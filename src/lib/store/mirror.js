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
 * No mirror at all means the background has never written one, which means
 * nothing has ever been saved. A page that finds nothing does nothing: an
 * install with an empty vocabulary costs exactly one storage read per page.
 */

import { webext } from "../browser.js";

/** @typedef {import("../protocol.js").VocabEntry} VocabEntry */

/**
 * @typedef {object} VocabMirror
 * @property {string} from
 * @property {string} to
 * @property {VocabEntry[]} entries
 */

/** The key in `storage.local`. `config` is the other one, and there are no more. */
export const MIRROR_KEY = "vocabIndex";

/**
 * @param {import("../config.js").Config} config
 * @param {import("./phrase.js").Phrase[]} phrases
 * @returns {VocabMirror}
 */
export function mirrorOf(config, phrases) {
  return {
    from: config.sourceLang,
    to: config.targetLang,
    entries: phrases.map((phrase) => [phrase.normalized, phrase.translations]),
  };
}

/**
 * Narrows whatever was in storage - which is to say, anything at all: an older
 * version of this extension wrote it, or somebody edited it by hand. A row that
 * does not make sense is dropped rather than shown, and a shape that does not
 * make sense is no mirror at all.
 *
 * @param {unknown} stored
 * @returns {VocabMirror | null}
 */
export function asMirror(stored) {
  if (typeof stored !== "object" || stored === null) return null;
  const { from, to, entries } = /** @type {Record<string, unknown>} */ (stored);
  if (typeof from !== "string" || typeof to !== "string" || !Array.isArray(entries)) return null;

  /** @type {VocabEntry[]} */
  const clean = [];
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const [normalized, translations] = entry;
    if (typeof normalized !== "string" || normalized.length === 0) continue;
    if (!Array.isArray(translations)) continue;
    const meanings = translations.filter((one) => typeof one === "string" && one.length > 0);
    if (meanings.length === 0) continue;
    clean.push([normalized, meanings]);
  }

  return { from, to, entries: clean };
}

/**
 * @param {VocabMirror} mirror
 * @param {import("../config.js").Config} config
 * @returns {boolean} whether it describes the pair that is being read now
 */
export function mirrorMatches(mirror, config) {
  return mirror.from === config.sourceLang && mirror.to === config.targetLang;
}

/**
 * @param {VocabMirror} mirror
 * @returns {Promise<void>}
 */
export async function writeMirror(mirror) {
  await webext().storage.local.set({ [MIRROR_KEY]: mirror });
}
