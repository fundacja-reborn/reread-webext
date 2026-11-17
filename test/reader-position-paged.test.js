import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { pageAt, pageOpeningOn, pagePercent, pageTops, reopenedPage } from "../src/lib/reader/pages.js";
import { FOLD_REACH, blockAtLine } from "../src/lib/reader/position.js";

/**
 * The reading position read by pages reopens the page that was read (D302).
 *
 * The position names a block, and a page of prose mostly opens in the
 * middle of one. Until this the restore landed on the page the block's
 * first line stands on - the page before the one that was read - and the
 * save taken right after the landing named the block THAT page opens in,
 * so every reopening that turned nothing went another page back (Michał's
 * report, 2026-11-17: an article reopened a page, or a few pages, before
 * the place). The rule is pure and held here case by case; so is the one
 * promise no single case can make - that a page saved and reopened is the
 * same page, on every page of a document.
 *
 * And on the line that was read (D303). The block and the percent cannot
 * say which line of the block opened the page, so pages cut for another
 * window put the block's lines on two pages either of which may be the one
 * meant. The row now carries the first line's first character, and the
 * restore opens a page on it: the page of the table cut from the head when
 * there is one, the pages cut again from the line when there is not. The
 * rule that tells the two apart is held here; so is what the reader does
 * with it, as far as a file can say.
 */

const LINE = 30;

/**
 * Paragraphs of the given line counts, a gap between them, under a head of
 * the given height - and the pages a band cuts them into, the way the
 * reader cuts them: the text is one block of the flow, every line its own.
 *
 * @param {number[]} counts lines in each paragraph
 * @param {{ band: number, head?: number, first?: number, gap?: number, anchor?: number }} how
 *   `anchor` cuts the pages from a line instead of from the head (D238)
 */
function prose(counts, { band, head = 0, first = 60, gap = 20, anchor }) {
  /** @type {{ top: number, bottom: number }[]} */
  const blocks = [];
  /** @type {{ top: number, bottom: number }[]} */
  const lines = [];
  let top = first + head;
  for (const count of counts) {
    blocks.push({ top, bottom: top + count * LINE });
    for (let index = 0; index < count; index += 1) {
      lines.push({ top: top + index * LINE, bottom: top + (index + 1) * LINE });
    }
    top += count * LINE + gap;
  }
  const text = { top: blocks[0]?.top ?? first, bottom: top - gap };
  const flow = head > 0 ? [{ top: first, bottom: first + head }, text] : [text];
  const tops = pageTops(flow, (index) => (flow[index] === text ? lines : []), band, first, anchor);
  return { blocks, lines, tops };
}

/**
 * What the save writes on a page: the block under the page's first line.
 *
 * @param {{ blocks: { top: number, bottom: number }[], tops: number[] }} doc
 * @param {number} page
 */
function savedOn(doc, page) {
  const at = blockAtLine(doc.blocks, (doc.tops[page] ?? 0) + FOLD_REACH);
  assert.notEqual(at, null);
  return /** @type {number} */ (at);
}

/**
 * Where a saved block reopens.
 *
 * @param {{ blocks: { top: number, bottom: number }[], tops: number[] }} doc
 * @param {number} at the block's index
 * @param {number} [percent]
 */
function reopened(doc, at, percent) {
  const block = doc.blocks[at];
  assert.ok(block !== undefined);
  return reopenedPage(doc.tops, block, doc.blocks[at - 1]?.bottom ?? -Infinity, percent);
}

describe("reopenedPage", () => {
  it("reopens the page that opens in the block, not the one its first line stands on", () => {
    // Ten lines a page; the second paragraph begins at the foot of the
    // first page and runs on over the head of the second.
    const doc = prose([6, 8, 6], { band: 10 * LINE });
    const top = doc.tops[1] ?? 0;
    const second = doc.blocks[1];
    assert.ok(second !== undefined && second.top < top && top < second.bottom, "the second page opens inside the second paragraph");
    assert.equal(savedOn(doc, 1), 1);
    assert.equal(pageAt(doc.tops, second.top), 0, "its first line stands on the page before");
    assert.equal(reopened(doc, 1), 1);
  });

  it("reopens the page a block opens with its own first line", () => {
    // 9 lines and a gap fill the band: the second paragraph opens page two.
    const doc = prose([9, 5, 5], { band: 10 * LINE, gap: LINE });
    assert.equal(doc.tops[1], doc.blocks[1]?.top);
    assert.equal(savedOn(doc, 1), 1);
    assert.equal(reopened(doc, 1), 1);
  });

  it("reopens a block standing inside a page on that page", () => {
    // Named on no page of this table: a position saved by scrolling, or
    // over pages cut for another window.
    const doc = prose([3, 3, 3, 8, 8], { band: 10 * LINE });
    assert.equal(reopened(doc, 1), 0);
    assert.equal(reopened(doc, 1, 100), 0, "a percent moves nothing that has one place");
  });

  it("tells the pages of one block apart by the stored percent", () => {
    // One paragraph three pages long, between two short ones.
    const doc = prose([4, 30, 4], { band: 10 * LINE });
    const pages = doc.tops.length;
    const opened = [1, 2, 3].filter((page) => savedOn(doc, page) === 1);
    assert.deepEqual(opened, [1, 2, 3], "the long paragraph opens three pages");
    for (const page of opened) {
      assert.equal(reopened(doc, 1, pagePercent(page, pages)), page);
    }
    assert.equal(reopened(doc, 1), 1, "with no percent the earliest - text repeated, never skipped");
    assert.equal(reopened(doc, 1, Number.NaN), 1);
  });

  it("answers the earliest of the pages a percent cannot tell apart", () => {
    // Three hundred pages inside one block: three pages share each percent.
    const tops = Array.from({ length: 300 }, (_, index) => 60 + index * 300);
    const block = { top: 60, bottom: 60 + 300 * 300 };
    const shared = [150, 151, 152].map((page) => pagePercent(page, 300));
    assert.deepEqual(shared, [50, 51, 51]);
    assert.equal(reopenedPage(tops, block, -Infinity, 51), 151);
  });

  it("keeps the first page of an article whose first paragraph runs over it", () => {
    // The page opens with the head, and the save names the first block
    // under it - which is also the block the second page opens in.
    const doc = prose([8, 6, 6], { band: 10 * LINE, head: 5 * LINE });
    assert.equal(savedOn(doc, 0), 0);
    assert.equal(savedOn(doc, 1), 0);
    const pages = doc.tops.length;
    assert.equal(reopened(doc, 0, pagePercent(0, pages)), 0);
    assert.equal(reopened(doc, 0, pagePercent(1, pages)), 1);
    assert.equal(reopened(doc, 0), 0);
  });

  it("reopens every page of a document on itself, and stays there", () => {
    // Ordinary prose in several shapes: paragraphs of one to twelve lines,
    // a head or none, three bands. Short enough that every page has its
    // own percent, which is what a paragraph longer than a page needs.
    let seed = 20261117;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (const how of [
      { band: 20 * LINE + 7, head: 0 },
      { band: 14 * LINE + 11, head: 9 * LINE },
      { band: 31 * LINE + 3, head: 4 * LINE },
    ]) {
      const counts = Array.from({ length: 160 }, () => 1 + Math.floor(next() * 12));
      const doc = prose(counts, how);
      const pages = doc.tops.length;
      assert.ok(pages > 20 && pages <= 100, `${pages} pages`);
      let early = 0;
      for (let page = 0; page < pages; page += 1) {
        const at = savedOn(doc, page);
        if (pageAt(doc.tops, doc.blocks[at]?.top ?? 0) !== page) early += 1;
        const landed = reopened(doc, at, pagePercent(page, pages));
        assert.equal(landed, page, `page ${page} of ${pages} reopened on ${landed}`);
        // The save the open takes right after the landing: the same block,
        // so the next reopening is the same page - nothing walks back.
        assert.equal(savedOn(doc, landed), at);
      }
      // What this replaced: the page of the block's first line.
      assert.ok(early > pages / 3, `only ${early} of ${pages} pages open inside a paragraph`);
    }
  });
});

describe("pageOpeningOn (D303)", () => {
  const tops = [60, 360, 660, 960];

  it("names the page that opens on the line, within a pixel", () => {
    assert.equal(pageOpeningOn(tops, 660, 660), 2);
    assert.equal(pageOpeningOn(tops, 660.4, 660.4), 2);
    assert.equal(pageOpeningOn(tops, 60, 60), 0);
  });

  it("answers nothing for a line standing inside a page", () => {
    assert.equal(pageOpeningOn(tops, 690, 690), null);
    assert.equal(pageOpeningOn(tops, 950, 950), null);
  });

  it("takes a block's first line for the block's edge", () => {
    // The page opens on the block's top, its first line a leading lower.
    assert.equal(pageOpeningOn(tops, 360, 365), 1);
    // Or on the first line itself, the block's top a leading higher.
    assert.equal(pageOpeningOn(tops, 355, 360), 1);
    // But not on whatever stands above the block on the same page.
    assert.equal(pageOpeningOn(tops, 420, 425), null);
  });

  it("answers nothing for the first paragraph under an article's head", () => {
    // The first page opens with the head; the paragraph's first line is
    // not what it opens on, however near the top it stands.
    assert.equal(pageOpeningOn(tops, 200, 205), null);
  });
});

describe("a remembered line reopens as the first line of its page (D303)", () => {
  /**
   * The first line of every page of a table, as the save would name it.
   *
   * @param {ReturnType<typeof prose>} doc
   */
  function pageLines(doc) {
    return doc.tops.map((top) => {
      const line = doc.lines.find((one) => one.bottom > top + FOLD_REACH);
      assert.ok(line !== undefined);
      return line.top;
    });
  }

  let seed = 303;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const counts = Array.from({ length: 220 }, () => 1 + Math.floor(next() * 14));

  it("on the table cut from the head, while nothing has changed", () => {
    const doc = prose(counts, { band: 19 * LINE + 5, head: 6 * LINE });
    for (const [page, top] of pageLines(doc).entries()) {
      // The first page opens with the head, and has no line to be named by.
      if (page === 0) continue;
      assert.equal(pageOpeningOn(doc.tops, top, top), page, `page ${page} is not found by its own first line`);
    }
  });

  it("on a table cut from the line, when the pages are cut for another band", () => {
    const saved = prose(counts, { band: 19 * LINE + 5, head: 6 * LINE });
    // Another window: three lines shorter, the bar a little taller.
    const how = { band: 16 * LINE + 9, head: 6 * LINE, first: 72 };
    const shift = 72 - 60;
    const reopened = prose(counts, how);
    let recut = 0;
    for (const [page, savedTop] of pageLines(saved).entries()) {
      if (page === 0) continue;
      const top = savedTop + shift;
      if (pageOpeningOn(reopened.tops, top, top) !== null) continue;
      recut += 1;
      // What the reader does then: the pages cut again from the line.
      const tops = prose(counts, { ...how, anchor: top }).tops;
      const landed = pageOpeningOn(tops, top, top);
      assert.notEqual(landed, null, `no page opens on the line of page ${page}`);
      assert.equal(tops[/** @type {number} */ (landed)], top);
    }
    // Nearly every page of the old table opens somewhere else in the new
    // one - which is the case the block and the percent could not answer.
    assert.ok(recut > saved.tops.length / 2, `only ${recut} of ${saved.tops.length} pages had to be cut again`);
  });
});

describe("the reading position in the user guide (D303)", () => {
  it("is promised in the user guide: the same line, and the same page's first line", async () => {
    const guide = await readFile(new URL("../docs/GUIDE.md", import.meta.url), "utf8");
    assert.match(guide, /Every saved document reopens where you stopped, with the same line at the top of the text\./, "the guide does not say which line a document reopens on");
    assert.match(guide, /In the Pages layout the page opens with that line again, also after the window or the text size has changed\./, "the guide does not say what a changed window does to the page");
  });
});

describe("the reader's wiring of the reopened page", () => {
  /**
   * The body of one top-level function.
   *
   * @param {string} script
   * @param {string} name
   */
  function bodyOf(script, name) {
    const at = script.search(new RegExp(`\\nfunction ${name}\\(`));
    assert.notEqual(at, -1, `no function ${name}`);
    return script.slice(at, script.indexOf("\n}\n", at));
  }

  it("lands a position read by pages through the rule, and measures the save by the same reach", async () => {
    const reader = await readFile(new URL("../src/reader/reader.js", import.meta.url), "utf8");
    const restore = bodyOf(reader, "restorePosition");
    assert.match(restore, /showPageOf\(\s*pages,\s*reopenedPage\(/, "the restore does not ask the rule for its page");
    assert.match(restore, /block\.previousElementSibling\?\.getBoundingClientRect\(\)\.bottom/, "the rule is not told where the block before ends");
    assert.match(restore, /position\?\.percent/, "the rule is not given the stored percent");
    assert.doesNotMatch(restore, /landOnPageOf\(/, "the restore lands on the page of the block's first line again");
    // The rule reads the save's measurement backwards: one constant, or the
    // two part on the first edit.
    assert.match(reader, /function topBlockIndex\(line = textFold\(\) \+ FOLD_REACH\) \{/, "the save measures by a reach of its own");
    assert.match(bodyOf(reader, "placeLine"), /top === undefined \? textFold\(\) \+ FOLD_REACH : top - window\.scrollY \+ FOLD_REACH/, "the page's top is measured by another reach");
  });

  it("writes the first line with the place, measured on the page being read (D303)", async () => {
    const reader = await readFile(new URL("../src/reader/reader.js", import.meta.url), "utf8");
    const save = bodyOf(reader, "savePositionNow");
    assert.match(save, /const line = placeLine\(pages\);\n  const at = topBlockIndex\(line\);/, "the block and the line are measured at two places");
    assert.match(save, /positionRecord\(target\.url, segment, at, Date\.now\(\), percent, topLineOffset\(root, at, line\)\)/, "the row is written without its first line");
    // Off its page under a bubble, the window is not the place: the page is.
    assert.match(bodyOf(reader, "placeLine"), /pages\.tops\[pageShown\(pages\)\]/, "the line is read off the window, not off the page shown");
    const measure = bodyOf(reader, "topLineOffset");
    assert.match(measure, /block\.getBoundingClientRect\(\)\.top > line\) return null;/, "a block beginning under the line is named by its first line");
    assert.match(measure, /anchorOf\(range, root, 0\)/, "the offset is not counted in the marks' prose");
  });

  it("opens on the remembered line: the head's table if it has the page, the pages cut from the line if not (D303)", async () => {
    const reader = await readFile(new URL("../src/reader/reader.js", import.meta.url), "utf8");
    const restore = bodyOf(reader, "restorePosition");
    assert.match(restore, /const pages = pagesNow\(\);\n  const line = keptLine\(root, at, position\?\.offset\);/, "the line is measured before the first cut has laid the pictures out");
    assert.match(restore, /let page = pageOpeningOn\(table\.tops, line\.from, line\.top\);\n    if \(page === null\) \{\n      pageAnchor = line\.anchor;\n      pagesStale = true;\n      table = pagesNow\(\) \?\? pages;/, "the pages are not cut from the line when no page opens on it");
    assert.match(restore, /scrollTo\(0, Math\.max\(0, line\.from - chromeFold\(\)\)\);/, "scrolled, the line is not put under the bar");
    // A row without the line still reopens by its block (D302, D100).
    assert.match(restore, /if \(pages !== null\) \{[\s\S]*?reopenedPage\(/, "a row without a line has lost the page of its block");
    assert.match(restore, /fineScrollTop\(/, "a row without a line has lost its place inside a tall block");
    assert.match(bodyOf(reader, "keptLine"), /rangeWithin\(root, at, offset, offset \+ 1\)/, "the offset is not read back through the marks' prose");
  });
});
