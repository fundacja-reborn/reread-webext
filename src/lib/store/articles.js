/**
 * Where saved articles live: the reading list's own database.
 *
 * Its own database rather than a second store in `reread-vocab`, for the
 * reason D13 gave models one: clearing or reimporting one kind of data must
 * never be a way to lose the other, and neither schema constrains the other's
 * upgrades. Its own two stores rather than one, for the reason the model
 * database has two: "what is saved here" has to be answerable without pulling
 * every article's content into memory - IndexedDB cannot read half a row.
 *
 * The primary key of both stores is the article's `url`. That is decision
 * D-d made schema: saving the same page again *is* overwriting the entry,
 * so one row per address is an invariant the database keeps, not a rule a
 * transaction remembers to check.
 *
 * The third store holds reading positions - where in a document its reader
 * stopped. In this database rather than its own because IndexedDB has no
 * transaction across databases, and a position must leave together with its
 * document: a row about where somebody was in an article that is gone would
 * be an orphan nothing ever cleans. Keyed by `docId` rather than `url`
 * because books, when they come, will keep positions here too under their
 * own ids.
 *
 * Only the reader page opens this. The background never needs an article, no
 * message carries one, and an extension page writing its own origin's
 * database directly is the same call D14 made for models.
 */

import { asPosition } from "../reader/position.js";
import { importPlan } from "./articles-file.js";
import { asSavedMeta } from "./saved-article.js";

const DB_NAME = "reread-articles";
const DB_VERSION = 2;
/** The list's half: one light row per article. */
const META = "meta";
/** The article's half: the rebuilt markup, read only to render one. */
const CONTENT = "content";
/** Where each document's reader stopped: one row per `docId`, or none. */
const POSITIONS = "positions";

/**
 * @typedef {import("./saved-article.js").SavedMeta} SavedMeta
 * @typedef {import("./saved-article.js").SavedArticle} SavedArticle
 * @typedef {import("../reader/position.js").ReadingPosition} ReadingPosition
 */

/**
 * @template T
 * @param {IDBRequest<T>} request
 * @returns {Promise<T>}
 */
function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

/**
 * @returns {Promise<IDBDatabase>}
 */
function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "url" });
      if (!db.objectStoreNames.contains(CONTENT)) db.createObjectStore(CONTENT, { keyPath: "url" });
      // Version 2. Contains-guarded like the others, so the one upgrade path
      // serves both a fresh install and a database from version 1.
      if (!db.objectStoreNames.contains(POSITIONS)) {
        db.createObjectStore(POSITIONS, { keyPath: "docId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Cannot open the articles database"));
    request.onblocked = () => reject(new Error("The articles database is in use by another page"));
  });
}

/**
 * @template T
 * @param {IDBTransactionMode} mode
 * @param {(
 *   meta: IDBObjectStore,
 *   content: IDBObjectStore,
 *   positions: IDBObjectStore,
 * ) => Promise<T>} work
 * @returns {Promise<T>}
 */
async function withStores(mode, work) {
  const db = await open();
  try {
    const transaction = db.transaction([META, CONTENT, POSITIONS], mode);
    const result = await work(
      transaction.objectStore(META),
      transaction.objectStore(CONTENT),
      transaction.objectStore(POSITIONS),
    );
    await new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve(undefined);
      transaction.onerror = () => reject(transaction.error ?? new Error("Articles transaction failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Articles transaction aborted"));
    });
    return result;
  } finally {
    db.close();
  }
}

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
  await withStores("readwrite", async (metaStore, contentStore, positionsStore) => {
    await promisify(metaStore.put(meta));
    await promisify(contentStore.put({ url: article.url, content, dir, lang }));
    await promisify(positionsStore.delete(article.url));
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
  await withStores("readwrite", async (metaStore, contentStore, positionsStore) => {
    await promisify(metaStore.delete(url));
    await promisify(contentStore.delete(url));
    await promisify(positionsStore.delete(url));
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
  const row = await withStores("readonly", (_meta, _content, positionsStore) =>
    promisify(positionsStore.get(docId)),
  );
  return asPosition(row);
}

/**
 * One row per document, overwritten in place: the position is the latest
 * word, and its history means nothing.
 *
 * @param {ReadingPosition} position
 * @returns {Promise<void>}
 */
export async function putPosition(position) {
  await withStores("readwrite", async (_meta, _content, positionsStore) => {
    await promisify(positionsStore.put(position));
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
  const row = await withStores("readonly", (metaStore) => promisify(metaStore.get(url)));
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
    await withStores("readonly", (metaStore) => promisify(metaStore.getAll()))
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
  const { meta, stored } = await withStores("readonly", async (metaStore, contentStore) => ({
    meta: asSavedMeta(await promisify(metaStore.get(url))),
    stored: /** @type {unknown} */ (await promisify(contentStore.get(url))),
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
  const { metas, stored } = await withStores("readonly", async (metaStore, contentStore) => ({
    metas: /** @type {unknown[]} */ (await promisify(metaStore.getAll())),
    stored: /** @type {unknown[]} */ (await promisify(contentStore.getAll())),
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
  return await withStores("readwrite", async (metaStore, contentStore) => {
    const keys = /** @type {IDBValidKey[]} */ (await promisify(metaStore.getAllKeys()));
    const { toAdd, skipped } = importPlan(keys.map(String), articles);
    for (const article of toAdd) {
      const { content, dir, lang, ...meta } = article;
      await promisify(metaStore.put(meta));
      await promisify(contentStore.put({ url: article.url, content, dir, lang }));
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
  return await withStores("readwrite", async (metaStore) => {
    const row = asSavedMeta(await promisify(metaStore.get(url)));
    if (row === null) return null;
    const updated = { ...row, readAt };
    await promisify(metaStore.put(updated));
    return updated;
  });
}
