import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { afterEach, describe, it } from "node:test";
import { bodyOf } from "./openings.js";

import { sameAliases, sameEntries } from "../src/lib/store/mirror.js";
import { offStorageChanged, onStorageChanged } from "../src/lib/storage-changes.js";

/**
 * One listener on `storage.onChanged` per page (D297). Firefox reads every
 * change into a page once per registered listener - the old and the new
 * value of every key, whoever cares for it - so four listeners on the
 * reader page were four copies of every vocabulary write. The modules
 * register with `lib/storage-changes.js`, the browser hears of one
 * listener, and a page uses the mirror the event already carries instead
 * of reading it out of storage again.
 */

const SRC = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, SRC), "utf8");
}

/**
 * Every script under `src/`, by its path from there.
 *
 * @param {URL} [dir]
 * @param {string} [prefix]
 * @returns {Promise<string[]>}
 */
async function scripts(dir = SRC, prefix = "") {
  /** @type {string[]} */
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === "vendor") continue;
      found.push(...(await scripts(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`)));
    } else if (entry.name.endsWith(".js")) {
      found.push(`${prefix}${entry.name}`);
    }
  }
  return found;
}

/** A browser with nothing but the event, counting who listens to it. */
function install() {
  /** @type {Set<(changes: Record<string, unknown>, area: string) => void>} */
  const registered = new Set();
  const world = /** @type {{ browser?: unknown }} */ (/** @type {unknown} */ (globalThis));
  world.browser = {
    runtime: { id: "test" },
    storage: {
      onChanged: {
        /** @param {(changes: Record<string, unknown>, area: string) => void} listener */
        addListener: (listener) => registered.add(listener),
        /** @param {(changes: Record<string, unknown>, area: string) => void} listener */
        removeListener: (listener) => registered.delete(listener),
      },
    },
  };
  return {
    registered,
    /** @param {Record<string, unknown>} changes @param {string} area */
    fire(changes, area) {
      for (const listener of [...registered]) listener(changes, area);
    },
  };
}

describe("one storage listener per page (D297)", () => {
  /** @type {Array<(changes: Record<string, { oldValue?: unknown, newValue?: unknown }>, area: string) => void>} */
  let mine = [];

  afterEach(() => {
    for (const listener of mine) offStorageChanged(listener);
    mine = [];
    delete (/** @type {{ browser?: unknown }} */ (/** @type {unknown} */ (globalThis)).browser);
  });

  it("registers with the browser once, however many modules listen", () => {
    const browser = install();
    /** @type {string[]} */
    const heard = [];
    mine = [(_changes, area) => heard.push(`first ${area}`), (_changes, area) => heard.push(`second ${area}`), () => heard.push("third")];
    for (const listener of mine) onStorageChanged(listener);
    assert.equal(browser.registered.size, 1, "the browser was told of more than one listener");

    browser.fire({ config: { newValue: 1 } }, "local");
    assert.deepEqual(heard, ["first local", "second local", "third"]);
  });

  it("hands every listener the same change, not a copy each", () => {
    const browser = install();
    /** @type {unknown[]} */
    const seen = [];
    mine = [(changes) => seen.push(changes), (changes) => seen.push(changes)];
    for (const listener of mine) onStorageChanged(listener);
    const changes = { vocabIndex: { newValue: { entries: [] } } };
    browser.fire(changes, "local");
    assert.equal(seen[0], changes);
    assert.equal(seen[1], changes);
  });

  it("leaves the browser's event alone once nobody listens, and comes back for the next", () => {
    const browser = install();
    const one = () => undefined;
    const two = () => undefined;
    onStorageChanged(one);
    onStorageChanged(two);
    offStorageChanged(one);
    assert.equal(browser.registered.size, 1, "a listener still stands and the browser's was taken away");
    offStorageChanged(two);
    assert.equal(browser.registered.size, 0, "a page switched off left a listener behind");
    // Removing what was never registered is quiet, and changes nothing.
    offStorageChanged(one);
    assert.equal(browser.registered.size, 0);

    mine = [one];
    onStorageChanged(one);
    assert.equal(browser.registered.size, 1);
  });

  it("lets every listener hear a change one of them threw on", () => {
    const browser = install();
    /** @type {string[]} */
    const heard = [];
    mine = [
      () => {
        throw new Error("the first listener broke");
      },
      () => heard.push("second"),
    ];
    for (const listener of mine) onStorageChanged(listener);
    assert.throws(() => browser.fire({}, "local"), /the first listener broke/, "the error was swallowed");
    assert.deepEqual(heard, ["second"], "a listener that threw silenced the one after it");
  });

  it("is the only module that registers on the browser's event", async () => {
    for (const path of await scripts()) {
      if (path === "lib/storage-changes.js") continue;
      assert.doesNotMatch(
        await source(path),
        /storage\s*\.\s*(?:local\s*\.\s*|session\s*\.\s*)?onChanged\s*\.\s*addListener/,
        `${path} registers its own storage listener: every one is another copy of every change read into the page`,
      );
    }
  });
});

describe("a page meets its own save in the mirror (D297)", () => {
  it("takes what changed of the mirror from the event, and reads storage only when the event has none of it", async () => {
    const reading = await source("content/reading.js");
    const listener = bodyOf(reading, "onStorageChanged");
    // Since D299 the mirror is a head and buckets: the event carries the
    // ones a write touched, and they are put among the ones last read.
    assert.match(listener, /const moved = Object\.keys\(changes\)\.filter\(isMirrorKey\);/, "a changed bucket is not heard");
    assert.match(
      listener,
      /if \(moved\.length > 0 && storedMirror !== null && storedConfig !== null\) \{[\s\S]*?const mirror = \{ \.\.\.storedMirror \};[\s\S]*?if \(value === undefined\) delete mirror\[key\];\s*else mirror\[key\] = value;[\s\S]*?void loadVocabulary\(\{ \[CONFIG_KEY\]: settings, \.\.\.mirror \}\);\s*return;/,
      "the mirror in the event is read out of storage again",
    );
    assert.match(listener, /const settings = config === undefined \? storedConfig\.value : config\.newValue;/, "settings that moved in the same write are not the ones used");
    assert.match(listener, /\}\s*void loadVocabulary\(\);\s*\}$/, "a change to the settings alone no longer reads everything");
    const load = bodyOf(reading, "loadVocabulary");
    assert.match(load, /storedConfig = \{ value: stored\[CONFIG_KEY\] \};\s*storedMirror = mirrorPart\(stored\);/, "what a read found is not kept for the next change");
    assert.match(load, /storage\.local\.get\(\[CONFIG_KEY, \.\.\.MIRROR_KEYS\]\)/, "the mirror is read without its buckets");
    assert.match(bodyOf(reading, "stop"), /storedMirror = null;/, "a stopped side keeps the mirror");
  });

  it("reads the whole mirror in the content script's one read at startup", async () => {
    const content = await source("content/index.js");
    assert.match(content, /storage\.local\.get\(\[CONFIG_KEY, \.\.\.MIRROR_KEYS, PLATFORM_KEY, MODELS_KEY\]\)/, "the startup read leaves the buckets to a second read");
    assert.equal((content.match(/storage\.local\.get\(/g) ?? []).length, 1, "the content script reads storage more than once at startup");
  });

  it("paints again only when the mirror says something the page does not show", async () => {
    const reading = await source("content/reading.js");
    // Sliced rather than asked of `bodyOf`: the function's default parameter
    // is a brace of its own.
    const adopt = reading.slice(reading.indexOf("function adopt("), reading.indexOf("let shown = null;"));
    assert.ok(adopt.length > 0, "adopt was not found");
    assert.match(
      adopt,
      /const same =\s*shown !== null &&\s*shown\.ground === \(root \?\? document\.body\) &&\s*shown\.weight === underline &&\s*sameEntries\(vocabulary, next\) &&\s*sameAliases\(aliases, nextAliases\);/,
      "the paint is skipped on less than the same phrases, forms, ground and weight",
    );
    assert.match(adopt, /if \(!same\) repaint\(\);/);
    assert.match(bodyOf(reading, "repaint"), /shown = \{ ground: root \?\? document\.body, weight: underline \};/, "a paint is not recorded");
    // A start and a stop both forget the record: a start over new text
    // paints whatever the vocabulary says.
    const start = reading.slice(reading.indexOf("export function start("), reading.indexOf("export function stop("));
    assert.match(start, /shown = null;\s*void loadVocabulary\(where\.stored\);/, "a start over new text can skip its paint");
    assert.match(bodyOf(reading, "stop"), /shown = null;\s*storedConfig = null;/, "a stopped side keeps its record");
  });

  it("tells the same vocabulary from one that moved", () => {
    const held = new Map([
      ["read", ["czytać"]],
      ["take off", ["zdjąć", "wystartować"]],
    ]);
    assert.equal(sameEntries(held, new Map([...held].reverse())), true, "the order of the phrases is not a difference");
    assert.equal(sameEntries(held, new Map([...held, ["new", ["nowy"]]])), false, "a phrase more");
    assert.equal(sameEntries(held, new Map([["read", ["czytać"]]])), false, "a phrase fewer");
    assert.equal(sameEntries(held, new Map([["read", ["czytać"]], ["take on", ["przyjąć"]]])), false, "another phrase");
    assert.equal(sameEntries(held, new Map([["read", ["przeczytać"]], ["take off", ["zdjąć", "wystartować"]]])), false, "another meaning");
    assert.equal(sameEntries(held, new Map([["read", ["czytać"]], ["take off", ["wystartować", "zdjąć"]]])), false, "the meanings in another order");
    assert.equal(sameEntries(held, new Map([["read", ["czytać"]], ["take off", ["zdjąć"]]])), false, "a meaning fewer");
    assert.equal(sameEntries(new Map(), new Map()), true);
  });

  it("tells the same forms from forms that moved", () => {
    const held = new Map([
      ["reads", "read"],
      ["reading", "read"],
    ]);
    assert.equal(sameAliases(held, new Map([...held].reverse())), true);
    assert.equal(sameAliases(held, new Map([["reads", "read"]])), false, "a form fewer");
    assert.equal(sameAliases(held, new Map([...held, ["banks", "bank"]])), false, "a form more");
    assert.equal(sameAliases(held, new Map([["reads", "read"], ["reading", "reading"]])), false, "a form sent to another word");
    assert.equal(sameAliases(new Map(), new Map()), true);
  });
});
