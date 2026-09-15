/**
 * How long a text is, in the two numbers a reader picks a text by (D226):
 * its words, and the minutes they take at a steady pace. Pure over strings,
 * so that the list's row, the header over the article and the imports all
 * count one way, and the way runs under `node --test`.
 *
 * A word is what the matcher calls a token (`matcher/tokenize.js`): a run of
 * letters, digits and their marks, with everything between runs ignored -
 * `don't` is two, `e-mail` is two, exactly as the underlines see them. The
 * one exception is writing without spaces between words, Chinese and
 * Japanese, where a run is a whole clause and would count as one: there
 * every character counts, which is how reading speed is quoted for those
 * languages anyway (characters a minute).
 *
 * The pace is one number per reader - typed once in the settings (D228) -
 * and the same for every text, on purpose. Reading speed differs by text
 * too, by its language and by how much of it is new, and no setting could
 * keep up with that; the label says "about", and a text counted at one
 * steady pace still orders the list honestly - twice the words, twice the
 * minutes. What the setting puts right is the reader's own pace: the
 * default, two hundred words a minute, is a slow native reader, and a
 * reader of a language they are learning at half that saw every estimate
 * halved.
 */

/**
 * Words a minute - the pace every estimate is made at until the reader sets
 * their own (`readingPace` in the config).
 */
export const WORDS_PER_MINUTE = 200;

/** The tokenizer's word class, as one run. */
const WORD = /[\p{L}\p{N}\p{M}]+/gu;

/**
 * The scripts written without spaces between words, where a character is
 * the unit a reading speed counts. Korean is not here: it puts spaces
 * between words, and the runs count right on their own.
 */
const CHARACTER_WORDS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;

/**
 * How many words a plain text holds.
 *
 * @param {string} text
 * @returns {number}
 */
export function countWords(text) {
  let words = 0;
  for (const [run] of text.matchAll(WORD)) {
    const characters = run.match(CHARACTER_WORDS);
    if (characters === null) words += 1;
    // A run of characters that each count, and whatever else stood glued
    // to them (`2024年`: the year and the character) as one word more.
    else words += characters.length + (characters.length < run.length ? 1 : 0);
  }
  return words;
}

/**
 * The elements our own markup may hold *inside* a run of prose (the kept
 * list of `sanitize.js` minus everything that starts a new line). A tag
 * from this set stands between two halves of one word as often as between
 * two words (`un<em>believ</em>able`), so it counts for nothing; any other
 * tag - a paragraph, a list item, a line break, an unknown name - ends the
 * word before it, which is what the reader sees too.
 */
const INLINE = new Set([
  "a", "abbr", "b", "cite", "code", "del", "em", "i", "ins", "kbd", "mark", "q", "s", "samp",
  "small", "span", "strong", "sub", "sup", "time", "u", "var",
]);

/** A comment, which the rebuild never writes but a hand-made file might. */
const COMMENT = /<!--[\s\S]*?-->/g;

/**
 * One tag, its attributes with their quoted values taken as a whole: a `>`
 * inside an `alt` must not end the tag early and spill half of it into the
 * count. The three alternatives start on different characters, so the
 * scan is one pass whatever the tag holds.
 */
const TAG = /<\/?([a-zA-Z][a-zA-Z0-9-]*)(?:\s(?:[^>"']|"[^"]*"|'[^']*')*)?\/?>/g;

/**
 * A character reference, numeric or named. The serializer writes only five
 * names into text (`amp`, `lt`, `gt`, `quot` and `nbsp`); the rest is for
 * files written by hand.
 */
const ENTITY = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z][a-zA-Z0-9]*));/g;

const NAMED = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", "\""],
  ["apos", "'"],
  // U+00A0 is not a word character, and must not be read as the word `nbsp`.
  ["nbsp", " "],
]);

/**
 * @param {string} decimal
 * @param {string} hex
 * @param {string} named
 * @returns {string}
 */
function decoded(decimal, hex, named) {
  if (decimal !== undefined || hex !== undefined) {
    const code = decimal !== undefined ? Number.parseInt(decimal, 10) : Number.parseInt(hex, 16);
    const valid = code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
    return valid ? String.fromCodePoint(code) : " ";
  }
  // An unknown name is dropped rather than spaced: it is most often a letter
  // (`&eacute;`), and a space there would cut one word into two.
  return NAMED.get(named) ?? "";
}

/**
 * How many words a piece of our own rebuilt markup holds - the content a
 * saved article stores, a book's blocks, the article as it stands on the
 * reader's page. Counted off the markup rather than a DOM so that the
 * count is the same wherever it is made, and needs no document to make it.
 *
 * @param {string} markup
 * @returns {number}
 */
export function wordsIn(markup) {
  const text = markup
    .replace(COMMENT, " ")
    .replace(TAG, (_tag, name) => (INLINE.has(String(name).toLowerCase()) ? "" : " "))
    .replace(ENTITY, (_reference, decimal, hex, named) => decoded(decimal, hex, named));
  return countWords(text);
}

/**
 * The minutes a count of words takes at a pace, as a label wants them:
 * whole minutes under an hour (never less than one - a text is never read
 * in no time), hours and minutes above it, the minutes to the nearest five
 * because at that length the estimate is no finer than that.
 *
 * @param {number} words
 * @param {number} [pace] words a minute - the reader's own from the config,
 *   already held to its scale there; the default where nobody set one
 * @returns {{ hours: number, minutes: number }}
 */
export function readingTime(words, pace = WORDS_PER_MINUTE) {
  const total = Math.max(1, Math.round(words / pace));
  if (total < 60) return { hours: 0, minutes: total };
  const hours = Math.floor(total / 60);
  const rest = Math.round((total - hours * 60) / 5) * 5;
  return rest === 60 ? { hours: hours + 1, minutes: 0 } : { hours, minutes: rest };
}

/**
 * A count as a stored row may carry it, or nothing: a row from before the
 * field has none and is counted when it is next opened; a field that will
 * not read is no count. Zero is a count - a text of pictures alone was
 * counted and found empty, and must not be counted again on every open.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
export function asWordCount(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}
