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
  function chosenPair(config2) {
    if (config2.sourceLang === null || config2.targetLang === null) return null;
    return { from: config2.sourceLang, to: config2.targetLang };
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

  // src/lib/appearance.js
  function applyTheme(root, theme) {
    root.dataset["readerTheme"] = theme;
  }
  function applyReading(root, reader) {
    applyTheme(root, reader.theme);
    root.dataset["readerFont"] = reader.font;
    root.style.setProperty("--reader-size", `${reader.fontSize}px`);
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
  function fail(code) {
    return { ok: false, code };
  }
  function asResult(response) {
    if (typeof response !== "object" || response === null || !("ok" in response)) {
      return fail(ErrorCode.INTERNAL);
    }
    return (
      /** @type {Result<T>} */
      response
    );
  }

  // src/lib/messages.js
  function describeError(code) {
    switch (code) {
      case ErrorCode.ENGINE_MISSING:
        return t("error_engine_missing");
      case ErrorCode.MODEL_MISSING:
        return t("error_model_missing");
      case ErrorCode.UNSUPPORTED_PAIR:
        return t("error_unsupported_pair");
      case ErrorCode.TOO_LONG:
        return t("error_too_long");
      case ErrorCode.NO_PAGE:
        return t("error_no_page");
      case ErrorCode.UNKNOWN_MESSAGE:
        return t("error_unknown_message");
      case ErrorCode.INTERNAL:
        return t("error_internal");
      default:
        return t("error_internal");
    }
  }

  // src/lib/own-tabs.js
  async function tabsShowing(url, ask2) {
    try {
      const query2 = ask2 ?? (() => webext().runtime.getContexts?.({ contextTypes: ["TAB"] }));
      const views = await query2();
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
  var VOCAB_TAB_KEY = "vocabTabId";
  var BACK_ROAD_KEY = "reread.backRoad";
  async function writeTabId(key, tabId, session) {
    if (tabId === null) await session.remove(key);
    else await session.set({ [key]: tabId });
  }
  async function writeVocabTab(tabId, session = webext().storage.session) {
    await writeTabId(VOCAB_TAB_KEY, tabId, session);
  }

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
    const button2 = document.getElementById("back");
    if (button2 === null) return;
    if (walkedHere()) {
      button2.hidden = false;
      button2.addEventListener("click", () => history.back());
      return;
    }
    button2.addEventListener("click", () => void toReading());
    const reveal = () => void readerTab().then((tab) => {
      button2.hidden = tab === null;
    });
    reveal();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") reveal();
    });
  }

  // src/lib/store/mirror.js
  var MIRROR_KEY = "vocabIndex";

  // src/lib/normalize.js
  var LAYOUT_ARTEFACTS = new RegExp("[\\u00AD\\u200B]", "gu");
  function collapseWhitespace(text) {
    return text.normalize("NFC").replace(LAYOUT_ARTEFACTS, "").replace(/\s+/gu, " ").trim();
  }

  // src/lib/store/tsv.js
  var SEPARATOR = "	";
  var JOINER = "; ";
  function field(text) {
    return collapseWhitespace(text);
  }
  function toTsv(phrases2) {
    const lines = phrases2.map(
      (phrase) => field(phrase.phrase) + SEPARATOR + field(phrase.translations.join(JOINER))
    );
    return lines.length === 0 ? "" : lines.join("\n") + "\n";
  }
  function fromTsv(text) {
    const rows = [];
    let invalid = 0;
    for (const line of text.split("\n")) {
      const one = line.endsWith("\r") ? line.slice(0, -1) : line;
      if (one.trim().length === 0) continue;
      const cells = one.split(SEPARATOR);
      if (cells.length !== 2) {
        invalid += 1;
        continue;
      }
      const phrase = field(String(cells[0]));
      const meanings = String(cells[1]).split(JOINER).map(field).filter((meaning) => meaning.length > 0);
      if (phrase.length === 0 || meanings.length === 0) {
        invalid += 1;
        continue;
      }
      rows.push({ text: phrase, translations: meanings });
    }
    return { rows, invalid };
  }
  function safeCode(code) {
    return code.replace(/[^A-Za-z0-9_-]/g, "_");
  }
  function exportFilename({ langFrom, langTo }) {
    return `reread-${safeCode(langFrom)}-${safeCode(langTo)}.tsv`;
  }
  function pairFromFilename(name) {
    const code = "[a-z]{2,3}(?:_[a-z]{4})?";
    const match = new RegExp(`(?:^|-)(${code})-(${code}) ?(?:\\(\\d+\\))?\\.tsv$`).exec(
      name.toLowerCase()
    );
    if (match === null) return null;
    return { langFrom: String(match[1]), langTo: String(match[2]) };
  }

  // src/lib/store/vocab.js
  var DB_NAME = "reread-vocab";
  var DB_VERSION = 1;
  var PHRASES = "phrases";
  var BY_KEY = "by_key";
  var BY_PAIR = "by_pair";
  function promisify(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    });
  }
  function open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (db.objectStoreNames.contains(PHRASES)) return;
        const phrases2 = db.createObjectStore(PHRASES, { keyPath: "id" });
        phrases2.createIndex(BY_KEY, ["langFrom", "langTo", "normalized"], { unique: true });
        phrases2.createIndex(BY_PAIR, ["langFrom", "langTo"], { unique: false });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Cannot open the vocabulary database"));
      request.onblocked = () => reject(new Error("The vocabulary database is in use by another page"));
    });
  }
  async function withPhrases(mode, work) {
    const db = await open();
    try {
      const transaction = db.transaction([PHRASES], mode);
      const result = await work(transaction.objectStore(PHRASES));
      await new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve(void 0);
        transaction.onerror = () => reject(transaction.error ?? new Error("Vocabulary transaction failed"));
        transaction.onabort = () => reject(transaction.error ?? new Error("Vocabulary transaction aborted"));
      });
      return result;
    } finally {
      db.close();
    }
  }
  async function listPhrases(pair) {
    const records = (
      /** @type {Phrase[]} */
      await withPhrases(
        "readonly",
        (store) => promisify(store.index(BY_PAIR).getAll([pair.langFrom, pair.langTo]))
      )
    );
    return records.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }
  async function listPairs() {
    return await withPhrases("readonly", async (store) => {
      const index = store.index(BY_PAIR);
      const pairs = [];
      await new Promise((resolve, reject) => {
        const request = index.openKeyCursor(null, "nextunique");
        request.onerror = () => reject(request.error ?? new Error("Cannot list the saved language pairs"));
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor === null) {
            resolve(void 0);
            return;
          }
          const [langFrom, langTo] = (
            /** @type {[string, string]} */
            cursor.key
          );
          pairs.push({ langFrom, langTo });
          cursor.continue();
        };
      });
      const counts = await Promise.all(
        pairs.map((pair) => promisify(index.count([pair.langFrom, pair.langTo])))
      );
      return pairs.map((pair, at) => ({ ...pair, count: counts[at] ?? 0 }));
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
  function speaking() {
    return mine !== null;
  }
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
  function sortByLabel(rows) {
    return [...rows].sort(byLabel);
  }
  function matchesFilter(searchable, query2) {
    const words = query2.toLowerCase().split(/\s+/).filter((word) => word.length > 0);
    return words.every((word) => searchable.includes(word));
  }

  // src/vocab/list-view.js
  var PAGE_SIZE = 100;
  function newestFirst(phrases2) {
    return [...phrases2].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
  }
  function searchablePhrase(phrase) {
    return [phrase.phrase, ...phrase.translations].join(" ").toLowerCase();
  }
  function listView(phrases2, { query: query2, page: page2 }) {
    const matching = phrases2.filter((phrase) => matchesFilter(searchablePhrase(phrase), query2));
    const pages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
    const current = Math.min(Math.max(1, page2), pages);
    return {
      rows: matching.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE),
      page: current,
      pages,
      matching: matching.length
    };
  }
  function markSegments(text, query2) {
    const words = query2.toLowerCase().split(/\s+/).filter((word) => word.length > 0);
    const folded = text.toLowerCase();
    if (words.length === 0 || folded.length !== text.length) return [{ text, hit: false }];
    const hit = new Array(text.length).fill(false);
    for (const word of words) {
      for (let at = folded.indexOf(word); at !== -1; at = folded.indexOf(word, at + 1)) {
        hit.fill(true, at, at + word.length);
      }
    }
    const segments = [];
    let from = 0;
    for (let at = 1; at <= text.length; at += 1) {
      if (at === text.length || hit[at] !== hit[from]) {
        segments.push({ text: text.slice(from, at), hit: hit[from] === true });
        from = at;
      }
    }
    return segments;
  }
  function pairChoicesFor(config2, saved) {
    const rows = sortByLabel(
      saved.map(({ langFrom, langTo, count }) => ({
        pair: `${langFrom}${langTo}`,
        from: langFrom,
        to: langTo,
        count
      }))
    );
    if (config2.sourceLang === null || config2.targetLang === null) return rows;
    const known = rows.some((row) => row.from === config2.sourceLang && row.to === config2.targetLang);
    if (known) return rows;
    return [
      {
        pair: `${config2.sourceLang}${config2.targetLang}`,
        from: config2.sourceLang,
        to: config2.targetLang,
        count: 0
      },
      ...rows
    ];
  }

  // src/vocab/vocab.js
  localizePage();
  watchToolbarScheme();
  var versionSpan = document.getElementById("version");
  if (versionSpan !== null) versionSpan.textContent = webext().runtime.getManifest().version;
  var brandButton = document.getElementById("brand");
  var pageBar = document.querySelector(".page-bar");
  var displayButton = document.getElementById("display");
  var displayPanel = document.getElementById("display-panel");
  var sizeValue = document.getElementById("size-value");
  var voiceSetting = document.getElementById("voice-setting");
  var voiceChoice = (
    /** @type {HTMLSelectElement | null} */
    document.getElementById("voice-choice")
  );
  var rateSetting = document.getElementById("rate-setting");
  var rateValue = document.getElementById("rate-value");
  var menuButton = document.getElementById("menu");
  var menuPanel = document.getElementById("menu-panel");
  var navLibrary = document.getElementById("nav-library");
  var navMarks = document.getElementById("nav-marks");
  var navSettings = document.getElementById("nav-settings");
  var pairSelect = (
    /** @type {HTMLSelectElement | null} */
    document.getElementById("pair")
  );
  var introLine = document.getElementById("intro");
  var countLine = document.getElementById("count");
  var exportButton = (
    /** @type {HTMLButtonElement | null} */
    document.getElementById("export")
  );
  var importButton = (
    /** @type {HTMLButtonElement | null} */
    document.getElementById("import")
  );
  var importInput = (
    /** @type {HTMLInputElement | null} */
    document.getElementById("import-file")
  );
  var importConfirm = document.getElementById("import-confirm");
  var importSummary = document.getElementById("import-summary");
  var importSample = document.getElementById("import-sample");
  var importPairSelect = (
    /** @type {HTMLSelectElement | null} */
    document.getElementById("import-pair")
  );
  var importRun = (
    /** @type {HTMLButtonElement | null} */
    document.getElementById("import-run")
  );
  var importCancel = (
    /** @type {HTMLButtonElement | null} */
    document.getElementById("import-cancel")
  );
  var transferLine = document.getElementById("transfer-status");
  var filterInput = (
    /** @type {HTMLInputElement | null} */
    document.getElementById("filter")
  );
  var listContainer = document.getElementById("list");
  var statusLine = document.getElementById("status");
  var pager = document.getElementById("pager");
  var pageLabel = document.getElementById("page-label");
  var prevButton = (
    /** @type {HTMLButtonElement | null} */
    document.getElementById("prev")
  );
  var nextButton = (
    /** @type {HTMLButtonElement | null} */
    document.getElementById("next")
  );
  var config = null;
  var phrases = [];
  var choices = [];
  var shownPair = "";
  var query = "";
  var page = 1;
  var editing = null;
  var draft = "";
  var pending = null;
  var importChoices = [];
  var SAMPLE_ROWS = 3;
  var sounding = null;
  function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== void 0) node.textContent = text;
    return node;
  }
  function button(label) {
    const node = document.createElement("button");
    node.type = "button";
    node.textContent = label;
    return node;
  }
  function speakerIcon() {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const body = document.createElementNS(NS, "path");
    body.setAttribute("d", "M4 9.5v5h3.2L12 18.6V5.4L7.2 9.5H4z");
    body.setAttribute("fill", "currentColor");
    svg.append(body);
    for (const arc of ["M15 9.2a4.4 4.4 0 0 1 0 5.6", "M17.6 6.8a8 8 0 0 1 0 10.4"]) {
      const wave = document.createElementNS(NS, "path");
      wave.setAttribute("d", arc);
      wave.setAttribute("fill", "none");
      wave.setAttribute("stroke", "currentColor");
      wave.setAttribute("stroke-width", "1.8");
      wave.setAttribute("stroke-linecap", "round");
      svg.append(wave);
    }
    return svg;
  }
  function speakPhrase(phrase) {
    if (config === null) return;
    if (speaking() && sounding === phrase.normalized) {
      stop();
      sounding = null;
      return;
    }
    sounding = phrase.normalized;
    speak(
      phrase.phrase,
      phrase.langFrom,
      config.ttsVoices[primaryLanguage(phrase.langFrom)],
      config.ttsRate / 100
    );
  }
  function status(text, tone) {
    if (statusLine === null) return;
    statusLine.textContent = text;
    if (tone === void 0) delete statusLine.dataset["tone"];
    else statusLine.dataset["tone"] = tone;
  }
  function transferStatus(text, tone) {
    if (transferLine === null) return;
    transferLine.textContent = text;
    if (tone === void 0) delete transferLine.dataset["tone"];
    else transferLine.dataset["tone"] = tone;
  }
  function adoptConfig(fresh) {
    config = fresh;
    applyReading(document.documentElement, fresh.reader);
    if (sizeValue !== null) sizeValue.textContent = String(fresh.reader.fontSize);
    if (rateValue !== null) rateValue.textContent = `${(fresh.ttsRate / 100).toFixed(1)}\xD7`;
    for (const button2 of document.querySelectorAll("[data-theme], [data-font]")) {
      const wanted = button2.getAttribute("data-theme") ?? button2.getAttribute("data-font");
      const current = button2.hasAttribute("data-theme") ? fresh.reader.theme : fresh.reader.font;
      button2.setAttribute("aria-pressed", String(wanted === current));
    }
    renderVoiceChoice();
  }
  function renderVoiceChoice() {
    if (voiceChoice === null || config === null) return;
    const lang = config.sourceLang ?? "";
    const stored = lang === "" ? void 0 : config.ttsVoices[primaryLanguage(lang)];
    const voices = canSpeak() && lang !== "" ? voicesFor(speechSynthesis.getVoices(), lang) : [];
    const fallback = document.createElement("option");
    fallback.value = "";
    fallback.textContent = t("options_tts_default");
    fallback.selected = stored === void 0;
    voiceChoice.replaceChildren(
      fallback,
      ...voices.map((voice) => {
        const option = document.createElement("option");
        option.value = voice.voiceURI;
        option.textContent = `${voice.name} (${voice.lang})`;
        option.selected = voice.voiceURI === stored;
        return option;
      })
    );
  }
  async function onDisplayPress(event) {
    const button2 = event.target;
    if (!(button2 instanceof HTMLButtonElement)) return;
    const rate = button2.getAttribute("data-rate");
    if (rate !== null) {
      const current = (await readConfig()).ttsRate;
      adoptConfig(await writeConfig({ ttsRate: clamp(current + Number(rate), TTS_RATE) }));
      return;
    }
    const theme = button2.getAttribute("data-theme");
    const font = button2.getAttribute("data-font");
    const size = button2.getAttribute("data-size");
    let patch = {};
    if (isTheme(theme)) patch = { theme };
    else if (isFont(font)) patch = { font };
    else if (size !== null) {
      const current = (await readConfig()).reader;
      patch = { fontSize: clamp(current.fontSize + Number(size), SIZE) };
    } else return;
    adoptConfig(await writeConfig({ reader: patch }));
  }
  function clamp(value, range) {
    return Math.min(range.max, Math.max(range.min, value));
  }
  async function ask(request) {
    try {
      return asResult(await webext().runtime.sendMessage(request));
    } catch {
      return fail(ErrorCode.INTERNAL);
    }
  }
  async function reload() {
    try {
      const fresh = await readConfig();
      adoptConfig(fresh);
      const chosen = chosenPair(fresh);
      const pair = chosen === null ? "" : `${chosen.from}${chosen.to}`;
      if (pair !== shownPair) {
        shownPair = pair;
        page = 1;
      }
      const [saved, list] = await Promise.all([
        listPairs(),
        chosen === null ? Promise.resolve([]) : listPhrases({ langFrom: chosen.from, langTo: chosen.to })
      ]);
      choices = pairChoicesFor(fresh, saved);
      phrases = newestFirst(list);
      if (editing !== null && !phrases.some((one) => one.normalized === editing)) {
        editing = null;
        draft = "";
      }
      render();
    } catch {
      status(describeError(ErrorCode.INTERNAL), "error");
    }
  }
  function render() {
    renderPair();
    renderList();
    if (exportButton !== null) exportButton.disabled = phrases.length === 0;
  }
  function renderPair() {
    if (pairSelect === null || config === null) return;
    pairSelect.replaceChildren();
    for (const choice of choices) {
      const option = document.createElement("option");
      option.value = choice.pair;
      option.textContent = pairLabel(choice.from, choice.to);
      option.selected = choice.from === config.sourceLang && choice.to === config.targetLang;
      pairSelect.append(option);
    }
  }
  function renderCount(matching) {
    if (countLine === null) return;
    countLine.hidden = phrases.length === 0;
    countLine.textContent = query.trim().length > 0 ? plural(phrases.length, "vocab_count_filtered", [matching.toLocaleString()]) : plural(phrases.length, "phrases");
  }
  function renderList() {
    if (listContainer === null) return;
    const view = listView(phrases, { query, page });
    page = view.page;
    renderCount(view.matching);
    const editorHadFocus = document.activeElement instanceof HTMLTextAreaElement && listContainer.contains(document.activeElement);
    listContainer.replaceChildren();
    if (phrases.length === 0) {
      listContainer.append(element("p", "empty", t("vocab_empty", t("bubble_save"))));
    } else if (view.matching === 0) {
      listContainer.append(noMatch());
    } else {
      for (const phrase of view.rows) listContainer.append(phraseRow(phrase));
    }
    if (editorHadFocus) {
      const editor = listContainer.querySelector("textarea");
      if (editor instanceof HTMLTextAreaElement) {
        editor.focus();
        editor.setSelectionRange(editor.value.length, editor.value.length);
      }
    }
    renderPager(view);
  }
  function renderPager(view) {
    if (pager === null) return;
    pager.hidden = view.pages <= 1;
    if (pageLabel !== null) {
      pageLabel.textContent = t("pager_page_of", [view.page.toLocaleString(), view.pages.toLocaleString()]);
    }
    if (prevButton !== null) prevButton.disabled = view.page <= 1;
    if (nextButton !== null) nextButton.disabled = view.page >= view.pages;
  }
  function fillHighlighted(node, text) {
    for (const segment of markSegments(text, query)) {
      if (segment.hit) {
        const mark = document.createElement("mark");
        mark.textContent = segment.text;
        node.append(mark);
      } else {
        node.append(segment.text);
      }
    }
  }
  function noMatch() {
    const wrap = element("div", "empty no-match");
    wrap.append(element("p", "no-match-text", t("vocab_filter_no_match", query)));
    const clear = button(t("vocab_filter_clear"));
    clear.addEventListener("click", () => {
      query = "";
      if (filterInput !== null) {
        filterInput.value = "";
        filterInput.focus();
      }
      renderList();
    });
    wrap.append(clear);
    return wrap;
  }
  function phraseRow(phrase) {
    const row = element("div", "phrase-row");
    row.dataset["key"] = phrase.normalized;
    const word = element("span", "phrase-word");
    fillHighlighted(word, phrase.phrase);
    word.title = new Date(phrase.createdAt).toLocaleDateString(uiLocale());
    row.append(word);
    if (editing === phrase.normalized) {
      row.append(editorFor(phrase));
      return row;
    }
    const meanings = element("span", "phrase-meanings");
    fillHighlighted(meanings, phrase.translations.join("; "));
    row.append(meanings);
    const edit = button(t("bubble_edit"));
    edit.className = "quiet quiet-edit";
    edit.setAttribute("aria-label", t("vocab_edit_aria", phrase.phrase));
    edit.addEventListener("click", () => {
      editing = phrase.normalized;
      draft = phrase.translations.join("\n");
      renderList();
      listContainer?.querySelector("textarea")?.focus();
    });
    const learned = button(t("bubble_learned"));
    learned.className = "quiet quiet-learned";
    learned.setAttribute("aria-label", t("vocab_learned_aria", phrase.phrase));
    learned.addEventListener("click", () => void forget(phrase, learned));
    const actions = element("div", "phrase-actions");
    if (canSpeak()) {
      const speaker = button("");
      speaker.className = "quiet quiet-speak";
      speaker.setAttribute("aria-label", t("vocab_speak_aria", phrase.phrase));
      speaker.title = t("bubble_speak");
      speaker.append(speakerIcon());
      speaker.addEventListener("click", () => speakPhrase(phrase));
      actions.append(speaker);
    }
    actions.append(edit, learned);
    row.append(actions);
    return row;
  }
  function editorFor(phrase) {
    const wrap = element("div", "phrase-edit");
    const editor = document.createElement("textarea");
    editor.value = draft;
    editor.rows = Math.max(2, draft.split("\n").length);
    const save = button(t("bubble_save"));
    const cancel = button(t("action_cancel"));
    const empty = () => editor.value.split("\n").every((line) => line.trim().length === 0);
    save.disabled = empty();
    editor.addEventListener("input", () => {
      draft = editor.value;
      save.disabled = empty();
    });
    editor.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (!save.disabled) void saveEdit(phrase);
      }
      if (event.key === "Escape") closeEditor();
    });
    save.addEventListener("click", () => void saveEdit(phrase));
    cancel.addEventListener("click", () => closeEditor());
    const actions = element("div", "phrase-actions");
    actions.append(save, cancel);
    wrap.append(editor, actions);
    return wrap;
  }
  function refocusRow(key) {
    if (listContainer === null) return;
    for (const row of listContainer.querySelectorAll(".phrase-row")) {
      if (row instanceof HTMLElement && row.dataset["key"] === key) {
        const edit = row.querySelector("button.quiet-edit");
        if (edit instanceof HTMLButtonElement) edit.focus();
        return;
      }
    }
  }
  function closeEditor() {
    const closed = editing;
    editing = null;
    draft = "";
    renderList();
    if (closed !== null) refocusRow(closed);
  }
  async function forget(phrase, trigger) {
    const learnedButtons = () => listContainer === null ? [] : [...listContainer.querySelectorAll("button.quiet-learned")];
    const at = learnedButtons().indexOf(trigger);
    const answer = await ask({ kind: Message.FORGET_PHRASE, text: phrase.phrase });
    if (!answer.ok) {
      status(describeError(answer.code), "error");
      return;
    }
    status("");
    await reload();
    if (at === -1) return;
    const successor = learnedButtons()[Math.min(at, learnedButtons().length - 1)];
    if (successor instanceof HTMLButtonElement) successor.focus();
    else filterInput?.focus();
  }
  async function saveEdit(phrase) {
    const translations = draft.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
    if (translations.length === 0) return;
    const answer = await ask({ kind: Message.SAVE_PHRASE, text: phrase.phrase, translations });
    if (!answer.ok) {
      status(describeError(answer.code), "error");
      return;
    }
    status("");
    editing = null;
    draft = "";
    await reload();
    refocusRow(phrase.normalized);
  }
  async function exportPhrases() {
    if (config === null) return;
    const chosen = chosenPair(config);
    if (chosen === null) return;
    const pair = { langFrom: chosen.from, langTo: chosen.to };
    try {
      const list = await listPhrases(pair);
      if (list.length === 0) return;
      const url = URL.createObjectURL(new Blob([toTsv(list)], { type: "text/tab-separated-values" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = exportFilename(pair);
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 6e4);
      transferStatus("");
    } catch {
      transferStatus(describeError(ErrorCode.INTERNAL), "error");
    }
  }
  async function offerImport(file) {
    try {
      const parsed = fromTsv(await file.text());
      if (parsed.rows.length === 0) {
        pending = null;
        renderImportOffer();
        transferStatus(t("vocab_import_nothing"), "error");
        return;
      }
      pending = { name: file.name, rows: parsed.rows, invalid: parsed.invalid };
      transferStatus("");
      renderImportOffer();
    } catch {
      pending = null;
      renderImportOffer();
      transferStatus(describeError(ErrorCode.INTERNAL), "error");
    }
  }
  function renderImportOffer() {
    if (importConfirm === null) return;
    importConfirm.hidden = pending === null;
    if (pending === null) return;
    if (importSummary !== null) {
      importSummary.textContent = plural(pending.rows.length, "vocab_import_summary", [pending.name]);
    }
    if (importSample !== null) {
      importSample.replaceChildren();
      for (const row of pending.rows.slice(0, SAMPLE_ROWS)) {
        const item = document.createElement("li");
        item.textContent = `${row.text} \u2192 ${row.translations.join("; ")}`;
        importSample.append(item);
      }
    }
    renderImportPair();
  }
  function renderImportPair() {
    if (importPairSelect === null || config === null || pending === null) return;
    const named = pairFromFilename(pending.name);
    importChoices = [...choices];
    if (named !== null && !importChoices.some((one) => one.from === named.langFrom && one.to === named.langTo)) {
      importChoices.unshift({
        pair: `${named.langFrom}${named.langTo}`,
        from: named.langFrom,
        to: named.langTo,
        count: 0
      });
    }
    const chosen = chosenPair(config);
    const preferred = named !== null ? `${named.langFrom}${named.langTo}` : chosen !== null ? `${chosen.from}${chosen.to}` : "";
    importPairSelect.replaceChildren();
    for (const choice of importChoices) {
      const option = document.createElement("option");
      option.value = choice.pair;
      option.textContent = choice.count > 0 ? `${pairLabel(choice.from, choice.to)} (${choice.count.toLocaleString()})` : pairLabel(choice.from, choice.to);
      option.selected = choice.pair === preferred;
      importPairSelect.append(option);
    }
  }
  function closeImportOffer() {
    pending = null;
    renderImportOffer();
  }
  async function runImport() {
    if (pending === null || importRun === null || importPairSelect === null) return;
    const choice = importChoices.find((one) => one.pair === importPairSelect.value);
    if (choice === void 0) return;
    importRun.disabled = true;
    try {
      if (config === null || config.sourceLang !== choice.from || config.targetLang !== choice.to) {
        await writeConfig({ sourceLang: choice.from, targetLang: choice.to });
      }
      const offered = pending;
      const answer = await ask({ kind: Message.IMPORT_PHRASES, rows: offered.rows });
      if (!answer.ok) {
        transferStatus(describeError(answer.code), "error");
        return;
      }
      const report = (
        /** @type {import("../lib/protocol.js").ImportReport} */
        answer.value
      );
      const unreadable = report.invalid + offered.invalid;
      const sentences = [plural(report.added, "vocab_import_added")];
      if (report.skipped > 0) sentences.push(plural(report.skipped, "vocab_import_skipped"));
      if (unreadable > 0) sentences.push(plural(unreadable, "vocab_import_unreadable"));
      transferStatus(sentences.join(" "));
      closeImportOffer();
      await reload();
    } finally {
      importRun.disabled = false;
    }
  }
  brandButton?.addEventListener("click", () => void webext().runtime.openOptionsPage());
  armBackArrow();
  window.addEventListener("pageshow", () => {
    void webext().tabs.getCurrent().then((tab) => typeof tab?.id === "number" ? writeVocabTab(tab.id) : void 0).catch(() => void 0);
  });
  window.addEventListener("pagehide", () => {
    void writeVocabTab(null).catch(() => void 0);
  });
  function setPanel(button2, panel, open2) {
    if (button2 === null || panel === null) return;
    panel.hidden = !open2;
    button2.setAttribute("aria-expanded", String(open2));
  }
  displayButton?.addEventListener("click", () => {
    const opening = displayPanel?.hidden === true;
    setPanel(menuButton, menuPanel, false);
    setPanel(displayButton, displayPanel, opening);
  });
  menuButton?.addEventListener("click", () => {
    const opening = menuPanel?.hidden === true;
    setPanel(displayButton, displayPanel, false);
    setPanel(menuButton, menuPanel, opening);
  });
  function anyPanelOpen() {
    return displayPanel?.hidden === false || menuPanel?.hidden === false;
  }
  function closePanels() {
    setPanel(displayButton, displayPanel, false);
    setPanel(menuButton, menuPanel, false);
  }
  displayPanel?.addEventListener("click", (event) => void onDisplayPress(event));
  voiceChoice?.addEventListener("change", () => {
    if (voiceChoice === null || config === null) return;
    const key = primaryLanguage(config.sourceLang ?? "");
    if (key === "") return;
    const map = { ...config.ttsVoices };
    if (voiceChoice.value === "") delete map[key];
    else map[key] = voiceChoice.value;
    void writeConfig({ ttsVoices: map }).then(adoptConfig);
  });
  if (canSpeak()) {
    if (voiceSetting !== null) voiceSetting.hidden = false;
    if (rateSetting !== null) rateSetting.hidden = false;
    speechSynthesis.addEventListener("voiceschanged", renderVoiceChoice);
  }
  navLibrary?.addEventListener("click", () => {
    closePanels();
    void webext().runtime.sendMessage({ kind: Message.OPEN_LIBRARY }).catch(() => void 0);
  });
  navMarks?.addEventListener("click", () => {
    closePanels();
    void webext().runtime.sendMessage({ kind: Message.OPEN_MARKS }).catch(() => void 0);
  });
  navSettings?.addEventListener("click", () => {
    closePanels();
    void webext().runtime.openOptionsPage();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!anyPanelOpen()) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (pageBar?.contains(target) === true || displayPanel?.contains(target) === true || menuPanel?.contains(target) === true) {
      return;
    }
    closePanels();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !anyPanelOpen()) return;
    const focus = document.activeElement;
    if (focus instanceof Node && displayPanel?.contains(focus) === true) displayButton?.focus();
    else if (focus instanceof Node && menuPanel?.contains(focus) === true) menuButton?.focus();
    closePanels();
  });
  pairSelect?.addEventListener("change", () => {
    if (pairSelect === null) return;
    const choice = choices.find((one) => one.pair === pairSelect.value);
    if (choice === void 0) return;
    void writeConfig({ sourceLang: choice.from, targetLang: choice.to });
  });
  exportButton?.addEventListener("click", () => void exportPhrases());
  importButton?.addEventListener("click", () => importInput?.click());
  importInput?.addEventListener("change", () => {
    if (importInput === null) return;
    const file = importInput.files?.[0];
    importInput.value = "";
    if (file !== void 0) void offerImport(file);
  });
  importRun?.addEventListener("click", () => void runImport());
  importCancel?.addEventListener("click", () => {
    closeImportOffer();
    transferStatus("");
  });
  filterInput?.addEventListener("input", () => {
    if (filterInput === null) return;
    query = filterInput.value;
    page = 1;
    renderList();
  });
  prevButton?.addEventListener("click", () => {
    page -= 1;
    renderList();
  });
  nextButton?.addEventListener("click", () => {
    page += 1;
    renderList();
  });
  webext().storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[MIRROR_KEY] !== void 0) {
      void reload();
      return;
    }
    if (changes[CONFIG_KEY] === void 0) return;
    void readConfig().then((fresh) => {
      const pair = `${fresh.sourceLang}${fresh.targetLang}`;
      adoptConfig(fresh);
      if (pair !== shownPair) void reload();
    });
  });
  var intro = t("vocab_intro", [t("bubble_learned"), t("bubble_edit")]);
  if (introLine !== null && intro.length > 0) introLine.textContent = intro;
  void reload();
})();
//# sourceMappingURL=vocab.js.map
