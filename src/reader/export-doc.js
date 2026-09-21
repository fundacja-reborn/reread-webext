/**
 * A document as a file of its own (D229), on the reader page: one saved
 * article or one imported book read out of the database, rebuilt through
 * the allowed list the way every render rebuilds it, and written as the
 * file the press asked for - a book file (`lib/store/epub-file.js`) or a
 * plain-text page (`lib/store/markdown-file.js`). This file is the part
 * that needs the database, `DOMParser` and the ZIP writer; every rule of
 * what the files hold lives in the two modules, under `node --test`, and
 * nothing here decides anything about them.
 *
 * The rebuild is the same barrier the screen stands behind: the stored
 * copy is not trusted back, and what reaches the file is what would reach
 * the reader's own page - a book of thirty parts rebuilt one part at a
 * time, between parts a breath for the event loop, the import's own
 * manner. The pictures are the database's rows for the document, read
 * once and whole (the backup reads them the same way); a book's text is
 * read whole too, as its backup reads it, and a book with a torn part
 * is no file rather than half a book.
 *
 * Nothing here touches the network, and the file goes nowhere but the
 * browser's download: a document leaves the way the backup leaves.
 */

import { t } from "../lib/i18n.js";
import { NO_BASE, buildArticle } from "../lib/reader/article.js";
import { getArticle, getPictures } from "../lib/store/articles.js";
import { allBookPictures, allBookSegments, getBook } from "../lib/store/books.js";
import { EPUB_MIME, documentFilename, documentIdentifier, epubDocument } from "../lib/store/epub-file.js";
import { MARKDOWN_MIME, markdownDocument } from "../lib/store/markdown-file.js";
import { packArchive } from "./zip.js";

/** The two files a document leaves as. */
/** @typedef {"epub" | "markdown"} ExportFormat */

/**
 * What a press comes to: the file's content (the archive as the writer
 * packed it, or the page as text), the name it is downloaded under, and
 * what it is.
 *
 * @typedef {{ content: Blob | string, filename: string, type: string }} ExportedDocument
 */

/**
 * The file under construction, whichever kind: the parts go in one at a
 * time, and the file comes out at the end.
 *
 * A book that has a table of contents hands each part the rows that land
 * in it (D277): the file then lists what the reader lists, chapters named
 * by the file the book came from included. The plain-text page has no
 * contents to list and takes no rows.
 *
 * @typedef {{
 *   part: (root: Element, rows?: import("../lib/store/epub-file.js").PartRow[]) => void,
 *   finish: () => Promise<ExportedDocument>,
 * }} DocumentWriter
 */

/**
 * One document written as one file, or nothing - for a document the
 * database no longer holds, or a book whose text it holds only in part.
 * A picture read that fails leaves the file without pictures rather than
 * without the file.
 *
 * @param {"article" | "book"} kind
 * @param {string} key an article's address, a book's id
 * @param {ExportFormat} format
 * @returns {Promise<ExportedDocument | null>}
 */
export async function exportDocument(kind, key, format) {
  return kind === "book" ? exportBook(key, format) : exportArticle(key, format);
}

/**
 * @param {string} url
 * @param {ExportFormat} format
 * @returns {Promise<ExportedDocument | null>}
 */
async function exportArticle(url, format) {
  const article = await getArticle(url);
  if (article === null) return null;
  const writer =
    format === "markdown"
      ? markdownWriter({ title: article.title, source: url, at: article.savedAt }, article.title)
      : epubWriter(
          {
            identifier: documentIdentifier("article", url),
            title: article.title,
            lang: article.lang,
            dir: article.dir,
            source: url,
            modifiedAt: article.savedAt,
            pictures: await getPictures(url).catch(() => []),
            contentsLabel: t("reader_book_toc"),
          },
          article.title,
        );
  writer.part(rebuilt(article.content, { baseUrl: url }));
  return writer.finish();
}

/**
 * @param {string} id
 * @param {ExportFormat} format
 * @returns {Promise<ExportedDocument | null>}
 */
async function exportBook(id, format) {
  const book = await getBook(id);
  if (book === null) return null;
  const segments = await allBookSegments(book);
  if (segments === null) return null;
  const writer =
    format === "markdown"
      ? markdownWriter({ title: book.title, source: book.author, at: book.addedAt }, book.title)
      : epubWriter(
          {
            identifier: documentIdentifier("book", id),
            title: book.title,
            lang: book.lang,
            dir: null,
            author: book.author,
            modifiedAt: book.addedAt,
            pictures: await allBookPictures(book).catch(() => []),
            contentsLabel: t("reader_book_toc"),
          },
          book.title,
        );
  // The table the book's row carries, where it carries one: the file's own
  // (D277) or the headings' (D116), either way what the reader lists. A row
  // still owed its scan, or scanned and empty, leaves the writer to read
  // the headings off the text as it goes - as it does for an article.
  const toc = book.toc !== null && book.toc.length > 0 ? book.toc : null;
  for (const [at, segment] of segments.entries()) {
    if (at > 0) await yieldToUi();
    // A book's pictures are addressed inside its archive (D183), and the
    // stored address is whole already - resolved against the root, as on
    // screen; its links, where a Markdown text left any (D230), resolve
    // against no address and stand only when absolute.
    const root = rebuilt(segment.blocks.join(""), { baseUrl: NO_BASE, archive: "" });
    if (toc === null) writer.part(root);
    else writer.part(root, toc.filter((entry) => entry.segmentIndex === at));
  }
  return writer.finish();
}

/**
 * The stored copy parsed inert and rebuilt through the allowed list - the
 * road every render takes (`renderSaved`, `openBook`), with the pictures
 * left as the addresses the text asks for: the writers match those to
 * the database's rows themselves.
 *
 * @param {string} html our own stored markup
 * @param {Omit<import("../lib/reader/article.js").RebuildOptions, "pictures">} options
 * @returns {Element}
 */
function rebuilt(html, options) {
  const source = new DOMParser().parseFromString(html, "text/html").body;
  return buildArticle(source, document, { ...options, pictures: true });
}

/**
 * @param {import("../lib/store/markdown-file.js").MarkdownMeta} meta
 * @param {string} title
 * @returns {DocumentWriter}
 */
function markdownWriter(meta, title) {
  const page = markdownDocument(meta);
  return {
    part: (root) => page.part(root),
    finish: () =>
      Promise.resolve({ content: page.text(), filename: documentFilename(title, "md"), type: MARKDOWN_MIME }),
  };
}

/**
 * @param {import("../lib/store/epub-file.js").EpubMeta} meta
 * @param {string} title
 * @returns {DocumentWriter}
 */
function epubWriter(meta, title) {
  const book = epubDocument(meta);
  return {
    part: (root, rows) => book.part(root, rows),
    finish: async () => {
      // The writer's own type on the archive: what the browser is handed
      // is a book file, whatever the ZIP library calls its output.
      const archive = await packArchive(book.entries());
      return {
        content: new Blob([archive], { type: EPUB_MIME }),
        filename: documentFilename(title, "epub"),
        type: EPUB_MIME,
      };
    },
  };
}

/** A breath between two parts of a book, so the page stays responsive through a long one. */
function yieldToUi() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
