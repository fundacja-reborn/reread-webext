import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAX_SENTENCE_LENGTH, sentenceAround } from "../src/lib/sentence.js";

/**
 * Marks the selection in the text with `[` and `]`, so a case reads as the
 * reader would see it rather than as two numbers.
 *
 * @param {string} marked
 * @returns {string | null}
 */
function around(marked) {
  const start = marked.indexOf("[");
  const end = marked.indexOf("]") - 1;
  const text = marked.replace("[", "").replace("]", "");
  return sentenceAround(text, start, end);
}

describe("sentenceAround", () => {
  it("takes the sentence the selection sits in, and only that one", () => {
    assert.equal(
      around("He sat down. The [bank] of the river was steep. Nobody was there."),
      "The bank of the river was steep.",
    );
  });

  it("starts at the beginning of the text when nothing ends before it", () => {
    assert.equal(around("The [bank] of the river was steep. Then it rained."), "The bank of the river was steep.");
  });

  it("ends at the end of the text when nothing ends after it", () => {
    assert.equal(around("He stopped. The [bank] of the river was steep"), "The bank of the river was steep");
  });

  it("does not break on a decimal point", () => {
    assert.equal(around("The rate fell to 3.5 per [cent] last year."), "The rate fell to 3.5 per cent last year.");
  });

  it("does not break on initials", () => {
    assert.equal(
      around("J. R. R. Tolkien wrote about a [ring] in a hole."),
      "J. R. R. Tolkien wrote about a ring in a hole.",
    );
  });

  it("does not break on an abbreviation followed by a name", () => {
    assert.equal(around("Mr. Smith kept the [ledger] in his desk."), "Mr. Smith kept the ledger in his desk.");
  });

  it("does not break on a lower-case word after the stop", () => {
    assert.equal(around("It cost 40 p. per [sheet] of paper."), "It cost 40 p. per sheet of paper.");
  });

  it("breaks on a question mark and an exclamation mark", () => {
    assert.equal(around("Where is it? The [key] was here!"), "The key was here!");
    assert.equal(around("Stop! The [key] is gone."), "The key is gone.");
  });

  it("breaks on an ellipsis", () => {
    assert.equal(around("He waited… The [door] opened."), "The door opened.");
  });

  it("breaks on a line inside one block", () => {
    assert.equal(around("First line\nThe [second] line"), "The second line");
  });

  it("keeps a full stop that belongs to the selection", () => {
    assert.equal(around("Read [the whole thing. Then] stop."), "Read the whole thing. Then stop.");
  });

  it("says nothing when the selection already is the sentence", () => {
    assert.equal(around("[The bank was steep.]"), null);
    assert.equal(around("He stopped. [The bank was steep.] Then it rained."), null);
  });

  it("says nothing when the selection is the sentence bar its punctuation", () => {
    assert.equal(around("[The bank was steep]."), null);
  });

  it("says nothing when what is around the selection is not a sentence", () => {
    const long = `${"word ".repeat(MAX_SENTENCE_LENGTH)}here.`;
    assert.equal(sentenceAround(long, 0, 4), null);
  });

  it("says nothing about offsets that make no sense", () => {
    assert.equal(sentenceAround("The bank was steep.", 5, 5), null);
    assert.equal(sentenceAround("The bank was steep.", -1, 4), null);
    assert.equal(sentenceAround("The bank was steep.", 4, 100), null);
    assert.equal(sentenceAround("The bank was steep.", 1.5, 4), null);
    assert.equal(sentenceAround("", 0, 0), null);
  });

  it("trims the whitespace a block leaves around its text", () => {
    assert.equal(around("  \n  The [bank] was steep.   "), "The bank was steep.");
  });

  it("works in Polish, where the abbreviations are lower-case", () => {
    assert.equal(
      around("Kupił chleb, mleko itd. Potem [wrócił] do domu. Było ciemno."),
      "Potem wrócił do domu.",
    );
    assert.equal(around("Zebranie o godz. 15 w [sali] numer 3."), "Zebranie o godz. 15 w sali numer 3.");
  });

  it("does not break inside a domain or a file name", () => {
    assert.equal(around("Read it on example.com before the [meeting] starts."), "Read it on example.com before the meeting starts.");
  });
});
