import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { ErrorCode, fail, ok } from "../src/lib/protocol.js";
import { ENGINE_IDLE_MS, HEARTBEAT_MS, keptWarm, warmKeeper } from "../src/lib/translator/warm.js";

/**
 * The engine stays warm for the same time in both browsers (D298). In
 * Chromium the offscreen document closes itself after five idle minutes; in
 * Firefox the engine's worker belongs to the event page, which the browser
 * puts down after thirty seconds - so the page is kept awake for those five
 * minutes after a translation, by touching an extension API on a timer, and
 * not a beat longer.
 */

const SRC = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, SRC), "utf8");
}

/** A repeating timer the test turns by hand. */
function clock() {
  let now = 0;
  /** @type {{ work: () => void, every: number, next: number } | null} */
  let timer = null;
  let made = 0;
  return {
    now: () => now,
    /** @param {() => void} work @param {number} ms */
    setTimer: (work, ms) => {
      made += 1;
      timer = { work, every: ms, next: now + ms };
      return timer;
    },
    /** @param {unknown} which */
    clearTimer: (which) => {
      if (which === timer) timer = null;
    },
    /** @param {number} ms */
    advance(ms) {
      const end = now + ms;
      while (timer !== null && timer.next <= end) {
        now = timer.next;
        timer.next += timer.every;
        timer.work();
      }
      now = end;
    },
    running: () => timer !== null,
    made: () => made,
  };
}

describe("the engine stays warm after a translation (D298)", () => {
  it("touches on every beat for the whole window, and stops with it", () => {
    const ticking = clock();
    let touches = 0;
    const keeper = warmKeeper({ touch: () => (touches += 1), idle: 100, beat: 30, now: ticking.now, setTimer: ticking.setTimer, clearTimer: ticking.clearTimer });
    assert.equal(keeper.awake(), false, "a keeper nobody used runs a timer");
    assert.equal(ticking.running(), false);

    keeper.used();
    assert.equal(keeper.awake(), true);
    ticking.advance(99);
    assert.equal(touches, 3, "beats at 30, 60 and 90");
    // The beat at 120 finds the window over: no touch, and no timer left.
    ticking.advance(30);
    assert.equal(touches, 3, "a touch after the window");
    assert.equal(keeper.awake(), false);
    assert.equal(ticking.running(), false, "an idle keeper still runs a timer");
    ticking.advance(1000);
    assert.equal(touches, 3);
  });

  it("extends the window with every use, on the one timer", () => {
    const ticking = clock();
    let touches = 0;
    const keeper = warmKeeper({ touch: () => (touches += 1), idle: 100, beat: 30, now: ticking.now, setTimer: ticking.setTimer, clearTimer: ticking.clearTimer });
    keeper.used();
    ticking.advance(80);
    keeper.used();
    ticking.advance(80);
    assert.equal(keeper.awake(), true, "a second use did not extend the window");
    assert.equal(ticking.made(), 1, "a second use started a second timer");
    // The window now ends at 180: beats at 30..150 touched, 180 stops.
    ticking.advance(40);
    assert.equal(touches, 5);
    assert.equal(keeper.awake(), false);

    // And it starts again after it stopped.
    keeper.used();
    assert.equal(keeper.awake(), true);
    assert.equal(ticking.made(), 2);
    keeper.stop();
    assert.equal(ticking.running(), false);
  });

  it("opens the window only for an answer that came from the engine", async () => {
    let used = 0;
    const keeper = { used: () => (used += 1) };
    /** @type {import("../src/lib/protocol.js").Result<import("../src/lib/protocol.js").Translation>} */
    let answer = ok({ gloss: "słowo", sentence: null });
    const provider = keptWarm({ id: "stand-in", translate: async () => answer }, keeper);
    assert.equal(provider.id, "stand-in");

    assert.deepEqual(await provider.translate({ text: "word", from: "en", to: "pl" }), answer);
    assert.equal(used, 1);

    answer = fail(ErrorCode.MODEL_MISSING);
    assert.deepEqual(await provider.translate({ text: "word", from: "en", to: "pl" }), answer);
    answer = fail(ErrorCode.INTERNAL);
    await provider.translate({ text: "word", from: "en", to: "pl" });
    assert.equal(used, 1, "a failure kept an engine warm that never stood");
  });

  it("keeps both browsers' engines for the same time, inside the thirty seconds a background is given", async () => {
    assert.equal(ENGINE_IDLE_MS, 5 * 60_000);
    assert.ok(HEARTBEAT_MS >= 10_000 && HEARTBEAT_MS <= 25_000, `${HEARTBEAT_MS} ms`);

    const host = await source("offscreen/engine-host.js");
    assert.match(host, /const IDLE_LIMIT_MS = ENGINE_IDLE_MS;/, "the offscreen host closes on a number of its own");
    const remote = await source("lib/translator/providers/bergamot/remote.js");
    assert.match(remote, /import \{ HEARTBEAT_MS \} from "\.\.\/\.\.\/warm\.js";/, "the Chromium heartbeat has a number of its own");
    assert.doesNotMatch(remote, /const HEARTBEAT_MS/);
  });

  it("keeps the event page awake and leaves the service worker alone", async () => {
    const background = await source("background/index.js");
    assert.match(
      background,
      /setProvider\(offscreenApi\(\) === null \? keptWarm\(bergamot, awake\) : bergamotViaHost\);/,
      "the event page's engine is not kept warm, or the service worker's is kept twice",
    );
    // The touch has to reach the browser's parent process to count as
    // activity; `getPlatformInfo` does, and answers from memory.
    assert.match(background, /const awake = warmKeeper\(\{\s*touch: \(\) => \{\s*void webext\(\)\s*\.runtime\.getPlatformInfo\(\)\s*\.catch\(\(\) => \{\}\);\s*\},\s*\}\);/);
    // The provider itself stays plain: it also runs in the offscreen
    // document, which has its own timer.
    const provider = await source("lib/translator/providers/bergamot/index.js");
    assert.doesNotMatch(provider, /warm\.js|warmKeeper|keptWarm/, "the provider keeps itself warm, in the offscreen document too");
  });
});
