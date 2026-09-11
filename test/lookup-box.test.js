import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { bodyOf } from "./openings.js";

/**
 * The look-up field (D197) and its two homes, read at the call sites the way
 * `bubble-hint` and `popup-first-paint` are: the rules live in
 * `lookup.test.js`, and what could regress here is a page that stops
 * mounting the field, a request that starts carrying a language, a string
 * written as markup, a popup that saves after all, or a row that arrives
 * late and moves the rows under a cursor (D194).
 */

const ROOT = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

describe("the look-up field", () => {
  it("asks the dictionaries alone, in the pair's language, and never the engine", async () => {
    const box = await source("lib/lookup-box.js");
    const asking = bodyOf(box, "lookUp");
    assert.match(asking, /kind: Message\.LOOK_UP, text: phrase\.text \}/, "the look-up carries something besides the text");
    assert.doesNotMatch(box, /Message\.TRANSLATE/, "the field asks the engine");
    assert.doesNotMatch(asking, /lang:/, "the field names a language - the pair is the background's business (D8)");
  });

  it("writes every string as text, and links out with no opener and no referrer", async () => {
    const box = await source("lib/lookup-box.js");
    assert.doesNotMatch(box, /innerHTML/, "something is written as markup");
    const verdict = bodyOf(box, "verdictLine");
    assert.match(verdict, /link\.target = "_blank"/, "the link leaves in the page's own tab");
    assert.match(verdict, /link\.rel = "noopener noreferrer"/, "the link hands the page to its destination");
    assert.match(verdict, /link\.textContent = part\.label/, "the link's words go in as something other than text");
    assert.match(verdict, /deps\.openDictionaries\(\)/, "the settings word does not open the settings");
  });

  it("saves with a press on a line, and forgets with the last line taken back", async () => {
    const box = await source("lib/lookup-box.js");
    const pressed = bodyOf(box, "press");
    assert.match(pressed, /afterPress\(state\.meanings, line\)/, "a press stopped asking the rule");
    assert.match(pressed, /next\.act === "forget"[\s\S]*?Message\.FORGET_PHRASE/, "the last line taken back does not forget");
    assert.match(pressed, /Message\.SAVE_PHRASE, text: phrase\.text, translations: next\.meanings/, "a press saves something other than the rule's meanings");
  });

  it("draws the lines as prose and offers no editor where it only reads", async () => {
    const render = bodyOf(await source("lib/lookup-box.js"), "render");
    // The read-only field's lines must not promise a choice: a div, never a
    // button - and neither Own meaning nor Learned stands under them.
    assert.match(render, /if \(readOnly\) \{[\s\S]*?element\("div", "lookup-sense", line\)/, "a read-only line is a press");
    assert.match(render, /if \(!readOnly && !state\.pending && !state\.editing\)/, "the actions stand in the read-only field");
  });
});

describe("the popup's look-up row", () => {
  it("stands in the markup from the first paint, under the pair and before the rooms", async () => {
    const markup = await source("popup/index.html");
    const row = markup.indexOf('id="lookup-head"');
    assert.notEqual(row, -1, "the popup has no look-up row");
    assert.doesNotMatch(markup, /id="lookup-head"[^>]*hidden/, "the row waits for a script to stand at all");
    assert.ok(markup.indexOf('id="pair-row"') < row, "the row stands above the pair it depends on");
    assert.ok(row < markup.indexOf('id="open-library"'), "the row stands among the rooms");
  });

  it("is settled by the settings alone, before the models are read (D194)", async () => {
    const script = await source("popup/index.js");
    const render = bodyOf(script, "render");
    const settled = render.indexOf("lookupRowStands(");
    const models = render.indexOf("installedModels()");
    assert.ok(settled !== -1 && models !== -1, "the popup's draw lost a step");
    assert.ok(settled < models, "the row is decided only after the models have been read");
    // A change of pair takes the answer down: it was in the old pair's language.
    assert.match(bodyOf(script, "choosePair"), /lookupBox\?\.reset\(\)/, "a new pair keeps the old pair's answer");
  });

  it("only reads, and turns the popup into its results mode once the field has answered", async () => {
    const script = await source("popup/index.js");
    const mounted = script.slice(script.indexOf("mountLookupBox("), script.indexOf("async function openVocabularyWith"));
    assert.match(mounted, /readOnly: true/, "the popup's field writes");
    assert.match(mounted, /onState: onLookupState/, "the popup does not follow the field");
    const landing = bodyOf(script, "onLookupState");
    assert.match(landing, /if \(state\.phrase !== null\) showResults\(true\)/, "an answer leaves the hallway standing");
    assert.match(landing, /state\.saved \? t\("popup_lookup_open"\) : t\("popup_lookup_add"\)/, "the door does not name the phrase's standing");
    // The rows leave on the body's mode, in the stylesheet, and the field's
    // row sticks to the top there; the arrow brings the rows back.
    const styles = await source("popup/popup.css");
    assert.match(styles, /body\[data-mode="lookup"\] \.popup-row:not\(\.popup-lookup-head, \.popup-lookup-only\) \{\s*display: none;/, "the rows stay in the results mode");
    assert.match(styles, /body\[data-mode="lookup"\] \.popup-lookup-head \{\s*position: sticky;\s*top: 0;/, "the field's row scrolls away with the answer");
    assert.match(script, /lookupBack\?\.addEventListener\("click", \(\) => showResults\(false\)\)/, "the arrow does not bring the hallway back");
  });

  it("opens the saved-phrases page with the phrase riding along, as its one act", async () => {
    const script = await source("popup/index.js");
    const door = bodyOf(script, "openVocabularyWith");
    assert.match(door, /kind: Message\.OPEN_VOCABULARY, text: lookedUp\.text/, "the door opens the page without the phrase");
    assert.match(door, /window\.close\(\)/, "the popup stays open behind the page");
  });

  it("has no folded-bubble switch any more (D197)", async () => {
    const markup = await source("popup/index.html");
    assert.doesNotMatch(markup, /id="quiet-bubble"/, "the switch stands in the popup");
    assert.doesNotMatch(await source("popup/index.js"), /hideBubbleActions/, "the popup writes the switch's setting");
  });
});

describe("the saved-phrases page's fold", () => {
  it("holds the field behind a fold, hidden without a pair", async () => {
    const markup = await source("vocab/vocab.html");
    const fold = markup.slice(markup.indexOf('id="add-phrase"'), markup.indexOf("</details>", markup.indexOf('id="add-phrase"')));
    assert.match(fold, /id="lookup-box"/, "the fold has no field in it");
    const script = await source("vocab/vocab.js");
    assert.match(script, /mountLookupBox\(/, "the page does not mount the field");
    assert.doesNotMatch(script.slice(script.indexOf("mountLookupBox(")), /readOnly: true/, "the page's field only reads");
    assert.match(bodyOf(script, "reload"), /addFold\.hidden = chosen === null/, "the fold stands with nowhere to file a phrase");
  });

  it("looks up the phrase the address brought, on arrival and on a turn of the open tab", async () => {
    const script = await source("vocab/vocab.js");
    const arrival = bodyOf(script, "arriveWithPhrase");
    assert.match(arrival, /\/\^#lookup=\(\.\*\)\$\/\.exec\(location\.hash\)/, "the page reads something other than the fragment the background writes");
    assert.match(arrival, /decodeURIComponent\(/, "the phrase is read as it was encoded");
    assert.match(arrival, /history\.replaceState\(/, "the fragment stays on the address for the next reload");
    assert.match(arrival, /addFold\.open = true;\s*void lookupBox\.search\(text\)/, "the fold does not open on the phrase, or the field is not asked");
    assert.match(script, /window\.addEventListener\("hashchange", arriveWithPhrase\)/, "a turn of the open tab goes unheard");
  });
});
