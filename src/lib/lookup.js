/**
 * Looking a word up without a page: the rules behind the "Look up a word"
 * field in the toolbar popup and the "Add a phrase" fold on the saved-phrases
 * page (D197).
 *
 * The field is the bubble over a selection with the page taken away - and
 * with the engine taken away too, on purpose: a word typed on its own has no
 * sentence around it, which is exactly where the engine guesses worst (the
 * bubble says so under every translated word, D192). The dictionaries are the
 * answer, the way they are in the quiet bubble (D121, D158), and a meaning
 * the reader types is the other one. Nothing here touches the DOM or the
 * database: shapes come in, decisions go out, and `lookup-box.js` draws them.
 */

import { MEANING_SEPARATOR, afterChoosing, entryBlocks, quietNote, toMeanings } from "./gloss.js";
import { collapseWhitespace, normalize, trimPhrase } from "./normalize.js";
import { MAX_PHRASE_LENGTH } from "./store/phrase.js";

/**
 * What was typed, as a phrase - or nothing to look up.
 *
 * The same two forms a selection is reduced to: `trimPhrase` for what is
 * shown and saved, `normalize` for the key. So a word typed here and the same
 * word selected on a page are one phrase in the vocabulary, and a comma
 * caught at the end costs nothing. Nothing but punctuation is not a question,
 * and neither is more than the store would keep (the bubble's own ceiling).
 *
 * @param {string} input as typed
 * @returns {{ text: string, normalized: string } | null}
 */
export function lookupText(input) {
  if (input.length > MAX_PHRASE_LENGTH) return null;
  const normalized = normalize(input);
  if (normalized.length === 0) return null;
  return { text: trimPhrase(input), normalized };
}

/**
 * The entries come twice: as the bubble's blocks - the label decided, the
 * senses cut into lines to press (`entryBlocks`) - and as they were stored,
 * for the field that only reads and shows an entry as the book wrote it,
 * paragraph by paragraph (`paragraphsOf`). Same order, one for one.
 *
 * @typedef {{ kind: "entries", blocks: ReturnType<typeof entryBlocks>, entries: import("./protocol.js").DictEntry[], lang: string }
 *   | { kind: "silence", note: "no-dictionary" | "not-in-dictionary", lang: string }
 *   | { kind: "fault" }} LookupOutcome
 */

/**
 * A stored sense as the paragraphs the book wrote it in: the import keeps a
 * section's end as one blank line (`dict/text.js`, D197), and a field that
 * reads rather than presses shows the space - "Noun", its senses, then
 * "Verb". Lines inside a paragraph stay lines; blank paragraphs are none.
 *
 * @param {string} sense
 * @returns {string[]}
 */
export function paragraphsOf(sense) {
  return sense
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

/**
 * What the field shows once the dictionaries have answered (`look-up`, D162):
 * the entries as the bubble's blocks, or one sentence about the silence -
 * which of two silences, by the count the answer carries (D164): no
 * dictionary for the language at all, or dictionaries that did not know the
 * word.
 *
 * No answer at all is a fault, and it is said as one. The bubble keeps quiet
 * on it (D164's rule: a fault must never read as a missing dictionary), but
 * the bubble has a page to fall back on and this field has a press to answer -
 * a press answered with nothing reads as a field that hung. The field stands
 * only where a pair is chosen, so "no language to ask in" is never the cause.
 *
 * The bubble's third verdict, "select whole words", is about a selection the
 * matcher could never find again; a typed phrase is whole words by
 * construction, so it does not arise here.
 *
 * @param {import("./protocol.js").LookUp | null} answer
 * @param {string} normalized the phrase's key, for the blocks' labels
 * @returns {LookupOutcome}
 */
export function lookupOutcome(answer, normalized) {
  if (answer === null) return { kind: "fault" };
  const note = quietNote({
    entries: answer.entries.length,
    dictionaries: answer.dictionaries,
    findable: true,
  });
  if (note === null) {
    return {
      kind: "entries",
      blocks: entryBlocks(answer.entries, normalized),
      entries: answer.entries,
      lang: answer.lang,
    };
  }
  // `findable: true` rules the whole-words verdict out; the type of
  // `quietNote` does not know that, so it is folded into the nearest one.
  return { kind: "silence", note: note === "whole-words" ? "not-in-dictionary" : note, lang: answer.lang };
}

/**
 * Whether a saved meaning and a dictionary line are one and the same (K3 of
 * the panel's rebuild, Michał's call 2026-09-12): equal once whitespace is
 * folded the way the store folds it on every save (`collapseWhitespace` -
 * the ends trimmed, every run of whitespace one space), and otherwise
 * exact. Case counts: a German noun and the verb it came from differ by a
 * capital, and a meaning the reader typed is the reader's spelling.
 *
 * @param {string} meaning as saved
 * @param {string} line as the book wrote it, or as typed
 * @returns {boolean}
 */
export function sameMeaning(meaning, line) {
  return collapseWhitespace(meaning) === collapseWhitespace(line);
}

/**
 * Whether a dictionary line is among the phrase's saved meanings - what the
 * line's checkbox shows.
 *
 * @param {string[]} meanings what the phrase means now
 * @param {string} line
 * @returns {boolean}
 */
export function isSaved(meanings, line) {
  return meanings.some((meaning) => sameMeaning(meaning, line));
}

/**
 * What a press on a dictionary line does to the phrase - D34's rule seen from
 * the field: the line joins the saved meanings or leaves them, and the phrase
 * is saved with what is left. Taking the last meaning back forgets the
 * phrase: the bubble declines to save an empty gloss and leaves the reader
 * the rest of the bubble, but here the line was the reader's only word about
 * the phrase, and a phrase with nothing to mean has nothing to stay for
 * (K4 of the panel's rebuild, confirmed by Michał 2026-09-12).
 *
 * The meaning taken back is found by `sameMeaning`: a meaning saved from the
 * bubble is the line with its whitespace folded, and it has to leave on the
 * press of the line it came from.
 *
 * @param {string[]} meanings what the phrase means now - empty while it is
 *   not saved
 * @param {string} line the line pressed
 * @returns {{ act: "save", meanings: string[] } | { act: "forget", meanings: string[] }}
 */
export function afterPress(meanings, line) {
  const without = meanings.filter((meaning) => !sameMeaning(meaning, line));
  const next =
    without.length === meanings.length
      ? toMeanings(afterChoosing(meanings.join(MEANING_SEPARATOR), line))
      : without;
  return next.length === 0 ? { act: "forget", meanings: [] } : { act: "save", meanings: next };
}
