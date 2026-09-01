/**
 * Which of the popup's rows stand, once the settings have been read.
 *
 * Two questions decide it, and both are about what the popup would otherwise
 * promise. A fresh install has no model, so a pair select would offer a
 * translation nothing can deliver (the signpost to the settings stands in its
 * place). Translation switched off (D120) takes the whole translating half of
 * the extension out of reach, so every row that only serves it goes too, and
 * one quiet note stands where the pair was - the state must never read as a
 * breakage.
 *
 * Pure and separate from the popup's DOM for the reason `choices.js` is: the
 * rule is worth a test, and `node --test` has no popup to open.
 */

/**
 * @typedef {object} PopupRows
 * @property {boolean} site the switch for the site the popup opened over
 * @property {boolean} pair the language pair select
 * @property {boolean} setup the signpost that stands in the pair's place on a
 *   device with no model at all
 * @property {boolean} translationNote the line that says why nothing
 *   translates, in the same place
 * @property {boolean} vocabulary the door to the saved phrases
 * @property {boolean} quiet the folded-bubble switch
 * @property {boolean} readerOnly the reader-only switch
 * @property {boolean} translation the translation-off switch itself
 */

/**
 * @param {{ translationOff: boolean, bubbleOff: boolean, fresh: boolean, pair: boolean }} state
 *   the two settings, whether this device holds no translation model at all,
 *   and whether a language pair is chosen (D162: with one, the quiet
 *   vocabulary works on ordinary pages, and the rows that serve it stand)
 * @returns {PopupRows}
 */
export function popupRows({ translationOff, bubbleOff, fresh, pair }) {
  return {
    // With the bubble switched off under the trim (D149) every ordinary page
    // is left alone already, so a switch that could only leave it alone too
    // has no other side - the row goes; a site's own entry, if any, stays
    // readable in the settings' list.
    site: !(translationOff && bubbleOff),
    pair: !translationOff && !fresh,
    setup: !translationOff && fresh,
    translationNote: translationOff,
    // The saved phrases live wherever a pair is chosen - the quiet
    // vocabulary writes them without the engine (D158/D162) - so their door
    // goes only when there is truly nothing behind it.
    vocabulary: !translationOff || pair,
    // The bubble's fold means nothing when the trimmed bubble never folds.
    quiet: !translationOff,
    // Reader-only keeps its say under the trim now (D162): with a pair the
    // ordinary pages read again, and this is the switch that decides. It
    // still goes when every page is a launcher (no pair) or left alone
    // entirely (the no-bubble sub-option).
    readerOnly: !translationOff || (pair && !bubbleOff),
    // Always, and it is the one switch that stays: it is the way back, and a
    // mode with no way out of it in the surface that turned it on would be a
    // trap. The row it sits in is the last before the settings, where the
    // popup keeps what is flipped rarely.
    translation: true,
  };
}
