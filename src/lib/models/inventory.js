/**
 * Which language pairs have a model on this device, said where a content
 * script can read it.
 *
 * The model database is reachable from extension pages only, and the launcher
 * bubble on an ordinary page has one question about it: is there anything to
 * translate with, or should the offer say up front that the settings page is
 * where translation starts? Waking the background to ask on every selection
 * would be the cost `<all_urls>` was promised not to incur - so the answer
 * rides `storage.local` the way the vocabulary mirror and the platform do:
 * written by the few places that change it, read in the same call a page
 * already makes for its settings.
 *
 * One writer's rule, shared with the mirror: whoever touched the model store
 * writes the inventory whole, from what the store just said. `putModel` and
 * `deleteModel` do it on their own way out - the settings page is the one
 * place models change, and going through the store is what both of its doors
 * (a download, a folder of files) already do. The background writes it once
 * in `onInstalled`, which is what hands the key to installations that predate
 * it without waiting for the settings page to be opened.
 *
 * A missing key means "nobody has written one yet", and that is not the same
 * thing as "no models": an updated extension has models and no key until the
 * background's reconciliation runs. `needsModelHint` therefore only ever
 * speaks on a written inventory - the hint's job is to help somebody with
 * nothing installed, and saying it to somebody mid-update would be false.
 */

import { webext } from "../browser.js";

/** The key in `storage.local`, next to `config`, `vocabIndex` and `platform`. */
export const MODELS_KEY = "models";

/**
 * @typedef {object} ModelInventory
 * @property {string[]} pairs the stored pair ids, e.g. `"enpl"`
 */

/**
 * The rule that turns a language pair into the store's pair id - one home for
 * the concatenation the engine and the inventory both rely on.
 *
 * @param {string} from
 * @param {string} to
 * @returns {string}
 */
export function modelPair(from, to) {
  return `${from}${to}`;
}

/**
 * @param {{ pair: string }[]} metas what `listModels` answered
 * @returns {ModelInventory}
 */
export function inventoryOf(metas) {
  return { pairs: metas.map((meta) => meta.pair) };
}

/**
 * Narrows whatever was in storage, the mirror's manner: rows that make no
 * sense are dropped, a shape that makes no sense is no inventory at all -
 * and no inventory means nobody has said anything yet, never "no models".
 *
 * @param {unknown} stored
 * @returns {ModelInventory | null}
 */
export function asInventory(stored) {
  if (typeof stored !== "object" || stored === null) return null;
  const pairs = /** @type {Record<string, unknown>} */ (stored)["pairs"];
  if (!Array.isArray(pairs)) return null;
  return { pairs: pairs.filter((one) => typeof one === "string" && one.length > 0) };
}

/**
 * Whether the launcher's offer should add that translation needs a model
 * from the settings page.
 *
 * Only on a written, empty-for-this-pair inventory: no inventory at all is
 * an older background that has not reconciled yet, and about that the only
 * honest thing is silence. With translation switched off the question has
 * dissolved - the reader was chosen for reading, and a hint about models
 * would be the setting talking over the person who set it.
 *
 * @param {Pick<import("../config.js").Config, "sourceLang" | "targetLang" | "translationOff">} config
 * @param {ModelInventory | null} inventory
 * @returns {boolean}
 */
export function needsModelHint(config, inventory) {
  if (config.translationOff) return false;
  if (inventory === null) return false;
  return !inventory.pairs.includes(modelPair(config.sourceLang, config.targetLang));
}

/**
 * @param {{ pair: string }[]} metas what `listModels` answered
 * @returns {Promise<void>}
 */
export async function writeInventory(metas) {
  await webext().storage.local.set({ [MODELS_KEY]: inventoryOf(metas) });
}
