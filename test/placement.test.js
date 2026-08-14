import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { placement } from "../src/content/tooltip.js";

/**
 * The bubble is placed by an edge rather than by a rectangle (D44): the answer
 * is the line of the near edge (`top`) and which way the rest hangs off it
 * (`grow`) - never a `bottom` computed from the viewport's height, which
 * Android's dynamic toolbar drags around (D77). Which edge it is decides which
 * way the bubble grows once the row of actions unfolds. That is the part no
 * smoke test can measure: on the screen a bubble eight pixels out of place
 * looks like a bubble.
 *
 * The numbers below are viewport coordinates, as everything here is: `GAP` is
 * 8 pixels between the phrase and the bubble, `VIEWPORT_MARGIN` another 8 from
 * the edges of the window, and `HANDLE_GAP` of 32 stands a below-preferring
 * bubble clear of the system's selection handles (D74).
 */

const VIEWPORT = { width: 1000, height: 800 };

/**
 * @param {object} phrase
 * @param {number} phrase.top
 * @param {number} [phrase.height]
 * @param {number} [phrase.left]
 */
function at({ top, height = 20, left = 100 }) {
  return { top, bottom: top + height, left };
}

describe("placement", () => {
  it("stands above the phrase, hanging up from the line of its near edge", () => {
    const spot = placement({
      anchor: at({ top: 400 }),
      size: { width: 300, height: 60 },
      viewport: VIEWPORT,
    });

    // The line is 8 pixels above the phrase; the bubble hangs upward from it,
    // so growing taller moves the top edge and never this line.
    assert.deepEqual(spot, { left: 100, top: 392, grow: "up" });
  });

  it("goes below the phrase when there is no room above it", () => {
    const spot = placement({
      anchor: at({ top: 30 }),
      size: { width: 300, height: 60 },
      viewport: VIEWPORT,
    });

    assert.deepEqual(spot, { left: 100, top: 58, grow: "down" });
  });

  it("counts the folded row when it asks whether the bubble fits above", () => {
    // 60 tall fits above a phrase at 90 (90 - 8 - 60 = 22, past the margin);
    // the same bubble with its row unfolded is 90 tall and does not.
    const anchor = at({ top: 90 });
    const size = { width: 300, height: 60 };

    assert.deepEqual(placement({ anchor, size, viewport: VIEWPORT }), { left: 100, top: 82, grow: "up" });
    assert.deepEqual(placement({ anchor, size, viewport: VIEWPORT, folded: 30 }), {
      left: 100,
      top: 118,
      grow: "down",
    });
  });

  it("keeps a bubble below the phrase off the bottom of the window, row and all", () => {
    const anchor = at({ top: 40 });
    const size = { width: 300, height: 700 };

    // Eight pixels below the phrase puts the foot of it at 768, still inside.
    assert.deepEqual(placement({ anchor, size, viewport: VIEWPORT }), { left: 100, top: 68, grow: "down" });
    // With the row unfolded it would not, so it comes up to make the room -
    // 800 less the margin less 730.
    assert.deepEqual(placement({ anchor, size, viewport: VIEWPORT, folded: 30 }), {
      left: 100,
      top: 62,
      grow: "down",
    });
  });

  it("never leaves the window, whichever way it is pushed", () => {
    const size = { width: 300, height: 60 };

    // Taller than everything: pinned to the top margin rather than off-screen.
    assert.deepEqual(placement({ anchor: at({ top: 10 }), size: { width: 300, height: 900 }, viewport: VIEWPORT }), {
      left: 100,
      top: 8,
      grow: "down",
    });
    // A phrase against the left edge of the window, and one against the right.
    assert.equal(placement({ anchor: at({ top: 400, left: 2 }), size, viewport: VIEWPORT }).left, 8);
    assert.equal(placement({ anchor: at({ top: 400, left: 950 }), size, viewport: VIEWPORT }).left, 692);
  });

  it("answers in whole pixels", () => {
    const spot = placement({
      anchor: at({ top: 400.4, left: 100.6 }),
      size: { width: 300.3, height: 60.7 },
      viewport: VIEWPORT,
    });

    assert.deepEqual(spot, { left: 101, top: 392, grow: "up" });
  });

  it("stands below a touch selection, past the system's handles", () => {
    // Plenty of room on either side, and below still wins: above the phrase
    // stands the system's own selection bar, and under its last line hang the
    // drag handles - 32 pixels instead of 8 steps past them (D74).
    const spot = placement({
      anchor: at({ top: 400 }),
      size: { width: 300, height: 60 },
      viewport: VIEWPORT,
      prefer: "below",
    });

    assert.deepEqual(spot, { left: 100, top: 452, grow: "down" });
  });

  it("falls back above when a below-preferring bubble has no room below", () => {
    const spot = placement({
      anchor: at({ top: 700 }),
      size: { width: 300, height: 60 },
      viewport: VIEWPORT,
      prefer: "below",
    });

    // The above-position keeps the ordinary gap: there are no handles over a
    // phrase, only under it.
    assert.deepEqual(spot, { left: 100, top: 692, grow: "up" });
  });

  it("counts the folded row when it asks whether the bubble fits below", () => {
    // 60 tall ends at 792 below a phrase at 680, exactly on the margin; with
    // the row unfolded it would not fit, and above there is room.
    const anchor = at({ top: 680 });
    const size = { width: 300, height: 60 };

    assert.deepEqual(placement({ anchor, size, viewport: VIEWPORT, prefer: "below" }), {
      left: 100,
      top: 732,
      grow: "down",
    });
    assert.deepEqual(placement({ anchor, size, viewport: VIEWPORT, folded: 10, prefer: "below" }), {
      left: 100,
      top: 672,
      grow: "up",
    });
  });

  it("clamps a below-preferring bubble that fits nowhere, like any other", () => {
    const spot = placement({
      anchor: at({ top: 380 }),
      size: { width: 300, height: 700 },
      viewport: VIEWPORT,
      prefer: "below",
    });

    // 800 less the margin less 700: as much of it on the screen as there is
    // screen, even over the phrase - the last resort is the same both ways.
    assert.deepEqual(spot, { left: 100, top: 92, grow: "down" });
  });
});
