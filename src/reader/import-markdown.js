/**
 * Importing a Markdown text into the reading list (D230): the file read
 * whole, parsed by our own parser (`lib/book/markdown.js`) into the closed
 * markup every render knows, rebuilt through the allowed list like
 * anything else this extension renders, and cut into the parts of a book
 * by the EPUB import's own packer - so that a note from another app and a
 * document this reader exported come back as one more book on the list:
 * parts, a table of contents from the headings, footnotes as popups, the
 * reading position, the highlighter.
 *
 * A book rather than an article, because an article is a page with an
 * address and a text file has none: nothing to open the original of,
 * nothing to key the row by but an id of its own. The same file imported
 * twice is two books, as an EPUB imported twice is - import never
 * overwrites, and a text has no address to be the same by.
 *
 * What a Markdown text has that an EPUB has not is links to the web, kept
 * (the rebuild resolves against `NO_BASE`, which keeps an absolute
 * address and refuses a relative one), and pictures that are addresses on
 * the web rather than files in an archive: kept as the addresses, shown by
 * nothing and fetched by nothing - a book's pictures are the file's, and
 * this file holds none. The book row is written last, the EPUB import's
 * rule: an import cut short leaves orphans the next list opening sweeps.
 */

import { packableBlocks } from "../lib/book/blocks.js";
import { parseMarkdown } from "../lib/book/markdown.js";
import { packedChars } from "../lib/book/pictures.js";
import { BOOK_CUT_VERSION, isHeadingTag, segmenter } from "../lib/book/segment.js";
import { NO_BASE, buildArticle } from "../lib/reader/article.js";
import { bookRecord } from "../lib/store/book.js";
import { deleteBook, putBook } from "../lib/store/books.js";
import { partWriter } from "./book-parts.js";

/** @typedef {import("./book-parts.js").PackedBlock} PackedBlock */
/** @typedef {import("./import-book.js").ImportOutcome} ImportOutcome */
/** @typedef {import("./import-book.js").ImportProgress} ImportProgress */

/**
 * The most a text may be. A note is kilobytes and a whole novel as one
 * text a megabyte or two; the file is read, parsed and rebuilt whole,
 * and a tablet's memory is the reason for a ceiling at all - ten novels
 * is not a text anybody wrote.
 */
export const MAX_MARKDOWN_BYTES = 8 * 1024 * 1024;

/** How many blocks go to the packer between two breaths for the event loop. */
const BLOCKS_PER_BREATH = 200;

/**
 * @param {string} what
 * @param {unknown} [error]
 * @returns {ImportOutcome}
 */
function unreadable(what, error) {
  console.warn(`re/read: this file cannot be imported as a Markdown text - ${what}`, ...(error === undefined ? [] : [error]));
  return { ok: false, reason: "unreadable" };
}

/** A breath for the event loop between two runs of blocks. */
function yieldToUi() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * The title a file gives its text when the text names none: the file's
 * name without its extension - or the name whole, when that leaves
 * nothing.
 *
 * @param {string} filename
 * @returns {string}
 */
export function titleFromFilename(filename) {
  const bare = filename.replace(/\.(?:md|markdown)$/i, "").trim();
  return bare.length > 0 ? bare : filename.trim();
}

/**
 * The whole import of one file. Progress is reported once per part
 * written, the EPUB import's unit: every report is a repaint, and on
 * e-ink a repaint is a flash.
 *
 * @param {File} file
 * @param {(progress: ImportProgress) => void} onProgress
 * @returns {Promise<ImportOutcome>}
 */
export async function importMarkdown(file, onProgress) {
  if (file.size > MAX_MARKDOWN_BYTES) return unreadable(`${file.size} bytes is over the ${MAX_MARKDOWN_BYTES} the import takes`);
  /** @type {import("../lib/book/markdown.js").ParsedMarkdown} */
  let parsed;
  try {
    parsed = parseMarkdown(await file.text());
  } catch (error) {
    return unreadable("the file could not be read, or would not parse", error);
  }
  if (parsed.html.trim().length === 0) return unreadable("the file holds no text to read");

  const bookId = crypto.randomUUID();
  try {
    const packer = /** @type {ReturnType<typeof segmenter<PackedBlock>>} */ (segmenter());
    const parts = partWriter(bookId, (written) => onProgress({ segments: written, pictures: 0, bytes: 0 }));
    // Our own markup, and still parsed inert and rebuilt through the
    // allowed list: the parser passes the text's raw HTML through, and
    // this is the wall it meets. `NO_BASE` keeps a link to the web and
    // refuses one to nowhere; without `archive`, a picture's address on
    // the web is kept as it stands (`safeSrc`).
    const source = new DOMParser().parseFromString(parsed.html, "text/html").body;
    const rebuilt = buildArticle(source, document, { baseUrl: NO_BASE, pictures: true });
    let since = 0;
    for (const block of packableBlocks(rebuilt)) {
      const text = block.textContent ?? "";
      const holdsPicture = block.localName === "img" || block.querySelector("img") !== null;
      // A block with nothing to read leaves the book, as in an EPUB - but
      // one holding a picture stays: the picture is invisible today and
      // has an address a later download may ask for.
      if (text.trim().length === 0 && block.localName !== "hr" && !holdsPicture) continue;
      since += 1;
      if (since % BLOCKS_PER_BREATH === 0) await yieldToUi();
      await parts.write(
        packer.push({
          // A picture nobody kept weighs nothing in the packer's budget.
          chars: packedChars(text.length, 0),
          heading: isHeadingTag(block.localName),
          payload: { html: block.outerHTML, pictures: [] },
        }),
      );
    }
    await parts.write(packer.finish());

    const book = bookRecord({
      id: bookId,
      title: parsed.title ?? titleFromFilename(file.name),
      author: parsed.author,
      lang: parsed.lang,
      segmentCount: parts.written(),
      totalChars: parts.totalChars(),
      addedAt: Date.now(),
      toc: parts.toc(),
      pictures: null,
      cut: BOOK_CUT_VERSION,
      words: parts.words(),
    });
    // No record means no text worth keeping came out - a file of blank lines.
    if (book === null) throw new Error("nothing to keep");

    await putBook(book);
    return { ok: true, book };
  } catch (error) {
    await deleteBook(bookId).catch(() => undefined);
    return unreadable("the import failed part-way", error);
  }
}
