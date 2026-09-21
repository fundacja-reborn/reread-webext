import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EDGE_COOLDOWN_MS,
  EDGE_QUIET_MS,
  EDGE_SLACK,
  EDGE_TOUCH_PX,
  EDGE_WHEEL_PX,
  atEdgeFor,
  edgeSwipe,
  edgeWheel,
  edgeWheelStart,
  wheelPixels,
  windowEdge,
} from "../src/lib/reader/pages.js";
import { edgeKeyTurn } from "../src/lib/reader/paging.js";

// Scrolling past the end of the text (D275). Scrolled, a long book's window
// ends where the stretch on screen ends - a border said nowhere since D270 -
// and the gesture the reader is already making now carries the reading over
// it: one more push at the very end opens what follows, one more pull at the
// very beginning opens what came before. The rule all three inputs share is
// that the gesture has to BEGIN at the edge: momentum, a fling and a held key
// all run into the end from somewhere else, and an accidental carry is a
// quarter of an hour of text thrown over. The rules are pure and tested
// here; the page's wiring is read from its source.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (/** @type {string} */ path) => readFileSync(join(ROOT, path), "utf8");

describe("windowEdge", () => {
  it("says which end of the text the window stands at", () => {
    assert.equal(windowEdge(0, 800, 5000), "top");
    assert.equal(windowEdge(1200, 800, 5000), null);
    assert.equal(windowEdge(4200, 800, 5000), "bottom");
    // A stretch short enough to stand whole in the window is at both.
    assert.equal(windowEdge(0, 800, 640), "both");
  });

  it("forgives the last fraction of a pixel a dense screen cannot reach", () => {
    assert.equal(windowEdge(4200 - EDGE_SLACK, 800, 5000), "bottom");
    assert.equal(windowEdge(4200 - EDGE_SLACK - 1, 800, 5000), null);
    assert.equal(windowEdge(1.5, 800, 5000), "top");
    assert.equal(windowEdge(Number.NaN, 800, 5000), null);
  });

  it("pairs an end with the turn that pushes against it", () => {
    assert.equal(atEdgeFor("bottom", "down"), true);
    assert.equal(atEdgeFor("bottom", "up"), false);
    assert.equal(atEdgeFor("top", "up"), true);
    assert.equal(atEdgeFor("both", "down"), true);
    assert.equal(atEdgeFor(null, "down"), false);
  });
});

describe("wheelPixels", () => {
  it("reads lines and pages as the pixels they scroll", () => {
    assert.equal(wheelPixels(120, 0, 800), 120);
    assert.equal(wheelPixels(3, 1, 800), 96);
    assert.equal(wheelPixels(-1, 2, 800), -800);
    assert.equal(wheelPixels(Number.NaN, 0, 800), 0);
  });
});

/**
 * Feeds wheel events through the rule. Each event: [delta, gap since the
 * event before, where the window stands].
 *
 * @param {Array<[number, number, import("../src/lib/reader/pages.js").WindowEdge]>} events
 * @param {number} [lastTurnAt]
 * @returns {{ turns: Array<"down" | "up">, asked: number }}
 */
function wheel(events, lastTurnAt = -Infinity) {
  let state = edgeWheelStart();
  let now = 10_000;
  let asked = 0;
  /** @type {Array<"down" | "up">} */
  const turns = [];
  for (const [delta, gap, edge] of events) {
    now += gap;
    const result = edgeWheel(state, { delta, now, lastTurnAt }, () => {
      asked += 1;
      return edge;
    });
    state = result.state;
    if (result.turn !== null) turns.push(result.turn);
  }
  return { turns, asked };
}

describe("edgeWheel", () => {
  it("opens nothing for momentum that runs into the end of the text", () => {
    // A flick from the middle of the text: events a few dozen milliseconds
    // apart, the window reaching the bottom half way through them and the
    // tail pushing against it for a second more.
    /** @type {Array<[number, number, import("../src/lib/reader/pages.js").WindowEdge]>} */
    const flick = [[90, 1000, null]];
    for (let index = 0; index < 8; index += 1) flick.push([80, 16, null]);
    for (let index = 0; index < 60; index += 1) flick.push([40, 20, "bottom"]);
    assert.deepEqual(wheel(flick).turns, []);
  });

  it("opens what follows for a push that begins at the end, once it is far enough", () => {
    const pushes = wheel([
      [100, 1000, "bottom"],
      [100, 40, "bottom"],
    ]);
    assert.deepEqual(pushes.turns, ["down"]);
    // One notch of a mouse wheel is not a push.
    assert.deepEqual(wheel([[100, 1000, "bottom"]]).turns, []);
    assert.ok(EDGE_WHEEL_PX > 100 && EDGE_WHEEL_PX <= 200);
  });

  it("opens what came before for a pull that begins at the beginning", () => {
    assert.deepEqual(
      wheel([
        [-80, 1000, "top"],
        [-80, 30, "top"],
      ]).turns,
      ["up"],
    );
  });

  it("counts a push only against the end it pushes at", () => {
    // Pulling up at the bottom, pushing down at the top: ordinary scrolls.
    assert.deepEqual(wheel([[-400, 1000, "bottom"]]).turns, []);
    assert.deepEqual(wheel([[400, 1000, "top"]]).turns, []);
    // A stretch standing whole in the window answers both ways.
    assert.deepEqual(wheel([[400, 1000, "both"]]).turns, ["down"]);
    assert.deepEqual(wheel([[-400, 1000, "both"]]).turns, ["up"]);
  });

  it("forgets the push when the gesture turns round, or the window moves off the end", () => {
    assert.deepEqual(
      wheel([
        [100, 1000, "bottom"],
        [-20, 30, "bottom"],
        [100, 30, "bottom"],
        [100, 30, "bottom"],
      ]).turns,
      [],
      "the gesture that turned round is nobody's until a still moment",
    );
    assert.deepEqual(
      wheel([
        [100, 1000, "bottom"],
        [100, 30, null],
      ]).turns,
      [],
    );
  });

  it("takes a push after a still moment as a new gesture", () => {
    const events = /** @type {Array<[number, number, import("../src/lib/reader/pages.js").WindowEdge]>} */ ([
      [90, 1000, null],
      [90, 20, "bottom"],
      [90, 20, "bottom"],
      // The hand stops, and pushes again.
      [100, EDGE_QUIET_MS, "bottom"],
      [100, 30, "bottom"],
    ]);
    assert.deepEqual(wheel(events).turns, ["down"]);
  });

  it("earns one turn a gesture, and none within a moment of the last carry", () => {
    const long = /** @type {Array<[number, number, import("../src/lib/reader/pages.js").WindowEdge]>} */ ([[200, 1000, "both"]]);
    for (let index = 0; index < 30; index += 1) long.push([200, 30, "both"]);
    assert.deepEqual(wheel(long).turns, ["down"], "one long push leafed through several stretches");
    // The clock of the last carry, whichever input made it.
    const soon = 10_000 + 1000 - (EDGE_COOLDOWN_MS - 50);
    assert.deepEqual(wheel([[400, 1000, "bottom"]], soon).turns, []);
  });

  it("measures the document only at a gesture's beginning and while it pushes against the end", () => {
    /** @type {Array<[number, number, import("../src/lib/reader/pages.js").WindowEdge]>} */
    const scroll = [[60, 1000, null]];
    for (let index = 0; index < 50; index += 1) scroll.push([60, 16, null]);
    assert.equal(wheel(scroll).asked, 1, "an ordinary scroll pays for the rule at every event");
    // And a sideways or zoom event, which arrives as no delta, asks nothing.
    assert.equal(wheel([[0, 1000, "bottom"]]).asked, 0);
  });
});

describe("edgeSwipe", () => {
  const still = { alone: true, now: 50_000, lastTurnAt: -Infinity };

  it("goes on for a finger that landed at the end and moved up, back for one at the beginning moved down", () => {
    assert.equal(edgeSwipe({ ...still, startedAt: "bottom", edge: "bottom", dx: 4, dy: -(EDGE_TOUCH_PX + 8) }), "down");
    assert.equal(edgeSwipe({ ...still, startedAt: "top", edge: "top", dx: -6, dy: EDGE_TOUCH_PX + 8 }), "up");
  });

  it("opens nothing for a fling that ran into the end from somewhere else", () => {
    assert.equal(edgeSwipe({ ...still, startedAt: null, edge: "bottom", dx: 0, dy: -300 }), null);
    assert.equal(edgeSwipe({ ...still, startedAt: "top", edge: "bottom", dx: 0, dy: -300 }), null);
  });

  it("opens nothing for a short drag, a sideways one, or two fingers", () => {
    assert.equal(edgeSwipe({ ...still, startedAt: "bottom", edge: "bottom", dx: 0, dy: -(EDGE_TOUCH_PX - 1) }), null);
    // The phrase selection's gesture (D80).
    assert.equal(edgeSwipe({ ...still, startedAt: "bottom", edge: "bottom", dx: 120, dy: -100 }), null);
    assert.equal(edgeSwipe({ ...still, alone: false, startedAt: "bottom", edge: "bottom", dx: 0, dy: -200 }), null);
  });

  it("opens nothing the wrong way round, or when the window has moved off the end", () => {
    assert.equal(edgeSwipe({ ...still, startedAt: "bottom", edge: "bottom", dx: 0, dy: 200 }), null);
    assert.equal(edgeSwipe({ ...still, startedAt: "bottom", edge: null, dx: 0, dy: -200 }), null);
  });

  it("waits out the moment after a carry", () => {
    assert.equal(
      edgeSwipe({ alone: true, now: 50_000, lastTurnAt: 50_000 - (EDGE_COOLDOWN_MS - 1), startedAt: "both", edge: "both", dx: 0, dy: -200 }),
      null,
    );
  });
});

describe("edgeKeyTurn", () => {
  const bare = {
    shift: false,
    alt: false,
    ctrl: false,
    meta: false,
    mac: false,
    tag: "BODY",
    editable: false,
    reading: false,
    dialog: false,
    repeat: false,
  };

  it("takes the keys that move a scrolled text on, the bare arrows among them", () => {
    assert.equal(edgeKeyTurn({ ...bare, key: "PageDown" }), "down");
    assert.equal(edgeKeyTurn({ ...bare, key: "PageUp" }), "up");
    assert.equal(edgeKeyTurn({ ...bare, key: " " }), "down");
    assert.equal(edgeKeyTurn({ ...bare, key: " ", shift: true }), "up");
    assert.equal(edgeKeyTurn({ ...bare, key: "ArrowDown" }), "down");
    assert.equal(edgeKeyTurn({ ...bare, key: "ArrowUp" }), "up");
    // The Mac's own paging pair (D170).
    assert.equal(edgeKeyTurn({ ...bare, key: "ArrowDown", alt: true, mac: true }), "down");
  });

  it("never takes a key held down - auto-repeat is the keyboard's momentum", () => {
    for (const key of ["PageDown", "PageUp", " ", "ArrowDown", "ArrowUp"]) {
      assert.equal(edgeKeyTurn({ ...bare, key, repeat: true }), null, key);
    }
  });

  it("leaves every other key, chord and place alone", () => {
    for (const key of ["End", "Home", "ArrowRight", "ArrowLeft", "Enter", "j"]) {
      assert.equal(edgeKeyTurn({ ...bare, key }), null, key);
    }
    // Shift with an arrow stretches a selection.
    assert.equal(edgeKeyTurn({ ...bare, key: "ArrowDown", shift: true }), null);
    assert.equal(edgeKeyTurn({ ...bare, key: "ArrowDown", ctrl: true }), null);
    assert.equal(edgeKeyTurn({ ...bare, key: "ArrowDown", alt: true }), null, "off the Mac an Alt chord is the system's");
    assert.equal(edgeKeyTurn({ ...bare, key: "PageDown", dialog: true }), null);
    assert.equal(edgeKeyTurn({ ...bare, key: "ArrowDown", tag: "SELECT" }), null);
    assert.equal(edgeKeyTurn({ ...bare, key: "ArrowDown", editable: true }), null);
    // The space bar is a press on a button, and the lector's while the voice reads.
    assert.equal(edgeKeyTurn({ ...bare, key: " ", tag: "BUTTON" }), null);
    assert.equal(edgeKeyTurn({ ...bare, key: " ", reading: true }), null);
  });
});

describe("the reader's page at the edge of a scrolled book", () => {
  const script = read("src/reader/reader.js");
  const css = read("src/reader/reader.css");

  /**
   * One function of the reader's script, from its name to the next one's.
   *
   * @param {string} name
   * @param {string} next
   */
  function fn(name, next) {
    const from = script.indexOf(`function ${name}(`);
    const to = script.indexOf(`function ${next}(`, from);
    assert.ok(from >= 0 && to > from, `${name} before ${next}`);
    return script.slice(from, to);
  }

  it("carries on only over a scrolled book with text that way and nothing else in the hand", () => {
    const may = fn("mayCarryOn", "carryOn");
    assert.match(may, /if \(target === null \|\| target\.origin !== "book" \|\| paged\(\)\) return false;/);
    assert.match(may, /if \(turn === "down" \? !frame\.onward : !frame\.earlier\) return false;/);
    assert.match(may, /roomShown !== null \|\| anyPanelOpen\(\) \|\| document\.querySelector\("dialog\[open\]"\) !== null/);
    assert.match(may, /if \(markerOn \|\| stretching \|\| bubbleOpen\(\)\) return false;/);
    assert.match(may, /window\.getSelection\(\)\?\.isCollapsed === false/);
    assert.match(may, /performance\.now\(\) - edgeTurnedAt >= EDGE_COOLDOWN_MS/);
  });

  it("does what the two quiet steps do: on with the text counted as finished, back to the end of what came before", () => {
    const whole = fn("carryOn", "paged");
    const carry = whole.slice(0, whole.indexOf("\n}\n"));
    assert.match(carry, /if \(turn === "down"\) countFinished\(\);\n\s+turnSegment\(turn === "down" \? 1 : -1\);/);
    // The spent wheel gesture stays spent: its momentum is still arriving.
    assert.doesNotMatch(carry, /edgeWheelState = /);
  });

  it("asks where the window stands before the key has moved it, and leaves the paged layout to its own turns", () => {
    const keys = fn("onPageKey", "edgeNow");
    const asked = keys.indexOf("const past = paged() ? null : edgeKeyTurn({ ...press, repeat: event.repeat });");
    const paging = keys.indexOf("const turn = pageTurn(press);");
    assert.ok(asked >= 0 && paging > asked, "the edge is asked before the press is paged");
    assert.match(keys, /if \(past !== null && atEdgeFor\(edgeNow\(\), past\) && mayCarryOn\(past\)\) \{\n\s+event\.preventDefault\(\);\n\s+carryOn\(past\);\n\s+return;/);
  });

  it("listens to the wheel and the finger passively, and never over the chrome, a dialog or a bar", () => {
    const from = script.indexOf("// The wheel and the trackpad. Passive");
    const to = script.indexOf("/** Whether the document on screen is being read by pages right now. */");
    assert.ok(from >= 0 && to > from);
    const listeners = script.slice(from, to);
    assert.equal((listeners.match(/passive: true/g) ?? []).length, 4, "wheel, touchstart, touchend, touchcancel");
    assert.doesNotMatch(listeners, /preventDefault/);
    assert.equal((listeners.match(/over\.closest\(EDGE_DEAF\) !== null\) return;/g) ?? []).length, 2);
    assert.match(script, /const EDGE_DEAF = "\.reader-chrome, dialog, \.speech-bar, \.mark-bar, \.note-popover";/);
    // Touch events, because a pan takes the pointer away.
    assert.match(listeners, /"touchstart"/);
    assert.match(listeners, /"touchend"/);
    assert.doesNotMatch(listeners, /"pointer(down|up|move)"/);
    // Read at the lift, from the finger that landed.
    assert.match(listeners, /Array\.from\(event\.changedTouches\)\.find\(\(one\) => one\.identifier === began\.id\)/);
  });

  it("keeps the phone's pull-to-refresh out of the way over a scrolled book, and only there", () => {
    assert.match(
      css,
      /:root:not\(\[data-reader-layout="paged"\]\):has\(#article\[data-book-place\]:not\(\[hidden\]\)\),\n:root:not\(\[data-reader-layout="paged"\]\):has\(#article\[data-book-place\]:not\(\[hidden\]\)\) body \{\n  overscroll-behavior-y: contain;\n\}/,
    );
  });

  it("keeps both steps around the text as the accessible road", () => {
    const page = read("src/reader/reader.html");
    assert.match(page, /id="segment-prev"/);
    assert.match(page, /id="segment-next-end"/);
  });
});
