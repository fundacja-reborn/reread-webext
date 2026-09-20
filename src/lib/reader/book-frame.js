/**
 * What stands around a book's text on screen (D270).
 *
 * A long book is stored and rendered one stretch at a time - an EPUB of a
 * thousand pages in one document would cost every open, every scan and every
 * page table the whole book. That is this extension's housekeeping, and it
 * used to be the reader's business too: every stretch opened on the book's
 * title, its author, the acts on it and a pager saying "Part 2 of 63", with
 * two framed chevrons in the row's corners. Read by pages, those chevrons
 * are exactly what a control for the previous and the next PAGE looks like,
 * and a press on one jumped a quarter of an hour of text (Michał,
 * 2026-09-20: "I fell for it myself"; then, the better idea: "the parts are
 * an internal, artificial division - the reader should see the book as a
 * whole, with its table of contents").
 *
 * So the division is said nowhere. A book opens on its head once, at its
 * beginning, and closes on its ending once, under its last line; between
 * them there is text. Read by pages, a turn past a stretch's last page opens
 * the next one and nothing on the page says a border was crossed. Scrolled,
 * a stretch ends where the window can go no further, so the text is given
 * one quiet step at each end - on with the reading under the last line, back
 * to the earlier text over the first - named for the reading, never for the
 * part. Which of them the layout shows is the stylesheet's say (the paged
 * layout hides both), so that switching the layout needs no redraw; which of
 * them the place in the book allows is said here.
 *
 * @param {{ index: number, count: number }} place the stretch on screen and
 *   how many the book is kept in
 * @returns {{ head: boolean, earlier: boolean, onward: boolean, ending: boolean }}
 *   `head`: the title block, the acts on the book and the language note -
 *   the book's beginning alone; `earlier` and `onward`: the steps to the text
 *   before and after; `ending`: the acts of finishing and the way back to the
 *   list - under the book's last line alone
 */
export function bookFrame({ index, count }) {
  const first = index <= 0;
  const last = index >= count - 1;
  return { head: first, earlier: !first, onward: !last, ending: last };
}
