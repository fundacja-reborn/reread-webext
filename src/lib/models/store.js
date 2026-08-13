/**
 * Where translation models live between sessions.
 *
 * Its own database, separate from the vocabulary that arrives later: models are
 * replaceable bytes that can always be fetched or loaded again, vocabulary is
 * the one thing in this extension nobody can recreate. Keeping them apart means
 * clearing every model can never be a way to lose a phrase, and neither schema
 * constrains the other's upgrades.
 *
 * Two stores, not one, and that is the whole design: a model is tens of
 * megabytes, so anything that wants to know *which* models are here - a
 * settings page listing them, a translation checking it has the right one -
 * must be able to ask without reading them. `meta` answers that in kilobytes;
 * `files` is only ever read when something is about to be loaded into the
 * engine.
 *
 * Written by the settings page and read by the background. Both are extension
 * pages of the same origin, so both see the same database - and fifteen
 * megabytes is not a thing to copy through a message port when the alternative
 * is a shared module.
 */

const DB_NAME = "reread-models";
const DB_VERSION = 1;
const META = "meta";
const FILES = "files";

/**
 * @typedef {object} ModelMeta
 * @property {string} pair `"enpl"`, and the key of both stores
 * @property {string} from
 * @property {string} to
 * @property {number} bytes total on disk, for saying what a model costs
 * @property {number} addedAt epoch milliseconds; also how a caller notices a model was replaced
 * @property {string} [sourceUrl] the model file's download address - Mozilla's paths carry the
 *   training run, so this is the version identity an update check compares. Absent for models
 *   added from files and for anything stored before it was recorded: about those, no claim.
 */

/**
 * @typedef {object} ModelFiles
 * @property {string} pair
 * @property {ArrayBuffer} model
 * @property {ArrayBuffer} shortlist
 * @property {ArrayBuffer[]} vocabs
 * @property {Record<string, string | number | boolean>} [config] from the model's own metadata
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
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "pair" });
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: "pair" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Cannot open the model database"));
    // Another page holding an older version open would block the upgrade
    // forever, and a settings page waiting in silence is worse than an error.
    request.onblocked = () => reject(new Error("The model database is in use by another page"));
  });
}

/**
 * @template T
 * @param {string[]} stores
 * @param {IDBTransactionMode} mode
 * @param {(transaction: IDBTransaction) => Promise<T>} work
 * @returns {Promise<T>}
 */
async function withStores(stores, mode, work) {
  const db = await open();
  try {
    const transaction = db.transaction(stores, mode);
    const result = await work(transaction);
    await new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve(undefined);
      transaction.onerror = () => reject(transaction.error ?? new Error("Model transaction failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Model transaction aborted"));
    });
    return result;
  } finally {
    db.close();
  }
}

/**
 * @param {ModelFiles} files
 * @param {{ from: string, to: string, sourceUrl?: string }} languages
 * @returns {Promise<ModelMeta>}
 */
export async function putModel(files, languages) {
  const bytes =
    files.model.byteLength +
    files.shortlist.byteLength +
    files.vocabs.reduce((total, vocab) => total + vocab.byteLength, 0);

  /** @type {ModelMeta} */
  const meta = {
    pair: files.pair,
    from: languages.from,
    to: languages.to,
    bytes,
    addedAt: Date.now(),
    ...(languages.sourceUrl === undefined ? {} : { sourceUrl: languages.sourceUrl }),
  };

  // One transaction over both stores: a `meta` row without its files would be a
  // model the extension claims to have and cannot load.
  await withStores([META, FILES], "readwrite", async (transaction) => {
    await promisify(transaction.objectStore(FILES).put(files));
    await promisify(transaction.objectStore(META).put(meta));
  });

  return meta;
}

/**
 * @returns {Promise<ModelMeta[]>}
 */
export async function listModels() {
  const records = await withStores([META], "readonly", (transaction) =>
    promisify(transaction.objectStore(META).getAll()),
  );
  return records.sort((a, b) => a.pair.localeCompare(b.pair));
}

/**
 * @param {string} pair
 * @returns {Promise<ModelMeta | null>}
 */
export async function getModelMeta(pair) {
  const record = await withStores([META], "readonly", (transaction) =>
    promisify(transaction.objectStore(META).get(pair)),
  );
  return record ?? null;
}

/**
 * The bytes. Only call this when something is about to be handed to the engine.
 *
 * @param {string} pair
 * @returns {Promise<ModelFiles | null>}
 */
export async function getModelFiles(pair) {
  const record = await withStores([FILES], "readonly", (transaction) =>
    promisify(transaction.objectStore(FILES).get(pair)),
  );
  return record ?? null;
}

/**
 * @param {string} pair
 * @returns {Promise<void>}
 */
export async function deleteModel(pair) {
  await withStores([META, FILES], "readwrite", async (transaction) => {
    await promisify(transaction.objectStore(FILES).delete(pair));
    await promisify(transaction.objectStore(META).delete(pair));
  });
}
