/**
 * How a selected phrase is reduced to the key everything else agrees on.
 *
 * This is the most expensive function in the project to change: it decides
 * which phrase is "the same phrase" for the vocabulary store, for the
 * highlighter, and for import - so changing it after the first release means
 * rewriting stored keys, not just recompiling. Anything added here should be a
 * difference nobody would call a difference: a line break inside a selection, a
 * non-breaking space, a soft hyphen left over from justified text.
 *
 * Deliberately not done here:
 *   - stripping punctuation. Selecting `word,` and selecting `word` really do
 *     produce different keys today. Whether that is worth fixing is an open
 *     question in the docs, not something to sneak in.
 *   - lemmatisation. Out of scope by decision: matching is literal.
 */

/**
 * Invisible characters that only ever come from how the text was laid out:
 * U+00AD, a soft hyphen left by justification, and U+200B, a zero-width space
 * marking a break opportunity. Built from a string of escapes rather than
 * written into a regex literal, because a literal one in the source is a
 * character nobody can see in a diff.
 */
const LAYOUT_ARTEFACTS = new RegExp("[\\u00AD\\u200B]", "gu");

/**
 * The phrase as it is shown and stored for display: original case, but with the
 * line breaks of the page taken out.
 *
 * @param {string} text
 * @returns {string}
 */
export function collapseWhitespace(text) {
  return text.normalize("NFC").replace(LAYOUT_ARTEFACTS, "").replace(/\s+/gu, " ").trim();
}

/**
 * The matching key: `collapseWhitespace` plus case folding.
 *
 * `toLowerCase` and not `toLocaleLowerCase`: the key must not depend on the
 * locale of the browser that produced it, or the same phrase saved on a Turkish
 * profile would stop matching itself anywhere else.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalize(text) {
  return collapseWhitespace(text).toLowerCase();
}
