/**
 * The table of contents a book file carries itself, and where its rows land
 * in the book as this extension keeps it (D277).
 *
 * An EPUB names its chapters twice over: EPUB 3 in a navigation document
 * (`nav.xhtml` - a nested list of links inside `nav epub:type="toc"`),
 * EPUB 2 in the NCX (`toc.ncx` - nested `navPoint`s, each a label and a
 * `content src`). Either is the list every e-reader shows, and it names the
 * chapters of a book whose own text does not: a chapter title set as a
 * plain paragraph is no heading, so the table read off h1-h3 (`toc.js`,
 * D116) is empty for such a book and its reader is shown places named by
 * their first words (D271). The file knew the names all along.
 *
 * A row of the file points at `chapter.xhtml#fragment`; a row of ours
 * stands on `(segment, block)`. The road between the two runs through the
 * import, and only there - the file is not kept:
 *
 *   1. the rows are read and their addresses resolved to archive paths
 *      (`navDocumentRows`, `ncxRows`, `rowTargets`);
 *   2. while a chapter is rebuilt, the rebuild tells what it made of every
 *      source element (`RebuildOptions.trace`), and a row whose target was
 *      met is marked on the first element built at or after it
 *      (`rowTracer`) - nothing is added to the sanitizer's allowed list and
 *      nothing rides in the markup;
 *   3. the marks are read off the packable blocks (`markedBlocks`,
 *      `blocks.js`), a row whose block the import drops waits for the next
 *      block kept (`rowCarrier`), and the block carries its rows through
 *      the packer;
 *   4. the writer, which alone knows where a block ended up once the
 *      packer's cuts and merges are spoken for, notes each row's place
 *      (`book-parts.js`), and `landedToc` turns rows and places into the
 *      `TocEntry` list the book's row has always carried.
 *
 * So the shape of `toc` does not change, a book imported before this keeps
 * the table it has, and everything that reads a table of contents - the
 * dialog, the row being read, the search's groups, the export - reads this
 * one unchanged. Pure throughout: the XML is walked through the four
 * properties `opf.js` walks it by, so the whole of it runs under
 * `node --test`.
 */

import { opfDirectory, resolveZipPath } from "./opf.js";
import { cappedToc, tocTitle } from "./toc.js";

/** @typedef {import("./opf.js").XmlEl} XmlEl */
/** @typedef {import("./toc.js").TocEntry} TocEntry */

/**
 * One row of the file's contents: its words, how deep it sits in the list
 * (1 is the outermost), and the address it points at, as the file wrote it.
 *
 * @typedef {{ title: string, level: number, href: string }} NavRow
 */

/** A row as first read: its words as found, and no address when it is words alone. */
/** @typedef {{ title: string, level: number, href: string | null }} RawRow */

/**
 * Rows read from one file before reading stops. The table kept is capped at
 * `TOC_ENTRY_CAP`; the reading allows for more, because rows that land
 * nowhere - a link to a file outside the spine - fall out before the cap.
 */
const ROWS_READ_CAP = 2000;

/**
 * How deep either walk follows a nesting. A table of contents is three or
 * four levels at its deepest; a file nested past this is not describing a
 * book, and the walk is recursive.
 */
const DEPTH_LIMIT = 32;

/** An address that names its scheme - a row pointing out of the file. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

const LISTS = new Set(["ol", "ul"]);
const LINK = new Set(["a"]);
const WORDS = new Set(["span"]);
const NAV = new Set(["nav"]);
const NAV_MAP = new Set(["navmap"]);
const NAV_POINT = new Set(["navpoint"]);
const NAV_LABEL = new Set(["navlabel"]);
const CONTENT = new Set(["content"]);
/** @type {Set<string>} */
const NOTHING = new Set();

/**
 * An element's name in lower case. The files are XML and spell `navPoint`
 * with its capital; the same file read by an HTML parser - the import's
 * second try at a file the XML parser refused - spells it without.
 *
 * @param {XmlEl} el
 * @returns {string}
 */
function nameOf(el) {
  return el.localName.toLowerCase();
}

/**
 * The elements of those names nearest under `root`, in document order:
 * found depth-first, never looked for inside one another, and never inside
 * an element the caller fences off. "Nearest" rather than "children",
 * because both formats let packaging stand in between - a `div` around a
 * list, a `p` around a link - and because an HTML parser nests an NCX's
 * child points inside their parent's `content` (it knows no such void
 * element), where a walk by children would lose them.
 *
 * @param {XmlEl} root
 * @param {Set<string>} names
 * @param {Set<string>} fences elements not looked into
 * @returns {XmlEl[]}
 */
function nearest(root, names, fences) {
  /** @type {XmlEl[]} */
  const found = [];
  /**
   * @param {XmlEl} el
   * @param {number} depth
   */
  const walk = (el, depth) => {
    for (const child of el.children) {
      const name = nameOf(child);
      if (names.has(name)) found.push(child);
      else if (!fences.has(name) && depth < DEPTH_LIMIT) walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return found;
}

/**
 * Rows as read made into rows worth keeping: the words through the rule
 * every title of a table goes through (`tocTitle`), and an address for each.
 * A row that is words alone - "Part One" standing over its chapters, which
 * EPUB 3 allows as a `span` - takes the address of the first row under it:
 * a part begins where its first chapter does. One with nothing under it
 * leads nowhere and goes.
 *
 * @param {RawRow[]} rows
 * @returns {NavRow[]}
 */
function settled(rows) {
  /** @type {NavRow[]} */
  const kept = [];
  for (const [index, row] of rows.entries()) {
    const title = tocTitle(row.title);
    if (title === null) continue;
    let href = row.href;
    for (let under = index + 1; href === null && under < rows.length; under += 1) {
      const next = /** @type {RawRow} */ (rows[under]);
      if (next.level <= row.level) break;
      href = next.href;
    }
    if (href === null) continue;
    kept.push({ title, level: row.level, href });
  }
  return kept;
}

/**
 * @param {string | null} value an address as the file wrote it
 * @returns {string | null} the same, or nothing for one that says nothing
 */
function written(value) {
  if (typeof value !== "string") return null;
  const href = value.trim();
  return href.length > 0 ? href : null;
}

/**
 * What an element says it is: the tokens of `epub:type`, and the one ARIA
 * role that says "table of contents" written as the token it means.
 *
 * @param {XmlEl} el
 * @returns {string[]}
 */
function typesOf(el) {
  const types = (el.getAttribute("epub:type") ?? "").split(/\s+/).filter((type) => type.length > 0);
  if (el.getAttribute("role") === "doc-toc") types.push("toc");
  return types;
}

/**
 * The rows of an EPUB 3 navigation document. The document holds several
 * lists - the contents, the landmarks, the page list - and the contents are
 * the `nav` that says `toc`; a file that types none of its `nav`s (or types
 * them under a prefix of its own, which this namespace-blind walk does not
 * read) is taken at its first untyped one, where the contents stand in
 * practice.
 *
 * @param {XmlEl} root the document's root element
 * @returns {NavRow[]}
 */
export function navDocumentRows(root) {
  const navs = nearest(root, NAV, NOTHING);
  const contents =
    navs.find((nav) => typesOf(nav).includes("toc")) ?? navs.find((nav) => typesOf(nav).length === 0);
  if (contents === undefined) return [];
  /** @type {RawRow[]} */
  const rows = [];
  for (const list of nearest(contents, LISTS, NOTHING)) readItems(list, 1, rows);
  return settled(rows);
}

/**
 * @param {XmlEl} list an `ol` (or the `ul` a careless file wrote)
 * @param {number} level
 * @param {RawRow[]} rows
 */
function readItems(list, level, rows) {
  for (const item of list.children) {
    if (nameOf(item) !== "li") continue;
    if (rows.length >= ROWS_READ_CAP) return;
    // The item's own link and words - never those of a list nested in it.
    const link = nearest(item, LINK, LISTS)[0];
    const words = link ?? nearest(item, WORDS, LISTS)[0];
    rows.push({
      title: words?.textContent ?? "",
      level,
      href: link === undefined ? null : written(link.getAttribute("href")),
    });
    if (level >= DEPTH_LIMIT) continue;
    for (const nested of nearest(item, LISTS, NOTHING)) readItems(nested, level + 1, rows);
  }
}

/**
 * The rows of an EPUB 2 NCX: the `navMap`'s points, nested as the file
 * nests them. The NCX's other lists - `pageList`, `navList` - are not
 * contents and are not read.
 *
 * @param {XmlEl} root the document's root element
 * @returns {NavRow[]}
 */
export function ncxRows(root) {
  /** @type {RawRow[]} */
  const rows = [];
  for (const map of nearest(root, NAV_MAP, NOTHING)) readPoints(map, 1, rows);
  return settled(rows);
}

/**
 * @param {XmlEl} parent the `navMap`, or a point with points of its own
 * @param {number} level
 * @param {RawRow[]} rows
 */
function readPoints(parent, level, rows) {
  for (const point of nearest(parent, NAV_POINT, NOTHING)) {
    if (rows.length >= ROWS_READ_CAP) return;
    // The point's own label and address - never those of a point inside it.
    const label = nearest(point, NAV_LABEL, NAV_POINT)[0];
    const content = nearest(point, CONTENT, NAV_POINT)[0];
    rows.push({
      title: label?.textContent ?? "",
      level,
      href: content === undefined ? null : written(content.getAttribute("src")),
    });
    if (level < DEPTH_LIMIT) readPoints(point, level + 1, rows);
  }
}

/**
 * Which of the file's two lists is the book's contents. The navigation
 * document is the one the third edition calls the table of contents, and
 * its NCX is there for older readers, so the navigation document is read -
 * unless it names fewer than two rows, which is no table, and the NCX
 * names more.
 *
 * @param {NavRow[]} fromNav
 * @param {NavRow[]} fromNcx
 * @returns {NavRow[]}
 */
export function preferredRows(fromNav, fromNcx) {
  return fromNav.length >= 2 || fromNav.length >= fromNcx.length ? fromNav : fromNcx;
}

/**
 * Where one row points: which row it is, and the fragment of its address -
 * null for a row that points at a whole file, which begins where the file
 * does.
 *
 * @typedef {{ row: number, fragment: string | null }} RowTarget
 */

/**
 * The rows' addresses as the import will meet them: by the archive path of
 * the file each points into, in the rows' own order. An address is written
 * against the file that holds the list, not against the package. A row
 * pointing out of the archive - a scheme, a path climbing above the root -
 * points nowhere this import goes, and is left out; so, later, is a row
 * pointing at a file the spine does not read.
 *
 * @param {NavRow[]} rows
 * @param {string} listPath the archive path of the file the rows were read from
 * @returns {Map<string, RowTarget[]>}
 */
export function rowTargets(rows, listPath) {
  const directory = opfDirectory(listPath);
  /** @type {Map<string, RowTarget[]>} */
  const targets = new Map();
  for (const [row, { href }] of rows.entries()) {
    if (SCHEME.test(href)) continue;
    const hash = href.indexOf("#");
    const file = hash === -1 ? href : href.slice(0, hash);
    // A bare "#fragment" points into the list's own file.
    const path = (file.split("?")[0] ?? "").length === 0 ? listPath : resolveZipPath(directory, file);
    if (path === null) continue;
    const fragment = hash === -1 ? null : decodedFragment(href.slice(hash + 1));
    const held = targets.get(path);
    if (held === undefined) targets.set(path, [{ row, fragment }]);
    else held.push({ row, fragment });
  }
  return targets;
}

/**
 * A fragment as the id it names: percent-escapes decoded, the way a
 * browser following the link would. An empty one names nothing.
 *
 * @param {string} fragment what stood after the `#`
 * @returns {string | null}
 */
function decodedFragment(fragment) {
  if (fragment.length === 0) return null;
  try {
    return decodeURIComponent(fragment);
  } catch {
    // A percent sign that is no escape: the id may be spelled that way.
    return fragment;
  }
}

/**
 * The rows of one chapter followed through its rebuild. `buildArticle`
 * tells `trace` of every source element as it meets it, with the element it
 * built for it or null (`RebuildOptions.trace`); a row whose target is met
 * waits for the first element built from then on - the target's own where
 * the sanitizer keeps it, otherwise whatever text comes next - and is
 * marked on it. Document order on both sides is what makes "next" mean
 * "where the reader would be sent".
 *
 * Generic on purpose: the two element types are opaque here, keys of two
 * maps and nothing more.
 *
 * @template S, R
 * @param {Map<S, number[]>} wanted the rows each source element is the target of
 * @returns {{
 *   trace: (source: S, rebuilt: R | null) => void,
 *   marks: Map<R, number[]>,
 *   trailing: () => number[],
 *   unmet: () => number[],
 * }} `marks`: rebuilt elements and the rows marked on them, in document
 *   order. `trailing`: rows whose target was met after the last element the
 *   rebuild made - they belong to whatever text follows the chapter.
 *   `unmet`: rows whose target the walk never reached, inside something
 *   dropped whole - the chapter's start is the best that can be said of them.
 */
export function rowTracer(wanted) {
  /** @type {Map<R, number[]>} */
  const marks = new Map();
  /** @type {Set<S>} */
  const met = new Set();
  /** @type {number[]} */
  let waiting = [];
  return {
    trace(source, rebuilt) {
      const rows = wanted.get(source);
      if (rows !== undefined && !met.has(source)) {
        met.add(source);
        waiting.push(...rows);
      }
      if (rebuilt !== null && waiting.length > 0) {
        marks.set(rebuilt, waiting);
        waiting = [];
      }
    },
    marks,
    trailing: () => waiting,
    unmet: () => [...wanted].flatMap(([source, rows]) => (met.has(source) ? [] : rows)),
  };
}

/**
 * Rows on their way to a block. The import drops blocks with nothing to
 * read - a spacer, the shadow of a picture nobody kept, the empty anchor a
 * converter planted as a chapter's target - and a row that arrived at one
 * must not fall with it: it waits, and lands on the next block kept. Rows
 * still waiting when the book ends land nowhere.
 *
 * @returns {{ arrive: (rows: number[]) => void, land: () => number[] }}
 */
export function rowCarrier() {
  /** @type {number[]} */
  let carried = [];
  return {
    arrive(rows) {
      carried.push(...rows);
    },
    land() {
      const landed = carried;
      carried = [];
      return landed;
    },
  };
}

/** Where a row landed: the anchor a `TocEntry` stands on. */
/** @typedef {{ segmentIndex: number, blockIndex: number }} RowPlace */

/**
 * The file's rows as the table the book's row carries. A row that landed
 * nowhere is left out. The rest stand in reading order - which the file's
 * own order nearly always is, and which everything that asks "which row is
 * being read" counts on (`currentTocRow`, `chapterOf`); a file that lists
 * its notes first gets them where they are. Depth is counted from the
 * shallowest row that landed and held to the three levels a row may have;
 * a row repeated on the spot - same words, same place - is said once.
 *
 * @param {NavRow[]} rows
 * @param {Map<number, RowPlace>} places where each row landed, by its index
 * @returns {TocEntry[]}
 */
export function landedToc(rows, places) {
  /** @type {Array<{ row: NavRow, place: RowPlace }>} */
  const landed = [];
  let shallowest = Number.POSITIVE_INFINITY;
  for (const [index, row] of rows.entries()) {
    const place = places.get(index);
    if (place === undefined) continue;
    landed.push({ row, place });
    shallowest = Math.min(shallowest, row.level);
  }
  // Stable, so rows landing on one block keep the file's order - a part's
  // name stays above the chapter it opens with.
  landed.sort(
    (a, b) => a.place.segmentIndex - b.place.segmentIndex || a.place.blockIndex - b.place.blockIndex,
  );

  /** @type {TocEntry[]} */
  const entries = [];
  for (const { row, place } of landed) {
    const last = entries[entries.length - 1];
    if (
      last !== undefined &&
      last.title === row.title &&
      last.segmentIndex === place.segmentIndex &&
      last.blockIndex === place.blockIndex
    ) {
      continue;
    }
    entries.push({
      title: row.title,
      level: /** @type {1 | 2 | 3} */ (Math.min(3, Math.max(1, row.level - shallowest + 1))),
      segmentIndex: place.segmentIndex,
      blockIndex: place.blockIndex,
    });
  }
  return cappedToc(entries);
}

/**
 * Rows up to which a file's table is thin: the size of a list that names
 * the front matter and nothing else - cover, title page, copyright,
 * contents, "start reading" - which is what a careless conversion leaves
 * in place of a table of contents.
 */
export const THIN_TABLE = 5;

/**
 * The table a book is given at import: the file's own, or the headings of
 * its text, as before D277. The file's is the one a reader of the book
 * expects - it is what every e-reader lists - so it stands unless it is no
 * table to move about by:
 *
 *   - it leads to fewer than two places. One row is a cover's link; rows
 *     that all land on one block are a list whose fragments the text does
 *     not hold;
 *   - it is thin (`THIN_TABLE`) while the text's own headings list more.
 *     Until D277 such a book was shown its headings, and a list of "Cover,
 *     Title, Start" in their place would take its chapters away.
 *
 * A book with neither is shown places (D271), which is the reader's
 * business and stores nothing.
 *
 * @param {TocEntry[]} fromFile
 * @param {TocEntry[]} fromHeadings
 * @returns {TocEntry[]}
 */
export function importedToc(fromFile, fromHeadings) {
  const places = new Set(fromFile.map((entry) => `${entry.segmentIndex}:${entry.blockIndex}`));
  if (places.size < 2) return fromHeadings;
  if (fromFile.length <= THIN_TABLE && fromHeadings.length > fromFile.length) return fromHeadings;
  return fromFile;
}
