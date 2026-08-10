import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { ErrorCode, fail, ok } from "../src/lib/protocol.js";
import { MAX_INPUT_LENGTH, activeProviderId, setProvider, translate } from "../src/lib/translator/index.js";
import { noEngine } from "../src/lib/translator/providers/none.js";

afterEach(() => {
  setProvider(noEngine);
});

/**
 * @param {(input: { text: string, from: string, to: string }) => Promise<import("../src/lib/protocol.js").Result<string>>} translateFn
 * @returns {import("../src/lib/translator/index.js").Provider}
 */
function provider(translateFn) {
  return { id: "fake", translate: translateFn };
}

describe("translate", () => {
  it("starts with no engine, and says so rather than inventing a translation", async () => {
    assert.equal(activeProviderId(), "none");
    assert.deepEqual(await translate({ text: "hello", from: "en", to: "pl" }), fail(ErrorCode.ENGINE_MISSING));
  });

  it("answers an empty string for an empty selection without asking the engine", async () => {
    let asked = false;
    setProvider(
      provider(async () => {
        asked = true;
        return ok("should not happen");
      }),
    );

    assert.deepEqual(await translate({ text: "   ", from: "en", to: "pl" }), ok(""));
    assert.equal(asked, false);
  });

  it("refuses a selection longer than a tooltip is for", async () => {
    const text = "x".repeat(MAX_INPUT_LENGTH + 1);
    assert.deepEqual(await translate({ text, from: "en", to: "pl" }), fail(ErrorCode.TOO_LONG));
  });

  it("accepts a selection exactly at the limit", async () => {
    setProvider(provider(async (input) => ok(input.text.length.toString())));
    const text = "x".repeat(MAX_INPUT_LENGTH);

    assert.deepEqual(await translate({ text, from: "en", to: "pl" }), ok(String(MAX_INPUT_LENGTH)));
  });

  it("passes text through when both languages are the same", async () => {
    setProvider(
      provider(async () => {
        throw new Error("the engine should not have been asked");
      }),
    );

    assert.deepEqual(await translate({ text: "  hello  ", from: "en", to: "en" }), ok("hello"));
  });

  it("hands the engine text that is already trimmed", async () => {
    /** @type {string | null} */
    let seen = null;
    setProvider(
      provider(async (input) => {
        seen = input.text;
        return ok("witaj");
      }),
    );

    await translate({ text: "  hello ", from: "en", to: "pl" });
    assert.equal(seen, "hello");
  });

  it("turns a provider that throws into an error code, never an exception", async () => {
    setProvider(
      provider(async () => {
        throw new Error("model file is corrupt");
      }),
    );

    assert.deepEqual(await translate({ text: "hello", from: "en", to: "pl" }), fail(ErrorCode.INTERNAL));
  });

  it("passes a provider's own failure through unchanged", async () => {
    setProvider(provider(async () => fail(ErrorCode.MODEL_MISSING)));

    assert.deepEqual(await translate({ text: "hello", from: "en", to: "pl" }), fail(ErrorCode.MODEL_MISSING));
  });
});
