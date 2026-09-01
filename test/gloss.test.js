import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { afterChoosing, choosableLines, entryBlocks, filingWarning, quietNote, toMeanings } from "../src/lib/gloss.js";

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

describe("choosableLines", () => {
  it("leaves an entry that already had a meaning per sense alone", () => {
    assert.deepEqual(choosableLines(["bank (instytucja)", "brzeg"]), ["bank (instytucja)", "brzeg"]);
  });

  it("breaks up the one field a dictionary packed a whole entry into", () => {
    // WikDict's `nominate`, shortened. Pressed whole it made a four-line gloss
    // with a phonetic transcription in it; the reader wanted the last line.
    assert.deepEqual(
      choosableLines(["/ˈnɑ.mə.neɪt/, /ˈnɒm.ɪ.neɪt/\nverb\nto name someone for a particular role\nnominować"]),
      ["/ˈnɑ.mə.neɪt/, /ˈnɒm.ɪ.neɪt/", "verb", "to name someone for a particular role", "nominować"],
    );
  });

  it("gives every row something that can stand alone as a meaning", () => {
    // What the bubble is promised: press any row and exactly one meaning is
    // saved, never a row that would turn back into two.
    const rows = choosableLines(["a\nb\nc", "d", "  \ne  "]);
    for (const row of rows) assert.equal(toMeanings(row).length, 1);
    assert.deepEqual(rows, ["a", "b", "c", "d", "e"]);
  });

  it("has nothing to offer for an entry with nothing in it", () => {
    assert.deepEqual(choosableLines([]), []);
    assert.deepEqual(choosableLines(["", "   "]), []);
  });
});

describe("afterChoosing", () => {
  it("adds the pressed line under what the engine said", () => {
    assert.equal(afterChoosing("Wystąpienie", "okazja"), "Wystąpienie\nokazja");
  });

  it("collects several meanings in the order they were pressed", () => {
    assert.equal(afterChoosing("Wystąpienie\nokazja", "zjawisko"), "Wystąpienie\nokazja\nzjawisko");
  });

  it("takes a meaning back out when its line is pressed again", () => {
    assert.equal(afterChoosing("Wystąpienie\nokazja\nzjawisko", "okazja"), "Wystąpienie\nzjawisko");
  });

  it("leaves the rest alone when one of several goes", () => {
    assert.equal(afterChoosing("Wystąpienie\nokazja", "Wystąpienie"), "okazja");
  });

  it("adds to a gloss the reader has edited by hand", () => {
    assert.equal(afterChoosing("brzeg rzeki", "bank (instytucja)"), "brzeg rzeki\nbank (instytucja)");
  });

  it("does not keep the same meaning twice", () => {
    // The line is already in - pressing it means taking it out, which is what
    // the mark under it says. The engine and the dictionary agreeing is exactly
    // when this happens.
    assert.equal(afterChoosing("wydarzenie\nokazja", "wydarzenie"), "okazja");
  });

  it("gives nothing back rather than an empty gloss", () => {
    // The bubble declines this press: a phrase with no meaning has nothing to
    // save, and there is no state in which the last line may go.
    assert.equal(afterChoosing("okazja", "okazja"), "");
  });
});

describe("entryBlocks", () => {
  /**
   * @param {string} dictionary
   * @param {string} headword
   * @returns {import("../src/lib/protocol.js").DictEntry}
   */
  const entry = (dictionary, headword) => ({ dictionary, headword, senses: ["a meaning"] });

  it("prints neither half when the entry only repeats the page back", () => {
    // One book, and it found exactly what was selected: a label would say
    // nothing the page and the list do not already say.
    const [block] = entryBlocks([entry("WikDict", "watch")], "watch");
    assert.deepEqual(block, { headword: "", dictionary: "", lines: ["a meaning"] });
  });

  it("names the found form when it is not what was selected", () => {
    // The selection was "watches", the book knows "watch" - the label has to
    // say which word the definition is of. The comparison runs through the
    // key, so a difference of case or accent alone stays quiet.
    const [inflected] = entryBlocks([entry("WikDict", "watch")], "watches");
    assert.equal(inflected?.headword, "watch");
    const [cased] = entryBlocks([entry("WikDict", "Watch")], "watch");
    assert.equal(cased?.headword, "");
  });

  it("names the book only when there are books to tell apart", () => {
    const alone = entryBlocks([entry("WikDict", "watch")], "watch");
    assert.equal(alone[0]?.dictionary, "");

    const crowd = entryBlocks([entry("WikDict", "watch"), entry("PONS", "watch")], "watch");
    assert.deepEqual(
      crowd.map((block) => block.dictionary),
      ["WikDict", "PONS"],
    );
  });

  it("splits an entry's senses into one line per meaning", () => {
    const [block] = entryBlocks(
      [{ dictionary: "WikDict", headword: "watch", senses: ["verb\nobserwować", "zegarek"] }],
      "watch",
    );
    assert.deepEqual(block?.lines, ["verb", "obserwować", "zegarek"]);
  });
});

describe("quietNote", () => {
  it("says nothing while there are entries to show", () => {
    assert.equal(quietNote({ entries: 2, dictionaries: 1, findable: true }), null);
    assert.equal(quietNote({ entries: 1, dictionaries: 1, findable: false }), null);
  });

  it("names the missing dictionary first, then the gesture, then the miss", () => {
    // Michał's screenshot (2026-09-01): a fragment of a word, model off, and
    // the bubble stood on two icons and no word. The missing dictionary
    // outranks the gesture - it is the one state that outlasts this phrase.
    assert.equal(quietNote({ entries: 0, dictionaries: 0, findable: true }), "no-dictionary");
    assert.equal(quietNote({ entries: 0, dictionaries: 0, findable: false }), "no-dictionary");
    assert.equal(quietNote({ entries: 0, dictionaries: 1, findable: false }), "whole-words");
    assert.equal(quietNote({ entries: 0, dictionaries: 3, findable: true }), "not-in-dictionary");
  });
});

describe("filingWarning", () => {
  it("warns only where the page's language and a dictionary of it agree (D167)", () => {
    // Michał's rule: lang=pl on the page and the word found in a Polish
    // book - then Save filing under en -> pl is worth a sentence.
    assert.equal(filingWarning({ entries: 2, findable: true, reading: "pl", pairFrom: "en" }), true);
    // One signal alone cries wolf: nothing found in Polish books may mean an
    // English quote on a Polish page, where en -> pl is the right shelf.
    assert.equal(filingWarning({ entries: 0, findable: true, reading: "pl", pairFrom: "en" }), false);
    // Same language, no mismatch to speak of.
    assert.equal(filingWarning({ entries: 2, findable: true, reading: "en", pairFrom: "en" }), false);
    // No Save on offer, nothing to warn about.
    assert.equal(filingWarning({ entries: 2, findable: false, reading: "pl", pairFrom: "en" }), false);
    // Nobody named a language on either side.
    assert.equal(filingWarning({ entries: 2, findable: true, reading: "", pairFrom: "en" }), false);
    assert.equal(filingWarning({ entries: 2, findable: true, reading: "pl", pairFrom: "" }), false);
  });
});
