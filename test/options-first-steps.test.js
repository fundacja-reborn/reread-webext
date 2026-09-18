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

/** @param {Partial<Parameters<typeof stepsView>[0]>} state */
function view(state) {
  return stepsView({ model: false, translationOff: false, dictionary: false, pinned: false, hidden: false, ...state });
}

describe("the first steps", () => {
  it("counts what is actually stored", () => {
    assert.deepEqual(view({}).steps, [false, false, false]);
    assert.equal(view({}).done, 0);
    assert.deepEqual(view({ model: true, dictionary: true, pinned: true }).steps, [true, true, true]);
    assert.equal(view({ model: true, dictionary: true, pinned: true }).done, 3);
  });

  it("counts reading without a model as translation set up", () => {
    // Somebody who switched translation off has finished setting translation
    // up - the card must not ask them for a model they have refused.
    assert.equal(view({ translationOff: true }).steps[0], true);
    assert.equal(view({ translationOff: true }).open, false);
    assert.equal(view({ translationOff: true }).intro, false, "the old sentence still contradicts the page");
  });

  it("stands open while the first step is undone, and folds to one line after it", () => {
    assert.equal(view({}).open, true, "a fresh install does not open the card");
    assert.equal(view({}).intro, true, "a fresh install is not told what to do");
    assert.equal(view({ model: true }).open, false, "the card stays open with the first step done");
    assert.equal(view({ model: true }).show, true, "the card leaves with two steps to go");
  });

  it("leaves for good once every step is done, or once it is put away", () => {
    assert.equal(view({ model: true, dictionary: true, pinned: true }).show, false, "a finished card still stands");
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
    assert.match(markup, /<a class="step-door" href="#translation-models"/, "the model step does not lead to the models");
    assert.match(markup, /<a class="step-door" href="#dictionaries"/, "the dictionary step does not lead to the dictionaries");
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
    assert.equal((markup.match(/<span class="visually-hidden step-state"><\/span>/g) ?? []).length, 3, "not every step says its state");
    const css = await source("options/options.css");
    assert.doesNotMatch(css, /\.steps li\.is-done \{\s*color/, "the state is told by colour alone");
  });
});

describe("the data section", () => {
  it("breaks out only the share it can name honestly", async () => {
    const options = await source("options/options.js");
    // A model's metadata carries what it takes on disk, so the sum of them is
    // a true part of the total. Nothing else on this page is.
    assert.match(options, /models\.reduce\(\(sum, model\) => sum \+ model\.bytes, 0\)/, "the models' share is not summed from their own metadata");
    assert.match(options, /fill\("storage-models"/, "the share is never said");
    assert.doesNotMatch(options, /dictionaries\.reduce\(\(sum[^)]*\) => sum \+ [a-z]+\.bytes/, "the dictionaries' text is passed off as their cost on disk");

    // And the note says what is left unbroken, in every language.
    for (const locale of ["en", "pl", "de", "fr", "es", "uk"]) {
      const catalogue = JSON.parse(await source(`_locales/${locale}/messages.json`));
      const note = catalogue["options_storage_how_more"].message;
      assert.ok(note.length > 200, `${locale} does not say what the total leaves unbroken`);
    }
  });

  it("gathers the copies under one heading, with the figures on the digits' own width", async () => {
    const markup = await source("options/options.html");
    const at = markup.indexOf('<h3 id="copies"');
    assert.ok(at > 0, "the copies have no heading of their own");
    const block = markup.slice(at, markup.indexOf("</ul>", at));
    for (const id of ["storage-backup", "storage-marks-backup", "storage-library-copy"]) {
      assert.ok(block.includes(`id="${id}"`), `${id} is not in the copies block`);
    }
    const css = await source("options/options.css");
    assert.match(css, /\.copies \{[\s\S]*?font-variant-numeric: tabular-nums;/, "a column of dates and counts does not line up");
  });

  it("points at the pages a copy to a file is made on, without inventing a message", async () => {
    const markup = await source("options/options.html");
    assert.match(markup, /id="copy-library"/, "there is no way to the reading list");
    assert.match(markup, /id="copy-vocabulary"/, "there is no way to the saved phrases");
    const options = await source("options/options.js");
    assert.match(options, /copy-library"\)\?\.addEventListener\("click", \(\) => \{\s*void webext\(\)\.runtime\.sendMessage\(\{ kind: Message\.OPEN_LIBRARY \}\)/, "the reading list is opened some other way");
    // The message the background answers carries no section for these pages,
    // and this round changes no protocol.
    const protocol = await source("lib/protocol.js");
    assert.doesNotMatch(protocol, /OpenLibraryRequest, section/, "the protocol grew a field this round");
  });
});
