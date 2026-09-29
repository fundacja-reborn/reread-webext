import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bodyBoxes, lostParts, mendBody, partsHeld } from "../src/lib/reader/split-body.js";

/**
 * A page in as much of a DOM as the module reads: node type, tag name,
 * attributes, parents and children, text summed up the tree, `appendChild`
 * and `replaceChild` that move a node the way a browser's do, and a document
 * that makes an element. Nothing here parses - `node --test` has no DOM - so
 * what the test can pin down is the rule: which boxes are of one shape, what
 * a paragraph is, when an article holds a part and not the rest, and what a
 * mending moves where. The pages this was written for (Ars Technica, three
 * `div.post-content` in three grid rows; a snapshot of archive.today, two
 * boxes of `<div>` paragraphs with nothing but a style on them) are run
 * through a real parser in `tmp/split-body-probe/`, outside the gate.
 *
 * @typedef {{ name: string, value: string, cloneNode: () => FakeAttr }} FakeAttr
 *
 * @typedef {{
 *   nodeType: number,
 *   tagName: string,
 *   parentNode: FakeNode | null,
 *   childNodes: FakeNode[],
 *   attributes: FakeAttr[],
 *   ownerDocument: { createElement: (tagName: string) => FakeNode },
 *   readonly firstChild: FakeNode | null,
 *   readonly textContent: string,
 *   getAttribute: (name: string) => string | null,
 *   setAttributeNode: (attribute: FakeAttr) => void,
 *   appendChild: (child: FakeNode) => FakeNode,
 *   replaceChild: (next: FakeNode, old: FakeNode) => FakeNode,
 * }} FakeNode
 */

/**
 * @param {string} name
 * @param {string} value
 * @returns {FakeAttr}
 */
function attr(name, value) {
  return { name, value, cloneNode: () => attr(name, value) };
}

const factory = { createElement: (/** @type {string} */ tagName) => el(tagName) };

/**
 * @param {FakeNode} node
 * @param {FakeNode} child
 */
function detach(node, child) {
  const from = child.parentNode;
  if (from !== null) from.childNodes.splice(from.childNodes.indexOf(child), 1);
  child.parentNode = node;
}

/**
 * @param {string} tagName
 * @param {Record<string, string>} [attributes]
 * @param {FakeNode[]} [children]
 * @returns {FakeNode}
 */
function el(tagName, attributes = {}, children = []) {
  /** @type {FakeNode} */
  const node = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    parentNode: null,
    childNodes: [],
    attributes: Object.entries(attributes).map(([name, value]) => attr(name, value)),
    ownerDocument: factory,
    get firstChild() {
      return node.childNodes[0] ?? null;
    },
    get textContent() {
      return node.childNodes.map((child) => child.textContent).join("");
    },
    getAttribute: (name) => node.attributes.find((one) => one.name === name)?.value ?? null,
    setAttributeNode: (attribute) => {
      node.attributes.push(attribute);
    },
    appendChild: (child) => {
      detach(node, child);
      node.childNodes.push(child);
      return child;
    },
    replaceChild: (next, old) => {
      const at = node.childNodes.indexOf(old);
      assert.notEqual(at, -1);
      detach(node, next);
      node.childNodes.splice(at, 1, next);
      old.parentNode = null;
      return old;
    },
  };
  for (const child of children) node.appendChild(child);
  return node;
}

/**
 * @param {string} data
 * @returns {FakeNode}
 */
function text(data) {
  return {
    nodeType: 3,
    tagName: "#text",
    parentNode: null,
    childNodes: [],
    attributes: [],
    ownerDocument: factory,
    firstChild: null,
    textContent: data,
    getAttribute: () => null,
    setAttributeNode: () => undefined,
    appendChild: (child) => child,
    replaceChild: (_next, old) => old,
  };
}

/**
 * A paragraph long enough to count, and unlike any other: the seed makes the
 * text, so a test can tell which box a paragraph came from.
 *
 * @param {string} seed
 */
function prose(seed) {
  return `${seed}: ${"a word ".repeat(12)}and a full stop.`;
}

/** @param {string} seed */
function p(seed) {
  return el("p", {}, [text(prose(seed))]);
}

/**
 * The page under a document node, the way a browser hangs it, so that depth
 * counts from the same place; `querySelectorAll` answers for one tag name,
 * in document order and as the tree stands when asked - all the module asks
 * of a document.
 *
 * @param {FakeNode} body
 */
function page(body) {
  const html = el("html", {}, [el("head"), body]);
  const doc = el("#document", {}, [html]);
  doc.nodeType = 9;
  const document = {
    /** @param {string} selector */
    querySelectorAll: (selector) => {
      assert.match(selector, /^(p|div)$/);
      /** @type {FakeNode[]} */
      const found = [];
      /** @param {FakeNode} node */
      const walk = (node) => {
        if (node.tagName === selector.toUpperCase()) found.push(node);
        for (const child of node.childNodes) walk(child);
      };
      walk(doc);
      return found;
    },
  };
  // Cast: the fake is as much of a Document as the module reads.
  return /** @type {Document} */ (/** @type {unknown} */ (document));
}

/**
 * What a box holds, child by child: the text of a paragraph, the tag of
 * anything else.
 *
 * @param {Element | FakeNode | undefined} box
 */
function contentsOf(box) {
  assert.ok(box);
  const node = /** @type {FakeNode} */ (/** @type {unknown} */ (box));
  return node.childNodes.map((child) => (child.tagName === "P" ? child.textContent : child.tagName));
}

/**
 * The layout that lost two thirds of an article: three boxes of one class,
 * each in its own row, an advertising slot between every two.
 *
 * @param {string} [className]
 */
function arsLike(className = "post-content post-content-double") {
  const row = (/** @type {FakeNode[]} */ children) =>
    el("div", { class: "row" }, [el("div", { class: "column" }, [el("div", { class: className }, children)])]);
  const ad = () => el("div", { class: "ad-wrapper" }, [el("div", { class: "ad" })]);
  const first = row([p("one-a"), p("one-b")]);
  const second = row([p("two-a"), el("blockquote", {}, [p("two-quote")]), p("two-b")]);
  const third = row([p("three-a")]);
  const body = el("body", {}, [
    el("article", { class: "h-entry" }, [el("header", {}, [el("h1", {}, [text("A title")])]), first, ad(), second, ad(), third]),
  ]);
  return { body };
}

const BOX = "box-sizing:border-box;display:block;";
const TYPE = 'color:rgb(26, 26, 26);font-family:"Breve Text", serif;font-size:19px;';
const LINE = "box-sizing:border-box;display:block;margin-block-end:19px;";

/**
 * A paragraph as an archive hands it over: a `<div>` with a style.
 *
 * @param {string} seed
 */
function line(seed) {
  return el("div", { style: LINE }, [text(prose(seed))]);
}

/**
 * A paragraph of an archive with links in it, and a word in a `<span>`.
 *
 * @param {string} seed
 */
function linked(seed) {
  return el("div", { style: LINE, id: `p-${seed}` }, [
    el("span", { style: "text-transform:uppercase;" }, [text(`${seed}: `)]),
    text("a word ".repeat(6)),
    el("a", { href: "https://example.org/one" }, [text("a word ".repeat(6))]),
    text("and a full stop."),
  ]);
}

/**
 * The same layout as a snapshot of archive.today has it: no `<p>` and no
 * class anywhere, the style of every element written into it. Two boxes of
 * the body, each under the element that carries the type, and a row of
 * teasers whose boxes have the body's own style and another parent.
 */
function archiveLike() {
  const row = (/** @type {FakeNode[]} */ children) =>
    el("div", { style: "display:grid;" }, [el("div", { style: TYPE }, [el("div", { style: BOX }, children)])]);
  const ad = () => el("div", { style: "min-height:250px;" }, [el("div", { style: BOX })]);
  const teaser = (/** @type {string} */ seed) =>
    el("div", { style: "display:flex;" }, [el("div", { style: "font-size:14px;" }, [el("div", { style: BOX }, [line(seed)])])]);
  const first = row([line("one-a"), line("one-b"), el("div", { style: LINE }, [text("A short line.")])]);
  const second = row([line("two-a"), linked("two-links"), line("two-b")]);
  const body = el("body", {}, [
    el("article", {}, [el("header", {}, [el("h1", {}, [text("A title")])]), first, ad(), second, teaser("tease-1"), teaser("tease-2")]),
  ]);
  return { body };
}

describe("bodyBoxes", () => {
  it("takes every parent of a long paragraph, in document order, with the text of each", () => {
    const boxes = bodyBoxes(page(arsLike().body));
    assert.deepEqual(
      boxes.map((box) => [box.box.tagName, box.texts]),
      [
        ["DIV", [prose("one-a"), prose("one-b")]],
        // The quoted paragraph belongs to the blockquote, not to the box around it.
        ["DIV", [prose("two-a"), prose("two-b")]],
        ["BLOCKQUOTE", [prose("two-quote")]],
        ["DIV", [prose("three-a")]],
      ],
    );
    assert.deepEqual(
      boxes.map((box) => box.divs),
      [false, false, false, false],
    );
    assert.deepEqual(
      boxes.map((box) => box.paragraphs.map((paragraph) => paragraph.tagName)),
      [["P", "P"], ["P", "P"], ["P"], ["P"]],
    );
  });

  it("shapes a box by depth, tag and class, the same on every parse of the same page", () => {
    const first = bodyBoxes(page(arsLike().body));
    const again = bodyBoxes(page(arsLike().body));
    assert.deepEqual(
      first.map((box) => box.key),
      ["6|DIV|post-content post-content-double", "6|DIV|post-content post-content-double", null, "6|DIV|post-content post-content-double"],
    );
    assert.deepEqual(
      again.map((box) => [box.key, box.texts]),
      first.map((box) => [box.key, box.texts]),
    );
  });

  it("tells boxes of one class apart by depth", () => {
    const body = el("body", {}, [
      el("div", { class: "text" }, [p("shallow")]),
      el("section", {}, [el("div", { class: "text" }, [p("deep")])]),
    ]);
    assert.deepEqual(
      bodyBoxes(page(body)).map((box) => box.key),
      ["3|DIV|text", "4|DIV|text"],
    );
  });

  it("gives no shape to a box whose class says comment, sidebar, widget", () => {
    const body = el("body", {}, [
      el("div", { class: "entry-content" }, [p("article-a")]),
      el("div", { class: "comment-body" }, [p("comment-1")]),
      el("aside", { class: "sidebar-text" }, [p("side-1")]),
      el("div", { class: "promo widget" }, [p("promo-1")]),
    ]);
    assert.deepEqual(
      bodyBoxes(page(body)).map((box) => box.key),
      ["3|DIV|entry-content", null, null, null],
    );
  });

  it("shapes a box without a class by its style and by its parent, and gives none to one without either", () => {
    const body = el("body", {}, [
      el("div", { style: TYPE }, [el("div", { style: `  ${BOX}  ` }, [p("styled-a")])]),
      el("div", { style: TYPE }, [el("div", { style: BOX }, [p("styled-b")])]),
      // The same style under another parent is another shape.
      el("div", { style: "font-size:14px;" }, [el("div", { style: BOX }, [p("elsewhere")])]),
      el("div", { class: "column" }, [el("div", { style: BOX }, [p("under-a-class")])]),
      // A class is what a box is told by when it has one, whatever its style.
      el("div", { style: TYPE }, [el("div", { class: "text", style: BOX }, [p("classed")])]),
      el("div", { style: TYPE }, [el("div", {}, [p("bare")])]),
      el("div", { style: TYPE }, [el("div", { class: "  ", style: "  " }, [p("blank")])]),
    ]);
    assert.deepEqual(
      bodyBoxes(page(body)).map((box) => box.key),
      [
        `4|DIV||${BOX}||${TYPE}||DIV<BODY<HTML`,
        `4|DIV||${BOX}||${TYPE}||DIV<BODY<HTML`,
        `4|DIV||${BOX}||font-size:14px;||DIV<BODY<HTML`,
        `4|DIV||${BOX}||column||DIV<BODY<HTML`,
        "4|DIV|text",
        null,
        null,
      ],
    );
  });

  it("tells unclassed boxes of one style and one parent apart by the tags on the way up", () => {
    const piece = (/** @type {string} */ seed) => el("div", { style: TYPE }, [el("div", { style: BOX }, [p(seed)])]);
    const body = el("body", {}, [
      el("main", {}, [el("article", {}, [piece("body-a"), piece("body-b")])]),
      // As deep as the body's boxes and dressed like them, under another roof.
      el("footer", {}, [el("div", {}, [piece("a notice")])]),
    ]);
    assert.deepEqual(
      bodyBoxes(page(body)).map((box) => box.key),
      [
        `6|DIV||${BOX}||${TYPE}||DIV<ARTICLE<MAIN<BODY<HTML`,
        `6|DIV||${BOX}||${TYPE}||DIV<ARTICLE<MAIN<BODY<HTML`,
        `6|DIV||${BOX}||${TYPE}||DIV<DIV<FOOTER<BODY<HTML`,
      ],
    );
  });

  it("wants a paragraph of 80 characters, and squashes the whitespace of its text", () => {
    const long = `${prose("long")} ${prose("and longer")}`;
    const body = el("body", {}, [
      el("div", { class: "note" }, [el("p", {}, [text("Too short to count.")])]),
      el("div", { class: "body-text" }, [
        el("p", {}, [text(`  ${prose("spread").replace(/ /g, "\n  ")}  `)]),
        el("p", {}, [text("Also too short.")]),
        el("p", {}, [text(long.replace(" and ", "\n\n   and ")), text("")]),
      ]),
    ]);
    const boxes = bodyBoxes(page(body));
    assert.deepEqual(
      boxes.map((box) => box.texts),
      [[prose("spread"), long]],
    );
    assert.equal(boxes[0]?.paragraphs.length, 2);
  });

  it("reads the block-less <div>s of a page without a <p> as its paragraphs", () => {
    const boxes = bodyBoxes(page(archiveLike().body));
    assert.deepEqual(
      boxes.map((box) => [box.divs, box.texts]),
      [
        [true, [prose("one-a"), prose("one-b")]],
        [true, [prose("two-a"), linked("two-links").textContent.trim(), prose("two-b")]],
        [true, [prose("tease-1")]],
        [true, [prose("tease-2")]],
      ],
    );
    assert.deepEqual(
      boxes.map((box) => box.key),
      [
        `6|DIV||${BOX}||${TYPE}||DIV<DIV<ARTICLE<BODY<HTML`,
        `6|DIV||${BOX}||${TYPE}||DIV<DIV<ARTICLE<BODY<HTML`,
        `6|DIV||${BOX}||font-size:14px;||DIV<DIV<ARTICLE<BODY<HTML`,
        `6|DIV||${BOX}||font-size:14px;||DIV<DIV<ARTICLE<BODY<HTML`,
      ],
    );
  });

  it("takes a <div> holding a block for a container, however deep the block", () => {
    const long = prose("beside a block");
    const body = el("body", {}, [
      el("div", { style: BOX }, [
        el("div", {}, [text(long), el("img", { src: "a.png" })]),
        el("div", {}, [text(long), el("span", {}, [el("ul", {}, [el("li", {}, [text("An item.")])])])]),
        el("div", {}, [el("em", {}, [el("a", { href: "#" }, [text(prose("inline all the way"))])])]),
      ]),
    ]);
    assert.deepEqual(
      bodyBoxes(page(body)).map((box) => box.texts),
      [[prose("inline all the way")]],
    );
  });

  it("leaves <div>s alone on a page with a <p>", () => {
    const { body } = archiveLike();
    body.appendChild(el("footer", {}, [el("p", {}, [text("One paragraph, and a short one.")])]));
    assert.deepEqual(bodyBoxes(page(body)), []);
  });
});

describe("lostParts and partsHeld", () => {
  const boxes = bodyBoxes(page(arsLike().body));

  it("is torn when the text holds paragraphs of some boxes of a shape and none of the others", () => {
    const middle = `A title\n${prose("two-a")}\n${prose("two-quote")}\n${prose("two-b")}`;
    const loss = lostParts(boxes, middle);
    assert.deepEqual(loss, { torn: [[0, 1, 3]], thinned: [] });
    assert.ok(loss);
    assert.equal(partsHeld(boxes, loss, middle), 2);
  });

  it("is whole when the text holds a paragraph of every box, even with other whitespace", () => {
    const whole = [prose("one-b"), prose("two-a"), prose("three-a")]
      .map((one) => one.replace(/ /g, "\n \t"))
      .join("\n");
    assert.equal(lostParts(boxes, whole), null);
  });

  it("is nobody's when the text holds none of the paragraphs", () => {
    assert.equal(lostParts(boxes, prose("somewhere else entirely")), null);
    assert.equal(lostParts(boxes, ""), null);
  });

  it("holds a box by any of its paragraphs, not by the longest", () => {
    const build = () =>
      el("body", {}, [
        el("div", { class: "entry-content" }, [p("short-a"), el("p", {}, [text(`${prose("long-a")} ${prose("longer")}`)])]),
        el("div", { class: "entry-content" }, [p("short-b")]),
      ]);
    const two = bodyBoxes(page(build()));
    assert.equal(lostParts(two, `${prose("short-a")}\n${prose("short-b")}`), null);
    assert.deepEqual(lostParts(two, prose("short-a")), { torn: [[0, 1]], thinned: [] });
  });

  it("leaves alone a box with no shape to share, and a shape of one box", () => {
    const build = () =>
      el("body", {}, [
        el("div", { class: "entry-content" }, [p("article-a")]),
        el("div", {}, [p("bare-1")]),
        el("div", {}, [p("bare-2")]),
        el("div", { class: "comment-body" }, [p("comment-1")]),
        el("div", { class: "comment-body" }, [p("comment-2")]),
      ]);
    const loose = bodyBoxes(page(build()));
    assert.equal(loose.length, 5);
    assert.equal(lostParts(loose, [prose("article-a"), prose("bare-1"), prose("comment-1")].join("\n")), null);
  });

  it("tells the torn groups from the ones the text holds nothing of", () => {
    const build = () =>
      el("body", {}, [
        el("div", { class: "entry-content" }, [p("article-a")]),
        el("div", { class: "entry-content" }, [p("article-b")]),
        el("div", { class: "review-text" }, [p("review-1")]),
        el("div", { class: "review-text" }, [p("review-2")]),
      ]);
    const loss = lostParts(bodyBoxes(page(build())), prose("article-a"));
    assert.deepEqual(loss, { torn: [[0, 1]], thinned: [] });
  });

  it("is thinned when a box of <div> paragraphs is held in part, and a box of <p> never is", () => {
    const divs = bodyBoxes(page(el("body", {}, [el("div", { style: BOX }, [line("kept-a"), linked("dropped"), line("kept-b")])])));
    const kept = `${prose("kept-a")}\n${prose("kept-b")}`;
    const loss = lostParts(divs, kept);
    assert.deepEqual(loss, { torn: [], thinned: [0] });
    assert.ok(loss);
    assert.equal(partsHeld(divs, loss, kept), 2);
    assert.equal(partsHeld(divs, loss, `${kept}\n${linked("dropped").textContent}`), 3);
    assert.equal(lostParts(divs, `${kept}\n${linked("dropped").textContent}`), null);
    assert.equal(lostParts(divs, prose("somewhere else entirely")), null);

    const written = bodyBoxes(page(el("body", {}, [el("div", { class: "text" }, [p("kept-a"), p("dropped"), p("kept-b")])])));
    assert.equal(lostParts(written, kept), null);
  });

  it("tears the boxes of an archive by their style, and counts a torn box once", () => {
    const archive = bodyBoxes(page(archiveLike().body));
    // The first box whole, of the second nothing: torn. The teasers share the
    // body's style and not its parent, and nothing of them is held.
    const first = `A title\n${prose("one-a")}\n${prose("one-b")}`;
    const loss = lostParts(archive, first);
    assert.deepEqual(loss, { torn: [[0, 1]], thinned: [] });
    assert.ok(loss);
    assert.equal(partsHeld(archive, loss, first), 2);

    // A box of a torn group that lost a paragraph of its own is mended with
    // the group, not named twice.
    const partly = lostParts(archive, `${prose("two-a")}\n${prose("two-b")}`);
    assert.deepEqual(partly, { torn: [[0, 1]], thinned: [] });
  });
});

describe("mendBody", () => {
  it("moves the later boxes' contents into the first, in order, and leaves them empty", () => {
    const loss = lostParts(bodyBoxes(page(arsLike().body)), prose("two-a"));
    assert.deepEqual(loss, { torn: [[0, 1, 3]], thinned: [] });
    assert.ok(loss);

    // The document being mended is a fresh parse: its own boxes, found by place.
    const fresh = arsLike();
    const boxes = bodyBoxes(page(fresh.body));
    assert.deepEqual(mendBody(boxes, loss), { joined: 1, written: 0 });

    assert.deepEqual(
      [boxes[0], boxes[1], boxes[3]].map((box) => contentsOf(box?.box)),
      [[prose("one-a"), prose("one-b"), prose("two-a"), "BLOCKQUOTE", prose("two-b"), prose("three-a")], [], []],
    );
    // Every moved node knows its new parent, and the rows still stand where they were.
    const first = /** @type {FakeNode} */ (/** @type {unknown} */ (boxes[0]?.box));
    for (const child of first.childNodes) assert.equal(child.parentNode, first);
    assert.equal(fresh.body.childNodes[0]?.childNodes.length, 6);
  });

  it("joins only the torn groups", () => {
    const build = () =>
      el("body", {}, [
        el("div", { class: "entry-content" }, [p("article-a")]),
        el("div", { class: "entry-content" }, [p("article-b")]),
        el("div", { class: "review-text" }, [p("review-1")]),
        el("div", { class: "review-text" }, [p("review-2")]),
      ]);
    const loss = lostParts(bodyBoxes(page(build())), prose("article-a"));
    assert.ok(loss);

    const fresh = build();
    assert.deepEqual(mendBody(bodyBoxes(page(fresh)), loss), { joined: 1, written: 0 });
    assert.deepEqual(
      fresh.childNodes.map((box) => box.childNodes.length),
      [2, 0, 1, 1],
    );
  });

  it("makes <p> of the long <div> paragraphs of a torn group, and joins them", () => {
    const loss = lostParts(bodyBoxes(page(archiveLike().body)), prose("one-a"));
    assert.deepEqual(loss, { torn: [[0, 1]], thinned: [] });
    assert.ok(loss);

    const fresh = archiveLike();
    const boxes = bodyBoxes(page(fresh.body));
    assert.deepEqual(mendBody(boxes, loss), { joined: 1, written: 5 });

    const first = /** @type {FakeNode} */ (/** @type {unknown} */ (boxes[0]?.box));
    assert.deepEqual(contentsOf(boxes[0]?.box), [
      prose("one-a"),
      prose("one-b"),
      // A short line is nobody's to rename: Readability reads it as it did.
      "DIV",
      prose("two-a"),
      linked("two-links").textContent,
      prose("two-b"),
    ]);
    assert.deepEqual(contentsOf(boxes[1]?.box), []);

    // A paragraph keeps what it had: its attributes, copied, and its children.
    const written = first.childNodes[4];
    assert.ok(written);
    assert.equal(written.tagName, "P");
    assert.equal(written.parentNode, first);
    assert.deepEqual(
      written.attributes.map((one) => [one.name, one.value]),
      [
        ["style", LINE],
        ["id", "p-two-links"],
      ],
    );
    assert.deepEqual(
      written.childNodes.map((child) => child.tagName),
      ["SPAN", "#text", "A", "#text"],
    );
    for (const child of written.childNodes) assert.equal(child.parentNode, written);

    // The teasers are not the article's, and stay the <div>s they were.
    assert.deepEqual(
      [boxes[2], boxes[3]].map((box) => contentsOf(box?.box)),
      [["DIV"], ["DIV"]],
    );
    // The page now has paragraphs, and they are the ones just written.
    assert.deepEqual(
      bodyBoxes(page(fresh.body)).map((box) => [box.divs, box.texts.length]),
      [[false, 5]],
    );
  });

  it("makes <p> of the long <div> paragraphs of a thinned box where they stand", () => {
    const build = () =>
      el("body", {}, [
        el("div", { style: BOX }, [line("kept-a"), linked("dropped"), el("div", { style: LINE }, [text("A short line.")]), line("kept-b")]),
        el("div", { style: "font-size:14px;" }, [line("somebody else's")]),
      ]);
    const loss = lostParts(bodyBoxes(page(build())), `${prose("kept-a")}\n${prose("kept-b")}`);
    assert.deepEqual(loss, { torn: [], thinned: [0] });
    assert.ok(loss);

    const fresh = build();
    const boxes = bodyBoxes(page(fresh));
    assert.deepEqual(mendBody(boxes, loss), { joined: 0, written: 3 });
    assert.deepEqual(contentsOf(boxes[0]?.box), [prose("kept-a"), linked("dropped").textContent, "DIV", prose("kept-b")]);
    assert.deepEqual(contentsOf(boxes[1]?.box), ["DIV"]);
  });

  it("does nothing for a place the page does not have", () => {
    const fresh = arsLike();
    const boxes = bodyBoxes(page(fresh.body));
    assert.deepEqual(mendBody(boxes, { torn: [[7, 9]], thinned: [11] }), { joined: 0, written: 0 });
    assert.deepEqual(contentsOf(boxes[0]?.box), [prose("one-a"), prose("one-b")]);
  });
});
