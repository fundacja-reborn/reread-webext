/**
 * What the saved-phrases page shows, without the DOM.
 *
 * A vocabulary is thousands of rows after a season of reading, so the page
 * needs the same two things the long lists in the settings needed - a filter
 * and an order - plus one they did not: pages, because five thousand rows in
 * one column is a scroll nobody finishes. All three are rules, rules can be
 * wrong quietly, and so all three live here, under `node --test`.
 */

import { matchesFilter, sortByLabel } from "../options/models-view.js";

/** @typedef {import("../lib/store/phrase.js").Phrase} Phrase */

/**
 * A hundred rows: enough that a page of vocabulary feels like a list rather
 * than a peephole, few enough that rebuilding one is nothing.
 */
export const PAGE_SIZE = 100;

/**
 * Newest first - the store keeps oldest first, because that is the order an
 * export has to be stable in, but what a reader opens this page for is "what
 * did I just save". The id tiebreak is the store's, mirrored, so two phrases
 * saved in the same millisecond hold their order between renders.
 *
 * @param {Phrase[]} phrases as `listPhrases` answers, oldest first
 * @returns {Phrase[]}
 */
export function newestFirst(phrases) {
  return [...phrases].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
}

/**
 * Everything a row can be found by: how the phrase is written and every
 * meaning it was kept for.
 *
 * @param {Phrase} phrase
 * @returns {string}
 */
export function searchablePhrase(phrase) {
  return [phrase.phrase, ...phrase.translations].join(" ").toLowerCase();
}

/**
 * The page as it should be rendered: which rows, which page that turned out to
 * be, out of how many. The page number asked for is clamped rather than
 * trusted, because the list moves under it - Learned takes the last row of the
 * last page, a filter narrows ten pages to one - and a blank page with a
 * pager pointing back at it is a dead end nobody should have to notice.
 *
 * @param {Phrase[]} phrases newest first, as the page keeps them
 * @param {{ query: string, page: number }} shown what the reader asked for
 * @returns {{ rows: Phrase[], page: number, pages: number, matching: number }}
 */
export function listView(phrases, { query, page }) {
  const matching = phrases.filter((phrase) => matchesFilter(searchablePhrase(phrase), query));
  const pages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  return {
    rows: matching.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE),
    page: current,
    pages,
    matching: matching.length,
  };
}

/**
 * Which pairs the select offers: every pair with anything saved, by name, and
 * the configured pair even when nothing is saved for it yet - a control must
 * never disagree with the settings it shows, which is the popup's rule for the
 * same select. Counts ride along so the choice reads as "what is where"
 * before it is made.
 *
 * @param {{ sourceLang: string, targetLang: string }} config
 * @param {Array<{ langFrom: string, langTo: string, count: number }>} saved
 * @returns {Array<{ pair: string, from: string, to: string, count: number }>}
 */
export function pairChoicesFor(config, saved) {
  const rows = sortByLabel(
    saved.map(({ langFrom, langTo, count }) => ({
      pair: `${langFrom}${langTo}`,
      from: langFrom,
      to: langTo,
      count,
    })),
  );

  const known = rows.some((row) => row.from === config.sourceLang && row.to === config.targetLang);
  if (known) return rows;

  return [
    {
      pair: `${config.sourceLang}${config.targetLang}`,
      from: config.sourceLang,
      to: config.targetLang,
      count: 0,
    },
    ...rows,
  ];
}
