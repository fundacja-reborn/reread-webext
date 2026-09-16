/**
 * The tree a document leaves in (D229): what the two files a document is
 * exported as - the EPUB (`epub-file.js`) and the Markdown page
 * (`markdown-file.js`) - read of the rebuilt article, and nothing more.
 *
 * Both writers walk the tree `buildArticle` made: the stored copy parsed
 * inert and rebuilt through the allowed list, the road every render takes
 * (`saved-article.js` says why the copy is not trusted back). They read it
 * through five properties a DOM node has as-is - the node's type, its
 * lower-case name, its text, its children, and one attribute at a time -
 * so that a test can hand them a small hand-built tree and read back what
 * came out, the way `test/reader-article.test.js` does with the rebuild.
 * Nothing here needs a document, and no attribute is ever enumerated off
 * the source: each is asked for by name from the sanitizer's own list.
 */

/**
 * The least a node has to be to be walked here. A DOM `Node` satisfies it
 * as-is: `localName` and `getAttribute` stand on elements alone, and only
 * an element (`nodeType` 1) is ever asked for them.
 *
 * @typedef {{
 *   nodeType: number,
 *   localName?: string,
 *   nodeValue?: string | null,
 *   childNodes: Iterable<ExportNode>,
 *   getAttribute?: (name: string) => string | null,
 * }} ExportNode
 */

export const ELEMENT_NODE = 1;
export const TEXT_NODE = 3;

/**
 * @param {ExportNode} node
 * @returns {node is ExportNode & { localName: string, getAttribute: (name: string) => string | null }}
 */
export function isElement(node) {
  return node.nodeType === ELEMENT_NODE && typeof node.localName === "string";
}

/**
 * @param {ExportNode} node
 * @returns {boolean}
 */
export function isText(node) {
  return node.nodeType === TEXT_NODE;
}

/**
 * An element's name as the two writers spell it: lower case, whatever the
 * DOM's own case for the document it was parsed from.
 *
 * @param {ExportNode & { localName: string }} element
 * @returns {string}
 */
export function nameOf(element) {
  return element.localName.toLowerCase();
}

/**
 * @param {ExportNode} node
 * @returns {ExportNode[]}
 */
export function childrenOf(node) {
  return Array.from(node.childNodes);
}

/**
 * One attribute, or nothing - for an empty value too, which the rebuild
 * never writes (`article.js` skips them) and no file wants.
 *
 * @param {ExportNode} node
 * @param {string} name
 * @returns {string | null}
 */
export function attributeOf(node, name) {
  if (!isElement(node)) return null;
  const value = node.getAttribute(name);
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * The text under a node, as the DOM's `textContent` would give it: every
 * text node's words in order, markup gone, whitespace as it stands.
 *
 * @param {ExportNode} node
 * @returns {string}
 */
export function textOf(node) {
  if (isText(node)) return node.nodeValue ?? "";
  let text = "";
  for (const child of childrenOf(node)) text += textOf(child);
  return text;
}

/**
 * Text as a line: runs of whitespace as one space, none at either end -
 * the shape a heading, a title or a table cell wants. U+00A0 is not
 * whitespace here: a non-breaking space is a character an author placed.
 *
 * @param {string} text
 * @returns {string}
 */
export function oneLine(text) {
  return text.replace(/[ \t\r\n\f]+/g, " ").trim();
}
