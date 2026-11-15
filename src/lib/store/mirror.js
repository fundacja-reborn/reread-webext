/**
 * The copy of the vocabulary that content scripts are allowed to read.
 *
 * The database is the background's, and a page must not have to wake the
 * background to find out whether the word under the cursor is one the reader
 * kept. That would be a message on every navigation, on every page, forever -
 * the opposite of what `<all_urls>` was justified with. So the background keeps
 * a derived copy in `storage.local`, and a page reads it in the same call it
 * reads the settings with.
 *
 * Two properties make a cache like this safe to have:
 *
 *   - one writer. Only the background writes it, always in full, always from
 *     what the database just said. It has no history of its own to drift from.
 *   - it says which pair it is for. A copy left over from another language pair
 *     is not stale data to be shown anyway, it is a reason to ask the background
 *     for the real thing - and that is the only time a page sends a message
 *     about vocabulary before the reader touches anything.
 *
 * One thing in it is not read off the database: the other forms of the
 * saved words (D208, `forms`), which come out of the installed dictionaries
 * and cost a dozen point reads per word. Those the background computes once
 * per word and carries from one mirror to the next, under a stamp of the
 * dictionaries that vouched for them (`formsStamp`) - the one history the
 * mirror has, and one it checks against the shelf on every rebuild
 * (`store/forms.js`). A page may use them only while the switch that asks
 * for them is on; with it off the background writes none.
 *
 * No mirror at all means the background has never written one, which means
 * nothing has ever been saved. A page that finds nothing does nothing: an
 * install with an empty vocabulary costs exactly one storage read per page.
 *
 * The phrases the reader marked learned are not in it (D224): the
 * background hands `mirrorOf` the rows still being learned and no others,
 * so that Learned is what takes a phrase off every page - and off the
 * popup's "saved", which reads the same copy - while the row itself stays
 * in the store, on the phrases page's learned shelf.
 *
 * In storage it is not one value (D299), for the reason the vocabulary's
 * other copy is not (D297, `backup.js`): the browser hands a changed value,
 * old and new, to every page that listens, and one saved phrase used to
 * send every page the whole vocabulary twice. The entries are dealt into
 * buckets by their key, each bucket with the forms of its own words:
 *
 *   - `vocabIndex` - the head: the pair, the forms' stamp, when it was
 *     written, and one digest per bucket
 *   - `vocabIndex:<n>` - the entries of bucket `n`, each with the moment
 *     its phrase was saved, and the forms of the words among them
 *
 * A write deals the whole mirror again - from what the database just said,
 * as before - and stores the buckets whose digest moved, with the head, in
 * one call: one change, one event, so no page ever sees a head and buckets
 * that disagree. The head is written every time, changed or not: it is what
 * "the vocabulary was written" looks like to a page that listens for that
 * and nothing more (the phrases page). A page puts the buckets back
 * together in the order the phrases were saved (`mirrorFrom`), which is
 * the order the background listed them in and the one `formAliases`
 * settles a contested form by; the moment rides in the bucket for that
 * alone. The mirror of the versions before - the whole of it under the
 * head's key - is still read, until the first write replaces it.
 */

import { webext } from "../browser.js";
import { bucketFor, digestOf } from "./digest.js";

/** @typedef {import("../protocol.js").VocabEntry} VocabEntry */

/**
 * @typedef {object} VocabMirror
 * @property {string} from
 * @property {string} to
 * @property {VocabEntry[]} entries oldest first
 * @property {number[]} order when each entry's phrase was saved, entry by
 *   entry - what puts the entries of different buckets back in order
 *   (D299); nothing a page reads beyond that
 * @property {Record<string, string[]>} forms the other forms of a saved word
 *   (D208), by its key: the ones a dictionary of the language vouched for,
 *   an empty list for a word that has none - which is worth writing down,
 *   because it is the answer of a dozen reads. Only single words of the one
 *   language with rules ever have a line here, and nothing does while the
 *   switch is off.
 * @property {string} formsStamp what the forms were computed from
 *   (`dict/forms.js`, `formsStamp`); empty when there are none
 */

/**
 * The head's key in `storage.local` - and, until D299, the key of the whole
 * mirror.
 */
export const MIRROR_KEY = "vocabIndex";

/**
 * How many buckets the entries are dealt into. A save rewrites one and the
 * head; a page reads them all in the one call it already makes at load.
 * Thirty-two makes a bucket of five thousand phrases about twelve
 * kilobytes. Changing the number is a new shape: the old head stops being a
 * head (`asMirrorHead`), every bucket is written again, and the buckets
 * past the new count have to be removed by whoever changes it.
 */
export const MIRROR_BUCKETS = 32;

/** The shape with buckets; the whole mirror under one key had no version. */
const VERSION = 2;

/**
 * @param {number} index
 * @returns {string} the key of one bucket
 */
export function mirrorBucketKey(index) {
  return `${MIRROR_KEY}:${index}`;
}

/**
 * Every key the mirror stands under - what a page asks storage for to have
 * the whole of it, in the call it reads the settings with.
 */
export const MIRROR_KEYS = Object.freeze([
  MIRROR_KEY,
  ...Array.from({ length: MIRROR_BUCKETS }, (_, index) => mirrorBucketKey(index)),
]);

/**
 * The keys that hold one phrase, if the mirror holds it: the head and the
 * phrase's own bucket. What the popup reads to say whether a word is saved
 * - a few kilobytes instead of the vocabulary.
 *
 * @param {string} normalized
 * @returns {string[]}
 */
export function mirrorKeysFor(normalized) {
  return [MIRROR_KEY, mirrorBucketKey(bucketFor(normalized, MIRROR_BUCKETS))];
}

/**
 * @param {string} key a key of `storage.local`
 * @returns {boolean} whether the mirror stands under it, head or bucket
 */
export function isMirrorKey(key) {
  return key === MIRROR_KEY || key.startsWith(`${MIRROR_KEY}:`);
}

/** What a mirror carries for forms when nothing computed any. */
const NO_FORMS = Object.freeze({ forms: {}, stamp: "" });

/**
 * An unchosen pair mirrors as the empty string on both sides: the mirror's
 * shape stays two strings and a list, and a page comparing it against the
 * pairless settings (`mirrorMatches`) finds them agreeing - so a fresh
 * install reads one empty mirror and goes quiet, instead of reading a
 * mismatch and asking the background for a vocabulary that cannot exist.
 *
 * @param {import("../config.js").Config} config
 * @param {import("./phrase.js").Phrase[]} phrases
 * @param {{ forms: Record<string, string[]>, stamp: string }} [known] the
 *   forms of the words and the stamp they stand under (D208), from
 *   `store/forms.js`; none when nothing asked for them
 * @returns {VocabMirror}
 */
export function mirrorOf(config, phrases, known = NO_FORMS) {
  return {
    from: config.sourceLang ?? "",
    to: config.targetLang ?? "",
    entries: phrases.map((phrase) => [phrase.normalized, phrase.translations]),
    order: phrases.map((phrase) => phrase.createdAt),
    forms: known.forms,
    formsStamp: known.stamp,
  };
}

/**
 * The forms as stored, or as much of them as really maps a key to a list of
 * words. A line that makes no sense is dropped, an empty list is kept: it
 * says the word was asked about and has no forms, which the next rebuild
 * must not ask again.
 *
 * @param {unknown} value
 * @returns {Record<string, string[]>}
 */
function asForms(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};

  /** @type {Record<string, string[]>} */
  const forms = {};
  for (const [key, list] of Object.entries(value)) {
    if (key.length === 0 || !Array.isArray(list)) continue;
    forms[key] = list.filter((one) => typeof one === "string" && one.length > 0);
  }
  return forms;
}

/**
 * One stored entry narrowed to a key and its meanings, or nothing: a row
 * that does not make sense is dropped rather than shown.
 *
 * @param {unknown} normalized
 * @param {unknown} translations
 * @returns {VocabEntry | null}
 */
function asEntry(normalized, translations) {
  if (typeof normalized !== "string" || normalized.length === 0) return null;
  if (!Array.isArray(translations)) return null;
  const meanings = translations.filter((one) => typeof one === "string" && one.length > 0);
  return meanings.length === 0 ? null : [normalized, meanings];
}

/**
 * The mirror as the versions before D299 stored it - the whole of it under
 * the head's key - narrowed: anything at all may stand there, an older
 * version of this extension wrote it, or somebody edited it by hand. A row
 * that does not make sense is dropped rather than shown, and a shape that
 * does not make sense is no mirror at all. A mirror from before the forms
 * (D208) has none, which reads as none computed. The entries stand in the
 * order they were listed in, so their places are their order.
 *
 * @param {unknown} stored
 * @returns {VocabMirror | null}
 */
export function asMirror(stored) {
  if (typeof stored !== "object" || stored === null) return null;
  const { from, to, entries, forms, formsStamp } = /** @type {Record<string, unknown>} */ (stored);
  if (typeof from !== "string" || typeof to !== "string" || !Array.isArray(entries)) return null;

  /** @type {VocabEntry[]} */
  const clean = [];
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const one = asEntry(entry[0], entry[1]);
    if (one !== null) clean.push(one);
  }

  return {
    from,
    to,
    entries: clean,
    order: clean.map((_, at) => at),
    forms: asForms(forms),
    formsStamp: typeof formsStamp === "string" ? formsStamp : "",
  };
}

/**
 * @param {VocabMirror} mirror
 * @param {import("../config.js").Config} config
 * @returns {boolean} whether it describes the pair that is being read now -
 *   an unchosen pair (`null`, mirrored as `""`) matching the empty mirror is
 *   deliberate, see `mirrorOf`
 */
export function mirrorMatches(mirror, config) {
  return mirror.from === (config.sourceLang ?? "") && mirror.to === (config.targetLang ?? "");
}

/**
 * The forms as a page matches them (D208): each form to the key it stands
 * for, so that `reading` found on the page opens the bubble of the saved
 * `read`. A form that is itself a saved key is nobody's alias - the reader's
 * own entry for it answers; a form two keys claim goes to the first of them,
 * in the order the entries stand (oldest first, as the background lists
 * them); a form of a key that is not among the entries is dropped, because
 * a key not in the vocabulary has no bubble to open.
 *
 * @param {VocabEntry[]} entries
 * @param {Record<string, string[]>} forms
 * @returns {Map<string, string>} form to key
 */
export function formAliases(entries, forms) {
  const keys = new Set(entries.map(([key]) => key));
  /** @type {Map<string, string>} */
  const aliases = new Map();
  for (const [key] of entries) {
    for (const form of forms[key] ?? []) {
      if (keys.has(form) || aliases.has(form)) continue;
      aliases.set(form, key);
    }
  }
  return aliases;
}

/**
 * Whether two vocabularies, as a page holds them, name the same phrases
 * with the same meanings (D297) - what lets a page leave its underlines
 * alone when the mirror comes back saying what the page already painted
 * after its own save. Meanings are compared in order: the bubble shows
 * them in it.
 *
 * @param {ReadonlyMap<string, readonly string[]>} held
 * @param {ReadonlyMap<string, readonly string[]>} next
 * @returns {boolean}
 */
export function sameEntries(held, next) {
  if (held.size !== next.size) return false;
  for (const [key, meanings] of next) {
    const before = held.get(key);
    if (before === undefined || before.length !== meanings.length) return false;
    if (before.some((one, at) => one !== meanings[at])) return false;
  }
  return true;
}

/**
 * Whether two sets of aliases (`formAliases`) send the same forms to the
 * same words - the other half of the same question.
 *
 * @param {ReadonlyMap<string, string>} held
 * @param {ReadonlyMap<string, string>} next
 * @returns {boolean}
 */
export function sameAliases(held, next) {
  if (held.size !== next.size) return false;
  for (const [form, key] of next) if (held.get(form) !== key) return false;
  return true;
}

/**
 * What stands under the head's key since D299.
 *
 * @typedef {object} MirrorHead
 * @property {2} version
 * @property {string} from
 * @property {string} to
 * @property {string} formsStamp
 * @property {number} writtenAt epoch milliseconds
 * @property {string[]} digests one per bucket
 */

/**
 * Whatever stood under the head's key, narrowed into a head - or nothing:
 * the whole mirror of the versions before, a shape from another version, a
 * head for another number of buckets. No head means every bucket is written
 * by the next write.
 *
 * @param {unknown} stored
 * @returns {MirrorHead | null}
 */
export function asMirrorHead(stored) {
  if (typeof stored !== "object" || stored === null) return null;
  const { version, from, to, formsStamp, writtenAt, digests } = /** @type {Record<string, unknown>} */ (stored);
  if (version !== VERSION || typeof from !== "string" || typeof to !== "string") return null;
  if (!Array.isArray(digests) || digests.length !== MIRROR_BUCKETS) return null;
  if (!digests.every((digest) => typeof digest === "string")) return null;
  return {
    version: VERSION,
    from,
    to,
    formsStamp: typeof formsStamp === "string" ? formsStamp : "",
    writtenAt: typeof writtenAt === "number" && Number.isFinite(writtenAt) ? writtenAt : 0,
    digests,
  };
}

/**
 * The mirror put back together from what storage holds under its keys - or
 * under some of them: a caller that asked for one bucket (`mirrorKeysFor`)
 * gets a mirror of that bucket's entries, which is all it wanted. Null
 * without a head, which is the background never having written one. The
 * whole mirror of the versions before D299 is read as it stands.
 *
 * The entries come out oldest first, a key breaking a tie - the order the
 * background listed them in. A bucket that will not read holds nothing: its
 * phrases go without their underline until the next write, and no page
 * fails for it.
 *
 * @param {Record<string, unknown>} stored the values under the mirror's keys
 * @returns {VocabMirror | null}
 */
export function mirrorFrom(stored) {
  const top = stored[MIRROR_KEY];
  const head = asMirrorHead(top);
  if (head === null) return asMirror(top);

  /** @type {Array<{ entry: VocabEntry, at: number }>} */
  const rows = [];
  /** @type {Record<string, string[]>} */
  const forms = {};
  for (let index = 0; index < MIRROR_BUCKETS; index += 1) {
    const bucket = stored[mirrorBucketKey(index)];
    if (typeof bucket !== "object" || bucket === null) continue;
    const held = /** @type {Record<string, unknown>} */ (bucket);
    if (!Array.isArray(held.rows)) continue;
    for (const row of held.rows) {
      if (!Array.isArray(row) || row.length !== 3) continue;
      const entry = asEntry(row[0], row[1]);
      if (entry === null) continue;
      rows.push({ entry, at: typeof row[2] === "number" && Number.isFinite(row[2]) ? row[2] : 0 });
    }
    Object.assign(forms, asForms(held.forms));
  }
  rows.sort((a, b) => a.at - b.at || (a.entry[0] < b.entry[0] ? -1 : a.entry[0] > b.entry[0] ? 1 : 0));

  return {
    from: head.from,
    to: head.to,
    entries: rows.map((row) => row.entry),
    order: rows.map((row) => row.at),
    forms,
    formsStamp: head.formsStamp,
  };
}

/**
 * The whole mirror, read: every key in one call.
 *
 * @returns {Promise<VocabMirror | null>}
 */
export async function readMirror() {
  return mirrorFrom(await webext().storage.local.get([...MIRROR_KEYS]));
}

/**
 * What the writer needs from storage - a parameter, so the rule of which
 * buckets are written can be tested against a stand-in.
 *
 * @typedef {object} MirrorStorage
 * @property {(keys: string[]) => Promise<Record<string, unknown>>} read
 * @property {(items: Record<string, unknown>) => Promise<void>} write
 * @property {() => number} now
 */

/** @returns {MirrorStorage} */
function storage() {
  return {
    read: (keys) => webext().storage.local.get(keys),
    write: async (items) => {
      await webext().storage.local.set(items);
    },
    now: () => Date.now(),
  };
}

/**
 * The mirror written: dealt into its buckets, and the buckets whose digest
 * differs from the one the standing head remembers stored with the new
 * head, in one call. Every bucket when there is no head - the first write,
 * and the one that replaces the whole mirror of the versions before - and
 * when the caller asks for the whole of it (`whole`): an install or an
 * update, where what stands in storage is not to be trusted to be what the
 * head says.
 *
 * A form rides in the bucket of the word it belongs to, and only for a word
 * that is among the entries: a form of a key the mirror does not hold has
 * no bubble to open (`formAliases`).
 *
 * @param {VocabMirror} mirror
 * @param {{ whole?: boolean }} [how]
 * @param {MirrorStorage} [deps]
 * @returns {Promise<void>}
 */
export async function writeMirror(mirror, { whole = false } = {}, deps = storage()) {
  const head = whole ? null : asMirrorHead((await deps.read([MIRROR_KEY]))[MIRROR_KEY]);

  /** @type {Array<{ rows: Array<[string, string[], number]>, forms: Record<string, string[]> }>} */
  const buckets = Array.from({ length: MIRROR_BUCKETS }, () => ({ rows: [], forms: {} }));
  for (const [at, [key, meanings]] of mirror.entries.entries()) {
    const bucket = buckets[bucketFor(key, MIRROR_BUCKETS)];
    if (bucket === undefined) continue;
    bucket.rows.push([key, meanings, mirror.order[at] ?? at]);
    const forms = Object.hasOwn(mirror.forms, key) ? mirror.forms[key] : undefined;
    if (forms !== undefined) bucket.forms[key] = forms;
  }

  /** @type {string[]} */
  const digests = [];
  /** @type {Record<string, unknown>} */
  const items = {};
  for (const [index, bucket] of buckets.entries()) {
    const digest = digestOf(JSON.stringify(bucket));
    digests.push(digest);
    if (head === null || head.digests[index] !== digest) items[mirrorBucketKey(index)] = bucket;
  }
  /** @type {MirrorHead} */
  const next = {
    version: VERSION,
    from: mirror.from,
    to: mirror.to,
    formsStamp: mirror.formsStamp,
    writtenAt: deps.now(),
    digests,
  };
  items[MIRROR_KEY] = next;
  await deps.write(items);
}
