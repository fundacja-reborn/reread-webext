/**
 * How heavily a saved phrase is underlined (D130).
 *
 * The mark is deliberately quiet - `content/highlight.css` argues the whole
 * case - but how quiet a dotted rule reads is not a matter of taste alone: an
 * e-ink panel has sixteen greys and rounds a thin one back into the paper,
 * and a phone at three device pixels per CSS pixel loses it another way. So
 * the dial exists, and it is one dial: each step moves the thickness *and*
 * the ink together, because a thicker line in the same faint colour is still
 * faint on the panel that asked for the change.
 *
 * Named steps rather than a number, and a highlight registration of its own
 * per step, because of the one rule this extension is built around: the page
 * being read keeps exactly the DOM its author wrote. A custom property would
 * have to be set on the page's root element to reach `::highlight()`, and
 * that is a mutation of somebody else's document; a stylesheet with a rule
 * per step is not. The script picks which name to paint under, and everything
 * the reader can see is in a file anyone can read.
 */

/** @typedef {"fine" | "medium" | "strong"} UnderlineWeight */

/** In the order the panel offers them, lightest first. */
export const UNDERLINE_WEIGHTS = /** @type {readonly UnderlineWeight[]} */ ([
  "fine",
  "medium",
  "strong",
]);

/**
 * The line as it has always been drawn. A stored setting is always a
 * deliberate press, and a profile from before this existed looks exactly the
 * way it did.
 */
export const DEFAULT_UNDERLINE = "fine";

/**
 * @param {unknown} value
 * @returns {value is UnderlineWeight}
 */
export function isUnderlineWeight(value) {
  return typeof value === "string" && UNDERLINE_WEIGHTS.includes(/** @type {UnderlineWeight} */ (value));
}

/**
 * The highlight registry name a weight paints under. Every one of them must
 * be a name `content/highlight.css` has a rule for - a registration nothing
 * styles paints nothing at all, and `test/underline.test.js` holds the two
 * files to each other.
 *
 * @param {UnderlineWeight} weight
 * @returns {string}
 */
export function underlineName(weight) {
  return `reread-${weight}`;
}

/**
 * Every name the stylesheet knows. What paints takes one; what stops painting
 * takes them all, because the weight can have changed since the last paint
 * and a registration left behind would keep its ranges underlined.
 */
export const UNDERLINE_NAMES = UNDERLINE_WEIGHTS.map(underlineName);
