import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ErrorCode, Message, asRequest, asResult, fail, ok } from "../src/lib/protocol.js";

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
    for (const kind of [Message.OPEN_READER, Message.OPEN_SETTINGS, Message.LIST_PHRASES]) {
      assert.deepEqual(asRequest({ kind }), { kind });
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
