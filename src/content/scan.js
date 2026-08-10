/**
 * Walking a page for saved phrases, without changing a thing about it.
 *
 * The unit of matching is a block, not a text node. A page writes one sentence
 * as several nodes whenever there is a link or an `<em>` in it, so the text
 * nodes of a block are joined, matched as one string, and the matches are
 * mapped back onto the nodes they came from. A range may therefore start in one
 * node and end in another, which is exactly what the reader sees anyway.
 *
 * The walk stops at block boundaries so that two paragraphs never join into a
 * word that is on neither of them, and it never enters script, style, form
 * fields or anything being edited.
 */

import { findMatches } from "../lib/matcher/index.js";
import { joinPieces, locate } from "../lib/matcher/spans.js";

/** Text that is never prose: not rendered, or being typed into. */
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION", "SVG"]);

/**
 * Where one run of text ends and the next begins. A tag list rather than
 * `getComputedStyle`, which would be a layout question asked once per element
 * on the page - and the answer would be the same for all but a handful.
 */
const BLOCK = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "BODY", "BR", "CAPTION", "DD", "DETAILS",
  "DIALOG", "DIV", "DL", "DT", "FIELDSET", "FIGCAPTION", "FIGURE", "FOOTER", "FORM",
  "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P",
  "PRE", "SECTION", "SUMMARY", "TABLE", "TBODY", "TD", "TFOOT", "TH", "THEAD", "TR", "UL",
]);

/** @typedef {{ range: Range, normalized: string }} Painted */

/**
 * The nearest thing that counts as a block above a node - the granularity at
 * which a page is rescanned after it changes.
 *
 * @param {Node} node
 * @returns {Element | null}
 */
export function blockAround(node) {
  const start = node.nodeType === Node.ELEMENT_NODE ? /** @type {Element} */ (node) : node.parentElement;
  for (let element = start; element !== null; element = element.parentElement) {
    if (BLOCK.has(element.tagName)) return element;
  }
  return document.body;
}

/**
 * @param {Text[]} pieces text nodes the reader sees as one run
 * @param {import("../lib/matcher/index.js").PhraseIndex} index
 * @param {Painted[]} into
 */
function matchRun(pieces, index, into) {
  if (pieces.length === 0) return;

  const { text, spans } = joinPieces(pieces.map((piece) => piece.data));
  for (const match of findMatches(text, index)) {
    // The last character rather than the position after it: an end that lands
    // exactly on a boundary would otherwise point at the piece after the match.
    const from = locate(spans, match.start);
    const to = locate(spans, match.end - 1);
    const first = from === null ? undefined : pieces[from.piece];
    const last = to === null ? undefined : pieces[to.piece];
    if (from === null || to === null || first === undefined || last === undefined) continue;

    const range = document.createRange();
    range.setStart(first, from.offset);
    range.setEnd(last, to.offset + 1);
    into.push({ range, normalized: match.normalized });
  }
}

/**
 * @param {Node} root
 * @param {import("../lib/matcher/index.js").PhraseIndex} index
 * @returns {Painted[]}
 */
export function scan(root, index) {
  /** @type {Painted[]} */
  const found = [];
  /** @type {Text[]} */
  let run = [];

  const flush = () => {
    matchRun(run, index, found);
    run = [];
  };

  /**
   * @param {Node} node
   */
  const walk = (node) => {
    for (let child = node.firstChild; child !== null; child = child.nextSibling) {
      if (child.nodeType === Node.TEXT_NODE) {
        run.push(/** @type {Text} */ (child));
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;

      const element = /** @type {Element} */ (child);
      if (SKIP.has(element.tagName)) continue;
      if (element instanceof HTMLElement && element.isContentEditable) continue;

      const boundary = BLOCK.has(element.tagName);
      if (boundary) flush();
      walk(element);
      if (boundary) flush();
    }
  };

  if (root.nodeType === Node.TEXT_NODE) run.push(/** @type {Text} */ (root));
  else walk(root);
  flush();

  return found;
}
