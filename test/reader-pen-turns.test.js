import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * Turning the page with the pen in the hand (D242).
 *
 * Read by pages, a bar standing at the foot shortens the readable band and
 * the page's last lines are given to the page after it (D238). With the pen
 * up every tap on the text is the marker's (D107) - a mark, the word beside
 * the active one, or the pen put down - and every drag is a stroke, so
 * nothing left in the window turned a page: a highlight on those last lines
 * could not be reached at all, because picking the pen up moved them on and
 * every way of following them put the pen down first (Michał's smoke on the
 * Boox, 2026-09-17). The two turns in the pen's own toolbar are the way.
 *
 * What a smoke test sees as "it turned" is held here as wiring: where the
 * turns stand, when they are offered, what they do, and that pressing one
 * is not a press away from the pen or from the active mark.
 */

const ROOT = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

/**
 * The body of one top-level function.
 *
 * @param {string} script
 * @param {string} name
 */
function bodyOf(script, name) {
  const at = script.search(new RegExp(`\\n(?:export )?(?:async )?function ${name}\\(`));
  assert.notEqual(at, -1, `no function ${name}`);
  return script.slice(at, script.indexOf("\n}\n", at));
}

describe("the page turned with the pen in the hand (D242)", () => {
  it("stands the two turns at the ends of the pen's own toolbar, named and silent", async () => {
    const html = await source("reader/reader.html");
    const opens = html.indexOf('id="mark-bar"');
    const ends = html.indexOf('id="mark-pin-start"');
    assert.ok(opens !== -1 && ends > opens, "the pen's toolbar is gone");
    const bar = html.slice(opens, ends);
    for (const [id, key] of [
      ["mark-turn-prev", "reader_page_prev"],
      ["mark-turn-next", "reader_page_next"],
    ]) {
      const at = bar.indexOf(`id="${id}"`);
      assert.notEqual(at, -1, `${id} does not stand in the pen's toolbar`);
      const button = bar.slice(at, bar.indexOf("</button>", at));
      // Hidden until the layout asks for it: in the scrolling layout a drag
      // that never held still scrolls the article, and a turn would be a
      // button that does nothing.
      assert.match(button, /\n\s+hidden\n/, `${id} stands before the layout is asked`);
      assert.match(button, new RegExp(`data-i18n-title="${key}"`), `${id} carries no name`);
      assert.match(button, new RegExp(`data-i18n-aria-label="${key}"`), `${id} has no accessible name`);
      assert.doesNotMatch(button, /speech-label/, `${id} carries a word into a toolbar of icons`);
    }
    // At the ends, around the acts: the turns are the outermost buttons, so
    // a thumb aiming at one has the bar's edge to stop it.
    assert.ok(bar.indexOf('id="mark-turn-prev"') < bar.indexOf('id="mark-copy"'), "the turn back stands among the acts");
    assert.ok(bar.indexOf('id="mark-turn-next"') > bar.indexOf('id="mark-delete"'), "the turn on stands among the acts");
  });

  it("offers them in the paged layout alone, with the toolbar's own dress", async () => {
    const reader = await source("reader/reader.js");
    const dress = bodyOf(reader, "refreshMarkBar");
    assert.match(dress, /const turning = paged\(\);\s*if \(markTurnPrev !== null\) markTurnPrev\.hidden = !turning;\s*if \(markTurnNext !== null\) markTurnNext\.hidden = !turning;/, "the turns do not follow the layout where the toolbar is dressed");
    // The toolbar is dressed whenever the pen is picked up (`deselectMark`
    // runs then) and whenever the settings land (`applyAppearance`), which
    // is every moment the layout can change.
    assert.match(bodyOf(reader, "deselectMark"), /refreshMarkBar\(\);/, "the pen picked up does not dress its toolbar");
    assert.match(bodyOf(reader, "applyAppearance"), /refreshMarkBar\(\);/, "a layout switched does not dress the pen's toolbar");
  });

  it("turns a page on a press, and the press is not a press away", async () => {
    const reader = await source("reader/reader.js");
    assert.match(reader, /markTurnPrev\?\.addEventListener\("click", \(event\) => \{\s*releasePress\(event\);\s*turnPage\("up"\);/, "the turn back answers no press");
    assert.match(reader, /markTurnNext\?\.addEventListener\("click", \(event\) => \{\s*releasePress\(event\);\s*turnPage\("down"\);/, "the turn on answers no press");
    // The press-away rule (D107) reads a press inside this bar as none of
    // its business, which is what keeps the pen in the hand and the active
    // mark active across a turn.
    const away = reader.slice(reader.indexOf('document.addEventListener("pointerdown", (event) => {\n  if (!markerOn) return;'));
    assert.match(away.slice(0, away.indexOf("\n});")), /if \(markBar\?\.contains\(target\) === true\) return;/, "a press on the toolbar puts the pen down");
  });

  it("names them in every catalogue", async () => {
    for (const locale of ["en", "pl", "de", "fr", "es", "uk"]) {
      const catalogue = JSON.parse(await source(`_locales/${locale}/messages.json`));
      for (const key of ["reader_page_prev", "reader_page_next"]) {
        assert.ok(typeof catalogue[key]?.message === "string" && catalogue[key].message.length > 0, `${locale} does not name ${key}`);
      }
    }
  });
});

describe("a press that leaves the button as it found it (D244)", () => {
  it("hands the focus back after a pointer's press, and keeps it after a key's", async () => {
    const reader = await source("reader/reader.js");
    const release = bodyOf(reader, "releasePress");
    // `detail` counts a pointer's clicks and is zero for Enter and Space:
    // a finger gets its button back to rest, a keyboard keeps its place.
    assert.match(release, /if \(event\.detail !== 0 && event\.currentTarget instanceof HTMLElement\) event\.currentTarget\.blur\(\);/, "a tapped button keeps the frame and the wash a focused one wears");
    // The acts that leave the bar standing as it was, and only those: the
    // note's dialog wants the focus back when it closes, and the bin takes
    // its own button away with the mark.
    assert.match(reader, /markCopyButton\?\.addEventListener\("click", \(event\) => \{\s*releasePress\(event\);/, "the copy keeps its focus ring after a tap");
    assert.doesNotMatch(reader, /markNoteButton\?\.addEventListener\("click", \(event\) => \{\s*releasePress/, "the note hands back the focus its dialog will want");
    assert.doesNotMatch(reader, /markDeleteButton\?\.addEventListener\("click", \(event\) => \{\s*releasePress/, "the bin blurs a button it is about to hide");
  });

  it("stands nine buttons of the pen's bar on one line at a phone's width", async () => {
    const styles = await source("reader/reader.css");
    const dress = /\.speech-bar\.mark-bar button \{([^}]*)\}/.exec(styles);
    assert.notEqual(dress, null, "the pen's bar lost its own dress");
    // The air, not the glyphs: the icons hold the size they were given for
    // being read at all (D107's smoke), and the padding is what gives way -
    // two rows on a paged document cost two lines of every page.
    assert.match(dress?.[1] ?? "", /padding: 0\.15rem 0\.25rem;/, "the pen's buttons wear air enough to break the row at 125%");
    assert.match(styles, /\.speech-bar\.mark-bar \{\s*gap: 0\.2rem;/, "the pen's bar spreads its buttons enough to break the row at 125%");
    assert.match(styles, /\.mark-bar \.reader-icon \{\s*width: 1\.5em;/, "the pen's glyphs gave way instead of the air around them");
  });
});
