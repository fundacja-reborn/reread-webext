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
 * Only the reader page opens this. The background never needs an article, no
 * message carries one, and an extension page writing its own origin's
 * database directly is the same call D14 made for models.
 */

import { asSavedMeta } from "./saved-article.js";

const DB_NAME = "reread-articles";
const DB_VERSION = 1;
/** The list's half: one light row per article. */
const META = "meta";
/** The article's half: the rebuilt markup, read only to render one. */
const CONTENT = "content";

/**
 * @typedef {import("./saved-article.js").SavedMeta} SavedMeta
 * @typedef {import("./saved-article.js").SavedArticle} SavedArticle
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
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Cannot open the articles database"));
    request.onblocked = () => reject(new Error("The articles database is in use by another page"));
  });
}

/**
 * @template T
 * @param {IDBTransactionMode} mode
 * @param {(meta: IDBObjectStore, content: IDBObjectStore) => Promise<T>} work
 * @returns {Promise<T>}
 */
async function withStores(mode, work) {
  const db = await open();
  try {
    const transaction = db.transaction([META, CONTENT], mode);
    const result = await work(transaction.objectStore(META), transaction.objectStore(CONTENT));
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
 * @param {SavedArticle} article
 * @returns {Promise<void>}
 */
export async function putArticle(article) {
  const { content, dir, lang, ...meta } = article;
  await withStores("readwrite", async (metaStore, contentStore) => {
    await promisify(metaStore.put(meta));
    await promisify(contentStore.put({ url: article.url, content, dir, lang }));
  });
}

/**
 * Deletes at both ends, and quietly when there was nothing: the second press
 * of a toggle and a row that is already gone mean the same thing.
 *
 * @param {string} url
 * @returns {Promise<void>}
 */
export async function deleteArticle(url) {
  await withStores("readwrite", async (metaStore, contentStore) => {
    await promisify(metaStore.delete(url));
    await promisify(contentStore.delete(url));
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
