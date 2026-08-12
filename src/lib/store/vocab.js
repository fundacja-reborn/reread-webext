/**
 * Where the vocabulary lives: the one thing in this extension that cannot be
 * downloaded again.
 *
 * Its own database, separate from `reread-models` (D13). Models are replaceable
 * bytes; phrases are the reader's own work, so clearing every model must never
 * be a way to lose one, and neither schema constrains the other's upgrades.
 *
 * One store, and the shape of a row is in `phrase.js`. The uniqueness the brief
 * asks for - one row per (language pair, normalized phrase) - is a unique index
 * rather than the primary key, so that a future change to `normalize()` rebuilds
 * an index instead of rewriting the identity of every row (D20).
 *
 * Only the background writes this. Content scripts read a derived copy from
 * `storage.local` (`mirror.js`) and ask the background to write; the
 * saved-phrases page - an extension page, so the same origin as this
 * database - reads it directly and writes through the background like
 * everything else, because a write is two steps (the row, then the mirror)
 * and `background/vocabulary.js` is where that rule is enforced.
 */

import { resaved } from "./phrase.js";

const DB_NAME = "reread-vocab";
const DB_VERSION = 1;
const PHRASES = "phrases";

/** `(langFrom, langTo, normalized)` - the key from the brief, unique. */
const BY_KEY = "by_key";
/** Everything saved for one language pair: the mirror, and later the export. */
const BY_PAIR = "by_pair";

/**
 * @typedef {import("./phrase.js").Phrase} Phrase
 * @typedef {{ langFrom: string, langTo: string }} Pair
 * @typedef {{ langFrom: string, langTo: string, normalized: string }} PhraseKey
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
      if (db.objectStoreNames.contains(PHRASES)) return;
      const phrases = db.createObjectStore(PHRASES, { keyPath: "id" });
      phrases.createIndex(BY_KEY, ["langFrom", "langTo", "normalized"], { unique: true });
      phrases.createIndex(BY_PAIR, ["langFrom", "langTo"], { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Cannot open the vocabulary database"));
    // A page holding an older version open would block the upgrade forever, and
    // waiting in silence is worse than saying so.
    request.onblocked = () => reject(new Error("The vocabulary database is in use by another page"));
  });
}

/**
 * @template T
 * @param {IDBTransactionMode} mode
 * @param {(store: IDBObjectStore) => Promise<T>} work
 * @returns {Promise<T>}
 */
async function withPhrases(mode, work) {
  const db = await open();
  try {
    const transaction = db.transaction([PHRASES], mode);
    const result = await work(transaction.objectStore(PHRASES));
    await new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve(undefined);
      transaction.onerror = () => reject(transaction.error ?? new Error("Vocabulary transaction failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Vocabulary transaction aborted"));
    });
    return result;
  } finally {
    db.close();
  }
}

/**
 * @param {PhraseKey} key
 * @returns {[string, string, string]}
 */
function indexKey({ langFrom, langTo, normalized }) {
  return [langFrom, langTo, normalized];
}

/**
 * Saves a phrase, replacing the meanings of one already saved under the same
 * key. Lookup and write happen in one transaction: two tabs saving the same
 * word at the same moment must not end up as two rows, and the unique index
 * would reject the second one anyway.
 *
 * @param {Phrase} phrase
 * @returns {Promise<void>}
 */
export async function putPhrase(phrase) {
  await withPhrases("readwrite", async (store) => {
    const existing = /** @type {Phrase | undefined} */ (
      await promisify(store.index(BY_KEY).get(indexKey(phrase)))
    );
    await promisify(store.put(existing === undefined ? phrase : resaved(existing, phrase)));
  });
}

/**
 * @param {PhraseKey} key
 * @returns {Promise<Phrase | null>}
 */
export async function getPhrase(key) {
  const record = await withPhrases("readonly", (store) =>
    promisify(store.index(BY_KEY).get(indexKey(key))),
  );
  return record ?? null;
}

/**
 * @param {PhraseKey} key
 * @returns {Promise<boolean>} whether there was anything to forget
 */
export async function deletePhrase(key) {
  return await withPhrases("readwrite", async (store) => {
    const id = await promisify(store.index(BY_KEY).getKey(indexKey(key)));
    if (id === undefined) return false;
    await promisify(store.delete(id));
    return true;
  });
}

/**
 * Everything saved for one language pair, oldest first.
 *
 * Sorted here rather than by the index, which orders by its own key: what a
 * reader means by "my vocabulary" is the order they collected it in, and an
 * export that reshuffles itself between runs is an export nobody can diff.
 *
 * @param {Pair} pair
 * @returns {Promise<Phrase[]>}
 */
export async function listPhrases(pair) {
  const records = /** @type {Phrase[]} */ (
    await withPhrases("readonly", (store) =>
      promisify(store.index(BY_PAIR).getAll([pair.langFrom, pair.langTo])),
    )
  );
  return records.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/**
 * Which pairs have anything saved, and how much. The saved-phrases page offers
 * these rather than the installed models, because vocabulary outlives its
 * model: deleting the `enpl` model must not hide the phrases saved with it.
 *
 * Distinct pairs come off the index keys (`nextunique`), so nothing here loads
 * a phrase - the counts are index counts, a handful of point queries in the
 * same transaction.
 *
 * @returns {Promise<Array<Pair & { count: number }>>}
 */
export async function listPairs() {
  return await withPhrases("readonly", async (store) => {
    const index = store.index(BY_PAIR);

    /** @type {Pair[]} */
    const pairs = [];
    await new Promise((resolve, reject) => {
      const request = index.openKeyCursor(null, "nextunique");
      request.onerror = () => reject(request.error ?? new Error("Cannot list the saved language pairs"));
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor === null) {
          resolve(undefined);
          return;
        }
        const [langFrom, langTo] = /** @type {[string, string]} */ (cursor.key);
        pairs.push({ langFrom, langTo });
        cursor.continue();
      };
    });

    const counts = await Promise.all(
      pairs.map((pair) => promisify(index.count([pair.langFrom, pair.langTo]))),
    );
    return pairs.map((pair, at) => ({ ...pair, count: counts[at] ?? 0 }));
  });
}
