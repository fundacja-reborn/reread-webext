import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { clear, unmark, unregister } from "../src/content/highlighter.js";
import { UNDERLINE_NAMES } from "../src/lib/underline.js";

/**
 * The paint on a page is taken back through one door, and this file holds it
 * shut. WebKit up to Safari 18 drops a registry entry on `delete` without
 * repainting its ranges (`HighlightRegistry::remove`), so a highlight deleted
 * straight from `CSS.highlights` stays on the screen until something else
 * repaints that spot - on the iPad that was the closing bubble's own patch and
 * nothing beside it, the stale wash of the Safari spike's P2. Emptying the set
 * first is repainted on every engine. No browser runs in CI: the registry
 * below is a stand-in that remembers the order of what was asked of it, and
 * the last test reads the sources for anyone deleting on their own.
 */

/** A registry entry that remembers whether it was emptied while still registered. */
class FakeHighlight {
  /** @param {() => boolean} registered whether the entry still stands in the registry */
  constructor(registered) {
    this.registered = registered;
    this.cleared = false;
    this.clearedWhileRegistered = false;
  }

  clear() {
    this.cleared = true;
    this.clearedWhileRegistered = this.registered();
  }
}

/**
 * Runs with `CSS.highlights` and `Highlight` standing in - the two things
 * `highlighter.js` asks for before it touches anything - and takes both away
 * afterwards, so no other test meets an engine that is not there.
 *
 * @param {(registry: Map<string, FakeHighlight>) => void} run
 */
function withRegistry(run) {
  /** @type {Map<string, FakeHighlight>} */
  const registry = new Map();
  Reflect.set(globalThis, "CSS", { highlights: registry });
  Reflect.set(globalThis, "Highlight", FakeHighlight);
  try {
    run(registry);
  } finally {
    Reflect.deleteProperty(globalThis, "CSS");
    Reflect.deleteProperty(globalThis, "Highlight");
  }
}

/**
 * @param {Map<string, FakeHighlight>} registry
 * @param {string} name
 * @returns {FakeHighlight}
 */
function registered(registry, name) {
  const entry = new FakeHighlight(() => registry.has(name));
  registry.set(name, entry);
  return entry;
}

describe("taking a highlight back", () => {
  it("empties the registration before dropping it, so every engine repaints", () => {
    withRegistry((registry) => {
      const entry = registered(registry, "reread-something");
      unregister("reread-something");
      assert.equal(entry.cleared, true, "the set was not emptied");
      assert.equal(entry.clearedWhileRegistered, true, "emptied only after the delete - too late for WebKit");
      assert.equal(registry.has("reread-something"), false, "the entry is still registered");
    });
  });

  it("is quiet about a name nobody registered, and about an engine without the API", () => {
    withRegistry(() => {
      assert.doesNotThrow(() => unregister("reread-nobody"));
    });
    assert.equal(typeof globalThis.CSS, "undefined");
    assert.doesNotThrow(() => unregister("reread-something"));
  });

  it("is the door the module's own take-backs use", () => {
    withRegistry((registry) => {
      const active = registered(registry, "reread-active");
      const underlines = new Map(UNDERLINE_NAMES.map((name) => [name, registered(registry, name)]));

      unmark();
      assert.equal(active.clearedWhileRegistered, true, "the recall mark was dropped without being emptied");
      assert.equal(registry.has("reread-active"), false);

      clear();
      for (const [name, entry] of underlines) {
        assert.equal(entry.clearedWhileRegistered, true, `${name} was dropped without being emptied`);
        assert.equal(registry.has(name), false);
      }
    });
  });

  it("is the only door: no module deletes from the registry on its own", async () => {
    const root = new URL("../src/", import.meta.url);
    const files = (await readdir(root, { recursive: true })).filter((path) => path.endsWith(".js"));
    assert.ok(files.length > 10, "the source tree was not walked");

    const highlighter = await readFile(new URL("content/highlighter.js", root), "utf8");
    // The one registry delete there is, inside `unregister` and nowhere else.
    const deletes = [...highlighter.matchAll(/\bapi\??\.delete\(|registry\(\)\??\.delete\(/g)];
    assert.equal(deletes.length, 1, "highlighter.js deletes from the registry in more than one place");
    const door = highlighter.indexOf("export function unregister(");
    const nextExport = highlighter.indexOf("\nexport function", door + 1);
    assert.ok(door !== -1 && deletes[0]?.index !== undefined);
    assert.ok(deletes[0].index > door && deletes[0].index < nextExport, "the registry delete has left `unregister`");

    for (const path of files) {
      const text = await readFile(new URL(path, root), "utf8");
      assert.equal(text.includes("highlights.delete("), false, `${path} deletes from CSS.highlights directly`);
    }
  });
});
