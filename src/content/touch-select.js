/**
 * Selecting by touch on the reader page, without the browser's selection (D80).
 *
 * On a touch screen the native selection comes wrapped in system chrome - a
 * floating bar over the phrase, drag handles under it - that a page can
 * neither move nor dismiss, and its gestures end in no event a page can hear
 * (D73). Readlang's answer is not to create a native selection at all, and
 * this module is that answer for the reader: while the pointer is a finger or
 * a pen, the article refuses the native selection (`user-select: none`, via an
 * attribute the stylesheet reads), a tap takes the word under it, a drag that
 * starts on the selection stretches it word by word, and the end of the
 * gesture is a `touchend` - unambiguous, so the bubble, the translation and
 * the keeping happen exactly on the finger lifting and never mid-gesture.
 *
 * Only ever started by the reader page, which is our own page: on somebody
 * else's page the native selection is part of not touching what is being read,
 * and stays.
 *
 * The selection itself is a run of the matcher's own tokens in one block,
 * painted through the highlight registry the way underlines are - no node of
 * the article is touched, and the words selected are exactly words a scan can
 * find again. What the module hands out is the DOM `Range` of that run;
 * everything about bubbles, translating and keeping stays in `reading.js`,
 * which also decides what a tap on an underlined phrase or on empty space
 * means - taps this module does not take keep becoming the compatibility
 * mouse events those paths already listen to.
 */

import { locate } from "../lib/matcher/spans.js";
import { tokenize } from "../lib/matcher/tokenize.js";
import { nearestWordIndex, wordIndexAt } from "../lib/matcher/words.js";
import { touchPointer } from "../lib/selection.js";
import { phraseAt, supported } from "./highlighter.js";
import { blockPieces } from "./scan.js";

/** Must be the name in `reader.css`. */
const NAME = "reread-selection";

/**
 * How far a touch may drift and still be a tap. Wider than the mouse's four
 * pixels: a fingertip rolls as it lifts, and a tap read as a tiny scroll
 * would select nothing over and over.
 */
const TAP_SLOP = 10;

/**
 * How far outside its own boxes the selection can still be grabbed, and how
 * far off a word a tap still counts as on it. A line of text is thinner than
 * a fingertip; without the margin, starting the stretch gesture would demand
 * pixel aim.
 */
const GRAB_SLOP = 8;

/**
 * How a finished gesture relates to what was selected before it - the whole
 * of what `reading.js` needs in order to keep the vocabulary honest about a
 * phrase built in steps.
 *
 * @typedef {"tap" | "extend" | "again"} GestureKind
 */

/**
 * @typedef {object} TouchSelectHooks
 * @property {Element} root where taps select - the article, and nothing else
 * @property {(target: EventTarget | null) => boolean} owns whether a target is the bubble's
 * @property {(range: Range, kind: GestureKind) => void} onSelected a gesture ended on this selection
 * @property {() => void} onExtendStart a stretch is moving - whatever is shown is stale
 */

/** @type {TouchSelectHooks | null} */
let hooks = null;
let started = false;

/**
 * The block the selection lives in, with the machinery to move around it:
 * its pieces, their places in the joined text, and the text's tokens. One
 * selection, one block - the matcher stops at block edges, so a phrase across
 * two could never be found again (D45).
 *
 * @typedef {{ block: Element, parts: import("./scan.js").BlockPart[], spans: import("../lib/matcher/spans.js").Span[], tokens: import("../lib/matcher/tokenize.js").Token[] }} Geometry
 */

/** @type {Geometry | null} */
let geometry = null;
/** The selected run of tokens, ends inclusive, and the word it grew from. */
/** @type {{ from: number, to: number, anchor: number } | null} */
let span = null;
/** The selection as the page sees it - live, rebuilt on every change. */
/** @type {Range | null} */
let range = null;
/** @type {Highlight | null} */
let highlight = null;

/**
 * The one touch being followed, from start to end. `tap` observes and lets
 * scrolling be scrolling; `extend` has claimed the gesture with
 * `preventDefault` and is stretching the selection.
 *
 * @type {{ id: number, x: number, y: number, mode: "tap" | "extend", moved: boolean } | null}
 */
let gesture = null;

/**
 * @param {TouchList} touches
 * @param {number} id
 * @returns {Touch | null}
 */
function touchById(touches, id) {
  for (const touch of touches) {
    if (touch.identifier === id) return touch;
  }
  return null;
}

/**
 * Whether a point lies in one of a range's boxes, a finger's margin included.
 *
 * @param {Range} target
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function withinRects(target, x, y) {
  for (const rect of target.getClientRects()) {
    if (
      x >= rect.left - GRAB_SLOP &&
      x <= rect.right + GRAB_SLOP &&
      y >= rect.top - GRAB_SLOP &&
      y <= rect.bottom + GRAB_SLOP
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The caret the browser would put at a point - the same question underline
 * hit-testing deliberately does not ask, asked here on purpose: a tap is not
 * on a known range yet, and the nearest caret is the honest reading of where
 * in the text a finger landed.
 *
 * @param {number} x
 * @param {number} y
 * @returns {{ node: Text, offset: number } | null}
 */
function caretAt(x, y) {
  if (typeof document.caretPositionFromPoint !== "function") return null;
  const position = document.caretPositionFromPoint(x, y);
  const node = position === null ? null : position.offsetNode;
  if (!(node instanceof Text)) return null;
  return { node, offset: position === null ? 0 : position.offset };
}

/**
 * Where a caret sits in its block's joined text, through the same pieces the
 * matcher joins. Null for a caret in no piece of this block - another block,
 * or text the walk skips - which every caller treats as "not a word here".
 *
 * @param {Geometry} geo
 * @param {Text} node
 * @param {number} offset
 * @returns {number | null}
 */
function offsetIn(geo, node, offset) {
  const index = geo.parts.findIndex((part) => part.node === node);
  const piece = geo.spans[index];
  if (index === -1 || piece === undefined) return null;
  return piece.start + offset;
}

/**
 * The DOM range of a run of tokens, built the way the underline painter builds
 * its matches: ends mapped back through the piece spans, the last character
 * rather than the position after it, so an end on a piece boundary stays in
 * the piece the word is in.
 *
 * @param {Geometry} geo
 * @param {number} from token index
 * @param {number} to token index, inclusive
 * @returns {Range | null}
 */
function rangeOfSpan(geo, from, to) {
  const first = geo.tokens[from];
  const last = geo.tokens[to];
  if (first === undefined || last === undefined) return null;

  const start = locate(geo.spans, first.start);
  const end = locate(geo.spans, last.end - 1);
  const startNode = start === null ? null : (geo.parts[start.piece]?.node ?? null);
  const endNode = end === null ? null : (geo.parts[end.piece]?.node ?? null);
  if (start === null || end === null || startNode === null || endNode === null) return null;

  const built = document.createRange();
  built.setStart(startNode, start.offset);
  built.setEnd(endNode, end.offset + 1);
  return built;
}

/**
 * Painted the way underlines are painted: a registered highlight, no node
 * touched. Above the underlines (`priority`), because the selection is the
 * newer statement about the same words.
 */
function paint() {
  if (!supported() || range === null) return;
  if (highlight === null) {
    highlight = new Highlight();
    highlight.priority = 1;
    CSS.highlights.set(NAME, highlight);
  }
  highlight.clear();
  highlight.add(range);
}

/**
 * @param {Geometry} geo
 * @param {number} from
 * @param {number} to
 * @param {number} anchor
 * @returns {boolean} whether the selection now stands
 */
function select(geo, from, to, anchor) {
  const built = rangeOfSpan(geo, from, to);
  if (built === null) return false;
  geometry = geo;
  span = { from, to, anchor };
  range = built;
  paint();
  return true;
}

/** The selection and its paint, gone. Safe to call however little is held. */
export function clearTouchSelection() {
  geometry = null;
  span = null;
  range = null;
  highlight = null;
  if (supported()) CSS.highlights.delete(NAME);
}

/**
 * The stylesheet's switch (D80): while the pointer is a finger or a pen the
 * article refuses the native selection, and the moment a mouse presses, it is
 * given back - a hybrid loses nothing. Reading the pointer type off the press
 * is the one way to know which world the next gesture belongs to.
 *
 * @param {PointerEvent} event
 */
function onPointerDown(event) {
  hooks?.root.toggleAttribute("data-touch-select", touchPointer(event.pointerType));
}

/**
 * @param {TouchEvent} event
 */
function onTouchStart(event) {
  if (hooks === null) return;

  if (gesture !== null) {
    // A second finger. A stretch in progress keeps its claim and ignores it;
    // a tap being watched stops being one - this is a pinch now.
    if (gesture.mode === "tap") gesture = null;
    return;
  }
  if (event.touches.length > 1) return;
  const touch = event.changedTouches[0];
  if (touch === undefined) return;
  if (hooks.owns(event.target)) return;

  // On the selection: the stretch gesture, claimed whole before the browser
  // reads it as a scroll - and with it go the compatibility mouse events,
  // which would have read the same press as "dismiss the bubble".
  if (range !== null && withinRects(range, touch.clientX, touch.clientY)) {
    event.preventDefault();
    gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, mode: "extend", moved: false };
    return;
  }

  const target = event.target;
  if (!(target instanceof Node) || !hooks.root.contains(target)) return;
  gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, mode: "tap", moved: false };
}

/**
 * @param {TouchEvent} event
 */
function onTouchMove(event) {
  const active = gesture;
  if (active === null) return;
  const touch = touchById(event.changedTouches, active.id);
  if (touch === null) return;

  if (active.mode === "tap") {
    // Travelled: a scroll, and the browser is already doing it. Stop watching.
    if (Math.abs(touch.clientX - active.x) > TAP_SLOP || Math.abs(touch.clientY - active.y) > TAP_SLOP) {
      gesture = null;
    }
    return;
  }

  if (event.cancelable) event.preventDefault();
  if (!active.moved) {
    active.moved = true;
    // Whatever bubble is open is about the selection this is stretching away
    // from - it stands aside (D75's reason), and nothing comes back until the
    // finger lifts.
    hooks?.onExtendStart();
  }
  extendTo(touch.clientX, touch.clientY);
}

/**
 * The stretch, one move at a time: the word nearest the finger becomes the
 * far end, the anchor word stays the near one. A finger outside the block -
 * past its last line, over a nested block's text - moves nothing, which is
 * what keeps the selection from jumping to text it could never form a phrase
 * with (D45).
 *
 * @param {number} x
 * @param {number} y
 */
function extendTo(x, y) {
  const geo = geometry;
  const at = span;
  if (geo === null || at === null) return;

  const caret = caretAt(x, y);
  if (caret === null) return;
  const offset = offsetIn(geo, caret.node, caret.offset);
  if (offset === null) return;
  const focus = nearestWordIndex(geo.tokens, offset);
  if (focus === -1) return;

  const from = Math.min(at.anchor, focus);
  const to = Math.max(at.anchor, focus);
  if (from === at.from && to === at.to) return;
  select(geo, from, to, at.anchor);
}

/**
 * @param {TouchEvent} event
 */
function onTouchEnd(event) {
  const active = gesture;
  if (active === null || hooks === null) return;
  const touch = touchById(event.changedTouches, active.id);
  if (touch === null) return;
  gesture = null;

  if (active.mode === "extend") {
    if (event.cancelable) event.preventDefault();
    if (range === null) return;
    // Moved: a selection stretched, ended exactly here. Still: a tap on the
    // selection itself, which is a knock on a bubble that may have closed -
    // `reading.js` answers it again or knows it is already open.
    hooks.onSelected(range, active.moved ? "extend" : "again");
    return;
  }

  tap(event, touch.clientX, touch.clientY);
}

/**
 * A touch the system took back - an edge swipe, mostly. The selection as
 * stretched so far is answered like a lifted finger: the reader is left with
 * a bubble about what is on the screen, never with a highlight and nothing
 * to show for it.
 *
 * @param {TouchEvent} event
 */
function onTouchCancel(event) {
  const active = gesture;
  if (active === null) return;
  if (touchById(event.changedTouches, active.id) === null) return;
  gesture = null;
  if (active.mode === "extend" && active.moved && range !== null) {
    hooks?.onSelected(range, "extend");
  }
}

/**
 * A tap, told apart from every tap that is not a word. Links keep navigating,
 * underlined phrases keep recalling, empty space keeps dismissing - all of
 * them by this returning without `preventDefault`, so the tap goes on to
 * become the compatibility mouse events those paths already handle. Only a
 * tap that lands on a plain word claims the event, selects the word, and
 * hands it over on the spot - the finger is up, and this is the moment the
 * bubble is for.
 *
 * @param {TouchEvent} event
 * @param {number} x
 * @param {number} y
 */
function tap(event, x, y) {
  if (hooks === null) return;

  // The article's own links outrank selecting the words inside them - the
  // mouse still selects there, and a link that stopped opening would be the
  // reader breaking the article.
  const target = event.target;
  if (target instanceof Element && target.closest("a[href]") !== null) return;

  // An underlined phrase: recall, which already works by tap and knows the
  // whole phrase - a one-word selection over it would shadow the better answer.
  if (phraseAt(x, y) !== null) return;

  const caret = caretAt(x, y);
  if (caret === null) return;
  const pieces = blockPieces(caret.node);
  if (pieces === null || !hooks.root.contains(pieces.block)) return;

  /** @type {Geometry} */
  const geo = { ...pieces, tokens: tokenize(pieces.text) };
  const offset = offsetIn(geo, caret.node, caret.offset);
  if (offset === null) return;
  const index = wordIndexAt(geo.tokens, offset);
  if (index === -1) return;

  // The caret snaps to the nearest text from anywhere - a tap in the empty
  // end of a paragraph's last line reads as a caret at its last word. Only a
  // tap whose point actually touches the word's own boxes selects it; the
  // rest is somebody tapping past the text, which is a dismissal.
  const word = rangeOfSpan(geo, index, index);
  if (word === null || !withinRects(word, x, y)) return;

  event.preventDefault();
  if (select(geo, index, index, index) && range !== null) {
    hooks.onSelected(range, "tap");
  }
}

/**
 * Stretch the selection one word left or right - the bubble's own buttons, for
 * the screens where a drag is hard to see (e-ink) or hard to aim. Returns the
 * grown range, or null at the block's edge, where there is no word to grow to.
 *
 * @param {-1 | 1} direction
 * @returns {Range | null}
 */
export function extendTouchSelection(direction) {
  const geo = geometry;
  const at = span;
  if (geo === null || at === null) return null;

  const from = direction < 0 ? at.from - 1 : at.from;
  const to = direction < 0 ? at.to : at.to + 1;
  if (from < 0 || to >= geo.tokens.length) return null;
  if (!select(geo, from, to, at.anchor)) return null;
  return range;
}

/**
 * @param {TouchSelectHooks} options
 */
export function startTouchSelect(options) {
  if (started) return;
  started = true;
  hooks = options;
  // The touch listeners are not passive on purpose: claiming the stretch
  // gesture and the tap-on-a-word is `preventDefault`, and a passive listener
  // has none to call. Everything else remains one hit-test per event.
  document.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
  document.addEventListener("touchstart", onTouchStart, { capture: true, passive: false });
  document.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
  document.addEventListener("touchend", onTouchEnd, { capture: true, passive: false });
  document.addEventListener("touchcancel", onTouchCancel, { capture: true, passive: true });
}

/** Everything taken back: listeners, attribute, selection, paint. */
export function stopTouchSelect() {
  if (!started) return;
  started = false;
  document.removeEventListener("pointerdown", onPointerDown, { capture: true });
  document.removeEventListener("touchstart", onTouchStart, { capture: true });
  document.removeEventListener("touchmove", onTouchMove, { capture: true });
  document.removeEventListener("touchend", onTouchEnd, { capture: true });
  document.removeEventListener("touchcancel", onTouchCancel, { capture: true });
  hooks?.root.removeAttribute("data-touch-select");
  hooks = null;
  gesture = null;
  clearTouchSelection();
}
