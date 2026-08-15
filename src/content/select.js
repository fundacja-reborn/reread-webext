/**
 * Selecting on the reader page, without the browser's selection (D80,
 * reshaped by D81, joined by the mouse in D86).
 *
 * On a touch screen the native selection comes wrapped in system chrome - a
 * floating bar over the phrase, drag handles under it - that a page can
 * neither move nor dismiss, and its gestures end in no event a page can hear
 * (D73). Readlang's answer is not to create a native selection at all, and
 * this module is that answer for the reader: the article refuses the native
 * selection outright (`user-select: none` in the stylesheet), and selecting
 * is one gesture with a beginning the reader asks for and an end the page
 * can hear. A finger held
 * still on a word takes it whole; dragging on, finger still down, stretches
 * the selection word by word; the finger lifting is the one moment the
 * bubble, the translation and the keeping happen - never mid-gesture.
 *
 * The hold is what makes the gesture claimable at all. A tap is the most
 * overloaded thing on a touch screen - the start of a scroll, a link, a
 * dismissal - and selecting on taps (the first D80) meant a chain of buttons
 * and special cases to build a phrase around one. A held finger is neither a
 * scroll nor a tap, so the page can take it without robbing the article of
 * anything - and everything after the hold belongs to the gesture, scrolling
 * included, because a finger that asked to select is not asking to scroll.
 * The promise runs the other way too: a touch that scrolled - or landed on a
 * page still gliding from a scroll - never becomes a hold, however long the
 * finger rests before lifting. Fingers routinely rest at the end of their
 * scroll, and a word selected there would be the gesture answering a
 * question nobody asked.
 *
 * Taps stay what taps are everywhere: while a selection stands, a tap on the
 * word right next to it grows the phrase by that word (the after-the-fact
 * refinement, and the e-ink way to extend), and a tap on the selection itself
 * is a knock on a bubble that may have closed - everything else, links and
 * underlined phrases and empty space, keeps becoming the compatibility mouse
 * events the old paths already listen to.
 *
 * The mouse lives in the same world (D86): the article refuses the native
 * selection for every pointer, and a mouse gesture selects the same runs of
 * whole words a finger does. A press that travels is a drag and selects from
 * the word it pressed on - no hold needed, because a mouse drag is not a
 * scroll and not anything else; a press that stays put for the hold's 400 ms
 * takes its word too, so the hand that learned the gesture on glass finds it
 * at the desk. The release is the gesture's end the way the finger lifting
 * is. Clicks speak the tap's grammar - the neighbour grows the phrase, the
 * selection knocks - and a double click still takes a word, the way it does
 * everywhere. What the desk pays is the native selection itself: article
 * text cannot be dragged over and copied any more, the price D80 already
 * named on touch. The release is handed in by `reading.js` (`releaseMouse`)
 * rather than listened for here: the mouse-up already has an owner there,
 * deciding between a selection, an underline and a dismissal, and two
 * listeners would each answer half. A finger's compatibility mouse events
 * are kept out by time - they arrive on the heels of a touch, and a mouse
 * event that close to one is a translation, not a hand on a mouse - which is
 * also what lets a pen with no touch screen under it (a desk tablet) speak
 * for the mouse here.
 *
 * Only ever started by the reader page, which is our own page: on somebody
 * else's page the native selection is part of not touching what is being
 * read, and stays.
 *
 * The selection itself is a run of the matcher's own tokens in one block,
 * painted through the highlight registry the way underlines are - no node of
 * the article is touched, and the words selected are exactly words a scan can
 * find again. What the module hands out is the DOM `Range` of that run;
 * everything about bubbles, translating and keeping stays in `reading.js`.
 */

import { locate } from "../lib/matcher/spans.js";
import { tokenize } from "../lib/matcher/tokenize.js";
import { besideSpan, nearestWordIndex, wordIndexAt } from "../lib/matcher/words.js";
import { madeSelection } from "../lib/selection.js";
import { supported } from "./highlighter.js";
import { blockPieces } from "./scan.js";

/** Must be the name in `reader.css`. */
const NAME = "reread-selection";

/**
 * How long a finger has to hold still before the hold becomes a selection.
 * Android's own long-press timing, so the gesture lands exactly when a hand
 * trained by the platform expects it to - and a shade before the browser's
 * own long-press machinery, so ours speaks first. The mouse waits the same
 * time (D86): one number the hand already knows, on glass and at the desk.
 */
const HOLD_MS = 400;

/**
 * How far a holding finger may drift and still be holding, and how far a tap
 * may roll as it lifts and still be a tap. Wider than the mouse's four
 * pixels: a fingertip is not a point, and a hold read as a tiny scroll would
 * select nothing over and over.
 */
const TAP_SLOP = 10;

/**
 * How far off a word a touch still counts as on it, and how far outside its
 * own boxes the selection still catches the knocking tap. A line of text is
 * thinner than a fingertip; without the margin, both would demand pixel aim.
 */
const GRAB_SLOP = 8;

/**
 * The mouse's margin: next to none. A pointer that lands between two lines
 * or a breath away from the phrase is dismissing, not aiming - given the
 * finger's slop, those clicks would read as knocks on the selection instead.
 */
const MOUSE_SLOP = 2;

/**
 * How long after a touch a mouse event still belongs to it. A tap the touch
 * side leaves unclaimed becomes compatibility mouse events on its heels, and
 * they must not walk the mouse grammar too - a double tap is not a double
 * click. A real hand on a real mouse is never this close behind a touch, and
 * a pen with no touch screen under it (a desk tablet) speaks only mouse
 * events, so this one gate is also what lets it in.
 */
const COMPAT_MS = 500;

/**
 * How long after the page last scrolled a touch still belongs to the scroll.
 * A finger landing on a page in mid-glide is catching it, not asking about
 * the word it happens to land on - and the catch often rests longer than the
 * hold's timer. Scroll events come every frame while anything moves, so the
 * window only has to outlast one frame's gap, with slack for a slow panel.
 */
const SCROLL_TAIL_MS = 100;

/**
 * How a finished gesture relates to what was selected before it - the whole
 * of what `reading.js` needs in order to keep the vocabulary honest about a
 * phrase built in steps. `press` is the hold-and-drag gesture ending, a fresh
 * statement of the whole phrase; `extend` is a tap growing the standing
 * selection by its neighbour; `again` is a tap on the selection itself.
 *
 * @typedef {"press" | "extend" | "again"} GestureKind
 */

/**
 * @typedef {object} SelectHooks
 * @property {Element} root where holds select - the article, and nothing else
 * @property {(target: EventTarget | null) => boolean} owns whether a target is the bubble's
 * @property {(range: Range, kind: GestureKind) => void} onSelected a gesture ended on this selection
 * @property {() => void} onSelectStart a hold just took a word - whatever is shown is stale
 */

/** @type {SelectHooks | null} */
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
 * The one touch being followed, from start to end. `hold` observes - a timer
 * is running toward the selection, and a finger that travels or lifts first
 * was a scroll or a tap; `select` has claimed the gesture with
 * `preventDefault` and is stretching the selection. `x`/`y` follow the
 * finger; `fromX`/`fromY` stay where it landed, because drift is measured
 * against the landing point and never against the previous event - a slow
 * scroll moves little between events, and a creeping reference point would
 * let it pass for a finger holding still.
 *
 * @type {{ id: number, x: number, y: number, fromX: number, fromY: number, target: EventTarget | null, timer: number, mode: "hold" | "select" } | null}
 */
let gesture = null;

/**
 * The one mouse press being followed, the touch gesture's shape without the
 * ambiguity (D86): `hold` is a press that may yet be a click, waiting on the
 * same timer the finger waits on; `select` has taken a word and is
 * stretching. There is no scroll to tell a drag from, so travel alone claims
 * the gesture - and no `preventDefault` either, because the article's
 * stylesheet already refuses the native selection for everybody.
 *
 * @type {{ x: number, y: number, fromX: number, fromY: number, timer: number, mode: "hold" | "select" } | null}
 */
let mouse = null;

/**
 * When a touch last spoke, `performance.now()` time - stamped on every touch
 * start and end, so the compatibility mouse events a tap turns into are
 * always inside `COMPAT_MS` of it, however long the finger rested first.
 * Never, rather than zero: zero is the page loading, and a mouse pressing in
 * the first half second of it is no less a mouse.
 */
let touchedAt = -Infinity;

/** When the page last scrolled, `performance.now()` time. See `SCROLL_TAIL_MS`. */
let scrolledAt = 0;

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
 * Whether a point lies in one of a range's boxes, the pointer's margin
 * included - a finger's or a mouse's, whichever asked.
 *
 * @param {Range} target
 * @param {number} x
 * @param {number} y
 * @param {number} slop
 * @returns {boolean}
 */
function withinRects(target, x, y, slop) {
  for (const rect of target.getClientRects()) {
    if (x >= rect.left - slop && x <= rect.right + slop && y >= rect.top - slop && y <= rect.bottom + slop) {
      return true;
    }
  }
  return false;
}

/**
 * The caret the browser would put at a point - the same question underline
 * hit-testing deliberately does not ask, asked here on purpose: a touch is
 * not on a known range yet, and the nearest caret is the honest reading of
 * where in the text a finger landed.
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
export function clearSelection() {
  geometry = null;
  span = null;
  range = null;
  highlight = null;
  if (supported()) CSS.highlights.delete(NAME);
}

/**
 * The word under a point, in the geometry of its own block - the shared first
 * step of every gesture that starts or grows a selection. Only a point that
 * actually touches the word's boxes answers: the caret snaps to the nearest
 * text from anywhere, and a press in the empty end of a paragraph's last line
 * must not read as its last word.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} slop the asking pointer's margin
 * @returns {{ geo: Geometry, index: number } | null}
 */
function wordAt(x, y, slop) {
  if (hooks === null) return null;
  const caret = caretAt(x, y);
  if (caret === null) return null;
  const pieces = blockPieces(caret.node);
  if (pieces === null || !hooks.root.contains(pieces.block)) return null;

  /** @type {Geometry} */
  const geo = { ...pieces, tokens: tokenize(pieces.text) };
  const offset = offsetIn(geo, caret.node, caret.offset);
  if (offset === null) return null;
  const index = wordIndexAt(geo.tokens, offset);
  if (index === -1) return null;

  const word = rangeOfSpan(geo, index, index);
  if (word === null || !withinRects(word, x, y, slop)) return null;
  return { geo, index };
}

/**
 * The hold coming due: the finger is still down and has not travelled, so
 * this is a selection starting - if there is a word under it to start on.
 *
 * A hold on the article's own links is left to the browser, whose long-press
 * menu (open in new tab, copy link) is part of the article working; a hold on
 * empty space, an image or another block's text takes nothing and quietly
 * remains a tap in waiting. An underlined phrase is *not* stepped around the
 * way the old tap stepped around it: a tap still recalls it whole, and the
 * hold is now the more deliberate gesture - somebody starting a selection on
 * a word they happen to already know.
 */
function hold() {
  const active = gesture;
  if (active === null || active.mode !== "hold" || hooks === null) return;

  const target = active.target;
  if (target instanceof Element && target.closest("a[href]") !== null) return;

  const word = wordAt(active.x, active.y, GRAB_SLOP);
  if (word === null) return;

  // Whatever bubble is open is about to be about something else (D75's
  // reason) - it stands aside before the new selection paints over its
  // phrase, and nothing comes back until the finger lifts.
  hooks.onSelectStart();
  if (!select(word.geo, word.index, word.index, word.index)) return;
  active.mode = "select";
  // The tick Android's own long-press gives: the sign the hold took, on the
  // hardware that can make it - an e-ink reader mostly cannot, and there the
  // painted selection is the answer.
  if (typeof navigator.vibrate === "function") navigator.vibrate(15);
}

/**
 * @param {TouchEvent} event
 */
function onTouchStart(event) {
  touchedAt = performance.now();
  if (hooks === null) return;

  if (gesture !== null) {
    // A second finger. A selection in progress keeps its claim and ignores
    // it; a hold waiting on its timer stops waiting - this is a pinch now.
    if (gesture.mode === "hold") cancelGesture();
    return;
  }
  if (event.touches.length > 1) return;
  const touch = event.changedTouches[0];
  if (touch === undefined) return;
  if (hooks.owns(event.target)) return;

  const target = event.target;
  if (!(target instanceof Node) || !hooks.root.contains(target)) return;

  // Landing on a page still gliding from a scroll: the catch, part of the
  // scrolling and none of ours - it arms no hold, and its end claims no tap.
  if (performance.now() - scrolledAt < SCROLL_TAIL_MS) return;

  gesture = {
    id: touch.identifier,
    x: touch.clientX,
    y: touch.clientY,
    fromX: touch.clientX,
    fromY: touch.clientY,
    target,
    timer: window.setTimeout(hold, HOLD_MS),
    mode: "hold",
  };
}

/** The gesture and its timer, gone - a scroll, a pinch, a system take-back. */
function cancelGesture() {
  if (gesture !== null) window.clearTimeout(gesture.timer);
  gesture = null;
}

/**
 * @param {TouchEvent} event
 */
function onTouchMove(event) {
  const active = gesture;
  if (active === null) return;
  const touch = touchById(event.changedTouches, active.id);
  if (touch === null) return;

  if (active.mode === "hold") {
    // Travelled from where it landed: a scroll, and the browser is already
    // doing it. The gesture is over for good - a finger resting at the end
    // of its scroll is finishing the scroll, not starting a hold. Drift
    // inside the slop keeps the hold and follows the finger, so the word
    // the hold takes is the word actually under it when it comes due.
    if (Math.abs(touch.clientX - active.fromX) > TAP_SLOP || Math.abs(touch.clientY - active.fromY) > TAP_SLOP) {
      cancelGesture();
      return;
    }
    active.x = touch.clientX;
    active.y = touch.clientY;
    return;
  }

  if (event.cancelable) event.preventDefault();
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
  touchedAt = performance.now();
  const active = gesture;
  if (active === null || hooks === null) return;
  const touch = touchById(event.changedTouches, active.id);
  if (touch === null) return;
  cancelGesture();

  if (active.mode === "select") {
    // The gesture's end is the moment everything is for: the bubble, the
    // translation and the keeping land exactly here. Claimed, so the lift
    // does not also become the mouse events that would read it as a click.
    if (event.cancelable) event.preventDefault();
    if (range === null) return;
    hooks.onSelected(range, "press");
    return;
  }

  tap(event, touch.clientX, touch.clientY);
}

/**
 * A touch the system took back - an edge swipe, mostly. A selection stretched
 * so far is answered like a lifted finger: the reader is left with a bubble
 * about what is on the screen, never with a highlight and nothing to show for
 * it. A hold still waiting was nothing yet, and becomes nothing.
 *
 * @param {TouchEvent} event
 */
function onTouchCancel(event) {
  touchedAt = performance.now();
  const active = gesture;
  if (active === null) return;
  if (touchById(event.changedTouches, active.id) === null) return;
  cancelGesture();
  if (active.mode === "select" && range !== null) {
    hooks?.onSelected(range, "press");
  }
}

/**
 * The one grammar a tap and a click share (D81, D86), meaningful only next to
 * a standing selection: on the word right beside it, the phrase grows by that
 * word; on the selection itself, a knock on a bubble that may have closed.
 * True means the gesture was answered here, and the caller keeps it from
 * meaning anything else - the touch side by `preventDefault`, the mouse side
 * by claiming the release before `reading.js` reads it as a dismissal.
 *
 * Everything else - and everything while nothing is selected - stays free:
 * links keep navigating, underlined phrases keep recalling, empty space keeps
 * dismissing. Selecting itself is not this grammar's job (D81) - that is what
 * the hold and the drag are for.
 *
 * @param {EventTarget | null} target what the press landed on
 * @param {number} x
 * @param {number} y
 * @param {number} slop the asking pointer's margin
 * @returns {boolean} whether the gesture was answered
 */
function answerTap(target, x, y, slop) {
  const geo = geometry;
  const at = span;
  if (hooks === null || geo === null || at === null || range === null) return false;

  if (target instanceof Element && target.closest("a[href]") !== null) return false;

  const word = wordAt(x, y, slop);
  // Not on a word, but on the selection's own boxes - between two selected
  // words, or in the margin around them: the knock.
  if (word === null) {
    if (!withinRects(range, x, y, slop)) return false;
    hooks.onSelected(range, "again");
    return true;
  }

  // A word of another block can never join this phrase (D45) - the press
  // keeps meaning what a press anywhere means.
  if (word.geo.block !== geo.block) return false;

  const beside = besideSpan(at, word.index);
  if (beside === "apart") return false;

  if (beside === "within") {
    hooks.onSelected(range, "again");
    return true;
  }

  const from = beside === "left" ? at.from - 1 : at.from;
  const to = beside === "right" ? at.to + 1 : at.to;
  if (!select(geo, from, to, at.anchor) || range === null) return false;
  hooks.onSelected(range, "extend");
  return true;
}

/**
 * A tap walking the shared grammar. Claiming means `preventDefault`, so an
 * answered tap does not also become the compatibility mouse events that would
 * read it as a dismissal.
 *
 * @param {TouchEvent} event
 * @param {number} x
 * @param {number} y
 */
function tap(event, x, y) {
  if (answerTap(event.target, x, y, GRAB_SLOP)) event.preventDefault();
}

/**
 * Whether this mouse event came from a hand on a mouse. The compatibility
 * events a touch turns into arrive within a beat of it; anything later is the
 * desk's own - a mouse, or a pen with no touch screen to speak through.
 *
 * @returns {boolean}
 */
function realMouse() {
  return performance.now() - touchedAt > COMPAT_MS;
}

/** The mouse gesture and its timer, gone - a click after all, or a lost press. */
function cancelMouse() {
  if (mouse !== null) window.clearTimeout(mouse.timer);
  mouse = null;
}

/**
 * A press ending where no release will say so - the pointer left the window,
 * the window lost focus mid-drag. Answered like a lifted finger: a selection
 * stretched so far gets its bubble, a press that was still nothing becomes
 * nothing.
 */
function endMouse() {
  const active = mouse;
  cancelMouse();
  if (active !== null && active.mode === "select" && range !== null) {
    hooks?.onSelected(range, "press");
  }
}

/**
 * A mouse press on the article arms the same two futures a touch has: the
 * hold's timer toward a word, and travel toward a drag. Nothing is claimed
 * yet - a press that stays put and lifts in time is a click, and clicks
 * belong to everything else this page does.
 *
 * A press on a link stays the link's, clicks and drags alike, for the reason
 * the hold steps around one: a reader whose links stop working is a broken
 * article. macOS's control-click is a context menu, not a press.
 *
 * @param {MouseEvent} event
 */
function onMouseDown(event) {
  if (hooks === null) return;
  // Another button mid-gesture changes nothing, the way a second finger
  // does not: only the first button's presses are this module's to follow.
  if (event.button !== 0 || event.ctrlKey || !realMouse()) return;
  // Whatever was armed before this press lost its release somewhere - a
  // fresh press of the same button is the one sure sign of that.
  cancelMouse();
  if (hooks.owns(event.target)) return;

  const target = event.target;
  if (!(target instanceof Node) || !hooks.root.contains(target)) return;
  if (target instanceof Element && target.closest("a[href]") !== null) return;

  mouse = {
    x: event.clientX,
    y: event.clientY,
    fromX: event.clientX,
    fromY: event.clientY,
    timer: window.setTimeout(mouseHold, HOLD_MS),
    mode: "hold",
  };
}

/**
 * The mouse's hold coming due: the button is still down and has not
 * travelled, so this is the touch hold at the desk - the word under the
 * pointer, taken whole. A press on no word stays armed and quietly remains a
 * click in waiting.
 */
function mouseHold() {
  const active = mouse;
  if (active === null || active.mode !== "hold" || hooks === null) return;

  const word = wordAt(active.x, active.y, MOUSE_SLOP);
  if (word === null) return;

  hooks.onSelectStart();
  if (!select(word.geo, word.index, word.index, word.index)) return;
  active.mode = "select";
}

/**
 * The mouse moving: drift under a waiting hold, the claim of a drag, or the
 * stretch of a claimed one. Travel needs no timer here - a mouse drag is not
 * a scroll and not anything else, so the moment the press has moved like a
 * drag (`madeSelection`, the same four pixels the release would measure), the
 * word it pressed on is taken and the stretch begins. A drag from no word -
 * empty margin, an image - selects nothing, and the press is done meaning
 * things.
 *
 * @param {MouseEvent} event
 */
function onMouseMove(event) {
  const active = mouse;
  if (active === null || hooks === null) return;

  // The button is no longer down: the release happened where this page could
  // not hear it (outside the window, over the browser's own chrome).
  if ((event.buttons & 1) === 0) {
    endMouse();
    return;
  }

  if (active.mode === "hold") {
    const from = { x: active.fromX, y: active.fromY };
    const to = { x: event.clientX, y: event.clientY };
    if (!madeSelection({ from, to, clicks: 1 })) {
      // Drift inside the slop keeps the hold and follows the pointer, so the
      // word the hold takes is the word actually under it when it comes due.
      active.x = event.clientX;
      active.y = event.clientY;
      return;
    }
    const word = wordAt(from.x, from.y, MOUSE_SLOP);
    if (word === null) {
      cancelMouse();
      return;
    }
    hooks.onSelectStart();
    if (!select(word.geo, word.index, word.index, word.index)) {
      cancelMouse();
      return;
    }
    active.mode = "select";
  }

  extendTo(event.clientX, event.clientY);
}

/**
 * The mouse release, handed in by `reading.js` rather than listened for here:
 * the release already has an owner there, deciding between a selection, an
 * underline and a dismissal, and two listeners would each answer half. True
 * claims it - the gesture or the click was this module's, and the caller's
 * own reading must not also run.
 *
 * A drag or a hold ending is the gesture's end, the moment everything is for
 * (the touch side's `touchend`). A plain click walks the tap's grammar, with
 * the mouse's own aim - and a double click still takes a word, the way it
 * does everywhere; only where the grammar has spoken first does the second
 * click of a pair mean the grammar instead (a double click beside the phrase
 * must grow it once and knock, not shrink it to one word).
 *
 * @param {MouseEvent} event
 * @returns {boolean} whether the release was this module's
 */
export function releaseMouse(event) {
  if (hooks === null || event.button !== 0) return false;

  const active = mouse;
  cancelMouse();
  // Only a press this module armed can mean anything here: one that began on
  // the article, first button, no link, no bubble - `onMouseDown` is the
  // gate, and a release without its press is somebody else's click.
  if (active === null) return false;

  if (active.mode === "select") {
    if (range !== null) hooks.onSelected(range, "press");
    return true;
  }

  // A click, then - the press never travelled and the hold never took.
  if (answerTap(event.target, event.clientX, event.clientY, MOUSE_SLOP)) return true;

  if (event.detail >= 2) {
    const target = event.target;
    if (target instanceof Element && target.closest("a[href]") !== null) return false;
    const word = wordAt(event.clientX, event.clientY, MOUSE_SLOP);
    if (word === null) return false;
    hooks.onSelectStart();
    if (!select(word.geo, word.index, word.index, word.index) || range === null) return false;
    hooks.onSelected(range, "press");
    return true;
  }

  return false;
}

/**
 * The window losing focus mid-press: the release will land in another window,
 * so the gesture is answered now, the way a system take-back is on touch.
 */
function onWindowBlur() {
  endMouse();
}

/**
 * The page scrolling is the one signal of a scroll that cannot be missed.
 * The slop check above needs `touchmove` still being delivered, and a
 * browser that has handed the pan to its compositor may stop delivering it -
 * while scroll events keep coming, one per moved frame. So every scroll
 * stamps its time (the gate in `onTouchStart` reads it), and a scroll during
 * an armed hold ends the hold on the spot: the page moving under a waiting
 * finger means this touch is a scroll, whatever its own coordinates said.
 * A claimed selection is deliberately not ended here - its own moves are
 * `preventDefault`-ed, so a scroll arriving then is not this gesture's. The
 * mouse's armed hold ends here too: a wheel turning under a pressed button
 * moves the text under the pointer, and the word the hold would take is no
 * longer the word that was pressed.
 */
function onScroll() {
  scrolledAt = performance.now();
  if (gesture?.mode === "hold") cancelGesture();
  if (mouse?.mode === "hold") cancelMouse();
}

/**
 * The browser's own long-press answer, stepped in front of: on text that
 * refuses selection Firefox for Android can still raise a context menu, and
 * it would land in the middle of the gesture that is already selecting. Only
 * while our gesture holds the claim - a long-press on a link never gets here,
 * because a hold on a link never claims.
 *
 * @param {Event} event
 */
function onContextMenu(event) {
  if (gesture?.mode === "select") event.preventDefault();
}

/**
 * @param {SelectHooks} options
 */
export function startSelect(options) {
  if (started) return;
  started = true;
  hooks = options;
  // The touch listeners are not passive on purpose: claiming the gesture is
  // `preventDefault`, and a passive listener has none to call. Everything
  // else remains one hit-test per event - and the mouse pair less than that
  // at rest, one null check per move while no press is being followed.
  document.addEventListener("touchstart", onTouchStart, { capture: true, passive: false });
  document.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
  document.addEventListener("touchend", onTouchEnd, { capture: true, passive: false });
  document.addEventListener("touchcancel", onTouchCancel, { capture: true, passive: true });
  document.addEventListener("mousedown", onMouseDown, { capture: true, passive: true });
  document.addEventListener("mousemove", onMouseMove, { capture: true, passive: true });
  window.addEventListener("blur", onWindowBlur);
  document.addEventListener("contextmenu", onContextMenu, { capture: true });
  // Capture sees the document's own scrolling; the bubble's inner scrolling
  // stays behind a shadow boundary scroll events do not cross.
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
}

/** Everything taken back: listeners, selection, paint. */
export function stopSelect() {
  if (!started) return;
  started = false;
  document.removeEventListener("touchstart", onTouchStart, { capture: true });
  document.removeEventListener("touchmove", onTouchMove, { capture: true });
  document.removeEventListener("touchend", onTouchEnd, { capture: true });
  document.removeEventListener("touchcancel", onTouchCancel, { capture: true });
  document.removeEventListener("mousedown", onMouseDown, { capture: true });
  document.removeEventListener("mousemove", onMouseMove, { capture: true });
  window.removeEventListener("blur", onWindowBlur);
  document.removeEventListener("contextmenu", onContextMenu, { capture: true });
  document.removeEventListener("scroll", onScroll, { capture: true });
  hooks = null;
  scrolledAt = 0;
  touchedAt = -Infinity;
  cancelGesture();
  cancelMouse();
  clearSelection();
}
