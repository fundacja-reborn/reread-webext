/**
 * Which word an offset falls in - the pure half of selecting by touch (D80).
 *
 * The reader page selects by tap and drag rather than through the browser's
 * own selection, and a touch is a point, not a range: the DOM half turns the
 * point into a character offset with `caretPositionFromPoint`, and this module
 * turns the offset into a word of the tokenization phrases are matched in.
 * Same tokens, same boundaries - a phrase selected this way is exactly a
 * phrase the matcher can find again.
 *
 * Two questions, because a tap and a drag are asking differently. A tap wants
 * the word it landed on and nothing else - a tap that touched no word is a
 * dismissal, not a selection. A drag in progress wants the nearest word, so
 * that a finger crossing the gap between two words never makes the selection
 * flicker away.
 */

/** @typedef {import("./tokenize.js").Token} Token */

/**
 * The word an offset falls inside, edges included.
 *
 * A caret position lies between characters, so an offset equal to a token's
 * end came from a tap on its last character and still means that word. Two
 * tokens can never dispute an offset: adjacent word characters are one token
 * by construction, so between two tokens there is always at least one
 * character of something else.
 *
 * @param {Token[]} tokens
 * @param {number} offset into the text the tokens came from
 * @returns {number} index into `tokens`, or -1 when the offset touches no word
 */
export function wordIndexAt(tokens, offset) {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token !== undefined && offset >= token.start && offset <= token.end) return index;
  }
  return -1;
}

/**
 * The word nearest an offset - the drag's forgiving question.
 *
 * Distance is measured to the token's edges, zero inside it, and the earlier
 * token wins a tie, which keeps the answer stable while a finger sits in the
 * middle of a gap.
 *
 * @param {Token[]} tokens
 * @param {number} offset into the text the tokens came from
 * @returns {number} index into `tokens`, or -1 only when there are no tokens
 */
export function nearestWordIndex(tokens, offset) {
  let best = -1;
  let bestDistance = Infinity;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) continue;
    const distance = offset < token.start ? token.start - offset : offset > token.end ? offset - token.end : 0;
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
    // Inside a token, and tokens do not overlap: nothing further can be nearer.
    if (distance === 0) break;
  }
  return best;
}
