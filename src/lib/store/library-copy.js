/**
 * The reading list's copy bound to this extension: the rules of
 * `library-backup.js` with IndexedDB, the config and `storage.local` behind
 * them, and every entry quiet on failure - the copy is insurance, and a
 * save that succeeded must not turn into an error because its insurance
 * did. `articles.js` and `books.js` call these after their writes and
 * before the writes that could fill an empty library; the reader's list
 * asks the restore before it reads; the settings page moves the switch.
 */

import { effectiveLibraryCopy, platformOs, readConfig } from "../config.js";
import { asPosition } from "../reader/position.js";
import { asBookMeta } from "./book.js";
import {
  articleKey,
  bookKey,
  buildLibraryCopy as buildWith,
  clearLibraryCopy as clearWith,
  copyArticle as copyArticleWith,
  copyBook as copyBookWith,
  copyPosition as copyPositionWith,
  copySummary,
  dropCopied,
  patchCopiedMeta,
  restoreLibrary as restoreWith,
  segmentsOf,
  storageDeps,
} from "./library-backup.js";
import { promisify, withLibrary } from "./library-db.js";
import { asSavedMeta } from "./saved-article.js";

/**
 * @typedef {import("./library-backup.js").LibraryCopyDeps} LibraryCopyDeps
 * @typedef {import("./library-backup.js").CopiedBook} CopiedBook
 * @typedef {import("./library-backup.js").Segment} Segment
 * @typedef {import("./saved-article.js").SavedArticle} SavedArticle
 * @typedef {import("./saved-article.js").SavedMeta} SavedMeta
 * @typedef {import("./book.js").BookMeta} BookMeta
 * @typedef {import("../reader/position.js").ReadingPosition} ReadingPosition
 * @typedef {import("./library-db.js").LibraryStores} LibraryStores
 */

/** The platform, asked once: it does not change under a running page. */
/** @type {Promise<string> | null} */
let platform = null;

/** @returns {Promise<string>} */
function os() {
  platform ??= platformOs();
  return platform;
}

/**
 * Every key of one book's segments (`books.js` explains the empty array).
 *
 * @param {string} bookId
 * @returns {IDBKeyRange}
 */
function segmentRange(bookId) {
  return IDBKeyRange.bound([bookId, 0], [bookId, []]);
}

/**
 * @param {LibraryStores} stores
 * @returns {Promise<boolean>}
 */
async function isEmpty(stores) {
  const [metas, books] = await Promise.all([
    promisify(stores.meta.count()),
    promisify(stores.books.count()),
  ]);
  return metas === 0 && books === 0;
}

/**
 * Every saved article whole, joined from its two stores the way
 * `allArticles` joins them - repeated here rather than imported, because
 * `articles.js` imports this module and a module must not need its caller.
 *
 * @param {unknown[]} metas
 * @param {unknown[]} stored
 * @returns {SavedArticle[]}
 */
function articlesOf(metas, stored) {
  /** @type {Map<string, { content: string, dir: string | null, lang: string | null }>} */
  const contents = new Map();
  for (const row of stored) {
    if (typeof row !== "object" || row === null) continue;
    const { url, content, dir, lang } = /** @type {Record<string, unknown>} */ (row);
    if (typeof url !== "string" || typeof content !== "string" || content.length === 0) continue;
    contents.set(url, {
      content,
      dir: typeof dir === "string" && dir.length > 0 ? dir : null,
      lang: typeof lang === "string" && lang.length > 0 ? lang : null,
    });
  }
  /** @type {SavedArticle[]} */
  const articles = [];
  for (const row of metas) {
    const meta = asSavedMeta(row);
    if (meta === null) continue;
    const held = contents.get(meta.url);
    if (held !== undefined) articles.push({ ...meta, ...held });
  }
  return articles;
}

/**
 * Every book with all of its text, from one read of the segments store - a
 * book whose text is not all there is left out, as `segmentsOf` rules.
 *
 * @param {unknown[]} rows book rows
 * @param {unknown[]} segmentRows every segment row, in key order
 * @returns {CopiedBook[]}
 */
function booksOf(rows, segmentRows) {
  /** @type {Map<string, unknown[]>} */
  const byBook = new Map();
  for (const row of segmentRows) {
    if (typeof row !== "object" || row === null) continue;
    const { bookId } = /** @type {Record<string, unknown>} */ (row);
    if (typeof bookId !== "string") continue;
    const list = byBook.get(bookId) ?? [];
    list.push(row);
    byBook.set(bookId, list);
  }
  /** @type {CopiedBook[]} */
  const books = [];
  for (const row of rows) {
    const meta = asBookMeta(row);
    if (meta === null) continue;
    const segments = segmentsOf(meta, byBook.get(meta.id) ?? []);
    if (segments !== null) books.push({ meta, segments });
  }
  return books;
}

/**
 * The copy's view of this extension: the switch as the config and the
 * platform decide it, and the library's three answers - its emptiness, its
 * whole, and the rows written back into an empty one (checked again inside
 * the transaction that writes them, because the count outside it is a gate,
 * not a lock).
 *
 * @returns {LibraryCopyDeps}
 */
function copyDeps() {
  return {
    ...storageDeps(),
    enabled: async () => effectiveLibraryCopy(await readConfig(), await os()),
    empty: () => withLibrary("readonly", isEmpty),
    snapshot: async () => {
      const { metas, stored, books, segments, positions } = await withLibrary("readonly", async (stores) => ({
        metas: /** @type {unknown[]} */ (await promisify(stores.meta.getAll())),
        stored: /** @type {unknown[]} */ (await promisify(stores.content.getAll())),
        books: /** @type {unknown[]} */ (await promisify(stores.books.getAll())),
        segments: /** @type {unknown[]} */ (await promisify(stores.bookSegments.getAll())),
        positions: /** @type {unknown[]} */ (await promisify(stores.positions.getAll())),
      }));
      return {
        articles: articlesOf(metas, stored),
        books: booksOf(books, segments),
        positions: positions.map(asPosition).filter((position) => position !== null),
      };
    },
    putRows: async (library) => {
      return await withLibrary("readwrite", async (stores) => {
        if (!(await isEmpty(stores))) return 0;
        for (const article of library.articles) {
          const { content, dir, lang, ...meta } = article;
          await promisify(stores.meta.put(meta));
          await promisify(stores.content.put({ url: article.url, content, dir, lang }));
        }
        for (const { meta, segments } of library.books) {
          for (const [index, segment] of segments.entries()) {
            await promisify(stores.bookSegments.put({ bookId: meta.id, index, ...segment }));
          }
          await promisify(stores.books.put(meta));
        }
        for (const position of library.positions) await promisify(stores.positions.put(position));
        return library.articles.length + library.books.length;
      });
    },
  };
}

/**
 * Whatever the browser deleted, back from the copy - the library empty and
 * the copy holding a document being the one shape that means. Asked by the
 * writes that could fill an empty library and by the list before it reads,
 * after `restoreMarks` in every case (its rule wants no marks either, and a
 * library restored first would refuse the marks their way back).
 *
 * @returns {Promise<number>} how many documents came back
 */
export async function restoreLibrary() {
  try {
    return await restoreWith(copyDeps());
  } catch {
    return 0;
  }
}

/**
 * The copy made whole from the library - the switch turned on.
 *
 * @returns {Promise<boolean>} whether the copy was built
 */
export async function buildLibraryCopy() {
  try {
    await buildWith(copyDeps());
    return true;
  } catch {
    return false;
  }
}

/**
 * The copy removed - the switch turned off.
 *
 * @returns {Promise<boolean>} whether the copy was cleared
 */
export async function clearLibraryCopy() {
  try {
    await clearWith(copyDeps());
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {SavedArticle} article
 * @param {boolean} replaced whether the save wrote over an older article
 * @returns {Promise<void>}
 */
export async function copyArticle(article, replaced) {
  try {
    await copyArticleWith(article, replaced, copyDeps());
  } catch {
    // Insurance, not a transaction: the article is saved either way.
  }
}

/**
 * The book just written, read back whole for the copy: the row and every
 * segment, which the import wrote before the row - so a book with a row has
 * all of its text, or `segmentsOf` refuses it.
 *
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function copyBook(id) {
  try {
    const deps = copyDeps();
    if (!(await deps.enabled())) return;
    const { row, rows } = await withLibrary("readonly", async (stores) => ({
      row: /** @type {unknown} */ (await promisify(stores.books.get(id))),
      rows: /** @type {unknown[]} */ (await promisify(stores.bookSegments.getAll(segmentRange(id)))),
    }));
    const meta = asBookMeta(row);
    if (meta === null) return;
    const segments = segmentsOf(meta, rows);
    if (segments !== null) await copyBookWith({ meta, segments }, deps);
  } catch {
    // As above.
  }
}

/**
 * @param {ReadingPosition} position
 * @returns {Promise<void>}
 */
export async function copyPosition(position) {
  try {
    await copyPositionWith(position, copyDeps());
  } catch {
    // As above.
  }
}

/**
 * @param {SavedMeta} meta the article's light row as it stands now
 * @returns {Promise<void>}
 */
export async function patchArticleCopy(meta) {
  try {
    await patchCopiedMeta(articleKey(meta.url), meta, copyDeps());
  } catch {
    // As above.
  }
}

/**
 * @param {BookMeta} meta the book's row as it stands now
 * @returns {Promise<void>}
 */
export async function patchBookCopy(meta) {
  try {
    await patchCopiedMeta(bookKey(meta.id), meta, copyDeps());
  } catch {
    // As above.
  }
}

/**
 * @param {string} url
 * @returns {Promise<void>}
 */
export async function dropArticleCopy(url) {
  try {
    await dropCopied(url, "article", copyDeps());
  } catch {
    // As above.
  }
}

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function dropBookCopy(id) {
  try {
    await dropCopied(id, "book", copyDeps());
  } catch {
    // As above.
  }
}

/**
 * The copy in two numbers for the settings page: how many documents, how
 * much space - or null for no copy at all, and null when the area will not
 * answer, which the line reads the same way.
 *
 * @returns {Promise<{ docs: number, bytes: number } | null>}
 */
export async function readLibraryCopy() {
  try {
    return copySummary(await storageDeps().readAll());
  } catch {
    return null;
  }
}
