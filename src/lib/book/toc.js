/**
 * The table of contents of a document (D116), read off its blocks: the
 * h1-h3 blocks that `segment.js` already treats as chapter breaks are the
 * chapters. Two readers of the same rule, because the blocks come in two
 * shapes: `headingEntries` walks a book segment's *stored* strings (the
 * import pipeline and the backfill of books from before the TOC existed),
 * `renderedEntries` walks what a caller read off *rendered* blocks - an
 * article's map, built fresh from the screen with nothing stored (D117).
 * Pure either way, so the whole of it runs under `node --test`.
 *
 * The string reader's input is exclusively this extension's own rebuilt
 * markup: block strings written by `import-book.js`, each the `outerHTML`
 * of one allowed-list element. That closed format is what licenses parsing
 * by regular expression here. The serializer entity-escapes text (`&` `<`
 * `>` and U+00A0), so raw `<` only ever opens a real tag; the one `>` that
 * can stand anywhere but a tag's edge is inside a quoted attribute value,
 * which the strip pattern reads quotes to step over.
 *
 * A book whose text has no headings has no chapters to list, and since D270
 * nothing else to move about by either - the stretches it is kept in are
 * said nowhere. Its contents are then **places in the book** (D271): one row
 * per stretch, named by the first words that stand there (`placeTitle`) and
 * carrying how far into the book the place is. A place has a chapter row's
 * shape, so everything that reads a table of contents reads this one; it is
 * built in memory by the reader and never stored - an empty `toc` on the
 * book's row keeps meaning "scanned, no headings found".
 */

import { isHeadingTag } from "./segment.js";

/**
 * One chapter row: the words to show, how deep the heading sits, and the
 * place to land - the same `(segment, block)` anchor reading positions and
 * highlighter marks stand on, stable because a book is segmented once and
 * never re-cut.
 *
 * @typedef {{
 *   title: string,
 *   level: 1 | 2 | 3,
 *   segmentIndex: number,
 *   blockIndex: number,
 * }} TocEntry
 */

/**
 * Entries a book may carry. The list rides the book's metadata row, which
 * the reading list loads without touching a single segment - a pathological
 * file of ten thousand headings must not turn that row into a payload. Five
 * hundred chapters are a table of contents; whatever stands past them is
 * not.
 */
export const TOC_ENTRY_CAP = 500;

/** Characters a title may keep - an abused heading is cut, never refused. */
export const TOC_TITLE_CAP = 120;

/**
 * A place's row (D271): a chapter row's shape, plus how far into the book
 * the place stands, in whole percent - the number its row shows on the
 * right, where a chapter's title needs none.
 *
 * @typedef {TocEntry & { percent: number }} PlaceEntry
 */

/**
 * Characters a place's name may keep, the ellipsis included. Half a chapter
 * title's cap on purpose: a heading is a name somebody wrote to be listed,
 * first words are a way to recognize a place, and a list of sixty of them
 * has to stay a list on a phone.
 */
export const PLACE_TITLE_CAP = 64;

/**
 * Characters a place's name wants before it stops collecting. A stretch
 * that opens on a line of dialogue or on a chapter number set as a plain
 * paragraph ("XII") is named by that line and the words after it - the
 * number alone would name sixty places "I" to "LX" at best, and "- Yes."
 * names nothing.
 */
export const PLACE_TITLE_MIN = 24;

/** A block that opens a chapter: the tags the segmenter prefers to cut before. */
const HEADING_BLOCK = /^<h([123])[\s>]/;

/**
 * A whole tag, quotes and all: the plain run stops at any quote, and each
 * quoted attribute value is stepped over in one piece - so a `>` inside
 * `dir="a>b"` does not end the match early.
 */
const TAGS = /<[^>"']*(?:"[^"]*"[^>"']*|'[^']*'[^>"']*)*>/g;

/**
 * A heading's text made into a row's title, or nothing when there is none
 * to show: whitespace collapsed, the cap applied - an abused heading is
 * cut, never refused. The one rule both readers share.
 *
 * @param {string} text
 * @returns {string | null}
 */
export function tocTitle(text) {
  const shown = text.replace(/\s+/g, " ").trim();
  if (shown.length === 0) return null;
  if (shown.length <= TOC_TITLE_CAP) return shown;
  return `${shown.slice(0, TOC_TITLE_CAP - 1).trimEnd()}…`;
}

/**
 * The words of a stored heading block. Inline markup goes the way of the
 * outer tag; the four entities are the only ones the serializer ever writes
 * into text, and `&amp;` is decoded last so an author's literal "&lt;"
 * survives as itself.
 *
 * @param {string} block
 * @returns {string | null}
 */
function titleOf(block) {
  return tocTitle(wordsOf(block));
}

/**
 * The text of a stored block with its markup taken off - see the header
 * for why a regular expression may read this markup at all.
 *
 * @param {string} block
 * @returns {string}
 */
function wordsOf(block) {
  return block
    .replace(TAGS, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/**
 * The chapter rows one segment contributes, in reading order. Only the
 * segment's own top-level blocks are read - a heading buried inside some
 * wrapper the import kept whole is invisible here, exactly as it was to the
 * segmenter's cut.
 *
 * @param {string[]} blocks the segment's stored blocks
 * @param {number} segmentIndex the segment they belong to
 * @returns {TocEntry[]}
 */
export function headingEntries(blocks, segmentIndex) {
  /** @type {TocEntry[]} */
  const entries = [];
  for (const [blockIndex, block] of blocks.entries()) {
    const heading = HEADING_BLOCK.exec(block);
    if (heading === null) continue;
    const title = titleOf(block);
    if (title === null) continue;
    entries.push({
      title,
      level: /** @type {1 | 2 | 3} */ (Number(heading[1])),
      segmentIndex,
      blockIndex,
    });
  }
  return entries;
}

/**
 * The chapter rows of a rendered document (D117) - `headingEntries`' twin
 * for blocks already standing in a DOM, handed over as the two properties
 * the rule reads (so this stays testable without one). The caller walks the
 * rendered top-level blocks; the anchors are their indexes, the same ground
 * the stored reader names.
 *
 * @param {Array<{ localName: string, text: string }>} blocks
 * @param {number} segmentIndex the part they render - an article's zero
 * @returns {TocEntry[]}
 */
export function renderedEntries(blocks, segmentIndex) {
  /** @type {TocEntry[]} */
  const entries = [];
  for (const [blockIndex, block] of blocks.entries()) {
    if (!isHeadingTag(block.localName)) continue;
    const title = tocTitle(block.text);
    if (title === null) continue;
    entries.push({
      title,
      level: /** @type {1 | 2 | 3} */ (Number(block.localName.slice(1))),
      segmentIndex,
      blockIndex,
    });
  }
  return entries;
}

/**
 * A whole book's list, held to the cap. The first chapters stay - a reader
 * lost past the five hundredth heading is not lost for lack of a row here.
 *
 * @param {TocEntry[]} entries
 * @returns {TocEntry[]}
 */
export function cappedToc(entries) {
  return entries.length <= TOC_ENTRY_CAP ? entries : entries.slice(0, TOC_ENTRY_CAP);
}

/**
 * Whether a book is shown places for its contents (D271): a book kept in
 * more than one stretch whose scanned table has fewer than two rows. None
 * is the book without headings; one is, in practice, the title page's own
 * heading over a book whose chapters are set as plain paragraphs - a table
 * of one row leads nowhere, and its reader is as lost as the first one's.
 * A row still owed its scan (`null`) answers false: the scan decides.
 *
 * @param {TocEntry[] | null} toc as the book's row carries it
 * @param {number} segmentCount
 * @returns {boolean}
 */
export function wantsPlaces(toc, segmentCount) {
  return toc !== null && toc.length < 2 && Number.isInteger(segmentCount) && segmentCount > 1;
}

/**
 * A footnote's mark inside a stored block: the anchor the import left with
 * the note's text in `data-note` (`book/notes.js`) and a digit or a symbol
 * for its words - bare, or wrapped in a `sup` of its own. Quotes are stepped
 * over as `TAGS` steps over them (a note may hold a `>`), and the match ends
 * at the first closing tag: anchors do not nest.
 */
const ANCHORS = /<a\s[^>"']*(?:"[^"]*"[^>"']*|'[^']*'[^>"']*)*>[\s\S]*?<\/a>/g;

/** A letter or a digit of any script: what makes a block's text words. */
const WORDS = /[\p{L}\p{N}]/u;

/**
 * What may not stand before the ellipsis of a name that was cut: space,
 * the punctuation a clause ends or a quotation opens with, and the dashes -
 * the en and em dash spelled as codes, since no file of this repository
 * holds a literal em-dash.
 */
const LOOSE_END = new RegExp("[\\s,;:(\\[\\-\\u2013\\u2014\\u00ab\\u201e\\u201c\"']+$", "u");

/**
 * The words of a stored block as a place is named by them: footnote marks
 * taken out whole (their digit would glue itself to the word before it),
 * markup off, whitespace collapsed. Empty for a block that holds no letter
 * and no digit - a picture, a rule, a row of asterisks between two scenes.
 *
 * @param {string} block
 * @returns {string}
 */
function placeWords(block) {
  const text = wordsOf(block.replace(ANCHORS, (anchor) => (/\sdata-note=/.test(anchor) ? "" : anchor)))
    .replace(/\s+/g, " ")
    .trim();
  return WORDS.test(text) ? text : "";
}

/**
 * The first words of a text, held to the cap: whole when they fit, otherwise
 * cut at the last space before the cap and closed with an ellipsis. A text
 * that has no space to cut at in the cap's second half - an unspaced script,
 * one endless token - is cut at the cap itself, never inside a surrogate
 * pair.
 *
 * @param {string} words collapsed and trimmed
 * @returns {string}
 */
function firstWords(words) {
  if (words.length <= PLACE_TITLE_CAP) return words;
  const room = PLACE_TITLE_CAP - 1;
  let cut = words.slice(0, room);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  const space = cut.lastIndexOf(" ");
  if (words[room] !== " " && space >= room / 2) cut = cut.slice(0, space);
  return `${cut.replace(LOOSE_END, "")}…`;
}

/**
 * How one stretch of a book is named in the places list (D271), and where
 * its row lands: the first words standing in it, and the block they begin
 * in - the landing shows the very words the row promised, which a leading
 * picture's block would not. Words are collected across blocks until there
 * are enough to recognize a place by (`PLACE_TITLE_MIN`). Null for a stretch
 * without words - pictures only - which gets no row.
 *
 * @param {string[]} blocks the segment's stored blocks
 * @returns {{ title: string, blockIndex: number } | null}
 */
export function placeTitle(blocks) {
  let words = "";
  let blockIndex = -1;
  for (const [index, block] of blocks.entries()) {
    const text = placeWords(block);
    if (text.length === 0) continue;
    if (blockIndex === -1) blockIndex = index;
    words = words.length === 0 ? text : `${words} ${text}`;
    if (words.length >= PLACE_TITLE_MIN) break;
  }
  return blockIndex === -1 ? null : { title: firstWords(words), blockIndex };
}

/**
 * How far into the book a stretch begins, in whole percent - the arithmetic
 * of `overallPercent` (`lib/reader/position.js`) for a reading that stands
 * at the stretch's first line, so the number on a place's row and the one
 * the reading list shows after landing there are one number.
 *
 * @param {number} segmentIndex
 * @param {number} segmentCount
 * @returns {number} 0-100
 */
export function placePercent(segmentIndex, segmentCount) {
  if (!Number.isFinite(segmentIndex) || !Number.isFinite(segmentCount) || segmentCount <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((segmentIndex / segmentCount) * 100)));
}

/**
 * One stretch's row in the places list, or null when it holds no words.
 * Flat on purpose (`level: 1`): places are not a hierarchy.
 *
 * @param {string[]} blocks the segment's stored blocks
 * @param {number} segmentIndex
 * @param {number} segmentCount
 * @returns {PlaceEntry | null}
 */
export function placeEntry(blocks, segmentIndex, segmentCount) {
  const named = placeTitle(blocks);
  if (named === null) return null;
  return {
    title: named.title,
    level: 1,
    segmentIndex,
    blockIndex: named.blockIndex,
    percent: placePercent(segmentIndex, segmentCount),
  };
}

/**
 * Whether a row is a place rather than a chapter. The two travel in one
 * list through everything that reads a table of contents; the two readers
 * that must tell them apart - the dialog, which shows a place's percent,
 * and the search, whose headings are chapters only - ask here.
 *
 * @param {TocEntry} entry
 * @returns {entry is PlaceEntry}
 */
export function isPlace(entry) {
  return "percent" in entry && typeof entry.percent === "number";
}
