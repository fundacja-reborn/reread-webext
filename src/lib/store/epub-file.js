/**
 * The EPUB a document travels out in (D229): one saved article or one
 * imported book as a book file an e-reader opens - the text as the reader
 * shows it, the pictures the database keeps with it, and for a table of
 * contents the headings - or, for a book that has a table already, that
 * table (D277). Nothing here reads a database or a DOM: the reader
 * page parses the stored copy and rebuilds it through the allowed list,
 * the road every render takes, and hands the rebuilt tree in part by part
 * (`src/reader/export-doc.js`); this module writes the files the archive
 * holds, as strings and bytes, so that every decision runs under
 * `node --test`. The archive itself is the vendored ZIP library's business
 * on the reader page (`src/reader/zip.js`), fed the entries in the order
 * they stand here - `mimetype` first and uncompressed, which is what makes
 * a ZIP an EPUB to a reader that sniffs it.
 *
 * EPUB 3, in its plainest form: an OCF container naming one package
 * document, the package with its three required metadata fields and the
 * modification stamp, a navigation document, one XHTML file per part (an
 * article is one part; a book's parts are its segments, cut once at import
 * and never re-cut), one small stylesheet, and the pictures as files. No
 * cover, no NCX for EPUB 2 readers, no fonts: what the reader shows is what
 * the file holds.
 *
 * The XHTML is written by a walk of its own rather than by the DOM's
 * serializer, for two reasons. The serializer writes HTML, and an EPUB
 * wants XML: void elements closed, the five named entities and no other,
 * no character the XML grammar forbids - one control character in a
 * scraped page and a strict reader refuses the whole book. And the walk is
 * a second pass through the sanitizer's answers (`decide`,
 * `allowedAttributes`): the tree handed in is already the rebuilt one, and
 * the file still holds only what the allowed list names, whatever tree a
 * caller hands in.
 *
 * A book's footnotes (`data-note` on a marker, `lib/book/notes.js`) become
 * EPUB 3 footnotes - the marker a `noteref`, the note an `aside` at the
 * part's end - which is the one form an e-reader shows as a popup, as
 * this reader does.
 */

import { isHeadingTag } from "../book/segment.js";
import { TOC_ENTRY_CAP, tocTitle } from "../book/toc.js";
import { SOURCE_ATTRIBUTE } from "../reader/pictures.js";
import { allowedAttributes, decide } from "../reader/sanitize.js";
import { attributeOf, childrenOf, isElement, isText, nameOf, oneLine, textOf } from "./export-tree.js";

/** @typedef {import("./export-tree.js").ExportNode} ExportNode */
/** @typedef {import("../reader/pictures.js").PictureRow} PictureRow */

/**
 * One entry to write: its name, its bytes, and whether it is worth
 * deflating - the same shape the backup's archive hands the ZIP writer
 * (`articles-archive.js`).
 *
 * @typedef {{ name: string, data: Uint8Array, deflate: boolean }} ArchiveEntry
 */

/** What the file is, to the browser that downloads it and to whatever opens it. */
export const EPUB_MIME = "application/epub+zip";

/** The one entry every EPUB opens with: this string, stored, first. */
export const MIMETYPE_ENTRY = "mimetype";

/** Where everything but the container's own two files lives. */
const CONTENT_DIR = "OEBPS";

/**
 * The most a file name keeps of a title. Long enough for any honest title,
 * short enough that a title pasted from a page's `<title>` - the site's
 * name and a slogan behind the words - stays a name a file dialog shows
 * whole.
 */
export const FILENAME_LIMIT = 80;

/** What a document with no usable title is called. */
const FALLBACK_FILENAME = "reread-document";

/**
 * Characters no file name may hold on some file system a download lands
 * on: the path separators, the wildcards, the quotes and the control
 * characters (written as codes: an invisible character in a source file is
 * one nobody sees in a diff).
 */
const FILENAME_UNSAFE = new RegExp('[\\u0000-\\u001f\\u007f"*/:<>?\\\\|]+', "g");

/** The elements written without a closing tag - XML wants them closed on the spot. */
const VOID = new Set(["br", "hr", "img"]);

/**
 * The kinds a picture row may be, and the suffix each is written with -
 * the archive's own table (`articles-archive.js`), repeated rather than
 * imported so that this module needs nothing of the backup.
 */
const EXTENSIONS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
]);

/**
 * Where a link in the file may point: the two web schemes and mail, the
 * sanitizer's own list (`SAFE_SCHEMES`) - checked again here, because a
 * file that leaves this extension is opened by readers that follow links.
 */
const SAFE_LINK = /^(?:https?:|mailto:)/i;

/** The attributes that carry an address, each held to `SAFE_LINK`. */
const LINK_ATTRIBUTES = new Set(["href", "cite"]);

/** A language tag as BCP 47 spells it, near enough: `en`, `pt-BR`, `zh-Hant-TW`. */
const LANGUAGE_TAG = /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i;

/** The three values `dir` may take; anything else is no direction. */
const DIRECTIONS = new Set(["ltr", "rtl", "auto"]);

/** A book's id as the import writes it (`crypto.randomUUID`). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What XML 1.0 forbids in text and attributes: the control characters but
 * tab, newline and return, the surrogate range (a lone surrogate matches
 * here as a code point of its own), and the two non-characters at the end
 * of the basic plane. Written as codes, not literals.
 */
const XML_FORBIDDEN = new RegExp(
  "[^\\t\\n\\r\\u0020-\\uD7FF\\uE000-\\uFFFD\\u{10000}-\\u{10FFFF}]",
  "gu",
);

/**
 * The stylesheet every part links: a picture no wider than the screen, a
 * code block that wraps rather than runs off an e-ink page, the source
 * line of an article a little smaller than the text. Readers apply their
 * own type on top, which is the point of an EPUB.
 */
const STYLE = [
  "img { max-width: 100%; height: auto; }",
  "figure { margin: 1em 0; }",
  "figcaption { font-size: 0.9em; }",
  "pre { white-space: pre-wrap; }",
  ".doc-source { font-size: 0.9em; overflow-wrap: anywhere; }",
  "",
].join("\n");

/**
 * Text as XML wants it: the forbidden characters gone, the three that
 * open markup escaped. Nothing else is touched - a non-breaking space is
 * a character, and written as one.
 *
 * @param {string} value
 * @returns {string}
 */
export function xmlText(value) {
  return value
    .replace(XML_FORBIDDEN, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * An attribute value, always written in double quotes - so the one
 * character more to escape is the quote.
 *
 * @param {string} value
 * @returns {string}
 */
export function xmlAttribute(value) {
  return xmlText(value).replace(/"/g, "&quot;");
}

/**
 * What the file is called: the document's title, made a name any file
 * system takes - the unsafe characters gone, the whitespace one space,
 * nothing at the ends a file system would strip or refuse (a dot, a
 * space), and no longer than the limit. A title that leaves nothing gets
 * the fallback. No date and no prefix: the title is the name a reader
 * looks for on an e-reader's shelf, and a browser numbers a second download
 * by itself.
 *
 * @param {string} title
 * @param {"epub" | "md"} extension
 * @returns {string}
 */
export function documentFilename(title, extension) {
  const clean = title.replace(FILENAME_UNSAFE, " ").replace(/\s+/g, " ").trim();
  const cut = clean.length > FILENAME_LIMIT ? clean.slice(0, FILENAME_LIMIT) : clean;
  const name = cut.replace(/^[. ]+|[. ]+$/g, "");
  return `${name.length > 0 ? name : FALLBACK_FILENAME}.${extension}`;
}

/**
 * The package's unique identifier: an article's address, which is its key
 * in the database and the same in every export of it; a book's id as a
 * URN - the UUID the import gave it, or, for an id that is not one (a
 * hand-made backup can plant any string), a URN of this extension's own.
 * Stable on purpose: two exports of one document are one book to a reader
 * that keeps a library by identifier.
 *
 * @param {"article" | "book"} kind
 * @param {string} key the address, or the id
 * @returns {string}
 */
export function documentIdentifier(kind, key) {
  if (kind === "article") return key;
  return UUID.test(key) ? `urn:uuid:${key.toLowerCase()}` : `urn:reread:book:${key}`;
}

/**
 * The document's language as `dc:language` wants it, a BCP 47 tag; the
 * underscore some pages write (`en_US`) read as the hyphen it means. A
 * value that is no tag - or none at all - is `und`, the tag for
 * "undetermined": the element is required, and a guess would be a lie.
 *
 * @param {string | null | undefined} lang
 * @returns {string}
 */
export function languageTag(lang) {
  if (typeof lang !== "string") return "und";
  const tag = lang.trim().replace(/_/g, "-");
  return LANGUAGE_TAG.test(tag) ? tag : "und";
}

/**
 * The modification stamp the package must carry, in the one form the
 * specification allows (`CCYY-MM-DDThh:mm:ssZ`). The document's own clock -
 * when it was saved, or added - rather than the export's: two exports of
 * one document are then the same package, the promise every file this
 * extension writes keeps.
 *
 * @param {number} at a timestamp in milliseconds
 * @returns {string}
 */
export function modifiedStamp(at) {
  const date = new Date(Number.isFinite(at) && at > 0 ? at : 0);
  return `${date.toISOString().slice(0, 19)}Z`;
}

/**
 * One row of the table of contents: the heading's words, how deep it sits,
 * and where in the package it stands.
 *
 * @typedef {{ level: 1 | 2 | 3, title: string, href: string }} NavEntry
 */

/**
 * What the package says about the document, given once.
 *
 * @typedef {object} EpubMeta
 * @property {string} identifier as `documentIdentifier` answers
 * @property {string} title
 * @property {string | null} lang what the extractor said, or the book's; `und` when nothing
 * @property {string | null} dir the article's direction, or null
 * @property {string | null} [author] a book's, written as the creator
 * @property {string | null} [source] an article's address, written as the
 *   source and, at the head of the first part, as a line under the title
 * @property {number} modifiedAt the document's own clock
 * @property {Pick<PictureRow, "src" | "index" | "mime" | "data">[]} pictures
 *   the pictures the database keeps with the document, by the addresses
 *   its text asks for; the first row per address stands, as on screen
 * @property {string} contentsLabel what the table of contents is called, in
 *   the reader's language
 */

/**
 * One picture as the package holds it: the entry's name inside the content
 * directory, and the row whose bytes it is.
 *
 * @typedef {{ name: string, row: Pick<PictureRow, "src" | "index" | "mime" | "data"> }} PictureFile
 */

/**
 * What a walk over one part carries: the pictures by address, the ones the
 * text turned out to ask for (only those are written), the headings met so
 * far - or null when the part's rows of the contents were handed in and
 * the headings are not what is listed - the footnotes to stand at the
 * part's end, and an id waiting for the next element written (`anchored`).
 *
 * @typedef {{
 *   files: Map<string, PictureFile>,
 *   used: Set<string>,
 *   headings: Array<{ level: 1 | 2 | 3, title: string, id: string }> | null,
 *   notes: string[],
 *   anchor: string | null,
 * }} PartContext
 */

/**
 * A row of the contents a book already has (D277), as the part it lands in
 * is told of it: the words, the depth, and which of the part's top-level
 * blocks it stands on - the `blockIndex` of the book's own `TocEntry`.
 *
 * @typedef {{ title: string, level: 1 | 2 | 3, blockIndex: number }} PartRow
 */

/**
 * The package under construction: the parts go in one at a time, as the
 * reader page rebuilds them - a book of thirty parts never has thirty
 * trees standing at once - and the entries come out at the end. The
 * caller adds at least one part; a package with none names no text.
 *
 * The contents are the headings met on the way, unless the caller hands a
 * part its rows (D277): a book whose table came from the file it was
 * imported from lists chapters whose titles are plain paragraphs, which no
 * walk for headings would find - and what the reader shows as the book's
 * contents is what the file should hold. A part written with rows gives the
 * blocks they name an id apiece and lists those; its headings get none,
 * being listed already or not at all. The caller hands rows to every part
 * of a book or to none.
 *
 * @param {EpubMeta} meta
 * @returns {{ part: (root: ExportNode, rows?: PartRow[]) => void, entries: () => ArchiveEntry[] }}
 */
export function epubDocument(meta) {
  /** @type {Map<string, PictureFile>} */
  const files = new Map();
  for (const row of meta.pictures) {
    const extension = EXTENSIONS.get(row.mime);
    if (extension === undefined || files.has(row.src)) continue;
    files.set(row.src, { name: `images/${row.index}.${extension}`, row });
  }
  /** @type {Set<string>} */
  const used = new Set();
  /** @type {Array<{ name: string, xhtml: string }>} */
  const parts = [];
  /** @type {NavEntry[]} */
  const nav = [];

  return {
    part(root, rows) {
      const name = `text-${parts.length + 1}.xhtml`;
      /** @type {PartContext} */
      const context = { files, used, headings: rows === undefined ? [] : null, notes: [], anchor: null };
      let body = "";
      if (parts.length === 0 && typeof meta.source === "string") body += headBlock(meta.title, meta.source);
      body += rows === undefined ? writeChildren(root, context) : writeBlocks(root, rows, name, context, nav);
      body += notesBlock(context.notes);
      parts.push({ name, xhtml: partDocument(meta, body) });
      for (const heading of context.headings ?? []) {
        nav.push({ level: heading.level, title: heading.title, href: `${name}#${heading.id}` });
      }
    },

    entries() {
      const pictures = [...files.values()].filter((file) => used.has(file.row.src));
      const entries = nav.length > 0 ? nav.slice(0, TOC_ENTRY_CAP) : [fallbackEntry(meta, parts)];
      return [
        { name: MIMETYPE_ENTRY, data: encode(EPUB_MIME), deflate: false },
        { name: "META-INF/container.xml", data: encode(containerXml()), deflate: true },
        { name: `${CONTENT_DIR}/content.opf`, data: encode(packageOpf(meta, parts, pictures)), deflate: true },
        { name: `${CONTENT_DIR}/nav.xhtml`, data: encode(navXhtml(meta.contentsLabel, entries)), deflate: true },
        { name: `${CONTENT_DIR}/style.css`, data: encode(STYLE), deflate: true },
        ...parts.map((part) => ({ name: `${CONTENT_DIR}/${part.name}`, data: encode(part.xhtml), deflate: true })),
        ...pictures.map((file) => ({
          name: `${CONTENT_DIR}/${file.name}`,
          data: new Uint8Array(file.row.data),
          deflate: false,
        })),
      ];
    },
  };
}

/**
 * The one row a table of contents must have when the text has no heading
 * to list: the document itself, at its first part.
 *
 * @param {EpubMeta} meta
 * @param {Array<{ name: string }>} parts
 * @returns {NavEntry}
 */
function fallbackEntry(meta, parts) {
  return { level: 1, title: oneLine(meta.title) || meta.identifier, href: parts[0]?.name ?? "text-1.xhtml" };
}

/** @param {string} text @returns {Uint8Array} */
function encode(text) {
  return new TextEncoder().encode(text);
}

/**
 * @param {ExportNode} node
 * @param {PartContext} context
 * @returns {string}
 */
function writeChildren(node, context) {
  let out = "";
  for (const child of childrenOf(node)) out += writeNode(child, context);
  return out;
}

/**
 * A part's top-level blocks with the rows of the contents that stand on
 * them (D277): a block a row names is written with an id, and the row is
 * listed at that id. The blocks are counted the way the reader counts them
 * when a row is pressed - the root's element children, in order. A block
 * that writes no element to carry the id - a picture the database no
 * longer holds - leaves an empty `div` to carry it, so the row still leads
 * to where the block stood.
 *
 * @param {ExportNode} root
 * @param {PartRow[]} rows the rows that land in this part
 * @param {string} name the part's file name
 * @param {PartContext} context
 * @param {NavEntry[]} nav where the rows are listed
 * @returns {string}
 */
function writeBlocks(root, rows, name, context, nav) {
  let out = "";
  let blockIndex = -1;
  let anchors = 0;
  for (const child of childrenOf(root)) {
    if (isElement(child)) blockIndex += 1;
    const landing = isElement(child) ? rows.filter((row) => row.blockIndex === blockIndex) : [];
    if (landing.length === 0) {
      out += writeNode(child, context);
      continue;
    }
    anchors += 1;
    const id = `contents-${anchors}`;
    context.anchor = id;
    const written = writeNode(child, context);
    if (context.anchor !== null) {
      context.anchor = null;
      out += `<div id="${id}"></div>`;
    }
    out += written;
    for (const row of landing) nav.push({ level: row.level, title: row.title, href: `${name}#${id}` });
  }
  return out;
}

/**
 * The id waiting for the next element written, as the attribute it becomes -
 * taken once, by whichever element is written first.
 *
 * @param {PartContext} context
 * @returns {string} what follows the element's other attributes, leading space included
 */
function anchored(context) {
  if (context.anchor === null) return "";
  const id = context.anchor;
  context.anchor = null;
  return ` id="${xmlAttribute(id)}"`;
}

/**
 * One node as XHTML. The sanitizer's four answers again: a dropped element
 * writes nothing, an unwrapped one its children, a picture what
 * `writePicture` decides, a kept one itself with the attributes its own
 * list names. A footnote marker becomes a noteref, a heading gets the id
 * its row of the contents points at - and where the contents were handed
 * in instead (`writeBlocks`), the first element written takes the id that
 * is waiting.
 *
 * @param {ExportNode} node
 * @param {PartContext} context
 * @returns {string}
 */
function writeNode(node, context) {
  if (isText(node)) return xmlText(node.nodeValue ?? "");
  if (!isElement(node)) return "";
  const name = nameOf(node);
  const decision = decide(name);
  if (decision === "drop") return "";
  if (decision === "unwrap") return writeChildren(node, context);
  if (decision === "image") return writePicture(node, context);

  if (name === "a") {
    const note = attributeOf(node, "data-note");
    if (note !== null) {
      context.notes.push(note);
      const id = `note-${context.notes.length}`;
      return `<a epub:type="noteref" href="#${id}"${writeAttributes(node, name, ["href"])}${anchored(context)}>${writeChildren(node, context)}</a>`;
    }
  }

  let attributes = writeAttributes(node, name, []) + anchored(context);
  if (context.headings !== null && isHeadingTag(name)) {
    const title = tocTitle(textOf(node));
    if (title !== null) {
      const id = `heading-${context.headings.length + 1}`;
      context.headings.push({ level: /** @type {1 | 2 | 3} */ (Number(name.slice(1))), title, id });
      attributes += ` id="${id}"`;
    }
  }
  if (VOID.has(name)) return `<${name}${attributes}/>`;
  return `<${name}${attributes}>${writeChildren(node, context)}</${name}>`;
}

/**
 * The attributes the sanitizer allows the element, each asked for by name
 * and written only when it stands: an address held to the safe schemes
 * once more, `reversed` in the spelled-out form XML requires of a boolean
 * attribute, the footnote carrier never (it is the noteref's business).
 *
 * @param {ExportNode & { localName: string }} node
 * @param {string} name
 * @param {string[]} skipped attributes written by the caller itself
 * @returns {string} what follows the tag name, leading space included
 */
function writeAttributes(node, name, skipped) {
  let out = "";
  for (const attribute of allowedAttributes(name)) {
    if (attribute === "data-note" || skipped.includes(attribute)) continue;
    const value = attributeOf(node, attribute);
    if (value === null) continue;
    if (LINK_ATTRIBUTES.has(attribute) && !SAFE_LINK.test(value)) continue;
    if (attribute === "dir" && !DIRECTIONS.has(value.toLowerCase())) continue;
    const written = attribute === "reversed" ? "reversed" : attribute === "dir" ? value.toLowerCase() : value;
    out += ` ${attribute}="${xmlAttribute(written)}"`;
  }
  return out;
}

/**
 * A picture the package holds, or nothing: the text asks by the address
 * the rebuild kept (`data-src`), the database answers with a row or not,
 * and a picture the database does not hold is no element at all - a
 * reference to a file the archive lacks is what readers refuse whole
 * books over. `alt` always stands, empty when the page gave none.
 *
 * @param {ExportNode & { localName: string }} node
 * @param {PartContext} context
 * @returns {string}
 */
function writePicture(node, context) {
  const src = attributeOf(node, SOURCE_ATTRIBUTE);
  const file = src === null ? undefined : context.files.get(src);
  if (src === null || file === undefined) return "";
  context.used.add(src);
  const alt = attributeOf(node, "alt") ?? "";
  return `<img src="${xmlAttribute(file.name)}" alt="${xmlAttribute(alt)}"${writeAttributes(node, "img", ["alt"])}${anchored(context)}/>`;
}

/**
 * The head of an article's first part: its title, and where it came from.
 * The extractor leaves the title out of the text (the page's own heading
 * goes with the chrome), so a book file without this would open on the
 * first paragraph, nameless. The address stands as a link where a reader
 * can follow one and as words everywhere else; an address off the web
 * (`file:`) stands as words alone.
 *
 * @param {string} title
 * @param {string} source
 * @returns {string}
 */
function headBlock(title, source) {
  const address = SAFE_LINK.test(source)
    ? `<a href="${xmlAttribute(source)}">${xmlText(source)}</a>`
    : xmlText(source);
  return `<header class="doc-head">\n<h1 class="doc-title">${xmlText(oneLine(title))}</h1>\n<p class="doc-source">${address}</p>\n</header>\n`;
}

/**
 * The footnotes of one part, each an `aside` a noteref points at - EPUB
 * 3's own form, the one readers show as a popup.
 *
 * @param {string[]} notes
 * @returns {string}
 */
function notesBlock(notes) {
  return notes
    .map((note, at) => `\n<aside epub:type="footnote" id="note-${at + 1}"><p>${xmlText(oneLine(note))}</p></aside>`)
    .join("");
}

/**
 * One part as a whole XHTML document. The language and the direction ride
 * on the root, as they do on the reader's article element, and only when
 * they are worth writing: a tag that is no tag is left off rather than
 * written as `und` on every paragraph's ancestor.
 *
 * @param {EpubMeta} meta
 * @param {string} body
 * @returns {string}
 */
function partDocument(meta, body) {
  const tag = languageTag(meta.lang);
  const lang = tag === "und" ? "" : ` xml:lang="${xmlAttribute(tag)}" lang="${xmlAttribute(tag)}"`;
  const dir =
    typeof meta.dir === "string" && DIRECTIONS.has(meta.dir.toLowerCase())
      ? ` dir="${meta.dir.toLowerCase()}"`
      : "";
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"${lang}${dir}>`,
    "<head>",
    `<title>${xmlText(oneLine(meta.title))}</title>`,
    '<link rel="stylesheet" type="text/css" href="style.css"/>',
    "</head>",
    "<body>",
    body,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/**
 * The container: one line naming where the package document is.
 *
 * @returns {string}
 */
function containerXml() {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">',
    "<rootfiles>",
    `<rootfile full-path="${CONTENT_DIR}/content.opf" media-type="application/oebps-package+xml"/>`,
    "</rootfiles>",
    "</container>",
    "",
  ].join("\n");
}

/**
 * The package document: the three metadata fields EPUB 3 requires and the
 * stamp, the creator or the source where the document has one, every file
 * the container holds in the manifest, the parts in reading order in the
 * spine.
 *
 * @param {EpubMeta} meta
 * @param {Array<{ name: string }>} parts
 * @param {PictureFile[]} pictures the ones the text asked for
 * @returns {string}
 */
function packageOpf(meta, parts, pictures) {
  const lang = languageTag(meta.lang);
  const author = typeof meta.author === "string" && meta.author.length > 0 ? meta.author : null;
  const source = typeof meta.source === "string" && meta.source.length > 0 ? meta.source : null;
  const items = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
    ...parts.map((part, at) => `<item id="text-${at + 1}" href="${xmlAttribute(part.name)}" media-type="application/xhtml+xml"/>`),
    ...pictures.map(
      (file) =>
        `<item id="picture-${file.row.index}" href="${xmlAttribute(file.name)}" media-type="${xmlAttribute(file.row.mime)}"/>`,
    ),
  ];
  const spine = parts.map((_part, at) => `<itemref idref="text-${at + 1}"/>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="${xmlAttribute(lang)}">`,
    '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">',
    `<dc:identifier id="uid">${xmlText(meta.identifier)}</dc:identifier>`,
    `<dc:title>${xmlText(oneLine(meta.title))}</dc:title>`,
    `<dc:language>${xmlText(lang)}</dc:language>`,
    ...(author === null ? [] : [`<dc:creator>${xmlText(oneLine(author))}</dc:creator>`]),
    ...(source === null ? [] : [`<dc:source>${xmlText(source)}</dc:source>`]),
    `<meta property="dcterms:modified">${modifiedStamp(meta.modifiedAt)}</meta>`,
    "</metadata>",
    "<manifest>",
    ...items,
    "</manifest>",
    "<spine>",
    ...spine,
    "</spine>",
    "</package>",
    "",
  ].join("\n");
}

/**
 * The navigation document: the headings as a nested list, a deeper heading
 * inside the row of the one before it, a shallower one closing the rows
 * it stands above - the shape of a book's table of contents. A jump of
 * two levels nests one step, not two: a list nested inside nothing is a
 * list no reader shows.
 *
 * @param {string} label what the table of contents is called
 * @param {NavEntry[]} entries at least one
 * @returns {string}
 */
function navXhtml(label, entries) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">',
    "<head>",
    `<title>${xmlText(label)}</title>`,
    "</head>",
    "<body>",
    '<nav epub:type="toc" id="toc">',
    `<h1>${xmlText(label)}</h1>`,
    "<ol>",
    navItems(entries),
    "</ol>",
    "</nav>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/**
 * @param {NavEntry[]} entries
 * @returns {string}
 */
export function navItems(entries) {
  let out = "";
  /** @type {number[]} the level of every open row, outermost first */
  const open = [];
  for (const entry of entries) {
    const innermost = open[open.length - 1];
    if (innermost === undefined) {
      out += "<li>";
      open.push(entry.level);
    } else if (entry.level > innermost) {
      out += "<ol><li>";
      open.push(entry.level);
    } else {
      // Close the rows this one stands above, then stand beside the one
      // whose level matches - or, at the top, in its place.
      while (open.length > 1 && (open[open.length - 2] ?? 0) >= entry.level) {
        out += "</li></ol>";
        open.pop();
      }
      out += "</li><li>";
      open[open.length - 1] = entry.level;
    }
    out += `<a href="${xmlAttribute(entry.href)}">${xmlText(entry.title)}</a>`;
  }
  while (open.length > 1) {
    out += "</li></ol>";
    open.pop();
  }
  if (open.length === 1) out += "</li>";
  return out;
}
