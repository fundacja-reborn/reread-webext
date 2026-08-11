import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { afterChoosing, toMeanings } from "../src/lib/gloss.js";

describe("toMeanings", () => {
  it("keeps one line as one meaning", () => {
    assert.deepEqual(toMeanings("brzeg"), ["brzeg"]);
  });

  it("makes a meaning of every line", () => {
    assert.deepEqual(toMeanings("brzeg\nbank"), ["brzeg", "bank"]);
  });

  it("splits a dictionary line that was several lines in the book", () => {
    // What `senses()` produces for an entry written a paragraph per meaning.
    // Kept whole it would reach the store as one meaning and come out with its
    // lines glued together by spaces - one long answer instead of three.
    assert.deepEqual(toMeanings("bank (instytucja)\nbrzeg (rzeki)\nławica"), [
      "bank (instytucja)",
      "brzeg (rzeki)",
      "ławica",
    ]);
  });

  it("drops blank lines and the space around a meaning", () => {
    assert.deepEqual(toMeanings("  brzeg  \n\n   \nbank\n"), ["brzeg", "bank"]);
  });

  it("has nothing to save in an empty box", () => {
    assert.deepEqual(toMeanings("   \n  \n"), []);
  });
});

describe("afterChoosing", () => {
  it("puts the chosen line where the gloss was", () => {
    assert.equal(afterChoosing("brzeg", "bank (instytucja)", "brzeg"), "bank (instytucja)");
  });

  it("gives the gloss back when the same line is pressed again", () => {
    assert.equal(afterChoosing("bank (instytucja)", "bank (instytucja)", "brzeg"), "brzeg");
  });

  it("replaces one choice with another rather than collecting them", () => {
    assert.equal(afterChoosing("bank (instytucja)", "ławica", "brzeg"), "ławica");
  });

  it("chooses over a gloss the reader has edited by hand", () => {
    assert.equal(afterChoosing("brzeg rzeki", "bank (instytucja)", "brzeg rzeki"), "bank (instytucja)");
  });

  it("takes a choice back to the edited gloss and not to the engine's", () => {
    // An edit is the gloss from then on: `setBody` is what records it, and the
    // bubble calls that when the edit box closes on a save.
    assert.equal(afterChoosing("ławica", "ławica", "brzeg rzeki"), "brzeg rzeki");
  });
});
