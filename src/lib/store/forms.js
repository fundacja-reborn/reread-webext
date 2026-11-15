/**
 * The pages' mirror of the vocabulary, with the other forms of its words
 * (D208) - the one step of rebuilding the mirror that reads something other
 * than the vocabulary's own database.
 *
 * The forms come out of the installed dictionaries of the language being
 * read (`dict/forms.js`), and the reads are the cost: a dozen per word per
 * dictionary. So they are computed once per word and carried from the mirror
 * that stands in storage to the one being written, under a stamp of the shelf
 * that vouched for them; the dictionary store checks the stamp and computes
 * only what the standing mirror lacks (`readForms`). A dictionary added or
 * removed changes the stamp, and everything is computed again - a few
 * seconds for a vocabulary of a thousand words, once.
 *
 * Nothing at all is read when nobody asked: with the switch off, without a
 * pair, or reading a language the rules do not know, the mirror is written
 * without forms and the dictionary database is not opened. And the forms
 * are an extra: a dictionary database that will not open costs them and
 * nothing else - the mirror is still written, with the forms it had.
 *
 * Two homes of the vocabulary rebuild the mirror - the background after every
 * write, and the phrases page after its one-time migration - and both come
 * through here, so neither can write a mirror that quietly drops the forms.
 *
 * The forms a rebuild ends with are also kept in this page's memory (D299),
 * and the next rebuild starts from them instead of reading the standing
 * mirror back out of storage - every bucket of it, for a save that changed
 * one word. Memory is no worse a witness than the mirror: the forms of a
 * word are decided by the word and the shelf alone, the stamp says which
 * shelf, and the dictionary store checks the stamp against the shelf as it
 * stands on every call. A page that was just started remembers nothing and
 * reads the mirror, once.
 */

import { chosenPair } from "../config.js";
import { RULED_LANGUAGE } from "../dict/deinflect.js";
import { readForms } from "../dict/store.js";
import { keyTokens } from "../matcher/tokenize.js";
import { mirrorOf, readMirror } from "./mirror.js";

/**
 * @typedef {object} FormsDeps
 * @property {() => Promise<{ forms: Record<string, string[]>, formsStamp: string } | null>} standing
 *   the forms already computed and the stamp they stand under - the mirror
 *   as it is in storage now, or what the last rebuild on this page ended with
 * @property {typeof readForms} readForms
 * @property {(known: { forms: Record<string, string[]>, stamp: string }) => void} [remember]
 *   told what a rebuild ended with, for the next one
 */

/**
 * What the last rebuild on this page ended with (D299, see the head of this
 * file); null on a page that has not rebuilt yet.
 *
 * @type {{ forms: Record<string, string[]>, formsStamp: string } | null}
 */
let remembered = null;

/**
 * @returns {FormsDeps}
 */
function defaults() {
  return {
    standing: async () => remembered ?? (await readMirror()),
    readForms,
    remember: (known) => {
      remembered = { forms: known.forms, formsStamp: known.stamp };
    },
  };
}

/**
 * Which saved keys can have forms at all: single words. A phrase is not
 * conjugated word by word (`takes off` stays as spelled - the same rule the
 * look-up follows), and the tokens are the matcher's own, so `don't` is two
 * of them and stays literal.
 *
 * @param {string} key
 * @returns {boolean}
 */
function singleWord(key) {
  return keyTokens(key).length === 1;
}

/**
 * @param {import("../config.js").Config} config
 * @param {import("./phrase.js").Phrase[]} phrases of the chosen pair
 * @param {FormsDeps} [deps]
 * @returns {Promise<import("./mirror.js").VocabMirror>}
 */
export async function mirrorWithForms(config, phrases, deps = defaults()) {
  const pair = chosenPair(config);
  if (!config.underlineForms || pair === null || pair.from !== RULED_LANGUAGE) {
    return mirrorOf(config, phrases);
  }

  const standing = await deps.standing();
  const kept = standing === null ? { forms: {}, stamp: "" } : { forms: standing.forms, stamp: standing.formsStamp };
  const keys = phrases.map((phrase) => phrase.normalized).filter(singleWord);
  try {
    const { forms, stamp } = await deps.readForms(pair.from, { keys, known: kept.forms, stamp: kept.stamp });
    deps.remember?.({ forms, stamp });
    return mirrorOf(config, phrases, { forms, stamp });
  } catch {
    // The dictionary database would not open: the vocabulary is still
    // mirrored, with the forms it already had - stale beats none, and the
    // next rebuild asks again.
    return mirrorOf(config, phrases, kept);
  }
}
