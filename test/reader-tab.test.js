import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { openLibrary, openMarks, openReader, readInReader } from "../src/background/reader-tab.js";
import { READER_SOURCE_KEY, READER_TAB_KEY, readReaderSource } from "../src/lib/session.js";
import { fakeBrowser } from "./fake-browser.js";

const READER_URL = "moz-extension://uuid/reader/reader.html";

/**
 * @param {{ tabs?: import("./fake-browser.js").FakeTab[], session?: Record<string, unknown> }} [initial]
 */
function reader(initial) {
  const { state, api } = fakeBrowser(initial);
  return { state, deps: { ...api, url: READER_URL, now: () => 1000 } };
}

describe("opening the reader", () => {
  it("opens a tab when there is none, and remembers it", async () => {
    const { state, deps } = reader();

    await openReader(deps);

    assert.deepEqual(state.created, [READER_URL]);
    assert.equal(state.stored[READER_TAB_KEY], 100);
  });

  it("goes back to the remembered tab instead of opening a second one", async () => {
    const { state, deps } = reader({
      tabs: [{ id: 7, windowId: 3 }],
      session: { [READER_TAB_KEY]: 7 },
    });

    await openReader(deps);

    assert.deepEqual(state.created, []);
    assert.equal(state.selected, 7);
    assert.equal(state.stored[READER_TAB_KEY], 7);
  });

  it("focuses the window the reader is in, not only the tab", async () => {
    const { state, deps } = reader({
      tabs: [{ id: 7, windowId: 3 }],
      session: { [READER_TAB_KEY]: 7 },
    });

    await openReader(deps);

    assert.equal(state.focusedWindow, 3);
  });

  it("counts a selected tab in a window that just closed as opened", async () => {
    const { state, deps } = reader({
      tabs: [{ id: 7, windowId: 3 }],
      session: { [READER_TAB_KEY]: 7 },
    });
    state.windowGone = true;

    await openReader(deps);

    // The reader is selected; a second one would be the bug this module is for.
    assert.deepEqual(state.created, []);
    assert.equal(state.selected, 7);
  });

  it("opens a new tab when the remembered one is gone, and remembers that one", async () => {
    const { state, deps } = reader({ session: { [READER_TAB_KEY]: 7 } });

    await openReader(deps);

    assert.deepEqual(state.created, [READER_URL]);
    assert.equal(state.stored[READER_TAB_KEY], 100);
  });

  it("opens one tab per press when nothing is ever remembered", async () => {
    const { state, deps } = reader();
    state.createWithoutId = true;

    await openReader(deps);
    await openReader(deps);

    assert.equal(state.created.length, 2);
    // Nothing to come back to beats an id that was already stale.
    assert.equal(READER_TAB_KEY in state.stored, false);
  });

  it("ignores a remembered value that is not a tab id", async () => {
    const { state, deps } = reader({ session: { [READER_TAB_KEY]: "7" } });

    await openReader(deps);

    assert.deepEqual(state.created, [READER_URL]);
    assert.equal(state.stored[READER_TAB_KEY], 100);
  });
});

describe("the toolbar button", () => {
  it("points the reader at the tab it was pressed on, then opens it", async () => {
    const { state, deps } = reader({ tabs: [{ id: 4, windowId: 1 }] });

    await readInReader({ id: 4 }, deps);

    assert.deepEqual(state.stored[READER_SOURCE_KEY], { tabId: 4, at: 1000 });
    assert.deepEqual(state.created, [READER_URL]);
  });

  it("points it somewhere else when pressed on another page", async () => {
    const { state, deps } = reader({
      tabs: [{ id: 4 }, { id: 5 }, { id: 7, windowId: 3 }],
      session: { [READER_TAB_KEY]: 7, [READER_SOURCE_KEY]: { tabId: 4, at: 1 } },
    });

    await readInReader({ id: 5 }, deps);

    assert.deepEqual(state.stored[READER_SOURCE_KEY], { tabId: 5, at: 1000 });
    // Same reader, brought forward - not a second one.
    assert.deepEqual(state.created, []);
    assert.equal(state.selected, 7);
  });

  it("re-points at the same tab, so pressing twice reaches a reader already open", async () => {
    const { state, deps } = reader({
      tabs: [{ id: 4 }, { id: 7, windowId: 3 }],
      session: { [READER_TAB_KEY]: 7, [READER_SOURCE_KEY]: { tabId: 4, at: 1 } },
    });

    await readInReader({ id: 4 }, deps);

    // The tab is the same one; the timestamp is what makes this a change the
    // reader hears about at all.
    assert.deepEqual(state.stored[READER_SOURCE_KEY], { tabId: 4, at: 1000 });
  });

  it("pressed on the reader itself, only brings it forward", async () => {
    const { state, deps } = reader({
      tabs: [{ id: 7, windowId: 3 }],
      session: { [READER_TAB_KEY]: 7, [READER_SOURCE_KEY]: { tabId: 4, at: 1 } },
    });

    await readInReader({ id: 7 }, deps);

    // Pointing the reader at itself would replace an article with the reader.
    assert.deepEqual(state.stored[READER_SOURCE_KEY], { tabId: 4, at: 1 });
    assert.deepEqual(state.created, []);
  });

  it("opens the reader even when the press came from a tab with no id", async () => {
    const { state, deps } = reader();

    await readInReader({}, deps);

    assert.deepEqual(state.created, [READER_URL]);
    assert.equal(READER_SOURCE_KEY in state.stored, false);
  });
});

describe("the reading list entry", () => {
  it("points the reader at nothing, then opens it", async () => {
    const { state, deps } = reader();

    await openLibrary(deps);

    assert.deepEqual(state.created, [READER_URL]);
    // Written, not removed - the write is the signal a standing reader hears.
    assert.deepEqual(state.stored[READER_SOURCE_KEY], { at: 1000 });
  });

  it("replaces a source the reader was pointed at, and only raises the tab", async () => {
    const { state, deps } = reader({
      tabs: [{ id: 7, windowId: 3 }],
      session: { [READER_TAB_KEY]: 7, [READER_SOURCE_KEY]: { tabId: 4, at: 1 } },
    });

    await openLibrary(deps);

    assert.deepEqual(state.stored[READER_SOURCE_KEY], { at: 1000 });
    assert.deepEqual(state.created, []);
    assert.equal(state.selected, 7);
  });

  it("writes a value the reader reads back as no source at all", async () => {
    const { state, deps } = reader();

    await openLibrary(deps);

    assert.equal(await readReaderSource(deps.session), null);
    // The sentinel still is a change, which a removal of an absent key is not.
    assert.equal(READER_SOURCE_KEY in state.stored, true);
  });
});

describe("the highlights entry", () => {
  it("points the reader at the highlights page, then opens it", async () => {
    const { state, deps } = reader();

    await openMarks(deps);

    assert.deepEqual(state.stored[READER_SOURCE_KEY], { marks: true, at: 1000 });
    assert.deepEqual(state.created, [READER_URL]);
  });

  it("replaces a source the reader was pointed at, and only raises the tab", async () => {
    const { state, deps } = reader({
      tabs: [{ id: 7, windowId: 3 }],
      session: { [READER_TAB_KEY]: 7, [READER_SOURCE_KEY]: { tabId: 4, at: 1 } },
    });

    await openMarks(deps);

    assert.deepEqual(state.stored[READER_SOURCE_KEY], { marks: true, at: 1000 });
    assert.deepEqual(state.created, []);
    assert.equal(state.selected, 7);
  });

  it("writes a value the reader reads back as the highlights source", async () => {
    const { deps } = reader();

    await openMarks(deps);

    assert.deepEqual(await readReaderSource(deps.session), { marks: true, at: 1000 });
  });

  it("reads a marks flag that is not exactly true as no source", async () => {
    // The union is told apart by `marks: true` alone, so anything else in
    // that seat must fall out as garbage, not as a tab source.
    for (const marks of [false, 1, "true", {}]) {
      const { deps } = reader({ session: { [READER_SOURCE_KEY]: { marks, at: 5 } } });
      assert.equal(await readReaderSource(deps.session), null);
    }
  });
});
