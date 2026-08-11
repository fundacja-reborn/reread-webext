/**
 * The order and the filtering of the model list, without the DOM.
 *
 * The list went from two rows to a hundred the day the registry learned every
 * pair Mozilla publishes, and a hundred rows need two things a short list never
 * did: an order that puts what is yours where you can see it, and a filter that
 * finds a language by name. Both are rules, rules can be wrong quietly, and so
 * both live here, where `node --test` can reach them.
 */

import { pairLabel } from "../lib/language.js";

/**
 * @typedef {import("../lib/models/registry.js").ModelRow} ModelRow
 */

/**
 * @param {ModelRow} a
 * @param {ModelRow} b
 * @returns {number}
 */
function byLabel(a, b) {
  return pairLabel(a.from, a.to).localeCompare(pairLabel(b.from, b.to));
}

/**
 * The pair being read first, then what is installed, then everything that
 * could be downloaded - by name within each group. The eye goes to the top of
 * a long list for "mine", and to the alphabet for everything else.
 *
 * @param {ModelRow[]} rows
 * @param {{ sourceLang: string, targetLang: string }} reading
 * @returns {ModelRow[]}
 */
export function orderForDisplay(rows, reading) {
  /** @param {ModelRow} row */
  const tier = (row) => {
    if (row.from === reading.sourceLang && row.to === reading.targetLang) return 0;
    return row.installed !== null ? 1 : 2;
  };
  return [...rows].sort((a, b) => tier(a) - tier(b) || byLabel(a, b));
}

/**
 * By name only - for the pair select, where nothing is "installed first"
 * because choosing what to read is not managing what is stored.
 *
 * @param {ModelRow[]} rows
 * @returns {ModelRow[]}
 */
export function sortByLabel(rows) {
  return [...rows].sort(byLabel);
}

/**
 * Everything a row can be found by: codes for whoever thinks in `pl`, names
 * for whoever thinks in Polish, joined and lowered once at render time.
 *
 * @param {ModelRow} row
 * @returns {string}
 */
export function searchableText(row) {
  return [row.from, row.to, row.pair, pairLabel(row.from, row.to)].join(" ").toLowerCase();
}

/**
 * Every word of the query has to appear somewhere in the row's text, so
 * "english pol" narrows and "pol english" narrows to the same rows. An empty
 * query matches everything, which is what an empty filter box means.
 *
 * @param {string} searchable as `searchableText` built it
 * @param {string} query as typed
 * @returns {boolean}
 */
export function matchesFilter(searchable, query) {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word.length > 0);
  return words.every((word) => searchable.includes(word));
}
