/**
 * Parts of an article body that Readability leaves behind: boxes of the body
 * standing apart from the one it took, and paragraphs that came as `<div>`s.
 *
 * Some layouts cut the body of an article into several containers of the
 * same shape with an advertising slot between every two: Ars Technica (2026)
 * puts three `div.post-content` each in its own grid row. Readability scores
 * every box on its own, takes the best one and looks for the rest of the
 * article among that box's siblings - which the other boxes are not. Its
 * ways up to a common ancestor - three more candidates scoring three quarters
 * of the best, a parent scoring more than its child - are open to some such
 * pages and closed to others: a body in three boxes lost two of them, a
 * review in five lost four, another body in three came out whole. Where they
 * are closed the reader shows a part of the article and says nothing, which
 * is worse than an error: the box it shows reads like a whole.
 *
 * And some pages have no `<p>` and no class to tell a box by. A snapshot of
 * archive.today is the page as the archive rewrote it: every `<p>` a `<div>`,
 * every class gone and the style it stood for written into the `style`
 * attribute. Readability reads a `<div>` with no block inside as a paragraph,
 * which is why such a page is read at all - except a paragraph a quarter of
 * whose text is links, which it leaves a `<div>` and later cleans away as a
 * container of links. So a snapshot loses what the page it was taken of does
 * not: the other boxes of a body (nothing to tell them by) and, out of the
 * box it keeps, every paragraph with enough links in it.
 *
 * Nothing here decides what the article is - Readability does, twice when it
 * has to. This module remembers the boxes of a page (`bodyBoxes`), tells what
 * an extracted article holds a part of and not the rest (`lostParts`), and
 * mends a fresh parse of the page for a second run (`mendBody`): the boxes of
 * one shape moved into the first of them, the `<div>` paragraphs of the boxes
 * concerned made the `<p>` they were. A page whose article came out whole gets
 * no second run and no change at all, and the second answer replaces the
 * first only when it holds more of the paragraphs in question (`partsHeld`) -
 * the caller's rule, counted here.
 *
 * The DOM is touched through a handful of members - `querySelectorAll`,
 * `parentNode`, `childNodes`, `firstChild`, `textContent`, `getAttribute`,
 * `appendChild`, and for a paragraph `ownerDocument.createElement`,
 * `attributes`, `setAttributeNode` and `replaceChild` - so that a test can
 * hand it a small fake one. The real pages this was written for are
 * reproduced with a real parser in `tmp/split-body-probe/` (jsdom, outside
 * the gate).
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
 * What makes a `<div>` a container and not a paragraph: Readability's own
 * list (`DIV_TO_P_ELEMS`), so that a `<div>` is a paragraph here exactly when
 * it is one there.
 */
const BLOCKS = new Set(["BLOCKQUOTE", "DL", "DIV", "IMG", "OL", "P", "PRE", "TABLE", "UL"]);

/**
 * A box: the parent of paragraphs long enough to count, and what is
 * remembered of it. `key` is the shape it shares with other boxes, or null
 * when it has none to share; `texts` are its long paragraphs as an extracted
 * text would hold them, `paragraphs` the elements they were read from, and
 * `divs` says that those are `<div>`s - the page has no `<p>`.
 *
 * Boxes come in document order, and the same page parsed again gives the same
 * boxes in the same places: that is how what was lost in one parse (`Loss`,
 * places in the list) is found in the next.
 *
 * @typedef {{
 *   box: Element,
 *   key: string | null,
 *   divs: boolean,
 *   paragraphs: Element[],
 *   texts: string[],
 * }} BodyBox
 */

/**
 * What an extracted article holds a part of and not the rest, by the places
 * of the boxes: `torn` are the groups of one shape of which it holds some
 * boxes and not the others, `thinned` the boxes of `<div>` paragraphs of
 * which it holds some paragraphs and not the others.
 *
 * @typedef {{ torn: number[][], thinned: number[] }} Loss
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
 * Whether an element holds a block anywhere inside: a `<div>` that does is a
 * container, one that does not is a paragraph.
 *
 * @param {Element} element
 * @returns {boolean}
 */
function holdsBlock(element) {
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType !== ELEMENT_NODE) continue;
    const inner = /** @type {Element} */ (child);
    if (BLOCKS.has(inner.tagName) || holdsBlock(inner)) return true;
  }
  return false;
}

/**
 * @param {Element} element
 * @param {string} name
 */
function attributeOf(element, name) {
  return squash(element.getAttribute(name) ?? "");
}

/**
 * The tags of an element's ancestors, from the nearest up.
 *
 * @param {Element} element
 */
function wayUp(element) {
  /** @type {string[]} */
  const tags = [];
  for (let node = element.parentNode; node !== null; node = node.parentNode) {
    if (node.nodeType === ELEMENT_NODE) tags.push(/** @type {Element} */ (node).tagName);
  }
  return tags.join("<");
}

/**
 * The shape of a box: what it shares with the other pieces of one body, and
 * the same on every parse of the same page. A box with a class is told by
 * depth, tag and class. A box without one is told by its inline style - what
 * an archive made of the class - and, since `display:block` says less than a
 * name does and stands on half the boxes of a page, by where it stands as
 * well: the class or style of its parent, and the tags on the way up from it.
 * The pieces of one body stand in rows of one kind under one roof; a notice
 * in the footer that happens to look like them does not. A box with neither
 * class nor style has no shape to share, and one whose class names a comment,
 * a sidebar or a widget is left alone.
 *
 * @param {Element} box
 * @returns {string | null}
 */
function shapeOf(box) {
  const className = attributeOf(box, "class");
  if (className !== "") {
    return NOT_A_BODY.test(className) ? null : `${depthOf(box)}|${box.tagName}|${className}`;
  }
  const style = attributeOf(box, "style");
  if (style === "") return null;

  const parent = box.parentNode;
  let around = "";
  if (parent !== null && parent.nodeType === ELEMENT_NODE) {
    const outer = /** @type {Element} */ (parent);
    around = attributeOf(outer, "class") || attributeOf(outer, "style");
  }
  // The empty place between the bars is the class there is none of, so that
  // no class can spell the key of a style.
  return `${depthOf(box)}|${box.tagName}||${style}||${around}||${wayUp(box)}`;
}

/**
 * The boxes of the page: every parent of a paragraph long enough to count, in
 * document order. A paragraph is a `<p>` - and on a page without a single
 * one, a `<div>` with no block inside, which is all such a page has for a
 * paragraph and what Readability makes one of.
 *
 * @param {Document} doc the page as parsed, before Readability has been at it
 * @returns {BodyBox[]}
 */
export function bodyBoxes(doc) {
  const written = Array.from(doc.querySelectorAll("p"));
  const divs = written.length === 0;
  const candidates = divs
    ? Array.from(doc.querySelectorAll("div")).filter((div) => !holdsBlock(div))
    : written;

  /** @type {Map<Element, BodyBox>} */
  const boxes = new Map();
  for (const paragraph of candidates) {
    const text = squash(paragraph.textContent ?? "");
    if (text.length < PARAGRAPH_MIN) continue;
    const parent = paragraph.parentNode;
    if (parent === null || parent.nodeType !== ELEMENT_NODE) continue;
    const box = /** @type {Element} */ (parent);

    let known = boxes.get(box);
    if (known === undefined) {
      known = { box, key: shapeOf(box), divs, paragraphs: [], texts: [] };
      boxes.set(box, known);
    }
    known.paragraphs.push(paragraph);
    known.texts.push(text);
  }
  return Array.from(boxes.values());
}

/**
 * How many of a box's paragraphs the text holds.
 *
 * @param {BodyBox} box
 * @param {string} haystack squashed
 */
function heldOf(box, haystack) {
  return box.texts.filter((text) => haystack.includes(text)).length;
}

/**
 * What the text holds a part of and not the rest, or null when it holds
 * whole whatever it holds. Two things are asked of it. Of the boxes of one
 * shape, two or more: does it hold a paragraph of some and none of the
 * others - a body Readability found and left pieces of behind. And of a box
 * whose paragraphs are `<div>`s: does it hold some of them and not all - a
 * box Readability took and cleaned paragraphs out of. A group or a box it
 * holds nothing of is somebody else's - comments under the article, say - and
 * is not touched; any paragraph of a box tells that the box is held, since
 * the longest one may be the very paragraph that was cleaned away.
 *
 * @param {BodyBox[]} boxes
 * @param {string} text an extracted article's text
 * @returns {Loss | null}
 */
export function lostParts(boxes, text) {
  const haystack = squash(text);
  const held = boxes.map((box) => heldOf(box, haystack));

  /** @type {Map<string, number[]>} */
  const shapes = new Map();
  boxes.forEach((box, place) => {
    if (box.key === null) return;
    const places = shapes.get(box.key);
    if (places === undefined) shapes.set(box.key, [place]);
    else places.push(place);
  });

  /** @type {number[][]} */
  const torn = [];
  /** @type {Set<number>} */
  const joined = new Set();
  for (const places of shapes.values()) {
    const some = places.filter((place) => (held[place] ?? 0) > 0).length;
    if (some === 0 || some === places.length) continue;
    torn.push(places);
    for (const place of places) joined.add(place);
  }

  /** @type {number[]} */
  const thinned = [];
  boxes.forEach((box, place) => {
    if (!box.divs || joined.has(place)) return;
    const some = held[place] ?? 0;
    if (some > 0 && some < box.texts.length) thinned.push(place);
  });

  return torn.length === 0 && thinned.length === 0 ? null : { torn, thinned };
}

/**
 * The places of every box the loss is about.
 *
 * @param {Loss} loss
 */
function placesOf(loss) {
  return [...loss.torn.flat(), ...loss.thinned];
}

/**
 * How many paragraphs of the boxes in question the text holds - the measure
 * by which one answer of Readability beats another.
 *
 * @param {BodyBox[]} boxes
 * @param {Loss} loss
 * @param {string} text an extracted article's text
 */
export function partsHeld(boxes, loss, text) {
  const haystack = squash(text);
  let held = 0;
  for (const place of placesOf(loss)) {
    const box = boxes[place];
    if (box !== undefined) held += heldOf(box, haystack);
  }
  return held;
}

/**
 * A `<div>` paragraph made a `<p>` where it stands, the way Readability
 * itself renames an element (`_setNodeTag`): a new one with copies of the
 * same attributes - its class and its `hidden` still tell Readability what
 * they told it - and the same children. Copies of the attribute nodes rather
 * than `setAttribute`, which refuses some of the names a parser takes.
 *
 * @param {Element} paragraph
 */
function asParagraph(paragraph) {
  const parent = paragraph.parentNode;
  if (parent === null) return;
  const written = paragraph.ownerDocument.createElement("p");
  for (const attribute of Array.from(paragraph.attributes)) {
    written.setAttributeNode(/** @type {Attr} */ (attribute.cloneNode()));
  }
  for (let child = paragraph.firstChild; child !== null; child = paragraph.firstChild) {
    written.appendChild(child);
  }
  parent.replaceChild(written, paragraph);
}

/**
 * Mends the page for a second run. In every box the loss is about, the long
 * `<div>` paragraphs become `<p>`, which Readability keeps whatever their
 * links; and the contents of every later box of a torn group move into the
 * first, in document order, leaving the later boxes empty where they stand.
 * Runs over the boxes of a fresh parse: Readability has rewritten the
 * document the loss was read from.
 *
 * @param {BodyBox[]} boxes the boxes of the document being mended
 * @param {Loss} loss what the first answer left behind, from whatever parse
 * @returns {{ joined: number, written: number }} how many groups were joined
 *   and how many paragraphs were made `<p>`
 */
export function mendBody(boxes, loss) {
  let written = 0;
  for (const place of placesOf(loss)) {
    const box = boxes[place];
    if (box === undefined || !box.divs) continue;
    for (const paragraph of box.paragraphs) asParagraph(paragraph);
    written += box.paragraphs.length;
  }

  let joined = 0;
  for (const places of loss.torn) {
    const [head, ...rest] = places.map((place) => boxes[place]);
    if (head === undefined) continue;
    for (const later of rest) {
      if (later === undefined) continue;
      for (let child = later.box.firstChild; child !== null; child = later.box.firstChild) {
        head.box.appendChild(child);
      }
    }
    joined += 1;
  }
  return { joined, written };
}
