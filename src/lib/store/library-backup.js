/**
 * The copy of the reading list that outlives the database: every saved
 * article whole, every book with its text, and where the reader stopped in
 * each. The third copy after the vocabulary's (`backup.js`) and the
 * highlights' (`marks-backup.js`), for the reason those two exist: Safari
 * deletes the origin's IndexedDB after thirty days without a touch on the
 * extension's pages, and `storage.local` is where that does not reach.
 *
 * Unlike the first two it is a choice (`libraryCopy` in the config). The
 * vocabulary and the marks are the reader's own work - small, and impossible
 * to type in again - so they are copied everywhere. The reading list is
 * large (the copy doubles the space it takes) and mostly findable again, so
 * it is copied where the risk is real - iOS and iPadOS, unless switched off -
 * and on request elsewhere (`effectiveLibraryCopy`).
 *
 * And unlike them it is not one value but one key per document:
 *
 *   - `libraryCopy:article:<url>` - the article whole, as `getArticle` gives it
 *   - `libraryCopy:book:<id>` - the book's row and every segment of its text
 *   - `libraryCopy:position:<docId>` - where the reader stopped in it
 *
 * because one value would mean rewriting tens of megabytes after every saved
 * reading position, and because a row that will not read should cost only its
 * own document. There is no index: the keys are found by their prefix in a
 * read of the whole area, asked only when the library is empty, when the
 * switch moves, and for the settings page's line.
 *
 * The rules: additions only while the copy is on, removals always (switching
 * off clears the copy, and a stale row must never come back with the switch);
 * a document's light row is patched where it stands and written nowhere it
 * does not; restored only into an empty library - no article, no book -
 * asked before the writes that make one and before the list reads, always
 * after the highlights' own restore, whose rule wants no marks either; and
 * quiet in every failure, because the copy is insurance and a save must not
 * fail for its insurance (`library-copy.js` binds it so).
 *
 * The store and the storage arrive as parameters so the rules can be tested
 * against stand-ins; `library-copy.js` supplies IndexedDB, the config and
 * `storage.local`.
 */

import { webext } from "../browser.js";
import { asPosition } from "../reader/position.js";
import { asBookMeta, asSegment } from "./book.js";
import { asSavedMeta } from "./saved-article.js";

/**
 * @typedef {import("./saved-article.js").SavedArticle} SavedArticle
 * @typedef {import("./saved-article.js").SavedMeta} SavedMeta
 * @typedef {import("./book.js").BookMeta} BookMeta
 * @typedef {import("../reader/position.js").ReadingPosition} ReadingPosition
 * @typedef {{ blocks: string[], charCount: number }} Segment
 */

/**
 * A book as the copy carries it and as the library gets it back: the light
 * row and its text, every segment in reading order.
 *
 * @typedef {{ meta: BookMeta, segments: Segment[] }} CopiedBook
 */

/**
 * Everything the copy holds, read back from the whole area: the keys that
 * wear the prefix (readable or not - a clear has to take them all), and what
 * of it narrows to a document. Positions only of documents that are here:
 * a place in a document the copy does not hold would be a row nothing ever
 * cleans.
 *
 * @typedef {{ keys: string[], articles: SavedArticle[], books: CopiedBook[], positions: ReadingPosition[] }} CopiedLibrary
 */

/**
 * The library as the copy is built from it, whole.
 *
 * @typedef {{ articles: SavedArticle[], books: CopiedBook[], positions: ReadingPosition[] }} LibrarySnapshot
 */

/**
 * @typedef {object} LibraryCopyDeps
 * @property {() => Promise<boolean>} enabled whether the copy is on, as the switch and the platform decide
 * @property {() => Promise<boolean>} empty whether the library holds no article and no book
 * @property {(library: CopiedLibrary) => Promise<number>} putRows the documents written back - into an
 *   empty library only, checked again where the write is atomic; answers how many were
 * @property {() => Promise<LibrarySnapshot>} snapshot the whole library, for a build
 * @property {() => Promise<Record<string, unknown>>} readAll everything in the storage area
 * @property {(key: string) => Promise<unknown>} read whatever stands under one key
 * @property {(items: Record<string, unknown>) => Promise<void>} write
 * @property {(keys: string[]) => Promise<void>} remove
 */

/** What every key of the copy begins with, in `storage.local`. */
export const LIBRARY_COPY_PREFIX = "libraryCopy:";

const VERSION = 1;

/** @param {string} url */
export function articleKey(url) {
  return `${LIBRARY_COPY_PREFIX}article:${url}`;
}

/** @param {string} id */
export function bookKey(id) {
  return `${LIBRARY_COPY_PREFIX}book:${id}`;
}

/** @param {string} docId */
export function positionKey(docId) {
  return `${LIBRARY_COPY_PREFIX}position:${docId}`;
}

/**
 * The storage half of the dependencies, the same on every page.
 *
 * @returns {Pick<LibraryCopyDeps, "readAll" | "read" | "write" | "remove">}
 */
export function storageDeps() {
  return {
    readAll: () => webext().storage.local.get(null),
    read: async (key) => (await webext().storage.local.get(key))[key],
    write: (items) => webext().storage.local.set(items),
    remove: async (keys) => {
      if (keys.length > 0) await webext().storage.local.remove(keys);
    },
  };
}

/**
 * The row an article is copied as: its light half apart from its text, the
 * same two halves the database keeps, so a patch of the light half never
 * has to carry the text along.
 *
 * @param {SavedArticle} article
 * @returns {{ version: number, meta: SavedMeta, content: string, dir: string | null, lang: string | null }}
 */
export function articleRow(article) {
  const { content, dir, lang, ...meta } = article;
  return { version: VERSION, meta, content, dir, lang };
}

/**
 * @param {CopiedBook} book
 * @returns {{ version: number, meta: BookMeta, segments: Segment[] }}
 */
export function bookRow(book) {
  return { version: VERSION, meta: book.meta, segments: book.segments };
}

/**
 * @param {ReadingPosition} position
 * @returns {{ version: number, position: ReadingPosition }}
 */
export function positionRow(position) {
  return { version: VERSION, position };
}

/**
 * A book's text as the database holds it, put in order - or nothing when it
 * is not all there: a copy of half a book is a book that opens on a hole,
 * and the database's own rule (`books.js`) is that the row is written last,
 * after every segment, so a book with a row has every segment or is torn.
 *
 * @param {BookMeta} book
 * @param {unknown[]} rows the segment rows under the book's id, in key order
 * @returns {Segment[] | null}
 */
export function segmentsOf(book, rows) {
  /** @type {Segment[]} */
  const segments = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) return null;
    const { index } = /** @type {Record<string, unknown>} */ (row);
    const segment = asSegment(row);
    if (index !== segments.length || segment === null) return null;
    segments.push(segment);
  }
  return segments.length === book.segmentCount ? segments : null;
}

/**
 * @param {unknown} value
 * @returns {SavedArticle | null}
 */
export function asCopiedArticle(value) {
  if (typeof value !== "object" || value === null) return null;
  const { version, meta, content, dir, lang } = /** @type {Record<string, unknown>} */ (value);
  if (version !== VERSION) return null;
  const light = asSavedMeta(meta);
  if (light === null || typeof content !== "string" || content.length === 0) return null;
  return {
    ...light,
    content,
    dir: typeof dir === "string" && dir.length > 0 ? dir : null,
    lang: typeof lang === "string" && lang.length > 0 ? lang : null,
  };
}

/**
 * @param {unknown} value
 * @returns {CopiedBook | null}
 */
export function asCopiedBook(value) {
  if (typeof value !== "object" || value === null) return null;
  const { version, meta, segments } = /** @type {Record<string, unknown>} */ (value);
  if (version !== VERSION || !Array.isArray(segments)) return null;
  const book = asBookMeta(meta);
  if (book === null || segments.length !== book.segmentCount) return null;
  /** @type {Segment[]} */
  const kept = [];
  for (const row of segments) {
    const segment = asSegment(row);
    if (segment === null) return null;
    kept.push(segment);
  }
  return { meta: book, segments: kept };
}

/**
 * @param {unknown} value
 * @returns {ReadingPosition | null}
 */
export function asCopiedPosition(value) {
  if (typeof value !== "object" || value === null) return null;
  const { version, position } = /** @type {Record<string, unknown>} */ (value);
  return version === VERSION ? asPosition(position) : null;
}

/**
 * The copy picked out of the whole storage area by its prefix and narrowed
 * row by row. A row that will not read is still one of the copy's keys - a
 * clear takes it - but no document: the library gets back only what opens.
 *
 * @param {Record<string, unknown>} all everything the area holds
 * @returns {CopiedLibrary}
 */
export function copiedLibrary(all) {
  /** @type {string[]} */
  const keys = [];
  /** @type {SavedArticle[]} */
  const articles = [];
  /** @type {CopiedBook[]} */
  const books = [];
  /** @type {ReadingPosition[]} */
  const positions = [];
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(LIBRARY_COPY_PREFIX)) continue;
    keys.push(key);
    const kind = key.slice(LIBRARY_COPY_PREFIX.length).split(":", 1)[0];
    if (kind === "article") {
      const article = asCopiedArticle(value);
      if (article !== null && key === articleKey(article.url)) articles.push(article);
    } else if (kind === "book") {
      const book = asCopiedBook(value);
      if (book !== null && key === bookKey(book.meta.id)) books.push(book);
    } else if (kind === "position") {
      const position = asCopiedPosition(value);
      if (position !== null && key === positionKey(position.docId)) positions.push(position);
    }
  }
  const docIds = new Set([...articles.map((article) => article.url), ...books.map((book) => book.meta.id)]);
  return {
    keys: keys.sort(),
    articles: articles.sort((a, b) => a.url.localeCompare(b.url)),
    books: books.sort((a, b) => a.meta.id.localeCompare(b.meta.id)),
    positions: positions.filter((position) => docIds.has(position.docId)),
  };
}

/**
 * What the copy takes, as the settings page says it: the size of the rows as
 * they would be written, near enough - the area's own accounting is not
 * readable in every browser.
 *
 * @param {unknown} value
 * @returns {number} bytes
 */
function bytesOf(value) {
  return new TextEncoder().encode(JSON.stringify(value) ?? "").length;
}

/**
 * The copy in two numbers for the settings page, or null when there is no
 * copy at all - the line then says so, or says the switch is off.
 *
 * @param {Record<string, unknown>} all everything the area holds
 * @returns {{ docs: number, bytes: number } | null}
 */
export function copySummary(all) {
  const library = copiedLibrary(all);
  if (library.keys.length === 0) return null;
  return {
    docs: library.articles.length + library.books.length,
    bytes: library.keys.reduce((sum, key) => sum + bytesOf(all[key]), 0),
  };
}

/**
 * The rows every document of a library is copied as, keyed - the shape one
 * build writes and one restore reads.
 *
 * @param {LibrarySnapshot} library
 * @returns {Map<string, unknown>}
 */
export function rowsOf(library) {
  /** @type {Map<string, unknown>} */
  const rows = new Map();
  for (const article of library.articles) rows.set(articleKey(article.url), articleRow(article));
  for (const book of library.books) rows.set(bookKey(book.meta.id), bookRow(book));
  const docIds = new Set([
    ...library.articles.map((article) => article.url),
    ...library.books.map((book) => book.meta.id),
  ]);
  for (const position of library.positions) {
    if (docIds.has(position.docId)) rows.set(positionKey(position.docId), positionRow(position));
  }
  return rows;
}

/**
 * The library written back from the copy, when - and only when - the
 * library is empty and the copy holds a document. The emptiness is asked
 * first and the area read only then, so on every ordinary call this costs
 * two counts and nothing else.
 *
 * @param {LibraryCopyDeps} deps
 * @returns {Promise<number>} how many documents came back
 */
export async function restoreLibrary(deps) {
  if (!(await deps.empty())) return 0;
  const library = copiedLibrary(await deps.readAll());
  if (library.articles.length === 0 && library.books.length === 0) return 0;
  return await deps.putRows(library);
}

/**
 * The copy made whole from the library, when the switch is turned on: every
 * document written, one row at a time so no single write carries the whole
 * reading list, and the rows the library no longer names removed - whatever
 * a copy switched off and on again might have kept.
 *
 * @param {LibraryCopyDeps} deps
 * @returns {Promise<number>} how many documents the copy now holds
 */
export async function buildLibraryCopy(deps) {
  const library = await deps.snapshot();
  const rows = rowsOf(library);
  const stale = copiedLibrary(await deps.readAll()).keys.filter((key) => !rows.has(key));
  await deps.remove(stale);
  for (const [key, row] of rows) await deps.write({ [key]: row });
  return library.articles.length + library.books.length;
}

/**
 * The copy removed whole, when the switch is turned off - every key with the
 * prefix, readable or not.
 *
 * @param {LibraryCopyDeps} deps
 * @returns {Promise<number>} how many keys went
 */
export async function clearLibraryCopy(deps) {
  const { keys } = copiedLibrary(await deps.readAll());
  await deps.remove(keys);
  return keys.length;
}

/**
 * One article into the copy, after its save - and, when the save wrote over
 * an older article, its reading position out of it, the way the database
 * drops the position of text that is gone.
 *
 * @param {SavedArticle} article
 * @param {boolean} replaced whether the save wrote over an older article
 * @param {LibraryCopyDeps} deps
 * @returns {Promise<boolean>} whether the copy was written
 */
export async function copyArticle(article, replaced, deps) {
  if (replaced) await deps.remove([positionKey(article.url)]);
  if (!(await deps.enabled())) return false;
  await deps.write({ [articleKey(article.url)]: articleRow(article) });
  return true;
}

/**
 * One book into the copy, after the row that made it exist.
 *
 * @param {CopiedBook} book
 * @param {LibraryCopyDeps} deps
 * @returns {Promise<boolean>} whether the copy was written
 */
export async function copyBook(book, deps) {
  if (!(await deps.enabled())) return false;
  await deps.write({ [bookKey(book.meta.id)]: bookRow(book) });
  return true;
}

/**
 * @param {ReadingPosition} position
 * @param {LibraryCopyDeps} deps
 * @returns {Promise<boolean>} whether the copy was written
 */
export async function copyPosition(position, deps) {
  if (!(await deps.enabled())) return false;
  await deps.write({ [positionKey(position.docId)]: positionRow(position) });
  return true;
}

/**
 * A document's light row changed where it stands - read or unread again, a
 * table of contents found - and nowhere else: without a row under the key
 * there is nothing to patch, which is also what makes the switch unasked
 * here (a copy switched off has no rows).
 *
 * @param {string} key
 * @param {SavedMeta | BookMeta} meta
 * @param {LibraryCopyDeps} deps
 * @returns {Promise<boolean>} whether a row was patched
 */
export async function patchCopiedMeta(key, meta, deps) {
  const row = await deps.read(key);
  if (typeof row !== "object" || row === null) return false;
  await deps.write({ [key]: { ...row, meta } });
  return true;
}

/**
 * A document out of the copy, with its position - always, switch or no
 * switch: a row about a document that is gone must not outlive it.
 *
 * @param {string} docId an article's url or a book's id
 * @param {"article" | "book"} kind
 * @param {LibraryCopyDeps} deps
 * @returns {Promise<void>}
 */
export async function dropCopied(docId, kind, deps) {
  await deps.remove([kind === "article" ? articleKey(docId) : bookKey(docId), positionKey(docId)]);
}
