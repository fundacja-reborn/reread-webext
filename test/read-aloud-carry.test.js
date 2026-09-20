import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Reading aloud across the border between two stretches of a long book
// (D274). A long book is rendered one stretch at a time, and the listener was
// never told (D270) - so the voice falling silent at the end of a stretch
// fell silent in the middle of a chapter. The module now asks the page when
// it comes to the end of the text (`onFinished`), waits with its bar standing
// while the page brings what follows, and reads on when told
// (`carryOnReading`). In the gap a pause, a stop or another document has the
// last word.
//
// `read-aloud.js` is the DOM half of the voice, but everything it asks of a
// browser fits in a few stand-ins: an engine that remembers what it was
// handed, a range that measures as one line on the screen, and an article of
// paragraphs. What the reader page does with the hook is read from its
// source, since that page only exists in a browser.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The engine: what was handed over, in order, and how often it was flushed. */
const engine = {
  /** @type {FakeUtterance[]} */
  spoken: [],
  cancels: 0,
};

class FakeUtterance {
  /** @param {string} text */
  constructor(text) {
    this.text = text;
    this.lang = "";
    this.rate = 1;
    this.voice = null;
    /** @type {Map<string, Array<(event: object) => void>>} */
    this.listeners = new Map();
  }

  /**
   * @param {string} type
   * @param {(event: object) => void} listener
   */
  addEventListener(type, listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  /**
   * @param {string} type
   * @param {object} [event]
   */
  fire(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class FakeElement {
  /**
   * @param {string} tagName
   * @param {Array<FakeElement | FakeText>} children
   */
  constructor(tagName, children) {
    this.nodeType = 1;
    this.tagName = tagName;
    this.isContentEditable = false;
    /** @type {FakeElement | FakeText | null} */
    this.firstChild = children[0] ?? null;
    /** @type {FakeElement | FakeText | null} */
    this.nextSibling = null;
    children.forEach((child, index) => {
      child.nextSibling = children[index + 1] ?? null;
    });
  }
}

class FakeText {
  /** @param {string} data */
  constructor(data) {
    this.nodeType = 3;
    this.data = data;
    /** @type {FakeElement | FakeText | null} */
    this.nextSibling = null;
  }
}

/**
 * An article of paragraphs, one sentence each.
 *
 * @param {string[]} sentences
 */
function articleOf(sentences) {
  return new FakeElement(
    "ARTICLE",
    sentences.map((sentence) => new FakeElement("P", [new FakeText(sentence)])),
  );
}

/** Timers the module sets, run by hand: its top-up waits out the `end` event in one. */
/** @type {Array<(() => void) | null>} */
let timers = [];
function runTimers() {
  const due = timers;
  timers = [];
  for (const timer of due) timer?.();
}

/** @type {Record<string, unknown>} */
const saved = {};
const GLOBALS = ["speechSynthesis", "SpeechSynthesisUtterance", "Node", "HTMLElement", "document", "window"];

/** @type {typeof import("../src/reader/read-aloud.js")} */
let voice;

/** What the page under test shows, and what it answers the voice. */
const page = {
  /** @type {FakeElement | null} */
  article: null,
  /** @type {string[]} */
  states: [],
  finished: 0,
  more: false,
};

before(async () => {
  for (const name of GLOBALS) saved[name] = Reflect.get(globalThis, name);
  Reflect.set(globalThis, "speechSynthesis", {
    speak: (/** @type {FakeUtterance} */ utterance) => engine.spoken.push(utterance),
    cancel: () => {
      engine.cancels += 1;
    },
    getVoices: () => [],
  });
  Reflect.set(globalThis, "SpeechSynthesisUtterance", FakeUtterance);
  Reflect.set(globalThis, "Node", { ELEMENT_NODE: 1, TEXT_NODE: 3 });
  Reflect.set(globalThis, "HTMLElement", FakeElement);
  // One line of text standing in the middle of the window: under the fold,
  // inside the band the spoken line is kept in, so nothing ever scrolls.
  Reflect.set(globalThis, "document", {
    createRange: () => ({
      setStart() {},
      setEnd() {},
      getBoundingClientRect: () => ({ top: 200, bottom: 220, width: 300, height: 20 }),
      getClientRects: () => [],
    }),
  });
  Reflect.set(globalThis, "window", {
    innerHeight: 800,
    scrollY: 0,
    scrollTo() {},
    setTimeout: (/** @type {() => void} */ run) => timers.push(run),
    clearTimeout: (/** @type {number} */ id) => {
      timers[id - 1] = null;
    },
  });

  voice = await import("../src/reader/read-aloud.js");
  voice.configureReading({
    article: () => /** @type {Element | null} */ (/** @type {unknown} */ (page.article)),
    fold: () => 60,
    onChange: (state) => page.states.push(state),
    onFail: () => assert.fail("the engine was said to have failed"),
    onNoVoice: () => assert.fail("no offline voice was said to be missing"),
    onFinished: () => {
      page.finished += 1;
      return page.more;
    },
  });
});

after(() => {
  for (const name of GLOBALS) {
    if (saved[name] === undefined) Reflect.deleteProperty(globalThis, name);
    else Reflect.set(globalThis, name, saved[name]);
  }
});

beforeEach(() => {
  voice.forgetReading();
  engine.spoken.length = 0;
  engine.cancels = 0;
  timers = [];
  page.states = [];
  page.finished = 0;
  page.more = false;
});

/**
 * Reads a text of two sentences to its end: both handed over (the engine is
 * kept one sentence ahead), both ended.
 */
function readToTheEnd() {
  page.article = articleOf(["First sentence of the stretch.", "Last sentence of the stretch."]);
  voice.startReading();
  assert.deepEqual(
    engine.spoken.map((utterance) => utterance.text.trim()),
    ["First sentence of the stretch.", "Last sentence of the stretch."],
  );
  const [first, last] = engine.spoken;
  first?.fire("end");
  runTimers();
  last?.fire("end");
  runTimers();
}

/** The page's side of the carry: the next text rendered, then the answer. */
function bringNextStretch() {
  voice.forgetReading(true);
  page.article = articleOf(["The next stretch begins here.", "And it goes on."]);
  voice.carryOnReading(true);
}

describe("the voice at the end of the text on screen", () => {
  it("ends the reading where the page has nothing more - every article, a book's last stretch", () => {
    readToTheEnd();
    assert.equal(page.finished, 1, "the page was not asked");
    assert.equal(voice.readingState(), "off");
    assert.deepEqual(page.states, ["playing", "off"]);
  });

  it("waits with its bar standing where the page brings more, and reads on from the first sentence", () => {
    page.more = true;
    readToTheEnd();
    assert.equal(page.finished, 1);
    assert.equal(voice.readingState(), "playing", "the bar went away in the gap");
    assert.deepEqual(page.states, ["playing"], "the bar was told about the gap");

    engine.spoken.length = 0;
    bringNextStretch();
    assert.equal(voice.readingState(), "playing");
    assert.deepEqual(
      engine.spoken.map((utterance) => utterance.text.trim()),
      ["The next stretch begins here.", "And it goes on."],
    );
    assert.ok(!page.states.includes("off"), "the reading was said to be over on the way");
  });

  it("carries on again at the end of the next stretch, and ends with the book", () => {
    page.more = true;
    readToTheEnd();
    engine.spoken.length = 0;
    bringNextStretch();
    const [first, last] = engine.spoken;
    // The book's last stretch: nothing follows.
    page.more = false;
    first?.fire("end");
    runTimers();
    last?.fire("end");
    runTimers();
    assert.equal(page.finished, 2);
    assert.equal(voice.readingState(), "off");
  });

  it("obeys a pause pressed in the gap: the next text arrives paused, and Play reads it", () => {
    page.more = true;
    readToTheEnd();
    voice.pauseReading();
    assert.equal(voice.readingState(), "paused");

    engine.spoken.length = 0;
    bringNextStretch();
    assert.equal(voice.readingState(), "paused");
    assert.equal(engine.spoken.length, 0, "a paused reading spoke when its text arrived");

    voice.toggleReading();
    assert.equal(voice.readingState(), "playing");
    assert.equal(engine.spoken[0]?.text.trim(), "The next stretch begins here.");
  });

  it("takes a pause back in the gap without speaking from a text that is not there yet", () => {
    page.more = true;
    readToTheEnd();
    voice.pauseReading();
    engine.spoken.length = 0;
    voice.toggleReading();
    assert.equal(voice.readingState(), "playing");
    assert.equal(engine.spoken.length, 0, "the old text was read again in the gap");
    assert.equal(page.finished, 1, "the page was asked for the next stretch twice");

    bringNextStretch();
    assert.equal(engine.spoken[0]?.text.trim(), "The next stretch begins here.");
  });

  it("obeys a stop pressed in the gap: the next text arrives in silence", () => {
    page.more = true;
    readToTheEnd();
    voice.stopReading();
    assert.equal(voice.readingState(), "off");

    engine.spoken.length = 0;
    bringNextStretch();
    assert.equal(voice.readingState(), "off");
    assert.equal(engine.spoken.length, 0);
  });

  it("ends with any other render in the gap - a row of the contents, the way back to the list", () => {
    page.more = true;
    readToTheEnd();
    // Not the render the reading waits for.
    voice.forgetReading();
    assert.equal(voice.readingState(), "off");

    engine.spoken.length = 0;
    page.article = articleOf(["Some other document."]);
    voice.carryOnReading(true);
    assert.equal(engine.spoken.length, 0, "a late answer started a reading over another document");
  });

  it("ends where the page could not bring the text after all", () => {
    page.more = true;
    readToTheEnd();
    engine.spoken.length = 0;
    voice.forgetReading(true);
    voice.carryOnReading(false);
    assert.equal(voice.readingState(), "off");
    assert.equal(engine.spoken.length, 0);
  });

  it("does not take the word 'carrying' from a render nobody waits for", () => {
    page.article = articleOf(["One sentence.", "Another sentence."]);
    voice.startReading();
    assert.equal(voice.readingState(), "playing");
    // A book turning its own stretch under a voice that is mid-text: the
    // text being read is leaving the screen, and the reading with it.
    voice.forgetReading(true);
    assert.equal(voice.readingState(), "off");
  });

  it("steps over a stretch without a word in it", () => {
    page.more = true;
    readToTheEnd();
    assert.equal(page.finished, 1);
    // Pictures and nothing else: the page is asked for what follows.
    voice.forgetReading(true);
    page.article = articleOf([]);
    voice.carryOnReading(true);
    assert.equal(page.finished, 2);
    assert.equal(voice.readingState(), "playing");

    engine.spoken.length = 0;
    bringNextStretch();
    assert.equal(engine.spoken[0]?.text.trim(), "The next stretch begins here.");
  });

  it("goes on into what follows when a skip steps past the last sentence", () => {
    page.more = true;
    page.article = articleOf(["Only sentence of the stretch."]);
    voice.startReading();
    voice.skipSentence(1);
    assert.equal(page.finished, 1);
    assert.equal(voice.readingState(), "playing");
    // And a skip in the gap has no sentence to step from.
    voice.skipSentence(1);
    voice.skipSentence(-1);
    assert.equal(page.finished, 1);
  });

  it("keeps a change of voice in the gap for the text on its way", () => {
    page.more = true;
    readToTheEnd();
    engine.spoken.length = 0;
    voice.readingVoice({ lang: "en", voiceURI: undefined, rate: 1.5 });
    assert.equal(engine.spoken.length, 0, "the text that has been read was started again");
    bringNextStretch();
    assert.equal(engine.spoken[0]?.rate, 1.5);
    voice.readingVoice({ lang: "en", voiceURI: undefined, rate: 1 });
  });
});

describe("the reader's page when the voice reaches the end of a stretch", () => {
  const script = readFileSync(join(ROOT, "src/reader/reader.js"), "utf8");

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

  it("answers for a book with text to come, and for nothing else", () => {
    const carry = fn("carryReadingOn", "enterView");
    assert.match(carry, /if \(target === null \|\| target\.origin !== "book"\) return false;/);
    assert.match(carry, /if \(next >= target\.segmentCount\) return false;/);
    assert.match(script, /onFinished: carryReadingOn,/);
  });

  it("counts the text the voice read as finished, then opens what follows at its first line", () => {
    const carry = fn("carryReadingOn", "enterView");
    const counted = carry.indexOf("countFinished();");
    const opened = carry.indexOf("void openBook(target.url, next)");
    assert.ok(counted >= 0 && opened > counted, "the count comes while the text being left is on screen");
    // No target rides along: the top of the text, the first page by pages,
    // landed on as any opening is - with no turn signalled.
    assert.doesNotMatch(carry, /openBook\(target\.url, next, /);
  });

  it("tells the voice to read on only over the text it waited for", () => {
    const carry = fn("carryReadingOn", "enterView");
    assert.match(carry, /if \(voiceCarry !== awaited\) return;/);
    assert.match(
      carry,
      /carryOnReading\(\n\s+shown !== null &&\n\s+shown\.origin === "book" &&\n\s+shown\.url === awaited\.url &&\n\s+shown\.segmentIndex === awaited\.index,\n\s+\);/,
    );
  });

  it("lets the render the voice asked for keep the bar and an open sheet, and no other render", () => {
    const render = fn("renderArticle", "renderFacts");
    assert.match(
      render,
      /const carried =\n\s+voiceCarry !== null &&\n\s+piece\.origin === "book" &&\n\s+piece\.url === voiceCarry\.url &&\n\s+piece\.segment\?\.index === voiceCarry\.index;/,
    );
    assert.match(render, /forgetReading\(carried\);/);
    assert.match(render, /if \(!carried\) enterView\("doc"\);/);
  });
});
