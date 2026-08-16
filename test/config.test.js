import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  BUBBLE_SCALE,
  DEFAULTS,
  MEASURE,
  READER_DEFAULTS,
  SIZE,
  TTS_RATE,
  effectiveReaderOnly,
  osFrom,
  platformOs,
  publishPlatform,
  readConfig,
  withDefaults,
  writeConfig,
} from "../src/lib/config.js";

/**
 * Enough of the extension API for the settings module: `storage.local` over a
 * plain object, and the `runtime.id` that `webext()` checks for. The platform
 * answer is optional the way it is in real life - content scripts have no
 * `getPlatformInfo`, and `platformOs` has to survive its absence.
 *
 * @param {Record<string, unknown>} [initial]
 * @param {{ os?: string }} [platform]
 */
function installFakeBrowser(initial = {}, platform = {}) {
  const store = { ...initial };
  const fake = {
    runtime: {
      id: "reread@test",
      ...(platform.os === undefined
        ? {}
        : { getPlatformInfo: async () => ({ os: platform.os }) }),
    },
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

describe("reader-only mode", () => {
  it("answers null for a profile that has never chosen", () => {
    // Null is a state, not a missing boolean: it is what lets the platform
    // keep deciding, on this version and on every future one.
    assert.equal(withDefaults(undefined).readerOnly, null);
    assert.equal(withDefaults({ sourceLang: "en" }).readerOnly, null);
  });

  it("keeps a choice somebody made, in both directions", () => {
    assert.equal(withDefaults({ readerOnly: true }).readerOnly, true);
    assert.equal(withDefaults({ readerOnly: false }).readerOnly, false);
  });

  it("treats a hand-edited value of the wrong type as no choice", () => {
    for (const readerOnly of ["true", 1, null, {}]) {
      assert.equal(withDefaults({ readerOnly }).readerOnly, null);
    }
  });

  it("lets the platform decide only while nobody has chosen", () => {
    assert.equal(effectiveReaderOnly({ readerOnly: null }, "android"), true);
    assert.equal(effectiveReaderOnly({ readerOnly: null }, "mac"), false);
    assert.equal(effectiveReaderOnly({ readerOnly: null }, ""), false);
    // A choice outlives the default - a future version flipping the platform
    // rule must not overrule a switch somebody has set.
    assert.equal(effectiveReaderOnly({ readerOnly: false }, "android"), false);
    assert.equal(effectiveReaderOnly({ readerOnly: true }, "linux"), true);
  });

  it("writes a choice through writeConfig and reads it back as one", async () => {
    const store = installFakeBrowser();
    await writeConfig({ readerOnly: true });
    assert.equal(/** @type {any} */ (store["config"]).readerOnly, true);
    assert.equal((await readConfig()).readerOnly, true);

    // Writing something else must not manufacture a choice along the way.
    const untouched = installFakeBrowser();
    await writeConfig({ sourceLang: "de" });
    assert.equal(/** @type {any} */ (untouched["config"]).readerOnly, null);
    assert.equal((await readConfig()).readerOnly, null);
  });
});

describe("the quiet bubble", () => {
  it("hides the actions by default, on profiles old and new", () => {
    // The switch shipped after 0.2.6, so a stored config without the key is
    // every existing profile - and the redesigned default has to reach them.
    assert.equal(withDefaults(undefined).hideBubbleActions, true);
    assert.equal(withDefaults({ sourceLang: "en" }).hideBubbleActions, true);
  });

  it("keeps a choice somebody made, in both directions", () => {
    assert.equal(withDefaults({ hideBubbleActions: true }).hideBubbleActions, true);
    assert.equal(withDefaults({ hideBubbleActions: false }).hideBubbleActions, false);
  });

  it("treats a hand-edited value of the wrong type as the default", () => {
    for (const hideBubbleActions of ["false", 0, null, {}]) {
      assert.equal(withDefaults({ hideBubbleActions }).hideBubbleActions, true);
    }
  });

  it("writes the choice through writeConfig without touching the rest", async () => {
    const store = installFakeBrowser({ config: { sourceLang: "de", targetLang: "en" } });
    const written = await writeConfig({ hideBubbleActions: false });

    assert.deepEqual(written, { ...DEFAULTS, sourceLang: "de", targetLang: "en", hideBubbleActions: false });
    assert.equal(/** @type {any} */ (store["config"]).hideBubbleActions, false);
  });
});

describe("the bubble scale", () => {
  it("answers 100% for profiles old and new", () => {
    assert.equal(withDefaults(undefined).bubbleScale, 100);
    assert.equal(withDefaults({ sourceLang: "en" }).bubbleScale, 100);
  });

  it("keeps a stored percent and clamps one from outside the scale", () => {
    assert.equal(withDefaults({ bubbleScale: 150 }).bubbleScale, 150);
    assert.equal(withDefaults({ bubbleScale: BUBBLE_SCALE.min }).bubbleScale, BUBBLE_SCALE.min);
    assert.equal(withDefaults({ bubbleScale: BUBBLE_SCALE.max }).bubbleScale, BUBBLE_SCALE.max);
    // Clamped rather than dropped: an out-of-range number still says what
    // somebody wanted - as much of it as this scale has. A factor stored by
    // hand lands on the floor the same way: the scale is percent by contract.
    assert.equal(withDefaults({ bubbleScale: 10 }).bubbleScale, BUBBLE_SCALE.min);
    assert.equal(withDefaults({ bubbleScale: 999 }).bubbleScale, BUBBLE_SCALE.max);
    assert.equal(withDefaults({ bubbleScale: 1.25 }).bubbleScale, BUBBLE_SCALE.min);
  });

  it("treats a hand-edited value of the wrong type as the default", () => {
    for (const bubbleScale of ["150", null, {}, Number.NaN]) {
      assert.equal(withDefaults({ bubbleScale }).bubbleScale, 100);
    }
  });

  it("writes the percent through writeConfig without touching the rest", async () => {
    const store = installFakeBrowser({ config: { sourceLang: "de", targetLang: "en" } });
    const written = await writeConfig({ bubbleScale: 130 });

    assert.deepEqual(written, { ...DEFAULTS, sourceLang: "de", targetLang: "en", bubbleScale: 130 });
    assert.equal(/** @type {any} */ (store["config"]).bubbleScale, 130);
  });
});

describe("the reading speed", () => {
  it("answers the voice's own speed for profiles old and new", () => {
    assert.equal(withDefaults(undefined).ttsRate, 100);
    assert.equal(withDefaults({ sourceLang: "en" }).ttsRate, 100);
  });

  it("keeps a stored percent and clamps one from outside the scale", () => {
    assert.equal(withDefaults({ ttsRate: 70 }).ttsRate, 70);
    assert.equal(withDefaults({ ttsRate: TTS_RATE.min }).ttsRate, TTS_RATE.min);
    assert.equal(withDefaults({ ttsRate: TTS_RATE.max }).ttsRate, TTS_RATE.max);
    assert.equal(withDefaults({ ttsRate: 5 }).ttsRate, TTS_RATE.min);
    assert.equal(withDefaults({ ttsRate: 900 }).ttsRate, TTS_RATE.max);
    // The percent is the contract, so an engine factor stored by hand reads
    // as far too slow rather than as itself - and lands on the floor.
    assert.equal(withDefaults({ ttsRate: 1.5 }).ttsRate, TTS_RATE.min);
  });

  it("treats a hand-edited value of the wrong type as the default", () => {
    for (const ttsRate of ["150", null, {}, Number.NaN]) {
      assert.equal(withDefaults({ ttsRate }).ttsRate, 100);
    }
  });

  it("writes the percent through writeConfig without touching the rest", async () => {
    const store = installFakeBrowser({ config: { sourceLang: "de", targetLang: "en" } });
    const written = await writeConfig({ ttsRate: 80 });

    assert.deepEqual(written, { ...DEFAULTS, sourceLang: "de", targetLang: "en", ttsRate: 80 });
    assert.equal(/** @type {any} */ (store["config"]).ttsRate, 80);
  });
});

describe("the reading voices", () => {
  it("answers an empty map for a profile that predates it", () => {
    assert.deepEqual(withDefaults(undefined).ttsVoices, {});
    assert.deepEqual(withDefaults({ sourceLang: "en" }).ttsVoices, {});
  });

  it("keeps a choice per language", () => {
    assert.deepEqual(withDefaults({ ttsVoices: { en: "urn:alice", pl: "urn:zosia" } }).ttsVoices, {
      en: "urn:alice",
      pl: "urn:zosia",
    });
  });

  it("keeps the entries that map a language to a voice and drops the rest", () => {
    // Losing the whole map over one broken entry would silence a choice made
    // for every other language.
    assert.deepEqual(
      withDefaults({ ttsVoices: { en: "urn:alice", de: 7, fr: "", "": "urn:nobody" } }).ttsVoices,
      { en: "urn:alice" },
    );
  });

  it("treats a map that is not one as empty", () => {
    for (const ttsVoices of ["urn:alice", 7, null, ["urn:alice"]]) {
      assert.deepEqual(withDefaults({ ttsVoices }).ttsVoices, {});
    }
  });

  it("does not hand out a map shared with the defaults", () => {
    const result = withDefaults({});
    result.ttsVoices["en"] = "urn:alice";
    assert.deepEqual(DEFAULTS.ttsVoices, {});
    assert.deepEqual(withDefaults({}).ttsVoices, {});
  });

  it("replaces the whole map on write, so choosing the default removes an entry", async () => {
    const store = installFakeBrowser();
    await writeConfig({ ttsVoices: { en: "urn:alice", de: "urn:karl" } });
    const written = await writeConfig({ ttsVoices: { de: "urn:karl" } });

    // A per-key merge could only ever add - the settings page holds the full
    // map, and what it writes is the whole of what is chosen.
    assert.deepEqual(written.ttsVoices, { de: "urn:karl" });
    assert.deepEqual(/** @type {any} */ (store["config"]).ttsVoices, { de: "urn:karl" });
  });
});

describe("the published platform", () => {
  it("reads the os back and answers unknown for anything else", () => {
    assert.equal(osFrom({ os: "android" }), "android");
    assert.equal(osFrom({ os: "mac" }), "mac");
    // A fresh install's first page can be faster than `onInstalled` - the key
    // simply is not there yet, and unknown has to read as the desktop default.
    for (const stored of [undefined, null, {}, { os: 7 }, "android", 7]) {
      assert.equal(osFrom(stored), "");
    }
  });

  it("publishes what the platform says, where content scripts can read it", async () => {
    const store = installFakeBrowser({}, { os: "android" });
    await publishPlatform();
    assert.deepEqual(store["platform"], { os: "android" });
    assert.equal(osFrom(store["platform"]), "android");
  });

  it("answers unknown where the platform cannot be asked", async () => {
    // A context without `getPlatformInfo` - the call throws, the answer is the
    // desktop default rather than the exception.
    installFakeBrowser();
    assert.equal(await platformOs(), "");
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

  it("keeps links plain on profiles old and new", () => {
    // The switch shipped after 0.2.22, so a stored config without the key is
    // every existing profile - and the reading-first default has to reach them.
    assert.equal(withDefaults(undefined).reader.links, "plain");
    assert.equal(withDefaults({ reader: { theme: "dark" } }).reader.links, "plain");
  });

  it("keeps a choice about links, in both directions", () => {
    assert.equal(withDefaults({ reader: { links: "active" } }).reader.links, "active");
    assert.equal(withDefaults({ reader: { links: "plain" } }).reader.links, "plain");
  });

  it("treats a hand-edited links value it does not know as the default", () => {
    for (const links of ["on", "off", true, false, 7, null, {}]) {
      assert.equal(withDefaults({ reader: { links } }).reader.links, "plain");
    }
  });

  it("switches links without resetting the rest of the appearance", async () => {
    const store = installFakeBrowser();
    await writeConfig({ reader: { fontSize: 22 } });
    const written = await writeConfig({ reader: { links: "active" } });

    assert.deepEqual(written.reader, { ...READER_DEFAULTS, fontSize: 22, links: "active" });
    assert.deepEqual(
      /** @type {any} */ (store["config"]).reader,
      { ...READER_DEFAULTS, fontSize: 22, links: "active" },
    );
  });
});
