import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { bodyOf } from "./openings.js";

/**
 * The reader's note on a document, under the title (D284): the note's
 * rules live with the marks (`reader-marks.test.js`, `marks-copy.test.js`),
 * the list's use of it in `reader-list-view.test.js`; this reads the places
 * the line is drawn - the header's markup, the stylesheet under it, the
 * reader page's hand on it - the facts line's own manner (D226), because a
 * line nobody dresses or a state nobody puts on it is a feature that
 * silently does nothing.
 */

const ROOT = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

describe("the note under the title (D284) - the page", () => {
  it("stands last in the header block, right before the text, hidden until there is a note", async () => {
    const html = await source("reader/reader.html");
    const pictures = html.indexOf('<p id="pictures-offer" class="reader-pictures" hidden>');
    const line = html.indexOf('<p id="doc-note" class="reader-note" hidden>');
    const content = html.indexOf('<div id="content">');
    assert.ok(pictures !== -1 && line !== -1 && content !== -1, "a piece of the header is not where it was");
    assert.ok(pictures < line && line < content, "the note line does not stand between the pictures line and the text");
    assert.ok(!html.slice(pictures, line).includes("<div"), "something stands between the pictures line and the note");
    assert.match(html, /<span id="doc-note-text"><\/span>/, "the note's words carry markup of their own");
    // One door beside the words, named like the highlights page's act - the
    // same key in both places, so the two cannot drift apart.
    const button = html.slice(line, content);
    assert.match(button, /id="doc-note-edit"/);
    assert.match(button, /data-i18n-title="reader_doc_note_edit"/);
    assert.match(button, /data-i18n-aria-label="reader_doc_note_edit"/);
  });

  it("is dressed with the header block and the lines before it close up to it", async () => {
    const css = await source("reader/reader.css");
    // First in the list: the facts line's test wants the list to end on the
    // pictures line, and a dress is a dress wherever the name stands.
    assert.match(css, /\.reader-note,\n\.reader-byline,\n\.reader-source,\n\.reader-facts,\n\.reader-pictures \{/, "the note line does not wear the block's dress");
    for (const before of ["reader-byline", "reader-source", "reader-facts", "reader-pictures"]) {
      assert.match(css, new RegExp(`\\.${before}:has\\(~ \\.reader-note:not\\(\\[hidden\\]\\)\\)`), `${before} does not close up to the note`);
    }
    assert.match(css, /\.reader-note\[hidden\] \{\s*display: none;/, "a flex line ignores hidden unless the sheet says so");
    // The act wears the site line's quiet icon dress, one rule for both.
    assert.match(css, /\.reader-source a,\n\.reader-note button \{/, "the act is not in the quiet icon's dress");
    // Past a book's beginning the header is taken away, the note with it.
    assert.match(css, /#article\[data-book-place="within"\][^{]*\.reader-note/, "the note stands over a stretch of a book past its beginning");
  });
});

describe("the note under the title (D284) - the reader page", () => {
  it("puts the note on the line and the state on the menu row in one hand, as text", async () => {
    const script = await source("reader/reader.js");
    const dressing = bodyOf(script, "dressDocNote");
    assert.match(dressing, /navNote\.textContent = docNote === undefined \? t\("reader_doc_note_add"\) : t\("reader_doc_note_edit"\)/);
    assert.match(dressing, /docNoteLine\.hidden = docNote === undefined/);
    assert.match(dressing, /docNoteText\.textContent = docNote \?\? ""/, "the note must enter as text");
    assert.equal(script.includes("dressNoteRow"), false, "the old name is still around");
  });

  it("dresses the line with the row's read, hides it with the actions and at render, and takes it back on a failed write", async () => {
    const script = await source("reader/reader.js");
    const refreshing = bodyOf(script, "refreshActions");
    assert.match(refreshing, /getDocNote\(target\.url\)\.catch\(\(\) => undefined\)/);
    assert.match(refreshing, /if \(docNoteLine !== null\) docNoteLine\.hidden = true;\s*return;/, "the line is not hidden with the actions over no document");
    assert.match(refreshing, /dressDocNote\(\);/);
    const rendering = bodyOf(script, "renderArticle");
    assert.match(rendering, /if \(docNoteLine !== null\) docNoteLine\.hidden = true;/, "the last document's note stands over the next at render");
    const applying = bodyOf(script, "applyDocNote");
    assert.equal(applying.match(/dressDocNote\(\);/g)?.length, 2, "the line is not redressed both on the write and on its take-back");
  });

  it("opens the dialog from the act beside the note, and keeps the line from selecting", async () => {
    const script = await source("reader/reader.js");
    assert.match(script, /docNoteEdit\?\.addEventListener\("click", \(\) => onDocNotePress\(\)\);/);
    assert.match(script, /docNoteLine\?\.contains\(target\) === true/, "a hold on the act would select a word");
  });
});
