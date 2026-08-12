import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ErrorCode,
  Message,
  asPage,
  asPageInfo,
  asPageRequest,
  asRequest,
  asResult,
  asTranslation,
  fail,
  ok,
} from "../src/lib/protocol.js";

describe("asTranslation", () => {
  const ENTRY = { dictionary: "Test", headword: "bank", senses: ["brzeg", "instytucja"] };

  it("passes a well-formed translation through", () => {
    assert.deepEqual(asTranslation({ gloss: "bank", sentence: "Brzeg był stromy.", entries: [ENTRY] }), {
      gloss: "bank",
      sentence: "Brzeg był stromy.",
      entries: [ENTRY],
    });
  });

  it("keeps the gloss when there is no sentence", () => {
    assert.deepEqual(asTranslation({ gloss: "bank", sentence: null }), {
      gloss: "bank",
      sentence: null,
      entries: [],
    });
  });

  /**
   * A page can be running a content script from before an update while the
   * background is already the new one. Whatever comes back, the bubble may not
   * throw into somebody else's console.
   */
  it("turns anything else into an empty translation rather than throwing", () => {
    for (const value of [null, undefined, "bank", 42, [], {}, { gloss: 7 }, { sentence: "only" }]) {
      assert.deepEqual(asTranslation(value), { gloss: "", sentence: null, entries: [] });
    }
  });

  it("drops a sentence that is not a string, keeping the gloss", () => {
    assert.deepEqual(asTranslation({ gloss: "bank", sentence: 42 }), {
      gloss: "bank",
      sentence: null,
      entries: [],
    });
  });

  it("answers with an array of entries whatever arrived in their place", () => {
    for (const entries of [undefined, null, "brzeg", 42, {}, [null], [{ senses: "brzeg" }], [{ senses: [] }]]) {
      assert.deepEqual(asTranslation({ gloss: "bank", sentence: null, entries }).entries, []);
    }
  });

  it("keeps the entries that are whole and drops the ones that are not", () => {
    const mixed = asTranslation({
      gloss: "bank",
      sentence: null,
      entries: [ENTRY, { dictionary: "Broken" }, { senses: ["ok", 42, ""] }],
    });

    assert.deepEqual(mixed.entries, [ENTRY, { dictionary: "", headword: "", senses: ["ok"] }]);
  });

  it("has no second layer to offer when there is no gloss to offer it with", () => {
    assert.deepEqual(asTranslation({ gloss: "", sentence: "Brzeg był stromy.", entries: [ENTRY] }), {
      gloss: "",
      sentence: null,
      entries: [],
    });
  });
});

describe("asRequest", () => {
  it("accepts a translate request", () => {
    assert.deepEqual(asRequest({ kind: Message.TRANSLATE, text: "hello" }), {
      kind: Message.TRANSLATE,
      text: "hello",
    });
  });

  it("drops fields it was not asked for", () => {
    assert.deepEqual(asRequest({ kind: Message.TRANSLATE, text: "hello", url: "https://example.com" }), {
      kind: Message.TRANSLATE,
      text: "hello",
    });
  });

  it("keeps the sentence a translate request carries", () => {
    assert.deepEqual(asRequest({ kind: Message.TRANSLATE, text: "bank", context: "The bank was steep." }), {
      kind: Message.TRANSLATE,
      text: "bank",
      context: "The bank was steep.",
    });
  });

  it("drops a sentence that is not one, rather than refusing the translation", () => {
    for (const context of [42, null, {}, ["a"], undefined]) {
      assert.deepEqual(asRequest({ kind: Message.TRANSLATE, text: "bank", context }), {
        kind: Message.TRANSLATE,
        text: "bank",
      });
    }
  });

  it("accepts the requests that carry nothing", () => {
    for (const kind of [
      Message.OPEN_READER,
      Message.OPEN_LIBRARY,
      Message.OPEN_VOCABULARY,
      Message.OPEN_SETTINGS,
      Message.LIST_PHRASES,
    ]) {
      assert.deepEqual(asRequest({ kind }), { kind });
    }
  });

  it("lets open-library carry nothing even when something was sent along", () => {
    // The whole point of the kind is that it is not about any tab.
    assert.deepEqual(asRequest({ kind: Message.OPEN_LIBRARY, sourceTabId: 42 }), {
      kind: Message.OPEN_LIBRARY,
    });
  });

  it("lets open-vocabulary carry nothing even when something was sent along", () => {
    // Same rule as the reading list: the page shows the configured pair, and
    // neither a tab nor a pair may ride in.
    assert.deepEqual(asRequest({ kind: Message.OPEN_VOCABULARY, sourceTabId: 42, pair: "enpl" }), {
      kind: Message.OPEN_VOCABULARY,
    });
  });

  it("keeps the tab the reader is asked to read", () => {
    assert.deepEqual(asRequest({ kind: Message.OPEN_READER, sourceTabId: 42 }), {
      kind: Message.OPEN_READER,
      sourceTabId: 42,
    });
  });

  it("drops a tab id that is not one, rather than refusing the reader", () => {
    for (const sourceTabId of ["42", null, {}, [42], undefined]) {
      assert.deepEqual(asRequest({ kind: Message.OPEN_READER, sourceTabId }), {
        kind: Message.OPEN_READER,
      });
    }
  });

  it("accepts a save with its meanings", () => {
    assert.deepEqual(asRequest({ kind: Message.SAVE_PHRASE, text: "bank", translations: ["bank", "brzeg"] }), {
      kind: Message.SAVE_PHRASE,
      text: "bank",
      translations: ["bank", "brzeg"],
    });
  });

  it("rejects a save whose meanings are not a list of strings", () => {
    for (const translations of [undefined, "brzeg", 7, null, ["brzeg", 7], [{}]]) {
      assert.equal(
        asRequest({ kind: Message.SAVE_PHRASE, text: "bank", translations }),
        null,
        `should have rejected ${JSON.stringify(translations) ?? "undefined"}`,
      );
    }
  });

  it("rejects a save without the phrase it is about", () => {
    assert.equal(asRequest({ kind: Message.SAVE_PHRASE, translations: ["brzeg"] }), null);
  });

  it("accepts forgetting a phrase, and only with the phrase", () => {
    assert.deepEqual(asRequest({ kind: Message.FORGET_PHRASE, text: "bank" }), {
      kind: Message.FORGET_PHRASE,
      text: "bank",
    });
    assert.equal(asRequest({ kind: Message.FORGET_PHRASE }), null);
    assert.equal(asRequest({ kind: Message.FORGET_PHRASE, text: 42 }), null);
  });

  it("rejects a translate request without text", () => {
    assert.equal(asRequest({ kind: Message.TRANSLATE }), null);
  });

  it("rejects a translate request whose text is not a string", () => {
    assert.equal(asRequest({ kind: Message.TRANSLATE, text: 42 }), null);
  });

  it("rejects anything that is not one of ours", () => {
    for (const message of [null, undefined, 7, "translate", [], {}, { kind: "drop-database" }]) {
      assert.equal(asRequest(message), null, `should have rejected ${JSON.stringify(message) ?? "undefined"}`);
    }
  });
});

describe("asResult", () => {
  it("passes a well-formed answer through", () => {
    assert.deepEqual(asResult(ok("witaj")), ok("witaj"));
    assert.deepEqual(asResult(fail(ErrorCode.TOO_LONG)), fail(ErrorCode.TOO_LONG));
  });

  it("turns a broken answer into an internal error rather than throwing", () => {
    for (const response of [undefined, null, "ok", 1, {}]) {
      assert.deepEqual(asResult(response), fail(ErrorCode.INTERNAL));
    }
  });
});

describe("asPageRequest", () => {
  it("accepts the two questions a tab is asked", () => {
    assert.deepEqual(asPageRequest({ kind: Message.GRAB_PAGE }), { kind: Message.GRAB_PAGE });
    assert.deepEqual(asPageRequest({ kind: Message.PAGE_INFO }), { kind: Message.PAGE_INFO });
  });

  it("refuses everything addressed to the background", () => {
    // A content script that answered these would be answering questions meant
    // for the side that has the database and the engine.
    for (const kind of [
      Message.TRANSLATE,
      Message.READ_PAGE,
      Message.SAVE_PHRASE,
      Message.LIST_PHRASES,
      Message.OPEN_READER,
    ]) {
      assert.equal(asPageRequest({ kind, text: "word", translations: [] }), null, kind);
    }
  });

  it("refuses anything that is not a message", () => {
    for (const message of [null, undefined, 7, "grab-page", [], {}]) {
      assert.equal(asPageRequest(message), null);
    }
  });
});

describe("asPageInfo", () => {
  it("passes an ordinary page's answer through", () => {
    assert.deepEqual(asPageInfo({ hostname: "example.test" }), {
      hostname: "example.test",
      reader: false,
    });
  });

  it("answers for the reader without asking it for a hostname", () => {
    assert.deepEqual(asPageInfo({ reader: true }), { hostname: "", reader: true });
  });

  it("treats a page with no hostname like a page that never answered", () => {
    // `file:` mostly. There is no site to switch off, and the popup says so
    // the same way it does over `about:`.
    for (const value of [{ hostname: "" }, { hostname: 7 }, {}, null, undefined, "example.test", 7]) {
      assert.equal(asPageInfo(value), null, `should have refused ${JSON.stringify(value) ?? "undefined"}`);
    }
  });
});

describe("asPage", () => {
  const page = { url: "https://example.test/a", title: "A", html: "<html></html>" };

  it("passes a page through", () => {
    assert.deepEqual(asPage(page), page);
  });

  it("accepts a tab with no title, because the article carries its own", () => {
    assert.deepEqual(asPage({ ...page, title: undefined }), { ...page, title: "" });
  });

  it("refuses anything the reader could not parse", () => {
    for (const value of [
      null,
      undefined,
      "https://example.test/a",
      { ...page, url: 42 },
      { ...page, html: 42 },
      { ...page, html: "" },
      {},
    ]) {
      assert.equal(asPage(value), null, `should have refused ${JSON.stringify(value) ?? "undefined"}`);
    }
  });
});
