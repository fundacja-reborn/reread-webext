import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { bodyOf } from "./openings.js";

/**
 * The bar's own full-screen tool (D195): one press for the whole screen and
 * the bar folded behind its ribbon, on Android over an article, where the
 * row has room. The rules are markup, a stylesheet and call sites, so this
 * reads them the way `bubble-fold` does.
 */

const ROOT = new URL("../src/reader/", import.meta.url);

/** @param {string} name */
async function source(name) {
  return readFile(new URL(name, ROOT), "utf8");
}

describe("the reader bar's full-screen tool", () => {
  it("stands among the view controls, right before the menu, with both glyphs and hidden until earned", async () => {
    const markup = await source("reader.html");
    const display = markup.indexOf('id="display"');
    const tool = markup.indexOf('id="fullscreen"');
    const menu = markup.indexOf('id="menu"');
    assert.ok(display !== -1 && tool !== -1 && menu !== -1, "the bar lost a tool");
    assert.ok(display < tool && tool < menu, "the full-screen tool left its place between Aa and the menu");
    const button = markup.slice(tool, markup.indexOf("</button>", tool));
    assert.match(button, /fullscreen-enter/, "the entering glyph is gone");
    assert.match(button, /fullscreen-exit/, "the leaving glyph is gone");
    const startTag = markup.slice(markup.lastIndexOf("<button", tool), markup.indexOf(">", tool));
    assert.match(startTag, /\n\s+hidden\s*$/, "the tool stands before the page knows where it is");
  });

  it("is offered on Android over an article where the browser has a full screen to give and the row has room", async () => {
    const script = await source("reader.js");
    const rule = bodyOf(script, "updateFullscreenTool");
    assert.match(rule, /shown === null/, "the tool stands over the list, which keeps its whole chrome");
    assert.match(rule, /os !== "android"/, "the tool stands on the desktop, which the ask was not about");
    assert.match(rule, /document\.fullscreenEnabled/, "the tool stands where the browser has no full screen");
    // Room is measured in the row, not read off a breakpoint: the row's
    // width in CSS pixels follows the browser's zoom, and a Boox with room
    // to spare fell under a fixed 30rem (Michał's photo, 2026-09-11).
    assert.match(rule, /bar\.scrollWidth > bar\.clientWidth/, "the room for the tool is assumed rather than measured");
    assert.match(script, /window\.addEventListener\("resize", updateFullscreenTool\)/, "a turned phone keeps the old answer about the room");
    assert.match(rule, /reader_fullscreen_exit/, "the tool's name does not follow the browser's state");
  });

  it("asks for the screen inside the press and folds the bar after, and leaves on the second press", async () => {
    const script = await source("reader.js");
    const at = script.indexOf('fullscreenTool?.addEventListener("click"');
    assert.ok(at !== -1, "the tool answers no press");
    const handler = script.slice(at, script.indexOf("\n});", at));
    const asked = handler.indexOf("requestFullscreen()");
    const folded = handler.indexOf("chromeHidden: true");
    assert.ok(asked !== -1 && folded !== -1, "the press lost half of what it does");
    assert.ok(asked < folded, "the bar folds before the screen is asked for - outside the press's activation");
    assert.match(handler, /exitFullscreen\(\)/, "the second press does not leave full screen");
    assert.match(script, /addEventListener\("fullscreenchange", updateFullscreenTool\)/, "the tool's name stops following Back and Esc");
  });

  it("wears the row's tight dress on a narrow screen, and lights up in full screen", async () => {
    const sheet = await source("reader.css");
    const narrow = sheet.slice(sheet.indexOf("@media (max-width: 30rem)"));
    assert.match(narrow, /#display,\s*#fullscreen,\s*#menu \{/, "the tool keeps the desktop's air where the others give it up");
    assert.doesNotMatch(narrow, /#fullscreen \{\s*display: none/, "the stylesheet takes the tool away by width, which the zoom makes a lie");
    assert.match(sheet, /:root:fullscreen #fullscreen,/, "the tool does not light up while the page has the screen");
    assert.match(sheet, /:root:fullscreen :is\(#nav-fullscreen, #fullscreen\) \.fullscreen-enter/, "the glyph does not follow the browser's state");
  });
});
