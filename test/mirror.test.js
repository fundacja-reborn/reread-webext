import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { withDefaults } from "../src/lib/config.js";
import { asMirror, mirrorMatches, mirrorOf } from "../src/lib/store/mirror.js";

// Through `withDefaults` rather than written out: the mirror cares about the
// language pair and nothing else, and it should not need editing every time
// some other setting is added.
const CONFIG = withDefaults({ sourceLang: "en", targetLang: "pl" });

/**
 * @param {string} normalized
 * @param {string[]} translations
 * @returns {import("../src/lib/store/phrase.js").Phrase}
 */
function phrase(normalized, translations) {
  return {
    id: `id-${normalized}`,
    langFrom: "en",
    langTo: "pl",
    phrase: normalized,
    normalized,
    translations,
    createdAt: 1000,
  };
}

describe("mirrorOf", () => {
  it("carries the pair it was built for and nothing a page has no use for", () => {
    assert.deepEqual(mirrorOf(CONFIG, [phrase("bank", ["bank", "brzeg"])]), {
      from: "en",
      to: "pl",
      entries: [["bank", ["bank", "brzeg"]]],
    });
  });

  it("is empty rather than absent when the vocabulary is empty", () => {
    assert.deepEqual(mirrorOf(CONFIG, []), { from: "en", to: "pl", entries: [] });
  });

  it("mirrors an unchosen pair as the empty pair", () => {
    assert.deepEqual(mirrorOf({ ...CONFIG, sourceLang: null, targetLang: null }, []), {
      from: "",
      to: "",
      entries: [],
    });
  });
});

describe("mirrorMatches", () => {
  it("says yes only for the pair being read", () => {
    assert.equal(mirrorMatches({ from: "en", to: "pl", entries: [] }, CONFIG), true);
    assert.equal(mirrorMatches({ from: "pl", to: "en", entries: [] }, CONFIG), false);
    assert.equal(mirrorMatches({ from: "en", to: "de", entries: [] }, CONFIG), false);
  });

  it("matches the empty mirror to the unchosen pair - a fresh install must go quiet, not ask", () => {
    const none = { ...CONFIG, sourceLang: null, targetLang: null };
    assert.equal(mirrorMatches({ from: "", to: "", entries: [] }, none), true);
    // A mirror left behind by a chosen pair does not match the pairless
    // settings - and the pairless mirror answers no chosen pair.
    assert.equal(mirrorMatches({ from: "en", to: "pl", entries: [] }, none), false);
    assert.equal(mirrorMatches({ from: "", to: "", entries: [] }, CONFIG), false);
  });
});

describe("asMirror", () => {
  it("accepts what the background writes", () => {
    const mirror = mirrorOf(CONFIG, [phrase("word", ["slowo"])]);
    assert.deepEqual(asMirror(mirror), mirror);
  });

  it("answers nothing at all for a shape that is not a mirror", () => {
    for (const stored of [undefined, null, 7, "vocabIndex", [], {}, { from: "en", to: "pl" }, { from: 1, to: 2, entries: [] }]) {
      assert.equal(asMirror(stored), null, `should have rejected ${JSON.stringify(stored) ?? "undefined"}`);
    }
  });

  it("drops the rows that make no sense and keeps the ones that do", () => {
    const mirror = asMirror({
      from: "en",
      to: "pl",
      entries: [
        ["good", ["dobry"]],
        ["missing meanings", []],
        ["wrong meanings", "dobry"],
        [42, ["dobry"]],
        ["", ["dobry"]],
        ["too short"],
        "not a row",
        ["mixed", ["kept", 7, ""]],
      ],
    });

    assert.deepEqual(mirror, {
      from: "en",
      to: "pl",
      entries: [
        ["good", ["dobry"]],
        ["mixed", ["kept"]],
      ],
    });
  });
});
