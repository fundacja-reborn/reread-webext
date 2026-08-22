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
 * @param {{ translationOff: boolean, fresh: boolean }} state the setting, and
 *   whether this device holds no translation model at all
 * @returns {PopupRows}
 */
export function popupRows({ translationOff, fresh }) {
  return {
    pair: !translationOff && !fresh,
    setup: !translationOff && fresh,
    translationNote: translationOff,
    vocabulary: !translationOff,
    // The bubble's fold means nothing when the bubble is trimmed to a phrase
    // and a speaker, and reader-only means nothing when every ordinary page
    // is a launcher page already.
    quiet: !translationOff,
    readerOnly: !translationOff,
    // Always, and it is the one switch that stays: it is the way back, and a
    // mode with no way out of it in the surface that turned it on would be a
    // trap. The row it sits in is the last before the settings, where the
    // popup keeps what is flipped rarely.
    translation: true,
  };
}
