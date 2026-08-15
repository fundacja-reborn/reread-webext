import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { tokenize } from "../src/lib/matcher/tokenize.js";
import { besideSpan, nearestWordIndex, wordIndexAt } from "../src/lib/matcher/words.js";

/**
 * The pure half of the reader's touch selection (D80/D81): a touch becomes a
 * character offset, and these turn the offset into a word of the same
 * tokenization that matches phrases - so what a gesture selects is exactly
 * what a scan can find again - and say where a tapped word stands against
 * the selection already made.
 */

// Tokens and their spans: The [0,3), Pacific [4,11), our [13,16), ocean [17,22).
const TEXT = "The Pacific, our ocean.";
const TOKENS = tokenize(TEXT);

describe("wordIndexAt", () => {
  it("finds the word an offset is inside", () => {
    assert.equal(wordIndexAt(TOKENS, 1), 0); // inside `The`
    assert.equal(wordIndexAt(TOKENS, 6), 1); // inside `Pacific`
    assert.equal(wordIndexAt(TOKENS, 18), 3); // inside `ocean`
  });

  it("counts a word's own edges as the word", () => {
    // A caret position lies between characters: a tap on `T` can answer
    // offset 0, and a tap on the last letter can answer the offset after it.
    assert.equal(wordIndexAt(TOKENS, 0), 0);
    assert.equal(wordIndexAt(TOKENS, 3), 0); // right after `The`
    assert.equal(wordIndexAt(TOKENS, 4), 1); // right before `Pacific`
  });

  it("finds no word between words", () => {
    // Offset 12 sits between the comma and the space - a tap there is a
    // dismissal, not a selection of whatever happens to be nearest.
    assert.equal(wordIndexAt(TOKENS, 12), -1);
    assert.equal(wordIndexAt(TOKENS, 23), -1); // past the final full stop
  });

  it("finds nothing in no words", () => {
    assert.equal(wordIndexAt([], 0), -1);
    assert.equal(wordIndexAt(tokenize("... !!"), 1), -1);
  });

  it("splits a hyphenated word the way the matcher does", () => {
    const tokens = tokenize("e-mail");
    assert.equal(wordIndexAt(tokens, 1), 0); // the edge of `e`
    assert.equal(wordIndexAt(tokens, 2), 1); // the edge of `mail`
  });
});

describe("nearestWordIndex", () => {
  it("answers the word itself when inside one", () => {
    assert.equal(nearestWordIndex(TOKENS, 6), 1);
  });

  it("bridges the gap a dragging finger crosses", () => {
    // Between `Pacific,` and `our`: nearer the comma's side first, nearer
    // `our` past the middle of the gap.
    assert.equal(nearestWordIndex(TOKENS, 12), 1);
    assert.equal(nearestWordIndex(TOKENS, 13), 2);
  });

  it("clamps to the first and last word beyond the text's ends", () => {
    assert.equal(nearestWordIndex(TOKENS, -5), 0);
    assert.equal(nearestWordIndex(TOKENS, TEXT.length + 40), TOKENS.length - 1);
  });

  it("lets the earlier word win a tie, so a resting finger cannot flicker", () => {
    // Two spaces make a gap with a real middle: offset 3 is one character
    // from `ab` and one from `cd`, and the answer has to be one of them for
    // good rather than whichever a later loop iteration felt like.
    const spaced = tokenize("ab  cd");
    assert.equal(nearestWordIndex(spaced, 3), 0);
  });

  it("answers -1 only for no words at all", () => {
    assert.equal(nearestWordIndex([], 7), -1);
    assert.equal(nearestWordIndex(tokenize("?!"), 0), -1);
  });
});

describe("besideSpan", () => {
  const span = { from: 2, to: 4 };

  it("knows a word already selected, edges included", () => {
    assert.equal(besideSpan(span, 2), "within");
    assert.equal(besideSpan(span, 3), "within");
    assert.equal(besideSpan(span, 4), "within");
  });

  it("names the one word a tap may grow the selection by", () => {
    assert.equal(besideSpan(span, 1), "left");
    assert.equal(besideSpan(span, 5), "right");
  });

  it("keeps every farther word a plain tap", () => {
    // A tap is also how a reader dismisses things (D81): only the immediate
    // neighbour reads unambiguously as "this one too".
    assert.equal(besideSpan(span, 0), "apart");
    assert.equal(besideSpan(span, 6), "apart");
    assert.equal(besideSpan(span, -3), "apart");
  });

  it("grows a one-word selection either way", () => {
    const word = { from: 3, to: 3 };
    assert.equal(besideSpan(word, 2), "left");
    assert.equal(besideSpan(word, 3), "within");
    assert.equal(besideSpan(word, 4), "right");
  });

  it("never grows past the first word", () => {
    // The word before index 0 does not exist; the caller sees `apart` for
    // every index below the run, -1 included, and claims nothing.
    assert.equal(besideSpan({ from: 0, to: 1 }, -1), "apart");
  });
});
