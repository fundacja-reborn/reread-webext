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

  it("saves with a tick on a line, and forgets with the last line unticked", async () => {
    const box = await source("lib/lookup-box.js");
    const pressed = bodyOf(box, "pressed");
    assert.match(pressed, /afterPress\(state\.meanings, line\)/, "a press stopped asking the rule");
    assert.match(pressed, /next\.act === "forget"[\s\S]*?Message\.FORGET_PHRASE/, "the last line taken back does not forget");
    assert.match(pressed, /Message\.SAVE_PHRASE, text: phrase\.text, translations: next\.meanings/, "a press saves something other than the rule's meanings");
    // One after another: three lines ticked in a row are three saves, each
    // from what the one before it left.
    assert.match(bodyOf(box, "press"), /queue = queue\.then\(\(\) => pressed\(line, at\)\)/, "two presses can be in flight at once");
  });

  it("draws every line as a row with a native checkbox where it writes, ticked while the meaning is saved", async () => {
    const box = await source("lib/lookup-box.js");
    const row = bodyOf(box, "lineRow");
    assert.match(row, /element\("label", "lookup-line"\)/, "a row is not a label over the whole line");
    assert.match(row, /box\.type = "checkbox";/, "the row has no native checkbox");
    assert.match(row, /const saved = isSaved\(state\.meanings, line\);[\s\S]*?box\.checked = saved;/, "the checkbox does not show whether the meaning is saved");
    assert.match(row, /row\.dataset\["saved"\] = saved \? "true" : "false"/, "the row does not say for the stylesheet that its meaning is saved");
    assert.match(row, /box\.addEventListener\("change", \(\) => void press\(line, at\)\)/, "a tick does not save");
    // The mark that stays is the checkbox and the weight, never a wash alone.
    const styles = await source("assets/page.css");
    assert.match(styles, /\.lookup-line\[data-saved="true"\] \.lookup-line-text \{\s*font-weight: 600;/, "a saved line is told by a wash alone");
    assert.doesNotMatch(box, /lookup-sense|aria-pressed/, "a line is still a pressed button");
    // The redraw after a tick keeps the row under the finger and the focus.
    const redraw = bodyOf(box, "redrawAround");
    assert.match(redraw, /window\.scrollBy\(0, moved\)/, "the page does not follow the row that moved");
    assert.match(redraw, /box\.focus\(\{ preventScroll: true \}\)/, "the focus is dropped with the rebuilt checkbox");
  });

  it("asks on submit alone - never as the word is typed - and lets a phone spell the word as the book does", async () => {
    const box = await source("lib/lookup-box.js");
    assert.match(box, /form\.addEventListener\("submit", \(event\) => \{\s*event\.preventDefault\(\);\s*void lookUp\(\);/, "Enter and the button do not ask the same way");
    // The input listener follows the cross and takes the answer down with
    // an emptied field; it must not look the word up (on e-ink every redraw
    // is a flash - the rebuild's D4).
    const typing = box.slice(box.indexOf('input.addEventListener("input"'), box.indexOf("return {", box.indexOf('input.addEventListener("input"')));
    assert.doesNotMatch(typing, /lookUp\(\)/, "typing asks the dictionaries");
    assert.match(box, /input\.type = "search";/, "the field is not a search field");
    assert.match(box, /input\.enterKeyHint = "search";/, "the phone's keyboard does not say Search");
    assert.match(box, /input\.setAttribute\("autocapitalize", "off"\)/, "a phone's keyboard forces a capital on the word");
  });

  it("has one way out: the cross empties the field and takes the answer down, the caret kept in the field", async () => {
    const box = await source("lib/lookup-box.js");
    assert.match(box, /const clearButton = button\("lookup-clear", String\.fromCodePoint\(0x00d7\)\)/, "the field has no cross of its own");
    assert.match(box, /clearButton\.setAttribute\("aria-label", t\("lookup_clear"\)\)/, "the cross has no name");
    assert.match(box, /clearButton\.addEventListener\("click", \(\) => \{\s*input\.value = "";\s*showClear\(\);\s*clear\(\);\s*input\.focus\(\);/, "the cross does not empty the field, take the answer down and keep the caret");
    assert.match(box, /input\.addEventListener\("input", \(\) => \{\s*showClear\(\);\s*if \(input\.value\.length === 0 && state\.phrase !== null\) clear\(\);/, "an emptied field keeps its answer");
    // No Close, no Edit, no Learned in the panel: the field does one thing,
    // and the phrase's row in the list does the rest (the rebuild's D3, D6).
    assert.doesNotMatch(box, /t\("close"\)/, "the panel has a Close");
    assert.doesNotMatch(box, /bubble_edit|bubble_learned|lookup_own_meaning|textarea/, "the panel manages the whole entry");
    // And the browser's own cross stands down, so there is one cross, not two.
    const styles = await source("assets/page.css");
    assert.match(styles, /\.lookup-input::-webkit-search-cancel-button[\s\S]*?appearance: none;/, "the browser's own cross doubles the field's");
  });

  it("reads top down: the phrase with its standing, then the books - the meanings once, as ticked rows", async () => {
    const box = await source("lib/lookup-box.js");
    const render = bodyOf(box, "render");
    const at = (/** @type {string} */ marker) => render.indexOf(marker);
    assert.ok(at('"lookup-head"') !== -1 && at('"lookup-head"') < at('"lookup-kept"'), "the phrase is not at the head");
    assert.ok(at('"lookup-kept"') < at('"lookup-entries"'), "the books stand before what the phrase means");
    // The standing at the head's far end, for a saved phrase only: the
    // count, and the way to the phrase's own row where the home has a list.
    assert.match(render, /if \(state\.meanings\.length > 0\) head\.append\(standing\(state\.phrase\)\)/, "the standing stands for an unsaved phrase, or not at all");
    const standing = bodyOf(box, "standing");
    assert.match(standing, /t\("lookup_saved_count", \[state\.meanings\.length\.toLocaleString\(\)\]\)/, "the count is not the saved meanings'");
    assert.match(standing, /if \(deps\.showInList !== undefined\) \{[\s\S]*?button\("lookup-show", t\("lookup_show_in_list"\)\)/, "the link stands without a list to show, or never");
    assert.match(standing, /show\.addEventListener\("click", \(\) => deps\.showInList\?\.\(phrase\)\)/, "the link does not hand the phrase to the list");
    // The chips stand only where the field reads (the popup has no rows to
    // tick); where it writes, the ticked rows say it once (D2 of the rebuild).
    assert.match(render, /if \(readOnly && state\.meanings\.length > 0\) \{[\s\S]*?element\("span", "lookup-chip", meaning\)/, "the field that writes shows its meanings twice, or the popup not at all");
    assert.doesNotMatch(render, /button\("lookup-chip"/, "a chip is a press");
  });

  it("draws the entries as prose, paragraph by paragraph, where it only reads", async () => {
    const render = bodyOf(await source("lib/lookup-box.js"), "render");
    // The read-only field's entries must not promise a choice: divs, never
    // buttons - the book's paragraphs as it wrote them (the presses cut a
    // sense into lines).
    assert.match(
      render,
      /if \(readOnly\) \{[\s\S]*?paragraphsOf\(sense\)[\s\S]*?element\("div", "lookup-paragraph", paragraph\)/,
      "a read-only entry is presses, or loses the book's paragraphs",
    );
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
    // An answer turns the rows into the results mode; the answer taken down
    // (the field emptied by its own "x") brings them back.
    assert.match(landing, /showResults\(state\.phrase !== null\)/, "an answer leaves the hallway standing, or an emptied field the results");
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

  it("brings the saved phrase's row into view on \"Show in list\": the filter set, the row scrolled to, no animation", async () => {
    const script = await source("vocab/vocab.js");
    assert.match(script.slice(script.indexOf("mountLookupBox(")), /showInList,/, "the page's field has no list to show");
    const showing = bodyOf(script, "showInList");
    // The filter narrows the list to the phrase - which also walks past the
    // pages - and the phrase's own row is scrolled to, the first matching
    // one when the exact row is not on the page. Not smooth: on e-ink an
    // animated scroll is a run of flashes.
    assert.match(showing, /query = phrase\.text;\s*page = 1;/, "the filter is not set to the phrase, or the page not turned back");
    assert.match(showing, /filterInput\.value = phrase\.text/, "the filter box does not show the filter the list follows");
    assert.match(showing, /row\.dataset\["key"\] === phrase\.normalized/, "the phrase's own row is not the one looked for");
    assert.match(showing, /\(own \?\? rows\[0\]\)\?\.scrollIntoView\(\{ block: "start" \}\)/, "the row is not scrolled to, or the scroll animates");
    assert.doesNotMatch(showing, /smooth/, "the scroll animates");
    // The panel eases nothing in - the fold opens at once.
    const styles = await source("vocab/vocab.css");
    assert.match(styles, /\.lookup-fold button,\s*\.lookup-fold summary \{\s*transition: none;/, "the panel's controls ease in");
  });

  it("looks up the phrase the address brought, on arrival and on a turn of the open tab", async () => {
    const script = await source("vocab/vocab.js");
    const arrival = bodyOf(script, "arriveWithPhrase");
    assert.match(arrival, /\/\^#lookup=\(\.\*\)\$\/\.exec\(location\.hash\)/, "the page reads something other than the fragment the background writes");
    assert.match(arrival, /decodeURIComponent\(/, "the phrase is read as it was encoded");
    assert.match(arrival, /history\.replaceState\(/, "the fragment stays on the address for the next reload");
    assert.match(arrival, /addFold\.open = true;\s*void lookupBox\.search\(text\)/, "the fold does not open on the phrase, or the field is not asked");
    assert.match(script, /window\.addEventListener\("hashchange", arriveWithPhrase\)/, "a turn of the open tab goes unheard");
    // Asked only once the list is in - the field reads the phrase's standing
    // off it - and the first draw must not reset the field the address just
    // filled: only a pair changed does (Michał's screenshot, 2026-09-11).
    assert.match(script, /void reload\(\)\.then\(arriveWithPhrase\)/, "the phrase is looked up before the list is in");
    assert.doesNotMatch(script, /^arriveWithPhrase\(\);/m, "the phrase is looked up before the list is in");
    assert.match(bodyOf(script, "reload"), /if \(shownPair !== ""\) lookupBox\?\.reset\(\)/, "the first draw resets the field");
  });
});
