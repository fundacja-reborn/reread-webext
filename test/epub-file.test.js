import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EPUB_MIME,
  FILENAME_LIMIT,
  MIMETYPE_ENTRY,
  documentFilename,
  documentIdentifier,
  epubDocument,
  languageTag,
  modifiedStamp,
  navItems,
  xmlAttribute,
  xmlText,
} from "../src/lib/store/epub-file.js";

/**
 * A rebuilt tree in as much of a DOM as the writer reads: node type,
 * lower-case name, children, and one attribute at a time - the same fakes
 * `reader-article.test.js` hands the rebuild.
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

/** A comment: neither text nor structure. */
function comment() {
  return { nodeType: 8, nodeValue: " aside ", childNodes: [] };
}

/**
 * @param {object} node
 * @returns {import("../src/lib/store/export-tree.js").ExportNode}
 */
function tree(node) {
  return /** @type {import("../src/lib/store/export-tree.js").ExportNode} */ (node);
}

const decoder = new TextDecoder();

/**
 * @param {import("../src/lib/store/epub-file.js").ArchiveEntry[]} entries
 * @param {string} name
 * @returns {string}
 */
function entryText(entries, name) {
  const entry = entries.find((one) => one.name === name);
  assert.ok(entry !== undefined, `no entry ${name} among ${entries.map((one) => one.name).join(", ")}`);
  return decoder.decode(entry.data);
}

/**
 * The body of a part alone - what a case about the text is about.
 *
 * @param {string} part
 * @returns {string}
 */
function bodyOf(part) {
  const match = /<body>\n([\s\S]*)\n<\/body>/.exec(part);
  assert.ok(match !== null, part);
  return String(match[1]);
}

/**
 * The package around one article of a root, the way the reader page asks
 * for it.
 *
 * @param {object} root
 * @param {Partial<import("../src/lib/store/epub-file.js").EpubMeta>} [over]
 */
function articleEntries(root, over = {}) {
  const book = epubDocument({
    identifier: "https://example.test/a",
    title: "An article",
    lang: "en",
    dir: null,
    source: "https://example.test/a",
    modifiedAt: Date.UTC(2026, 8, 16, 10, 30, 5, 250),
    pictures: [],
    contentsLabel: "Contents",
    ...over,
  });
  book.part(tree(root));
  return book.entries();
}

/** A picture row as the database holds one, with a few bytes for data. */
function picture(/** @type {number} */ index, /** @type {string} */ src, mime = "image/jpeg") {
  return { url: "https://example.test/a", index, src, mime, width: 100, height: 80, data: new Uint8Array([1, 2, 3, index]).buffer };
}

describe("xmlText and xmlAttribute", () => {
  it("escape the three characters that open markup, and the quote in an attribute", () => {
    assert.equal(xmlText("a < b & c > d \"q\""), "a &lt; b &amp; c &gt; d \"q\"");
    assert.equal(xmlAttribute("say \"hi\" & <go>"), "say &quot;hi&quot; &amp; &lt;go&gt;");
  });

  it("drop what XML forbids and keep what it allows", () => {
    // A form feed and a lone surrogate go; tab, newline and a non-breaking
    // space stay, and so does an emoji beyond the basic plane.
    const forbidden = String.fromCodePoint(0x0c) + String.fromCodePoint(0xd800);
    const kept = "tab\tline\n" + String.fromCodePoint(0xa0) + String.fromCodePoint(0x1f600);
    assert.equal(xmlText(forbidden + kept), kept);
  });
});

describe("documentFilename", () => {
  it("names the file after the title, with the extension", () => {
    assert.equal(documentFilename("A long article", "epub"), "A long article.epub");
    assert.equal(documentFilename("Notes", "md"), "Notes.md");
  });

  it("takes out what a file system refuses, and the ends a file system strips", () => {
    assert.equal(documentFilename('Q: "why?" / a\\b | c*d <e>', "epub"), "Q why a b c d e.epub");
    assert.equal(documentFilename("  ...dotted.  ", "md"), "dotted.md");
    assert.equal(documentFilename("tab\tand\nnewline", "md"), "tab and newline.md");
  });

  it("holds a title to the limit and falls back for a title that leaves nothing", () => {
    const long = "x".repeat(FILENAME_LIMIT + 20);
    assert.equal(documentFilename(long, "epub"), `${"x".repeat(FILENAME_LIMIT)}.epub`);
    assert.equal(documentFilename("???", "epub"), "reread-document.epub");
    assert.equal(documentFilename("", "md"), "reread-document.md");
  });
});

describe("documentIdentifier, languageTag and modifiedStamp", () => {
  it("names an article by its address and a book by a URN of its id", () => {
    assert.equal(documentIdentifier("article", "https://example.test/a?x=1"), "https://example.test/a?x=1");
    assert.equal(
      documentIdentifier("book", "4A3F9C2E-1B7D-4E5A-9F00-0123456789AB"),
      "urn:uuid:4a3f9c2e-1b7d-4e5a-9f00-0123456789ab",
    );
    assert.equal(documentIdentifier("book", "hand-made"), "urn:reread:book:hand-made");
  });

  it("passes a language tag through, reads an underscore as a hyphen, and says und otherwise", () => {
    assert.equal(languageTag("en"), "en");
    assert.equal(languageTag("pt-BR"), "pt-BR");
    assert.equal(languageTag("en_US"), "en-US");
    assert.equal(languageTag("not a tag"), "und");
    assert.equal(languageTag(null), "und");
    assert.equal(languageTag(""), "und");
  });

  it("writes the stamp in the one form the package allows, from the document's own clock", () => {
    assert.equal(modifiedStamp(Date.UTC(2026, 8, 16, 10, 30, 5, 250)), "2026-09-16T10:30:05Z");
    assert.equal(modifiedStamp(Number.NaN), "1970-01-01T00:00:00Z");
    assert.equal(modifiedStamp(-5), "1970-01-01T00:00:00Z");
  });
});

describe("epubDocument", () => {
  it("writes the container in the order a reader sniffs it, the mimetype first and stored", () => {
    const entries = articleEntries(el("div", {}, [el("p", {}, [text("Hello")])]));
    assert.deepEqual(
      entries.map((entry) => entry.name),
      [MIMETYPE_ENTRY, "META-INF/container.xml", "OEBPS/content.opf", "OEBPS/nav.xhtml", "OEBPS/style.css", "OEBPS/text-1.xhtml"],
    );
    assert.equal(entries[0]?.deflate, false);
    assert.equal(decoder.decode(entries[0]?.data), EPUB_MIME);
    assert.ok(entries.slice(1).every((entry) => entry.deflate));
    assert.match(entryText(entries, "META-INF/container.xml"), /full-path="OEBPS\/content\.opf"/);
  });

  it("writes the package with its required metadata, the manifest and the spine", () => {
    const entries = articleEntries(el("div", {}, [el("p", {}, [text("Hello")])]));
    const opf = entryText(entries, "OEBPS/content.opf");
    assert.match(opf, /<package [^>]*version="3\.0" unique-identifier="uid" xml:lang="en">/);
    assert.match(opf, /<dc:identifier id="uid">https:\/\/example\.test\/a<\/dc:identifier>/);
    assert.match(opf, /<dc:title>An article<\/dc:title>/);
    assert.match(opf, /<dc:language>en<\/dc:language>/);
    assert.match(opf, /<dc:source>https:\/\/example\.test\/a<\/dc:source>/);
    assert.doesNotMatch(opf, /dc:creator/);
    assert.match(opf, /<meta property="dcterms:modified">2026-09-16T10:30:05Z<\/meta>/);
    assert.match(opf, /<item id="nav" href="nav\.xhtml" media-type="application\/xhtml\+xml" properties="nav"\/>/);
    assert.match(opf, /<item id="text-1" href="text-1\.xhtml" media-type="application\/xhtml\+xml"\/>/);
    assert.match(opf, /<spine>\n<itemref idref="text-1"\/>\n<\/spine>/);
  });

  it("writes a book's author as the creator and says und for a language it does not know", () => {
    const book = epubDocument({
      identifier: "urn:uuid:1",
      title: "Dracula",
      lang: "??",
      dir: null,
      author: "Bram Stoker",
      modifiedAt: 1000,
      pictures: [],
      contentsLabel: "Contents",
    });
    book.part(tree(el("div", {}, [el("p", {}, [text("Once")])])));
    const opf = entryText(book.entries(), "OEBPS/content.opf");
    assert.match(opf, /<dc:creator>Bram Stoker<\/dc:creator>/);
    assert.match(opf, /<dc:language>und<\/dc:language>/);
    assert.doesNotMatch(opf, /dc:source/);
    // No language on the part's root either: a guess is not written.
    const part = entryText(book.entries(), "OEBPS/text-1.xhtml");
    assert.doesNotMatch(part, /xml:lang/);
    assert.doesNotMatch(part, /doc-head/);
  });

  it("opens an article's text with its title and its address, and closes the void elements", () => {
    const entries = articleEntries(
      el("div", {}, [
        el("p", {}, [text("One"), el("br"), text("two")]),
        el("hr"),
        el("p", { lang: "fr", dir: "RTL" }, [text("Trois")]),
      ]),
      { dir: "rtl" },
    );
    const part = entryText(entries, "OEBPS/text-1.xhtml");
    assert.match(part, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<html xmlns="http:\/\/www\.w3\.org\/1999\/xhtml" xmlns:epub="http:\/\/www\.idpf\.org\/2007\/ops" xml:lang="en" lang="en" dir="rtl">/);
    assert.match(part, /<title>An article<\/title>/);
    assert.match(part, /<link rel="stylesheet" type="text\/css" href="style\.css"\/>/);
    assert.match(
      part,
      /<header class="doc-head">\n<h1 class="doc-title">An article<\/h1>\n<p class="doc-source"><a href="https:\/\/example\.test\/a">https:\/\/example\.test\/a<\/a><\/p>\n<\/header>/,
    );
    assert.match(part, /<p>One<br\/>two<\/p><hr\/><p lang="fr" dir="rtl">Trois<\/p>/);
  });

  it("keeps only what the allowed list keeps, and only the attributes it names", () => {
    const entries = articleEntries(
      el("div", {}, [
        el("script", {}, [text("alert(1)")]),
        el("section", {}, [el("p", { class: "x", style: "color:red", id: "p1" }, [text("kept")])]),
        el("a", { href: "https://example.test/link", target: "_blank", rel: "noreferrer", onclick: "x()" }, [text("go")]),
        el("a", { href: "javascript:alert(1)" }, [text("no")]),
        el("blockquote", { cite: "data:text/html,x" }, [text("q")]),
        el("ol", { start: "3", reversed: "reversed", type: "a" }, [el("li", { value: "7" }, [text("i")])]),
        comment(),
      ]),
    );
    const part = bodyOf(entryText(entries, "OEBPS/text-1.xhtml"));
    assert.doesNotMatch(part, /alert|script|class="x"|style=|id="p1"|target=|rel=|onclick/);
    assert.match(part, /<p>kept<\/p><a href="https:\/\/example\.test\/link">go<\/a><a>no<\/a><blockquote>q<\/blockquote>/);
    assert.match(part, /<ol start="3" reversed="reversed" type="a"><li value="7">i<\/li><\/ol>/);
  });

  it("escapes the text and the attributes, and drops what XML forbids", () => {
    const entries = articleEntries(
      el("div", {}, [
        el("p", {}, [text("a < b & c" + String.fromCodePoint(0x0c))]),
        el("abbr", { title: 'say "hi"' }, [text("x")]),
      ]),
    );
    const part = entryText(entries, "OEBPS/text-1.xhtml");
    assert.match(part, /<p>a &lt; b &amp; c<\/p><abbr title="say &quot;hi&quot;">x<\/abbr>/);
  });

  it("gives every h1-h3 an id and lists them in the contents, nested by level", () => {
    const entries = articleEntries(
      el("div", {}, [
        el("h1", {}, [text("Book")]),
        el("h3", {}, [text("  Deep  ")]),
        el("h2", {}, [text("Middle")]),
        el("h4", {}, [text("Not listed")]),
        el("h2", {}, [text("   ")]),
      ]),
    );
    const part = entryText(entries, "OEBPS/text-1.xhtml");
    assert.match(part, /<h1 id="heading-1">Book<\/h1><h3 id="heading-2">  Deep  <\/h3><h2 id="heading-3">Middle<\/h2><h4>Not listed<\/h4><h2>   <\/h2>/);
    const nav = entryText(entries, "OEBPS/nav.xhtml");
    assert.match(nav, /<nav epub:type="toc" id="toc">\n<h1>Contents<\/h1>/);
    assert.match(
      nav,
      /<ol>\n<li><a href="text-1\.xhtml#heading-1">Book<\/a><ol><li><a href="text-1\.xhtml#heading-2">Deep<\/a><\/li><li><a href="text-1\.xhtml#heading-3">Middle<\/a><\/li><\/ol><\/li>\n<\/ol>/,
    );
  });

  it("lists the document itself when the text has no heading", () => {
    const entries = articleEntries(el("div", {}, [el("p", {}, [text("Plain")])]));
    const nav = entryText(entries, "OEBPS/nav.xhtml");
    assert.match(nav, /<ol>\n<li><a href="text-1\.xhtml">An article<\/a><\/li>\n<\/ol>/);
  });

  it("writes a book part by part, the contents across parts, the footnotes as asides", () => {
    const book = epubDocument({
      identifier: "urn:uuid:1",
      title: "A book",
      lang: "en",
      dir: null,
      author: null,
      modifiedAt: 1000,
      pictures: [],
      contentsLabel: "Spis",
    });
    book.part(tree(el("div", {}, [el("h2", {}, [text("One")]), el("p", {}, [text("First"), el("a", { "data-note": "A note", href: "#x" }, [text("1")])])])));
    book.part(tree(el("div", {}, [el("h2", {}, [text("Two")]), el("p", {}, [text("Second")])])));
    const entries = book.entries();
    assert.deepEqual(
      entries.filter((entry) => entry.name.startsWith("OEBPS/text-")).map((entry) => entry.name),
      ["OEBPS/text-1.xhtml", "OEBPS/text-2.xhtml"],
    );
    const first = entryText(entries, "OEBPS/text-1.xhtml");
    assert.match(first, /<p>First<a epub:type="noteref" href="#note-1">1<\/a><\/p>\n<aside epub:type="footnote" id="note-1"><p>A note<\/p><\/aside>/);
    assert.doesNotMatch(first, /href="#x"/);
    const nav = entryText(entries, "OEBPS/nav.xhtml");
    assert.match(nav, /<li><a href="text-1\.xhtml#heading-1">One<\/a><\/li><li><a href="text-2\.xhtml#heading-1">Two<\/a><\/li>/);
    const opf = entryText(entries, "OEBPS/content.opf");
    assert.match(opf, /<itemref idref="text-1"\/>\n<itemref idref="text-2"\/>/);
  });

  it("writes the pictures the text asks for as files, and drops a picture the database lacks", () => {
    const entries = articleEntries(
      el("div", {}, [
        el("figure", {}, [
          el("img", { "data-src": "https://cdn.test/one.jpg", alt: "A \"photo\"" }),
          el("figcaption", {}, [text("Caption")]),
        ]),
        el("p", {}, [el("img", { "data-src": "https://cdn.test/missing.png", alt: "gone" })]),
        el("p", {}, [el("img", { "data-src": "https://cdn.test/one.jpg" })]),
      ]),
      {
        pictures: [
          picture(0, "https://cdn.test/one.jpg"),
          picture(1, "https://cdn.test/unused.png", "image/png"),
          picture(2, "https://cdn.test/one.jpg"),
        ],
      },
    );
    const part = entryText(entries, "OEBPS/text-1.xhtml");
    assert.match(part, /<figure><img src="images\/0\.jpg" alt="A &quot;photo&quot;"\/><figcaption>Caption<\/figcaption><\/figure><p><\/p><p><img src="images\/0\.jpg" alt=""\/><\/p>/);
    // One file for the picture shown twice, none for the one nobody asked
    // for, none for the address without a row.
    assert.deepEqual(
      entries.filter((entry) => entry.name.startsWith("OEBPS/images/")).map((entry) => [entry.name, entry.deflate]),
      [["OEBPS/images/0.jpg", false]],
    );
    const opf = entryText(entries, "OEBPS/content.opf");
    assert.match(opf, /<item id="picture-0" href="images\/0\.jpg" media-type="image\/jpeg"\/>/);
    assert.doesNotMatch(opf, /unused|picture-1|picture-2/);
    assert.deepEqual([...(entries.find((entry) => entry.name === "OEBPS/images/0.jpg")?.data ?? [])], [1, 2, 3, 0]);
  });

  it("writes the same document as the same package twice", () => {
    const root = el("div", {}, [el("h2", {}, [text("T")]), el("p", {}, [text("Same")])]);
    const one = articleEntries(root).map((entry) => [entry.name, decoder.decode(entry.data)]);
    const two = articleEntries(root).map((entry) => [entry.name, decoder.decode(entry.data)]);
    assert.deepEqual(one, two);
  });
});

describe("navItems", () => {
  it("nests a deeper row inside the one before it and closes back to a shallower one", () => {
    const items = navItems([
      { level: 1, title: "A", href: "a" },
      { level: 2, title: "B", href: "b" },
      { level: 3, title: "C", href: "c" },
      { level: 1, title: "D", href: "d" },
    ]);
    assert.equal(
      items,
      '<li><a href="a">A</a><ol><li><a href="b">B</a><ol><li><a href="c">C</a></li></ol></li></ol></li><li><a href="d">D</a></li>',
    );
  });

  it("stands a shallower row beside a deeper one under the same parent, and a jump nests one step", () => {
    const items = navItems([
      { level: 2, title: "A", href: "a" },
      { level: 1, title: "B", href: "b" },
      { level: 3, title: "C", href: "c" },
      { level: 2, title: "D", href: "d" },
    ]);
    assert.equal(
      items,
      '<li><a href="a">A</a></li><li><a href="b">B</a><ol><li><a href="c">C</a></li><li><a href="d">D</a></li></ol></li>',
    );
  });

  it("writes nothing for no rows", () => {
    assert.equal(navItems([]), "");
  });
});
