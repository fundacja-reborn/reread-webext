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

import { allowedAttributes, decide, safeHref } from "./sanitize.js";

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/** Links carry them; these two are the only attributes holding an address. */
const URL_ATTRIBUTES = new Set(["href", "cite"]);

/**
 * @param {Element} source the article's root, as parsed
 * @param {Document} target the document that will own the result
 * @param {{ baseUrl: string }} options
 * @returns {Element} a `<div>` holding the rebuilt article
 */
export function buildArticle(source, target, options) {
  const root = target.createElement("div");
  appendChildren(source, root, target, options.baseUrl);
  return root;
}

/**
 * @param {Element} source
 * @param {Element} into
 * @param {Document} target
 * @param {string} baseUrl
 */
function appendChildren(source, into, target, baseUrl) {
  for (const child of Array.from(source.childNodes)) {
    appendNode(child, into, target, baseUrl);
  }
}

/**
 * @param {Node} node
 * @param {Element} into
 * @param {Document} target
 * @param {string} baseUrl
 */
function appendNode(node, into, target, baseUrl) {
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
    appendChildren(element, into, target, baseUrl);
    return;
  }

  const name = element.tagName.toLowerCase();
  const rebuilt = target.createElement(name);
  copyAttributes(element, rebuilt, name, baseUrl);
  appendChildren(element, rebuilt, target, baseUrl);
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
