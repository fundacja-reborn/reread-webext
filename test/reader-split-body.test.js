import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bodyPieces, joinGroups, marksHeld, tornGroups } from "../src/lib/reader/split-body.js";

/**
 * A page in as much of a DOM as the module reads: node type, tag name, one
 * attribute at a time, parents and children, text summed up the tree, and
 * `appendChild` that moves a node the way a browser's does. Nothing here
 * parses - `node --test` has no DOM - so what the test can pin down is the
 * rule: which boxes count as one shape, when an article is torn, and what a
 * join moves where. The page this was written for (Ars Technica, three
 * `div.post-content` in three grid rows) is run through a real parser in
 * `tmp/split-body-probe/`, outside the gate.
 *
 * @typedef {{
 *   nodeType: number,
 *   tagName: string,
 *   parentNode: FakeNode | null,
 *   childNodes: FakeNode[],
 *   readonly firstChild: FakeNode | null,
 *   readonly textContent: string,
 *   getAttribute: (name: string) => string | null,
 *   appendChild: (child: FakeNode) => FakeNode,
 * }} FakeNode
 */

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
    get firstChild() {
      return node.childNodes[0] ?? null;
    },
    get textContent() {
      return node.childNodes.map((child) => child.textContent).join("");
    },
    getAttribute: (name) => attributes[name] ?? null,
    appendChild: (child) => {
      const from = child.parentNode;
      if (from !== null) from.childNodes.splice(from.childNodes.indexOf(child), 1);
      child.parentNode = node;
      node.childNodes.push(child);
      return child;
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
    firstChild: null,
    textContent: data,
    getAttribute: () => null,
    appendChild: (child) => child,
  };
}

/**
 * A paragraph long enough to count, and unlike any other: the seed makes the
 * text, so a test can tell which box a mark came from.
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
 * counts from the same place; `querySelectorAll` answers for paragraphs alone,
 * in document order - all the module asks of a document.
 *
 * @param {FakeNode} body
 */
function page(body) {
  const html = el("html", {}, [el("head"), body]);
  const doc = el("#document", {}, [html]);
  doc.nodeType = 9;
  /** @type {FakeNode[]} */
  const paragraphs = [];
  /** @param {FakeNode} node */
  const walk = (node) => {
    if (node.tagName === "P") paragraphs.push(node);
    for (const child of node.childNodes) walk(child);
  };
  walk(doc);
  const document = {
    /** @param {string} selector */
    querySelectorAll: (selector) => {
      assert.equal(selector, "p");
      return paragraphs;
    },
  };
  // Cast: the fake is as much of a Document as the module reads.
  return /** @type {Document} */ (/** @type {unknown} */ (document));
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
  return { body, boxes: [first, second, third] };
}

describe("bodyPieces", () => {
  it("groups boxes of one tag, class and depth, in document order, one mark each", () => {
    const { body } = arsLike();
    const groups = bodyPieces(page(body));
    assert.equal(groups.length, 1);
    const group = groups[0];
    assert.ok(group);
    assert.equal(group.boxes.length, 3);
    assert.deepEqual(
      group.boxes.map((box) => box.getAttribute("class")),
      Array(3).fill("post-content post-content-double"),
    );
    // The longest paragraph of each box; the quoted one belongs to the blockquote, not the box.
    assert.deepEqual(group.marks, [prose("one-a"), prose("two-a"), prose("three-a")]);
    assert.match(group.key, /^\d+\|DIV\|post-content post-content-double$/);
  });

  it("is the same shape on every parse of the same page", () => {
    const first = bodyPieces(page(arsLike().body));
    const again = bodyPieces(page(arsLike().body));
    assert.deepEqual(
      again.map((group) => group.key),
      first.map((group) => group.key),
    );
  });

  it("wants two boxes of a shape, a class on them, and a paragraph long enough to count", () => {
    const lone = el("body", {}, [el("div", { class: "entry-content" }, [p("only"), p("only-b")])]);
    assert.deepEqual(bodyPieces(page(lone)), []);

    const classless = el("body", {}, [
      el("div", {}, [p("first")]),
      el("div", {}, [p("second")]),
      el("div", { class: "  " }, [p("third")]),
    ]);
    assert.deepEqual(bodyPieces(page(classless)), []);

    const short = el("body", {}, [
      el("div", { class: "note" }, [el("p", {}, [text("Too short to count.")])]),
      el("div", { class: "note" }, [el("p", {}, [text("Also too short.")])]),
    ]);
    assert.deepEqual(bodyPieces(page(short)), []);
  });

  it("tells boxes of one class apart by depth", () => {
    const body = el("body", {}, [
      el("div", { class: "text" }, [p("shallow")]),
      el("section", {}, [el("div", { class: "text" }, [p("deep")])]),
    ]);
    assert.deepEqual(bodyPieces(page(body)), []);
  });

  it("leaves alone the boxes whose class says comment, sidebar, widget", () => {
    const body = el("body", {}, [
      el("div", { class: "entry-content" }, [p("article-a")]),
      el("div", { class: "entry-content" }, [p("article-b")]),
      el("div", { class: "comment-body" }, [p("comment-1")]),
      el("div", { class: "comment-body" }, [p("comment-2")]),
      el("div", { class: "comment-body" }, [p("comment-3")]),
      el("aside", { class: "sidebar-text" }, [p("side-1")]),
      el("aside", { class: "sidebar-text" }, [p("side-2")]),
      el("div", { class: "promo widget" }, [p("promo-1")]),
      el("div", { class: "promo widget" }, [p("promo-2")]),
    ]);
    const groups = bodyPieces(page(body));
    assert.deepEqual(
      groups.map((group) => group.marks),
      [[prose("article-a"), prose("article-b")]],
    );
  });

  it("squashes the whitespace of a mark and picks the longest paragraph", () => {
    const long = `${prose("long")} ${prose("and longer")}`;
    const box = () =>
      el("div", { class: "body-text" }, [
        el("p", {}, [text(`  ${prose("short").replace(/ /g, "\n  ")}  `)]),
        el("p", {}, [text(long.replace(" and ", "\n\n   and ")), text("")]),
      ]);
    const groups = bodyPieces(page(el("body", {}, [box(), box()])));
    assert.deepEqual(
      groups.map((group) => group.marks),
      [[long, long]],
    );
  });
});

describe("tornGroups and marksHeld", () => {
  const groups = bodyPieces(page(arsLike().body));

  it("is torn when the text holds some of a group's marks and not all", () => {
    const middle = `A title\n${prose("two-a")}\n${prose("two-quote")}\n${prose("two-b")}`;
    assert.deepEqual(tornGroups(groups, middle), groups);
    assert.equal(marksHeld(groups, middle), 1);
  });

  it("is whole when the text holds every mark, even with other whitespace", () => {
    const whole = [prose("one-a"), prose("two-a"), prose("three-a")]
      .map((mark) => mark.replace(/ /g, "\n \t"))
      .join("\n");
    assert.deepEqual(tornGroups(groups, whole), []);
    assert.equal(marksHeld(groups, whole), 3);
  });

  it("is nobody's when the text holds none of the marks", () => {
    assert.deepEqual(tornGroups(groups, prose("somewhere else entirely")), []);
    assert.equal(marksHeld(groups, ""), 0);
  });
});

describe("joinGroups", () => {
  it("moves the later boxes' contents into the first, in order, and leaves them empty", () => {
    const { body, boxes } = arsLike();
    const groups = bodyPieces(page(body));
    const torn = tornGroups(groups, prose("two-a"));
    assert.equal(torn.length, 1);

    // The document being joined is a fresh parse: its own groups, matched by key.
    const fresh = arsLike();
    const joined = joinGroups(bodyPieces(page(fresh.body)), torn);
    assert.equal(joined, 1);

    const contents = fresh.boxes.map((row) => {
      const column = row.childNodes[0];
      const box = column?.childNodes[0];
      assert.ok(box);
      return box.childNodes.map((child) => (child.tagName === "P" ? child.textContent : child.tagName));
    });
    assert.deepEqual(contents, [
      [prose("one-a"), prose("one-b"), prose("two-a"), "BLOCKQUOTE", prose("two-b"), prose("three-a")],
      [],
      [],
    ]);
    // Every moved node knows its new parent, and the rows still stand where they were.
    const first = fresh.boxes[0]?.childNodes[0]?.childNodes[0];
    assert.ok(first);
    for (const child of first.childNodes) assert.equal(child.parentNode, first);
    assert.equal(fresh.body.childNodes[0]?.childNodes.length, 6);
    // The page the groups were read from is not the one joined.
    assert.equal(boxes[1]?.childNodes[0]?.childNodes[0]?.childNodes.length, 3);
  });

  it("joins only the torn groups and counts what it joined", () => {
    const build = () =>
      el("body", {}, [
        el("div", { class: "entry-content" }, [p("article-a")]),
        el("div", { class: "entry-content" }, [p("article-b")]),
        el("div", { class: "review-text" }, [p("review-1")]),
        el("div", { class: "review-text" }, [p("review-2")]),
      ]);
    const groups = bodyPieces(page(build()));
    assert.equal(groups.length, 2);
    const torn = tornGroups(groups, prose("article-a"));
    assert.deepEqual(
      torn.map((group) => group.marks),
      [[prose("article-a"), prose("article-b")]],
    );

    const fresh = build();
    assert.equal(joinGroups(bodyPieces(page(fresh)), torn), 1);
    assert.deepEqual(
      fresh.childNodes.map((box) => box.childNodes.length),
      [2, 0, 1, 1],
    );
    assert.equal(joinGroups(bodyPieces(page(build())), []), 0);
  });
});
