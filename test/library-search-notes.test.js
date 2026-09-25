import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { docNotesOf } from "../src/lib/store/marks.js";
import { bodyOf } from "./openings.js";

/**
 * The reading list's search covers the reader's note on a document (D283):
 * the rule of what is searched lives in `list-view.js` under its own tests;
 * what stands here is the store's light read of the notes and the shape
 * of the two pages that use it - the notes read at a press and never for
 * the plain list, the own-words group of the deep search fed the same way,
 * and the found row showing its note.
 */

const ROOT = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

describe("docNotesOf", () => {
  it("reads each row's note by the note's own rule, and nothing of its marks", () => {
    const notes = docNotesOf([
      { docId: "a", marks: [{ broken: true }], note: "  about a  " },
      { docId: "b", marks: [], note: "   " },
      { docId: "c", marks: [] },
      { docId: "", marks: [], note: "keyless" },
      { docId: "d", note: 7 },
      null,
      "text",
    ]);
    assert.deepEqual([...notes], [["a", "about a"]]);
  });
});

describe("the reading list page and the notes (D283)", () => {
  it("reads the notes only while a search is applied, and dresses the entries with them", async () => {
    const script = await source("reader/reader.js");
    const refreshing = bodyOf(script, "refreshLibrary");
    assert.match(
      refreshing,
      /const searching = libraryQuery\.trim\(\)\.length > 0;[\s\S]*?searching \? allDocNotes\(\)\.catch\(\(\) => new Map\(\)\) : Promise\.resolve\(new Map\(\)\)/,
      "the notes are read for the plain list too, or not at all",
    );
    assert.match(refreshing, /articleEntry\(meta, positions\.get\(meta\.url\) \?\? null, notes\.get\(meta\.url\)\)/);
    assert.match(refreshing, /bookEntry\(book, positions\.get\(book\.id\) \?\? null, notes\.get\(book\.id\)\)/);
  });

  it("puts the note line under a row in both dresses of the row, by the shown-note rule", async () => {
    const script = await source("reader/reader.js");
    const row = bodyOf(script, "libraryRow");
    assert.equal(row.match(/\.\.\.noteLine\(entry\)/g)?.length, 2, "one of the row's two dresses has no note line");
    const line = bodyOf(script, "noteLine");
    assert.match(line, /if \(!noteShown\(entry, libraryQuery\)\) return \[\];/);
    assert.match(line, /note\.className = "library-doc-note";/);
    assert.match(line, /note\.textContent = entry\.note \?\? "";/, "the note must enter as text");
  });

  it("feeds the deep search's own-words group the notes, and shows the note on such a row", async () => {
    const script = await source("reader/library-search.js");
    const loading = bodyOf(script, "loadDocs");
    assert.match(loading, /allDocNotes\(\)\.catch\(\(\) => new Map\(\)\)/);
    assert.match(loading, /articleEntry\(meta, positions\.get\(meta\.url\) \?\? null, notes\.get\(meta\.url\)\)/);
    assert.match(loading, /bookEntry\(book, positions\.get\(book\.id\) \?\? null, notes\.get\(book\.id\)\)/);
    assert.match(loading, /searchable: searchableArticle\(entry\)/);
    const row = bodyOf(script, "docRow");
    // The same fold that put the row in its group decides the line.
    assert.match(row, /if \(hits === null && doc\.note !== undefined && metaMatches\(doc\.note, folded\)\)/);
    assert.match(row, /note\.className = "library-doc-note";/);
    assert.match(row, /note\.textContent = doc\.note;/);
  });

  it("names the group for what it holds, and the box for what it searches", async () => {
    const en = JSON.parse(await source("_locales/en/messages.json"));
    assert.equal(en.reader_search_in_titles.message, "In titles and notes");
    assert.equal(en.reader_filter_placeholder.message, "Search by title, site or note");
    const markup = await source("reader/reader.html");
    assert.ok(markup.includes('placeholder="Search by title, site or note"'), "the markup's fallback placeholder disagrees with the catalogue");
  });
});
