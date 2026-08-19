/**
 * Asking the installed dictionaries about a phrase.
 *
 * This is the half of a bubble the engine cannot produce. A translation has to
 * choose a sense and cannot mention the one it did not choose; a dictionary
 * lists them, which is what makes it the answer to `bank` rather than a second
 * opinion about it.
 *
 * Two callers, one function. The background runs it alongside the translation
 * (D31) and it never delays the gloss: a point read in IndexedDB against a
 * translation is nothing, and the reader who presses "More" finds it already
 * there. The reader page calls it directly for the quiet bubble (D121) - with
 * translation off there is no engine ride to share, and the reader page is an
 * extension page with the database in reach, the way the options page already
 * writes it (D14/D15). A dictionary that fails - a database that will not
 * open, a schema from a future version - costs the entries and nothing else:
 * extras do not get to break answers.
 */

import { keyTokens } from "../matcher/tokenize.js";
import { normalize } from "../normalize.js";
import { baseForms } from "./deinflect.js";
import { lookupEntries } from "./store.js";

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
 * The keys a phrase is asked under, or null when it is not a dictionary
 * question at all - the pure half of `lookUp`, split out so the rules can be
 * tested without a database. First the phrase as normalized, then - for a
 * single word in the one language whose endings this build knows - its
 * possible base forms. Other forms only for a single word: `takes off` is not
 * a phrase whose parts can be conjugated separately, and a dictionary that
 * has `take off` has it under that spelling.
 *
 * @param {string} text as the page had it
 * @param {string} langFrom the language being read
 * @returns {string[] | null}
 */
export function lookupKeys(text, langFrom) {
  const key = normalize(text);
  if (key.length === 0) return null;

  const words = keyTokens(key);
  if (words.length === 0 || words.length > MAX_WORDS) return null;

  const others = words.length === 1 && langFrom === DEINFLECTED ? baseForms(key) : [];
  return [key, ...others];
}

/**
 * @param {string} text as the page had it
 * @param {string} langFrom the language being read
 * @returns {Promise<import("../protocol.js").DictEntry[]>}
 */
export async function lookUp(text, langFrom) {
  const keys = lookupKeys(text, langFrom);
  if (keys === null) return [];

  try {
    return await lookupEntries(keys, langFrom);
  } catch {
    return [];
  }
}
