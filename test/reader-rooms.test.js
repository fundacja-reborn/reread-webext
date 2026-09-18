import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { asRoomRequest } from "../src/lib/room-frame.js";

/**
 * The settings and the saved phrases shown inside the reader's own document
 * (D243), instead of walked to.
 *
 * The full screen belongs to the document: the Fullscreen spec ends it in
 * the HTML unloading document cleanup steps, and no freshly loaded document
 * may ask for it back without a press of its own. So the reader's own three
 * views keep it and a walk to a room lost it every time, six refreshes for
 * one trip on an e-ink panel (Michał, 2026-09-17). The rooms stay pages -
 * the browser's Options button, the popup and the bubble all open them on
 * their own screen - and the reader shows the same page in a frame.
 *
 * What is held here: the ask the two sides share, the frame built and thrown
 * away per opening, the one history entry a visit writes, and the fallback
 * for a frame that never loads.
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

describe("what a framed room asks the reader for (D243)", () => {
  it("reads back the four asks, and only those", () => {
    assert.deepEqual(asRoomRequest({ reread: "room", act: "ready" }), { act: "ready" });
    assert.deepEqual(asRoomRequest({ reread: "room", act: "close" }), { act: "close" });
    assert.deepEqual(asRoomRequest({ reread: "room", act: "view", view: "marks" }), { act: "view", view: "marks" });
    assert.deepEqual(asRoomRequest({ reread: "room", act: "room", room: "vocab" }), { act: "room", room: "vocab" });
    assert.deepEqual(asRoomRequest({ reread: "room", act: "room", room: "settings", section: "dictionaries" }), {
      act: "room",
      room: "settings",
      section: "dictionaries",
    });
  });

  it("answers null for everything that is not one of ours", () => {
    // `message` is a doorway anything can knock on: another script's post,
    // a shape from a build still open in some other tab, a bare value.
    for (const data of [null, undefined, 42, "ready", [], {}, { act: "close" }, { reread: "doc", act: "close" }]) {
      assert.equal(asRoomRequest(data), null, `${JSON.stringify(data) ?? "undefined"} was taken for an ask`);
    }
    assert.equal(asRoomRequest({ reread: "room", act: "walk" }), null, "an unknown act is answered");
    assert.equal(asRoomRequest({ reread: "room", act: "view", view: "settings" }), null, "a view that is not the reader's is answered");
    assert.equal(asRoomRequest({ reread: "room", act: "room", room: "reader" }), null, "a room that is not a room is answered");
  });

  it("drops a section this build does not know, rather than carrying it into an address", () => {
    // The section becomes the frame's fragment, so only D192's own list is
    // let through; the room still opens, at its top.
    assert.deepEqual(asRoomRequest({ reread: "room", act: "room", room: "settings", section: "../../evil" }), {
      act: "room",
      room: "settings",
    });
  });

  it("posts to this extension's own origin, never to anyone who will listen", async () => {
    const module = await source("lib/room-frame.js");
    assert.match(bodyOf(module, "askReader"), /window\.parent\.postMessage\(\{ \[MARK\]: "room", \.\.\.request \}, location\.origin\)/, "an ask goes out with a wildcard target");
    assert.match(bodyOf(module, "framedInReader"), /window\.parent !== window/, "a page has no way to tell it stands in a frame");
  });
});

describe("the room over the reading (D243)", () => {
  it("lets this extension frame its own pages, and nothing else", async () => {
    const manifest = JSON.parse(await source("manifest.json"));
    const policy = manifest["content_security_policy"]["extension_pages"];
    assert.match(policy, /frame-src 'self';/, "the policy has no room for a frame of our own page");
    assert.doesNotMatch(policy, /frame-src[^;]*(https|\*|data:)/, "the policy frames more than our own pages");
    // The default stays 'none': the frame is the one thing opened up.
    assert.match(policy, /default-src 'none';/, "the policy's floor moved");
  });

  it("builds the frame per opening and throws it away, so the tab's history stays the reader's", async () => {
    const reader = await source("reader/reader.js");
    const html = await source("reader/reader.html");
    assert.match(html, /<section id="room" class="room" hidden><\/section>/, "the room is not an empty sheet in the markup");
    const open = bodyOf(reader, "openRoom");
    assert.match(open, /document\.createElement\("iframe"\)/, "the frame is kept between openings - its later addresses would write history entries of their own");
    assert.match(open, /frame\.src = webext\(\)\.runtime\.getURL\(ROOM_PAGE\[kind\]/, "the frame is pointed somewhere other than our own page");
    assert.match(open, /roomBox\.replaceChildren\(frame\)/, "the old frame outlives the new one");
    assert.match(bodyOf(reader, "closeRoom"), /roomBox\.replaceChildren\(\);\s*roomBox\.hidden = true;/, "the frame is left standing when the room closes");
    // Whatever the reading had in hand goes first: the walk used to do it by
    // ending the document.
    for (const put of ["closePanels\\(\\)", "setMarker\\(false\\)", "stopReading\\(\\)", "dismiss\\(\\)"]) {
      assert.match(open, new RegExp(put), `the room opens over a reading that still holds ${put}`);
    }
  });

  it("writes one history entry per visit, and only once the frame has reported", async () => {
    const reader = await source("reader/reader.js");
    const open = bodyOf(reader, "openRoom");
    assert.match(open, /if \(fromHistory\) return;/, "a step into an entry writes another entry");
    assert.match(open, /roomPending = \{ kind, section, replace: standing \};/, "the entry is written before the frame is known to load");
    const reported = bodyOf(reader, "roomReported");
    assert.match(reported, /if \(pending\.replace\) history\.replaceState\(state, ""\);\s*else history\.pushState\(state, ""\);/, "a room leading to the other room stacks a second entry");
    // A frame that never loads: the room gives up and walks, which costs the
    // full screen but never leaves a sheet with a step back written for it.
    assert.match(open, /roomWatch = window\.setTimeout\(\(\) => \{[\s\S]*?closeRoom\(\);\s*walkToRoom\(kind, section\);/, "a frame that never loads leaves a blank sheet");
    assert.match(bodyOf(reader, "walkToRoom"), /walkTo\(ROOM_PAGE\.settings, Message\.OPEN_SETTINGS, section\)/, "the walk this replaced is gone, so there is nothing to fall back to");
  });

  it("hears only the standing frame, and reads the ask before acting on it", async () => {
    const reader = await source("reader/reader.js");
    const at = reader.indexOf('window.addEventListener("message"');
    assert.notEqual(at, -1, "the reader hears no ask from a room");
    const listener = reader.slice(at, reader.indexOf("\n});", at));
    assert.match(listener, /event\.source !== frame\.contentWindow/, "any window may speak for the room");
    assert.match(listener, /event\.origin !== location\.origin/, "an ask from another origin is acted on");
    assert.match(listener, /const ask = asRoomRequest\(event\.data\);\s*if \(ask === null\) return;/, "the ask is acted on unread");
  });

  it("makes the step back the way out, for the arrow and the system's gesture alike", async () => {
    const reader = await source("reader/reader.js");
    assert.match(bodyOf(reader, "leaveRoom"), /if \(roomEntry\) \{\s*history\.back\(\);\s*return;\s*\}/, "the arrow closes the room past the history it wrote");
    // A frame that has not reported yet wrote no entry, so there is no step
    // to wait for: the room goes here, and so does what it was left for.
    assert.match(bodyOf(reader, "leaveRoom"), /closeRoom\(\);\s*afterRoom\(leavingFor\);/, "a room left before its entry exists forgets what it was left for");
    const at = reader.indexOf('window.addEventListener("popstate"');
    const listener = reader.slice(at, reader.indexOf("\n});", at));
    assert.match(listener, /const room = asRoomState\(event\.state\);\s*if \(room !== null\) \{\s*openRoom\(room\.kind, room\.section, true\);/, "a step forward into a room's entry does not open it");
    assert.match(listener, /if \(roomShown !== null\) \{\s*closeRoom\(\);/, "a step out of a room leaves it standing");
    assert.match(listener, /if \(afterRoom\(leavingFor\)\) return;/, "a step out of a room forgets what it was left for");
    assert.match(bodyOf(reader, "afterRoom"), /if \(leavingFor === "library"\) \{\s*leaveToList\(\);/, "a room's reading-list row does not land on the list");
    assert.match(bodyOf(reader, "afterRoom"), /history\.pushState\(marksState\(scope\), ""\);\s*void showMarks\(scope, \{ fresh: true \}\);/, "a room's highlights row does not open the highlights");
    assert.match(listener, /if \(!unwindToList\) return;/, "a step out of a room falls through to the views it never left");
    // A reload standing on a room's entry opens the room again.
    assert.match(reader, /const roomStanding = asRoomState\(history\.state\);\s*if \(roomStanding !== null\) openRoom\(roomStanding\.kind, roomStanding\.section, true\);/, "a reload swallows the visit");
  });

  it("stops the reading's own gestures while the room owns the window", async () => {
    const reader = await source("reader/reader.js");
    assert.match(bodyOf(reader, "onPageKey"), /if \(roomShown !== null\) return;/, "a page key turns a page nobody can see");
    assert.match(bodyOf(reader, "onBareTap"), /roomShown !== null/, "a tap turns a page under the room");
    assert.match(reader, /if \(!paged\(\) \|\| roomShown !== null\) return;/, "the wheel turns pages under the room");
  });

  it("opens both doors of the reader into the room, and leaves the rooms their own screen", async () => {
    const reader = await source("reader/reader.js");
    assert.match(bodyOf(reader, "goToSettings"), /openRoom\("settings", section\);/, "the settings door still walks away from the reading");
    assert.match(reader, /openRoom\("vocab"\);/, "the phrases row still walks away from the reading");
    // The rooms are still pages: the browser's own Options button opens one.
    const manifest = JSON.parse(await source("manifest.json"));
    assert.equal(manifest["options_ui"]["page"], "options/options.html", "the settings stopped being a page of their own");
  });

  it("teaches both rooms that they stand inside the reader", async () => {
    for (const { page, row } of [
      { page: "options/options.js", row: 'askReader\\(\\{ act: "room", room: "vocab" \\}\\)' },
      { page: "vocab/vocab.js", row: 'askReader\\(\\{ act: "view", view: "marks" \\}\\)' },
    ]) {
      const script = await source(page);
      assert.match(script, /const inReader = framedInReader\(\);/, `${page} cannot tell it stands in the reader`);
      assert.match(script, new RegExp(row), `${page}: a menu row still navigates the frame`);
      // The phrases page still guards its tool; the settings page dropped
      // the tool altogether in F3, so there is nothing there to guard.
      if (page === "vocab/vocab.js") {
        assert.match(script, /if \(!inReader\) armFullscreenTool\(/, `${page} offers a second full-screen tool inside the reader's own screen`);
      } else {
        assert.doesNotMatch(script, /armFullscreenTool/, `${page} still arms a tool it no longer has`);
      }
      assert.match(script, /if \(inReader\) askReader\(\{ act: "ready" \}\);/, `${page} never reports for duty`);
    }
    // The phrases page signs the tab as its own; framed, that tab is the
    // reader's and the popup's row would raise an article.
    assert.match(await source("vocab/vocab.js"), /if \(!inReader\) \{\s*window\.addEventListener\("pageshow"/, "a framed phrases page signs the reader's tab as its own");
    // The arrow in a framed room is the way out of the room.
    assert.match(bodyOf(await source("lib/back-arrow.js"), "armBackArrow"), /if \(framedInReader\(\)\) \{\s*button\.hidden = false;\s*button\.addEventListener\("click", \(\) => askReader\(\{ act: "close" \}\)\);/, "the arrow of a framed room walks its own history");
  });
});
