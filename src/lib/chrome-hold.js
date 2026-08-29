/**
 * The bar and its panels held where they stand while a panel is open
 * (D153). The stylesheet sticks the box for as long as the page's scrim
 * shows - and stuck at the window's top, it first slid up by the page's own
 * top padding: a small scroll of an open menu on its way to being stuck
 * (Michał's smoke, 2026-08-29). So the offset it sticks at is its own,
 * measured on the press and handed to the stylesheet as a property: a box
 * at the top of its page holds under the page's padding, one already
 * part-way up the window holds there, and one part-way out of it holds at
 * the edge, whole. Cleared with the last panel, so nothing of the hold
 * outlives it.
 *
 * One home for the three pages that wear the bar - the reader's
 * `.reader-chrome`, the phrases' and the settings' `.page-chrome`.
 */

/**
 * @param {Element | null} box the chrome around the bar and its panels
 * @param {boolean} held whether a panel is open under it
 */
export function holdChrome(box, held) {
  if (!(box instanceof HTMLElement)) return;
  if (!held) {
    box.style.removeProperty("--chrome-hold");
    return;
  }
  // Measured once, when the hold begins: a second panel opening over the
  // first finds the box already held, and must not move it. The measure is
  // taken with the scrim already showing, so the box is stuck by then and
  // the rectangle says where it will stand - its own place, or the edge.
  if (box.style.getPropertyValue("--chrome-hold") !== "") return;
  const top = Math.max(0, Math.round(box.getBoundingClientRect().top));
  box.style.setProperty("--chrome-hold", `${top}px`);
}
