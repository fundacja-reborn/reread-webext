/**
 * The order and the filtering of the long lists on the settings page, without
 * the DOM.
 *
 * The model list went from two rows to a hundred the day the registry learned
 * every pair Mozilla publishes, and the dictionary catalogue arrived at five
 * hundred; lists that long need two things a short list never did: an order
 * that puts what is yours where you can see it, and a filter that finds a
 * language by name. Both are rules, rules can be wrong quietly, and so both
 * live here, where `node --test` can reach them. Everything below the model
 * ordering works on anything with a `from` and a `to`, because that is all it
 * ever reads - which is why the saved-phrases page borrows it too.
 */

import { pairLabel } from "../lib/language.js";

/**
 * @typedef {import("../lib/models/registry.js").ModelRow} ModelRow
 */

/**
 * @typedef {{ from: string, to: string, pair?: string }} Directed anything with two language sides
 */

/**
 * @param {Directed} a
 * @param {Directed} b
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
 * By name only - for the pair select and the dictionary catalogue, where
 * nothing is "installed first".
 *
 * @template {Directed} T
 * @param {T[]} rows
 * @returns {T[]}
 */
export function sortByLabel(rows) {
  return [...rows].sort(byLabel);
}

/**
 * Everything a row can be found by: codes for whoever thinks in `pl`, names
 * for whoever thinks in Polish, joined and lowered once at render time. Both
 * spellings of the pair are in there, because models write `enpl` and
 * dictionaries write `en-pl`, and nobody filtering should have to know which.
 *
 * @param {Directed} row
 * @returns {string}
 */
export function searchableText(row) {
  return [row.from, row.to, row.pair ?? `${row.from}${row.to}`, `${row.from}-${row.to}`, pairLabel(row.from, row.to)]
    .join(" ")
    .toLowerCase();
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
