import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { DEFAULTS, readConfig, withDefaults, writeConfig } from "../src/lib/config.js";

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
      sourceLang: "de",
      targetLang: "pl",
    });
  });

  it("fills in only what is missing", () => {
    assert.deepEqual(withDefaults({ sourceLang: "de" }), {
      sourceLang: "de",
      targetLang: DEFAULTS.targetLang,
    });
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
    assert.deepEqual(await readConfig(), { sourceLang: "de", targetLang: "en" });
  });
});

describe("writeConfig", () => {
  it("merges a patch into what is there and answers the result", async () => {
    const store = installFakeBrowser({ config: { sourceLang: "de", targetLang: "en" } });
    const written = await writeConfig({ targetLang: "pl" });

    assert.deepEqual(written, { sourceLang: "de", targetLang: "pl" });
    assert.deepEqual(store["config"], { sourceLang: "de", targetLang: "pl" });
  });

  it("stores a complete object even when the patch is partial", async () => {
    const store = installFakeBrowser();
    await writeConfig({ sourceLang: "fr" });

    assert.deepEqual(store["config"], { sourceLang: "fr", targetLang: DEFAULTS.targetLang });
  });
});
