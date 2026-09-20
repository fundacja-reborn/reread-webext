/**
 * The fresh install's three steps, counted from what is actually stored
 * (D254, P6). The card used to be a paragraph saying "nothing translates yet"
 * to somebody who had downloaded a model an hour earlier: it described a state
 * instead of reading one.
 *
 * Two of the three the page can tell by itself - a model on the device (or the
 * switch that says none is wanted), and a dictionary. The third, whether the
 * toolbar button has been pinned, the browser answers where it has the API
 * (Firefox and Chromium both do, `action.getUserSettings`); where it has not,
 * the reader says so with a press and the page writes that down - and where
 * there is no toolbar at all, on a phone or a tablet, the step is not asked
 * (`hasToolbar`).
 *
 * What is written down is the only new thing this round stores: one key of its
 * own beside the settings, never inside them - the shape of `config` is a
 * contract with every version that came before.
 */

import { webext } from "../lib/browser.js";

/** The one new key this round adds, held apart from the settings themselves. */
export const STEPS_KEY = "firstSteps";

/**
 * @typedef {object} StepsState
 * @property {boolean} hidden whether the card has been put away for good
 * @property {boolean} pinned whether the toolbar step was ticked by hand
 */

/** @type {StepsState} */
const NONE = Object.freeze({ hidden: false, pinned: false });

/**
 * @param {unknown} raw
 * @returns {StepsState}
 */
function asState(raw) {
  if (typeof raw !== "object" || raw === null) return NONE;
  const held = /** @type {Record<string, unknown>} */ (raw);
  return {
    hidden: held["hidden"] === true,
    pinned: held["pinned"] === true,
  };
}

/** @returns {Promise<StepsState>} */
export async function readSteps() {
  try {
    const held = await webext().storage.local.get(STEPS_KEY);
    return asState(held[STEPS_KEY]);
  } catch {
    // A card that cannot read its own state shows itself: a signpost nobody
    // asked for is a smaller problem than one that never comes back.
    return NONE;
  }
}

/**
 * @param {Partial<StepsState>} change
 * @returns {Promise<StepsState>}
 */
export async function writeSteps(change) {
  const now = { ...(await readSteps()), ...change };
  try {
    await webext().storage.local.set({ [STEPS_KEY]: now });
  } catch {
    // Nothing to do but leave the card where it is; the press can be repeated.
  }
  return now;
}

/**
 * Whether the toolbar button is pinned, as the browser sees it. Null where the
 * browser will not say - an old engine, or a platform with no toolbar to pin
 * anything to - and then the card asks instead of guessing.
 *
 * @returns {Promise<boolean | null>}
 */
export async function pinnedByBrowser() {
  const action = webext().action;
  if (typeof action?.getUserSettings !== "function") return null;
  try {
    const settings = await action.getUserSettings();
    return typeof settings?.isOnToolbar === "boolean" ? settings.isOnToolbar : null;
  } catch {
    return null;
  }
}

/**
 * Whether this platform has a toolbar to pin the button to. Firefox on
 * Android has none - the button stands in the browser's own menu - and
 * neither has Safari on a phone or a tablet, so the step that asks for it is
 * not a step there at all: it is an errand nobody can run, and it kept the
 * card standing for good (Michał's Boox, 2026-09-19).
 *
 * The same three names `effectiveReaderOnly` knows, for the same reason: no
 * browser has said which of "ios" and "ipados" an iPad answers with.
 *
 * @param {string} os as `getPlatformInfo` names it
 */
export function hasToolbar(os) {
  return os !== "android" && os !== "ios" && os !== "ipados";
}

/**
 * What the card shows, from what is stored and what the browser said. Kept
 * apart from the DOM so the rule can be held to examples without a browser:
 * the first step is "something to explain words with", and a model or a
 * dictionary answers it alone - neither is required, and a card that asked
 * for both in turn said something untrue about the one that is optional
 * (Michał, 2026-09-19).
 *
 * The steps carry their own row's id rather than a place in a list, because
 * how many there are depends on the platform: a phone has no toolbar, and
 * the card there is one step long.
 *
 * @param {{ model: boolean, dictionary: boolean, pinned: boolean | null,
 *   hidden: boolean, toolbar: boolean }} state
 * @returns {{ steps: { id: string, done: boolean }[], done: number,
 *   total: number, show: boolean, open: boolean, intro: boolean }}
 */
export function stepsView(state) {
  const source = state.model || state.dictionary;
  const steps = [
    { id: "step-source", done: source },
    ...(state.toolbar ? [{ id: "step-pin", done: state.pinned === true }] : []),
  ];
  const done = steps.filter((step) => step.done).length;
  return {
    steps,
    done,
    total: steps.length,
    // Gone once every step is done, or once it has been put away by hand.
    show: !state.hidden && done < steps.length,
    // Open while the first step is undone; one line once it is.
    open: !source,
    // And the old sentence only where it is true.
    intro: !source,
  };
}
