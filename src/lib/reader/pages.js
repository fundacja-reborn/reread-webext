/**
 * The pages of a document laid out as one long column (D233), and where each
 * begins - without a DOM, for the reason `paging.js` gives about its own
 * arithmetic: the rule decides what a reader on an e-ink panel sees at every
 * turn, and every case of it has to run under `node --test`.
 *
 * The document stays the window's scroller (D59). What the paged layout adds
 * is a table of page tops - document coordinates a turn scrolls to, one under
 * the stuck chrome - cut so that a page begins with a whole line and ends
 * with one: a block that fits goes on the page, a block cut by the page's
 * edge is opened into its lines and cut between two of them, and whatever
 * stands past the cut opens the next page. The line cut at the foot of the
 * window is hidden by the curtain (`curtain` below), so no page ever shows
 * half a sentence at either end - what a page of paper does, and what the
 * browser's own paging cannot do (D127, D143: it knows neither the lines nor
 * the bar).
 *
 * Boxes are `{top, bottom}` in document coordinates. The lines of a block are
 * asked for only when the block is cut, because measuring every line of every
 * block is the one cost that grows with the article, and one page cuts one or
 * two blocks.
 */

/** @typedef {{ top: number, bottom: number }} Box */

/**
 * Within a pixel is on the line: rects come back fractional, and a line
 * ending a hair past the page's edge is a line that fits.
 */
const EPS = 1;

/** @typedef {{ index: number, top: number, bottom: number }} Block */

/**
 * Where every page begins.
 *
 * Cut from the document's head by default: page after page down the flow.
 * Given an `anchor` - the top of the page being read, when the band was
 * cut short or long by a bar standing up, the count's footer, the browser's
 * own bar sliding in (D238) - the pages are cut from the anchor both ways:
 * on from it exactly as from the head, and back from it so that the page
 * before ends exactly on it. The page being read keeps its first line
 * whatever the band did, and only its foot moves; a table cut from the head
 * again moved the first line of every page after the change, and on an
 * e-ink panel a moved page is a full refresh and a lost place (Michał's
 * smoke, 2026-09-17: the page began a paragraph earlier once the pen was
 * out). The named artefact: the first page of the part may come up short,
 * the way the last page of a chapter does. An anchor at the head, or past
 * the flow's end, is no anchor.
 *
 * @param {Box[]} blocks the flow's blocks in order, document coordinates;
 *   boxes without height are skipped (a hidden row measures as nothing)
 * @param {(index: number) => Box[]} linesOf the line boxes of one block,
 *   sorted by top - asked only for a block the page's edge cuts; an empty
 *   answer means a block with no lines to cut between (a picture, a rule)
 * @param {number} height the readable band's height - one page's worth
 * @param {number} [first] where the first page begins - what the window
 *   shows under the stuck chrome before anything has scrolled, breathing
 *   room and all; the first block's top when not given
 * @param {number} [anchor] the top of a page to keep - a line's top, or a
 *   block's - from which the table is cut both ways
 * @returns {number[]} the top of every page, ascending; one page at least
 */
export function pageTops(blocks, linesOf, height, first, anchor) {
  /** @type {Block[]} */
  const flow = [];
  for (const [index, box] of blocks.entries()) {
    if (box.bottom - box.top > 0) flow.push({ index, top: box.top, bottom: box.bottom });
  }
  const start = first ?? flow[0]?.top ?? 0;
  if (flow.length === 0 || !(height > 0)) return [start];
  const end = flow[flow.length - 1]?.bottom ?? start;
  if (anchor === undefined || anchor <= start + EPS || anchor >= end - EPS) {
    return pagesOn(flow, linesOf, height, start);
  }
  const back = pagesBack(flow, linesOf, height, anchor, start);
  // The head's page is what is left above the pages cut back - unless the
  // cut reached the first block itself, and the only thing left is the
  // paper above it: then that page is the head's, and nobody is shown a
  // page of margin.
  const highest = back[back.length - 1];
  const head = highest !== undefined && highest <= (flow[0]?.top ?? start) + EPS ? highest : start;
  if (head !== start) back.pop();
  return [head, ...back.reverse(), ...pagesOn(flow, linesOf, height, anchor)];
}

/**
 * The pages from `top` on, `top` itself the first.
 *
 * @param {Block[]} flow
 * @param {(index: number) => Box[]} linesOf
 * @param {number} height
 * @param {number} top
 * @returns {number[]}
 */
function pagesOn(flow, linesOf, height, top) {
  const tops = [top];
  let at = 0;
  // Whatever stands wholly above the first page is not on any page.
  while (at < flow.length && (flow[at]?.bottom ?? 0) <= top + EPS) at += 1;
  for (;;) {
    const limit = top + height;
    // The first block not wholly on this page: cut by the edge, or below it.
    let cut = at;
    while (cut < flow.length && (flow[cut]?.bottom ?? 0) <= limit + EPS) cut += 1;
    const block = flow[cut];
    if (block === undefined) return tops;

    let next;
    if (block.top >= limit - EPS) {
      // The block begins past the edge: it opens the next page whole.
      next = block.top;
    } else {
      const lines = linesOf(block.index);
      const line = lines.find((one) => one.bottom > limit + EPS);
      if (line === undefined) {
        // Every line fits and only the box's own foot runs past the edge - or
        // a block with no lines at all. One that began on this page and would
        // fit on a page of its own moves whole (a picture is never cut in
        // two); one taller than a page, or one that began above this page,
        // is cut at the edge and goes on.
        const fits = block.bottom - block.top <= height + EPS;
        next = lines.length === 0 && fits && block.top > top + EPS ? block.top : limit;
      } else if (line.top <= top + EPS) {
        // The cut line is the page's first - a line taller than the page.
        next = limit;
      } else {
        next = line.top;
      }
    }
    // A page has to move the reading on: whatever the measurement said, the
    // next page begins below this one.
    if (next <= top + EPS) next = limit;
    tops.push(next);
    top = next;
    at = cut;
  }
}

/**
 * The pages above `bottom`, the nearest first: each ends exactly where the
 * one below begins and opens on the earliest line from which everything
 * down to that edge fits the band - the mirror of `pagesOn`, cut upward.
 * Stops above `start`, the head's own page, which takes whatever is left
 * however short it comes up.
 *
 * @param {Block[]} flow
 * @param {(index: number) => Box[]} linesOf
 * @param {number} height
 * @param {number} bottom
 * @param {number} start
 * @returns {number[]} tops, descending
 */
function pagesBack(flow, linesOf, height, bottom, start) {
  /** @type {number[]} */
  const tops = [];
  for (;;) {
    const limit = bottom - height;
    // What is left fits the head's page.
    if (limit <= start + EPS) return tops;
    // The last block not wholly on this page: cut by the edge, or above it.
    let cut = -1;
    while (cut + 1 < flow.length && (flow[cut + 1]?.top ?? Infinity) < limit - EPS) cut += 1;
    const block = flow[cut];
    // The block after it is the first that may open this page whole - if it
    // stands above the edge at all.
    const after = flow[cut + 1];
    const opener = after !== undefined && after.top < bottom - EPS ? after.top : null;

    let top;
    if (block === undefined) {
      // No block begins above the edge: the page opens with the flow's
      // first, and the paper above that is nobody's page.
      top = opener ?? limit;
    } else if (block.bottom <= limit + EPS) {
      // The block ends above the edge: the page opens with the next one.
      top = opener ?? limit;
    } else {
      const lines = linesOf(block.index);
      const line = lines.find((one) => one.top >= limit - EPS);
      if (line === undefined) {
        // Every line stands above the edge and only the box's own foot
        // reaches past it - or a block with no lines. One that fits a page
        // moves whole onto the page before, and this page opens with the
        // next block; one taller than a page is cut at the edge.
        const fits = block.bottom - block.top <= height + EPS;
        top = (lines.length > 0 || fits) && opener !== null ? opener : limit;
      } else if (line.bottom >= bottom - EPS) {
        // The line found is the page's last and only - taller than the page.
        top = limit;
      } else {
        top = line.top;
      }
    }
    // A page has to reach back: whatever the measurement said, this page
    // begins above the one below it.
    if (top >= bottom - EPS) top = limit;
    if (top <= start + EPS) return tops;
    tops.push(top);
    bottom = top;
  }
}

/**
 * The page a document coordinate falls on: the last page beginning at or
 * above it. Before the first page is the first page.
 *
 * @param {number[]} tops
 * @param {number} y
 * @returns {number}
 */
export function pageAt(tops, y) {
  let page = 0;
  for (const [index, top] of tops.entries()) {
    if (top <= y + EPS) page = index;
    else break;
  }
  return page;
}

/**
 * The page a turn lands on, or null when there is no page that way - which
 * is the caller's cue to turn the part of a book instead. `first` and `last`
 * are the ends of the table, and always land.
 *
 * @param {number[]} tops
 * @param {number} page the page on screen
 * @param {import("./paging.js").PageTurn} turn
 * @returns {number | null}
 */
export function turnTarget(tops, page, turn) {
  if (turn === "first") return 0;
  if (turn === "last") return tops.length - 1;
  const next = turn === "down" ? page + 1 : page - 1;
  return next < 0 || next >= tops.length ? null : next;
}

/**
 * How far above the next page's top the curtain begins. A line's top comes
 * back fractional, and the browser paints a fixed box on whole device pixels:
 * a curtain laid exactly on the line's top was snapped half a pixel down and
 * left the line's anti-aliased first row showing as a faint dotted seam
 * over the footer (Michał's screenshots from Chrome, 2026-09-17). Two pixels
 * reach nothing but leading: the previous line's glyphs end at least a
 * heading's half-leading (three and a half pixels) above the next line's
 * glyph box, and a block's top stands its own half-leading above its first
 * glyphs.
 */
export const CURTAIN_OVERLAP = 2;

/**
 * Where the curtain begins, in window coordinates: a little above where the
 * next page begins (`CURTAIN_OVERLAP`), covering the lines and the pictures
 * the browser would still show under the page's last whole line - the
 * curtain itself runs down to the window's foot, under the footer. Null for
 * the last page, which ends where the document does, and when the next page
 * begins under the footer anyway.
 *
 * @param {number[]} tops
 * @param {number} page the page on screen
 * @param {number} scrollY
 * @param {number} floor where the footer (or a bar) begins, window coordinates
 * @returns {number | null}
 */
export function curtainTop(tops, page, scrollY, floor) {
  const next = tops[page + 1];
  if (next === undefined) return null;
  const top = next - scrollY - CURTAIN_OVERLAP;
  return top >= floor ? null : top;
}

/**
 * Whether the window stands on a page: within a pixel of where a turn to that
 * page would have scrolled it. A page is shown off its top by the bubble's
 * own scrolling (D97, D138) or by a scroll the browser made itself, and then
 * the curtain would cover the wrong lines.
 *
 * @param {number} scrollY
 * @param {number} pageTop the page's top, document coordinates
 * @param {number} fold the lower edge of the stuck chrome
 * @returns {boolean}
 */
export function onPage(scrollY, pageTop, fold) {
  return Math.abs(scrollY - Math.max(0, pageTop - fold)) <= EPS;
}

/**
 * The page to turn to so that a sentence being read stays on screen - or
 * null to stay where the window is, because a line of the sentence already
 * stands on the page shown. A sentence straddling the page's head is read
 * from its start while its head stays behind the curtain: the voice begins
 * a page with the first sentence any part of which is visible, and turning
 * back for its first line turned every such page back (Michał's smoke,
 * 2026-09-17). A sentence with no line on the page - the one that opens
 * the next page, or one far away after a skip - turns to the page its first
 * line stands on. Nothing to measure is nowhere to go.
 *
 * The word being spoken asks with `onward`: a word on a later page - the
 * tail of a long sentence under the foot's curtain - turns the page on, so
 * the reader follows the voice, but a word on an earlier page never turns it
 * back: it belongs to the sentence read from its start behind the head's
 * curtain, and the same smoke's second round watched every such page turn
 * back on its first word.
 *
 * @param {number[]} tops
 * @param {number} page the page on screen
 * @param {number[]} lines the tops of the sentence's or the word's lines,
 *   document coordinates, in reading order
 * @param {boolean} [onward] whether only a page further on may be turned to
 * @returns {number | null}
 */
export function revealTarget(tops, page, lines, onward = false) {
  const first = lines[0];
  if (first === undefined) return null;
  const top = tops[page] ?? 0;
  const next = tops[page + 1] ?? Number.POSITIVE_INFINITY;
  if (lines.some((line) => line >= top - EPS && line < next - EPS)) return null;
  const target = pageAt(tops, first);
  return onward && target < page ? null : target;
}

/**
 * Which way a tap turns the page: the left third of the window turns back,
 * the right third turns on, and the middle - where a thumb rests, and where
 * a tap is most likely aimed at a word - turns nothing. The reading edge is
 * the right one on purpose even in a right-to-left text: a page turns the
 * way the book is held, and the convention every e-reader settled on is the
 * right side for onward.
 *
 * @param {number} x the tap, window coordinates
 * @param {number} width the window's width
 * @returns {import("./paging.js").PageTurn | null}
 */
export function tapZone(x, width) {
  if (!(width > 0) || x < 0 || x > width) return null;
  if (x < width / 3) return "up";
  if (x > (width * 2) / 3) return "down";
  return null;
}

/**
 * What a pointer did between landing and lifting, and where - everything the
 * rules below need to tell a tap meant to turn the page from the hand that
 * is holding the device (D250).
 *
 * The zones stay thirds: narrowing them does not help, because the thumb
 * holding a phone with slim bezels touches the very edge rather than a third
 * of the width, and a narrower zone only makes a deliberate tap harder to
 * land. What tells the two apart is the signature: a resting thumb lies on
 * the glass for seconds, slides, spreads a wide contact, lands within the
 * bezel's reach and usually beside a second finger; a tap is brief, still,
 * small and alone.
 *
 * @typedef {object} TapSignature
 * @property {string} pointerType as `PointerEvent` names it
 * @property {number} downAt when the pointer landed
 * @property {number} upAt when it lifted
 * @property {number} dx how far it travelled before lifting
 * @property {number} dy
 * @property {number | null} width the contact's size, or null when the
 *   device's own numbers say nothing (`blobTrusted`)
 * @property {number | null} height
 * @property {number} x where it landed, window coordinates - what the zone
 *   and the dead strips are read from, because that is the point the hand
 *   chose
 * @property {number} y
 * @property {number} viewportW the window
 * @property {number} viewportH
 * @property {number[]} otherPointers when the other pointers of the moment
 *   landed - a grip puts two contacts down together
 */

/**
 * How long a contact may last and still be a tap. A thumb holding the device
 * lies there for as long as the reading does, so this one test takes most of
 * the accidents. Just under the hold that starts a selection (`HOLD_MS`, 400
 * in `content/select.js`, which is Android's own long-press timing): a
 * contact that nearly became a hold was not a tap either way. The cost,
 * deliberately paid: no "tap and hold to fly through pages", which does not
 * exist here anyway.
 */
export const TAP_HOLD_MS = 350;

/**
 * How far a tap may travel. A grip's contact slides; a tap barely moves. A
 * shade under what the gesture module lets a tap roll as it lifts
 * (`TAP_SLOP`, 10): turning the page is a bigger thing to do by mistake
 * than selecting a word, so it asks for a little more certainty.
 */
export const TAP_DRIFT = 8;

/**
 * How wide a contact may be. A thumb laid on its side reports 35-50 CSS
 * pixels, a fingertip 15-25. Never the only reason to refuse a turn - a
 * large thumb tapping deliberately must still turn the page - which is why
 * it stands beside the tests above rather than in front of them, and why it
 * is skipped entirely on a device whose numbers mean nothing (`blobTrusted`).
 */
export const TAP_BLOB = 28;

/**
 * How close to the window's top edge a tap is taken for a finger that came
 * in from behind the bezel rather than one aimed at the page. The other
 * three edges stand further in (below).
 */
export const TAP_EDGE = 8;

/**
 * The dead strips: down each side, where the bezel is and where a hand
 * wraps, and along the foot, where the thumb holding a phone rests. Nobody
 * aims at the last two dozen pixels of the screen, so the strips cost a
 * deliberate tap nothing - and the corners, where an accidental contact
 * gathers, stop turning pages.
 */
export const TAP_DEAD_SIDE = 24;
export const TAP_DEAD_FOOT = 40;

/**
 * How close together two contacts have to land to be one grip. A thumb that
 * has been resting for seconds is not this - it must not block a deliberate
 * tap - but a second contact arriving with this one is a hand shifting its
 * hold, never a page being turned.
 */
export const TAP_ALONE_MS = 100;

/**
 * Whether a pointer could be asking for a turn at all: the pen never turns
 * a page - it is the highlighter's, and every tap with it in hand is the
 * marker's - and a contact that landed beside another is a grip.
 *
 * @param {TapSignature} tap
 * @returns {boolean}
 */
function meansToTurn(tap) {
  if (tap.pointerType === "pen") return false;
  return !tap.otherPointers.some((at) => Math.abs(at - tap.downAt) <= TAP_ALONE_MS);
}

/**
 * Which way a tap turns the page, or null - the whole signature, not the
 * position alone (D250). Every test has to pass; the order is cheapest
 * first, and each of them is one line of the table in `planning/
 * reread-przewracanie-input-i-sygnal.md`.
 *
 * @param {TapSignature} tap
 * @returns {import("./paging.js").PageTurn | null}
 */
export function tapIntent(tap) {
  if (!meansToTurn(tap)) return null;
  // The strips, and the window's own top edge with them.
  if (tap.x < TAP_DEAD_SIDE || tap.x > tap.viewportW - TAP_DEAD_SIDE) return null;
  if (tap.y < TAP_EDGE || tap.y > tap.viewportH - TAP_DEAD_FOOT) return null;
  if (tap.upAt - tap.downAt >= TAP_HOLD_MS) return null;
  if (Math.hypot(tap.dx, tap.dy) >= TAP_DRIFT) return null;
  const blob = Math.max(tap.width ?? 0, tap.height ?? 0);
  if (blob >= TAP_BLOB) return null;
  return tapZone(tap.x, tap.viewportW);
}

/**
 * How far sideways a swipe has to travel to turn the page, and how much
 * more sideways than up or down it has to be. A gesture that has to move is
 * the one input a resting hand cannot make by accident, which is why it is
 * the default where a hand wraps around the screen (`effectiveTouchTurn`).
 */
export const SWIPE_MIN = 40;
export const SWIPE_AXIS = 2;

/**
 * Which way a swipe turns the page, or null. Leftward turns on, the way the
 * right-hand zone does and the way a page of paper goes; no hold, no time
 * limit - a gesture that held first belongs to the selection, which claims
 * it before this is ever asked.
 *
 * @param {TapSignature} tap
 * @returns {import("./paging.js").PageTurn | null}
 */
export function swipeIntent(tap) {
  if (!meansToTurn(tap)) return null;
  if (Math.abs(tap.dx) < SWIPE_MIN) return null;
  if (Math.abs(tap.dx) <= SWIPE_AXIS * Math.abs(tap.dy)) return null;
  return tap.dx < 0 ? "down" : "up";
}

/** How many contacts are measured before the blob test is trusted or dropped. */
export const BLOB_SAMPLES = 6;

/**
 * Whether a device's contact sizes say anything. `PointerEvent.width` and
 * `height` are optional in practice: some devices answer 0, some answer 1,
 * some answer the same constant to every touch there ever was. A test read
 * off a constant refuses nothing or refuses everything, so it is measured
 * first and dropped for the whole session if the numbers are flat.
 *
 * Only real touches are measured - a mouse reports a single pixel by
 * definition, and counting it would drop the test on every device with both.
 *
 * @param {number[]} samples the larger of width and height, one per touch
 * @returns {boolean}
 */
export function blobTrusted(samples) {
  if (samples.length < BLOB_SAMPLES) return false;
  if (samples.every((one) => one <= 1)) return false;
  return new Set(samples).size > 1;
}

/**
 * How far a wheel's notches have to be apart to be two turns. A trackpad
 * sends a burst of small deltas for one flick, and a page a notch would be a
 * chapter a flick.
 */
export const WHEEL_COOLDOWN_MS = 250;

/**
 * The turn a wheel event asks for, or null: nothing for a sideways scroll or
 * a zoom chord, and nothing within the cooldown of the last turn. The caller
 * remembers when it last turned.
 *
 * @param {{ deltaX: number, deltaY: number, ctrl: boolean }} wheel
 * @param {number} now
 * @param {number} lastTurnAt
 * @returns {import("./paging.js").PageTurn | null}
 */
export function wheelTurn(wheel, now, lastTurnAt) {
  if (wheel.ctrl || wheel.deltaY === 0 || Math.abs(wheel.deltaX) > Math.abs(wheel.deltaY)) return null;
  if (now - lastTurnAt < WHEEL_COOLDOWN_MS) return null;
  return wheel.deltaY > 0 ? "down" : "up";
}

/**
 * How far the reading has reached, in whole percent, when the reading goes
 * by pages: the page on screen counts as read - the scroll mode's own
 * reading of the bottom edge (`position.js`), said in pages.
 *
 * @param {number} page
 * @param {number} count
 * @returns {number}
 */
export function pagePercent(page, count) {
  if (!(count > 0)) return 0;
  return Math.min(100, Math.max(0, Math.round(((page + 1) / count) * 100)));
}

/**
 * The page turned from the window's edge while a range is being stretched
 * (D239): a finger dragging a selection, a handle or the pen's stroke to
 * the foot of the page turns it under the finger and goes on, the way
 * Kindle, Apple Books and KOReader turn theirs. Nothing turns at once - a
 * finger grazing the edge to take the last line must not lose the page:
 * the first turn after a stay this long in the zone, the next ones this
 * far apart while the pointer stays. An e-ink panel needs the time to
 * refresh, and the eye to find the new page. Starting values, to be tuned
 * on the panel.
 */
export const EDGE_TURN_FIRST_MS = 700;
export const EDGE_TURN_REPEAT_MS = 1200;

/**
 * How tall the edge zones are at the least: the foot's zone is everything
 * below the page's last full line - the curtain, the margin, the foot's
 * strip, a bar - which can be next to nothing when the last line ends on
 * the margin, and the head's zone is the chrome and this much of the band.
 */
export const EDGE_ZONE_MIN = 24;

/** @typedef {"down" | "up"} EdgeZone */

/**
 * The edge zone a pointer stands in, or null. Dead at the part's ends -
 * the range cannot leave the part, whose next page is another document.
 *
 * @param {number} y the pointer, window coordinates
 * @param {number} head where the page's first line stands
 * @param {number} foot where the page's last full line ends - the
 *   curtain's edge, or the band's foot
 * @param {number} bottom the window's foot
 * @param {{ up: boolean, down: boolean }} turns whether there is a page that way
 * @returns {EdgeZone | null}
 */
export function edgeZone(y, head, foot, bottom, turns) {
  if (y >= Math.min(foot, bottom - EDGE_ZONE_MIN)) return turns.down ? "down" : null;
  if (y < head + EDGE_ZONE_MIN) return turns.up ? "up" : null;
  return null;
}

/**
 * Whether the stay in a zone has earned a turn: the first after
 * `EDGE_TURN_FIRST_MS` in the zone, each next one `EDGE_TURN_REPEAT_MS`
 * after the last. The caller keeps the clocks; leaving the zone resets
 * them by starting a new stay.
 *
 * @param {EdgeZone | null} zone
 * @param {number} enteredAt when the stay began
 * @param {number | null} turnedAt when the stay last turned, or null
 * @param {number} now
 * @returns {boolean}
 */
export function edgeTurn(zone, enteredAt, turnedAt, now) {
  if (zone === null) return false;
  return turnedAt === null ? now - enteredAt >= EDGE_TURN_FIRST_MS : now - turnedAt >= EDGE_TURN_REPEAT_MS;
}

/**
 * Why the window is being moved to another page (D251). A turn asked for by
 * the hand - a key, the wheel, a tap, a swipe - is the one the reader has to
 * notice; the rest are the reader's own machinery going somewhere, and a
 * machine announcing itself is noise.
 *
 * @typedef {"turn" | "jump" | "speech" | "drag"} TurnReason
 */

/**
 * How long the band stands in ink before the new page is uncovered, and how
 * far apart two flashes have to be. The gap is a brake on the hardware keys
 * of an e-reader, which repeat while they are held: a series of full-band
 * inversions faster than three a second is flicker in the sense of WCAG
 * 2.3.1, and half a second holds us well under it. It is also what keeps a
 * reader flipping through pages from watching a strobe.
 */
export const FLASH_HOLD_MS = 150;
export const FLASH_GAP_MS = 500;

/**
 * Whether a turn may flash the band (D251).
 *
 * Not while the voice reads - a flash at every turn of a page nobody is
 * looking at is a refresh a minute for nothing; not while a range is being
 * stretched across the page's edge (D239), where a black band under the
 * finger in the middle of a selection says less than it costs; not for a
 * jump, which is not a page being turned at all; and not within `minGap` of
 * the last one.
 *
 * @param {TurnReason} reason
 * @param {number} lastFlashAt
 * @param {number} now
 * @param {number} [minGap]
 * @returns {boolean}
 */
export function flashAllowed(reason, lastFlashAt, now, minGap = FLASH_GAP_MS) {
  if (reason !== "turn") return false;
  return now - lastFlashAt >= minGap;
}

/**
 * How a turn moves the window (D251): instantly, as every movement in the
 * reader has been until now; smoothly, which shows the direction on a screen
 * that can draw motion; or behind a flash of the band, which is the one
 * extra frame an e-ink panel draws well - the signal Kindle and Kobo turn
 * their pages with, and the reason a reader looking at the middle of a page
 * knows it has changed at all.
 *
 * Only a turn from the hand is dressed either way. A jump - a search hit, a
 * heading, the reading position restored - is a landing somewhere else, and
 * a smooth scroll through half an article is slow and sickening; the voice
 * and a stretched range have their own reasons above.
 *
 * @param {object} how
 * @param {"smooth" | "flash" | "off"} how.effect the setting - what to do is
 *   the reader's own choice now, not the theme's (D251, Michał's call
 *   2026-09-19): the flash is for the panel it is drawn well on, and the
 *   theme is only a look, which somebody may wear on glass
 * @param {boolean} how.reduced whether the system asked for less motion -
 *   which takes the flash as well as the scroll: a band going black and
 *   back is motion, whatever draws it
 * @param {TurnReason} how.reason
 * @param {number} how.lastFlashAt
 * @param {number} how.now
 * @returns {"instant" | "smooth" | "flash"}
 */
export function turnMotion(how) {
  if (how.effect === "off" || how.reduced || how.reason !== "turn") return "instant";
  if (how.effect === "flash") return flashAllowed(how.reason, how.lastFlashAt, how.now) ? "flash" : "instant";
  return "smooth";
}
