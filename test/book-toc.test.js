import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TOC_ENTRY_CAP,
  TOC_TITLE_CAP,
  cappedToc,
  headingEntries,
} from "../src/lib/book/toc.js";

describe("headingEntries", () => {
  it("reads the chapters out of a segment's blocks", () => {
    const blocks = [
      "<h1>Part One</h1>",
      "<p>Prose.</p>",
      "<h2>Chapter I</h2>",
      "<p>More prose.</p>",
      "<h3>A section</h3>",
    ];
    assert.deepEqual(headingEntries(blocks, 4), [
      { title: "Part One", level: 1, segmentIndex: 4, blockIndex: 0 },
      { title: "Chapter I", level: 2, segmentIndex: 4, blockIndex: 2 },
      { title: "A section", level: 3, segmentIndex: 4, blockIndex: 4 },
    ]);
  });

  it("ignores everything that is not an h1-h3 block", () => {
    const blocks = [
      "<p>Prose.</p>",
      "<h4>Too deep</h4>",
      "<h5>Deeper</h5>",
      "<hr>",
      "<ul><li>a list</li></ul>",
      "<blockquote><p>quoted</p></blockquote>",
    ];
    assert.deepEqual(headingEntries(blocks, 0), []);
  });

  it("does not mistake hr or a nested heading for a chapter", () => {
    const blocks = ["<hr>", "<div>own text<h2>buried</h2></div>"];
    assert.deepEqual(headingEntries(blocks, 0), []);
  });

  it("reads a heading that carries attributes", () => {
    const blocks = ['<h2 lang="en" dir="ltr">Chapter II</h2>'];
    assert.deepEqual(headingEntries(blocks, 1), [
      { title: "Chapter II", level: 2, segmentIndex: 1, blockIndex: 0 },
    ]);
  });

  it("steps over a > inside a quoted attribute value", () => {
    const blocks = ['<h2 dir="a>b">Odd but honest</h2>'];
    assert.deepEqual(headingEntries(blocks, 0), [
      { title: "Odd but honest", level: 2, segmentIndex: 0, blockIndex: 0 },
    ]);
  });

  it("strips inline markup and keeps the words", () => {
    const blocks = ["<h2>The <em>fine</em> art of <span>reading</span></h2>"];
    assert.equal(headingEntries(blocks, 0)[0]?.title, "The fine art of reading");
  });

  it("decodes exactly the serializer's entities, ampersand last", () => {
    const blocks = ["<h2>Crime &amp; Punishment: 1 &lt; 2 &gt; 0&nbsp;&amp;lt;</h2>"];
    // The author's literal "&lt;" arrives serialized as "&amp;lt;" and must
    // come back as the five characters they wrote, not as "<".
    assert.equal(headingEntries(blocks, 0)[0]?.title, "Crime & Punishment: 1 < 2 > 0 &lt;");
  });

  it("collapses the whitespace a source spreads a title over", () => {
    const blocks = ["<h2>  A\n   spaced\t title  </h2>"];
    assert.equal(headingEntries(blocks, 0)[0]?.title, "A spaced title");
  });

  it("skips a heading with nothing to show", () => {
    const blocks = ["<h2><span></span></h2>", "<h2>   </h2>", "<h2>Kept</h2>"];
    assert.deepEqual(headingEntries(blocks, 0), [
      { title: "Kept", level: 2, segmentIndex: 0, blockIndex: 2 },
    ]);
  });

  it("cuts an abused title at the cap instead of refusing it", () => {
    const long = "word ".repeat(60).trim();
    const [entry] = headingEntries([`<h2>${long}</h2>`], 0);
    assert.ok(entry);
    assert.ok(entry.title.length <= TOC_TITLE_CAP);
    assert.ok(entry.title.endsWith("…"));
    assert.ok(entry.title.startsWith("word word"));
  });

  it("keeps a title exactly at the cap whole", () => {
    const exact = "x".repeat(TOC_TITLE_CAP);
    assert.equal(headingEntries([`<h2>${exact}</h2>`], 0)[0]?.title, exact);
  });
});

describe("cappedToc", () => {
  it("lets an honest list through untouched", () => {
    const entries = headingEntries(["<h1>One</h1>", "<h2>Two</h2>"], 0);
    assert.equal(cappedToc(entries), entries);
  });

  it("keeps the first chapters of a pathological book", () => {
    const entries = Array.from({ length: TOC_ENTRY_CAP + 7 }, (_, index) => ({
      title: `Chapter ${index}`,
      level: /** @type {2} */ (2),
      segmentIndex: 0,
      blockIndex: index,
    }));
    const capped = cappedToc(entries);
    assert.equal(capped.length, TOC_ENTRY_CAP);
    assert.equal(capped[0]?.title, "Chapter 0");
    assert.equal(capped[TOC_ENTRY_CAP - 1]?.title, `Chapter ${TOC_ENTRY_CAP - 1}`);
  });
});
