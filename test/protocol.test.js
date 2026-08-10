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

  it("accepts an open-reader request", () => {
    assert.deepEqual(asRequest({ kind: Message.OPEN_READER }), { kind: Message.OPEN_READER });
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
