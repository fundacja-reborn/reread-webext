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
 * @typedef {object} ReaderConfig
 * @property {"auto" | "light" | "sepia" | "dark"} theme `auto` follows the browser.
 * @property {"serif" | "sans"} font
 * @property {number} fontSize In pixels.
 * @property {number} measure Column width in characters.
 */

/**
 * @typedef {object} Config
 * @property {string} sourceLang Language being read, BCP-47.
 * @property {string} targetLang Language it is translated into, BCP-47.
 * @property {ReaderConfig} reader How the reader looks. Nothing else uses it.
 */

/** @type {readonly string[]} */
const THEMES = ["auto", "light", "sepia", "dark"];
/** @type {readonly string[]} */
const FONTS = ["serif", "sans"];

/**
 * Type guards rather than casts, and exported because the reader needs the
 * same question answered: a button carries its value as a string attribute,
 * and this is what turns one back into a setting.
 *
 * @param {unknown} value
 * @returns {value is ReaderConfig["theme"]}
 */
export function isTheme(value) {
  return typeof value === "string" && THEMES.includes(value);
}

/**
 * @param {unknown} value
 * @returns {value is ReaderConfig["font"]}
 */
export function isFont(value) {
  return typeof value === "string" && FONTS.includes(value);
}

/**
 * What the buttons in the reader can reach.
 *
 * The width is in `ch`, the width of a zero in whatever font is set - which is
 * wider than an average letter, so 65 of them hold something like 75 characters
 * of prose. That is the middle of the range typography has agreed on for a
 * century: much below 45 and the eye jumps line to line too often, much above
 * 85 and it loses its place coming back to the left margin.
 */
export const SIZE = Object.freeze({ min: 14, max: 28, step: 1 });
export const MEASURE = Object.freeze({ min: 45, max: 85, step: 5 });

/** @type {Readonly<ReaderConfig>} */
export const READER_DEFAULTS = Object.freeze({
  theme: "auto",
  font: "serif",
  fontSize: 18,
  measure: 65,
});

/** @type {Readonly<Config>} */
export const DEFAULTS = Object.freeze({
  sourceLang: "en",
  targetLang: "pl",
  reader: READER_DEFAULTS,
});

/**
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function text(value, fallback) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/**
 * A number that has to land in a range.
 *
 * Out of range is clamped rather than thrown away, because it says what
 * somebody wanted: a stored 40 from a future version with a wider scale becomes
 * the widest this one has, not the default. Anything that is not a number at
 * all has said nothing, so it gets the default.
 *
 * @param {unknown} value
 * @param {{ min: number, max: number }} range
 * @param {number} fallback
 * @returns {number}
 */
function within(value, range, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

/**
 * @param {unknown} stored
 * @returns {ReaderConfig}
 */
function readerWithDefaults(stored) {
  const raw = /** @type {Record<string, unknown>} */ (
    typeof stored === "object" && stored !== null ? stored : {}
  );

  return {
    theme: isTheme(raw["theme"]) ? raw["theme"] : READER_DEFAULTS.theme,
    font: isFont(raw["font"]) ? raw["font"] : READER_DEFAULTS.font,
    fontSize: within(raw["fontSize"], SIZE, READER_DEFAULTS.fontSize),
    measure: within(raw["measure"], MEASURE, READER_DEFAULTS.measure),
  };
}

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

  return {
    sourceLang: text(raw["sourceLang"], DEFAULTS.sourceLang),
    targetLang: text(raw["targetLang"], DEFAULTS.targetLang),
    reader: readerWithDefaults(raw["reader"]),
  };
}

/**
 * @returns {Promise<Config>}
 */
export async function readConfig() {
  const stored = await webext().storage.local.get(CONFIG_KEY);
  return withDefaults(stored[CONFIG_KEY]);
}

/**
 * `reader` is merged a level deeper than the rest, because that is how it is
 * used: the buttons in the reader change one thing at a time, and a patch of
 * `{ reader: { theme } }` that dropped the type size would be a setting quietly
 * resetting another one.
 *
 * @param {{ sourceLang?: string, targetLang?: string, reader?: Partial<ReaderConfig> }} patch
 * @returns {Promise<Config>}
 */
export async function writeConfig(patch) {
  const current = await readConfig();
  const next = withDefaults({
    ...current,
    ...patch,
    reader: { ...current.reader, ...patch.reader },
  });
  await webext().storage.local.set({ [CONFIG_KEY]: next });
  return next;
}
