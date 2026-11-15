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
 * The copy is not one value (D297). It was, until a vocabulary of five
 * thousand phrases made every save rewrite two megabytes: Firefox reads the
 * old value, serializes the old and the new one, and hands both to every
 * `storage.onChanged` listener of every page of the extension, each of
 * which deserializes them whether it reads that key or not
 * (`child/ext-storage.js`). On an e-ink reader that was seconds of a blocked
 * page after every save, right when the next press lands. So the phrases
 * are dealt into a fixed number of buckets by their id, each under a key of
 * its own, and a rebuild writes only the buckets whose phrases changed:
 *
 *   - `vocabBackup` - the head: when the copy was written, how many phrases
 *     it holds, what they weigh, and one digest per bucket
 *   - `vocabBackup:<n>` - the phrases of bucket `n`, as the store holds them
 *
 * Three rules keep the copy honest, the ones the pages' mirror already lives
 * by (`mirror.js`):
 *
 *   - one writer, always from the whole store. Only the background writes
 *     the copy, after every write to the database, from what the database
 *     just said: every rebuild reads every row and compares every bucket,
 *     and writes the ones that differ. A read that fails writes nothing: a
 *     copy is never replaced by a guess.
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
 * The counts (D209) are the one thing a bucket's digest does not see. A
 * finished part of a book adds a read to a few hundred rows at once, which
 * is every bucket, and the copy would be whole again at the next save. They
 * are statistics, written without rebuilding the copy at all (`countPhrases`
 * in the background), so they ride with whatever else rewrites their bucket
 * - and every rebuild rewrites one bucket in turn whatever its digest says
 * (`cursor`), so no count in the copy is older than as many rebuilds as
 * there are buckets.
 *
 * The buckets are written before the head: a page that dies between the two
 * leaves buckets the head has no digest for yet, which the next rebuild
 * writes again, and never a digest for a bucket that was not written. The
 * copy of the versions before this one - the whole of it under the head's
 * key - is still read, restored from, and replaced by the first rebuild.
 *
 * The store and the storage arrive as parameters so the rules can be tested
 * against stand-ins; callers pass nothing.
 */

import { webext } from "../browser.js";
import { bucketFor, digestOf } from "./digest.js";
import { isCount, withLearnedAt } from "./phrase.js";
import { allPhrases, hasPhrases, putMissingPhrases } from "./vocab.js";

/** @typedef {import("./phrase.js").Phrase} Phrase */

/**
 * The copy read back whole, whichever shape it was stored in.
 *
 * @typedef {object} VocabBackup
 * @property {number} writtenAt epoch milliseconds
 * @property {Phrase[]} phrases every pair
 */

/**
 * What stands under the head's key (D297).
 *
 * @typedef {object} BackupHead
 * @property {2} version
 * @property {number} writtenAt epoch milliseconds
 * @property {number} count how many phrases the buckets hold
 * @property {number} bytes what they weigh as JSON, without their counts
 * @property {string[]} digests one per bucket, of the phrases without their counts
 * @property {number} cursor the bucket the next rebuild writes whatever its digest says
 */

/**
 * What the copy needs from the world, in the order it asks: whether the
 * store is empty, its rows, the row adder that skips what exists, and the
 * copy's own reading and writing - by key, because the copy is many.
 *
 * @typedef {object} BackupDeps
 * @property {() => Promise<boolean>} empty whether nothing at all is saved
 * @property {() => Promise<Phrase[]>} list everything saved, every pair
 * @property {(phrases: Phrase[]) => Promise<{ added: number, skipped: number }>} putMissing
 * @property {(keys: string[]) => Promise<Record<string, unknown>>} read whatever stands under each key
 * @property {(items: Record<string, unknown>) => Promise<void>} write
 * @property {() => number} now
 */

/** The head's key in `storage.local`, beside the mirror's and the settings'. */
export const BACKUP_KEY = "vocabBackup";

/**
 * How many buckets the phrases are dealt into. A save rewrites one of them
 * and the head, so the more there are the less a save moves - and the more
 * keys a restore reads, once, when the database is gone. Sixty-four makes a
 * bucket of five thousand phrases weigh what a saved article's paragraph
 * does. Changing the number is a new shape: the head of the old one stops
 * being a head (`asHead`), every bucket is written again, and the buckets
 * past the new count have to be removed by whoever changes it.
 */
export const BACKUP_BUCKETS = 64;

/** The shape with buckets; the whole copy under one key was version 1. */
const VERSION = 2;
const WHOLE_VERSION = 1;

/**
 * @param {number} index
 * @returns {string} the key of one bucket
 */
export function bucketKey(index) {
  return `${BACKUP_KEY}:${index}`;
}

const BUCKET_KEYS = Array.from({ length: BACKUP_BUCKETS }, (_, index) => bucketKey(index));

/**
 * The fields a bucket's digest is taken over, in the order they are
 * written: every field of a phrase but its counts (see the head of this
 * file). A field added to `Phrase` belongs here unless it is a count -
 * `test/backup.test.js` holds this list against `asPhrase`.
 */
const DIGESTED = [
  "id",
  "langFrom",
  "langTo",
  "phrase",
  "normalized",
  "translations",
  "createdAt",
  "context",
  "sourceUrl",
  "learnedAt",
];

/**
 * @returns {BackupDeps}
 */
function defaults() {
  return {
    empty: async () => !(await hasPhrases()),
    list: allPhrases,
    putMissing: putMissingPhrases,
    read: (keys) => webext().storage.local.get(keys),
    write: async (items) => {
      await webext().storage.local.set(items);
    },
    now: () => Date.now(),
  };
}

/**
 * Which bucket a phrase lives in: by its id, which never changes, so a
 * phrase edited, learned or counted stays where it is and only its own
 * bucket is written again.
 *
 * @param {string} id
 * @returns {number}
 */
export function bucketOf(id) {
  return bucketFor(id, BACKUP_BUCKETS);
}

/**
 * The phrases dealt into their buckets, each bucket in the order of its
 * ids - a fixed order, so the same phrases always make the same digest
 * whatever order the store listed them in.
 *
 * @param {Phrase[]} phrases
 * @returns {Phrase[][]}
 */
function bucketsOf(phrases) {
  /** @type {Phrase[][]} */
  const buckets = Array.from({ length: BACKUP_BUCKETS }, () => []);
  for (const phrase of phrases) buckets[bucketOf(phrase.id)]?.push(phrase);
  for (const bucket of buckets) bucket.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return buckets;
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
 * The rows of one stored list, narrowed: a row that does not make sense is
 * dropped rather than restored, and anything that is not a list holds none.
 *
 * @param {unknown} rows
 * @returns {Phrase[]}
 */
function asPhrases(rows) {
  /** @type {Phrase[]} */
  const clean = [];
  if (!Array.isArray(rows)) return clean;
  for (const row of rows) {
    const one = asPhrase(row);
    if (one !== null) clean.push(one);
  }
  return clean;
}

/**
 * The copy as the versions before D297 wrote it - the whole of it under the
 * head's key - narrowed: any other shape is not that copy.
 *
 * @param {unknown} stored
 * @returns {VocabBackup | null}
 */
export function asWholeBackup(stored) {
  if (typeof stored !== "object" || stored === null) return null;
  const { version, writtenAt, phrases } = /** @type {Record<string, unknown>} */ (stored);
  if (version !== WHOLE_VERSION || typeof writtenAt !== "number" || !Array.isArray(phrases)) return null;
  return { writtenAt, phrases: asPhrases(phrases) };
}

/**
 * Whatever stood under the head's key, narrowed into a head - or nothing:
 * the old whole copy, a shape from another version, a head for another
 * number of buckets. No head means every bucket is written by the next
 * rebuild, which is the right answer to each of those.
 *
 * @param {unknown} stored
 * @returns {BackupHead | null}
 */
export function asHead(stored) {
  if (typeof stored !== "object" || stored === null) return null;
  const { version, writtenAt, count, bytes, digests, cursor } = /** @type {Record<string, unknown>} */ (stored);
  if (version !== VERSION || typeof writtenAt !== "number" || !Number.isFinite(writtenAt)) return null;
  if (!isCount(count) || !isCount(bytes)) return null;
  if (!Array.isArray(digests) || digests.length !== BACKUP_BUCKETS) return null;
  if (!digests.every((digest) => typeof digest === "string")) return null;
  // A cursor that makes no sense starts the round again: it only decides
  // which bucket is written unasked, never what any bucket holds.
  const turn = isCount(cursor) && cursor < BACKUP_BUCKETS ? cursor : 0;
  return { version: VERSION, writtenAt, count, bytes, digests, cursor: turn };
}

/**
 * The copy rebuilt from the whole store: every row read, every bucket
 * compared, and written - the buckets whose phrases differ from what the
 * head remembers, the one bucket whose turn it is (so the counts catch up,
 * see the head of this file), and the head after them. Every bucket when
 * there is no head: the first rebuild, and the one that replaces the whole
 * copy of the versions before. Nothing is written when the store cannot be
 * read - the exception is the caller's, and the copy stays what it was.
 *
 * @param {BackupDeps} [deps]
 * @returns {Promise<number>} how many phrases the copy now holds
 */
export async function rebuildBackup(deps = defaults()) {
  const phrases = await deps.list();
  const head = asHead((await deps.read([BACKUP_KEY]))[BACKUP_KEY]);

  /** @type {string[]} */
  const digests = [];
  /** @type {Record<string, unknown>} */
  const changed = {};
  let bytes = 0;
  for (const [index, bucket] of bucketsOf(phrases).entries()) {
    // One pass over the bucket's text for both numbers: what it weighs, and
    // what tells it from the bucket the head remembers.
    const text = JSON.stringify(bucket, DIGESTED);
    const digest = digestOf(text);
    digests.push(digest);
    bytes += text.length;
    if (head === null || head.digests[index] !== digest || head.cursor === index) changed[bucketKey(index)] = bucket;
  }

  if (Object.keys(changed).length > 0) await deps.write(changed);
  /** @type {BackupHead} */
  const next = {
    version: VERSION,
    writtenAt: deps.now(),
    count: phrases.length,
    bytes,
    digests,
    cursor: head === null ? 0 : (head.cursor + 1) % BACKUP_BUCKETS,
  };
  await deps.write({ [BACKUP_KEY]: next });
  return phrases.length;
}

/**
 * The copy read back whole - the one read that costs every bucket, made
 * only when the database is found empty. A bucket the head counts on and
 * no row answers holds nothing; the whole copy of the versions before D297
 * is read as it stands.
 *
 * @param {BackupDeps} deps
 * @returns {Promise<VocabBackup | null>}
 */
async function readBackup(deps) {
  const stored = (await deps.read([BACKUP_KEY]))[BACKUP_KEY];
  const whole = asWholeBackup(stored);
  if (whole !== null) return whole;
  const head = asHead(stored);
  if (head === null) return null;

  const rows = await deps.read(BUCKET_KEYS);
  /** @type {Phrase[]} */
  const phrases = [];
  for (const key of BUCKET_KEYS) phrases.push(...asPhrases(rows[key]));
  return { writtenAt: head.writtenAt, phrases };
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
 * Since D297 the rebuild itself is light as well - it writes the buckets
 * that changed, not the whole copy - and it stays off the path: it still
 * reads every row to find them.
 *
 * One rebuild at a time, in order: each reads the whole store and writes
 * what differs from the head it found, and two racing could land an older
 * read after a newer one. Nothing waits for it, so its failure is nobody's error - the next
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
  const backup = await readBackup(deps);
  if (backup === null || backup.phrases.length === 0) return 0;
  const { added } = await deps.putMissing(backup.phrases);
  return added;
}

/**
 * A copy written for a vocabulary that has none - the installations that
 * kept their phrases before the copy existed, on the first start after the
 * update - and the copy of the versions before D297 written again in
 * buckets, on the first start after that one. A head already there is left
 * alone (the writes keep the copy current), and an empty store has nothing
 * to copy: the old whole copy standing beside an empty store is exactly
 * what a restore reads, and is never written over from nothing. The
 * question costs the head, a few kilobytes, whatever the copy weighs.
 *
 * @param {BackupDeps} [deps]
 * @returns {Promise<boolean>} whether a copy was written
 */
export async function ensureBackup(deps = defaults()) {
  if (asHead((await deps.read([BACKUP_KEY]))[BACKUP_KEY]) !== null) return false;
  if (await deps.empty()) return false;
  await rebuildBackup(deps);
  return true;
}

/**
 * What the settings page says about the copy: how many phrases, written when,
 * and what it weighs - all three off the head, where the rebuild wrote them
 * down, so the line costs no bucket. The weight is the phrases' own JSON
 * without their counts. The whole copy of the versions before D297 is
 * weighed as it was then, by the value already read.
 *
 * @param {BackupDeps} [deps]
 * @returns {Promise<{ count: number, writtenAt: number, bytes: number } | null>}
 */
export async function readBackupSummary(deps = defaults()) {
  const stored = (await deps.read([BACKUP_KEY]))[BACKUP_KEY];
  const head = asHead(stored);
  if (head !== null) return { count: head.count, writtenAt: head.writtenAt, bytes: head.bytes };
  const whole = asWholeBackup(stored);
  if (whole === null) return null;
  return { count: whole.phrases.length, writtenAt: whole.writtenAt, bytes: JSON.stringify(stored).length };
}
