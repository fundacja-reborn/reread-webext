import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { markedBlocks } from "../src/lib/book/blocks.js";
import {
  THIN_TABLE,
  importedToc,
  landedToc,
  navDocumentRows,
  ncxRows,
  preferredRows,
  rowCarrier,
  rowTargets,
  rowTracer,
} from "../src/lib/book/nav.js";
import { isHeadingTag, segmenter } from "../src/lib/book/segment.js";
import { TOC_ENTRY_CAP, TOC_TITLE_CAP } from "../src/lib/book/toc.js";
import { buildArticle } from "../src/lib/reader/article.js";

/**
 * The four properties the walk reads, hand-built - the fakes `opf.test.js`
 * walks a package with. `textContent` is put together from the children,
 * the way a DOM's is.
 *
 * @param {string} localName
 * @param {Record<string, string>} [attrs]
 * @param {Array<import("../src/lib/book/opf.js").XmlEl | string>} [children]
 * @returns {import("../src/lib/book/opf.js").XmlEl}
 */
function el(localName, attrs = {}, children = []) {
  return {
    localName,
    getAttribute: (name) => attrs[name] ?? null,
    children: children.filter((child) => typeof child !== "string"),
    textContent: children.map((child) => (typeof child === "string" ? child : child.textContent)).join(""),
  };
}

/**
 * One `li` of a navigation document: a link, and the list nested under it.
 *
 * @param {string} href
 * @param {string} words
 * @param {import("../src/lib/book/opf.js").XmlEl[]} [nested] the items under it
 */
function item(href, words, nested = []) {
  return el("li", {}, [el("a", { href }, [words]), ...(nested.length > 0 ? [el("ol", {}, nested)] : [])]);
}

/** @param {import("../src/lib/book/opf.js").XmlEl[]} navs */
function navDocument(navs) {
  return el("html", {}, [el("head", {}, [el("title", {}, ["Contents"])]), el("body", {}, navs)]);
}

describe("navDocumentRows", () => {
  it("reads the nested list of the toc nav, depth and all", () => {
    const doc = navDocument([
      el("nav", { "epub:type": "toc" }, [
        el("h2", {}, ["Contents"]),
        el("ol", {}, [
          item("Cover.xhtml", "Cover"),
          item("Chapter03.xhtml", "3. A Cold Shower a Day", [
            item("Chapter03.xhtml#lev1", "WHM Protocol"),
            item("Chapter03.xhtml#lev2", "The Wim Hof Way to Get Warm"),
          ]),
          item("Chapter04.xhtml", "4. Breathe"),
        ]),
      ]),
    ]);
    assert.deepEqual(navDocumentRows(doc), [
      { title: "Cover", level: 1, href: "Cover.xhtml" },
      { title: "3. A Cold Shower a Day", level: 1, href: "Chapter03.xhtml" },
      { title: "WHM Protocol", level: 2, href: "Chapter03.xhtml#lev1" },
      { title: "The Wim Hof Way to Get Warm", level: 2, href: "Chapter03.xhtml#lev2" },
      { title: "4. Breathe", level: 1, href: "Chapter04.xhtml" },
    ]);
  });

  it("reads the contents and neither the landmarks nor the page list", () => {
    const doc = navDocument([
      el("nav", { "epub:type": "landmarks" }, [el("ol", {}, [item("Cover.xhtml", "Cover")])]),
      el("nav", { "epub:type": "toc" }, [el("ol", {}, [item("one.xhtml", "One"), item("two.xhtml", "Two")])]),
      el("nav", { "epub:type": "page-list" }, [el("ol", {}, [item("one.xhtml#p1", "1")])]),
    ]);
    assert.deepEqual(
      navDocumentRows(doc).map((row) => row.title),
      ["One", "Two"],
    );
  });

  it("takes the first untyped nav when none says it is the contents", () => {
    const doc = navDocument([
      el("nav", {}, [el("ol", {}, [item("one.xhtml", "One")])]),
      el("nav", { "epub:type": "landmarks" }, [el("ol", {}, [item("cover.xhtml", "Cover")])]),
    ]);
    assert.deepEqual(navDocumentRows(doc), [{ title: "One", level: 1, href: "one.xhtml" }]);
  });

  it("hears the ARIA role that says table of contents", () => {
    const doc = navDocument([
      el("nav", { "epub:type": "landmarks" }, [el("ol", {}, [item("cover.xhtml", "Cover")])]),
      el("nav", { role: "doc-toc" }, [el("ol", {}, [item("one.xhtml", "One")])]),
    ]);
    assert.deepEqual(navDocumentRows(doc), [{ title: "One", level: 1, href: "one.xhtml" }]);
  });

  it("gives a row that is words alone the address of the first row under it", () => {
    // EPUB 3 lets a heading of the list be a span: "Part One" over its chapters.
    const part = el("li", {}, [
      el("span", {}, ["Part One"]),
      el("ol", {}, [item("ch1.xhtml", "Chapter 1"), item("ch2.xhtml", "Chapter 2")]),
    ]);
    const orphan = el("li", {}, [el("span", {}, ["Leads nowhere"])]);
    const doc = navDocument([el("nav", { "epub:type": "toc" }, [el("ol", {}, [part, orphan, item("end.xhtml", "End")])])]);
    assert.deepEqual(navDocumentRows(doc), [
      { title: "Part One", level: 1, href: "ch1.xhtml" },
      { title: "Chapter 1", level: 2, href: "ch1.xhtml" },
      { title: "Chapter 2", level: 2, href: "ch2.xhtml" },
      { title: "End", level: 1, href: "end.xhtml" },
    ]);
  });

  it("finds the link through packaging, and never borrows one from a nested list", () => {
    const wrapped = el("li", {}, [el("p", {}, [el("a", { href: "one.xhtml" }, ["One"])])]);
    const bare = el("li", {}, [el("ol", {}, [item("deep.xhtml", "Deep")])]);
    const doc = navDocument([el("nav", { "epub:type": "toc" }, [el("div", {}, [el("ol", {}, [wrapped, bare])])])]);
    assert.deepEqual(navDocumentRows(doc), [
      { title: "One", level: 1, href: "one.xhtml" },
      { title: "Deep", level: 2, href: "deep.xhtml" },
    ]);
  });

  it("collapses the whitespace of a title and cuts an abused one", () => {
    const doc = navDocument([
      el("nav", { "epub:type": "toc" }, [
        el("ol", {}, [item("one.xhtml", "  Chapter\n   One  "), item("two.xhtml", "x".repeat(400)), item("three.xhtml", "   ")]),
      ]),
    ]);
    const rows = navDocumentRows(doc);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.title, "Chapter One");
    assert.equal(rows[1]?.title.length, TOC_TITLE_CAP);
  });

  it("answers no rows for a document without a nav", () => {
    assert.deepEqual(navDocumentRows(navDocument([el("p", {}, ["No contents here."])])), []);
  });
});

/**
 * One `navPoint`, as an XML parser hands it over.
 *
 * @param {string} label
 * @param {string} src
 * @param {import("../src/lib/book/opf.js").XmlEl[]} [points] the points under it
 */
function point(label, src, points = []) {
  return el("navPoint", { id: label, playOrder: "1" }, [
    el("navLabel", {}, [el("text", {}, [label])]),
    el("content", { src }),
    ...points,
  ]);
}

describe("ncxRows", () => {
  it("reads a flat navMap - a Calibre conversion's", () => {
    const ncx = el("ncx", {}, [
      el("head", {}, [el("meta", { name: "dtb:depth", content: "2" })]),
      el("docTitle", {}, [el("text", {}, ["Na wschód od Edenu"])]),
      el("navMap", {}, [
        point("Dedykacja", "Text/index_split_003.html"),
        point("CZĘŚĆ PIERWSZA", "Text/index_split_004.html"),
        point("ROZDZIAŁ 1", "Text/index_split_005.html"),
      ]),
    ]);
    assert.deepEqual(ncxRows(ncx), [
      { title: "Dedykacja", level: 1, href: "Text/index_split_003.html" },
      { title: "CZĘŚĆ PIERWSZA", level: 1, href: "Text/index_split_004.html" },
      { title: "ROZDZIAŁ 1", level: 1, href: "Text/index_split_005.html" },
    ]);
  });

  it("reads nested points with their depth, and a label never from a point inside", () => {
    const ncx = el("ncx", {}, [
      el("navMap", {}, [
        point("Part One", "part1.xhtml", [point("Chapter 1", "ch1.xhtml#start"), point("Chapter 2", "ch2.xhtml")]),
        point("Part Two", "part2.xhtml"),
      ]),
    ]);
    assert.deepEqual(ncxRows(ncx), [
      { title: "Part One", level: 1, href: "part1.xhtml" },
      { title: "Chapter 1", level: 2, href: "ch1.xhtml#start" },
      { title: "Chapter 2", level: 2, href: "ch2.xhtml" },
      { title: "Part Two", level: 1, href: "part2.xhtml" },
    ]);
  });

  it("does not read the page list", () => {
    const ncx = el("ncx", {}, [
      el("navMap", {}, [point("One", "one.xhtml")]),
      el("pageList", {}, [el("pageTarget", {}, [el("navLabel", {}, [el("text", {}, ["1"])]), el("content", { src: "one.xhtml#p1" })])]),
    ]);
    assert.deepEqual(ncxRows(ncx), [{ title: "One", level: 1, href: "one.xhtml" }]);
  });

  it("reads the shape an HTML parser makes of the file", () => {
    // The second try at a file the XML parser refused: names in lower case,
    // and - `content` being no void element to that parser - the points
    // under a point nested inside its `content`.
    const inner = el("navpoint", {}, [
      el("navlabel", {}, [el("text", {}, ["Chapter 1"])]),
      el("content", { src: "ch1.xhtml" }),
    ]);
    const outer = el("navpoint", {}, [
      el("navlabel", {}, [el("text", {}, ["Part One"])]),
      el("content", { src: "part1.xhtml" }, [inner]),
    ]);
    const doc = el("html", {}, [el("head"), el("body", {}, [el("ncx", {}, [el("navmap", {}, [outer])])])]);
    assert.deepEqual(ncxRows(doc), [
      { title: "Part One", level: 1, href: "part1.xhtml" },
      { title: "Chapter 1", level: 2, href: "ch1.xhtml" },
    ]);
  });

  it("gives a point without an address the address of the first point under it", () => {
    const part = el("navPoint", {}, [el("navLabel", {}, [el("text", {}, ["Part One"])]), point("Chapter 1", "ch1.xhtml")]);
    assert.deepEqual(ncxRows(el("ncx", {}, [el("navMap", {}, [part])])), [
      { title: "Part One", level: 1, href: "ch1.xhtml" },
      { title: "Chapter 1", level: 2, href: "ch1.xhtml" },
    ]);
  });

  it("survives a file nested deeper than any table of contents", () => {
    let deepest = point("bottom", "bottom.xhtml");
    for (let depth = 0; depth < 200; depth += 1) deepest = point(`level ${depth}`, "x.xhtml", [deepest]);
    const rows = ncxRows(el("ncx", {}, [el("navMap", {}, [deepest])]));
    assert.ok(rows.length > 0 && rows.length < 200);
  });
});

describe("preferredRows", () => {
  const row = (/** @type {string} */ title) => ({ title, level: 1, href: `${title}.xhtml` });

  it("reads the navigation document where it names a table", () => {
    const nav = [row("a"), row("b")];
    assert.equal(preferredRows(nav, [row("a"), row("b"), row("c")]), nav);
  });

  it("falls back on the NCX when the navigation document names fewer than two rows and the NCX more", () => {
    const ncx = [row("a"), row("b")];
    assert.equal(preferredRows([row("a")], ncx), ncx);
    assert.equal(preferredRows([], ncx), ncx);
  });

  it("stays with the navigation document when the NCX has no more to say", () => {
    const nav = [row("a")];
    assert.equal(preferredRows(nav, [row("a")]), nav);
    assert.equal(preferredRows(nav, []), nav);
  });
});

describe("rowTargets", () => {
  it("resolves addresses against the file that holds the list, not the package", () => {
    const rows = [
      { title: "One", level: 1, href: "Chapter01.xhtml" },
      { title: "Two", level: 1, href: "../text/Chapter02.xhtml#start" },
    ];
    assert.deepEqual(
      [...rowTargets(rows, "OEBPS/xhtml/nav.xhtml")],
      [
        ["OEBPS/xhtml/Chapter01.xhtml", [{ row: 0, fragment: null }]],
        ["OEBPS/text/Chapter02.xhtml", [{ row: 1, fragment: "start" }]],
      ],
    );
  });

  it("gathers the rows that point into one file, in the rows' order", () => {
    const rows = [
      { title: "Three", level: 1, href: "ch3.xhtml" },
      { title: "Protocol", level: 2, href: "ch3.xhtml#lev1" },
      { title: "Four", level: 1, href: "ch4.xhtml" },
      { title: "Warm", level: 2, href: "ch3.xhtml#lev2" },
    ];
    assert.deepEqual(rowTargets(rows, "toc.ncx").get("ch3.xhtml"), [
      { row: 0, fragment: null },
      { row: 1, fragment: "lev1" },
      { row: 3, fragment: "lev2" },
    ]);
  });

  it("decodes the escapes of a path and of a fragment", () => {
    const rows = [{ title: "One", level: 1, href: "My%20Book.xhtml#rozdzia%C5%82" }];
    assert.deepEqual(
      [...rowTargets(rows, "OEBPS/toc.ncx")],
      [["OEBPS/My Book.xhtml", [{ row: 0, fragment: "rozdział" }]]],
    );
  });

  it("keeps a fragment whose percent sign is no escape, and reads an empty one as none", () => {
    const rows = [
      { title: "One", level: 1, href: "one.xhtml#100%" },
      { title: "Two", level: 1, href: "two.xhtml#" },
    ];
    const targets = rowTargets(rows, "toc.ncx");
    assert.deepEqual(targets.get("one.xhtml"), [{ row: 0, fragment: "100%" }]);
    assert.deepEqual(targets.get("two.xhtml"), [{ row: 1, fragment: null }]);
  });

  it("reads a bare fragment as a place in the list's own file", () => {
    const rows = [{ title: "Here", level: 1, href: "#toc" }];
    assert.deepEqual([...rowTargets(rows, "OEBPS/nav.xhtml")], [["OEBPS/nav.xhtml", [{ row: 0, fragment: "toc" }]]]);
  });

  it("leaves out a row that points out of the archive", () => {
    const rows = [
      { title: "Web", level: 1, href: "https://example.test/chapter" },
      { title: "Script", level: 1, href: "javascript:alert(1)" },
      { title: "Climber", level: 1, href: "../../etc/passwd" },
      { title: "Stays", level: 1, href: "one.xhtml" },
    ];
    assert.deepEqual([...rowTargets(rows, "OEBPS/toc.ncx").keys()], ["OEBPS/one.xhtml"]);
  });
});

describe("rowTracer", () => {
  it("marks a row on the element built for its target", () => {
    const tracer = rowTracer(new Map([["source-p", [4]]]));
    tracer.trace("source-h", "built-h");
    tracer.trace("source-p", "built-p");
    assert.deepEqual([...tracer.marks], [["built-p", [4]]]);
    assert.deepEqual(tracer.trailing(), []);
    assert.deepEqual(tracer.unmet(), []);
  });

  it("marks a row whose target was not kept on the next element built", () => {
    // An unwrapped `section id`, a dropped `svg id`: the text that follows
    // is where the reader would be sent.
    const tracer = rowTracer(new Map([["section", [1]], ["svg", [2]]]));
    tracer.trace("section", null);
    tracer.trace("svg", null);
    tracer.trace("paragraph", "built-paragraph");
    tracer.trace("later", "built-later");
    assert.deepEqual([...tracer.marks], [["built-paragraph", [1, 2]]]);
  });

  it("hands over the rows met after the last element built", () => {
    const tracer = rowTracer(new Map([["end-anchor", [7]]]));
    tracer.trace("paragraph", "built-paragraph");
    tracer.trace("end-anchor", null);
    assert.deepEqual([...tracer.marks], []);
    assert.deepEqual(tracer.trailing(), [7]);
  });

  it("names the rows whose target the walk never reached", () => {
    const tracer = rowTracer(new Map([["inside-dropped", [3, 5]], ["met", [4]]]));
    tracer.trace("met", "built");
    assert.deepEqual(tracer.unmet(), [3, 5]);
  });

  it("counts a target once, however often the walk says its name", () => {
    const tracer = rowTracer(new Map([["target", [1]]]));
    tracer.trace("target", "built-a");
    tracer.trace("target", "built-b");
    assert.deepEqual([...tracer.marks], [["built-a", [1]]]);
  });
});

describe("rowCarrier", () => {
  it("lands what has arrived, once", () => {
    const carrier = rowCarrier();
    carrier.arrive([1, 2]);
    assert.deepEqual(carrier.land(), [1, 2]);
    assert.deepEqual(carrier.land(), []);
  });

  it("keeps the rows of a block that was dropped for the next one kept", () => {
    const carrier = rowCarrier();
    carrier.arrive([1]);
    // The block was empty and nothing landed; the next block's own rows join.
    carrier.arrive([2]);
    assert.deepEqual(carrier.land(), [1, 2]);
  });
});

describe("landedToc", () => {
  const rows = [
    { title: "Part One", level: 1, href: "p1.xhtml" },
    { title: "Chapter 1", level: 2, href: "c1.xhtml" },
    { title: "Chapter 2", level: 2, href: "c2.xhtml" },
  ];

  it("makes rows and places into the entries a book's row carries", () => {
    const places = new Map([
      [0, { segmentIndex: 0, blockIndex: 3 }],
      [1, { segmentIndex: 0, blockIndex: 4 }],
      [2, { segmentIndex: 2, blockIndex: 0 }],
    ]);
    assert.deepEqual(landedToc(rows, places), [
      { title: "Part One", level: 1, segmentIndex: 0, blockIndex: 3 },
      { title: "Chapter 1", level: 2, segmentIndex: 0, blockIndex: 4 },
      { title: "Chapter 2", level: 2, segmentIndex: 2, blockIndex: 0 },
    ]);
  });

  it("leaves out a row that landed nowhere", () => {
    const places = new Map([[1, { segmentIndex: 0, blockIndex: 4 }]]);
    assert.deepEqual(landedToc(rows, places), [{ title: "Chapter 1", level: 1, segmentIndex: 0, blockIndex: 4 }]);
  });

  it("counts depth from the shallowest row that landed, and holds it to three levels", () => {
    const deep = [2, 3, 4, 5, 9].map((level) => ({ title: `Level ${level}`, level, href: "x.xhtml" }));
    const places = new Map(deep.map((_, index) => [index, { segmentIndex: 0, blockIndex: index }]));
    assert.deepEqual(
      landedToc(deep, places).map((entry) => entry.level),
      [1, 2, 3, 3, 3],
    );
  });

  it("puts the rows in reading order, and keeps the file's order on one block", () => {
    const listed = [
      { title: "Notes", level: 1, href: "notes.xhtml" },
      { title: "Part One", level: 1, href: "c1.xhtml" },
      { title: "Chapter 1", level: 2, href: "c1.xhtml" },
    ];
    const places = new Map([
      [0, { segmentIndex: 9, blockIndex: 2 }],
      [1, { segmentIndex: 0, blockIndex: 1 }],
      [2, { segmentIndex: 0, blockIndex: 1 }],
    ]);
    assert.deepEqual(
      landedToc(listed, places).map((entry) => entry.title),
      ["Part One", "Chapter 1", "Notes"],
    );
  });

  it("says a row repeated on the spot once", () => {
    const twice = [
      { title: "Chapter 1", level: 1, href: "c1.xhtml" },
      { title: "Chapter 1", level: 1, href: "c1.xhtml#top" },
      { title: "Chapter 1", level: 1, href: "c1-again.xhtml" },
    ];
    const places = new Map([
      [0, { segmentIndex: 0, blockIndex: 1 }],
      [1, { segmentIndex: 0, blockIndex: 1 }],
      [2, { segmentIndex: 4, blockIndex: 0 }],
    ]);
    assert.equal(landedToc(twice, places).length, 2);
  });

  it("holds the list to the cap", () => {
    const many = Array.from({ length: TOC_ENTRY_CAP + 40 }, (_, index) => ({
      title: `Chapter ${index}`,
      level: 1,
      href: `c${index}.xhtml`,
    }));
    const places = new Map(many.map((_, index) => [index, { segmentIndex: index, blockIndex: 0 }]));
    assert.equal(landedToc(many, places).length, TOC_ENTRY_CAP);
  });
});

describe("importedToc", () => {
  /** @type {import("../src/lib/book/toc.js").TocEntry} */
  const entry = { title: "A", level: 1, segmentIndex: 0, blockIndex: 0 };
  /** @param {number} count rows, each on a block of its own */
  const table = (count) => Array.from({ length: count }, (_, blockIndex) => ({ ...entry, blockIndex }));

  it("takes the file's table - the chapters of a book whose text has no heading", () => {
    const fromFile = table(62);
    assert.equal(importedToc(fromFile, []), fromFile);
  });

  it("takes the file's table over headings that list about as much, or more", () => {
    const fromFile = table(20);
    assert.equal(importedToc(fromFile, table(18)), fromFile);
    assert.equal(importedToc(fromFile, table(45)), fromFile);
  });

  it("takes the headings when the file's table is a single row, or none", () => {
    const fromHeadings = table(2);
    assert.equal(importedToc([entry], fromHeadings), fromHeadings);
    assert.equal(importedToc([], fromHeadings), fromHeadings);
  });

  it("takes the headings when every row of the file's table landed on one block", () => {
    // A list whose fragments the text does not hold: all at the file's start.
    const fromHeadings = table(3);
    assert.equal(importedToc([entry, { ...entry, title: "B" }, { ...entry, title: "C" }], fromHeadings), fromHeadings);
  });

  it("takes the headings over a thin table that lists less than they do", () => {
    // "Cover, Title, Start" over a text of thirty chapters.
    const fromHeadings = table(30);
    assert.equal(importedToc(table(3), fromHeadings), fromHeadings);
    assert.equal(importedToc(table(THIN_TABLE), fromHeadings), fromHeadings);
  });

  it("keeps a thin table the headings do not out-list, and any table past thin", () => {
    const thin = table(3);
    assert.equal(importedToc(thin, table(3)), thin);
    assert.equal(importedToc(thin, []), thin);
    const past = table(THIN_TABLE + 1);
    assert.equal(importedToc(past, table(30)), past);
  });

  it("answers the empty list the places are shown for when the book has neither", () => {
    assert.deepEqual(importedToc([entry], []), []);
  });
});

/**
 * A source chapter and the document it is rebuilt into, in as much of a DOM
 * as the rebuild and the dissolving walk read between them: node type, tag
 * and local name, children, one attribute at a time.
 *
 * @param {string} name
 * @param {object[]} [children]
 */
function source(name, children = []) {
  return {
    nodeType: 1,
    tagName: name.toUpperCase(),
    localName: name,
    childNodes: children,
    /** @returns {string | null} */
    getAttribute: () => null,
  };
}

/** @param {string} data */
function words(data) {
  return { nodeType: 3, nodeValue: data, childNodes: [] };
}

function fakeDocument() {
  return {
    /** @param {string} name */
    createElement(name) {
      return {
        nodeType: 1,
        tagName: name.toUpperCase(),
        localName: name,
        /** @type {any[]} */
        childNodes: [],
        /** @param {any} child */
        appendChild(child) {
          this.childNodes.push(child);
          return child;
        },
        setAttribute() {},
      };
    },
    /** @param {string} data */
    createTextNode(data) {
      return { nodeType: 3, nodeValue: data, childNodes: [] };
    },
  };
}

/** @param {any} node @returns {string} */
function textOf(node) {
  return node.nodeType === 3 ? node.nodeValue : node.childNodes.map(textOf).join("");
}

/**
 * The import's own loop over chapters (`import-book.js`), with everything
 * that needs a browser taken out: the rebuild traced, the marks read off
 * the blocks, empty blocks dropped, rows carried, the packer fed, the places
 * noted as the part writer notes them.
 *
 * @param {Array<{ body: object, targets: Array<[object | null, number]> }>} chapters each
 *   with the rows that point into it - at an element, or (null) at the file
 * @param {number} [budget]
 * @returns {Map<number, string>} each landed row, and the text of its block
 */
function landings(chapters, budget) {
  const packer = /** @type {ReturnType<typeof segmenter<{ text: string, rows: number[] }>>} */ (segmenter(budget));
  const carrier = rowCarrier();
  /** @type {Map<number, string>} */
  const landed = new Map();
  /** @param {Array<{ blocks: Array<{ text: string, rows: number[] }> }>} segments */
  const write = (segments) => {
    for (const segment of segments) {
      for (const block of segment.blocks) for (const row of block.rows) landed.set(row, block.text);
    }
  };
  for (const { body, targets } of chapters) {
    /** @type {Map<object, number[]>} */
    const wanted = new Map();
    /** @type {number[]} */
    const atStart = [];
    for (const [element, row] of targets) {
      if (element === null) atStart.push(row);
      else wanted.set(element, [...(wanted.get(element) ?? []), row]);
    }
    const tracer = rowTracer(wanted);
    const rebuilt = buildArticle(
      /** @type {Element} */ (/** @type {unknown} */ (body)),
      /** @type {Document} */ (/** @type {unknown} */ (fakeDocument())),
      { baseUrl: "", trace: /** @type {any} */ (tracer.trace) },
    );
    carrier.arrive([...atStart, ...tracer.unmet()]);
    for (const { block, rows } of markedBlocks(rebuilt, /** @type {any} */ (tracer.marks))) {
      carrier.arrive(rows);
      const text = textOf(block);
      if (text.trim().length === 0 && block.localName !== "hr") continue;
      write(
        packer.push({
          chars: text.length,
          heading: isHeadingTag(block.localName),
          payload: { text, rows: carrier.land() },
        }),
      );
    }
    carrier.arrive(tracer.trailing());
  }
  write(packer.finish());
  return landed;
}

describe("a row's road through the import", () => {
  it("lands a row that names a file on the file's first block", () => {
    const body = source("body", [source("p", [words("ROZDZIAŁ 1")]), source("p", [words("Dolina rzeki Salinas.")])]);
    assert.deepEqual([...landings([{ body, targets: [[null, 0]] }])], [[0, "ROZDZIAŁ 1"]]);
  });

  it("lands a row on the paragraph its fragment names, inside the wrapper the chapter came in", () => {
    const title = source("p", [words("WHM Protocol")]);
    const body = source("body", [
      source("div", [source("h1", [words("3 A Cold Shower")]), source("p", [words("Prose.")]), title, source("p", [words("More.")])]),
    ]);
    assert.deepEqual(
      [...landings([{ body, targets: [[null, 0], [title, 1]] }])],
      [[0, "3 A Cold Shower"], [1, "WHM Protocol"]],
    );
  });

  it("lands a row named on an inline anchor on the block around it", () => {
    const anchor = source("a");
    const body = source("body", [source("p", [words("Before.")]), source("h2", [anchor, words("Chapter 2")])]);
    assert.deepEqual([...landings([{ body, targets: [[anchor, 5]] }])], [[5, "Chapter 2"]]);
  });

  it("lands a row named on a wrapper on the first block the wrapper holds", () => {
    const wrapper = source("div", [source("p", [words("First of the chapter.")]), source("p", [words("Second.")])]);
    const body = source("body", [source("p", [words("Epigraph.")]), wrapper]);
    assert.deepEqual([...landings([{ body, targets: [[wrapper, 2]] }])], [[2, "First of the chapter."]]);
  });

  it("lands a row named on something the sanitizer unwraps or drops on the text that follows", () => {
    const section = source("section", [source("p", [words("Inside the section.")])]);
    const frame = source("svg", [source("title", [words("Cover")])]);
    const body = source("body", [source("p", [words("Before.")]), section, frame, source("p", [words("After the frame.")])]);
    assert.deepEqual(
      [...landings([{ body, targets: [[section, 1], [frame, 2]] }])],
      [[1, "Inside the section."], [2, "After the frame."]],
    );
  });

  it("carries a row past the empty block its target was - the anchor a converter plants", () => {
    const anchor = source("p");
    const body = source("body", [source("p", [words("End of chapter 1.")]), anchor, source("p", [words("CHAPTER 2")])]);
    assert.deepEqual([...landings([{ body, targets: [[anchor, 8]] }])], [[8, "CHAPTER 2"]]);
  });

  it("carries a row past a file with nothing to read, to the next file's first block", () => {
    const cover = source("body", [source("div", [source("p")])]);
    const first = source("body", [source("p", [words("Chapter the first.")])]);
    assert.deepEqual(
      [...landings([{ body: cover, targets: [[null, 0]] }, { body: first, targets: [[null, 1]] }])],
      [[0, "Chapter the first."], [1, "Chapter the first."]],
    );
  });

  it("carries a row met after a chapter's last element to the next chapter", () => {
    const tail = source("section");
    const one = source("body", [source("p", [words("Last words of one.")]), tail]);
    const two = source("body", [source("p", [words("First words of two.")])]);
    assert.deepEqual([...landings([{ body: one, targets: [[tail, 3]] }, { body: two, targets: [] }])], [[3, "First words of two."]]);
  });

  it("lands a row whose target sits inside something dropped whole on the chapter's start", () => {
    const hidden = source("title", [words("Cover")]);
    const body = source("body", [source("p", [words("Opening.")]), source("svg", [hidden]), source("p", [words("Later.")])]);
    assert.deepEqual([...landings([{ body, targets: [[hidden, 6]] }])], [[6, "Opening."]]);
  });

  it("leaves a row nowhere when the book ends before any block takes it", () => {
    const tail = source("section");
    const body = source("body", [source("p", [words("The end.")]), tail]);
    assert.deepEqual([...landings([{ body, targets: [[tail, 9]] }])], []);
  });

  it("keeps a row on its block through the packer's cuts and the merge of a short tail", () => {
    const long = "x".repeat(60);
    const title = source("p", [words("LAST CHAPTER")]);
    const body = source("body", [
      source("p", [words(long)]),
      source("p", [words(long)]),
      title,
      source("p", [words("short")]),
    ]);
    // A budget of 100 closes a part after the second paragraph and folds the
    // short tail back into it; the row still names its own block.
    assert.deepEqual([...landings([{ body, targets: [[title, 1]] }], 100)], [[1, "LAST CHAPTER"]]);
  });
});
