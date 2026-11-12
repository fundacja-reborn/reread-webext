import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { bookUnits, importUnits, pictureCount, progressMeter } from "../src/lib/reader/import-progress.js";
import { bodyOf } from "./openings.js";

/**
 * The import's progress (2026-11-12): a large backup takes minutes on a
 * slow device, and the page said nothing in that time. The rules - the work
 * counted before the first write, the meter that paints it - are held here;
 * the page's side is read at its call sites, the way `backup-page.test.js`
 * reads the import itself.
 */

/**
 * A meter with its paints kept.
 *
 * @param {number} total
 */
function metered(total) {
  /** @type {{ fraction: number, label: string }[]} */
  const paints = [];
  const meter = progressMeter(total, (fraction, label) => paints.push({ fraction, label }));
  return { meter, paints };
}

describe("the work an import means", () => {
  it("counts an article twice - written, then copied - and a book by its parts, its pictures and its row", () => {
    assert.equal(bookUnits({ parts: 63, pictures: 12 }), 76);
    assert.deepEqual(
      importUnits({
        articles: 110,
        pictures: 125,
        books: [
          { parts: 63, pictures: 12 },
          { parts: 4, pictures: 0 },
        ],
        phrases: 2113,
        highlights: 9,
      }),
      { articles: 220, pictures: 125, books: 81, phrases: 106, highlights: 9, total: 541 },
    );
  });

  it("comes to nothing for a file that brings nothing new", () => {
    assert.deepEqual(importUnits({ articles: 0, pictures: 0, books: [], phrases: 0, highlights: 0 }), {
      articles: 0,
      pictures: 0,
      books: 0,
      phrases: 0,
      highlights: 0,
      total: 0,
    });
  });

  it("counts the pictures of the given articles and of no other", () => {
    const refs = new Map([
      ["https://a.example/", [1, 2, 3]],
      ["https://b.example/", [4]],
      ["https://c.example/", []],
    ]);
    assert.equal(pictureCount(refs, ["https://a.example/", "https://c.example/", "https://nowhere.example/"]), 3);
    assert.equal(pictureCount(refs, []), 0);
  });
});

describe("the import's meter", () => {
  it("paints a stage the moment it begins, with the line as it stands then", () => {
    const { meter, paints } = metered(10);
    let done = 0;
    meter.stage(() => `Articles: ${done} of 10`, 10);
    assert.deepEqual(paints, [{ fraction: 0, label: "Articles: 0 of 10" }]);
    done = 3;
    meter.step(3);
    assert.deepEqual(paints.at(-1), { fraction: 0.3, label: "Articles: 3 of 10" });
  });

  it("repaints only when the bar moves a whole percent - a hundred paints for the longest import", () => {
    const { meter, paints } = metered(5000);
    meter.stage(() => "Pictures", 5000);
    for (let i = 0; i < 5000; i += 1) meter.step();
    // The stage's own paint, then one per percent from 1 to 100.
    assert.equal(paints.length, 101);
    assert.equal(paints.at(-1)?.fraction, 1);
    for (const [at, paint] of paints.entries()) assert.equal(paint.fraction, at / 100);
  });

  it("starts a stage where the stages before it were planned to end, whatever they counted", () => {
    const { meter, paints } = metered(100);
    meter.stage(() => "Articles", 40);
    // Fewer steps than planned: a picture the archive did not give.
    meter.step(10);
    meter.stage(() => "Pictures", 40);
    assert.deepEqual(paints.at(-1), { fraction: 0.4, label: "Pictures" });
    // More steps than planned never run into the next stage's share.
    meter.step(1000);
    assert.equal(paints.at(-1)?.fraction, 0.8);
    meter.stage(() => "Highlights", 20);
    assert.equal(paints.at(-1)?.fraction, 0.8);
    meter.step(20);
    assert.equal(paints.at(-1)?.fraction, 1);
  });

  it("never runs past the end, and never divides by an import of nothing", () => {
    const { meter, paints } = metered(10);
    meter.stage(() => "Articles", 10);
    meter.stage(() => "More than was counted", 50);
    meter.step(50);
    assert.equal(paints.at(-1)?.fraction, 1);

    const empty = metered(0);
    empty.meter.stage(() => "Saved phrases", 0);
    empty.meter.step();
    for (const paint of empty.paints) assert.ok(paint.fraction >= 0 && paint.fraction <= 1, "the bar left its range");
  });

  it("repaints on request, for a line that changed without a step", () => {
    const { meter, paints } = metered(100);
    let book = 0;
    meter.stage(() => `Book ${book} of 8`, 100);
    book = 1;
    meter.refresh();
    assert.deepEqual(paints.at(-1), { fraction: 0, label: "Book 1 of 8" });
    // A step back is not a thing: the bar only grows.
    meter.step(-5);
    assert.equal(paints.at(-1)?.fraction, 0);
  });
});

const ROOT = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

describe("the import's progress on the reading list page", () => {
  it("answers the press on the button itself and locks what could start a second import", async () => {
    const script = await source("reader/reader.js");
    const busy = bodyOf(script, "setImportBusy");
    assert.match(busy, /importRun\.disabled = busy;\s*importRun\.textContent = busy \? t\("action_importing"\) : t\("action_import"\);/, "the pressed button does not say it is importing");
    // Cancel leaves the row: a greyed or a frame-hiding Cancel over an
    // import that goes on is a button that lies.
    assert.match(busy, /if \(importCancel !== null\) importCancel\.hidden = busy;/, "Cancel stands over an import it cannot stop");
    assert.match(busy, /if \(importSettings !== null\) importSettings\.disabled = busy;/, "the settings' box can be changed under the import");
    assert.match(busy, /if \(importButton instanceof HTMLButtonElement\) importButton\.disabled = busy;/, "a second file can be picked under the import");
    assert.match(busy, /if \(importProgress !== null\) importProgress\.hidden = !busy;/, "the bar does not come and go with the import");
    assert.match(busy, /if \(busy\) paintImportProgress\(0, t\("reader_import_progress_preparing"\)\);/, "the bar starts without a line");
    for (const name of ["runBackup", "runImport"]) {
      const running = bodyOf(script, name);
      assert.match(running, /importRun === null \|\| importBusy\) return;/, `${name} runs twice at once`);
      // Painted before the first write, released whatever happens.
      const locked = running.indexOf("setImportBusy(true);");
      const painted = running.indexOf("await nextPaint();");
      const written = running.indexOf("await importArticles(");
      assert.ok(locked !== -1 && locked < painted && painted < written, `${name} writes before the press is answered`);
      assert.match(running, /\} finally \{\s*setImportBusy\(false\);\s*\}/, `${name} can leave the frame locked`);
    }
    assert.match(bodyOf(script, "dispatchImport"), /^\{\s*if \(importBusy\) return;/, "a file is taken while an import writes");
  });

  it("counts the work before the first write and steps through every part", async () => {
    const script = await source("reader/reader.js");
    const running = bodyOf(script, "runBackup");
    assert.match(running, /const adding = importPlan\(\(await listArticles\(\)\)\.map\(\(meta\) => meta\.url\), offered\.articles\)\.toAdd;/, "the articles to add are not counted from the list as it stands");
    assert.match(running, /books: shelved\.map\(\(book\) => \(\{ parts: book\.meta\.segmentCount, pictures: \(book\.pictures \?\? \[\]\)\.length \}\)\),\s*phrases: offered\.phrases\.length,\s*highlights: offered\.highlights\.length,/, "a part is left out of the count");
    assert.match(running, /const meter = progressMeter\(units\.total, paintImportProgress\);/, "the meter does not paint the frame's bar");
    assert.match(running, /const onArticle = adding\.length > 0 \? articlesStage\(meter, adding\.length, units\.articles\) : undefined;/, "a file with no new article shows an empty count");
    assert.match(running, /await writePictures\(offered\.pictures, report\.urls, meter\)/, "the pictures are written without the meter");
    assert.match(running, /meter\.stage\(\(\) => t\("reader_import_progress_phrases", \[offered\.phrases\.length\.toLocaleString\(\)\]\), units\.phrases\);/, "the vocabulary's wait has no line");
    assert.match(running, /meter\.stage\(\(\) => t\("reader_import_progress_highlights"\), units\.highlights\);/, "the highlights' wait has no line");

    // An article is counted once it is both written and copied.
    assert.match(bodyOf(script, "articlesStage"), /Math\.min\(adding, Math\.floor\(steps \/ 2\)\)\.toLocaleString\(\)/, "the line counts an article before its copy");
    const articles = await source("lib/store/articles.js");
    const importing = bodyOf(articles, "importArticles");
    assert.match(importing, /added\.push\(\{ \.\.\.meta, content, dir, lang \}\);\s*onStep\?\.\(\);/, "a written article is not a step");
    assert.match(importing, /await copyArticle\(article, false\);\s*onStep\?\.\(\);/, "a copied article is not a step");

    const pictures = bodyOf(script, "writePictures");
    assert.match(pictures, /const named = pictureCount\(pictures\.refs, urls\);\s*if \(named === 0\) return pictured;/, "the pictures' stage is not counted from the articles actually added");
    assert.match(pictures, /await putPicture\(row\);\s*seen \+= 1;\s*meter\.step\(\);/, "a written picture is not a step");
    assert.match(pictures, /const missing = refs\.length - rows\.length;\s*if \(missing > 0\) \{\s*seen \+= missing;\s*meter\.step\(missing\);/, "a picture the archive did not give leaves the line short of its total");

    const books = bodyOf(script, "importBooks");
    assert.match(books, /at \+= 1;\s*meter\.refresh\(\);\s*await nextPaint\(\);/, "the line does not name the book before its text is read");
    assert.match(books, /await putBookSegment\(\{ bookId: id, index, \.\.\.segment \}\);\s*step\(\);/, "a written part is not a step");
    assert.match(books, /await putBookPicture\(row\);\s*step\(\);/, "a kept picture is not a step");
    assert.match(books, /unreadable \+= 1;\s*meter\.step\(planned\);\s*continue;/, "a book left out keeps its share of the bar");
    assert.match(books, /meter\.step\(Math\.max\(0, planned - spent\)\);/, "a book does not end on its share of the bar");
  });

  it("says a picked backup is being read, at once, and takes no second file meanwhile", async () => {
    const script = await source("reader/reader.js");
    const dispatch = bodyOf(script, "dispatchImport");
    const said = dispatch.indexOf('transferStatus(t("reader_import_reading", [file.name]));');
    const locked = dispatch.indexOf("importButton.disabled = true;");
    const painted = dispatch.indexOf("await nextPaint();");
    const read = dispatch.indexOf("await file.arrayBuffer()");
    assert.ok(said !== -1 && said < locked && locked < painted && painted < read, "the file is read before the page says so");
    assert.match(dispatch, /\} catch \{[\s\S]*?transferStatus\(describeError\(ErrorCode\.INTERNAL\), "error"\);\s*\} finally \{\s*if \(importButton instanceof HTMLButtonElement\) importButton\.disabled = false;\s*\}/, "a file that cannot be read leaves the line or the lock standing");
    // Every way out of the offers replaces the line: with the offer (the
    // line cleared) or with the reason there is none.
    assert.match(bodyOf(script, "offerParts"), /transferStatus\(""\);\s*renderImportOffer\(\);/, "the backup's offer leaves the reading line over it");
    assert.match(bodyOf(script, "offerParsed"), /transferStatus\(""\);\s*renderImportOffer\(\);/, "the list's offer leaves the reading line over it");
  });

  it("waits for a frame, but never on a tab that gets none", async () => {
    const waiting = bodyOf(await source("reader/reader.js"), "nextPaint");
    assert.match(waiting, /const late = setTimeout\(resolve, 100\);/, "a hidden tab's import waits for a frame for ever");
    assert.match(waiting, /requestAnimationFrame\(\(\) => \{\s*setTimeout\(\(\) => \{\s*clearTimeout\(late\);\s*resolve\(\);/, "the wait ends before the frame is painted");
  });

  it("reports in view: the frame closes over the line, and the line is brought back", async () => {
    const script = await source("reader/reader.js");
    assert.match(bodyOf(script, "reportImport"), /transferStatus\(text\);\s*closeImportOffer\(\);\s*transferLine\?\.scrollIntoView\(\{ block: "nearest" \}\);/, "the report may end up above the screen");
    for (const name of ["runBackup", "runImport"]) {
      assert.match(bodyOf(script, name), /reportImport\(sentences\.join\(" "\)\);\s*await refreshLibrary\(\);/, `${name} does not report through the one door`);
    }
  });

  it("stands in the offer's frame, under its buttons: a bar that never animates, a line, the word about the page", async () => {
    const markup = await source("reader/reader.html");
    assert.match(
      markup,
      /<button type="button" id="library-import-cancel" data-i18n="action_cancel">Cancel<\/button>\s*<\/p>\s*(?:<!--[\s\S]*?-->\s*)?<div id="library-import-progress" class="import-progress" hidden>\s*<progress\s+id="library-import-bar"\s+class="import-progress-bar"\s+max="1"\s+value="0"\s+aria-label="Import progress"\s+data-i18n-aria-label="reader_import_progress_label"\s*><\/progress>\s*<p id="library-import-stage" class="import-stage"><\/p>\s*<p class="hint" data-i18n="reader_import_keep_open">/,
      "the progress is not under the offer's buttons, or the bar has no value to stand on",
    );
    // A bar without a value is the browser's running animation - a flash
    // per frame on e-ink. The paint always gives it one.
    assert.match(bodyOf(await source("reader/reader.js"), "paintImportProgress"), /if \(importBar !== null\) importBar\.value = fraction;\s*if \(importStage !== null\) importStage\.textContent = label;/, "the bar and the line are not painted together");
  });

  it("is promised in the user guide", async () => {
    const guide = await readFile(new URL("../docs/GUIDE.md", import.meta.url), "utf8");
    assert.match(guide, /\*\*While a backup is imported\.\*\* After you pick the file, a line under the buttons says it is being read/, "the guide does not say the file's reading is shown");
    assert.match(guide, /the button reads \*\*Importing\.\.\.\*\* and takes no more presses, and a progress bar under it shows how far the import is, with a line naming the part being written and its count/, "the guide does not describe the press's answer and the bar");
    assert.match(guide, /The import cannot be stopped half way, so \*\*Cancel\*\* is not shown during that time; keep the page open until the report appears in place of the frame\./, "the guide does not say why Cancel is gone and what to wait for");
  });
});
