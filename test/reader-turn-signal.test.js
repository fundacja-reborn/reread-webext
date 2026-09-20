import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * A page turned says so (D251).
 *
 * Until this, a turn was a change with no signal: on an e-ink panel the new
 * page is simply there, and a reader whose eye was in the middle of the
 * text could not tell whether the page had turned at all - let alone which
 * way. The rule that decides what a turn wears is pure and tested with
 * `pages.js`; what is held here is the wiring, and the two promises that
 * cannot be read off a screenshot: that only a turn from the hand is
 * dressed, and that nothing about the page's state waits on a timer.
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

/**
 * One CSS rule's declarations.
 *
 * @param {string} styles
 * @param {string} selector
 */
function ruleOf(styles, selector) {
  const at = styles.indexOf(`\n${selector} {`);
  assert.notEqual(at, -1, `no rule for ${selector}`);
  return styles.slice(at, styles.indexOf("\n}", at));
}

describe("the signal that a page has turned (D251)", () => {
  it("asks the rule what a turn wears, with the setting, the system and the reason", async () => {
    const reader = await source("reader/reader.js");
    const show = bodyOf(reader, "showPageOf");
    assert.match(show, /const motion = turnMotion\(\{\s*effect: settings\.reader\.turnEffect,\s*reduced: lessMotion\?\.matches === true,\s*reason,\s*lastFlashAt,\s*now: performance\.now\(\),/, "the turn is dressed without asking the setting, the system or the reason");
    // And never the paper: the theme decided between the flash and the
    // scroll until Michał's call (2026-09-19), which gave a dark flash to
    // anybody wearing the E-ink theme on glass.
    assert.doesNotMatch(show, /theme === "eink"/, "the theme still decides how a turn moves");
    // The query itself, not its answer: the switch is flipped mid-reading.
    assert.match(reader, /const lessMotion = window\.matchMedia\?\.\("\(prefers-reduced-motion: reduce\)"\) \?\? null;/, "less motion is read once at load, and wrong from then on");
  });

  it("moves the window each of the three ways, and keeps the turn's own state out of the clock", async () => {
    const reader = await source("reader/reader.js");
    const show = bodyOf(reader, "showPageOf");
    assert.match(show, /if \(motion === "flash"\) flashBand\(\);/, "the flash is not raised before the turn");
    assert.match(show, /scrollTo\(\{ top: y, left: 0, behavior: "smooth" \}\);\s*settleAfterSmooth\(\);/, "a smooth turn does not square the page where `scrollend` never comes");
    assert.match(show, /\} else \{[\s\S]*scrollTo\(0, y\);/, "a turn that wears nothing is no longer instant");
    // Whatever it wears, the page's own state is set in the same task as
    // before: a pending flash must never hold a turn, or a held hardware
    // key would turn nothing while it waits.
    assert.match(show, /pages\.anchor = top;\s*keepPageAnchor\(pages, page\);\s*refreshCurtain\(\);[\s\S]*restretch\(\);/, "the turn's own state waits on the signal");
  });

  it("flashes the reading band alone, and takes the ink down on its own clock", async () => {
    const reader = await source("reader/reader.js");
    const flash = bodyOf(reader, "flashBand");
    assert.match(flash, /lastFlashAt = performance\.now\(\);/, "the flash does not stamp its own clock, and the next one cannot be held apart from it");
    assert.match(flash, /pageFlash\.style\.top = `\$\{Math\.round\(band\.top\)\}px`;\s*pageFlash\.style\.height = `\$\{Math\.max\(0, Math\.round\(band\.bottom - band\.top\)\)\}px`;/, "the flash is not the reading band - the bar, the foot or the count are refreshed with it");
    assert.match(flash, /flashTimer = window\.setTimeout\(\(\) => \{\s*if \(pageFlash !== null\) pageFlash\.hidden = true;\s*\}, FLASH_HOLD_MS\);/, "the ink does not come down after its hold");
    const markup = await source("reader/reader.html");
    assert.match(markup, /<div id="page-flash" class="page-flash" hidden aria-hidden="true"><\/div>/, "there is no band to ink, or a screen reader hears it");
    const styles = await source("reader/reader.css");
    const rule = ruleOf(styles, ".page-flash");
    assert.match(rule, /position: fixed;/, "the flash scrolls with the document");
    assert.match(rule, /background: var\(--page-fg\);/, "the flash is not the page's own ink");
    assert.match(rule, /pointer-events: none;/, "the flash takes the presses of the beat it stands for");
    assert.doesNotMatch(rule, /transition|animation/, "the flash fades, which is the smear D59 keeps out");
  });

  it("dresses a turn from the hand, and never a landing, the voice or a drag", async () => {
    const reader = await source("reader/reader.js");
    assert.match(reader, /function turnPage\(turn, reason = "turn"\) \{/, "a turn is not a turn by default");
    assert.match(bodyOf(reader, "turnPage"), /showPageOf\(pages, target, turn === "first" \|\| turn === "last" \? "jump" : reason\);/, "either end of the text is signalled as a turn");
    // The voice reads on while the page turns under it (D233); the range
    // stretched to the page's edge turns it under the finger (D239).
    assert.match(bodyOf(reader, "revealOnPage"), /showPageOf\(pages, target, "speech"\);/, "the voice's turn is dressed as the hand's");
    assert.match(bodyOf(reader, "onEdgeDue"), /turnPage\(stay\.zone, "drag"\);/, "the edge's turn is dressed as the hand's");
    // Everything else lands: the position restored, a search hit, a
    // heading, the window squared with its page.
    for (const name of ["landOnPageOf", "landOnLastPage", "settlePage"]) {
      assert.doesNotMatch(bodyOf(reader, name), /showPageOf\([^)]*"(?:turn|speech|drag)"\)/, `${name} dresses a landing as a turn`);
    }
  });

  it("is promised in the README, with what it does not touch", async () => {
    const readme = await readFile(new URL("../README.md", ROOT), "utf8");
    assert.match(readme, /\*\*Page turn effect\*\*, in the same section of the settings, shows that the page has turned/, "the README does not offer the effect");
    assert.match(readme, /Three values, and the reader picks: a smooth slide, which is the default/, "the README does not say the effect is chosen rather than inferred");
    assert.match(readme, /a dark flash of the text area, for e-ink screens[\s\S]*?a distinct dark flash on an ordinary one/, "the README does not say what the flash looks like on each screen");
    assert.match(readme, /Nothing happens when your system asks for less motion, and nothing when the page is turned by reading aloud or by dragging a selection/, "the README promises a signal where there is none");
  });

  it("offers the effect on the settings page, in every language", async () => {
    const markup = await source("options/options.html");
    // Three radios on the page rather than a select (D268): what a select
    // opens on Android is the browser's own dialog, which no rule of ours
    // reaches - and on an e-ink panel it vanishes into the page under it.
    assert.match(
      markup,
      /name="turn-effect" value="smooth"[\s\S]*?name="turn-effect" value="flash"[\s\S]*?name="turn-effect" value="off"/,
      "the row does not offer the three values, smoothest first",
    );
    assert.doesNotMatch(markup, /<select id="turn-effect"/, "the values are behind the browser's own dialog again");
    // One paragraph, always open (D264): what the row is for, then what the
    // value in force looks like - no trigger, and no folded rest opening
    // under the line that had already said it.
    assert.match(markup, /<p class="row-note" id="turn-effect-note-group">\s*<span data-i18n="options_turn_effect_hint">[^<]*<\/span>\s*<span id="turn-effect-note"><\/span>\s*<\/p>/, "the row's two halves are not one paragraph");
    assert.doesNotMatch(markup, /more-turnEffect|options_turn_effect_more/, "the row still folds a rest away");
    assert.match(markup, /id="s-turnEffect" data-setting="turnEffect" data-keywords="options_keywords_turn"/, "the row cannot be found by the words its folded rest used to carry");
    const script = await source("options/options.js");
    assert.match(script, /if \(!\(chosen instanceof HTMLInputElement\) \|\| !isTurnEffect\(chosen\.value\)\) return;/, "a value the guard does not know can be written");
    assert.match(script, /writeConfig\(\{ reader: \{ turnEffect: chosen\.value \} \}\)/, "the row does not write the reader's setting");
    assert.match(bodyOf(script, "renderTurning"), /if \(markChoice\("turn-effect", config\.reader\.turnEffect\)\) sayEffect\(config\.reader\.turnEffect\);/, "the row does not show what is stored, or says nothing about it");
    // The second half of that paragraph, one sentence per value, each key a
    // literal.
    assert.match(markup, /<span id="turn-effect-note"><\/span>/, "there is nothing to say what the chosen effect looks like");
    const said = bodyOf(script, "sayEffect");
    for (const key of ["options_turn_effect_note_off", "options_turn_effect_note_flash", "options_turn_effect_note_smooth"]) {
      assert.match(said, new RegExp(`t\\("${key}"\\)`), `${key} is built from the value rather than written`);
    }
    // What decides between the flash and the slide is the theme, not the
    // screen (`turnMotion`: `eink: settings.reader.theme === "eink"`), so
    // both halves of the line are told by theme - it said "on other screens"
    // until Michał pointed out what that promises somebody reading on glass
    // under the E-ink theme (2026-09-19): a dark flash, not a smooth slide.
    // Screens are named inside the first half, for what the same flash looks
    // like where it belongs and where it does not, which is the other thing
    // he found: on an e-ink panel it is hardly visible, on glass it is not.
    for (const lang of ["en", "pl", "de", "fr", "es", "uk"]) {
      const catalogue = JSON.parse(await source(`_locales/${lang}/messages.json`));
      // The flash is the one value worth a sentence after it is chosen
      // (Michał, 2026-09-19): what it is for, and what it looks like where
      // it is not for - the dark flash somebody on glass would otherwise
      // take for a fault.
      const flash = String(catalogue["options_turn_effect_note_flash"]?.message ?? "");
      assert.match(flash, /e-ink|E-ink|E-Ink/, `${lang} does not say which screen the flash is for`);
      assert.ok(flash.length > 40, `${lang} says nothing about what the flash looks like`);
      assert.match(String(catalogue["options_turn_effect_flash"]?.message ?? ""), /e-ink|E-ink|E-Ink/i, `${lang} does not mark the value as the e-ink one`);
      // And no value is described by the theme any more.
      for (const key of ["options_turn_effect_hint", "options_turn_effect_note_smooth"]) {
        const message = String(catalogue[key]?.message ?? "");
        assert.doesNotMatch(message, /E-ink/, `${lang}/${key} still ties the effect to the theme`);
      }
    }
    assert.match(script, /sayEffect\(chosen\.value\);/, "the line stands still when the effect is changed");
    for (const lang of ["en", "pl", "de", "fr", "es", "uk"]) {
      const catalogue = JSON.parse(await source(`_locales/${lang}/messages.json`));
      for (const key of [
        "options_turn_effect",
        "options_turn_effect_smooth",
        "options_turn_effect_flash",
        "options_turn_effect_off",
        "options_turn_effect_hint",
      ]) {
        assert.ok(typeof catalogue[key]?.message === "string", `${lang} has no ${key}`);
      }
    }
  });
});
