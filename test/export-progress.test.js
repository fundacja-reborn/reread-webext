import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import {
  bookExportUnits,
  documentProgress,
  documentUnits,
  exportUnits,
  promisedPictures,
} from "../src/lib/reader/export-progress.js";
import { bodyOf } from "./openings.js";

/**
 * The export's progress (2026-11-15): the backup of a large library takes a
 * minute or more on a slow device, and a press on Export changed nothing on
 * the page until the file was done - no word on the button, no bar, and no
 * lock, so a second press started a second file. The rules - the work
 * counted before the first entry - are held here; the page's side is read
 * at its call sites, the way `import-progress.test.js` reads the import.
 */

describe("the work an export means", () => {
  it("counts the phrases by the import's weight, a picture and an article as a step, a book by its parts and pictures", () => {
    assert.equal(bookExportUnits({ parts: 63, pictures: 12 }), 75);
    assert.deepEqual(
      exportUnits({
        phrases: 5297,
        pictures: 501,
        articles: 119,
        books: [
          { parts: 63, pictures: 12 },
          { parts: 4, pictures: 0 },
        ],
      }),
      { phrases: 265, pictures: 501, articles: 119, books: 79, total: 964 },
    );
  });

  it("comes to nothing for a selection of nothing", () => {
    assert.deepEqual(exportUnits({ phrases: 0, pictures: 0, articles: 0, books: [] }), {
      phrases: 0,
      pictures: 0,
      articles: 0,
      books: 0,
      total: 0,
    });
  });

  it("counts the pictures the rows promise, and none for a row without the field", () => {
    assert.equal(promisedPictures([{ pictures: { count: 3 } }, {}, { pictures: { count: 4 } }]), 7);
    assert.equal(promisedPictures([]), 0);
  });

  it("gives a book file as much of the bar for the packing as for the parts, and a text page none", () => {
    assert.deepEqual(documentUnits(63, "epub"), { rebuild: 63, pack: 63, total: 126 });
    assert.deepEqual(documentUnits(63, "markdown"), { rebuild: 63, pack: 0, total: 63 });
    // An article is one part, and a document of no parts still has a bar.
    assert.deepEqual(documentUnits(1, "epub"), { rebuild: 1, pack: 1, total: 2 });
    assert.deepEqual(documentUnits(0, "markdown"), { rebuild: 1, pack: 0, total: 1 });
  });

});

describe("a document's progress", () => {
  it("starts at nothing, stands half way when a book file's parts are rebuilt, and ends on the whole", () => {
    /** @type {number[]} */
    const fractions = [];
    const progress = documentProgress(4, "epub", (fraction) => fractions.push(fraction));
    assert.deepEqual(fractions, [0]);
    for (let part = 0; part < 4; part += 1) progress.rebuilt();
    assert.equal(fractions.at(-1), 0.5);
    // Seven entries, each a seventh of the packing's share: sevenths do not
    // add up to the whole in floating point, and the last entry closes it.
    for (let entry = 1; entry <= 7; entry += 1) progress.packed(entry, 7);
    assert.equal(fractions.at(-1), 1);
    for (const [at, fraction] of fractions.entries()) {
      assert.ok(at === 0 || fraction >= /** @type {number} */ (fractions[at - 1]), "the bar went back");
    }
  });

  it("ends a text page's bar with its parts - it has no packing", () => {
    /** @type {number[]} */
    const fractions = [];
    const progress = documentProgress(1, "markdown", (fraction) => fractions.push(fraction));
    progress.rebuilt();
    assert.deepEqual(fractions, [0, 1]);
  });

  it("says whether the bar moved since the last entry, so the writer breathes per percent and not per entry", () => {
    const progress = documentProgress(1, "epub", undefined);
    progress.rebuilt();
    // A thousand entries over half the bar: fifty whole percent to cross.
    let breaths = 0;
    for (let entry = 1; entry <= 1000; entry += 1) if (progress.packed(entry, 1000)) breaths += 1;
    assert.ok(breaths >= 50 && breaths <= 52, `${breaths} breaths for fifty percent`);
  });
});

const ROOT = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

/**
 * The stream's body: a generator, which `bodyOf` does not look for, so it
 * is cut from the head to the first close at the margin.
 *
 * @param {string} script
 */
function streamOf(script) {
  const start = script.indexOf("async function* backupStream(");
  assert.ok(start !== -1, "backupStream is missing");
  return script.slice(start, script.indexOf("\n}\n", start));
}

describe("the export's progress on the reading list page", () => {
  it("answers the press on the pressed button and locks all three", async () => {
    const script = await source("reader/reader.js");
    const controls = bodyOf(script, "renderExportControls");
    assert.match(controls, /exportButton\.disabled = exportBusy !== null \|\| \(picking && picked\.size === 0\);\s*exportButton\.textContent =\s*exportBusy === "backup"\s*\? t\("action_exporting"\)/, "the pressed Export does not say it is exporting");
    assert.match(controls, /exportEpubButton\.disabled = picked\.size === 0 \|\| documentExport \|\| exportBusy !== null;\s*exportEpubButton\.textContent =\s*exportBusy === "epub"\s*\? t\("action_exporting"\)/, "the pressed EPUB button does not say it is exporting");
    assert.match(controls, /exportMarkdownButton\.disabled = picked\.size === 0 \|\| documentExport \|\| exportBusy !== null;\s*exportMarkdownButton\.textContent =\s*exportBusy === "markdown"\s*\? t\("action_exporting"\)/, "the pressed Markdown button does not say it is exporting");

    const busy = bodyOf(script, "setExportBusy");
    assert.match(busy, /exportBusy = which;\s*renderExportControls\(\);/, "the buttons are not redrawn with the lock");
    assert.match(busy, /if \(exportPictures !== null\) exportPictures\.disabled = which !== null;\s*if \(exportBooks !== null\) exportBooks\.disabled = which !== null;/, "the boxes can be changed under the export");
    assert.match(busy, /if \(exportProgress !== null\) exportProgress\.hidden = which === null;/, "the bar does not come and go with the export");
    assert.match(busy, /if \(which !== null\) paintExportProgress\(0, t\("reader_export_progress_preparing"\)\);/, "the bar starts without a line");
  });

  it("locks the backup before the first read, paints, and releases it whatever happens", async () => {
    const script = await source("reader/reader.js");
    const exporting = bodyOf(script, "exportList");
    assert.match(exporting, /^\{\s*if \(exportBusy !== null\) return;\s*setExportBusy\("backup"\);\s*transferStatus\(""\);/, "a second press starts a second file, or the last report stands over the new export");
    const locked = exporting.indexOf('setExportBusy("backup");');
    const painted = exporting.indexOf("await nextPaint();");
    const selection = exporting.indexOf("await exportSelection();");
    const read = exporting.indexOf("allArticles(),");
    assert.ok(locked !== -1 && locked < painted && painted < selection && selection < read, "the databases are read before the press is answered");
    assert.match(exporting, /\} catch \{\s*transferStatus\(describeError\(ErrorCode\.INTERNAL\), "error"\);\s*\} finally \{\s*setExportBusy\(null\);\s*\}/, "a failed export leaves the buttons locked");
  });

  it("counts the work off the stream's input and steps through every part", async () => {
    const script = await source("reader/reader.js");
    const stream = streamOf(script);
    assert.match(
      stream,
      /const units = exportUnits\(\{\s*phrases: input\.selection === true \? 0 : input\.phrases\.length,\s*pictures: input\.pictures \? promisedPictures\(input\.articles\) : 0,\s*articles: input\.articles\.length,\s*books: input\.books\.map\(\(book\) => \(\{ parts: book\.segmentCount, pictures: book\.pictures\?\.count \?\? 0 \}\)\),\s*\}\);\s*const meter = progressMeter\(units\.total, paintExportProgress\);/,
      "a part is left out of the count, or the meter does not paint the section's bar",
    );
    // Each stage is painted before its long stretch, and stepped once the
    // archive has taken its entries.
    assert.match(stream, /meter\.stage\(\(\) => t\("reader_import_progress_phrases", \[input\.phrases\.length\.toLocaleString\(\)\]\), units\.phrases\);\s*await nextPaint\(\);\s*\}\s*yield\* backupEntries\(input\);\s*if \(units\.phrases > 0\) meter\.step\(units\.phrases\);/, "the vocabulary's entry has no line, or is counted before it is written");
    assert.match(stream, /t\("reader_import_progress_pictures", \[seen\.toLocaleString\(\), units\.pictures\.toLocaleString\(\)\]\)/, "the pictures' line does not count towards the rows' total");
    assert.match(stream, /const kept = pictureEntries\(at, await getPictures\(article\.url\)\);[\s\S]*?seen \+= article\.pictures\.count;\s*meter\.step\(article\.pictures\.count\);\s*\}\s*if \(kept\.refs\.length === 0\) continue;/, "an article whose pictures the database lost leaves the line short of its total");
    assert.match(stream, /meter\.stage\(\(\) => t\("reader_export_progress_articles", \[articles\.length\.toLocaleString\(\)\]\), units\.articles\);\s*await nextPaint\(\);\s*\}\s*yield articlesEntry\(articles, input\.marks, input\.positions, refs\);\s*if \(units\.articles > 0\) meter\.step\(units\.articles\);/, "the articles' entry has no line, or is counted before it is written");
    assert.match(stream, /t\("reader_import_progress_books", \[turn\.toLocaleString\(\), input\.books\.length\.toLocaleString\(\)\]\)/, "the books' line does not say which book is being written");
    assert.match(stream, /turn \+= 1;\s*meter\.refresh\(\);\s*await nextPaint\(\);/, "the line does not name the book before its text is read");
    assert.match(stream, /deflate: true \};\s*meter\.step\(book\.segmentCount\);/, "a book's text is not a step");
    assert.match(stream, /meter\.step\(promised\);\s*const position = input\.positions\.get\(book\.id\);/, "a book's pictures are not a step");
  });

  it("shows the ticked documents one by one, the bar moving inside a long one", async () => {
    const script = await source("reader/reader.js");
    const exporting = bodyOf(script, "exportPickedDocuments");
    assert.match(exporting, /^\{\s*if \(documentExport \|\| exportBusy !== null \|\| picked\.size === 0\) return;\s*documentExport = true;\s*setExportBusy\(format\);\s*transferStatus\(""\);/, "the files can be started twice, or the pressed button does not answer");
    assert.match(exporting, /const meter = progressMeter\(keys\.length \* 100, paintExportProgress\);/, "the bar does not count in whole hundredths of a document");
    assert.match(exporting, /t\("reader_export_progress_documents", \[turn\.toLocaleString\(\), keys\.length\.toLocaleString\(\)\]\)/, "the line does not say which document is being written");
    assert.match(exporting, /turn \+= 1;\s*meter\.refresh\(\);\s*await nextPaint\(\);/, "the line does not name the document before it is read");
    assert.match(exporting, /\(fraction\) => \{\s*const percent = Math\.round\(fraction \* 100\);\s*meter\.step\(percent - within\);\s*within = percent;\s*\}/, "the bar stands still inside a long document");
    // A document that failed, or reported nothing, still ends on its share.
    assert.match(exporting, /\} catch \{\s*failed \+= 1;\s*\}\s*meter\.step\(100 - within\);/, "a document that could not be written leaves the bar behind");
    assert.match(exporting, /\} finally \{\s*documentExport = false;\s*setExportBusy\(null\);\s*\}/, "a failed export leaves the buttons locked");
  });

  it("answers a press on the menu's export row in the row's own line, in whole percent", async () => {
    const script = await source("reader/reader.js");
    const pressing = bodyOf(script, "onExportPress");
    assert.match(pressing, /exportNote = \{ url: target\.url, format, text: t\("reader_export_doc_progress", \[percent\]\) \};\s*if \(line !== null && shown\?\.url === target\.url\) line\.textContent = exportNote\.text;/, "the line is not kept where the menu reads it back, or is written over another document's row");
    const said = pressing.indexOf("say(0);");
    const painted = pressing.indexOf("await nextPaint();");
    const written = pressing.indexOf("await exportDocument(");
    assert.ok(said !== -1 && said < painted && painted < written, "the document is read before the press is answered");
    assert.match(pressing, /target\.url, format, say\);/, "the writing does not report to the row's line");
  });

  it("stands under the section's buttons: a bar that never animates, a line, the word about the page", async () => {
    const markup = await source("reader/reader.html");
    assert.match(
      markup,
      /<button type="button" id="library-export-markdown" hidden><\/button>\s*(?:<!--[\s\S]*?-->\s*)?<\/p>\s*(?:<!--[\s\S]*?-->\s*)?<div id="library-export-progress" class="export-progress" hidden>\s*<progress\s+id="library-export-bar"\s+class="export-progress-bar"\s+max="1"\s+value="0"\s+aria-label="Export progress"\s+data-i18n-aria-label="reader_export_progress_label"\s*><\/progress>\s*<p id="library-export-stage" class="export-stage"><\/p>\s*<p class="hint" data-i18n="reader_export_keep_open">/,
      "the progress is not under the export buttons, or the bar has no value to stand on",
    );
    assert.match(bodyOf(await source("reader/reader.js"), "paintExportProgress"), /if \(exportBar !== null\) exportBar\.value = fraction;\s*if \(exportStage !== null\) exportStage\.textContent = label;/, "the bar and the line are not painted together");
    // The import's dress under the export's own names.
    const styles = await source("reader/reader.css");
    assert.match(styles, /\.import-progress,\s*\.export-progress \{/, "the export's frame is not dressed as the import's");
    assert.match(styles, /\.import-progress-bar,\s*\.export-progress-bar \{/, "the export's bar is not dressed as the import's");
    assert.match(styles, /\.import-stage,\s*\.export-stage \{/, "the export's line is not dressed as the import's");
  });
});

describe("a document's export reports how far it is", () => {
  it("steps per part rebuilt and per entry packed, breathing only when the bar moved", async () => {
    const script = await source("reader/export-doc.js");
    assert.match(bodyOf(script, "exportArticle"), /const progress = documentProgress\(1, format, onProgress\);[\s\S]*?progress\.rebuilt\(\);\s*return writer\.finish\(progress\.packed\);/, "an article's file reports nothing");
    assert.match(bodyOf(script, "exportBook"), /const progress = documentProgress\(segments\.length, format, onProgress\);[\s\S]*?progress\.rebuilt\(\);\s*\}\s*return writer\.finish\(progress\.packed\);/, "a book's file does not step per part");
    assert.match(bodyOf(script, "epubWriter"), /await packArchive\(paced\(book\.entries\(\), packed\)\);/, "the packing is not stepped");
    // The step comes after the yield: the generator is resumed once the
    // archive has taken the entry.
    const start = script.indexOf("async function* paced(");
    assert.ok(start !== -1, "paced is missing");
    assert.match(script.slice(start, script.indexOf("\n}\n", start)), /yield entry;\s*if \(packed\(at \+ 1, entries\.length\)\) await yieldToUi\(\);/, "an entry is counted before it is packed, or the packing breathes per entry");
  });
});

describe("the export's progress in the user guide", () => {
  it("is promised in the user guide", async () => {
    const guide = await readFile(new URL("../docs/GUIDE.md", import.meta.url), "utf8");
    assert.match(guide, /\*\*While a backup is exported\.\*\* After you press \*\*Export\*\*, the button reads \*\*Exporting\.\.\.\*\* and takes no more presses, and a progress bar under the buttons shows how far the file is, with a line naming the part being written and its count/, "the guide does not describe the press's answer and the bar");
    assert.match(guide, /if the page is closed earlier, no file is written and nothing is changed\./, "the guide does not say what closing the page does");
    assert.match(guide, /While a file is written, the line under the pressed row of the menu reads \*\*Exporting\.\.\.\*\* with the percent done/, "the guide does not describe the menu row's line");
  });
});
