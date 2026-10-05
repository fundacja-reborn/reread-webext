/**
 * The copy of the vocabulary that outlives the database.
 *
 * Everything the reader keeps lives in the extension origin's IndexedDB, and
 * Safari deletes an origin's script-written storage after thirty days of use
 * without a touch on its pages (`ARCHITECTURE.md` §3; the iPad answered the
 * probe of 2026-08-26 with "not granted"). Nothing an extension can call
 * changes that. `storage.local` is a different place: Safari keeps it in the
 * extension's own SQLite, outside website data; Firefox never evicts an
 * extension origin; Chromium's `unlimitedStorage` does the same. So the
 * vocabulary is copied there whole - every pair, every field, the record as
 * the store holds it - the way the TSV export cannot, which drops ids and
 * dates on purpose.
 *
 * Three rules keep the copy honest, the ones the pages' mirror already lives
 * by (`mirror.js`):
 *
 *   - one writer, always in full. Only the background writes the copy, after
 *     every write to the database, from what the database just said. A read
 *     that fails writes nothing: a copy is never replaced by a guess.
 *   - it is restored only into nothing. The database empty and the copy not
 *     is the one shape a deletion leaves behind; a deliberate emptying leaves
 *     an empty copy too, so the copy cannot bring back what the reader let
 *     go. Rows go in through `putMissingPhrases`, which never touches a row
 *     that exists - two restores at once, or a restore beside a save, can
 *     neither duplicate nor overwrite anything.
 *   - asked before every write, not only at start. A deletion can land while
 *     the background is alive, and a save on top of a freshly emptied store
 *     would otherwise rebuild the copy from that one phrase.
 *
 * The store and the storage arrive as parameters so the rules can be tested
 * against stand-ins; callers pass nothing.
 */

import { webext } from "../browser.js";
import { isCount, withLearnedAt } from "./phrase.js";
import { allPhrases, hasPhrases, putMissingPhrases } from "./vocab.js";

/** @typedef {import("./phrase.js").Phrase} Phrase */

/**
 * @typedef {object} VocabBackup
 * @property {1} version
 * @property {number} writtenAt epoch milliseconds
 * @property {Phrase[]} phrases every pair, oldest first
 */

/**
 * What the copy needs from the world, in the order it asks: whether the
 * store is empty, its rows, the row adder that skips what exists, and the
 * copy's own reading and writing.
 *
 * @typedef {object} BackupDeps
 * @property {() => Promise<boolean>} empty whether nothing at all is saved
 * @property {() => Promise<Phrase[]>} list everything saved, every pair
 * @property {(phrases: Phrase[]) => Promise<{ added: number, skipped: number }>} putMissing
 * @property {() => Promise<unknown>} read whatever stands under the copy's key
 * @property {(backup: VocabBackup) => Promise<void>} write
 * @property {() => number} now
 */

/** The key in `storage.local`, beside the mirror's and the settings'. */
export const BACKUP_KEY = "vocabBackup";

const VERSION = 1;

/**
 * @returns {BackupDeps}
 */
function defaults() {
  return {
    empty: async () => !(await hasPhrases()),
    list: allPhrases,
    putMissing: putMissingPhrases,
    read: async () => (await webext().storage.local.get(BACKUP_KEY))[BACKUP_KEY],
    write: async (backup) => {
      await webext().storage.local.set({ [BACKUP_KEY]: backup });
    },
    now: () => Date.now(),
  };
}

/**
 * @param {Phrase[]} phrases
 * @param {number} now
 * @returns {VocabBackup}
 */
export function backupOf(phrases, now) {
  return { version: VERSION, writtenAt: now, phrases: [...phrases] };
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isWord(value) {
  return typeof value === "string" && value.length > 0;
}

/**
 * A stored row narrowed back into a phrase, field by field - the copy was
 * written by this extension, but a version of it that wrote a different
 * shape, or a hand that edited storage, must not be able to put a broken
 * row into the store. Unknown fields are left behind.
 *
 * @param {unknown} row
 * @returns {Phrase | null}
 */
function asPhrase(row) {
  if (typeof row !== "object" || row === null) return null;
  const {
    id,
    langFrom,
    langTo,
    phrase,
    normalized,
    translations,
    createdAt,
    context,
    sourceUrl,
    recallCount,
    lastRecallAt,
    readCount,
    lastReadAt,
    learnedAt,
  } = /** @type {Record<string, unknown>} */ (row);
  if (!isWord(id) || !isWord(langFrom) || !isWord(langTo) || !isWord(phrase) || !isWord(normalized)) return null;
  if (!Array.isArray(translations)) return null;
  const meanings = translations.filter(isWord);
  if (meanings.length === 0) return null;
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) return null;

  /** @type {Phrase} */
  const clean = { id, langFrom, langTo, phrase, normalized, translations: meanings, createdAt };
  if (isWord(context)) clean.context = context;
  if (isWord(sourceUrl)) clean.sourceUrl = sourceUrl;
  // The counts (D209) come back as they were, and only as counts: a copy
  // written by a hand or an older shape that holds something else there
  // restores the phrase without them, never with a number that is not one.
  // A count's time rides only with its count - a time alone says nothing.
  if (isCount(recallCount) && recallCount > 0) {
    clean.recallCount = recallCount;
    if (typeof lastRecallAt === "number" && Number.isFinite(lastRecallAt)) clean.lastRecallAt = lastRecallAt;
  }
  if (isCount(readCount) && readCount > 0) {
    clean.readCount = readCount;
    if (typeof lastReadAt === "number" && Number.isFinite(lastReadAt)) clean.lastReadAt = lastReadAt;
  }
  // The learned mark (D224) comes back as it was, and only as a moment: a
  // phrase the reader had marked learned must not come back underlined
  // because the database was deleted - and a broken mark must not make a
  // learned phrase of one still being learned.
  return withLearnedAt(clean, learnedAt);
}

/**
 * Whatever stood under the key, narrowed: a shape from another version is no
 * copy at all, and a row that does not make sense is dropped rather than
 * restored.
 *
 * @param {unknown} stored
 * @returns {VocabBackup | null}
 */
export function asBackup(stored) {
  if (typeof stored !== "object" || stored === null) return null;
  const { version, writtenAt, phrases } = /** @type {Record<string, unknown>} */ (stored);
  if (version !== VERSION || typeof writtenAt !== "number" || !Array.isArray(phrases)) return null;

  /** @type {Phrase[]} */
  const clean = [];
  for (const row of phrases) {
    const one = asPhrase(row);
    if (one !== null) clean.push(one);
  }
  return { version: VERSION, writtenAt, phrases: clean };
}

/**
 * The copy rebuilt from the whole store. Nothing is written when the store
 * cannot be read - the exception is the caller's, and the copy stays what it
 * was.
 *
 * @param {BackupDeps} [deps]
 * @returns {Promise<number>} how many phrases the copy now holds
 */
export async function rebuildBackup(deps = defaults()) {
  const phrases = await deps.list();
  await deps.write(backupOf(phrases, deps.now()));
  return phrases.length;
}

/**
 * How long the copy waits after a write for the next one before it is
 * rebuilt (D295). Long enough to fold the burst a page makes into one
 * rebuild - a save from the bubble's chain lands with the automatic keep
 * before it and the deletion of that scaffolding after it - and well inside
 * the half minute an idle event page is given before the browser puts it
 * down, so the timer fires in the same life as the write it follows.
 */
export const BACKUP_DELAY_MS = 1500;

/**
 * The copy rebuilt off the write's own path (D295). A write schedules the
 * rebuild and answers; the rebuild runs once the writes go quiet.
 *
 * Until D295 every save awaited it: the whole store read, every row with
 * its sentence written into `storage.local` - half a megabyte per thousand
 * phrases - and the storage event carrying the old and the new copy into
 * every page that listens, before the bubble heard that its phrase was
 * kept. On an e-ink reader with a few thousand phrases that was the
 * seconds the bubble hung after Save (Michał's report, 2026-10-05). The
 * copy exists for Safari's thirty-day eviction of the database, which a
 * copy a second and a half behind the store serves exactly as well.
 *
 * One rebuild at a time, in order: each reads the whole store and writes
 * the whole copy, and two racing could land an older read after a newer
 * one. Nothing waits for it, so its failure is nobody's error - the next
 * write schedules it again. A write the browser puts the page down under
 * before the timer fires leaves the copy one write behind until the next;
 * the eviction the copy answers is thirty days away.
 *
 * `flush` is for the caller that does have to wait: it runs a scheduled
 * rebuild at once and waits for the one in flight.
 *
 * @param {object} deps
 * @param {() => Promise<unknown>} deps.rebuild
 * @param {number} [deps.delay]
 * @param {(work: () => void, ms: number) => unknown} [deps.setTimer]
 * @param {(timer: unknown) => void} [deps.clearTimer]
 * @returns {{ schedule: () => void, flush: () => Promise<void>, pending: () => boolean }}
 */
export function backupScheduler({
  rebuild,
  delay = BACKUP_DELAY_MS,
  setTimer = (work, ms) => setTimeout(work, ms),
  clearTimer = (timer) => clearTimeout(/** @type {ReturnType<typeof setTimeout>} */ (timer)),
}) {
  /** @type {unknown} */
  let timer = null;
  /** @type {Promise<void>} */
  let chain = Promise.resolve();

  const run = () => {
    timer = null;
    chain = chain.then(() => rebuild()).then(
      () => undefined,
      () => undefined,
    );
    return chain;
  };

  return {
    schedule() {
      if (timer !== null) clearTimer(timer);
      timer = setTimer(() => void run(), delay);
    },
    async flush() {
      if (timer !== null) {
        clearTimer(timer);
        await run();
      } else {
        await chain;
      }
    },
    pending: () => timer !== null,
  };
}

/**
 * The store filled back from the copy, when - and only when - the store is
 * empty and the copy is not. The emptiness is asked first and the copy read
 * only then: on every ordinary start and before every ordinary write this
 * costs one count and nothing else.
 *
 * @param {BackupDeps} [deps]
 * @returns {Promise<number>} how many phrases came back
 */
export async function restoreVocabulary(deps = defaults()) {
  if (!(await deps.empty())) return 0;
  const backup = asBackup(await deps.read());
  if (backup === null || backup.phrases.length === 0) return 0;
  const { added } = await deps.putMissing(backup.phrases);
  return added;
}

/**
 * A copy written for a vocabulary that has none - the installations that
 * kept their phrases before the copy existed, on the first start after the
 * update. A valid copy already there is left alone (the writes keep it
 * current), and an empty store has nothing to copy.
 *
 * @param {BackupDeps} [deps]
 * @returns {Promise<boolean>} whether a copy was written
 */
export async function ensureBackup(deps = defaults()) {
  if (asBackup(await deps.read()) !== null) return false;
  if (await deps.empty()) return false;
  await rebuildBackup(deps);
  return true;
}

/**
 * What the settings page says about the copy: how many phrases, written when,
 * and what it weighs. The size is the copy's own JSON, measured here because
 * the whole of it is already parsed - the settings page counts the vocabulary
 * into its breakdown of the space, and a second read of the same key to weigh
 * it would be a read for nothing.
 *
 * @param {BackupDeps} [deps]
 * @returns {Promise<{ count: number, writtenAt: number, bytes: number } | null>}
 */
export async function readBackupSummary(deps = defaults()) {
  const backup = asBackup(await deps.read());
  if (backup === null) return null;
  return { count: backup.phrases.length, writtenAt: backup.writtenAt, bytes: JSON.stringify(backup).length };
}
