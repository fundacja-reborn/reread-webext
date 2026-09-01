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
 * else this extension renders: the allowed list decides what survives, and
 * images fall out with it (D3 - `img` has always been on the dropped list).
 * Links lose their `href` wholesale: with no base URL to resolve against,
 * `safeHref` refuses every one - internal and external alike - and what
 * remains is the link's text. Deliberate, not incidental: the brief puts
 * links-as-mechanism (the book's own TOC page, cross-references) out of
 * scope, and a book is prose to read, not a page to leave. The reader's
 * table of contents (D116) is not these links: it is built here from the
 * h1-h3 blocks as segments are written - the same headings the segmenter
 * cuts before - and stored on the book row.
 *
 * Footnotes are the one exception now (mobileread request, accepted plan):
 * a reference recognized as one (`lib/book/notes.js` holds the rules) gets
 * its note's text resolved RIGHT HERE and carried on the marker as
 * `data-note` - still no href, no id, no navigation; the render turns the
 * mark into a small popover. Resolved at import because the segments cut
 * the book apart and the sanitizer strips every id: by render time there is
 * nothing left to follow, so the text has to ride along now.
 */

import { packableBlocks } from "../lib/book/blocks.js";
import { cleanNoteText, internalTarget, isNoteref } from "../lib/book/notes.js";
import {
  containerOpfPath,
  decodeXml,
  hasEncryption,
  opfDirectory,
  opfPackage,
  resolveZipPath,
} from "../lib/book/opf.js";
import { isHeadingTag, segmenter } from "../lib/book/segment.js";
import { cappedToc, headingEntries } from "../lib/book/toc.js";
import { buildArticle } from "../lib/reader/article.js";
import { bookRecord } from "../lib/store/book.js";
import { deleteBook, putBook, putBookSegment } from "../lib/store/books.js";
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
 * The whole import of one file. Progress is reported once per segment
 * written - not per block, not per chapter - which is deliberately coarse:
 * every report is a repaint, and on e-ink a repaint is a flash.
 *
 * @param {File} file
 * @param {(segments: number) => void} onSegment
 * @returns {Promise<ImportOutcome>}
 */
export async function importEpub(file, onSegment) {
  /** @type {Uint8Array} */
  let bytes;
  /** @type {FflateModule["unzipSync"]} */
  let unzipSync;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
    ({ unzipSync } = await loadFflate());
  } catch {
    return { ok: false, reason: "unreadable" };
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
  } catch {
    // Not a ZIP at all - a renamed PDF, a truncated download.
    return { ok: false, reason: "unreadable" };
  }
  if (hasEncryption(names)) return { ok: false, reason: "drm" };

  const bookId = crypto.randomUUID();
  try {
    const containerBytes = entry("META-INF/container.xml");
    const containerDoc = containerBytes === null ? null : parseXml(decodeXml(containerBytes));
    const opfPath = containerDoc === null ? null : containerOpfPath(containerDoc.documentElement);
    const opfBytes = opfPath === null ? null : entry(opfPath);
    const opfDoc = opfBytes === null ? null : parseXml(decodeXml(opfBytes));
    if (opfPath === null || opfDoc === null) return { ok: false, reason: "unreadable" };

    const pkg = opfPackage(opfDoc.documentElement);
    if (pkg.spineHrefs.length === 0) return { ok: false, reason: "unreadable" };

    const baseDir = opfDirectory(opfPath);
    const packer = /** @type {ReturnType<typeof segmenter<string>>} */ (segmenter());

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
    let written = 0;
    let totalChars = 0;
    /** @type {import("../lib/book/toc.js").TocEntry[]} */
    const tocEntries = [];

    /** @param {Array<import("../lib/book/segment.js").Segment<string>>} segments */
    const writeSegments = async (segments) => {
      for (const segment of segments) {
        await putBookSegment({
          bookId,
          index: written,
          blocks: segment.blocks,
          charCount: segment.charCount,
        });
        // The table of contents (D116), read off the segment in its final
        // shape - only here are the packer's cuts and merges all spoken for,
        // so only here do the anchors name blocks a render will show.
        tocEntries.push(...headingEntries(segment.blocks, written));
        written += 1;
        totalChars += segment.charCount;
        onSegment(written);
      }
    };

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
      // (see the header): the footnotes' text onto their markers.
      annotateNoterefs(chapter, path, readNoteDoc);
      const rebuilt = buildArticle(chapter.body, document, { baseUrl: "" });
      // `packableBlocks` rather than the root's children: EPUB chapters
      // usually wrap all their markup in one `<div>`, and packing that as a
      // single block would put a whole chapter in one segment and a
      // part-divider page in its own (see `lib/book/blocks.js`).
      for (const block of packableBlocks(rebuilt)) {
        const text = block.textContent ?? "";
        // Blocks with nothing to read are usually the shadow of a dropped
        // image, or a spacer of non-breaking whitespace; the one kept is the
        // scene break, which is its own meaning.
        if (text.trim().length === 0 && block.localName !== "hr") continue;
        await writeSegments(
          packer.push({
            chars: text.length,
            heading: isHeadingTag(block.localName),
            payload: block.outerHTML,
          }),
        );
      }
    }
    await writeSegments(packer.finish());

    const book = bookRecord({
      id: bookId,
      title: pkg.title ?? file.name.replace(/\.epub$/i, "").trim(),
      author: pkg.author,
      lang: pkg.lang,
      segmentCount: written,
      totalChars,
      addedAt: Date.now(),
      toc: cappedToc(tocEntries),
    });
    // No record means no text worth keeping came out - a spine of covers.
    if (book === null) throw new Error("nothing to keep");

    await putBook(book);
    return { ok: true, book };
  } catch {
    // Leave nothing behind: the book row was never written, and this takes
    // the segments (best-effort - the orphan sweep covers a failure here).
    await deleteBook(bookId).catch(() => undefined);
    return { ok: false, reason: "unreadable" };
  }
}
