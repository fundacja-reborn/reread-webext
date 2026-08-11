/**
 * Which language pairs the popup offers.
 *
 * Only pairs whose model is on this device, because the popup is for switching
 * between things that work - downloading what does not is the settings page's
 * job, a screen with room to say what it costs. Plus the configured pair even
 * when its model is not here: a control must never disagree with the settings
 * it shows, and silently displaying the first installed pair instead would be
 * exactly that disagreement.
 *
 * Pure and separate from the popup's DOM for the reason `withDefaults` is: the
 * rule is worth a test, and `node --test` has no popup to open.
 */

/**
 * @typedef {{ pair: string, from: string, to: string }} PairChoice
 */

/**
 * @param {{ sourceLang: string, targetLang: string }} config
 * @param {PairChoice[]} installed models on this device, in any order
 * @returns {PairChoice[]} what the select shows, configured pair always included
 */
export function pairChoices(config, installed) {
  const rows = installed
    .map(({ pair, from, to }) => ({ pair, from, to }))
    .sort((a, b) => a.pair.localeCompare(b.pair));

  const known = rows.some((row) => row.from === config.sourceLang && row.to === config.targetLang);
  if (known) return rows;

  return [
    { pair: `${config.sourceLang}${config.targetLang}`, from: config.sourceLang, to: config.targetLang },
    ...rows,
  ];
}
