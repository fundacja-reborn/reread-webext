/**
 * Where imported books live: the books' half of the reading list's database
 * (`library-db.js` opens it and says why everything shares it).
 *
 * Metadata and text are separate stores for the reason articles split theirs:
 * the list must render without a single segment entering memory. Segments are
 * keyed `[bookId, index]`, so one book's text is one contiguous key range -
 * which is what lets a delete take all of it in one pass, and the orphan
 * sweep find strays without reading their content.
 *
 * The order of an import's writes is part of the contract here: segments
 * first, the book row **last**. An import interrupted by a closed tab then
 * leaves segments without a book - invisible to every reader of this module -
 * and `sweepOrphanSegments` removes them the next time the list opens. At no
 * point does a half-imported book exist as a row anybody can open.
 */

import { asBookMeta, asSegment } from "./book.js";
import { promisify, withLibrary } from "./library-db.js";
import { rebuildMarksBackup } from "./marks.js";

/**
 * @typedef {import("./book.js").BookMeta} BookMeta
 */

/**
 * Every key of one book's segments: from `[id, 0]` up to `[id, anything]` -
 * an empty array sorts above every number in IndexedDB's key order, which is
 * the standard way to say "all indexes of this id".
 *
 * @param {string} bookId
 * @returns {IDBKeyRange}
 */
function segmentRange(bookId) {
  return IDBKeyRange.bound([bookId, 0], [bookId, []]);
}

/**
 * Writes one segment as the import produces it. Plain `put` - an import
 * writes each key once, and a re-import is a new book under a new id.
 *
 * @param {{ bookId: string, index: number, blocks: string[], charCount: number }} segment
 * @returns {Promise<void>}
 */
export async function putBookSegment(segment) {
  await withLibrary("readwrite", async (stores) => {
    await promisify(stores.bookSegments.put(segment));
  });
}

/**
 * The last write of an import - the row that makes the book exist.
 *
 * @param {BookMeta} book
 * @returns {Promise<void>}
 */
export async function putBook(book) {
  await withLibrary("readwrite", async (stores) => {
    await promisify(stores.books.put(book));
  });
}

/**
 * @param {string} id
 * @returns {Promise<BookMeta | null>}
 */
export async function getBook(id) {
  const row = await withLibrary("readonly", (stores) => promisify(stores.books.get(id)));
  return asBookMeta(row);
}

/**
 * Every book's light row, unordered - the list merges, orders and filters
 * these together with the articles, where the rule is testable.
 *
 * @returns {Promise<BookMeta[]>}
 */
export async function listBooks() {
  const rows = /** @type {unknown[]} */ (
    await withLibrary("readonly", (stores) => promisify(stores.books.getAll()))
  );
  return rows.map(asBookMeta).filter((book) => book !== null);
}

/**
 * One segment's text, or null when it is not there to render - an index past
 * the end and a torn row read the same.
 *
 * @param {string} bookId
 * @param {number} index
 * @returns {Promise<{ blocks: string[], charCount: number } | null>}
 */
export async function getBookSegment(bookId, index) {
  const row = await withLibrary("readonly", (stores) =>
    promisify(stores.bookSegments.get([bookId, index])),
  );
  return asSegment(row);
}

/**
 * Deletes the book whole: its row, every segment, its reading position and
 * its highlighter marks, in one transaction - the copy is the only copy, and
 * nothing of it may survive as an orphan. Quiet when the book is already
 * gone.
 *
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteBook(id) {
  await withLibrary("readwrite", async (stores) => {
    await promisify(stores.books.delete(id));
    await promisify(stores.bookSegments.delete(segmentRange(id)));
    await promisify(stores.positions.delete(id));
    await promisify(stores.marks.delete(id));
  });
  // The marks left with the book, and the copy that outlives the database
  // follows every write that touches a marks row (`marks-backup.js`).
  await rebuildMarksBackup();
}

/**
 * Marks one book read, or unread again - by hand, from the book's view, the
 * same meaning the articles' toggle has. A no-op when the book is gone.
 *
 * @param {string} id
 * @param {number | null} readAt
 * @returns {Promise<BookMeta | null>} the row as it stands now
 */
export async function setBookReadAt(id, readAt) {
  return await withLibrary("readwrite", async (stores) => {
    const row = asBookMeta(await promisify(stores.books.get(id)));
    if (row === null) return null;
    const updated = { ...row, readAt };
    await promisify(stores.books.put(updated));
    return updated;
  });
}

/**
 * Writes the table of contents a backfill scan produced (D116) - for books
 * imported before the TOC existed, whose rows carry `toc: null`. One
 * readwrite transaction around a fresh read of the row, because the scan
 * took time and the world may have moved: a book deleted meanwhile must not
 * be resurrected by this put, and a scan another tab already landed is the
 * same list - first writer wins, quietly.
 *
 * @param {string} id
 * @param {import("../book/toc.js").TocEntry[]} toc
 * @returns {Promise<boolean>} whether this call's list is the one stored
 */
export async function setBookToc(id, toc) {
  return await withLibrary("readwrite", async (stores) => {
    const row = asBookMeta(await promisify(stores.books.get(id)));
    if (row === null || row.toc !== null) return false;
    await promisify(stores.books.put({ ...row, toc }));
    return true;
  });
}

/**
 * Removes segments whose book never came to exist - the leavings of an
 * import that a closed tab cut short (the book row is written last). Run
 * when the list opens, because this page is the only one holding a key to
 * the database; the keys are read, never the text.
 *
 * @returns {Promise<void>}
 */
export async function sweepOrphanSegments() {
  await withLibrary("readwrite", async (stores) => {
    const bookIds = new Set(
      /** @type {IDBValidKey[]} */ (await promisify(stores.books.getAllKeys())).map(String),
    );
    const segmentKeys = /** @type {Array<[string, number]>} */ (
      await promisify(stores.bookSegments.getAllKeys())
    );
    /** @type {Set<string>} */
    const strays = new Set();
    for (const [bookId] of segmentKeys) {
      if (!bookIds.has(bookId)) strays.add(bookId);
    }
    for (const bookId of strays) {
      await promisify(stores.bookSegments.delete(segmentRange(bookId)));
      await promisify(stores.positions.delete(bookId));
      await promisify(stores.marks.delete(bookId));
    }
  });
}
