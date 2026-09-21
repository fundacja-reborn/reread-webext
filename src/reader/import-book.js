/**
 * Importing an EPUB into the reading list - the one-time pipeline the brief
 * calls Phase B: unpack, parse, rebuild, cut, store. It runs on the reader
 * page (O18): the page has `DOMParser` in both browsers, it is the page that
 * owns the articles database, and a book's text riding `runtime.sendMessage`
 * would be cost without gain.
 *
 * The shape of the work is streaming, because the target device is an e-ink
 * tablet with little memory and a slow CPU:
 *
 *   - the ZIP is never unpacked whole - fflate's `filter` inflates exactly
 *     one entry per ask, so the peak is the largest chapter, not the book;
 *   - between spine entries the loop yields to the event loop, so the page
 *     stays responsive through a long import;
 *   - segments are written the moment the packer closes them; in memory
 *     there is never more than the current chapter and the packer's tail.
 *
 * The book row is written **last**. An import cut short by a closed tab
 * leaves only segments without a book - invisible everywhere, and swept the
 * next time the list opens (`sweepOrphanSegments`). At no point can a
 * half-imported book be opened.
 *
 * Chapter markup goes through the same `buildArticle` walk as everything
 * else this extension renders: the allowed list decides what survives.
 * Links lose their `href` wholesale: with no base URL to resolve against,
 * `safeHref` refuses every one - internal and external alike - and what
 * remains is the link's text. Deliberate, not incidental: the brief puts
 * links-as-mechanism (the book's own TOC page, cross-references) out of
 * scope, and a book is prose to read, not a page to leave. The reader's
 * table of contents is not these links. It is the file's own table where
 * the file has one (D277): the navigation document or the NCX is read
 * before the spine, each row's target is followed through the rebuild of
 * the chapter it points into, and the row is stored as the `(segment,
 * block)` its target landed on (`lib/book/nav.js` holds the rules and the
 * road; nothing of it rides in the markup). A file without a table worth
 * the name gets the one read off the h1-h3 blocks as segments are written
 * (D116) - the same headings the segmenter cuts before. Either way the list
 * is stored on the book row, in one shape.
 *
 * Pictures stay (D183; they fell out with the allowed list until then).
 * A chapter's `<img>` keeps its address as a path inside the archive
 * (`archiveSrc`, resolved against the chapter), and the picture behind it
 * is read out of the archive right here, decided on by the rules an
 * article's pictures follow, and written as a row under the book's id -
 * one at a time, as the blocks are met, so that a book of plates never has
 * its plates in memory at once. A picture that cannot be kept leaves its
 * block; a block with nothing left to read leaves the book. What the
 * cover pages of the presses wrap in an SVG frame is unwrapped first
 * (`framePictures`), because the sanitizer drops `svg` whole. Nothing here
 * touches the network: a book's pictures are in the file, or nowhere.
 *
 * Footnotes are the one exception now (mobileread request, accepted plan):
 * a reference recognized as one (`lib/book/notes.js` holds the rules) gets
 * its note's text resolved RIGHT HERE and carried on the marker as
 * `data-note` - still no href, no id, no navigation; the render turns the
 * mark into a small popover. Resolved at import because the segments cut
 * the book apart and the sanitizer strips every id: by render time there is
 * nothing left to follow, so the text has to ride along now.
 */

import { markedBlocks } from "../lib/book/blocks.js";
import {
  importedToc,
  landedToc,
  navDocumentRows,
  ncxRows,
  preferredRows,
  rowCarrier,
  rowTargets,
  rowTracer,
} from "../lib/book/nav.js";
import { cleanNoteText, internalTarget, isNoteref } from "../lib/book/notes.js";
import {
  containerOpfPath,
  decodeXml,
  hasEncryption,
  opfDirectory,
  opfPackage,
  resolveZipPath,
} from "../lib/book/opf.js";
import { framedPictureHref, packedChars } from "../lib/book/pictures.js";
import { BOOK_CUT_VERSION, isHeadingTag, segmenter } from "../lib/book/segment.js";
import { buildArticle } from "../lib/reader/article.js";
import { decide } from "../lib/reader/sanitize.js";
import { bookRecord } from "../lib/store/book.js";
import { deleteBook, putBook } from "../lib/store/books.js";
import { partWriter } from "./book-parts.js";
import { archivePictures, pictureKeeper } from "./book-pictures.js";
import { loadFflate } from "./zip.js";

/**
 * The slice of fflate this pipeline uses - the synchronous single-entry
 * reads, nothing else (`zip.js` loads the vendored file and says what of
 * it is ever called).
 *
 * @typedef {import("./zip.js").ZipEntryInfo} ZipEntryInfo
 * @typedef {import("./zip.js").FflateModule} FflateModule
 */

/** @typedef {"drm" | "unreadable"} ImportFailure */

/**
 * @typedef {{ ok: true, book: import("../lib/store/book.js").BookMeta }
 *   | { ok: false, reason: ImportFailure }} ImportOutcome
 */

/**
 * The one failure sentence the reader gets, with its cause left where
 * somebody looking for it will find it: the reader page's console. The
 * sentence covers everything from "not a ZIP" to a database that would not
 * take a row, and a cause swallowed whole is a report nobody can act on -
 * the first import of a book with pictures failed with the sentence alone
 * (2026-09-05), and the file turned out to be the question.
 *
 * @param {string} what
 * @param {unknown} [error]
 * @returns {ImportOutcome}
 */
function unreadable(what, error) {
  console.warn(`re/read: this file cannot be imported as an EPUB - ${what}`, ...(error === undefined ? [] : [error]));
  return { ok: false, reason: "unreadable" };
}

/**
 * Where an import stands: how many parts are written, how many pictures
 * are kept and what they take (D183).
 *
 * @typedef {{ segments: number, pictures: number, bytes: number }} ImportProgress
 */

/** @typedef {import("./book-parts.js").PackedBlock} PackedBlock */

/**
 * XML parsed inert, or nothing when it would not parse - `DOMParser` never
 * throws on XML, it plants a `parsererror` element instead, and both engines
 * agree on the local name.
 *
 * @param {string} text
 * @returns {Document | null}
 */
function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  return doc.getElementsByTagNameNS("*", "parsererror").length === 0 ? doc : null;
}

/** A breath for the event loop between spine entries. */
function yieldToUi() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * The block whose text stands for a note: the target itself when it is a
 * block, otherwise the nearest one around it - a note's id often sits on a
 * `<sup>` or an empty anchor inside the paragraph that IS the note.
 */
const NOTE_BLOCKS = "p, li, dd, aside, blockquote, td, div, section, footer";

/**
 * Footnote references of one chapter, resolved to their notes' text and
 * carried as `data-note` on the marker (see the header). The walk runs on
 * the parsed chapter BEFORE `buildArticle`, because the rebuild is what
 * strips the hrefs and ids this needs to read.
 *
 * The rules are `lib/book/notes.js`'s; this is only the DOM around them.
 * Recognition is checked before any target is materialized, so the book's
 * own TOC page - hundreds of internal links whose text is words - never
 * costs a single extra parse.
 *
 * @param {Document} chapter parsed, inert (DOMParser has no browsing context)
 * @param {string} chapterPath the chapter's own path inside the archive
 * @param {(path: string | null) => Document | null} readDoc another file of
 *   the book, parsed - cached by the caller, null for a path the archive
 *   does not hold
 */
function annotateNoterefs(chapter, chapterPath, readDoc) {
  const chapterDir = opfDirectory(chapterPath);
  for (const anchor of chapter.querySelectorAll("a[href]")) {
    if (!isNoteref(anchor.getAttribute("epub:type"), anchor.textContent ?? "")) continue;
    const target = internalTarget(anchor.getAttribute("href"));
    if (target === null) continue;

    const resolved = target.path === null ? chapterPath : resolveZipPath(chapterDir, target.path);
    const where = resolved === chapterPath ? chapter : readDoc(resolved);
    const found = where === null ? null : where.getElementById(target.id);
    if (found === null) continue;

    const block = found.closest(NOTE_BLOCKS) ?? found;
    const text = cleanNoteText(block.textContent ?? "");
    if (text.length === 0) continue;
    anchor.setAttribute("data-note", text);
  }
}

/**
 * The pictures the presses wrap in an SVG frame - a cover page is
 * `<svg><image href="cover.jpg"/></svg>` more often than not - unwrapped
 * into the `<img>` they are, before the rebuild drops the frame with every
 * other SVG. The rule is `lib/book/pictures.js`'s (`framedPictureHref`);
 * this is only the DOM around it. The parsed chapter is inert
 * (`DOMParser` has no browsing context), so the new element loads nothing.
 *
 * @param {Document} chapter
 */
function framePictures(chapter) {
  for (const svg of Array.from(chapter.querySelectorAll("svg"))) {
    const href = framedPictureHref(svg);
    if (href === null) continue;
    const image = chapter.createElement("img");
    image.setAttribute("src", href);
    const alt = svg.querySelector("title")?.textContent?.trim() ?? "";
    if (alt.length > 0) image.setAttribute("alt", alt);
    svg.replaceWith(image);
  }
}

/**
 * The file's own table of contents (D277), read before the spine so that
 * its targets can be followed as the chapters go by: the rows, and where
 * each points, by archive path. The navigation document is read first and
 * the NCX only when that names no table (`preferredRows`), so a book of the
 * third edition costs one parse. A list the XML parser refuses - an entity
 * the file never declared is the usual reason - gets the HTML parser, which
 * refuses nothing; `nav.js` reads what either makes of it.
 *
 * Whatever goes wrong here costs the book its chapters' names and nothing
 * else: the answer is then no rows, and the headings of the text stand in
 * as they did before.
 *
 * @param {ReturnType<typeof opfPackage>} pkg
 * @param {string} baseDir the package's directory
 * @param {(path: string) => Uint8Array | null} entry
 * @returns {{
 *   rows: import("../lib/book/nav.js").NavRow[],
 *   targets: Map<string, import("../lib/book/nav.js").RowTarget[]>,
 * }}
 */
function fileContents(pkg, baseDir, entry) {
  /**
   * @param {string | null} href as the package names the list
   * @param {(root: Element) => import("../lib/book/nav.js").NavRow[]} read
   */
  const list = (href, read) => {
    const path = href === null ? null : resolveZipPath(baseDir, href);
    const bytes = path === null ? null : entry(path);
    if (path === null || bytes === null) return null;
    const text = decodeXml(bytes);
    const doc = parseXml(text) ?? new DOMParser().parseFromString(text, "text/html");
    return { path, rows: read(doc.documentElement) };
  };

  try {
    const nav = list(pkg.navHref, navDocumentRows);
    let chosen = nav;
    if (nav === null || nav.rows.length < 2) {
      const ncx = list(pkg.ncxHref, ncxRows);
      if (ncx !== null && (nav === null || preferredRows(nav.rows, ncx.rows) === ncx.rows)) chosen = ncx;
    }
    if (chosen !== null) return { rows: chosen.rows, targets: rowTargets(chosen.rows, chosen.path) };
  } catch (error) {
    console.warn("re/read: the book's own table of contents could not be read - its headings stand in", error);
  }
  return { rows: [], targets: new Map() };
}

/**
 * The element a row of the contents points at inside a chapter: the one
 * with that `id`, or - in a file old enough - the anchor with that `name`.
 * Nothing for a fragment the chapter does not hold, and nothing for the
 * body itself or anything outside it: all three mean the chapter's start.
 *
 * A target inside something the rebuild drops whole - a caption in a frame,
 * a fallback inside an `object` - is never met by the walk, which does not
 * look into what it drops; the dropped element is met, and it stands where
 * its inside stood, so it is the one answered.
 *
 * @param {Document} chapter parsed, inert
 * @param {string} fragment
 * @returns {Element | null}
 */
function targetElement(chapter, fragment) {
  const found = chapter.getElementById(fragment) ?? chapter.getElementsByName(fragment)[0] ?? null;
  if (found === null || found === chapter.body || !chapter.body.contains(found)) return null;
  let target = found;
  for (let node = found.parentElement; node !== null && node !== chapter.body; node = node.parentElement) {
    if (decide(node.tagName) === "drop") target = node;
  }
  return target;
}

/**
 * The whole import of one file. Progress is reported once per segment
 * written and once per picture kept - not per block, not per chapter -
 * which is deliberately coarse: every report is a repaint, and on e-ink a
 * repaint is a flash.
 *
 * @param {File} file
 * @param {(progress: ImportProgress) => void} onProgress
 * @returns {Promise<ImportOutcome>}
 */
export async function importEpub(file, onProgress) {
  /** @type {Uint8Array} */
  let bytes;
  /** @type {FflateModule["unzipSync"]} */
  let unzipSync;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
    ({ unzipSync } = await loadFflate());
  } catch (error) {
    return unreadable("the file could not be read, or the ZIP reader could not load", error);
  }

  /**
   * One entry's bytes, inflated on demand - the filter is what keeps every
   * other entry compressed and unread.
   *
   * @param {string} path
   * @returns {Uint8Array | null}
   */
  const entry = (path) => {
    const out = unzipSync(bytes, { filter: (candidate) => candidate.name === path });
    return out[path] ?? null;
  };

  /** @type {string[]} */
  const names = [];
  try {
    unzipSync(bytes, {
      filter: (candidate) => {
        names.push(candidate.name);
        return false;
      },
    });
  } catch (error) {
    // Not a ZIP at all - a renamed PDF, a truncated download.
    return unreadable("not a ZIP archive", error);
  }
  if (hasEncryption(names)) return { ok: false, reason: "drm" };

  const bookId = crypto.randomUUID();
  try {
    const containerBytes = entry("META-INF/container.xml");
    const containerDoc = containerBytes === null ? null : parseXml(decodeXml(containerBytes));
    const opfPath = containerDoc === null ? null : containerOpfPath(containerDoc.documentElement);
    const opfBytes = opfPath === null ? null : entry(opfPath);
    const opfDoc = opfBytes === null ? null : parseXml(decodeXml(opfBytes));
    // The usual shape of a "book" that is not one: a folder zipped with
    // its own name in front of every entry, so nothing stands at the root.
    if (containerDoc === null) return unreadable("META-INF/container.xml is missing at the root, or will not parse");
    if (opfPath === null) return unreadable("META-INF/container.xml names no package document");
    if (opfDoc === null) return unreadable(`the package document ${opfPath} is missing, or will not parse`);

    const pkg = opfPackage(opfDoc.documentElement);
    if (pkg.spineHrefs.length === 0) return unreadable("the spine names no XHTML entry");

    const baseDir = opfDirectory(opfPath);
    const packer = /** @type {ReturnType<typeof segmenter<PackedBlock>>} */ (segmenter());
    /** @type {ImportProgress} */
    const progress = { segments: 0, pictures: 0, bytes: 0 };
    // The book's pictures, kept as the blocks that show them are met (D183).
    const keeper = pictureKeeper(bookId, archivePictures(unzipSync, bytes), (kept, size) => {
      progress.pictures = kept;
      progress.bytes = size;
      onProgress({ ...progress });
    });

    // Other files of the book, parsed for footnote targets - most books keep
    // every note in one or two files, so the cache is tiny; capped all the
    // same, because this pipeline's shape is streaming and a book that
    // scatters targets must not pull itself whole into memory.
    /** @type {Map<string, Document | null>} */
    const noteDocs = new Map();
    /** @param {string | null} path */
    const readNoteDoc = (path) => {
      if (path === null) return null;
      const held = noteDocs.get(path);
      if (held !== undefined) return held;
      if (noteDocs.size >= 4) {
        const oldest = noteDocs.keys().next().value;
        if (oldest !== undefined) noteDocs.delete(oldest);
      }
      const bytes = entry(path);
      const doc =
        bytes === null ? null : new DOMParser().parseFromString(decodeXml(bytes), "text/html");
      noteDocs.set(path, doc);
      return doc;
    };
    // The parts written as the packer closes them, with the table of
    // contents and the words counted on the way (`book-parts.js`, shared
    // with the Markdown import since D230).
    const parts = partWriter(bookId, (written) => {
      progress.segments = written;
      onProgress({ ...progress });
    });
    // The file's own table of contents (D277), and its rows on their way
    // to the blocks they land on.
    const contents = fileContents(pkg, baseDir, entry);
    const carrier = rowCarrier();

    for (const href of pkg.spineHrefs) {
      await yieldToUi();
      const path = resolveZipPath(baseDir, href);
      const data = path === null ? null : entry(path);
      // A spine that names an entry the archive does not hold is a broken
      // book; importing it minus a chapter would be corruption dressed as
      // success.
      if (path === null || data === null) throw new Error(`spine entry missing: ${href}`);

      // The HTML parser rather than the XML one: it cannot fail, and the
      // rebuild walks whatever it produces through the allowed list anyway.
      // The empty base is what strips every link (see the header): `safeHref`
      // cannot resolve anything against it, so no `href` survives the walk.
      const chapter = new DOMParser().parseFromString(decodeXml(data), "text/html");
      // Before the rebuild, while the hrefs and the targets' ids still exist
      // (see the header): the footnotes' text onto their markers, and the
      // framed pictures out of their frames.
      annotateNoterefs(chapter, path, readNoteDoc);
      framePictures(chapter);
      // The rows of the file's contents that point into this chapter
      // (D277), by the element each points at - looked up here, after the
      // frames were replaced, so that every element named is one the rebuild
      // will meet. A row that names the whole file, or a fragment the file
      // does not hold, begins where the chapter does.
      /** @type {Map<Element, number[]>} */
      const wanted = new Map();
      /** @type {number[]} */
      const atStart = [];
      for (const { row, fragment } of contents.targets.get(path) ?? []) {
        const found = fragment === null ? null : targetElement(chapter, fragment);
        if (found === null) atStart.push(row);
        else wanted.set(found, [...(wanted.get(found) ?? []), row]);
      }
      const tracer = /** @type {ReturnType<typeof rowTracer<Element, Element>>} */ (rowTracer(wanted));
      // Pictures kept, addressed by their path in the archive, resolved
      // against this chapter's directory (D183).
      const rebuilt = buildArticle(chapter.body, document, {
        baseUrl: "",
        pictures: true,
        archive: opfDirectory(path),
        trace: tracer.trace,
      });
      carrier.arrive([...atStart, ...tracer.unmet()]);
      // The dissolving walk rather than the root's children: EPUB chapters
      // usually wrap all their markup in one `<div>`, and packing that as a
      // single block would put a whole chapter in one segment and a
      // part-divider page in its own (see `lib/book/blocks.js`).
      for (const { block, rows } of markedBlocks(rebuilt, tracer.marks)) {
        carrier.arrive(rows);
        // The block's pictures first, out of the archive and into the
        // database; what could not be kept has left the block by now.
        const pictures = await keeper.keep(block);
        const text = block.textContent ?? "";
        // Blocks with nothing to read are usually the shadow of a picture
        // nobody kept, or a spacer of non-breaking whitespace; the ones kept
        // are the scene break, which is its own meaning, and a picture
        // standing on its own.
        // (A row of the contents that arrived at a block dropped here waits
        // with the carrier for the next one kept.)
        if (text.trim().length === 0 && block.localName !== "hr" && pictures.length === 0) continue;
        await parts.write(
          packer.push({
            chars: packedChars(text.length, pictures.length),
            heading: isHeadingTag(block.localName),
            payload: { html: block.outerHTML, pictures, rows: carrier.land() },
          }),
        );
      }
      // A target met after the chapter's last element belongs to whatever
      // text comes next - the following chapter's first block.
      carrier.arrive(tracer.trailing());
    }
    await parts.write(packer.finish());

    const book = bookRecord({
      id: bookId,
      title: pkg.title ?? file.name.replace(/\.epub$/i, "").trim(),
      author: pkg.author,
      lang: pkg.lang,
      segmentCount: parts.written(),
      totalChars: parts.totalChars(),
      addedAt: Date.now(),
      // The file's own table where it is one to move about by, the
      // headings of the text otherwise (D277, `importedToc`).
      toc: importedToc(landedToc(contents.rows, parts.places()), parts.toc()),
      pictures: keeper.summary(),
      cut: BOOK_CUT_VERSION,
      words: parts.words(),
    });
    // No record means no text worth keeping came out - a spine of covers.
    if (book === null) throw new Error("nothing to keep");

    await putBook(book);
    return { ok: true, book };
  } catch (error) {
    // Leave nothing behind: the book row was never written, and this takes
    // the segments and the pictures (best-effort - the orphan sweep covers
    // a failure here).
    await deleteBook(bookId).catch(() => undefined);
    return unreadable("the import failed part-way", error);
  }
}
