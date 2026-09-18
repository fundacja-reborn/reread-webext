import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * The sheets hanging under the reader's bar - the Aa panel and the menu -
 * and the moment they come down (D253).
 *
 * A press landing outside the chrome closes them; a press inside it is the
 * toggles' own business, which is what keeps the Aa button from closing the
 * panel it has just opened. The way back stands inside the chrome too, so
 * the arrow beside the mark changed the room with the panel open and the
 * whole change happened behind it (Michał's report, 2026-09-18). History's
 * own steps - Back, a forward step, the system's edge gesture - come with no
 * press at all, so nothing was closing the sheets there either.
 *
 * What is held here: the room on screen is stamped in one place, that place
 * takes the sheets down, and every road into a room goes through it.
 */

const ROOT = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

/**
 * The body of one top-level function.
 *
 * @param {string} script
 * @param {string} name
 */
function bodyOf(script, name) {
  const at = script.search(new RegExp(`\\n(?:export )?(?:async )?function ${name}\\(`));
  assert.notEqual(at, -1, `no function ${name}`);
  return script.slice(at, script.indexOf("\n}\n", at));
}

describe("a panel hanging under the bar when the room changes (D253)", () => {
  it("is taken down where the room is stamped, not at each of the doors", async () => {
    const reader = await source("reader/reader.js");
    const enter = bodyOf(reader, "enterView");
    assert.match(enter, /document\.body\.dataset\["view"\] = room;/, "the room is stamped somewhere else");
    assert.match(enter, /closePanels\(\);/, "the room changes with a sheet left hanging over it");
  });

  it("stamps the room in one place, so no road into one can forget the rule", async () => {
    const reader = await source("reader/reader.js");
    const stamps = reader.match(/dataset\["view"\] = /gu) ?? [];
    assert.equal(stamps.length, 1, "the room is stamped in more than one place, and only one of them closes the panels");
  });

  it("is the way into all three of the reader's rooms", async () => {
    const reader = await source("reader/reader.js");
    for (const room of ["doc", "list", "marks"]) {
      assert.match(reader, new RegExp(`enterView\\("${room}"\\);`), `the ${room} view is entered around the rule`);
    }
  });

  it("still comes down to a press beside it and to Escape", async () => {
    // The two roads that were already there, kept honest: a press outside
    // the chrome (`pointerdown`, so the press that closes the panel can be
    // the press that starts a selection) and the key.
    const reader = await source("reader/reader.js");
    assert.match(reader, /if \(event\.target instanceof Node && chromeBox !== null && chromeBox\.contains\(event\.target\)\) return;\s*closePanels\(\);/, "a press beside an open panel leaves it standing");
    assert.match(reader, /if \(event\.key !== "Escape" \|\| !anyPanelOpen\(\)\) return;/, "Escape no longer reaches an open panel");
  });
});
