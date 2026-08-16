/**
 * What the reading list shows, without the DOM - the same split as
 * `vocab/list-view.js`, for the same reason: a filter, an order and pages are
 * rules, rules can be wrong quietly, and so they live under `node --test`.
 *
 * The order and the segment split are the store's own (`listedRows`); this
 * module adds what a list on screen needs on top of them - which rows match
 * the filter box, and which slice of those is the page in view.
 *
 * Books share the list with articles by wearing the same fields: the entry
 * mappers below are the one place that decides how a book answers the
 * questions the list asks - what is its title, what stands where the site
 * name stands, where does it sort. Everything downstream (segments, filter,
 * pages) then treats the two kinds identically, which is the point.
 */

import { overallPercent } from "../lib/reader/position.js";
import { Segment, listedRows } from "../lib/store/saved-article.js";
import { matchesFilter } from "../options/models-view.js";

/** @typedef {import("../lib/store/saved-article.js").SavedMeta} SavedMeta */
/** @typedef {import("../lib/store/saved-article.js").SegmentValue} SegmentValue */
/** @typedef {import("../lib/store/book.js").BookMeta} BookMeta */
/** @typedef {import("../lib/reader/position.js").ReadingPosition} ReadingPosition */

/**
 * One row of the list, either kind. `url` is the row's key and the way to
 * open it - a book's id plays the part its address plays for an article.
 * `percentRead` is how much of the whole document has passed before the
 * eyes, 0-100 - or null for a row never opened (or whose position predates
 * the measure). The renderer says it only on unread rows: on a read one the
 * mark has already said more.
 *
 * @typedef {SavedMeta & {
 *   kind: "article" | "book",
 *   progress: { at: number, of: number } | null,
 *   percentRead: number | null,
 * }} LibraryEntry
 */

/**
 * Fifty rows: an article row is a title over a line of detail, about twice a
 * phrase row, so half the vocabulary page's hundred keeps a page of articles
 * at roughly the same scroll.
 */
export const PAGE_SIZE = 50;

/**
 * @param {SavedMeta} meta
 * @param {ReadingPosition | null} position
 * @returns {LibraryEntry}
 */
export function articleEntry(meta, position) {
  return {
    ...meta,
    kind: "article",
    progress: null,
    percentRead: overallPercent(position, 1),
  };
}

/**
 * A book as a row. The author stands where the hostname stands - it is what
 * the filter searches and the detail line opens with. `savedAt` is when the
 * book was added, so the one ordering rule serves both kinds. Progress reads
 * the stored position: a book never opened is honestly at its first part,
 * and a position pointing past the end (which the anchor rules would refuse
 * anyway) shows as the last.
 *
 * @param {BookMeta} book
 * @param {ReadingPosition | null} position
 * @returns {LibraryEntry}
 */
export function bookEntry(book, position) {
  const at = position === null ? 0 : Math.min(position.segmentIndex, book.segmentCount - 1);
  return {
    url: book.id,
    hostname: book.author ?? "",
    title: book.title,
    savedAt: book.addedAt,
    readAt: book.readAt,
    kind: "book",
    progress: { at: at + 1, of: book.segmentCount },
    percentRead: overallPercent(position, book.segmentCount),
  };
}

/**
 * Everything a row can be found by: the title as it is shown, and the site
 * it came from - or, for a book, its author.
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
 * `unread` and `read` count the whole of each segment, filter and pages
 * notwithstanding: they feed the tab labels, and a tab says how much it
 * holds, not how much of it happens to be on screen. The two are derived
 * from one `listedRows` call because the segments partition the list -
 * counting the other one twice would be a second copy of the rule.
 *
 * @template {SavedMeta} T
 * @param {T[]} metas as the stores answer, in any order
 * @param {{ segment: SegmentValue, query: string, page: number }} shown
 * @returns {{
 *   rows: T[],
 *   page: number,
 *   pages: number,
 *   matching: number,
 *   inSegment: number,
 *   unread: number,
 *   read: number,
 * }}
 */
export function libraryView(metas, { segment, query, page }) {
  const inSegment = listedRows(metas, segment);
  const matching = inSegment.filter((meta) => matchesFilter(searchableArticle(meta), query));
  const pages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  const elsewhere = metas.length - inSegment.length;
  return {
    rows: matching.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE),
    page: current,
    pages,
    matching: matching.length,
    inSegment: inSegment.length,
    unread: segment === Segment.UNREAD ? inSegment.length : elsewhere,
    read: segment === Segment.READ ? inSegment.length : elsewhere,
  };
}
