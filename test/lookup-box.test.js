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
    const typing = box.slice(box.lastIndexOf('input.addEventListener("input"'), box.lastIndexOf("return {"));
    assert.match(typing, /if \(input\.value\.length === 0 && state\.phrase !== null\) clear\(\);/, "the word field's input listener is not the one read");
    assert.doesNotMatch(typing, /lookUp\(\)/, "typing asks the dictionaries");
    assert.match(box, /input\.type = "search";/, "the field is not a search field");
    assert.match(box, /input\.enterKeyHint = "search";/, "the phone's keyboard does not say Search");
    assert.match(box, /input\.setAttribute\("autocapitalize", "off"\)/, "a phone's keyboard forces a capital on the word");
  });

  it("has one way out: the cross empties the field and takes the answer down, the caret kept in the field", async () => {
    const box = await source("lib/lookup-box.js");
    // The cross is the shared component's (`clear-field.js`, the list's
    // filter wears the same); emptied, the field takes its answer down.
    assert.match(box, /const clearing = clearableField\(input, \{ label: t\("lookup_clear"\), onClear: \(\) => clear\(\) \}\)/, "the field has no cross of its own, or one of its own making");
    assert.match(box, /input\.addEventListener\("input", \(\) => \{\s*if \(input\.value\.length === 0 && state\.phrase !== null\) clear\(\);/, "an emptied field keeps its answer");
    // A value set by script tells the cross.
    assert.match(box, /search\(text\) \{\s*input\.value = text;\s*clearing\.refresh\(\);/, "the cross does not follow a phrase set by script");
    // No Close, no Edit, no Learned in the panel: the field does one thing,
    // and the phrase's row in the list does the rest (the rebuild's D3, D6).
    assert.doesNotMatch(box, /t\("close"\)/, "the panel has a Close");
    assert.doesNotMatch(box, /bubble_edit|bubble_learned|lookup_own_meaning|textarea/, "the panel manages the whole entry");
    // The component itself: wrapped in place, hidden while empty, a press
    // empties, tells the home and keeps the caret; the browser's own cross
    // stands down, so there is one cross, not two.
    const field = await source("lib/clear-field.js");
    assert.match(field, /input\.replaceWith\(field\);\s*field\.append\(input\);/, "the field is not wrapped in place");
    assert.match(field, /cross\.hidden = input\.value\.length === 0;/, "the cross stands over an empty field");
    assert.match(field, /cross\.addEventListener\("click", \(\) => \{\s*input\.value = "";\s*refresh\(\);\s*onClear\(\);\s*input\.focus\(\);/, "the cross does not empty the field, tell the home and keep the caret");
    const styles = await source("assets/page.css");
    assert.match(styles, /\.clear-field > input::-webkit-search-cancel-button[\s\S]*?appearance: none;/, "the browser's own cross doubles the field's");
    assert.doesNotMatch(styles, /lookup-clear|lookup-field/, "the old cross's dress is still there");
  });

  it("reads top down: the phrase with its standing, then the books - the meanings once, as ticked rows", async () => {
    const box = await source("lib/lookup-box.js");
    const render = bodyOf(box, "render");
    const at = (/** @type {string} */ marker) => render.indexOf(marker);
    assert.ok(at('"lookup-head"') !== -1 && at('"lookup-head"') < at("savedGroup()"), "the phrase is not at the head");
    assert.ok(at("savedGroup()") < at("books(groups)"), "the books stand before what the phrase means");
    // The standing at the head's far end, for a saved phrase only: the
    // count, and the way to the phrase's own row where the home has a list.
    // Where the field writes only: where it reads, "Saved (N)" first on the
    // shelf says the same thing (Michał's cosmetic round).
    assert.match(render, /if \(!readOnly && state\.meanings\.length > 0\) head\.append\(standing\(state\.phrase\)\)/, "the standing stands for an unsaved phrase, in the popup, or not at all");
    const standing = bodyOf(box, "standing");
    assert.match(standing, /t\("lookup_saved_count", \[state\.meanings\.length\.toLocaleString\(\)\]\)/, "the count is not the saved meanings'");
    assert.match(standing, /if \(deps\.showInList !== undefined\) \{[\s\S]*?button\("lookup-show", t\("lookup_show_in_list"\)\)/, "the link stands without a list to show, or never");
    assert.match(standing, /show\.addEventListener\("click", \(\) => deps\.showInList\?\.\(phrase\)\)/, "the link does not hand the phrase to the list");
    // Where the field writes, the ticked rows say what is saved once (D2 of
    // the rebuild); where it only reads, "Saved (N)" stands first on the
    // shelf (the fourth brief) - no chips anywhere any more.
    assert.match(render, /if \(readOnly && !state\.pending && state\.meanings\.length > 0\) shelf\.append\(savedGroup\(\)\)/, "the popup's saved meanings do not stand first, or the page's stand twice");
    assert.doesNotMatch(box, /lookup-chip|lookup_kept|lookup-kept/, "the chips are still there");
  });

  it("folds the books: one fold per book, the first open, the rest of a long book under Show all", async () => {
    const box = await source("lib/lookup-box.js");
    const render = bodyOf(box, "render");
    assert.match(render, /entryGroups\(state\.outcome\.entries, state\.phrase\.normalized, state\.outcome\.lang\)/, "the entries are not grouped by book, or the rows not told apart in the book's language");
    // A label stands over the first meaning after it, wherever that lands;
    // a transcription or a cross-reference is never a row, and the book
    // ends in "More about the word" when it has any.
    const rows = bodyOf(box, "books");
    assert.match(rows, /if \(row\.kind === "heading"\) \{\s*label = row\.text;\s*continue;/, "a label is a row to tick");
    assert.match(rows, /if \(row\.kind !== "meaning"\) continue;/, "a transcription or a cross-reference is a row to tick");
    assert.match(rows, /if \(label !== null\) \{\s*home\.append\(element\("div", "lookup-entry-heading", label\)\);/, "the label does not stand over its first meaning where that meaning lands");
    assert.match(rows, /if \(group\.about\.length > 0\) book\.append\(aboutFold\(group\)\)/, "More about the word stands with nothing in it, or not at the book's end");
    assert.match(bodyOf(box, "aboutFold"), /fold\("lookup-about", `about:\$\{group\.dictionary\}`, false,[\s\S]*?t\("lookup_more_about"\)/, "More about the word opens by default, or is not remembered");
    // The books and "Your own" on one shelf, parted by one separator rule -
    // the space between the last book and "Your own" is the space between
    // two books (block 4 of the polish round).
    assert.match(render, /shelf\.append\(\.\.\.books\(groups\)\);\s*if \(!readOnly && !state\.pending\) shelf\.append\(ownSection\(/, "Your own stands off the shelf");
    assert.match(await source("assets/page.css"), /\.lookup-entries > \* \+ \* \{\s*border-top: 1px solid var\(--page-line\);/, "the shelf has no one separator rule");
    assert.match(await source("assets/page.css"), /\.lookup-own \{\s*margin: 0;\s*\}/, "Your own keeps a margin of its own over the separator");
    // The section heads as list items, so the browser's own disclosure
    // triangle stands before each name - the glyph every other fold on the
    // page wears - on a 44px line that is the whole press.
    const heads = await source("assets/page.css");
    assert.match(heads, /\.lookup-group-label \{\s*display: list-item;\s*min-height: 44px;[\s\S]*?cursor: pointer;/, "a book's name line does not keep the browser's triangle, or is not the press");
    assert.match(heads, /\.lookup-group-label::marker \{\s*color: var\(--page-muted\);/, "the triangle is not in the muted voice");
    assert.match(heads, /\.lookup-about-label \{\s*display: list-item;/, "More about the word hides its triangle");
    assert.doesNotMatch(heads, /list-style: none|details-marker/, "a fold's triangle is hidden somewhere");
    const shelf = bodyOf(box, "books");
    assert.match(shelf, /fold\("lookup-group", `group:\$\{group\.dictionary\}`, at === 0, summary\)/, "the first book is not the one open by default, or a book is no fold");
    assert.match(shelf, /summary\.append\(` \(\$\{group\.lines\.length\.toLocaleString\(\)\}\)`\)/, "the fold's name carries no count");
    assert.match(shelf, /foldPoint\(group\.lines, state\.meanings\)/, "the cut does not ask the rule");
    assert.match(shelf, /shown < group\.lines\.length \? moreFold\(book, group, unfolded, at\) : null/, "the rest of a long book does not fold, or ignores a saved line out of sight");
    // The rest of the lines, then the button - the book's last child in
    // both states, so the rows unfold above it and it does not move.
    assert.match(shelf, /book\.append\(more\.rest, more\.toggle\)/, "the button does not stand last in the book");
    const rest = bodyOf(box, "moreFold");
    assert.match(rest, /rest\.hidden = !open;/, "the rest of the lines is not a hidden block");
    assert.match(rest, /toggle\.textContent = shown \? t\("lookup_show_fewer"\) : t\("lookup_show_all", \[group\.lines\.length\.toLocaleString\(\)\]\)/, "the button's words do not follow the state");
    assert.match(rest, /toggle\.setAttribute\("aria-expanded", String\(shown\)\)/, "the button does not say whether the block is shown");
    // On the spot, without a redraw; the state written down; a close from
    // the bottom of a long book brings the book's name back into view.
    assert.match(rest, /rest\.hidden = !opening;\s*say\(opening\);\s*folds\.set\(key, opening\);/, "a press redraws, or forgets the state");
    assert.doesNotMatch(rest, /render\(\)/, "a press redraws the whole answer");
    assert.match(rest, /if \(!opening && book\.getBoundingClientRect\(\)\.top < 0\) book\.scrollIntoView\(\{ block: "start" \}\)/, "a close at the bottom of a long book leaves the reader in another book");
    assert.doesNotMatch(await source("assets/page.css"), /lookup-more-label/, "the old summary's dress is still there");
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
    assert.match(render, /if \(!readOnly && !state\.pending\) shelf\.append\(ownSection\(groups\.flatMap\(\(group\) => group\.lines\)\)\)/, "the section stands in the popup, or before the books have answered");
    assert.ok(render.indexOf("books(groups)") < render.indexOf("ownSection("), "Your own stands before the books");
    const section = bodyOf(box, "ownSection");
    // Not a fold (Michał's cosmetic round): the field for the next meaning
    // always in view, the label in a book's name line's dress without the
    // triangle.
    assert.match(section, /element\("section", "lookup-own"\);[\s\S]*?element\("div", "lookup-own-label", t\("lookup_own"\)\)/, "Your own is a fold, or its label not the section's");
    assert.doesNotMatch(section, /fold\(|summary/, "Your own folds");
    assert.match(await source("assets/page.css"), /\.lookup-own-label \{\s*display: flex;[\s\S]*?min-height: 44px;[\s\S]*?text-transform: uppercase;/, "Your own's label is not a book's name line without the triangle");
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

  it("shows the same shelf without its boxes where it only reads, what is saved first under its own name", async () => {
    const box = await source("lib/lookup-box.js");
    // One component in both homes (the fourth brief's D2): the read-only
    // row is the same row with no box and nothing to press.
    const row = bodyOf(box, "lineRow");
    assert.match(row, /if \(readOnly\) \{\s*\/\/[\s\S]*?const row = element\("div", "lookup-line"\);[\s\S]*?row\.dataset\["saved"\] = saved \? "true" : "false";[\s\S]*?return row;\s*\}/, "a read-only row is a label with a box, or does not say it is saved");
    assert.doesNotMatch(box, /paragraphsOf|lookup-paragraph", paragraph/, "the popup still draws prose of its own");
    // "Saved (N)" first: every saved meaning with a tick standing still in
    // the box's column, open by default and remembered.
    const saved = bodyOf(box, "savedGroup");
    assert.match(saved, /t\("lookup_saved_group", \[state\.meanings\.length\.toLocaleString\(\)\]\)/, "the saved group is not named with its count");
    assert.match(saved, /fold\("lookup-group lookup-group-saved", "saved", true, summary\)/, "the saved group is not a fold open by default");
    assert.match(saved, /element\("span", "lookup-line-mark", String\.fromCodePoint\(0x2713\)\)/, "a saved meaning has no tick");
    assert.match(saved, /mark\.setAttribute\("aria-hidden", "true"\)/, "the tick is read out beside the group's own name");
    // The stylesheet reads the mode off the answer.
    assert.match(box, /if \(readOnly\) answer\.dataset\["readonly"\] = "true";/, "the answer does not say it only reads");
    const styles = await source("assets/page.css");
    assert.match(styles, /\.lookup-answer\[data-readonly="true"\] \.lookup-line \{\s*cursor: default;/, "a read-only row invites a press");
    assert.match(styles, /\.lookup-line-mark \{\s*flex: none;\s*width: var\(--lookup-box-size, 20px\);/, "the tick does not stand in the box's column");
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
    // The rows leave on the body's mode, in the stylesheet; the popup is a
    // column of three pieces of which only the answer scrolls, inside
    // itself (the fourth brief) - the field and the door stay in reach; the
    // arrow brings the rows back.
    const styles = await source("popup/popup.css");
    assert.match(styles, /body\[data-mode="lookup"\] \.popup-row:not\(\.popup-lookup-head, \.popup-lookup-only\) \{\s*display: none;/, "the rows stay in the results mode");
    assert.match(styles, /body\[data-mode="lookup"\] \{\s*display: flex;\s*flex-direction: column;/, "the popup is not a column in the results mode");
    assert.match(styles, /body\[data-mode="lookup"\] \.popup-lookup-answer \{\s*flex: 1 1 auto;\s*min-height: 0;\s*max-height: 420px;\s*overflow-y: auto;/, "the answer does not scroll inside itself under the desktop panel's ceiling");
    assert.match(styles, /body\[data-os="android"\]\[data-mode="lookup"\] \{\s*height: 100dvh;/, "on Android the popup does not take the window");
    assert.doesNotMatch(styles, /position: sticky/, "something still sticks");
    assert.match(script, /lookupBack\?\.addEventListener\("click", \(\) => showResults\(false\)\)/, "the arrow does not bring the hallway back");
  });

  it("opens the saved-phrases page with the phrase riding along, as its one act", async () => {
    const script = await source("popup/index.js");
    const door = bodyOf(script, "openVocabularyWith");
    assert.match(door, /kind: Message\.OPEN_VOCABULARY, text: lookedUp\.text/, "the door opens the page without the phrase");
    assert.match(door, /window\.close\(\)/, "the popup stays open behind the page");
  });

  it("stands as a raised surface with an edge that survives the greys, in every theme", async () => {
    const page = await source("assets/page.css");
    // The token in every palette: the paper a step lighter in sepia and in
    // the dark, the paper itself where it is white (the fourth brief's D3).
    const palettes = page.match(/--surface-raised: #[0-9a-f]{6};/g) ?? [];
    assert.equal(palettes.length, 5, "a palette has no raised surface");
    assert.match(page, /:root\[data-reader-theme="sepia"\] \{[\s\S]*?--page-bg: #f4ecd8;[\s\S]*?--surface-raised: #f8f4e8;/, "sepia's raised surface is not its paper a step lighter");
    assert.match(page, /:root\[data-reader-theme="dark"\] \{[\s\S]*?--page-bg: #171a21;[\s\S]*?--surface-raised: #20242d;/, "the dark raised surface is not its paper a step lighter");
    assert.match(page, /:root\[data-reader-theme="light"\] \{[\s\S]*?--page-bg: #ffffff;[\s\S]*?--surface-raised: #ffffff;/, "the light raised surface is not the white paper itself");
    // The popup wears it with the edge, and no shadow.
    const popup = await source("popup/popup.css");
    assert.match(popup, /^body \{[\s\S]*?background: var\(--surface-raised\);\s*border: 1px solid var\(--page-border\);/m, "the popup is not the raised surface with the border token's edge");
    assert.doesNotMatch(popup, /box-shadow/, "the popup leans on a shadow");
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

  it("brings the saved phrase's row into view on \"Show in list\": the filter set, the filter's state line scrolled to, no animation", async () => {
    const script = await source("vocab/vocab.js");
    assert.match(script.slice(script.indexOf("mountLookupBox(")), /showInList,/, "the page's field has no list to show");
    const showing = bodyOf(script, "showInList");
    // The filter narrows the list to the phrase - which also walks past the
    // pages - and the page scrolls to the filter's state line over the list,
    // so the sentence about the filter and the phrase's row are on the
    // screen together, with the way out of the filter under the keyboard's
    // focus. Not smooth: on e-ink an animated scroll is a run of flashes.
    assert.match(showing, /query = phrase\.text;\s*page = 1;/, "the filter is not set to the phrase, or the page not turned back");
    assert.match(showing, /filterInput\.value = phrase\.text/, "the filter box does not show the filter the list follows");
    assert.match(showing, /filterStatus\.scrollIntoView\(\{ block: "start" \}\)/, "the state line is not what is scrolled to, or the scroll animates");
    assert.match(showing, /clear\.focus\(\{ preventScroll: true \}\)/, "Clear filter does not take the focus");
    assert.doesNotMatch(showing, /smooth/, "the scroll animates");
    // The panel eases nothing in - the fold opens at once.
    const styles = await source("vocab/vocab.css");
    assert.match(styles, /\.lookup-fold button,\s*\.lookup-fold summary \{\s*transition: none;/, "the panel's controls ease in");
  });

  it("centres a row's checkbox on the first line of its text, by the tokens and at every reading size", async () => {
    const page = await source("assets/page.css");
    const vocab = await source("vocab/vocab.css");
    // The margin is half of what the line stands tall over the box, from
    // tokens - the line's height set by the phrases page from the reading
    // size the Aa panel chose, by the one line-height the rows use.
    assert.match(page, /\.lookup-answer \{\s*--lookup-box-size: 20px;\s*--lookup-line-gap: 12px;/, "the answer does not hold the box's size and the gap as tokens");
    assert.match(page, /\.lookup-line-box \{[\s\S]*?margin: calc\(\(var\(--lookup-line-height, 1\.6em\) - var\(--lookup-box-size, 20px\)\) \/ 2\) 0 0;/, "the box's margin is a constant, or not half the line's excess");
    assert.match(vocab, /:root \{\s*--phrase-line-height: 1\.45;/, "the rows' line-height is not a token");
    assert.match(vocab, /line-height: var\(--phrase-line-height\);/, "the rows' rule does not use the token");
    assert.doesNotMatch(vocab, /^\s*line-height: 1\.45;/m, "the line-height is written twice");
    assert.match(vocab, /\.lookup-fold \.lookup-line \{\s*--lookup-line-height: calc\(var\(--reader-size, 18px\) \* var\(--phrase-line-height\)\);/, "the panel's line height does not follow the reading size");
    // Neither centring on the whole wrapped row nor a native checkbox's baseline.
    const row = page.slice(page.indexOf(".lookup-line {"), page.indexOf(".lookup-line:hover"));
    assert.match(row, /align-items: flex-start;/, "the row does not align its box to the first line");
    assert.doesNotMatch(row, /align-items: (center|baseline)/, "the row centres the box on the whole row, or on a baseline");
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
    assert.match(panel, /\.lookup-entries > \* \+ \* \{\s*border-top: 1px solid var\(--page-line\)/, "the books are not parted by the separator token");
    assert.match(panel, /\.lookup-own-input \{[\s\S]*?border: 1px solid var\(--page-border\)/, "the own field's edge is not the control token");
  });

  it("looks up the phrase the address brought, on arrival and on a turn of the open tab", async () => {
    const script = await source("vocab/vocab.js");
    const arrival = bodyOf(script, "arriveWithPhrase");
    assert.match(arrival, /\/\^#lookup=\(\.\*\)\$\/\.exec\(location\.hash\)/, "the page reads something other than the fragment the background writes");
    assert.match(arrival, /decodeURIComponent\(/, "the phrase is read as it was encoded");
    assert.match(arrival, /history\.replaceState\(/, "the fragment stays on the address for the next reload");
    // The list narrowed to the phrase as well (the fourth brief), then the
    // fold opened and the field asked.
    assert.match(arrival, /query = text;\s*page = 1;\s*if \(filterInput !== null\) filterInput\.value = text;\s*filterClear\?\.refresh\(\);\s*renderList\(\);/, "the list is not narrowed to the phrase on arrival");
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
