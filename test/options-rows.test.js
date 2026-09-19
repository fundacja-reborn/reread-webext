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
    const opens = [...markup.matchAll(/aria-controls="(more-[A-Za-z-]+)"/g)].map((match) => String(match[1]));
    // A More stands in a row's note and over a section's opening sentence
    // alike; both open the same kind of paragraph.
    const rests = [...markup.matchAll(/<p class="(?:row-note|explain) row-more" id="(more-[A-Za-z-]+)"/g)].map((match) =>
      String(match[1]),
    );
    assert.deepEqual(opens, rests, "a More opens nothing, or a folded half has no way in");
    // A floor, moved down by hand when a fold is deliberately taken off a
    // row (Michał, 2026-09-19: the font name and the reading pace say all
    // they have to say in the row, 15 -> 13; the voice too, 13 -> 12, and the
    // bubble's own switch, 12 -> 11; the quiet bubble lost its description
    // altogether, 11 -> 10, the reader-only switch its fold, 10 -> 9, and the
    // page number its own, 9 -> 8).
    assert.ok(opens.length >= 8, `only ${opens.length} rows say more than their sentence`);
    // Each rest is hidden until the press - `hidden`, not a clip, so a screen
    // reader hears the sentence and the rest exactly as the eye does.
    for (const id of rests) {
      const at = markup.indexOf(`id="${id}"`);
      assert.match(markup.slice(at, markup.indexOf(">", at)), /hidden/, `${id} stands open`);
    }

    // The same pairing for what a checkbox points at: a box naming a
    // description that is not there tells a screen reader about nothing, and
    // a description nobody points at is never read out with the switch it
    // explains. Both directions, because this round took a description away
    // from a row whose name says the whole of it (Michał, 2026-09-19).
    const pointed = [...markup.matchAll(/aria-describedby="(hint-[A-Za-z]+)"/g)].map((match) => String(match[1]));
    const hints = [...markup.matchAll(/<p class="row-note" id="(hint-[A-Za-z]+)"/g)].map((match) => String(match[1]));
    assert.deepEqual([...pointed].sort(), [...hints].sort(), "a box names a description that is not there, or one goes unnamed");
  });

  it("says one whole sentence in every language, with the rest behind the More", async () => {
    const markup = await source("options/options.html");
    // Only the notes built as "one sentence, then More": the pair's note is a
    // sentence broken around a link to the models, and its halves are held
    // together by the markup rather than each ending in a full stop.
    const hints = [
      ...markup.matchAll(
        /<p class="row-note"(?: id="hint-[A-Za-z]+")?>\s*<span data-i18n="([a-z_]+)"\s*>[^<]*<\/span\s*><span class="note-tail">&nbsp;<button type="button" class="note-more"/g,
      ),
    ].map((match) => String(match[1]));
    // A floor, not a count: it fails when the shape is abandoned wholesale,
    // and moves down by hand when a row is deliberately left without a fold
    // (D264 took the fold off both Pages-layout select rows, 16 -> 14;
    // Michał's second round on the panels took it off the translation-off
    // switch, whose whole answer is two sentences long, 14 -> 13; his smoke of
    // 2026-09-19 took it off the font name and the reading pace, where half
    // the answer behind a press is half a setting, 13 -> 11, and off the
    // voice, whose folded half said where the speech is made, 11 -> 10, and
    // the bubble's switch, whose folded half held the reason to leave it on,
    // 10 -> 9; the quiet bubble, whose name says the whole of it, 9 -> 8; and
    // the reader-only switch, 8 -> 7; the page number, 7 -> 6).
    assert.ok(hints.length >= 6, `only ${hints.length} rows open with a sentence of their own`);
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
    // Since D265 the indent is the whole of it: a child's words begin where
    // its parent's words do - the checkbox's own column - and its hairline is
    // inset the same. The line down the leading edge was the flat page's way
    // of saying "these belong to the row above"; inside a card, standing
    // under it and indented to it says the same with no second boundary.
    const child = rule(css, ".row.row-sub");
    assert.match(child, /padding-inline-start: calc\(var\(--row-pad-x\) \+ var\(--row-indent\)\)/, "a child is not indented to its parent's own column");
    assert.doesNotMatch(child, /border/, "a child is joined to its parent by a line again");
    assert.match(
      css,
      /:is\(\.card, \.rows\) > :where\(:not\(\[hidden\]\)\) ~ \.row-sub:not\(\[hidden\]\)::after \{\n  inset-inline-start: calc\(var\(--row-pad-x\) \+ var\(--row-indent\)\);/,
      "a child's hairline is not inset to its own column",
    );

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
    // In this order (Michał, 2026-09-19): what does the translating, the
    // warning, and only then how a model is fetched. Somebody reading this
    // section is deciding whether to download anything at all, and the
    // sentence that can send them to the dictionaries instead is no use
    // standing after the one about downloading.
    const engine = markup.indexOf('data-i18n="options_engine_value"');
    const intro = markup.indexOf('data-i18n="options_models_intro"');
    assert.ok(engine > 0 && at > engine, "the warning no longer follows the line about the engine");
    assert.ok(intro > at, "the prose about fetching a model stands before the warning again");
    // Two quiet notes in the models subsection since Michał's smoke: where
    // the downloads come from, and how old the list of them is. Neither is
    // framed any more (D265, D4) - the frame is kept for the one warning on
    // the page - so what this counts is paragraphs in the page's small print,
    // not boxes.
    const section = markup.slice(markup.indexOf('<h3 id="translation-models"'), markup.indexOf('<h3 id="dictionaries"'));
    assert.equal((section.match(/<p class="note"/g) ?? []).length, 2, "the models subsection lost one of its two quiet notes");
    const css = await source("options/options.css");
    assert.doesNotMatch(css, /p\.explain mark/, "the highlighter's stroke is still dressed on this page");
  });

  it("stands a description under the name it explains, not under the control beside it (Michał, 2026-09-19)", async () => {
    const css = await source("options/options.css");
    const markup = await source("options/options.html");
    // A control row is two tracks: the name and its description in the first,
    // the control in the second. A description spanning both began a
    // control's height below its own label - the name at the top of the row
    // and its sentence several lines under it, with the field in between.
    assert.match(
      rule(css, ".row-value:not(.row-storage) > .row-note"),
      /grid-column: 1/,
      "a description still stands under the control as well",
    );
    // The two rows that sent this round: a name to type and a number to type,
    // each saying the whole of what it is for in the row itself. Half an
    // answer behind a press is half a setting - somebody fills the field in
    // and wonders why nothing changed.
    for (const row of ["s-fontFamily", "s-readingPace"]) {
      const at = markup.indexOf(`id="${row}"`);
      assert.ok(at > 0, `no row ${row}`);
      const block = markup.slice(at, markup.indexOf("</div>", at));
      assert.doesNotMatch(block, /note-more/, `${row} still keeps half of its answer behind a press`);
      assert.match(block, /<p class="row-note" data-i18n="/, `${row} lost the description of its own`);
    }
    // And the field is the width of a font name rather than of the column: it
    // stands beside a sentence now.
    assert.match(rule(css, "#font-custom"), /width: 14rem/, "the font field takes the room its description reads in");
    // The control keeps the row's far edge and holds both lines of the first
    // column, so nothing stands between a name and its own sentence.
    assert.match(
      rule(css, ".row-value:has(> .row-note):not(.row-stack) > :is(select, button, output, .inline, .stepper)"),
      /grid-row: 1 \/ span 2;[\s\S]*grid-column: 2/,
      "the control still makes the first line its own height",
    );

    // Under a checkbox the description begins in the label's column rather
    // than under the box: the hanging indent leaves a card of switches one
    // edge for the boxes and one for the words - the column the eye runs
    // down. The plan asked for it at D265 ("aligned to the label, not to the
    // box") and a later rule of equal weight had been overriding the row's
    // own ever since (Michał's smoke, 2026-09-19).
    assert.match(rule(css, ".row-check > .row-note"), /grid-column: 2/, "a description still wraps under the checkbox");
    assert.ok(
      css.indexOf(".row-check > .row-note {") > css.indexOf(".row > .row-note {"),
      "the exception stands before the rule it has to beat - a tie in weight is settled by order",
    );

    // On a card too narrow for a label, a field and a button on one line, the
    // break goes after the label - not after the field, which left the button
    // alone on a line of its own (Michał, 2026-09-19). Only where the label
    // is the one label of its line: a row that reads as a sentence ("Words in
    // ... explained in ...") would come apart into four lines instead of two.
    const narrow = css.slice(css.indexOf("@container (max-width: 30rem)"));
    assert.match(narrow, /\.inline > label:only-of-type \{\s*flex: 1 0 100%;/, "the button is still left alone under the field");
  });

  it("ties every fold's trigger to the sentence it follows (F6)", async () => {
    const markup = await source("options/options.html");
    // The word is Details, not More: the bubble has a button called More, and
    // a sentence naming it stood beside a trigger with the same word.
    assert.doesNotMatch(markup, /data-i18n="options_note_more"/, "a fold is still called More");
    assert.equal((markup.match(/data-i18n="options_details"/g) ?? []).length, 8, "not every fold is called Details");
    // Hard space, so the trigger goes over a wrapping line with the last word.
    // The hard space and the trigger in one box that cannot break (D259, K2):
    // measured in the browser, the hard space alone let the trigger open a
    // line of its own at 49 widths out of 231.
    assert.equal((markup.match(/<\/span\s*><span class="note-tail">&nbsp;<button type="button" class="note-more"/g) ?? []).length, 8, "a trigger can be left alone at the start of a line");
    const css = await source("options/options.css");
    assert.match(rule(css, ".note-tail"), /white-space: nowrap/, "the space before a trigger is a break opportunity again");
    assert.match(rule(css, "button.note-more"), /white-space: nowrap/, "the trigger's own words can be split");
    // And the one sentence that names the bubble's button says it in quotes.
    for (const locale of LOCALES) {
      const catalogue = JSON.parse(await source(`_locales/${locale}/messages.json`));
      assert.match(catalogue["options_bubble_more_hint"].message, /[«„“"]/, `${locale} names the bubble's button without quoting it`);
    }
  });

  it("says the option in force in the row's own note, with no fold over it (§6.4, D264)", async () => {
    const markup = await source("options/options.html");
    // The two select rows of the Pages layout each say what the value in
    // force does. What stood around that line is gone: a folded rest that
    // opened *under* the line already answering the question, and - over the
    // touch row - a general sentence saying the row's name a second time.
    // The words a reader might type for either row went to the search's own
    // keywords, which is where a word nobody has to read belongs.
    for (const [setting, line] of [
      ["touchTurn", "touch-turn-note"],
      ["turnEffect", "turn-effect-note"],
    ]) {
      const at = markup.indexOf(`id="s-${setting}"`);
      const row = markup.slice(at, markup.indexOf("</div>", at));
      assert.ok(row.includes(`id="${line}"`), `${setting} says nothing about the option in force`);
      assert.doesNotMatch(row, /note-more|row-more/, `${setting} still folds a rest away`);
      assert.match(row, /data-keywords="options_keywords_turn"/, `${setting} cannot be found by the words it no longer says`);
    }
    // The effect row keeps one general sentence, in the same paragraph as the
    // line about the value in force - one paragraph, read in one breath.
    assert.match(
      markup,
      /<span data-i18n="options_turn_effect_hint">[^<]*<\/span>\s*<span id="turn-effect-note">/,
      "the effect row's two halves are two paragraphs again",
    );
  });
});
