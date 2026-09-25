/**
 * Where highlighter marks live: one row per document in the reading list's
 * database, holding every mark the document has. One row rather than one per
 * mark for the reason the position is one row: the marks of a document are
 * read together, written together, and leave together with it - and a list
 * of a few dozen small records rewritten whole costs nothing next to the
 * article standing beside it.
 *
 * The same row carries the reader's note on the whole document (D282), the
 * optional `note` - the reader's own words about the document the way a
 * mark's note is their words about a quote. It rides the marks row rather
 * than the document's own row because it is the same kind of thing the
 * marks are: the reader's work, which the copy in `storage.local` keeps
 * when the browser empties the database (`marks-backup.js`), which the
 * highlights' file carries out and back (`marks-copy.js`), and which a
 * fresh save of the same address must not throw away with the text
 * (`articles.js`). A row stands while the document has a mark or a note,
 * and leaves when it has neither: "nothing" keeps one shape, and only the
 * one that costs no row.
 *
 * Keyed by `docId` exactly as positions are - an article's `url`, a book's
 * own id - so the rows of one document can be deleted by one name in one
 * transaction (`articles.js`, `books.js` do that; this module never has to).
 *
 * Only the reader page opens this, like everything else in the database.
 */

import { asMark, asNote, compareMarks } from "../reader/marks.js";
import { asBookMeta } from "./book.js";
import { promisify, withLibrary } from "./library-db.js";
import {
  rebuildMarksBackup as rebuildWith,
  restoreMarks as restoreWith,
  storageDeps,
} from "./marks-backup.js";
import { asSavedMeta } from "./saved-article.js";

/** @typedef {import("../reader/marks.js").Mark} Mark */
/** @typedef {import("./marks-backup.js").DocTitle} DocTitle */

/**
 * One row as it is written: the document's marks in reading order, and its
 * note where it has one - the field absent otherwise, the mark's own rule.
 *
 * @typedef {{ docId: string, marks: Mark[], note?: string }} MarksRow
 */

/**
 * A row as it came back from the database, narrowed field by field, or
 * null for a row that holds nothing readable - no mark that narrows and no
 * note. A mark that does not narrow drops alone, the lean of `asMark`; the
 * note narrows through the mark's own door (`asNote`), so a hand-edited row
 * reads by the rule the editor writes by.
 *
 * @param {unknown} value
 * @returns {MarksRow | null}
 */
function asRow(value) {
  if (typeof value !== "object" || value === null) return null;
  const { docId, marks, note } = /** @type {Record<string, unknown>} */ (value);
  if (typeof docId !== "string" || docId.length === 0) return null;
  const kept = (Array.isArray(marks) ? marks : [])
    .map(asMark)
    .filter((mark) => mark !== null)
    .sort(compareMarks);
  const words = asNote(note);
  if (kept.length === 0 && words === undefined) return null;
  return { docId, marks: kept, ...(words === undefined ? {} : { note: words }) };
}

/**
 * The note a stored row carries, or nothing - for the writes in
 * `articles.js` that replace a document's text and must carry its note
 * across (D282) without knowing the row's shape.
 *
 * @param {unknown} row whatever `stores.marks.get` answered
 * @returns {string | undefined}
 */
export function noteOfRow(row) {
  return asRow(row)?.note;
}

/**
 * The row written as the two fields stand - or taken out, when the
 * document has neither a mark nor a note: a row saying "nothing" and no
 * row must mean the same thing, and only one of them costs nothing.
 *
 * @param {import("./library-db.js").LibraryStores} stores
 * @param {string} docId
 * @param {Mark[]} marks
 * @param {string | undefined} note
 */
async function writeRow(stores, docId, marks, note) {
  if (marks.length === 0 && note === undefined) await promisify(stores.marks.delete(docId));
  else await promisify(stores.marks.put({ docId, marks, ...(note === undefined ? {} : { note }) }));
}

/**
 * Every mark of one document, in reading order, however the row was written
 * or hand-edited. No row at all - or a row holding the document's note and
 * no mark - is simply a document nobody marked.
 *
 * @param {string} docId
 * @returns {Promise<Mark[]>}
 */
export async function getMarks(docId) {
  const row = await withLibrary("readonly", (stores) => promisify(stores.marks.get(docId)));
  return asRow(row)?.marks ?? [];
}

/**
 * The reader's note on one document (D282), or nothing.
 *
 * @param {string} docId
 * @returns {Promise<string | undefined>}
 */
export async function getDocNote(docId) {
  const row = await withLibrary("readonly", (stores) => promisify(stores.marks.get(docId)));
  return noteOfRow(row);
}

/**
 * The document's marks, replaced whole - the latest word, like a position.
 * The document's note stands as it stood: a mark drawn, recoloured or taken
 * out says nothing about the words on the whole document, so the write
 * reads them off the row and puts them back. An empty list with no note
 * deletes the row rather than storing it.
 *
 * @param {string} docId
 * @param {Mark[]} marks
 * @returns {Promise<void>}
 */
export async function putMarks(docId, marks) {
  // Settled first, the copy's rule: a library the browser emptied gets its
  // marks back before this write, so the copy rebuilt below is never built
  // from this one row alone.
  await restoreMarks();
  await withLibrary("readwrite", async (stores) => {
    const note = noteOfRow(await promisify(stores.marks.get(docId)));
    await writeRow(stores, docId, marks, note);
  });
  await rebuildMarksBackup();
}

/**
 * The document's note, replaced whole (D282) - the marks standing as they
 * stood, the mirror of `putMarks`. Whatever the text holds narrows through
 * `asNote`: an emptied box saved is the note removed, and a document left
 * with no note and no mark loses its row.
 *
 * @param {string} docId
 * @param {string} text the note as the box holds it
 * @returns {Promise<void>}
 */
export async function putDocNote(docId, text) {
  await restoreMarks();
  await withLibrary("readwrite", async (stores) => {
    const marks = asRow(await promisify(stores.marks.get(docId)))?.marks ?? [];
    await writeRow(stores, docId, marks, asNote(text));
  });
  await rebuildMarksBackup();
}

/**
 * Several documents' rows replaced whole in one transaction - `putMarks`
 * for a list, the highlights import's write (D168): the copy's rule settled
 * once before, the copy rebuilt once after, and no document written while
 * another is not. A row that names a note writes it; one that names none
 * keeps the note standing under its key, as `putMarks` does.
 *
 * @param {{ docId: string, marks: Mark[], note?: string }[]} rows
 * @returns {Promise<void>}
 */
export async function putMarksRows(rows) {
  await restoreMarks();
  await withLibrary("readwrite", async (stores) => {
    for (const { docId, marks, note } of rows) {
      const kept = note === undefined ? noteOfRow(await promisify(stores.marks.get(docId))) : asNote(note);
      await writeRow(stores, docId, marks, kept);
    }
  });
  await rebuildMarksBackup();
}

/**
 * Every row at once, in two maps: each document's marks, and each
 * document's note where it has one - for the exports, the highlights page
 * and the import's plan. The article file carries each article's marks
 * beside it, the highlights file is nothing but these maps dressed in
 * titles. One `getAll` for the same reason the list reads positions in
 * bulk. Rows narrow like `getMarks` narrows, and a document stands in a
 * map only with something in it: no empty lists, no empty notes.
 *
 * @returns {Promise<{ marks: Map<string, Mark[]>, notes: Map<string, string> }>} both keyed by `docId`
 */
export async function allMarksRows() {
  const rows = /** @type {unknown[]} */ (
    await withLibrary("readonly", (stores) => promisify(stores.marks.getAll()))
  );
  return narrowRows(rows);
}

/**
 * Every document's marks, for the callers that ask about nothing else.
 *
 * @returns {Promise<Map<string, Mark[]>>} keyed by `docId`
 */
export async function allMarks() {
  return (await allMarksRows()).marks;
}

/**
 * @param {unknown[]} rows
 * @returns {{ marks: Map<string, Mark[]>, notes: Map<string, string> }} both keyed by `docId`
 */
function narrowRows(rows) {
  /** @type {Map<string, Mark[]>} */
  const marks = new Map();
  /** @type {Map<string, string>} */
  const notes = new Map();
  for (const value of rows) {
    const row = asRow(value);
    if (row === null) continue;
    if (row.marks.length > 0) marks.set(row.docId, row.marks);
    if (row.note !== undefined) notes.set(row.docId, row.note);
  }
  return { marks, notes };
}

/**
 * The titles the library can still put to a marks row - every article's and
 * every book's - as the copy remembers them beside the row.
 *
 * @param {unknown[]} metas
 * @param {unknown[]} books
 * @returns {Map<string, DocTitle>}
 */
function titlesOf(metas, books) {
  /** @type {Map<string, DocTitle>} */
  const titles = new Map();
  for (const row of metas) {
    const meta = asSavedMeta(row);
    if (meta !== null) titles.set(meta.url, { kind: "article", title: meta.title });
  }
  for (const row of books) {
    const book = asBookMeta(row);
    if (book !== null) titles.set(book.id, { kind: "book", title: book.title });
  }
  return titles;
}

/**
 * The copy's view of this database (`marks-backup.js` holds the rules; this
 * is the IndexedDB half of them): the snapshot the copy is rebuilt from, the
 * emptiness the restore asks about, and the rows written back - into an
 * empty library only, checked again inside the transaction that writes them,
 * because the count outside it is a gate, not a lock.
 *
 * @returns {import("./marks-backup.js").MarksBackupDeps}
 */
function backupDeps() {
  /** @param {import("./library-db.js").LibraryStores} stores */
  const isEmpty = async (stores) => {
    const [metas, books, marks] = await Promise.all([
      promisify(stores.meta.count()),
      promisify(stores.books.count()),
      promisify(stores.marks.count()),
    ]);
    return metas === 0 && books === 0 && marks === 0;
  };
  return {
    ...storageDeps(),
    snapshot: async () => {
      const { rows, metas, books } = await withLibrary("readonly", async (stores) => ({
        rows: /** @type {unknown[]} */ (await promisify(stores.marks.getAll())),
        metas: /** @type {unknown[]} */ (await promisify(stores.meta.getAll())),
        books: /** @type {unknown[]} */ (await promisify(stores.books.getAll())),
      }));
      const { marks, notes } = narrowRows(rows);
      return { marks, notes, titles: titlesOf(metas, books) };
    },
    empty: () => withLibrary("readonly", isEmpty),
    putRows: async (docs) => {
      await withLibrary("readwrite", async (stores) => {
        if (!(await isEmpty(stores))) return;
        for (const doc of docs) await writeRow(stores, doc.docId, doc.marks, doc.note);
      });
    },
  };
}

/**
 * Whatever the browser deleted, back from the copy - the library empty and
 * the copy not being the one shape that means. Asked by every write to the
 * marks and by the pages before they read, and quiet on every failure: the
 * copy is insurance, and a write must not fail because its insurance did.
 *
 * @returns {Promise<number>} how many documents' marks came back
 */
export async function restoreMarks() {
  try {
    return await restoreWith(backupDeps());
  } catch {
    return 0;
  }
}

/**
 * The copy rebuilt from the whole store, after every write that touched a
 * marks row - here, in `articles.js` and in `books.js`. Quiet on failure
 * for the same reason `restoreMarks` is; the next write rebuilds it again.
 *
 * @returns {Promise<boolean>} whether the copy was written
 */
export async function rebuildMarksBackup() {
  try {
    await rebuildWith(backupDeps());
    return true;
  } catch {
    return false;
  }
}
