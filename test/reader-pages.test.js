import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CURTAIN_OVERLAP,
  WHEEL_COOLDOWN_MS,
  curtainTop,
  onPage,
  pageAt,
  pagePercent,
  pageTops,
  revealTarget,
  tapZone,
  turnTarget,
  wheelTurn,
} from "../src/lib/reader/pages.js";

/**
 * A block of `count` lines, each `line` tall, standing at `top`.
 *
 * @param {number} top
 * @param {number} count
 * @param {number} line
 */
function paragraph(top, count, line = 30) {
  const lines = Array.from({ length: count }, (_, index) => ({
    top: top + index * line,
    bottom: top + (index + 1) * line,
  }));
  return { box: { top, bottom: top + count * line }, lines };
}

/**
 * A flow of paragraphs with a gap between them, and the line function the
 * cutter asks for.
 *
 * @param {Array<{ lines: number, gap?: number, plain?: boolean }>} shape
 * @param {number} [line]
 */
function flow(shape, line = 30) {
  /** @type {{ top: number, bottom: number }[]} */
  const blocks = [];
  /** @type {{ top: number, bottom: number }[][]} */
  const lines = [];
  let top = 100;
  for (const part of shape) {
    if (part.plain === true) {
      // A picture: a box with no lines to cut between.
      blocks.push({ top, bottom: top + part.lines * line });
      lines.push([]);
    } else {
      const made = paragraph(top, part.lines, line);
      blocks.push(made.box);
      lines.push(made.lines);
    }
    top += part.lines * line + (part.gap ?? 20);
  }
  return { blocks, linesOf: (/** @type {number} */ index) => lines[index] ?? [] };
}

describe("pageTops", () => {
  it("opens every page on a whole line and closes it on one", () => {
    // Three paragraphs of ten lines at 30px, 20px apart, in a band of 200px
    // (six lines and two thirds): the first page ends after six lines, the
    // seventh line opens the second page.
    const { blocks, linesOf } = flow([{ lines: 10 }, { lines: 10 }, { lines: 10 }]);
    const tops = pageTops(blocks, linesOf, 200);
    assert.equal(tops[0], 100);
    assert.equal(tops[1], 100 + 6 * 30);
    // Every top but the first is a line's own top.
    const all = [0, 1, 2].flatMap((index) => linesOf(index).map((line) => line.top));
    for (const top of tops.slice(1)) assert.ok(all.includes(top), `${top} is no line's top`);
  });

  it("moves a block that begins past the edge whole to the next page", () => {
    // Five lines (150px) then a gap: the second paragraph begins at 270,
    // past a 160px page, and opens the second page at its own top.
    const { blocks, linesOf } = flow([{ lines: 5 }, { lines: 5 }]);
    assert.deepEqual(pageTops(blocks, linesOf, 160), [100, 270]);
  });

  it("puts a block that fits exactly on the page and opens the next with the following one", () => {
    const { blocks, linesOf } = flow([{ lines: 5 }, { lines: 5 }]);
    // 150px of lines fit a 150px band to the pixel.
    assert.deepEqual(pageTops(blocks, linesOf, 150), [100, 270]);
  });

  it("gives one page to a document that fits", () => {
    const { blocks, linesOf } = flow([{ lines: 3 }]);
    assert.deepEqual(pageTops(blocks, linesOf, 1000), [100]);
  });

  it("gives one page to nothing at all", () => {
    assert.deepEqual(pageTops([], () => [], 500), [0]);
    assert.deepEqual(pageTops([], () => [], 500, 60), [60]);
    // A row without height is no block, so there is no first block to begin at.
    assert.deepEqual(pageTops([{ top: 10, bottom: 10 }], () => [], 500), [0]);
  });

  it("begins the first page where the window begins, not where the first block does", () => {
    // The chrome is 60px tall in the flow: the first page is what shows
    // under it before anything scrolled, breathing room included.
    const { blocks, linesOf } = flow([{ lines: 10 }]);
    const tops = pageTops(blocks, linesOf, 200, 60);
    assert.equal(tops[0], 60);
    // 60 + 200 = 260 cuts the sixth line (250-280): it opens page two.
    assert.equal(tops[1], 250);
  });

  it("moves a picture that would not fit to the next page whole", () => {
    // Four lines, then a picture four lines tall: the page of 200px holds
    // the text (120px) and the gap, not the picture (240 to 360).
    const { blocks, linesOf } = flow([{ lines: 4 }, { lines: 4, plain: true }]);
    assert.deepEqual(pageTops(blocks, linesOf, 200), [100, 240]);
  });

  it("cuts a picture taller than a page at the edge and goes on", () => {
    const { blocks, linesOf } = flow([{ lines: 20, plain: true }]);
    // 600px of picture in 250px pages: three pages, cut at the edges.
    assert.deepEqual(pageTops(blocks, linesOf, 250), [100, 350, 600]);
  });

  it("cuts a line taller than the page at the edge rather than looping", () => {
    const { blocks, linesOf } = flow([{ lines: 2 }], 300);
    assert.deepEqual(pageTops(blocks, linesOf, 200), [100, 300, 400, 600]);
  });

  it("skips a hidden row and what stands wholly above the first page", () => {
    const { blocks, linesOf } = flow([{ lines: 5 }, { lines: 5 }]);
    const hidden = [{ top: 0, bottom: 0 }, ...blocks];
    const shifted = (/** @type {number} */ index) => linesOf(index - 1);
    assert.deepEqual(pageTops(hidden, shifted, 160), [100, 270]);
    // A first page beginning under the first block: the block above is
    // nobody's page, and the second fits the one page there is.
    assert.deepEqual(pageTops(blocks, linesOf, 160, 260), [260]);
  });

  it("never cuts inside a page's first line twice", () => {
    // A cut line whose top is the page's own top would make no progress;
    // the cutter falls back to the edge.
    const blocks = [{ top: 0, bottom: 1000 }];
    const linesOf = () => [{ top: 0, bottom: 1000 }];
    assert.deepEqual(pageTops(blocks, linesOf, 400), [0, 400, 800]);
  });
});

describe("pageAt", () => {
  const tops = [60, 250, 480, 700];

  it("names the page a coordinate falls on", () => {
    assert.equal(pageAt(tops, 60), 0);
    assert.equal(pageAt(tops, 248), 0);
    assert.equal(pageAt(tops, 250), 1);
    // Within a pixel of a page's top is that page: rects come back
    // fractional, and a line that opens a page must be found on it.
    assert.equal(pageAt(tops, 249.5), 1);
    assert.equal(pageAt(tops, 479.5), 2);
    assert.equal(pageAt(tops, 5000), 3);
  });

  it("puts what stands above the first page on the first page", () => {
    assert.equal(pageAt(tops, 0), 0);
  });
});

describe("turnTarget", () => {
  const tops = [60, 250, 480];

  it("turns on and back within the table", () => {
    assert.equal(turnTarget(tops, 0, "down"), 1);
    assert.equal(turnTarget(tops, 1, "up"), 0);
  });

  it("answers null past either end - the part of a book turns instead", () => {
    assert.equal(turnTarget(tops, 2, "down"), null);
    assert.equal(turnTarget(tops, 0, "up"), null);
  });

  it("goes to either end whatever the page", () => {
    assert.equal(turnTarget(tops, 1, "first"), 0);
    assert.equal(turnTarget(tops, 1, "last"), 2);
  });
});

describe("curtainTop", () => {
  const tops = [60, 250, 480];

  it("begins a hair above the next page's top", () => {
    // On the first page, scrolled to 0, the footer begins at 300: the
    // second page begins at 250, and shows under the last whole line.
    assert.equal(curtainTop(tops, 0, 0, 300), 250 - CURTAIN_OVERLAP);
    // On the second page (scrolled to 250 - 60): the third begins at 480,
    // which is 290 down the window.
    assert.equal(curtainTop(tops, 1, 190, 300), 290 - CURTAIN_OVERLAP);
  });

  it("reaches nothing but leading", () => {
    // A heading's half-leading (1.3 line-height at 1.2em of 18px) is the
    // narrowest gap between two lines' glyph boxes in the reader.
    assert.ok(CURTAIN_OVERLAP < (21.6 * 1.3 - 21.6 * 1.15) / 2 + 0.5);
  });

  it("draws nothing over the last page, or when the next page begins under the footer", () => {
    assert.equal(curtainTop(tops, 2, 420, 300), null);
    assert.equal(curtainTop(tops, 0, 0, 240), null);
    // Within the overlap of the footer's edge there is still a seam to cover.
    assert.equal(curtainTop(tops, 0, 0, 249), 250 - CURTAIN_OVERLAP);
  });
});

describe("onPage", () => {
  it("is within a pixel of where a turn to the page scrolls", () => {
    assert.ok(onPage(190, 250, 60));
    assert.ok(onPage(190.6, 250, 60));
    assert.ok(!onPage(200, 250, 60));
    // The first page under a chrome taller than its top: the window at 0.
    assert.ok(onPage(0, 40, 60));
  });
});

describe("revealTarget", () => {
  const tops = [60, 250, 480];

  it("leaves a sentence with a line on the page where it stands", () => {
    assert.equal(revealTarget(tops, 1, [280, 310, 340]), null);
    // Straddling the page's head: read from its start, the head behind the
    // curtain, the page not turned back for it.
    assert.equal(revealTarget(tops, 1, [190, 220, 250]), null);
    assert.equal(revealTarget(tops, 1, [220, 250]), null);
    // Straddling the page's foot: the page stays until the next sentence.
    assert.equal(revealTarget(tops, 1, [450, 480, 510]), null);
  });

  it("turns to the first line's page for a sentence with no line on the page", () => {
    // The sentence opening the next page.
    assert.equal(revealTarget(tops, 1, [480, 510]), 2);
    // A sentence far ahead after a skip, and one behind after a skip back.
    assert.equal(revealTarget(tops, 0, [510, 540]), 2);
    assert.equal(revealTarget(tops, 2, [70, 100]), 0);
  });

  it("goes nowhere for a sentence with no line to measure", () => {
    assert.equal(revealTarget(tops, 1, []), null);
  });

  it("turns the page on for a word further on, and never back for one behind", () => {
    // The tail of a long sentence under the foot's curtain: the reader
    // follows the voice onto the next page.
    assert.equal(revealTarget(tops, 1, [510], true), 2);
    // The first words of a sentence straddling the page's head stand on
    // the page before, behind the curtain: the page stays (the second
    // round of the same smoke watched it turn back on every such word).
    assert.equal(revealTarget(tops, 1, [220], true), null);
    assert.equal(revealTarget(tops, 2, [70], true), null);
    // A word on the page shown asks for nothing either way.
    assert.equal(revealTarget(tops, 1, [300], true), null);
    // The sentence itself may still turn back - a skip back asks for it.
    assert.equal(revealTarget(tops, 2, [70, 100], false), 0);
  });

  it("reads a line within a pixel of a page's top as that page's", () => {
    assert.equal(revealTarget(tops, 1, [249.5]), null);
    assert.equal(revealTarget(tops, 1, [479.5]), 2);
  });
});

describe("tapZone", () => {
  it("turns back on the left third, on on the right third, and not in the middle", () => {
    assert.equal(tapZone(10, 900), "up");
    assert.equal(tapZone(299, 900), "up");
    assert.equal(tapZone(300, 900), null);
    assert.equal(tapZone(450, 900), null);
    assert.equal(tapZone(600, 900), null);
    assert.equal(tapZone(601, 900), "down");
    assert.equal(tapZone(890, 900), "down");
  });

  it("answers nothing outside the window or without one", () => {
    assert.equal(tapZone(-1, 900), null);
    assert.equal(tapZone(901, 900), null);
    assert.equal(tapZone(10, 0), null);
  });
});

describe("wheelTurn", () => {
  it("turns on a notch down and back on a notch up", () => {
    assert.equal(wheelTurn({ deltaX: 0, deltaY: 53, ctrl: false }, 1000, -Infinity), "down");
    assert.equal(wheelTurn({ deltaX: 0, deltaY: -53, ctrl: false }, 1000, -Infinity), "up");
  });

  it("lets a flick's burst be one turn", () => {
    assert.equal(wheelTurn({ deltaX: 0, deltaY: 8, ctrl: false }, 1000, 1000 - WHEEL_COOLDOWN_MS + 1), null);
    assert.equal(wheelTurn({ deltaX: 0, deltaY: 8, ctrl: false }, 1000, 1000 - WHEEL_COOLDOWN_MS), "down");
  });

  it("leaves a sideways scroll and a zoom chord alone", () => {
    assert.equal(wheelTurn({ deltaX: 40, deltaY: 10, ctrl: false }, 1000, -Infinity), null);
    assert.equal(wheelTurn({ deltaX: 0, deltaY: 10, ctrl: true }, 1000, -Infinity), null);
    assert.equal(wheelTurn({ deltaX: 0, deltaY: 0, ctrl: false }, 1000, -Infinity), null);
  });
});

describe("pagePercent", () => {
  it("counts the page shown as read", () => {
    assert.equal(pagePercent(0, 4), 25);
    assert.equal(pagePercent(3, 4), 100);
    assert.equal(pagePercent(0, 1), 100);
    assert.equal(pagePercent(0, 0), 0);
  });
});
