/**
 * The sentence a selection sits in.
 *
 * The engine is much better at a word when it can see the sentence around it:
 * measured on the real en-pl model, thirty ambiguous words came out in the right
 * sense 25 times inside their sentence and 10 times on their own. What it will
 * not do is say which target word the selected one became - this build exposes
 * no alignment - so the sentence is not used to sharpen the gloss. It is shown,
 * translated, behind "More".
 *
 * Finding where a sentence starts is a guess dressed as a rule, and the rule
 * here is deliberately small: a full stop ends a sentence unless it is doing
 * another job. Everything it gets wrong costs a slightly longer or shorter piece
 * of context - never a wrong translation of the phrase itself, which is
 * translated on its own either way.
 *
 * No DOM in this file: the caller hands over text and two offsets, so all of
 * this is testable without a browser.
 */

import { trimPhrase } from "./normalize.js";

/** Ends a sentence on its own, wherever it appears. */
const HARD_STOPS = new Set(["!", "?", "…", "\n"]);

/**
 * Abbreviations that end in a full stop and are regularly followed by a capital
 * letter, which is the only case the rules below cannot tell from a sentence
 * ending. Single letters (`J. R. R. Tolkien`, `e.g.`) are handled by a rule
 * rather than a list, and lower-case abbreviations (`np.`, `itd.`) by the one
 * about what follows.
 */
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "st", "sr", "jr", "vs", "etc", "fig", "no", "vol", "ok",
]);

/**
 * How long a piece of context may get before it stops being a sentence and
 * starts being a paragraph somebody forgot to punctuate. Past this the reader
 * gets no context rather than a wall of text and the decoding time it costs.
 */
export const MAX_SENTENCE_LENGTH = 400;

/**
 * @param {string} text
 * @param {number} index of the character before the full stop
 * @returns {string} the word ending at `index`, lower-cased
 */
function wordBefore(text, index) {
  let start = index + 1;
  while (start > 0 && /\p{L}/u.test(text[start - 1] ?? "")) start -= 1;
  return text.slice(start, index + 1).toLowerCase();
}

/**
 * Whether the character at `index` ends a sentence.
 *
 * @param {string} text
 * @param {number} index
 * @returns {boolean}
 */
function endsSentence(text, index) {
  const character = text[index];
  if (character === undefined) return false;
  if (HARD_STOPS.has(character)) return true;
  if (character !== ".") return false;

  const next = text[index + 1];
  // `3.14` and `example.com`: a full stop with text hard against it is inside
  // something, not after it.
  if (next !== undefined && !/\s/u.test(next)) return false;

  const word = wordBefore(text, index - 1);
  // One letter before the stop is an initial or `e.g.`, never the end of a
  // sentence somebody wrote.
  if (word.length === 1) return false;
  if (ABBREVIATIONS.has(word)) return false;

  // What follows decides the rest. A lower-case letter continues what was
  // already going on, and so does a digit: sentences rarely start with one,
  // while `godz. 15`, `vol. 3` and `p. 40` are everywhere.
  const following = text.slice(index + 1).match(/\S/u)?.[0];
  if (following === undefined) return true;
  return !/[\p{Ll}\p{N}]/u.test(following);
}

/**
 * The sentence containing `[start, end)`, or `null` when there is no useful one.
 *
 * Null means "say nothing extra": the selection already is the whole sentence,
 * or what is around it is too long to be one, or the offsets make no sense.
 *
 * @param {string} text of one block, as the reader sees it
 * @param {number} start of the selection within it
 * @param {number} end of the selection within it
 * @returns {string | null}
 */
export function sentenceAround(text, start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 0 || end > text.length || start >= end) return null;

  let from = 0;
  // Stops strictly before the selection only: a full stop inside it is part of
  // what was selected, not a boundary of the sentence it sits in.
  for (let index = start - 1; index >= 0; index -= 1) {
    if (endsSentence(text, index)) {
      from = index + 1;
      break;
    }
  }

  let to = text.length;
  for (let index = Math.max(start, end - 1); index < text.length; index += 1) {
    if (endsSentence(text, index)) {
      to = index + 1;
      break;
    }
  }

  const sentence = text.slice(from, to).trim();
  if (sentence.length === 0 || sentence.length > MAX_SENTENCE_LENGTH) return null;

  // Nothing to add: the selection is the sentence, so translating it twice would
  // print the same line under itself. Compared without the punctuation at the
  // edges, because dragging over a sentence usually catches the full stop and
  // sometimes does not, and that is not a difference worth a second line.
  if (trimPhrase(sentence) === trimPhrase(text.slice(start, end))) return null;

  return sentence;
}
