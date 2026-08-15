import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { asPageRequest, asRequest } from "../src/lib/protocol.js";
import {
  asEngineCall,
  engineCall,
} from "../src/lib/translator/providers/bergamot/host-protocol.js";

describe("the background-to-engine-host channel", () => {
  it("round-trips a job", () => {
    const job = { text: "una frase", from: "es", to: "en", context: "Es una frase corta." };
    assert.deepEqual(asEngineCall(engineCall(job)), job);
  });

  it("drops a context that is not a string, keeps the job", () => {
    const call = /** @type {Record<string, unknown>} */ (
      engineCall({ text: "word", from: "de", to: "en" })
    );
    call["job"] = { text: "word", from: "de", to: "en", context: 7 };
    assert.deepEqual(asEngineCall(call), { text: "word", from: "de", to: "en" });
  });

  it("refuses everything that is not its own call", () => {
    for (const wrong of [
      null,
      undefined,
      "translate",
      {},
      { host: "somebody-else", job: { text: "a", from: "b", to: "c" } },
      { host: "bergamot-host" },
      { host: "bergamot-host", job: null },
      { host: "bergamot-host", job: { text: "a", from: "b" } },
      { host: "bergamot-host", job: { text: 1, from: "b", to: "c" } },
      // The whole protocol.js family: addressed to the background, never here.
      { kind: "translate", text: "a" },
      { kind: "page-info" },
    ]) {
      assert.equal(asEngineCall(wrong), null);
    }
  });

  it("is invisible to every other listener's narrowing", () => {
    // The load-bearing invariant of the channel: `runtime.sendMessage` reaches
    // every open extension page, and the reader and content scripts answer
    // whatever their narrowing accepts. An engine call slipping through either
    // one would race the host for `sendResponse`.
    const call = engineCall({ text: "una frase", from: "es", to: "en" });
    assert.equal(asRequest(call), null);
    assert.equal(asPageRequest(call), null);
  });
});
