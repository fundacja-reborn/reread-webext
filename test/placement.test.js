import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { placement } from "../src/content/tooltip.js";

/**
 * The bubble is placed by an edge rather than by a rectangle (D44), and which
 * edge it is decides which way it grows once the row of actions unfolds. That
 * is the part no smoke test can measure: on the screen a bubble eight pixels
 * out of place looks like a bubble.
 *
 * The numbers below are viewport coordinates, as everything here is: `GAP` is
 * 8 pixels between the phrase and the bubble, `VIEWPORT_MARGIN` another 8 from
 * the edges of the window.
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
  it("stands above the phrase, pinned by its bottom edge", () => {
    const spot = placement({
      anchor: at({ top: 400 }),
      size: { width: 300, height: 60 },
      viewport: VIEWPORT,
    });

    // Pinned by the bottom, and the bottom is 8 pixels above the phrase: 800
    // minus 392. Growing taller now moves the top edge, not this one.
    assert.deepEqual(spot, { left: 100, bottom: 408 });
  });

  it("goes below the phrase when there is no room above it", () => {
    const spot = placement({
      anchor: at({ top: 30 }),
      size: { width: 300, height: 60 },
      viewport: VIEWPORT,
    });

    assert.deepEqual(spot, { left: 100, top: 58 });
  });

  it("counts the folded row when it asks whether the bubble fits above", () => {
    // 60 tall fits above a phrase at 90 (90 - 8 - 60 = 22, past the margin);
    // the same bubble with its row unfolded is 90 tall and does not.
    const anchor = at({ top: 90 });
    const size = { width: 300, height: 60 };

    assert.deepEqual(placement({ anchor, size, viewport: VIEWPORT }), { left: 100, bottom: 718 });
    assert.deepEqual(placement({ anchor, size, viewport: VIEWPORT, folded: 30 }), { left: 100, top: 118 });
  });

  it("keeps a bubble below the phrase off the bottom of the window, row and all", () => {
    const anchor = at({ top: 40 });
    const size = { width: 300, height: 700 };

    // Eight pixels below the phrase puts the foot of it at 768, still inside.
    assert.deepEqual(placement({ anchor, size, viewport: VIEWPORT }), { left: 100, top: 68 });
    // With the row unfolded it would not, so it comes up to make the room -
    // 800 less the margin less 730.
    assert.deepEqual(placement({ anchor, size, viewport: VIEWPORT, folded: 30 }), { left: 100, top: 62 });
  });

  it("never leaves the window, whichever way it is pushed", () => {
    const size = { width: 300, height: 60 };

    // Taller than everything: pinned to the top margin rather than off-screen.
    assert.deepEqual(placement({ anchor: at({ top: 10 }), size: { width: 300, height: 900 }, viewport: VIEWPORT }), {
      left: 100,
      top: 8,
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

    assert.deepEqual(spot, { left: 101, bottom: 408 });
  });
});
