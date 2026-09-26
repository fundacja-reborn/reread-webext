import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * A bubble over a document read by pages (D285): aimed at the bubble, an
 * input is the bubble's - the wheel under the cursor over it, a finger that
 * landed on it, a key while the focus stands inside it - and its list scrolls
 * the way it does in the scroll layout. Aimed at the text, the wheel, the
 * keys and a swipe turn the page and close the bubble first: the turn takes
 * the phrase out of the window, and a bubble left open over a page nobody
 * can see is one nothing can settle the page under. The tap keeps its own
 * rule - it could mean "close" or "turn", so it only closes.
 *
 * The rule for the keys is pure and tested with `paging.js`. What is held
 * here is the wiring a smoke test sees only as "the page turned" or "the
 * list scrolled": that a press into the list gives it the focus the rule
 * reads, that the three roads into a turn ask the same question and close
 * the bubble the same way, and that the tap does not.
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

/**
 * The wheel listener of the paged layout - the one that turns pages. The
 * other wheel listener (D275) carries a scrolled book over its edge and asks
 * `mayCarryOn`, which refuses under a bubble on its own.
 *
 * @param {string} script
 */
function pagedWheel(script) {
  const at = script.search(/document\.addEventListener\(\n\s*"wheel",\n\s*\(event\) => \{\n\s*if \(!paged\(\)/);
  assert.notEqual(at, -1, "no wheel listener for the paged layout");
  return script.slice(at, script.indexOf("\n);\n", at));
}

describe("a bubble over a document read by pages (D285)", () => {
  it("gives the list the focus a press into it asks for", async () => {
    const tooltip = await source("content/tooltip.js");
    // Without it a press into the list focuses nothing, and the keys after
    // it go wherever each engine's own last-click rule sends them - and the
    // reader, reading the press by its target, would see the body.
    assert.match(tooltip, /entriesElement\.tabIndex = -1;/, "a press into the bubble's list focuses nothing");
    const reading = await source("content/reading.js");
    assert.match(reading, /export function bubbleOwns\(target\) \{\s*return tooltip\.owns\(target\);/, "the reader cannot ask whether an event was aimed at the bubble");
  });

  it("reads a key by where it was aimed, and closes the bubble with the page it stood on", async () => {
    const reader = await source("reader/reader.js");
    const keys = bodyOf(reader, "onPageKey");
    assert.match(keys, /bubble: bubbleOwns\(event\.target\),/, "the key rule is not told where the press was aimed");
    assert.doesNotMatch(keys, /bubble: bubbleOpen\(\)/, "every key waits under a bubble, wherever it was aimed");
    assert.match(keys, /const turn = pageTurn\(press\);\s*if \(turn === null\) return;/, "a press the rule refuses is still taken from the browser");
    // Never mid-stretch (D239): the range being dragged grows onto the page.
    assert.match(keys, /if \(paged\(\)\) \{\s*(?:\/\/[^\n]*\n\s*)*if \(bubbleOpen\(\) && !stretching\) dismiss\(\);\s*turnPage\(turn\);\s*return;/, "a turn by key leaves the bubble open over the page just left, or closes it mid-stretch");
    // Scrolled, the bubble rides with its phrase (D82): nothing closes it.
    assert.equal((keys.match(/dismiss\(\)/g) ?? []).length, 1, "a page key in the scroll layout closes the bubble");
  });

  it("leaves the wheel to the bubble under the cursor, and turns with it over the text", async () => {
    const reader = await source("reader/reader.js");
    const wheel = pagedWheel(reader);
    assert.match(wheel, /if \(!paged\(\) \|\| roomShown !== null\) return;\s*const target = event\.target instanceof Element \? event\.target : null;\s*if \(bubbleOwns\(target\)\) return;/, "the wheel over the bubble turns the page");
    assert.doesNotMatch(wheel, /\|\| bubbleOpen\(\)\) return;/, "the wheel over the text waits under a bubble");
    assert.match(wheel, /wheelTurnedAt = now;\s*(?:\/\/[^\n]*\n\s*)*if \(bubbleOpen\(\) && !stretching\) dismiss\(\);\s*turnPage\(turn\);/, "a turn by wheel leaves the bubble open over the page just left, or closes it mid-stretch");
    // Passive still: the listener never takes the wheel from the list.
    assert.match(wheel, /\{ passive: true \},?\s*$/, "the paged wheel listener is no longer passive");
  });

  it("keeps the swipe on the same rule, and the tap on its own", async () => {
    const reader = await source("reader/reader.js");
    const swipe = bodyOf(reader, "swipeTurn");
    assert.match(swipe, /if \(bubbleOwns\(target\)\) return;/, "a finger that landed on the bubble turns the page");
    assert.doesNotMatch(swipe, /if \(bubbleOpen\(\)\) return;/, "a swipe over the text waits under a bubble");
    assert.match(swipe, /if \(turn === null\) return;\s*if \(bubbleOpen\(\)\) dismiss\(\);\s*turnPage\(turn\);/, "a turn by swipe leaves the bubble open over the page just left");
    // A tap could mean "close" or "turn", so it only closes - `reading.js`
    // never calls it bare while a bubble stands, and it asks nothing about
    // the bubble itself.
    assert.doesNotMatch(bodyOf(reader, "onBareTap"), /dismiss\(\)|bubbleOpen\(\)|bubbleOwns\(/, "a tap now turns the page under a bubble");
    // Nothing settles the page under a bubble, still: the bubble's own
    // scrolling is deliberate, and a turn now closes it before it scrolls.
    assert.match(bodyOf(reader, "settlePage"), /if \(bubbleOpen\(\)\) \{\s*refreshCurtain\(\);\s*return;/, "the page settles under a bubble");
    // The turn itself knows nothing of the bubble: each road closes it, so
    // a road that forgot would show up here as a turn under an open bubble.
    assert.doesNotMatch(bodyOf(reader, "turnPage"), /dismiss\(\)|bubbleOpen\(\)/, "the turn closes the bubble itself, and the roads no longer have to");
  });
});
