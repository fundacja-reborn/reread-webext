import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EXPORT_STAMP_KEY,
  STALE_AFTER_DAYS,
  ago,
  asStamp,
  backupReminder,
  grownSince,
  readExportStamp,
  stampOf,
  writeExportStamp,
} from "../src/lib/store/export-stamp.js";

/**
 * The stamp Export leaves and the line the reading list reads off it
 * (D288): the shape, the storage's stand-in, the growth since, the age in
 * words, and the one rule that puts the line in ink.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 27, 12, 0, 0);

/** @param {Partial<import("../src/lib/store/export-stamp.js").Held>} [held] */
function held(held = {}) {
  return { phrases: 0, articles: 0, books: 0, highlights: 0, ...held };
}

/** A storage that remembers one value, and can be told to fail. */
function storage() {
  /** @type {unknown} */
  let kept;
  let broken = false;
  return {
    deps: {
      read: async () => {
        if (broken) throw new Error("storage gone");
        return kept;
      },
      write: async (/** @type {unknown} */ stamp) => {
        if (broken) throw new Error("storage gone");
        kept = stamp;
      },
    },
    stored: () => kept,
    /** @param {unknown} value */
    plant: (value) => {
      kept = value;
    },
    breakIt: () => {
      broken = true;
    },
  };
}

describe("the export stamp", () => {
  it("is the moment and the four counts, under one key in storage.local", () => {
    assert.equal(EXPORT_STAMP_KEY, "backupExport");
    const stamp = stampOf(NOW, held({ phrases: 856, articles: 12, books: 2, highlights: 41 }));
    assert.deepEqual(stamp, {
      version: 1,
      at: NOW,
      held: { phrases: 856, articles: 12, books: 2, highlights: 41 },
    });
  });

  it("reads back what it wrote, and unknown fields are left behind", () => {
    const stamp = stampOf(NOW, held({ phrases: 3 }));
    assert.deepEqual(asStamp(stamp), stamp);
    assert.deepEqual(asStamp({ ...stamp, held: { ...stamp.held, extra: 9 }, extra: true }), stamp);
  });

  it("refuses what is not a stamp, and reads a broken count as zero rather than dropping the date", () => {
    for (const value of [undefined, null, "stamp", 42, {}, { at: "yesterday" }, { at: 0 }, { at: -1 }, { at: Number.NaN }]) {
      assert.equal(asStamp(value), null, `${JSON.stringify(value)} reads as a stamp`);
    }
    assert.deepEqual(asStamp({ at: NOW }), stampOf(NOW, held()));
    assert.deepEqual(
      asStamp({ at: NOW, held: { phrases: -1, articles: 1.5, books: "2", highlights: 7 } }),
      stampOf(NOW, held({ highlights: 7 })),
    );
  });

  it("is written and read through the storage, quietly on either failure", async () => {
    const box = storage();
    assert.equal(await readExportStamp(box.deps), null);
    const stamp = stampOf(NOW, held({ articles: 1 }));
    assert.equal(await writeExportStamp(stamp, box.deps), true);
    assert.deepEqual(box.stored(), stamp);
    assert.deepEqual(await readExportStamp(box.deps), stamp);
    box.plant({ garbage: true });
    assert.equal(await readExportStamp(box.deps), null);
    box.breakIt();
    assert.equal(await readExportStamp(box.deps), null);
    assert.equal(await writeExportStamp(stamp, box.deps), false);
  });
});

describe("the growth since the file", () => {
  it("is each count here over the count held, never below zero", () => {
    const then = held({ phrases: 100, articles: 10, books: 2, highlights: 40 });
    assert.deepEqual(
      grownSince(then, held({ phrases: 114, articles: 13, books: 2, highlights: 49 })),
      held({ phrases: 14, articles: 3, books: 0, highlights: 9 }),
    );
    // More deleted than saved since: the part understates, it never goes negative.
    assert.deepEqual(grownSince(then, held({ phrases: 80, articles: 12, books: 1, highlights: 40 })), held({ articles: 2 }));
  });
});

describe("how long ago", () => {
  it("speaks in the coarsest unit that still says something, in the reader's language", () => {
    /** @param {number} days */
    const back = (days) => ago(NOW - days * DAY, NOW, "en");
    assert.equal(back(0), "today");
    assert.equal(ago(NOW - 23 * 60 * 60 * 1000, NOW, "en"), "today");
    assert.equal(back(1), "yesterday");
    assert.equal(back(6), "6 days ago");
    assert.equal(back(7), "last week");
    assert.equal(back(20), "2 weeks ago");
    assert.equal(back(30), "last month");
    assert.equal(back(100), "3 months ago");
    assert.equal(back(365), "last year");
    assert.equal(back(800), "2 years ago");
    assert.equal(ago(NOW - 20 * DAY, NOW, "pl"), "2 tygodnie temu");
  });

  it("treats a moment ahead of the clock as now - a clock set back must not say the file is from the future", () => {
    assert.equal(ago(NOW + 3 * DAY, NOW, "en"), "today");
  });
});

describe("the line under Export", () => {
  it("says nothing over a fresh install: no file yet, nothing here to lose", () => {
    assert.equal(backupReminder(null, held(), NOW, "en"), null);
  });

  it("counts what stands to be lost while no file was ever written, in ink", () => {
    assert.deepEqual(backupReminder(null, held({ phrases: 1, articles: 12, highlights: 41 }), NOW, "en"), {
      text: "No backup file yet. On this device: 12 articles, 1 saved phrase, 41 highlights.",
      due: true,
    });
  });

  it("says when the file was written and what grew since, in the export report's order, the empty parts left out", () => {
    const stamp = stampOf(NOW - 3 * DAY, held({ phrases: 100, articles: 10, books: 2, highlights: 40 }));
    assert.deepEqual(backupReminder(stamp, held({ phrases: 114, articles: 13, books: 2, highlights: 49 }), NOW, "en"), {
      text: "Last backup: 3 days ago. More since then: 3 articles, 14 saved phrases, 9 highlights.",
      due: false,
    });
    assert.deepEqual(backupReminder(stamp, held({ phrases: 100, articles: 10, books: 3, highlights: 40 }), NOW, "en"), {
      text: "Last backup: 3 days ago. More since then: 1 book.",
      due: false,
    });
  });

  it("says so when nothing grew - also when more was deleted than saved", () => {
    const stamp = stampOf(NOW - 40 * DAY, held({ phrases: 100, articles: 10 }));
    assert.deepEqual(backupReminder(stamp, held({ phrases: 100, articles: 10 }), NOW, "en"), {
      text: "Last backup: last month. Nothing more since then.",
      due: false,
    });
    assert.deepEqual(backupReminder(stamp, held({ phrases: 90, articles: 4 }), NOW, "en"), {
      text: "Last backup: last month. Nothing more since then.",
      due: false,
    });
  });

  it("goes to ink only once the file is a month old and something grew - neither alone does it", () => {
    const grown = held({ phrases: 101 });
    const then = held({ phrases: 100 });
    const fresh = stampOf(NOW - (STALE_AFTER_DAYS - 1) * DAY, then);
    const stale = stampOf(NOW - STALE_AFTER_DAYS * DAY, then);
    assert.equal(backupReminder(fresh, grown, NOW, "en")?.due, false, "a fresh file with growth presses");
    assert.equal(backupReminder(stale, then, NOW, "en")?.due, false, "a stale file with nothing new presses");
    assert.equal(backupReminder(stale, grown, NOW, "en")?.due, true, "a stale file with growth does not press");
  });
});
