import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { withDefaults } from "../src/lib/config.js";
import {
  MIRROR_BUCKETS,
  MIRROR_KEY,
  MIRROR_KEYS,
  asMirror,
  asMirrorHead,
  formAliases,
  isMirrorKey,
  mirrorBucketKey,
  mirrorFrom,
  mirrorKeysFor,
  mirrorMatches,
  mirrorOf,
  writeMirror,
} from "../src/lib/store/mirror.js";

// Through `withDefaults` rather than written out: the mirror cares about the
// language pair and nothing else, and it should not need editing every time
// some other setting is added.
const CONFIG = withDefaults({ sourceLang: "en", targetLang: "pl" });

/** A mirror with nothing computed for the forms (D208) - every mirror before them. */
const NO_FORMS = { forms: {}, formsStamp: "" };

/** An empty mirror's other half: no entries, and so no order (D299). */
const NONE = { entries: [], order: [] };

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
      order: [1000],
      ...NO_FORMS,
    });
  });

  it("is empty rather than absent when the vocabulary is empty", () => {
    assert.deepEqual(mirrorOf(CONFIG, []), { from: "en", to: "pl", ...NONE, ...NO_FORMS });
  });

  it("mirrors an unchosen pair as the empty pair", () => {
    assert.deepEqual(mirrorOf({ ...CONFIG, sourceLang: null, targetLang: null }, []), {
      from: "",
      to: "",
      ...NONE,
      ...NO_FORMS,
    });
  });

  it("carries the forms it was handed, under their stamp (D208)", () => {
    const known = { forms: { read: ["reads", "reading"], bank: [] }, stamp: "1|en|dict:10:5" };
    assert.deepEqual(mirrorOf(CONFIG, [phrase("read", ["czytać"])], known), {
      from: "en",
      to: "pl",
      entries: [["read", ["czytać"]]],
      order: [1000],
      forms: { read: ["reads", "reading"], bank: [] },
      formsStamp: "1|en|dict:10:5",
    });
  });
});

describe("mirrorMatches", () => {
  it("says yes only for the pair being read", () => {
    assert.equal(mirrorMatches({ from: "en", to: "pl", ...NONE, ...NO_FORMS }, CONFIG), true);
    assert.equal(mirrorMatches({ from: "pl", to: "en", ...NONE, ...NO_FORMS }, CONFIG), false);
    assert.equal(mirrorMatches({ from: "en", to: "de", ...NONE, ...NO_FORMS }, CONFIG), false);
  });

  it("matches the empty mirror to the unchosen pair - a fresh install must go quiet, not ask", () => {
    const none = { ...CONFIG, sourceLang: null, targetLang: null };
    assert.equal(mirrorMatches({ from: "", to: "", ...NONE, ...NO_FORMS }, none), true);
    // A mirror left behind by a chosen pair does not match the pairless
    // settings - and the pairless mirror answers no chosen pair.
    assert.equal(mirrorMatches({ from: "en", to: "pl", ...NONE, ...NO_FORMS }, none), false);
    assert.equal(mirrorMatches({ from: "", to: "", ...NONE, ...NO_FORMS }, CONFIG), false);
  });
});

describe("asMirror", () => {
  it("reads the whole mirror the versions before D299 wrote, its places as its order", () => {
    const { order: _order, ...whole } = mirrorOf(CONFIG, [phrase("word", ["slowo"]), phrase("other", ["inne"])]);
    assert.deepEqual(asMirror(whole), { ...whole, order: [0, 1] });
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
      order: [0, 1],
      ...NO_FORMS,
    });
  });

  it("reads a mirror from before the forms as one with none computed (D208)", () => {
    const mirror = asMirror({ from: "en", to: "pl", entries: [["good", ["dobry"]]] });
    assert.deepEqual(mirror?.forms, {});
    assert.equal(mirror?.formsStamp, "");
  });

  it("keeps the forms that make sense, an empty list included, and drops the rest", () => {
    const mirror = asMirror({
      from: "en",
      to: "pl",
      entries: [["read", ["czytać"]]],
      forms: {
        read: ["reads", "reading", 7, ""],
        // Asked about and found to have none: worth keeping, so that the
        // next rebuild does not ask the dictionaries again.
        bank: [],
        "": ["nothing"],
        broken: "reads",
      },
      formsStamp: "1|en|dict:10:5",
    });
    assert.deepEqual(mirror?.forms, { read: ["reads", "reading"], bank: [] });
    assert.equal(mirror?.formsStamp, "1|en|dict:10:5");
  });

  it("reads forms of a shape that is not a map as none, and a stamp that is not a string as none", () => {
    const mirror = asMirror({ from: "en", to: "pl", entries: [], forms: ["reads"], formsStamp: 7 });
    assert.deepEqual(mirror?.forms, {});
    assert.equal(mirror?.formsStamp, "");
  });
});

/**
 * A storage area that remembers what was written to it, and in which calls.
 *
 * @param {Record<string, unknown>} [initial]
 */
function area(initial = {}) {
  /** @type {Record<string, unknown>} */
  const held = { ...initial };
  /** @type {string[][]} */
  const writes = [];
  let now = 7;
  return {
    held,
    writes,
    /** The bucket keys written since the last call, without the head. */
    takeBuckets: () => writes.splice(0).flat().filter((key) => key !== MIRROR_KEY),
    /** @param {number} at */
    setNow: (at) => {
      now = at;
    },
    deps: {
      /** @param {string[]} keys */
      read: async (keys) => {
        /** @type {Record<string, unknown>} */
        const found = {};
        for (const key of keys) if (held[key] !== undefined) found[key] = JSON.parse(JSON.stringify(held[key]));
        return found;
      },
      /** @param {Record<string, unknown>} items */
      write: async (items) => {
        writes.push(Object.keys(items));
        for (const [key, value] of Object.entries(items)) held[key] = JSON.parse(JSON.stringify(value));
      },
      now: () => now,
    },
  };
}

/**
 * Phrases saved one after another, a millisecond apart.
 *
 * @param {number} count
 * @returns {import("../src/lib/store/phrase.js").Phrase[]}
 */
function saved(count) {
  return Array.from({ length: count }, (_, at) => ({ ...phrase(`word${at}`, [`znaczenie${at}`]), createdAt: 5000 + at }));
}

describe("the mirror in buckets (D299)", () => {
  it("comes back from storage as it went in: the pair, the entries oldest first, the forms, the stamp", async () => {
    const phrases = saved(200);
    const forms = Object.fromEntries(phrases.filter((_, at) => at % 3 === 0).map((one) => [one.normalized, [`${one.normalized}s`]]));
    const mirror = mirrorOf(CONFIG, phrases, { forms, stamp: "1|en|dict:10:5" });
    const store = area();
    await writeMirror(mirror, {}, store.deps);

    assert.deepEqual(mirrorFrom(store.held), mirror);
    assert.equal(store.writes.length, 1, "the buckets and the head went in more than one call");
    assert.equal(store.writes[0]?.length, MIRROR_BUCKETS + 1, "the first write leaves a bucket unwritten");
    assert.deepEqual(Object.keys(store.held).sort(), [...MIRROR_KEYS].sort());
  });

  it("stores one bucket and the head for one phrase saved, changed or learned", async () => {
    const phrases = saved(200);
    const store = area();
    await writeMirror(mirrorOf(CONFIG, phrases), {}, store.deps);
    store.takeBuckets();

    const fresh = { ...phrase("brand new", ["nowy"]), createdAt: 9000 };
    await writeMirror(mirrorOf(CONFIG, [...phrases, fresh]), {}, store.deps);
    assert.deepEqual(store.writes[0]?.includes(MIRROR_KEY), true, "the head did not ride with the bucket");
    const bucket = mirrorKeysFor("brand new")[1];
    assert.deepEqual(store.takeBuckets(), [bucket], "a save");

    await writeMirror(mirrorOf(CONFIG, [...phrases, { ...fresh, translations: ["nowiutki"] }]), {}, store.deps);
    assert.deepEqual(store.takeBuckets(), [bucket], "other meanings");

    // Its forms arriving are its bucket's too.
    await writeMirror(mirrorOf(CONFIG, [...phrases, fresh], { forms: { "brand new": [] }, stamp: "s" }), {}, store.deps);
    assert.deepEqual(store.takeBuckets(), [bucket], "forms computed");

    // Learned: the phrase leaves the mirror, and only its bucket hears.
    const before = mirrorOf(CONFIG, phrases, { forms: {}, stamp: "s" });
    await writeMirror(before, {}, store.deps);
    assert.deepEqual(store.takeBuckets(), [bucket], "learned");
    assert.deepEqual(mirrorFrom(store.held), before);
  });

  it("writes the head every time, and no bucket when nothing changed", async () => {
    const mirror = mirrorOf(CONFIG, saved(50));
    const store = area();
    await writeMirror(mirror, {}, store.deps);
    store.takeBuckets();
    store.setNow(99);
    await writeMirror(mirror, {}, store.deps);
    assert.deepEqual(store.writes, [[MIRROR_KEY]], "a page that listens for the head would not hear of this write");
    assert.equal(asMirrorHead(store.held[MIRROR_KEY])?.writtenAt, 99);
  });

  it("stores every bucket when asked for the whole, whatever the head says", async () => {
    const mirror = mirrorOf(CONFIG, saved(50));
    const store = area();
    await writeMirror(mirror, {}, store.deps);
    // A bucket lost under a head that still vouches for it.
    const lost = mirrorKeysFor("word7")[1] ?? "";
    delete store.held[lost];
    store.takeBuckets();
    await writeMirror(mirror, {}, store.deps);
    assert.deepEqual(store.takeBuckets(), [], "the digests matched, so nothing was written - as designed");
    await writeMirror(mirror, { whole: true }, store.deps);
    assert.equal(store.takeBuckets().length, MIRROR_BUCKETS);
    assert.deepEqual(mirrorFrom(store.held), mirror);
  });

  it("reads the whole mirror of the versions before, and replaces it at the first write", async () => {
    const phrases = saved(10);
    const old = { from: "en", to: "pl", entries: phrases.map((one) => [one.normalized, one.translations]), forms: { word1: ["word1s"] }, formsStamp: "s" };
    const store = area({ [MIRROR_KEY]: old });
    const read = mirrorFrom(store.held);
    assert.deepEqual(read?.entries, old.entries);
    assert.deepEqual(read?.forms, old.forms);

    await writeMirror(mirrorOf(CONFIG, phrases, { forms: old.forms, stamp: "s" }), {}, store.deps);
    assert.equal(store.writes[0]?.length, MIRROR_BUCKETS + 1, "the old mirror was taken for a head");
    assert.notEqual(asMirrorHead(store.held[MIRROR_KEY]), null);
    assert.deepEqual(mirrorFrom(store.held)?.entries, old.entries);
  });

  it("puts entries of different buckets back in the order they were saved, a key breaking a tie", async () => {
    const phrases = [
      { ...phrase("zebra", ["z"]), createdAt: 10 },
      { ...phrase("apple", ["a"]), createdAt: 30 },
      { ...phrase("mango", ["m"]), createdAt: 20 },
      { ...phrase("alpha", ["a"]), createdAt: 20 },
    ];
    const store = area();
    // Listed by the background oldest first, as `listPhrases` does.
    const listed = [...phrases].sort((a, b) => a.createdAt - b.createdAt || (a.normalized < b.normalized ? -1 : 1));
    await writeMirror(mirrorOf(CONFIG, listed), {}, store.deps);
    assert.deepEqual(mirrorFrom(store.held)?.entries.map(([key]) => key), ["zebra", "alpha", "mango", "apple"]);
  });

  it("answers for one phrase from its own bucket", async () => {
    const phrases = saved(200);
    const store = area();
    await writeMirror(mirrorOf(CONFIG, phrases), {}, store.deps);
    const keys = mirrorKeysFor("word42");
    assert.equal(keys.length, 2);
    assert.equal(keys[0], MIRROR_KEY);
    const part = mirrorFrom(await store.deps.read(keys));
    assert.deepEqual(part?.entries.find(([key]) => key === "word42")?.[1], ["znaczenie42"]);
    assert.ok((part?.entries.length ?? 0) < phrases.length, "one bucket held the whole vocabulary");
    assert.equal(part?.from, "en");
  });

  it("is no mirror without a head, and holds nothing in a bucket that will not read", async () => {
    assert.equal(mirrorFrom({}), null);
    assert.equal(mirrorFrom({ [mirrorBucketKey(0)]: { rows: [["word", ["x"], 1]], forms: {} } }), null, "buckets without a head are nobody's");

    const store = area();
    await writeMirror(mirrorOf(CONFIG, saved(100)), {}, store.deps);
    const broken = mirrorKeysFor("word5")[1] ?? "";
    const whole = mirrorFrom(store.held)?.entries.length ?? 0;
    store.held[broken] = "not a bucket";
    const without = mirrorFrom(store.held);
    assert.ok(without !== null && without.entries.length < whole && without.entries.length > 0);
    assert.equal(without.entries.some(([key]) => key === "word5"), false);

    // Rows are narrowed one by one, as the old mirror's were.
    store.held[broken] = { rows: [["good", ["dobry"], 3], ["no meanings", [], 4], [7, ["x"], 5], ["short", ["x"]], "row", ["mixed", ["kept", 7, ""], "then"]], forms: { good: ["goods", 7], "": ["x"] } };
    const narrowed = mirrorFrom({ [MIRROR_KEY]: store.held[MIRROR_KEY], [broken]: store.held[broken] });
    assert.deepEqual(narrowed?.entries, [["mixed", ["kept"]], ["good", ["dobry"]]], "a row without a moment goes first");
    assert.deepEqual(narrowed?.forms, { good: ["goods"] });
  });

  it("takes a head only in its own shape", () => {
    const digests = Array.from({ length: MIRROR_BUCKETS }, () => "0-0");
    const head = { version: 2, from: "en", to: "pl", formsStamp: "s", writtenAt: 5, digests };
    assert.deepEqual(asMirrorHead(head), head);
    assert.equal(asMirrorHead(undefined), null);
    assert.equal(asMirrorHead({ from: "en", to: "pl", entries: [] }), null, "the whole mirror of the versions before is not a head");
    assert.equal(asMirrorHead({ ...head, version: 3 }), null);
    assert.equal(asMirrorHead({ ...head, from: 7 }), null);
    assert.equal(asMirrorHead({ ...head, digests: digests.slice(1) }), null, "a head for another number of buckets");
    assert.equal(asMirrorHead({ ...head, digests: digests.map(() => 7) }), null);
    assert.equal(asMirrorHead({ ...head, formsStamp: 7 })?.formsStamp, "");
    assert.equal(asMirrorHead({ ...head, writtenAt: "then" })?.writtenAt, 0);
  });

  it("knows its own keys among the storage area's", () => {
    assert.equal(MIRROR_KEYS.length, MIRROR_BUCKETS + 1);
    for (const key of MIRROR_KEYS) assert.equal(isMirrorKey(key), true);
    for (const key of ["config", "vocabBackup", "vocabBackup:3", "vocabIndexes", "models"]) assert.equal(isMirrorKey(key), false, key);
  });
});

describe("formAliases", () => {
  /** @type {import("../src/lib/protocol.js").VocabEntry[]} */
  const entries = [
    ["read", ["czytać"]],
    ["reading", ["czytanie"]],
    ["bank", ["bank"]],
  ];

  it("maps each form to the key it stands for", () => {
    const aliases = formAliases(entries, { bank: ["banks"], read: ["reads"] });
    assert.deepEqual([...aliases], [
      ["reads", "read"],
      ["banks", "bank"],
    ]);
  });

  it("never makes a saved key an alias of another - the reader's own entry answers", () => {
    // `reading` is saved in its own right: a press on it opens its bubble,
    // not `read`'s.
    const aliases = formAliases(entries, { read: ["reads", "reading"] });
    assert.deepEqual([...aliases], [["reads", "read"]]);
  });

  it("gives a form two keys claim to the first of them", () => {
    // `reads` is `read`'s by the rules and `reading`'s by the dictionary's
    // entry for both; the oldest saved word wins, and the answer is the same
    // on every page.
    const aliases = formAliases(entries, { read: ["reads"], reading: ["reads", "readings"] });
    assert.deepEqual([...aliases], [
      ["reads", "read"],
      ["readings", "reading"],
    ]);
  });

  it("ignores the forms of a key that is not among the entries", () => {
    // A key left in the forms after its phrase was forgotten has no bubble
    // to open, and its forms must not be underlined.
    const aliases = formAliases(entries, { gone: ["goes", "going"] });
    assert.equal(aliases.size, 0);
  });

  it("has nothing to say without forms", () => {
    assert.equal(formAliases(entries, {}).size, 0);
    assert.equal(formAliases([], { read: ["reads"] }).size, 0);
  });
});
