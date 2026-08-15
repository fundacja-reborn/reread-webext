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
 * @property {string[]} disabledHosts Sites where re/read stays off. Exact
 *   hostnames - no port, no scheme, no patterns, no subdomain matching. Every
 *   entry is one conscious press of the switch in the toolbar popup, and the
 *   settings page is where the list can be read and emptied.
 * @property {boolean | null} readerOnly Whether ordinary pages only offer the
 *   reader, never a translation in place. `null` means nobody has chosen, and
 *   the platform decides at read time (`effectiveReaderOnly`): on Android on,
 *   elsewhere off. Only a hand-set value is ever stored, so a future change of
 *   the default reaches every installation that never touched the switch.
 * @property {boolean} hideBubbleActions Whether the translation bubble opens
 *   with its action row folded away, unfolding on a click or tap on the bubble
 *   (D81). Save is the standing exception either way: a phrase that does not
 *   keep itself always shows the way to keep it, and an error its one way out.
 * @property {Record<string, string>} ttsVoices Which voice reads a language
 *   aloud (D83): source language to the `voiceURI` chosen for it. Per language
 *   rather than per pair - the voice picked for `en` serves every pair read in
 *   English - and no entry means the engine's own default for the language.
 *   The URIs name this device's voices; a stale one is ignored at speak time
 *   (`lib/tts.js`), never an error.
 * @property {number} bubbleScale How big the bubble's type is, in percent of
 *   its built-in size (D85). The bubble deliberately ignores the page it
 *   stands on, so no page setting can reach it - this is its one knob, and it
 *   exists because built-in sizes land differently on different screens: an
 *   e-ink tablet can render a CSS pixel visibly smaller than a phone does.
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

/**
 * What the bubble-size stepper on the settings page can reach, in percent.
 * The floor keeps the bubble readable at all; the ceiling is double, which
 * already covers the worst honest case measured (an e-ink tablet whose CSS
 * pixel is a quarter smaller than a phone's, D84) with room for eyesight.
 */
export const BUBBLE_SCALE = Object.freeze({ min: 80, max: 200, step: 10 });

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
  disabledHosts: [],
  readerOnly: null,
  hideBubbleActions: true,
  ttsVoices: {},
  bubbleScale: 100,
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
 * The list of switched-off sites, or as much of it as is really a list of
 * hostnames. Anything else in there was hand-edited; keeping the entries that
 * make sense beats losing the list over one of them. Duplicates are folded
 * here, at the door, so no writer has to remember to.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
function hostList(value) {
  if (!Array.isArray(value)) return [];

  /** @type {string[]} */
  const hosts = [];
  for (const one of value) {
    if (typeof one === "string" && one.length > 0 && !hosts.includes(one)) hosts.push(one);
  }
  return hosts;
}

/**
 * The voice map, or as much of it as really maps a language to a voice. Both
 * sides are opaque strings from the platform (a BCP-47ish tag, a `voiceURI`),
 * so the only rule is: strings, non-empty. Whether a voice still exists is
 * not this function's business - the list lives on the device and changes
 * without warning, so existence is checked at speak time, where it can be.
 *
 * @param {unknown} value
 * @returns {Record<string, string>}
 */
function voiceMap(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};

  /** @type {Record<string, string>} */
  const map = {};
  for (const [lang, uri] of Object.entries(value)) {
    if (lang.length > 0 && typeof uri === "string" && uri.length > 0) map[lang] = uri;
  }
  return map;
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
    disabledHosts: hostList(raw["disabledHosts"]),
    // Not a boolean means nobody has chosen - which is a state of its own, not
    // `false`: it is what lets the platform keep deciding (`effectiveReaderOnly`).
    readerOnly: typeof raw["readerOnly"] === "boolean" ? raw["readerOnly"] : null,
    hideBubbleActions:
      typeof raw["hideBubbleActions"] === "boolean" ? raw["hideBubbleActions"] : DEFAULTS.hideBubbleActions,
    ttsVoices: voiceMap(raw["ttsVoices"]),
    bubbleScale: within(raw["bubbleScale"], BUBBLE_SCALE, DEFAULTS.bubbleScale),
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
 * `ttsVoices` is deliberately not: the patch replaces the whole map, because
 * the settings page holds the full map and choosing the default voice has to
 * be able to remove an entry - a per-key merge could only ever add.
 *
 * @param {{ sourceLang?: string, targetLang?: string, reader?: Partial<ReaderConfig>, disabledHosts?: string[], readerOnly?: boolean, hideBubbleActions?: boolean, ttsVoices?: Record<string, string>, bubbleScale?: number }} patch
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

/**
 * Where the background publishes which platform this is, for the one context
 * that cannot ask: content scripts get no `runtime.getPlatformInfo`, and the
 * default of `readerOnly` depends on the answer. A separate key rather than a
 * field of the config, because the config is what somebody chose and this is a
 * fact about the device - and because `withDefaults` drops keys it does not
 * know, so anything smuggled into the config would be erased by the next write.
 */
export const PLATFORM_KEY = "platform";

/**
 * The published platform, read back. Anything that is not a string says the
 * background has not published yet (a fresh install's first page can be faster
 * than `onInstalled`), and an empty answer falls back to the desktop default -
 * wrong for at most the moment it takes the real value to arrive through
 * `storage.onChanged`.
 *
 * @param {unknown} stored value under `PLATFORM_KEY`
 * @returns {string} the OS as `getPlatformInfo` names it, or `""` when unknown
 */
export function osFrom(stored) {
  if (typeof stored !== "object" || stored === null) return "";
  const os = /** @type {Record<string, unknown>} */ (stored)["os"];
  return typeof os === "string" ? os : "";
}

/**
 * The one rule about the mode: a hand-set value wins, and with none the
 * platform decides. On Android the reader is the surface that works on a
 * phone - the bubble and the system's own selection toolbar fight over the
 * same spot - so that is where the default flips.
 *
 * @param {Pick<Config, "readerOnly">} config
 * @param {string} os as `getPlatformInfo` or `osFrom` names it
 * @returns {boolean}
 */
export function effectiveReaderOnly(config, os) {
  return config.readerOnly ?? os === "android";
}

/**
 * Which platform this is, asked directly - for extension pages, which may.
 * Content scripts read `PLATFORM_KEY` instead.
 *
 * @returns {Promise<string>}
 */
export async function platformOs() {
  try {
    const info = await webext().runtime.getPlatformInfo();
    return info.os;
  } catch {
    // No answer reads as the desktop default, which is the harmless direction.
    return "";
  }
}

/**
 * Asks once and writes the answer down for content scripts. The background
 * calls this from `onInstalled` - installs and updates are the only moments
 * the value can be missing, and a write on every wake would fire a storage
 * event at every open tab for a value that never changes.
 *
 * @returns {Promise<void>}
 */
export async function publishPlatform() {
  const os = await platformOs();
  await webext().storage.local.set({ [PLATFORM_KEY]: { os } });
}
