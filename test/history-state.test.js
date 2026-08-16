import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { asDocState, docState } from "../src/lib/reader/history-state.js";

describe("history state", () => {
  it("reads back exactly what it wrote", () => {
    assert.deepEqual(asDocState(docState("article", "https://example.com/a")), {
      kind: "article",
      url: "https://example.com/a",
    });
    assert.deepEqual(asDocState(docState("book", "book:1f2e")), {
      kind: "book",
      url: "book:1f2e",
    });
  });

  it("answers null for every entry that is not a document's", () => {
    // The base entry the page loaded on, and the shapes history can hand over.
    assert.equal(asDocState(null), null);
    assert.equal(asDocState(undefined), null);
    assert.equal(asDocState("doc"), null);
    assert.equal(asDocState(42), null);
    assert.equal(asDocState({}), null);
    assert.equal(asDocState([]), null);
  });

  it("refuses an entry without our mark, whatever else it carries", () => {
    // `history.state` is shared ground: anything that ever ran on this page
    // may have written to it, and a lookalike is not an invitation.
    assert.equal(asDocState({ kind: "article", url: "https://example.com/a" }), null);
    assert.equal(asDocState({ reread: "list", kind: "article", url: "https://a" }), null);
  });

  it("refuses a marked entry whose fields do not hold", () => {
    // An entry can outlive the build that wrote it - a restored session
    // carries state from before an update - so every field is checked.
    assert.equal(asDocState({ reread: "doc", kind: "page", url: "https://a" }), null);
    assert.equal(asDocState({ reread: "doc", kind: "article" }), null);
    assert.equal(asDocState({ reread: "doc", kind: "article", url: "" }), null);
    assert.equal(asDocState({ reread: "doc", kind: "article", url: 7 }), null);
  });

  it("hands back only the two fields, whatever extra a state carried", () => {
    const state = { reread: "doc", kind: "book", url: "book:9", extra: "noise" };
    assert.deepEqual(asDocState(state), { kind: "book", url: "book:9" });
  });
});
