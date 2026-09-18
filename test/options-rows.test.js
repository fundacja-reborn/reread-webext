import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * The settings rows themselves (D254, P5, P8, P9): the sentence every note
 * says out loud, the rest of it behind the row's own More, the rows that only
 * exist under another row, and the word a field says when what was typed in it
 * is stored.
 *
 * The rule this file exists for: no description on this page may be clipped
 * in mid-sentence again. That is a fact about the markup and the catalogues,
 * and neither shows it in a smoke test run in one language.
 */

const ROOT = new URL("../src/", import.meta.url);
const LOCALES = ["en", "pl", "de", "fr", "es", "uk"];

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

describe("the settings rows", () => {
  it("clips no description any more: the fold and its chevron are gone", async () => {
    const markup = await source("options/options.html");
    const script = await source("options/options.js");
    const css = await source("options/options.css");
    assert.doesNotMatch(markup, /data-fold/, "a note is still clipped to two lines and an ellipsis");
    assert.doesNotMatch(markup, /note-chevron/, "the fold's chevron is still drawn");
    assert.doesNotMatch(script, /foldNotes|judgeFold/, "the page still measures whether a note overflows");
    assert.doesNotMatch(css, /note-fold|note-toggle/, "the fold's box is still dressed");
    // The measuring is what made the chevron promise more where there was
    // none, and what Chrome reported as a ResizeObserver loop.
    assert.doesNotMatch(script, /new ResizeObserver/, "a note's size is still watched");
  });

  it("gives every More a paragraph to open, and every paragraph a More", async () => {
    const markup = await source("options/options.html");
    const opens = [...markup.matchAll(/aria-controls="(more-[A-Za-z]+)"/g)].map((match) => String(match[1]));
    const rests = [...markup.matchAll(/<p class="row-note row-more" id="(more-[A-Za-z]+)"/g)].map((match) =>
      String(match[1]),
    );
    assert.deepEqual(opens, rests, "a More opens nothing, or a folded half has no way in");
    assert.ok(opens.length >= 15, `only ${opens.length} rows say more than their sentence`);
    // Each rest is hidden until the press - `hidden`, not a clip, so a screen
    // reader hears the sentence and the rest exactly as the eye does.
    for (const id of rests) {
      const at = markup.indexOf(`id="${id}"`);
      assert.match(markup.slice(at, markup.indexOf(">", at)), /hidden/, `${id} stands open`);
    }
  });

  it("says one whole sentence in every language, with the rest behind the More", async () => {
    const markup = await source("options/options.html");
    // Only the notes built as "one sentence, then More": the pair's note is a
    // sentence broken around a link to the models, and its halves are held
    // together by the markup rather than each ending in a full stop.
    const hints = [
      ...markup.matchAll(
        /<p class="row-note">\s*<span data-i18n="([a-z_]+)"\s*>[^<]*<\/span\s*>&nbsp;<button type="button" class="note-more"/g,
      ),
    ].map((match) => String(match[1]));
    assert.ok(hints.length >= 15, `only ${hints.length} rows open with a sentence of their own`);
    for (const locale of LOCALES) {
      const catalogue = JSON.parse(await source(`_locales/${locale}/messages.json`));
      for (const key of hints) {
        const sentence = catalogue[key]?.message;
        assert.equal(typeof sentence, "string", `${locale} has no ${key}`);
        // A sentence, whole: it ends in a full stop and never in the ellipsis
        // the old clip left in the middle of one.
        assert.doesNotMatch(sentence, /\.\.\.|…/, `${locale}/${key} trails off`);
        assert.match(sentence, /[.!?]$/, `${locale}/${key} does not end a sentence`);
      }
      // And the rest of it is there, in the same language.
      for (const key of [...markup.matchAll(/row-more" id="more-[A-Za-z]+" data-i18n="([a-z_]+)"/g)]) {
        const rest = catalogue[String(key[1])]?.message;
        assert.equal(typeof rest, "string", `${locale} has no ${key[1]}`);
        assert.ok(rest.length > 0, `${locale}/${key[1]} is empty`);
      }
    }
  });

  it("stands a dependent row under the row it depends on, and takes it away with it", async () => {
    const markup = await source("options/options.html");
    const children = [...markup.matchAll(/id="s-([A-Za-z]+)" data-setting="[A-Za-z]+" data-parent="([A-Za-z]+)"/g)].map(
      (match) => ({ row: String(match[1]), parent: String(match[2]) }),
    );
    assert.deepEqual(
      children,
      [
        { row: "bubbleOff", parent: "translationOff" },
        { row: "ttsVoices", parent: "ttsOff" },
        { row: "ttsRate", parent: "ttsOff" },
      ],
      "the page's dependent rows have changed",
    );
    // Each child stands right under its parent, and wears the indent.
    for (const { row, parent } of children) {
      assert.ok(
        markup.indexOf(`id="s-${parent}"`) < markup.indexOf(`id="s-${row}"`),
        `${row} stands before the row it depends on`,
      );
      const at = markup.indexOf(`id="s-${row}"`);
      assert.match(markup.slice(markup.lastIndexOf("<div", at), at), /row-sub/, `${row} is not drawn as a child`);
    }
    const css = await source("options/options.css");
    // One line down the leading edge and no box around the group (D258, V3):
    // with a rule over it and a rule under it the two voice rows read as a
    // box inside a list, heavier than anything else on the page.
    assert.match(rule(css, ".row-sub"), /border-inline-start: 2px solid var\(--page-line\)/, "no line joins a child to its parent");
    assert.doesNotMatch(rule(css, ".row-sub"), /border-top|border-bottom/, "the group of children is drawn as a box");

    const script = await source("options/options.js");
    assert.match(script, /row\.hidden = !parent\.checked;/, "a child stays on the page with its parent switched off");
    assert.doesNotMatch(script, /classList\.toggle\("no-tts"/, "the voice rows still leave by a body class");
  });

  it("says when what was typed into a field is stored, and takes the word back on the next keystroke", async () => {
    const markup = await source("options/options.html");
    for (const field of ["font-custom", "reading-pace"]) {
      assert.match(
        markup,
        new RegExp(`<output class="field-saved" id="${field}-saved" data-i18n="options_field_saved" hidden>`),
        `${field} never says what was stored`,
      );
    }
    const script = await source("options/options.js");
    assert.match(script, /tellSaved\("font-custom", true\)/, "the font's name is stored without saying so");
    assert.match(script, /tellSaved\("font-custom", false\)/, "the word stands over a field being retyped");
    assert.match(script, /tellSaved\("reading-pace", true\)/, "the pace is stored without saying so");
    assert.match(script, /tellSaved\("reading-pace", false\)/, "the word stands over a pace being retyped");
    // Never on a clock: every disappearance is one more refresh of an e-ink
    // panel, and the word has a reason to leave - the next keystroke.
    const body = script.slice(script.indexOf("function tellSaved"), script.indexOf("\n}\n", script.indexOf("function tellSaved")));
    assert.doesNotMatch(body, /setTimeout/, "the word leaves on a timer");
  });

  it("says the warning about single words in the section's own prose, and ends it at the dictionaries (P8, F7)", async () => {
    const markup = await source("options/options.html");
    // A highlighter's stroke until D254, the page's framed note until F7:
    // two framed notes one under the other read as two warnings, and the
    // frame belongs to the one that says where a download comes from.
    assert.match(markup, /<span data-i18n="options_models_single_word"/, "the warning is not a paragraph of the section's prose");
    assert.doesNotMatch(markup, /<p class="note" data-i18n="options_models_single_word">/, "the warning still wears the note's frame");
    assert.doesNotMatch(markup, /<mark data-i18n=/, "a paragraph still wears the highlighter's own wash");
    const at = markup.indexOf('data-i18n="options_models_single_word"');
    assert.match(markup.slice(at, at + 600), /<a href="#dictionaries"/, "the warning does not end at the dictionaries");
    // And one framed note in the models subsection, not two.
    const section = markup.slice(markup.indexOf('<h3 id="translation-models"'), markup.indexOf('<h3 id="dictionaries"'));
    assert.equal((section.match(/<p class="note"/g) ?? []).length, 1, "the models subsection wears more than one framed note");
    const css = await source("options/options.css");
    assert.doesNotMatch(css, /p\.explain mark/, "the highlighter's stroke is still dressed on this page");
  });

  it("ties every fold's trigger to the sentence it follows (F6)", async () => {
    const markup = await source("options/options.html");
    // The word is Details, not More: the bubble has a button called More, and
    // a sentence naming it stood beside a trigger with the same word.
    assert.doesNotMatch(markup, /data-i18n="options_note_more"/, "a fold is still called More");
    assert.equal((markup.match(/data-i18n="options_details"/g) ?? []).length, 19, "not every fold is called Details");
    // Hard space, so the trigger goes over a wrapping line with the last word.
    assert.equal((markup.match(/<\/span\s*>&nbsp;<button type="button" class="note-more"/g) ?? []).length, 19, "a trigger can be left alone at the start of a line");
    const css = await source("options/options.css");
    assert.match(rule(css, "button.note-more"), /white-space: nowrap/, "the trigger's own words can be split");
    // And the one sentence that names the bubble's button says it in quotes.
    for (const locale of LOCALES) {
      const catalogue = JSON.parse(await source(`_locales/${locale}/messages.json`));
      assert.match(catalogue["options_bubble_more_hint"].message, /[«„“"]/, `${locale} names the bubble's button without quoting it`);
    }
  });

  it("says the option in force right under the sentence, before the folded rest (§6.4)", async () => {
    const markup = await source("options/options.html");
    for (const [setting, line] of [
      ["touchTurn", "touch-turn-note"],
      ["turnEffect", "turn-effect-note"],
    ]) {
      const sentence = markup.indexOf(`aria-controls="more-${setting}"`);
      const chosen = markup.indexOf(`id="${line}"`);
      const rest = markup.indexOf(`id="more-${setting}"`);
      assert.ok(sentence > 0 && chosen > sentence, `${setting} says nothing about the option in force`);
      assert.ok(rest > chosen, `${setting} buries the option in force under the folded rest`);
    }
  });
});
