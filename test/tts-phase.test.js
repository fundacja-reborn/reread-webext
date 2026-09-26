import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

import {
  PENDING_CEILING,
  reflectSpeech,
  setSpeechOff,
  speak,
  speaking,
  speechOwner,
  speechPhase,
  stop,
  watchSpeech,
} from "../src/lib/tts.js";

/**
 * Where the voice is, as every speaker's button shows it (D287): pending
 * from the press to the engine's own `start`, speaking to `end`, idle
 * otherwise - and whose press it is. The engine here is a stand-in whose
 * utterances fire their events when the test says so, which is the whole
 * point: the wait before `start` is the seconds an e-ink tablet takes to
 * wake its voice, and what the button says during them is the rule under
 * test.
 */

/** An utterance the test can drive: it keeps the listeners and fires them on demand. */
class Utterance {
  /** @param {string} text */
  constructor(text) {
    this.text = text;
    /** @type {{ name: string } | null} */
    this.voice = null;
    /** @type {Map<string, () => void>} */
    this.listeners = new Map();
  }
  /**
   * @param {string} type
   * @param {() => void} handler
   */
  addEventListener(type, handler) {
    this.listeners.set(type, handler);
  }
  /** @param {string} type */
  fire(type) {
    this.listeners.get(type)?.();
  }
}

const ALICE = { name: "Alice", lang: "en-US", voiceURI: "urn:alice", localService: true, default: true };

/**
 * @param {{ voices?: typeof ALICE[], arriving?: typeof ALICE[] }} [shape] the
 *   voices listed at once, or - with `arriving` - none at first and these on
 *   `voiceschanged`, the way a fresh Chromium page answers
 * @returns {{ spoken: Utterance[], cancelled: () => number }}
 */
function engine({ voices = [ALICE], arriving } = {}) {
  /** @type {Utterance[]} */
  const spoken = [];
  let cancelled = 0;
  let listed = voices;
  globalThis.speechSynthesis = /** @type {any} */ ({
    getVoices: () => listed,
    speak: (/** @type {Utterance} */ utterance) => spoken.push(utterance),
    cancel: () => {
      cancelled += 1;
    },
    addEventListener: (/** @type {string} */ _type, /** @type {() => void} */ handler) => {
      queueMicrotask(() => {
        if (arriving !== undefined) listed = arriving;
        handler();
      });
    },
    removeEventListener: () => {},
  });
  globalThis.SpeechSynthesisUtterance = /** @type {any} */ (Utterance);
  return { spoken, cancelled: () => cancelled };
}

/** The phases and owners a watcher was told, in order. */
function journal() {
  /** @type {{ phase: string, owner: unknown }[]} */
  const seen = [];
  const forget = watchSpeech((phase, owner) => seen.push({ phase, owner }));
  return { seen, forget };
}

/** A button in as much of a DOM as `reflectSpeech` touches. */
function button() {
  /** @type {Record<string, string>} */
  const attributes = {};
  return {
    attributes,
    /** @param {string} name @param {string} value */
    setAttribute(name, value) {
      attributes[name] = value;
    },
    /** @param {string} name */
    removeAttribute(name) {
      delete attributes[name];
    },
  };
}

describe("the voice's phase", () => {
  /** @type {(() => void)[]} */
  const forgets = [];

  afterEach(() => {
    for (const forget of forgets.splice(0)) forget();
    stop();
    setSpeechOff(false);
    mock.timers.reset();
    globalThis.speechSynthesis = /** @type {any} */ (undefined);
    globalThis.SpeechSynthesisUtterance = /** @type {any} */ (undefined);
  });

  it("is pending from the press, speaking from the engine's start, idle from its end", async () => {
    const { spoken } = engine();
    const { seen, forget } = journal();
    forgets.push(forget);
    const press = Symbol("press");

    assert.equal(speechPhase(), "idle");
    const promise = speak("hello", "en", undefined, 1, press);
    // Before the voice list is even asked for: the button says so at once.
    assert.equal(speechPhase(), "pending");
    assert.equal(speechOwner(), press);
    assert.equal(await promise, true);
    assert.equal(speechPhase(), "pending");
    assert.equal(speaking(), true);

    spoken[0]?.fire("start");
    assert.equal(speechPhase(), "speaking");
    assert.equal(speechOwner(), press);

    spoken[0]?.fire("end");
    assert.equal(speechPhase(), "idle");
    assert.equal(speechOwner(), null);
    assert.equal(speaking(), false);
    assert.deepEqual(seen, [
      { phase: "pending", owner: press },
      { phase: "speaking", owner: press },
      { phase: "idle", owner: press },
    ]);
  });

  it("rests on the engine's error as on its end", async () => {
    const { spoken } = engine();
    await speak("hello", "en", undefined, 1, "a");
    spoken[0]?.fire("error");
    assert.equal(speechPhase(), "idle");
    assert.equal(speaking(), false);
  });

  it("is stopped while pending: the utterance goes, and its late start is nobody's", async () => {
    const { spoken, cancelled } = engine();
    const { seen, forget } = journal();
    forgets.push(forget);
    await speak("hello", "en", undefined, 1, "a");
    stop();
    assert.equal(speechPhase(), "idle");
    assert.equal(cancelled(), 1);
    // A cancelled engine may still report the start it had queued.
    spoken[0]?.fire("start");
    assert.equal(speechPhase(), "idle");
    assert.deepEqual(
      seen.map((entry) => entry.phase),
      ["pending", "idle"],
    );
  });

  it("abandons a press stopped while the voice list was still loading", async () => {
    const { spoken, cancelled } = engine({ voices: [], arriving: [ALICE] });
    const promise = speak("hello", "en", undefined, 1, "a");
    assert.equal(speechPhase(), "pending");
    // The bubble closed before the list arrived.
    stop();
    assert.equal(await promise, false);
    assert.equal(spoken.length, 0);
    assert.equal(cancelled(), 0);
    assert.equal(speechPhase(), "idle");
  });

  it("hands the phase to a new press without resting in between, and rests the old owner", async () => {
    const { spoken, cancelled } = engine();
    const { seen, forget } = journal();
    forgets.push(forget);
    await speak("one", "en", undefined, 1, "first");
    spoken[0]?.fire("start");
    assert.equal(speechPhase(), "speaking");

    await speak("two", "en", undefined, 1, "second");
    assert.equal(cancelled(), 1);
    assert.equal(speechPhase(), "pending");
    assert.equal(speechOwner(), "second");
    // The first utterance's end reports in after the module moved on.
    spoken[0]?.fire("end");
    assert.equal(speechPhase(), "pending");
    spoken[1]?.fire("start");
    assert.equal(speechPhase(), "speaking");
    assert.deepEqual(seen, [
      { phase: "pending", owner: "first" },
      { phase: "speaking", owner: "first" },
      { phase: "pending", owner: "second" },
      { phase: "speaking", owner: "second" },
    ]);
  });

  it("tells the watchers of a second press even while the phase stays pending", async () => {
    engine();
    const { seen, forget } = journal();
    forgets.push(forget);
    await speak("one", "en", undefined, 1, "first");
    await speak("two", "en", undefined, 1, "second");
    assert.deepEqual(seen, [
      { phase: "pending", owner: "first" },
      { phase: "pending", owner: "second" },
    ]);
  });

  it("rests after a refusal - no offline voice for the language - unless a newer press is on its way", async () => {
    engine({ voices: [{ ...ALICE, name: "Google polski", lang: "pl-PL", voiceURI: "urn:google", localService: false }] });
    const { seen, forget } = journal();
    forgets.push(forget);
    assert.equal(await speak("cześć", "pl", undefined, 1, "a"), false);
    assert.equal(speechPhase(), "idle");
    assert.deepEqual(
      seen.map((entry) => entry.phase),
      ["pending", "idle"],
    );
  });

  it("gives up a press the engine never answers, after the ceiling", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const { cancelled } = engine();
    await speak("hello", "en", undefined, 1, "a");
    assert.equal(speechPhase(), "pending");
    mock.timers.tick(PENDING_CEILING - 1);
    assert.equal(speechPhase(), "pending");
    mock.timers.tick(1);
    assert.equal(speechPhase(), "idle");
    assert.equal(cancelled(), 1);
    assert.equal(speaking(), false);
  });

  it("does not give up a voice that started before the ceiling", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const { spoken, cancelled } = engine();
    await speak("hello", "en", undefined, 1, "a");
    spoken[0]?.fire("start");
    mock.timers.tick(PENDING_CEILING);
    assert.equal(speechPhase(), "speaking");
    assert.equal(cancelled(), 0);
  });

  it("rests when reading aloud is switched off mid-phrase", async () => {
    const { spoken } = engine();
    await speak("hello", "en", undefined, 1, "a");
    spoken[0]?.fire("start");
    setSpeechOff(true);
    assert.equal(speechPhase(), "idle");
    assert.equal(speechOwner(), null);
  });

  it("forgets a watcher that asked to be forgotten", async () => {
    engine();
    const { seen, forget } = journal();
    forget();
    await speak("hello", "en", undefined, 1, "a");
    assert.deepEqual(seen, []);
  });
});

describe("reflectSpeech", () => {
  it("paints busy while pending, pressed while speaking, neither at rest", () => {
    const speaker = button();
    reflectSpeech(speaker, "pending");
    assert.deepEqual(speaker.attributes, { "aria-busy": "true", "aria-pressed": "false" });
    reflectSpeech(speaker, "speaking");
    assert.deepEqual(speaker.attributes, { "aria-pressed": "true" });
    reflectSpeech(speaker, "idle");
    assert.deepEqual(speaker.attributes, { "aria-pressed": "false" });
  });
});
