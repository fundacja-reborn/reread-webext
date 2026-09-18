import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { answers, folded, tokens } from "../src/options/search.js";

/**
 * Searching the settings (D254, P10). The rule itself - which words find which
 * row - is held here against the real catalogues: a Polish reader typing
 * "glos" with no diacritics has to find the voice row, and "slowniki" has to
 * find the whole dictionaries subsection. The wiring around it (the field in
 * two places, the status line, the keys) is checked on the page's own files.
 */

const ROOT = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

/** @param {string} locale */
async function catalogue(locale) {
  return JSON.parse(await source(`_locales/${locale}/messages.json`));
}

/**
 * What one row can be found by, built the way `search.js` builds it: the row's
 * name, its sentence, the rest behind its More, its keywords, and the names of
 * the section and subsection above it.
 *
 * @param {Record<string, { message: string }>} words
 * @param {string[]} keys
 */
function haystack(words, keys) {
  return keys.map((key) => words[key]?.message ?? "").join(" ");
}

describe("searching the settings", () => {
  it("folds a word the way a keyboard reaches it", () => {
    assert.equal(folded("Głos lektora"), "glos lektora");
    assert.equal(folded("Świeży ŁÓDŹ"), "swiezy lodz");
    assert.equal(folded("Übersetzung"), "ubersetzung");
    assert.equal(folded("Página"), "pagina");
    // Cyrillic has no marks to take off, and is left exactly as it is.
    assert.equal(folded("Читання Вголос"), "читання вголос");
    assert.deepEqual(tokens("  voice   speed "), ["voice", "speed"]);
    assert.deepEqual(tokens("   "), []);
  });

  it("wants every word of the query, anywhere in the row", () => {
    const row = "Voice for reading aloud. A separate voice for each language.";
    assert.ok(answers(row, "voice"), "one word does not match");
    assert.ok(answers(row, "voice language"), "two words in either order do not match");
    assert.ok(answers(row, "lang"), "part of a word does not match");
    assert.ok(!answers(row, "voice dictionary"), "a word that is not there still matches");
    assert.ok(!answers(row, ""), "an empty query matches everything");
  });

  it("finds what the brief's own examples ask for, in Polish without the diacritics", async () => {
    const pl = await catalogue("pl");

    // "lektor" -> Reading aloud. The word is in none of the row's own
    // sentences; it is there because the row carries keywords.
    const aloud = haystack(pl, [
      "options_tts",
      "options_tts_hint",
      "options_tts_more",
      "options_keywords_tts",
      "options_section_aloud",
    ]);
    assert.ok(answers(aloud, "lektor"), "the reading-aloud row is not found by the word for a reader");

    // "glos" -> the voice row, with no Polish letters typed at all.
    const voice = haystack(pl, [
      "options_tts_voice",
      "options_tts_voice_hint",
      "options_tts_voice_more",
      "options_section_aloud",
    ]);
    assert.ok(answers(voice, "glos"), "the voice row needs its diacritics typed");
    assert.ok(answers(voice, "głos"), "the voice row is lost when the diacritics are typed");

    // "slowniki" -> the dictionaries subsection, by its own name.
    assert.ok(answers(pl["options_dictionaries_heading"].message, "slowniki"), "the dictionaries subsection is not found by name");

    // And a word that is nowhere on the page finds nothing.
    assert.ok(!answers(aloud + voice, "kalendarz"), "a word nobody wrote still matches");
  });

  it("finds the same rows in every language the page speaks", async () => {
    const wanted = [
      ["en", "aloud", ["options_tts", "options_tts_hint", "options_keywords_tts"]],
      ["de", "stimme", ["options_tts_voice", "options_tts_voice_hint", "options_keywords_tts"]],
      ["fr", "police", ["options_font_custom", "options_font_custom_hint", "options_keywords_font"]],
      ["es", "tamano", ["options_bubble_scale", "options_bubble_scale_hint", "options_keywords_scale"]],
      ["uk", "голос", ["options_tts_voice", "options_tts_voice_hint", "options_keywords_tts"]],
    ];
    for (const [locale, query, keys] of wanted) {
      const words = await catalogue(String(locale));
      assert.ok(
        answers(haystack(words, /** @type {string[]} */ (keys)), String(query)),
        `${locale} does not find its row with "${query}"`,
      );
    }
  });

  it("keeps the catalogues, the lists and the typed CSS out of the index", async () => {
    const script = await source("options/search.js");
    // What the index is built from is the rows and the headings - a section's
    // own blocks are shown or hidden whole, never searched into.
    assert.match(script, /for \(const row of child\.querySelectorAll\(":scope > \.row"\)\)/, "the index is not built from the rows");
    assert.doesNotMatch(script, /dictionary-catalog|disabled-hosts|custom-css-text/, "the index reaches into the page's data");
  });

  it("puts one field in two places rather than two fields in one page", async () => {
    const markup = await source("options/options.html");
    assert.equal((markup.match(/type="search"\s+id="settings-search-field"/g) ?? []).length, 1, "the field is written twice");
    assert.match(markup, /<search id="settings-search"/, "the field has no search landmark around it");
    assert.match(markup, /<label class="visually-hidden" for="settings-search-field"/, "the field is unlabelled");
    assert.match(markup, /<button\s+id="search-open"/, "the bar has no way into the search");

    const script = await source("options/search.js");
    assert.match(script, /side\.prepend\(search\)/, "the field never stands in the column");
    assert.match(script, /bar\.insertBefore\(search, bar\.querySelector\("\.page-tools"\)\)/, "the field never stands in the bar, or stands after its tools");
    assert.match(script, /window\.matchMedia\("\(min-width: 60rem\)"\)\.addEventListener\("change", placeField\)/, "a resized window leaves the field where it was");
  });

  it("says what it found, waits for the typing to stop, and answers Escape and slash", async () => {
    const script = await source("options/search.js");
    assert.match(script, /plural\(found, "options_search_found"\)/, "the count is not said in the language's own plural");
    assert.match(script, /t\("options_search_none", query\)/, "nothing found says nothing");
    assert.match(script, /t\("options_search_clear"\)/, "there is no way out of an empty result");
    assert.match(script, /const SETTLE = 200;/, "the page redraws on every keystroke");
    assert.match(script, /if \(event\.key === "Escape"\)/, "Escape does not clear the field");
    assert.match(script, /if \(event\.key !== "\/" /, "slash does not reach the field");
    assert.match(script, /first\.focus\(\);/, "Enter does not hand the reading to what was found");
    // The status line is a live region, so the count is spoken as it changes.
    const markup = await source("options/options.html");
    assert.match(markup, /<p id="search-status" class="status" role="status" hidden>/, "the count is not announced");
  });

  it("finds a row whose switch is off and says which switch brings it (Michał, 2026-09-18)", async () => {
    const script = await source("options/search.js");
    assert.match(script, /block\(row, hit && dependent && off\)/, "a row behind a switched-off parent is lost to the search");
    assert.match(script, /t\("options_blocked_by"\)/, "nothing says why the row cannot be used");
    assert.match(script, /door\.href = `#\$\{parent\?\.id \?\? ""\}`/, "the row does not lead to the switch that brings it");
    assert.match(script, /if \(control\.disabled\) control\.dataset\["wasOff"\] = "";/, "a control the page itself disabled is handed back when the query clears");
    assert.match(script, /if \(row\.element\.dataset\["parent"\] === undefined\) return;/, "a row that depends on nothing is disabled and re-enabled all the same");

    const css = await source("options/options.css");
    assert.match(css, /\.row-blocked/, "a blocked row looks like any other");
    for (const locale of ["en", "pl", "de", "fr", "es", "uk"]) {
      const words = await catalogue(locale);
      assert.equal(typeof words["options_blocked_by"]?.message, "string", `${locale} cannot say it`);
      assert.equal(typeof words["options_blocked_by_rest"]?.message, "string", `${locale} cannot finish saying it`);
    }
  });

  it("hides the first steps and dims the sections with nothing to show", async () => {
    const script = await source("options/search.js");
    assert.match(script, /steps\.hidden = true;/, "the first-steps card stands over the results");
    assert.match(script, /link\.setAttribute\("aria-disabled", String\(empty\)\)/, "an empty section is offered as if it had something");
    assert.match(script, /opened = new Set\(\);/, "the folds the reader opened are not remembered");
    assert.match(script, /row\.more\.hidden = !open;/, "clearing the query does not put the folds back");
  });
});
