import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { READER_TAB_KEY, openReader } from "../src/background/reader-tab.js";

const READER_URL = "moz-extension://uuid/reader/reader.html";

/**
 * As much of a browser as this module talks to: tabs that exist, the one that
 * is selected, and which window each of them is in. Everything the tests assert
 * is readable from here afterwards, which is why it counts calls rather than
 * recording them.
 *
 * @param {{ tabs?: Array<{ id: number, windowId?: number }>, session?: Record<string, unknown> }} [initial]
 */
function fakeBrowser(initial = {}) {
  const tabs = new Map((initial.tabs ?? []).map((tab) => [tab.id, tab]));
  /** @type {Record<string, unknown>} */
  const stored = { ...(initial.session ?? {}) };

  const state = {
    stored,
    created: /** @type {string[]} */ ([]),
    selected: /** @type {number | null} */ (null),
    focusedWindow: /** @type {number | null} */ (null),
    nextId: 100,
    /** Set to fail the next `windows.update`, the way a closed window would. */
    windowGone: false,
    /** Set to make `tabs.create` answer without an id. */
    createWithoutId: false,
  };

  const api = {
    tabs: {
      /** @param {{ url: string }} properties */
      async create(properties) {
        state.created.push(properties.url);
        if (state.createWithoutId) return {};
        const tab = { id: state.nextId++, windowId: 1 };
        tabs.set(tab.id, tab);
        state.selected = tab.id;
        return tab;
      },
      /**
       * @param {number} tabId
       * @param {{ active?: boolean }} _properties
       */
      async update(tabId, _properties) {
        const tab = tabs.get(tabId);
        // What the browser does for an id that is no longer a tab, and the only
        // way this module can learn that without the `tabs` permission.
        if (tab === undefined) throw new Error(`Invalid tab ID: ${tabId}`);
        state.selected = tabId;
        return tab;
      },
    },
    windows: {
      /**
       * @param {number} windowId
       * @param {{ focused?: boolean }} _properties
       */
      async update(windowId, _properties) {
        if (state.windowGone) throw new Error(`Invalid window ID: ${windowId}`);
        state.focusedWindow = windowId;
        return {};
      },
    },
    session: {
      /** @param {string | string[] | null} [keys] */
      async get(keys) {
        if (typeof keys !== "string") return { ...stored };
        return keys in stored ? { [keys]: stored[keys] } : {};
      },
      /** @param {Record<string, unknown>} items */
      async set(items) {
        Object.assign(stored, items);
      },
      /** @param {string | string[]} keys */
      async remove(keys) {
        for (const key of typeof keys === "string" ? [keys] : keys) delete stored[key];
      },
    },
  };

  return { state, deps: { ...api, url: READER_URL } };
}

describe("opening the reader", () => {
  it("opens a tab when there is none, and remembers it", async () => {
    const { state, deps } = fakeBrowser();

    await openReader(deps);

    assert.deepEqual(state.created, [READER_URL]);
    assert.equal(state.stored[READER_TAB_KEY], 100);
  });

  it("goes back to the remembered tab instead of opening a second one", async () => {
    const { state, deps } = fakeBrowser({
      tabs: [{ id: 7, windowId: 3 }],
      session: { [READER_TAB_KEY]: 7 },
    });

    await openReader(deps);

    assert.deepEqual(state.created, []);
    assert.equal(state.selected, 7);
    assert.equal(state.stored[READER_TAB_KEY], 7);
  });

  it("focuses the window the reader is in, not only the tab", async () => {
    const { state, deps } = fakeBrowser({
      tabs: [{ id: 7, windowId: 3 }],
      session: { [READER_TAB_KEY]: 7 },
    });

    await openReader(deps);

    assert.equal(state.focusedWindow, 3);
  });

  it("counts a selected tab in a window that just closed as opened", async () => {
    const { state, deps } = fakeBrowser({
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
    const { state, deps } = fakeBrowser({ session: { [READER_TAB_KEY]: 7 } });

    await openReader(deps);

    assert.deepEqual(state.created, [READER_URL]);
    assert.equal(state.stored[READER_TAB_KEY], 100);
  });

  it("opens one tab per press when nothing is ever remembered", async () => {
    const { state, deps } = fakeBrowser();
    state.createWithoutId = true;

    await openReader(deps);
    await openReader(deps);

    assert.equal(state.created.length, 2);
    // Nothing to come back to beats an id that was already stale.
    assert.equal(READER_TAB_KEY in state.stored, false);
  });

  it("ignores a remembered value that is not a tab id", async () => {
    const { state, deps } = fakeBrowser({ session: { [READER_TAB_KEY]: "7" } });

    await openReader(deps);

    assert.deepEqual(state.created, [READER_URL]);
    assert.equal(state.stored[READER_TAB_KEY], 100);
  });
});
