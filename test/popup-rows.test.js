import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { popupRows } from "../src/popup/rows.js";

describe("the popup's rows", () => {
  it("shows the pair on a device that has a model", () => {
    const rows = popupRows({ translationOff: false, fresh: false, bubbleOff: false });
    assert.equal(rows.pair, true);
    assert.equal(rows.setup, false);
    assert.equal(rows.translationNote, false);
  });

  it("puts the signpost in the pair's place while nothing is installed", () => {
    const rows = popupRows({ translationOff: false, fresh: true, bubbleOff: false });
    assert.equal(rows.pair, false);
    assert.equal(rows.setup, true);
  });

  it("takes the translating half away when translation is switched off", () => {
    const rows = popupRows({ translationOff: true, fresh: false, bubbleOff: false });
    assert.equal(rows.pair, false);
    assert.equal(rows.setup, false);
    assert.equal(rows.vocabulary, false);
    assert.equal(rows.quiet, false);
    assert.equal(rows.readerOnly, false);
  });

  it("says why in the pair's place, so nothing reads as a breakage", () => {
    assert.equal(popupRows({ translationOff: true, fresh: false, bubbleOff: false }).translationNote, true);
    assert.equal(popupRows({ translationOff: true, fresh: true, bubbleOff: false }).translationNote, true);
    // The signpost never stands beside the note: with translation off, a
    // missing model is not what the popup has to say.
    assert.equal(popupRows({ translationOff: true, fresh: true, bubbleOff: false }).setup, false);
  });

  it("keeps the switch that got there, whatever it did to the rest", () => {
    // The one row exempt from the hiding above: it is the way back, and a
    // mode that hides its own switch is a trap.
    for (const translationOff of [true, false]) {
      for (const fresh of [true, false]) {
        for (const bubbleOff of [true, false]) {
          assert.equal(popupRows({ translationOff, fresh, bubbleOff }).translation, true);
        }
      }
    }
  });

  it("takes the site switch away only where it could change nothing (D149)", () => {
    // With the bubble switched off under the trim every ordinary page is
    // left alone already; a switch with no other side is not a choice.
    assert.equal(popupRows({ translationOff: true, fresh: false, bubbleOff: true }).site, false);
    assert.equal(popupRows({ translationOff: true, fresh: false, bubbleOff: false }).site, true);
    // Under a hidden row the stored value never acts - the popup's rule too.
    assert.equal(popupRows({ translationOff: false, fresh: false, bubbleOff: true }).site, true);
    assert.equal(popupRows({ translationOff: false, fresh: true, bubbleOff: false }).site, true);
  });
});
