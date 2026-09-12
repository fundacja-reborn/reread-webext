import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LINES_OPEN,
  afterPress,
  entryGroups,
  foldPoint,
  isSaved,
  lookupOutcome,
  lookupText,
  ownMeanings,
  paragraphsOf,
  sameMeaning,
} from "../src/lib/lookup.js";
import { MAX_PHRASE_LENGTH } from "../src/lib/store/phrase.js";

/**
 * The look-up field's rules (D197): what a typed word becomes, what the
 * dictionaries' answer becomes on the screen, and what a press on a line
 * does to the phrase. The field itself (`lib/lookup-box.js`) is DOM; its call
 * sites are read in `lookup-box.test.js`.
 */

describe("lookupText", () => {
  it("reduces what was typed to the phrase and its key, as a selection would be", () => {
    // The same two forms the bubble keeps (`trimPhrase`, `normalize`): a word
    // typed here and the same word selected on a page are one phrase.
    assert.deepEqual(lookupText("  Elevation, "), { text: "Elevation", normalized: "elevation" });
    assert.deepEqual(lookupText("take\toff"), { text: "take off", normalized: "take off" });
  });

  it("has nothing to ask about punctuation, spaces or nothing at all", () => {
    assert.equal(lookupText(""), null);
    assert.equal(lookupText("   "), null);
    assert.equal(lookupText("...!?"), null);
  });

  it("refuses what the store would refuse", () => {
    assert.notEqual(lookupText("a".repeat(MAX_PHRASE_LENGTH)), null);
    assert.equal(lookupText("a".repeat(MAX_PHRASE_LENGTH + 1)), null);
  });
});

describe("lookupOutcome", () => {
  const entry = { dictionary: "WikDict", headword: "elevation", senses: ["wysokość", "wzniesienie"] };

  it("shows the entries as the bubble's blocks, with the language they came in", () => {
    const outcome = lookupOutcome({ entries: [entry], dictionaries: 1, lang: "en" }, "elevation");
    assert.equal(outcome.kind, "entries");
    if (outcome.kind !== "entries") return;
    assert.equal(outcome.lang, "en");
    // One book: no dictionary name in the label; the headword is the word
    // typed, so no headword either - the label stays empty (D23).
    assert.deepEqual(outcome.blocks, [{ headword: "", dictionary: "", lines: ["wysokość", "wzniesienie"] }]);
    // And as stored, one for one with the blocks, for the field that reads.
    assert.deepEqual(outcome.entries, [entry]);
  });

  it("names the headword the dictionary answered about when it is not the word typed", () => {
    const outcome = lookupOutcome({ entries: [entry], dictionaries: 1, lang: "en" }, "elevations");
    assert.equal(outcome.kind, "entries");
    if (outcome.kind !== "entries") return;
    assert.equal(outcome.blocks[0]?.headword, "elevation");
  });

  it("tells the two silences apart by the count (D164)", () => {
    assert.deepEqual(lookupOutcome({ entries: [], dictionaries: 0, lang: "en" }, "elevation"), {
      kind: "silence",
      note: "no-dictionary",
      lang: "en",
    });
    assert.deepEqual(lookupOutcome({ entries: [], dictionaries: 2, lang: "en" }, "elevation"), {
      kind: "silence",
      note: "not-in-dictionary",
      lang: "en",
    });
  });

  it("says a fault as a fault - a press answered with nothing would read as a hang", () => {
    assert.deepEqual(lookupOutcome(null, "elevation"), { kind: "fault" });
  });
});

describe("paragraphsOf", () => {
  it("cuts a stored sense at the blank lines the import kept, and nowhere else", () => {
    // The import keeps a section's end as one blank line (dict/text.js,
    // D197); the lines inside a section stay one paragraph.
    assert.deepEqual(paragraphsOf("Noun\nNew information of interest.\n\nVerb\nTo report."), [
      "Noun\nNew information of interest.",
      "Verb\nTo report.",
    ]);
    assert.deepEqual(paragraphsOf("wysokość"), ["wysokość"]);
  });

  it("has no paragraph of nothing", () => {
    assert.deepEqual(paragraphsOf("\n\n a \n\n\n\n b \n\n"), ["a", "b"]);
    assert.deepEqual(paragraphsOf("   "), []);
  });
});

describe("entryGroups", () => {
  it("groups the entries by book, in the answer's order, every group named", () => {
    const groups = entryGroups(
      [
        { dictionary: "WikDict en-pl", headword: "watch", senses: ["zegarek", "oglądać"] },
        { dictionary: "reader.dict", headword: "watch", senses: ["A timepiece.\nTo observe."] },
        // The same book answering under a second headword (a base form) is
        // still one group, its lines counted together.
        { dictionary: "WikDict en-pl", headword: "watches", senses: ["zegarki"] },
      ],
      "watches",
    );
    assert.deepEqual(groups, [
      {
        dictionary: "WikDict en-pl",
        entries: [
          { headword: "watch", lines: ["zegarek", "oglądać"] },
          { headword: "", lines: ["zegarki"] },
        ],
        lines: ["zegarek", "oglądać", "zegarki"],
      },
      {
        dictionary: "reader.dict",
        entries: [{ headword: "watch", lines: ["A timepiece.", "To observe."] }],
        lines: ["A timepiece.", "To observe."],
      },
    ]);
  });

  it("names a lone book too - the name is the fold's own words", () => {
    const [group] = entryGroups([{ dictionary: "WikDict en-pl", headword: "watch", senses: ["zegarek"] }], "watch");
    assert.equal(group?.dictionary, "WikDict en-pl");
    assert.equal(group?.entries[0]?.headword, "");
  });
});

describe("foldPoint", () => {
  const lines = Array.from({ length: LINES_OPEN + 3 }, (_, at) => `line ${at}`);

  it("cuts a long book after the first lines, the rest folded", () => {
    assert.deepEqual(foldPoint(lines, []), { shown: LINES_OPEN, unfolded: false });
    assert.deepEqual(foldPoint(["a", "b"], []), { shown: 2, unfolded: false });
  });

  it("opens the fold by itself when a saved meaning would be out of sight", () => {
    assert.deepEqual(foldPoint(lines, [`line ${LINES_OPEN + 1}`]), { shown: LINES_OPEN, unfolded: true });
    assert.deepEqual(foldPoint(lines, ["line 0"]), { shown: LINES_OPEN, unfolded: false });
  });
});

describe("sameMeaning", () => {
  it("folds whitespace the way the store does on a save, and nothing else (K3)", () => {
    assert.ok(sameMeaning("być omawianym w mediach", "  być omawianym   w mediach "));
    assert.ok(sameMeaning("a\tb", "a b"));
    // Case counts: a German noun and its verb differ by a capital, and a
    // meaning the reader typed is the reader's spelling.
    assert.equal(sameMeaning("Laufen", "laufen"), false);
    assert.equal(sameMeaning("nowina", "nowiny"), false);
  });

  it("finds a line among the saved meanings by the same rule", () => {
    assert.ok(isSaved(["wysokość", "wzniesienie"], "wzniesienie"));
    assert.ok(isSaved(["wysokość"], " wysokość "));
    assert.equal(isSaved(["wysokość"], "Wysokość"), false);
    assert.equal(isSaved([], "wysokość"), false);
  });

  it("keeps under Your own only the meanings no book's line says, in the saved order", () => {
    // A meaning identical to a line stands once, as that line ticked.
    assert.deepEqual(ownMeanings(["☞ nowina", "wysokość", "moje"], ["wysokość", "wzniesienie"]), ["☞ nowina", "moje"]);
    assert.deepEqual(ownMeanings(["wysokość"], ["wysokość"]), []);
    assert.deepEqual(ownMeanings(["moje"], []), ["moje"]);
  });
});

describe("afterPress", () => {
  it("takes a meaning back on the press of the line it came from, whitespace folded or not", () => {
    // Saved from the bubble the line arrives with its whitespace folded;
    // the row's checkbox still has to untick it.
    assert.deepEqual(afterPress(["a b", "c"], "a  b"), { act: "save", meanings: ["c"] });
  });

  it("saves the phrase with the pressed line, after what it already meant (D34)", () => {
    assert.deepEqual(afterPress([], "wysokość"), { act: "save", meanings: ["wysokość"] });
    assert.deepEqual(afterPress(["wysokość"], "wzniesienie"), {
      act: "save",
      meanings: ["wysokość", "wzniesienie"],
    });
  });

  it("takes a pressed line back out", () => {
    assert.deepEqual(afterPress(["wysokość", "wzniesienie"], "wysokość"), {
      act: "save",
      meanings: ["wzniesienie"],
    });
  });

  it("forgets the phrase when the last meaning is taken back", () => {
    // The bubble declines to save an empty gloss and leaves the reader the
    // rest of the bubble; here the line was the reader's only word about the
    // phrase, and a phrase with nothing to mean has nothing to stay for.
    assert.deepEqual(afterPress(["wysokość"], "wysokość"), { act: "forget", meanings: [] });
  });

  it("splits a line the book wrote as several", () => {
    assert.deepEqual(afterPress([], "bank\nbrzeg"), { act: "save", meanings: ["bank", "brzeg"] });
  });
});
