import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  BUBBLE_SCALE,
  DEFAULTS,
  MEASURE,
  READER_DEFAULTS,
  SIZE,
  TTS_RATE,
  chosenPair,
  effectiveLibraryCopy,
  effectiveReaderOnly,
  osFrom,
  pageMode,
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

describe("chosenPair", () => {
  it("answers the chosen pair, and null while nobody has chosen", () => {
    assert.deepEqual(chosenPair({ sourceLang: "de", targetLang: "pl" }), {
      from: "de",
      to: "pl",
    });
    assert.equal(chosenPair({ sourceLang: null, targetLang: null }), null);
    assert.equal(chosenPair(DEFAULTS), null);
  });
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
    assert.deepEqual(withDefaults({ ttsRate: 150 }), { ...DEFAULTS, ttsRate: 150 });
  });

  it("only ever keeps the pair whole - half a pair is no choice", () => {
    assert.deepEqual(withDefaults({ sourceLang: "de" }), DEFAULTS);
    assert.deepEqual(withDefaults({ targetLang: "pl" }), DEFAULTS);
    assert.deepEqual(withDefaults({ sourceLang: "de", targetLang: 7 }), DEFAULTS);
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
    assert.equal(DEFAULTS.sourceLang, null);
  });

  it("keeps a known marker colour and heals anything else to yellow", () => {
    assert.equal(withDefaults({ reader: { markerColor: "pink" } }).reader.markerColor, "pink");
    // A colour the stylesheet does not dress would paint invisibly - a
    // hand-edited value falls back rather than reaching the registry.
    assert.equal(withDefaults({ reader: { markerColor: "mauve" } }).reader.markerColor, "yellow");
    assert.equal(withDefaults({ reader: {} }).reader.markerColor, "yellow");
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
    await writeConfig({ ttsRate: 150 });

    assert.deepEqual(store["config"], { ...DEFAULTS, ttsRate: 150 });
  });

  it("half a pair patched over no pair stays no pair", async () => {
    // Every real writer sends the pair whole; a half that slips through must
    // not become a choice - and must not resurrect a default nobody picked.
    const store = installFakeBrowser();
    await writeConfig({ sourceLang: "fr" });

    assert.deepEqual(store["config"], DEFAULTS);
  });

  it("half a pair patched over a chosen pair moves that half", async () => {
    const store = installFakeBrowser();
    await writeConfig({ sourceLang: "de", targetLang: "pl" });
    await writeConfig({ sourceLang: "fr" });

    assert.deepEqual(store["config"], { ...DEFAULTS, sourceLang: "fr", targetLang: "pl" });
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
    // Michal's ask (2026-08-25): iOS reads like Android - the system
    // selection bar and the bubble fight over the same spot. Both Apple
    // names, because getPlatformInfo's answer on an iPad is undocumented.
    assert.equal(effectiveReaderOnly({ readerOnly: null }, "ios"), true);
    assert.equal(effectiveReaderOnly({ readerOnly: null }, "ipados"), true);
    assert.equal(effectiveReaderOnly({ readerOnly: null }, "mac"), false);
    assert.equal(effectiveReaderOnly({ readerOnly: null }, ""), false);
    // A choice outlives the default - a future version flipping the platform
    // rule must not overrule a switch somebody has set.
    assert.equal(effectiveReaderOnly({ readerOnly: false }, "android"), false);
    assert.equal(effectiveReaderOnly({ readerOnly: false }, "ios"), false);
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

describe("translation switched off", () => {
  it("is off-off by default, on profiles old and new", () => {
    // The switch shipped after 0.4.22, so a stored config without the key is
    // every existing profile - and translation has to keep working for them.
    assert.equal(withDefaults(undefined).translationOff, false);
    assert.equal(withDefaults({ sourceLang: "en" }).translationOff, false);
  });

  it("keeps a choice somebody made, in both directions", () => {
    assert.equal(withDefaults({ translationOff: true }).translationOff, true);
    assert.equal(withDefaults({ translationOff: false }).translationOff, false);
  });

  it("treats a hand-edited value of the wrong type as translation on", () => {
    for (const translationOff of ["true", 1, null, {}]) {
      assert.equal(withDefaults({ translationOff }).translationOff, false);
    }
  });

  it("writes the choice through writeConfig without touching the rest", async () => {
    const store = installFakeBrowser({ config: { sourceLang: "de", targetLang: "en" } });
    const written = await writeConfig({ translationOff: true });

    assert.deepEqual(written, { ...DEFAULTS, sourceLang: "de", targetLang: "en", translationOff: true });
    assert.equal(/** @type {any} */ (store["config"]).translationOff, true);
  });
});

describe("pageMode", () => {
  const base = { disabledHosts: [], readerOnly: null, translationOff: false };

  it("reads by default on the desk, launches by default on Android", () => {
    assert.equal(pageMode(base, "mac", "example.org"), "reading");
    assert.equal(pageMode(base, "android", "example.org"), "launcher");
  });

  it("silences a switched-off site whatever else is set", () => {
    const off = { ...base, disabledHosts: ["example.org"] };
    assert.equal(pageMode(off, "mac", "example.org"), "off");
    assert.equal(pageMode({ ...off, translationOff: true }, "mac", "example.org"), "off");
    assert.equal(pageMode({ ...off, readerOnly: true }, "android", "example.org"), "off");
    // The switch names one exact host, and no other host inherits it.
    assert.equal(pageMode(off, "mac", "www.example.org"), "reading");
  });

  it("only ever launches with translation off - the reader-only choice has no say", () => {
    const off = { ...base, translationOff: true };
    assert.equal(pageMode(off, "mac", "example.org"), "launcher");
    // Reader-only explicitly off would mean reading - but reading is a
    // translation in place, and there is none to offer (D120).
    assert.equal(pageMode({ ...off, readerOnly: false }, "mac", "example.org"), "launcher");
    assert.equal(pageMode({ ...off, readerOnly: true }, "android", "example.org"), "launcher");
  });

  it("honours the reader-only choice while translation is on", () => {
    assert.equal(pageMode({ ...base, readerOnly: true }, "mac", "example.org"), "launcher");
    assert.equal(pageMode({ ...base, readerOnly: false }, "android", "example.org"), "reading");
  });
});

describe("the quiet bubble", () => {
  it("shows the actions by default, on profiles old and new", () => {
    // Default `false` since D125: the buttons are what the bubble is for, and
    // somebody meeting it for the first time has to see them. A config without
    // the key is every profile that never touched the switch, this one
    // included - the changed default reaches all of them.
    assert.equal(withDefaults(undefined).hideBubbleActions, false);
    assert.equal(withDefaults({ sourceLang: "en" }).hideBubbleActions, false);
  });

  it("keeps a choice somebody made, in both directions", () => {
    assert.equal(withDefaults({ hideBubbleActions: true }).hideBubbleActions, true);
    assert.equal(withDefaults({ hideBubbleActions: false }).hideBubbleActions, false);
  });

  it("treats a hand-edited value of the wrong type as the default", () => {
    for (const hideBubbleActions of ["true", 1, null, {}]) {
      assert.equal(withDefaults({ hideBubbleActions }).hideBubbleActions, false);
    }
  });

  it("writes the choice through writeConfig without touching the rest", async () => {
    const store = installFakeBrowser({ config: { sourceLang: "de", targetLang: "en" } });
    const written = await writeConfig({ hideBubbleActions: false });

    assert.deepEqual(written, { ...DEFAULTS, sourceLang: "de", targetLang: "en", hideBubbleActions: false });
    assert.equal(/** @type {any} */ (store["config"]).hideBubbleActions, false);
  });
});

describe("the default keep", () => {
  it("keeps what the reader opens, on profiles old and new", () => {
    // The switch arrives with D124, so every profile that predates it has a
    // stored config without the key - and the default has to reach them too:
    // this is the setting that decides whether opening a page files it.
    assert.equal(withDefaults(undefined).keepArticles, true);
    assert.equal(withDefaults({ sourceLang: "en" }).keepArticles, true);
  });

  it("keeps a choice somebody made, in both directions", () => {
    assert.equal(withDefaults({ keepArticles: true }).keepArticles, true);
    // The one that matters: only a stored `false` turns the keeping off, so a
    // switch somebody set must survive every read.
    assert.equal(withDefaults({ keepArticles: false }).keepArticles, false);
  });

  it("treats a hand-edited value of the wrong type as the default", () => {
    for (const keepArticles of ["false", 0, null, {}]) {
      assert.equal(withDefaults({ keepArticles }).keepArticles, true);
    }
  });

  it("writes the choice through writeConfig without touching the rest", async () => {
    const store = installFakeBrowser({ config: { sourceLang: "de", targetLang: "en" } });
    const written = await writeConfig({ keepArticles: false });

    assert.deepEqual(written, { ...DEFAULTS, sourceLang: "de", targetLang: "en", keepArticles: false });
    assert.equal(/** @type {any} */ (store["config"]).keepArticles, false);
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

describe("the reading list's copy", () => {
  it("answers null for a profile that has never chosen", () => {
    assert.equal(withDefaults(undefined).libraryCopy, null);
    assert.equal(withDefaults({ keepArticles: false }).libraryCopy, null);
  });

  it("keeps a choice somebody made, in both directions", () => {
    assert.equal(withDefaults({ libraryCopy: true }).libraryCopy, true);
    assert.equal(withDefaults({ libraryCopy: false }).libraryCopy, false);
  });

  it("treats a hand-edited value of the wrong type as no choice", () => {
    for (const libraryCopy of ["true", 1, null, {}]) {
      assert.equal(withDefaults({ libraryCopy }).libraryCopy, null);
    }
  });

  it("is on unasked, everywhere", () => {
    // D146: the copy began as a choice outside iOS and iPadOS (Safari's
    // tracking prevention deletes the extension's IndexedDB after thirty
    // days without a visit to its pages; no other browser deletes it on its
    // own). But one database is one set of files, and a damaged profile, a
    // cleaning tool or a hand in the developer tools takes it on any
    // platform - Michał's own test emptied it and found nothing to come
    // back from. The default no longer asks the platform at all.
    assert.equal(effectiveLibraryCopy({ libraryCopy: null }), true);
    // A choice outlives the default in both directions.
    assert.equal(effectiveLibraryCopy({ libraryCopy: false }), false);
    assert.equal(effectiveLibraryCopy({ libraryCopy: true }), true);
  });
});
