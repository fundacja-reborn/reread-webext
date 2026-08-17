/**
 * What the highlights page shows, without the DOM - the same split as
 * `list-view.js` beside the reading list, for the same reason: an order, a
 * filter and pages are rules, rules can be wrong quietly, and so they live
 * under `node --test`.
 *
 * The page is one flat list of quotes, each row knowing which document it
 * came from - not sections per document, because the page exists to be
 * scrolled and searched, and the row's own detail line carries the title.
 * The order is the journal's: the document marked most recently first, and
 * inside a document its quotes in reading order - a reader highlights while
 * moving forward, and a document's quotes read top to bottom the way the
 * document does. Sorting the quotes themselves by their clocks would read
 * each document backwards; the clock orders documents, the text orders
 * quotes.
 */

import { matchesFilter } from "../options/models-view.js";

/** @typedef {import("../lib/reader/marks.js").Mark} Mark */
/** @typedef {import("../lib/store/saved-article.js").SavedMeta} SavedMeta */
/** @typedef {import("../lib/store/book.js").BookMeta} BookMeta */

/**
 * One quote on the page: the mark itself, and what its document answers when
 * the row is drawn or pressed - the key to open it by, which store answers
 * for it, the title the detail line shows, and for a book of many parts the
 * part the quote stands in.
 *
 * @typedef {{
 *   docId: string,
 *   kind: "article" | "book",
 *   title: string,
 *   part: { at: number, of: number } | null,
 *   mark: Mark,
 * }} MarkRow
 */

/**
 * Twenty-five rows: a quote runs several lines where an article row runs
 * two, so half the reading list's fifty keeps a page of quotes at roughly
 * the same scroll.
 */
export const MARKS_PAGE_SIZE = 25;

/**
 * Every stored mark as a row, in the page's order. A mark whose document
 * neither store answers for is left out: marks live and die with their
 * document, so such a row is two reads catching the database mid-delete,
 * not a quote anybody can open.
 *
 * @param {SavedMeta[]} metas
 * @param {BookMeta[]} books
 * @param {Map<string, Mark[]>} marks keyed by `docId`, each list in reading order
 * @returns {MarkRow[]}
 */
export function markRows(metas, books, marks) {
  /** @type {Map<string, { kind: "article" | "book", title: string, parts: number }>} */
  const docs = new Map();
  for (const meta of metas) docs.set(meta.url, { kind: "article", title: meta.title, parts: 1 });
  for (const book of books) {
    docs.set(book.id, { kind: "book", title: book.title, parts: book.segmentCount });
  }

  /** @type {{ docId: string, doc: { kind: "article" | "book", title: string, parts: number }, newest: number, list: Mark[] }[]} */
  const groups = [];
  for (const [docId, list] of marks) {
    const doc = docs.get(docId);
    if (doc === undefined || list.length === 0) continue;
    const newest = Math.max(...list.map((mark) => mark.createdAt));
    groups.push({ docId, doc, newest, list });
  }
  // Newest-marked document first; documents whose clocks were healed to zero
  // sink together to the end, where the title keeps their order steady.
  groups.sort((a, b) => b.newest - a.newest || a.doc.title.localeCompare(b.doc.title));

  return groups.flatMap(({ docId, doc, list }) =>
    list.map((mark) => ({
      docId,
      kind: doc.kind,
      title: doc.title,
      // Only a book of many parts has a part worth naming; an article's
      // implicit one and a one-part book would be a number saying nothing.
      part:
        doc.kind === "book" && doc.parts > 1
          ? { at: mark.segmentIndex + 1, of: doc.parts }
          : null,
      mark,
    })),
  );
}

/**
 * Everything a quote can be found by: its own text and its document's title.
 * The title rides along even on the scoped page, where every row shares it -
 * it matches every row alike there, so it changes nothing.
 *
 * @param {MarkRow} row
 * @returns {string}
 */
export function searchableMark(row) {
  return `${row.mark.text} ${row.title}`.toLowerCase();
}

/**
 * The page as it should be rendered: which rows, which page that turned out
 * to be, out of how many. The page number is clamped rather than trusted,
 * exactly the reading list's reason: the list moves under it. `total` counts
 * the scope before the filter, so the renderer can tell "nothing highlighted
 * here" from "the filter matched nothing" - two different sentences.
 *
 * @param {MarkRow[]} rows as `markRows` built them
 * @param {{ scope: string | null, query: string, page: number }} shown
 * @returns {{ rows: MarkRow[], page: number, pages: number, matching: number, total: number }}
 */
export function marksListView(rows, { scope, query, page }) {
  const inScope = scope === null ? rows : rows.filter((row) => row.docId === scope);
  const matching = inScope.filter((row) => matchesFilter(searchableMark(row), query));
  const pages = Math.max(1, Math.ceil(matching.length / MARKS_PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  return {
    rows: matching.slice((current - 1) * MARKS_PAGE_SIZE, current * MARKS_PAGE_SIZE),
    page: current,
    pages,
    matching: matching.length,
    total: inScope.length,
  };
}
