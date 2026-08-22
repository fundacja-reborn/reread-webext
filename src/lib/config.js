/**
 * Settings, and the promise that a missing settings file is never a reason for
 * the extension not to work: every field has a default, and reading always
 * answers a complete object.
 */

import { webext } from "./browser.js";
import { DEFAULT_MARK_COLOR, isMarkColor } from "./reader/marks.js";
import { DEFAULT_UNDERLINE, isUnderlineWeight } from "./underline.js";

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
 * @property {"active" | "plain"} links Whether links in the article text answer
 *   a press (D95). The words stay either way - they are part of the sentence -
 *   but the reader's main gesture is selecting a phrase to translate, and a
 *   live link under a slightly short hold turns selection into navigation.
 *   `plain` is the default: reading first, the original is one menu row away.
 * @property {import("./reader/marks.js").MarkColor} markerColor What the
 *   highlighter draws in (D106). One global choice rather than a picker per
 *   mark - a pen has one ink at a time, and drawing over a mark repaints it
 *   in the current one. A name, never a value: the stylesheet holds a wash
 *   for each name in each theme. Marks already made keep the colour they
 *   were drawn in; this only says what the next stroke wears.
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
 * @property {boolean} translationOff Whether the translation half of the
 *   extension is switched off - for reading in one's own language, where the
 *   reader and the reading list are the whole point. Presentation only:
 *   nothing stored is deleted, and switching back on restores everything.
 *   Ordinary pages then only ever offer the reader (`pageMode`); the reader's
 *   bubble keeps the speaker and the clipboard and loses the translation.
 *   Named for the off state so the default (`false`) is the extension as it
 *   has always been, and a stored `true` is always a deliberate press.
 * @property {boolean} keepArticles Whether a page opened in the reader is kept
 *   in the offline reading list without being asked (D124). Default `true`:
 *   the reader's whole point is a copy that survives the original moving,
 *   and the Save button was one press between reading a page and having it.
 *   Only ever on the way in, and only when nothing is stored under that
 *   address yet - a stored copy carries the highlights and the reading
 *   position, and writing over it would take both, so reopening a page must
 *   never be what erases them. Live pages only: books and saved articles are
 *   in the list by definition.
 * @property {boolean} hideBubbleActions Whether the translation bubble opens
 *   with its action row folded away, unfolding on a click or tap on the bubble
 *   (D81). Save is the standing exception either way: a phrase that does not
 *   keep itself always shows the way to keep it, and an error its one way out.
 *   Default `false` since D125: what the bubble is for - saving, hearing,
 *   editing - should be visible to somebody meeting it for the first time,
 *   and folding it away is the taste of a reader who already knows it is
 *   there. The fold stays one press away in the popup.
 * @property {Record<string, string>} ttsVoices Which voice reads a language
 *   aloud (D83): source language to the `voiceURI` chosen for it. Per language
 *   rather than per pair - the voice picked for `en` serves every pair read in
 *   English - and no entry means the engine's own default for the language.
 *   The URIs name this device's voices; a stale one is ignored at speak time
 *   (`lib/tts.js`), never an error.
 * @property {number} ttsRate How fast a voice reads, in percent of its own
 *   normal speed (D87). Percent rather than the engine's factor for the reason
 *   `bubbleScale` is one: it is a stepper's value, and an integer survives
 *   storage, hand-editing and `within`'s clamp without a rounding story. One
 *   number for both places a voice speaks - the bubble's phrase and the
 *   reader's article - because how fast a voice is comfortable is a fact about
 *   the person, not about the surface.
 * @property {number} bubbleScale How big the bubble's type is, in percent of
 *   its built-in size (D85). The bubble deliberately ignores the page it
 *   stands on, so no page setting can reach it - this is its one knob, and it
 *   exists because built-in sizes land differently on different screens: an
 *   e-ink tablet can render a CSS pixel visibly smaller than a phone does.
 * @property {import("./underline.js").UnderlineWeight} underline How heavily
 *   a saved phrase is underlined (D130). Not in `reader`, though its dial
 *   sits in the reader's Aa panel: the underline is worn by every page being
 *   read, and `reader` is the reader page's own appearance. A name, never a
 *   measurement - the stylesheet holds a rule per name, because reaching
 *   `::highlight()` with a value would mean setting a property on somebody
 *   else's document.
 */

/** @type {readonly string[]} */
const THEMES = ["auto", "light", "sepia", "dark"];
/** @type {readonly string[]} */
const FONTS = ["serif", "sans"];
/** @type {readonly string[]} */
const LINKS = ["active", "plain"];

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
 * @param {unknown} value
 * @returns {value is ReaderConfig["links"]}
 */
export function isLinks(value) {
  return typeof value === "string" && LINKS.includes(value);
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

/**
 * What the reading-speed stepper can reach, in percent of the voice's normal
 * speed. The floor is half speed - slow enough to follow a language being
 * learned word by word, and the point below which most engines start to slur
 * rather than to slow - and the ceiling is double, where a familiar language
 * still parses and an unfamiliar one long since stopped.
 */
export const TTS_RATE = Object.freeze({ min: 50, max: 200, step: 10 });

/** @type {Readonly<ReaderConfig>} */
export const READER_DEFAULTS = Object.freeze({
  theme: "auto",
  font: "serif",
  fontSize: 18,
  measure: 65,
  links: "plain",
  markerColor: DEFAULT_MARK_COLOR,
});

/** @type {Readonly<Config>} */
export const DEFAULTS = Object.freeze({
  sourceLang: "en",
  targetLang: "pl",
  reader: READER_DEFAULTS,
  disabledHosts: [],
  readerOnly: null,
  translationOff: false,
  keepArticles: true,
  hideBubbleActions: false,
  ttsVoices: {},
  ttsRate: 100,
  bubbleScale: 100,
  underline: DEFAULT_UNDERLINE,
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
    links: isLinks(raw["links"]) ? raw["links"] : READER_DEFAULTS.links,
    markerColor: isMarkColor(raw["markerColor"]) ? raw["markerColor"] : READER_DEFAULTS.markerColor,
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
    translationOff:
      typeof raw["translationOff"] === "boolean" ? raw["translationOff"] : DEFAULTS.translationOff,
    // Default `true`, so it reaches profiles that predate the switch as well
    // as fresh ones: only a stored `false` is somebody having turned it off.
    keepArticles:
      typeof raw["keepArticles"] === "boolean" ? raw["keepArticles"] : DEFAULTS.keepArticles,
    hideBubbleActions:
      typeof raw["hideBubbleActions"] === "boolean" ? raw["hideBubbleActions"] : DEFAULTS.hideBubbleActions,
    ttsVoices: voiceMap(raw["ttsVoices"]),
    ttsRate: within(raw["ttsRate"], TTS_RATE, DEFAULTS.ttsRate),
    bubbleScale: within(raw["bubbleScale"], BUBBLE_SCALE, DEFAULTS.bubbleScale),
    // A name the stylesheet knows, or the line as it has always been drawn:
    // a weight this version never heard of has no rule to paint under, and a
    // registration nothing styles underlines nothing at all.
    underline: isUnderlineWeight(raw["underline"]) ? raw["underline"] : DEFAULTS.underline,
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
 * @param {{ sourceLang?: string, targetLang?: string, reader?: Partial<ReaderConfig>, disabledHosts?: string[], readerOnly?: boolean, translationOff?: boolean, keepArticles?: boolean, hideBubbleActions?: boolean, ttsVoices?: Record<string, string>, ttsRate?: number, bubbleScale?: number, underline?: import("./underline.js").UnderlineWeight }} patch
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
 * Which of its three states a page is in - the whole hierarchy of the content
 * script, with silence at the top: a site switched off in the popup gets
 * nothing at all; with translation off every other page gets the launcher,
 * because the one thing left to offer a selection is the reader (the
 * reader-only question has dissolved - there is no translation in place to
 * choose against); reader-only mode gets the launcher too; and what remains
 * gets the full reading side. Here rather than in the content script so the
 * hierarchy sits under `node --test`.
 *
 * @param {Pick<Config, "disabledHosts" | "readerOnly" | "translationOff">} config
 * @param {string} os as `getPlatformInfo` or `osFrom` names it
 * @param {string} hostname the page's own, exact - the way `disabledHosts` stores them
 * @returns {"off" | "launcher" | "reading"}
 */
export function pageMode(config, os, hostname) {
  if (config.disabledHosts.includes(hostname)) return "off";
  if (config.translationOff) return "launcher";
  if (effectiveReaderOnly(config, os)) return "launcher";
  return "reading";
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
