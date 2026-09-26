/**
 * Pieces of one article body, boxed separately.
 *
 * Some layouts cut the body of an article into several containers of the
 * same shape with an advertising slot between every two: Ars Technica (2026)
 * puts three `div.post-content` each in its own grid row. Readability scores
 * every box on its own, takes the best one and looks for the rest of the
 * article among that box's siblings - which the other boxes are not. Its way
 * up to a common ancestor asks for three more candidates scoring three
 * quarters of the best, so a body in four or more boxes is found whole and
 * one in two or three loses everything but its best box. The reader then
 * shows a third of the article and says nothing, which is worse than an
 * error: the box it shows reads like a whole.
 *
 * Nothing here decides what the article is - Readability does, twice when it
 * has to. This module tells which boxes on a page are of one shape
 * (`bodyPieces`), whether an extracted article holds some of them and not the
 * others (`tornGroups`), and moves the contents of such boxes into the first
 * of them (`joinGroups`), so that a second run of Readability meets the whole
 * body in one place. A page whose article came out whole gets no second run
 * and no change at all, and the second answer replaces the first only when
 * it holds more of the boxes (`marksHeld`) - the caller's rule, counted here.
 *
 * The DOM is touched through a handful of members - `querySelectorAll`,
 * `parentNode`, `textContent`, `getAttribute`, `firstChild`, `appendChild` -
 * so that a test can hand it a small fake one. The real page this was written
 * for is reproduced with a real parser in `tmp/split-body-probe/` (jsdom,
 * outside the gate).
 */

const ELEMENT_NODE = 1;

/**
 * A paragraph shorter than this says nothing about where the body is: the
 * length Readability itself asks of a paragraph before joining it to the
 * article as a sibling.
 */
const PARAGRAPH_MIN = 80;

/**
 * A box whose class says what it is - a comment, a sidebar, a widget - is no
 * piece of the body, however many paragraphs it holds. Readability's own list
 * of names that count against a candidate, with the names it drops outright
 * (comments, replies, menus, popups) added.
 */
const NOT_A_BODY =
  /-ad-|hidden|banner|combx|comment|community|com-|contact|disqus|footer|gdpr|masthead|media|menu|meta|nav|outbrain|popup|promo|related|remark|replies|scroll|share|shoutbox|sidebar|skyscraper|sponsor|shopping|tags|widget/i;

/**
 * Boxes of one shape holding paragraphs, in document order, and for each box
 * a mark: the text of its longest paragraph, by which the box can be told in
 * whatever Readability hands back. `key` is the shape - depth, tag and class
 * - and the same on every parse of the same page, which is how the groups of
 * a second parse are matched to the groups of the first.
 *
 * @typedef {{ key: string, boxes: Element[], marks: string[] }} PieceGroup
 */

/**
 * Whitespace as an extracted text and a page agree on it: runs of it are one
 * space, and none at the ends. Readability keeps the text of a paragraph as it
 * was, but nothing about the whitespace around it is promised.
 *
 * @param {string} text
 */
function squash(text) {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * How many ancestors an element has. Boxes of one body sit at one depth; a
 * comment that happens to share the body's class sits in a list, deeper.
 *
 * @param {Element} element
 */
function depthOf(element) {
  let depth = 0;
  for (let node = element.parentNode; node !== null; node = node.parentNode) depth += 1;
  return depth;
}

/**
 * The same-shaped boxes of the page: two or more elements of one tag, class
 * and depth, each the parent of a paragraph long enough to count. Boxes
 * without a class have no shape to share, and boxes whose class names a
 * comment, a sidebar or a widget are left alone.
 *
 * @param {Document} doc the page as parsed, before Readability has been at it
 * @returns {PieceGroup[]}
 */
export function bodyPieces(doc) {
  /** @type {Map<string, Map<Element, string>>} */
  const shapes = new Map();
  for (const paragraph of Array.from(doc.querySelectorAll("p"))) {
    const text = squash(paragraph.textContent ?? "");
    if (text.length < PARAGRAPH_MIN) continue;
    const parent = paragraph.parentNode;
    if (parent === null || parent.nodeType !== ELEMENT_NODE) continue;
    const box = /** @type {Element} */ (parent);
    const className = squash(box.getAttribute("class") ?? "");
    if (className === "" || NOT_A_BODY.test(className)) continue;

    const key = `${depthOf(box)}|${box.tagName}|${className}`;
    let boxes = shapes.get(key);
    if (boxes === undefined) {
      boxes = new Map();
      shapes.set(key, boxes);
    }
    const mark = boxes.get(box);
    if (mark === undefined || mark.length < text.length) boxes.set(box, text);
  }

  /** @type {PieceGroup[]} */
  const groups = [];
  for (const [key, boxes] of shapes) {
    if (boxes.size < 2) continue;
    groups.push({ key, boxes: Array.from(boxes.keys()), marks: Array.from(boxes.values()) });
  }
  return groups;
}

/**
 * @param {string[]} marks
 * @param {string} haystack squashed
 */
function heldIn(marks, haystack) {
  return marks.filter((mark) => haystack.includes(mark)).length;
}

/**
 * How many of the groups' marks the text holds - the measure by which one
 * answer of Readability beats another.
 *
 * @param {PieceGroup[]} groups
 * @param {string} text an extracted article's text
 */
export function marksHeld(groups, text) {
  const haystack = squash(text);
  return groups.reduce((held, group) => held + heldIn(group.marks, haystack), 0);
}

/**
 * The groups the text holds a part of and not the whole: a body Readability
 * found and left pieces of behind. A group it holds nothing of is somebody
 * else's - comments under the article, say - and is not touched.
 *
 * @param {PieceGroup[]} groups
 * @param {string} text an extracted article's text
 * @returns {PieceGroup[]}
 */
export function tornGroups(groups, text) {
  const haystack = squash(text);
  return groups.filter((group) => {
    const held = heldIn(group.marks, haystack);
    return held > 0 && held < group.marks.length;
  });
}

/**
 * Moves the contents of every later box of a torn group into the first, in
 * document order, leaving the later boxes empty where they stand. Runs over
 * the groups of a fresh parse, matched to the torn ones by key: Readability
 * has rewritten the document the torn groups were read from.
 *
 * @param {PieceGroup[]} groups the groups of the document being joined
 * @param {PieceGroup[]} torn the groups to join, from whatever parse
 * @returns {number} how many groups were joined
 */
export function joinGroups(groups, torn) {
  const keys = new Set(torn.map((group) => group.key));
  let joined = 0;
  for (const group of groups) {
    if (!keys.has(group.key)) continue;
    const first = group.boxes[0];
    if (first === undefined) continue;
    for (const box of group.boxes.slice(1)) {
      for (let child = box.firstChild; child !== null; child = box.firstChild) {
        first.appendChild(child);
      }
    }
    joined += 1;
  }
  return joined;
}
