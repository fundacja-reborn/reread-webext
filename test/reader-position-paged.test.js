import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { pageAt, pagePercent, pageTops, reopenedPage } from "../src/lib/reader/pages.js";
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
 */

const LINE = 30;

/**
 * Paragraphs of the given line counts, a gap between them, under a head of
 * the given height - and the pages a band cuts them into, the way the
 * reader cuts them: the text is one block of the flow, every line its own.
 *
 * @param {number[]} counts lines in each paragraph
 * @param {{ band: number, head?: number, first?: number, gap?: number }} how
 */
function prose(counts, { band, head = 0, first = 60, gap = 20 }) {
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
  const tops = pageTops(flow, (index) => (flow[index] === text ? lines : []), band, first);
  return { blocks, tops };
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
    assert.match(bodyOf(reader, "topBlockIndex"), /const line = textFold\(\) \+ FOLD_REACH;/, "the save measures by a reach of its own");
  });
});
