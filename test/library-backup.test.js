import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LIBRARY_COPY_PREFIX,
  articleKey,
  articleRow,
  asCopiedArticle,
  asCopiedBook,
  asCopiedPosition,
  bookKey,
  bookRow,
  buildLibraryCopy,
  clearLibraryCopy,
  copiedLibrary,
  copyArticle,
  copyBook,
  copyPosition,
  copySummary,
  dropCopied,
  patchCopiedMeta,
  positionKey,
  positionRow,
  restoreLibrary,
  rowsOf,
  segmentsOf,
} from "../src/lib/store/library-backup.js";

/** @typedef {import("../src/lib/store/library-backup.js").LibraryCopyDeps} LibraryCopyDeps */
/** @typedef {import("../src/lib/store/library-backup.js").CopiedBook} CopiedBook */
/** @typedef {import("../src/lib/store/library-backup.js").CopiedLibrary} CopiedLibrary */
/** @typedef {import("../src/lib/store/library-backup.js").LibrarySnapshot} LibrarySnapshot */
/** @typedef {import("../src/lib/store/saved-article.js").SavedArticle} SavedArticle */
/** @typedef {import("../src/lib/reader/position.js").ReadingPosition} ReadingPosition */

/**
 * The copy of the reading list, held to the rules the other two copies keep
 * and to its own: one key per document found by its prefix, additions only
 * while the switch is on, removals always, restored only into a library with
 * nothing in it. No browser runs in CI - the library and the storage area
 * are stand-ins that remember what was asked of them.
 */

/**
 * @param {string} url
 * @param {Partial<SavedArticle>} [over]
 * @returns {SavedArticle}
 */
function article(url, over = {}) {
  return {
    url,
    hostname: "a.example",
    title: `Page at ${url}`,
    savedAt: 1000,
    readAt: null,
    content: "<p>Some text</p>",
    dir: null,
    lang: "en",
    ...over,
  };
}

/**
 * @param {string} id
 * @param {number} segmentCount
 * @returns {CopiedBook}
 */
function book(id, segmentCount) {
  return {
    meta: {
      id,
      title: `Book ${id}`,
      author: null,
      lang: "en",
      segmentCount,
      totalChars: 10 * segmentCount,
      addedAt: 2000,
      readAt: null,
      toc: null,
    },
    segments: Array.from({ length: segmentCount }, (_, index) => ({
      blocks: [`<p>segment ${index}</p>`],
      charCount: 10,
    })),
  };
}

/**
 * @param {string} docId
 * @returns {ReadingPosition}
 */
function position(docId) {
  return { docId, segmentIndex: 0, blockIndex: 3, updatedAt: 3000, percent: 40 };
}

/**
 * @param {{ enabled?: boolean, empty?: boolean, area?: Record<string, unknown>, snapshot?: LibrarySnapshot }} [script]
 */
function standIn(script = {}) {
  /** @type {string[]} */
  const asked = [];
  /** @type {Record<string, unknown>} */
  const area = { ...(script.area ?? {}) };
  /** @type {CopiedLibrary | null} */
  let put = null;
  /** @type {LibraryCopyDeps} */
  const deps = {
    enabled: async () => {
      asked.push("enabled");
      return script.enabled ?? true;
    },
    empty: async () => {
      asked.push("empty");
      return script.empty ?? false;
    },
    putRows: async (library) => {
      asked.push(`putRows ${library.articles.length + library.books.length}`);
      put = library;
      return library.articles.length + library.books.length;
    },
    snapshot: async () => {
      asked.push("snapshot");
      return script.snapshot ?? { articles: [], books: [], positions: [] };
    },
    readAll: async () => {
      asked.push("readAll");
      return { ...area };
    },
    read: async (key) => {
      asked.push(`read ${key}`);
      return area[key];
    },
    write: async (items) => {
      asked.push(`write ${Object.keys(items).join(",")}`);
      Object.assign(area, items);
    },
    remove: async (keys) => {
      asked.push(`remove ${keys.join(",")}`);
      for (const key of keys) delete area[key];
    },
  };
  return { deps, asked, area, put: () => put };
}

/** @param {unknown} value */
const throughJson = (value) => JSON.parse(JSON.stringify(value));

describe("the copy of the reading list", () => {
  it("copies an article as its two halves and reads it back whole", () => {
    const saved = article("https://a.example/p", { readAt: 5000, dir: "rtl" });
    const row = articleRow(saved);
    assert.deepEqual(row.meta, {
      url: saved.url,
      hostname: "a.example",
      title: saved.title,
      savedAt: 1000,
      readAt: 5000,
    });
    assert.deepEqual(asCopiedArticle(throughJson(row)), saved);

    // Torn rows read as no article: the library gets back only what opens.
    assert.equal(asCopiedArticle({ ...row, content: "" }), null);
    assert.equal(asCopiedArticle({ ...row, meta: { title: "no address" } }), null);
    assert.equal(asCopiedArticle({ ...row, version: 2 }), null);
    assert.equal(asCopiedArticle("not a row"), null);
  });

  it("copies a book only with all of its text, in order", () => {
    const whole = book("b1", 3);
    const rows = whole.segments.map((segment, index) => ({ bookId: "b1", index, ...segment }));
    assert.deepEqual(segmentsOf(whole.meta, rows), whole.segments);
    // A missing segment, one out of order, or a count the row does not
    // promise: not a book anybody could open on every page.
    assert.equal(segmentsOf(whole.meta, rows.slice(0, 2)), null);
    assert.equal(segmentsOf(whole.meta, [rows[0], rows[2], rows[1]]), null);
    assert.equal(segmentsOf({ ...whole.meta, segmentCount: 2 }, rows), null);

    const row = bookRow(whole);
    assert.deepEqual(asCopiedBook(throughJson(row)), whole);
    assert.equal(asCopiedBook({ ...row, segments: row.segments.slice(1) }), null);
    assert.equal(asCopiedBook({ ...row, segments: [...row.segments.slice(0, 2), { blocks: [] }] }), null);
    assert.equal(asCopiedBook({ ...row, version: 0 }), null);
  });

  it("copies where the reader stopped, and refuses half a place", () => {
    const place = position("https://a.example/p");
    assert.deepEqual(asCopiedPosition(throughJson(positionRow(place))), place);
    assert.equal(asCopiedPosition({ version: 1, position: { docId: "x" } }), null);
    assert.equal(asCopiedPosition({ version: 3, position: place }), null);
  });

  it("finds the copy in the whole area by its prefix, and keeps only what opens", () => {
    const kept = article("https://a.example/kept");
    const shelf = book("b1", 1);
    const area = {
      vocabBackup: { version: 1, phrases: [] },
      config: { keepArticles: true },
      [articleKey(kept.url)]: articleRow(kept),
      [bookKey("b1")]: bookRow(shelf),
      [positionKey(kept.url)]: positionRow(position(kept.url)),
      // A place in a document the copy does not hold: an orphan nothing
      // would ever clean, so it stays out.
      [positionKey("https://a.example/gone")]: positionRow(position("https://a.example/gone")),
      // A row under the wrong key names no document the key does.
      [articleKey("https://a.example/other")]: articleRow(article("https://a.example/elsewhere")),
      // Unreadable, but the copy's: a clear has to take it.
      [`${LIBRARY_COPY_PREFIX}article:https://a.example/torn`]: { version: 1 },
    };
    const library = copiedLibrary(area);
    assert.deepEqual(library.articles, [kept]);
    assert.deepEqual(library.books, [shelf]);
    assert.deepEqual(library.positions, [position(kept.url)]);
    assert.deepEqual(library.keys, [
      articleKey(kept.url),
      articleKey("https://a.example/other"),
      `${LIBRARY_COPY_PREFIX}article:https://a.example/torn`,
      bookKey("b1"),
      positionKey("https://a.example/gone"),
      positionKey(kept.url),
    ]);
  });

  it("restores only into an empty library, and reads the area only then", async () => {
    const full = standIn({ empty: false, area: { [articleKey("u")]: articleRow(article("u")) } });
    assert.equal(await restoreLibrary(full.deps), 0);
    assert.deepEqual(full.asked, ["empty"]);

    const nothingToRestore = standIn({ empty: true, area: { vocabBackup: {} } });
    assert.equal(await restoreLibrary(nothingToRestore.deps), 0);
    assert.deepEqual(nothingToRestore.asked, ["empty", "readAll"]);

    const kept = article("https://a.example/p");
    const emptied = standIn({
      empty: true,
      area: {
        [articleKey(kept.url)]: articleRow(kept),
        [bookKey("b1")]: bookRow(book("b1", 2)),
        [positionKey("b1")]: positionRow(position("b1")),
      },
    });
    assert.equal(await restoreLibrary(emptied.deps), 2);
    assert.deepEqual(emptied.asked, ["empty", "readAll", "putRows 2"]);
    const put = emptied.put();
    assert.ok(put !== null);
    assert.deepEqual(put.articles, [kept]);
    assert.deepEqual(put.books, [book("b1", 2)]);
    assert.deepEqual(put.positions, [position("b1")]);
  });

  it("builds the copy from the whole library and sweeps the rows it no longer names", async () => {
    const kept = article("https://a.example/kept");
    const shelf = book("b1", 2);
    const stand = standIn({
      snapshot: {
        articles: [kept],
        books: [shelf],
        positions: [position(kept.url), position("https://a.example/orphan")],
      },
      area: {
        vocabBackup: { version: 1 },
        [articleKey("https://a.example/deleted")]: articleRow(article("https://a.example/deleted")),
        [positionKey("https://a.example/deleted")]: positionRow(position("https://a.example/deleted")),
      },
    });
    assert.equal(await buildLibraryCopy(stand.deps), 2);
    assert.deepEqual(Object.keys(stand.area).sort(), [
      articleKey(kept.url),
      bookKey("b1"),
      positionKey(kept.url),
      "vocabBackup",
    ]);
    assert.deepEqual(stand.area[bookKey("b1")], bookRow(shelf));
    // One document per write, never the whole reading list in one.
    assert.deepEqual(
      stand.asked.filter((step) => step.startsWith("write")),
      [`write ${articleKey(kept.url)}`, `write ${bookKey("b1")}`, `write ${positionKey(kept.url)}`],
    );
  });

  it("keys every document of a library, and a position only beside its document", () => {
    const rows = rowsOf({
      articles: [article("u")],
      books: [book("b", 1)],
      positions: [position("u"), position("b"), position("nobody")],
    });
    assert.deepEqual([...rows.keys()], [articleKey("u"), bookKey("b"), positionKey("u"), positionKey("b")]);
  });

  it("clears every key of the copy and nothing else", async () => {
    const stand = standIn({
      area: {
        vocabBackup: { version: 1 },
        marksBackup: { version: 1 },
        [articleKey("u")]: articleRow(article("u")),
        [`${LIBRARY_COPY_PREFIX}book:torn`]: "not a row",
      },
    });
    assert.equal(await clearLibraryCopy(stand.deps), 2);
    assert.deepEqual(Object.keys(stand.area).sort(), ["marksBackup", "vocabBackup"]);
  });

  it("writes a document only while the switch is on", async () => {
    const off = standIn({ enabled: false });
    assert.equal(await copyArticle(article("u"), false, off.deps), false);
    assert.equal(await copyBook(book("b", 1), off.deps), false);
    assert.equal(await copyPosition(position("u"), off.deps), false);
    assert.deepEqual(Object.keys(off.area), []);

    const on = standIn({ enabled: true });
    assert.equal(await copyArticle(article("u"), false, on.deps), true);
    assert.equal(await copyBook(book("b", 1), on.deps), true);
    assert.equal(await copyPosition(position("u"), on.deps), true);
    assert.deepEqual(Object.keys(on.area).sort(), [articleKey("u"), bookKey("b"), positionKey("u")]);
    assert.deepEqual(on.area[articleKey("u")], articleRow(article("u")));
  });

  it("drops the old place when a save writes over an article, switch or no switch", async () => {
    const off = standIn({ enabled: false, area: { [positionKey("u")]: positionRow(position("u")) } });
    assert.equal(await copyArticle(article("u"), true, off.deps), false);
    assert.deepEqual(Object.keys(off.area), []);
    // A first save of an address drops nothing: there is nothing under it,
    // and the remove would be a write for no reason.
    const first = standIn({ enabled: false });
    await copyArticle(article("u"), false, first.deps);
    assert.deepEqual(first.asked, ["enabled"]);
  });

  it("patches a light row where one stands, and nowhere else", async () => {
    const saved = article("u");
    const stand = standIn({ area: { [articleKey("u")]: articleRow(saved) } });
    const read = { ...articleRow(saved).meta, readAt: 9000 };
    assert.equal(await patchCopiedMeta(articleKey("u"), read, stand.deps), true);
    assert.deepEqual(stand.area[articleKey("u")], { ...articleRow(saved), meta: read });
    // No row, no write - which is also what makes the switch unasked here.
    assert.equal(await patchCopiedMeta(articleKey("elsewhere"), read, stand.deps), false);
    assert.deepEqual(Object.keys(stand.area), [articleKey("u")]);
    assert.ok(!stand.asked.includes("enabled"));
  });

  it("drops a document with its place", async () => {
    const stand = standIn({
      area: {
        [articleKey("u")]: articleRow(article("u")),
        [positionKey("u")]: positionRow(position("u")),
        [bookKey("b")]: bookRow(book("b", 1)),
        [positionKey("b")]: positionRow(position("b")),
      },
    });
    await dropCopied("u", "article", stand.deps);
    assert.deepEqual(Object.keys(stand.area).sort(), [bookKey("b"), positionKey("b")]);
    await dropCopied("b", "book", stand.deps);
    assert.deepEqual(Object.keys(stand.area), []);
  });

  it("sums the copy for the settings page", () => {
    assert.equal(copySummary({ vocabBackup: { version: 1 } }), null);
    const area = {
      [articleKey("u")]: articleRow(article("u")),
      [bookKey("b")]: bookRow(book("b", 2)),
      [positionKey("u")]: positionRow(position("u")),
    };
    const summary = copySummary(area);
    assert.ok(summary !== null);
    assert.equal(summary.docs, 2);
    assert.equal(summary.bytes, Object.values(area).reduce((sum, row) => sum + JSON.stringify(row).length, 0));
  });
});
