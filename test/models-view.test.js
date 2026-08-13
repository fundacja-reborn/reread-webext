import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { dictionaryRows, matchesFilter, orderForDisplay, searchableText, sortByLabel } from "../src/options/models-view.js";

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

describe("dictionaryRows", () => {
  const reading = { sourceLang: "en", targetLang: "pl" };

  /**
   * @param {string} langFrom
   * @param {string} langTo
   * @param {string} [name]
   * @returns {import("../src/lib/dict/store.js").Dictionary}
   */
  function stored(langFrom, langTo, name = `dict ${langFrom}-${langTo}`) {
    return {
      id: name,
      name,
      langFrom,
      langTo,
      entryCount: 1,
      aliasCount: 0,
      bytes: 1,
      addedAt: 1,
      ready: true,
      credit: null,
    };
  }

  /**
   * @param {string} from
   * @param {string} to
   */
  function offered(from, to) {
    return { from, to, url: `https://example.invalid/wikdict-${from}-${to}.zip` };
  }

  it("puts what is stored above the catalogue, and the pair being read on top", () => {
    const rows = dictionaryRows([stored("de", "en")], [offered("ar", "en"), offered("en", "pl")], reading);
    assert.deepEqual(
      rows.map((one) => `${one.from}-${one.to}:${one.installed === null ? "offered" : "stored"}`),
      ["en-pl:offered", "de-en:stored", "ar-en:offered"],
    );
  });

  it("folds away the catalogue row of a pair already answered for", () => {
    const rows = dictionaryRows([stored("en", "pl")], [offered("en", "pl"), offered("de", "en")], reading);
    assert.deepEqual(
      rows.map((one) => `${one.from}-${one.to}:${one.installed === null ? "offered" : "stored"}`),
      ["en-pl:stored", "de-en:offered"],
    );
  });

  it("keeps two stored dictionaries of one pair as two rows", () => {
    const rows = dictionaryRows([stored("en", "pl", "first"), stored("en", "pl", "second")], [offered("en", "pl")], reading);
    assert.deepEqual(
      rows.map((one) => one.installed?.name ?? "offered"),
      ["first", "second"],
    );
  });
});

describe("searchableText", () => {
  it("holds the codes, both spellings of the pair and the names, lowered", () => {
    const text = searchableText(row("en", "pl"));
    for (const needle of ["en", "pl", "enpl", "en-pl", "english", "polish"]) {
      assert.ok(text.includes(needle), `missing ${needle} in ${text}`);
    }
  });

  it("builds the pair itself when a row carries none, as catalogue rows do", () => {
    const text = searchableText({ from: "en", to: "pl" });
    assert.ok(text.includes("enpl"));
    assert.ok(text.includes("en-pl"));
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
