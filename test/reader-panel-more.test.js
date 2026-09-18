import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * A panel that scrolls within itself says so, and is scrolled by the word it
 * says it with (D246, D247).
 *
 * At Firefox for Android's 125% the Aa panel's thirteen rows outgrow the
 * window, and the panel scrolled with nothing to say so - the last row cut
 * off by the window's edge read as the end of the list (Michał's photo from
 * a Pixel, 2026-09-18: "should the scrollbar not stay visible? or some other
 * way?"). The browser's own scrollbar is no answer there: on Android it is
 * an overlay that fades, and on an e-ink panel a fade is not there at all.
 *
 * So the panel's foot carries a strip of its own paper with a chevron in it.
 * The first cut of it (D246) was paper and nothing else, and the phone
 * showed what that costs: the air under the panel's last row stayed the
 * panel's, so the rows went on showing through it under the strip, and a
 * press on the chevron went through to the row beneath - in the Aa panel the
 * voice list, which opened (Michał's photos, 2026-09-18). The strip carries
 * that air itself now, and is a button.
 *
 * What is held here: the strip stands in both panels, it never comes and
 * goes (a strip that appeared would move the rows under it at the moment
 * somebody reads them), the paper reaches the panel's last pixel, the press
 * brings up what is below, and the measure is asked at every moment that can
 * change the answer.
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

describe("the foot of a panel that scrolls within itself (D246, D247)", () => {
  it("stands in both of the reader's panels, as their last word and a press of its own", async () => {
    const markup = await source("reader/reader.html");
    const panel = markup.slice(markup.indexOf('id="display-panel"'), markup.indexOf('id="menu-panel"'));
    const menu = markup.slice(markup.indexOf('id="menu-panel"'));
    for (const { where, text } of [
      { where: "the Aa panel", text: panel },
      { where: "the menu", text: menu.slice(0, menu.indexOf("</nav>")) },
    ]) {
      assert.match(text, /<button\s+type="button"\s+class="panel-more"/, `${where} has no foot to say what is below it`);
      assert.match(text, /class="reader-icon panel-more-glyph"/, `${where}'s foot has no chevron`);
      // A button is pressed, so it is named - and it starts dead, because a
      // panel that has not been measured yet has nothing to bring up.
      assert.match(text, /class="panel-more"[^>]*data-i18n-aria-label="reader_panel_more"/, `${where}'s foot is a press with no name`);
      assert.match(text, /class="panel-more"[^>]*\sdisabled\s*>/, `${where}'s foot is a stop on the way through the rows before anything is measured`);
    }
    const catalogue = JSON.parse(await source("_locales/en/messages.json"));
    assert.equal(typeof catalogue["reader_panel_more"]?.["message"], "string", "the strip's name is in no catalogue");
    // Both panels scroll within themselves; both wear the same foot.
    const styles = await source("reader/reader.css");
    assert.match(styles, /\.reader-chrome > \.nav-menu \{\s*max-height/, "the menu stopped scrolling within itself");
  });

  it("never comes and goes: the strip stands, the chevron and the line follow", async () => {
    const styles = await source("reader/reader.css");
    // No `hidden` on the strip anywhere: it is in flow at every moment, or
    // the rows under it would move by its height as it appeared.
    assert.doesNotMatch(await source("reader/reader.html"), /class="panel-more"[^>]*\shidden[\s>]/, "the strip comes and goes, moving the rows under it");
    assert.match(styles, /\.panel-more \.panel-more-glyph \{[^}]*visibility: hidden;/, "the chevron stands whether or not there is more below");
    assert.match(styles, /\[data-more="true"\] \.panel-more-glyph \{\s*visibility: visible;/, "the chevron never comes out");
    // The line over the strip is a shadow: a border would cost a reflow.
    assert.match(styles, /\[data-more="true"\] \.panel-more \{\s*box-shadow: 0 -1px 0 var\(--page-line\);/, "the line over the strip is drawn in a way that moves the rows");
  });

  it("carries the panel's own air under its last row, so the paper reaches the foot", async () => {
    // A stuck foot is held inside its parent's content box: air given to the
    // panel is a band of the scrollport the rows go on showing through,
    // under the strip (Michał's photo, 2026-09-18).
    const styles = await source("reader/reader.css");
    assert.match(styles, /\.reader-panel \{[^}]*padding: 0\.6rem 0 0;/, "the Aa panel keeps air under its last row that its foot cannot cover");
    assert.match(styles, /\.reader-chrome > \.nav-menu \{[^}]*padding-bottom: 0;/, "the menu keeps air under its last row that its foot cannot cover");
    // The air is the strip's height rather than padding beneath its chevron
    // (D253): held as padding it all stood under the glyph, which read as a
    // strip cut short (Michał's photo, 2026-09-18). Same total height, so
    // the panel's fold is where it was.
    assert.match(styles, /\.panel-more \{[^}]*min-height: 2\.5rem;\s*padding: 0;/, "the air under the last row stands nowhere, or hangs under the chevron again");
    assert.doesNotMatch(styles, /\.panel-more \{[^}]*pointer-events: none;/, "the strip hands the press through to whatever stands under it");
    // The strip is a button inside a menu whose every button is a row: the
    // row dress, the separators and the rule that drops the last row's line
    // all pass it by.
    const page = await source("assets/page.css");
    assert.match(page, /\.nav-menu button:not\(\.panel-more\) \{/, "the reader's foot strip wears the menu's row dress");
    assert.match(page, /\.nav-menu button:not\(\.panel-more\):hover \{/, "the foot strip answers a hover like a menu row");
    assert.match(page, /:not\(\.panel-more, :has\(~ :is\(a, button\):not\(\[hidden\], \.panel-more\)\)\)/, "the foot strip makes the row before it draw a line again");
  });

  it("is drawn at the size of a glyph that is the whole of its button (D253)", async () => {
    const styles = await source("reader/reader.css");
    // The pager's rule, where the words step aside under a phone's width and
    // the chevrons become the buttons (`.pager-icon`, page.css). At the
    // panel's own quieter voice the stroke came to some 8 by 4 px - the
    // smallest mark in the reader, alone on an empty strip with no frame
    // around it, and the only word that anything waits below the fold
    // (Michał's photo, 2026-09-18).
    assert.match(styles, /\.panel-more \.panel-more-glyph \{[^}]*width: 1\.5rem;\s*height: 1\.5rem;/, "the chevron speaks in the panel's voice again, not as the button it is");
    const page = await source("assets/page.css");
    assert.match(page, /@media \(max-width: 30rem\) \{[^@]*?\.pager-icon \{\s*width: 1\.5em;/, "the size the strip's chevron follows is no longer the pager's");
  });

  it("brings up what stands below when it is pressed", async () => {
    const reader = await source("reader/reader.js");
    assert.match(reader, /panelFoot\(panel\)\?\.addEventListener\("click", \(\) => \{/, "the chevron says there is more below and does nothing about it");
    // One panel's worth of rows less the strip, so the row the chevron stood
    // over comes up whole; in one frame, for the e-ink panels this is drawn
    // on.
    assert.match(reader, /const step = panel\.clientHeight - \(foot === null \? 0 : foot\.offsetHeight\);/, "the press steps past the row it stood over");
    assert.match(reader, /panel\.scrollBy\(\{ top: Math\.max\(step, panel\.clientHeight \/ 2\), behavior: "instant" \}\);/, "the press smears an e-ink panel with a smooth scroll");
    assert.match(bodyOf(reader, "panelFoot"), /foot instanceof HTMLButtonElement \? foot : null;/, "the foot is taken on trust");
  });

  it("measures what is below the fold, and asks again whenever the answer can change", async () => {
    const reader = await source("reader/reader.js");
    const dress = bodyOf(reader, "dressPanelMore");
    assert.match(dress, /for \(const panel of \[displayPanel, menuPanel\]\)/, "only one panel is asked");
    assert.match(dress, /!panel\.hidden && panel\.scrollHeight - panel\.scrollTop - panel\.clientHeight > 1/, "what stands below the fold is guessed rather than measured");
    assert.match(dress, /if \(panel\.dataset\["more"\] !== said\) panel\.dataset\["more"\] = said;/, "the attribute is written on every scroll");
    // A press only while there is something to bring up - and the focus
    // handed back rather than dropped on the body, where a Tab would start
    // again from the top of the page.
    assert.match(dress, /foot\.disabled = dead;/, "the strip stays a press with nothing below it");
    assert.match(dress, /if \(dead && document\.activeElement === foot\) \(panel === displayPanel \? displayButton : menuButton\)\?\.focus\(\);/, "a strip disabled under the focus drops it on the body");
    // Every moment that can change the answer: an opening, a scroll, a
    // window resize and a settings change (the rows' height, a row coming
    // or going with the Type row's Custom choice).
    assert.match(bodyOf(reader, "setPanel"), /dressPanelMore\(\);/, "a panel just opened says nothing about its fold");
    assert.match(reader, /panel\.addEventListener\("scroll", \(\) => dressPanelMore\(\), \{ passive: true \}\);/, "a scrolled panel keeps the answer it opened with");
    assert.match(reader, /window\.addEventListener\("resize", \(\) => dressPanelMore\(\)\);/, "a turned phone keeps the old answer");
    assert.match(bodyOf(reader, "applyAppearance"), /dressPanelMore\(\);/, "a text size stepped keeps the old answer");
  });
});
