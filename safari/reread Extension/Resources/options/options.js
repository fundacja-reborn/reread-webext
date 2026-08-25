"use strict";
(() => {
  // src/lib/browser.js
  function webext() {
    const api = globalThis.browser ?? globalThis.chrome;
    if (!api?.runtime?.id) {
      throw new Error("re/read: no WebExtension API in this context");
    }
    return api;
  }

  // src/lib/reader/marks.js
  var MARK_COLORS = Object.freeze(["yellow", "green", "blue", "pink"]);
  var DEFAULT_MARK_COLOR = "yellow";
  function isMarkColor(value) {
    return typeof value === "string" && MARK_COLORS.includes(
      /** @type {MarkColor} */
      value
    );
  }

  // src/lib/underline.js
  var UNDERLINE_WEIGHTS = (
    /** @type {readonly UnderlineWeight[]} */
    [
      "fine",
      "medium",
      "strong"
    ]
  );
  var DEFAULT_UNDERLINE = "medium";
  function isUnderlineWeight(value) {
    return typeof value === "string" && UNDERLINE_WEIGHTS.includes(
      /** @type {UnderlineWeight} */
      value
    );
  }
  function underlineName(weight) {
    return `reread-${weight}`;
  }
  var UNDERLINE_NAMES = UNDERLINE_WEIGHTS.map(underlineName);

  // src/lib/config.js
  var CONFIG_KEY = "config";
  var THEMES = ["auto", "light", "sepia", "dark"];
  var FONTS = ["serif", "sans"];
  var LINKS = ["active", "plain"];
  function isTheme(value) {
    return typeof value === "string" && THEMES.includes(value);
  }
  function isFont(value) {
    return typeof value === "string" && FONTS.includes(value);
  }
  function isLinks(value) {
    return typeof value === "string" && LINKS.includes(value);
  }
  var SIZE = Object.freeze({ min: 14, max: 28, step: 1 });
  var MEASURE = Object.freeze({ min: 45, max: 85, step: 5 });
  var BUBBLE_SCALE = Object.freeze({ min: 80, max: 200, step: 10 });
  var TTS_RATE = Object.freeze({ min: 50, max: 200, step: 10 });
  var READER_DEFAULTS = Object.freeze({
    theme: "auto",
    font: "serif",
    fontSize: 18,
    measure: 65,
    links: "plain",
    markerColor: DEFAULT_MARK_COLOR
  });
  var DEFAULTS = Object.freeze({
    sourceLang: null,
    targetLang: null,
    reader: READER_DEFAULTS,
    disabledHosts: [],
    readerOnly: null,
    translationOff: false,
    keepArticles: true,
    hideBubbleActions: false,
    ttsVoices: {},
    ttsRate: 100,
    bubbleScale: 100,
    underline: DEFAULT_UNDERLINE
  });
  function within(value, range, fallback) {
    if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
    return Math.min(range.max, Math.max(range.min, Math.round(value)));
  }
  function hostList(value) {
    if (!Array.isArray(value)) return [];
    const hosts = [];
    for (const one of value) {
      if (typeof one === "string" && one.length > 0 && !hosts.includes(one)) hosts.push(one);
    }
    return hosts;
  }
  function voiceMap(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    const map = {};
    for (const [lang, uri] of Object.entries(value)) {
      if (lang.length > 0 && typeof uri === "string" && uri.length > 0) map[lang] = uri;
    }
    return map;
  }
  function readerWithDefaults(stored) {
    const raw = (
      /** @type {Record<string, unknown>} */
      typeof stored === "object" && stored !== null ? stored : {}
    );
    return {
      theme: isTheme(raw["theme"]) ? raw["theme"] : READER_DEFAULTS.theme,
      font: isFont(raw["font"]) ? raw["font"] : READER_DEFAULTS.font,
      fontSize: within(raw["fontSize"], SIZE, READER_DEFAULTS.fontSize),
      measure: within(raw["measure"], MEASURE, READER_DEFAULTS.measure),
      links: isLinks(raw["links"]) ? raw["links"] : READER_DEFAULTS.links,
      markerColor: isMarkColor(raw["markerColor"]) ? raw["markerColor"] : READER_DEFAULTS.markerColor
    };
  }
  function withDefaults(stored) {
    const source = typeof stored === "object" && stored !== null ? stored : {};
    const raw = (
      /** @type {Record<string, unknown>} */
      source
    );
    return {
      // A pair only ever exists whole: one leg stored without the other (a
      // hand-edited file) is no choice, and half a pair downstream would be a
      // translation into nowhere. Existing installations read as chosen - their
      // stored strings were written by `writeConfig`, and for the profiles that
      // predate this rule that is the honest reading available.
      sourceLang: typeof raw["sourceLang"] === "string" && raw["sourceLang"].length > 0 && typeof raw["targetLang"] === "string" && raw["targetLang"].length > 0 ? raw["sourceLang"] : null,
      targetLang: typeof raw["sourceLang"] === "string" && raw["sourceLang"].length > 0 && typeof raw["targetLang"] === "string" && raw["targetLang"].length > 0 ? raw["targetLang"] : null,
      reader: readerWithDefaults(raw["reader"]),
      disabledHosts: hostList(raw["disabledHosts"]),
      // Not a boolean means nobody has chosen - which is a state of its own, not
      // `false`: it is what lets the platform keep deciding (`effectiveReaderOnly`).
      readerOnly: typeof raw["readerOnly"] === "boolean" ? raw["readerOnly"] : null,
      translationOff: typeof raw["translationOff"] === "boolean" ? raw["translationOff"] : DEFAULTS.translationOff,
      // Default `true`, so it reaches profiles that predate the switch as well
      // as fresh ones: only a stored `false` is somebody having turned it off.
      keepArticles: typeof raw["keepArticles"] === "boolean" ? raw["keepArticles"] : DEFAULTS.keepArticles,
      hideBubbleActions: typeof raw["hideBubbleActions"] === "boolean" ? raw["hideBubbleActions"] : DEFAULTS.hideBubbleActions,
      ttsVoices: voiceMap(raw["ttsVoices"]),
      ttsRate: within(raw["ttsRate"], TTS_RATE, DEFAULTS.ttsRate),
      bubbleScale: within(raw["bubbleScale"], BUBBLE_SCALE, DEFAULTS.bubbleScale),
      // A name the stylesheet knows, or the line as it has always been drawn:
      // a weight this version never heard of has no rule to paint under, and a
      // registration nothing styles underlines nothing at all.
      underline: isUnderlineWeight(raw["underline"]) ? raw["underline"] : DEFAULTS.underline
    };
  }
  async function readConfig() {
    const stored = await webext().storage.local.get(CONFIG_KEY);
    return withDefaults(stored[CONFIG_KEY]);
  }
  async function writeConfig(patch) {
    const current = await readConfig();
    const next = withDefaults({
      ...current,
      ...patch,
      reader: { ...current.reader, ...patch.reader }
    });
    await webext().storage.local.set({ [CONFIG_KEY]: next });
    return next;
  }
  function effectiveReaderOnly(config2, os2) {
    return config2.readerOnly ?? os2 === "android";
  }
  async function platformOs() {
    try {
      const info = await webext().runtime.getPlatformInfo();
      return info.os;
    } catch {
      return "";
    }
  }

  // src/lib/appearance.js
  function applyTheme(root, theme) {
    root.dataset["readerTheme"] = theme;
  }
  function followTheme() {
    const root = document.documentElement;
    const apply = () => void readConfig().then((config2) => applyTheme(root, config2.reader.theme));
    webext().storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || changes[CONFIG_KEY] === void 0) return;
      apply();
    });
    apply();
  }

  // src/lib/i18n.js
  var LOCALE_KEY = "locale_code";
  var locale = null;
  function t(key, substitutions) {
    try {
      return webext().i18n.getMessage(key, substitutions);
    } catch {
      return "";
    }
  }
  function uiLocale() {
    if (locale === null) {
      const declared = t(LOCALE_KEY);
      locale = declared.length > 0 ? declared : "en";
    }
    return locale;
  }
  function plural(count, base, rest = []) {
    const substitutions = [count.toLocaleString(), ...rest];
    const category = new Intl.PluralRules(uiLocale()).select(count);
    const exact = category === "other" ? "" : t(`${base}_${category}`, substitutions);
    return exact.length > 0 ? exact : t(`${base}_other`, substitutions);
  }
  function aside(detail) {
    return detail === void 0 || detail.length === 0 ? "" : ` (${detail})`;
  }
  function localizePage() {
    document.documentElement.lang = uiLocale();
    for (const element2 of document.querySelectorAll("[data-i18n]")) {
      const text = t(element2.getAttribute("data-i18n") ?? "");
      if (text.length > 0) element2.textContent = text;
    }
    const attributes = (
      /** @type {const} */
      [
        ["title", "data-i18n-title"],
        ["placeholder", "data-i18n-placeholder"],
        ["aria-label", "data-i18n-aria-label"]
      ]
    );
    for (const [attribute, marker] of attributes) {
      for (const element2 of document.querySelectorAll(`[${marker}]`)) {
        const text = t(element2.getAttribute(marker) ?? "");
        if (text.length > 0) element2.setAttribute(attribute, text);
      }
    }
  }

  // src/lib/protocol.js
  var Message = Object.freeze({
    TRANSLATE: "translate",
    OPEN_READER: "open-reader",
    OPEN_LIBRARY: "open-library",
    OPEN_MARKS: "open-marks",
    OPEN_VOCABULARY: "open-vocabulary",
    OPEN_SETTINGS: "open-settings",
    SAVE_PHRASE: "save-phrase",
    FORGET_PHRASE: "forget-phrase",
    LIST_PHRASES: "list-phrases",
    IMPORT_PHRASES: "import-phrases",
    READ_PAGE: "read-page",
    GRAB_PAGE: "grab-page",
    PAGE_INFO: "page-info"
  });
  var ErrorCode = Object.freeze({
    /** No translation engine is bundled yet (the state before M1 lands). */
    ENGINE_MISSING: "engine_missing",
    /** The engine is there, the model for this language pair is not. */
    MODEL_MISSING: "model_missing",
    /** No model exists for this pair at all. */
    UNSUPPORTED_PAIR: "unsupported_pair",
    /** Longer than the tooltip is meant for - a page, not a phrase. */
    TOO_LONG: "too_long",
    /**
     * There is nothing for the reader to take: the tab it was pointed at is gone,
     * or it is a page no content script runs in - `about:`, the PDF viewer, the
     * add-ons site. Not an error in the sense of something being broken.
     */
    NO_PAGE: "no_page",
    /** A request the background does not know. Reaching a user means a bug. */
    UNKNOWN_MESSAGE: "unknown_message",
    /** Anything that got as far as an exception. */
    INTERNAL: "internal"
  });

  // src/lib/own-tabs.js
  async function tabsShowing(url, ask) {
    try {
      const query = ask ?? (() => webext().runtime.getContexts?.({ contextTypes: ["TAB"] }));
      const views = await query();
      if (!Array.isArray(views)) return null;
      const tabs = [];
      for (const view of views) {
        if (typeof view !== "object" || view === null) continue;
        const { documentUrl, tabId } = (
          /** @type {Record<string, unknown>} */
          view
        );
        if (typeof documentUrl !== "string" || !documentUrl.startsWith(url)) continue;
        if (typeof tabId === "number" && tabId >= 0) tabs.push(tabId);
      }
      return tabs;
    } catch {
      return null;
    }
  }

  // src/lib/session.js
  var BACK_ROAD_KEY = "reread.backRoad";

  // src/lib/back-arrow.js
  var READER_PAGE = "reader/reader.html";
  function walkedHere() {
    try {
      return sessionStorage.getItem(BACK_ROAD_KEY) !== null;
    } catch {
      return false;
    }
  }
  async function readerTab() {
    const seen = await tabsShowing(webext().runtime.getURL(READER_PAGE), void 0);
    return seen !== null && seen.length > 0 ? seen[0] ?? null : null;
  }
  async function focusTab(tabId) {
    let tab;
    try {
      tab = await webext().tabs.update(tabId, { active: true });
    } catch {
      return false;
    }
    if (typeof tab.windowId === "number") {
      try {
        await webext().windows.update(tab.windowId, { focused: true });
      } catch {
      }
    }
    return true;
  }
  async function toReading() {
    const tab = await readerTab();
    if (tab !== null && await focusTab(tab)) return;
    await webext().runtime.sendMessage({ kind: Message.OPEN_LIBRARY }).catch(() => void 0);
  }
  function armBackArrow() {
    const button = document.getElementById("back");
    if (button === null) return;
    if (walkedHere()) {
      button.hidden = false;
      button.addEventListener("click", () => history.back());
      return;
    }
    button.addEventListener("click", () => void toReading());
    const reveal = () => void readerTab().then((tab) => {
      button.hidden = tab === null;
    });
    reveal();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") reveal();
    });
  }

  // src/lib/language.js
  var names = null;
  function languageName(code) {
    names ??= new Intl.DisplayNames([uiLocale()], { type: "language" });
    try {
      return names.of(code.replace(/_/g, "-")) ?? code;
    } catch {
      return code;
    }
  }
  function pairLabel(from, to) {
    return t("pair_label", [languageName(from), languageName(to)]);
  }

  // src/lib/dict/catalog.json
  var catalog_default = {
    comment: "Generated by tools/wikdict-catalog.mjs - the list of dictionaries the settings page offers to download, one entry per WikDict archive. No checksums on purpose: WikDict rebuilds its files in place, so a sum pinned here would break with every rebuild; see src/lib/dict/download.js for what stands guard instead.",
    source: "https://download.wikdict.com/dictionaries/stardict/",
    checkedAt: "2026-08-12",
    dictionaries: [
      {
        from: "bg",
        to: "en",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-bg-en.zip"
      },
      {
        from: "ca",
        to: "bg",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ca-bg.zip"
      },
      {
        from: "ca",
        to: "cs",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ca-cs.zip"
      },
      {
        from: "ca",
        to: "da",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ca-da.zip"
      },
      {
        from: "ca",
        to: "de",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ca-de.zip"
      },
      {
        from: "ca",
        to: "el",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ca-el.zip"
      },
      {
        from: "ca",
        to: "en",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ca-en.zip"
      },
      {
        from: "ca",
        to: "es",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ca-es.zip"
      },
      {
        from: "ca",
        to: "fi",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ca-fi.zip"
      },
      {
        from: "ca",
        to: "fr",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ca-fr.zip"
      },
      {
        from: "ca",
        to: "ga",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ca-ga.zip"
      },
      {
        from: "ca",
        to: "id",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ca-id.zip"
      },
      {
        from: "ca",
        to: "it",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ca-it.zip"
      },
      {
        from: "ca",
        to: "ja",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ca-ja.zip"
      },
      {
        from: "ca",
        to: "la",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ca-la.zip"
      },
      {
        from: "ca",
        to: "lt",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ca-lt.zip"
      },
      {
        from: "ca",
        to: "nl",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ca-nl.zip"
      },
      {
        from: "ca",
        to: "no",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ca-no.zip"
      },
      {
        from: "ca",
        to: "pl",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ca-pl.zip"
      },
      {
        from: "ca",
        to: "pt",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ca-pt.zip"
      },
      {
        from: "ca",
        to: "ru",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ca-ru.zip"
      },
      {
        from: "ca",
        to: "sv",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ca-sv.zip"
      },
      {
        from: "ca",
        to: "tr",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ca-tr.zip"
      },
      {
        from: "cs",
        to: "bg",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-cs-bg.zip"
      },
      {
        from: "cs",
        to: "ca",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-cs-ca.zip"
      },
      {
        from: "cs",
        to: "da",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-cs-da.zip"
      },
      {
        from: "cs",
        to: "de",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-cs-de.zip"
      },
      {
        from: "cs",
        to: "el",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-cs-el.zip"
      },
      {
        from: "cs",
        to: "en",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-cs-en.zip"
      },
      {
        from: "cs",
        to: "es",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-cs-es.zip"
      },
      {
        from: "cs",
        to: "fi",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-cs-fi.zip"
      },
      {
        from: "cs",
        to: "fr",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-cs-fr.zip"
      },
      {
        from: "cs",
        to: "ga",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-cs-ga.zip"
      },
      {
        from: "cs",
        to: "id",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-cs-id.zip"
      },
      {
        from: "cs",
        to: "it",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-cs-it.zip"
      },
      {
        from: "cs",
        to: "ja",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-cs-ja.zip"
      },
      {
        from: "cs",
        to: "la",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-cs-la.zip"
      },
      {
        from: "cs",
        to: "lt",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-cs-lt.zip"
      },
      {
        from: "cs",
        to: "nl",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-cs-nl.zip"
      },
      {
        from: "cs",
        to: "no",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-cs-no.zip"
      },
      {
        from: "cs",
        to: "pl",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-cs-pl.zip"
      },
      {
        from: "cs",
        to: "pt",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-cs-pt.zip"
      },
      {
        from: "cs",
        to: "ru",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-cs-ru.zip"
      },
      {
        from: "cs",
        to: "sv",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-cs-sv.zip"
      },
      {
        from: "cs",
        to: "tr",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-cs-tr.zip"
      },
      {
        from: "cs",
        to: "zh",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-cs-zh.zip"
      },
      {
        from: "da",
        to: "bg",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-da-bg.zip"
      },
      {
        from: "da",
        to: "ca",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-da-ca.zip"
      },
      {
        from: "da",
        to: "cs",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-da-cs.zip"
      },
      {
        from: "da",
        to: "de",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-da-de.zip"
      },
      {
        from: "da",
        to: "el",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-da-el.zip"
      },
      {
        from: "da",
        to: "en",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-da-en.zip"
      },
      {
        from: "da",
        to: "es",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-da-es.zip"
      },
      {
        from: "da",
        to: "fi",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-da-fi.zip"
      },
      {
        from: "da",
        to: "fr",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-da-fr.zip"
      },
      {
        from: "da",
        to: "it",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-da-it.zip"
      },
      {
        from: "da",
        to: "ja",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-da-ja.zip"
      },
      {
        from: "da",
        to: "pl",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-da-pl.zip"
      },
      {
        from: "da",
        to: "pt",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-da-pt.zip"
      },
      {
        from: "da",
        to: "ru",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-da-ru.zip"
      },
      {
        from: "da",
        to: "sv",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-da-sv.zip"
      },
      {
        from: "da",
        to: "tr",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-da-tr.zip"
      },
      {
        from: "de",
        to: "bg",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-de-bg.zip"
      },
      {
        from: "de",
        to: "ca",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-de-ca.zip"
      },
      {
        from: "de",
        to: "cs",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-de-cs.zip"
      },
      {
        from: "de",
        to: "da",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-de-da.zip"
      },
      {
        from: "de",
        to: "el",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-de-el.zip"
      },
      {
        from: "de",
        to: "en",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-de-en.zip"
      },
      {
        from: "de",
        to: "es",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-de-es.zip"
      },
      {
        from: "de",
        to: "fi",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-de-fi.zip"
      },
      {
        from: "de",
        to: "fr",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-de-fr.zip"
      },
      {
        from: "de",
        to: "ga",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-de-ga.zip"
      },
      {
        from: "de",
        to: "id",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-de-id.zip"
      },
      {
        from: "de",
        to: "it",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-de-it.zip"
      },
      {
        from: "de",
        to: "ja",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-de-ja.zip"
      },
      {
        from: "de",
        to: "ku",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-de-ku.zip"
      },
      {
        from: "de",
        to: "la",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-de-la.zip"
      },
      {
        from: "de",
        to: "lt",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-de-lt.zip"
      },
      {
        from: "de",
        to: "mg",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-de-mg.zip"
      },
      {
        from: "de",
        to: "nl",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-de-nl.zip"
      },
      {
        from: "de",
        to: "no",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-de-no.zip"
      },
      {
        from: "de",
        to: "pl",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-de-pl.zip"
      },
      {
        from: "de",
        to: "pt",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-de-pt.zip"
      },
      {
        from: "de",
        to: "ru",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-de-ru.zip"
      },
      {
        from: "de",
        to: "sv",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-de-sv.zip"
      },
      {
        from: "de",
        to: "tr",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-de-tr.zip"
      },
      {
        from: "de",
        to: "zh",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-de-zh.zip"
      },
      {
        from: "el",
        to: "bg",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-el-bg.zip"
      },
      {
        from: "el",
        to: "ca",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-el-ca.zip"
      },
      {
        from: "el",
        to: "cs",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-el-cs.zip"
      },
      {
        from: "el",
        to: "da",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-el-da.zip"
      },
      {
        from: "el",
        to: "de",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-el-de.zip"
      },
      {
        from: "el",
        to: "en",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-el-en.zip"
      },
      {
        from: "el",
        to: "es",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-el-es.zip"
      },
      {
        from: "el",
        to: "fi",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-el-fi.zip"
      },
      {
        from: "el",
        to: "fr",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-el-fr.zip"
      },
      {
        from: "el",
        to: "ga",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-el-ga.zip"
      },
      {
        from: "el",
        to: "id",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-el-id.zip"
      },
      {
        from: "el",
        to: "it",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-el-it.zip"
      },
      {
        from: "el",
        to: "ja",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-el-ja.zip"
      },
      {
        from: "el",
        to: "la",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-el-la.zip"
      },
      {
        from: "el",
        to: "lt",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-el-lt.zip"
      },
      {
        from: "el",
        to: "nl",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-el-nl.zip"
      },
      {
        from: "el",
        to: "no",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-el-no.zip"
      },
      {
        from: "el",
        to: "pl",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-el-pl.zip"
      },
      {
        from: "el",
        to: "pt",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-el-pt.zip"
      },
      {
        from: "el",
        to: "ru",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-el-ru.zip"
      },
      {
        from: "el",
        to: "sv",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-el-sv.zip"
      },
      {
        from: "el",
        to: "tr",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-el-tr.zip"
      },
      {
        from: "el",
        to: "zh",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-el-zh.zip"
      },
      {
        from: "en",
        to: "bg",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-en-bg.zip"
      },
      {
        from: "en",
        to: "ca",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-en-ca.zip"
      },
      {
        from: "en",
        to: "cs",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-en-cs.zip"
      },
      {
        from: "en",
        to: "da",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-en-da.zip"
      },
      {
        from: "en",
        to: "de",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-en-de.zip"
      },
      {
        from: "en",
        to: "el",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-en-el.zip"
      },
      {
        from: "en",
        to: "es",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-en-es.zip"
      },
      {
        from: "en",
        to: "fi",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-en-fi.zip"
      },
      {
        from: "en",
        to: "fr",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-en-fr.zip"
      },
      {
        from: "en",
        to: "ga",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-en-ga.zip"
      },
      {
        from: "en",
        to: "id",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-en-id.zip"
      },
      {
        from: "en",
        to: "it",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-en-it.zip"
      },
      {
        from: "en",
        to: "ja",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-en-ja.zip"
      },
      {
        from: "en",
        to: "ku",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-en-ku.zip"
      },
      {
        from: "en",
        to: "la",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-en-la.zip"
      },
      {
        from: "en",
        to: "lt",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-en-lt.zip"
      },
      {
        from: "en",
        to: "nl",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-en-nl.zip"
      },
      {
        from: "en",
        to: "no",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-en-no.zip"
      },
      {
        from: "en",
        to: "pl",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-en-pl.zip"
      },
      {
        from: "en",
        to: "pt",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-en-pt.zip"
      },
      {
        from: "en",
        to: "ru",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-en-ru.zip"
      },
      {
        from: "en",
        to: "sv",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-en-sv.zip"
      },
      {
        from: "en",
        to: "tr",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-en-tr.zip"
      },
      {
        from: "en",
        to: "zh",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-en-zh.zip"
      },
      {
        from: "es",
        to: "bg",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-es-bg.zip"
      },
      {
        from: "es",
        to: "ca",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-es-ca.zip"
      },
      {
        from: "es",
        to: "cs",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-es-cs.zip"
      },
      {
        from: "es",
        to: "da",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-es-da.zip"
      },
      {
        from: "es",
        to: "de",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-es-de.zip"
      },
      {
        from: "es",
        to: "el",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-es-el.zip"
      },
      {
        from: "es",
        to: "en",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-es-en.zip"
      },
      {
        from: "es",
        to: "fi",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-es-fi.zip"
      },
      {
        from: "es",
        to: "fr",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-es-fr.zip"
      },
      {
        from: "es",
        to: "ga",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-es-ga.zip"
      },
      {
        from: "es",
        to: "id",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-es-id.zip"
      },
      {
        from: "es",
        to: "it",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-es-it.zip"
      },
      {
        from: "es",
        to: "ja",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-es-ja.zip"
      },
      {
        from: "es",
        to: "la",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-es-la.zip"
      },
      {
        from: "es",
        to: "lt",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-es-lt.zip"
      },
      {
        from: "es",
        to: "nl",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-es-nl.zip"
      },
      {
        from: "es",
        to: "no",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-es-no.zip"
      },
      {
        from: "es",
        to: "pl",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-es-pl.zip"
      },
      {
        from: "es",
        to: "pt",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-es-pt.zip"
      },
      {
        from: "es",
        to: "ru",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-es-ru.zip"
      },
      {
        from: "es",
        to: "sv",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-es-sv.zip"
      },
      {
        from: "es",
        to: "tr",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-es-tr.zip"
      },
      {
        from: "es",
        to: "zh",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-es-zh.zip"
      },
      {
        from: "fi",
        to: "bg",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fi-bg.zip"
      },
      {
        from: "fi",
        to: "ca",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fi-ca.zip"
      },
      {
        from: "fi",
        to: "cs",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fi-cs.zip"
      },
      {
        from: "fi",
        to: "da",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fi-da.zip"
      },
      {
        from: "fi",
        to: "de",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fi-de.zip"
      },
      {
        from: "fi",
        to: "el",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fi-el.zip"
      },
      {
        from: "fi",
        to: "en",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fi-en.zip"
      },
      {
        from: "fi",
        to: "es",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fi-es.zip"
      },
      {
        from: "fi",
        to: "fr",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fi-fr.zip"
      },
      {
        from: "fi",
        to: "ga",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fi-ga.zip"
      },
      {
        from: "fi",
        to: "id",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fi-id.zip"
      },
      {
        from: "fi",
        to: "it",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fi-it.zip"
      },
      {
        from: "fi",
        to: "ja",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fi-ja.zip"
      },
      {
        from: "fi",
        to: "la",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fi-la.zip"
      },
      {
        from: "fi",
        to: "lt",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fi-lt.zip"
      },
      {
        from: "fi",
        to: "nl",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fi-nl.zip"
      },
      {
        from: "fi",
        to: "no",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fi-no.zip"
      },
      {
        from: "fi",
        to: "pl",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fi-pl.zip"
      },
      {
        from: "fi",
        to: "pt",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fi-pt.zip"
      },
      {
        from: "fi",
        to: "ru",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fi-ru.zip"
      },
      {
        from: "fi",
        to: "sv",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fi-sv.zip"
      },
      {
        from: "fi",
        to: "tr",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fi-tr.zip"
      },
      {
        from: "fi",
        to: "zh",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fi-zh.zip"
      },
      {
        from: "fr",
        to: "bg",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fr-bg.zip"
      },
      {
        from: "fr",
        to: "ca",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fr-ca.zip"
      },
      {
        from: "fr",
        to: "cs",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fr-cs.zip"
      },
      {
        from: "fr",
        to: "da",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fr-da.zip"
      },
      {
        from: "fr",
        to: "de",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fr-de.zip"
      },
      {
        from: "fr",
        to: "el",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fr-el.zip"
      },
      {
        from: "fr",
        to: "en",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fr-en.zip"
      },
      {
        from: "fr",
        to: "es",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fr-es.zip"
      },
      {
        from: "fr",
        to: "fi",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fr-fi.zip"
      },
      {
        from: "fr",
        to: "ga",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fr-ga.zip"
      },
      {
        from: "fr",
        to: "id",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fr-id.zip"
      },
      {
        from: "fr",
        to: "it",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fr-it.zip"
      },
      {
        from: "fr",
        to: "ja",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fr-ja.zip"
      },
      {
        from: "fr",
        to: "la",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fr-la.zip"
      },
      {
        from: "fr",
        to: "lt",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fr-lt.zip"
      },
      {
        from: "fr",
        to: "nl",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fr-nl.zip"
      },
      {
        from: "fr",
        to: "no",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fr-no.zip"
      },
      {
        from: "fr",
        to: "pl",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fr-pl.zip"
      },
      {
        from: "fr",
        to: "pt",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fr-pt.zip"
      },
      {
        from: "fr",
        to: "ru",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fr-ru.zip"
      },
      {
        from: "fr",
        to: "sv",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fr-sv.zip"
      },
      {
        from: "fr",
        to: "tr",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fr-tr.zip"
      },
      {
        from: "fr",
        to: "zh",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-fr-zh.zip"
      },
      {
        from: "it",
        to: "bg",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-it-bg.zip"
      },
      {
        from: "it",
        to: "ca",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-it-ca.zip"
      },
      {
        from: "it",
        to: "cs",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-it-cs.zip"
      },
      {
        from: "it",
        to: "da",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-it-da.zip"
      },
      {
        from: "it",
        to: "de",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-it-de.zip"
      },
      {
        from: "it",
        to: "el",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-it-el.zip"
      },
      {
        from: "it",
        to: "en",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-it-en.zip"
      },
      {
        from: "it",
        to: "es",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-it-es.zip"
      },
      {
        from: "it",
        to: "fi",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-it-fi.zip"
      },
      {
        from: "it",
        to: "fr",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-it-fr.zip"
      },
      {
        from: "it",
        to: "ga",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-it-ga.zip"
      },
      {
        from: "it",
        to: "id",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-it-id.zip"
      },
      {
        from: "it",
        to: "ja",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-it-ja.zip"
      },
      {
        from: "it",
        to: "la",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-it-la.zip"
      },
      {
        from: "it",
        to: "lt",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-it-lt.zip"
      },
      {
        from: "it",
        to: "nl",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-it-nl.zip"
      },
      {
        from: "it",
        to: "no",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-it-no.zip"
      },
      {
        from: "it",
        to: "pl",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-it-pl.zip"
      },
      {
        from: "it",
        to: "pt",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-it-pt.zip"
      },
      {
        from: "it",
        to: "ru",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-it-ru.zip"
      },
      {
        from: "it",
        to: "sv",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-it-sv.zip"
      },
      {
        from: "it",
        to: "tr",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-it-tr.zip"
      },
      {
        from: "ja",
        to: "bg",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ja-bg.zip"
      },
      {
        from: "ja",
        to: "da",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ja-da.zip"
      },
      {
        from: "ja",
        to: "de",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ja-de.zip"
      },
      {
        from: "ja",
        to: "en",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ja-en.zip"
      },
      {
        from: "ja",
        to: "es",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ja-es.zip"
      },
      {
        from: "ja",
        to: "fi",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ja-fi.zip"
      },
      {
        from: "ja",
        to: "fr",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ja-fr.zip"
      },
      {
        from: "ja",
        to: "ga",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ja-ga.zip"
      },
      {
        from: "ja",
        to: "id",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ja-id.zip"
      },
      {
        from: "ja",
        to: "it",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ja-it.zip"
      },
      {
        from: "ja",
        to: "la",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ja-la.zip"
      },
      {
        from: "ja",
        to: "nl",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ja-nl.zip"
      },
      {
        from: "ja",
        to: "pl",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ja-pl.zip"
      },
      {
        from: "ja",
        to: "pt",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ja-pt.zip"
      },
      {
        from: "ja",
        to: "ru",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ja-ru.zip"
      },
      {
        from: "ja",
        to: "sv",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ja-sv.zip"
      },
      {
        from: "ja",
        to: "tr",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ja-tr.zip"
      },
      {
        from: "ja",
        to: "zh",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ja-zh.zip"
      },
      {
        from: "ku",
        to: "de",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ku-de.zip"
      },
      {
        from: "ku",
        to: "en",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ku-en.zip"
      },
      {
        from: "ku",
        to: "es",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ku-es.zip"
      },
      {
        from: "ku",
        to: "fi",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ku-fi.zip"
      },
      {
        from: "ku",
        to: "fr",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ku-fr.zip"
      },
      {
        from: "ku",
        to: "it",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ku-it.zip"
      },
      {
        from: "ku",
        to: "nl",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ku-nl.zip"
      },
      {
        from: "ku",
        to: "pt",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ku-pt.zip"
      },
      {
        from: "ku",
        to: "ru",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ku-ru.zip"
      },
      {
        from: "ku",
        to: "sv",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ku-sv.zip"
      },
      {
        from: "ku",
        to: "tr",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ku-tr.zip"
      },
      {
        from: "ku",
        to: "zh",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ku-zh.zip"
      },
      {
        from: "nl",
        to: "bg",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-nl-bg.zip"
      },
      {
        from: "nl",
        to: "ca",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-nl-ca.zip"
      },
      {
        from: "nl",
        to: "cs",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-nl-cs.zip"
      },
      {
        from: "nl",
        to: "da",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-nl-da.zip"
      },
      {
        from: "nl",
        to: "de",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-nl-de.zip"
      },
      {
        from: "nl",
        to: "el",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-nl-el.zip"
      },
      {
        from: "nl",
        to: "en",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-nl-en.zip"
      },
      {
        from: "nl",
        to: "es",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-nl-es.zip"
      },
      {
        from: "nl",
        to: "fi",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-nl-fi.zip"
      },
      {
        from: "nl",
        to: "fr",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-nl-fr.zip"
      },
      {
        from: "nl",
        to: "ga",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-nl-ga.zip"
      },
      {
        from: "nl",
        to: "id",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-nl-id.zip"
      },
      {
        from: "nl",
        to: "it",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-nl-it.zip"
      },
      {
        from: "nl",
        to: "ja",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-nl-ja.zip"
      },
      {
        from: "nl",
        to: "la",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-nl-la.zip"
      },
      {
        from: "nl",
        to: "lt",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-nl-lt.zip"
      },
      {
        from: "nl",
        to: "no",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-nl-no.zip"
      },
      {
        from: "nl",
        to: "pl",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-nl-pl.zip"
      },
      {
        from: "nl",
        to: "pt",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-nl-pt.zip"
      },
      {
        from: "nl",
        to: "ru",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-nl-ru.zip"
      },
      {
        from: "nl",
        to: "sv",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-nl-sv.zip"
      },
      {
        from: "nl",
        to: "tr",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-nl-tr.zip"
      },
      {
        from: "nl",
        to: "zh",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-nl-zh.zip"
      },
      {
        from: "no",
        to: "bg",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-no-bg.zip"
      },
      {
        from: "no",
        to: "ca",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-no-ca.zip"
      },
      {
        from: "no",
        to: "cs",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-no-cs.zip"
      },
      {
        from: "no",
        to: "da",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-no-da.zip"
      },
      {
        from: "no",
        to: "de",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-no-de.zip"
      },
      {
        from: "no",
        to: "el",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-no-el.zip"
      },
      {
        from: "no",
        to: "en",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-no-en.zip"
      },
      {
        from: "no",
        to: "fi",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-no-fi.zip"
      },
      {
        from: "no",
        to: "fr",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-no-fr.zip"
      },
      {
        from: "no",
        to: "ga",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-no-ga.zip"
      },
      {
        from: "no",
        to: "id",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-no-id.zip"
      },
      {
        from: "no",
        to: "it",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-no-it.zip"
      },
      {
        from: "no",
        to: "ja",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-no-ja.zip"
      },
      {
        from: "no",
        to: "la",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-no-la.zip"
      },
      {
        from: "no",
        to: "nl",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-no-nl.zip"
      },
      {
        from: "no",
        to: "pl",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-no-pl.zip"
      },
      {
        from: "no",
        to: "pt",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-no-pt.zip"
      },
      {
        from: "no",
        to: "ru",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-no-ru.zip"
      },
      {
        from: "no",
        to: "sv",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-no-sv.zip"
      },
      {
        from: "no",
        to: "tr",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-no-tr.zip"
      },
      {
        from: "pl",
        to: "bg",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pl-bg.zip"
      },
      {
        from: "pl",
        to: "ca",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pl-ca.zip"
      },
      {
        from: "pl",
        to: "cs",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pl-cs.zip"
      },
      {
        from: "pl",
        to: "da",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pl-da.zip"
      },
      {
        from: "pl",
        to: "de",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pl-de.zip"
      },
      {
        from: "pl",
        to: "el",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pl-el.zip"
      },
      {
        from: "pl",
        to: "en",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pl-en.zip"
      },
      {
        from: "pl",
        to: "es",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pl-es.zip"
      },
      {
        from: "pl",
        to: "fi",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pl-fi.zip"
      },
      {
        from: "pl",
        to: "fr",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pl-fr.zip"
      },
      {
        from: "pl",
        to: "ga",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pl-ga.zip"
      },
      {
        from: "pl",
        to: "id",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pl-id.zip"
      },
      {
        from: "pl",
        to: "it",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pl-it.zip"
      },
      {
        from: "pl",
        to: "ja",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pl-ja.zip"
      },
      {
        from: "pl",
        to: "la",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pl-la.zip"
      },
      {
        from: "pl",
        to: "lt",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pl-lt.zip"
      },
      {
        from: "pl",
        to: "nl",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pl-nl.zip"
      },
      {
        from: "pl",
        to: "no",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pl-no.zip"
      },
      {
        from: "pl",
        to: "pt",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pl-pt.zip"
      },
      {
        from: "pl",
        to: "ru",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pl-ru.zip"
      },
      {
        from: "pl",
        to: "sv",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pl-sv.zip"
      },
      {
        from: "pl",
        to: "tr",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pl-tr.zip"
      },
      {
        from: "pl",
        to: "zh",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pl-zh.zip"
      },
      {
        from: "pt",
        to: "bg",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pt-bg.zip"
      },
      {
        from: "pt",
        to: "ca",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pt-ca.zip"
      },
      {
        from: "pt",
        to: "cs",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pt-cs.zip"
      },
      {
        from: "pt",
        to: "da",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pt-da.zip"
      },
      {
        from: "pt",
        to: "de",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pt-de.zip"
      },
      {
        from: "pt",
        to: "el",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pt-el.zip"
      },
      {
        from: "pt",
        to: "en",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pt-en.zip"
      },
      {
        from: "pt",
        to: "es",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pt-es.zip"
      },
      {
        from: "pt",
        to: "fi",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pt-fi.zip"
      },
      {
        from: "pt",
        to: "fr",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pt-fr.zip"
      },
      {
        from: "pt",
        to: "ga",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pt-ga.zip"
      },
      {
        from: "pt",
        to: "id",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pt-id.zip"
      },
      {
        from: "pt",
        to: "it",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pt-it.zip"
      },
      {
        from: "pt",
        to: "ja",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pt-ja.zip"
      },
      {
        from: "pt",
        to: "la",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pt-la.zip"
      },
      {
        from: "pt",
        to: "nl",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pt-nl.zip"
      },
      {
        from: "pt",
        to: "no",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pt-no.zip"
      },
      {
        from: "pt",
        to: "pl",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pt-pl.zip"
      },
      {
        from: "pt",
        to: "ru",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pt-ru.zip"
      },
      {
        from: "pt",
        to: "sv",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pt-sv.zip"
      },
      {
        from: "pt",
        to: "tr",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-pt-tr.zip"
      },
      {
        from: "ru",
        to: "bg",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ru-bg.zip"
      },
      {
        from: "ru",
        to: "ca",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ru-ca.zip"
      },
      {
        from: "ru",
        to: "cs",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ru-cs.zip"
      },
      {
        from: "ru",
        to: "da",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ru-da.zip"
      },
      {
        from: "ru",
        to: "de",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ru-de.zip"
      },
      {
        from: "ru",
        to: "el",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ru-el.zip"
      },
      {
        from: "ru",
        to: "en",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ru-en.zip"
      },
      {
        from: "ru",
        to: "es",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ru-es.zip"
      },
      {
        from: "ru",
        to: "fi",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ru-fi.zip"
      },
      {
        from: "ru",
        to: "fr",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ru-fr.zip"
      },
      {
        from: "ru",
        to: "id",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ru-id.zip"
      },
      {
        from: "ru",
        to: "it",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ru-it.zip"
      },
      {
        from: "ru",
        to: "ja",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ru-ja.zip"
      },
      {
        from: "ru",
        to: "la",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ru-la.zip"
      },
      {
        from: "ru",
        to: "lt",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ru-lt.zip"
      },
      {
        from: "ru",
        to: "nl",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ru-nl.zip"
      },
      {
        from: "ru",
        to: "no",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ru-no.zip"
      },
      {
        from: "ru",
        to: "pl",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ru-pl.zip"
      },
      {
        from: "ru",
        to: "pt",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ru-pt.zip"
      },
      {
        from: "ru",
        to: "sv",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ru-sv.zip"
      },
      {
        from: "ru",
        to: "tr",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ru-tr.zip"
      },
      {
        from: "ru",
        to: "zh",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-ru-zh.zip"
      },
      {
        from: "sv",
        to: "bg",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-sv-bg.zip"
      },
      {
        from: "sv",
        to: "ca",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-sv-ca.zip"
      },
      {
        from: "sv",
        to: "cs",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-sv-cs.zip"
      },
      {
        from: "sv",
        to: "da",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-sv-da.zip"
      },
      {
        from: "sv",
        to: "de",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-sv-de.zip"
      },
      {
        from: "sv",
        to: "el",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-sv-el.zip"
      },
      {
        from: "sv",
        to: "en",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-sv-en.zip"
      },
      {
        from: "sv",
        to: "es",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-sv-es.zip"
      },
      {
        from: "sv",
        to: "fi",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-sv-fi.zip"
      },
      {
        from: "sv",
        to: "fr",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-sv-fr.zip"
      },
      {
        from: "sv",
        to: "ga",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-sv-ga.zip"
      },
      {
        from: "sv",
        to: "id",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-sv-id.zip"
      },
      {
        from: "sv",
        to: "it",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-sv-it.zip"
      },
      {
        from: "sv",
        to: "ja",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-sv-ja.zip"
      },
      {
        from: "sv",
        to: "la",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-sv-la.zip"
      },
      {
        from: "sv",
        to: "lt",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-sv-lt.zip"
      },
      {
        from: "sv",
        to: "nl",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-sv-nl.zip"
      },
      {
        from: "sv",
        to: "no",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-sv-no.zip"
      },
      {
        from: "sv",
        to: "pl",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-sv-pl.zip"
      },
      {
        from: "sv",
        to: "pt",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-sv-pt.zip"
      },
      {
        from: "sv",
        to: "ru",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-sv-ru.zip"
      },
      {
        from: "sv",
        to: "tr",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-sv-tr.zip"
      },
      {
        from: "sv",
        to: "zh",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-sv-zh.zip"
      },
      {
        from: "tr",
        to: "bg",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-tr-bg.zip"
      },
      {
        from: "tr",
        to: "ca",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-tr-ca.zip"
      },
      {
        from: "tr",
        to: "cs",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-tr-cs.zip"
      },
      {
        from: "tr",
        to: "da",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-tr-da.zip"
      },
      {
        from: "tr",
        to: "de",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-tr-de.zip"
      },
      {
        from: "tr",
        to: "el",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-tr-el.zip"
      },
      {
        from: "tr",
        to: "en",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-tr-en.zip"
      },
      {
        from: "tr",
        to: "es",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-tr-es.zip"
      },
      {
        from: "tr",
        to: "fi",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-tr-fi.zip"
      },
      {
        from: "tr",
        to: "fr",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-tr-fr.zip"
      },
      {
        from: "tr",
        to: "ga",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-tr-ga.zip"
      },
      {
        from: "tr",
        to: "id",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-tr-id.zip"
      },
      {
        from: "tr",
        to: "it",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-tr-it.zip"
      },
      {
        from: "tr",
        to: "ja",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-tr-ja.zip"
      },
      {
        from: "tr",
        to: "ku",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-tr-ku.zip"
      },
      {
        from: "tr",
        to: "la",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-tr-la.zip"
      },
      {
        from: "tr",
        to: "lt",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-tr-lt.zip"
      },
      {
        from: "tr",
        to: "nl",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-tr-nl.zip"
      },
      {
        from: "tr",
        to: "no",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-tr-no.zip"
      },
      {
        from: "tr",
        to: "pl",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-tr-pl.zip"
      },
      {
        from: "tr",
        to: "pt",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-tr-pt.zip"
      },
      {
        from: "tr",
        to: "ru",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-tr-ru.zip"
      },
      {
        from: "tr",
        to: "sv",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-tr-sv.zip"
      },
      {
        from: "tr",
        to: "zh",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-tr-zh.zip"
      },
      {
        from: "zh",
        to: "de",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-zh-de.zip"
      },
      {
        from: "zh",
        to: "en",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-zh-en.zip"
      },
      {
        from: "zh",
        to: "es",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-zh-es.zip"
      },
      {
        from: "zh",
        to: "fi",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-zh-fi.zip"
      },
      {
        from: "zh",
        to: "fr",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-zh-fr.zip"
      },
      {
        from: "zh",
        to: "it",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-zh-it.zip"
      },
      {
        from: "zh",
        to: "ja",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-zh-ja.zip"
      },
      {
        from: "zh",
        to: "ku",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-zh-ku.zip"
      },
      {
        from: "zh",
        to: "la",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-zh-la.zip"
      },
      {
        from: "zh",
        to: "mg",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-zh-mg.zip"
      },
      {
        from: "zh",
        to: "nl",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-zh-nl.zip"
      },
      {
        from: "zh",
        to: "no",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-zh-no.zip"
      },
      {
        from: "zh",
        to: "pl",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-zh-pl.zip"
      },
      {
        from: "zh",
        to: "pt",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-zh-pt.zip"
      },
      {
        from: "zh",
        to: "ru",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-zh-ru.zip"
      },
      {
        from: "zh",
        to: "sv",
        url: "https://download.wikdict.com/dictionaries/stardict/wikdict-zh-sv.zip"
      }
    ]
  };

  // src/lib/dict/catalog.js
  function isLanguageCode(code) {
    return /^[a-z]{2,3}$/.test(code);
  }
  function parseEntry(raw, index) {
    const where = `dictionary ${index}`;
    if (typeof raw !== "object" || raw === null) return { ok: false, problem: `${where}: not an object` };
    const { from, to, url } = (
      /** @type {Record<string, unknown>} */
      raw
    );
    if (typeof from !== "string" || typeof to !== "string" || !isLanguageCode(from) || !isLanguageCode(to)) {
      return { ok: false, problem: `${where}: from and to must be language codes like en` };
    }
    if (from === to) return { ok: false, problem: `${where}: a dictionary from ${from} to itself` };
    if (typeof url !== "string" || !url.startsWith("https://")) {
      return { ok: false, problem: `${where}: url is not https` };
    }
    return { ok: true, value: { from, to, url } };
  }
  function parseCatalog(raw) {
    if (typeof raw !== "object" || raw === null) {
      return { dictionaries: [], problems: ["catalog is not an object"] };
    }
    const list = (
      /** @type {Record<string, unknown>} */
      raw["dictionaries"]
    );
    if (!Array.isArray(list)) return { dictionaries: [], problems: ["catalog has no dictionaries array"] };
    const dictionaries = [];
    const problems = [];
    const seen = /* @__PURE__ */ new Set();
    for (const [index, entry] of list.entries()) {
      const result = parseEntry(entry, index);
      if (!result.ok) {
        problems.push(result.problem);
        continue;
      }
      const key = `${result.value.from}-${result.value.to}`;
      if (seen.has(key)) {
        problems.push(`dictionary ${index}: ${key} is listed twice`);
        continue;
      }
      seen.add(key);
      dictionaries.push(result.value);
    }
    dictionaries.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
    return { dictionaries, problems };
  }
  var parsed = null;
  function catalogDictionaries() {
    parsed ??= parseCatalog(catalog_default);
    return parsed.dictionaries;
  }
  function catalogSource() {
    const { source, checkedAt } = (
      /** @type {Record<string, unknown>} */
      catalog_default
    );
    return {
      source: typeof source === "string" ? source : "",
      checkedAt: typeof checkedAt === "string" ? checkedAt : ""
    };
  }

  // src/lib/dict/download.js
  var MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
  function fileName(url) {
    return url.split("?")[0]?.split("/").pop() || url;
  }
  async function downloadArchive(url, options = {}) {
    const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    const { onProgress, signal } = options;
    if (signal?.aborted) return { ok: false, problem: "cancelled" };
    let response;
    try {
      response = await fetchImpl(url, { signal, cache: "no-store", redirect: "follow" });
    } catch (error) {
      if (signal?.aborted) return { ok: false, problem: "cancelled" };
      return { ok: false, problem: "network", detail: `${fileName(url)}: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (!response.ok) {
      return { ok: false, problem: "http", detail: `${response.status} ${response.statusText} for ${fileName(url)}`.trim() };
    }
    const claimed = Number.parseInt(response.headers.get("content-length") ?? "", 10);
    const total = Number.isSafeInteger(claimed) && claimed > 0 ? claimed : 0;
    if (total > MAX_ARCHIVE_BYTES) {
      return { ok: false, problem: "too_big", detail: `${fileName(url)}: ${total} bytes` };
    }
    const body = response.body;
    if (body === null) {
      const whole = await response.arrayBuffer();
      if (whole.byteLength > MAX_ARCHIVE_BYTES) {
        return { ok: false, problem: "too_big", detail: `${fileName(url)}: ${whole.byteLength} bytes` };
      }
      onProgress?.({ received: whole.byteLength, total });
      return { ok: true, value: whole };
    }
    const reader = body.getReader();
    const chunks = [];
    let received = 0;
    for (; ; ) {
      let step;
      try {
        step = await reader.read();
      } catch (error) {
        if (signal?.aborted) return { ok: false, problem: "cancelled" };
        return { ok: false, problem: "network", detail: `${fileName(url)}: ${error instanceof Error ? error.message : String(error)}` };
      }
      if (step.done) break;
      const chunk = step.value ?? new Uint8Array(0);
      chunks.push(chunk);
      received += chunk.byteLength;
      if (received > MAX_ARCHIVE_BYTES) {
        await reader.cancel().catch(() => void 0);
        return { ok: false, problem: "too_big", detail: `${fileName(url)}: over ${MAX_ARCHIVE_BYTES} bytes` };
      }
      onProgress?.({ received, total: total === 0 ? 0 : Math.max(total, received) });
      if (signal?.aborted) {
        await reader.cancel().catch(() => void 0);
        return { ok: false, problem: "cancelled" };
      }
    }
    const all = new Uint8Array(received);
    let at = 0;
    for (const chunk of chunks) {
      all.set(chunk, at);
      at += chunk.byteLength;
    }
    return { ok: true, value: all.buffer };
  }
  function describeDictDownloadProblem(problem, detail) {
    switch (problem) {
      case "network":
        return t("dict_download_network", aside(detail));
      case "http":
        return t("dict_download_http", aside(detail));
      case "too_big":
        return t("dict_download_too_big", aside(detail));
      case "cancelled":
        return t("download_cancelled");
      default:
        return t("download_failed");
    }
  }

  // src/lib/models/upstream.js
  var ARCHITECTURE_PREFERENCE = ["base-memory", "tiny", "base"];
  var UPSTREAM_ROLES = Object.freeze({
    model: "model",
    lexicalShortlist: "shortlist",
    vocab: "vocab",
    srcVocab: "vocab",
    trgVocab: "vocab"
  });
  var ROLE_ORDER = ["model", "shortlist", "vocab"];
  function allowedPrefix(source) {
    const url = new URL(source);
    const bucket = url.pathname.split("/").filter(Boolean)[0] ?? "";
    return `${url.origin}/${bucket}/`;
  }
  function underPrefix(url, prefix) {
    if (!url.startsWith(prefix)) return false;
    try {
      return new URL(url).href.startsWith(prefix);
    } catch {
      return false;
    }
  }
  function pickEntry(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return { ok: false, problem: "no entries" };
    const released = entries.filter((entry) => String(entry?.releaseStatus ?? "").startsWith("Release"));
    if (released.length === 0) return { ok: false, problem: "nothing released" };
    const rank = (entry) => {
      const at = ARCHITECTURE_PREFERENCE.indexOf(String(entry?.architecture ?? ""));
      return at === -1 ? ARCHITECTURE_PREFERENCE.length : at;
    };
    const sorted = [...released].sort((a, b) => rank(a) - rank(b));
    const [first, second] = sorted;
    if (second !== void 0 && rank(first) === rank(second)) {
      return { ok: false, problem: "more than one released build of the same kind" };
    }
    return { ok: true, value: first };
  }
  function parsePairKey(pairKey) {
    const parts = pairKey.split("-");
    if (parts.length !== 2) return null;
    const [from, to] = (
      /** @type {[string, string]} */
      parts
    );
    const code = /^[a-z]{2,3}(_[a-z]{4})?$/;
    if (!code.test(from) || !code.test(to)) return null;
    return { pair: `${from}${to}`, from, to };
  }
  function convertFiles(entry, baseUrl, prefix) {
    const files = [];
    for (const [key, published] of Object.entries(entry?.files ?? {})) {
      const role = (
        /** @type {Record<string, "model" | "shortlist" | "vocab">} */
        UPSTREAM_ROLES[key]
      );
      if (role === void 0) return { ok: false, problem: `unknown file "${key}"` };
      const path = (
        /** @type {any} */
        published?.path
      );
      if (typeof path !== "string" || path.length === 0) return { ok: false, problem: `"${key}" has no path` };
      const url = `${baseUrl}/${path}`;
      if (!underPrefix(url, prefix)) return { ok: false, problem: `"${key}" points outside ${prefix}` };
      const claimedHash = (
        /** @type {any} */
        published?.uncompressedHash
      );
      const claimedSize2 = (
        /** @type {any} */
        published?.uncompressedSize
      );
      files.push({
        role,
        url,
        // The index does not say what crosses the wire, only what unpacks out of
        // it - zero means unknown, and the download layer treats it as such.
        downloadBytes: 0,
        bytes: typeof claimedSize2 === "number" && Number.isSafeInteger(claimedSize2) && claimedSize2 > 0 ? claimedSize2 : 0,
        sha256: typeof claimedHash === "string" && /^[0-9a-f]{64}$/.test(claimedHash) ? claimedHash : null
      });
    }
    for (const role of ROLE_ORDER) {
      if (!files.some((file) => file.role === role)) return { ok: false, problem: `no ${role} file` };
    }
    if (files.filter((file) => file.role === "model").length > 1) {
      return { ok: false, problem: "more than one model file" };
    }
    files.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.url.localeCompare(b.url));
    return { ok: true, value: files };
  }
  function convertUpstreamIndex(raw, source) {
    const models = [];
    const problems = [];
    if (typeof raw !== "object" || raw === null) return { models, problems: ["index is not an object"] };
    const { baseUrl, models: byPair } = (
      /** @type {Record<string, unknown>} */
      raw
    );
    if (typeof baseUrl !== "string" || baseUrl.length === 0) {
      return { models, problems: ["index has no baseUrl"] };
    }
    const prefix = allowedPrefix(source);
    const base = baseUrl.replace(/\/$/, "");
    if (typeof byPair !== "object" || byPair === null) return { models, problems: ["index has no models"] };
    for (const [pairKey, entries] of Object.entries(byPair)) {
      const languages = parsePairKey(pairKey);
      if (languages === null) {
        problems.push(`${pairKey}: not a language pair`);
        continue;
      }
      const picked = pickEntry(entries);
      if (!picked.ok) {
        problems.push(`${pairKey}: ${picked.problem}`);
        continue;
      }
      const files = convertFiles(picked.value, base, prefix);
      if (!files.ok) {
        problems.push(`${pairKey}: ${files.problem}`);
        continue;
      }
      models.push({
        pair: languages.pair,
        from: languages.from,
        to: languages.to,
        downloadBytes: files.value.reduce((total, file) => total + file.downloadBytes, 0),
        bytes: files.value.reduce((total, file) => total + file.bytes, 0),
        files: files.value
      });
    }
    models.sort((a, b) => a.pair.localeCompare(b.pair));
    return { models, problems };
  }
  function modelSourceUrl(model) {
    return model.files.find((file) => file.role === "model")?.url ?? null;
  }
  function updateAvailable(installed, available) {
    if (installed === null || available === null) return false;
    const recorded = installed.sourceUrl;
    if (recorded === void 0 || recorded === "") return false;
    const offered = modelSourceUrl(available);
    return offered !== null && offered !== recorded;
  }

  // src/lib/dict/live.js
  var LIVE_DICTIONARIES_KEY = "dictionariesIndex";
  function convertListing(html, source) {
    const entries = [];
    const seen = /* @__PURE__ */ new Set();
    for (const match of html.matchAll(/href="(wikdict-([a-z]{2,3})-([a-z]{2,3})\.zip)"/g)) {
      const [, name, from, to] = match;
      if (name === void 0 || from === void 0 || to === void 0) continue;
      if (from === to || seen.has(name)) continue;
      seen.add(name);
      entries.push({ from, to, url: `${source}${name}` });
    }
    entries.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
    return entries;
  }
  function readStored(stored) {
    if (typeof stored !== "object" || stored === null) return null;
    const { fetchedAt, etag, dictionaries } = (
      /** @type {Record<string, unknown>} */
      stored
    );
    if (typeof fetchedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fetchedAt)) return null;
    const { source } = catalogSource();
    if (source === "") return null;
    const parsed3 = parseCatalog({ dictionaries });
    const kept = parsed3.dictionaries.filter((entry) => underPrefix(entry.url, source));
    if (kept.length === 0) return null;
    return { fetchedAt, etag: typeof etag === "string" ? etag : null, dictionaries: kept };
  }
  async function readLiveDictionaries() {
    try {
      const stored = await webext().storage.local.get(LIVE_DICTIONARIES_KEY);
      const read = readStored(stored[LIVE_DICTIONARIES_KEY]);
      return read === null ? null : { fetchedAt: read.fetchedAt, dictionaries: read.dictionaries };
    } catch {
      return null;
    }
  }
  async function refreshLiveDictionaries(options = {}) {
    const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    const today = options.today ?? (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const { source } = catalogSource();
    if (source === "") return { ok: false, detail: "no source in the packaged catalogue" };
    let cached = null;
    try {
      const stored = await webext().storage.local.get(LIVE_DICTIONARIES_KEY);
      cached = readStored(stored[LIVE_DICTIONARIES_KEY]);
    } catch {
    }
    let response;
    try {
      response = await fetchImpl(source, {
        // The conditional request is the whole economy of this refresh; the
        // browser's own cache underneath it would only blur whose answer this is.
        cache: "no-store",
        redirect: "follow",
        ...cached?.etag ? { headers: { "If-None-Match": cached.etag } } : {}
      });
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
    if (response.status === 304 && cached !== null) {
      const value2 = { fetchedAt: today, dictionaries: cached.dictionaries };
      await write({ ...value2, etag: cached.etag });
      return { ok: true, changed: false, value: value2 };
    }
    if (!response.ok) {
      return { ok: false, detail: `${response.status} ${response.statusText}`.trim() };
    }
    let html;
    try {
      html = await response.text();
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
    const dictionaries = convertListing(html, source);
    if (dictionaries.length === 0) return { ok: false, detail: "the listing held no dictionaries" };
    const value = { fetchedAt: today, dictionaries };
    await write({ ...value, etag: response.headers.get("ETag") });
    return { ok: true, changed: true, value };
  }
  async function write(value) {
    try {
      await webext().storage.local.set({ [LIVE_DICTIONARIES_KEY]: value });
    } catch {
    }
  }

  // src/lib/models/files.js
  function isGzip(data) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    return bytes.length >= 2 && bytes[0] === 31 && bytes[1] === 139;
  }
  function withoutGz(name) {
    return name.replace(/\.gz$/i, "");
  }
  function roleOf(name) {
    const base = withoutGz(name).toLowerCase();
    if (base.startsWith("model.")) return "model";
    if (base.startsWith("lex.")) return "shortlist";
    if (base.startsWith("vocab.")) return "vocab";
    return null;
  }
  function parsePair(name) {
    for (const segment of withoutGz(name).toLowerCase().split(".")) {
      if (/^[a-z]{4}$/.test(segment)) {
        return { pair: segment, from: segment.slice(0, 2), to: segment.slice(2) };
      }
    }
    return null;
  }
  function classifyModelFiles(names2) {
    if (names2.length === 0) return { ok: false, problem: "empty" };
    const byRole = { model: [], shortlist: [], vocab: [] };
    const pairs = /* @__PURE__ */ new Map();
    for (const name of names2) {
      const role = roleOf(name);
      if (role === null) return { ok: false, problem: "unknown_file", detail: name };
      const parsed3 = parsePair(name);
      if (parsed3 === null) return { ok: false, problem: "unknown_pair", detail: name };
      byRole[role].push(name);
      pairs.set(parsed3.pair, { from: parsed3.from, to: parsed3.to });
    }
    if (pairs.size > 1) {
      return { ok: false, problem: "mixed_pairs", detail: [...pairs.keys()].sort().join(", ") };
    }
    if (byRole.model.length === 0) return { ok: false, problem: "missing_model" };
    if (byRole.shortlist.length === 0) return { ok: false, problem: "missing_shortlist" };
    if (byRole.vocab.length === 0) return { ok: false, problem: "missing_vocab" };
    const [pair] = [...pairs.keys()];
    const languages = pairs.get(
      /** @type {string} */
      pair
    );
    if (pair === void 0 || languages === void 0) return { ok: false, problem: "unknown_pair" };
    return { ok: true, value: { pair, from: languages.from, to: languages.to, byRole } };
  }
  function describeClassifyProblem(problem, detail) {
    const file = detail ?? t("model_files_one_of_them");
    switch (problem) {
      case "empty":
        return t("model_files_empty");
      case "unknown_file":
        return t("model_files_unknown_file", file);
      case "unknown_pair":
        return t("model_files_unknown_pair", file);
      case "mixed_pairs":
        return t("model_files_mixed_pairs", detail ?? "");
      case "missing_model":
        return t("model_files_missing_model");
      case "missing_shortlist":
        return t("model_files_missing_shortlist");
      case "missing_vocab":
        return t("model_files_missing_vocab");
      default:
        return t("model_files_not_a_model");
    }
  }

  // src/lib/dict/stardict.js
  var MAX_WORD_BYTES = 255;
  var MAGIC = "StarDict's dict ifo file";
  var OTHER_MAGIC = Object.freeze({
    "StarDict's treedict ifo file": "a tree dictionary",
    "StarDict's storage ifo file": "a resource storage file"
  });
  var decoder = new TextDecoder("utf-8");
  function keyValue(line) {
    const at = line.indexOf("=");
    if (at <= 0) return null;
    return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
  }
  function parseIfo(text, fallbackName = "Dictionary") {
    const lines = text.split(/\r?\n/u);
    const magic = (lines[0] ?? "").trim();
    if (magic !== MAGIC) {
      const known = (
        /** @type {Record<string, string>} */
        OTHER_MAGIC[magic]
      );
      return { ok: false, problem: "not_stardict", detail: known };
    }
    const fields = /* @__PURE__ */ new Map();
    for (const line of lines.slice(1)) {
      const pair = keyValue(line);
      if (pair !== null) fields.set(pair[0], pair[1]);
    }
    const bookname = fields.get("bookname")?.trim() ?? "";
    const credit = [fields.get("author"), fields.get("website"), fields.get("description")].map((part) => part?.trim() ?? "").filter((part) => part.length > 0).join(" - ");
    return {
      ok: true,
      value: {
        bookname: bookname.length > 0 ? bookname : fallbackName,
        version: fields.get("version") ?? "",
        wordcount: Number.parseInt(fields.get("wordcount") ?? "", 10) || 0,
        // 64-bit offsets exist only in 3.0.0, and 32 is the default everywhere
        // else. Getting this wrong turns every offset into nonsense, so it is the
        // one declared field that has to be believed.
        offsetBits: fields.get("idxoffsetbits")?.trim() === "64" ? 64 : 32,
        sametypesequence: fields.get("sametypesequence")?.trim() ?? "",
        credit: credit.length > 0 ? credit : null
      }
    };
  }
  function zeroAt(bytes, from) {
    for (let at = from; at < bytes.length; at += 1) {
      if (bytes[at] === 0) return at;
    }
    return -1;
  }
  function bytesOf(data) {
    return data instanceof Uint8Array ? data : new Uint8Array(data);
  }
  function* idxEntries(data, offsetBits) {
    const bytes = bytesOf(data);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const offsetSize = offsetBits === 64 ? 8 : 4;
    let at = 0;
    while (at < bytes.length) {
      const end = zeroAt(bytes, at);
      if (end < 0) return;
      if (end - at > MAX_WORD_BYTES) return;
      if (end + 1 + offsetSize + 4 > bytes.length) return;
      const word = decoder.decode(bytes.subarray(at, end));
      const numbers = end + 1;
      const offset = offsetBits === 64 ? Number(view.getBigUint64(numbers, false)) : view.getUint32(numbers, false);
      const size = view.getUint32(numbers + offsetSize, false);
      yield { word, offset, size };
      at = numbers + offsetSize + 4;
    }
  }
  function isWord(entry) {
    return entry.word.length > 0 && entry.size > 0;
  }
  function* synEntries(data) {
    const bytes = bytesOf(data);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let at = 0;
    while (at < bytes.length) {
      const end = zeroAt(bytes, at);
      if (end < 0 || end - at > MAX_WORD_BYTES || end + 5 > bytes.length) return;
      const word = decoder.decode(bytes.subarray(at, end));
      if (word.length > 0) yield { word, target: view.getUint32(end + 1, false) };
      at = end + 5;
    }
  }
  function readFields(data, entry, sametypesequence) {
    const bytes = bytesOf(data);
    const start = entry.offset;
    const end = start + entry.size;
    if (start < 0 || end > bytes.length) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const fields = [];
    let at = start;
    const readOne = (type, last) => {
      const upper = type >= "A" && type <= "Z";
      if (upper) {
        if (last) return end;
        if (at + 4 > end) return end;
        const size = view.getUint32(at, false);
        return Math.min(end, at + 4 + size);
      }
      const stop2 = last ? -1 : zeroAt(bytes, at);
      const text = decoder.decode(bytes.subarray(at, stop2 < 0 || stop2 > end ? end : stop2));
      fields.push({ type, text });
      return stop2 < 0 || stop2 > end ? end : stop2 + 1;
    };
    if (sametypesequence.length > 0) {
      for (let index = 0; index < sametypesequence.length; index += 1) {
        if (at >= end) break;
        const last = index === sametypesequence.length - 1;
        at = readOne(sametypesequence[index] ?? "m", last);
      }
      return fields;
    }
    while (at < end) {
      const type = String.fromCharCode(bytes[at] ?? 0);
      at += 1;
      at = readOne(type, false);
    }
    return fields;
  }

  // src/lib/dict/text.js
  var MARKUP = /* @__PURE__ */ new Set(["h", "g", "x", "w", "k"]);
  var READABLE = /* @__PURE__ */ new Set(["m", "l", "t", "y", "n", ...MARKUP]);
  var LIMITS = Object.freeze({ senseLength: 1e3, senses: 10, name: 120, credit: 400 });
  var LINE_BREAKS = /<\s*\/?\s*(?:br|p|div|li|tr|td|th|table|ul|ol|dl|dt|dd|blockquote|h[1-6])\b[^>]*>/giu;
  var XDXF_KEY = /<k>[\s\S]*?<\/k>/giu;
  var TAG = /<[^>]*>/gu;
  var NAMED_ENTITIES = Object.freeze({
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    lrm: String.fromCodePoint(8206),
    rlm: String.fromCodePoint(8207),
    zwj: String.fromCodePoint(8205),
    zwnj: String.fromCodePoint(8204),
    shy: String.fromCodePoint(173),
    ensp: " ",
    emsp: " ",
    thinsp: " ",
    // Written by code point, not as themselves: the house style keeps a literal
    // em dash out of our own prose, and a dash decoded from a book is the book's
    // character rather than ours - it has to come out as what the book wrote.
    mdash: String.fromCodePoint(8212),
    ndash: String.fromCodePoint(8211),
    hellip: "\u2026",
    lsquo: "\u2018",
    rsquo: "\u2019",
    ldquo: "\u201C",
    rdquo: "\u201D",
    sbquo: "\u201A",
    bdquo: "\u201E",
    laquo: "\xAB",
    raquo: "\xBB",
    prime: "\u2032",
    Prime: "\u2033",
    deg: "\xB0",
    times: "\xD7",
    divide: "\xF7",
    plusmn: "\xB1",
    middot: "\xB7",
    bull: "\u2022",
    dagger: "\u2020",
    Dagger: "\u2021",
    sect: "\xA7",
    para: "\xB6",
    copy: "\xA9",
    reg: "\xAE",
    trade: "\u2122",
    micro: "\xB5",
    sup1: "\xB9",
    sup2: "\xB2",
    sup3: "\xB3"
  });
  function decodeEntities(text) {
    return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/giu, (whole, body) => {
      const table = (
        /** @type {Record<string, string>} */
        NAMED_ENTITIES
      );
      const written = String(body);
      const named = table[written] ?? table[written.toLowerCase()];
      if (named !== void 0) return named;
      const name = written.toLowerCase();
      if (name.startsWith("#")) {
        const code = name.startsWith("#x") ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
        if (Number.isInteger(code) && code > 0 && code <= 1114111 && !(code >= 55296 && code <= 57343)) {
          return String.fromCodePoint(code);
        }
      }
      return whole;
    });
  }
  function tidy(text) {
    return text.replace(/\r\n?/gu, "\n").split("\n").map((line) => line.replace(/[^\S\n]+/gu, " ").trim()).filter((line) => line.length > 0).join("\n").trim();
  }
  function clamp(text, limit) {
    if (text.length <= limit) return text;
    const cut = text.slice(0, limit);
    const space = cut.lastIndexOf(" ");
    return `${(space > limit - 40 ? cut.slice(0, space) : cut).trimEnd()}...`;
  }
  function about(text, limit = LIMITS.credit) {
    if (text === null) return null;
    const plain = clamp(fieldText({ type: "h", text }), limit);
    return plain.length > 0 ? plain : null;
  }
  function fieldText({ type, text }) {
    if (!READABLE.has(type)) return "";
    if (!MARKUP.has(type)) return tidy(text);
    const withoutMarkup = (type === "x" ? text.replace(XDXF_KEY, " ") : text).replace(LINE_BREAKS, "\n").replace(TAG, "");
    return tidy(decodeEntities(withoutMarkup));
  }
  function senses(fields) {
    const found = [];
    let pending = [];
    for (const field of fields) {
      const text = fieldText(field);
      if (text.length === 0) continue;
      if (field.type === "t" || field.type === "y") {
        pending.push(text);
        continue;
      }
      found.push(clamp([...pending, text].join(" "), LIMITS.senseLength));
      pending = [];
    }
    if (pending.length > 0) found.push(clamp(pending.join(" "), LIMITS.senseLength));
    return found.slice(0, LIMITS.senses);
  }

  // src/lib/dict/import.js
  function withoutCompression(name) {
    return name.replace(/\.(?:gz|dz)$/iu, "");
  }
  function classifyDictionaryFiles(names2) {
    if (names2.length === 0) return { ok: false, problem: "empty" };
    const byBase = /* @__PURE__ */ new Map();
    for (const name of names2) {
      const bare = withoutCompression(name);
      const match = /^(.*)\.(ifo|idx|dict|syn)$/iu.exec(bare);
      if (match === null) continue;
      const base2 = match[1] ?? "";
      const role = (
        /** @type {"ifo" | "idx" | "dict" | "syn"} */
        (match[2] ?? "").toLowerCase()
      );
      const found = byBase.get(base2) ?? {};
      if (found[role] === void 0) found[role] = name;
      byBase.set(base2, found);
    }
    if (byBase.size === 0) return { ok: false, problem: "missing_ifo" };
    if (byBase.size > 1) {
      return { ok: false, problem: "mixed", detail: [...byBase.keys()].sort().join(", ") };
    }
    const [base] = [...byBase.keys()];
    const files = byBase.get(
      /** @type {string} */
      base
    ) ?? {};
    if (files.ifo === void 0) return { ok: false, problem: "missing_ifo" };
    if (files.idx === void 0) return { ok: false, problem: "missing_idx" };
    if (files.dict === void 0) return { ok: false, problem: "missing_dict" };
    return {
      ok: true,
      value: {
        base: (
          /** @type {string} */
          base
        ),
        ifo: files.ifo,
        idx: files.idx,
        dict: files.dict,
        ...files.syn === void 0 ? {} : { syn: files.syn }
      }
    };
  }
  function dictionaryFromZip(entries) {
    const usable = entries.filter((entry) => {
      const leaf = entry.name.split("/").pop() ?? "";
      return leaf.length > 0 && !leaf.startsWith(".") && !entry.name.split("/").includes("__MACOSX");
    });
    const classified = classifyDictionaryFiles(usable.map((entry) => entry.name));
    if (!classified.ok) return classified;
    const { base, ifo, idx, dict, syn } = classified.value;
    const bytesOf2 = (name) => (
      /** @type {Uint8Array} */
      usable.find((entry) => entry.name === name)?.bytes
    );
    return {
      ok: true,
      value: {
        // The base may still carry the folder the archive wraps its files in;
        // the leaf is what a status line should call the dictionary.
        base: base.split("/").pop() || base,
        files: {
          ifo: bytesOf2(ifo),
          idx: bytesOf2(idx),
          dict: bytesOf2(dict),
          ...syn === void 0 ? {} : { syn: bytesOf2(syn) }
        }
      }
    };
  }
  function take(files, role) {
    const sources = (
      /** @type {Partial<Record<"ifo" | "idx" | "dict" | "syn", FileSource>>} */
      files
    );
    const source = sources[role];
    delete sources[role];
    return source;
  }
  function streamOf(bytes) {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(
          /** @type {Uint8Array<ArrayBuffer>} */
          bytes
        );
        controller.close();
      }
    });
  }
  async function gunzip(stream, sizeHint) {
    const reader = stream.pipeThrough(new DecompressionStream("gzip")).getReader();
    let out = new Uint8Array(sizeHint);
    let length = 0;
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.length > out.length) {
        const grown = new Uint8Array(Math.max(out.length * 2, length + value.length));
        grown.set(out.subarray(0, length));
        out = grown;
      }
      out.set(value, length);
      length += value.length;
    }
    return length === out.length ? out : out.subarray(0, length);
  }
  function claimedSize(tail) {
    if (tail.length < 4) return 0;
    return new DataView(tail.buffer, tail.byteOffset + tail.length - 4, 4).getUint32(0, true);
  }
  async function unpack(source) {
    if (source === void 0) return new Uint8Array();
    if (source instanceof Blob) {
      const head = new Uint8Array(await source.slice(0, 2).arrayBuffer());
      if (!isGzip(head)) return new Uint8Array(await source.arrayBuffer());
      const tail = new Uint8Array(await source.slice(Math.max(0, source.size - 4)).arrayBuffer());
      return gunzip(source.stream(), claimedSize(tail));
    }
    const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
    if (!isGzip(bytes)) return bytes;
    return gunzip(streamOf(bytes), claimedSize(bytes));
  }
  async function openDictionary(files, { fallbackName } = {}) {
    const unpackFailed = (error) => ({
      ok: false,
      problem: "unpack",
      detail: error instanceof Error ? error.message : String(error)
    });
    let ifoBytes;
    try {
      ifoBytes = await unpack(take(files, "ifo"));
    } catch (error) {
      return unpackFailed(error);
    }
    const ifo = parseIfo(new TextDecoder("utf-8").decode(ifoBytes), fallbackName);
    if (!ifo.ok) return ifo;
    let idx;
    let dict;
    let syn;
    try {
      idx = await unpack(take(files, "idx"));
      dict = await unpack(take(files, "dict"));
      const synSource = take(files, "syn");
      syn = synSource === void 0 ? null : await unpack(synSource);
    } catch (error) {
      return unpackFailed(error);
    }
    const { offsetBits, sametypesequence } = ifo.value;
    let words2 = 0;
    for (const entry of idxEntries(idx, offsetBits)) {
      if (isWord(entry)) words2 += 1;
    }
    if (words2 === 0) return { ok: false, problem: "no_entries" };
    let synonyms = 0;
    if (syn !== null) {
      for (const _ of synEntries(syn)) synonyms += 1;
    }
    const name = about(ifo.value.bookname, LIMITS.name) ?? fallbackName ?? t("dict_default_name");
    return {
      ok: true,
      value: {
        name,
        credit: about(ifo.value.credit),
        idx,
        dict,
        syn,
        offsetBits,
        sametypesequence,
        words: words2,
        synonyms
      }
    };
  }
  function* entriesOf({ idx, dict, offsetBits, sametypesequence }, { readFrom = 0 } = {}) {
    let position = -1;
    for (const entry of idxEntries(idx, offsetBits)) {
      position += 1;
      if (!isWord(entry)) continue;
      if (position < readFrom) {
        yield { position, headword: entry.word, senses: [] };
        continue;
      }
      const fields = readFields(dict, entry, sametypesequence);
      yield { position, headword: entry.word, senses: fields === null ? [] : senses(fields) };
    }
  }
  function* aliasesOf({ syn }) {
    if (syn === null) return;
    for (const { word, target } of synEntries(syn)) yield { headword: word, target };
  }
  function describeImportProblem(problem, detail) {
    switch (problem) {
      case "empty":
        return t("dict_import_empty");
      case "missing_ifo":
        return t("dict_import_missing_ifo");
      case "missing_idx":
        return t("dict_import_missing_idx");
      case "missing_dict":
        return t("dict_import_missing_dict");
      case "mixed":
        return t("dict_import_mixed", detail ?? "");
      case "not_stardict":
        return detail === void 0 ? t("dict_import_not_stardict") : t("dict_import_not_stardict_detail", detail);
      case "unpack":
        return t("dict_import_unpack", aside(detail));
      case "no_entries":
        return detail === void 0 ? t("dict_import_no_entries") : t("dict_import_no_entries_detail", detail);
      default:
        return t("dict_import_unreadable");
    }
  }

  // src/lib/dict/zip.js
  var LIMITS2 = Object.freeze({
    entries: 64,
    totalBytes: 256 * 1024 * 1024,
    nameLength: 512
  });
  var EOCD_SIGNATURE = 101010256;
  var CENTRAL_SIGNATURE = 33639248;
  var LOCAL_SIGNATURE = 67324752;
  var MAX_U16 = 65535;
  var MAX_U32 = 4294967295;
  var crcTable = null;
  function crc32(bytes) {
    if (crcTable === null) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
        crcTable[n] = c >>> 0;
      }
    }
    let crc = 4294967295;
    for (const byte of bytes) crc = /** @type {number} */
    crcTable[(crc ^ byte) & 255] ^ crc >>> 8;
    return (crc ^ 4294967295) >>> 0;
  }
  function findEndOfCentralDirectory(view) {
    const floor = Math.max(0, view.byteLength - 22 - MAX_U16);
    for (let at = view.byteLength - 22; at >= floor; at -= 1) {
      if (view.getUint32(at, true) === EOCD_SIGNATURE) return at;
    }
    return -1;
  }
  async function inflateRaw(compressed) {
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  function refuse(problem, detail) {
    return { ok: false, problem, ...detail === void 0 ? {} : { detail } };
  }
  async function readZip(buffer) {
    const view = new DataView(buffer);
    if (view.byteLength < 22) return refuse("not_zip");
    const end = findEndOfCentralDirectory(view);
    if (end === -1) return refuse("not_zip");
    if (view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0) {
      return refuse("zip_unsupported", "a multi-part archive");
    }
    const count = view.getUint16(end + 10, true);
    const centralOffset = view.getUint32(end + 16, true);
    if (count === MAX_U16 || centralOffset === MAX_U32) return refuse("zip_unsupported", "zip64");
    if (count === 0) return refuse("zip_bad", "no entries");
    if (count > LIMITS2.entries) return refuse("zip_too_big", `${count} entries`);
    const entries = [];
    let at = centralOffset;
    let totalBytes = 0;
    for (let read = 0; read < count; read += 1) {
      if (at + 46 > end || view.getUint32(at, true) !== CENTRAL_SIGNATURE) {
        return refuse("zip_bad", "central directory does not add up");
      }
      const flags = view.getUint16(at + 8, true);
      const method = view.getUint16(at + 10, true);
      const crc = view.getUint32(at + 16, true);
      const compressedSize = view.getUint32(at + 20, true);
      const uncompressedSize = view.getUint32(at + 24, true);
      const nameLength = view.getUint16(at + 28, true);
      const extraLength = view.getUint16(at + 30, true);
      const commentLength = view.getUint16(at + 32, true);
      const localOffset = view.getUint32(at + 42, true);
      if ((flags & 1) !== 0 || (flags & 64) !== 0) return refuse("zip_unsupported", "encrypted");
      if (method !== 0 && method !== 8) return refuse("zip_unsupported", `compression method ${method}`);
      if (compressedSize === MAX_U32 || uncompressedSize === MAX_U32 || localOffset === MAX_U32) {
        return refuse("zip_unsupported", "zip64");
      }
      if (nameLength === 0 || nameLength > LIMITS2.nameLength) return refuse("zip_bad", "a nameless or absurd entry");
      if (at + 46 + nameLength > end) return refuse("zip_bad", "central directory does not add up");
      const name = new TextDecoder("utf-8").decode(new Uint8Array(buffer, at + 46, nameLength));
      if (name.includes(String.fromCodePoint(0))) return refuse("zip_bad", "a name with a NUL in it");
      if (!name.endsWith("/")) {
        totalBytes += uncompressedSize;
        if (totalBytes > LIMITS2.totalBytes) return refuse("zip_too_big", "unpacks to too much");
        entries.push({ name, method, crc, compressedSize, uncompressedSize, localOffset });
      }
      at += 46 + nameLength + extraLength + commentLength;
    }
    const files = [];
    for (const entry of entries) {
      if (entry.localOffset + 30 > view.byteLength || view.getUint32(entry.localOffset, true) !== LOCAL_SIGNATURE) {
        return refuse("zip_bad", `${entry.name}: local header is not where the directory says`);
      }
      const nameLength = view.getUint16(entry.localOffset + 26, true);
      const extraLength = view.getUint16(entry.localOffset + 28, true);
      const dataStart = entry.localOffset + 30 + nameLength + extraLength;
      if (dataStart + entry.compressedSize > view.byteLength) {
        return refuse("zip_bad", `${entry.name}: data runs past the end of the file`);
      }
      const compressed = new Uint8Array(buffer, dataStart, entry.compressedSize);
      let bytes;
      if (entry.method === 0) {
        bytes = compressed.slice();
      } else {
        try {
          bytes = await inflateRaw(compressed);
        } catch {
          return refuse("zip_bad", `${entry.name}: does not decompress`);
        }
      }
      if (bytes.byteLength !== entry.uncompressedSize) {
        return refuse("zip_bad", `${entry.name}: unpacked to ${bytes.byteLength} bytes, the archive said ${entry.uncompressedSize}`);
      }
      if (crc32(bytes) !== entry.crc) {
        return refuse("zip_bad", `${entry.name}: checksum does not match`);
      }
      files.push({ name: entry.name, bytes });
    }
    if (files.length === 0) return refuse("zip_bad", "only directories inside");
    return { ok: true, value: files };
  }
  function describeZipProblem(problem, detail) {
    switch (problem) {
      case "not_zip":
        return t("zip_not_zip");
      case "zip_unsupported":
        return t("zip_unsupported", aside(detail));
      case "zip_too_big":
        return t("zip_too_big", aside(detail));
      case "zip_bad":
        return t("zip_bad", aside(detail));
      default:
        return t("zip_unreadable");
    }
  }

  // src/lib/normalize.js
  var LAYOUT_ARTEFACTS = new RegExp("[\\u00AD\\u200B]", "gu");
  var EDGE_PUNCTUATION = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;
  function collapseWhitespace(text) {
    return text.normalize("NFC").replace(LAYOUT_ARTEFACTS, "").replace(/\s+/gu, " ").trim();
  }
  function trimPhrase(text) {
    return collapseWhitespace(text).replace(EDGE_PUNCTUATION, "").trim();
  }
  function normalize(text) {
    return trimPhrase(text).toLowerCase();
  }

  // src/lib/dict/rows.js
  var BATCH_ROWS = 5e3;
  function utf8Length(text) {
    let total = 0;
    for (let at = 0; at < text.length; at += 1) {
      const code = text.charCodeAt(at);
      if (code < 128) total += 1;
      else if (code < 2048) total += 2;
      else if (code >= 55296 && code <= 56319) {
        total += 4;
        at += 1;
      } else total += 3;
    }
    return total;
  }
  function rowBytes(row) {
    let total = utf8Length(row.key) + utf8Length(row.headword) + utf8Length(row.aliasOf ?? "");
    for (const sense of row.senses) total += utf8Length(sense);
    return total;
  }
  function mergeSenses(into, more) {
    const added = [];
    for (const sense of more) {
      if (into.length >= LIMITS.senses) break;
      if (into.includes(sense)) continue;
      into.push(sense);
      added.push(sense);
    }
    return added;
  }
  function entriesReadFrom(progress) {
    if (progress === null) return 0;
    return progress.phase === "entries" ? progress.next : Number.POSITIVE_INFINITY;
  }
  function* rowBatches(dictId, { entries, aliases }, { batchSize = BATCH_ROWS, resume = null } = {}) {
    const keys = [];
    const taken = /* @__PURE__ */ new Set();
    let batch = /* @__PURE__ */ new Map();
    let additions = /* @__PURE__ */ new Map();
    const replayEntriesBelow = entriesReadFrom(resume);
    const replayAliasesThrough = resume !== null && resume.phase === "aliases" ? resume.next : 0;
    const skippedBefore = new Set(resume?.skipped ?? []);
    let phase = "entries";
    let lastPosition = -1;
    let aliasOrdinal = 0;
    let done = 0;
    let entryCount = resume?.entryCount ?? 0;
    let aliasCount = resume?.aliasCount ?? 0;
    let bytes = resume?.bytes ?? 0;
    const skipped = [...resume?.skipped ?? []];
    const flush = () => {
      const rows = [...batch.values()];
      for (const row of rows) bytes += rowBytes(row);
      const progress = {
        phase,
        next: phase === "entries" ? lastPosition + 1 : aliasOrdinal,
        skipped: [...skipped],
        done,
        entryCount,
        aliasCount,
        bytes
      };
      const out = { rows, additions: [...additions.values()], done, progress };
      batch = /* @__PURE__ */ new Map();
      additions = /* @__PURE__ */ new Map();
      return out;
    };
    for (const entry of entries) {
      done += 1;
      lastPosition = entry.position;
      if (entry.position < replayEntriesBelow) {
        if (skippedBefore.has(entry.position)) continue;
        const key2 = normalize(entry.headword);
        if (key2.length === 0) continue;
        keys[entry.position] = key2;
        taken.add(key2);
        continue;
      }
      if (entry.senses.length === 0) {
        skipped.push(entry.position);
        continue;
      }
      const key = normalize(entry.headword);
      if (key.length === 0) continue;
      keys[entry.position] = key;
      const pending = batch.get(key);
      if (pending !== void 0) {
        mergeSenses(pending.senses, entry.senses);
      } else if (taken.has(key)) {
        const addition = additions.get(key);
        if (addition === void 0) additions.set(key, { dictId, key, senses: [...entry.senses] });
        else addition.senses.push(...entry.senses);
      } else {
        batch.set(key, { dictId, key, headword: entry.headword, senses: [...entry.senses] });
        taken.add(key);
        entryCount += 1;
      }
      if (batch.size >= batchSize) yield flush();
    }
    phase = "aliases";
    for (const alias of aliases) {
      done += 1;
      aliasOrdinal += 1;
      const key = normalize(alias.headword);
      if (key.length === 0 || taken.has(key)) continue;
      const targetKey = keys[alias.target];
      if (targetKey === void 0 || targetKey === key) continue;
      taken.add(key);
      if (aliasOrdinal <= replayAliasesThrough) continue;
      batch.set(key, { dictId, key, headword: alias.headword, senses: [], aliasOf: targetKey });
      aliasCount += 1;
      if (batch.size >= batchSize) yield flush();
    }
    if (batch.size > 0 || additions.size > 0) yield flush();
    return { entryCount, aliasCount, bytes, skipped: skipped.length };
  }

  // src/lib/dict/order.js
  function rankOf(dictionary) {
    return typeof dictionary.rank === "number" ? dictionary.rank : Number.MAX_SAFE_INTEGER;
  }
  function answerOrder(dictionaries) {
    return [...dictionaries].sort(
      (a, b) => rankOf(a) - rankOf(b) || a.addedAt - b.addedAt || a.id.localeCompare(b.id)
    );
  }
  function afterMove(ids, id, step) {
    const at = ids.indexOf(id);
    if (at < 0) return null;
    const to = at + step;
    const neighbour = ids[to];
    if (neighbour === void 0) return null;
    const moved = [...ids];
    moved[at] = neighbour;
    moved[to] = id;
    return moved;
  }
  function inChosenOrder(dictionaries, ids) {
    const place = new Map(ids.map((id, at) => [id, at]));
    const chosen = [];
    const rest = [];
    for (const dictionary of answerOrder(dictionaries)) {
      if (place.has(dictionary.id)) chosen.push(dictionary);
      else rest.push(dictionary);
    }
    chosen.sort((a, b) => (place.get(a.id) ?? 0) - (place.get(b.id) ?? 0));
    return [...chosen, ...rest];
  }
  function nextRank(dictionaries) {
    let last = -1;
    for (const dictionary of dictionaries) {
      if (typeof dictionary.rank === "number" && dictionary.rank > last) last = dictionary.rank;
    }
    return last + 1;
  }

  // src/lib/dict/store.js
  var DB_NAME = "reread-dicts";
  var DB_VERSION = 3;
  var META = "meta";
  var ENTRIES = "entries";
  var SOURCES = "sources";
  function promisify(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    });
  }
  function rankExisting(meta) {
    const all = meta.getAll();
    all.onsuccess = () => {
      answerOrder(
        /** @type {Dictionary[]} */
        all.result
      ).forEach((dictionary, at) => {
        if (dictionary.rank !== at) meta.put({ ...dictionary, rank: at });
      });
    };
  }
  function open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "id" });
        if (!db.objectStoreNames.contains(ENTRIES)) {
          db.createObjectStore(ENTRIES, { keyPath: ["dictId", "key"] });
        }
        if (!db.objectStoreNames.contains(SOURCES)) db.createObjectStore(SOURCES, { keyPath: "id" });
        const upgrade = request.transaction;
        if (upgrade !== null) rankExisting(upgrade.objectStore(META));
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Cannot open the dictionary database"));
      request.onblocked = () => reject(new Error("The dictionary database is in use by another page"));
    });
  }
  async function withStores(stores, mode, work) {
    const db = await open();
    try {
      const transaction = db.transaction(stores, mode);
      const result = await work(transaction);
      await completed(transaction);
      return result;
    } finally {
      db.close();
    }
  }
  function completed(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve(void 0);
      transaction.onerror = () => reject(transaction.error ?? new Error("Dictionary transaction failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Dictionary transaction aborted"));
    });
  }
  function rowsOf(id) {
    return IDBKeyRange.bound([id], [id, []]);
  }
  async function listDictionaries() {
    const records = (
      /** @type {Dictionary[]} */
      await withStores([META], "readonly", (transaction) => promisify(transaction.objectStore(META).getAll()))
    );
    return answerOrder(records);
  }
  async function reorderDictionaries(ids) {
    await withStores([META], "readwrite", async (transaction) => {
      const store = transaction.objectStore(META);
      const stored = (
        /** @type {Dictionary[]} */
        await promisify(store.getAll())
      );
      const ordered = inChosenOrder(stored, ids);
      for (const [at, dictionary] of ordered.entries()) {
        if (dictionary.rank === at) continue;
        await promisify(store.put({ ...dictionary, rank: at }));
      }
    });
  }
  async function beginImport({ name, langFrom, langTo, credit }) {
    return await withStores([META], "readwrite", async (transaction) => {
      const store = transaction.objectStore(META);
      const stored = (
        /** @type {Dictionary[]} */
        await promisify(store.getAll())
      );
      const dictionary = {
        id: crypto.randomUUID(),
        name,
        langFrom,
        langTo,
        entryCount: 0,
        aliasCount: 0,
        bytes: 0,
        addedAt: Date.now(),
        rank: nextRank(stored),
        ready: false,
        credit
      };
      await promisify(store.put(dictionary));
      return dictionary;
    });
  }
  async function stageSources(id, files) {
    const sources = { id, ifo: files.ifo, idx: files.idx, dict: files.dict, ...files.syn === void 0 ? {} : { syn: files.syn } };
    await withStores([SOURCES], "readwrite", async (transaction) => {
      await promisify(transaction.objectStore(SOURCES).put(sources));
    });
  }
  async function readSources(id) {
    const sources = (
      /** @type {ImportSources | undefined} */
      await withStores([SOURCES], "readonly", (transaction) => promisify(transaction.objectStore(SOURCES).get(id)))
    );
    return sources ?? null;
  }
  async function stagedIds() {
    const keys = (
      /** @type {string[]} */
      await withStores([SOURCES], "readonly", (transaction) => promisify(transaction.objectStore(SOURCES).getAllKeys()))
    );
    return new Set(keys);
  }
  function resumable(dictionary, staged) {
    return !dictionary.ready && staged.has(dictionary.id);
  }
  async function mergeAdditions(store, additions) {
    let appended = 0;
    for (const { dictId, key, senses: senses2 } of additions) {
      const row = (
        /** @type {import("./rows.js").DictionaryRow | undefined} */
        await promisify(store.get([dictId, key]))
      );
      if (row === void 0) continue;
      const added = mergeSenses(row.senses, senses2);
      if (added.length === 0) continue;
      for (const sense of added) appended += utf8Length(sense);
      store.put(row);
    }
    return appended;
  }
  async function openWriter(id) {
    const db = await open();
    db.onversionchange = () => db.close();
    const markProgress = async (meta, mark) => {
      const existing = (
        /** @type {Dictionary | undefined} */
        await promisify(meta.get(id))
      );
      if (existing === void 0) throw new Error("The dictionary was removed while it was being added");
      meta.put({ ...existing, ...mark });
    };
    return {
      put(rows, additions, mark) {
        const transaction = db.transaction([ENTRIES, META], "readwrite");
        const store = transaction.objectStore(ENTRIES);
        for (const row of rows) store.put(row);
        return Promise.all([
          mergeAdditions(store, additions),
          markProgress(transaction.objectStore(META), mark),
          completed(transaction)
        ]).then(([appended]) => appended);
      },
      close() {
        db.close();
      }
    };
  }
  async function finishImport(id, counts) {
    return await withStores([META, SOURCES], "readwrite", async (transaction) => {
      const store = transaction.objectStore(META);
      const existing = (
        /** @type {Dictionary | undefined} */
        await promisify(store.get(id))
      );
      if (existing === void 0) throw new Error("The dictionary was removed while it was being added");
      const { progress: _, ...rest } = existing;
      const ready = { ...rest, ...counts, ready: true };
      await promisify(store.put(ready));
      transaction.objectStore(SOURCES).delete(id);
      return ready;
    });
  }
  async function deleteDictionary(id) {
    await withStores([ENTRIES, SOURCES, META], "readwrite", (transaction) => {
      transaction.objectStore(ENTRIES).delete(rowsOf(id));
      transaction.objectStore(SOURCES).delete(id);
      transaction.objectStore(META).delete(id);
    });
  }
  async function removeUnfinished() {
    const staged = await stagedIds();
    const leftovers = (await listDictionaries()).filter(
      (dictionary) => !dictionary.ready && !resumable(dictionary, staged)
    );
    for (const dictionary of leftovers) await deleteDictionary(dictionary.id);
    return leftovers;
  }

  // src/lib/models/download.js
  var Refused = class extends Error {
    /**
     * @param {DownloadProblem} problem
     * @param {string} [detail]
     */
    constructor(problem, detail) {
      super(detail ?? problem);
      this.name = "Refused";
      this.problem = problem;
      this.detail = detail;
    }
  };
  function fileName2(url) {
    return url.split("?")[0]?.split("/").pop() || url;
  }
  function toArrayBuffer(view) {
    const { buffer, byteOffset, byteLength } = view;
    if (buffer instanceof ArrayBuffer && byteOffset === 0 && byteLength === buffer.byteLength) return buffer;
    return (
      /** @type {ArrayBuffer} */
      view.slice().buffer
    );
  }
  async function sha256Hex(buffer) {
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  async function unpack2(bytes) {
    const buffer = toArrayBuffer(bytes);
    if (!isGzip(buffer)) return buffer;
    try {
      const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
      return await new Response(stream).arrayBuffer();
    } catch (error) {
      throw new Refused("unpack", error instanceof Error ? error.message : String(error));
    }
  }
  async function readBody(response, onChunk, signal) {
    const body = response.body;
    if (body === null) {
      const whole = new Uint8Array(await response.arrayBuffer());
      onChunk(whole.byteLength);
      return whole;
    }
    const reader = body.getReader();
    const chunks = [];
    let size = 0;
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
      onChunk(value.byteLength);
      if (signal?.aborted) {
        await reader.cancel().catch(() => void 0);
        throw new Refused("cancelled");
      }
    }
    const all = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
      all.set(chunk, at);
      at += chunk.byteLength;
    }
    return all;
  }
  async function fetchFile(file, fetchImpl, onChunk, signal) {
    if (signal?.aborted) throw new Refused("cancelled");
    let response;
    try {
      response = await fetchImpl(file.url, { signal, cache: "no-store", redirect: "follow" });
    } catch (error) {
      if (signal?.aborted) throw new Refused("cancelled");
      throw new Refused("network", `${fileName2(file.url)}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) {
      throw new Refused("http", `${response.status} ${response.statusText} for ${fileName2(file.url)}`.trim());
    }
    let received;
    try {
      received = await readBody(response, onChunk, signal);
    } catch (error) {
      if (error instanceof Refused) throw error;
      if (signal?.aborted) throw new Refused("cancelled");
      throw new Refused("network", `${fileName2(file.url)}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const content = await unpack2(received);
    if (content.byteLength === 0) {
      throw new Refused("size", `${fileName2(file.url)}: empty`);
    }
    if (file.bytes > 0 && content.byteLength !== file.bytes) {
      throw new Refused("size", `${fileName2(file.url)}: ${content.byteLength} bytes, expected ${file.bytes}`);
    }
    if (file.sha256 !== null && await sha256Hex(content) !== file.sha256) {
      throw new Refused("checksum", fileName2(file.url));
    }
    return content;
  }
  async function downloadModel(model, options = {}) {
    const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    const { onProgress, signal } = options;
    let received = 0;
    const onChunk = (chunk) => {
      received += chunk;
      onProgress?.({ received, total: Math.max(model.downloadBytes, received) });
    };
    let modelFile = null;
    let shortlist = null;
    const vocabs = [];
    try {
      for (const file of model.files) {
        const content = await fetchFile(file, fetchImpl, onChunk, signal);
        if (file.role === "model") modelFile = content;
        else if (file.role === "shortlist") shortlist = content;
        else vocabs.push(content);
      }
    } catch (error) {
      if (error instanceof Refused) return { ok: false, problem: error.problem, ...error.detail ? { detail: error.detail } : {} };
      return { ok: false, problem: "network", detail: error instanceof Error ? error.message : String(error) };
    }
    if (modelFile === null || shortlist === null || vocabs.length === 0) {
      return { ok: false, problem: "size", detail: "the download is missing one of the three files" };
    }
    return { ok: true, value: { pair: model.pair, model: modelFile, shortlist, vocabs } };
  }
  function describeDownloadProblem(problem, detail) {
    switch (problem) {
      case "network":
        return t("model_download_network", aside(detail));
      case "http":
        return t("model_download_http", aside(detail));
      case "size":
        return t("model_download_size", aside(detail));
      case "checksum":
        return t("model_download_checksum", aside(detail));
      case "unpack":
        return t("model_download_unpack", aside(detail));
      case "cancelled":
        return t("download_cancelled");
      default:
        return t("download_failed");
    }
  }

  // src/lib/models/registry.json
  var registry_default = {
    comment: "Generated by tools/models-registry.mjs - see that file for why the sums are ours. sha256 is of the file after unpacking, which is what gets stored and handed to the engine; downloadBytes is what comes over the wire, and is only used to say what a download costs.",
    source: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/db/models.json",
    checkedAt: "2026-08-11",
    generated: "2026-08-11T00:37:33Z",
    models: [
      {
        pair: "aren",
        from: "ar",
        to: "en",
        architecture: "base-memory",
        downloadBytes: 25901017,
        bytes: 37049022,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/ar-en/retrain_base-memory_X9fDxFreTOCslPKzb1CXTg/exported/model.aren.intgemm.alphas.bin.gz",
            downloadBytes: 23224456,
            bytes: 31561787,
            sha256: "7b7af0282dc5f4d8805b9a298c2fa828967e3f09ca10f1942ebeea0b2cfc12fa"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/ar-en/retrain_base-memory_X9fDxFreTOCslPKzb1CXTg/exported/lex.50.50.aren.s2t.bin.gz",
            downloadBytes: 2259861,
            bytes: 4627200,
            sha256: "4b45f14dbea40d368093a13563fc1ca48457ee70c1291c82b206f3baff210081"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/ar-en/retrain_base-memory_X9fDxFreTOCslPKzb1CXTg/exported/vocab.aren.spm.gz",
            downloadBytes: 416700,
            bytes: 860035,
            sha256: "51b4ee3f828d10015464523d0b4f5a6c086b0b2a9bde716a581001cf6c260366"
          }
        ]
      },
      {
        pair: "bgen",
        from: "bg",
        to: "en",
        architecture: "base-memory",
        downloadBytes: 25021262,
        bytes: 36840189,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/bg-en/retrain_hr_WvwHu4k6TgmJ2YTvL4Mu2g/exported/model.bgen.intgemm.alphas.bin.gz",
            downloadBytes: 22399269,
            bytes: 31561787,
            sha256: "78f7e6e1435cc2d4a29cf597f493187fe29ddb9ce9d3766c287e2e6d37052d01"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/bg-en/retrain_hr_WvwHu4k6TgmJ2YTvL4Mu2g/exported/lex.50.50.bgen.s2t.bin.gz",
            downloadBytes: 2187053,
            bytes: 4355920,
            sha256: "e661dfdd88aa9ff9606f237a60c910d97c2e710960199589579f628c5d8aa899"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/bg-en/retrain_hr_WvwHu4k6TgmJ2YTvL4Mu2g/exported/vocab.bgen.spm.gz",
            downloadBytes: 434940,
            bytes: 922482,
            sha256: "4bafad5fcc0e771ed82233d1e99d69dcb96487b430702f7e688615c8a61f3df4"
          }
        ]
      },
      {
        pair: "bnen",
        from: "bn",
        to: "en",
        architecture: "tiny",
        downloadBytes: 15367712,
        bytes: 22915947,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/bn-en/h1-2025_XcpBlhA1SyOJCH2UzoIMyQ/exported/model.bnen.intgemm.alphas.bin.gz",
            downloadBytes: 12665857,
            bytes: 17141051,
            sha256: "14c1d9e92918e8d04cb0ed351ae386c3b5d5c62a6dc601d9515f4c7e6c2a3a56"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/bn-en/h1-2025_XcpBlhA1SyOJCH2UzoIMyQ/exported/lex.50.50.bnen.s2t.bin.gz",
            downloadBytes: 2264284,
            bytes: 4793596,
            sha256: "aea901a6bd8722962551c0349b8570af684444028b62bbff465be9931e6e9800"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/bn-en/h1-2025_XcpBlhA1SyOJCH2UzoIMyQ/exported/vocab.bnen.spm.gz",
            downloadBytes: 437571,
            bytes: 981300,
            sha256: "8a6a4de992ccd47bae4227ec6420866374137d6cc88ed6e8b2f16b36322a9d37"
          }
        ]
      },
      {
        pair: "caen",
        from: "ca",
        to: "en",
        architecture: "base-memory",
        downloadBytes: 25454995,
        bytes: 36731612,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/ca-en/target-side-dedup_xxxxxxxxRxSxxxxxxxxxxA/exported/model.caen.intgemm.alphas.bin.gz",
            downloadBytes: 22787743,
            bytes: 31561787,
            sha256: "b7f9c70823052f60c257eb1c4eff893abea3648aa9d1c23c8774e1e5ef061434"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/ca-en/target-side-dedup_xxxxxxxxRxSxxxxxxxxxxA/exported/lex.50.50.caen.s2t.bin.gz",
            downloadBytes: 2257590,
            bytes: 4359552,
            sha256: "74880047539925630601d61aa6c29a0672046236ca6cf33eeaf6f6f6690e914e"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/ca-en/target-side-dedup_xxxxxxxxRxSxxxxxxxxxxA/exported/vocab.caen.spm.gz",
            downloadBytes: 409662,
            bytes: 810273,
            sha256: "6d22da90905873c2793d0805e34e5c27901b16e7e7a7a427696696f67dfe1f0e"
          }
        ]
      },
      {
        pair: "csen",
        from: "cs",
        to: "en",
        architecture: "base-memory",
        downloadBytes: 25736689,
        bytes: 37367529,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/cs-en/retrain_hr_EwWhUov8TP6D_oolATvbUA/exported/model.csen.intgemm.alphas.bin.gz",
            downloadBytes: 22830296,
            bytes: 31561787,
            sha256: "c815273b31074492eaab0ccd78d33d7ac16f94088707ab2492abaedcb9ee0b75"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/cs-en/retrain_hr_EwWhUov8TP6D_oolATvbUA/exported/lex.50.50.csen.s2t.bin.gz",
            downloadBytes: 2493702,
            bytes: 4990588,
            sha256: "eba6bd9575251525f1941640ea0b6527a06e72a46421579eafea04d635ee20a8"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/cs-en/retrain_hr_EwWhUov8TP6D_oolATvbUA/exported/vocab.csen.spm.gz",
            downloadBytes: 412691,
            bytes: 815154,
            sha256: "ee4b8ce15c8e1237c5f7a2d04741341beb0a5d5c09820f7ec08f13ee2b212755"
          }
        ]
      },
      {
        pair: "daen",
        from: "da",
        to: "en",
        architecture: "tiny",
        downloadBytes: 15096083,
        bytes: 22426481,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/da-en/spring-2024_U1vVpsWWT-K4L9pRfP1K1g/exported/model.daen.intgemm.alphas.bin.gz",
            downloadBytes: 12525769,
            bytes: 17141051,
            sha256: "2c1ace24220c905404bbb1de14bfeda8a391ef8d6c56f3b193a9d3e340d99b12"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/da-en/spring-2024_U1vVpsWWT-K4L9pRfP1K1g/exported/lex.50.50.daen.s2t.bin.gz",
            downloadBytes: 2170970,
            bytes: 4489412,
            sha256: "e5f50fba646e0d3cedf2957575aa84c3bdca6798ce32ccd63c956fc043d774a3"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/da-en/spring-2024_U1vVpsWWT-K4L9pRfP1K1g/exported/vocab.daen.spm.gz",
            downloadBytes: 399344,
            bytes: 796018,
            sha256: "b9392fcd9c53b802628d33a160f6eb52ca3d25a07ec9e015ab93b6bd5c7e8033"
          }
        ]
      },
      {
        pair: "deen",
        from: "de",
        to: "en",
        architecture: "base-memory",
        downloadBytes: 25444292,
        bytes: 37317656,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/de-en/retrain_hr2_WZOW24i4QJmIib61LeHfwg/exported/model.deen.intgemm.alphas.bin.gz",
            downloadBytes: 22403755,
            bytes: 31561787,
            sha256: "3e6f7c2c2425d10824797270b382bee718ff34af2cab9308841c82ca46dc6f20"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/de-en/retrain_hr2_WZOW24i4QJmIib61LeHfwg/exported/lex.50.50.deen.s2t.bin.gz",
            downloadBytes: 2626658,
            bytes: 4945796,
            sha256: "113b98460468360cca68c042e1cddf49c4e1931cbb975ed04349c9a3bd607010"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/de-en/retrain_hr2_WZOW24i4QJmIib61LeHfwg/exported/vocab.deen.spm.gz",
            downloadBytes: 413879,
            bytes: 810073,
            sha256: "69f730becafa48e3bb2c244eab66456877c08959a02f2bd5519b5a3088b62f9c"
          }
        ]
      },
      {
        pair: "elen",
        from: "el",
        to: "en",
        architecture: "tiny",
        downloadBytes: 14966961,
        bytes: 22331871,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/el-en/spring-2024_RJucgx7LRMKB9E4oSSzdtA/exported/model.elen.intgemm.alphas.bin.gz",
            downloadBytes: 12696541,
            bytes: 17141051,
            sha256: "0a43c3716156061494d995d0c88113e789f8d919e0c88a15bc1ad360e0482a8c"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/el-en/spring-2024_RJucgx7LRMKB9E4oSSzdtA/exported/lex.50.50.elen.s2t.bin.gz",
            downloadBytes: 1851246,
            bytes: 4295860,
            sha256: "2c969b069b3d230feddd17db2d74eb658a9b33b960d2d40adbca5496c9784e85"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/el-en/spring-2024_RJucgx7LRMKB9E4oSSzdtA/exported/vocab.elen.spm.gz",
            downloadBytes: 419174,
            bytes: 894960,
            sha256: "e1a1298cc2cf3968f3d7cc3b36bc463a4e1bf154272e8fb2f15142b54edc4349"
          }
        ]
      },
      {
        pair: "enar",
        from: "en",
        to: "ar",
        architecture: "base-memory",
        downloadBytes: 24915968,
        bytes: 35565070,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-ar/retrain_base-memory_G3CmhwG_TZext3cys-udHg/exported/model.enar.intgemm.alphas.bin.gz",
            downloadBytes: 22857819,
            bytes: 31561787,
            sha256: "ae659d7045fc2e5d6ba50583586a5d94ee4358d92c019847e37b57a0e627faa8"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-ar/retrain_base-memory_G3CmhwG_TZext3cys-udHg/exported/lex.50.50.enar.s2t.bin.gz",
            downloadBytes: 1639219,
            bytes: 3139692,
            sha256: "2b7194817c5dd9225ca90c0d908cc92e1d6d1f45625781a5feb037ac568d6a61"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-ar/retrain_base-memory_G3CmhwG_TZext3cys-udHg/exported/vocab.enar.spm.gz",
            downloadBytes: 418930,
            bytes: 863591,
            sha256: "8d93c54aa5e2044c416ec680b5ff9af0227bd698521666e8b1a1ea1b041fbae8"
          }
        ]
      },
      {
        pair: "enaz",
        from: "en",
        to: "az",
        architecture: "tiny",
        downloadBytes: 15363608,
        bytes: 21309164,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-az/h1-2025_fu1HFuR0QY-zVBcKYQkJIA/exported/model.enaz.intgemm.alphas.bin.gz",
            downloadBytes: 13233108,
            bytes: 17141051,
            sha256: "9c87aa09ff4f81c320993fe412624ca3584fe9ccf5371247d64f1117dffcf168"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-az/h1-2025_fu1HFuR0QY-zVBcKYQkJIA/exported/lex.50.50.enaz.s2t.bin.gz",
            downloadBytes: 1711544,
            bytes: 3332384,
            sha256: "f87f5de2674cf48562df60843a658e0000bedfd75aa8ffa5e251e2cb1321f255"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-az/h1-2025_fu1HFuR0QY-zVBcKYQkJIA/exported/vocab.enaz.spm.gz",
            downloadBytes: 418956,
            bytes: 835729,
            sha256: "afc1f4d7d20cd04addd3bc605acfdb83afbf62fb76d1a6bbc94cf42bf0286108"
          }
        ]
      },
      {
        pair: "enbg",
        from: "en",
        to: "bg",
        architecture: "base-memory",
        downloadBytes: 25415532,
        bytes: 35560217,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-bg/retrain_hr_eAF9fkYRScmBmvvfdT4XWw/exported/model.enbg.intgemm.alphas.bin.gz",
            downloadBytes: 23432015,
            bytes: 31561787,
            sha256: "e2b30db98ac6706efc893067a74e51f36f015a8f820fe8a4f0f5052fa6a22f30"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-bg/retrain_hr_eAF9fkYRScmBmvvfdT4XWw/exported/lex.50.50.enbg.s2t.bin.gz",
            downloadBytes: 1548577,
            bytes: 3075948,
            sha256: "93d4ca4412db269cc4164cbfa04c08edd0f65690c8264d6215a0522d4a13ec1a"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-bg/retrain_hr_eAF9fkYRScmBmvvfdT4XWw/exported/vocab.enbg.spm.gz",
            downloadBytes: 434940,
            bytes: 922482,
            sha256: "4bafad5fcc0e771ed82233d1e99d69dcb96487b430702f7e688615c8a61f3df4"
          }
        ]
      },
      {
        pair: "enbn",
        from: "en",
        to: "bn",
        architecture: "tiny",
        downloadBytes: 14866591,
        bytes: 21329765,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-bn/h1-2025_TYlSskC_Sk6lBlfWRetXmg/exported/model.enbn.intgemm.alphas.bin.gz",
            downloadBytes: 12821521,
            bytes: 17141051,
            sha256: "b63c8d5f8fdc1fcb8bbb2d20c751faab94af67ee1822427665119c93a11f6596"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-bn/h1-2025_TYlSskC_Sk6lBlfWRetXmg/exported/lex.50.50.enbn.s2t.bin.gz",
            downloadBytes: 1607697,
            bytes: 3207488,
            sha256: "74ad4234a0a9cf57b21d99b34fefc14f7c731d7e76da7940eb0155c13a234b5e"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-bn/h1-2025_TYlSskC_Sk6lBlfWRetXmg/exported/vocab.enbn.spm.gz",
            downloadBytes: 437373,
            bytes: 981226,
            sha256: "8895bebb290adc2a5ef46710d81be13d341883a8c6c233e0c060f968df0deef4"
          }
        ]
      },
      {
        pair: "enbs",
        from: "en",
        to: "bs",
        architecture: "base-memory",
        downloadBytes: 25027895,
        bytes: 35599859,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-bs/hbs-topk10_HBBkp2ozSYaY9f7WVGRtpA/exported/model.enbs.intgemm.alphas.bin.gz",
            downloadBytes: 22932779,
            bytes: 31561787,
            sha256: "27575113fffad6c45a0bad36bd1823c4f319ed30f65ec134815b67bdae0d9f8d"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-bs/hbs-topk10_HBBkp2ozSYaY9f7WVGRtpA/exported/lex.50.50.enbs.s2t.bin.gz",
            downloadBytes: 1682912,
            bytes: 3214628,
            sha256: "6847523f4d5df9425cda606e73f404c07e19452dac7659bdcc92743c46cba3c0"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-bs/hbs-topk10_HBBkp2ozSYaY9f7WVGRtpA/exported/vocab.enbs.spm.gz",
            downloadBytes: 412204,
            bytes: 823444,
            sha256: "dfed9c3e08e85a22feac7748a20fa981dca94f358115af2f45d704b9cc944cc8"
          }
        ]
      },
      {
        pair: "enca",
        from: "en",
        to: "ca",
        architecture: "base-memory",
        downloadBytes: 25670249,
        bytes: 36716532,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-ca/short-sentences_dqpjVFEaT2WLVB2nV0_H2g/exported/model.enca.intgemm.alphas.bin.gz",
            downloadBytes: 23174479,
            bytes: 31561787,
            sha256: "735881c99ff303e55eb2e92a3b86762523d5dd1a4797b2574b851062051426ee"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-ca/short-sentences_dqpjVFEaT2WLVB2nV0_H2g/exported/lex.50.50.enca.s2t.bin.gz",
            downloadBytes: 2085904,
            bytes: 4344092,
            sha256: "8f2151a7fb75454f5167a8df8758ec02ab02c0302893851bad7caa6b729822fb"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-ca/short-sentences_dqpjVFEaT2WLVB2nV0_H2g/exported/vocab.enca.spm.gz",
            downloadBytes: 409866,
            bytes: 810653,
            sha256: "64ebcb5f6cb5a954ced615e48a44a85e77a644e4910544014b299b8ee0fa1b1f"
          }
        ]
      },
      {
        pair: "encs",
        from: "en",
        to: "cs",
        architecture: "base-memory",
        downloadBytes: 25501917,
        bytes: 35949377,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-cs/retrain_hr_F_JF0vqvSjSwn3caQQcicA/exported/model.encs.intgemm.alphas.bin.gz",
            downloadBytes: 23192301,
            bytes: 31561787,
            sha256: "1d7855f91c3e2b8ef79fbea62707d46ceb8a1ad01834ef6dd500f32a7006cc2c"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-cs/retrain_hr_F_JF0vqvSjSwn3caQQcicA/exported/lex.50.50.encs.s2t.bin.gz",
            downloadBytes: 1896925,
            bytes: 3572436,
            sha256: "699b9b59fe3acbcddf831380024b2e139f2cbe225dce96d59ade2b159318f58b"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-cs/retrain_hr_F_JF0vqvSjSwn3caQQcicA/exported/vocab.encs.spm.gz",
            downloadBytes: 412691,
            bytes: 815154,
            sha256: "ee4b8ce15c8e1237c5f7a2d04741341beb0a5d5c09820f7ec08f13ee2b212755"
          }
        ]
      },
      {
        pair: "enda",
        from: "en",
        to: "da",
        architecture: "tiny",
        downloadBytes: 14705475,
        bytes: 21801188,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-da/spring-2024_XUm0Ij8WSfabkKeKA_Xv_g/exported/model.enda.intgemm.alphas.bin.gz",
            downloadBytes: 12723889,
            bytes: 17141051,
            sha256: "0157ed1162dd5a7a0fc6a3cc86014ec21cb47a8febf77164df24d8921270bb29"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-da/spring-2024_XUm0Ij8WSfabkKeKA_Xv_g/exported/lex.50.50.enda.s2t.bin.gz",
            downloadBytes: 1582768,
            bytes: 3864788,
            sha256: "d183786cae59a5df06d5b00c58e3ec2a5791d302240a65540fc6a1da2b66eada"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-da/spring-2024_XUm0Ij8WSfabkKeKA_Xv_g/exported/vocab.enda.spm.gz",
            downloadBytes: 398818,
            bytes: 795349,
            sha256: "b06349522bf053e4a6f01efc4d1450e4fe35717a938a82831988c087229c9619"
          }
        ]
      },
      {
        pair: "ende",
        from: "en",
        to: "de",
        architecture: "base-memory",
        downloadBytes: 25720702,
        bytes: 36719532,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-de/retrain_hr_fix_names_SCgGhxUPQ2WAECHLRtzrMg/exported/model.ende.intgemm.alphas.bin.gz",
            downloadBytes: 22992073,
            bytes: 31561787,
            sha256: "8df29d9494d19f47fd5d97c6a73474c6f657e9f81c1a607c431d02befdf3810f"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-de/retrain_hr_fix_names_SCgGhxUPQ2WAECHLRtzrMg/exported/lex.50.50.ende.s2t.bin.gz",
            downloadBytes: 2314750,
            bytes: 4347672,
            sha256: "7ed39f1cffbd68a27ddf05bbfe068de2060f1d7e69f1a20e27ae923551dd7393"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-de/retrain_hr_fix_names_SCgGhxUPQ2WAECHLRtzrMg/exported/vocab.ende.spm.gz",
            downloadBytes: 413879,
            bytes: 810073,
            sha256: "69f730becafa48e3bb2c244eab66456877c08959a02f2bd5519b5a3088b62f9c"
          }
        ]
      },
      {
        pair: "enel",
        from: "en",
        to: "el",
        architecture: "tiny",
        downloadBytes: 14579945,
        bytes: 20893943,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-el/spring-2024_Y3ThG3XkTxG4ROUQK2LpVg/exported/model.enel.intgemm.alphas.bin.gz",
            downloadBytes: 12808027,
            bytes: 17141051,
            sha256: "724b358d399c6b23444de36d76e9e2630c7024c29d9e617323b820a11631535a"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-el/spring-2024_Y3ThG3XkTxG4ROUQK2LpVg/exported/lex.50.50.enel.s2t.bin.gz",
            downloadBytes: 1352643,
            bytes: 2856724,
            sha256: "c2acd9241eb8a1e5b13a43efa5723628839d6e3b3dc7b93e2f20990a6ab81e24"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-el/spring-2024_Y3ThG3XkTxG4ROUQK2LpVg/exported/vocab.enel.spm.gz",
            downloadBytes: 419275,
            bytes: 896168,
            sha256: "0ffc5569d7f400f03539c5fc3e28ff35f1d0381eba0ec866c44aef0c26f3ce5e"
          }
        ]
      },
      {
        pair: "enes",
        from: "en",
        to: "es",
        architecture: "base-memory",
        downloadBytes: 25373354,
        bytes: 36576277,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-es/retrain_hr_fix_names_CUAEXUHoQum_cFqh-ZAryw/exported/model.enes.intgemm.alphas.bin.gz",
            downloadBytes: 22698792,
            bytes: 31561787,
            sha256: "3b1c399511c01c84c36fae5c0524df44096288efdc8236e182b5c97d7ad2244c"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-es/retrain_hr_fix_names_CUAEXUHoQum_cFqh-ZAryw/exported/lex.50.50.enes.s2t.bin.gz",
            downloadBytes: 2265250,
            bytes: 4198436,
            sha256: "7d51237c0a07027dcd61643cfbbb0f8c48597d19907ef53d2cae9d6bec2cf25c"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-es/retrain_hr_fix_names_CUAEXUHoQum_cFqh-ZAryw/exported/vocab.enes.spm.gz",
            downloadBytes: 409312,
            bytes: 816054,
            sha256: "5ae254fa9b15aa182e70fd2a6186b1333c63a29a48043a9224c6aa4fcac058ad"
          }
        ]
      },
      {
        pair: "enet",
        from: "en",
        to: "et",
        architecture: "base-memory",
        downloadBytes: 25231423,
        bytes: 35867729,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-et/retrain_hr_GubU3EaMRY2VkR8p1dPUNw/exported/model.enet.intgemm.alphas.bin.gz",
            downloadBytes: 22951751,
            bytes: 31561787,
            sha256: "36bdc87f8d500861a5d286ebd3ea58df530da87e31b8a233f5e9c46c300c281d"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-et/retrain_hr_GubU3EaMRY2VkR8p1dPUNw/exported/lex.50.50.enet.s2t.bin.gz",
            downloadBytes: 1865410,
            bytes: 3488368,
            sha256: "259c60582f49449c226a6e5a369481c68322013f367e459e54c595686c05d4d8"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-et/retrain_hr_GubU3EaMRY2VkR8p1dPUNw/exported/vocab.enet.spm.gz",
            downloadBytes: 414262,
            bytes: 817574,
            sha256: "89a3deea4ae7d674fb46a4dae39135dd4dfaac9786f2868d0b5bc5c0aca2ef83"
          }
        ]
      },
      {
        pair: "eneu",
        from: "en",
        to: "eu",
        architecture: "base-memory",
        downloadBytes: 25116821,
        bytes: 35532187,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-eu/eneu-baseline_IXuA7hOrQPCVZJOp6LIYVw/exported/model.eneu.intgemm.alphas.bin.gz",
            downloadBytes: 23068167,
            bytes: 31561787,
            sha256: "f28d03817b718806c9262e3d76960efb8cbd04d0721307c8e23edcae9364150a"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-eu/eneu-baseline_IXuA7hOrQPCVZJOp6LIYVw/exported/lex.50.50.eneu.s2t.bin.gz",
            downloadBytes: 1638880,
            bytes: 3149580,
            sha256: "a6a856a89acc6bbf970b6c5e51fe705bee6fe2b8007a3c31ae54ca2c6fd69aad"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-eu/eneu-baseline_IXuA7hOrQPCVZJOp6LIYVw/exported/vocab.eneu.spm.gz",
            downloadBytes: 409774,
            bytes: 820820,
            sha256: "d0cbd7a04e20c3a45bcf29260967db26a97c4787c03a9d867df0465bc104cec2"
          }
        ]
      },
      {
        pair: "enfa",
        from: "en",
        to: "fa",
        architecture: "tiny",
        downloadBytes: 15203098,
        bytes: 21615516,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-fa/h1-2025_c_TYU1BOTByxOnnkAunO7g/exported/model.enfa.intgemm.alphas.bin.gz",
            downloadBytes: 13058508,
            bytes: 17141051,
            sha256: "456ad3952bcc59d208c76baba4dcef340ee4239416bd760d6fec27f9a16228f8"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-fa/h1-2025_c_TYU1BOTByxOnnkAunO7g/exported/lex.50.50.enfa.s2t.bin.gz",
            downloadBytes: 1728367,
            bytes: 3631332,
            sha256: "8542e7fb2bfa3a11b89f8392b8adb0dbbf863cd34569488b7c4535a91c3ae6b4"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-fa/h1-2025_c_TYU1BOTByxOnnkAunO7g/exported/vocab.enfa.spm.gz",
            downloadBytes: 416223,
            bytes: 843133,
            sha256: "6435d3d9d766159fe192ab90892540b438ad7adb7ab4ea4049f68d0b4cdea3bd"
          }
        ]
      },
      {
        pair: "enfi",
        from: "en",
        to: "fi",
        architecture: "base-memory",
        downloadBytes: 24869864,
        bytes: 35870649,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-fi/retrain_hr_b45LsGaNQFyDRhHAvBbKrA/exported/model.enfi.intgemm.alphas.bin.gz",
            downloadBytes: 22580027,
            bytes: 31561787,
            sha256: "88b0caa4cc6980d632801cb2b1950748f1dc43ad2ac83678917ad86c720b5cdd"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-fi/retrain_hr_b45LsGaNQFyDRhHAvBbKrA/exported/lex.50.50.enfi.s2t.bin.gz",
            downloadBytes: 1875557,
            bytes: 3490092,
            sha256: "26e95a87f87e4b0fa9a35524cf9fea691204504453877ba4ac81ccc66af1488c"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-fi/retrain_hr_b45LsGaNQFyDRhHAvBbKrA/exported/vocab.enfi.spm.gz",
            downloadBytes: 414280,
            bytes: 818770,
            sha256: "6a866911427f2916609ae89c7f2f04a78de3fdd8aa183039ecba986635d4f246"
          }
        ]
      },
      {
        pair: "enfr",
        from: "en",
        to: "fr",
        architecture: "base-memory",
        downloadBytes: 25752472,
        bytes: 36749127,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-fr/retrain_hr_NLIxDbE1TBGyOTI-zwZagw/exported/model.enfr.intgemm.alphas.bin.gz",
            downloadBytes: 23045432,
            bytes: 31561787,
            sha256: "6322e296d4fecfe395a8d5723da4ec37ecbe6d7613bb1dfcf4b28e2a47498b68"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-fr/retrain_hr_NLIxDbE1TBGyOTI-zwZagw/exported/lex.50.50.enfr.s2t.bin.gz",
            downloadBytes: 2297334,
            bytes: 4372936,
            sha256: "2585ed98d3af0bc949865aedeb390493d591f56870814376e73e4144c41ed059"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-fr/retrain_hr_NLIxDbE1TBGyOTI-zwZagw/exported/vocab.enfr.spm.gz",
            downloadBytes: 409706,
            bytes: 814404,
            sha256: "783abf3abe075afdf8d85d233994bef2c3a064e935ab1bed946820aff6ac002a"
          }
        ]
      },
      {
        pair: "engl",
        from: "en",
        to: "gl",
        architecture: "base-memory",
        downloadBytes: 25436493,
        bytes: 35396493,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-gl/engl-finetranslations_d_vpGU94Qz-VGUAvC-QW1w/exported/model.engl.intgemm.alphas.bin.gz",
            downloadBytes: 23427851,
            bytes: 31561787,
            sha256: "bec08e5408932c3813ccfb565ab7003d334dd6ca148c9d2bd074e17b8c0be1b1"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-gl/engl-finetranslations_d_vpGU94Qz-VGUAvC-QW1w/exported/lex.50.50.engl.s2t.bin.gz",
            downloadBytes: 1598079,
            bytes: 3007680,
            sha256: "28621d3797a945ca0112c872640686586e77957b5421b0ef95886806b09d8874"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-gl/engl-finetranslations_d_vpGU94Qz-VGUAvC-QW1w/exported/vocab.engl.spm.gz",
            downloadBytes: 410563,
            bytes: 827026,
            sha256: "da044600f961c4c977e747cc9fb8afd4c05829629033d344a575a93807ea1cba"
          }
        ]
      },
      {
        pair: "engu",
        from: "en",
        to: "gu",
        architecture: "tiny",
        downloadBytes: 14621890,
        bytes: 21285646,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-gu/h1-2025_Na2-WpCIR1Sdy17l-XDeLA/exported/model.engu.intgemm.alphas.bin.gz",
            downloadBytes: 12657911,
            bytes: 17141051,
            sha256: "0f2c8bc7f13ecb9b89459e8fd9af6d8736e0f6b1c8f8a80f747fcdc030d0a588"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-gu/h1-2025_Na2-WpCIR1Sdy17l-XDeLA/exported/lex.50.50.engu.s2t.bin.gz",
            downloadBytes: 1529098,
            bytes: 3179500,
            sha256: "5699d5f0f6265766c57e8e860596091d16a7ea68e9e181a3310b8b52d79f8b5e"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-gu/h1-2025_Na2-WpCIR1Sdy17l-XDeLA/exported/vocab.engu.spm.gz",
            downloadBytes: 434881,
            bytes: 965095,
            sha256: "74ce11b041bfc527eedded78594498419c781c81a3fcb3384a3485af70cc2325"
          }
        ]
      },
      {
        pair: "enhe",
        from: "en",
        to: "he",
        architecture: "tiny",
        downloadBytes: 14958840,
        bytes: 21052116,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-he/h1-2025_QtanzRiDRISacRVw4WzWYQ/exported/model.enhe.intgemm.alphas.bin.gz",
            downloadBytes: 12979964,
            bytes: 17141051,
            sha256: "e37ac6e6f131704c85deb94a657aa20afbb44db2879f44aec9c33a34f4467587"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-he/h1-2025_QtanzRiDRISacRVw4WzWYQ/exported/lex.50.50.enhe.s2t.bin.gz",
            downloadBytes: 1567190,
            bytes: 3066048,
            sha256: "8795f4c5e19b4a196c9ed394c275a28a09e5ddbbf47ae16faa4446bf2b8bc7d9"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-he/h1-2025_QtanzRiDRISacRVw4WzWYQ/exported/vocab.enhe.spm.gz",
            downloadBytes: 411686,
            bytes: 845017,
            sha256: "672b334afa84011200fdaee02c2fc7810910c35ae9ea7619be073c851703ce9e"
          }
        ]
      },
      {
        pair: "enhi",
        from: "en",
        to: "hi",
        architecture: "tiny",
        downloadBytes: 14856351,
        bytes: 21571231,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-hi/h1-2025_KoJuCNf_Q42R2Bz6j2jlOQ/exported/model.enhi.intgemm.alphas.bin.gz",
            downloadBytes: 12736263,
            bytes: 17141051,
            sha256: "18682fa6aa1c1b2f78a6fcbcb354755094d623e65436ef7821720c5213e11a49"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-hi/h1-2025_KoJuCNf_Q42R2Bz6j2jlOQ/exported/lex.50.50.enhi.s2t.bin.gz",
            downloadBytes: 1690062,
            bytes: 3504820,
            sha256: "b473f6fe41cdb7c1dbeeb714fc50314feab77b0af2b2da6f7830ee14492dd847"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-hi/h1-2025_KoJuCNf_Q42R2Bz6j2jlOQ/exported/vocab.enhi.spm.gz",
            downloadBytes: 430026,
            bytes: 925360,
            sha256: "8017cbf812bae400794c424699b89de90db06ac7a4ca67a420013a9f68b270c1"
          }
        ]
      },
      {
        pair: "enhr",
        from: "en",
        to: "hr",
        architecture: "base-memory",
        downloadBytes: 24882698,
        bytes: 35615197,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-hr/hbs-topk10_PLHJ-5OxSNyWlwZM12Kghw/exported/model.enhr.intgemm.alphas.bin.gz",
            downloadBytes: 22758240,
            bytes: 31561787,
            sha256: "2f34590dff70aec009d3c6e9bee7a4a18aa6a0a1978c7dc49c686eb454b77704"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-hr/hbs-topk10_PLHJ-5OxSNyWlwZM12Kghw/exported/lex.50.50.enhr.s2t.bin.gz",
            downloadBytes: 1713561,
            bytes: 3232644,
            sha256: "70cf1afc8aeb6d7ed7dc269ccdd4e40e2d139a2b1106313c94210d32b14bc845"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-hr/hbs-topk10_PLHJ-5OxSNyWlwZM12Kghw/exported/vocab.enhr.spm.gz",
            downloadBytes: 410897,
            bytes: 820766,
            sha256: "6b86a23aac0ba7aae69218826600afe1c70b3e5830814d9428f7248d23e016f8"
          }
        ]
      },
      {
        pair: "enhu",
        from: "en",
        to: "hu",
        architecture: "base-memory",
        downloadBytes: 25884324,
        bytes: 35858196,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-hu/h1-2025_J8_9zNmQT2GfHg7_heOI_Q/exported/model.enhu.intgemm.alphas.bin.gz",
            downloadBytes: 23710206,
            bytes: 31561787,
            sha256: "ec0c210d09cd5d8a5edf7a50462db0a8fb5dd78d03bbc6d4d72d91074f0490e4"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-hu/h1-2025_J8_9zNmQT2GfHg7_heOI_Q/exported/lex.50.50.enhu.s2t.bin.gz",
            downloadBytes: 1768398,
            bytes: 3490288,
            sha256: "f3d1e61003597d1cc9d87e05d2b398a7ae2b3941e3f96947764aac239df1a808"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-hu/h1-2025_J8_9zNmQT2GfHg7_heOI_Q/exported/vocab.enhu.spm.gz",
            downloadBytes: 405720,
            bytes: 806121,
            sha256: "2eee837cfdcc45c091d025f585d3fcdb293db7794e316b38a0aeff8c47a659e0"
          }
        ]
      },
      {
        pair: "enid",
        from: "en",
        to: "id",
        architecture: "tiny",
        downloadBytes: 14617628,
        bytes: 21429690,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-id/spring-2024_bbjDBFoDTNGSUo2if3ET_A/exported/model.enid.intgemm.alphas.bin.gz",
            downloadBytes: 12503257,
            bytes: 17141051,
            sha256: "f81f13eef703a4e0650ffc3138a0f4bab7b6c8bfd173ef1b7bda68d16b8bc7e8"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-id/spring-2024_bbjDBFoDTNGSUo2if3ET_A/exported/lex.50.50.enid.s2t.bin.gz",
            downloadBytes: 1734565,
            bytes: 3515428,
            sha256: "d37f72bcab6e7bc52fd223350f95521b5810bb2486a97275f86077988fced3f4"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-id/spring-2024_bbjDBFoDTNGSUo2if3ET_A/exported/vocab.enid.spm.gz",
            downloadBytes: 379806,
            bytes: 773211,
            sha256: "61bc7db24d3b6de638a02a280580a273fe0c942ecbe8a8204b2f81978211db22"
          }
        ]
      },
      {
        pair: "enis",
        from: "en",
        to: "is",
        architecture: "base-memory",
        downloadBytes: 24979335,
        bytes: 36209342,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-is/docmt-vocab_EkZBaZqDS5Cce_lC2BpxlA/exported/model.enis.intgemm.alphas.bin.gz",
            downloadBytes: 22588003,
            bytes: 31561787,
            sha256: "459626236a49158aa555facd23e5f594e2f8416f4ebad32e0548af94c5b1ae0c"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-is/docmt-vocab_EkZBaZqDS5Cce_lC2BpxlA/exported/lex.50.50.enis.s2t.bin.gz",
            downloadBytes: 1977789,
            bytes: 3837564,
            sha256: "4927d2bed702141b4ddd8a5e7034b27fb17312fdb7e3cc5f455ccf2e2f6670e0"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-is/docmt-vocab_EkZBaZqDS5Cce_lC2BpxlA/exported/vocab.enis.spm.gz",
            downloadBytes: 413543,
            bytes: 809991,
            sha256: "61b2ea10edbe4cc61e36c833cacc2f55778ed9ca860cd382729060634d4b0adb"
          }
        ]
      },
      {
        pair: "enit",
        from: "en",
        to: "it",
        architecture: "base-memory",
        downloadBytes: 26509835,
        bytes: 36507703,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-it/retrain_hr_fix_names_GPSr_u8PSmC9fOx1ZDCHoA/exported/model.enit.intgemm.alphas.bin.gz",
            downloadBytes: 23892889,
            bytes: 31561787,
            sha256: "248f47568788ecc351da7e5e07064d4153b4f71e011364ae2c931ffeec4d1cc2"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-it/retrain_hr_fix_names_GPSr_u8PSmC9fOx1ZDCHoA/exported/lex.50.50.enit.s2t.bin.gz",
            downloadBytes: 2209348,
            bytes: 4133192,
            sha256: "8b21914804625b2777dae7fdb636eb78f02a3eb8b7bceaa50f29ac740961da93"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-it/retrain_hr_fix_names_GPSr_u8PSmC9fOx1ZDCHoA/exported/vocab.enit.spm.gz",
            downloadBytes: 407598,
            bytes: 812724,
            sha256: "3ef0211d4ae6db21440892f180f2019fe2bfc110a330ffa9d2eca9665e4f2bc5"
          }
        ]
      },
      {
        pair: "enja",
        from: "en",
        to: "ja",
        architecture: "base-memory",
        downloadBytes: 36229257,
        bytes: 49601566,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-ja/llmaat_finetune10M_qe8_f2_ApiGGQIwTKuF9i_k3n9Q2Q/exported/model.enja.intgemm.alphas.bin.gz",
            downloadBytes: 33052218,
            bytes: 43849787,
            sha256: "59ae659f9bb63e4f81f474fe3c03d3f4499434b5f9e779fab7c12a45f31fd562"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-ja/llmaat_finetune10M_qe8_f2_ApiGGQIwTKuF9i_k3n9Q2Q/exported/lex.50.50.enja.s2t.bin.gz",
            downloadBytes: 2341409,
            bytes: 4128360,
            sha256: "edfb7eb47b98a2689b804ab3614c31b24f1257aa54b1154da3d85e1ae8152d9f"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-ja/llmaat_finetune10M_qe8_f2_ApiGGQIwTKuF9i_k3n9Q2Q/exported/srcvocab.enja.spm.gz",
            downloadBytes: 404352,
            bytes: 796275,
            sha256: "970c98d174fc01e0339fbabbf45af36a4be3f26f819ec1a5ea1189f71e091889"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-ja/llmaat_finetune10M_qe8_f2_ApiGGQIwTKuF9i_k3n9Q2Q/exported/trgvocab.enja.spm.gz",
            downloadBytes: 431278,
            bytes: 827144,
            sha256: "3b3d9f8f3a034d98d0a476f1794fa79c01e4e98a967ceb6777a66ba2d03ec1e1"
          }
        ]
      },
      {
        pair: "enkn",
        from: "en",
        to: "kn",
        architecture: "tiny",
        downloadBytes: 14875419,
        bytes: 21014535,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-kn/h1-2025_DDVsjRwsQ8GL3-JAiAmmfQ/exported/model.enkn.intgemm.alphas.bin.gz",
            downloadBytes: 13009213,
            bytes: 17141051,
            sha256: "17a5ddc86e24f62c04aa15272930275812b5c1674bec50a877528680d5834d2d"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-kn/h1-2025_DDVsjRwsQ8GL3-JAiAmmfQ/exported/lex.50.50.enkn.s2t.bin.gz",
            downloadBytes: 1416160,
            bytes: 2808304,
            sha256: "94b660f37c9c29a904b48498a7202846faaeef16f30668f356336c29cefc0f63"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-kn/h1-2025_DDVsjRwsQ8GL3-JAiAmmfQ/exported/vocab.enkn.spm.gz",
            downloadBytes: 450046,
            bytes: 1065180,
            sha256: "1d41f1f6b67a8c29fa3aabbc7758b766bdd9acdbeec7d1277ab60c8e492c8b7a"
          }
        ]
      },
      {
        pair: "enko",
        from: "en",
        to: "ko",
        architecture: "base-memory",
        downloadBytes: 38024406,
        bytes: 51906032,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-ko/cjk_retrain_base-memory_GP50C3MpQ9apCWZOW-f3PA/exported/model.enko.intgemm.alphas.bin.gz",
            downloadBytes: 33738001,
            bytes: 43849787,
            sha256: "ffe5ef2ce3f2e944055e35310bab186f6a70d533a0ee4394adf716a0e383afbb"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-ko/cjk_retrain_base-memory_GP50C3MpQ9apCWZOW-f3PA/exported/lex.50.50.enko.s2t.bin.gz",
            downloadBytes: 3471311,
            bytes: 6449612,
            sha256: "96efba97d4bb93ab362e5569bea0f115184d2f68d63b67305ee663c18e32fbeb"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-ko/cjk_retrain_base-memory_GP50C3MpQ9apCWZOW-f3PA/exported/srcvocab.enko.spm.gz",
            downloadBytes: 402480,
            bytes: 791280,
            sha256: "8d4e3141868efd410eb86c2b60d41aa6bc6b46e4c4b2c0b85e3792493c69d802"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-ko/cjk_retrain_base-memory_GP50C3MpQ9apCWZOW-f3PA/exported/trgvocab.enko.spm.gz",
            downloadBytes: 412614,
            bytes: 815353,
            sha256: "2ece21b28dd7022d36127d17423a74dabf544787dfc1cf614f7b565f93a4a1d3"
          }
        ]
      },
      {
        pair: "enlt",
        from: "en",
        to: "lt",
        architecture: "base-memory",
        downloadBytes: 25038750,
        bytes: 35790254,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-lt/h1-2025_CpawQ31iTrmnax9Xi0DkBw/exported/model.enlt.intgemm.alphas.bin.gz",
            downloadBytes: 22865642,
            bytes: 31561787,
            sha256: "d27c676d9d761c2abfffec83956e32b2923f3f745b56acdbd84c49d888cdc94e"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-lt/h1-2025_CpawQ31iTrmnax9Xi0DkBw/exported/lex.50.50.enlt.s2t.bin.gz",
            downloadBytes: 1769752,
            bytes: 3421640,
            sha256: "5972c834218c7beea241dc8fe77c2e577a8d8b4eb3d3dc286d10ad890c64d374"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-lt/h1-2025_CpawQ31iTrmnax9Xi0DkBw/exported/vocab.enlt.spm.gz",
            downloadBytes: 403356,
            bytes: 806827,
            sha256: "5d38fe70ff4a50368af756b715b69519c9ee064c27cbceeabc90d4e1a10f25a8"
          }
        ]
      },
      {
        pair: "enlv",
        from: "en",
        to: "lv",
        architecture: "base-memory",
        downloadBytes: 25861087,
        bytes: 35737170,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-lv/h1-2025_L9sajlF2TCKfEzDro4tK3Q/exported/model.enlv.intgemm.alphas.bin.gz",
            downloadBytes: 23727668,
            bytes: 31561787,
            sha256: "715f9f444dffa0b39e71955c28bffd30afa4cc8300a192ec8fabb766cc5ba11d"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-lv/h1-2025_L9sajlF2TCKfEzDro4tK3Q/exported/lex.50.50.enlv.s2t.bin.gz",
            downloadBytes: 1725879,
            bytes: 3359096,
            sha256: "d54b9bc278558444c5c25df5ae7339b73eee55cf79705f19fec672b6d55d959c"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-lv/h1-2025_L9sajlF2TCKfEzDro4tK3Q/exported/vocab.enlv.spm.gz",
            downloadBytes: 407540,
            bytes: 816287,
            sha256: "63146b49ce46ba1283b6956e38efdd4899d1a409cad9d2b6a06cbd4e32ca0808"
          }
        ]
      },
      {
        pair: "enml",
        from: "en",
        to: "ml",
        architecture: "tiny",
        downloadBytes: 14300153,
        bytes: 20783011,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-ml/h1-2025_UylcthuMRoelqd6lsCbXJw/exported/model.enml.intgemm.alphas.bin.gz",
            downloadBytes: 12570038,
            bytes: 17141051,
            sha256: "c461749c8315f6417104cf4df32e5063e86cb101203f9629512294c1c8ab5337"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-ml/h1-2025_UylcthuMRoelqd6lsCbXJw/exported/lex.50.50.enml.s2t.bin.gz",
            downloadBytes: 1275347,
            bytes: 2532960,
            sha256: "4a37286742244a130548b79823c9707bc0e56f373361e2cb56402f82e862c2b0"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-ml/h1-2025_UylcthuMRoelqd6lsCbXJw/exported/vocab.enml.spm.gz",
            downloadBytes: 454768,
            bytes: 1109e3,
            sha256: "8282614894087e4ffab325cbdb3aeeba35677f770ef8f253c189b392fe1f4d52"
          }
        ]
      },
      {
        pair: "enms",
        from: "en",
        to: "ms",
        architecture: "tiny",
        downloadBytes: 15487819,
        bytes: 21879919,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-ms/h1-2025_Ba76abX1Qtums6Vbv95tzg/exported/model.enms.intgemm.alphas.bin.gz",
            downloadBytes: 13039668,
            bytes: 17141051,
            sha256: "3d6961462ffa711413d513624d7e6399b3560c2b0994daa73b0a45699e657af8"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-ms/h1-2025_Ba76abX1Qtums6Vbv95tzg/exported/lex.50.50.enms.s2t.bin.gz",
            downloadBytes: 2044118,
            bytes: 3936428,
            sha256: "be8fec4866c9ed2cf669adaea2e259c4c22f34838032eb0ee117c10fcb968c4c"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-ms/h1-2025_Ba76abX1Qtums6Vbv95tzg/exported/vocab.enms.spm.gz",
            downloadBytes: 404033,
            bytes: 802440,
            sha256: "c1f182330fb8c80778da36dd6e5bde59464db2390f623ea62817081cc759695a"
          }
        ]
      },
      {
        pair: "ennb",
        from: "en",
        to: "nb",
        architecture: "tiny",
        downloadBytes: 15316161,
        bytes: 22177813,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-nb/h1-2025_A0d8NsivR6Szy2dI4Nz6FQ/exported/model.ennb.intgemm.alphas.bin.gz",
            downloadBytes: 12713727,
            bytes: 17141051,
            sha256: "78429eb7f544361061c9d9ec2f0872adf30b76e4c9ef3dbaab1210a0f2aa19b5"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-nb/h1-2025_A0d8NsivR6Szy2dI4Nz6FQ/exported/lex.50.50.ennb.s2t.bin.gz",
            downloadBytes: 2193397,
            bytes: 4234572,
            sha256: "0780a1659ef460864ba92da6d58ca6f9056fb8ec8be507c189aeb25ce23e429f"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-nb/h1-2025_A0d8NsivR6Szy2dI4Nz6FQ/exported/vocab.ennb.spm.gz",
            downloadBytes: 409037,
            bytes: 802190,
            sha256: "cad75f2c3eccb9545b571ca32f235e6ffaae6d8a77bfa808cf8068948c421f10"
          }
        ]
      },
      {
        pair: "ennl",
        from: "en",
        to: "nl",
        architecture: "base-memory",
        downloadBytes: 25951889,
        bytes: 36400119,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-nl/retrain_hr_fix_names_fR8XhBiBQniIbi4I_ebJ2Q/exported/model.ennl.intgemm.alphas.bin.gz",
            downloadBytes: 23386633,
            bytes: 31561787,
            sha256: "7e8402da61972dc2fdcf7147c7f1e12f7916a6d9349514ee7a731288357575a9"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-nl/retrain_hr_fix_names_fR8XhBiBQniIbi4I_ebJ2Q/exported/lex.50.50.ennl.s2t.bin.gz",
            downloadBytes: 2155034,
            bytes: 4030624,
            sha256: "bb4922718f8ca6d746ad090c0a88110a664dc050ee3f311bce33698b4e1679e9"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-nl/retrain_hr_fix_names_fR8XhBiBQniIbi4I_ebJ2Q/exported/vocab.ennl.spm.gz",
            downloadBytes: 410222,
            bytes: 807708,
            sha256: "c09588ca5662b230ed65bd39a07f58d9f7dd21c3a19e4aeb1bff39bf3b297c56"
          }
        ]
      },
      {
        pair: "enno",
        from: "en",
        to: "no",
        architecture: "tiny",
        downloadBytes: 15316161,
        bytes: 22177813,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-no/h1-2025_A0d8NsivR6Szy2dI4Nz6FQ/exported/model.enno.intgemm.alphas.bin.gz",
            downloadBytes: 12713727,
            bytes: 17141051,
            sha256: "78429eb7f544361061c9d9ec2f0872adf30b76e4c9ef3dbaab1210a0f2aa19b5"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-no/h1-2025_A0d8NsivR6Szy2dI4Nz6FQ/exported/lex.50.50.enno.s2t.bin.gz",
            downloadBytes: 2193397,
            bytes: 4234572,
            sha256: "0780a1659ef460864ba92da6d58ca6f9056fb8ec8be507c189aeb25ce23e429f"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-no/h1-2025_A0d8NsivR6Szy2dI4Nz6FQ/exported/vocab.enno.spm.gz",
            downloadBytes: 409037,
            bytes: 802190,
            sha256: "cad75f2c3eccb9545b571ca32f235e6ffaae6d8a77bfa808cf8068948c421f10"
          }
        ]
      },
      {
        pair: "enpl",
        from: "en",
        to: "pl",
        architecture: "base-memory",
        downloadBytes: 24864968,
        bytes: 35923451,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-pl/retrain_hr_fix_names_YmTlfuUsSKCbUp75UXaUuw/exported/model.enpl.intgemm.alphas.bin.gz",
            downloadBytes: 22577447,
            bytes: 31561787,
            sha256: "b0b59716bcc8f46b8dc6ab5c32a2732acaad42a5a6d9ae9b472526a1bb0d71d4"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-pl/retrain_hr_fix_names_YmTlfuUsSKCbUp75UXaUuw/exported/lex.50.50.enpl.s2t.bin.gz",
            downloadBytes: 1874327,
            bytes: 3540052,
            sha256: "d7d7b364673f633763c9f8f2e8ee9c7a184e92f4086e8b84abe870a2a8dbe5d5"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-pl/retrain_hr_fix_names_YmTlfuUsSKCbUp75UXaUuw/exported/vocab.enpl.spm.gz",
            downloadBytes: 413194,
            bytes: 821612,
            sha256: "2000f182efa8ce5f69bc3f9e574666b5bc2c0af684eedd32f69d15aa9021ea85"
          }
        ]
      },
      {
        pair: "enpt",
        from: "en",
        to: "pt",
        architecture: "base-memory",
        downloadBytes: 25866313,
        bytes: 36348853,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-pt/retrain_hr_fix_names_Vnb0RUXTTd67hR-oLHM3eg/exported/model.enpt.intgemm.alphas.bin.gz",
            downloadBytes: 23340019,
            bytes: 31561787,
            sha256: "07892fd2544ee79dcb643615d8f2debb9793fae16842e87c328e27a3dd26a770"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-pt/retrain_hr_fix_names_Vnb0RUXTTd67hR-oLHM3eg/exported/lex.50.50.enpt.s2t.bin.gz",
            downloadBytes: 2117608,
            bytes: 3970340,
            sha256: "ccb4c31c9e1899d77a200e71a86958e6ef6c8649627d0bbf3f873b57d9f236bd"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-pt/retrain_hr_fix_names_Vnb0RUXTTd67hR-oLHM3eg/exported/vocab.enpt.spm.gz",
            downloadBytes: 408686,
            bytes: 816726,
            sha256: "d9f46182823d5bbc84201252b2dfcac28f63e561f0ec827ed858f241864c9def"
          }
        ]
      },
      {
        pair: "enro",
        from: "en",
        to: "ro",
        architecture: "tiny",
        downloadBytes: 14450698,
        bytes: 21682453,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-ro/spring-2024_Ov3G4D_DRJa-4qTlILkPhg/exported/model.enro.intgemm.alphas.bin.gz",
            downloadBytes: 12207487,
            bytes: 17141051,
            sha256: "aa98c415e5beb1c5ee2f7d2508a3bbba949be223d7d9e5e1788ad0ae8598dda5"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-ro/spring-2024_Ov3G4D_DRJa-4qTlILkPhg/exported/lex.50.50.enro.s2t.bin.gz",
            downloadBytes: 1846074,
            bytes: 3739880,
            sha256: "508bce64a8bc906a99043ad2f4855b4662e06f8827c1c6a75ab83181b4f17f81"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-ro/spring-2024_Ov3G4D_DRJa-4qTlILkPhg/exported/vocab.enro.spm.gz",
            downloadBytes: 397137,
            bytes: 801522,
            sha256: "d89eedf6cbbcb30d7ed4b0b092189196ac2b010ec0c3ede33a6676b17ea1c95e"
          }
        ]
      },
      {
        pair: "enru",
        from: "en",
        to: "ru",
        architecture: "base-memory",
        downloadBytes: 23786432,
        bytes: 35240782,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-ru/retrain_base-memory_KJ23-iDVTcymG1ZldWY17w/exported/model.enru.intgemm.alphas.bin.gz",
            downloadBytes: 21988864,
            bytes: 31561787,
            sha256: "184cb5cda528eeefc0f75f5d0035d787b71d74af135e3c5608d01ae02ecfb920"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-ru/retrain_base-memory_KJ23-iDVTcymG1ZldWY17w/exported/lex.50.50.enru.s2t.bin.gz",
            downloadBytes: 1378563,
            bytes: 2774540,
            sha256: "4d91839726b960e70b6d05c53d0cffd16262832b1c0e1ea99d66f412dcc6a239"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-ru/retrain_base-memory_KJ23-iDVTcymG1ZldWY17w/exported/vocab.enru.spm.gz",
            downloadBytes: 419005,
            bytes: 904455,
            sha256: "56ee63e14e8cb926c394242adc3ed7cc602644c3d33058cff2ce2959d52a6258"
          }
        ]
      },
      {
        pair: "ensk",
        from: "en",
        to: "sk",
        architecture: "base-memory",
        downloadBytes: 25017423,
        bytes: 35727023,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-sk/h1-2025_NbGVkenLTPiss8w800509A/exported/model.ensk.intgemm.alphas.bin.gz",
            downloadBytes: 22902983,
            bytes: 31561787,
            sha256: "e33af359fd58c8958104b1b74b3ea302800ccba2f125c1629e09d7f9dd9a3804"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-sk/h1-2025_NbGVkenLTPiss8w800509A/exported/lex.50.50.ensk.s2t.bin.gz",
            downloadBytes: 1708788,
            bytes: 3356348,
            sha256: "f3d1aec4ee5246d6a6ee5dc7ed4c6b18f6071c7baca69bf1344aef675b95515d"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-sk/h1-2025_NbGVkenLTPiss8w800509A/exported/vocab.ensk.spm.gz",
            downloadBytes: 405652,
            bytes: 808888,
            sha256: "cfa6a9e601d74686b117f041eb1ad9de94c34219110b67367d570a9e27026a46"
          }
        ]
      },
      {
        pair: "ensl",
        from: "en",
        to: "sl",
        architecture: "base-memory",
        downloadBytes: 24809638,
        bytes: 35793299,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-sl/h1-2025_Ph0DK4RhRMe7z4cLk-f7eg/exported/model.ensl.intgemm.alphas.bin.gz",
            downloadBytes: 22669559,
            bytes: 31561787,
            sha256: "a34fc5cc2f52733f64e37f8512cf1ddc4723c08a7a1a59d01fc2b6e641fc2280"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-sl/h1-2025_Ph0DK4RhRMe7z4cLk-f7eg/exported/lex.50.50.ensl.s2t.bin.gz",
            downloadBytes: 1741316,
            bytes: 3428300,
            sha256: "2190798297bc12505f917189defcf451ab5bd2e815bc05df244dc291dc2ae63b"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-sl/h1-2025_Ph0DK4RhRMe7z4cLk-f7eg/exported/vocab.ensl.spm.gz",
            downloadBytes: 398763,
            bytes: 803212,
            sha256: "7cd295383c46824c05a05db76b543d3595f2516537dd22b77190a45c8919224d"
          }
        ]
      },
      {
        pair: "ensr",
        from: "en",
        to: "sr",
        architecture: "base-memory",
        downloadBytes: 24737527,
        bytes: 35026482,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-sr/hbs-topk10_KZK68xhrQWWeK6xcMRtd9A/exported/model.ensr.intgemm.alphas.bin.gz",
            downloadBytes: 23014587,
            bytes: 31561787,
            sha256: "d26e1c5a01f917c38ccda17d1bf116024ac4d988105e1bbf70bc5e8f9191c57a"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-sr/hbs-topk10_KZK68xhrQWWeK6xcMRtd9A/exported/lex.50.50.ensr.s2t.bin.gz",
            downloadBytes: 1289317,
            bytes: 2542096,
            sha256: "b2ae22b4d7bc4295d25b8a55559ebbdbd8f728bc8de5c3d6f110bd44ce7d8962"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-sr/hbs-topk10_KZK68xhrQWWeK6xcMRtd9A/exported/vocab.ensr.spm.gz",
            downloadBytes: 433623,
            bytes: 922599,
            sha256: "7f54ba1554b7b1a89299a0ec5950535432f062b50a5f8c9bcd664a2444fa882a"
          }
        ]
      },
      {
        pair: "ensv",
        from: "en",
        to: "sv",
        architecture: "tiny",
        downloadBytes: 15094740,
        bytes: 21883099,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-sv/spring-2024_bQQme71PS4eZRDl3NM-kgA/exported/model.ensv.intgemm.alphas.bin.gz",
            downloadBytes: 12775086,
            bytes: 17141051,
            sha256: "65ea0db8e658435846f297384face62dbf1804cfc92de8388b0e368e6ecc25a7"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-sv/spring-2024_bQQme71PS4eZRDl3NM-kgA/exported/lex.50.50.ensv.s2t.bin.gz",
            downloadBytes: 1921270,
            bytes: 3948180,
            sha256: "5761c39887a0e0cd3dd38d22cadc31cecd2a43b0514c4bba96b426736e7fd72d"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-sv/spring-2024_bQQme71PS4eZRDl3NM-kgA/exported/vocab.ensv.spm.gz",
            downloadBytes: 398384,
            bytes: 793868,
            sha256: "ff7e366ff4228107e58d76ca348e7dea2eb325452363d68e0047e97fb483e40e"
          }
        ]
      },
      {
        pair: "enta",
        from: "en",
        to: "ta",
        architecture: "base-memory",
        downloadBytes: 25090166,
        bytes: 35405968,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-ta/next26-nobcbpcc_RgO3iURPQH2EjhUm533NWA/exported/model.enta.intgemm.alphas.bin.gz",
            downloadBytes: 23206004,
            bytes: 31561787,
            sha256: "83266ea604611756d1c3c358d7bed1fdf79a646c1f701b42c1db501c237c0f3b"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-ta/next26-nobcbpcc_RgO3iURPQH2EjhUm533NWA/exported/lex.50.50.enta.s2t.bin.gz",
            downloadBytes: 1434399,
            bytes: 2746824,
            sha256: "3a40b2175a114f3ca0ee5501c12e9636ef46f282304b041001f282baf4a5bc6f"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-ta/next26-nobcbpcc_RgO3iURPQH2EjhUm533NWA/exported/vocab.enta.spm.gz",
            downloadBytes: 449763,
            bytes: 1097357,
            sha256: "c4fd3cbcec4e7c8a80b7c0656092fb482b9f266b1e8c6cb171f81af394f0f899"
          }
        ]
      },
      {
        pair: "ente",
        from: "en",
        to: "te",
        architecture: "tiny",
        downloadBytes: 14473805,
        bytes: 21029631,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-te/h1-2025_J_7yoPHaRJqsevUR512RsQ/exported/model.ente.intgemm.alphas.bin.gz",
            downloadBytes: 12590862,
            bytes: 17141051,
            sha256: "a3fee2fcd39df975da28666c536adff60147dce59062fca6097bb42fb2a52500"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-te/h1-2025_J_7yoPHaRJqsevUR512RsQ/exported/lex.50.50.ente.s2t.bin.gz",
            downloadBytes: 1434105,
            bytes: 2832156,
            sha256: "ea44d146f6b4614586654d91d7b677ee617e2367be2eccd72e81aa0fa359b92c"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-te/h1-2025_J_7yoPHaRJqsevUR512RsQ/exported/vocab.ente.spm.gz",
            downloadBytes: 448838,
            bytes: 1056424,
            sha256: "41d0828d103a07e0608c604102ba4418fcb06e82b3742c1abc6d3ec343673e93"
          }
        ]
      },
      {
        pair: "enth",
        from: "en",
        to: "th",
        architecture: "base-memory",
        downloadBytes: 25029041,
        bytes: 35571916,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-th/new-opuscleaner-en-th-onestage-topk10_WIvJuHhrSyiXLtJBJOUrsA/exported/model.enth.intgemm.alphas.bin.gz",
            downloadBytes: 22976729,
            bytes: 31561787,
            sha256: "80e326097655fca75f841130da3338a849aa245374e1616448bcf37b9523a05a"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-th/new-opuscleaner-en-th-onestage-topk10_WIvJuHhrSyiXLtJBJOUrsA/exported/lex.50.50.enth.s2t.bin.gz",
            downloadBytes: 1601933,
            bytes: 3016612,
            sha256: "6961ce07f38e6c113a70855706aa7cad4cc828f986d1751c33f14699f885a2e8"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-th/new-opuscleaner-en-th-onestage-topk10_WIvJuHhrSyiXLtJBJOUrsA/exported/vocab.enth.spm.gz",
            downloadBytes: 450379,
            bytes: 993517,
            sha256: "5deff7093d558768f8c22406449202e27595f023cc383a2b66beed240ed46443"
          }
        ]
      },
      {
        pair: "entr",
        from: "en",
        to: "tr",
        architecture: "tiny",
        downloadBytes: 15101045,
        bytes: 21201144,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-tr/spring-2024_LiFGeNrEQpKdNlziG2qP_A/exported/model.entr.intgemm.alphas.bin.gz",
            downloadBytes: 13159314,
            bytes: 17141051,
            sha256: "ea3cd4ee09de190df265c78d84260e277a9a8a3ddff05eb55d72afe7fc0fdbf4"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-tr/spring-2024_LiFGeNrEQpKdNlziG2qP_A/exported/lex.50.50.entr.s2t.bin.gz",
            downloadBytes: 1546258,
            bytes: 3261300,
            sha256: "3aba0be842bd4c192659c781e6fdce8eb9b2b1fff29a40d22f75da369d59f46f"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-tr/spring-2024_LiFGeNrEQpKdNlziG2qP_A/exported/vocab.entr.spm.gz",
            downloadBytes: 395473,
            bytes: 798793,
            sha256: "a220363d60391f7ce3df8ec9785424dbc00c24d5786d1a4308cf8ca3ed3385c2"
          }
        ]
      },
      {
        pair: "enuk",
        from: "en",
        to: "uk",
        architecture: "base-memory",
        downloadBytes: 24865346,
        bytes: 35538228,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-uk/docmt-vocab_a2OVwdI-Sg-SBZ_0Joqb0w/exported/model.enuk.intgemm.alphas.bin.gz",
            downloadBytes: 22864374,
            bytes: 31561787,
            sha256: "ed8bb4a811e1c45a259e91052080d25e5c8b4e2df0e59cb1521c04a57855ef97"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-uk/docmt-vocab_a2OVwdI-Sg-SBZ_0Joqb0w/exported/lex.50.50.enuk.s2t.bin.gz",
            downloadBytes: 1564122,
            bytes: 3054364,
            sha256: "dbfd4f8dc95da9c575164f7fc95ef00a2fb5f7d9f51b656559f99eeebdb57c87"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-uk/docmt-vocab_a2OVwdI-Sg-SBZ_0Joqb0w/exported/vocab.enuk.spm.gz",
            downloadBytes: 436850,
            bytes: 922077,
            sha256: "4dd6a91feff71e745395dcc0d52f885848ca0d843d5f70628ca51b3be1b70b45"
          }
        ]
      },
      {
        pair: "envi",
        from: "en",
        to: "vi",
        architecture: "base-memory",
        downloadBytes: 26890915,
        bytes: 36944671,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-vi/test_prompsit_Ep8JhBQ3QRizDT91JVy8KQ/exported/model.envi.intgemm.alphas.bin.gz",
            downloadBytes: 24244705,
            bytes: 31561787,
            sha256: "04fa6044593a404c2aa02b3096f203880852df6f8f41e5eb966ed9f2b4366737"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-vi/test_prompsit_Ep8JhBQ3QRizDT91JVy8KQ/exported/lex.50.50.envi.s2t.bin.gz",
            downloadBytes: 2246027,
            bytes: 4597684,
            sha256: "18116817fcd3d24dcdfd97cb57e9e60472800dae3b8a007f6f36d61d645f699c"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-vi/test_prompsit_Ep8JhBQ3QRizDT91JVy8KQ/exported/vocab.envi.spm.gz",
            downloadBytes: 400183,
            bytes: 785200,
            sha256: "76daa9a49e393e50c865c889290e4dc36e9453e5e1ec9df7b9f3bc39ea782537"
          }
        ]
      },
      {
        pair: "enzh",
        from: "en",
        to: "zh",
        architecture: "base-memory",
        downloadBytes: 36745493,
        bytes: 49913927,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-zh/llmaat_finetune10M_qe8_f2_ByQcSxGXQRqGi-UTxYE43g/exported/model.enzh.intgemm.alphas.bin.gz",
            downloadBytes: 33375922,
            bytes: 43849787,
            sha256: "4e5accc141373565ddc8fa1565bceaa8d0c3482a82cab8131c719ebcc6c2157c"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-zh/llmaat_finetune10M_qe8_f2_ByQcSxGXQRqGi-UTxYE43g/exported/lex.50.50.enzh.s2t.bin.gz",
            downloadBytes: 2536039,
            bytes: 4485184,
            sha256: "8575d8daa10e2dbff316dcdf8e1ce475357bcc2c92bdc63b736a2d5add22f681"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-zh/llmaat_finetune10M_qe8_f2_ByQcSxGXQRqGi-UTxYE43g/exported/srcvocab.enzh.spm.gz",
            downloadBytes: 407784,
            bytes: 806952,
            sha256: "bd9b65504acc6d9726dd281f7defc2adb7c2c22d0688fe2f84697de25197c8c5"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-zh/llmaat_finetune10M_qe8_f2_ByQcSxGXQRqGi-UTxYE43g/exported/trgvocab.enzh.spm.gz",
            downloadBytes: 425748,
            bytes: 772004,
            sha256: "aded6993c36e440284d11cec3f6b8aef9c0e43188a772d80be342a713adf223d"
          }
        ]
      },
      {
        pair: "enzh_hant",
        from: "en",
        to: "zh_hant",
        architecture: "base-memory",
        downloadBytes: 36402857,
        bytes: 49462340,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-zh_hant/zh_hant_llmaat_finetune10M_qe8_f2_aQ8azdOMQOSBVjBDOVDIZQ/exported/model.enzh_hant.intgemm.alphas.bin.gz",
            downloadBytes: 33291007,
            bytes: 43849787,
            sha256: "559ab90d723a58c1f1e2ab7cc12137bc667af5ba3e325e3eb30b5cdc930db520"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-zh_hant/zh_hant_llmaat_finetune10M_qe8_f2_aQ8azdOMQOSBVjBDOVDIZQ/exported/lex.50.50.enzh_hant.s2t.bin.gz",
            downloadBytes: 2290215,
            bytes: 4057188,
            sha256: "d891404d1436a7334df12539fe30a26f9e9f2b80bd42fdb8b5f8849e8a1e942b"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-zh_hant/zh_hant_llmaat_finetune10M_qe8_f2_aQ8azdOMQOSBVjBDOVDIZQ/exported/srcvocab.enzh_hant.spm.gz",
            downloadBytes: 404976,
            bytes: 803694,
            sha256: "2266df70492162a249ab1c0154f929bd6098b246544c666c1a0d5a24dde7d2ea"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-zh_hant/zh_hant_llmaat_finetune10M_qe8_f2_aQ8azdOMQOSBVjBDOVDIZQ/exported/trgvocab.enzh_hant.spm.gz",
            downloadBytes: 416659,
            bytes: 751671,
            sha256: "22b91a4436d70b91ab8777c677252ab5fae2bc284d71f977df5206c110e3444c"
          }
        ]
      },
      {
        pair: "esen",
        from: "es",
        to: "en",
        architecture: "base-memory",
        downloadBytes: 26241052,
        bytes: 37014089,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/es-en/retrain_hr_HbNjJ60BTwmVTbhfFxuduA/exported/model.esen.intgemm.alphas.bin.gz",
            downloadBytes: 23288494,
            bytes: 31561787,
            sha256: "4aed7734152ae0045d1a69ae49c86cfda18f53c61f90e95e1d1de1c7c7c3b033"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/es-en/retrain_hr_HbNjJ60BTwmVTbhfFxuduA/exported/lex.50.50.esen.s2t.bin.gz",
            downloadBytes: 2543246,
            bytes: 4636248,
            sha256: "e2610211d3b9577d012638fe7e7e74ed7b4b708ce96b9e792e67c282a6492daa"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/es-en/retrain_hr_HbNjJ60BTwmVTbhfFxuduA/exported/vocab.esen.spm.gz",
            downloadBytes: 409312,
            bytes: 816054,
            sha256: "5ae254fa9b15aa182e70fd2a6186b1333c63a29a48043a9224c6aa4fcac058ad"
          }
        ]
      },
      {
        pair: "eten",
        from: "et",
        to: "en",
        architecture: "base-memory",
        downloadBytes: 25520665,
        bytes: 37005329,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/et-en/retrain_hr_RNXxp-Q9Q4GRExCoMAT77Q/exported/model.eten.intgemm.alphas.bin.gz",
            downloadBytes: 22785077,
            bytes: 31561787,
            sha256: "df844b3a6df906b2e0682fb7765694f35b351854db00f964896d9c8c365fbff3"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/et-en/retrain_hr_RNXxp-Q9Q4GRExCoMAT77Q/exported/lex.50.50.eten.s2t.bin.gz",
            downloadBytes: 2321326,
            bytes: 4625968,
            sha256: "ad9750f3b41cb5686e561608271a0dc935fc827bf43226e579a6f48a3f6b5f11"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/et-en/retrain_hr_RNXxp-Q9Q4GRExCoMAT77Q/exported/vocab.eten.spm.gz",
            downloadBytes: 414262,
            bytes: 817574,
            sha256: "89a3deea4ae7d674fb46a4dae39135dd4dfaac9786f2868d0b5bc5c0aca2ef83"
          }
        ]
      },
      {
        pair: "euen",
        from: "eu",
        to: "en",
        architecture: "base-memory",
        downloadBytes: 25550679,
        bytes: 36126707,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/eu-en/euen-finetranslations_Blfz7PCVT4qOGYPj9q6oMg/exported/model.euen.intgemm.alphas.bin.gz",
            downloadBytes: 23241057,
            bytes: 31561787,
            sha256: "f0a31e26b381d6340b069da4d505e11d18ac91e42f0189d37ed5fe6aa3685ed4"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/eu-en/euen-finetranslations_Blfz7PCVT4qOGYPj9q6oMg/exported/lex.50.50.euen.s2t.bin.gz",
            downloadBytes: 1896953,
            bytes: 3738856,
            sha256: "4be647536631440bdf68c59d3de5720d8e87a482e0493ff41767488b4df1731d"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/eu-en/euen-finetranslations_Blfz7PCVT4qOGYPj9q6oMg/exported/vocab.euen.spm.gz",
            downloadBytes: 412669,
            bytes: 826064,
            sha256: "8f0cdff0c5bca8ed24d91c415f428d8b208f4991087723f38c1c28b59896de89"
          }
        ]
      },
      {
        pair: "faen",
        from: "fa",
        to: "en",
        architecture: "tiny",
        downloadBytes: 15426804,
        bytes: 21880624,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/fa-en/h1-2025_dyvKzoMQToKWHx7bbP-TtQ/exported/model.faen.intgemm.alphas.bin.gz",
            downloadBytes: 13071390,
            bytes: 17141051,
            sha256: "aa326306c177e11129de5bfeba518abc499c0b6005492766748a9c9ea6f4c712"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/fa-en/h1-2025_dyvKzoMQToKWHx7bbP-TtQ/exported/lex.50.50.faen.s2t.bin.gz",
            downloadBytes: 1939291,
            bytes: 3896420,
            sha256: "4828cb060bd4375f8aabb85fed39c18aca52b738838394546f2ddbf707a6f28e"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/fa-en/h1-2025_dyvKzoMQToKWHx7bbP-TtQ/exported/vocab.faen.spm.gz",
            downloadBytes: 416123,
            bytes: 843153,
            sha256: "bf36943053883d6c0fc98c2985f676a0a37042e796bad0e3df0a813d9d5393f4"
          }
        ]
      },
      {
        pair: "fien",
        from: "fi",
        to: "en",
        architecture: "base-memory",
        downloadBytes: 25930043,
        bytes: 37575689,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/fi-en/retrain_hr_C7-zSzS7Tm6zkOfVP7k0Gw/exported/model.fien.intgemm.alphas.bin.gz",
            downloadBytes: 22935246,
            bytes: 31561787,
            sha256: "e3887341f18bcc7787d9b59eb1229b56eefce18d49b7ebf1e62c55d65a377321"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/fi-en/retrain_hr_C7-zSzS7Tm6zkOfVP7k0Gw/exported/lex.50.50.fien.s2t.bin.gz",
            downloadBytes: 2580517,
            bytes: 5195132,
            sha256: "8bad431e07b062ba47f363b76e4656cc743fd608316d8a4830a4315e44ac9abb"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/fi-en/retrain_hr_C7-zSzS7Tm6zkOfVP7k0Gw/exported/vocab.fien.spm.gz",
            downloadBytes: 414280,
            bytes: 818770,
            sha256: "6a866911427f2916609ae89c7f2f04a78de3fdd8aa183039ecba986635d4f246"
          }
        ]
      },
      {
        pair: "fren",
        from: "fr",
        to: "en",
        architecture: "base-memory",
        downloadBytes: 26234715,
        bytes: 37200311,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/fr-en/retrain_hr_EFgIftH_RrCyzl5gjemVNg/exported/model.fren.intgemm.alphas.bin.gz",
            downloadBytes: 23175075,
            bytes: 31561787,
            sha256: "15f997bc0d13808b0b0fbd0786e684a3c8a52adcd8071844b76123fdacbf2b90"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/fr-en/retrain_hr_EFgIftH_RrCyzl5gjemVNg/exported/lex.50.50.fren.s2t.bin.gz",
            downloadBytes: 2649934,
            bytes: 4824120,
            sha256: "87c6752ea908f5f0347c10ac0cf7d80d9c2f4f20c81c90168f3e8230b56d4440"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/fr-en/retrain_hr_EFgIftH_RrCyzl5gjemVNg/exported/vocab.fren.spm.gz",
            downloadBytes: 409706,
            bytes: 814404,
            sha256: "783abf3abe075afdf8d85d233994bef2c3a064e935ab1bed946820aff6ac002a"
          }
        ]
      },
      {
        pair: "glen",
        from: "gl",
        to: "en",
        architecture: "base-memory",
        downloadBytes: 25657316,
        bytes: 36756406,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/gl-en/gl-finetranslations_M9yGl6Y4Q5ysCI8bqEZfTQ/exported/model.glen.intgemm.alphas.bin.gz",
            downloadBytes: 23054964,
            bytes: 31561787,
            sha256: "7e8ea0279166c72b0b430327533c643a88f26e80e4a9f9f294244a84213f3e6d"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/gl-en/gl-finetranslations_M9yGl6Y4Q5ysCI8bqEZfTQ/exported/lex.50.50.glen.s2t.bin.gz",
            downloadBytes: 2191952,
            bytes: 4367596,
            sha256: "fea6d0e1ea5d5e8e5f7207e4572867fb8f8d8b3f5f983a33067a06b218ab287f"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/gl-en/gl-finetranslations_M9yGl6Y4Q5ysCI8bqEZfTQ/exported/vocab.glen.spm.gz",
            downloadBytes: 410400,
            bytes: 827023,
            sha256: "5157bf2e08eeac7b98703bf50a14653eab84607bb707a00db81585f61c814a6c"
          }
        ]
      },
      {
        pair: "guen",
        from: "gu",
        to: "en",
        architecture: "tiny",
        downloadBytes: 15381564,
        bytes: 22304030,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/gu-en/h1-2025_AbHCTUgSSguJ1-Pq-XLnVA/exported/model.guen.intgemm.alphas.bin.gz",
            downloadBytes: 12917932,
            bytes: 17141051,
            sha256: "7b16e4e64f2776c73d87db01922c091738566b6a6092a42488cbaee1385cb4ab"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/gu-en/h1-2025_AbHCTUgSSguJ1-Pq-XLnVA/exported/lex.50.50.guen.s2t.bin.gz",
            downloadBytes: 2028621,
            bytes: 4197836,
            sha256: "af01dbec5a1555ddad7c4b19878ecda00e6f9d179ca76a40ab2413de6b081cb0"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/gu-en/h1-2025_AbHCTUgSSguJ1-Pq-XLnVA/exported/vocab.guen.spm.gz",
            downloadBytes: 435011,
            bytes: 965143,
            sha256: "6ad2aa442cc04398bd06b4f03a1027939bbfbaac5f87b3d21f667406f4f62704"
          }
        ]
      },
      {
        pair: "hbsen",
        from: "hbs",
        to: "en",
        architecture: "base-memory",
        downloadBytes: 25938230,
        bytes: 37534530,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/hbs-en/hbs_d85wHYN_SUmGIqekvLSNjA/exported/model.hbsen.intgemm.alphas.bin.gz",
            downloadBytes: 22949263,
            bytes: 31561787,
            sha256: "744c61ec0b987c44717f192fcebda7c2a1ac34f5cbfb56672771d28ff79c82c7"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/hbs-en/hbs_d85wHYN_SUmGIqekvLSNjA/exported/lex.50.50.hbsen.s2t.bin.gz",
            downloadBytes: 2578631,
            bytes: 5155408,
            sha256: "dccff06320cb87aaa6f93c246038b453d0d0c6f47fa3acd1162f104ac6a2c43f"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/hbs-en/hbs_d85wHYN_SUmGIqekvLSNjA/exported/vocab.hbsen.spm.gz",
            downloadBytes: 410336,
            bytes: 817335,
            sha256: "320561e2cef014a6d626a64822add3a387c91f609f23ea3b7f421d194075c14c"
          }
        ]
      },
      {
        pair: "heen",
        from: "he",
        to: "en",
        architecture: "tiny",
        downloadBytes: 15644623,
        bytes: 22622256,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/he-en/h1-2025_IZKPrf3xQaKu56F3zmH0cw/exported/model.heen.intgemm.alphas.bin.gz",
            downloadBytes: 12999905,
            bytes: 17141051,
            sha256: "7291cab3ec483b8cf524da96201fe947dca8c550132be21a06badeb946b5c079"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/he-en/h1-2025_IZKPrf3xQaKu56F3zmH0cw/exported/lex.50.50.heen.s2t.bin.gz",
            downloadBytes: 2232949,
            bytes: 4636028,
            sha256: "427c88732cb93b28d2a947cace79f62aabceb7d6f4438516e85994b14a73b68e"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/he-en/h1-2025_IZKPrf3xQaKu56F3zmH0cw/exported/vocab.heen.spm.gz",
            downloadBytes: 411769,
            bytes: 845177,
            sha256: "45f5d413b9208c5f24340ab0e20a63604a572784d289baa2d788deea946f79a2"
          }
        ]
      },
      {
        pair: "hien",
        from: "hi",
        to: "en",
        architecture: "tiny",
        downloadBytes: 15501784,
        bytes: 22672471,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/hi-en/h1-2025_IcUQD-GbSJWB6WV08oDoEw/exported/model.hien.intgemm.alphas.bin.gz",
            downloadBytes: 12752013,
            bytes: 17141051,
            sha256: "c82fd6ed3794b79fb9dde0718a22324502a408a9eca73497b5d0a4b8024ec6de"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/hi-en/h1-2025_IcUQD-GbSJWB6WV08oDoEw/exported/lex.50.50.hien.s2t.bin.gz",
            downloadBytes: 2319675,
            bytes: 4605984,
            sha256: "e789be33dfdb639e98f5cf9eb01aa945ec3c882f68f3c8860389cf846f0112d8"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/hi-en/h1-2025_IcUQD-GbSJWB6WV08oDoEw/exported/vocab.hien.spm.gz",
            downloadBytes: 430096,
            bytes: 925436,
            sha256: "9cbc02094ac2ebd75211b3bb6789a9d6fa112ce3c08e897f1645f18b21fbab00"
          }
        ]
      },
      {
        pair: "huen",
        from: "hu",
        to: "en",
        architecture: "tiny",
        downloadBytes: 16379723,
        bytes: 23124073,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/hu-en/andre_xxxxxxxxRxSxxxxxxxxxxA/exported/model.huen.intgemm.alphas.bin.gz",
            downloadBytes: 13181613,
            bytes: 17140899,
            sha256: "518356dbb0c071739318601963a87580fb41732652f52bd3635246330c186d9e"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/hu-en/andre_xxxxxxxxRxSxxxxxxxxxxA/exported/lex.50.50.huen.s2t.bin.gz",
            downloadBytes: 2778202,
            bytes: 5162428,
            sha256: "fff56b2501258ec4c46a8fc715caee7aeb15d853f859cdfacd3ef9903ed2fff1"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/hu-en/andre_xxxxxxxxRxSxxxxxxxxxxA/exported/vocab.huen.spm.gz",
            downloadBytes: 419908,
            bytes: 820746,
            sha256: "0db772702235b02d1f29abafb7a49ed77e54c60245b3a46e90716e74263aedd6"
          }
        ]
      },
      {
        pair: "iden",
        from: "id",
        to: "en",
        architecture: "tiny",
        downloadBytes: 15208738,
        bytes: 21964340,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/id-en/spring-2024_Yl0wXq-iQE6G9PpA3AQfcg/exported/model.iden.intgemm.alphas.bin.gz",
            downloadBytes: 13010657,
            bytes: 17141051,
            sha256: "eeed3d8c2c78ec7011b31b2419e1d2dfdf2a7cc0ee0dbb1fcd164c934cb5d328"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/id-en/spring-2024_Yl0wXq-iQE6G9PpA3AQfcg/exported/lex.50.50.iden.s2t.bin.gz",
            downloadBytes: 1818222,
            bytes: 4050348,
            sha256: "7a543087d4e9c1fe2f6b6f735b5e31aeadab80235e734c0388278722042ee3a2"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/id-en/spring-2024_Yl0wXq-iQE6G9PpA3AQfcg/exported/vocab.iden.spm.gz",
            downloadBytes: 379859,
            bytes: 772941,
            sha256: "a2dd1462abd17cccbbf3fefc562131f06b293f8ff6a5efad73ebb0176810d835"
          }
        ]
      },
      {
        pair: "isen",
        from: "is",
        to: "en",
        architecture: "base-memory",
        downloadBytes: 25654535,
        bytes: 36321986,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/is-en/docmt-vocab_I4Fy2MnOQHSOT4SYlCjPWw/exported/model.isen.intgemm.alphas.bin.gz",
            downloadBytes: 23229378,
            bytes: 31561787,
            sha256: "d2c285755d37f710458f1a49db5391a123e4e41ca7bd9829dd87cc61e4907ee6"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/is-en/docmt-vocab_I4Fy2MnOQHSOT4SYlCjPWw/exported/lex.50.50.isen.s2t.bin.gz",
            downloadBytes: 2012853,
            bytes: 3951884,
            sha256: "0655d05ccaf3cd2a01f910ef542455b7b14e66d96f6c95889079b9ca1ee168cf"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/is-en/docmt-vocab_I4Fy2MnOQHSOT4SYlCjPWw/exported/vocab.isen.spm.gz",
            downloadBytes: 412304,
            bytes: 808315,
            sha256: "5c69f0c81f6198f5615ac5aad9d89eb81a46ae8ea396a9e8e274a76409d35e13"
          }
        ]
      },
      {
        pair: "iten",
        from: "it",
        to: "en",
        architecture: "base-memory",
        downloadBytes: 26242301,
        bytes: 37088127,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/it-en/retrain_hr_d1nPDwVeSD6t-HdtWA4xNg/exported/model.iten.intgemm.alphas.bin.gz",
            downloadBytes: 23301774,
            bytes: 31561787,
            sha256: "21b70978ce2f3b4da7a06b5de86a09abe3acd30b9eee1b2ebb3582b9bad790bf"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/it-en/retrain_hr_d1nPDwVeSD6t-HdtWA4xNg/exported/lex.50.50.iten.s2t.bin.gz",
            downloadBytes: 2532929,
            bytes: 4713616,
            sha256: "0700d6d70b30490e68ff9deca0b45b80310745b491855bde3a13e1692d0cbce1"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/it-en/retrain_hr_d1nPDwVeSD6t-HdtWA4xNg/exported/vocab.iten.spm.gz",
            downloadBytes: 407598,
            bytes: 812724,
            sha256: "3ef0211d4ae6db21440892f180f2019fe2bfc110a330ffa9d2eca9665e4f2bc5"
          }
        ]
      },
      {
        pair: "jaen",
        from: "ja",
        to: "en",
        architecture: "base-memory",
        downloadBytes: 38143661,
        bytes: 54769181,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/ja-en/cjk_retrain_base-memory_NLRJLD_pQFyrvgKtbie2nA/exported/model.jaen.intgemm.alphas.bin.gz",
            downloadBytes: 32577435,
            bytes: 43977787,
            sha256: "3a603e20bfe1be86071913f9e23ab5129075bc0a8490151020ac4821e4f17302"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/ja-en/cjk_retrain_base-memory_NLRJLD_pQFyrvgKtbie2nA/exported/lex.50.50.jaen.s2t.bin.gz",
            downloadBytes: 4819610,
            bytes: 9348172,
            sha256: "525f412f0d210536c2933c78ae395fa0bf2b5ee6cc5dda61ebc2e79410ebaee4"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/ja-en/cjk_retrain_base-memory_NLRJLD_pQFyrvgKtbie2nA/exported/vocab.jaen.spm.gz",
            downloadBytes: 746616,
            bytes: 1443222,
            sha256: "5cb217758bae05877bb3f0c2f612e4e7c1e4cb03c10db11f4a47098d7ae62919"
          }
        ]
      },
      {
        pair: "knen",
        from: "kn",
        to: "en",
        architecture: "tiny",
        downloadBytes: 15656541,
        bytes: 22862463,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/kn-en/h1-2025_Ql24XjW0Sp-zWsmLrV5TGQ/exported/model.knen.intgemm.alphas.bin.gz",
            downloadBytes: 13077357,
            bytes: 17141051,
            sha256: "49e8d3bd794b098047f7b177d9d0e6d3e49ac798c2b75bc132149cb46c5bfbfd"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/kn-en/h1-2025_Ql24XjW0Sp-zWsmLrV5TGQ/exported/lex.50.50.knen.s2t.bin.gz",
            downloadBytes: 2128860,
            bytes: 4655776,
            sha256: "aa50a74f15e9ef8cf27a5b905c17037bd9d67883afde71b34c4138f9507fedfc"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/kn-en/h1-2025_Ql24XjW0Sp-zWsmLrV5TGQ/exported/vocab.knen.spm.gz",
            downloadBytes: 450324,
            bytes: 1065636,
            sha256: "d729397a42dba5801f330927a9956527161d6e0711b59fcea7cd2e862e6f36cc"
          }
        ]
      },
      {
        pair: "koen",
        from: "ko",
        to: "en",
        architecture: "base-memory",
        downloadBytes: 37241532,
        bytes: 54005366,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/ko-en/cjk_retrain_base-memory_QgYNtG3BTzKBFSV1wl06Pg/exported/model.koen.intgemm.alphas.bin.gz",
            downloadBytes: 32152814,
            bytes: 43977787,
            sha256: "7cb30cbc0a86e242084756445268a2346136771c92b884d9b4ebb077f67d5507"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/ko-en/cjk_retrain_base-memory_QgYNtG3BTzKBFSV1wl06Pg/exported/lex.50.50.koen.s2t.bin.gz",
            downloadBytes: 4381854,
            bytes: 8617516,
            sha256: "b26291f063ce216a74239275f0485534a38111203e59d42a2a56ba62d6eeb196"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/ko-en/cjk_retrain_base-memory_QgYNtG3BTzKBFSV1wl06Pg/exported/vocab.koen.spm.gz",
            downloadBytes: 706864,
            bytes: 1410063,
            sha256: "1c72b740ab793cdc3a8f16913dd6b4e806c77421077dd2d85edeb7be38418598"
          }
        ]
      },
      {
        pair: "lten",
        from: "lt",
        to: "en",
        architecture: "tiny",
        downloadBytes: 15284093,
        bytes: 22672798,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/lt-en/spring-2024_aAroslw9Ru-c5cam6SvLBg/exported/model.lten.intgemm.alphas.bin.gz",
            downloadBytes: 12571257,
            bytes: 17141051,
            sha256: "0aa4571ede6f68db2f14d2662875b4d2e6323aeccd75e3b4377ab9072a22db70"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/lt-en/spring-2024_aAroslw9Ru-c5cam6SvLBg/exported/lex.50.50.lten.s2t.bin.gz",
            downloadBytes: 2308876,
            bytes: 4724124,
            sha256: "f687821f4074063031b7857bd61232b4ef520f3cbac5a80d59993b27bf10a032"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/lt-en/spring-2024_aAroslw9Ru-c5cam6SvLBg/exported/vocab.lten.spm.gz",
            downloadBytes: 403960,
            bytes: 807623,
            sha256: "df3c6b7e9aa74ab4cce9f4ec73a44aac80be05fcd41ae55198a92c07c5ee3109"
          }
        ]
      },
      {
        pair: "lven",
        from: "lv",
        to: "en",
        architecture: "tiny",
        downloadBytes: 15228176,
        bytes: 22170805,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/lv-en/spring-2024_fkUrjGNcQiWrTQ5BcYbkgg/exported/model.lven.intgemm.alphas.bin.gz",
            downloadBytes: 12689153,
            bytes: 17141051,
            sha256: "7a96dd363ae9b4485aa254ddbff042223a565a20bfe5ba0ba29b94d8ded0406a"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/lv-en/spring-2024_fkUrjGNcQiWrTQ5BcYbkgg/exported/lex.50.50.lven.s2t.bin.gz",
            downloadBytes: 2131786,
            bytes: 4214476,
            sha256: "dff852d317f80169899e2e1132277cf922fa7a117b060e09a14dd19c0e1a02b8"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/lv-en/spring-2024_fkUrjGNcQiWrTQ5BcYbkgg/exported/vocab.lven.spm.gz",
            downloadBytes: 407237,
            bytes: 815278,
            sha256: "585a265757c071f5694d1bb7e65b73f38b1d065a62cda61510fa6c54fb87d2c9"
          }
        ]
      },
      {
        pair: "mlen",
        from: "ml",
        to: "en",
        architecture: "tiny",
        downloadBytes: 15543598,
        bytes: 23268070,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/ml-en/h1-2025_Ahkzk6jNTAut7rz6laKkGQ/exported/model.mlen.intgemm.alphas.bin.gz",
            downloadBytes: 12792306,
            bytes: 17141051,
            sha256: "5480719a5a8ac43acdf28db1c89a4d60837a475e1120ea0c4e021c4d5b7e6fd6"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/ml-en/h1-2025_Ahkzk6jNTAut7rz6laKkGQ/exported/lex.50.50.mlen.s2t.bin.gz",
            downloadBytes: 2296381,
            bytes: 5017972,
            sha256: "afb882ad10c9540c12fa105e1e5418a54ec8117f11c4f17d998adf1d445e308c"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/ml-en/h1-2025_Ahkzk6jNTAut7rz6laKkGQ/exported/vocab.mlen.spm.gz",
            downloadBytes: 454911,
            bytes: 1109047,
            sha256: "c6b2150c85a18cae437d4e7245ef29d4b3629b2c611fce812d115a59c3b80efe"
          }
        ]
      },
      {
        pair: "msen",
        from: "ms",
        to: "en",
        architecture: "tiny",
        downloadBytes: 15083678,
        bytes: 22315138,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/ms-en/h1-2025_afzwIUAqQRWx5PtvozOHnw/exported/model.msen.intgemm.alphas.bin.gz",
            downloadBytes: 12538542,
            bytes: 17141051,
            sha256: "db5c9415591f8a35c5c72046227b9c9398acade5df8afb5e6ac9f11f7d6650d5"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/ms-en/h1-2025_afzwIUAqQRWx5PtvozOHnw/exported/lex.50.50.msen.s2t.bin.gz",
            downloadBytes: 2141259,
            bytes: 4371896,
            sha256: "1ef575be54a310eeace84c52e609f2a8c292f3c4b170376ee6ee3524c0c30316"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/ms-en/h1-2025_afzwIUAqQRWx5PtvozOHnw/exported/vocab.msen.spm.gz",
            downloadBytes: 403877,
            bytes: 802191,
            sha256: "6db8c20803d5f9c9fff2b6c3950f5bda4a9fa14aaef1d92818f8a3d53fd850f9"
          }
        ]
      },
      {
        pair: "nben",
        from: "nb",
        to: "en",
        architecture: "tiny",
        downloadBytes: 15911406,
        bytes: 22461294,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/nb-en/h1-2025_YKogHXi6Q4es3P7fEWEaBw/exported/model.nben.intgemm.alphas.bin.gz",
            downloadBytes: 13193689,
            bytes: 17141051,
            sha256: "00ab7b969156f6c948be59dad4755e47a24eeb31aa39f02f1de7bce43081cc2a"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/nb-en/h1-2025_YKogHXi6Q4es3P7fEWEaBw/exported/lex.50.50.nben.s2t.bin.gz",
            downloadBytes: 2308582,
            bytes: 4517876,
            sha256: "cc07976874c905e859918be71d3fe993c9ec8696d986db2418bb1a16ff4ea500"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/nb-en/h1-2025_YKogHXi6Q4es3P7fEWEaBw/exported/vocab.nben.spm.gz",
            downloadBytes: 409135,
            bytes: 802367,
            sha256: "23eb1743070efac5a447f4f72aafda69b1985af272cece85a2f0bb08e6fcdeef"
          }
        ]
      },
      {
        pair: "nlen",
        from: "nl",
        to: "en",
        architecture: "base-memory",
        downloadBytes: 25674063,
        bytes: 37231907,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/nl-en/retrain_hr_JbTCb42HREGvK8d6aOCjFQ/exported/model.nlen.intgemm.alphas.bin.gz",
            downloadBytes: 22647743,
            bytes: 31561787,
            sha256: "ff987741ff15a5d94fff16cbef28f2b0a85a6e9547d982fad60ac09d16d11270"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/nl-en/retrain_hr_JbTCb42HREGvK8d6aOCjFQ/exported/lex.50.50.nlen.s2t.bin.gz",
            downloadBytes: 2616098,
            bytes: 4862412,
            sha256: "811ac8f9dcbd12706e2d73a7057a7bbe6b9f0607d15170ffe9439977e8229b41"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/nl-en/retrain_hr_JbTCb42HREGvK8d6aOCjFQ/exported/vocab.nlen.spm.gz",
            downloadBytes: 410222,
            bytes: 807708,
            sha256: "c09588ca5662b230ed65bd39a07f58d9f7dd21c3a19e4aeb1bff39bf3b297c56"
          }
        ]
      },
      {
        pair: "noen",
        from: "no",
        to: "en",
        architecture: "tiny",
        downloadBytes: 15911406,
        bytes: 22461294,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/no-en/h1-2025_YKogHXi6Q4es3P7fEWEaBw/exported/model.noen.intgemm.alphas.bin.gz",
            downloadBytes: 13193689,
            bytes: 17141051,
            sha256: "00ab7b969156f6c948be59dad4755e47a24eeb31aa39f02f1de7bce43081cc2a"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/no-en/h1-2025_YKogHXi6Q4es3P7fEWEaBw/exported/lex.50.50.noen.s2t.bin.gz",
            downloadBytes: 2308582,
            bytes: 4517876,
            sha256: "cc07976874c905e859918be71d3fe993c9ec8696d986db2418bb1a16ff4ea500"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/no-en/h1-2025_YKogHXi6Q4es3P7fEWEaBw/exported/vocab.noen.spm.gz",
            downloadBytes: 409135,
            bytes: 802367,
            sha256: "23eb1743070efac5a447f4f72aafda69b1985af272cece85a2f0bb08e6fcdeef"
          }
        ]
      },
      {
        pair: "plen",
        from: "pl",
        to: "en",
        architecture: "base-memory",
        downloadBytes: 25533351,
        bytes: 37347607,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/pl-en/retrain_hr_HLLa6ZwsSomB0kyBr7Iz6w/exported/model.plen.intgemm.alphas.bin.gz",
            downloadBytes: 22630393,
            bytes: 31561787,
            sha256: "06dbab3baa3bbceab746bc6a3bba807878f38536382c03acddf59d3edf3b5d94"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/pl-en/retrain_hr_HLLa6ZwsSomB0kyBr7Iz6w/exported/lex.50.50.plen.s2t.bin.gz",
            downloadBytes: 2489764,
            bytes: 4964208,
            sha256: "b295dfefa7022a62e105276e8c39fdfd67bffe588f4fd78583edd4e04ee0cb3b"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/pl-en/retrain_hr_HLLa6ZwsSomB0kyBr7Iz6w/exported/vocab.plen.spm.gz",
            downloadBytes: 413194,
            bytes: 821612,
            sha256: "2000f182efa8ce5f69bc3f9e574666b5bc2c0af684eedd32f69d15aa9021ea85"
          }
        ]
      },
      {
        pair: "pten",
        from: "pt",
        to: "en",
        architecture: "base-memory",
        downloadBytes: 25596942,
        bytes: 37013005,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/pt-en/retrain_hr_drxrs5bGSsOWvfK9lyZISw/exported/model.pten.intgemm.alphas.bin.gz",
            downloadBytes: 22700409,
            bytes: 31561787,
            sha256: "7b854f1ec5a485dd33efd7c1bc01dd7d5a57f566957c5e47722af333f0ce9157"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/pt-en/retrain_hr_drxrs5bGSsOWvfK9lyZISw/exported/lex.50.50.pten.s2t.bin.gz",
            downloadBytes: 2487847,
            bytes: 4634492,
            sha256: "2685d8b6530be92a4db4cc61f15a097eb114552be15cb6c1699e9d2d99d24470"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/pt-en/retrain_hr_drxrs5bGSsOWvfK9lyZISw/exported/vocab.pten.spm.gz",
            downloadBytes: 408686,
            bytes: 816726,
            sha256: "d9f46182823d5bbc84201252b2dfcac28f63e561f0ec827ed858f241864c9def"
          }
        ]
      },
      {
        pair: "roen",
        from: "ro",
        to: "en",
        architecture: "tiny",
        downloadBytes: 15278473,
        bytes: 22633591,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/ro-en/spring-2024_RwH0W_MDRK2BmZA6VzAmBg/exported/model.roen.intgemm.alphas.bin.gz",
            downloadBytes: 12722200,
            bytes: 17141051,
            sha256: "e7542557fc6dbafacddae7b48e67fcdb07bd67b3fb55a76139edf366eca5dbdb"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/ro-en/spring-2024_RwH0W_MDRK2BmZA6VzAmBg/exported/lex.50.50.roen.s2t.bin.gz",
            downloadBytes: 2159556,
            bytes: 4691708,
            sha256: "d242745eadff6f345784fccf1d58046061501b28c8190ba5912a9da5f056cd2f"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/ro-en/spring-2024_RwH0W_MDRK2BmZA6VzAmBg/exported/vocab.roen.spm.gz",
            downloadBytes: 396717,
            bytes: 800832,
            sha256: "2a690fbcd1b79bc9b99c43d582252720e0900245c82ecc813c8eb05cf063fd0c"
          }
        ]
      },
      {
        pair: "ruen",
        from: "ru",
        to: "en",
        architecture: "tiny",
        downloadBytes: 14995467,
        bytes: 22530152,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/ru-en/spring-2024_QrcdYgbwS7e7xbhtOSdoNQ/exported/model.ruen.intgemm.alphas.bin.gz",
            downloadBytes: 12613599,
            bytes: 17141051,
            sha256: "b1d85c13cfbb05e1d326dd6f0fb5ef270a2011b547450260f96567a93f446c94"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/ru-en/spring-2024_QrcdYgbwS7e7xbhtOSdoNQ/exported/lex.50.50.ruen.s2t.bin.gz",
            downloadBytes: 1962008,
            bytes: 4483844,
            sha256: "f654693577505fd38b1f3d220cdd4ffffbb45afb900a60cf751f0724eadc74e0"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/ru-en/spring-2024_QrcdYgbwS7e7xbhtOSdoNQ/exported/vocab.ruen.spm.gz",
            downloadBytes: 419860,
            bytes: 905257,
            sha256: "93bdc941b16e523695c319f74778bca9fd8b75a25ad75020cdc98aef74cdc0fc"
          }
        ]
      },
      {
        pair: "sken",
        from: "sk",
        to: "en",
        architecture: "tiny",
        downloadBytes: 15574825,
        bytes: 22862457,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/sk-en/spring-2024_TD01UwWXRKacv3wnYeVKbg/exported/model.sken.intgemm.alphas.bin.gz",
            downloadBytes: 12821519,
            bytes: 17141051,
            sha256: "1686f94838ace314719e945606a09a66dafd40847dd3fd352ad3f7a969aac62f"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/sk-en/spring-2024_TD01UwWXRKacv3wnYeVKbg/exported/lex.50.50.sken.s2t.bin.gz",
            downloadBytes: 2348184,
            bytes: 4913324,
            sha256: "18577a7ded6b9957c948f2a384683f7ce09def42336c8141eee7ba86b79e2c8e"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/sk-en/spring-2024_TD01UwWXRKacv3wnYeVKbg/exported/vocab.sken.spm.gz",
            downloadBytes: 405122,
            bytes: 808082,
            sha256: "7d25655bd15f34d77db5d2cb96a51c7943c5528f37f83b677a09bb0ea4e4f59b"
          }
        ]
      },
      {
        pair: "slen",
        from: "sl",
        to: "en",
        architecture: "base-memory",
        downloadBytes: 26267497,
        bytes: 36685349,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/sl-en/h1-2025_TCeLyjkQRL2YbTXrUhTlAg/exported/model.slen.intgemm.alphas.bin.gz",
            downloadBytes: 23730414,
            bytes: 31561787,
            sha256: "9d15df58b60048366de4f7b6e727157ffdaea3a0fd1c1759ce232b057e2f991c"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/sl-en/h1-2025_TCeLyjkQRL2YbTXrUhTlAg/exported/lex.50.50.slen.s2t.bin.gz",
            downloadBytes: 2138548,
            bytes: 4320484,
            sha256: "f456a49e437ccb4a547e4b51480e29c8b83f11e26a3713af35b078cd4dd255cc"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/sl-en/h1-2025_TCeLyjkQRL2YbTXrUhTlAg/exported/vocab.slen.spm.gz",
            downloadBytes: 398535,
            bytes: 803078,
            sha256: "54ed331d3435e2bdc5b02462180197b77631f466fc0e61897b5469449857dd2b"
          }
        ]
      },
      {
        pair: "sqen",
        from: "sq",
        to: "en",
        architecture: "tiny",
        downloadBytes: 15170001,
        bytes: 22217767,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/sq-en/h1-2025_I8xy7KMeQoe3mMEV3umzfQ/exported/model.sqen.intgemm.alphas.bin.gz",
            downloadBytes: 12593638,
            bytes: 17141051,
            sha256: "4b0ce319e7c8f7e1836ce18cb6522c83268e8cff54f2a7f5dcef270250a44475"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/sq-en/h1-2025_I8xy7KMeQoe3mMEV3umzfQ/exported/lex.50.50.sqen.s2t.bin.gz",
            downloadBytes: 2165940,
            bytes: 4256516,
            sha256: "b2f51df0bc14b9f89a29d39652a80167ef413eb1579957ecea825cb0a7575c60"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/sq-en/h1-2025_I8xy7KMeQoe3mMEV3umzfQ/exported/vocab.sqen.spm.gz",
            downloadBytes: 410423,
            bytes: 820200,
            sha256: "6b7ce057b54ed983eb47087254ea8673e20a857739fc5b57874c80c3301bb91d"
          }
        ]
      },
      {
        pair: "sven",
        from: "sv",
        to: "en",
        architecture: "tiny",
        downloadBytes: 15410099,
        bytes: 22579780,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/sv-en/spring-2024_ObaRXwXeSW6HA_-J5_dE-g/exported/model.sven.intgemm.alphas.bin.gz",
            downloadBytes: 12847259,
            bytes: 17141051,
            sha256: "92d79e2725718b84aed486473bdfcbe6bba3e7094922d4bead8a121cfa346372"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/sv-en/spring-2024_ObaRXwXeSW6HA_-J5_dE-g/exported/lex.50.50.sven.s2t.bin.gz",
            downloadBytes: 2165215,
            bytes: 4645680,
            sha256: "1c4640765e806d905cdc4f51158f6f869c78709b9e8a43070877965fa13c160e"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/sv-en/spring-2024_ObaRXwXeSW6HA_-J5_dE-g/exported/vocab.sven.spm.gz",
            downloadBytes: 397625,
            bytes: 793049,
            sha256: "93427195fac4125722ed778707478ef78cb77b3fdf1ed5b93bee9fd36e30a8ec"
          }
        ]
      },
      {
        pair: "taen",
        from: "ta",
        to: "en",
        architecture: "base-memory",
        downloadBytes: 26388788,
        bytes: 37607349,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/ta-en/next26_dwRqBIcMSDG7drW2_xDIMA/exported/model.taen.intgemm.alphas.bin.gz",
            downloadBytes: 23526938,
            bytes: 31561787,
            sha256: "5413fca6c35cd9c50157df1ebd425d6ca02713bfedc1ba7e5fb3050a437b13b6"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/ta-en/next26_dwRqBIcMSDG7drW2_xDIMA/exported/lex.50.50.taen.s2t.bin.gz",
            downloadBytes: 2410364,
            bytes: 4940884,
            sha256: "2eb77117d9997984fe700c386126865a6ca951fcfb78b3c29b2921a6a770d63a"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/ta-en/next26_dwRqBIcMSDG7drW2_xDIMA/exported/vocab.taen.spm.gz",
            downloadBytes: 451486,
            bytes: 1104678,
            sha256: "5ce5f840335d9cbbbd76ef160ee2566ebe239d820d66a827996f40dd01467a92"
          }
        ]
      },
      {
        pair: "teen",
        from: "te",
        to: "en",
        architecture: "tiny",
        downloadBytes: 15860062,
        bytes: 23013004,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/te-en/h1-2025_YEapi_rWRsSUVTqbBTqupw/exported/model.teen.intgemm.alphas.bin.gz",
            downloadBytes: 13202063,
            bytes: 17141051,
            sha256: "e2ec7b13ba6148eba309244ee17dc935f1b71e95bbf57154216f6247877abb7e"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/te-en/h1-2025_YEapi_rWRsSUVTqbBTqupw/exported/lex.50.50.teen.s2t.bin.gz",
            downloadBytes: 2209444,
            bytes: 4815756,
            sha256: "5df84ca17e4cc76a73ef7d93f94f53a89f37a11a456f2b6373ff19c4ce4ef964"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/te-en/h1-2025_YEapi_rWRsSUVTqbBTqupw/exported/vocab.teen.spm.gz",
            downloadBytes: 448555,
            bytes: 1056197,
            sha256: "dd57e1d68316ae32f9ba3f77223f317ce39cd1ef72e69e6b06b7c1d1ba954052"
          }
        ]
      },
      {
        pair: "then",
        from: "th",
        to: "en",
        architecture: "base-memory",
        downloadBytes: 25664671,
        bytes: 37044272,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/th-en/new-opuscleaner-en-th_aIiNAAZbRny4ODcYGOMlEA/exported/model.then.intgemm.alphas.bin.gz",
            downloadBytes: 22974117,
            bytes: 31561787,
            sha256: "f70a501324743668b031bee19cd001a66839e8e5dfc0b4a1c44d5ea99d4e8d66"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/th-en/new-opuscleaner-en-th_aIiNAAZbRny4ODcYGOMlEA/exported/lex.50.50.then.s2t.bin.gz",
            downloadBytes: 2239323,
            bytes: 4487056,
            sha256: "3a7661a7f5c811c83f05f53008083b042fea0334fc6044ca1fda4982a8d48453"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/th-en/new-opuscleaner-en-th_aIiNAAZbRny4ODcYGOMlEA/exported/vocab.then.spm.gz",
            downloadBytes: 451231,
            bytes: 995429,
            sha256: "b625d3dcdfa2b4bbec496c9a0a30d169c917464ac5ea75506c0699972fea95f0"
          }
        ]
      },
      {
        pair: "tren",
        from: "tr",
        to: "en",
        architecture: "tiny",
        downloadBytes: 15242651,
        bytes: 22614681,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/tr-en/statmt_xxxxxxxxRxSxxxxxxxxxxA/exported/model.tren.intgemm.alphas.bin.gz",
            downloadBytes: 12362908,
            bytes: 17140836,
            sha256: "bd18594ac5a7f1d9997e7ea5bd80272082219cf8b1ce604766e4f207eb86abbf"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/tr-en/statmt_xxxxxxxxRxSxxxxxxxxxxA/exported/lex.50.50.tren.s2t.bin.gz",
            downloadBytes: 2470683,
            bytes: 4662492,
            sha256: "d3374ab5267a73ee1aa1d926a298bd349426835f40856991ee959bc5cd4f9fce"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/tr-en/statmt_xxxxxxxxRxSxxxxxxxxxxA/exported/vocab.tren.spm.gz",
            downloadBytes: 409060,
            bytes: 811353,
            sha256: "ed328e589a3ccd70fd3ce7773fc3c01d8b7b18c687464cacf17fd40a8c0daadd"
          }
        ]
      },
      {
        pair: "uken",
        from: "uk",
        to: "en",
        architecture: "tiny",
        downloadBytes: 14883286,
        bytes: 21941581,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/uk-en/spring-2024_WEPBsc-zQWSDn34b5KFscw/exported/model.uken.intgemm.alphas.bin.gz",
            downloadBytes: 12677432,
            bytes: 17141051,
            sha256: "2e7b8bc9d2569d8b4ae244e964cdc343a0aa3735cc83ecb664be84a37cb45f48"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/uk-en/spring-2024_WEPBsc-zQWSDn34b5KFscw/exported/lex.50.50.uken.s2t.bin.gz",
            downloadBytes: 1790588,
            bytes: 3914120,
            sha256: "32b5e0df493671a223cb5cb32430181cbb7fe6b5562c91dbc3d35410d37e5ff6"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/uk-en/spring-2024_WEPBsc-zQWSDn34b5KFscw/exported/vocab.uken.spm.gz",
            downloadBytes: 415266,
            bytes: 886410,
            sha256: "8b51480dfc4ca2d7a08d2bfdaa9e57353ca97e6cf3d5f9aba4c0179d3665bfc0"
          }
        ]
      },
      {
        pair: "vien",
        from: "vi",
        to: "en",
        architecture: "tiny",
        downloadBytes: 15177910,
        bytes: 21808485,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/vi-en/spring-2024_Nc0SHbrgQaiFt4_FmKBXOA/exported/model.vien.intgemm.alphas.bin.gz",
            downloadBytes: 12914609,
            bytes: 17141051,
            sha256: "de4bf2b9ffb4d910e32720ec3a43655fb6f4062ce5219332f824fc1bdca7a5f4"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/vi-en/spring-2024_Nc0SHbrgQaiFt4_FmKBXOA/exported/lex.50.50.vien.s2t.bin.gz",
            downloadBytes: 1887658,
            bytes: 3910184,
            sha256: "3a071ed3d982f6eb6ee116b84067bf70041e4229e43ea65ecb6d7c2796e8851b"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/vi-en/spring-2024_Nc0SHbrgQaiFt4_FmKBXOA/exported/vocab.vien.spm.gz",
            downloadBytes: 375643,
            bytes: 757250,
            sha256: "cb152765d1e71ea3cf96fdb339c764b7201be7b9ab32e20cfebcf16a20fc0939"
          }
        ]
      },
      {
        pair: "zh_hanten",
        from: "zh_hant",
        to: "en",
        architecture: "base-memory",
        downloadBytes: 37754294,
        bytes: 51817972,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/zh_hant-en/zh_hant_openlid_zh_tw_lr0002_WJi5Ozi7SZWC6hgfD5GhTA/exported/model.zh_hanten.intgemm.alphas.bin.gz",
            downloadBytes: 33653648,
            bytes: 43849787,
            sha256: "0aee91790894458f5d367551f6edcd4c9cb97852c34f221bcbf9f4701ebcf0cd"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/zh_hant-en/zh_hant_openlid_zh_tw_lr0002_WJi5Ozi7SZWC6hgfD5GhTA/exported/lex.50.50.zh_hanten.s2t.bin.gz",
            downloadBytes: 3268812,
            bytes: 6385944,
            sha256: "aa7daf6cfc85c0cd2c10e2944d66f6da55497c9c6408789f3adfded4074c2fb1"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/zh_hant-en/zh_hant_openlid_zh_tw_lr0002_WJi5Ozi7SZWC6hgfD5GhTA/exported/srcvocab.zh_hanten.spm.gz",
            downloadBytes: 423691,
            bytes: 769669,
            sha256: "5cc6a76611dbf86219f109141533606b15ecb34eee83673bb86b2c16b14734db"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/zh_hant-en/zh_hant_openlid_zh_tw_lr0002_WJi5Ozi7SZWC6hgfD5GhTA/exported/trgvocab.zh_hanten.spm.gz",
            downloadBytes: 408143,
            bytes: 812572,
            sha256: "7bf002db37c10d3b114cc5588d7fdcb16c57d0fd1e2c34354c22cc9f0b6c3c29"
          }
        ]
      },
      {
        pair: "zhen",
        from: "zh",
        to: "en",
        architecture: "base-memory",
        downloadBytes: 38287826,
        bytes: 54556676,
        files: [
          {
            role: "model",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/zh-en/cjk_retrain_base-memory_cNY_yaJCStGwnTeXgW8A5w/exported/model.zhen.intgemm.alphas.bin.gz",
            downloadBytes: 32726806,
            bytes: 43977787,
            sha256: "5cd149601802fc8a18124a1c1306144dbbedc058630c4ddb2d53aa76fa9c7c06"
          },
          {
            role: "shortlist",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/zh-en/cjk_retrain_base-memory_cNY_yaJCStGwnTeXgW8A5w/exported/lex.50.50.zhen.s2t.bin.gz",
            downloadBytes: 4822158,
            bytes: 9219192,
            sha256: "8524dd4c93ffd7f0ae7be32f77a7c14fea7cdbbebe34ea6ad0ec368d5ddd8b13"
          },
          {
            role: "vocab",
            url: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/zh-en/cjk_retrain_base-memory_cNY_yaJCStGwnTeXgW8A5w/exported/vocab.zhen.spm.gz",
            downloadBytes: 738862,
            bytes: 1359697,
            sha256: "dff594318ab7d8b7b60b844ab98ebe6b932ae8045fab15235404c787715965b3"
          }
        ]
      }
    ]
  };

  // src/lib/models/registry.js
  var ROLE_ORDER2 = (
    /** @type {Role[]} */
    ["model", "shortlist", "vocab"]
  );
  var SHA256 = /^[0-9a-f]{64}$/;
  function isLanguageCode2(code) {
    return /^[a-z]{2,3}(_[a-z]{4})?$/.test(code);
  }
  function isSize(value, required) {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) return false;
    return required ? value > 0 : value >= 0;
  }
  function parseFile(raw, where, requireSums) {
    if (typeof raw !== "object" || raw === null) return { ok: false, problem: `${where}: not an object` };
    const { role, url, downloadBytes, bytes, sha256 } = (
      /** @type {Record<string, unknown>} */
      raw
    );
    if (typeof role !== "string" || !/** @type {string[]} */
    ROLE_ORDER2.includes(role)) {
      return { ok: false, problem: `${where}: unknown role ${JSON.stringify(role)}` };
    }
    if (typeof url !== "string" || !url.startsWith("https://")) {
      return { ok: false, problem: `${where}: url is not https` };
    }
    if (!isSize(downloadBytes, requireSums) || !isSize(bytes, requireSums)) {
      return { ok: false, problem: `${where}: sizes must be whole numbers` };
    }
    if (typeof sha256 === "string" && SHA256.test(sha256)) {
      return { ok: true, value: { role: (
        /** @type {Role} */
        role
      ), url, downloadBytes, bytes, sha256 } };
    }
    if (requireSums || sha256 !== null && sha256 !== void 0) {
      return { ok: false, problem: `${where}: sha256 is not 64 hex characters` };
    }
    return { ok: true, value: { role: (
      /** @type {Role} */
      role
    ), url, downloadBytes, bytes, sha256: null } };
  }
  function parseModel(raw, index, requireSums) {
    const where = `model ${index}`;
    if (typeof raw !== "object" || raw === null) return { ok: false, problem: `${where}: not an object` };
    const { pair, from, to, files } = (
      /** @type {Record<string, unknown>} */
      raw
    );
    if (typeof from !== "string" || typeof to !== "string" || !isLanguageCode2(from) || !isLanguageCode2(to)) {
      return { ok: false, problem: `${where}: from and to must be language codes like en or zh_hant` };
    }
    if (pair !== `${from}${to}`) {
      return { ok: false, problem: `${where}: pair ${JSON.stringify(pair)} does not match ${from} and ${to}` };
    }
    if (!Array.isArray(files) || files.length === 0) {
      return { ok: false, problem: `${where}: no files` };
    }
    const parsed3 = [];
    for (const [fileIndex, file] of files.entries()) {
      const result = parseFile(file, `${where}, file ${fileIndex}`, requireSums);
      if (!result.ok) return result;
      parsed3.push(result.value);
    }
    for (const role of ROLE_ORDER2) {
      if (!parsed3.some((file) => file.role === role)) {
        return { ok: false, problem: `${where}: no ${role} file` };
      }
    }
    if (parsed3.filter((file) => file.role === "model").length > 1) {
      return { ok: false, problem: `${where}: more than one model file` };
    }
    parsed3.sort((a, b) => ROLE_ORDER2.indexOf(a.role) - ROLE_ORDER2.indexOf(b.role));
    return {
      ok: true,
      value: {
        pair,
        from,
        to,
        downloadBytes: parsed3.reduce((total, file) => total + file.downloadBytes, 0),
        bytes: parsed3.reduce((total, file) => total + file.bytes, 0),
        files: parsed3
      }
    };
  }
  function parseRegistry(raw, options = {}) {
    const requireSums = options.requireSums ?? true;
    if (typeof raw !== "object" || raw === null) return { models: [], problems: ["registry is not an object"] };
    const list = (
      /** @type {Record<string, unknown>} */
      raw["models"]
    );
    if (!Array.isArray(list)) return { models: [], problems: ["registry has no models array"] };
    const models = [];
    const problems = [];
    const seen = /* @__PURE__ */ new Set();
    for (const [index, entry] of list.entries()) {
      const result = parseModel(entry, index, requireSums);
      if (!result.ok) {
        problems.push(result.problem);
        continue;
      }
      if (seen.has(result.value.pair)) {
        problems.push(`model ${index}: ${result.value.pair} is listed twice`);
        continue;
      }
      seen.add(result.value.pair);
      models.push(result.value);
    }
    models.sort((a, b) => a.pair.localeCompare(b.pair));
    return { models, problems };
  }
  var parsed2 = null;
  function registry() {
    parsed2 ??= parseRegistry(registry_default);
    return parsed2;
  }
  function registryModels() {
    return registry().models;
  }
  function modelRows(installed, available = registryModels()) {
    const rows = /* @__PURE__ */ new Map();
    for (const model of available) {
      rows.set(model.pair, { pair: model.pair, from: model.from, to: model.to, installed: null, available: model });
    }
    for (const meta of installed) {
      const row = rows.get(meta.pair);
      if (row === void 0) {
        rows.set(meta.pair, { pair: meta.pair, from: meta.from, to: meta.to, installed: meta, available: null });
      } else {
        row.installed = meta;
      }
    }
    return [...rows.values()].sort((a, b) => a.pair.localeCompare(b.pair));
  }
  function registrySource() {
    const { source, checkedAt } = (
      /** @type {Record<string, unknown>} */
      registry_default
    );
    return {
      source: typeof source === "string" ? source : "",
      checkedAt: typeof checkedAt === "string" ? checkedAt : ""
    };
  }

  // src/lib/models/live.js
  var LIVE_MODELS_KEY = "modelsIndex";
  function readStored2(stored) {
    if (typeof stored !== "object" || stored === null) return null;
    const { fetchedAt, etag, models } = (
      /** @type {Record<string, unknown>} */
      stored
    );
    if (typeof fetchedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fetchedAt)) return null;
    const parsed3 = parseRegistry({ models }, { requireSums: false });
    const prefix = allowedPrefix(registrySource().source);
    const kept = parsed3.models.filter((model) => model.files.every((file) => underPrefix(file.url, prefix)));
    if (kept.length === 0) return null;
    return { fetchedAt, etag: typeof etag === "string" ? etag : null, models: kept };
  }
  async function readLiveModels() {
    try {
      const stored = await webext().storage.local.get(LIVE_MODELS_KEY);
      const read = readStored2(stored[LIVE_MODELS_KEY]);
      return read === null ? null : { fetchedAt: read.fetchedAt, models: read.models };
    } catch {
      return null;
    }
  }
  async function refreshLiveModels(options = {}) {
    const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    const today = options.today ?? (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const { source } = registrySource();
    if (source === "") return { ok: false, detail: "no source in the packaged registry" };
    let cached = null;
    try {
      const stored = await webext().storage.local.get(LIVE_MODELS_KEY);
      cached = readStored2(stored[LIVE_MODELS_KEY]);
    } catch {
    }
    let response;
    try {
      response = await fetchImpl(source, {
        // The conditional request is the whole economy of this refresh; the
        // browser's own cache underneath it would only blur whose answer this is.
        cache: "no-store",
        redirect: "follow",
        ...cached?.etag ? { headers: { "If-None-Match": cached.etag } } : {}
      });
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
    if (response.status === 304 && cached !== null) {
      const value2 = { fetchedAt: today, models: cached.models };
      await write2({ ...value2, etag: cached.etag });
      return { ok: true, changed: false, value: value2 };
    }
    if (!response.ok) {
      return { ok: false, detail: `${response.status} ${response.statusText}`.trim() };
    }
    let raw;
    try {
      raw = await response.json();
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
    const { models } = convertUpstreamIndex(raw, source);
    if (models.length === 0) return { ok: false, detail: "the index held no usable models" };
    const value = { fetchedAt: today, models };
    await write2({ ...value, etag: response.headers.get("ETag") });
    return { ok: true, changed: true, value };
  }
  async function write2(value) {
    try {
      await webext().storage.local.set({ [LIVE_MODELS_KEY]: value });
    } catch {
    }
  }

  // src/lib/models/inventory.js
  var MODELS_KEY = "models";
  function inventoryOf(metas) {
    return { pairs: metas.map((meta) => meta.pair) };
  }
  async function writeInventory(metas) {
    await webext().storage.local.set({ [MODELS_KEY]: inventoryOf(metas) });
  }

  // src/lib/models/store.js
  var DB_NAME2 = "reread-models";
  var DB_VERSION2 = 1;
  var META2 = "meta";
  var FILES = "files";
  async function publishInventory() {
    try {
      await writeInventory(await listModels());
    } catch {
    }
  }
  function promisify2(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    });
  }
  function open2() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME2, DB_VERSION2);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(META2)) db.createObjectStore(META2, { keyPath: "pair" });
        if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: "pair" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Cannot open the model database"));
      request.onblocked = () => reject(new Error("The model database is in use by another page"));
    });
  }
  async function withStores2(stores, mode, work) {
    const db = await open2();
    try {
      const transaction = db.transaction(stores, mode);
      const result = await work(transaction);
      await new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve(void 0);
        transaction.onerror = () => reject(transaction.error ?? new Error("Model transaction failed"));
        transaction.onabort = () => reject(transaction.error ?? new Error("Model transaction aborted"));
      });
      return result;
    } finally {
      db.close();
    }
  }
  async function putModel(files, languages) {
    const bytes = files.model.byteLength + files.shortlist.byteLength + files.vocabs.reduce((total, vocab) => total + vocab.byteLength, 0);
    const meta = {
      pair: files.pair,
      from: languages.from,
      to: languages.to,
      bytes,
      addedAt: Date.now(),
      ...languages.sourceUrl === void 0 ? {} : { sourceUrl: languages.sourceUrl }
    };
    await withStores2([META2, FILES], "readwrite", async (transaction) => {
      await promisify2(transaction.objectStore(FILES).put(files));
      await promisify2(transaction.objectStore(META2).put(meta));
    });
    await publishInventory();
    return meta;
  }
  async function listModels() {
    const records = await withStores2(
      [META2],
      "readonly",
      (transaction) => promisify2(transaction.objectStore(META2).getAll())
    );
    return records.sort((a, b) => a.pair.localeCompare(b.pair));
  }
  async function deleteModel(pair) {
    await withStores2([META2, FILES], "readwrite", async (transaction) => {
      await promisify2(transaction.objectStore(FILES).delete(pair));
      await promisify2(transaction.objectStore(META2).delete(pair));
    });
    await publishInventory();
  }

  // src/lib/models/validate.js
  var WORKER_PATH = "background/engine.worker.js";
  var VERDICT_TIMEOUT_MS = 12e4;
  function testLoadModel(pair, files) {
    let worker;
    try {
      worker = new Worker(webext().runtime.getURL(WORKER_PATH));
    } catch (error) {
      return Promise.resolve({ ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
    return new Promise((resolve) => {
      const settle = (verdict) => {
        clearTimeout(timer);
        worker.terminate();
        resolve(verdict);
      };
      const timer = setTimeout(() => settle({ ok: false, detail: "the engine did not answer" }), VERDICT_TIMEOUT_MS);
      worker.addEventListener("message", (event) => {
        const { id, error } = (
          /** @type {{ id?: unknown, error?: { message?: string } }} */
          event.data ?? {}
        );
        if (id !== 1) return;
        if (error) settle({ ok: false, detail: String(error.message ?? "engine failed") });
        else settle({ ok: true });
      });
      worker.addEventListener("error", (event) => {
        settle({ ok: false, detail: String(event.message ?? "the engine crashed") });
      });
      worker.postMessage({
        id: 1,
        name: "load",
        args: [
          { from: pair.from, to: pair.to },
          { model: files.model, shortlist: files.shortlist, vocabs: files.vocabs, config: files.config ?? {} }
        ]
      });
    });
  }

  // src/lib/theme-icon.js
  var TOOLBAR_ICONS = Object.freeze({
    light: { 16: "assets/icons/icon-16.png", 32: "assets/icons/icon-32.png" },
    dark: { 16: "assets/icons/icon-light-16.png", 32: "assets/icons/icon-light-32.png" }
  });
  function toolbarIconFor(dark) {
    const getURL = webext().runtime.getURL;
    return Object.fromEntries(
      Object.entries(TOOLBAR_ICONS[dark ? "dark" : "light"]).map(([size, path]) => [
        size,
        getURL(path)
      ])
    );
  }
  function watchToolbarScheme() {
    const api = webext();
    const action = (
      /** @type {{ theme_icons?: unknown } | undefined} */
      api.runtime.getManifest()["action"]
    );
    if (action?.theme_icons !== void 0) return;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      void api.action.setIcon({ path: toolbarIconFor(media.matches) }).catch(() => {
      });
    };
    apply();
    media.addEventListener("change", apply);
  }

  // src/lib/tts.js
  function canSpeak() {
    return typeof globalThis.speechSynthesis !== "undefined";
  }
  function primaryLanguage(tag) {
    return tag.toLowerCase().split(/[-_]/, 1)[0] ?? "";
  }
  function voicesFor(voices, lang) {
    const wanted = primaryLanguage(lang);
    if (wanted === "") return [];
    return voices.filter((voice) => primaryLanguage(voice.lang) === wanted).sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
  }
  function chosenVoice(voices, voiceURI) {
    if (voiceURI === void 0 || voiceURI === "") return null;
    return voices.find((voice) => voice.voiceURI === voiceURI) ?? null;
  }
  var mine = null;
  var sharing = null;
  function speak(text, lang, voiceURI, rate = 1) {
    if (!canSpeak() || text.length === 0) return;
    sharing?.();
    stop();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = rate;
    const voice = chosenVoice(speechSynthesis.getVoices(), voiceURI);
    if (voice !== null) utterance.voice = voice;
    const done = () => {
      if (mine === utterance) mine = null;
    };
    utterance.addEventListener("end", done);
    utterance.addEventListener("error", done);
    mine = utterance;
    speechSynthesis.speak(utterance);
  }
  function stop() {
    if (mine === null) return;
    mine = null;
    speechSynthesis.cancel();
  }

  // src/options/models-view.js
  function byLabel(a, b) {
    return pairLabel(a.from, a.to).localeCompare(pairLabel(b.from, b.to));
  }
  function orderForDisplay(rows, reading) {
    const tier = (row) => {
      if (reading.sourceLang !== null && row.from === reading.sourceLang && row.to === reading.targetLang) {
        return 0;
      }
      return row.installed !== null ? 1 : 2;
    };
    return [...rows].sort((a, b) => tier(a) - tier(b) || byLabel(a, b));
  }
  function dictionaryRows(stored, catalog, reading) {
    const covered = new Set(stored.map((one) => `${one.langFrom}-${one.langTo}`));
    const installed = stored.map((one) => ({
      from: one.langFrom,
      to: one.langTo,
      installed: one,
      available: null
    }));
    const offered = catalog.filter((entry) => !covered.has(`${entry.from}-${entry.to}`)).map((entry) => ({ from: entry.from, to: entry.to, installed: null, available: entry }));
    return [...installed, ...orderForDisplay(offered, reading)];
  }
  function sortByLabel(rows) {
    return [...rows].sort(byLabel);
  }
  function searchableText(row) {
    return [row.from, row.to, row.pair ?? `${row.from}${row.to}`, `${row.from}-${row.to}`, pairLabel(row.from, row.to)].join(" ").toLowerCase();
  }
  function matchesFilter(searchable, query) {
    const words2 = query.toLowerCase().split(/\s+/).filter((word) => word.length > 0);
    return words2.every((word) => searchable.includes(word));
  }
  function filterActive(query) {
    return query.trim().length > 0;
  }
  function rowVisible({ installed, matches, expanded, query }) {
    if (filterActive(query)) return matches;
    return expanded || installed;
  }
  function showAllState({ total, installedCount, expanded, query }) {
    return { shown: !expanded && !filterActive(query) && total > installedCount, count: total };
  }
  function pairChoices(rows, reading) {
    const installed = rows.filter((row) => row.installed !== null).map((row) => ({ pair: row.pair, from: row.from, to: row.to }));
    if (installed.length === 0) return [];
    const chosen = reading.sourceLang !== null && reading.targetLang !== null ? {
      pair: `${reading.sourceLang}${reading.targetLang}`,
      from: reading.sourceLang,
      to: reading.targetLang
    } : null;
    const known = chosen === null || installed.some((row) => row.from === chosen.from && row.to === chosen.to);
    return sortByLabel(chosen !== null && !known ? [chosen, ...installed] : installed);
  }
  function firstStepsMove(wasDone, modelStored2, dictionaryStored2) {
    const done = modelStored2 && dictionaryStored2;
    return { done, open: done === wasDone ? null : !done };
  }

  // src/options/options.js
  var running = null;
  localizePage();
  watchToolbarScheme();
  followTheme();
  var config = withDefaults(void 0);
  var os = "";
  var liveList = null;
  var refreshing = false;
  var liveDictionaries = null;
  var refreshingDictionaries = false;
  var modelStored = null;
  var dictionaryStored = null;
  var dictionaryOrder = [];
  var setupDone = null;
  var modelsExpanded = false;
  var dictionariesExpanded = false;
  function renderFirstSteps() {
    const fold = document.getElementById("first-steps");
    if (!(fold instanceof HTMLDetailsElement)) return;
    if (modelStored === null || dictionaryStored === null) return;
    const move = firstStepsMove(setupDone, modelStored, dictionaryStored);
    setupDone = move.done;
    if (move.open !== null) fold.open = move.open;
    fold.hidden = false;
  }
  function availableModels() {
    return liveList?.models ?? registryModels();
  }
  function listDate() {
    return liveList?.fetchedAt ?? registrySource().checkedAt;
  }
  function availableDictionaries() {
    return liveDictionaries?.dictionaries ?? catalogDictionaries();
  }
  function dictionaryListDate() {
    return liveDictionaries?.fetchedAt ?? catalogSource().checkedAt;
  }
  async function refreshList() {
    if (refreshing) return;
    refreshing = true;
    refreshStatus(t("options_refreshing_list"), "busy");
    try {
      const result = await refreshLiveModels();
      if (!result.ok) {
        refreshStatus(t("options_refresh_failed", [aside(result.detail), listDate()]), "error");
        return;
      }
      liveList = result.value;
      fill("model-checked", listDate());
      refreshStatus("");
      if (running === null && !importing) await renderModels();
      else renderPair(modelRows(await listModels(), availableModels()));
    } finally {
      refreshing = false;
    }
  }
  async function refreshDictionaryList() {
    if (refreshingDictionaries) return;
    refreshingDictionaries = true;
    dictionaryRefreshStatus(t("options_refreshing_dict_list"), "busy");
    try {
      const result = await refreshLiveDictionaries();
      if (!result.ok) {
        dictionaryRefreshStatus(t("options_refresh_failed", [aside(result.detail), dictionaryListDate()]), "error");
        return;
      }
      liveDictionaries = result.value;
      fill("dictionary-checked", dictionaryListDate());
      dictionaryRefreshStatus("");
      if (running === null && !importing) await renderCatalog();
    } finally {
      refreshingDictionaries = false;
    }
  }
  function renderReaderOnly() {
    const toggle = document.getElementById("reader-only");
    if (toggle instanceof HTMLInputElement) toggle.checked = effectiveReaderOnly(config, os);
  }
  function renderQuietBubble() {
    const toggle = document.getElementById("quiet-bubble");
    if (toggle instanceof HTMLInputElement) toggle.checked = config.hideBubbleActions;
  }
  function renderKeepArticles() {
    const toggle = document.getElementById("keep-articles");
    if (toggle instanceof HTMLInputElement) toggle.checked = config.keepArticles;
  }
  function renderNoTranslation() {
    const toggle = document.getElementById("no-translation");
    if (toggle instanceof HTMLInputElement) toggle.checked = config.translationOff;
    document.body.classList.toggle("no-translation", config.translationOff);
  }
  function renderBubbleScale() {
    const value = document.getElementById("bubble-scale-value");
    if (value !== null) value.textContent = `${config.bubbleScale}%`;
  }
  async function stepBubbleScale(by) {
    const current = (await readConfig()).bubbleScale;
    config = await writeConfig({ bubbleScale: current + by });
    renderBubbleScale();
  }
  var VOICE_SAMPLE = "1, 2, 3";
  function renderVoice() {
    const select = document.getElementById("tts-voice");
    if (!(select instanceof HTMLSelectElement)) return;
    const source = config.sourceLang;
    const stored = source === null ? void 0 : config.ttsVoices[source];
    const voices = canSpeak() && source !== null ? voicesFor(speechSynthesis.getVoices(), source) : [];
    select.replaceChildren();
    const fallback = document.createElement("option");
    fallback.value = "";
    fallback.textContent = t("options_tts_default");
    select.append(fallback);
    for (const voice of voices) {
      const option = document.createElement("option");
      option.value = voice.voiceURI;
      option.textContent = `${voice.name} (${voice.lang})`;
      option.selected = voice.voiceURI === stored;
      select.append(option);
    }
    select.disabled = !canSpeak();
    const listen = document.getElementById("tts-listen");
    if (listen instanceof HTMLButtonElement) listen.disabled = !canSpeak();
  }
  function renderRate() {
    const value = document.getElementById("tts-rate-value");
    if (value !== null) value.textContent = `${(config.ttsRate / 100).toFixed(1)}\xD7`;
  }
  async function stepRate(by) {
    const current = (await readConfig()).ttsRate;
    config = await writeConfig({ ttsRate: current + by });
    renderRate();
  }
  function fill(id, value) {
    const element2 = document.getElementById(id);
    if (element2 !== null) element2.textContent = value;
  }
  function megabytes(bytes) {
    const amount = (bytes / 1048576).toLocaleString(void 0, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    });
    return `${amount} MB`;
  }
  function say(id, text, tone = "idle") {
    const element2 = document.getElementById(id);
    if (element2 === null) return;
    element2.textContent = text;
    element2.dataset["tone"] = tone;
  }
  function status(text, tone = "idle") {
    say("model-status", text, tone);
  }
  function refreshStatus(text, tone = "idle") {
    say("refresh-status", text, tone);
  }
  function fileStatus(text, tone = "idle") {
    say("file-status", text, tone);
  }
  function element(tag, className, text) {
    const created = document.createElement(tag);
    if (className.length > 0) created.className = className;
    if (text !== void 0) created.textContent = text;
    return created;
  }
  function deleteButton({ name, restAria, disabled, onConfirm }) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "model-delete";
    button.textContent = t("action_delete");
    button.disabled = disabled;
    button.dataset["name"] = name;
    button.dataset["restAria"] = restAria;
    button.setAttribute("aria-label", restAria);
    button.addEventListener("click", () => {
      if (button.hasAttribute("data-armed")) onConfirm(button);
      else armDelete(button);
    });
    return button;
  }
  function armedDelete() {
    const armed = document.querySelector("button.model-delete[data-armed]");
    return armed instanceof HTMLButtonElement ? armed : null;
  }
  function disarmDelete() {
    const armed = armedDelete();
    if (armed === null) return;
    armed.removeAttribute("data-armed");
    armed.textContent = t("action_delete");
    armed.setAttribute("aria-label", armed.dataset["restAria"] ?? "");
  }
  function armDelete(button) {
    disarmDelete();
    button.setAttribute("data-armed", "");
    button.textContent = t("options_delete_confirm");
    button.setAttribute("aria-label", t("options_delete_confirm_aria", button.dataset["name"] ?? ""));
  }
  function deleteButtonsIn(containerId) {
    const container = document.getElementById(containerId);
    if (container === null) return [];
    const buttons = [];
    for (const one of container.querySelectorAll("button.model-delete")) {
      if (one instanceof HTMLButtonElement) buttons.push(one);
    }
    return buttons;
  }
  function focusDeleteIn(containerId, filterId, at) {
    const deletes = deleteButtonsIn(containerId);
    const successor = deletes[Math.min(at, deletes.length - 1)];
    if (successor !== void 0) successor.focus();
    else document.getElementById(filterId)?.focus();
  }
  function renderRow(row) {
    const container = element("div", "model");
    const name = element("span", "model-name", pairLabel(row.from, row.to));
    if (row.from === config.sourceLang && row.to === config.targetLang) {
      name.append(element("span", "badge", t("options_badge_reading")));
    }
    const meta = element("span", "model-meta");
    const act = element("span", "model-act");
    container.append(name, meta, act);
    if (row.installed !== null) {
      meta.append(element("span", "", t("options_size_here", megabytes(row.installed.bytes))));
      const fresher = row.available;
      if (fresher !== null && updateAvailable(row.installed, fresher)) {
        const update = document.createElement("button");
        update.type = "button";
        update.textContent = t("action_update");
        update.disabled = running !== null;
        update.addEventListener("click", () => void download(row, fresher));
        act.append(update);
      } else if (fresher !== null && row.installed.sourceUrl === void 0) {
        meta.append(element("span", "", t("options_version_unknown")));
      }
      act.append(
        deleteButton({
          name: pairLabel(row.from, row.to),
          restAria: t("options_delete_model_aria", pairLabel(row.from, row.to)),
          disabled: running !== null,
          onConfirm: (button) => void removeModel(row, button)
        })
      );
      return container;
    }
    const available = row.available;
    if (available === null) return container;
    const size = available.downloadBytes > 0 ? available.downloadBytes : available.bytes;
    if (size > 0) meta.append(element("span", "", megabytes(size)));
    const start = document.createElement("button");
    start.type = "button";
    start.textContent = t("action_download");
    start.disabled = running !== null;
    start.addEventListener("click", () => void download(row, available));
    act.append(start);
    return container;
  }
  function renderDownloading(container, model, controller) {
    container.replaceChildren();
    container.append(element("span", "model-name", pairLabel(model.from, model.to)));
    const known = model.downloadBytes > 0;
    const bar = document.createElement("progress");
    bar.className = "model-progress";
    if (known) {
      bar.max = model.downloadBytes;
      bar.value = 0;
    }
    const size = element(
      "span",
      "",
      known ? t("options_progress_of", [megabytes(0), megabytes(model.downloadBytes)]) : megabytes(0)
    );
    const meta = element("span", "model-meta");
    meta.append(bar, size);
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = t("action_cancel");
    cancel.addEventListener("click", () => {
      cancel.disabled = true;
      controller.abort();
    });
    const act = element("span", "model-act");
    act.append(cancel);
    container.append(meta, act);
    let shown = "";
    return ({ received, total }) => {
      if (known) {
        bar.max = total;
        bar.value = received;
      }
      const text = known ? t("options_progress_of", [megabytes(received), megabytes(total)]) : megabytes(received);
      if (text !== shown) {
        shown = text;
        size.textContent = text;
      }
    };
  }
  async function removeModel(row, button) {
    if (running !== null) return;
    const at = deleteButtonsIn("models").indexOf(button);
    await deleteModel(row.pair);
    status(t("options_deleted_model", pairLabel(row.from, row.to)));
    await renderModels();
    focusDeleteIn("models", "model-filter", at);
  }
  async function adoptFirstPair(from, to) {
    const stored = await listModels();
    if (stored.length !== 1) return;
    if (config.sourceLang === from && config.targetLang === to) return;
    config = await writeConfig({ sourceLang: from, targetLang: to });
  }
  async function download(row, model) {
    if (running !== null || importing) return;
    const controller = new AbortController();
    running = { pair: row.pair, controller };
    const letGo = holdScreen();
    await renderModels();
    const container = document.getElementById(`model-${row.pair}`);
    const onProgress = container === null ? void 0 : renderDownloading(container, model, controller);
    status(t("options_downloading_model", [pairLabel(model.from, model.to), megabytes(model.downloadBytes)]), "busy");
    const result = await downloadModel(model, { signal: controller.signal, onProgress });
    if (!result.ok) {
      running = null;
      letGo();
      status(describeDownloadProblem(result.problem, result.detail), result.problem === "cancelled" ? "idle" : "error");
      await renderModels();
      return;
    }
    status(t("options_checking_model", pairLabel(model.from, model.to)), "busy");
    const verdict = await testLoadModel({ from: model.from, to: model.to }, result.value);
    running = null;
    letGo();
    if (!verdict.ok) {
      status(t("options_model_rejected", aside(verdict.detail)), "error");
      await renderModels();
      return;
    }
    try {
      const source = modelSourceUrl(model);
      const meta = await putModel(result.value, {
        from: model.from,
        to: model.to,
        ...source === null ? {} : { sourceUrl: source }
      });
      status(t("options_downloaded_model", [pairLabel(model.from, model.to), megabytes(meta.bytes)]));
      await adoptFirstPair(model.from, model.to);
    } catch (error) {
      status(t("options_store_failed", message(error)), "error");
    }
    await renderModels();
  }
  function renderPair(rows) {
    const select = document.getElementById("pair");
    if (!(select instanceof HTMLSelectElement)) return;
    const choices = pairChoices(rows, config);
    select.replaceChildren();
    select.disabled = choices.length === 0;
    if (choices.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = t("options_pair_none");
      option.selected = true;
      select.append(option);
      return;
    }
    for (const row of choices) {
      const option = document.createElement("option");
      option.value = row.pair;
      option.textContent = pairLabel(row.from, row.to);
      option.selected = row.from === config.sourceLang && row.to === config.targetLang;
      select.append(option);
    }
  }
  async function choosePair(pair) {
    const rows = modelRows(await listModels(), availableModels());
    const row = rows.find((candidate) => candidate.pair === pair);
    if (row === void 0) return;
    config = await writeConfig({ sourceLang: row.from, targetLang: row.to });
    await renderModels();
    await renderCatalog();
    status(
      row.installed === null ? t("options_reading_pair_missing", [languageName(row.from), languageName(row.to)]) : t("options_reading_pair", [languageName(row.from), languageName(row.to)])
    );
  }
  function applyFilterIn(containerId, inputId, noneId, showAllId, expanded) {
    const container = document.getElementById(containerId);
    if (container === null) return;
    const input = document.getElementById(inputId);
    const query = input instanceof HTMLInputElement ? input.value : "";
    let visible = 0;
    let total = 0;
    let installedCount = 0;
    for (const row of container.querySelectorAll(".model")) {
      if (!(row instanceof HTMLElement)) continue;
      total += 1;
      const installed = row.dataset["installed"] === "true";
      if (installed) installedCount += 1;
      const matches = matchesFilter(row.dataset["search"] ?? "", query);
      const shown = rowVisible({ installed, matches, expanded, query });
      row.hidden = !shown;
      if (shown) visible += 1;
    }
    const none = document.getElementById(noneId);
    if (none !== null) none.hidden = !filterActive(query) || visible > 0;
    const showAll = document.getElementById(showAllId);
    if (showAll instanceof HTMLButtonElement) {
      const state = showAllState({ total, installedCount, expanded, query });
      showAll.hidden = !state.shown;
      showAll.textContent = t("options_show_all", state.count.toLocaleString());
    }
  }
  function applyModelFilter() {
    applyFilterIn("models", "model-filter", "model-none", "models-show-all", modelsExpanded);
  }
  function applyCatalogFilter() {
    applyFilterIn("dictionary-catalog", "dictionary-filter", "dictionary-none", "dictionaries-show-all", dictionariesExpanded);
  }
  function expandList(containerId) {
    if (containerId === "models") {
      modelsExpanded = true;
      applyModelFilter();
    } else {
      dictionariesExpanded = true;
      applyCatalogFilter();
    }
    const first = document.querySelector(`#${containerId} .model[data-installed="false"] button`);
    if (first instanceof HTMLElement) first.focus();
  }
  async function renderModels() {
    const container = document.getElementById("models");
    if (container === null) return;
    const stored = await listModels();
    const rows = orderForDisplay(modelRows(stored, availableModels()), config);
    renderPair(rows);
    modelStored = stored.length > 0;
    renderFirstSteps();
    container.replaceChildren();
    if (rows.length === 0) {
      container.append(element("p", "empty", t("options_no_models")));
    } else {
      for (const row of rows) {
        const rendered = renderRow(row);
        rendered.id = `model-${row.pair}`;
        rendered.dataset["search"] = searchableText(row);
        rendered.dataset["installed"] = String(row.installed !== null);
        container.append(rendered);
      }
      const none = element("p", "empty", t("options_filter_no_match_models"));
      none.id = "model-none";
      none.hidden = true;
      container.append(none);
    }
    applyModelFilter();
  }
  function renderDisabledHosts() {
    const container = document.getElementById("disabled-hosts");
    if (container === null) return;
    container.replaceChildren();
    if (config.disabledHosts.length === 0) {
      container.append(element("p", "empty", t("options_no_disabled")));
      return;
    }
    for (const host of config.disabledHosts) {
      const row = element("div", "model");
      row.append(element("span", "model-name", host));
      const restore = document.createElement("button");
      restore.type = "button";
      restore.textContent = t("options_turn_back_on");
      restore.addEventListener("click", () => void restoreHost(host));
      const act = element("span", "model-act");
      act.append(restore);
      row.append(act);
      container.append(row);
    }
  }
  async function restoreHost(host) {
    const current = await readConfig();
    config = await writeConfig({ disabledHosts: current.disabledHosts.filter((one) => one !== host) });
    renderDisabledHosts();
  }
  function message(error) {
    return error instanceof Error ? error.message : String(error);
  }
  async function gunzipIfNeeded(buffer) {
    if (!isGzip(buffer)) return buffer;
    const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
    return await new Response(stream).arrayBuffer();
  }
  async function addSelectedModel() {
    const input = (
      /** @type {HTMLInputElement | null} */
      document.getElementById("model-files")
    );
    const chosen = [...input?.files ?? []];
    const classified = classifyModelFiles(chosen.map((file) => file.name));
    if (!classified.ok) {
      fileStatus(describeClassifyProblem(classified.problem, classified.detail), "error");
      return;
    }
    const { pair, from, to, byRole } = classified.value;
    fileStatus(t("options_reading_model_files", pairLabel(from, to)), "busy");
    try {
      const read = async (name) => {
        const file = chosen.find((candidate) => candidate.name === name);
        if (file === void 0) throw new Error(t("options_file_disappeared", name));
        return gunzipIfNeeded(await file.arrayBuffer());
      };
      const [model, shortlist] = await Promise.all([read(byRole.model[0] ?? ""), read(byRole.shortlist[0] ?? "")]);
      const vocabs = await Promise.all(byRole.vocab.map(read));
      fileStatus(t("options_checking_model", pairLabel(from, to)), "busy");
      const verdict = await testLoadModel({ from, to }, { pair, model, shortlist, vocabs });
      if (!verdict.ok) {
        fileStatus(t("options_model_rejected", aside(verdict.detail)), "error");
        return;
      }
      const meta = await putModel({ pair, model, shortlist, vocabs }, { from, to });
      if (input !== null) input.value = "";
      fileStatus(t("options_added_model", [pairLabel(from, to), megabytes(meta.bytes)]));
      await adoptFirstPair(from, to);
      await renderModels();
    } catch (error) {
      fileStatus(t("options_add_model_failed", message(error)), "error");
    }
  }
  var importing = false;
  var deletingId = null;
  var wake = {
    /** whether some work wants the screen on right now */
    held: false,
    /** a request in flight, so two visibility changes do not take two locks */
    requesting: false,
    /** @type {WakeLockSentinel | null} */
    lock: null
  };
  async function keepScreenOn() {
    if (!wake.held || wake.requesting || wake.lock !== null) return;
    if (document.visibilityState !== "visible" || !("wakeLock" in navigator)) return;
    wake.requesting = true;
    try {
      const lock = await navigator.wakeLock.request("screen");
      if (!wake.held) {
        await lock.release();
        return;
      }
      wake.lock = lock;
      lock.addEventListener("release", () => {
        if (wake.lock === lock) wake.lock = null;
      });
    } catch {
    } finally {
      wake.requesting = false;
    }
  }
  function holdScreen() {
    wake.held = true;
    document.addEventListener("visibilitychange", keepScreenOn);
    void keepScreenOn();
    return () => {
      wake.held = false;
      document.removeEventListener("visibilitychange", keepScreenOn);
      void wake.lock?.release();
      wake.lock = null;
    };
  }
  function dictionaryStatus(text, tone = "idle") {
    say("dictionary-status", text, tone);
  }
  function dictionaryFileStatus(text, tone = "idle") {
    say("dictionary-file-status", text, tone);
  }
  function dictionaryRefreshStatus(text, tone = "idle") {
    say("dictionary-refresh-status", text, tone);
  }
  function words(count) {
    return plural(count, "words");
  }
  function knownLanguages() {
    const languages = /* @__PURE__ */ new Set();
    if (config.sourceLang !== null) languages.add(config.sourceLang);
    if (config.targetLang !== null) languages.add(config.targetLang);
    for (const model of availableModels()) {
      languages.add(model.from);
      languages.add(model.to);
    }
    return [...languages].sort((a, b) => languageName(a).localeCompare(languageName(b)));
  }
  function renderLanguageChoices(id, selected) {
    const select = document.getElementById(id);
    if (!(select instanceof HTMLSelectElement)) return;
    if (select.options.length > 0) return;
    for (const language of knownLanguages()) {
      const option = document.createElement("option");
      option.value = language;
      option.textContent = languageName(language);
      option.selected = language === selected;
      select.append(option);
    }
  }
  function chosenLanguage(id, fallback) {
    const select = document.getElementById(id);
    const chosen = select instanceof HTMLSelectElement ? select.value : "";
    return chosen.length > 0 ? chosen : fallback;
  }
  function moveButton(dictionary, step, enabled) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "model-move";
    button.textContent = step < 0 ? "\u2191" : "\u2193";
    button.disabled = !enabled || importing;
    button.dataset["move"] = dictionary.id;
    button.dataset["step"] = String(step);
    const label = step < 0 ? t("options_move_dictionary_up_aria", dictionary.name) : t("options_move_dictionary_down_aria", dictionary.name);
    button.setAttribute("aria-label", label);
    button.title = label;
    button.addEventListener("click", () => void moveDictionary(dictionary, step));
    return button;
  }
  function renderDictionary(dictionary, place) {
    const container = element("div", "model");
    const name = element("span", "model-name", pairLabel(dictionary.langFrom, dictionary.langTo));
    if (dictionary.langFrom === config.sourceLang && dictionary.langTo === config.targetLang) {
      name.append(element("span", "badge", t("options_badge_reading")));
    }
    name.append(element("span", "dictionary-title", dictionary.name));
    container.append(name);
    if (dictionary.id === deletingId) {
      const meta2 = element("span", "model-meta");
      meta2.append(element("span", "", t("options_deleting_row")));
      container.append(meta2);
      return container;
    }
    if (!dictionary.ready) {
      renderUnfinished(container, dictionary);
      return container;
    }
    const counted = dictionary.aliasCount > 0 ? `${words(dictionary.entryCount)}, ${plural(dictionary.aliasCount, "spellings")}` : words(dictionary.entryCount);
    const meta = element("span", "model-meta");
    meta.append(element("span", "", counted));
    meta.append(element("span", "", megabytes(dictionary.bytes)));
    container.append(meta);
    const act = element("span", "model-act");
    if (place.total > 1) {
      act.append(moveButton(dictionary, -1, place.at > 0));
      act.append(moveButton(dictionary, 1, place.at < place.total - 1));
    }
    act.append(
      deleteButton({
        name: dictionary.name,
        restAria: t("options_delete_dictionary_aria", dictionary.name),
        disabled: importing,
        onConfirm: (button) => void removeDictionary(dictionary, button)
      })
    );
    container.append(act);
    if (dictionary.credit !== null) {
      const about2 = element("details", "model-about");
      about2.append(element("summary", "", t("options_about_dictionary")));
      about2.append(element("p", "dictionary-credit", dictionary.credit));
      container.append(about2);
    }
    return container;
  }
  function renderUnfinished(container, dictionary) {
    const progress = dictionary.progress;
    const standing = importElsewhere ? t("options_import_elsewhere") : progress === void 0 ? t("options_import_interrupted_early") : t("options_import_interrupted", [progress.done.toLocaleString(), progress.total.toLocaleString()]);
    const meta = element("span", "model-meta");
    meta.append(element("span", "", standing));
    container.append(meta);
    const act = element("span", "model-act");
    const go = document.createElement("button");
    go.type = "button";
    go.textContent = t("options_continue_import");
    go.setAttribute("aria-label", t("options_continue_import_aria", dictionary.name));
    go.disabled = importing || importElsewhere;
    go.addEventListener("click", () => void resumeImport(dictionary));
    act.append(go);
    act.append(
      deleteButton({
        name: dictionary.name,
        restAria: t("options_delete_dictionary_aria", dictionary.name),
        disabled: importing || importElsewhere,
        onConfirm: (button) => void removeDictionary(dictionary, button)
      })
    );
    container.append(act);
  }
  function moveButtonFor(id, step) {
    for (const button of document.querySelectorAll("#dictionary-catalog button.model-move")) {
      if (!(button instanceof HTMLButtonElement)) continue;
      if (button.dataset["move"] === id && button.dataset["step"] === String(step)) return button;
    }
    return null;
  }
  function focusMove(id, step) {
    const again = moveButtonFor(id, step);
    if (again !== null && !again.disabled) {
      again.focus();
      return;
    }
    const back = moveButtonFor(id, -step);
    if (back !== null && !back.disabled) back.focus();
  }
  async function moveDictionary(dictionary, step) {
    if (importing) return;
    const order = afterMove(dictionaryOrder, dictionary.id, step);
    if (order === null) return;
    try {
      await reorderDictionaries(order);
    } catch (error) {
      dictionaryStatus(t("options_reorder_failed", message(error)), "error");
      return;
    }
    await renderCatalog();
    const at = dictionaryOrder.indexOf(dictionary.id);
    if (at >= 0) {
      dictionaryStatus(
        t("options_dictionary_moved", [
          dictionary.name,
          (at + 1).toLocaleString(),
          dictionaryOrder.length.toLocaleString()
        ])
      );
    }
    focusMove(dictionary.id, step);
  }
  async function removeDictionary(dictionary, button) {
    if (importing) return;
    const at = deleteButtonsIn("dictionary-catalog").indexOf(button);
    importing = true;
    deletingId = dictionary.id;
    const letGo = holdScreen();
    dictionaryStatus(t("options_deleting_dictionary", dictionary.name), "busy");
    await renderCatalog();
    try {
      await deleteDictionary(dictionary.id);
      dictionaryStatus(t("options_deleted_dictionary", dictionary.name));
    } catch (error) {
      dictionaryStatus(t("options_delete_dictionary_failed", [dictionary.name, message(error)]), "error");
    } finally {
      letGo();
      deletingId = null;
      importing = false;
    }
    await renderCatalog();
    focusDeleteIn("dictionary-catalog", "dictionary-filter", at);
  }
  function catalogRowId(entry) {
    return `dictionary-${entry.from}-${entry.to}`;
  }
  function renderCatalogRow(entry) {
    const container = element("div", "model");
    container.append(element("span", "model-name", pairLabel(entry.from, entry.to)));
    const get = document.createElement("button");
    get.type = "button";
    get.textContent = t("action_download");
    get.disabled = running !== null || importing;
    get.addEventListener("click", () => void downloadDictionary(entry));
    const act = element("span", "model-act");
    act.append(get);
    container.append(act);
    return container;
  }
  async function renderCatalog() {
    const container = document.getElementById("dictionary-catalog");
    if (container === null) return;
    const stored = await listDictionaries();
    const rows = dictionaryRows(stored, availableDictionaries(), config);
    importElsewhere = !importing && await importHeld();
    dictionaryOrder = stored.map((one) => one.id);
    const hint = document.getElementById("dictionary-order-hint");
    if (hint !== null) hint.hidden = stored.length < 2;
    dictionaryStored = stored.some((one) => one.ready);
    renderFirstSteps();
    container.replaceChildren();
    if (rows.length === 0) {
      container.append(element("p", "empty", t("options_no_catalog")));
    } else {
      let at = 0;
      for (const row of rows) {
        let rendered;
        if (row.installed !== null) {
          rendered = renderDictionary(row.installed, { at, total: stored.length });
          at += 1;
          rendered.dataset["search"] = `${searchableText(row)} ${row.installed.name.toLowerCase()}`;
        } else if (row.available !== null) {
          rendered = renderCatalogRow(row.available);
          rendered.id = catalogRowId(row.available);
          rendered.dataset["search"] = searchableText(row);
        } else {
          continue;
        }
        rendered.dataset["installed"] = String(row.installed !== null);
        container.append(rendered);
      }
      const none = element("p", "empty", t("options_filter_no_match_dictionaries"));
      none.id = "dictionary-none";
      none.hidden = true;
      container.append(none);
    }
    applyCatalogFilter();
  }
  function renderFetching(container, entry, controller) {
    container.replaceChildren();
    container.append(element("span", "model-name", pairLabel(entry.from, entry.to)));
    const bar = document.createElement("progress");
    bar.className = "model-progress";
    const size = element("span", "", "");
    const meta = element("span", "model-meta");
    meta.append(bar, size);
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = t("action_cancel");
    cancel.addEventListener("click", () => {
      cancel.disabled = true;
      controller.abort();
    });
    const act = element("span", "model-act");
    act.append(cancel);
    container.append(meta, act);
    let shown = "";
    return ({ received, total }) => {
      if (total > 0) {
        bar.max = total;
        bar.value = received;
      }
      const text = total > 0 ? t("options_progress_of", [megabytes(received), megabytes(total)]) : megabytes(received);
      if (text !== shown) {
        shown = text;
        size.textContent = text;
      }
    };
  }
  async function downloadDictionary(entry) {
    if (running !== null || importing) return;
    importing = true;
    const letGo = holdScreen();
    const controller = new AbortController();
    await renderCatalog();
    const container = document.getElementById(catalogRowId(entry));
    const onProgress = container === null ? void 0 : renderFetching(container, entry, controller);
    const label = pairLabel(entry.from, entry.to);
    dictionaryStatus(t("options_downloading_dictionary", label), "busy");
    try {
      const fetched = await fetchDictionaryFiles(entry.url, controller.signal, onProgress);
      if (!fetched.ok) {
        dictionaryStatus(fetched.text, fetched.tone);
        return;
      }
      const ran = await withImportLock(async () => {
        await storeDictionary(fetched.value.files, {
          base: fetched.value.base,
          langFrom: entry.from,
          langTo: entry.to,
          say: dictionaryStatus
        });
      });
      if (!ran) dictionaryStatus(t("options_import_elsewhere"), "error");
    } finally {
      letGo();
      importing = false;
      await renderCatalog();
    }
  }
  async function fetchDictionaryFiles(url, signal, onProgress) {
    const result = await downloadArchive(url, { signal, onProgress });
    if (!result.ok) {
      return {
        ok: false,
        text: describeDictDownloadProblem(result.problem, result.detail),
        tone: result.problem === "cancelled" ? "idle" : "error"
      };
    }
    const zip = await readZip(result.value);
    if (!zip.ok) return { ok: false, text: describeZipProblem(zip.problem, zip.detail), tone: "error" };
    const sorted = dictionaryFromZip(zip.value);
    if (!sorted.ok) {
      return { ok: false, text: describeImportProblem(sorted.problem, sorted.detail), tone: "error" };
    }
    return sorted;
  }
  function breathe() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  var IMPORT_LOCK = "reread-dictionary-import";
  async function withImportLock(work) {
    if (!("locks" in navigator)) {
      await work();
      return true;
    }
    return await navigator.locks.request(IMPORT_LOCK, { ifAvailable: true }, async (lock) => {
      if (lock === null) return false;
      await work();
      return true;
    });
  }
  async function importHeld() {
    if (!("locks" in navigator)) return false;
    const { held = [] } = await navigator.locks.query();
    return held.some((lock) => lock.name === IMPORT_LOCK);
  }
  var importElsewhere = false;
  function blobOf(source) {
    if (source instanceof Blob) return source;
    return new Blob([
      /** @type {Uint8Array<ArrayBuffer> | ArrayBuffer} */
      source
    ]);
  }
  async function storeDictionary(files, { base, langFrom, langTo, say: say2 }) {
    let dictionary = null;
    try {
      say2(t("options_reading_file", base), "busy");
      dictionary = await beginImport({ name: base, langFrom, langTo, credit: null });
      await stageSources(dictionary.id, {
        ifo: blobOf(files.ifo),
        idx: blobOf(files.idx),
        dict: blobOf(files.dict),
        ...files.syn === void 0 ? {} : { syn: blobOf(files.syn) }
      });
      const opened = await openDictionary(files, { fallbackName: base });
      if (!opened.ok) {
        await deleteDictionary(dictionary.id);
        say2(describeImportProblem(opened.problem, opened.detail), "error");
        return false;
      }
      return await runImport(opened.value, dictionary, { say: say2, progress: null });
    } catch (error) {
      if (dictionary !== null) await deleteDictionary(dictionary.id).catch(() => void 0);
      say2(t("options_add_dictionary_failed", message(error)), "error");
      return false;
    }
  }
  async function resumeImport(dictionary) {
    if (importing || running !== null) return;
    importing = true;
    const letGo = holdScreen();
    await renderCatalog();
    try {
      const ran = await withImportLock(async () => {
        const sources = await readSources(dictionary.id);
        if (sources === null) {
          await deleteDictionary(dictionary.id);
          dictionaryStatus(t("options_swept_unfinished", dictionary.name));
          return;
        }
        dictionaryStatus(t("options_reading_file", dictionary.name), "busy");
        const opened = await openDictionary(
          { ifo: sources.ifo, idx: sources.idx, dict: sources.dict, ...sources.syn === void 0 ? {} : { syn: sources.syn } },
          { fallbackName: dictionary.name }
        );
        if (!opened.ok) {
          await deleteDictionary(dictionary.id);
          dictionaryStatus(describeImportProblem(opened.problem, opened.detail), "error");
          return;
        }
        const current = (await listDictionaries()).find((one) => one.id === dictionary.id) ?? dictionary;
        await runImport(opened.value, current, { say: dictionaryStatus, progress: current.progress ?? null });
      });
      if (!ran) dictionaryStatus(t("options_import_elsewhere"), "error");
    } catch (error) {
      await deleteDictionary(dictionary.id).catch(() => void 0);
      dictionaryStatus(t("options_add_dictionary_failed", message(error)), "error");
    } finally {
      letGo();
      importing = false;
      await renderCatalog();
    }
  }
  async function runImport(opened, dictionary, { say: say2, progress }) {
    const { name, credit } = opened;
    const total = opened.words + opened.synonyms;
    const batches = rowBatches(
      dictionary.id,
      {
        entries: entriesOf(opened, { readFrom: entriesReadFrom(progress) }),
        aliases: aliasesOf(opened)
      },
      { resume: progress }
    );
    const writer = await openWriter(dictionary.id);
    let appended = progress?.appended ?? 0;
    let summary;
    try {
      let step = batches.next();
      while (!step.done) {
        const batch = step.value;
        const writing = writer.put(batch.rows, batch.additions, {
          name,
          credit,
          progress: { ...batch.progress, total, appended }
        });
        say2(t("options_storing_dictionary", [name, batch.done.toLocaleString(), total.toLocaleString()]), "busy");
        step = batches.next();
        appended += await writing;
        if (document.visibilityState === "visible") await breathe();
      }
      summary = step.value;
    } finally {
      writer.close();
    }
    if (summary.entryCount === 0) {
      await deleteDictionary(dictionary.id);
      say2(describeImportProblem("no_entries", summary.skipped === 0 ? void 0 : `${summary.skipped}`), "error");
      return false;
    }
    const ready = await finishImport(dictionary.id, {
      entryCount: summary.entryCount,
      aliasCount: summary.aliasCount,
      bytes: summary.bytes + appended
    });
    const unreadable = summary.skipped === 0 ? "" : ` ${plural(summary.skipped, "options_skipped_entries")}`;
    say2(t("options_added_dictionary", [ready.name, words(ready.entryCount), megabytes(ready.bytes)]) + unreadable);
    return true;
  }
  async function addSelectedDictionary() {
    if (importing || running !== null) return;
    const input = (
      /** @type {HTMLInputElement | null} */
      document.getElementById("dictionary-files")
    );
    const chosen = [...input?.files ?? []];
    const classified = classifyDictionaryFiles(chosen.map((file) => file.name));
    if (!classified.ok) {
      dictionaryFileStatus(describeImportProblem(classified.problem, classified.detail), "error");
      return;
    }
    const langFrom = chosenLanguage("dictionary-from", config.sourceLang ?? "");
    const langTo = chosenLanguage("dictionary-to", config.targetLang ?? "");
    const { base, ifo, idx, dict, syn } = classified.value;
    importing = true;
    const letGo = holdScreen();
    await renderCatalog();
    try {
      const file = (name) => {
        const found = chosen.find((candidate) => candidate.name === name);
        if (found === void 0) throw new Error(t("options_file_disappeared", name));
        return found;
      };
      const files = {
        ifo: file(ifo),
        idx: file(idx),
        dict: file(dict),
        ...syn === void 0 ? {} : { syn: file(syn) }
      };
      let stored = false;
      const ran = await withImportLock(async () => {
        stored = await storeDictionary(files, { base, langFrom, langTo, say: dictionaryFileStatus });
      });
      if (!ran) dictionaryFileStatus(t("options_import_elsewhere"), "error");
      if (stored && input !== null) input.value = "";
    } catch (error) {
      dictionaryFileStatus(t("options_add_dictionary_failed", message(error)), "error");
    } finally {
      letGo();
      importing = false;
      await renderCatalog();
    }
  }
  async function render() {
    config = await readConfig();
    os = await platformOs();
    liveList = await readLiveModels();
    liveDictionaries = await readLiveDictionaries();
    const pin = document.getElementById("first-steps-pin");
    if (pin !== null && os === "android") {
      pin.setAttribute("data-i18n", "options_first_steps_pin_android");
      pin.textContent = t("options_first_steps_pin_android");
    }
    fill("version", webext().runtime.getManifest().version);
    renderReaderOnly();
    renderQuietBubble();
    renderKeepArticles();
    renderNoTranslation();
    renderBubbleScale();
    renderVoice();
    renderRate();
    renderLanguageChoices("dictionary-from", config.sourceLang ?? "");
    renderLanguageChoices("dictionary-to", config.targetLang ?? "");
    const { source } = registrySource();
    const host = source === "" ? "" : new URL(source).host;
    fill("model-host", host);
    const modelSource = document.getElementById("model-host");
    if (modelSource instanceof HTMLAnchorElement && source !== "") modelSource.href = source;
    fill("model-checked", listDate());
    const dictionaries = catalogSource();
    fill("dictionary-host", dictionaries.source === "" ? "" : new URL(dictionaries.source).host);
    const dictionarySource = document.getElementById("dictionary-host");
    if (dictionarySource instanceof HTMLAnchorElement && dictionaries.source !== "") {
      dictionarySource.href = dictionaries.source;
    }
    fill("dictionary-checked", dictionaryListDate());
    await renderModels();
    renderDisabledHosts();
    const swept = await removeUnfinished().catch(() => []);
    if (swept.length > 0) {
      dictionaryStatus(
        t("options_swept_unfinished", swept.map((one) => one.name).join(", "))
      );
    }
    await renderCatalog();
  }
  async function refresh() {
    config = await readConfig();
    renderReaderOnly();
    renderQuietBubble();
    renderKeepArticles();
    renderNoTranslation();
    renderBubbleScale();
    renderVoice();
    renderRate();
    renderDisabledHosts();
    if (running === null && !importing) {
      await renderModels();
      await renderCatalog();
    } else {
      renderPair(modelRows(await listModels(), availableModels()));
    }
  }
  webext().storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || changes[CONFIG_KEY] === void 0) return;
    void refresh();
  });
  if (canSpeak()) speechSynthesis.addEventListener("voiceschanged", renderVoice);
  document.getElementById("reader-only")?.addEventListener("change", (event) => {
    const toggle = event.target;
    if (!(toggle instanceof HTMLInputElement)) return;
    void writeConfig({ readerOnly: toggle.checked }).then((written) => {
      config = written;
    });
  });
  document.getElementById("quiet-bubble")?.addEventListener("change", (event) => {
    const toggle = event.target;
    if (!(toggle instanceof HTMLInputElement)) return;
    void writeConfig({ hideBubbleActions: toggle.checked }).then((written) => {
      config = written;
    });
  });
  document.getElementById("keep-articles")?.addEventListener("change", (event) => {
    const toggle = event.target;
    if (!(toggle instanceof HTMLInputElement)) return;
    void writeConfig({ keepArticles: toggle.checked }).then((written) => {
      config = written;
    });
  });
  document.getElementById("no-translation")?.addEventListener("change", (event) => {
    const toggle = event.target;
    if (!(toggle instanceof HTMLInputElement)) return;
    void writeConfig({ translationOff: toggle.checked }).then((written) => {
      config = written;
      renderNoTranslation();
    });
  });
  document.getElementById("bubble-scale-down")?.addEventListener("click", () => {
    void stepBubbleScale(-BUBBLE_SCALE.step);
  });
  document.getElementById("bubble-scale-up")?.addEventListener("click", () => {
    void stepBubbleScale(BUBBLE_SCALE.step);
  });
  document.getElementById("tts-voice")?.addEventListener("change", (event) => {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement)) return;
    const source = config.sourceLang;
    if (source === null) return;
    const map = { ...config.ttsVoices };
    if (select.value === "") delete map[source];
    else map[source] = select.value;
    void writeConfig({ ttsVoices: map }).then((written) => {
      config = written;
    });
  });
  document.getElementById("tts-listen")?.addEventListener("click", () => {
    const select = document.getElementById("tts-voice");
    const chosen = select instanceof HTMLSelectElement && select.value !== "" ? select.value : void 0;
    speak(VOICE_SAMPLE, config.sourceLang ?? "", chosen, config.ttsRate / 100);
  });
  document.getElementById("tts-rate-down")?.addEventListener("click", () => {
    void stepRate(-TTS_RATE.step);
  });
  document.getElementById("tts-rate-up")?.addEventListener("click", () => {
    void stepRate(TTS_RATE.step);
  });
  document.getElementById("add-model")?.addEventListener("click", () => void addSelectedModel());
  document.getElementById("refresh-models")?.addEventListener("click", () => void refreshList());
  document.getElementById("refresh-dictionaries")?.addEventListener("click", () => void refreshDictionaryList());
  document.getElementById("model-filter")?.addEventListener("input", () => applyModelFilter());
  document.getElementById("dictionary-filter")?.addEventListener("input", () => applyCatalogFilter());
  document.getElementById("models-show-all")?.addEventListener("click", () => expandList("models"));
  document.getElementById("dictionaries-show-all")?.addEventListener("click", () => expandList("dictionary-catalog"));
  document.getElementById("add-dictionary")?.addEventListener("click", () => void addSelectedDictionary());
  document.addEventListener("pointerdown", (event) => {
    const armed = armedDelete();
    if (armed === null) return;
    if (event.target instanceof Node && armed.contains(event.target)) return;
    disarmDelete();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") disarmDelete();
  });
  document.addEventListener("focusout", (event) => {
    const armed = armedDelete();
    if (armed !== null && event.target === armed && event.relatedTarget !== armed) disarmDelete();
  });
  document.getElementById("pair")?.addEventListener("change", (event) => {
    const select = event.target;
    if (select instanceof HTMLSelectElement) void choosePair(select.value);
  });
  var pageBar = document.querySelector(".page-bar");
  var menuButton = document.getElementById("menu");
  var menuPanel = document.getElementById("menu-panel");
  armBackArrow();
  function setMenu(open3) {
    if (menuButton === null || menuPanel === null) return;
    menuPanel.hidden = !open3;
    menuButton.setAttribute("aria-expanded", String(open3));
  }
  menuButton?.addEventListener("click", () => {
    setMenu(menuPanel?.hidden === true);
  });
  document.getElementById("nav-library")?.addEventListener("click", () => {
    setMenu(false);
    void webext().runtime.sendMessage({ kind: Message.OPEN_LIBRARY }).catch(() => {
    });
  });
  document.getElementById("nav-marks")?.addEventListener("click", () => {
    setMenu(false);
    void webext().runtime.sendMessage({ kind: Message.OPEN_MARKS }).catch(() => {
    });
  });
  document.getElementById("nav-vocabulary")?.addEventListener("click", () => {
    setMenu(false);
    void webext().runtime.sendMessage({ kind: Message.OPEN_VOCABULARY }).catch(() => {
    });
  });
  document.addEventListener("pointerdown", (event) => {
    if (menuPanel?.hidden !== false) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (pageBar?.contains(target) === true || menuPanel.contains(target)) return;
    setMenu(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || menuPanel?.hidden !== false) return;
    const focus = document.activeElement;
    if (focus instanceof Node && menuPanel.contains(focus)) menuButton?.focus();
    setMenu(false);
  });
  window.addEventListener("beforeunload", (event) => {
    if (running === null && !importing) return;
    event.preventDefault();
  });
  void render();
})();
//# sourceMappingURL=options.js.map
