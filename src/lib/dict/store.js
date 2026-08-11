/**
 * Where imported dictionaries live.
 *
 * Its own database, separate from both the models and the vocabulary, for the
 * reason D13 gave: a dictionary can be imported again from the file it came
 * from, a saved phrase cannot be recovered from anywhere. Deleting a dictionary
 * that turned out to be the wrong one must never be a way to lose vocabulary,
 * and an upgrade to one schema must never wait on the other.
 *
 * Two stores, and the split is the same one the models make: `meta` answers
 * "which dictionaries are here" in a few rows, `entries` holds the hundreds of
 * thousands. Nothing ever reads all of `entries`; it is only ever asked about
 * one word.
 *
 * The primary key of `entries` is `[dictId, key]` and there is no index at all.
 * A lookup knows which dictionaries are installed, so it can ask each of them
 * for a word directly - a handful of point reads. An index on the key would be
 * a second copy of every key in the database, bought for nothing.
 *
 * Written by the settings page, read by the background (D14: both are extension
 * pages of the same origin, and a hundred megabytes has no business going
 * through a message port).
 */

const DB_NAME = "reread-dicts";
const DB_VERSION = 1;
const META = "meta";
const ENTRIES = "entries";

/**
 * @typedef {object} Dictionary
 * @property {string} id
 * @property {string} name what the .ifo calls it
 * @property {string} langFrom the language of the headwords, chosen at import
 * @property {string} langTo
 * @property {number} entryCount
 * @property {number} aliasCount other spellings from the .syn file
 * @property {number} bytes what the text of it costs
 * @property {number} addedAt epoch milliseconds
 * @property {boolean} ready false until every row is in
 * @property {string | null} credit author and source, for attribution
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
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "id" });
      if (!db.objectStoreNames.contains(ENTRIES)) {
        db.createObjectStore(ENTRIES, { keyPath: ["dictId", "key"] });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Cannot open the dictionary database"));
    request.onblocked = () => reject(new Error("The dictionary database is in use by another page"));
  });
}

/**
 * @template T
 * @param {string[]} stores
 * @param {IDBTransactionMode} mode
 * @param {(transaction: IDBTransaction) => Promise<T> | T} work
 * @returns {Promise<T>}
 */
async function withStores(stores, mode, work) {
  const db = await open();
  try {
    const transaction = db.transaction(stores, mode);
    const result = await work(transaction);
    await new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve(undefined);
      transaction.onerror = () => reject(transaction.error ?? new Error("Dictionary transaction failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Dictionary transaction aborted"));
    });
    return result;
  } finally {
    db.close();
  }
}

/**
 * Every row of one dictionary, as a range over the primary key.
 *
 * `[id]` sorts before `[id, anything]`, and an array sorts after every string
 * in IndexedDB's key order - so an array as the second element is above every
 * key this dictionary could have and below the next dictionary's first row.
 * That is what makes deleting a dictionary one call rather than a cursor walk.
 *
 * @param {string} id
 * @returns {IDBKeyRange}
 */
function rowsOf(id) {
  return IDBKeyRange.bound([id], [id, []]);
}

/**
 * @typedef {object} DictionaryEntry
 * @property {string} dictionary the name of the book it came from
 * @property {string} headword as that dictionary spells it, which is not always what was selected
 * @property {string[]} senses
 */

/**
 * What the dictionaries here have to say about a word.
 *
 * One transaction over both stores: which dictionaries are installed, then a
 * point read per dictionary per candidate form. A dictionary answers at most
 * once - the first form that hits wins, so `watches` finding `watch` does not
 * also go looking for `watche`.
 *
 * Ordering is import order, which is the only order a reader can predict and
 * the one they can change by removing a dictionary and adding it again.
 *
 * @param {string[]} keys the word, then the forms worth trying instead of it
 * @param {string} langFrom the language being read
 * @returns {Promise<DictionaryEntry[]>}
 */
export async function lookupEntries(keys, langFrom) {
  if (keys.length === 0) return [];

  return await withStores([META, ENTRIES], "readonly", async (transaction) => {
    const installed = /** @type {Dictionary[]} */ (await promisify(transaction.objectStore(META).getAll()));
    // Matched on the language of the headwords alone. A dictionary explaining
    // English in English is often the better answer for somebody learning it,
    // and refusing it because the settings say "into Polish" would refuse a
    // book the reader deliberately installed.
    const dictionaries = installed
      .filter((dictionary) => dictionary.ready && dictionary.langFrom === langFrom)
      .sort((a, b) => a.addedAt - b.addedAt || a.id.localeCompare(b.id));

    const store = transaction.objectStore(ENTRIES);
    /** @type {DictionaryEntry[]} */
    const found = [];

    for (const dictionary of dictionaries) {
      for (const key of keys) {
        const row = /** @type {import("./rows.js").DictionaryRow | undefined} */ (
          await promisify(store.get([dictionary.id, key]))
        );
        if (row === undefined) continue;

        // One hop, never two: an alias points at a word, and a word that turned
        // out to be another alias is a dictionary contradicting itself.
        const target =
          row.aliasOf === undefined
            ? row
            : /** @type {import("./rows.js").DictionaryRow | undefined} */ (
                await promisify(store.get([dictionary.id, row.aliasOf]))
              );

        if (target === undefined || target.senses.length === 0) continue;
        found.push({ dictionary: dictionary.name, headword: target.headword, senses: target.senses });
        break;
      }
    }

    return found;
  });
}

/**
 * @returns {Promise<Dictionary[]>} oldest first, which is the order they are asked in
 */
export async function listDictionaries() {
  const records = /** @type {Dictionary[]} */ (
    await withStores([META], "readonly", (transaction) => promisify(transaction.objectStore(META).getAll()))
  );
  return records.sort((a, b) => a.addedAt - b.addedAt || a.id.localeCompare(b.id));
}

/**
 * Claims a place for a dictionary that is about to be written.
 *
 * The row goes in first and unready, rather than last and complete, because an
 * import that dies halfway - a closed tab, a full disk - would otherwise leave
 * rows behind that nothing knows the name of. Unready means invisible to a
 * lookup and collectable by `removeUnfinished`.
 *
 * @param {{ name: string, langFrom: string, langTo: string, credit: string | null }} about
 * @returns {Promise<Dictionary>}
 */
export async function beginImport({ name, langFrom, langTo, credit }) {
  /** @type {Dictionary} */
  const dictionary = {
    id: crypto.randomUUID(),
    name,
    langFrom,
    langTo,
    entryCount: 0,
    aliasCount: 0,
    bytes: 0,
    addedAt: Date.now(),
    ready: false,
    credit,
  };

  await withStores([META], "readwrite", (transaction) => promisify(transaction.objectStore(META).put(dictionary)));
  return dictionary;
}

/**
 * One batch of rows.
 *
 * The puts are fired without being awaited one by one: IndexedDB queues them on
 * the transaction, and waiting for each in turn would add a round trip through
 * the microtask queue to every one of a few hundred thousand rows. A failure
 * still aborts the transaction, which is what the wait at the end sees.
 *
 * @param {import("./rows.js").DictionaryRow[]} rows
 * @returns {Promise<void>}
 */
export async function putEntries(rows) {
  if (rows.length === 0) return;
  await withStores([ENTRIES], "readwrite", (transaction) => {
    const store = transaction.objectStore(ENTRIES);
    for (const row of rows) store.put(row);
  });
}

/**
 * @param {string} id
 * @param {{ entryCount: number, aliasCount: number, bytes: number }} counts
 * @returns {Promise<Dictionary>}
 */
export async function finishImport(id, counts) {
  return await withStores([META], "readwrite", async (transaction) => {
    const store = transaction.objectStore(META);
    const existing = /** @type {Dictionary | undefined} */ (await promisify(store.get(id)));
    if (existing === undefined) throw new Error("The dictionary was removed while it was being added");

    /** @type {Dictionary} */
    const ready = { ...existing, ...counts, ready: true };
    await promisify(store.put(ready));
    return ready;
  });
}

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteDictionary(id) {
  // Rows first: a meta row without its rows is a dictionary that answers
  // nothing, while rows without a meta row are invisible and collectable.
  await withStores([ENTRIES, META], "readwrite", (transaction) => {
    transaction.objectStore(ENTRIES).delete(rowsOf(id));
    transaction.objectStore(META).delete(id);
  });
}

/**
 * Throws away whatever a broken import left behind.
 *
 * Called when the settings page opens and before a new import starts - the two
 * moments when somebody is looking at this page and can be told about it.
 *
 * @returns {Promise<Dictionary[]>} what was removed, so it can be said out loud
 */
export async function removeUnfinished() {
  const unfinished = (await listDictionaries()).filter((dictionary) => !dictionary.ready);
  for (const dictionary of unfinished) await deleteDictionary(dictionary.id);
  return unfinished;
}
