import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { keeping, madeSelection } from "../src/lib/selection.js";

/**
 * The two rules of the reading side that do not need a page to be true: what a
 * mouse gesture meant, and what may be done with the phrase it produced.
 *
 * Everything around them is DOM and goes to `SMOKE-TESTS.md`. These two do not,
 * because both arrived as bug reports that looked like something else - a
 * bubble closing and opening itself again, and an underline that never came.
 */

const AT = { x: 100, y: 200 };

/**
 * @param {{ from?: { x: number, y: number } | null, to?: { x: number, y: number }, clicks?: number }} gesture
 */
function gesture({ from = AT, to = AT, clicks = 1 }) {
  return { from, to, clicks };
}

describe("madeSelection", () => {
  it("takes a press that travelled for a drag", () => {
    assert.equal(madeSelection(gesture({ to: { x: 400, y: 200 } })), true);
    assert.equal(madeSelection(gesture({ to: { x: 100, y: 260 } })), true);
  });

  it("takes a press that stayed put for a click", () => {
    // The bug: with several paragraphs selected, a click meant to dismiss the
    // bubble lands inside the selection - and Firefox still has that selection
    // when the release is caught. Reading it translated a phrase nobody
    // selected, over a page where the highlight was about to disappear.
    assert.equal(madeSelection(gesture({})), false);
  });

  it("forgives the shake of a hand resting on the mouse", () => {
    assert.equal(madeSelection(gesture({ to: { x: 103, y: 197 } })), false);
    assert.equal(madeSelection(gesture({ to: { x: 105, y: 200 } })), true);
  });

  it("takes a double or triple click for a selection, though nothing moved", () => {
    assert.equal(madeSelection(gesture({ clicks: 2 })), true);
    assert.equal(madeSelection(gesture({ clicks: 3 })), true);
  });

  it("reads the selection when no press of ours came first", () => {
    assert.equal(madeSelection(gesture({ from: null })), true);
  });
});

describe("keeping", () => {
  /**
   * @param {{ normalized?: string, gloss?: string, findable?: boolean, deliberate?: boolean }} phrase
   */
  const answer = ({ normalized = "ocean", gloss = "ocean", findable = true, deliberate = true }) =>
    keeping({ normalized, gloss, findable, deliberate });

  it("keeps a phrase of four words or fewer without being asked", () => {
    assert.equal(answer({ normalized: "ocean" }), "automatic");
    assert.equal(answer({ normalized: "the four great oceans" }), "automatic");
  });

  it("waits for Save on a longer one", () => {
    assert.equal(answer({ normalized: "all the four great oceans" }), "ask");
  });

  it("counts tokens rather than words, which an apostrophe splits", () => {
    // `world's` is two tokens, so this is five and waits for Save. The same
    // rule underlines it, so the count that decides is the matcher's own.
    assert.equal(answer({ normalized: "the world's four oceans" }), "ask");
  });

  it("keeps nothing that no page would ever show underlined", () => {
    // A selection running across two paragraphs, two list items or two cells of
    // a table. It translates like any other - it just cannot be kept, because
    // nothing would ever find it again.
    assert.equal(answer({ normalized: "intact getting your notes out", findable: false }), "none");
    // And a short one, which is the case that used to keep itself in silence.
    assert.equal(answer({ normalized: "milk bread", findable: false }), "none");
  });

  it("keeps nothing when there is no key or no translation", () => {
    assert.equal(answer({ normalized: "" }), "none");
    assert.equal(answer({ gloss: "" }), "none");
  });

  it("on a settled selection, keeps a single word without asking - the long-press", () => {
    // A touch selection reaches this through a timer, not a gesture (D73). The
    // one word is what the long-press itself took, so it is as deliberate as a
    // double click; it is kept the way D22 keeps any looked-up word.
    assert.equal(answer({ normalized: "ocean", deliberate: false }), "automatic");
  });

  it("on a settled selection, asks about anything wider than one word", () => {
    // Wider means the system's handles were dragged, and the timer cannot tell
    // a finished drag from a pause in the middle of one. A pause that wrote to
    // the vocabulary would keep half-made selections - so wide waits for Save.
    assert.equal(answer({ normalized: "milk bread", deliberate: false }), "ask");
    assert.equal(answer({ normalized: "the four great oceans", deliberate: false }), "ask");
  });

  it("keeps the other refusals over a settled selection too", () => {
    assert.equal(answer({ normalized: "milk bread", findable: false, deliberate: false }), "none");
    assert.equal(answer({ gloss: "", deliberate: false }), "none");
    assert.equal(answer({ normalized: "all the four great oceans", deliberate: false }), "ask");
  });
});
