/**
 * What a saved phrase is, and the rules about it that need no database to hold.
 *
 * Kept apart from `vocab.js` for the same reason the download layer is kept
 * apart from the model store: everything here is a value in and a value out, so
 * the rules that decide what gets written can be tested under `node --test`,
 * where there is no IndexedDB to open.
 */

import { collapseWhitespace, normalize, trimPhrase } from "../normalize.js";
import { ErrorCode, fail, ok } from "../protocol.js";

/**
 * A phrase somebody kept.
 *
 * `phrase` is what is shown and exported, `normalized` is what is matched -
 * they are two forms of the same thing and both are stored, because deriving
 * one from the other at read time would tie every read to the version of
 * `normalize()` that happens to be in the package.
 *
 * `translations` is a list, and holds exactly one entry for everything this
 * milestone can produce. It is a list because a word has more than one meaning:
 * once the bubble translates in context (G2 in the docs), the meaning that fits
 * the sentence in front of the reader goes first and the ones kept earlier stay
 * behind it. Deciding that shape now costs one array literal; deciding it after
 * the first release costs a database migration.
 *
 * @typedef {object} Phrase
 * @property {string} id
 * @property {string} langFrom
 * @property {string} langTo
 * @property {string} phrase
 * @property {string} normalized
 * @property {string[]} translations at least one, most specific first
 * @property {number} createdAt epoch milliseconds
 * @property {string} [context] reserved, written by nobody in M2 - see O2 in the docs
 * @property {string} [sourceUrl] reserved, written by nobody in M2 - see O3 in the docs
 */

/**
 * The same ceiling the translator facade puts on what it will translate. It is
 * therefore unreachable from the bubble - a selection this long never got a
 * translation to save. It is here so that a malformed message cannot write a
 * page into the vocabulary.
 */
export const MAX_PHRASE_LENGTH = 1000;

/**
 * The meanings, as they are stored: one line each, no blank ones, no
 * duplicates, in the order they were given. Whitespace is collapsed here rather
 * than at export time, because the TSV this ends up in has no escaping at all -
 * a tab or a newline in a translation would be a broken row in somebody's Anki
 * import, and the honest place to prevent that is before it is written.
 *
 * @param {string[]} translations
 * @returns {string[]}
 */
function cleanTranslations(translations) {
  /** @type {string[]} */
  const cleaned = [];
  for (const translation of translations) {
    const one = collapseWhitespace(translation);
    if (one.length > 0 && !cleaned.includes(one)) cleaned.push(one);
  }
  return cleaned;
}

/**
 * @param {object} input
 * @param {string} input.text as selected, or as it came out of an import
 * @param {string[]} input.translations what the reader is keeping it for
 * @param {string} input.langFrom
 * @param {string} input.langTo
 * @param {string} input.id
 * @param {number} input.now epoch milliseconds
 * @returns {import("../protocol.js").Result<Phrase>}
 */
export function buildPhrase({ text, translations, langFrom, langTo, id, now }) {
  if (text.length > MAX_PHRASE_LENGTH) return fail(ErrorCode.TOO_LONG);

  const phrase = trimPhrase(text);
  const normalized = normalize(text);
  const meanings = cleanTranslations(translations);
  // A selection of nothing but punctuation, or an edit box left empty. The
  // bubble offers to save neither, so getting here means a request nobody
  // should have sent.
  if (normalized.length === 0 || meanings.length === 0) return fail(ErrorCode.INTERNAL);

  return ok({ id, langFrom, langTo, phrase, normalized, translations: meanings, createdAt: now });
}

/**
 * Saving a phrase that is already known.
 *
 * The row keeps its identity - same `id`, same `createdAt`, same reserved
 * fields - and takes the two things the reader just decided: how the phrase is
 * written and what it means. The key is not touched, because the key is how
 * this row was found.
 *
 * Saving replaces the meanings rather than adding to them, and that is the
 * whole rule: a save says "this phrase means exactly what the bubble is
 * showing". Adding a meaning is then adding a line in the bubble, not a second
 * kind of message.
 *
 * @param {Phrase} existing
 * @param {Phrase} incoming
 * @returns {Phrase}
 */
export function resaved(existing, incoming) {
  return { ...existing, phrase: incoming.phrase, translations: incoming.translations };
}
