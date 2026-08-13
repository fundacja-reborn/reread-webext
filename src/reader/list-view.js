/**
 * What the reading list shows, without the DOM - the same split as
 * `vocab/list-view.js`, for the same reason: a filter, an order and pages are
 * rules, rules can be wrong quietly, and so they live under `node --test`.
 *
 * The order and the segment split are the store's own (`listedRows`); this
 * module adds what a list on screen needs on top of them - which rows match
 * the filter box, and which slice of those is the page in view.
 */

import { listedRows } from "../lib/store/saved-article.js";
import { matchesFilter } from "../options/models-view.js";

/** @typedef {import("../lib/store/saved-article.js").SavedMeta} SavedMeta */
/** @typedef {import("../lib/store/saved-article.js").SegmentValue} SegmentValue */

/**
 * Fifty rows: an article row is a title over a line of detail, about twice a
 * phrase row, so half the vocabulary page's hundred keeps a page of articles
 * at roughly the same scroll.
 */
export const PAGE_SIZE = 50;

/**
 * Everything a row can be found by: the title as it is shown and the site it
 * came from.
 *
 * @param {SavedMeta} meta
 * @returns {string}
 */
export function searchableArticle(meta) {
  return `${meta.title} ${meta.hostname}`.toLowerCase();
}

/**
 * The list as it should be rendered: which rows, which page that turned out
 * to be, out of how many. The page number asked for is clamped rather than
 * trusted, because the list moves under it - a delete takes the last row of
 * the last page, a filter narrows ten pages to one - and a blank page with a
 * pager pointing back at it is a dead end nobody should have to notice.
 *
 * `inSegment` counts the segment before the filter, so the renderer can tell
 * "this segment is empty" from "the filter matched nothing" - two different
 * sentences.
 *
 * @param {SavedMeta[]} metas as `listArticles` answers, in any order
 * @param {{ segment: SegmentValue, query: string, page: number }} shown
 * @returns {{ rows: SavedMeta[], page: number, pages: number, matching: number, inSegment: number }}
 */
export function libraryView(metas, { segment, query, page }) {
  const inSegment = listedRows(metas, segment);
  const matching = inSegment.filter((meta) => matchesFilter(searchableArticle(meta), query));
  const pages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  return {
    rows: matching.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE),
    page: current,
    pages,
    matching: matching.length,
    inSegment: inSegment.length,
  };
}
