import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * A panel that scrolls within itself says so (D246).
 *
 * At Firefox for Android's 125% the Aa panel's thirteen rows outgrow the
 * window, and the panel scrolled with nothing to say so - the last row cut
 * off by the window's edge read as the end of the list (Michał's photo from
 * a Pixel, 2026-09-18: "should the scrollbar not stay visible? or some other
 * way?"). The browser's own scrollbar is no answer there: on Android it is
 * an overlay that fades, and on an e-ink panel a fade is not there at all.
 *
 * So the panel's foot carries a strip of its own paper with a chevron in
 * it. What is held here: the strip stands in both panels, it never comes and
 * goes (a strip that appeared would move the rows under it at the moment
 * somebody reads them), only the chevron and the line follow the scroll, and
 * the measure is asked at every moment that can change the answer.
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

describe("the foot of a panel that scrolls within itself (D246)", () => {
  it("stands in both of the reader's panels, as their last word and out of the way", async () => {
    const markup = await source("reader/reader.html");
    const panel = markup.slice(markup.indexOf('id="display-panel"'), markup.indexOf('id="menu-panel"'));
    const menu = markup.slice(markup.indexOf('id="menu-panel"'));
    for (const { where, text } of [
      { where: "the Aa panel", text: panel },
      { where: "the menu", text: menu.slice(0, menu.indexOf("</nav>")) },
    ]) {
      assert.match(text, /<div class="panel-more" aria-hidden="true">/, `${where} has no foot to say what is below it`);
      assert.match(text, /class="reader-icon panel-more-glyph"/, `${where}'s foot has no chevron`);
    }
    // Both panels scroll within themselves; both wear the same foot.
    const styles = await source("reader/reader.css");
    assert.match(styles, /\.reader-chrome > \.nav-menu \{\s*max-height/, "the menu stopped scrolling within itself");
  });

  it("never comes and goes: the strip stands, the chevron and the line follow", async () => {
    const styles = await source("reader/reader.css");
    // No `hidden` on the strip anywhere: it is in flow at every moment, or
    // the rows under it would move by its height as it appeared.
    assert.doesNotMatch(await source("reader/reader.html"), /class="panel-more"[^>]*\shidden[\s>]/, "the strip comes and goes, moving the rows under it");
    assert.match(styles, /\.panel-more-glyph \{\s*visibility: hidden;\s*\}/, "the chevron stands whether or not there is more below");
    assert.match(styles, /\[data-more="true"\] \.panel-more-glyph \{\s*visibility: visible;/, "the chevron never comes out");
    // The line over the strip is a shadow: a border would cost a reflow.
    assert.match(styles, /\[data-more="true"\] \.panel-more \{\s*box-shadow: 0 -1px 0 var\(--page-line\);/, "the line over the strip is drawn in a way that moves the rows");
    assert.match(styles, /\.panel-more \{[^}]*pointer-events: none;/, "the strip catches presses meant for the row under it");
  });

  it("measures what is below the fold, and asks again whenever the answer can change", async () => {
    const reader = await source("reader/reader.js");
    const dress = bodyOf(reader, "dressPanelMore");
    assert.match(dress, /for \(const panel of \[displayPanel, menuPanel\]\)/, "only one panel is asked");
    assert.match(dress, /!panel\.hidden && panel\.scrollHeight - panel\.scrollTop - panel\.clientHeight > 1/, "what stands below the fold is guessed rather than measured");
    assert.match(dress, /if \(panel\.dataset\["more"\] !== said\) panel\.dataset\["more"\] = said;/, "the attribute is written on every scroll");
    // Every moment that can change the answer: an opening, a scroll, a
    // window resize and a settings change (the rows' height, a row coming
    // or going with the Type row's Custom choice).
    assert.match(bodyOf(reader, "setPanel"), /dressPanelMore\(\);/, "a panel just opened says nothing about its fold");
    assert.match(reader, /panel\?\.addEventListener\("scroll", \(\) => dressPanelMore\(\), \{ passive: true \}\);/, "a scrolled panel keeps the answer it opened with");
    assert.match(reader, /window\.addEventListener\("resize", \(\) => dressPanelMore\(\)\);/, "a turned phone keeps the old answer");
    assert.match(bodyOf(reader, "applyAppearance"), /dressPanelMore\(\);/, "a text size stepped keeps the old answer");
  });
});
