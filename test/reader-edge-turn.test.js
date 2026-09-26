import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * The page turned from the window's edge while a range is being stretched
 * (D239), and the keys and the wheel turning it under a standing selection
 * or an active mark. The clocks and the zones are pure and tested with
 * `pages.js`; what is held here is the wiring between the gesture
 * (`content/select.js`), the reading side that passes the hooks through,
 * and the reader page - the part a smoke test sees only as "it turned" or
 * "it did not".
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

describe("the page turned at the window's edge under a stretched range (D239)", () => {
  it("hears every move of a stretch before reading it, and reads it where the reader says", async () => {
    const select = await source("content/select.js");
    const stretch = bodyOf(select, "extendTo");
    // The reader hears the pointer first, then may move the point the
    // stretch is read at - for the stroke and the selection alike.
    assert.match(stretch, /stretchAt = \{ x, y \};\s*hooks\?\.onStretch\?\.\(x, y\);\s*const read = hooks\?\.stretchPoint\?\.\(x, y\) \?\? \{ x, y \};/, "the stretch is read before the reader hears where the pointer stands");
    assert.match(stretch, /extendInk\(read\.x, read\.y\)/, "the stroke is read under the pointer, not where the reader says");
    assert.match(stretch, /caretAt\(read\.x, read\.y\)/, "the selection is read under the pointer, not where the reader says");
    // The stretch read again on the reader's word, only while one is on.
    const again = bodyOf(select, "restretch");
    assert.match(again, /if \(gesture\?\.mode !== "select" && mouse\?\.mode !== "select"\) return;\s*extendTo\(at\.x, at\.y\);/, "a stretch that is over can be read again");
    // Every end of a stretch says so once: the lift, the take-back, the
    // window's blur, the release, and the stroke's paint going.
    for (const name of ["onTouchEnd", "onTouchCancel", "endMouse", "releaseMouse", "clearInk"]) {
      assert.match(bodyOf(select, name), /stretchOver\(\);/, `${name} ends a stretch without saying so`);
    }
    assert.match(bodyOf(select, "stretchOver"), /if \(stretchAt === null\) return;\s*stretchAt = null;\s*hooks\?\.onStretchEnd\?\.\(\);/, "the end is said twice, or without the pointer forgotten");
  });

  it("passes the three hooks and the second read through the reading side", async () => {
    const reading = await source("content/reading.js");
    assert.match(reading, /export \{ restretch \} from "\.\/select\.js";/, "the reader has no way to have the stretch read again");
    for (const hook of ["onStretch", "onStretchEnd", "stretchPoint"]) {
      assert.match(reading, new RegExp(`\\.\\.\\.\\(where\\.${hook} === undefined \\? \\{\\} : \\{ ${hook}: where\\.${hook} \\}\\),`), `${hook} does not reach the gesture`);
    }
  });

  it("arms at the edge, turns on the clock, reads the stretch again with the turn, and disarms on the lift", async () => {
    const reader = await source("reader/reader.js");
    assert.match(reader, /onStretch,\s*onStretchEnd: disarmEdge,\s*stretchPoint,/, "the reader does not hand the gesture its edge hooks");
    // The turn and the range in one task: the turn's own scroll reads the
    // stretch again before the task ends.
    assert.match(bodyOf(reader, "showPageOf"), /refreshCurtain\(\);[\s\S]*restretch\(\);/, "a turn does not grow the range onto the new page");
    // The stay: entering a zone starts it and draws the line; the same
    // zone keeps it; leaving ends it.
    const move = bodyOf(reader, "onStretch");
    assert.match(move, /if \(zone === null\) \{\s*disarmEdge\(\);\s*return;/, "leaving the zone keeps the turn armed");
    assert.match(move, /if \(stay !== null && stay\.zone === zone\) \{[\s\S]*return;/, "a move within the zone restarts its clock");
    assert.match(move, /edgeStay = \{ zone, x, y, enteredAt: performance\.now\(\), turnedAt: null, timer: 0 \};\s*showEdgeLine\(zone\);\s*scheduleEdgeTurn\(\);/, "entering the zone does not draw the line and start the clock");
    // The clock's ring: the pure rule decides, the page turns, the stay
    // goes on in the zone or ends at the part's end.
    const due = bodyOf(reader, "onEdgeDue");
    assert.match(due, /if \(!edgeTurn\(stay\.zone, stay\.enteredAt, stay\.turnedAt, now\)\) \{\s*scheduleEdgeTurn\(\);\s*return;/, "the clock rings a turn the rule refuses");
    // Turned as a drag, never as a turn from the hand (D251): the band does
    // not go black under a finger in the middle of a selection.
    assert.match(due, /turnPage\(stay\.zone, "drag"\);\s*stay\.turnedAt = now;\s*if \(edgeZoneAt\(stay\.y\) !== stay\.zone\) \{\s*disarmEdge\(\);/, "the stay goes on where the zone died, or the edge's turn is signalled");
    // The zones are dead at the part's ends: no page that way, no zone.
    assert.match(bodyOf(reader, "edgeZoneAt"), /up: turnTarget\(pages\.tops, page, "up"\) !== null,\s*down: turnTarget\(pages\.tops, page, "down"\) !== null,/, "the zone lives at the part's end, where the next page is another document");
    // The lift disarms whatever the gesture said.
    assert.match(bodyOf(reader, "onPointerLift"), /^[\s\S]*?disarmEdge\(\);/, "a lift the gesture never heard of leaves the clock running");
    assert.match(bodyOf(reader, "disarmEdge"), /window\.clearTimeout\(stay\.timer\);\s*edgeStay = null;\s*if \(pageEdge !== null\) pageEdge\.hidden = true;/, "disarming leaves the clock or the line");
  });

  it("sticks the range's end to the page's edge in a zone, and to the pointer elsewhere", async () => {
    const reader = await source("reader/reader.js");
    const point = bodyOf(reader, "stretchPoint");
    assert.match(point, /if \(!paged\(\)\) return \{ x, y \};/, "the scroll layout has an edge to stick to");
    assert.match(point, /if \(zone === null\) return \{ x, y \};/, "the pointer is moved outside the zones");
    // The last full line's end at the foot, the first line's start at the
    // head - the far side of the column in a right-to-left text.
    assert.match(point, /const rtl = article !== null && getComputedStyle\(article\)\.direction === "rtl";/, "a right-to-left text's line ends on the wrong side");
    assert.match(point, /zone === "down"[\s\S]*x: rtl \? column\.left \+ 3 : column\.right - 3, y: lastLineEnd\(pages, pageShown\(pages\), band\) - half/, "the foot's zone does not stick to the last line's end");
    assert.match(point, /return \{ x: rtl \? column\.right - 3 : column\.left \+ 3, y: band\.top \+ half \};/, "the head's zone does not stick to the first line's start");
    // The last full line ends at the curtain's edge, or at the band's foot
    // where the curtain has nothing to cover.
    assert.match(bodyOf(reader, "lastLineEnd"), /return cover === null \? band\.bottom : cover;/, "the last line's end is not the curtain's edge");
  });

  it("draws the armed turn as a still line of ink on the band's edge", async () => {
    const markup = await source("reader/reader.html");
    assert.match(markup, /<div id="page-edge" class="page-edge" hidden aria-hidden="true"><\/div>/, "there is no edge line to draw");
    const styles = await source("reader/reader.css");
    const line = styles.slice(styles.indexOf("\n.page-edge {"), styles.indexOf("}", styles.indexOf("\n.page-edge {")));
    assert.match(line, /position: fixed;\s*inset-inline: 0;\s*height: 2px;/, "the edge line is not two pixels across the window");
    assert.match(line, /z-index: 1;/, "the edge line stands under the curtain it marks the edge of");
    assert.match(line, /background: var\(--page-fg\);/, "the edge line is not the page's ink");
    assert.match(line, /pointer-events: none;/, "the edge line takes the pointer from the text");
    assert.doesNotMatch(line, /transition|animation/, "the edge line moves, which an e-ink panel draws as a smear");
    const show = bodyOf(await source("reader/reader.js"), "showEdgeLine");
    assert.match(show, /zone === "down" \? lastLineEnd\(pages, pageShown\(pages\), band\) : band\.top - 2/, "the line is not drawn on the band's edge");
  });

  it("draws a pin only on the page shown, never pulled to the edge", async () => {
    const reader = await source("reader/reader.js");
    assert.match(bodyOf(reader, "placeMarkPins"), /markPinEnd\.hidden = false;\s*dressMarkPins\(\);/, "the pins are placed without being dressed for the page");
    assert.match(bodyOf(reader, "refreshCurtain"), /dressMarkPins\(\);\s*$/, "a turn or a scroll leaves a pin drawn off the page");
    const dress = bodyOf(reader, "dressMarkPins");
    assert.match(dress, /const shown = rect\.top >= band\.top - 1 && rect\.bottom <= foot \+ 1;\s*pin\.style\.visibility = shown \? "" : "hidden";/, "a pin off the page is pulled to the edge, or hidden by the state that says the pins are down");
    assert.match(dress, /if \(pages === null\) \{\s*markPinStart\.style\.visibility = "";\s*markPinEnd\.style\.visibility = "";/, "the scroll layout hides a pin");
  });

  it("turns the page by key and wheel without closing a selection being dragged or an active mark", async () => {
    const reader = await source("reader/reader.js");
    // The turn itself, and the landing, close nothing at all.
    for (const name of ["turnPage", "showPageOf"]) {
      assert.doesNotMatch(bodyOf(reader, name), /clearSelection|dismiss\(|deselectMark|setMarker\(false\)/, `${name} closes what stands on the page`);
    }
    // The roads into a turn - the keys, the two wheel listeners (the paged
    // layout's and D275's edge) - close one thing only: an open bubble,
    // with the page it stood on (D285), and never mid-stretch, where the
    // range being dragged grows onto the next page - this decision's own
    // case, a key or the wheel under a pointer the gesture holds.
    const roads = [bodyOf(reader, "onPageKey")];
    const opener = 'document.addEventListener(\n  "wheel",';
    for (let at = reader.indexOf(opener); at !== -1; at = reader.indexOf(opener, at + 1)) {
      roads.push(reader.slice(at, reader.indexOf("{ passive: true },", at)));
    }
    assert.equal(roads.length, 3, "the keys and two wheel listeners");
    for (const road of roads) {
      assert.doesNotMatch(road, /clearSelection|deselectMark|setMarker\(false\)/, "a road into a turn closes what stands on the page");
      const bare = road.replaceAll("if (bubbleOpen() && !stretching) dismiss();", "");
      assert.doesNotMatch(bare, /dismiss\(/, "a road into a turn closes the bubble mid-stretch, or closes more than the bubble");
    }
    // The reading side's keys: the copy chord and Escape, nothing else -
    // the page keys and the arrows pass under a standing selection.
    const keys = bodyOf(await source("content/reading.js"), "onKeyDown");
    assert.match(keys, /if \(event\.key !== "Escape"\) return;/, "a key other than Escape reaches the selection");
    // And a scroll under the reader's anchored bubble keeps it (D82).
    assert.match(bodyOf(await source("content/reading.js"), "onScroll"), /if \(anchored\) return;/, "a turn under an open bubble closes it");
  });

  it("is promised in the README", async () => {
    const readme = await source("../README.md");
    assert.match(readme, /a highlight or a selection dragged to the foot of the page turns it after a moment and goes on onto the next page/, "the README does not promise the turn at the edge");
  });
});
