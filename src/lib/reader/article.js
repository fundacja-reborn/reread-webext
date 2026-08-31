/**
 * Rebuilding somebody else's article inside our document.
 *
 * The walk is here rather than on the reader page because it is the part worth
 * testing: it decides what survives contact with a website, and a mistake in it
 * is a script running on an extension page. It touches a DOM, but only through
 * seven methods, so a test can hand it a small fake one and read back what came
 * out.
 *
 * Nothing here assigns `innerHTML`. Elements are created by name, text is
 * copied as text, and attributes are asked for one at a time from a list -
 * never enumerated off the source, so an attribute nobody thought about is not
 * even read.
 */

import { NOTE_TEXT_LIMIT } from "../book/notes.js";
import { SOURCE_ATTRIBUTE } from "./pictures.js";
import { allowedAttributes, decide, safeHref, safeSrc } from "./sanitize.js";

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/** Links carry them; these two are the only attributes holding an address. */
const URL_ATTRIBUTES = new Set(["href", "cite"]);

/**
 * A stored picture as the rebuild shows it: where its bytes are to be had
 * (a `blob:` address of this page's own making) and how large it is, so
 * the text reserves its room before a byte is decoded.
 *
 * @typedef {{ url: string, width: number, height: number }} ShownPicture
 */

/**
 * What the rebuild does with a picture (D145), decided by the caller:
 *
 *   - nothing passed - the picture goes, element and all. The callers that
 *     never show one: a book's chapters, the search over stored texts;
 *   - `true` - the picture stands as `<img>` with its address kept in
 *     `data-src` and nothing in `src`: the shape of an article as it is
 *     stored and as it is read before any picture is saved, invisible under
 *     the stylesheet and loading nothing;
 *   - a resolver - the same element, and `src` set only where the resolver
 *     knows the address: a picture the database holds, by its own `blob:`.
 *
 * The two shapes that show differ in attributes alone, never in an element:
 * the highlighter's marks and the reading position count blocks, and a
 * picture saved must not move them.
 *
 * @typedef {true | ((src: string) => ShownPicture | null)} Pictures
 */

/**
 * @param {Element} source the article's root, as parsed
 * @param {Document} target the document that will own the result
 * @param {{ baseUrl: string, pictures?: Pictures }} options
 * @returns {Element} a `<div>` holding the rebuilt article
 */
export function buildArticle(source, target, options) {
  const root = target.createElement("div");
  appendChildren(source, root, target, options);
  return root;
}

/**
 * @param {Element} source
 * @param {Element} into
 * @param {Document} target
 * @param {{ baseUrl: string, pictures?: Pictures }} options
 */
function appendChildren(source, into, target, options) {
  for (const child of Array.from(source.childNodes)) {
    appendNode(child, into, target, options);
  }
}

/**
 * @param {Node} node
 * @param {Element} into
 * @param {Document} target
 * @param {{ baseUrl: string, pictures?: Pictures }} options
 */
function appendNode(node, into, target, options) {
  if (node.nodeType === TEXT_NODE) {
    const text = node.nodeValue ?? "";
    if (text.length > 0) into.appendChild(target.createTextNode(text));
    return;
  }

  // Comments, processing instructions, doctypes: not text, and not structure.
  if (node.nodeType !== ELEMENT_NODE) return;
  const element = /** @type {Element} */ (node);

  const decision = decide(element.tagName);
  if (decision === "drop") return;
  // The element goes, its children stay. That is what keeps an article whose
  // paragraphs sit inside <article>, <section> or somebody's own custom tag.
  if (decision === "unwrap") {
    appendChildren(element, into, target, options);
    return;
  }
  if (decision === "image") {
    appendPicture(element, into, target, options);
    return;
  }

  const name = element.tagName.toLowerCase();
  const rebuilt = target.createElement(name);
  copyAttributes(element, rebuilt, name, options.baseUrl);
  appendChildren(element, rebuilt, target, options);
  into.appendChild(rebuilt);
}

/**
 * A picture, as `Pictures` above says. The address is read from `src` first
 * and from `data-src` second: the first is how a page writes it (and how
 * Readability leaves it after undoing lazy loading), the second is how the
 * stored article carries it back here. A picture with no address worth
 * asking for is no picture - the same decision in every shape, so the
 * shapes that show keep the same elements.
 *
 * @param {Element} source
 * @param {Element} into
 * @param {Document} target
 * @param {{ baseUrl: string, pictures?: Pictures }} options
 */
function appendPicture(source, into, target, options) {
  const pictures = options.pictures;
  if (pictures === undefined) return;
  const src = safeSrc(
    source.getAttribute("src") ?? source.getAttribute(SOURCE_ATTRIBUTE),
    options.baseUrl,
  );
  if (src === null) return;

  const rebuilt = target.createElement("img");
  rebuilt.setAttribute(SOURCE_ATTRIBUTE, src);
  copyAttributes(source, rebuilt, "img", options.baseUrl);
  if (typeof pictures === "function") {
    const shown = pictures(src);
    if (shown !== null) {
      rebuilt.setAttribute("src", shown.url);
      rebuilt.setAttribute("width", String(shown.width));
      rebuilt.setAttribute("height", String(shown.height));
    }
  }
  into.appendChild(rebuilt);
}

/**
 * @param {Element} source
 * @param {Element} rebuilt
 * @param {string} name lower-case tag name
 * @param {string} baseUrl
 */
function copyAttributes(source, rebuilt, name, baseUrl) {
  for (const attribute of allowedAttributes(name)) {
    const value = source.getAttribute(attribute);
    if (typeof value !== "string" || value.length === 0) continue;

    if (URL_ATTRIBUTES.has(attribute)) {
      const href = safeHref(value, baseUrl);
      if (href !== null) rebuilt.setAttribute(attribute, href);
      continue;
    }
    // The footnote carrier is capped on every pass, not only at book import:
    // this walk also rebuilds live pages and stored copies, and the cap is
    // the sanitizer's half of letting the attribute through at all.
    if (attribute === "data-note") {
      rebuilt.setAttribute(attribute, value.slice(0, NOTE_TEXT_LIMIT));
      continue;
    }
    rebuilt.setAttribute(attribute, value);
  }

  // A link that goes anywhere goes to a new tab. Following one in place would
  // replace the article with the page it came from, which is a way of losing
  // what somebody was reading. `noreferrer` because where they are reading from
  // is nobody else's business.
  if (name === "a" && safeHref(source.getAttribute("href"), baseUrl) !== null) {
    rebuilt.setAttribute("target", "_blank");
    rebuilt.setAttribute("rel", "noreferrer noopener");
  }
}
