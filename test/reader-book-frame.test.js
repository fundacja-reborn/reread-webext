import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { bookFrame } from "../src/lib/reader/book-frame.js";

// A book as one text (D270). A long book is kept and rendered one stretch at
// a time, and the page says so nowhere: no "Part 2 of 63", no pager whose
// framed chevrons looked like the previous and the next page over a book read
// by pages, no title block over every stretch. What the rule is lives in
// `bookFrame`; that the page follows it - and that the division is not said
// anywhere a reader looks - is read from the sources, since the page only
// exists in a browser.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (/** @type {string} */ path) => readFileSync(join(ROOT, path), "utf8");
const page = read("src/reader/reader.html");
const css = read("src/reader/reader.css");
const script = read("src/reader/reader.js");

/**
 * One function of the reader's script, from its name to the next one's.
 *
 * @param {string} name
 * @param {string} next
 */
function fn(name, next) {
  const from = script.indexOf(`function ${name}(`);
  const to = script.indexOf(`function ${next}(`, from);
  assert.ok(from >= 0 && to > from, `${name} before ${next}`);
  return script.slice(from, to);
}

describe("what stands around a book's text", () => {
  it("is the head at the book's beginning alone, and the ending under its last line alone", () => {
    assert.deepEqual(bookFrame({ index: 0, count: 63 }), { head: true, earlier: false, onward: true, ending: false });
    assert.deepEqual(bookFrame({ index: 30, count: 63 }), { head: false, earlier: true, onward: true, ending: false });
    assert.deepEqual(bookFrame({ index: 62, count: 63 }), { head: false, earlier: true, onward: false, ending: true });
  });

  it("is both and neither step for a book kept in one stretch", () => {
    assert.deepEqual(bookFrame({ index: 0, count: 1 }), { head: true, earlier: false, onward: false, ending: true });
  });

  it("reads a place past either end as that end", () => {
    // A position row that outlived a re-import names a stretch the book no
    // longer has; the opener clamps it, and the rule must not disagree.
    assert.equal(bookFrame({ index: -1, count: 5 }).head, true);
    assert.equal(bookFrame({ index: 9, count: 5 }).ending, true);
    assert.equal(bookFrame({ index: 9, count: 5 }).onward, false);
  });
});

describe("the reader's page over a book", () => {
  it("has one quiet step at each end of the text, named for the reading and never for the part", () => {
    const top = page.slice(page.indexOf('<div id="segment-nav"'), page.indexOf("</div>", page.indexOf('<div id="segment-nav"')));
    const end = page.slice(page.indexOf('<div id="segment-nav-end"'), page.indexOf("</div>", page.indexOf('<div id="segment-nav-end"')));
    assert.match(top, /id="segment-prev"/);
    assert.match(top, /data-i18n="reader_book_earlier"/);
    assert.match(end, /id="segment-next-end"/);
    assert.match(end, /data-i18n="reader_book_onward"/);
    // One button each: no way on over the text, no way back under it, no
    // count between them, no door to the contents (the menu has it).
    for (const row of [top, end]) assert.equal((row.match(/<button/g) ?? []).length, 1);
    for (const gone of ['id="segment-next"', 'id="segment-prev-end"', "segment-label", 'id="toc"', 'id="toc-end"']) {
      assert.ok(!page.includes(gone), `${gone} is still in the markup`);
    }
    // The lists keep their pager and its words; these two rows wear neither.
    for (const row of [top, end]) assert.doesNotMatch(row, /pager/);
    // Chevrons on the scroll's own axis: up over the text, down under it. A
    // chevron pointing sideways is a page's.
    assert.match(top, /d="M3\.8 10\.1 8 5\.9l4\.2 4\.2"/);
    assert.match(end, /d="M3\.8 5\.9 8 10\.1l4\.2-4\.2"/);
  });

  it("never says that a book is kept in parts", () => {
    assert.ok(!page.includes("reader_book_part_of"), "the markup names a part");
    assert.ok(!page.includes("reader_book_nav"), "the markup names the parts' pager");
    // The reading list's row says how far the reading is in percent of the
    // whole book, and no longer "Part 5 of 63" beside it.
    const row = fn("detailLine", "refreshMarks");
    assert.doesNotMatch(row, /reader_book_part_of/);
    assert.match(row, /\[entry\.hostname, t\("reader_book_label"\), length, pictures, percent\]/);
    // And the steps are not the lists' pager in another dress.
    assert.doesNotMatch(page, /class="pager segment-nav"/);
  });

  it("has no words left to name a part with, anywhere in the package", () => {
    // Stage 2 took the label from its last two homes - the search dialog's
    // headings and scan line, and the highlights page's rows - and then from
    // the catalogs, so a part cannot be named by accident either.
    /** @type {string[]} */
    const naming = [];
    /** @param {string} dir */
    const walk = (dir) => {
      for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(path);
        else if (/\.(js|json|html|css)$/.test(entry.name) && read(path).includes("reader_book_part_of")) naming.push(path);
      }
    };
    walk("src");
    assert.deepEqual(naming, []);

    // The search says chapters, and how much of the book its scan has read.
    const search = read("src/reader/doc-search.js");
    assert.match(search, /chapterHeadings\(toc, held\.hits\)/);
    assert.match(search, /t\("reader_search_scanned", \[scanPercent\(index, doc\.segmentCount\)\.toLocaleString\(\)\]\)/);
    // A quote's row says its chapter, or less.
    assert.match(fn("markRowElement", "markOriginalLink"), /\[withTitle \? row\.title : "", row\.chapter \?\? "", when\]/);
  });

  it("hides both steps when the book is read by pages, by the stylesheet alone", () => {
    assert.match(css, /:root\[data-reader-layout="paged"\] \.segment-nav \{\n  display: none;\n\}/);
    // The script decides by the place in the book and never asks the layout,
    // so the layout can change under a book on screen with nothing to redo.
    const nav = fn("showSegmentNav", "showBookNote");
    assert.match(nav, /bookFrame\(segment\)/);
    assert.match(nav, /segmentNavTop\.hidden = frame === null \|\| !frame\.earlier/);
    assert.match(nav, /segmentNavEnd\.hidden = frame === null \|\| !frame\.onward/);
    assert.doesNotMatch(nav, /layout|paged/);
  });

  it("opens the earlier text at its end, scrolled as well as paged", () => {
    const turn = fn("turnSegment", "enterView");
    assert.match(turn, /if \(step < 0\) void openBook\(target\.url, next, \{ end: true \}\)/);
    assert.match(fn("openBook", "washSearchHit"), /landOnLastPage\(\) \|\| landAtEnd\(\)/);
    assert.match(fn("landAtEnd", "revealOnPage"), /scrollTo\(0, document\.documentElement\.scrollHeight\)/);
  });

  it("counts the text as finished when the reading goes on past it", () => {
    // The step under the text is the Next it replaced (D209): the count
    // first, while the stretch being left is still the one on screen.
    assert.match(
      script,
      /segmentOnwardButton\?\.addEventListener\("click", \(\) => \{\n  countFinished\(\);\n  turnSegment\(1\);\n\}\);/,
    );
    assert.match(script, /segmentEarlierButton\?\.addEventListener\("click", \(\) => turnSegment\(-1\)\)/);
  });

  it("wears the book's head once: the title block, the acts and the language note", () => {
    const render = fn("renderArticle", "renderFacts");
    assert.match(render, /article\.setAttribute\("data-book-place", place\.head \? "start" : "within"\)/);
    assert.match(render, /article\.removeAttribute\("data-book-place"\)/);
    // Where the title is not shown, the article is named by it.
    assert.match(render, /if \(place !== null && !place\.head\) article\.setAttribute\("aria-label", piece\.title\)/);
    // Taken away whole, by name and by `>`: a clipped box would still be a
    // block of the page table, and a book's own chapter headings are h1 too.
    assert.match(
      css,
      /#article\[data-book-place="within"\] > :is\(#title, \.reader-byline, \.reader-source, \.reader-facts\) \{\n  display: none;\n\}/,
    );
    const open = fn("openBook", "washSearchHit");
    assert.match(open, /showBookNote\(frame\.head \? book : null\)/);
    const acts = fn("refreshActions", "refreshPicturesRow");
    assert.match(acts, /actions\.hidden = !frame\.head/);
    assert.match(acts, /actionsEnd\.hidden = !frame\.ending/);
    // An article is its own beginning and its own end.
    assert.match(acts, /: \{ head: true, ending: true \}/);
  });

  it("states the whole book's length under its title, and no count of phrases for a stretch", () => {
    assert.match(fn("openBook", "washSearchHit"), /words: book\.words \?\? null/);
    const facts = fn("renderFacts", "timeLabel");
    const book = facts.slice(facts.indexOf("if (wholeBookWords !== undefined)"), facts.indexOf("if (shownWords > 0)"));
    assert.match(book, /plural\(wholeBookWords, "reader_words"\), timeLabel\(wholeBookWords\)/);
    assert.doesNotMatch(book, /foundPhrases/);
    assert.match(book, /return;/);
  });

  it("says the language note as one quiet line with a link in it, not a framed button", () => {
    const note = css.slice(css.indexOf("\n.book-note button {"), css.indexOf("\n}\n", css.indexOf("\n.book-note button {")));
    assert.match(note, /display: inline;/);
    assert.match(note, /border: none;/);
    assert.match(note, /text-decoration: underline;/);
    assert.doesNotMatch(note, /min-height: 44px/);
  });
});
