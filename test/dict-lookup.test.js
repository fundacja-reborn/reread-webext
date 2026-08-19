import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { lookupKeys } from "../src/lib/dict/lookup.js";

/**
 * The pure half of asking the dictionaries (D121): which keys a phrase is
 * asked under, and when it is not a dictionary question at all. The database
 * half (`lookUp` -> `lookupEntries`) lives on IndexedDB and stays with the
 * smoke tests; these are the rules both its callers - the background's
 * translate ride and the reader's quiet bubble - stand on.
 */
describe("lookupKeys", () => {
  it("asks under the normalized phrase first", () => {
    const keys = lookupKeys("  Elevation,  ", "en");
    assert.notEqual(keys, null);
    assert.equal(keys?.[0], "elevation");
  });

  it("answers null for a phrase that normalizes to nothing", () => {
    assert.equal(lookupKeys("", "en"), null);
    assert.equal(lookupKeys("   ", "en"), null);
  });

  it("answers null beyond four words - a sentence, not a headword", () => {
    assert.notEqual(lookupKeys("kick the bucket now", "en"), null);
    assert.equal(lookupKeys("kick the bucket right now", "en"), null);
  });

  it("offers base forms only for a single English word", () => {
    const inflected = lookupKeys("running", "en") ?? [];
    assert.equal(inflected[0], "running");
    // `running` sheds `ing` and the doubled letter - the dictionary has `run`.
    assert.ok(inflected.includes("run"), `expected run among ${inflected.join(", ")}`);

    // A phrase is not conjugated word by word: `takes off` stays as spelled.
    assert.deepEqual(lookupKeys("takes off", "en"), ["takes off"]);
  });

  it("never guesses endings in a language it does not know", () => {
    // Polish inflection is the `.syn` file's business, not a rule's: a wrong
    // guess would find a real entry for a word nobody selected.
    assert.deepEqual(lookupKeys("czytania", "pl"), ["czytania"]);
  });
});
