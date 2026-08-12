import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { matchesFilter, orderForDisplay, searchableText, sortByLabel } from "../src/options/models-view.js";

/**
 * @param {string} from
 * @param {string} to
 * @param {{ installed?: boolean }} [state]
 * @returns {import("../src/lib/models/registry.js").ModelRow}
 */
function row(from, to, { installed = false } = {}) {
  return {
    pair: `${from}${to}`,
    from,
    to,
    installed: installed ? { pair: `${from}${to}`, from, to, bytes: 1, addedAt: 1 } : null,
    available: null,
  };
}

describe("orderForDisplay", () => {
  const reading = { sourceLang: "en", targetLang: "pl" };

  it("puts the pair being read first, even when it is not installed", () => {
    const rows = orderForDisplay([row("ar", "en"), row("en", "pl")], reading);
    assert.deepEqual(
      rows.map((one) => one.pair),
      ["enpl", "aren"],
    );
  });

  it("puts installed pairs above the rest of the catalogue", () => {
    const rows = orderForDisplay([row("ar", "en"), row("uk", "en", { installed: true }), row("en", "pl")], reading);
    assert.deepEqual(
      rows.map((one) => one.pair),
      ["enpl", "uken", "aren"],
    );
  });

  it("orders each group by the name on screen, not the code behind it", () => {
    // By code German (de) comes before Basque (eu); on screen the names are
    // the other way around, and the screen is what is being sorted.
    const rows = orderForDisplay([row("de", "en"), row("eu", "en")], { sourceLang: "xx", targetLang: "yy" });
    assert.deepEqual(
      rows.map((one) => one.pair),
      ["euen", "deen"],
    );
  });
});

describe("sortByLabel", () => {
  it("sorts by name alone, with no tier for what is installed", () => {
    const rows = sortByLabel([row("de", "en", { installed: true }), row("eu", "en")]);
    assert.deepEqual(
      rows.map((one) => one.pair),
      ["euen", "deen"],
    );
  });

  it("leaves the rows it was given alone", () => {
    const given = [row("de", "en"), row("eu", "en")];
    sortByLabel(given);
    assert.deepEqual(
      given.map((one) => one.pair),
      ["deen", "euen"],
    );
  });
});

describe("searchableText", () => {
  it("holds the codes, the pair and the names, lowered", () => {
    const text = searchableText(row("en", "pl"));
    for (const needle of ["en", "pl", "enpl", "english", "polish"]) {
      assert.ok(text.includes(needle), `missing ${needle} in ${text}`);
    }
  });
});

describe("matchesFilter", () => {
  const text = searchableText(row("en", "pl"));

  it("matches everything on an empty or blank query", () => {
    assert.ok(matchesFilter(text, ""));
    assert.ok(matchesFilter(text, "   "));
  });

  it("needs every word, in any order and any case", () => {
    assert.ok(matchesFilter(text, "English pol"));
    assert.ok(matchesFilter(text, "pol english"));
    assert.ok(!matchesFilter(text, "english german"));
  });

  it("finds a pair by bare code", () => {
    assert.ok(matchesFilter(text, "pl"));
    assert.ok(!matchesFilter(text, "de"));
  });
});
