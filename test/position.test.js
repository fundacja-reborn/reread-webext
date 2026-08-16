import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  asPosition,
  blockAtLine,
  positionRecord,
  restoredIndex,
} from "../src/lib/reader/position.js";

describe("positionRecord", () => {
  it("builds the row a save writes", () => {
    assert.deepEqual(positionRecord("https://example.com/a", 0, 12, 1000), {
      docId: "https://example.com/a",
      segmentIndex: 0,
      blockIndex: 12,
      updatedAt: 1000,
    });
  });

  it("refuses a place that belongs to nothing or points nowhere", () => {
    assert.equal(positionRecord("", 0, 1, 1000), null);
    assert.equal(positionRecord("doc", -1, 1, 1000), null);
    assert.equal(positionRecord("doc", 0, -1, 1000), null);
    assert.equal(positionRecord("doc", 0, 1.5, 1000), null);
    assert.equal(positionRecord("doc", 0, NaN, 1000), null);
    assert.equal(positionRecord("doc", 0, 1, Infinity), null);
  });
});

describe("asPosition", () => {
  it("narrows a stored row field by field", () => {
    assert.deepEqual(asPosition({ docId: "doc", segmentIndex: 2, blockIndex: 7, updatedAt: 5 }), {
      docId: "doc",
      segmentIndex: 2,
      blockIndex: 7,
      updatedAt: 5,
    });
  });

  it("reads half an anchor as no anchor at all", () => {
    assert.equal(asPosition(null), null);
    assert.equal(asPosition(undefined), null);
    assert.equal(asPosition("doc"), null);
    assert.equal(asPosition({ docId: "doc", segmentIndex: 0 }), null);
    assert.equal(asPosition({ docId: "", segmentIndex: 0, blockIndex: 0 }), null);
    assert.equal(asPosition({ docId: "doc", segmentIndex: 0, blockIndex: 0.5 }), null);
    assert.equal(asPosition({ docId: "doc", segmentIndex: -1, blockIndex: 0 }), null);
  });

  it("keeps the place even when the timestamp is broken", () => {
    const kept = asPosition({ docId: "doc", segmentIndex: 0, blockIndex: 3, updatedAt: "when" });
    assert.deepEqual(kept, { docId: "doc", segmentIndex: 0, blockIndex: 3, updatedAt: 0 });
  });
});

describe("restoredIndex", () => {
  const position = { docId: "doc", segmentIndex: 0, blockIndex: 4, updatedAt: 1 };

  it("answers the stored block while it is still a place in the document", () => {
    assert.equal(restoredIndex(position, 0, 10), 4);
    assert.equal(restoredIndex(position, 0, 5), 4);
  });

  it("answers the top for no record at all", () => {
    assert.equal(restoredIndex(null, 0, 10), null);
  });

  it("answers the top for a record about another segment", () => {
    assert.equal(restoredIndex(position, 1, 10), null);
  });

  it("answers the top once the document has fewer blocks than the anchor", () => {
    assert.equal(restoredIndex(position, 0, 4), null);
    assert.equal(restoredIndex(position, 0, 0), null);
  });
});

describe("blockAtLine", () => {
  /** @param {number[]} bottoms */
  const rects = (...bottoms) => bottoms.map((bottom) => ({ bottom }));

  it("names the first block whose bottom is still below the line", () => {
    assert.equal(blockAtLine(rects(40, 90, 200), 60), 1);
    assert.equal(blockAtLine(rects(40, 90, 200), 0), 0);
  });

  it("a block ending exactly on the line is above it, not under it", () => {
    assert.equal(blockAtLine(rects(40, 90, 200), 90), 2);
  });

  it("scrolled past everything means the last block", () => {
    assert.equal(blockAtLine(rects(40, 90, 200), 500), 2);
  });

  it("an empty document has no place at all", () => {
    assert.equal(blockAtLine([], 60), null);
  });
});
