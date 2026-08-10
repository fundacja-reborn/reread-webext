/**
 * Underlining saved phrases on a page, without touching the page.
 *
 * The CSS Custom Highlight API is the whole reason this can exist: ranges are
 * handed to the browser and painted, and the document keeps exactly the nodes
 * its author wrote. Wrapping matches in `<span>` - the usual way to do this -
 * breaks single-page applications, invalidates the page's own `Range` objects
 * and comes back as a bug nobody can reproduce.
 *
 * Clicking an underline is answered with geometry rather than
 * `caretPositionFromPoint`: the ranges are already known, and asking which of
 * their rectangles contains the pointer is both exact and one browser
 * difference less to carry into the Chromium port. A caret position would also
 * answer "the nearest place a cursor could go", which is not the same question
 * as "did they click the underline".
 *
 * What is deliberately not here yet: matches spanning inline elements (a phrase
 * broken by `<em>`), and a `MutationObserver` for pages that add text after
 * they load. Both are known and planned; neither is an unknown.
 */

import { buildIndex, findMatches } from "../lib/matcher/index.js";

/** Must be the name in `highlight.css`. */
const NAME = "reread";

/** Text that is not prose: never rendered, or being typed into. */
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION"]);

/** @typedef {{ range: Range, normalized: string }} Painted */

/** @type {Painted[]} */
let painted = [];

/**
 * The API, or nothing at all. Firefox has had it since 140 and the manifest
 * asks for 142, but a content script runs in whatever the reader is actually
 * running, and this is not worth an exception on somebody's page.
 *
 * @returns {HighlightRegistry | null}
 */
function registry() {
  if (typeof CSS === "undefined" || !("highlights" in CSS)) return null;
  if (typeof Highlight !== "function") return null;
  return CSS.highlights;
}

/** @returns {boolean} */
export function supported() {
  return registry() !== null;
}

export function clear() {
  painted = [];
  registry()?.delete(NAME);
}

/**
 * @param {Node} node
 * @returns {number}
 */
function acceptNode(node) {
  const parent = node.parentElement;
  if (parent === null || SKIP.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
  // Text being edited moves under the reader's hands, and a range over it is
  // stale as soon as they type.
  if (parent.isContentEditable) return NodeFilter.FILTER_REJECT;
  return NodeFilter.FILTER_ACCEPT;
}

/**
 * Paints every saved phrase that occurs on the page.
 *
 * @param {Iterable<string>} keys normalized phrases
 * @returns {number} how many occurrences were painted
 */
export function paint(keys) {
  const api = registry();
  if (api === null || document.body === null) return 0;

  painted = [];
  const index = buildIndex(keys);
  if (index.size === 0) {
    api.delete(NAME);
    return 0;
  }

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode });
  const highlight = new Highlight();

  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.nodeValue;
    if (text === null || text.length === 0) continue;

    for (const match of findMatches(text, index)) {
      const range = document.createRange();
      range.setStart(node, match.start);
      range.setEnd(node, match.end);
      highlight.add(range);
      painted.push({ range, normalized: match.normalized });
    }
  }

  if (painted.length === 0) {
    api.delete(NAME);
    return 0;
  }

  api.set(NAME, highlight);
  return painted.length;
}

/**
 * Which saved phrase, if any, is under a point in the viewport.
 *
 * @param {number} x
 * @param {number} y
 * @returns {{ normalized: string, text: string, rect: DOMRect } | null}
 */
export function phraseAt(x, y) {
  for (const { range, normalized } of painted) {
    for (const rect of range.getClientRects()) {
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
      // The rectangle of the line that was clicked, not of the whole match: a
      // phrase wrapped across two lines would otherwise anchor its bubble to a
      // box spanning both.
      return { normalized, text: range.toString(), rect };
    }
  }
  return null;
}
