/**
 * The gloss: what the bubble shows about a phrase, and what gets saved.
 *
 * The two rules here need no bubble to hold them, so they live where
 * `node --test` can reach them - the same reason `store/phrase.js` is kept apart
 * from the database it writes to.
 */

/**
 * One line per meaning. A word has more than one, and separating them by
 * anything narrower than a line makes them read as one long sentence.
 */
export const MEANING_SEPARATOR = "\n";

/**
 * What the bubble is showing, as the list of meanings that gets stored.
 *
 * A line out of a dictionary comes through here too, and one of those can be
 * several lines: a book that writes a meaning per paragraph arrives as one sense
 * with the breaks still in it. Splitting is what keeps two meanings two meanings
 * all the way into the vocabulary - the store collapses whitespace, so a sense
 * kept whole would become one meaning with its lines glued together by spaces.
 *
 * @param {string} text
 * @returns {string[]} one meaning per line, blank ones dropped
 */
export function toMeanings(text) {
  return text
    .split(MEANING_SEPARATOR)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * The lines of a dictionary entry as a reader can choose between them: one row
 * per meaning, whatever the book packed into one field.
 *
 * The unit of choice is the line and not the entry, and the entry that settled
 * it is WikDict's `nominate` - six pronunciations, `verb`, an English
 * definition and `nominować`, all one sense with the breaks still in it.
 * Pressed whole it made a four-line gloss with a transcription in it, which is
 * everything a flashcard should not be, and left the reader editing afterwards
 * anyway. Split, the line they wanted is one press.
 *
 * No rule about which line is a meaning, and there will not be one: telling a
 * translation from a part of speech needs a list of parts of speech per
 * language, and the reader's eyes do it for nothing.
 *
 * @param {string[]} senses as the dictionary stored them
 * @returns {string[]} one meaning each, in the order the entry had them
 */
export function choosableLines(senses) {
  return senses.flatMap(toMeanings);
}

/**
 * What the gloss becomes when a reader presses a line of a dictionary entry.
 *
 * The line **joins** what is already there, and pressing it again takes it back
 * out. G1 had this the other way - a choice replacing the gloss - and Michał
 * reversed it on the first day of using it, which is the right call: a word has
 * several meanings, `translations` has been a list since the first day for that
 * exact reason (D21), and until now the only way to put a second one in it was
 * to type it. What D21 refuses is a machine quietly adding a variant at every
 * encounter, and a press is nobody's idea of quiet.
 *
 * The order is the order of pressing, after whatever the engine said. Somebody
 * who does not want the engine's guess on the card deletes that one line in the
 * edit box, which is a thing that already exists.
 *
 * Removing the last meaning gives back an empty string. That is not a gloss and
 * the bubble declines it: a phrase with nothing to mean has nothing to save.
 *
 * @param {string} shown the gloss the bubble has right now
 * @param {string} sense the line that was pressed
 * @returns {string}
 */
export function afterChoosing(shown, sense) {
  const meanings = toMeanings(shown);
  const without = meanings.filter((meaning) => meaning !== sense);
  const next = without.length === meanings.length ? [...meanings, sense] : without;
  return next.join(MEANING_SEPARATOR);
}
