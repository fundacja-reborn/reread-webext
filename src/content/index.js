/**
 * What runs on every page the reader opens.
 *
 * The budget here is the whole justification for `<all_urls>`: two listeners,
 * no work at all until there is a selection, and nothing added to the page
 * until there is a bubble to show. Everything expensive - the engine, the
 * database - lives in the background.
 */

import { webext } from "../lib/browser.js";
import { describeError } from "../lib/messages.js";
import { collapseWhitespace } from "../lib/normalize.js";
import { ErrorCode, Message, asResult, fail } from "../lib/protocol.js";
import { createTooltip } from "./tooltip.js";

const tooltip = createTooltip();

/**
 * Selections come faster than translations. Every request carries the value
 * this counter had when it started, and an answer for an older one is dropped
 * rather than painted over a bubble that has moved on.
 */
let generation = 0;

/**
 * @returns {{ text: string, rect: DOMRect } | null}
 */
function readSelection() {
  const selection = window.getSelection();
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return null;

  const text = collapseWhitespace(selection.toString());
  if (text.length === 0) return null;

  const rect = selection.getRangeAt(0).getBoundingClientRect();
  // A range inside a collapsed or hidden element measures as nothing, and a
  // bubble anchored to nothing lands in the corner of the screen.
  if (rect.width === 0 && rect.height === 0) return null;

  return { text, rect };
}

/**
 * @param {string} text
 * @returns {Promise<import("../lib/protocol.js").Result<string | null>>}
 */
async function requestTranslation(text) {
  try {
    const response = await webext().runtime.sendMessage({ kind: Message.TRANSLATE, text });
    return asResult(response);
  } catch {
    // The background can be asleep, restarting, or gone after an update. None
    // of that is worth an exception on a page somebody is reading.
    return fail(ErrorCode.INTERNAL);
  }
}

/**
 * @param {MouseEvent} event
 */
function onMouseUp(event) {
  if (tooltip.owns(event.target)) return;

  const selection = readSelection();
  if (selection === null) {
    tooltip.hide();
    return;
  }

  const mine = ++generation;
  tooltip.show({
    anchor: selection.rect,
    phrase: selection.text,
    body: "Translating...",
    tone: "pending",
  });

  void requestTranslation(selection.text).then((result) => {
    if (mine !== generation || !tooltip.isOpen()) return;
    if (result.ok) {
      tooltip.setBody(result.value ?? "", "normal");
    } else {
      tooltip.setBody(describeError(result.code), "error");
    }
  });
}

/**
 * @param {KeyboardEvent} event
 */
function onKeyDown(event) {
  if (event.key === "Escape" && tooltip.isOpen()) tooltip.hide();
}

// Capture phase: pages that stop propagation on their own selection handling
// are exactly the pages where this has to keep working.
document.addEventListener("mouseup", onMouseUp, { capture: true, passive: true });
document.addEventListener("keydown", onKeyDown, { capture: true, passive: true });
document.addEventListener("scroll", () => tooltip.hide(), { capture: true, passive: true });
