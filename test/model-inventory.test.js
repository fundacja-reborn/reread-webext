import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  MODELS_KEY,
  asInventory,
  inventoryOf,
  modelPair,
  needsModelHint,
  writeInventory,
} from "../src/lib/models/inventory.js";
import { DEFAULTS } from "../src/lib/config.js";

/** @param {Partial<import("../src/lib/config.js").Config>} [over] */
function config(over = {}) {
  return { ...DEFAULTS, ...over };
}

describe("modelPair", () => {
  it("is the store's concatenation", () => {
    assert.equal(modelPair("en", "pl"), "enpl");
  });
});

describe("inventoryOf", () => {
  it("keeps exactly the stored pair ids", () => {
    assert.deepEqual(inventoryOf([{ pair: "enpl" }, { pair: "deen" }]), {
      pairs: ["enpl", "deen"],
    });
    assert.deepEqual(inventoryOf([]), { pairs: [] });
  });
});

describe("asInventory", () => {
  it("answers null for anything that is not an inventory - which reads as 'nobody has said'", () => {
    assert.equal(asInventory(undefined), null);
    assert.equal(asInventory(null), null);
    assert.equal(asInventory("enpl"), null);
    assert.equal(asInventory({}), null);
    assert.equal(asInventory({ pairs: "enpl" }), null);
  });

  it("keeps the rows that are pair ids and drops the rest", () => {
    assert.deepEqual(asInventory({ pairs: ["enpl", "", 7, null, "deen"] }), {
      pairs: ["enpl", "deen"],
    });
  });

  it("round-trips what inventoryOf wrote", () => {
    assert.deepEqual(asInventory(inventoryOf([{ pair: "enpl" }])), { pairs: ["enpl"] });
  });
});

describe("needsModelHint", () => {
  it("speaks on a written inventory that lacks the pair being read", () => {
    assert.equal(needsModelHint(config(), { pairs: [] }), true);
    assert.equal(needsModelHint(config(), { pairs: ["deen"] }), true);
  });

  it("stays quiet when the pair has a model", () => {
    assert.equal(needsModelHint(config(), { pairs: ["enpl"] }), false);
    assert.equal(
      needsModelHint(config({ sourceLang: "de", targetLang: "en" }), { pairs: ["deen"] }),
      false,
    );
  });

  it("stays quiet with no inventory at all - an older background may just not have written one", () => {
    assert.equal(needsModelHint(config(), null), false);
  });

  it("stays quiet with translation switched off - the reader was chosen for reading", () => {
    assert.equal(needsModelHint(config({ translationOff: true }), { pairs: [] }), false);
  });
});

describe("writeInventory", () => {
  afterEach(() => {
    globalThis.browser = undefined;
  });

  it("writes the whole inventory under its key", async () => {
    /** @type {Record<string, unknown>} */
    const store = {};
    globalThis.browser = /** @type {any} */ ({
      runtime: { id: "test@reread" },
      storage: {
        local: {
          /** @param {Record<string, unknown>} items */
          async set(items) {
            Object.assign(store, items);
          },
        },
      },
    });

    await writeInventory([{ pair: "enpl" }]);
    assert.deepEqual(store[MODELS_KEY], { pairs: ["enpl"] });
  });
});
