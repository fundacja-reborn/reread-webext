import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MARKDOWN_MIME, markdownDocument } from "../src/lib/store/markdown-file.js";

/**
 * The same fakes the EPUB test hands its writer: node type, lower-case
 * name, children, one attribute at a time.
 *
 * @param {string} localName
 * @param {Record<string, string>} [attributes]
 * @param {object[]} [children]
 */
function el(localName, attributes = {}, children = []) {
  return {
    nodeType: 1,
    localName,
    childNodes: children,
    /** @param {string} name */
    getAttribute: (name) => (name in attributes ? attributes[name] : null),
  };
}

/** @param {string} data */
function text(data) {
  return { nodeType: 3, nodeValue: data, childNodes: [] };
}

/**
 * The body of one part as the file writes it, without the header - what
 * most cases are about.
 *
 * @param {object[]} children of the rebuilt root
 * @returns {string}
 */
function body(children) {
  const page = markdownDocument({ title: "T", source: null, at: 0 });
  page.part(/** @type {import("../src/lib/store/export-tree.js").ExportNode} */ (el("div", {}, children)));
  const whole = page.text();
  assert.ok(whole.startsWith("# T\n\n"), whole);
  return whole.slice("# T\n\n".length).replace(/\n$/, "");
}

describe("markdownDocument", () => {
  it("opens with the title, where the document came from and the day", () => {
    const page = markdownDocument({
      title: "  A long\narticle  ",
      source: "https://example.test/long",
      at: Date.UTC(2026, 7, 17, 13, 30),
    });
    page.part(/** @type {import("../src/lib/store/export-tree.js").ExportNode} */ (el("div", {}, [el("p", {}, [text("Body")])])));
    assert.equal(page.text(), "# A long article\n\nhttps://example.test/long - 2026-08-17\n\nBody\n");
  });

  it("says nothing about a source or a day it does not have", () => {
    const page = markdownDocument({ title: "Bare", source: null, at: 0 });
    page.part(/** @type {import("../src/lib/store/export-tree.js").ExportNode} */ (el("div", {}, [el("p", {}, [text("Body")])])));
    assert.equal(page.text(), "# Bare\n\nBody\n");
    const authored = markdownDocument({ title: "Book", source: "An Author", at: 0 });
    authored.part(/** @type {import("../src/lib/store/export-tree.js").ExportNode} */ (el("div", {}, [])));
    assert.equal(authored.text(), "# Book\n\nAn Author\n");
  });

  it("writes headings, paragraphs and rules, whitespace collapsed", () => {
    assert.equal(
      body([
        el("h1", {}, [text(" Top ")]),
        el("p", {}, [text("One\n  two  three")]),
        el("h3", {}, [text("Deep"), el("br"), text("er")]),
        el("hr"),
        el("h6", {}, [text("Six")]),
        el("h2", {}, [text("   ")]),
      ]),
      "# Top\n\nOne two three\n\n### Deep er\n\n---\n\n###### Six",
    );
  });

  it("writes emphasis around the words alone, with the air outside the marks", () => {
    assert.equal(
      body([
        el("p", {}, [
          text("Some "),
          el("em", {}, [text(" emphasis ")]),
          text("and"),
          el("strong", {}, [text(" strength")]),
          text(", un"),
          el("i", {}, [text("believ")]),
          text("able, "),
          el("s", {}, [text("gone")]),
          text(" "),
          el("b", {}, [text("   ")]),
          text("end"),
        ]),
      ]),
      "Some *emphasis* and **strength**, un*believ*able, ~~gone~~ end",
    );
  });

  it("writes links to the web with their words, and the words alone for the rest", () => {
    assert.equal(
      body([
        el("p", {}, [
          el("a", { href: "https://example.test/a (b)" }, [text(" go ")]),
          el("a", { href: "javascript:alert(1)" }, [text("no ")]),
          el("a", {}, [text("plain")]),
          el("a", { href: "https://example.test/" }, [text("  ")]),
        ]),
      ]),
      "[go](https://example.test/a%20%28b%29) no plain",
    );
  });

  it("writes a picture by its web address, and none for a path in an archive", () => {
    const children = [
      el("figure", {}, [
        el("img", { "data-src": "https://cdn.test/one.jpg", alt: "A [photo]" }),
        el("figcaption", {}, [text("Caption")]),
      ]),
      el("p", {}, [text("Before "), el("img", { "data-src": "OEBPS/images/x.jpg", alt: "inside" }), text(" after")]),
    ];
    assert.equal(body(children), "![A \\[photo\\]](https://cdn.test/one.jpg)\n\n*Caption*\n\nBefore after");
  });

  it("writes lists with their marks, nested and numbered from where the page starts", () => {
    assert.equal(
      body([
        el("ul", {}, [
          el("li", {}, [text("one")]),
          el("li", {}, [text("two"), el("ul", {}, [el("li", {}, [text("deep")])])]),
          el("li", {}, [el("p", {}, [text("first")]), el("p", {}, [text("second")])]),
        ]),
        el("ol", { start: "3" }, [el("li", {}, [text("three")]), el("li", {}, [text("four")])]),
      ]),
      "- one\n- two\n  - deep\n- first\n\n  second\n\n3. three\n4. four",
    );
  });

  it("writes a quote with every line marked, blocks of one quote together", () => {
    assert.equal(
      body([el("blockquote", {}, [el("p", {}, [text("First")]), el("p", {}, [text("Second"), el("br"), text("line")])])]),
      "> First\n>\n> Second\\\n> line",
    );
  });

  it("writes code as it stands, inside a fence longer than any run it holds", () => {
    assert.equal(
      body([
        el("pre", {}, [el("code", {}, [text("\nlet a = 1; // *not* emphasis\n```\n")])]),
        el("p", {}, [text("Run "), el("code", {}, [text("a`b")]), text(" or "), el("kbd", {}, [text("`x`")])]),
      ]),
      "````\nlet a = 1; // *not* emphasis\n```\n````\n\nRun ``a`b`` or `` `x` ``",
    );
  });

  it("writes a table as rows of cells, the first as the head", () => {
    assert.equal(
      body([
        el("table", {}, [
          el("caption", {}, [text("Sizes")]),
          el("thead", {}, [el("tr", {}, [el("th", {}, [text("Name")]), el("th", {}, [text("A|B")])])]),
          el("tbody", {}, [
            el("tr", {}, [el("td", {}, [text("x"), el("br"), text("y")]), el("td", {}, [text("1")])]),
            el("tr", {}, [el("td", {}, [text("short")])]),
          ]),
        ]),
      ]),
      "*Sizes*\n\n| Name | A\\|B |\n| --- | --- |\n| x y | 1 |\n| short |  |",
    );
  });

  it("writes a definition list as terms over their definitions", () => {
    assert.equal(
      body([
        el("dl", {}, [
          el("dt", {}, [text("Term")]),
          el("dd", {}, [text("Meaning one")]),
          el("dd", {}, [text("Meaning two")]),
          el("dt", {}, [text("Other")]),
          el("dd", {}, [text("Its meaning")]),
        ]),
      ]),
      "Term\n: Meaning one\n: Meaning two\n\nOther\n: Its meaning",
    );
  });

  it("makes a footnote of a note, numbered across the parts, the notes at the end", () => {
    const page = markdownDocument({ title: "B", source: null, at: 0 });
    const part = (/** @type {object} */ root) =>
      page.part(/** @type {import("../src/lib/store/export-tree.js").ExportNode} */ (root));
    part(el("div", {}, [el("p", {}, [text("First"), el("a", { "data-note": "The *note*" }, [text("1")])])]));
    part(el("div", {}, [el("p", {}, [text("Second"), el("a", { "data-note": "Another\n note" }, [text("2")])])]));
    assert.equal(page.text(), "# B\n\nFirst[^1]\n\nSecond[^2]\n\n[^1]: The \\*note\\*\n[^2]: Another note\n");
  });

  it("escapes what would read as markup, inside a line and at its start", () => {
    assert.equal(
      body([
        el("p", {}, [text("a * b _c_ [d] `e` \\f 5 < 6 <b>")]),
        el("p", {}, [text("# not a heading")]),
        el("p", {}, [text("- not a bullet"), el("br"), text("1. not a list"), el("br"), text("> not a quote")]),
        el("p", {}, [text("#hashtag stays, -dash stays, 3.14 stays")]),
      ]),
      "a \\* b \\_c\\_ \\[d\\] \\`e\\` \\\\f 5 < 6 \\<b>\n\n\\# not a heading\n\n\\- not a bullet\\\n1\\. not a list\\\n\\> not a quote\n\n#hashtag stays, -dash stays, 3.14 stays",
    );
  });

  it("drops what the allowed list drops and unwraps what it does not know", () => {
    assert.equal(
      body([
        el("script", {}, [text("alert(1)")]),
        el("section", {}, [el("article", {}, [el("p", {}, [text("kept")])])]),
        el("my-widget", {}, [text("loose words")]),
        el("div", {}, [text("  "), el("p", {}, [text("in a division")]), text("tail")]),
        el("p", {}, [el("q", {}, [text(" quoted ")]), el("sup", {}, [text("2")]), el("span", {}, [text(" span")])]),
      ]),
      "kept\n\nloose words\n\nin a division\n\ntail\n\n\"quoted\"2 span",
    );
  });

  it("is a Markdown file", () => {
    assert.equal(MARKDOWN_MIME, "text/markdown");
  });
});
