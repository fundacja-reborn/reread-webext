/**
 * A Markdown text read into this extension's own markup (D230): the road a
 * plain-text file takes into the reading list, where it becomes a book -
 * cut into parts, its headings the table of contents, its footnotes the
 * popups - the way an EPUB does. The one thing an EPUB has and this has
 * not is an address for its pictures inside the file: a Markdown text's
 * pictures are addresses on the web, kept as such and fetched by nothing
 * here.
 *
 * Our own parser rather than a vendored one, for the reason every
 * dependency of this extension is refused until it earns its place: the
 * package has to be readable, and a Markdown library is tens of thousands
 * of lines for a job whose useful half fits in this file. What is read is
 * CommonMark as people write it - headings of both kinds, paragraphs with
 * hard and soft breaks, quotes, fenced and indented code, bullet and
 * numbered lists nested by indentation, thematic breaks, links of every
 * shape (inline, reference, angle-bracket and bare URL), images, emphasis
 * with the flanking rules and the rule of three, code spans, backslash
 * escapes, entity references, raw HTML - plus the extensions the notes
 * apps agree on: tables, strikethrough, footnotes, a front matter block,
 * and the double-bracket links of Obsidian read as the words they show.
 * What is not read is read as text: nothing here is ever lost, only
 * left unformatted.
 *
 * The output is the closed markup every render of this extension knows,
 * as a string; the reader page parses it inert and rebuilds it through the
 * allowed list (`lib/reader/article.js`) like everything else - which is
 * also why raw HTML in the text is passed through untouched here: the
 * sanitizer is the barrier, not this parser, and a `<script>` in a note
 * meets the same wall a page's does.
 *
 * Pure over strings, so that every rule runs under `node --test`.
 */

import { cleanNoteText } from "./notes.js";

/**
 * What a text came to: its markup, and what its front matter or its first
 * heading said about it - a title (the first block, when it is a level-one
 * heading, is the title and leaves the text: the reader shows the title
 * over the text already), an author, a language. Null where the text said
 * nothing; the caller has the file's name for the title.
 *
 * @typedef {{ html: string, title: string | null, author: string | null, lang: string | null }} ParsedMarkdown
 */

/**
 * @typedef {{ type: "heading", level: number, text: string }
 *   | { type: "paragraph", text: string }
 *   | { type: "code", text: string }
 *   | { type: "hr" }
 *   | { type: "html", raw: string }
 *   | { type: "quote", children: Block[] }
 *   | { type: "list", ordered: boolean, start: number, tight: boolean, items: Block[][] }
 *   | { type: "table", head: string[], rows: string[][] }} Block
 */

/**
 * The definitions a text carries for its references: link labels to their
 * addresses, footnote ids to their text. Collected as the blocks are read,
 * consulted as the inline text is - a definition may stand after its use.
 *
 * @typedef {{ links: Map<string, string>, notes: Map<string, string> }} Definitions
 */

/**
 * @typedef {{ type: "text", value: string }
 *   | { type: "code", value: string }
 *   | { type: "html", value: string }
 *   | { type: "br" }
 *   | { type: "softbreak" }
 *   | { type: "link", href: string, children: Inline[] }
 *   | { type: "image", src: string, alt: string }
 *   | { type: "em" | "strong" | "del", children: Inline[] }
 *   | { type: "note", number: number, text: string }
 *   | { type: "delim", char: string, count: number, canOpen: boolean, canClose: boolean }
 *   | { type: "bracket", image: boolean, active: boolean, at: number }} Inline
 */

/**
 * What a walk over the inline text carries: the definitions, the footnotes
 * in the order they are first referred to (their numbers), and whether the
 * walk is inside a footnote's own text - where a footnote reference is
 * words, not another footnote.
 *
 * @typedef {{
 *   definitions: Definitions,
 *   noteNumbers: Map<string, number>,
 *   noteTexts: Map<string, string>,
 *   inNote: boolean,
 * }} InlineContext
 */

const BLANK = /^[ \t]*$/;
const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>/;
const QUOTE_MARK = /^ {0,3}> ?/;
const LIST_ITEM = /^( {0,3})([-+*]|\d{1,9}[.)])( +|$)/;
const INDENTED = /^ {4}/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const NOTE_DEFINITION = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]*(.*)$/;
const LINK_DEFINITION =
  /^ {0,3}\[((?:[^\]\\]|\\.){1,999})\]:[ \t]*(?:<([^<>\n]*)>|(\S+))(?:[ \t]+(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^)\\]|\\.)*\)))?[ \t]*$/;
const TABLE_DELIMITER = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const FRONT_MATTER_END = /^(?:---|\.\.\.)[ \t]*$/;
const FRONT_MATTER_FIELD = /^(title|author|lang|language):[ \t]*(.+?)[ \t]*$/i;

/**
 * A line that opens a block of its own - what ends a paragraph, and what a
 * lazy continuation line may not be. The block-level tags are the ones the
 * grammar lists for HTML blocks; a line opening with an inline tag (`<b>`)
 * is a paragraph with markup in it.
 */
const HTML_BLOCK =
  /^ {0,3}<(?:\/?(?:address|article|aside|blockquote|body|caption|center|col|colgroup|dd|details|dialog|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|head|header|hr|html|iframe|img|legend|li|link|main|menu|nav|ol|optgroup|option|p|param|picture|pre|script|section|source|style|summary|table|tbody|td|textarea|tfoot|th|thead|title|tr|track|ul)(?:[ \t/>]|$)|!--)/i;

/** @param {string} line @returns {boolean} */
function startsBlock(line) {
  return (
    FENCE_OPEN.test(line) ||
    ATX.test(line) ||
    HR.test(line) ||
    QUOTE.test(line) ||
    LIST_ITEM.test(line) ||
    HTML_BLOCK.test(line)
  );
}

/**
 * The text as markup, with what it said about itself.
 *
 * @param {string} text the file's content
 * @returns {ParsedMarkdown}
 */
export function parseMarkdown(text) {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  const front = frontMatter(lines);
  /** @type {Definitions} */
  const definitions = { links: new Map(), notes: new Map() };
  const blocks = parseBlocks(front === null ? lines : lines.slice(front.end), definitions);
  /** @type {InlineContext} */
  const context = { definitions, noteNumbers: new Map(), noteTexts: new Map(), inNote: false };

  let title = front?.title ?? null;
  const first = blocks[0];
  if (first !== undefined && first.type === "heading" && first.level === 1) {
    const words = plainText(parseInline(first.text, context)).trim();
    if (words.length > 0) {
      title = words;
      blocks.shift();
    }
  }
  return {
    html: renderBlocks(blocks, context, false),
    title,
    author: front?.author ?? null,
    lang: front?.lang ?? null,
  };
}

/**
 * The front matter the notes apps and the site generators put first: a
 * `---` fence on the first line, `key: value` lines, a closing fence -
 * read for the three fields worth a book's row, and left out of the text
 * (a reader wants the note, not its metadata). A text that opens with a
 * rule and never closes one, or closes it over no field at all, has no
 * front matter: the lines are content.
 *
 * @param {string[]} lines
 * @returns {{ title: string | null, author: string | null, lang: string | null, end: number } | null}
 *   `end` is the index of the first line after the block
 */
function frontMatter(lines) {
  if (lines[0]?.trim() !== "---") return null;
  const found = { title: /** @type {string | null} */ (null), author: /** @type {string | null} */ (null), lang: /** @type {string | null} */ (null) };
  let fields = 0;
  for (let at = 1; at < Math.min(lines.length, 60); at += 1) {
    const line = lines[at] ?? "";
    if (FRONT_MATTER_END.test(line)) return fields === 0 ? null : { ...found, end: at + 1 };
    const field = FRONT_MATTER_FIELD.exec(line);
    if (field === null) continue;
    fields += 1;
    const value = (field[2] ?? "").replace(/^(["'])(.*)\1$/, "$2").trim();
    if (value.length === 0) continue;
    const key = (field[1] ?? "").toLowerCase();
    if (key === "title") found.title = value;
    else if (key === "author") found.author = value;
    else found.lang = value;
  }
  return null;
}

/**
 * The blocks of a run of lines, read top to bottom: each construct claims
 * the lines it owns, the containers (a quote, a list item) hand theirs
 * back here with the container's mark taken off. Definitions are kept
 * aside as they are met and produce no block.
 *
 * @param {string[]} lines
 * @param {Definitions} definitions
 * @returns {Block[]}
 */
function parseBlocks(lines, definitions) {
  /** @type {Block[]} */
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (BLANK.test(line)) {
      i += 1;
      continue;
    }

    const fence = FENCE_OPEN.exec(line);
    if (fence !== null && (fence[2]?.[0] !== "`" || !(fence[3] ?? "").includes("`"))) {
      const indent = (fence[1] ?? "").length;
      const marker = fence[2] ?? "```";
      const strip = new RegExp(`^ {0,${indent}}`);
      /** @type {string[]} */
      const content = [];
      i += 1;
      while (i < lines.length) {
        const current = lines[i] ?? "";
        const close = FENCE_CLOSE.exec(current);
        if (close !== null && close[1]?.[0] === marker[0] && (close[1] ?? "").length >= marker.length) {
          i += 1;
          break;
        }
        content.push(current.replace(strip, ""));
        i += 1;
      }
      blocks.push({ type: "code", text: content.join("\n") });
      continue;
    }

    if (HTML_BLOCK.test(line)) {
      /** @type {string[]} */
      const raw = [];
      while (i < lines.length && !BLANK.test(lines[i] ?? "")) {
        raw.push(lines[i] ?? "");
        i += 1;
      }
      blocks.push({ type: "html", raw: raw.join("\n") });
      continue;
    }

    const atx = ATX.exec(line);
    if (atx !== null) {
      blocks.push({ type: "heading", level: (atx[1] ?? "#").length, text: (atx[2] ?? "").trim() });
      i += 1;
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      /** @type {string[]} */
      const inner = [];
      while (i < lines.length) {
        const current = lines[i] ?? "";
        if (QUOTE.test(current)) {
          inner.push(current.replace(QUOTE_MARK, ""));
          i += 1;
          continue;
        }
        // A paragraph inside the quote may go on without the mark (the
        // grammar's lazy continuation); a new block may not.
        const last = inner[inner.length - 1];
        if (
          !BLANK.test(current) &&
          last !== undefined &&
          !BLANK.test(last) &&
          !startsBlock(last) &&
          !startsBlock(current)
        ) {
          inner.push(current);
          i += 1;
          continue;
        }
        break;
      }
      blocks.push({ type: "quote", children: parseBlocks(inner, definitions) });
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item !== null) {
      i = parseList(lines, i, item, blocks, definitions);
      continue;
    }

    if (INDENTED.test(line)) {
      /** @type {string[]} */
      const content = [];
      while (i < lines.length && (INDENTED.test(lines[i] ?? "") || BLANK.test(lines[i] ?? ""))) {
        content.push((lines[i] ?? "").replace(/^ {1,4}/, ""));
        i += 1;
      }
      while (content.length > 0 && BLANK.test(content[content.length - 1] ?? "")) content.pop();
      blocks.push({ type: "code", text: content.join("\n") });
      continue;
    }

    const note = NOTE_DEFINITION.exec(line);
    if (note !== null) {
      const text = [note[2] ?? ""];
      i += 1;
      // The note goes on over indented lines, and over lines of a
      // paragraph that simply continues; a blank line before an
      // unindented one ends it.
      while (i < lines.length) {
        const current = lines[i] ?? "";
        if (BLANK.test(current)) {
          const next = lines[i + 1] ?? "";
          if (/^ {2}/.test(next) && !BLANK.test(next)) {
            text.push("");
            i += 1;
            continue;
          }
          break;
        }
        if (/^ {2}/.test(current)) {
          text.push(current.replace(/^ {1,4}/, ""));
          i += 1;
          continue;
        }
        const last = text[text.length - 1] ?? "";
        if (!BLANK.test(last) && !startsBlock(current) && NOTE_DEFINITION.exec(current) === null) {
          text.push(current.trim());
          i += 1;
          continue;
        }
        break;
      }
      definitions.notes.set(note[1] ?? "", text.join("\n"));
      continue;
    }

    const definition = LINK_DEFINITION.exec(line);
    if (definition !== null) {
      const label = normalizeLabel(definition[1] ?? "");
      if (!definitions.links.has(label)) {
        definitions.links.set(label, unescape(definition[2] ?? definition[3] ?? ""));
      }
      i += 1;
      continue;
    }

    const next = lines[i + 1];
    if (line.includes("|") && next !== undefined && TABLE_DELIMITER.test(next)) {
      const head = splitRow(line);
      if (head.length === splitRow(next).length) {
        /** @type {string[][]} */
        const rows = [];
        i += 2;
        while (i < lines.length && !BLANK.test(lines[i] ?? "") && !startsBlock(lines[i] ?? "")) {
          const cells = splitRow(lines[i] ?? "");
          rows.push(head.map((_cell, at) => cells[at] ?? ""));
          i += 1;
        }
        blocks.push({ type: "table", head, rows });
        continue;
      }
    }

    // A paragraph: the lines up to a blank one or the start of another
    // block - or a setext underline, which makes the paragraph a heading.
    /** @type {string[]} */
    const text = [line.replace(/^[ \t]+/, "")];
    i += 1;
    let heading = 0;
    while (i < lines.length) {
      const current = lines[i] ?? "";
      if (BLANK.test(current)) break;
      const setext = SETEXT.exec(current);
      if (setext !== null) {
        heading = setext[1]?.[0] === "=" ? 1 : 2;
        i += 1;
        break;
      }
      if (startsBlock(current)) break;
      text.push(current.replace(/^[ \t]+/, ""));
      i += 1;
    }
    const joined = text.join("\n").replace(/[ \t]+$/, "");
    blocks.push(heading === 0 ? { type: "paragraph", text: joined } : { type: "heading", level: heading, text: joined.trim() });
  }
  return blocks;
}

/**
 * A list from its first item on: every item of the same kind - the same
 * bullet, or numbers with the same delimiter - with the lines indented to
 * its content, read as blocks of their own. Loose (every paragraph its
 * own) when a blank line stands between two items or inside one between
 * two blocks, tight otherwise: the grammar's rule, and what makes a
 * shopping list read as a list and an outline as paragraphs.
 *
 * @param {string[]} lines
 * @param {number} from the index of the first item's line
 * @param {RegExpExecArray} first the first item's marker match
 * @param {Block[]} blocks where the list goes
 * @param {Definitions} definitions
 * @returns {number} the index of the first line after the list
 */
function parseList(lines, from, first, blocks, definitions) {
  const ordered = /^\d/.test(first[2] ?? "");
  const kind = ordered ? (first[2] ?? ".").slice(-1) : (first[2] ?? "-");
  const start = ordered ? Number.parseInt(first[2] ?? "1", 10) : 1;
  /** @type {Block[][]} */
  const items = [];
  let loose = false;
  let i = from;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const match = LIST_ITEM.exec(line);
    if (match === null || HR.test(line)) break;
    const marker = match[2] ?? "";
    const sameKind = ordered ? /^\d/.test(marker) && marker.slice(-1) === kind : marker === kind;
    if (!sameKind) break;

    const indent = (match[1] ?? "").length;
    const spaces = (match[3] ?? "").length;
    const rest = line.slice(indent + marker.length + spaces);
    // Five or more spaces after the marker start an indented code block
    // one column in; an empty item has nothing to measure by.
    const contentIndent = indent + marker.length + (spaces === 0 || spaces >= 5 ? 1 : spaces);
    /** @type {string[]} */
    const itemLines = [spaces >= 5 ? " ".repeat(spaces - 1) + rest : rest];
    i += 1;
    while (i < lines.length) {
      const current = lines[i] ?? "";
      if (BLANK.test(current)) {
        itemLines.push("");
        i += 1;
        continue;
      }
      const currentIndent = (/^ */.exec(current)?.[0] ?? "").length;
      if (currentIndent >= contentIndent) {
        itemLines.push(current.slice(contentIndent));
        i += 1;
        continue;
      }
      const last = itemLines[itemLines.length - 1] ?? "";
      if (!BLANK.test(last) && !startsBlock(last) && !startsBlock(current) && LIST_ITEM.exec(current) === null) {
        // A paragraph inside the item going on unindented: the grammar's
        // lazy continuation.
        itemLines.push(current.replace(/^ +/, ""));
        i += 1;
        continue;
      }
      break;
    }
    let trailing = 0;
    while (itemLines.length > 0 && BLANK.test(itemLines[itemLines.length - 1] ?? "")) {
      itemLines.pop();
      trailing += 1;
    }
    // A blank line before the next item of this list makes it loose; one
    // before an item of another kind ends this list tight.
    const following = LIST_ITEM.exec(lines[i] ?? "");
    const followingMarker = following?.[2] ?? "";
    const continues = following !== null && !HR.test(lines[i] ?? "") && (ordered ? /^\d/.test(followingMarker) && followingMarker.slice(-1) === kind : followingMarker === kind);
    if (trailing > 0 && continues) loose = true;
    if (holdsBlankBetweenBlocks(itemLines)) loose = true;
    items.push(parseBlocks(itemLines, definitions));
  }
  blocks.push({ type: "list", ordered, start: Number.isFinite(start) ? start : 1, tight: !loose, items });
  return i;
}

/**
 * Whether an item's lines hold a blank line with content on both sides -
 * outside a fenced code block, whose blank lines are code.
 *
 * @param {string[]} lines
 * @returns {boolean}
 */
function holdsBlankBetweenBlocks(lines) {
  let fence = /** @type {string | null} */ (null);
  let seenContent = false;
  let blankAfterContent = false;
  for (const line of lines) {
    if (fence === null) {
      const open = FENCE_OPEN.exec(line);
      if (open !== null) fence = open[2] ?? "```";
    } else {
      const close = FENCE_CLOSE.exec(line);
      if (close !== null && close[1]?.[0] === fence[0] && (close[1] ?? "").length >= fence.length) fence = null;
      seenContent = true;
      continue;
    }
    if (BLANK.test(line)) {
      if (seenContent) blankAfterContent = true;
    } else {
      if (blankAfterContent) return true;
      seenContent = true;
    }
  }
  return false;
}

/**
 * A table row as its cells: the outer bars off, the inner ones the
 * separators - unless escaped, which the inline pass reads as a bar.
 *
 * @param {string} line
 * @returns {string[]}
 */
function splitRow(line) {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  return row.split(/(?<!\\)\|/).map((cell) => cell.trim());
}

/**
 * A reference label as the definitions are keyed: case and runs of
 * whitespace folded, the grammar's rule.
 *
 * @param {string} label
 * @returns {string}
 */
function normalizeLabel(label) {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

/** A backslash before ASCII punctuation is the punctuation. */
const ESCAPED = /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g;

/** @param {string} value @returns {string} */
function unescape(value) {
  return value.replace(ESCAPED, "$1");
}

/**
 * Blocks as markup. In a tight list an item's paragraphs stand without
 * their element - the grammar's rendering, and what keeps a list of
 * short items from reading as a stack of paragraphs.
 *
 * @param {Block[]} blocks
 * @param {InlineContext} context
 * @param {boolean} tight
 * @returns {string}
 */
function renderBlocks(blocks, context, tight) {
  let out = "";
  for (const block of blocks) {
    switch (block.type) {
      case "heading":
        out += `<h${block.level}>${renderInline(parseInline(block.text, context))}</h${block.level}>`;
        break;
      case "paragraph": {
        const inline = renderInline(parseInline(block.text, context));
        out += tight ? inline : `<p>${inline}</p>`;
        break;
      }
      case "code":
        out += `<pre><code>${escapeHtml(block.text)}</code></pre>`;
        break;
      case "hr":
        out += "<hr>";
        break;
      case "html":
        out += block.raw;
        break;
      case "quote":
        out += `<blockquote>${renderBlocks(block.children, context, false)}</blockquote>`;
        break;
      case "list": {
        const tag = block.ordered ? "ol" : "ul";
        const start = block.ordered && block.start !== 1 ? ` start="${block.start}"` : "";
        out += `<${tag}${start}>`;
        for (const item of block.items) out += `<li>${renderBlocks(item, context, block.tight)}</li>`;
        out += `</${tag}>`;
        break;
      }
      case "table": {
        const cells = (/** @type {string[]} */ row, /** @type {"th" | "td"} */ tag) =>
          row.map((cell) => `<${tag}>${renderInline(parseInline(cell, context))}</${tag}>`).join("");
        out += `<table><thead><tr>${cells(block.head, "th")}</tr></thead>`;
        if (block.rows.length > 0) {
          out += `<tbody>${block.rows.map((row) => `<tr>${cells(row, "td")}</tr>`).join("")}</tbody>`;
        }
        out += "</table>";
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** @param {string} value @returns {string} */
function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Inline nodes as markup. Nothing but the four characters is escaped:
 * the string is parsed by the HTML parser next, and a reference the text
 * wrote (`&copy;`) has been kept as one.
 *
 * @param {Inline[]} nodes
 * @returns {string}
 */
function renderInline(nodes) {
  let out = "";
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        out += escapeHtml(node.value);
        break;
      case "code":
        out += `<code>${escapeHtml(node.value)}</code>`;
        break;
      case "html":
        out += node.value;
        break;
      case "br":
        out += "<br>";
        break;
      case "softbreak":
        out += "\n";
        break;
      case "link":
        out += `<a href="${escapeHtml(node.href)}">${renderInline(node.children)}</a>`;
        break;
      case "image":
        out += `<img src="${escapeHtml(node.src)}" alt="${escapeHtml(node.alt)}">`;
        break;
      case "em":
      case "strong":
      case "del":
        out += `<${node.type}>${renderInline(node.children)}</${node.type}>`;
        break;
      case "note":
        // The footnote's carrier (`lib/book/notes.js`): the text on the
        // marker, the render's popover reads it.
        out += `<a data-note="${escapeHtml(node.text)}">${node.number}</a>`;
        break;
      default:
        // A delimiter or a bracket left over: never here, `finish` makes
        // them text.
        break;
    }
  }
  return out;
}

/**
 * The words of inline nodes, markup gone - an image's alternative text,
 * a footnote's text, the title off the first heading.
 *
 * @param {Inline[]} nodes
 * @returns {string}
 */
function plainText(nodes) {
  let out = "";
  for (const node of nodes) {
    switch (node.type) {
      case "text":
      case "code":
        out += node.value;
        break;
      case "br":
      case "softbreak":
        out += " ";
        break;
      case "link":
      case "em":
      case "strong":
      case "del":
        out += plainText(node.children);
        break;
      case "image":
        out += node.alt;
        break;
      case "delim":
        out += node.char.repeat(node.count);
        break;
      case "bracket":
        out += node.image ? "![" : "[";
        break;
      default:
        break;
    }
  }
  return out;
}

const AUTOLINK_URL = /^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*)>/;
const AUTOLINK_EMAIL =
  /^<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/;
const HTML_TAG =
  /^(?:<[a-zA-Z][a-zA-Z0-9-]*(?:\s+[a-zA-Z_:][a-zA-Z0-9_.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>|<\/[a-zA-Z][a-zA-Z0-9-]*\s*>|<!--[\s\S]*?-->)/;
const ENTITY = /^&(?:#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z][a-zA-Z0-9]{1,31});/;
const BARE_URL = /^https?:\/\/[^\s<]+/;
const WIKILINK = /^\[\[([^\]\n|]*)(?:\|([^\]\n]*))?\]\]/;
const WIKI_EMBED = /^!\[\[[^\]\n]*\]\]/;
const NOTE_REFERENCE = /^\[\^([^\]\s]+)\]/;
const PUNCTUATION = /[\p{P}\p{S}]/u;
const WHITESPACE = /\s/;

/**
 * The inline text as nodes: one left-to-right pass that claims what is
 * unambiguous on sight (code, autolinks, tags, entities, escapes, breaks)
 * and leaves the rest - emphasis delimiters, link brackets - for the two
 * resolutions the grammar makes afterwards: a link when its closing
 * bracket is met, emphasis over the whole run once every bracket is
 * settled.
 *
 * @param {string} source
 * @param {InlineContext} context
 * @returns {Inline[]}
 */
export function parseInline(source, context) {
  /** @type {Inline[]} */
  const nodes = [];
  let text = "";
  const flush = () => {
    if (text.length > 0) nodes.push({ type: "text", value: text });
    text = "";
  };
  let i = 0;
  while (i < source.length) {
    const c = source[i] ?? "";
    const rest = source.slice(i);

    if (c === "\\") {
      const next = source[i + 1] ?? "";
      if (next === "\n") {
        flush();
        nodes.push({ type: "br" });
        i += 2;
      } else if (/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(next)) {
        text += next;
        i += 2;
      } else {
        text += c;
        i += 1;
      }
      continue;
    }

    if (c === "`") {
      const run = (/^`+/.exec(rest)?.[0] ?? "`").length;
      const closer = closingRun(source, i + run, run);
      if (closer === -1) {
        text += "`".repeat(run);
        i += run;
        continue;
      }
      flush();
      let value = source.slice(i + run, closer).replace(/\n/g, " ");
      if (value.length > 2 && value.startsWith(" ") && value.endsWith(" ") && value.trim().length > 0) {
        value = value.slice(1, -1);
      }
      nodes.push({ type: "code", value });
      i = closer + run;
      continue;
    }

    if (c === "<") {
      const url = AUTOLINK_URL.exec(rest);
      const email = url === null ? AUTOLINK_EMAIL.exec(rest) : null;
      if (url !== null || email !== null) {
        flush();
        const address = url?.[1] ?? email?.[1] ?? "";
        nodes.push({
          type: "link",
          href: email !== null ? `mailto:${address}` : address,
          children: [{ type: "text", value: address }],
        });
        i += (url ?? email)?.[0].length ?? 1;
        continue;
      }
      const tag = HTML_TAG.exec(rest);
      if (tag !== null) {
        flush();
        nodes.push({ type: "html", value: tag[0] });
        i += tag[0].length;
        continue;
      }
      text += c;
      i += 1;
      continue;
    }

    if (c === "&") {
      const entity = ENTITY.exec(rest);
      if (entity !== null) {
        flush();
        nodes.push({ type: "html", value: entity[0] });
        i += entity[0].length;
      } else {
        text += c;
        i += 1;
      }
      continue;
    }

    if (c === "!" && source[i + 1] === "[") {
      const embed = WIKI_EMBED.exec(rest);
      if (embed !== null) {
        // An embed of another note or a file this text does not carry.
        i += embed[0].length;
        continue;
      }
      flush();
      nodes.push({ type: "bracket", image: true, active: true, at: i + 2 });
      i += 2;
      continue;
    }

    if (c === "[") {
      const wiki = WIKILINK.exec(rest);
      if (wiki !== null) {
        // Obsidian's link to another note: the words it shows, as words -
        // the note is not in this file.
        text += (wiki[2] ?? wiki[1] ?? "").trim();
        i += wiki[0].length;
        continue;
      }
      const reference = NOTE_REFERENCE.exec(rest);
      const id = reference?.[1];
      if (reference !== null && id !== undefined && !context.inNote && context.definitions.notes.has(id)) {
        flush();
        nodes.push(noteNode(id, context));
        i += reference[0].length;
        continue;
      }
      flush();
      nodes.push({ type: "bracket", image: false, active: true, at: i + 1 });
      i += 1;
      continue;
    }

    if (c === "]") {
      flush();
      const end = closeBracket(source, i, nodes, context);
      i = end === -1 ? i + 1 : end;
      if (end === -1) text += "]";
      continue;
    }

    if (c === "*" || c === "_" || c === "~") {
      const run = (new RegExp(`^\\${c}+`).exec(rest)?.[0] ?? c).length;
      if (c === "~" && run !== 2) {
        text += c.repeat(run);
        i += run;
        continue;
      }
      flush();
      nodes.push(delimiter(c, run, source[i - 1], source[i + run]));
      i += run;
      continue;
    }

    if (c === "\n") {
      const hard = /[ ]{2,}$/.test(text);
      text = text.replace(/[ \t]+$/, "");
      flush();
      nodes.push({ type: hard ? "br" : "softbreak" });
      i += 1;
      continue;
    }

    if (c === "h" && (i === 0 || /[\s(*_~>]/.test(source[i - 1] ?? ""))) {
      const bare = BARE_URL.exec(rest);
      if (bare !== null) {
        const address = trimmedUrl(bare[0]);
        flush();
        nodes.push({ type: "link", href: address, children: [{ type: "text", value: address }] });
        i += address.length;
        continue;
      }
    }

    text += c;
    i += 1;
  }
  flush();
  return finish(nodes);
}

/**
 * Where a run of `length` backticks closes a code span opened at `from`,
 * or -1: a longer or shorter run is not the closer.
 *
 * @param {string} source
 * @param {number} from
 * @param {number} length
 * @returns {number}
 */
function closingRun(source, from, length) {
  const runs = /`+/g;
  runs.lastIndex = from;
  for (let match = runs.exec(source); match !== null; match = runs.exec(source)) {
    if (match[0].length === length) return match.index;
  }
  return -1;
}

/**
 * A bare address as the autolink extension trims it: the punctuation a
 * sentence hangs on the end is the sentence's, and so is a parenthesis
 * that closes one the address did not open.
 *
 * @param {string} address
 * @returns {string}
 */
function trimmedUrl(address) {
  let url = address;
  for (;;) {
    const trimmed = url.replace(/[?!.,:*_~'"]+$/, "");
    if (trimmed.endsWith(")")) {
      const opens = (trimmed.match(/\(/g) ?? []).length;
      const closes = (trimmed.match(/\)/g) ?? []).length;
      if (closes > opens) {
        url = trimmed.slice(0, -1);
        continue;
      }
    }
    if (trimmed === url) return url;
    url = trimmed;
  }
}

/**
 * A footnote reference as a node: the note numbered in the order the text
 * first refers to it, its text read once as words (a note's own Markdown
 * shown flat: the popover holds text).
 *
 * @param {string} id
 * @param {InlineContext} context
 * @returns {Inline}
 */
function noteNode(id, context) {
  let number = context.noteNumbers.get(id);
  if (number === undefined) {
    number = context.noteNumbers.size + 1;
    context.noteNumbers.set(id, number);
  }
  let text = context.noteTexts.get(id);
  if (text === undefined) {
    const raw = context.definitions.notes.get(id) ?? "";
    text = cleanNoteText(plainText(parseInline(raw, { ...context, inNote: true })));
    context.noteTexts.set(id, text);
  }
  return { type: "note", number, text };
}

/**
 * A run of emphasis characters with its two abilities, from what stands
 * on either side of it (the grammar's flanking rules; an underscore is
 * stricter, so that snake_case stays what it is).
 *
 * @param {string} char
 * @param {number} count
 * @param {string | undefined} before
 * @param {string | undefined} after
 * @returns {Inline}
 */
function delimiter(char, count, before, after) {
  const space = (/** @type {string | undefined} */ c) => c === undefined || WHITESPACE.test(c);
  const punct = (/** @type {string | undefined} */ c) => c !== undefined && PUNCTUATION.test(c);
  const left = !space(after) && (!punct(after) || space(before) || punct(before));
  const right = !space(before) && (!punct(before) || space(after) || punct(after));
  const canOpen = char === "_" ? left && (!right || punct(before)) : left;
  const canClose = char === "_" ? right && (!left || punct(after)) : right;
  return { type: "delim", char, count, canOpen, canClose };
}

/**
 * A closing bracket met: the last open bracket it may close and, after it,
 * either an inline destination, a reference label, or nothing - which is
 * a bracket that is just a bracket. A link made deactivates every bracket
 * before it: a link holds no link.
 *
 * @param {string} source
 * @param {number} at the index of the `]`
 * @param {Inline[]} nodes
 * @param {InlineContext} context
 * @returns {number} the index after what the link consumed, or -1
 */
function closeBracket(source, at, nodes, context) {
  let opener = -1;
  for (let k = nodes.length - 1; k >= 0; k -= 1) {
    const node = nodes[k];
    if (node !== undefined && node.type === "bracket") {
      opener = k;
      break;
    }
  }
  const bracket = nodes[opener];
  if (bracket === undefined || bracket.type !== "bracket") return -1;
  if (!bracket.active) {
    nodes.splice(opener, 1, { type: "text", value: bracket.image ? "![" : "[" });
    return -1;
  }

  /** @type {{ destination: string, end: number } | null} */
  let target = null;
  const inline = inlineDestination(source, at + 1);
  if (inline !== null) {
    target = inline;
  } else {
    const label = /^\[((?:[^\]\\]|\\.)*)\]/.exec(source.slice(at + 1));
    const content = source.slice(bracket.at, at);
    const key = normalizeLabel(label === null || (label[1] ?? "").length === 0 ? content : label[1] ?? "");
    const href = context.definitions.links.get(key);
    if (href !== undefined) target = { destination: href, end: at + 1 + (label?.[0].length ?? 0) };
  }
  if (target === null) {
    nodes.splice(opener, 1, { type: "text", value: bracket.image ? "![" : "[" });
    return -1;
  }

  const children = finish(nodes.splice(opener + 1));
  nodes.pop();
  if (bracket.image) {
    nodes.push({ type: "image", src: target.destination, alt: plainText(children) });
  } else {
    nodes.push({ type: "link", href: target.destination, children: withoutLinks(children) });
    for (const node of nodes) if (node.type === "bracket") node.active = false;
  }
  return target.end;
}

/**
 * An inline link's tail, `(destination "title")`, read from the character
 * after the closing bracket - or nothing, when what stands there is not
 * one. The destination is a bracketed address or a run without spaces
 * whose parentheses balance; the title is taken and let go.
 *
 * @param {string} source
 * @param {number} from
 * @returns {{ destination: string, end: number } | null}
 */
function inlineDestination(source, from) {
  if (source[from] !== "(") return null;
  let j = from + 1;
  const skipSpace = () => {
    while (j < source.length && /[ \t\n]/.test(source[j] ?? "")) j += 1;
  };
  skipSpace();
  let destination = "";
  if (source[j] === "<") {
    const close = source.indexOf(">", j + 1);
    if (close === -1 || source.slice(j + 1, close).includes("\n")) return null;
    destination = source.slice(j + 1, close);
    j = close + 1;
  } else {
    let depth = 0;
    const start = j;
    while (j < source.length) {
      const c = source[j] ?? "";
      if (c === "\\" && j + 1 < source.length) {
        j += 2;
        continue;
      }
      if (/[\s]/.test(c) || c.charCodeAt(0) < 0x20) break;
      if (c === "(") depth += 1;
      if (c === ")") {
        if (depth === 0) break;
        depth -= 1;
      }
      j += 1;
    }
    if (depth !== 0) return null;
    destination = source.slice(start, j);
  }
  skipSpace();
  const quote = source[j];
  if (quote === '"' || quote === "'" || quote === "(") {
    const closer = quote === "(" ? ")" : quote;
    let k = j + 1;
    while (k < source.length && source[k] !== closer) k += source[k] === "\\" ? 2 : 1;
    if (k >= source.length) return null;
    j = k + 1;
    skipSpace();
  }
  if (source[j] !== ")") return null;
  return { destination: unescape(destination), end: j + 1 };
}

/**
 * Link text holds no link: an address the autolink rule found inside one
 * stands as its words.
 *
 * @param {Inline[]} nodes
 * @returns {Inline[]}
 */
function withoutLinks(nodes) {
  /** @type {Inline[]} */
  const out = [];
  for (const node of nodes) {
    if (node.type === "link") out.push(...withoutLinks(node.children));
    else out.push(node);
  }
  return out;
}

/**
 * The run of nodes settled: emphasis resolved over the delimiters, and
 * whatever delimiter or bracket found no partner turned back into the
 * characters it was; neighbouring text joined.
 *
 * @param {Inline[]} nodes
 * @returns {Inline[]}
 */
function finish(nodes) {
  processEmphasis(nodes);
  /** @type {Inline[]} */
  const out = [];
  for (const node of nodes) {
    const literal =
      node.type === "delim"
        ? node.char.repeat(node.count)
        : node.type === "bracket"
          ? node.image
            ? "!["
            : "["
          : null;
    const settled = literal === null ? node : { type: /** @type {"text"} */ ("text"), value: literal };
    const last = out[out.length - 1];
    if (settled.type === "text" && last !== undefined && last.type === "text") last.value += settled.value;
    else out.push(settled);
  }
  return out;
}

/**
 * Emphasis over a run of nodes: the grammar's second phase, walked once
 * left to right. Every closer looks back for the nearest opener of its
 * character that the rule of three allows; the two give up as many
 * characters as the stronger emphasis takes, what stood between them
 * becomes the element's children, and the walk goes on from the closer
 * with whatever it has left.
 *
 * @param {Inline[]} nodes
 */
function processEmphasis(nodes) {
  let i = 0;
  while (i < nodes.length) {
    const closer = nodes[i];
    if (closer === undefined || closer.type !== "delim" || !closer.canClose) {
      i += 1;
      continue;
    }
    let found = -1;
    for (let j = i - 1; j >= 0; j -= 1) {
      const candidate = nodes[j];
      if (candidate === undefined || candidate.type !== "delim" || candidate.char !== closer.char || !candidate.canOpen) {
        continue;
      }
      const odd =
        (candidate.canClose || closer.canOpen) &&
        (candidate.count + closer.count) % 3 === 0 &&
        !(candidate.count % 3 === 0 && closer.count % 3 === 0);
      if (!odd || closer.char === "~") {
        found = j;
        break;
      }
    }
    if (found === -1) {
      if (!closer.canOpen) nodes[i] = { type: "text", value: closer.char.repeat(closer.count) };
      i += 1;
      continue;
    }
    const opener = nodes[found];
    if (opener === undefined || opener.type !== "delim") {
      i += 1;
      continue;
    }
    const use = closer.char === "~" ? 2 : opener.count >= 2 && closer.count >= 2 ? 2 : 1;
    const inner = finish(nodes.slice(found + 1, i));
    /** @type {Inline} */
    const wrapper = { type: closer.char === "~" ? "del" : use === 2 ? "strong" : "em", children: inner };
    opener.count -= use;
    closer.count -= use;
    /** @type {Inline[]} */
    const replacement = [];
    if (opener.count > 0) replacement.push(opener);
    replacement.push(wrapper);
    if (closer.count > 0) replacement.push(closer);
    nodes.splice(found, i - found + 1, ...replacement);
    i = found + replacement.length - (closer.count > 0 ? 1 : 0);
  }
}
