/**
 * Asking the installed dictionaries about a phrase.
 *
 * This is the half of a bubble the engine cannot produce. A translation has to
 * choose a sense and cannot mention the one it did not choose; a dictionary
 * lists them, which is what makes it the answer to `bank` rather than a second
 * opinion about it.
 *
 * It runs alongside the translation rather than after it, and it never delays
 * the gloss: a point read in IndexedDB against a translation is nothing, and
 * the reader who presses "More" finds it already there. A dictionary that
 * fails - a database that will not open, a schema from a future version - costs
 * the second layer and nothing else. The first line is the answer to what was
 * asked; everything here is extra, and extras do not get to break answers.
 */

import { baseForms } from "../lib/dict/deinflect.js";
import { lookupEntries } from "../lib/dict/store.js";
import { keyTokens } from "../lib/matcher/tokenize.js";
import { normalize } from "../lib/normalize.js";

/**
 * The same limit that decides whether a phrase saves itself: beyond it, a
 * selection is a sentence somebody is reading, not a word they want defined,
 * and no dictionary has an entry for it anyway.
 */
const MAX_WORDS = 4;

/**
 * The one language whose word endings this build knows. Everything else asks
 * for what was selected and takes what it gets - a wrong guess in a language we
 * do not know would find a real entry for a word nobody selected.
 */
const DEINFLECTED = "en";

/**
 * @param {string} text as the page had it
 * @param {string} langFrom the language being read
 * @returns {Promise<import("../lib/protocol.js").DictEntry[]>}
 */
export async function lookUp(text, langFrom) {
  const key = normalize(text);
  if (key.length === 0) return [];

  const words = keyTokens(key);
  if (words.length === 0 || words.length > MAX_WORDS) return [];

  // Other forms only for a single word: `takes off` is not a phrase whose parts
  // can be conjugated separately, and a dictionary that has `take off` has it
  // under that spelling.
  const others = words.length === 1 && langFrom === DEINFLECTED ? baseForms(key) : [];

  try {
    return await lookupEntries([key, ...others], langFrom);
  } catch {
    return [];
  }
}
