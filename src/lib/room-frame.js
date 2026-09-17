/**
 * A room of this extension standing inside the reader's own document (D243).
 *
 * The settings and the saved phrases are pages of their own: the browser's
 * own Options button opens one, the popup and the bubble open either, and
 * both have to work with no reader anywhere. But walking to them from the
 * reader cost the full screen every single time. The full screen belongs to
 * the document - the Fullscreen spec ends it in the HTML unloading document
 * cleanup steps, and no freshly loaded document may ask for it back without
 * a press of its own - while a walk is a real navigation, which is exactly
 * what gives a phone its way back (D139/D141). The reader's own three views
 * keep the screen because they are three sections of one file (Michał,
 * 2026-09-17: "entering the settings or the saved phrases always loses the
 * full screen (...) every loss is the picture rescaling and the browser's
 * bar coming back").
 *
 * So the reader shows the very same page inside itself, in a frame it builds
 * and throws away, and nothing navigates. This module is what the two sides
 * say to each other: a framed page cannot walk anywhere by itself, so it
 * asks the reader instead, and the reader reads the ask the way it reads a
 * history entry - field by field, trusting nothing (the frame is ours, but
 * `message` is a shared doorway, and a validator is cheaper than a proof).
 */

import { SETTINGS_SECTIONS } from "./protocol.js";

/** The property that marks a message as ours, named like the history entries'. */
const MARK = "reread";

/** The two rooms the reader can stand over itself. */
export const ROOMS = Object.freeze(/** @type {const} */ (["settings", "vocab"]));

/** @typedef {(typeof ROOMS)[number]} RoomKind */

/** The reader's own views a framed room's menu can ask for. */
const VIEWS = Object.freeze(/** @type {const} */ (["library", "marks"]));

/**
 * What a framed room asks the reader for:
 * - `ready`, once, as the page finishes loading - the reader waits for it
 *   before trusting the frame at all, so a frame a policy refuses to load
 *   falls back to the walk instead of leaving a blank sheet on screen;
 * - `close`, the way out its own bar offers (the arrow), which is the same
 *   step back the system's gesture takes;
 * - `view`, a row of its menu naming one of the reader's own views;
 * - `room`, a row naming the other room.
 *
 * @typedef {{ act: "ready" }
 *   | { act: "close" }
 *   | { act: "view", view: "library" | "marks" }
 *   | { act: "room", room: RoomKind, section?: string }} RoomRequest
 */

/**
 * Whether this page stands inside another document of ours. Only our own
 * pages can frame it: the manifest's policy allows `frame-src 'self'`, and
 * an extension page is not loadable from the web at all (nothing of ours is
 * web accessible), so a parent means the reader.
 *
 * @returns {boolean}
 */
export function framedInReader() {
  try {
    return window.parent !== window;
  } catch {
    // A cross-origin parent throws on nothing here, but the read is cheap
    // to guard and "standing alone" is the safe answer.
    return false;
  }
}

/**
 * Asks the reader for something, or does nothing on a page standing alone.
 * The origin is named on purpose: the message must not go anywhere but our
 * own document, whatever else ever ends up around it.
 *
 * @param {RoomRequest} request
 */
export function askReader(request) {
  if (!framedInReader()) return;
  try {
    window.parent.postMessage({ [MARK]: "room", ...request }, location.origin);
  } catch {
    // The parent went while the press was travelling; the room is on its
    // own screen then, and its own controls are the way out.
  }
}

/**
 * The ask a message carries, or null for everything that is not one of ours -
 * another script's message, an old shape from a version that is still open in
 * some tab, a stray post from anywhere. Validated field by field, the way the
 * history entries are (`lib/reader/history-state.js`).
 *
 * @param {unknown} data
 * @returns {RoomRequest | null}
 */
export function asRoomRequest(data) {
  if (typeof data !== "object" || data === null) return null;
  const message = /** @type {Record<string, unknown>} */ (data);
  if (message[MARK] !== "room") return null;
  const act = message["act"];
  if (act === "ready" || act === "close") return { act };
  if (act === "view") {
    const view = message["view"];
    return VIEWS.some((named) => named === view)
      ? { act, view: /** @type {"library" | "marks"} */ (view) }
      : null;
  }
  if (act !== "room") return null;
  const room = message["room"];
  if (!ROOMS.some((named) => named === room)) return null;
  const kind = /** @type {RoomKind} */ (room);
  const section = message["section"];
  // A section travels into the frame's address, so only the ones this build
  // knows are let through (D192's own list).
  if (section === undefined) return { act, room: kind };
  return SETTINGS_SECTIONS.some((named) => named === section)
    ? { act, room: kind, section: /** @type {string} */ (section) }
    : { act, room: kind };
}
