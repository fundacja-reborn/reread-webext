import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { speedFactor } from "../src/lib/i18n.js";

/**
 * The numbers, dates and doors of the settings page (D258, V6-V8).
 *
 * Every figure this extension shows is written in the reader's own language:
 * a size in megabytes has been since D153, and this round finishes the job -
 * the catalogue snapshots' dates, which stood as the `YYYY-MM-DD` the files
 * are stamped with, and the voice's speed, which stood as `0.9x` with a dot
 * in a language that writes a comma.
 *
 * And the door inside the copies note, which wore the row notes' More: a
 * sentence that named a page that way read as a fold rather than as the link
 * it promised. Since D260 there is one of them - the saved phrases' own
 * export is a different file, said in a sentence rather than in a second
 * door promising the same thing.
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

describe("the day a catalogue snapshot is from", () => {
  it("is written the way the reader's language writes a day (V7)", async () => {
    const script = await source("options/options.js");
    const day = script.slice(script.indexOf("function day(stamp)"), script.indexOf("\n}\n", script.indexOf("function day(stamp)")));
    assert.match(day, /toLocaleDateString\(uiLocale\(\), \{ dateStyle: "short" \}\)/, "the stamp is shown as the file writes it");
    // Built from the parts: `new Date("2026-09-18")` is UTC midnight, and west
    // of Greenwich that is the day before.
    assert.match(day, /new Date\(Number\(parts\[1\]\), Number\(parts\[2\]\) - 1, Number\(parts\[3\]\)\)/, "the day is read as an instant rather than as three numbers");
    assert.match(day, /if \(parts === null\) return stamp;/, "a stamp of another shape is not handed back as itself");

    // Both lists go through it - the models' and the dictionaries'.
    assert.match(script, /function listDate\(\) \{\n  return day\(/, "the model list's date is not written out");
    assert.match(script, /function dictionaryListDate\(\) \{\n  return day\(/, "the dictionary list's date is not written out");
  });
});

describe("the voice's speed", () => {
  it("is one factor, said once, in the reader's own decimal mark (V8)", () => {
    // The separator is the runtime's; what is held here is the shape - one
    // decimal and the multiplication sign, never the percent it is stored as.
    assert.match(speedFactor(90), /^0[.,]9×$/);
    assert.match(speedFactor(100), /^1[.,]0×$/);
    assert.match(speedFactor(175), /^1[.,]8×$/);
  });

  it("is said in one place for the three that show it", async () => {
    for (const path of ["options/options.js", "reader/reader.js", "vocab/vocab.js"]) {
      const script = await source(path);
      assert.match(script, /speedFactor\(/, `${path} does not use the shared helper`);
      assert.doesNotMatch(script, /ttsRate \/ 100\)\.toFixed/, `${path} still formats the speed itself`);
    }
  });
});

describe("the door inside the copies note", () => {
  it("is dressed as the link the sentence promises, not as a fold (V6, D260)", async () => {
    const markup = await source("options/options.html");
    const at = markup.indexOf('data-i18n="options_copies_uninstall"');
    assert.ok(at > 0, "the sentence about a copy to a file is gone");
    const block = markup.slice(at, markup.indexOf("</p>", at));
    assert.equal((block.match(/class="doorway"/g) ?? []).length, 1, "the reading list is not a door");
    assert.match(block, /data-i18n="options_copies_reading_list"/, "the door is not named as the sentence needs it");
    assert.doesNotMatch(block, /class="note-more"/, "a door still wears a fold's triangle");

    const css = await source("options/options.css");
    const door = rule(css, ".note .doorway");
    assert.match(door, /color: var\(--page-accent\)/, "a door is not the colour of a link");
    assert.match(door, /text-decoration: underline/, "a door is not underlined like a link");
    assert.doesNotMatch(door, /content:|clip-path/, "a door still draws a fold's triangle");

    // It still opens the page itself - this round changes no protocol.
    const script = await source("options/options.js");
    assert.match(script, /copy-library"\)\?\.addEventListener\("click"/, "the reading list is no longer opened");
  });
});

describe("the example CSS rule", () => {
  it("stands in code, outside the catalogue (V5)", async () => {
    const markup = await source("options/options.html");
    assert.match(markup, /<code>\.bubble \{ outline: 3px solid darkorange; \}<\/code>/, "the rule is set in the page's prose face");
    // A rule is the same in every language; only the sentence around it is
    // translated, in two pieces.
    for (const locale of ["en", "pl", "de", "fr", "es", "uk"]) {
      const catalogue = JSON.parse(await source(`_locales/${locale}/messages.json`));
      assert.doesNotMatch(catalogue["options_custom_css_example"].message, /\.bubble/, `${locale} still carries the rule in the catalogue`);
      assert.ok(catalogue["options_custom_css_example_rest"].message.length > 0, `${locale} has no second half of the example`);
    }

    // And the field the rules are typed into is fixed-width, like the example.
    const css = await source("options/options.css");
    assert.match(rule(css, ".custom-css textarea"), /font-family: ui-monospace/, "a stylesheet is typed in the page's prose face");
    assert.match(rule(css, "code"), /font-family: ui-monospace/, "code is set in the page's prose face");
  });
});
