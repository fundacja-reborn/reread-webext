import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildArticle } from "../src/lib/reader/article.js";
import { allowedAttributes, decide, safeHref } from "../src/lib/reader/sanitize.js";

const BASE = "https://example.test/section/article";

/**
 * A source tree, in as much of a DOM as the walk reads: node type, tag name,
 * children, and one attribute at a time. Nothing here is a real DOM and that is
 * the point - `node --test` has no DOM, and this is the one piece of the reader
 * where a mistake means somebody's script running on an extension page.
 *
 * @param {string} tagName
 * @param {Record<string, string>} [attributes]
 * @param {object[]} [children]
 */
function el(tagName, attributes = {}, children = []) {
  return {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    childNodes: children,
    /** @param {string} name */
    getAttribute: (name) => (name in attributes ? attributes[name] : null),
  };
}

/** @param {string} data */
function text(data) {
  return { nodeType: 3, nodeValue: data, childNodes: [] };
}

/** A comment: neither text to read nor structure to keep. */
function comment() {
  return { nodeType: 8, nodeValue: " an aside from the author ", childNodes: [] };
}

function fakeDocument() {
  return {
    /** @param {string} tagName */
    createElement(tagName) {
      return {
        nodeType: 1,
        tagName: tagName.toUpperCase(),
        /** @type {object[]} */
        childNodes: [],
        /** @type {Record<string, string>} */
        attributes: {},
        /** @param {object} child */
        appendChild(child) {
          this.childNodes.push(child);
          return child;
        },
        /**
         * @param {string} name
         * @param {string} value
         */
        setAttribute(name, value) {
          this.attributes[name] = value;
        },
      };
    },
    /** @param {string} data */
    createTextNode(data) {
      return { nodeType: 3, nodeValue: data, childNodes: [] };
    },
  };
}

/**
 * What came out, as something a failing assertion can be read from.
 *
 * @param {any} node
 * @returns {string}
 */
function serialize(node) {
  if (node.nodeType === 3) return node.nodeValue;
  const name = node.tagName.toLowerCase();
  const attributes = Object.entries(node.attributes ?? {})
    .map(([key, value]) => ` ${key}="${value}"`)
    .join("");
  const inside = node.childNodes.map(serialize).join("");
  return `<${name}${attributes}>${inside}</${name}>`;
}

/**
 * The one place the fakes are called a DOM. Everything above is checked by the
 * assertions; this cast is what lets the walk be written against real types.
 *
 * @param {object} source
 * @returns {string} the rebuilt article, serialized
 */
function rebuild(source) {
  const built = buildArticle(
    /** @type {Element} */ (/** @type {unknown} */ (source)),
    /** @type {Document} */ (/** @type {unknown} */ (fakeDocument())),
    { baseUrl: BASE },
  );
  return serialize(built);
}

describe("rebuilding an article", () => {
  it("keeps text and the elements that shape it", () => {
    const source = el("body", {}, [
      el("h2", {}, [text("A heading")]),
      el("p", {}, [text("Some "), el("em", {}, [text("emphasis")]), text(" here.")]),
      el("ul", {}, [el("li", {}, [text("one")]), el("li", {}, [text("two")])]),
    ]);

    assert.equal(
      rebuild(source),
      "<div><h2>A heading</h2><p>Some <em>emphasis</em> here.</p>" +
        "<ul><li>one</li><li>two</li></ul></div>",
    );
  });

  it("drops what runs, loads or plays - and everything inside it", () => {
    const source = el("body", {}, [
      el("script", {}, [text("alert(1)")]),
      el("style", {}, [text("body { display: none }")]),
      el("iframe", { src: "https://ads.test/" }, [text("fallback")]),
      el("img", { src: "https://cdn.test/photo.jpg" }),
      el("form", {}, [el("input", { value: "secret" })]),
      el("noscript", {}, [text("turn on scripts")]),
      el("p", {}, [text("the article")]),
    ]);

    assert.equal(rebuild(source), "<div><p>the article</p></div>");
  });

  it("unwraps what it does not know, because the text is still the article", () => {
    const source = el("body", {}, [
      el("article", {}, [
        el("section", {}, [el("p", {}, [text("first")])]),
        el("my-paywall-widget", {}, [el("p", {}, [text("second")])]),
      ]),
    ]);

    assert.equal(rebuild(source), "<div><p>first</p><p>second</p></div>");
  });

  it("throws away class, id and style, which is where the typography comes from", () => {
    const source = el("body", {}, [
      el("p", { class: "lede", id: "first", style: "color: red", onclick: "steal()" }, [
        text("plain"),
      ]),
    ]);

    assert.equal(rebuild(source), "<div><p>plain</p></div>");
  });

  it("keeps the few attributes that are about reading", () => {
    const source = el("body", {}, [
      el("table", {}, [
        el("tr", {}, [el("td", { colspan: "2", class: "x" }, [text("cell")])]),
      ]),
      el("abbr", { title: "and so on" }, [text("etc.")]),
      el("time", { datetime: "2026-08-11" }, [text("today")]),
      el("p", { lang: "fr", dir: "ltr" }, [text("bonjour")]),
    ]);

    assert.equal(
      rebuild(source),
      '<div><table><tr><td colspan="2">cell</td></tr></table>' +
        '<abbr title="and so on">etc.</abbr>' +
        '<time datetime="2026-08-11">today</time>' +
        '<p lang="fr" dir="ltr">bonjour</p></div>',
    );
  });

  it("makes links absolute and sends them to a new tab", () => {
    const source = el("body", {}, [el("a", { href: "../other" }, [text("elsewhere")])]);

    assert.equal(
      rebuild(source),
      '<div><a href="https://example.test/other" target="_blank" rel="noreferrer noopener">' +
        "elsewhere</a></div>",
    );
  });

  it("keeps the text of a link nobody should follow, and not the link", () => {
    const source = el("body", {}, [
      el("a", { href: "javascript:steal()" }, [text("click me")]),
      el("a", { href: "data:text/html,<script>steal()</script>" }, [text("or me")]),
    ]);

    // The element survives because the words are part of the sentence; the
    // destination does not, so there is nothing to follow and no target to open.
    assert.equal(rebuild(source), "<div><a>click me</a><a>or me</a></div>");
  });

  it("ignores comments and empty text", () => {
    const source = el("body", {}, [comment(), text(""), el("p", {}, [text("kept")])]);

    assert.equal(rebuild(source), "<div><p>kept</p></div>");
  });
});

/**
 * The rebuild with the caller's word on pictures.
 *
 * @param {object} source
 * @param {import("../src/lib/reader/article.js").Pictures | undefined} pictures
 * @param {string} [baseUrl]
 */
function rebuildWith(source, pictures, baseUrl = BASE) {
  return serialize(
    buildArticle(
      /** @type {Element} */ (/** @type {unknown} */ (source)),
      /** @type {Document} */ (/** @type {unknown} */ (fakeDocument())),
      { baseUrl, pictures },
    ),
  );
}

/**
 * The elements alone, attributes stripped - what the highlighter's marks and
 * the reading position count.
 *
 * @param {string} serialized
 */
const shape = (serialized) => serialized.replace(/<([a-z0-9]+)[^>]*>/g, "<$1>");

describe("pictures in the rebuild (D145)", () => {
  const source = el("body", {}, [
    el("p", {}, [text("before")]),
    el("figure", {}, [
      el("picture", {}, [
        el("source", { srcset: "https://cdn.test/photo.avif" }),
        el("img", { src: "/images/photo.jpg", alt: "A photo" }),
      ]),
      el("figcaption", {}, [text("Figure 1")]),
    ]),
    el("img", { src: "http://cdn.test/plain.jpg" }),
    el("img", { src: "data:image/gif;base64,R0lGODlh" }),
    el("img", { src: "javascript:alert(1)" }),
    el("img", { "data-src": "https://cdn.test/stored.png", alt: "" }),
    el("p", {}, [text("after")]),
  ]);

  it("keeps a picture's address where nothing loads from, and only an https one", () => {
    assert.equal(
      rebuildWith(source, true),
      "<div><p>before</p>" +
        '<figure><img data-src="https://example.test/images/photo.jpg" alt="A photo"></img>' +
        "<figcaption>Figure 1</figcaption></figure>" +
        '<img data-src="https://cdn.test/stored.png"></img>' +
        "<p>after</p></div>",
    );
  });

  it("drops pictures altogether for the callers that never show one", () => {
    assert.equal(
      rebuildWith(source, undefined),
      "<div><p>before</p><figure><figcaption>Figure 1</figcaption></figure><p>after</p></div>",
    );
    // A book has no base to resolve against, so no picture has an address.
    assert.equal(
      rebuildWith(source, true, ""),
      "<div><p>before</p><figure><figcaption>Figure 1</figcaption></figure><p>after</p></div>",
    );
  });

  it("shows only the pictures the database holds, and keeps the same elements either way", () => {
    /** @type {import("../src/lib/reader/article.js").Pictures} */
    const stored = (src) =>
      src === "https://example.test/images/photo.jpg" ? { url: "blob:page/1", width: 800, height: 600 } : null;
    const shown = rebuildWith(source, stored);
    assert.equal(
      shown,
      "<div><p>before</p>" +
        '<figure><img data-src="https://example.test/images/photo.jpg" alt="A photo" src="blob:page/1" width="800" height="600"></img>' +
        "<figcaption>Figure 1</figcaption></figure>" +
        '<img data-src="https://cdn.test/stored.png"></img>' +
        "<p>after</p></div>",
    );
    assert.equal(shape(shown), shape(rebuildWith(source, true)));
  });
});

describe("the allow list itself", () => {
  it("answers one of three things about an element", () => {
    assert.equal(decide("P"), "keep");
    assert.equal(decide("blockquote"), "keep");
    assert.equal(decide("SCRIPT"), "drop");
    assert.equal(decide("img"), "image");
    assert.equal(decide("picture"), "unwrap");
    assert.equal(decide("section"), "unwrap");
    assert.equal(decide("some-custom-element"), "unwrap");
  });

  it("offers lang and dir on anything, and the rest per element", () => {
    assert.deepEqual(allowedAttributes("p"), ["lang", "dir"]);
    assert.deepEqual(allowedAttributes("A"), ["href", "lang", "dir"]);
    assert.ok(allowedAttributes("td").includes("colspan"));
  });

  it("accepts the three schemes a reader can follow, and no others", () => {
    assert.equal(safeHref("/next", BASE), "https://example.test/next");
    assert.equal(safeHref("http://plain.test/", BASE), "http://plain.test/");
    assert.equal(safeHref("mailto:someone@example.test", BASE), "mailto:someone@example.test");

    assert.equal(safeHref("javascript:steal()", BASE), null);
    assert.equal(safeHref("data:text/html,hi", BASE), null);
    assert.equal(safeHref("file:///etc/passwd", BASE), null);
    assert.equal(safeHref("", BASE), null);
    assert.equal(safeHref(null, BASE), null);
    assert.equal(safeHref("http://[bad", BASE), null);
  });

  it("refuses every link over an empty base - what makes imported books linkless", () => {
    // The URL constructor parses the base before the value, so no base means
    // no links at all, absolute ones included. The book import counts on it.
    assert.equal(safeHref("http://plain.test/", ""), null);
    assert.equal(safeHref("ch2.xhtml", ""), null);
  });
});
