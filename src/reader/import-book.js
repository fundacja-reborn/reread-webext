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
 * links-as-mechanism (footnotes, the book's own TOC page) out of scope, and
 * a book is prose to read, not a page to leave. The reader's table of
 * contents (D116) is not these links: it is built here from the h1-h3
 * blocks as segments are written - the same headings the segmenter cuts
 * before - and stored on the book row.
 */

import { packableBlocks } from "../lib/book/blocks.js";
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

/**
 * The slice of fflate this pipeline uses - the synchronous single-entry
 * reads, nothing else. In particular none of the asynchronous API, which is
 * the part that spawns workers (see `vendor/fflate/README.md`).
 *
 * @typedef {{ name: string, size: number, originalSize: number }} ZipEntryInfo
 * @typedef {{
 *   unzipSync: (
 *     data: Uint8Array,
 *     opts?: { filter?: (file: ZipEntryInfo) => boolean },
 *   ) => Record<string, Uint8Array>,
 * }} FflateModule
 */

/** @type {FflateModule | null} */
let fflate = null;

/**
 * The vendored ZIP reader, loaded the first time a book is actually
 * imported - the reader page in its usual life never pays for it. A dynamic
 * import of the copied file rather than a bundled one, so what runs is
 * byte-for-byte what `vendor/fflate/CHECKSUMS` pins. The specifier is
 * written for the built package, where `vendor/` stands beside `reader/`;
 * the build marks it external so it survives bundling verbatim.
 *
 * @returns {Promise<FflateModule>}
 */
async function loadFflate() {
  if (fflate === null) {
    fflate = /** @type {FflateModule} */ (
      // @ts-expect-error - the path exists only in the built package (the
      // vendored file is copied, never bundled), so the checker cannot
      // resolve it from the source tree.
      await import("../vendor/fflate/browser.js")
    );
  }
  return fflate;
}

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
      if (data === null) throw new Error(`spine entry missing: ${href}`);

      // The HTML parser rather than the XML one: it cannot fail, and the
      // rebuild walks whatever it produces through the allowed list anyway.
      // The empty base is what strips every link (see the header): `safeHref`
      // cannot resolve anything against it, so no `href` survives the walk.
      const chapter = new DOMParser().parseFromString(decodeXml(data), "text/html");
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
