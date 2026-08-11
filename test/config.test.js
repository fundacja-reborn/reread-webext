import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  DEFAULTS,
  MEASURE,
  READER_DEFAULTS,
  SIZE,
  readConfig,
  withDefaults,
  writeConfig,
} from "../src/lib/config.js";

/**
 * Enough of the extension API for the settings module: `storage.local` over a
 * plain object, and the `runtime.id` that `webext()` checks for.
 *
 * @param {Record<string, unknown>} [initial]
 */
function installFakeBrowser(initial = {}) {
  const store = { ...initial };
  const fake = {
    runtime: { id: "reread@test" },
    storage: {
      local: {
        /** @param {string} key */
        async get(key) {
          return key in store ? { [key]: store[key] } : {};
        },
        /** @param {Record<string, unknown>} items */
        async set(items) {
          Object.assign(store, items);
        },
      },
    },
  };
  // The fake is deliberately partial - it holds what config.js touches and
  // nothing else, so a module reaching further fails here instead of in Firefox.
  globalThis.browser = /** @type {any} */ (fake);
  return store;
}

afterEach(() => {
  globalThis.browser = undefined;
});

describe("withDefaults", () => {
  it("answers the defaults for a profile that has never stored anything", () => {
    assert.deepEqual(withDefaults(undefined), DEFAULTS);
    assert.deepEqual(withDefaults(null), DEFAULTS);
    assert.deepEqual(withDefaults({}), DEFAULTS);
  });

  it("keeps stored values", () => {
    assert.deepEqual(withDefaults({ sourceLang: "de", targetLang: "pl" }), {
      ...DEFAULTS,
      sourceLang: "de",
      targetLang: "pl",
    });
  });

  it("fills in only what is missing", () => {
    assert.deepEqual(withDefaults({ sourceLang: "de" }), { ...DEFAULTS, sourceLang: "de" });
  });

  it("falls back for a hand-edited value of the wrong type or empty", () => {
    assert.deepEqual(withDefaults({ sourceLang: 7, targetLang: "" }), DEFAULTS);
  });

  it("drops keys it does not know, so a downgrade cannot resurrect them", () => {
    const result = withDefaults({ sourceLang: "de", experimentalMode: true });
    assert.deepEqual(Object.keys(result).sort(), Object.keys(DEFAULTS).sort());
  });

  it("does not hand out the frozen defaults object", () => {
    const result = withDefaults({});
    assert.notEqual(result, DEFAULTS);
    result.sourceLang = "de";
    assert.equal(DEFAULTS.sourceLang, "en");
  });
});

describe("readConfig", () => {
  it("answers a complete config when storage is empty", async () => {
    installFakeBrowser();
    assert.deepEqual(await readConfig(), DEFAULTS);
  });

  it("answers what was stored", async () => {
    installFakeBrowser({ config: { sourceLang: "de", targetLang: "en" } });
    assert.deepEqual(await readConfig(), { ...DEFAULTS, sourceLang: "de", targetLang: "en" });
  });
});

describe("writeConfig", () => {
  it("merges a patch into what is there and answers the result", async () => {
    const store = installFakeBrowser({ config: { sourceLang: "de", targetLang: "en" } });
    const written = await writeConfig({ targetLang: "pl" });

    assert.deepEqual(written, { ...DEFAULTS, sourceLang: "de", targetLang: "pl" });
    assert.deepEqual(store["config"], { ...DEFAULTS, sourceLang: "de", targetLang: "pl" });
  });

  it("stores a complete object even when the patch is partial", async () => {
    const store = installFakeBrowser();
    await writeConfig({ sourceLang: "fr" });

    assert.deepEqual(store["config"], { ...DEFAULTS, sourceLang: "fr" });
  });

  it("changes one part of the reader's appearance without resetting the others", async () => {
    const store = installFakeBrowser();
    await writeConfig({ reader: { fontSize: 22 } });
    const written = await writeConfig({ reader: { theme: "sepia" } });

    // The buttons in the reader change one thing at a time, and the second
    // press must not undo the first.
    assert.deepEqual(written.reader, { ...READER_DEFAULTS, fontSize: 22, theme: "sepia" });
    assert.deepEqual(
      /** @type {any} */ (store["config"]).reader,
      { ...READER_DEFAULTS, fontSize: 22, theme: "sepia" },
    );
  });
});

describe("switched-off sites", () => {
  it("answers an empty list for a profile that predates the switch", () => {
    assert.deepEqual(withDefaults({ sourceLang: "en" }).disabledHosts, []);
  });

  it("keeps stored hostnames in their order", () => {
    assert.deepEqual(withDefaults({ disabledHosts: ["docs.google.com", "example.test"] }).disabledHosts, [
      "docs.google.com",
      "example.test",
    ]);
  });

  it("keeps the hostnames and drops whatever hand-editing left between them", () => {
    // Losing the whole list over one broken entry would switch re/read back on
    // everywhere somebody had switched it off.
    assert.deepEqual(
      withDefaults({ disabledHosts: ["a.test", 7, "", null, "b.test", ["c.test"]] }).disabledHosts,
      ["a.test", "b.test"],
    );
  });

  it("folds a duplicate entry, so no writer has to check first", () => {
    assert.deepEqual(withDefaults({ disabledHosts: ["a.test", "b.test", "a.test"] }).disabledHosts, [
      "a.test",
      "b.test",
    ]);
  });

  it("treats a list that is not one as empty", () => {
    for (const disabledHosts of ["a.test", 7, null, {}]) {
      assert.deepEqual(withDefaults({ disabledHosts }).disabledHosts, []);
    }
  });

  it("does not hand out an array shared with the defaults", () => {
    const result = withDefaults({});
    result.disabledHosts.push("a.test");
    assert.deepEqual(DEFAULTS.disabledHosts, []);
    assert.deepEqual(withDefaults({}).disabledHosts, []);
  });

  it("writes the list through writeConfig without touching the rest", async () => {
    const store = installFakeBrowser({ config: { sourceLang: "de", targetLang: "en" } });
    const written = await writeConfig({ disabledHosts: ["a.test"] });

    assert.deepEqual(written, { ...DEFAULTS, sourceLang: "de", targetLang: "en", disabledHosts: ["a.test"] });
    assert.deepEqual(/** @type {any} */ (store["config"]).disabledHosts, ["a.test"]);

    // The next patch replaces the list and only the list.
    const emptied = await writeConfig({ disabledHosts: [] });
    assert.deepEqual(emptied, { ...DEFAULTS, sourceLang: "de", targetLang: "en" });
  });
});

describe("the reader's appearance", () => {
  it("answers the defaults for a profile that predates it", () => {
    // The one real migration: a config stored before this existed has no
    // `reader` key at all, and the day it is read has to be uneventful.
    assert.deepEqual(withDefaults({ sourceLang: "en", targetLang: "pl" }).reader, READER_DEFAULTS);
  });

  it("keeps a theme and a font it knows", () => {
    for (const theme of ["auto", "light", "sepia", "dark"]) {
      assert.equal(withDefaults({ reader: { theme } }).reader.theme, theme);
    }
    assert.equal(withDefaults({ reader: { font: "sans" } }).reader.font, "sans");
  });

  it("falls back for a theme or font it does not know", () => {
    assert.equal(withDefaults({ reader: { theme: "solarized" } }).reader.theme, "auto");
    assert.equal(withDefaults({ reader: { font: 7 } }).reader.font, "serif");
    assert.deepEqual(withDefaults({ reader: "large" }).reader, READER_DEFAULTS);
  });

  it("clamps a size or a width out of range instead of forgetting it", () => {
    // A value from a future version with a wider scale said what somebody
    // wanted; the default would not.
    assert.equal(withDefaults({ reader: { fontSize: 200 } }).reader.fontSize, SIZE.max);
    assert.equal(withDefaults({ reader: { fontSize: 2 } }).reader.fontSize, SIZE.min);
    assert.equal(withDefaults({ reader: { measure: 900 } }).reader.measure, MEASURE.max);
    assert.equal(withDefaults({ reader: { measure: 1 } }).reader.measure, MEASURE.min);
  });

  it("takes the default for a size that is not a number", () => {
    for (const fontSize of ["18", null, NaN, Infinity, {}]) {
      assert.equal(withDefaults({ reader: { fontSize } }).reader.fontSize, READER_DEFAULTS.fontSize);
    }
  });

  it("rounds a fractional size, because the buttons only ever produce whole ones", () => {
    assert.equal(withDefaults({ reader: { fontSize: 18.6 } }).reader.fontSize, 19);
  });

  it("drops reader keys it does not know", () => {
    const result = withDefaults({ reader: { theme: "dark", lineHeight: 3 } });
    assert.deepEqual(Object.keys(result.reader).sort(), Object.keys(READER_DEFAULTS).sort());
  });
});
