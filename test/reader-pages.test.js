import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BLOB_SAMPLES,
  CURTAIN_OVERLAP,
  EDGE_TURN_FIRST_MS,
  EDGE_TURN_REPEAT_MS,
  EDGE_ZONE_MIN,
  FLASH_GAP_MS,
  SWIPE_MIN,
  TAP_ALONE_MS,
  TAP_BLOB,
  TAP_DEAD_FOOT,
  TAP_DEAD_SIDE,
  TAP_DRIFT,
  TAP_EDGE,
  TAP_HOLD_MS,
  WHEEL_COOLDOWN_MS,
  blobTrusted,
  curtainTop,
  edgeTurn,
  edgeZone,
  flashAllowed,
  onPage,
  pageAt,
  pagePercent,
  pageTops,
  revealTarget,
  swipeIntent,
  tapIntent,
  tapZone,
  turnMotion,
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

  describe("cut from an anchor (D238)", () => {
    // Three paragraphs of ten lines at 30px, 20px apart, under a 60px
    // chrome: lines at 100-400, 420-720, 740-1040.
    const { blocks, linesOf } = flow([{ lines: 10 }, { lines: 10 }, { lines: 10 }]);
    const canonical = pageTops(blocks, linesOf, 200, 60);

    /**
     * Every line of the flow on exactly one page: the pages are contiguous,
     * each opens on a line's or a block's top (or the head), and no page
     * holds more than the band.
     *
     * @param {number[]} tops
     * @param {number} height
     */
    function whole(tops, height) {
      const lineTops = [0, 1, 2].flatMap((index) => linesOf(index).map((line) => line.top));
      const blockTops = blocks.map((block) => block.top);
      for (const [index, top] of tops.entries()) {
        if (index > 0) {
          assert.ok(top > (tops[index - 1] ?? 0), "a page does not begin below the one before");
          assert.ok(lineTops.includes(top) || blockTops.includes(top), `${top} is no line's top`);
        }
        const next = tops[index + 1];
        if (next !== undefined) {
          // Every line beginning on the page ends on it, within the band:
          // the next page may open a gap's width below the band (a block
          // beginning past the edge opens it whole), never a line's.
          for (const line of [0, 1, 2].flatMap((one) => linesOf(one))) {
            if (line.top >= top && line.top < next) {
              assert.ok(line.bottom <= next + 1, `a line is cut at ${next}`);
              assert.ok(line.bottom <= top + height + 1, `page ${index} holds more than the band`);
            }
          }
        }
      }
    }

    it("keeps the anchored page's first line and cuts on from it as from the head", () => {
      // The seventh line of the first paragraph (280) opened a page while
      // the band was 220px tall; the band shrinks to 200 (a bar stood up).
      const tops = pageTops(blocks, linesOf, 200, 60, 280);
      assert.ok(tops.includes(280), "the anchored page lost its first line");
      const at = tops.indexOf(280);
      // On from the anchor: exactly the canonical cut from that top.
      assert.deepEqual(tops.slice(at), pageTops(blocks, linesOf, 200, 280).slice(0));
      whole(tops, 200);
    });

    it("cuts the pages before the anchor back from it, each ending on the next", () => {
      // The third paragraph's top (730 is its box top less the gap: 740 is
      // the first line; the block begins at 740) as the anchor.
      const tops = pageTops(blocks, linesOf, 200, 60, 740);
      assert.deepEqual(tops, [60, 160, 340, 540, 740, 920]);
      whole(tops, 200);
      // Each page before the anchor is as full as the band allows: the
      // earliest line from which everything down to the next page fits.
      assert.equal(540, 740 - 200);
      assert.equal(340, 540 - 200);
    });

    it("comes up short on the head's page rather than on any other", () => {
      // 280 anchored in a 170px band: pages back of 150 (five lines) and
      // 130 - the head's page holds a single line and the margin.
      const tops = pageTops(blocks, linesOf, 170, 60, 280);
      assert.deepEqual(tops.slice(0, 3), [60, 130, 280]);
      whole(tops, 170);
    });

    it("opens the head's page on the first block when only the margin is left above the cut", () => {
      // 280 anchored in a 200px band: the page before holds every line
      // from 100 to 280 - 180px - and the 40px of paper above the first
      // block would have made the head's page an empty one.
      const tops = pageTops(blocks, linesOf, 200, 60, 280);
      assert.equal(tops[0], 100);
      assert.equal(tops[1], 280);
    });

    it("is the canonical table for an anchor at the head, or past the end", () => {
      assert.deepEqual(pageTops(blocks, linesOf, 200, 60, 60), canonical);
      assert.deepEqual(pageTops(blocks, linesOf, 200, 60, 20), canonical);
      assert.deepEqual(pageTops(blocks, linesOf, 200, 60, 5000), canonical);
      // A canonical page's top as the anchor changes nothing either.
      assert.deepEqual(pageTops(blocks, linesOf, 200, 60, canonical[2]), canonical);
    });

    it("holds the anchor's top whatever the band does", () => {
      for (const height of [120, 170, 200, 260, 400]) {
        const tops = pageTops(blocks, linesOf, height, 60, 480);
        assert.ok(tops.includes(480), `the anchor moved at ${height}px`);
        whole(tops, height);
      }
    });

    it("moves a picture whole onto the page before when the cut back lands inside it", () => {
      // Four lines, a picture four lines tall, six lines: anchored on the
      // last paragraph's top, the picture (240-360) does not fit above it
      // with the page's own lines, so it goes whole to the page before.
      const plated = flow([{ lines: 4 }, { lines: 4, plain: true }, { lines: 6 }]);
      assert.deepEqual(pageTops(plated.blocks, plated.linesOf, 200, 60, 380), [60, 190, 380]);
      // Anchored inside a picture taller than a page, the picture is cut at
      // the edge both ways, as the forward cut cuts one - and the head's
      // page shows the plate's top, short.
      const tall = flow([{ lines: 20, plain: true }]);
      assert.deepEqual(pageTops(tall.blocks, tall.linesOf, 250, 60, 400), [60, 150, 400, 650]);
    });
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

/**
 * A deliberate tap on the right third of a phone-sized window: brief, still,
 * a fingertip's contact, well inside the page, alone. Every test below takes
 * this one and spoils exactly one thing about it.
 *
 * @param {Partial<import("../src/lib/reader/pages.js").TapSignature>} [how]
 * @returns {import("../src/lib/reader/pages.js").TapSignature}
 */
function tap(how = {}) {
  return {
    pointerType: "touch",
    downAt: 1000,
    upAt: 1080,
    dx: 1,
    dy: -2,
    width: 18,
    height: 20,
    x: 330,
    y: 400,
    viewportW: 360,
    viewportH: 740,
    otherPointers: [],
    ...how,
  };
}

describe("tapIntent (D250)", () => {
  it("turns on the right third and back on the left, and nothing in the middle", () => {
    assert.equal(tapIntent(tap()), "down");
    assert.equal(tapIntent(tap({ x: 30 })), "up");
    assert.equal(tapIntent(tap({ x: 180 })), null);
  });

  it("refuses a contact that lasted longer than a tap", () => {
    assert.equal(tapIntent(tap({ upAt: 1000 + TAP_HOLD_MS - 1 })), "down");
    assert.equal(tapIntent(tap({ upAt: 1000 + TAP_HOLD_MS })), null);
    // The thumb that holds the device: on the glass for the whole page.
    assert.equal(tapIntent(tap({ upAt: 9000 })), null);
  });

  it("refuses a contact that travelled", () => {
    assert.equal(tapIntent(tap({ dx: TAP_DRIFT - 1, dy: 0 })), "down");
    assert.equal(tapIntent(tap({ dx: TAP_DRIFT, dy: 0 })), null);
    assert.equal(tapIntent(tap({ dx: 0, dy: TAP_DRIFT })), null);
  });

  it("never lets the pen turn a page", () => {
    assert.equal(tapIntent(tap({ pointerType: "pen" })), null);
    // The mouse turns pages like a finger: a click is a tap.
    assert.equal(tapIntent(tap({ pointerType: "mouse" })), "down");
  });

  it("refuses a contact wider than a fingertip, and only when the device measures one", () => {
    assert.equal(tapIntent(tap({ width: TAP_BLOB - 1, height: TAP_BLOB - 1 })), "down");
    assert.equal(tapIntent(tap({ width: 12, height: TAP_BLOB })), null);
    assert.equal(tapIntent(tap({ width: TAP_BLOB, height: 12 })), null);
    // A device whose numbers say nothing (`blobTrusted` dropped the test):
    // the other tests still stand, and a large thumb still turns pages.
    assert.equal(tapIntent(tap({ width: null, height: null })), "down");
  });

  it("keeps the dead strips down the sides and along the foot, and the edge at the head", () => {
    assert.equal(tapIntent(tap({ x: TAP_DEAD_SIDE - 1 })), null);
    assert.equal(tapIntent(tap({ x: TAP_DEAD_SIDE })), "up");
    assert.equal(tapIntent(tap({ x: 360 - TAP_DEAD_SIDE + 1 })), null);
    assert.equal(tapIntent(tap({ x: 360 - TAP_DEAD_SIDE })), "down");
    assert.equal(tapIntent(tap({ y: 740 - TAP_DEAD_FOOT + 1 })), null);
    assert.equal(tapIntent(tap({ y: 740 - TAP_DEAD_FOOT })), "down");
    assert.equal(tapIntent(tap({ y: TAP_EDGE - 1 })), null);
    assert.equal(tapIntent(tap({ y: TAP_EDGE })), "down");
    // The corners are where a hand's own contact gathers: neither turns.
    assert.equal(tapIntent(tap({ x: 8, y: 735 })), null);
    assert.equal(tapIntent(tap({ x: 352, y: 735 })), null);
  });

  it("leaves the strips the same on a reader's wide window", () => {
    const wide = { viewportW: 1200, viewportH: 900, x: 1100, y: 400 };
    assert.equal(tapIntent(tap(wide)), "down");
    assert.equal(tapIntent(tap({ ...wide, x: 1200 - TAP_DEAD_SIDE + 1 })), null);
    assert.equal(tapIntent(tap({ ...wide, x: 30 })), "up");
    assert.equal(tapIntent(tap({ ...wide, x: 600 })), null);
  });

  it("refuses a contact that landed beside another, and lets a long-resting one be", () => {
    assert.equal(tapIntent(tap({ otherPointers: [1000 + TAP_ALONE_MS] })), null);
    assert.equal(tapIntent(tap({ otherPointers: [1000 - TAP_ALONE_MS] })), null);
    assert.equal(tapIntent(tap({ otherPointers: [1000 + TAP_ALONE_MS + 1] })), "down");
    // The thumb that has been holding the device since the page opened is
    // not a second point of a grip: it must not stop a deliberate tap.
    assert.equal(tapIntent(tap({ otherPointers: [200] })), "down");
  });
});

describe("swipeIntent (D250)", () => {
  it("turns on to the left and back to the right, past the threshold", () => {
    assert.equal(swipeIntent(tap({ dx: -SWIPE_MIN, dy: 0 })), "down");
    assert.equal(swipeIntent(tap({ dx: SWIPE_MIN, dy: 0 })), "up");
    assert.equal(swipeIntent(tap({ dx: -SWIPE_MIN + 1, dy: 0 })), null);
    assert.equal(swipeIntent(tap({ dx: SWIPE_MIN - 1, dy: 0 })), null);
  });

  it("leaves a travel that was mostly up or down alone", () => {
    assert.equal(swipeIntent(tap({ dx: -60, dy: 29 })), "down");
    assert.equal(swipeIntent(tap({ dx: -60, dy: 30 })), null);
    assert.equal(swipeIntent(tap({ dx: -60, dy: -100 })), null);
  });

  it("asks nothing about the time, the size or the place it began", () => {
    // A slow swipe is a swipe; a swipe that began at the very edge is one
    // too - what makes it deliberate is that it moved.
    assert.equal(swipeIntent(tap({ dx: -80, dy: 0, upAt: 9000, width: 44, height: 44, x: 2, y: 738 })), "down");
  });

  it("never lets the pen turn a page, and refuses a second contact of the moment", () => {
    assert.equal(swipeIntent(tap({ dx: -80, dy: 0, pointerType: "pen" })), null);
    assert.equal(swipeIntent(tap({ dx: -80, dy: 0, otherPointers: [1050] })), null);
  });

  it("is not a tap, and a tap is not a swipe", () => {
    assert.equal(swipeIntent(tap()), null);
    assert.equal(tapIntent(tap({ dx: -80, dy: 0 })), null);
  });
});

describe("blobTrusted (D250)", () => {
  const spread = Array.from({ length: BLOB_SAMPLES }, (_, index) => 14 + index);

  it("waits for its measurements before saying anything", () => {
    assert.equal(blobTrusted([]), false);
    assert.equal(blobTrusted(spread.slice(0, BLOB_SAMPLES - 1)), false);
    assert.equal(blobTrusted(spread), true);
  });

  it("drops the test where the device answers a constant, or nothing", () => {
    assert.equal(blobTrusted(Array.from({ length: BLOB_SAMPLES }, () => 23)), false);
    assert.equal(blobTrusted(Array.from({ length: BLOB_SAMPLES }, () => 1)), false);
    assert.equal(blobTrusted(Array.from({ length: BLOB_SAMPLES }, () => 0)), false);
    // One real measurement among the ones and the test means something.
    assert.equal(blobTrusted([1, 1, 1, 1, 1, 26]), true);
  });
});

describe("flashAllowed and turnMotion (D251)", () => {
  const now = 10_000;

  it("flashes a turn from the hand, and nothing else", () => {
    assert.equal(flashAllowed("turn", -Infinity, now), true);
    assert.equal(flashAllowed("speech", -Infinity, now), false);
    assert.equal(flashAllowed("drag", -Infinity, now), false);
    assert.equal(flashAllowed("jump", -Infinity, now), false);
  });

  it("holds two flashes apart", () => {
    assert.equal(flashAllowed("turn", now - FLASH_GAP_MS, now), true);
    assert.equal(flashAllowed("turn", now - FLASH_GAP_MS + 1, now), false);
    // A held hardware key repeats faster than that: the pages turn, the
    // band does not strobe.
    assert.equal(flashAllowed("turn", now - 120, now), false);
  });

  /**
   * @param {Partial<Parameters<typeof turnMotion>[0]>} [how]
   */
  function motion(how = {}) {
    return turnMotion({
      effect: "auto",
      eink: false,
      reduced: false,
      reason: "turn",
      lastFlashAt: -Infinity,
      now,
      ...how,
    });
  }

  it("flashes on e-ink paper and scrolls smoothly on every other", () => {
    assert.equal(motion({ eink: true }), "flash");
    assert.equal(motion(), "smooth");
  });

  it("moves instantly where the setting, the system or the reason says so", () => {
    assert.equal(motion({ effect: "off" }), "instant");
    assert.equal(motion({ effect: "off", eink: true }), "instant");
    assert.equal(motion({ reduced: true }), "instant");
    // Less motion takes the flash too: a band going black is motion.
    assert.equal(motion({ reduced: true, eink: true }), "instant");
    for (const reason of /** @type {const} */ (["jump", "speech", "drag"])) {
      assert.equal(motion({ reason }), "instant", `${reason} is dressed as a turn`);
      assert.equal(motion({ reason, eink: true }), "instant", `${reason} flashes the band`);
    }
  });

  it("turns instantly rather than flashing within the gap", () => {
    assert.equal(motion({ eink: true, lastFlashAt: now - 100 }), "instant");
    assert.equal(motion({ eink: true, lastFlashAt: now - FLASH_GAP_MS }), "flash");
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

describe("edgeZone (D239)", () => {
  // A window 800 tall: the page's first line at 72, its last full line
  // ending at 740 (the curtain's edge), pages both ways.
  const both = { up: true, down: true };

  it("is the foot below the last full line, and the head within its reach of the first", () => {
    assert.equal(edgeZone(740, 72, 740, 800, both), "down");
    assert.equal(edgeZone(790, 72, 740, 800, both), "down");
    assert.equal(edgeZone(739, 72, 740, 800, both), null);
    assert.equal(edgeZone(72 + EDGE_ZONE_MIN - 1, 72, 740, 800, both), "up");
    assert.equal(edgeZone(72 + EDGE_ZONE_MIN, 72, 740, 800, both), null);
    // Above the first line - the margin, the chrome - is the head's zone too.
    assert.equal(edgeZone(10, 72, 740, 800, both), "up");
    assert.equal(edgeZone(400, 72, 740, 800, both), null);
  });

  it("keeps the foot's zone at least its reach tall when the curtain is next to nothing", () => {
    // The last line ends on the margin: the curtain has nothing to cover
    // and the foot would be a strip of nothing - the window's lowest
    // pixels make the zone instead.
    assert.equal(edgeZone(800 - EDGE_ZONE_MIN, 72, 798, 800, both), "down");
    assert.equal(edgeZone(800 - EDGE_ZONE_MIN - 1, 72, 798, 800, both), null);
  });

  it("is dead at the part's ends", () => {
    assert.equal(edgeZone(790, 72, 740, 800, { up: true, down: false }), null);
    assert.equal(edgeZone(10, 72, 740, 800, { up: false, down: true }), null);
    // The other edge keeps its zone.
    assert.equal(edgeZone(10, 72, 740, 800, { up: true, down: false }), "up");
  });
});

describe("edgeTurn (D239)", () => {
  it("turns first after the stay's first wait, then at the repeat's pace", () => {
    const entered = 1000;
    assert.equal(edgeTurn("down", entered, null, entered + EDGE_TURN_FIRST_MS - 1), false);
    assert.equal(edgeTurn("down", entered, null, entered + EDGE_TURN_FIRST_MS), true);
    const turned = entered + EDGE_TURN_FIRST_MS;
    assert.equal(edgeTurn("down", entered, turned, turned + EDGE_TURN_REPEAT_MS - 1), false);
    assert.equal(edgeTurn("down", entered, turned, turned + EDGE_TURN_REPEAT_MS), true);
    // The repeat is the slower clock: an e-ink panel refreshes, an eye
    // finds the page.
    assert.ok(EDGE_TURN_REPEAT_MS > EDGE_TURN_FIRST_MS);
  });

  it("turns nothing out of a zone", () => {
    assert.equal(edgeTurn(null, 0, null, 100000), false);
  });
});
