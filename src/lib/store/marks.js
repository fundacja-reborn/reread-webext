/**
 * Where highlighter marks live: one row per document in the reading list's
 * database, holding every mark the document has. One row rather than one per
 * mark for the reason the position is one row: the marks of a document are
 * read together, written together, and leave together with it - and a list
 * of a few dozen small records rewritten whole costs nothing next to the
 * article standing beside it.
 *
 * Keyed by `docId` exactly as positions are - an article's `url`, a book's
 * own id - so the rows of one document can be deleted by one name in one
 * transaction (`articles.js`, `books.js` do that; this module never has to).
 *
 * Only the reader page opens this, like everything else in the database.
 */

import { asMark, compareMarks } from "../reader/marks.js";
import { promisify, withLibrary } from "./library-db.js";

/** @typedef {import("../reader/marks.js").Mark} Mark */

/**
 * Every mark of one document, in reading order, however the row was written
 * or hand-edited. A mark that does not narrow drops alone - the lean of
 * `asMark` - and no row at all is simply a document nobody marked.
 *
 * @param {string} docId
 * @returns {Promise<Mark[]>}
 */
export async function getMarks(docId) {
  const row = await withLibrary("readonly", (stores) => promisify(stores.marks.get(docId)));
  if (typeof row !== "object" || row === null) return [];
  const { marks } = /** @type {Record<string, unknown>} */ (row);
  if (!Array.isArray(marks)) return [];
  return marks
    .map(asMark)
    .filter((mark) => mark !== null)
    .sort(compareMarks);
}

/**
 * The document's marks, replaced whole - the latest word, like a position. An
 * empty list deletes the row rather than storing it: a row saying "no marks"
 * and no row must mean the same thing, and only one of them costs nothing.
 *
 * @param {string} docId
 * @param {Mark[]} marks
 * @returns {Promise<void>}
 */
export async function putMarks(docId, marks) {
  await withLibrary("readwrite", async (stores) => {
    if (marks.length === 0) await promisify(stores.marks.delete(docId));
    else await promisify(stores.marks.put({ docId, marks }));
  });
}

/**
 * Every document's marks at once, for the exports: the article file carries
 * each article's marks beside it, and the highlights file is nothing but
 * this map dressed in titles. One `getAll` for the same reason the list
 * reads positions in bulk. Rows narrow like `getMarks` narrows, and a row
 * left with nothing readable simply is not in the map.
 *
 * @returns {Promise<Map<string, Mark[]>>} keyed by `docId`
 */
export async function allMarks() {
  const rows = /** @type {unknown[]} */ (
    await withLibrary("readonly", (stores) => promisify(stores.marks.getAll()))
  );
  /** @type {Map<string, Mark[]>} */
  const map = new Map();
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const { docId, marks } = /** @type {Record<string, unknown>} */ (row);
    if (typeof docId !== "string" || docId.length === 0 || !Array.isArray(marks)) continue;
    const kept = marks
      .map(asMark)
      .filter((mark) => mark !== null)
      .sort(compareMarks);
    if (kept.length > 0) map.set(docId, kept);
  }
  return map;
}
