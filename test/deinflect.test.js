import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { baseForms } from "../src/lib/dict/deinflect.js";

/**
 * @param {string} word
 * @param {string} form
 */
function offers(word, form) {
  assert.ok(baseForms(word).includes(form), `${word} should offer ${form}, got ${baseForms(word).join(", ")}`);
}

describe("baseForms", () => {
  it("undoes a plural", () => {
    offers("cats", "cat");
    offers("boxes", "box");
    offers("flies", "fly");
    offers("knives", "knife");
    offers("wolves", "wolf");
  });

  it("undoes a past tense and an -ing", () => {
    offers("walked", "walk");
    offers("moved", "move");
    offers("tried", "try");
    offers("walking", "walk");
    offers("making", "make");
  });

  it("undoes the letter a verb doubles before its ending", () => {
    offers("stopped", "stop");
    offers("running", "run");
    // And still offers the plain strip, because `calling` is `call`.
    offers("calling", "call");
  });

  it("undoes comparatives and an adverb", () => {
    offers("larger", "large");
    offers("happier", "happy");
    offers("happiest", "happy");
    offers("quickly", "quick");
  });

  it("undoes a possessive, with either apostrophe", () => {
    offers("dog's", "dog");
    offers(`dog${String.fromCodePoint(0x2019)}s`, "dog");
  });

  it("never offers the word it was given", () => {
    for (const word of ["bank", "watch", "cats", "running"]) {
      assert.ok(!baseForms(word).includes(word));
    }
  });

  it("says nothing about a word too short to have an ending", () => {
    assert.deepEqual(baseForms("a"), []);
    assert.deepEqual(baseForms(""), []);
  });

  it("offers no form shorter than two letters", () => {
    for (const form of baseForms("as")) assert.ok(form.length >= 2);
  });

  /**
   * Over-generating is the cheap direction: a form that is not a word finds
   * nothing in the dictionary, while a form we never think of is a word the
   * reader is told nothing about. `bus` suggesting `bu` costs one point read.
   */
  it("guesses wrong rather than not at all", () => {
    offers("bus", "bu");
  });

  it("has nothing to say about an irregular verb, which is the .syn file's job", () => {
    assert.ok(!baseForms("went").includes("go"));
  });
});
