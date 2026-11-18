import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { bodyOf } from "./openings.js";

/**
 * Taking a search of the reading list back (D306): the cross inside the
 * field, and the two ways to the list from a document - a step back, which
 * finds the results as they were left, and a door named for the list, which
 * opens the whole list over an empty field. The rules are wiring on a page
 * of DOM, so this reads the call sites the way `lookup-box` and
 * `page-header` do. What could regress is a field that loses its cross or
 * grows a second one, a cross that empties the field and leaves the list
 * narrowed, a step back that starts retyping searches, or a door that
 * forgets to start over.
 */

const ROOT = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

describe("the reading list's search, taken back", () => {
  it("has the shared cross in its field, and a press brings the whole list back", async () => {
    const reader = await source("reader/reader.js");
    assert.match(reader, /import \{ clearableField \} from "\.\.\/lib\/clear-field\.js";/, "the cross is not the shared component's");
    assert.match(
      reader,
      /clearableField\(libraryFilter, \{\s*label: t\("reader_filter_clear"\),\s*onClear: \(\) => \{\s*if \(forgetLibrarySearch\(\)\) void refreshLibrary\(\);\s*updateSearchControls\(\);\s*\},\s*\}\)/,
      "the cross does not take the search back, or the Search button does not follow the emptied field",
    );
    // The component empties the field and keeps the caret in it; the home
    // only answers. One cross: the browser's own stands down inside the
    // wrapper (page.css), and the markup carries none of its own.
    const markup = await source("reader/reader.html");
    assert.match(markup, /<input\s+type="search"\s+id="library-filter"/, "the field is not a search field");
    assert.doesNotMatch(markup, /clear-field-x/, "the markup draws a second cross");
  });

  it("forgets the question and nothing else: a list that was not narrowed keeps its page", async () => {
    const forgetting = bodyOf(await source("reader/reader.js"), "forgetLibrarySearch");
    assert.match(forgetting, /if \(libraryQuery\.length === 0 && !librarySearchShown\(\)\) return false;/, "an untouched list is redrawn, or sent back to its first page");
    assert.match(forgetting, /if \(librarySearchShown\(\)\) dismissLibrarySearch\(\);\s*libraryQuery = "";\s*libraryPage = 1;\s*return true;/, "the deep results or the narrowed list stay");
    assert.doesNotMatch(forgetting, /segment|picked|librarySearchToggle/, "taking a search back moves the segment, the selection or the scope");
  });

  it("is the same act from an emptied field as from the cross", async () => {
    const reader = await source("reader/reader.js");
    assert.match(
      reader,
      /libraryFilter\?\.addEventListener\("input", \(\) => \{\s*if \(libraryFilter === null\) return;\s*if \(libraryFilter\.value\.trim\(\)\.length === 0 && forgetLibrarySearch\(\)\) void refreshLibrary\(\);\s*updateSearchControls\(\);\s*\}\);/,
      "an emptied field keeps the list narrowed, or typing narrows it without a press (D173)",
    );
  });

  it("tells the cross when a script empties the field", async () => {
    const reader = await source("reader/reader.js");
    const clearing = bodyOf(reader, "clearLibrarySearch");
    assert.match(
      clearing,
      /forgetLibrarySearch\(\);\s*if \(libraryFilter !== null\) libraryFilter\.value = "";\s*libraryFilterCross\?\.refresh\(\);\s*updateSearchControls\(\);/,
      "the cross or the Search button stands over a field emptied by script",
    );
    // The button under "no match" is one of those ways.
    assert.match(
      bodyOf(reader, "refreshLibrary"),
      /clear\.addEventListener\("click", \(\) => \{\s*clearLibrarySearch\(\);\s*libraryFilter\?\.focus\(\);\s*void refreshLibrary\(\);\s*\}\);/,
      "the button under the sentence leaves the cross over an empty field",
    );
  });

  it("starts the list over behind a door named for it, from a document or the highlights alone", async () => {
    const reader = await source("reader/reader.js");
    assert.match(
      bodyOf(reader, "leaveToList"),
      /^\{\s*if \(shown !== null \|\| marksShown !== null\) clearLibrarySearch\(\);\s*walkToList\(\);\s*\}$/,
      "the list's doors find the old search, or take one back over a list nobody left",
    );
    // The popup's row is the same door, asked from outside this page: over
    // this page's own entries, and over a live page that has none.
    const showing = bodyOf(reader, "showPage");
    assert.match(showing, /clearLibrarySearch\(\);\s*unwindToList = true;\s*history\.back\(\);/, "the popup's row walks back to the old search");
    assert.match(showing, /if \(shown !== null\) clearLibrarySearch\(\);\s*await showLibrary\(\);/, "the popup's row over a live page finds the old search");
  });

  it("keeps the search on a step back, so the next result is a press away", async () => {
    const reader = await source("reader/reader.js");
    // Back by any means is popstate; the bar's arrow without an entry under
    // it turns the view itself. Neither takes anything back, and neither
    // does showing the list: the fresh start is the doors' own.
    const stepping = reader.slice(reader.indexOf('window.addEventListener("popstate"'), reader.indexOf(" * The road to the settings"));
    assert.match(stepping, /void showLibrary\(\);/, "the popstate listener is not the one read");
    assert.doesNotMatch(stepping, /clearLibrarySearch|forgetLibrarySearch/, "Back from a found document lands on an emptied search");
    assert.doesNotMatch(bodyOf(reader, "onBackPress"), /clearLibrarySearch|forgetLibrarySearch|leaveToList/, "the bar's arrow starts the list over");
    assert.doesNotMatch(bodyOf(reader, "showLibrary"), /clearLibrarySearch|forgetLibrarySearch/, "every showing of the list starts it over");
    assert.doesNotMatch(bodyOf(reader, "walkToList"), /clearLibrarySearch|forgetLibrarySearch/, "the walk itself starts the list over");
    // A document deleted from its own menu takes the walk, not the door.
    assert.match(bodyOf(reader, "onRemovePress"), /if \(shown !== target\) return;[\s\S]*?walkToList\(\);\s*\}$/, "a deleted document lands on an emptied search");
  });

  it("leaves the cross its room in the field and its own dress", async () => {
    const styles = await source("reader/reader.css");
    assert.match(styles, /\n\.filter-line input \{[^}]*?padding: 0\.35rem 2\.6rem 0\.35rem 0\.6rem;/, "the search's words run under the cross");
    // The Search button's rule must not reach the cross inside the field:
    // a descendant selector would give it the button's side padding.
    assert.match(styles, /\n\.filter-line > button \{\s*padding: 0\.35rem 1rem;/, "the Search button lost its dress");
    assert.match(styles, /\n\.filter-line > button\[data-stale\] \{/, "the lit Search button lost its dress");
    assert.doesNotMatch(styles, /\n\.filter-line button/, "the Search button's dress reaches the cross");
  });

  it("is promised in the user guide", async () => {
    const guide = await readFile(new URL("../docs/GUIDE.md", import.meta.url), "utf8");
    assert.match(guide, /The cross at the end of the search box clears the search and shows the whole list again\./, "the cross is not in the guide");
    assert.match(
      guide,
      /Going back from a document returns to the search results it was opened from; opening the reading list from the reader's menu or with the name \*\*re\/read\*\* in the bar shows the whole list, with the search box empty\./,
      "the two ways back are not in the guide",
    );
  });
});
