/**
 * Reader-only mode's whole footprint on an ordinary page: a selection shows
 * one offer - "Read in the reader" - and nothing else happens. No scan, no
 * underlines, no observer, and nothing ever goes to the engine; the reader is
 * where all of that lives in this mode. The bubble is the same shadow-rooted
 * tooltip the reading side uses, in a variant that is one button with no gloss
 * above it, so its isolation and its lifecycle are the ones already paid for.
 *
 * The selection is listened for through `selectionchange` with a settle timer,
 * not through the mouse gesture the reading side reads (D47). That is not a
 * disagreement with D47 but its terms not applying: on Android a selection is
 * made with the system's own handles, which end in no mouse gesture at all -
 * `selectionchange` is the one signal every way of selecting produces. What
 * made the event unusable over there was answering mid-drag with an engine run
 * per answer; here answering costs a bubble and the timer waits for the
 * selection to hold still, so the storm a drag produces collapses into one
 * showing. The timer only ever runs while a selection is being made - at rest
 * this module is a listener for the selection, one for scroll, and on a
 * touch-capable device one remembering the pointer's type (D74), and nothing
 * else.
 *
 * The press sends `open-reader` with no tab id on purpose: a content script
 * does not know which tab it is, but the background can read it off the
 * message's sender, and both doors to the reader end in the same function.
 */

import { webext } from "../lib/browser.js";
import { Message } from "../lib/protocol.js";
import { touchPointer } from "../lib/selection.js";
import { createTooltip } from "./tooltip.js";

/**
 * How long a selection has to hold still before the offer appears. Long enough
 * to outlast the `selectionchange` storm of a drag or a handle being moved,
 * short enough that nobody waits on it: the offer is not an answer somebody
 * asked for, it may arrive a beat after the gesture.
 */
const SETTLE_MS = 300;

const tooltip = createTooltip({ onAction });

/** @type {number | null} */
let timer = null;
let started = false;
/** The last press's pointer type: a finger's selection wears the system's
 *  bar and handles around it, and the offer stands a system strip away from
 *  it (D74). Only ever set where a finger can select - a mouse-only device
 *  does not pay for the listener. */
let lastPointerType = "";
/** The selection the offer is standing under, to stand aside when it moves. */
let shownText = "";
/**
 * The bubble-size knob as a plain factor (D85). This module deliberately
 * listens to nothing at rest, so it does not watch storage either -
 * `content/index.js` already does, owns the config, and hands the value down
 * through `setLauncherScale` on every settings change.
 */
let scale = 1;

/**
 * @param {number} factor `1` means "as designed"
 */
export function setLauncherScale(factor) {
  scale = factor;
}

/**
 * @param {import("./tooltip.js").ReportedAction} action
 */
function onAction(action) {
  if (action !== "reader") return;
  try {
    // The answer is not waited for: there is nothing to render, and the reader
    // tab coming forward is its own confirmation. A background mid-restart
    // means a press that did nothing, and pressing again is the repair.
    void webext()
      .runtime.sendMessage({ kind: Message.OPEN_READER })
      .catch(() => {});
  } catch {
    // No runtime in this context anymore - the extension was reloaded under
    // the page. Nothing to do that reloading the page will not fix.
  }
  tooltip.hide();
}

/**
 * The selection as it stands once it has held still, turned into the offer or
 * into the bubble going away. Reading the document's state rather than a
 * gesture is safe here for the reason the module comment gives: showing this
 * bubble twice costs nothing anybody can see.
 */
function settle() {
  timer = null;

  const selection = window.getSelection();
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) {
    tooltip.hide();
    return;
  }
  const text = selection.toString().trim();
  if (text.length === 0) {
    tooltip.hide();
    return;
  }

  const rect = selection.getRangeAt(0).getBoundingClientRect();
  // A selection inside a collapsed or hidden element measures as nothing, and
  // a bubble anchored to nothing lands in the corner of the screen.
  if (rect.width === 0 && rect.height === 0) {
    tooltip.hide();
    return;
  }

  shownText = text;
  tooltip.show({
    anchor: rect,
    variant: "launcher",
    body: "",
    actions: ["reader"],
    // A pen's selection wears the same system bar and handles (D80).
    touch: touchPointer(lastPointerType),
    // The same pointer also sizes the one button for the finger about to
    // press it (D84) - the media query alone answers wrong on some devices.
    coarse: touchPointer(lastPointerType),
    scale,
  });
}

function onSelectionChange() {
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(settle, SETTLE_MS);

  // The offer stands aside the moment the selection under it moves again
  // (D75): dragging a system handle sends the page no pointer event, so the
  // selection changing is the whole signal, and an offer left standing covers
  // the words the handle is heading for. A ghost change - the system's
  // toolbar poking a selection that did not move - carries the same text and
  // falls through; a collapse is the timer's business, as it always was.
  if (!tooltip.isOpen()) return;
  const selection = window.getSelection();
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return;
  if (selection.toString().trim() === shownText) return;
  tooltip.hide();
}

/**
 * @param {PointerEvent} event
 */
function onPointerDown(event) {
  lastPointerType = event.pointerType;
}

/**
 * @param {Event} event
 */
function onScroll(event) {
  // The bubble is anchored to viewport coordinates, and a scroll moves the
  // text out from under it. Scrolls inside the bubble itself do not leave the
  // shadow root, but the day one does it must not close what it scrolls.
  if (!tooltip.owns(event.target)) tooltip.hide();
}

export function startLauncher() {
  if (started) return;
  started = true;
  document.addEventListener("selectionchange", onSelectionChange);
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
  // Only where a finger can select, for the reason reading.js gives (D73):
  // on a mouse-only device the answer would never change, and the offer
  // stands above the phrase as it always has.
  if (navigator.maxTouchPoints > 0) {
    document.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
  }
}

/**
 * Everything `startLauncher` put on the page, taken back - switching sites off
 * and switching the mode off both land here, and both have to leave the page
 * as if nothing had run.
 */
export function stopLauncher() {
  if (!started) return;
  started = false;
  document.removeEventListener("selectionchange", onSelectionChange);
  document.removeEventListener("scroll", onScroll, { capture: true });
  // Removing what was never added is a no-op, so no second capability check.
  document.removeEventListener("pointerdown", onPointerDown, { capture: true });
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  lastPointerType = "";
  shownText = "";
  tooltip.hide();
}
