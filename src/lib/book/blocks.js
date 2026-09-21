/**
 * Which rebuilt elements a book hands the packer - the walk that dissolves
 * packaging so the cutting rules in `segment.js` get prose to work with.
 *
 * EPUB files as the big presses export them wrap every chapter's markup in a
 * single `<div>`. The sanitizer keeps `div` (a page may use one as a
 * paragraph), so without this walk a whole chapter arrives at the packer as
 * one indivisible block: the budget never cuts inside it, and a part-divider
 * page - three headings in their own wrapper - stands as a segment of nothing
 * but titles. Dissolving the wrapper is what lets the packer see the
 * headings and paragraphs that were always inside.
 *
 * A `div` is packaging when nothing in it is its own: no text of its own,
 * at least one element carrying the content. A `div` holding its own words
 * is somebody's paragraph and passes through whole - this walk never moves
 * or drops text, it only unwraps what held no text to begin with.
 */

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * True for a division that only packages other elements - nothing but
 * whitespace of its own between them.
 *
 * @param {Element} element
 * @returns {boolean}
 */
function isWrapper(element) {
  let holdsElement = false;
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === ELEMENT_NODE) {
      holdsElement = true;
      continue;
    }
    if (child.nodeType === TEXT_NODE && (child.nodeValue ?? "").trim().length > 0) {
      return false;
    }
  }
  return holdsElement;
}

/**
 * The blocks of a rebuilt chapter, in reading order, with wrapper `div`s
 * dissolved - recursively, because the presses also nest them. Whitespace
 * between the children of a dissolved wrapper is indentation, not prose,
 * and goes with the wrapper.
 *
 * @param {Element} root the rebuilt chapter, as `buildArticle` returned it
 * @returns {Generator<Element>}
 */
export function* packableBlocks(root) {
  yield* dissolved(root, null);
}

/**
 * The walk itself, with one thing said on the way: every wrapper dissolved,
 * the moment before the blocks it held are handed over.
 *
 * @param {Element} root
 * @param {((wrapper: Element) => void) | null} onWrapper
 * @returns {Generator<Element>}
 */
function* dissolved(root, onWrapper) {
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType !== ELEMENT_NODE) continue;
    const element = /** @type {Element} */ (child);
    if (element.localName === "div" && isWrapper(element)) {
      if (onWrapper !== null) onWrapper(element);
      yield* dissolved(element, onWrapper);
    } else {
      yield element;
    }
  }
}

/**
 * The same blocks, each with the rows of the book's own contents that land
 * on it (D277, `lib/book/nav.js`). The import marks a row on the rebuilt
 * element its target became; the block it lands on is the one that element
 * stands in - the element itself, when it is a block - and a mark on a
 * wrapper this walk dissolves passes to the first block the wrapper held,
 * which is where the wrapper began. Rows come out in document order, as
 * the marks went in.
 *
 * @param {Element} root the rebuilt chapter, as `buildArticle` returned it
 * @param {Map<Element, number[]>} marks rebuilt elements and the rows marked on them
 * @returns {Generator<{ block: Element, rows: number[] }>}
 */
export function* markedBlocks(root, marks) {
  /** @type {number[]} */
  let fromWrappers = [];
  const blocks = dissolved(root, (wrapper) => {
    fromWrappers.push(...(marks.get(wrapper) ?? []));
  });
  for (const block of blocks) {
    const rows = fromWrappers;
    fromWrappers = [];
    // Nothing marked, nothing to look for: the common chapter costs no walk.
    if (marks.size > 0) collectMarks(block, marks, rows);
    yield { block, rows };
  }
}

/**
 * The rows marked on an element and on everything inside it, in document
 * order.
 *
 * @param {Element} element
 * @param {Map<Element, number[]>} marks
 * @param {number[]} into
 */
function collectMarks(element, marks, into) {
  const rows = marks.get(element);
  if (rows !== undefined) into.push(...rows);
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === ELEMENT_NODE) collectMarks(/** @type {Element} */ (child), marks, into);
  }
}
