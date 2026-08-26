/**
 * Where saved articles live: the articles' half of the reading list's
 * database (`library-db.js` opens it and says why everything shares it).
 *
 * Two stores rather than one, for the reason the model database has two:
 * "what is saved here" has to be answerable without pulling every article's
 * content into memory - IndexedDB cannot read half a row.
 *
 * The primary key of both stores is the article's `url`. That is decision
 * D-d made schema: saving the same page again *is* overwriting the entry,
 * so one row per address is an invariant the database keeps, not a rule a
 * transaction remembers to check.
 *
 * Reading positions live here too - where in a document its reader stopped.
 * Keyed by `docId` rather than `url` because books keep their positions in
 * the same store under their own ids, and a position must leave together
 * with its document: a row about where somebody was in an article that is
 * gone would be an orphan nothing ever cleans. The highlighter's marks
 * (`marks.js`) are rows about a document in the same way, and every rule
 * about the position row - leaves with the document, cleared by an
 * overwrite whose content it measured - holds for them below too.
 */

import { asPosition } from "../reader/position.js";
import { importPlan } from "./articles-file.js";
import {
  copyArticle,
  copyPosition,
  dropArticleCopy,
  patchArticleCopy,
  restoreLibrary,
} from "./library-copy.js";
import { promisify, withLibrary } from "./library-db.js";
import { rebuildMarksBackup, restoreMarks } from "./marks.js";
import { asSavedMeta } from "./saved-article.js";

/**
 * @typedef {import("./saved-article.js").SavedMeta} SavedMeta
 * @typedef {import("./saved-article.js").SavedArticle} SavedArticle
 * @typedef {import("../reader/position.js").ReadingPosition} ReadingPosition
 */

/**
 * Saves an article, replacing whatever was saved under the same address. Both
 * halves go in one transaction: a row the list shows must never point at
 * content that is not there.
 *
 * Overwriting also clears the old reading position and the old highlighter
 * marks: both anchored into the text that has just been replaced, and saving
 * a page again puts it back on the reading pile - the same reset `readAt`
 * gets. A first save of an address clears nothing: the only marks that can
 * stand under an address nobody saved are the ones the copy put back after
 * the browser emptied the library (`marks-backup.js`), and this save is the
 * page returning to them. The reading list's own copy is asked back first
 * for the same reason and written after (`library-copy.js`).
 *
 * @param {SavedArticle} article
 * @returns {Promise<void>}
 */
export async function putArticle(article) {
  await restoreMarks();
  await restoreLibrary();
  const { content, dir, lang, ...meta } = article;
  const replaced = await withLibrary("readwrite", async (stores) => {
    const existing = await promisify(stores.meta.get(article.url));
    await promisify(stores.meta.put(meta));
    await promisify(stores.content.put({ url: article.url, content, dir, lang }));
    if (existing === undefined) return false;
    await promisify(stores.positions.delete(article.url));
    await promisify(stores.marks.delete(article.url));
    return true;
  });
  if (replaced) await rebuildMarksBackup();
  await copyArticle(article, replaced);
}

/**
 * Deletes at both ends, and quietly when there was nothing: the second press
 * of a toggle and a row that is already gone mean the same thing. The reading
 * position and the marks leave in the same transaction - a place in a
 * document that is gone is an orphan nothing would ever clean.
 *
 * @param {string} url
 * @returns {Promise<void>}
 */
export async function deleteArticle(url) {
  await withLibrary("readwrite", async (stores) => {
    await promisify(stores.meta.delete(url));
    await promisify(stores.content.delete(url));
    await promisify(stores.positions.delete(url));
    await promisify(stores.marks.delete(url));
  });
  await rebuildMarksBackup();
  await dropArticleCopy(url);
}

/**
 * Where this document's reader stopped, or null for the top - which is also
 * the answer for a torn row, exactly as `restoredIndex` will read it.
 *
 * @param {string} docId
 * @returns {Promise<ReadingPosition | null>}
 */
export async function getPosition(docId) {
  const row = await withLibrary("readonly", (stores) => promisify(stores.positions.get(docId)));
  return asPosition(row);
}

/**
 * Every position at once, for the list: fifty rows asking one at a time
 * would be fifty transactions for what one `getAll` answers. Unreadable rows
 * drop out here, so the list never has to doubt what it was handed.
 *
 * @returns {Promise<Map<string, ReadingPosition>>} keyed by `docId`
 */
export async function allPositions() {
  const rows = /** @type {unknown[]} */ (
    await withLibrary("readonly", (stores) => promisify(stores.positions.getAll()))
  );
  /** @type {Map<string, ReadingPosition>} */
  const positions = new Map();
  for (const row of rows) {
    const position = asPosition(row);
    if (position !== null) positions.set(position.docId, position);
  }
  return positions;
}

/**
 * One row per document, overwritten in place: the position is the latest
 * word, and its history means nothing.
 *
 * @param {ReadingPosition} position
 * @returns {Promise<void>}
 */
export async function putPosition(position) {
  await withLibrary("readwrite", async (stores) => {
    await promisify(stores.positions.put(position));
  });
  await copyPosition(position);
}

/**
 * The light half of one article - what the save button asks to know whether
 * this address is already kept.
 *
 * @param {string} url
 * @returns {Promise<SavedMeta | null>}
 */
export async function getArticleMeta(url) {
  const row = await withLibrary("readonly", (stores) => promisify(stores.meta.get(url)));
  return asSavedMeta(row);
}

/**
 * Every saved article's light half, unordered - the list orders and filters
 * through `listedRows`, where the rule is testable.
 *
 * @returns {Promise<SavedMeta[]>}
 */
export async function listArticles() {
  const rows = /** @type {unknown[]} */ (
    await withLibrary("readonly", (stores) => promisify(stores.meta.getAll()))
  );
  return rows.map(asSavedMeta).filter((meta) => meta !== null);
}

/**
 * One whole article, or null when either half is missing - a torn row is
 * treated as absent rather than rendered halfway.
 *
 * @param {string} url
 * @returns {Promise<SavedArticle | null>}
 */
export async function getArticle(url) {
  const { meta, stored } = await withLibrary("readonly", async (stores) => ({
    meta: asSavedMeta(await promisify(stores.meta.get(url))),
    stored: /** @type {unknown} */ (await promisify(stores.content.get(url))),
  }));
  if (meta === null || typeof stored !== "object" || stored === null) return null;

  const { content, dir, lang } = /** @type {Record<string, unknown>} */ (stored);
  if (typeof content !== "string" || content.length === 0) return null;

  return {
    ...meta,
    content,
    dir: typeof dir === "string" && dir.length > 0 ? dir : null,
    lang: typeof lang === "string" && lang.length > 0 ? lang : null,
  };
}

/**
 * Every saved article whole, for the export file: both stores read in one
 * readonly transaction and joined by address. A torn row - either half missing
 * or unreadable - is left out rather than exported half, the same reading
 * `getArticle` gives one.
 *
 * @returns {Promise<SavedArticle[]>}
 */
export async function allArticles() {
  const { metas, stored } = await withLibrary("readonly", async (stores) => ({
    metas: /** @type {unknown[]} */ (await promisify(stores.meta.getAll())),
    stored: /** @type {unknown[]} */ (await promisify(stores.content.getAll())),
  }));

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
 * Adds a file's worth of articles - and only adds: which rows that means is
 * `importPlan`'s decision, held down by its own tests. The look at what exists
 * and the writes share one readwrite transaction, so an article saved from
 * another tab between the two cannot end up written twice - the database's
 * one-row-per-address invariant is checked where it is enforced.
 *
 * The marks an entry brought ride in beside it (D106) - and only beside an
 * entry that is being added: a skipped article keeps its copy untouched in
 * the whole, marks included. And only where no marks row stands under the
 * address already: the one row that can stand under an address nobody saved
 * is the copy's (`marks-backup.js`, after the browser emptied the library),
 * and it is the latest word - newer than any file, which was written before
 * the marks the reader made since.
 *
 * @param {import("./articles-file.js").FileArticle[]} articles
 * @returns {Promise<{ added: number, skipped: number }>}
 */
export async function importArticles(articles) {
  await restoreMarks();
  const { added, skipped } = await withLibrary("readwrite", async (stores) => {
    const keys = /** @type {IDBValidKey[]} */ (await promisify(stores.meta.getAllKeys()));
    const plan = importPlan(keys.map(String), articles);
    /** @type {SavedArticle[]} */
    const added = [];
    for (const article of plan.toAdd) {
      const { content, dir, lang, marks, ...meta } = article;
      await promisify(stores.meta.put(meta));
      await promisify(stores.content.put({ url: article.url, content, dir, lang }));
      if (marks !== undefined && marks.length > 0) {
        const standing = await promisify(stores.marks.getKey(article.url));
        if (standing === undefined) await promisify(stores.marks.put({ docId: article.url, marks }));
      }
      added.push({ ...meta, content, dir, lang });
    }
    return { added, skipped: plan.skipped };
  });
  if (added.length > 0) await rebuildMarksBackup();
  for (const article of added) await copyArticle(article, false);
  return { added: added.length, skipped };
}

/**
 * Marks one article read, or unread again - the whole meaning of the toggle
 * in the article view. Read-and-write in one transaction, and a no-op when
 * the article is gone: marking is never a way to resurrect a row.
 *
 * @param {string} url
 * @param {number | null} readAt
 * @returns {Promise<SavedMeta | null>} the row as it stands now
 */
export async function setReadAt(url, readAt) {
  const updated = await withLibrary("readwrite", async (stores) => {
    const row = asSavedMeta(await promisify(stores.meta.get(url)));
    if (row === null) return null;
    const updated = { ...row, readAt };
    await promisify(stores.meta.put(updated));
    return updated;
  });
  if (updated !== null) await patchArticleCopy(updated);
  return updated;
}
