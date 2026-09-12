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
    const typing = box.slice(box.indexOf('clearButton.addEventListener("click"'), box.lastIndexOf("return {"));
    assert.match(typing, /input\.addEventListener\("input"/, "the word field has no input listener to read");
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
    assert.ok(at('"lookup-kept"') < at("books(entryGroups("), "the books stand before what the phrase means");
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

  it("folds the books: one fold per book, the first open, the rest of a long book under Show all", async () => {
    const box = await source("lib/lookup-box.js");
    assert.match(bodyOf(box, "render"), /books\(entryGroups\(state\.outcome\.entries, state\.phrase\.normalized\)\)/, "the entries are not grouped by book");
    const shelf = bodyOf(box, "books");
    assert.match(shelf, /fold\("lookup-group", `group:\$\{group\.dictionary\}`, at === 0, summary\)/, "the first book is not the one open by default, or a book is no fold");
    assert.match(shelf, /if \(!readOnly\) summary\.append\(` \(\$\{group\.lines\.length\.toLocaleString\(\)\}\)`\)/, "the fold's name carries no count where lines are ticked, or one where they are prose");
    assert.match(shelf, /foldPoint\(group\.lines, state\.meanings\)/, "the cut does not ask the rule");
    assert.match(shelf, /fold\("lookup-more", `more:\$\{group\.dictionary\}`, unfolded, label\)/, "the rest of a long book does not fold, or ignores a saved line out of sight");
    assert.match(shelf, /t\("lookup_show_fewer"\) : t\("lookup_show_all", \[group\.lines\.length\.toLocaleString\(\)\]\)/, "the fold's words do not follow its state");
    // A fold is remembered as the reader left it across the redraws a tick
    // makes, and forgotten with the next word.
    const folded = bodyOf(box, "fold");
    assert.match(folded, /details\.open = folds\.get\(key\) \?\? openByDefault;/, "a redraw forgets which folds were opened");
    assert.match(folded, /details\.addEventListener\("toggle", \(\) => \{\s*folds\.set\(key, details\.open\);/, "the reader's hand on a fold is not written down");
    assert.match(bodyOf(box, "lookUp"), /folds = new Map\(\);/, "a new word inherits the last word's folds");
    // No scrollbar inside the panel: the folds are the limit.
    const styles = await source("assets/page.css");
    const panel = styles.slice(styles.indexOf(".lookup-entries {"), styles.indexOf("/* --- the colophon"));
    assert.doesNotMatch(panel, /max-height|overflow(-y)?: auto/, "the entries scroll inside the panel");
  });

  it("keeps a meaning of the reader's own from the field under Your own, last in the answer", async () => {
    const box = await source("lib/lookup-box.js");
    const render = bodyOf(box, "render");
    // Last, where the field writes, once the books have answered - whatever
    // they said: the way in for a word no book knows.
    assert.match(render, /if \(!readOnly && !state\.pending\) \{[\s\S]*?answer\.append\(ownSection\(lines\)\)/, "the section stands in the popup, or before the books have answered");
    assert.ok(render.indexOf("books(entryGroups(") < render.indexOf("ownSection(lines)"), "Your own stands before the books");
    const section = bodyOf(box, "ownSection");
    assert.match(section, /ownMeanings\(state\.meanings, lines\)\.entries\(\)[\s\S]*?lineRow\(meaning, `own:\$\{at\}`\)/, "an own meaning is not a row to untick, or a book's line stands here twice");
    assert.match(section, /input\.value = state\.ownDraft;/, "a redraw after a tick eats what was typed");
    assert.match(section, /state\.ownDraft = input\.value;/, "what is typed is not kept");
    assert.match(section, /form\.addEventListener\("submit", \(event\) => \{\s*event\.preventDefault\(\);\s*if \(!empty\(\)\) void saveOwn\(\);/, "Enter does not save");
    assert.match(section, /save\.type = "submit";/, "the Save button is not the form's");
    // Saved after what is there, once, whitespace folded and nothing else;
    // the caret stays for the next one.
    const kept = bodyOf(box, "savedOwn");
    assert.match(kept, /const own = collapseWhitespace\(state\.ownDraft\);/, "the meaning is changed beyond its whitespace");
    assert.match(kept, /if \(!isSaved\(state\.meanings, own\)\) \{[\s\S]*?translations: meanings/, "a meaning already kept is saved twice");
    assert.match(kept, /const meanings = \[\.\.\.state\.meanings, own\];/, "the own meaning does not join after what is there");
    assert.match(kept, /state\.ownDraft = "";\s*render\(\);\s*ownField\(\)\?\.focus\(\);/, "the field is not emptied, or the caret leaves it");
    assert.match(bodyOf(box, "saveOwn"), /queue = queue\.then\(\(\) => savedOwn\(\)\)/, "an own save can cross a tick in flight");
    // A word no book knows lands the caret in the field.
    assert.match(bodyOf(box, "lookUp"), /if \(!readOnly && state\.outcome\.kind === "silence"\) ownField\(\)\?\.focus\(\);/, "the caret stays in the word field over a word no book knows");
  });

  it("draws the entries as prose, paragraph by paragraph, where it only reads", async () => {
    const shelf = bodyOf(await source("lib/lookup-box.js"), "books");
    // The read-only field's entries must not promise a choice: divs, never
    // checkboxes - the book's paragraphs as it wrote them (the rows cut a
    // sense into lines).
    assert.match(
      shelf,
      /if \(readOnly\) \{[\s\S]*?paragraphsOf\(sense\)[\s\S]*?element\("div", "lookup-paragraph", paragraph\)/,
      "a read-only entry is rows, or loses the book's paragraphs",
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

  it("sets the word and the lines in the list's reading face, and leaves the fold's dress to the fold's own summary", async () => {
    const styles = await source("vocab/vocab.css");
    // The content in the reading face by the rows' own rule (block 5): the
    // word with `.phrase-word`, the lines and the own meanings with
    // `.phrase-meanings`; labels, help and buttons stay the interface's.
    assert.match(styles, /\.phrase-word,\s*\.phrase-meanings,\s*\.lookup-fold \.lookup-phrase,\s*\.lookup-fold \.lookup-line-text \{\s*font-family: var\(--reader-font-lead/, "the panel's content is not in the rows' face by the rows' rule");
    assert.match(styles, /\.phrase-word,\s*\.lookup-fold \.lookup-phrase \{\s*font-weight: 600;/, "the word is not bold as the row's word is");
    // The fold-line rules reach their own summary and paragraph only: the
    // panel holds folds of its own, dressed in page.css.
    assert.match(styles, /\.fold-line > summary \{/, "the fold's summary rule reaches the books' folds");
    assert.doesNotMatch(styles, /\.fold-line summary \{|\.fold-line p \{/, "a descendant rule of the fold reaches into the panel");
    // Edges by the two tokens e-ink keeps: separators on --page-line, the
    // controls' borders on --page-border; nothing near-white of its own.
    const panel = (await source("assets/page.css")).slice((await source("assets/page.css")).indexOf("/* --- the look-up field"), (await source("assets/page.css")).indexOf("/* --- the colophon"));
    assert.doesNotMatch(panel, /#[0-9a-f]{3,8}\b/i, "the panel paints a colour of its own outside the tokens");
    assert.doesNotMatch(panel, /transition|animation/, "the panel eases something in");
    assert.match(panel, /\.lookup-group \+ \.lookup-group \{\s*border-top: 1px solid var\(--page-line\)/, "the books are not parted by the separator token");
    assert.match(panel, /\.lookup-own-input \{[\s\S]*?border: 1px solid var\(--page-border\)/, "the own field's edge is not the control token");
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
