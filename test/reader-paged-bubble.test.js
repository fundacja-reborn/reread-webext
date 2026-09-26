import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * A bubble standing over a document read by pages (D285): the page waits
 * under every input that turns it - the swipe since D250, the wheel and the
 * keys since the report behind D285 - and the bubble's own list scrolls
 * under the wheel and the keys the way it does in the scroll layout.
 *
 * The rule for the keys is pure and tested with `paging.js`. What is held
 * here is the wiring a smoke test sees only as "the page turned" or "the
 * list scrolled": that the keys reach the rule with the bubble's standing,
 * that the wheel's listener asks the same question before it turns, and
 * that the three roads into a turn keep the one answer.
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

describe("the page waiting under a bubble when read by pages (D285)", () => {
  it("tells the key rule that a bubble stands", async () => {
    const reader = await source("reader/reader.js");
    const keys = bodyOf(reader, "onPageKey");
    // The press carries the bubble's standing, not the focused element's
    // tag: a click into the bubble's list focuses nothing, so the key
    // reports the body, which is what a press on the page reports too.
    assert.match(keys, /paged: paged\(\),\s*(?:\/\/[^\n]*\n\s*)*bubble: bubbleOpen\(\),/, "the key rule is not told about the bubble");
    assert.match(keys, /const turn = pageTurn\(press\);\s*if \(turn === null\) return;/, "a press the rule refuses is still taken from the browser");
  });

  it("leaves the wheel to the bubble's list while a bubble stands", async () => {
    const reader = await source("reader/reader.js");
    // The paged wheel listener is the one that turns pages (the other,
    // D275's, carries a scrolled book over its edge and asks `mayCarryOn`,
    // which already refuses under a bubble).
    const wheel = reader.match(/document\.addEventListener\(\n\s*"wheel",\n\s*\(event\) => \{\n\s*if \(!paged\(\)[^\n]*\n/);
    assert.ok(wheel !== null, "no wheel listener for the paged layout");
    assert.match(wheel[0], /if \(!paged\(\) \|\| roomShown !== null \|\| bubbleOpen\(\)\) return;/, "the wheel turns the page out from under an open bubble");
    // Passive still: the listener never takes the wheel from the list.
    const after = reader.slice(reader.indexOf(wheel[0]));
    assert.match(after.slice(0, after.indexOf("\n);\n")), /\{ passive: true \},?\s*$/, "the paged wheel listener is no longer passive");
  });

  it("keeps the three roads into a turn on the one rule", async () => {
    const reader = await source("reader/reader.js");
    // The swipe's guard came first (D250); the wheel's and the keys' are its
    // siblings, and a road that forgot the bubble would turn the page under
    // it again - open over a page nobody can see, with the page never
    // settling while it stands (`settlePage`).
    assert.match(bodyOf(reader, "swipeTurn"), /if \(bubbleOpen\(\)\) return;/, "the swipe forgot the bubble");
    assert.match(bodyOf(reader, "settlePage"), /if \(bubbleOpen\(\)\) \{\s*refreshCurtain\(\);\s*return;/, "the page settles under a bubble");
    // Nothing on the turn's own road closes the bubble instead: the press
    // that puts it away is the reader's, and comes first.
    assert.doesNotMatch(bodyOf(reader, "turnPage"), /dismiss\(\)|tooltip\.hide/, "a turn now puts the bubble away itself");
  });
});
