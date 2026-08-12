import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { openVocabulary } from "../src/background/vocab-tab.js";
import { VOCAB_TAB_KEY } from "../src/lib/session.js";
import { fakeBrowser } from "./fake-browser.js";

const VOCAB_URL = "moz-extension://uuid/vocab/vocab.html";

/**
 * @param {{ tabs?: import("./fake-browser.js").FakeTab[], session?: Record<string, unknown> }} [initial]
 */
function vocab(initial) {
  const { state, api } = fakeBrowser(initial);
  return { state, deps: { ...api, url: VOCAB_URL } };
}

describe("opening the saved-phrases page", () => {
  it("opens a tab when there is none, and remembers it", async () => {
    const { state, deps } = vocab();

    await openVocabulary(deps);

    assert.deepEqual(state.created, [VOCAB_URL]);
    assert.equal(state.stored[VOCAB_TAB_KEY], 100);
  });

  it("goes back to the remembered tab instead of opening a second one", async () => {
    const { state, deps } = vocab({
      tabs: [{ id: 7, windowId: 3 }],
      session: { [VOCAB_TAB_KEY]: 7 },
    });

    await openVocabulary(deps);

    assert.deepEqual(state.created, []);
    assert.equal(state.selected, 7);
    assert.equal(state.focusedWindow, 3);
  });

  it("opens a new tab when the remembered one is gone, and remembers that one", async () => {
    const { state, deps } = vocab({ session: { [VOCAB_TAB_KEY]: 7 } });

    await openVocabulary(deps);

    assert.deepEqual(state.created, [VOCAB_URL]);
    assert.equal(state.stored[VOCAB_TAB_KEY], 100);
  });

  it("keeps its tab apart from the reader's", async () => {
    // Both pages remember a tab; a shared key would make one button close in
    // on the other's page.
    const { state, deps } = vocab({
      tabs: [{ id: 7, windowId: 3 }],
      session: { readerTabId: 7 },
    });

    await openVocabulary(deps);

    assert.deepEqual(state.created, [VOCAB_URL]);
    assert.equal(state.stored[VOCAB_TAB_KEY], 100);
    assert.equal(state.stored["readerTabId"], 7);
  });
});
