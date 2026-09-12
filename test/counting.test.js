import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CountReport, ReadLedger, mergeCounts, tallyRead } from "../src/lib/counting.js";

describe("ReadLedger", () => {
  it("claims a part once per document, however the reader moves inside it", () => {
    const ledger = new ReadLedger();
    assert.equal(ledger.claim("book-1", 0), true);
    assert.equal(ledger.claim("book-1", 0), false);
    assert.equal(ledger.claim("book-1", 1), true);
    assert.equal(ledger.claim("book-1", 0), false, "back and forth is one reading");
  });

  it("is one document deep: another document forgets the first, and the first counts again", () => {
    const ledger = new ReadLedger();
    assert.equal(ledger.claim("book-1", 3), true);
    assert.equal(ledger.claim("https://example.org/article", 0), true);
    assert.equal(ledger.claim("https://example.org/article", 0), false);
    assert.equal(ledger.claim("book-1", 3), true);
  });
});

describe("tallyRead", () => {
  it("tallies painted occurrences by the saved phrase they belong to, forms included, sorted by key", () => {
    const aliases = new Map([
      ["reading", "read"],
      ["reads", "read"],
    ]);
    const vocabulary = new Set(["read", "bank"]);
    /** @param {string} normalized */
    const keyOf = (normalized) => {
      const key = aliases.get(normalized) ?? normalized;
      return vocabulary.has(key) ? key : null;
    };
    assert.deepEqual(tallyRead(["reading", "bank", "read", "reads", "bank", "river"], keyOf), [
      ["bank", 2],
      ["read", 3],
    ]);
  });

  it("tallies nothing from nothing, and nothing from what is nobody's", () => {
    assert.deepEqual(tallyRead([], () => null), []);
    assert.deepEqual(tallyRead(["gone"], () => null), []);
  });
});

describe("mergeCounts", () => {
  it("adds a report up by key: every naming an opening, the tallies summed", () => {
    const merged = mergeCounts({
      recalled: ["bank", "read", "bank"],
      read: [
        ["read", 3],
        ["shore", 1],
        ["read", 2],
      ],
    });
    assert.deepEqual([...merged], [
      ["bank", { recalled: 2, read: 0 }],
      ["read", { recalled: 1, read: 5 }],
      ["shore", { recalled: 0, read: 1 }],
    ]);
  });

  it("adds an empty report up to nothing", () => {
    assert.equal(mergeCounts({ recalled: [], read: [] }).size, 0);
  });
});

describe("CountReport", () => {
  it("gathers openings and tallies and hands them over once", () => {
    const report = new CountReport();
    assert.equal(report.isEmpty(), true);
    assert.equal(report.take(), null);

    report.recalled("bank");
    report.read([["read", 3]]);
    report.recalled("bank");
    assert.equal(report.isEmpty(), false);
    assert.deepEqual(report.take(), { recalled: ["bank", "bank"], read: [["read", 3]] });

    assert.equal(report.isEmpty(), true);
    assert.equal(report.take(), null);
  });
});
