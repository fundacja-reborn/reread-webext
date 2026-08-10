/**
 * Settings, and the promise that a missing settings file is never a reason for
 * the extension not to work: every field has a default, and reading always
 * answers a complete object.
 */

import { webext } from "./browser.js";

/**
 * One key, one object: a versioned shape is easier to migrate than loose keys.
 * Exported because a content script reads the settings and the vocabulary
 * mirror in the same call, and two reads on every page load would be one too
 * many.
 */
export const CONFIG_KEY = "config";

/**
 * @typedef {object} Config
 * @property {string} sourceLang Language being read, BCP-47.
 * @property {string} targetLang Language it is translated into, BCP-47.
 */

/** @type {Readonly<Config>} */
export const DEFAULTS = Object.freeze({
  sourceLang: "en",
  targetLang: "pl",
});

/**
 * Pure half of reading the config, so the rules can be tested without a browser.
 *
 * Unknown keys are dropped and wrong types fall back to the default: stored
 * settings survive downgrades and hand-editing, and nothing downstream has to
 * check what it got.
 *
 * @param {unknown} stored
 * @returns {Config}
 */
export function withDefaults(stored) {
  const source = typeof stored === "object" && stored !== null ? stored : {};
  const raw = /** @type {Record<string, unknown>} */ (source);
  const result = { ...DEFAULTS };

  for (const key of /** @type {(keyof Config)[]} */ (Object.keys(DEFAULTS))) {
    const value = raw[key];
    if (typeof value === "string" && value.length > 0) result[key] = value;
  }

  return result;
}

/**
 * @returns {Promise<Config>}
 */
export async function readConfig() {
  const stored = await webext().storage.local.get(CONFIG_KEY);
  return withDefaults(stored[CONFIG_KEY]);
}

/**
 * @param {Partial<Config>} patch
 * @returns {Promise<Config>}
 */
export async function writeConfig(patch) {
  const next = withDefaults({ ...(await readConfig()), ...patch });
  await webext().storage.local.set({ [CONFIG_KEY]: next });
  return next;
}
