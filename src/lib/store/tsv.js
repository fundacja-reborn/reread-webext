/**
 * The TSV the vocabulary travels in - out to Anki and the KOReader plugin,
 * and back in from either.
 *
 * The format is the sister plugin's (`offlinetranslate.koplugin`, verified
 * against its `export.lua`), and every rule of it is a refusal to be clever:
 *
 *   - two columns, phrase TAB meaning, because Anki maps columns onto note
 *     fields and a third column would fill the wrong side of somebody's card,
 *   - no header row - it would import as a note of its own,
 *   - no escaping. A tab would open a column and a newline a row, so neither
 *     survives in a field, and runs of whitespace collapse to one space.
 *     That is the entire mechanism,
 *   - every row ends with a newline, the last one included - an unterminated
 *     final line is the kind of thing one importer forgives and the next
 *     drops,
 *   - the language pair lives in the file name, not in the file.
 *
 * One extension of our own: a phrase here keeps a list of meanings, and the
 * file has one cell. The cell holds the list joined with `"; "`, and reading
 * splits on exactly that - the two are inverses cell-wise, so a file survives
 * an export-import roundtrip byte for byte. A meaning that itself contains
 * `"; "` comes back as two meanings, which reads the same everywhere the list
 * is shown, and joins back into the same cell.
 *
 * Everything in this module is a value in and a value out; the database and
 * the message wire live elsewhere.
 */

import { collapseWhitespace } from "../normalize.js";

/** @typedef {import("./phrase.js").Phrase} Phrase */

/**
 * @typedef {object} TsvRow
 * @property {string} text the phrase, as the file spells it
 * @property {string[]} translations at least one, in the cell's order
 */

/**
 * @typedef {object} TsvFile
 * @property {TsvRow[]} rows every line that was a row of this format
 * @property {number} invalid lines that were not, counted rather than kept
 */

/** What stands between the two columns, and the reason this is a TSV. */
const SEPARATOR = "\t";

/**
 * What stands between two meanings sharing a cell. Split and join use the
 * exact same string, or the roundtrip promise above breaks.
 */
const JOINER = "; ";

/**
 * One field of one row, with everything that would break the file taken out -
 * the same rule the sister plugin applies, by way of the same collapse the
 * store already runs on everything it keeps. Stored phrases arrive here clean;
 * cleaning again is what makes that a fact about this file rather than a hope
 * about the caller.
 *
 * @param {string} text
 * @returns {string}
 */
function field(text) {
  return collapseWhitespace(text);
}

/**
 * The whole file, as one string. Rows are written in the order given - the
 * store answers oldest first, which is what keeps two exports diffable.
 *
 * @param {Phrase[]} phrases
 * @returns {string}
 */
export function toTsv(phrases) {
  const lines = phrases.map(
    (phrase) => field(phrase.phrase) + SEPARATOR + field(phrase.translations.join(JOINER)),
  );
  return lines.length === 0 ? "" : lines.join("\n") + "\n";
}

/**
 * Reads what `toTsv` writes, and what the sister plugin writes, and what a
 * spreadsheet saved - which is why line endings may be CRLF and blank lines
 * are nobody's fault. A line that is not a row of this format - no tab, a
 * third column, an empty cell - is counted and dropped: one broken line must
 * not cost the file, and a count the reader can see beats a silent shrug.
 *
 * @param {string} text
 * @returns {TsvFile}
 */
export function fromTsv(text) {
  /** @type {TsvRow[]} */
  const rows = [];
  let invalid = 0;

  for (const line of text.split("\n")) {
    const one = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (one.trim().length === 0) continue;

    const cells = one.split(SEPARATOR);
    if (cells.length !== 2) {
      invalid += 1;
      continue;
    }

    const phrase = field(String(cells[0]));
    const meanings = String(cells[1])
      .split(JOINER)
      .map(field)
      .filter((meaning) => meaning.length > 0);
    if (phrase.length === 0 || meanings.length === 0) {
      invalid += 1;
      continue;
    }

    rows.push({ text: phrase, translations: meanings });
  }

  return { rows, invalid };
}

/**
 * Language codes end up in a file name, and the settings they come from can be
 * edited by hand. Anything that is not a letter, a digit, a dash or an
 * underscore is replaced - the sister plugin's rule, so a code holding a slash
 * names no path on either side.
 *
 * @param {string} code
 * @returns {string}
 */
function safeCode(code) {
  return code.replace(/[^A-Za-z0-9_-]/g, "_");
}

/**
 * What the exported file is called. The suffix `-<from>-<to>.tsv` is the
 * convention that carries the pair (the sister plugin writes the same one
 * behind its own prefix); the prefix names the program that wrote the file.
 *
 * @param {{ langFrom: string, langTo: string }} pair
 * @returns {string}
 */
export function exportFilename({ langFrom, langTo }) {
  return `reread-${safeCode(langFrom)}-${safeCode(langTo)}.tsv`;
}

/**
 * The pair a file name carries, when it carries one - `*-en-pl.tsv` however
 * prefixed, ours and the sister plugin's alike, with the `(1)` a browser
 * hangs on a second download tolerated. Codes are the registry's shapes: two
 * or three letters, with an underscored script tag when there is one
 * (`zh_hant`). This is a starting point for a visible choice, never a
 * decision - which is why an unparseable name is `null` and not a guess.
 *
 * @param {string} name
 * @returns {{ langFrom: string, langTo: string } | null}
 */
export function pairFromFilename(name) {
  const code = "[a-z]{2,3}(?:_[a-z]{4})?";
  const match = new RegExp(`(?:^|-)(${code})-(${code}) ?(?:\\(\\d+\\))?\\.tsv$`).exec(
    name.toLowerCase(),
  );
  if (match === null) return null;
  return { langFrom: String(match[1]), langTo: String(match[2]) };
}
