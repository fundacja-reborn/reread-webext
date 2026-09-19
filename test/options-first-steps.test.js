import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { stepsView } from "../src/options/first-steps.js";

/**
 * The fresh install's three steps (D254, P6) and the data section under them
 * (§9). The card used to be a paragraph saying "nothing translates yet" to
 * somebody who had a model on the device: what is held here is that it now
 * reads the state instead of describing one, and that the one number the data
 * section breaks out of the total is a number the page can honestly name.
 */

const ROOT = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

/**
 * One rule's body, by its selector.
 *
 * @param {string} css
 * @param {string} selector
 */
function rule(css, selector) {
  const at = css.indexOf(`\n${selector} {`);
  assert.notEqual(at, -1, `no rule for ${selector}`);
  return css.slice(at, css.indexOf("\n}\n", at));
}

/** @param {Partial<Parameters<typeof stepsView>[0]>} state */
function view(state) {
  return stepsView({ model: false, dictionary: false, pinned: false, hidden: false, ...state });
}

describe("the first steps", () => {
  it("counts what is actually stored", () => {
    assert.deepEqual(view({}).steps, [false, false]);
    assert.equal(view({}).done, 0);
    assert.deepEqual(view({ model: true, pinned: true }).steps, [true, true]);
    assert.equal(view({ model: true, pinned: true }).done, 2);
  });

  it("asks for one of the two downloads, not for both (Michał, 2026-09-19)", () => {
    // Neither is required: a model translates sentences, a dictionary
    // explains words, and either one alone makes the bubble answer. A card
    // that asked for them in turn said something untrue about the one that
    // is optional.
    assert.equal(view({ model: true }).steps[0], true, "a model does not answer the first step");
    assert.equal(view({ dictionary: true }).steps[0], true, "a dictionary does not answer the first step");
    assert.equal(view({ model: true, dictionary: true }).steps[0], true);
    assert.equal(view({}).steps[0], false, "an empty device counts as set up");
    // And the sentence that explains it goes with the step.
    assert.equal(view({ dictionary: true }).intro, false, "the sentence stands over a step already done");
    assert.equal(view({ dictionary: true }).open, false, "the card stays open with its first step done");
  });

  it("stands open while the first step is undone, and folds to one line after it", () => {
    assert.equal(view({}).open, true, "a fresh install does not open the card");
    assert.equal(view({}).intro, true, "a fresh install is not told what to do");
    assert.equal(view({ model: true }).open, false, "the card stays open with the first step done");
    assert.equal(view({ model: true }).show, true, "the card leaves with a step to go");
  });

  it("leaves for good once every step is done, or once it is put away", () => {
    assert.equal(view({ model: true, pinned: true }).show, false, "a finished card still stands");
    assert.equal(view({ hidden: true }).show, false, "the card comes back after being put away");
    // Put away and then finished is still put away - and still countable, so
    // the way back in the About section shows the truth.
    assert.equal(view({ hidden: true, model: true }).done, 1);
  });

  it("writes its state beside the settings, never inside them", async () => {
    const script = await source("options/first-steps.js");
    assert.match(script, /export const STEPS_KEY = "firstSteps";/, "the card has no key of its own");
    // The shape of `config` is a contract with every version that came
    // before; this round adds one key beside it and changes none of it.
    assert.doesNotMatch(script, /CONFIG_KEY|writeConfig/, "the card writes into the settings themselves");
    const config = await source("lib/config.js");
    assert.doesNotMatch(config, /firstSteps/, "the settings grew a field for the card");
  });

  it("asks the browser about the toolbar, and asks the reader where it will not say", async () => {
    const script = await source("options/first-steps.js");
    assert.match(script, /typeof action\?\.getUserSettings !== "function"/, "the browser is asked without being checked first");
    assert.match(script, /return typeof settings\?\.isOnToolbar === "boolean" \? settings\.isOnToolbar : null;/, "an answer that is not a yes or a no is taken for one");
    const types = await readFile(new URL("../types/webext.d.ts", ROOT), "utf8");
    assert.match(types, /getUserSettings\?\(\): Promise<\{ isOnToolbar\?: boolean \}>;/, "the API is used without being declared");

    const markup = await source("options/options.html");
    assert.match(markup, /<button type="button" class="step-done" id="step-pin-done"/, "there is no way to tick the step by hand");
  });

  it("gives every step its own way in, and the card a way out and back", async () => {
    const markup = await source("options/options.html");
    // A step is pressed to go and fetch one, so each lands on the block the
    // fetching happens in (D263, K5), not on the subsection's heading.
    assert.match(markup, /<a class="step-door" href="#translation-models-available"/, "the model step does not lead to the models catalogue");
    assert.match(markup, /<a class="step-door" href="#dictionaries-available"/, "the dictionary step does not lead to the dictionaries catalogue");
    assert.match(markup, /id="first-steps-hide"/, "the card cannot be put away");
    assert.match(markup, /id="first-steps-show"/, "a card put away cannot be brought back");
    assert.ok(
      markup.indexOf('id="first-steps-show"') > markup.indexOf('<h2 id="about"'),
      "the way back does not stand in the About section",
    );

    const options = await source("options/options.js");
    // The card is redrawn by both frame renders, so a model downloaded now
    // ticks its step now - with no reload.
    assert.ok((options.match(/renderFirstSteps\(\);/g) ?? []).length >= 3, "the card is not redrawn where the stores change");
  });

  it("says the state of each step in words as well as in a glyph", async () => {
    const options = await source("options/options.js");
    assert.match(options, /t\("options_step_done_state"\) : t\("options_step_todo_state"\)/, "a screen reader hears only a tick");
    const markup = await source("options/options.html");
    assert.equal((markup.match(/<span class="visually-hidden step-state"><\/span>/g) ?? []).length, 2, "not every step says its state");
    const css = await source("options/options.css");
    assert.doesNotMatch(css, /\.steps li\.is-done \{\s*color/, "the state is told by colour alone");
  });
});

describe("the data section", () => {
  it("says where the space went, off metadata alone (F8)", async () => {
    const markup = await source("options/options.html");
    const options = await source("options/options.js");
    for (const id of ["storage-models", "storage-dictionaries", "storage-library", "storage-phrases", "storage-other"]) {
      assert.ok(markup.includes(`id="${id}"`), `the breakdown has no line for ${id}`);
    }
    assert.match(options, /models\.reduce\(\(sum, model\) => sum \+ model\.bytes, 0\)/, "the models' share is not summed from their own metadata");
    assert.match(options, /dictionaries\.reduce\(\(sum, one\) => sum \+ one\.bytes, 0\)/, "the dictionaries' share is not summed from their own metadata");
    // Whatever the browser's estimate has over the four parts - the indexes,
    // the caches, a dictionary's cost over the weight of its text - and never
    // a negative number when the estimate comes in under them.
    assert.match(options, /Math\.max\(0, report\.usage - known\)/, "Other is not the remainder, or can go negative");
    // Nothing here opens a document or a dictionary row: the library is read
    // off the rows the reading list itself lists.
    const library = options.slice(options.indexOf("async function libraryBytes"), options.indexOf("\n}\n", options.indexOf("async function libraryBytes")));
    assert.doesNotMatch(library, /readArticle|readBook|openDictionary|entriesOf/, "counting the space opens the documents");

    // And the fold says what the total is and what it is not, in every language.
    for (const locale of ["en", "pl", "de", "fr", "es", "uk"]) {
      const catalogue = JSON.parse(await source(`_locales/${locale}/messages.json`));
      const note = catalogue["options_storage_how_more"].message;
      assert.ok(note.length > 200, `${locale} does not say what the total counts`);
    }
  });

  it("gathers every explanation of the copies under one heading (D260)", async () => {
    const markup = await source("options/options.html");
    const at = markup.indexOf('<h3 id="copies"');
    assert.ok(at > 0, "the copies have no heading of their own");
    const block = markup.slice(at, markup.indexOf("</section>", at));
    // One sentence in the open, the rest of it behind one More - the three
    // explanations that stood a screen apart (a paragraph under the table,
    // the switch's own fold, and the switch's hint) are one now.
    assert.match(block, /data-i18n="options_copies_intro"/, "the subsection opens on nothing");
    assert.match(block, /aria-controls="more-copies"/, "the rest of it has no way in");
    assert.doesNotMatch(markup, /options_copies_safe|options_library_copy_more|options_storage_to_file/, "an explanation the round gathered still stands on its own");
    // And the switch itself moved under the heading it belongs to.
    assert.ok(block.includes('id="s-libraryCopy"'), "the one copy that is a choice stands elsewhere");
    assert.equal((block.match(/class="note-more"/g) ?? []).length, 1, "the subsection says the same thing behind two folds");
  });

  it("says each copy in a table with named columns (D260)", async () => {
    const markup = await source("options/options.html");
    const at = markup.indexOf('<table class="copies">');
    assert.ok(at > 0, "the copies are not a table");
    const block = markup.slice(at, markup.indexOf("</table>", at));
    for (const id of ["storage-backup", "storage-marks-backup", "storage-library-copy"]) {
      assert.ok(block.includes(`id="${id}"`), `${id} is not in the copies table`);
    }
    // Named columns rather than three values a reader has to infer.
    for (const key of ["options_copies_head_name", "options_copies_head_holds", "options_copies_head_when"]) {
      assert.match(block, new RegExp(`<th scope="col" data-i18n="${key}"`), `the table has no ${key} column`);
    }
    assert.equal((block.match(/<th scope="row" class="copy-name"/g) ?? []).length, 3, "a copy does not say what it is");
    assert.equal((block.match(/class="copy-holds"/g) ?? []).length, 3, "a copy does not say what it holds");
    assert.equal((block.match(/class="copy-when"/g) ?? []).length, 3, "a copy does not say when it was written");

    const options = await source("options/options.js");
    assert.match(options, /date\.textContent = at \?\? "\\u2014";/, "a copy with no date says nothing where the date stands");
    // The reading list's copy says its date like the other two (D260): the
    // dash is for a copy that was never written, not for one with 61
    // documents in it.
    assert.match(options, /copy === null \|\| copy\.writtenAt === null \? null : when\(copy\.writtenAt\)/, "the reading list's copy can never say when it changed");
    assert.match(options, /: t\("options_copies_off"\)/, "a copy that is switched off does not say so");

    const css = await source("options/options.css");
    assert.match(rule(css, ".copies"), /border-collapse: collapse/, "the table is not drawn as one");
    assert.match(rule(css, ".copies thead th"), /border-bottom: var\(--sep-row\)/, "the column names are not parted from the rows");
    assert.match(rule(css, ".copies"), /font-variant-numeric: tabular-nums/, "a column of dates and counts does not line up");
    // The table stands inset in its card like a list, and a card too narrow
    // for three columns takes it apart into blocks (D265).
    assert.match(rule(css, ".copies"), /margin: 0 var\(--row-pad-x\)/, "the table's lines are not the card's own");
    assert.match(css, /@container \(max-width: 30rem\) \{\n  \/\* A label and a control[\s\S]*?\.copies,\n  \.copies tbody,\n  \.copies tr \{\n    display: block;/, "three columns stay three columns in a narrow card");
  });

  it("promises of the export only what the export actually writes (D260)", async () => {
    // The note names four things in reread-backup.zip and says models and
    // dictionaries are not in it. What writes that file is `backup-file.js`,
    // and this is the claim checked against it rather than against memory.
    const backup = await source("lib/store/backup-file.js");
    for (const entry of ["ARTICLES_ENTRY", "BOOKS_ENTRY", "SETTINGS_ENTRY", "VOCABULARY_ENTRY", "toMarksCopy"]) {
      assert.ok(backup.includes(entry), `the backup no longer writes ${entry}`);
    }
    assert.match(backup, /BACKUP_FILENAME = "reread-backup\.zip"/, "the file is no longer called what the note says");
    assert.doesNotMatch(backup, /models|dictionar/i, "the backup grew models or dictionaries, which the note says it has not");
    // And the saved phrases' own export is the other format the note names.
    const vocab = await source("vocab/vocab.js");
    assert.match(vocab, /toTsv|toAnkiTsv/, "the saved phrases no longer export TSV");
  });

  it("points at the one page the whole export is made on, without inventing a message", async () => {
    const markup = await source("options/options.html");
    assert.match(markup, /id="copy-library"/, "there is no way to the reading list");
    // The saved phrases' own export is a different file and a different
    // format; a second door promising the same thing is gone, and the note
    // says the difference in a sentence (D260).
    assert.doesNotMatch(markup, /id="copy-vocabulary"/, "the second door is still there");
    const options = await source("options/options.js");
    assert.match(options, /copy-library"\)\?\.addEventListener\("click", \(\) => \{\s*void webext\(\)\.runtime\.sendMessage\(\{ kind: Message\.OPEN_LIBRARY \}\)/, "the reading list is opened some other way");
    assert.doesNotMatch(options, /OPEN_VOCABULARY \}\)\.catch\(\(\) => \{\}\);\s*\}\);\s*document\.getElementById\("add-model"/, "the saved phrases are still opened from the copies note");
    // The message the background answers carries no section for these pages,
    // and this round changes no protocol.
    const protocol = await source("lib/protocol.js");
    assert.doesNotMatch(protocol, /OpenLibraryRequest, section/, "the protocol grew a field this round");
  });
});
