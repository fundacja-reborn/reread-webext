import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_MARK_COLOR,
  asMark,
  compareMarks,
  comparePoints,
  isMarkColor,
  markRecord,
  marksInSegment,
  mergePlan,
  placeMark,
  quoteOf,
  withoutMark,
} from "../src/lib/reader/marks.js";

/**
 * A whole mark with sensible defaults, so a test names only what it is about.
 *
 * @param {Partial<import("../src/lib/reader/marks.js").Mark>} [over]
 * @returns {import("../src/lib/reader/marks.js").Mark}
 */
function mark(over = {}) {
  const built = markRecord({
    segmentIndex: 0,
    start: { block: 0, offset: 0 },
    end: { block: 0, offset: 5 },
    color: "yellow",
    createdAt: 1000,
    text: "quote",
    ...over,
  });
  assert.notEqual(built, null);
  return /** @type {import("../src/lib/reader/marks.js").Mark} */ (built);
}

describe("markRecord", () => {
  it("builds the record a finished stroke writes", () => {
    assert.deepEqual(
      markRecord({
        segmentIndex: 2,
        start: { block: 3, offset: 14 },
        end: { block: 5, offset: 9 },
        color: "yellow",
        createdAt: 1234,
        text: "across three blocks",
      }),
      {
        segmentIndex: 2,
        start: { block: 3, offset: 14 },
        end: { block: 5, offset: 9 },
        color: "yellow",
        createdAt: 1234,
        text: "across three blocks",
      },
    );
  });

  it("refuses a span that does not run forward", () => {
    // Backwards, empty, and the end standing at the very start of a block -
    // a mark "ending" there really ends in the block before.
    assert.equal(
      markRecord({
        segmentIndex: 0,
        start: { block: 1, offset: 5 },
        end: { block: 1, offset: 5 },
        color: "yellow",
        createdAt: 1,
        text: "x",
      }),
      null,
    );
    assert.equal(
      markRecord({
        segmentIndex: 0,
        start: { block: 2, offset: 0 },
        end: { block: 1, offset: 4 },
        color: "yellow",
        createdAt: 1,
        text: "x",
      }),
      null,
    );
    assert.equal(
      markRecord({
        segmentIndex: 0,
        start: { block: 0, offset: 3 },
        end: { block: 1, offset: 0 },
        color: "yellow",
        createdAt: 1,
        text: "x",
      }),
      null,
    );
  });

  it("refuses what it cannot paint or guard with", () => {
    assert.equal(markRecord({ ...mark(), color: "chartreuse" }), null);
    assert.equal(markRecord({ ...mark(), text: "" }), null);
    assert.equal(markRecord({ ...mark(), createdAt: Infinity }), null);
    assert.equal(markRecord({ ...mark(), segmentIndex: -1 }), null);
    assert.equal(
      markRecord({ ...mark(), start: { block: 0, offset: 1.5 } }),
      null,
    );
  });
});

describe("asMark", () => {
  it("narrows a stored mark field by field", () => {
    const stored = mark({ segmentIndex: 1, createdAt: 77 });
    assert.deepEqual(asMark(JSON.parse(JSON.stringify(stored))), stored);
  });

  it("heals what can heal and drops what cannot", () => {
    // An unknown colour is still somebody's mark: it comes back in the
    // default rather than not at all. Half an anchor or no quote is not.
    assert.equal(asMark({ ...mark(), color: "ultraviolet" })?.color, DEFAULT_MARK_COLOR);
    assert.equal(asMark({ ...mark(), createdAt: "yesterday" })?.createdAt, 0);
    assert.equal(asMark(null), null);
    assert.equal(asMark({ ...mark(), start: undefined }), null);
    assert.equal(asMark({ ...mark(), end: { block: 0 } }), null);
    assert.equal(asMark({ ...mark(), text: 7 }), null);
  });
});

describe("the order of marks", () => {
  it("compares points block-major", () => {
    assert.ok(comparePoints({ block: 1, offset: 90 }, { block: 2, offset: 0 }) < 0);
    assert.ok(comparePoints({ block: 2, offset: 5 }, { block: 2, offset: 4 }) > 0);
    assert.equal(comparePoints({ block: 3, offset: 3 }, { block: 3, offset: 3 }), 0);
  });

  it("orders marks segment first, then by where they begin", () => {
    const early = mark({ start: { block: 0, offset: 2 }, end: { block: 0, offset: 4 } });
    const late = mark({ start: { block: 4, offset: 0 }, end: { block: 4, offset: 2 } });
    const nextPart = mark({ segmentIndex: 1, start: { block: 0, offset: 0 }, end: { block: 0, offset: 2 } });
    assert.ok(compareMarks(early, late) < 0);
    assert.ok(compareMarks(late, nextPart) < 0);
  });
});

describe("mergePlan", () => {
  const standing = () => [
    mark({ start: { block: 1, offset: 10 }, end: { block: 1, offset: 20 }, text: "one" }),
    mark({ start: { block: 3, offset: 0 }, end: { block: 4, offset: 8 }, text: "two" }),
    mark({ segmentIndex: 1, start: { block: 1, offset: 12 }, end: { block: 1, offset: 18 }, text: "other part" }),
  ];

  it("absorbs nothing when the stroke stands alone", () => {
    const plan = mergePlan(standing(), {
      segmentIndex: 0,
      start: { block: 6, offset: 0 },
      end: { block: 6, offset: 4 },
    });
    assert.equal(plan.absorbed.length, 0);
    assert.deepEqual(plan.span.start, { block: 6, offset: 0 });
  });

  it("grows the stroke to cover every mark it overlaps or touches", () => {
    // Overlapping the first, touching the second end to start, crossing a
    // block boundary on the way: one stroke, one union.
    const marks = standing();
    const plan = mergePlan(marks, {
      segmentIndex: 0,
      start: { block: 1, offset: 15 },
      end: { block: 3, offset: 0 },
    });
    assert.deepEqual(plan.absorbed, [marks[0], marks[1]]);
    assert.deepEqual(plan.span, {
      segmentIndex: 0,
      start: { block: 1, offset: 10 },
      end: { block: 4, offset: 8 },
    });
  });

  it("never reaches into another segment", () => {
    // The same block numbers exist in every part of a book; only the same
    // part's marks are this stroke's to absorb.
    const plan = mergePlan(standing(), {
      segmentIndex: 1,
      start: { block: 1, offset: 0 },
      end: { block: 1, offset: 30 },
    });
    assert.equal(plan.absorbed.length, 1);
    assert.equal(plan.absorbed[0]?.text, "other part");
  });

  it("leaves marks that merely stand near", () => {
    const plan = mergePlan(standing(), {
      segmentIndex: 0,
      start: { block: 1, offset: 21 },
      end: { block: 1, offset: 30 },
    });
    // One offset short of touching: still two marks, and the seam is real.
    assert.equal(plan.absorbed.length, 0);
  });
});

describe("placeMark and withoutMark", () => {
  it("replaces the absorbed and keeps the reading order", () => {
    const a = mark({ start: { block: 0, offset: 0 }, end: { block: 0, offset: 3 }, text: "a" });
    const b = mark({ start: { block: 2, offset: 0 }, end: { block: 2, offset: 3 }, text: "b" });
    const c = mark({ start: { block: 5, offset: 0 }, end: { block: 5, offset: 3 }, text: "c" });
    const grown = mark({ start: { block: 1, offset: 0 }, end: { block: 2, offset: 9 }, text: "bc" });

    const placed = placeMark([a, b, c], [b], grown);
    assert.deepEqual(placed.map((one) => one.text), ["a", "bc", "c"]);
  });

  it("takes one mark and only that mark", () => {
    const a = mark({ text: "a" });
    const twin = mark({ text: "a" });
    const left = withoutMark([a, twin], twin);
    // Identity, not likeness: two marks can quote the same words, and the
    // delete bubble means the one that was tapped.
    assert.deepEqual(left, [a]);
  });
});

describe("marksInSegment", () => {
  it("answers one part of a book", () => {
    const here = mark({ segmentIndex: 2 });
    const elsewhere = mark({ segmentIndex: 3 });
    assert.deepEqual(marksInSegment([here, elsewhere], 2), [here]);
  });
});

describe("quoteOf", () => {
  it("reads a span inside one block", () => {
    assert.equal(
      quoteOf(["the quick brown fox"], { block: 4, offset: 4 }, { block: 4, offset: 9 }),
      "quick",
    );
  });

  it("reads across blocks with a line break at every boundary", () => {
    assert.equal(
      quoteOf(
        ["first paragraph", "the middle one", "and the last"],
        { block: 1, offset: 6 },
        { block: 3, offset: 3 },
      ),
      "paragraph\nthe middle one\nand",
    );
  });

  it("refuses offsets the prose cannot hold - the quote guard's teeth", () => {
    assert.equal(quoteOf(["short"], { block: 0, offset: 5 }, { block: 0, offset: 6 }), null);
    assert.equal(quoteOf(["short"], { block: 0, offset: 0 }, { block: 0, offset: 9 }), null);
    assert.equal(quoteOf(["a", "b"], { block: 0, offset: 0 }, { block: 0, offset: 1 }), null);
    assert.equal(quoteOf([], { block: 0, offset: 0 }, { block: 0, offset: 1 }), null);
    assert.equal(quoteOf(["ab"], { block: 0, offset: 0 }, { block: 0, offset: 0 }), null);
  });
});
