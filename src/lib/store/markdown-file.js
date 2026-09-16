/**
 * The Markdown page a document travels out in (D229): one saved article or
 * one imported book as a plain-text file - readable as it is, and as a
 * page of headings, lists, quotes and links to anything that reads
 * Markdown. The highlights already leave this way (`marks-file.js`); this
 * is the whole text, in the same dress: the title as the heading, where it
 * came from and the day it entered under it, then the text.
 *
 * The input is the rebuilt tree (`export-tree.js` says how it is read):
 * our own allowed list of elements and nothing else, so every element has
 * one Markdown answer here, and the sanitizer's four decisions are asked
 * again for whatever is not on the list. Nothing here reads a DOM or a
 * database - the reader page hands the parts in (`src/reader/export-doc.js`)
 * and this module answers with text, under `node --test`.
 *
 * What the text keeps and what it lets go: headings, paragraphs, quotes,
 * code, emphasis, lists, definition lists, tables (as rows of cells - a
 * cell spanning columns is written once, in its own column), rules, line
 * breaks, links, and the pictures that have an address on the web (an
 * article's; a Markdown text's, since D230) - a book's pictures out of
 * its archive have no address anybody could follow, and are left out. A
 * footnote (`data-note`) becomes a Markdown footnote, the
 * marker a reference and the note a line at the end, the form the
 * readers that know footnotes at all agree on. The prose is escaped only
 * where a character would otherwise read as markup - a star, an
 * underscore, a bracket, a heading mark at the start of a line - so that
 * the file reads as the text and not as a page of backslashes.
 */

import { SOURCE_ATTRIBUTE } from "../reader/pictures.js";
import { decide } from "../reader/sanitize.js";
import { attributeOf, childrenOf, isElement, isText, nameOf, oneLine, textOf } from "./export-tree.js";

/** @typedef {import("./export-tree.js").ExportNode} ExportNode */

/** What the file is, to the browser that downloads it. */
export const MARKDOWN_MIME = "text/markdown";

/** The elements that start a line of their own; everything else is inline. */
const BLOCKS = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "blockquote", "pre", "hr", "div",
  "ul", "ol", "li", "dl", "dt", "dd",
  "figure", "figcaption",
  "table", "caption", "thead", "tbody", "tfoot", "tr", "th", "td",
]);

/** The inline elements written as emphasis, and the marks they wear. */
const EMPHASIS = new Map([
  ["em", "*"], ["i", "*"], ["cite", "*"], ["var", "*"],
  ["strong", "**"], ["b", "**"],
  ["s", "~~"], ["del", "~~"],
]);

/** The inline elements written as code. */
const CODE = new Set(["code", "kbd", "samp"]);

/** Where a link in the file may point - the sanitizer's own schemes, asked again. */
const SAFE_LINK = /^(?:https?:|mailto:)/i;

/** A picture's address worth writing: one on the web, which is what an article's is. */
const WEB_PICTURE = /^https:/i;

/**
 * A line break inside a paragraph, carried through the whitespace collapse
 * as a character no text holds (private use, written as a code) and
 * written out afterwards.
 */
const BREAK = String.fromCodePoint(0xe000);

/**
 * The characters that read as markup anywhere in a line: the escape
 * itself, the emphasis marks, the code mark, the link brackets.
 */
const INLINE_MARKUP = /[\\*_`[\]]/g;

/** A `<` that would open an HTML tag; `5 < 6` is left alone. */
const TAG_OPENING = /<(?=[A-Za-z/!?])/g;

/**
 * What reads as a block mark at the start of a line: a heading, a quote, a
 * bullet, a table row, a numbered item - each only when followed by a
 * space or the end, the way the grammar reads them.
 */
const LINE_MARKUP = /^(?:[#>+\-|]|\d+[.)])(?=\s|$)/;

/** What the file says about the document over the text. */

/**
 * @typedef {object} MarkdownMeta
 * @property {string} title
 * @property {string | null} source an article's address, a book's author - whichever it has
 * @property {number} at when the document entered the list
 */

/**
 * What a walk carries: the footnotes met so far (numbered across parts,
 * a book's notes are one list).
 *
 * @typedef {{ notes: string[] }} WalkContext
 */

/**
 * The page under construction: the parts go in one at a time, as the
 * reader page rebuilds them, and the text comes out at the end. The header
 * is written first; a footnote's line stands at the very end, after the
 * last part.
 *
 * @param {MarkdownMeta} meta
 * @returns {{ part: (root: ExportNode) => void, text: () => string }}
 */
export function markdownDocument(meta) {
  /** @type {WalkContext} */
  const context = { notes: [] };
  /** @type {string[]} */
  const blocks = [];
  return {
    part(root) {
      blocks.push(...blocksOf(childrenOf(root), context));
    },
    text() {
      const head = [`# ${escapeLine(oneLine(meta.title))}`];
      const where = meta.source === null || meta.source.length === 0 ? [] : [escapeText(oneLine(meta.source))];
      const when = Number.isFinite(meta.at) && meta.at > 0 ? [isoDay(meta.at)] : [];
      const detail = [...where, ...when].join(" - ");
      if (detail.length > 0) head.push(detail);
      const notes = context.notes.map((note, at) => `[^${at + 1}]: ${escapeText(oneLine(note))}`);
      return [...head, ...blocks, ...(notes.length > 0 ? [notes.join("\n")] : [])].join("\n\n") + "\n";
    },
  };
}

/**
 * A timestamp as the day it names, UTC - the highlights file's rule, for
 * the same reason: the same document makes the same file wherever it is
 * written.
 *
 * @param {number} at
 * @returns {string}
 */
function isoDay(at) {
  return new Date(at).toISOString().slice(0, 10);
}

/**
 * The blocks a run of siblings makes: every block element its own, and
 * the inline nodes between blocks gathered into paragraphs - the way a
 * browser lays out text standing loose beside a list.
 *
 * @param {ExportNode[]} nodes
 * @param {WalkContext} context
 * @returns {string[]} each block as text, no blank line at either end
 */
function blocksOf(nodes, context) {
  /** @type {string[]} */
  const blocks = [];
  /** @type {ExportNode[]} */
  let run = [];
  const flush = () => {
    if (run.length === 0) return;
    const text = paragraph(inlineOf(run, context));
    if (text.length > 0) blocks.push(text);
    run = [];
  };
  for (const node of nodes) {
    if (isBlock(node)) {
      flush();
      blocks.push(...blockOf(node, context));
    } else if (isUnwrapped(node) && holdsBlocks(node)) {
      // An element the allowed list unwraps (a section, a site's own tag)
      // standing over blocks: its blocks as if they stood here.
      flush();
      blocks.push(...blocksOf(childrenOf(node), context));
    } else {
      run.push(node);
    }
  }
  flush();
  return blocks;
}

/**
 * @param {ExportNode} node
 * @returns {boolean}
 */
function isUnwrapped(node) {
  return isElement(node) && decide(nameOf(node)) === "unwrap";
}

/**
 * @param {ExportNode} node
 * @returns {node is ExportNode & { localName: string, getAttribute: (name: string) => string | null }}
 */
function isBlock(node) {
  return isElement(node) && BLOCKS.has(nameOf(node));
}

/**
 * Whether an element holds blocks of its own - a paragraph inside a list
 * item, a figure's caption - or inline text alone.
 *
 * @param {ExportNode} node
 * @returns {boolean}
 */
function holdsBlocks(node) {
  return childrenOf(node).some((child) => isBlock(child) || (isUnwrapped(child) && holdsBlocks(child)));
}

/**
 * One block element as Markdown - one block, or several where the element
 * holds several (a division of paragraphs), or none where it has no words.
 *
 * @param {ExportNode & { localName: string }} node
 * @param {WalkContext} context
 * @returns {string[]}
 */
function blockOf(node, context) {
  const name = nameOf(node);
  switch (name) {
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const text = inlineOf(childrenOf(node), context, true);
      return text.length === 0 ? [] : [`${"#".repeat(Number(name.slice(1)))} ${text}`];
    }
    case "blockquote":
      return [quoted(container(node, context))].filter((block) => block.length > 0);
    case "pre":
      return [fenced(textOf(node))];
    case "hr":
      return ["---"];
    case "ul":
    case "ol":
      return [list(node, context)].filter((block) => block.length > 0);
    case "dl":
      return [definitions(node, context)].filter((block) => block.length > 0);
    case "figcaption":
    case "caption": {
      const text = inlineOf(childrenOf(node), context, true);
      return text.length === 0 ? [] : [`*${text}*`];
    }
    case "table":
      return table(node, context);
    default:
      // A paragraph, a division, a list item met loose, a table's part met
      // loose: the blocks it holds, or its text as one paragraph.
      return container(node, context);
  }
}

/**
 * An element's contents as blocks: its own blocks where it holds any,
 * otherwise its inline text as one paragraph.
 *
 * @param {ExportNode} node
 * @param {WalkContext} context
 * @returns {string[]}
 */
function container(node, context) {
  if (holdsBlocks(node)) return blocksOf(childrenOf(node), context);
  const text = paragraph(inlineOf(childrenOf(node), context));
  return text.length === 0 ? [] : [text];
}

/**
 * Blocks under a quote mark, every line - a blank line between two blocks
 * of one quote keeps the mark, so the quote stays one to a reader.
 *
 * @param {string[]} blocks
 * @returns {string}
 */
function quoted(blocks) {
  return blocks
    .join("\n\n")
    .split("\n")
    .map((line) => (line.length === 0 ? ">" : `> ${line}`))
    .join("\n");
}

/**
 * A code block: the text as it stands, inside a fence longer than any run
 * of fence characters in it.
 *
 * @param {string} text
 * @returns {string}
 */
function fenced(text) {
  const body = text.replace(/^\n/, "").replace(/\n$/, "");
  let longest = 2;
  for (const run of body.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  const fence = "`".repeat(longest + 1);
  return `${fence}\n${body}\n${fence}`;
}

/**
 * A list, item by item: a bullet or a number before the item's first
 * block, its other blocks under it, indented to the width of the mark -
 * a nested list right under its item's line, a second paragraph after a
 * blank one, as the grammar wants each. A numbered list starts where the
 * page said it does.
 *
 * @param {ExportNode & { localName: string }} node
 * @param {WalkContext} context
 * @returns {string}
 */
function list(node, context) {
  const ordered = nameOf(node) === "ol";
  const start = Number.parseInt(attributeOf(node, "start") ?? "1", 10);
  let number = Number.isFinite(start) ? start : 1;
  /** @type {string[]} */
  const items = [];
  for (const child of childrenOf(node)) {
    if (!isElement(child)) continue;
    const blocks = nameOf(child) === "li" ? container(child, context) : blockOf(child, context);
    const mark = ordered ? `${number}. ` : "- ";
    if (ordered) number += 1;
    items.push(listItem(mark, blocks));
  }
  return items.join("\n");
}

/**
 * @param {string} mark
 * @param {string[]} blocks
 * @returns {string}
 */
function listItem(mark, blocks) {
  if (blocks.length === 0) return mark.trimEnd();
  const indent = " ".repeat(mark.length);
  let out = "";
  for (const [at, block] of blocks.entries()) {
    if (at > 0) out += /^(?:- |\d+\. )/.test(block) ? "\n" : "\n\n";
    out += block;
  }
  return mark + out.split("\n").map((line, at) => (at === 0 || line.length === 0 ? line : indent + line)).join("\n");
}

/**
 * A definition list in the form the extensions that know one agree on:
 * the term on a line, each definition under it after a colon. Two groups
 * stand a blank line apart.
 *
 * @param {ExportNode} node
 * @param {WalkContext} context
 * @returns {string}
 */
function definitions(node, context) {
  /** @type {string[]} */
  const lines = [];
  for (const child of childrenOf(node)) {
    if (!isElement(child)) continue;
    const name = nameOf(child);
    if (name === "dt") {
      const term = inlineOf(childrenOf(child), context, true);
      if (term.length === 0) continue;
      if (lines.length > 0) lines.push("");
      lines.push(escapeLine(term));
    } else if (name === "dd") {
      const text = container(child, context).join("\n\n");
      if (text.length === 0) continue;
      lines.push(...text.split("\n").map((line, at) => (at === 0 ? `: ${line}` : `  ${line}`)));
    } else {
      // A wrapper around a group (`div` inside `dl` is allowed HTML): its
      // rows as if they stood here.
      const inner = definitions(child, context);
      if (inner.length > 0) lines.push(...(lines.length > 0 ? [""] : []), inner);
    }
  }
  return lines.join("\n");
}

/**
 * A table as rows of cells between bars, the first row taken as the head
 * because the grammar wants one; the caption stands over it in italics.
 * Cells hold one line each - a break inside a cell is a space - and a
 * bar in a cell's words is escaped so it does not read as a column.
 *
 * @param {ExportNode} node
 * @param {WalkContext} context
 * @returns {string[]}
 */
function table(node, context) {
  /** @type {string[]} */
  const blocks = [];
  /** @type {string[][]} */
  const rows = [];
  /** @param {ExportNode} parent */
  const collectRows = (parent) => {
    for (const child of childrenOf(parent)) {
      if (!isElement(child)) continue;
      const name = nameOf(child);
      if (name === "caption") {
        blocks.push(...blockOf(child, context));
      } else if (name === "tr") {
        rows.push(
          childrenOf(child)
            .filter((cell) => isElement(cell) && (nameOf(cell) === "td" || nameOf(cell) === "th"))
            .map((cell) => inlineOf(childrenOf(cell), context, true).replace(/\|/g, "\\|")),
        );
      } else if (name === "thead" || name === "tbody" || name === "tfoot") {
        collectRows(child);
      }
    }
  };
  collectRows(node);
  const width = Math.max(0, ...rows.map((row) => row.length));
  if (width === 0) return blocks;
  const line = (/** @type {string[]} */ cells) =>
    `| ${Array.from({ length: width }, (_cell, at) => cells[at] ?? "").join(" | ")} |`;
  const [head, ...body] = rows;
  blocks.push([line(head ?? []), `| ${Array(width).fill("---").join(" | ")} |`, ...body.map(line)].join("\n"));
  return blocks;
}

/**
 * A run of inline nodes as one line of Markdown, whitespace collapsed the
 * way a browser lays it out: runs of it as one space, none at the ends,
 * a non-breaking space kept as the character it is. A line break stands
 * as a backslash before the newline - or, in a heading and a cell, as a
 * space, because those hold one line.
 *
 * @param {ExportNode[]} nodes
 * @param {WalkContext} context
 * @param {boolean} [single] whether the run must stay one line
 * @returns {string}
 */
function inlineOf(nodes, context, single = false) {
  let out = "";
  for (const node of nodes) out += inlineNode(node, context);
  const collapsed = out.replace(/[ \t\r\n\f]+/g, " ");
  const broken = collapsed
    .split(BREAK)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0)
    .join(single ? " " : "\\\n");
  return broken.trim();
}

/**
 * @param {ExportNode} node
 * @param {WalkContext} context
 * @returns {string}
 */
function inlineNode(node, context) {
  if (isText(node)) return escapeText(node.nodeValue ?? "");
  if (!isElement(node)) return "";
  const name = nameOf(node);
  const decision = decide(name);
  if (decision === "drop") return "";
  if (decision === "image") return picture(node, context);
  if (decision === "unwrap") return inlineChildren(node, context);

  if (name === "br") return BREAK;
  if (name === "a") return link(node, context);
  if (CODE.has(name)) return codeSpan(oneLine(textOf(node)));
  if (name === "q") return `"${inlineChildren(node, context).trim()}"`;
  const mark = EMPHASIS.get(name);
  if (mark !== undefined) return emphasis(mark, inlineChildren(node, context));
  // A block element met inline (a division inside a paragraph, which the
  // parser does not make but a hand-built tree might): its words, as
  // words. Every other inline element - a span, an abbreviation, a
  // superscript - is its text.
  return inlineChildren(node, context);
}

/**
 * @param {ExportNode} node
 * @param {WalkContext} context
 * @returns {string}
 */
function inlineChildren(node, context) {
  let out = "";
  for (const child of childrenOf(node)) out += inlineNode(child, context);
  return out;
}

/**
 * Emphasis around the words alone: the spaces the element held at its
 * edges move outside the marks, where the grammar wants them, and an
 * element of nothing but air is nothing.
 *
 * @param {string} mark
 * @param {string} inner
 * @returns {string}
 */
function emphasis(mark, inner) {
  const words = inner.replace(new RegExp(`^[ \\t\\r\\n\\f${BREAK}]+|[ \\t\\r\\n\\f${BREAK}]+$`, "g"), "");
  if (words.length === 0) return inner;
  const before = /^[ \t\r\n\f]/.test(inner) ? " " : "";
  const after = /[ \t\r\n\f]$/.test(inner) ? " " : "";
  return `${before}${mark}${words}${mark}${after}`;
}

/**
 * A span of code: the text as it is - no escaping inside code - between
 * more backticks than any run it holds, and padded with a space where the
 * text starts or ends with one.
 *
 * @param {string} text
 * @returns {string}
 */
function codeSpan(text) {
  if (text.length === 0) return "";
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  const ticks = "`".repeat(longest + 1);
  const padded = text.startsWith("`") || text.endsWith("`") ? ` ${text} ` : text;
  return `${ticks}${padded}${ticks}`;
}

/**
 * A link: a footnote marker becomes the reference of a footnote (the note
 * stands at the file's end), a link to the web the words with the address
 * behind them, and a link to nowhere its words.
 *
 * @param {ExportNode & { localName: string }} node
 * @param {WalkContext} context
 * @returns {string}
 */
function link(node, context) {
  const note = attributeOf(node, "data-note");
  if (note !== null) {
    context.notes.push(note);
    return `[^${context.notes.length}]`;
  }
  const inner = inlineChildren(node, context);
  const href = attributeOf(node, "href");
  if (href === null || !SAFE_LINK.test(href)) return inner;
  const words = inner.trim();
  if (words.length === 0) return inner;
  const before = /^[ \t\r\n\f]/.test(inner) ? " " : "";
  const after = /[ \t\r\n\f]$/.test(inner) ? " " : "";
  return `${before}[${words}](${linkTarget(href)})${after}`;
}

/**
 * A picture by its address on the web, or nothing: an article's pictures
 * are on their servers, a Markdown text's were written as addresses, and
 * a reader of the file can fetch either; a book's out of its archive are
 * paths inside a file nobody has, and no picture at all.
 *
 * @param {ExportNode & { localName: string }} node
 * @param {WalkContext} context
 * @returns {string}
 */
function picture(node, context) {
  const src = attributeOf(node, SOURCE_ATTRIBUTE);
  if (src === null || !WEB_PICTURE.test(src)) return "";
  const alt = oneLine(attributeOf(node, "alt") ?? "");
  return ` ![${escapeText(alt)}](${linkTarget(src)}) `;
}

/**
 * An address as a link's target: a parenthesis or a space in it would
 * close or break the target, so each is written as its escape - the
 * characters `encodeURIComponent` leaves alone, spelled out here.
 *
 * @param {string} address
 * @returns {string}
 */
function linkTarget(address) {
  return address.replace(/[()\s]/g, (character) =>
    character === "(" ? "%28" : character === ")" ? "%29" : encodeURIComponent(character),
  );
}

/**
 * Prose escaped where a character would read as markup - inside a line
 * only; what a line may start with is `escapeLine`'s business, once the
 * line stands.
 *
 * @param {string} text
 * @returns {string}
 */
function escapeText(text) {
  return text.replace(INLINE_MARKUP, "\\$&").replace(TAG_OPENING, "\\<");
}

/**
 * A line's first characters, escaped where they would open a block: a
 * heading mark, a quote mark, a bullet, a table bar, a number and its dot.
 *
 * @param {string} line
 * @returns {string}
 */
function escapeLine(line) {
  return line.replace(LINE_MARKUP, (mark) => (/^\d/.test(mark) ? `${mark.slice(0, -1)}\\${mark.slice(-1)}` : `\\${mark}`));
}

/**
 * Inline text as a paragraph: every line of it (a break makes more than
 * one) held to `escapeLine`.
 *
 * @param {string} text
 * @returns {string}
 */
function paragraph(text) {
  return text.split("\n").map(escapeLine).join("\n");
}
