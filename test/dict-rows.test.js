import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toRows } from "../src/lib/dict/rows.js";
import { LIMITS } from "../src/lib/dict/text.js";

/**
 * @param {import("../src/lib/dict/import.js").ParsedEntry[]} entries
 * @param {{ headword: string, target: number }[]} [aliases]
 * @returns {import("../src/lib/dict/import.js").ParsedDictionary}
 */
function parsed(entries, aliases = []) {
  return { name: "Test", credit: null, entries, aliases, skipped: 0 };
}

/**
 * @param {import("../src/lib/dict/rows.js").DictionaryRow[]} rows
 * @param {string} key
 * @returns {import("../src/lib/dict/rows.js").DictionaryRow | undefined}
 */
function at(rows, key) {
  return rows.find((row) => row.key === key);
}

describe("toRows", () => {
  it("keys a word the same way the vocabulary keys a phrase", () => {
    const { rows } = toRows("d1", parsed([{ headword: "Bank", senses: ["brzeg"] }]));
    assert.deepEqual(rows, [{ dictId: "d1", key: "bank", headword: "Bank", senses: ["brzeg"] }]);
  });

  it("merges the entries that normalising brings together", () => {
    const { rows, entryCount } = toRows(
      "d1",
      parsed([
        { headword: "Bank", senses: ["instytucja"] },
        { headword: "bank", senses: ["brzeg"] },
      ]),
    );

    assert.equal(entryCount, 1);
    assert.deepEqual(at(rows, "bank")?.senses, ["instytucja", "brzeg"]);
    // The first spelling wins, because it is the one the dictionary sorted first.
    assert.equal(at(rows, "bank")?.headword, "Bank");
  });

  it("does not let a dictionary that repeats itself repeat itself in the bubble", () => {
    const { rows } = toRows(
      "d1",
      parsed([
        { headword: "bank", senses: ["brzeg"] },
        { headword: "bank", senses: ["brzeg", "instytucja"] },
      ]),
    );
    assert.deepEqual(at(rows, "bank")?.senses, ["brzeg", "instytucja"]);
  });

  it("stops merging at the tenth meaning", () => {
    const many = Array.from({ length: 20 }, (_, index) => ({
      headword: "bank",
      senses: [`znaczenie ${index}`],
    }));
    const { rows } = toRows("d1", parsed(many));
    assert.equal(at(rows, "bank")?.senses.length, LIMITS.senses);
  });

  it("drops a headword that has no key to be found under", () => {
    const { rows, entryCount } = toRows("d1", parsed([{ headword: "---", senses: ["nic"] }]));
    assert.equal(entryCount, 0);
    assert.equal(rows.length, 0);
  });

  it("turns a synonym into a row that points at the word it means", () => {
    const { rows, aliasCount } = toRows(
      "d1",
      parsed([{ headword: "go", senses: ["iść"] }], [{ headword: "went", target: 0 }]),
    );

    assert.equal(aliasCount, 1);
    assert.deepEqual(at(rows, "went"), {
      dictId: "d1",
      key: "went",
      headword: "went",
      senses: [],
      aliasOf: "go",
    });
  });

  it("never lets a synonym shadow a word the dictionary has itself", () => {
    const { rows, aliasCount } = toRows(
      "d1",
      parsed(
        [
          { headword: "go", senses: ["iść"] },
          { headword: "went", senses: ["poszedł"] },
        ],
        [{ headword: "went", target: 0 }],
      ),
    );

    assert.equal(aliasCount, 0);
    assert.deepEqual(at(rows, "went")?.senses, ["poszedł"]);
  });

  it("ignores a synonym pointing at nothing, and one pointing at itself", () => {
    const { rows, aliasCount } = toRows(
      "d1",
      parsed(
        [{ headword: "go", senses: ["iść"] }],
        [
          { headword: "gone", target: 7 },
          { headword: "Go", target: 0 },
        ],
      ),
    );

    assert.equal(aliasCount, 0);
    assert.equal(rows.length, 1);
  });

  it("counts what the text costs, in the bytes it will take up", () => {
    const { bytes } = toRows("d1", parsed([{ headword: "bank", senses: ["ławka"] }]));
    // "bank" twice, as the key and as the headword, plus a meaning whose ł is
    // two bytes where the rest are one.
    assert.equal(bytes, 4 + 4 + 6);
  });

  it("counts a character outside the basic plane once, not twice", () => {
    const { bytes } = toRows("d1", parsed([{ headword: "a", senses: ["😀"] }]));
    assert.equal(bytes, 1 + 1 + 4);
  });
});
