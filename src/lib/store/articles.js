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
 * gone would be an orphan nothing ever cleans.
 */

import { asPosition } from "../reader/position.js";
import { importPlan } from "./articles-file.js";
import { promisify, withLibrary } from "./library-db.js";
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
 * Overwriting also clears the old reading position: the anchor counted blocks
 * of the text that has just been replaced, and saving a page again puts it
 * back on the reading pile - the same reset `readAt` gets.
 *
 * @param {SavedArticle} article
 * @returns {Promise<void>}
 */
export async function putArticle(article) {
  const { content, dir, lang, ...meta } = article;
  await withLibrary("readwrite", async (stores) => {
    await promisify(stores.meta.put(meta));
    await promisify(stores.content.put({ url: article.url, content, dir, lang }));
    await promisify(stores.positions.delete(article.url));
  });
}

/**
 * Deletes at both ends, and quietly when there was nothing: the second press
 * of a toggle and a row that is already gone mean the same thing. The reading
 * position leaves in the same transaction - a place in a document that is
 * gone is an orphan nothing would ever clean.
 *
 * @param {string} url
 * @returns {Promise<void>}
 */
export async function deleteArticle(url) {
  await withLibrary("readwrite", async (stores) => {
    await promisify(stores.meta.delete(url));
    await promisify(stores.content.delete(url));
    await promisify(stores.positions.delete(url));
  });
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
 * @param {SavedArticle[]} articles
 * @returns {Promise<{ added: number, skipped: number }>}
 */
export async function importArticles(articles) {
  return await withLibrary("readwrite", async (stores) => {
    const keys = /** @type {IDBValidKey[]} */ (await promisify(stores.meta.getAllKeys()));
    const { toAdd, skipped } = importPlan(keys.map(String), articles);
    for (const article of toAdd) {
      const { content, dir, lang, ...meta } = article;
      await promisify(stores.meta.put(meta));
      await promisify(stores.content.put({ url: article.url, content, dir, lang }));
    }
    return { added: toAdd.length, skipped };
  });
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
  return await withLibrary("readwrite", async (stores) => {
    const row = asSavedMeta(await promisify(stores.meta.get(url)));
    if (row === null) return null;
    const updated = { ...row, readAt };
    await promisify(stores.meta.put(updated));
    return updated;
  });
}
