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

/**
 * Where every page begins.
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
 * @returns {number[]} the top of every page, ascending; one page at least
 */
export function pageTops(blocks, linesOf, height, first) {
  const flow = [];
  for (const [index, box] of blocks.entries()) {
    if (box.bottom - box.top > 0) flow.push({ index, top: box.top, bottom: box.bottom });
  }
  const start = first ?? flow[0]?.top ?? 0;
  if (flow.length === 0 || !(height > 0)) return [start];

  const tops = [start];
  let top = start;
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
