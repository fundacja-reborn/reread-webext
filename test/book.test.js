import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { asBookMeta, asSegment, bookRecord } from "../src/lib/store/book.js";
import { articleEntry, bookEntry } from "../src/reader/list-view.js";

const whole = {
  id: "b-1",
  title: "Dracula",
  author: "Bram Stoker",
  lang: "en",
  segmentCount: 12,
  totalChars: 240000,
  addedAt: 1000,
};

describe("bookRecord", () => {
  it("builds the row an import writes", () => {
    assert.deepEqual(bookRecord(whole), { ...whole, readAt: null });
  });

  it("keeps only words worth carrying as author and language", () => {
    const kept = bookRecord({ ...whole, author: "   ", lang: undefined });
    assert.ok(kept);
    assert.equal(kept.author, null);
    assert.equal(kept.lang, null);
  });

  it("refuses what nobody could open: no id, no title, no text", () => {
    assert.equal(bookRecord({ ...whole, id: "" }), null);
    assert.equal(bookRecord({ ...whole, title: "  " }), null);
    assert.equal(bookRecord({ ...whole, segmentCount: 0 }), null);
    assert.equal(bookRecord({ ...whole, totalChars: 0 }), null);
    assert.equal(bookRecord({ ...whole, segmentCount: 2.5 }), null);
  });
});

describe("asBookMeta", () => {
  it("narrows a stored row field by field, healing what it can", () => {
    const healed = asBookMeta({ id: "b-1", segmentCount: 3, addedAt: "when", readAt: 7 });
    assert.deepEqual(healed, {
      id: "b-1",
      title: "b-1",
      author: null,
      lang: null,
      segmentCount: 3,
      totalChars: 0,
      addedAt: 0,
      readAt: 7,
    });
  });

  it("reads a row without an id or without segments as absent", () => {
    assert.equal(asBookMeta(null), null);
    assert.equal(asBookMeta({ title: "x", segmentCount: 3 }), null);
    assert.equal(asBookMeta({ id: "b-1", segmentCount: 0 }), null);
  });
});

describe("asSegment", () => {
  it("keeps a row of markup blocks", () => {
    assert.deepEqual(asSegment({ blocks: ["<p>a</p>"], charCount: 1 }), {
      blocks: ["<p>a</p>"],
      charCount: 1,
    });
  });

  it("reads a torn row as absent", () => {
    assert.equal(asSegment(null), null);
    assert.equal(asSegment({ blocks: [] }), null);
    assert.equal(asSegment({ blocks: ["<p>a</p>", 5] }), null);
  });
});

describe("library entries", () => {
  const meta = {
    url: "https://example.com/a",
    hostname: "example.com",
    title: "An article",
    savedAt: 500,
    readAt: null,
  };

  it("an article enters as itself", () => {
    assert.deepEqual(articleEntry(meta, null), {
      ...meta,
      kind: "article",
      progress: null,
      percentRead: null,
      lastReadAt: null,
    });
  });

  it("the entry carries its position's clock, and a torn clock reads as never", () => {
    const position = { docId: meta.url, segmentIndex: 0, blockIndex: 7, updatedAt: 777 };
    assert.equal(articleEntry(meta, position).lastReadAt, 777);
    // `asPosition` marks a row whose clock is broken with zero; the list must
    // not mistake that for a reading older than every honest date.
    assert.equal(articleEntry(meta, { ...position, updatedAt: 0 }).lastReadAt, null);
    const book = { ...whole, readAt: null };
    assert.equal(bookEntry(book, { ...position, docId: "b-1" }).lastReadAt, 777);
  });

  it("an article's percent read is its position's, as stored", () => {
    const position = { docId: meta.url, segmentIndex: 0, blockIndex: 7, updatedAt: 1, percent: 42 };
    assert.equal(articleEntry(meta, position).percentRead, 42);
    // A row from before the percent existed places the article, but has no
    // number to say - not a zero, which would read as "barely started".
    const bare = { docId: meta.url, segmentIndex: 0, blockIndex: 7, updatedAt: 1 };
    assert.equal(articleEntry(meta, bare).percentRead, null);
  });

  it("a book wears the list's fields: author for site, added for saved", () => {
    const book = { ...whole, readAt: 9 };
    assert.deepEqual(bookEntry(book, null), {
      url: "b-1",
      hostname: "Bram Stoker",
      title: "Dracula",
      savedAt: 1000,
      readAt: 9,
      kind: "book",
      progress: { at: 1, of: 12 },
      percentRead: null,
      lastReadAt: null,
    });
  });

  it("a book's percent read counts the parts before the remembered one", () => {
    const book = { ...whole, readAt: null };
    // Halfway through part 5 of 12: four whole parts and half of the fifth.
    const position = { docId: "b-1", segmentIndex: 4, blockIndex: 3, updatedAt: 1, percent: 50 };
    assert.equal(bookEntry(book, position).percentRead, Math.round((4.5 / 12) * 100));
  });

  it("progress reads the stored position, clamped to the book it has", () => {
    const book = { ...whole, readAt: null };
    /** @param {import("../src/lib/reader/position.js").ReadingPosition} position */
    const at = (position) => bookEntry(book, position).progress;
    assert.deepEqual(at({ docId: "b-1", segmentIndex: 4, blockIndex: 0, updatedAt: 1 }), {
      at: 5,
      of: 12,
    });
    // A position past the end - the book was re-imported shorter - shows as
    // the last part rather than an impossible one.
    assert.deepEqual(at({ docId: "b-1", segmentIndex: 40, blockIndex: 0, updatedAt: 1 }), {
      at: 12,
      of: 12,
    });
  });

  it("a book without an author leads with nothing, not with a blank", () => {
    const entry = bookEntry({ ...whole, author: null, readAt: null }, null);
    assert.equal(entry.hostname, "");
  });
});
