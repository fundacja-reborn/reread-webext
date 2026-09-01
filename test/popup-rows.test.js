import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { popupRows } from "../src/popup/rows.js";

/** @param {Partial<Parameters<typeof popupRows>[0]>} [state] */
const rows = (state = {}) =>
  popupRows({ translationOff: false, fresh: false, bubbleOff: false, pair: true, ...state });

describe("the popup's rows", () => {
  it("shows the pair on a device that has a model", () => {
    const shown = rows();
    assert.equal(shown.pair, true);
    assert.equal(shown.setup, false);
    assert.equal(shown.translationNote, false);
  });

  it("puts the signpost in the pair's place while nothing is installed", () => {
    const shown = rows({ fresh: true, pair: false });
    assert.equal(shown.pair, false);
    assert.equal(shown.setup, true);
  });

  it("takes the translating half away under the trim without a pair", () => {
    const shown = rows({ translationOff: true, pair: false });
    assert.equal(shown.pair, false);
    assert.equal(shown.setup, false);
    assert.equal(shown.vocabulary, false);
    assert.equal(shown.quiet, false);
    assert.equal(shown.readerOnly, false);
  });

  it("keeps the quiet vocabulary's rows under the trim with a pair (D162)", () => {
    // The switch turns off the model, not the bubble: with a pair the saved
    // phrases live and the ordinary pages read again, so their door and the
    // reader-only switch stand. The fold stays away - the trimmed bubble
    // never folds (D131).
    const shown = rows({ translationOff: true });
    assert.equal(shown.vocabulary, true);
    assert.equal(shown.readerOnly, true);
    assert.equal(shown.quiet, false);
    // The no-bubble sub-option leaves every ordinary page alone, and a
    // reader-only switch over pages already left alone chooses nothing.
    assert.equal(rows({ translationOff: true, bubbleOff: true }).readerOnly, false);
    assert.equal(rows({ translationOff: true, bubbleOff: true }).vocabulary, true);
  });

  it("says why in the pair's place, so nothing reads as a breakage", () => {
    assert.equal(rows({ translationOff: true }).translationNote, true);
    assert.equal(rows({ translationOff: true, fresh: true, pair: false }).translationNote, true);
    // The signpost never stands beside the note: with the model off, a
    // missing model is not what the popup has to say.
    assert.equal(rows({ translationOff: true, fresh: true, pair: false }).setup, false);
  });

  it("keeps the switch that got there, whatever it did to the rest", () => {
    // The one row exempt from the hiding above: it is the way back, and a
    // mode that hides its own switch is a trap.
    for (const translationOff of [true, false]) {
      for (const fresh of [true, false]) {
        for (const bubbleOff of [true, false]) {
          for (const pair of [true, false]) {
            assert.equal(popupRows({ translationOff, fresh, bubbleOff, pair }).translation, true);
          }
        }
      }
    }
  });

  it("takes the site switch away only where it could change nothing (D149)", () => {
    // With the bubble switched off under the trim every ordinary page is
    // left alone already; a switch with no other side is not a choice.
    assert.equal(rows({ translationOff: true, bubbleOff: true }).site, false);
    assert.equal(rows({ translationOff: true }).site, true);
    // Under a hidden row the stored value never acts - the popup's rule too.
    assert.equal(rows({ bubbleOff: true }).site, true);
    assert.equal(rows({ fresh: true, pair: false }).site, true);
  });
});
