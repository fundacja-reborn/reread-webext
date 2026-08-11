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
 * Pressing one is choosing it, and the choice replaces the gloss rather than
 * joining it (G1): the reader has just read both answers and decided between
 * them, and a card carrying the rejected one is a worse card.
 *
 * Pressing the chosen line again gives back the gloss it replaced. That second
 * press is the whole undo and it earns its line: once a dictionary meaning is
 * showing, the engine's answer is nowhere on the screen, so without it the way
 * back would be to forget the phrase and select it again.
 *
 * @param {string} shown the gloss the bubble has right now
 * @param {string} sense the line that was pressed
 * @param {string} given the gloss before any line was chosen
 * @returns {string}
 */
export function afterChoosing(shown, sense, given) {
  return shown === sense ? given : sense;
}
