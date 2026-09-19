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
 * or where there is no toolbar at all, the reader says so with a press and the
 * page writes that down.
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
 * What the card shows, from what is stored and what the browser said. Kept
 * apart from the DOM so the rule can be held to examples without a browser:
 * the first step is "something to explain words with", and a model or a
 * dictionary answers it alone - neither is required, and a card that asked
 * for both in turn said something untrue about the one that is optional
 * (Michał, 2026-09-19).
 *
 * @param {{ model: boolean, dictionary: boolean, pinned: boolean | null,
 *   hidden: boolean }} state
 * @returns {{ steps: boolean[], done: number, total: number, show: boolean, open: boolean, intro: boolean }}
 */
export function stepsView(state) {
  const steps = [state.model || state.dictionary, state.pinned === true];
  const done = steps.filter(Boolean).length;
  return {
    steps,
    done,
    total: steps.length,
    // Gone once every step is done, or once it has been put away by hand.
    show: !state.hidden && done < steps.length,
    // Open while the first step is undone; one line once it is.
    open: !steps[0],
    // And the old sentence only where it is true.
    intro: !steps[0],
  };
}
