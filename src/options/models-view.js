/**
 * The settings page's rules, without the DOM: the order and the filtering of
 * its long lists, and the one move of its first-steps fold.
 *
 * The model list went from two rows to a hundred the day the registry learned
 * every pair Mozilla publishes, and the dictionary catalogue arrived at five
 * hundred; lists that long need two things a short list never did: an order
 * that puts what is yours where you can see it, and a filter that finds a
 * language by name. Both are rules, rules can be wrong quietly, and so both
 * live here, where `node --test` can reach them. Everything below the model
 * ordering, down to the filter, works on anything with a `from` and a `to`,
 * because that is all it ever reads - which is why the saved-phrases page
 * borrows it too.
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
 * a long list for "mine", and to the alphabet for everything else. Models and
 * dictionaries both order this way, so the rule reads only what both carry.
 *
 * @template {Directed & { installed: object | null }} T
 * @param {T[]} rows
 * @param {{ sourceLang: string, targetLang: string }} reading
 * @returns {T[]}
 */
export function orderForDisplay(rows, reading) {
  /** @param {T} row */
  const tier = (row) => {
    if (row.from === reading.sourceLang && row.to === reading.targetLang) return 0;
    return row.installed !== null ? 1 : 2;
  };
  return [...rows].sort((a, b) => tier(a) - tier(b) || byLabel(a, b));
}

/**
 * @typedef {object} DictionaryRow one line of the dictionary frame
 * @property {string} from
 * @property {string} to
 * @property {import("../lib/dict/store.js").Dictionary | null} installed
 * @property {import("../lib/dict/catalog.js").CatalogDictionary | null} available
 */

/**
 * The dictionary frame's rows: every stored dictionary, then every catalogue
 * pair not already answered for. One row per stored dictionary rather than per
 * pair, because two dictionaries of one pair can both be here (a WikDict one
 * and one added from files) and each needs its own delete button. A catalogue
 * pair with a stored dictionary is folded away instead of offered again:
 * downloading it a second time would store a duplicate, and the by-hand fold
 * below stays open for whoever truly wants two.
 *
 * The stored ones keep the order they arrive in, untouched - that order is the
 * order they answer a lookup in, arranged by hand with the arrows, and a page
 * that re-sorted it into "the pair being read first" would be showing one
 * thing while the bubble did another. Only the catalogue below them is put in
 * display order, where the pair being read is genuinely the useful row to find
 * first among five hundred.
 *
 * @param {import("../lib/dict/store.js").Dictionary[]} stored in answering order
 * @param {import("../lib/dict/catalog.js").CatalogDictionary[]} catalog
 * @param {{ sourceLang: string, targetLang: string }} reading
 * @returns {DictionaryRow[]}
 */
export function dictionaryRows(stored, catalog, reading) {
  const covered = new Set(stored.map((one) => `${one.langFrom}-${one.langTo}`));

  /** @type {DictionaryRow[]} */
  const installed = stored.map((one) => ({
    from: one.langFrom,
    to: one.langTo,
    installed: one,
    available: null,
  }));

  /** @type {DictionaryRow[]} */
  const offered = catalog
    .filter((entry) => !covered.has(`${entry.from}-${entry.to}`))
    .map((entry) => ({ from: entry.from, to: entry.to, installed: null, available: entry }));

  return [...installed, ...orderForDisplay(offered, reading)];
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

/**
 * Whether the filter box is asking anything. Whitespace asks nothing: it
 * matches every row, and a list that unfolds under a stray space would be the
 * fold deciding by accident.
 *
 * @param {string} query as typed
 * @returns {boolean}
 */
export function filterActive(query) {
  return query.trim().length > 0;
}

/**
 * Whether one row of a catalogue is on screen.
 *
 * The lists stand folded to what is installed, because that is what somebody
 * returns to this page for; the hundreds of downloadable rows unfold on
 * request. A query overrides the fold in both directions - typing searches
 * the whole list without a press on "Show all", and what it hides it hides
 * even among the installed.
 *
 * @param {{ installed: boolean, matches: boolean, expanded: boolean, query: string }} row
 * @returns {boolean}
 */
export function rowVisible({ installed, matches, expanded, query }) {
  if (filterActive(query)) return matches;
  return expanded || installed;
}

/**
 * The one control of a folded list: whether "Show all" stands, and the count
 * it wears. The count is the whole list - the promise of what pressing it
 * shows, not of what is currently out of sight. Gone while a query runs the
 * list (the filter already reaches everything) and once everything shows
 * anyway.
 *
 * @param {{ total: number, installedCount: number, expanded: boolean, query: string }} list
 * @returns {{ shown: boolean, count: number }}
 */
export function showAllState({ total, installedCount, expanded, query }) {
  return { shown: !expanded && !filterActive(query) && total > installedCount, count: total };
}

/**
 * What the pair select offers: the pairs whose model is on this device - the
 * only pairs the engine can serve, and a shorter list than the catalogue's
 * hundred, which no native dropdown survives. Sorted by label, like every
 * list on the page.
 *
 * The configured pair rides along even with its model gone (deleted, or
 * configured by hand): a settings page must never disagree with the settings.
 * Empty means nothing is installed at all - the select then explains itself
 * with one disabled line instead of offering choices that translate nothing.
 *
 * @param {ModelRow[]} rows
 * @param {{ sourceLang: string, targetLang: string }} reading
 * @returns {{ pair: string, from: string, to: string }[]}
 */
export function pairChoices(rows, reading) {
  const installed = rows
    .filter((row) => row.installed !== null)
    .map((row) => ({ pair: row.pair, from: row.from, to: row.to }));
  if (installed.length === 0) return [];

  const known = installed.some((row) => row.from === reading.sourceLang && row.to === reading.targetLang);
  const choices = known
    ? installed
    : [
        { pair: `${reading.sourceLang}${reading.targetLang}`, from: reading.sourceLang, to: reading.targetLang },
        ...installed,
      ];
  return sortByLabel(choices);
}

/**
 * Which way the first-steps fold should move after a look at the stores.
 *
 * Setting up means two downloads, so the fold stands open while a model or a
 * dictionary is missing, and closes once both are here - but it only moves
 * when that verdict changes. Between changes `open` is null, and a fold the
 * reader toggled by hand stays as they left it through every redraw. Losing
 * the last model or dictionary opens it again: translating truly stopped
 * working, and the instructions are the answer to that.
 *
 * Any model and any dictionary count, not just the reading pair's: the fold
 * teaches the two moves, and the catalogue has no dictionary for every pair a
 * model exists for - a demand it cannot meet would hold the fold open forever.
 *
 * @param {boolean | null} wasDone the last look's verdict, null before the first
 * @param {boolean} modelStored whether any model is stored
 * @param {boolean} dictionaryStored whether any dictionary is stored
 * @returns {{ done: boolean, open: boolean | null }} the verdict to remember, and the move to make
 */
export function firstStepsMove(wasDone, modelStored, dictionaryStored) {
  const done = modelStored && dictionaryStored;
  return { done, open: done === wasDone ? null : !done };
}
