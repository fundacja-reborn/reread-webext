import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * The reader opened in full screen (D236): a switch on the settings page,
 * and in the reader an ask armed on every arrival from outside and made at
 * the first press - the only moment a browser accepts it. The rules are
 * markup and wiring, so this reads them the way the tool's test does; the
 * setting's own default and healing are tested with the config.
 */

const ROOT = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

describe("the reader opened in full screen", () => {
  it("stands on the settings page right under the default keep, off with the model as well", async () => {
    const markup = await source("options/options.html");
    const keep = markup.indexOf('id="keep-articles"');
    const row = markup.indexOf('id="reader-fullscreen"');
    const pair = markup.indexOf('id="pair"');
    assert.ok(keep !== -1 && row !== -1 && pair !== -1, "a row is gone");
    assert.ok(keep < row && row < pair, "the switch left its place between the default keep and the pair");
    // Its own row, and not one that hides with the translation switch: the
    // reader is the whole extension with the model off.
    const opening = markup.lastIndexOf('<div class="row', row);
    assert.ok(opening > keep, "the switch shares the default keep's row");
    assert.doesNotMatch(markup.slice(opening, row), /translation-only/, "the switch hides with the translation switch");
    const box = markup.slice(opening, markup.indexOf("</div>", row));
    assert.match(box, /data-i18n="options_reader_fullscreen"/, "the row is not named by its key");
    assert.match(box, /data-i18n="options_reader_fullscreen_hint"/, "the row has no hint");
  });

  it("is drawn from the config and written back as readerFullscreen", async () => {
    const script = await source("options/options.js");
    assert.match(script, /toggle\.checked = config\.readerFullscreen/, "the switch does not show the stored choice");
    assert.match(
      script,
      /getElementById\("reader-fullscreen"\)\?\.addEventListener\("change"[\s\S]*?writeConfig\(\{ readerFullscreen: toggle\.checked \}\)/,
      "the switch does not write readerFullscreen",
    );
  });

  it("arms the ask on every arrival and makes it at the first trusted press", async () => {
    const script = await source("reader/reader.js");
    // Every road in from outside: the load and the background's hand-ins
    // (`showPage`), and a return through history (`pageshow`).
    assert.match(script, /async function showPage\(firstLoad = false\) \{\s*const turn = \+\+epoch;[\s\S]{0,300}?offerFullscreen\(\);/, "showPage does not arm the ask");
    assert.match(script, /addEventListener\("pageshow", \(\) => \{[\s\S]{0,300}?offerFullscreen\(\);/, "pageshow does not arm the ask");
    // Read fresh, never from the page's copy of the settings.
    assert.match(script, /function offerFullscreen\(\) \{[\s\S]*?readConfig\(\)[\s\S]*?config\.readerFullscreen && document\.fullscreenElement === null/, "the ask is not read fresh from the config");
    // The press: a trusted click or key, with the keys that grant no
    // activation let through, one ask an arrival.
    assert.match(script, /addEventListener\("click", onFullscreenPress, \{ capture: true \}\)/, "no click listener");
    assert.match(script, /addEventListener\("keydown", onFullscreenPress, \{ capture: true \}\)/, "no keydown listener");
    assert.match(script, /if \(!fullscreenWaiting \|\| !event\.isTrusted\) return;/, "an untrusted press may ask");
    assert.match(script, /NO_ACTIVATION_KEYS = new Set\(\[\s*"Escape"/, "Escape is not let through");
    assert.match(script, /fullscreenWaiting = false;\s*(?:\/\/[^\n]*\n\s*)*document\.documentElement\.requestFullscreen\(\)/, "the ask does not disarm itself");
    // Full screen left ends the ask for the visit.
    assert.match(script, /addEventListener\("fullscreenchange", \(\) => \{\s*fullscreenWaiting = false;/, "leaving full screen does not end the ask");
  });
});
