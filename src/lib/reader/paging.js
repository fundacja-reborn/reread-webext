/**
 * Turning the page with the keyboard, and how far one turn goes.
 *
 * The reader's chrome is stuck over the article while one is on screen (D93):
 * no hiding on scroll, because a bar that moved would flash on an e-ink panel.
 * The browser knows nothing about it, so its own paging - a screenful minus a
 * small overlap - lands the top of the new screen *behind* the bar, and a few
 * lines of every page have to be scrolled back to (reported from a Boox Page,
 * whose hardware page keys send exactly these presses). `scroll-padding-top`
 * is no answer: it is honoured for scrolling something into view, and what a
 * keyboard's paging does with it is not something every engine agrees on.
 *
 * So the reader owns the keys, and the arithmetic and the rule live here,
 * without a DOM, for the reason `keys.js` gives about its own: a shortcut on
 * a page full of text has to say no far more often than yes, and every "no"
 * is somebody else's key.
 */

/** @typedef {"down" | "up"} PageTurn */

/**
 * What a press was aimed at, and what the page it was aimed at was doing.
 *
 * @typedef {object} Press
 * @property {string} key `KeyboardEvent.key`
 * @property {boolean} shift
 * @property {boolean} alt
 * @property {boolean} ctrl
 * @property {boolean} meta
 * @property {string} tag the tag name of what had focus, upper case, or `""`
 * @property {boolean} editable whether what had focus is being typed into
 * @property {boolean} reading whether the voice is reading right now
 * @property {boolean} dialog whether a dialog stands over the article
 */

/**
 * Text being typed into: every key in there is the box's, paging included -
 * a caret pages through the value, and moving the article underneath instead
 * would be this feature reaching into somebody's typing.
 */
const TYPING = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * What the space bar is aimed at when it is aimed at nothing in particular.
 * Anything else with focus - a button, a link, the host of a shadow root the
 * bubble lives in - keeps the key: the space bar is a press there, and only
 * the page's own body means "scroll me". The page keys need no such list;
 * they page whatever else has focus, because they mean nothing to a button.
 */
const PAGE_ITSELF = new Set(["", "BODY", "HTML"]);

/**
 * Which way this press turns the page, or null when the key is not ours.
 *
 * Shift is not in the list of modifiers that rule a press out: shift and the
 * space bar is how a page goes back, which is the pair every browser already
 * has. Alt, Control and Meta are the browser's and the system's.
 *
 * @param {Press} press
 * @returns {PageTurn | null}
 */
export function pageTurn(press) {
  if (press.alt || press.ctrl || press.meta) return null;
  // A dialog over the article - the contents, the search - pages its own
  // list. The article behind it is not what the press is about.
  if (press.dialog) return null;
  if (press.editable || TYPING.has(press.tag)) return null;

  switch (press.key) {
    case "PageDown":
      return "down";
    case "PageUp":
      return "up";
    case " ":
      // While the voice reads, the space bar is the lector's (D87), and the
      // page scrolls itself anyway. The page keys stay ours either way: the
      // voice has no use for them.
      if (press.reading || !PAGE_ITSELF.has(press.tag)) return null;
      return press.shift ? "up" : "down";
    default:
      return null;
  }
}

/**
 * How far one turn moves the page: the readable strip of the window, less one
 * line kept on screen so that nothing falls between two pages.
 *
 * The floor is that one line. A panel left open makes the strip short enough
 * for the subtraction to reach zero, and a press that did nothing at all
 * would read as a dead key.
 *
 * @param {{ top: number, bottom: number }} band the window's readable strip,
 *   in viewport coordinates: under the stuck chrome, above whichever bar
 *   stands at the foot of the window
 * @param {number} overlap one line of the text being read
 * @returns {number} the distance in CSS pixels, always positive
 */
export function pageStep(band, overlap) {
  const height = Math.max(0, band.bottom - band.top);
  return Math.max(overlap, height - overlap);
}
