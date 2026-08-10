import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { collapseWhitespace, normalize } from "../src/lib/normalize.js";

// Spelled out by code point: these are the characters the function exists for,
// and a literal one in a test file is a character nobody reviewing it can see.
const NBSP = String.fromCodePoint(0x00a0);
const SOFT_HYPHEN = String.fromCodePoint(0x00ad);
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);
const COMBINING_ACUTE = String.fromCodePoint(0x0301);
const E_ACUTE = String.fromCodePoint(0x00e9);

describe("collapseWhitespace", () => {
  it("keeps the case it was given", () => {
    assert.equal(collapseWhitespace("The Hague"), "The Hague");
  });

  it("turns a selection spanning a line break into one line", () => {
    assert.equal(
      collapseWhitespace("a phrase\n  broken  across\tlines"),
      "a phrase broken across lines",
    );
  });

  it("trims the whitespace a drag-selection picks up at the edges", () => {
    assert.equal(collapseWhitespace("  word  "), "word");
  });

  it("treats a non-breaking space as a space", () => {
    assert.equal(collapseWhitespace(`non${NBSP}breaking`), "non breaking");
  });

  it("drops a soft hyphen left over from justified text", () => {
    assert.equal(collapseWhitespace(`hy${SOFT_HYPHEN}phen`), "hyphen");
  });

  it("drops a zero-width space used as a break opportunity", () => {
    assert.equal(collapseWhitespace(`break${ZERO_WIDTH_SPACE}here`), "breakhere");
  });

  it("composes decomposed characters, so the same word has one form", () => {
    assert.equal(collapseWhitespace(`cafe${COMBINING_ACUTE}`), `caf${E_ACUTE}`);
  });

  it("answers an empty string for a selection of nothing but whitespace", () => {
    assert.equal(collapseWhitespace(" \n\t "), "");
  });
});

describe("normalize", () => {
  it("folds case, so the same word at the start of a sentence is the same word", () => {
    assert.equal(normalize("The Hague"), normalize("the hague"));
  });

  it("agrees with collapseWhitespace on everything else", () => {
    assert.equal(normalize(`  Caf${E_ACUTE}  Noir `), `caf${E_ACUTE} noir`);
  });

  it("does not touch punctuation, which is a known and deliberate limit", () => {
    assert.notEqual(normalize("word,"), normalize("word"));
  });

  it("is idempotent - normalizing a key again returns the key", () => {
    const key = normalize(`  Some${SOFT_HYPHEN} Phrase\n`);
    assert.equal(normalize(key), key);
  });
});
