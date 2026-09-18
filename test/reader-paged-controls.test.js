import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { pageTops } from "../src/lib/reader/pages.js";

/**
 * A page's edge never cuts through a row of controls (D245).
 *
 * Read by pages, the acts under the last paragraph - Mark as read, Delete,
 * and the way back to the reading list - came out halved: the frames at the
 * foot of one page and the words at the head of the next (Michał's photos,
 * 2026-09-18). The cutter was right to cut where it did: it measures a
 * block by its lines, and it found the buttons' words to be lines. So the
 * measure changed instead - nothing inside a control is a line, which
 * leaves such a block with no lines at all, and the rule a picture already
 * lives by moves it onto the next page whole.
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

describe("the measure that keeps a control whole (D245)", () => {
  it("counts no line inside a control, in the text or in the pictures", async () => {
    const reader = await source("reader/reader.js");
    const measure = bodyOf(reader, "lineBoxes");
    assert.match(measure, /if \(withinControl\(node, block\)\) continue;/, "a button's word is a line of the text again");
    assert.match(measure, /for \(const picture of block\.querySelectorAll\("img, svg, video, canvas"\)\) \{\s*if \(withinControl\(picture, block\)\) continue;/, "the glyph drawn in a button is a line of its own again");
  });

  it("walks up to and including the block, because a block can be a control", async () => {
    const reader = await source("reader/reader.js");
    const within = bodyOf(reader, "withinControl");
    assert.match(within, /if \(CONTROLS\.has\(at\.tagName\)\) return true;\s*if \(at === block\) return false;/, "the walk stops short of the block itself - the way back to the list is a button of its own");
    assert.match(reader, /const CONTROLS = new Set\(\["BUTTON", "SELECT", "TEXTAREA", "INPUT", "SUMMARY"\]\);/, "the controls a page must not cut are named somewhere else");
  });

  it("gives the whole row of acts to the page that can hold it", () => {
    // The photo's shape: a last paragraph, then the acts - a block with no
    // lines of its own - straddling the edge of a 200px band.
    const blocks = [
      { top: 100, bottom: 280 },
      { top: 300, bottom: 360 },
    ];
    /** @param {number} index */
    const linesOf = (index) =>
      index === 0
        ? Array.from({ length: 6 }, (_, line) => ({ top: 100 + line * 30, bottom: 130 + line * 30 }))
        : [];
    // Without the acts the paragraph alone fills one page; with them the
    // second page opens at their own top, never inside them.
    assert.deepEqual(pageTops(blocks, linesOf, 200), [100, 300]);
  });

  it("cuts a row taller than the page at the edge, as it does a tall picture", () => {
    // The one case where a control still has to be cut: nothing else can be
    // done with a block that no page can hold.
    const blocks = [{ top: 100, bottom: 500 }];
    const linesOf = () => [];
    assert.deepEqual(pageTops(blocks, linesOf, 150), [100, 250, 400]);
  });
});
