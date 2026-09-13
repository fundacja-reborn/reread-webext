import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { bodyOf } from "./openings.js";

/**
 * The backup's scope on the reading list page (2026-09-13): what Export
 * writes and what it leaves out, said in the open under the buttons; the
 * books' rows inside the selection saying why they wear no box; and the
 * import report naming the books whose highlights the file holds and the
 * reading list does not. The rules have their tests (`reader-list-view`,
 * `marks-copy`); this reads the markup and the call sites they meet at,
 * the way `backup-page.test.js` reads the backup's.
 */

const ROOT = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

describe("the backup's scope on the reading list page", () => {
  it("says what the backup holds and that books are not in it before the format fold, not inside it", async () => {
    const page = await source("reader/reader.html");
    const scope = page.indexOf('data-i18n="reader_backup_scope"');
    const books = page.indexOf('data-i18n="reader_backup_books_note"');
    const accepts = page.indexOf('data-i18n="reader_transfer_accepts"');
    const pick = page.indexOf('data-i18n="reader_transfer_pick"');
    const fold = page.indexOf('data-i18n="reader_format_title"');
    assert.ok(scope !== -1 && books !== -1, "a point of the backup's scope is missing");
    assert.ok(scope < books && books < accepts && accepts < pick, "the points do not stand in the brief's order: the backup, the books, Import, Select");
    assert.ok(pick < fold, "the points stand inside or after the fold");
    // One list, no heading, the four points as its items (the second polish).
    assert.match(
      page,
      /<ul class="hint transfer-notes">\s*<li data-i18n="reader_backup_scope">[\s\S]*?<li data-i18n="reader_backup_books_note">[\s\S]*?<li data-i18n="reader_transfer_accepts">[\s\S]*?<li data-i18n="reader_transfer_pick">[\s\S]*?<\/ul>\s*<details class="fold-line">/,
      "the four points are not one list right over the fold",
    );
    // The fold keeps only what the paragraphs do not say.
    assert.doesNotMatch(page, /reader_transfer_books/, "the fold still repeats that books are not in the backup");
    // The fold is a glossary: each entry opens with its extension in bold,
    // written in the page (a marked element holds text only), the .zip
    // entry in two paragraphs.
    const glossary = page.slice(fold, page.indexOf("</details>", fold));
    assert.match(glossary, /<strong>\.zip<\/strong> -\s*<span data-i18n="reader_transfer_note">/, "the .zip entry does not open with its extension in bold");
    assert.match(glossary, /<p data-i18n="reader_transfer_settings">/, "the settings sentence is not the .zip entry's second paragraph");
    assert.match(glossary, /<strong>\.epub<\/strong> -\s*<span data-i18n="reader_transfer_epub">/, "the .epub entry does not open with its extension in bold");
    assert.match(glossary, /<strong>\.md<\/strong> -\s*<span data-i18n="reader_transfer_marks">/, "the .md entry does not open with its extension in bold");
    assert.equal((glossary.match(/<strong>/g) ?? []).length, 3, "the glossary bolds something beyond its three extensions");
    assert.doesNotMatch(page.slice(scope, fold), /<strong>/, "the list over the fold wears a bold");
    for (const locale of ["en", "pl", "de", "fr", "es", "uk"]) {
      const catalogue = JSON.parse(await readFile(new URL(`_locales/${locale}/messages.json`, ROOT), "utf8"));
      assert.equal(catalogue["reader_transfer_books"], undefined, `${locale} still carries the fold's old key`);
      assert.match(catalogue["reader_backup_books_note"].message, /\.epub/, `${locale}: the books paragraph does not name the .epub file`);
    }
  });
});

describe("the pictures box under the buttons", () => {
  it("counts the pictures with their unit and a middle dot before the size, in the language's plural", async () => {
    const script = await source("reader/reader.js");
    assert.match(
      bodyOf(script, "renderExportControls"),
      /plural\(kept\.count, "reader_export_pictures", \[megabytes\(kept\.bytes\)\]\)/,
      "the label does not count through the plural family",
    );
    for (const locale of ["en", "pl", "de", "fr", "es", "uk"]) {
      const catalogue = JSON.parse(await readFile(new URL(`_locales/${locale}/messages.json`, ROOT), "utf8"));
      for (const family of ["reader_export_pictures", "library_pictures"]) {
        const sentence = catalogue[`${family}_other`].message;
        assert.match(sentence, /\$COUNT\$ \S+ · \$SIZE\$/, `${locale}/${family}: not "N unit · size"`);
      }
    }
  });
});

describe("the books' rows inside the selection", () => {
  it("say why they wear no box - to the pointer, to assistive technology, and under the bar", async () => {
    const script = await source("reader/reader.js");
    const row = bodyOf(script, "libraryRow");
    assert.match(
      row,
      /if \(entry\.kind === "book"\) \{\s*item\.classList\.add\("library-row-still"\);[\s\S]*?item\.setAttribute\("aria-disabled", "true"\);\s*item\.title = t\("reader_pick_book_title"\);/,
      "a book's row is not marked disabled with the reason as its title",
    );
    const page = await source("reader/reader.html");
    assert.match(
      page,
      /<div class="pick-bar" id="library-pick-line" hidden>[\s\S]*?<\/div>\s*(?:<!--[\s\S]*?-->\s*)?<p class="hint pick-note" id="library-pick-books" data-i18n="reader_pick_books_note" hidden>/,
      "the line about the books does not stand right under the selection's bar",
    );
  });

  it("show the line only inside the selection and only while a book is among the rows shown", async () => {
    const script = await source("reader/reader.js");
    assert.match(
      bodyOf(script, "renderPickLine"),
      /libraryPickBooks\.hidden = !picking \|\| libraryShown\.books === 0;/,
      "the line is not hidden outside the selection or over a list without books",
    );
    assert.match(bodyOf(script, "refreshLibrary"), /books: view\.books/, "the refresh does not keep the count of books shown");
    // The deep search's results stand in the rows' place; the line goes with the rows.
    assert.match(bodyOf(script, "applyLibrarySearchVisibility"), /libraryPickLine,\s*libraryPickBooks,/, "the line stays over the search's results");
  });
});

describe("the import report about books that are not in the reading list", () => {
  it("names them apart from the articles, with the file to import again after the book", async () => {
    const script = await source("reader/reader.js");
    const notes = bodyOf(script, "marksImportNotes");
    assert.match(notes, /missingByKind\(plan\.missing\)/, "the missing documents are not told apart by kind");
    assert.match(notes, /plural\(books\.length, "reader_marks_import_books", \[sampleOf\(books\)\]\)/, "the books get no sentence of their own");
    assert.match(notes, /plural\(articles\.length, "reader_marks_import_missing", \[sampleOf\(articles\)\]\)/, "the articles lost their sentence");
    for (const locale of ["en", "pl", "de", "fr", "es", "uk"]) {
      const catalogue = JSON.parse(await readFile(new URL(`_locales/${locale}/messages.json`, ROOT), "utf8"));
      const sentence = catalogue["reader_marks_import_books_other"].message;
      assert.match(sentence, /\$COUNT\$/, `${locale}: the sentence does not count the books`);
      assert.match(sentence, /\$TITLES\$/, `${locale}: the sentence does not name the books`);
      assert.match(sentence, /\.epub/, `${locale}: the sentence does not say where a book comes back from`);
    }
  });
});
