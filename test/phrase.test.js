import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ErrorCode, fail, ok } from "../src/lib/protocol.js";
import { MAX_PHRASE_LENGTH, buildPhrase, resaved } from "../src/lib/store/phrase.js";

/**
 * @param {Partial<Parameters<typeof buildPhrase>[0]>} overrides
 * @returns {import("../src/lib/protocol.js").Result<import("../src/lib/store/phrase.js").Phrase>}
 */
function build(overrides) {
  return buildPhrase({
    text: "word",
    translations: ["slowo"],
    langFrom: "en",
    langTo: "pl",
    id: "id-1",
    now: 1000,
    ...overrides,
  });
}

describe("buildPhrase", () => {
  it("stores the phrase as it was written and the key case-folded", () => {
    assert.deepEqual(
      build({ text: "The Hague" }),
      ok({
        id: "id-1",
        langFrom: "en",
        langTo: "pl",
        phrase: "The Hague",
        normalized: "the hague",
        translations: ["slowo"],
        createdAt: 1000,
      }),
    );
  });

  it("does not keep the comma a drag-selection caught", () => {
    const built = build({ text: "word," });
    assert.ok(built.ok);
    assert.equal(built.value.phrase, "word");
    assert.equal(built.value.normalized, "word");
  });

  it("leaves punctuation inside a word alone", () => {
    for (const text of ["e-mail", "don't", "U.S.A"]) {
      const built = build({ text });
      assert.ok(built.ok);
      assert.equal(built.value.phrase, text, `should have kept ${text} whole`);
    }
  });

  it("stores meanings without tabs or newlines, which the TSV export cannot escape", () => {
    const built = build({ translations: ["one\ttwo\nthree"] });
    assert.ok(built.ok);
    assert.deepEqual(built.value.translations, ["one two three"]);
  });

  it("drops blank and repeated meanings and keeps the order of the rest", () => {
    const built = build({ translations: ["bank", "   ", "bank", "brzeg"] });
    assert.ok(built.ok);
    assert.deepEqual(built.value.translations, ["bank", "brzeg"]);
  });

  it("refuses a selection that is nothing but punctuation - there is no key to save it under", () => {
    assert.deepEqual(build({ text: "..." }), fail(ErrorCode.INTERNAL));
  });

  it("refuses a phrase with nothing to mean", () => {
    assert.deepEqual(build({ translations: [] }), fail(ErrorCode.INTERNAL));
    assert.deepEqual(build({ translations: ["  "] }), fail(ErrorCode.INTERNAL));
  });

  it("refuses a page sent in place of a phrase", () => {
    assert.deepEqual(build({ text: "x".repeat(MAX_PHRASE_LENGTH + 1) }), fail(ErrorCode.TOO_LONG));
  });

  it("accepts a phrase exactly at the limit", () => {
    const built = build({ text: "x".repeat(MAX_PHRASE_LENGTH) });
    assert.ok(built.ok);
  });
});

describe("resaved", () => {
  it("keeps what identifies the row and takes what the reader just decided", () => {
    /** @type {import("../src/lib/store/phrase.js").Phrase} */
    const existing = {
      id: "id-1",
      langFrom: "en",
      langTo: "pl",
      phrase: "bank",
      normalized: "bank",
      translations: ["bank"],
      createdAt: 1000,
      context: "on the bank of the river",
    };
    const incoming = { ...existing, id: "id-2", createdAt: 2000, phrase: "Bank", translations: ["brzeg"] };

    assert.deepEqual(resaved(existing, incoming), {
      id: "id-1",
      langFrom: "en",
      langTo: "pl",
      phrase: "Bank",
      normalized: "bank",
      translations: ["brzeg"],
      createdAt: 1000,
      context: "on the bank of the river",
    });
  });
});
