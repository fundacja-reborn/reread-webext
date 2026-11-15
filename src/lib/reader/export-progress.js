/**
 * How far an export has come, as the page can say it: the work a file
 * means, counted before the first entry is written. The meter that turns
 * the count into a bar and a line is the import's own
 * (`import-progress.js`).
 *
 * The backup of a large library takes a minute or more on a slow device,
 * and until 2026-11-15 a press on Export changed nothing on the page until
 * the file was done - the button stayed as it was, took a second press and
 * started a second file (Michał's report from a Boox Page, after the same
 * was mended for the import). The rules live here, away from the page, so
 * `node --test` can hold them down.
 */

import { progressMeter } from "./import-progress.js";

/**
 * How many phrases weigh what one article does - the import's own weight.
 * The vocabulary is one entry of the archive, so the bar cannot move inside
 * it; the weight only decides how far the bar stands when it is written.
 */
const PHRASES_PER_UNIT = 20;

/**
 * @typedef {{
 *   phrases: number,
 *   pictures: number,
 *   articles: number,
 *   books: { parts: number, pictures: number }[],
 * }} ExportWork what the export will write: the phrases of the vocabulary's
 *   entry (none in a selection, which leaves that entry out), the pictures
 *   the articles' rows promise when the box asks for them, the articles of
 *   `articles.json`, and each book with its parts and its pictures
 */

/**
 * @typedef {{
 *   phrases: number,
 *   pictures: number,
 *   articles: number,
 *   books: number,
 *   total: number,
 * }} ExportUnits the same work in the bar's units, stage by stage
 */

/**
 * One book in the bar's units: its text, which is read whole and written
 * as one entry, weighs its parts; every picture is a step.
 *
 * @param {{ parts: number, pictures: number }} book
 * @returns {number}
 */
export function bookExportUnits(book) {
  return book.parts + book.pictures;
}

/**
 * The work in the bar's units. The articles are one entry of the archive,
 * as the vocabulary is, and weigh one unit each - the bar takes their share
 * when the entry is written.
 *
 * @param {ExportWork} work
 * @returns {ExportUnits}
 */
export function exportUnits(work) {
  const phrases = Math.ceil(work.phrases / PHRASES_PER_UNIT);
  const pictures = work.pictures;
  const articles = work.articles;
  const books = work.books.reduce((sum, book) => sum + bookExportUnits(book), 0);
  return { phrases, pictures, articles, books, total: phrases + pictures + articles + books };
}

/**
 * How many pictures the rows promise - the pictures' stage counted before
 * one is read. By the light rows' account, as the manifest's claim is: a
 * picture the database has lost is stepped over when its article's turn
 * comes, so the line still ends on this total.
 *
 * @param {{ pictures?: { count: number } }[]} rows articles or books
 * @returns {number}
 */
export function promisedPictures(rows) {
  return rows.reduce((sum, row) => sum + (row.pictures?.count ?? 0), 0);
}

/**
 * The units of one document written as a file of its own: a step per part
 * rebuilt, and for a book file as many again for the packing - the archive
 * deflates every part once more, and on a slow device that is the longer
 * half. A plain-text page is done when its parts are.
 *
 * @param {number} parts
 * @param {"epub" | "markdown"} format
 * @returns {{ rebuild: number, pack: number, total: number }}
 */
export function documentUnits(parts, format) {
  const rebuild = Math.max(1, Math.floor(parts));
  const pack = format === "epub" ? rebuild : 0;
  return { rebuild, pack, total: rebuild + pack };
}

/**
 * @typedef {{
 *   rebuilt: () => void,
 *   packed: (done: number, total: number) => boolean,
 * }} DocumentProgress
 */

/**
 * One document's progress as its two halves step it: `rebuilt` once per
 * part, then `packed` once per entry the archive has taken - which of
 * how many. `onProgress` hears a fraction when a half begins and then
 * once per whole percent, the meter's own economy.
 *
 * `packed` answers whether the bar moved since it was last asked: the
 * writer gives the page a turn of the event loop only then. A breath per
 * entry would cost a book of five hundred pictures two seconds of waiting
 * on timers; a breath per percent is at most a hundred.
 *
 * The last entry gives the bar whatever is left of the packing's share, so
 * the bar ends on the whole however the shares of the entries before it
 * rounded.
 *
 * @param {number} parts
 * @param {"epub" | "markdown"} format
 * @param {((fraction: number) => void) | undefined} onProgress
 * @returns {DocumentProgress}
 */
export function documentProgress(parts, format, onProgress) {
  const units = documentUnits(parts, format);
  let moved = false;
  const meter = progressMeter(units.total, (fraction) => {
    moved = true;
    onProgress?.(fraction);
  });
  const noLine = () => "";
  meter.stage(noLine, units.rebuild);
  let packing = false;
  return {
    rebuilt() {
      meter.step();
    },
    packed(done, total) {
      if (!packing) {
        packing = true;
        meter.stage(noLine, units.pack);
      }
      meter.step(done >= total ? units.pack : units.pack / total);
      const was = moved;
      moved = false;
      return was;
    },
  };
}
