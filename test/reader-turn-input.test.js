import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * What a finger does to a page read by pages (D250).
 *
 * The rules themselves are pure and tested with `pages.js` - which contact
 * is a tap, which travel is a swipe, which device's contact sizes mean
 * anything. What is held here is the wiring a smoke test sees only as "it
 * turned" or "it did not": where the signature comes from, that it is the
 * pointer's own clock and not the handler's, that the setting is asked at
 * every gesture, and that the settings page writes a name the guard knows.
 *
 * The one thing the reader may never go back to: reading a tap by its
 * position alone. That is what turned pages under the thumb holding a phone
 * (Michał, 2026-09-18).
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

describe("the gesture that turns a page by touch (D250)", () => {
  it("reads the setting at every gesture, and turns nothing at all with it off", async () => {
    const reader = await source("reader/reader.js");
    const tap = bodyOf(reader, "onBareTap");
    // Asked at every gesture rather than read once: the setting is changed
    // in a room over the reading itself, and `off` leaves neither road open.
    assert.match(tap, /if \(effectiveTouchTurn\(settings\.reader\) !== "zones"\) return;/, "a tap turns the page under a setting that asks for a slide, or for nothing");
    assert.match(tap, /const turn = tapIntent\(tap\);/, "the tap is not read as a whole signature");
    assert.match(reader, /if \(effectiveTouchTurn\(settings\.reader\) === "swipe"\) \{\s*swipeTurn\(liftedTap, down\.target\);/, "the slide is not read at the lift, or is read under every setting");
    // The guards that were there before the signature was: the pen's tap is
    // the marker's, a room owns the window, and a press that had something
    // to close has done its work.
    assert.match(tap, /if \(!paged\(\) \|\| markerOn \|\| pressHadWork \|\| roomShown !== null\) return;/, "the old guards left with the new rule");
  });

  it("answers a swipe at the pointer's own lift, under the same guards as a tap", async () => {
    const reader = await source("reader/reader.js");
    // A touch that travels is a pan as far as a browser is concerned:
    // neither Blink nor Gecko leaves the compatibility mouse events behind
    // it, so a swipe read through `reading.js` would silently do nothing.
    const swipe = bodyOf(reader, "swipeTurn");
    assert.match(swipe, /if \(!paged\(\) \|\| markerOn \|\| pressHadWork \|\| roomShown !== null \|\| stretching\) return;/, "the swipe's road has fewer guards than the tap's");
    assert.match(swipe, /if \(bubbleOpen\(\)\) return;/, "a swipe turns the page out from under an open bubble");
    assert.match(swipe, /if \(target instanceof Element && target\.closest\(TURN_STOPS\) !== null\) return;/, "a swipe over a button, a bar or a pager turns the page");
    // One list of what a press is about itself, read by both roads.
    assert.match(bodyOf(reader, "onBareTap"), /target\.closest\(TURN_STOPS\)/, "the two roads keep two lists of what stops a turn");
    // A selection drawn along a line travels sideways exactly like a swipe.
    assert.match(bodyOf(reader, "onStretch"), /^[\s\S]*?stretching = true;\s*if \(!paged\(\)\) return;/, "a range being stretched is not told apart from a swipe");
    assert.match(reader, /stretching = false;\s*const at = event\.timeStamp;/, "a fresh gesture inherits the last one's stretch");
  });

  it("never reads a tap by its position alone again", async () => {
    const reader = await source("reader/reader.js");
    assert.doesNotMatch(reader, /\btapZone\(/, "the reader still turns pages on where a contact landed, whatever the hand did");
    const tap = bodyOf(reader, "onBareTap");
    assert.match(tap, /const tap = lastTap\(\);\s*if \(tap === null\) return;/, "a bare tap with no gesture behind it turns a page");
  });

  it("keeps the pointers itself, because the bare tap arrives as a mouse event", async () => {
    const reader = await source("reader/reader.js");
    // `reading.js` hears a touch as the compatibility mouse event it leaves
    // behind: one event, where the finger lifted, with no contact size, no
    // pointer kind and no clock. The hook is unchanged for every other page.
    const reading = await source("content/reading.js");
    assert.match(reading, /onBareTap\?\.\(event\.clientX, event\.clientY, event\.target\)/, "the reading side's hook changed shape for the reader's sake");
    for (const event of ["pointerdown", "pointerup", "pointercancel"]) {
      assert.match(reader, new RegExp(`document\\.addEventListener\\(\\n\\s*"${event}"`), `${event} is not watched on the document`);
    }
    // The clock is the events' own: a handler that ran late on a busy
    // e-ink device would measure a contact time nobody spent.
    assert.match(reader, /upAt: event\.timeStamp,/, "the contact's end is read from the handler's clock");
    assert.match(reader, /const at = event\.timeStamp;/, "the contact's start is read from the handler's clock");
    // The point read is where the pointer landed, and the travel is the
    // difference - which is what tells a swipe from a tap at all.
    assert.match(reader, /dx: event\.clientX - down\.x,\s*dy: event\.clientY - down\.y,/, "the travel is not measured from where the contact landed");
    assert.match(reader, /x: down\.x,\s*y: down\.y,/, "the zone is read where the finger lifted, not where it landed");
    // A pointer the browser took away ended no gesture of ours.
    assert.match(reader, /"pointercancel",\s*\(event\) => \{\s*pointersDown\.delete\(event\.pointerId\);\s*liftedTap = null;/, "a cancelled pointer still stands for the next tap");
    assert.match(reader, /window\.addEventListener\("blur", \(\) => \{\s*pointersDown\.clear\(\);\s*liftedTap = null;/, "a window losing focus mid-gesture keeps the gesture");
  });

  it("measures the device's contact sizes before trusting them, and only real touches", async () => {
    const reader = await source("reader/reader.js");
    assert.match(reader, /if \(!blobSettled && event\.pointerType === "touch"\) \{/, "a mouse click is counted as a measurement, or the test is measured again forever");
    assert.match(reader, /blobSamples\.push\(Math\.max\(event\.width, event\.height\)\);\s*if \(blobSamples\.length >= BLOB_SAMPLES\) \{\s*blobReal = blobTrusted\(blobSamples\);\s*blobSettled = true;/, "the verdict is not taken once and kept");
    // Untrusted numbers reach the rule as nothing, which is what switches
    // the test off there (`tapIntent`).
    assert.match(reader, /const size = blobReal \? down\.blob : null;/, "a device that answers a constant still has its contacts measured against it");
  });

  it("offers the three gestures on the settings page, in every language", async () => {
    const markup = await source("options/options.html");
    assert.match(markup, /<select id="touch-turn">\s*<option value="zones"[\s\S]*?<option value="swipe"[\s\S]*?<option value="off"/, "the row does not offer the three gestures in order");
    assert.match(markup, /data-i18n="options_touch_turn_swipe">Slide a finger sideways</, "the gesture is named in the dialect of a phone's settings, not the reader's");
    assert.match(markup, /<p class="row-note" id="touch-turn-note"><\/p>/, "there is no line to say what the chosen gesture does");
    assert.match(markup, /data-fold data-i18n="options_touch_turn_hint"/, "the row has no folded note");
    const script = await source("options/options.js");
    assert.match(script, /if \(!\(select instanceof HTMLSelectElement\) \|\| !isTouchTurn\(select\.value\)\) return;/, "a value the guard does not know can be written");
    assert.match(script, /writeConfig\(\{ reader: \{ touchTurn: select\.value \} \}\)/, "the row does not write the reader's setting");
    assert.match(bodyOf(script, "renderTurning"), /touch\.value = effectiveTouchTurn\(config\.reader\);\s*sayGesture\(touch\.value\);/, "the row shows the stored null rather than the gesture in force, or says nothing about it");
    // One line per value, each key written out: a key built from the value
    // is a key the catalogue tests cannot see (`lib/messages.js`'s rule).
    const said = bodyOf(script, "sayGesture");
    for (const gesture of ["zones", "swipe", "off"]) {
      assert.match(said, new RegExp(`t\\("options_touch_turn_note_${gesture}"\\)`), `nothing is said about ${gesture}`);
    }
    assert.match(script, /sayGesture\(select\.value\);/, "the line stands still when the gesture is changed");
    assert.equal((script.match(/renderTurning\(\);/g) ?? []).length, 2, "the row is not drawn on both renders");
    for (const lang of ["en", "pl", "de", "fr", "es", "uk"]) {
      const catalogue = JSON.parse(await source(`_locales/${lang}/messages.json`));
      for (const key of [
        "options_touch_turn",
        "options_touch_turn_zones",
        "options_touch_turn_swipe",
        "options_touch_turn_off",
        "options_touch_turn_hint",
      ]) {
        assert.ok(typeof catalogue[key]?.message === "string", `${lang} has no ${key}`);
      }
    }
  });

  it("is promised in the README, defaults and all", async () => {
    const readme = await readFile(new URL("../README.md", ROOT), "utf8");
    assert.match(readme, /\*\*Turning pages by touch\*\* offers sliding a finger sideways - the default/, "the README does not offer the gestures, or names another default");
    assert.match(readme, /on a phone it must not begin at the very edge of the screen, where the system's own\s*back gesture lives/, "the README keeps the edge of a phone's screen a surprise");
    assert.match(readme, /A tap turns a page only when it is short, still and away from the edges of the screen/, "the README promises a tap that turns wherever it lands");
  });

  it("gathers the Pages layout's three settings under one heading", async () => {
    const markup = await source("options/options.html");
    // The section stands whatever layout is in force: this is where
    // somebody looking for the Pages layout comes, and a section that
    // appeared with the reader's own setting could not be found at all.
    const section = markup.slice(markup.indexOf('<h2 id="paged-layout"'), markup.indexOf("<!-- The wrapper is the translation-off switch's"));
    assert.doesNotMatch(section, /translation-only|hidden/, "the section hides itself from somebody looking for it");
    assert.match(section, /data-i18n="options_paged_intro"/, "the section does not say what it is about");
    for (const id of ["page-number", "touch-turn", "turn-effect"]) {
      assert.ok(section.includes(`id="${id}"`), `the ${id} row is not in the section`);
    }
    assert.match(markup, /<a href="#paged-layout" data-i18n="options_paged_heading">/, "the section is not in the page's own table of contents");
  });
});
