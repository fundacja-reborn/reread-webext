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
  function effectiveReaderOnly(config, os) {
    return config.readerOnly ?? os === "android";
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
    const apply = () => void readConfig().then((config) => applyTheme(root, config.reader.theme));
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
  function localizePage() {
    document.documentElement.lang = uiLocale();
    for (const element of document.querySelectorAll("[data-i18n]")) {
      const text = t(element.getAttribute("data-i18n") ?? "");
      if (text.length > 0) element.textContent = text;
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
      for (const element of document.querySelectorAll(`[${marker}]`)) {
        const text = t(element.getAttribute(marker) ?? "");
        if (text.length > 0) element.setAttribute(attribute, text);
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

  // src/lib/models/store.js
  var DB_NAME = "reread-models";
  var DB_VERSION = 1;
  var META = "meta";
  var FILES = "files";
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
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "pair" });
        if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: "pair" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Cannot open the model database"));
      request.onblocked = () => reject(new Error("The model database is in use by another page"));
    });
  }
  async function withStores(stores, mode, work) {
    const db = await open();
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
  async function listModels() {
    const records = await withStores(
      [META],
      "readonly",
      (transaction) => promisify(transaction.objectStore(META).getAll())
    );
    return records.sort((a, b) => a.pair.localeCompare(b.pair));
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
  function asPageInfo(value) {
    if (typeof value !== "object" || value === null) return null;
    const { hostname, reader } = (
      /** @type {Record<string, unknown>} */
      value
    );
    if (reader === true) return { hostname: "", reader: true };
    if (typeof hostname !== "string" || hostname.length === 0) return null;
    return { hostname, reader: false };
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

  // src/popup/choices.js
  function pairChoices(config, installed) {
    const rows = installed.map(({ pair, from, to }) => ({ pair, from, to })).sort((a, b) => a.pair.localeCompare(b.pair));
    if (config.sourceLang === null || config.targetLang === null) return rows;
    const known = rows.some((row) => row.from === config.sourceLang && row.to === config.targetLang);
    if (known) return rows;
    return [
      { pair: `${config.sourceLang}${config.targetLang}`, from: config.sourceLang, to: config.targetLang },
      ...rows
    ];
  }

  // src/popup/rows.js
  function popupRows({ translationOff, fresh }) {
    return {
      pair: !translationOff && !fresh,
      setup: !translationOff && fresh,
      translationNote: translationOff,
      vocabulary: !translationOff,
      // The bubble's fold means nothing when the bubble is trimmed to a phrase
      // and a speaker, and reader-only means nothing when every ordinary page
      // is a launcher page already.
      quiet: !translationOff,
      readerOnly: !translationOff,
      // Always, and it is the one switch that stays: it is the way back, and a
      // mode with no way out of it in the surface that turned it on would be a
      // trap. The row it sits in is the last before the settings, where the
      // popup keeps what is flipped rarely.
      translation: true
    };
  }

  // src/popup/index.js
  localizePage();
  watchToolbarScheme();
  followTheme();
  var siteRow = document.getElementById("site-row");
  var siteLabel = document.getElementById("site-label");
  var siteNote = document.getElementById("site-note");
  var siteToggle = (
    /** @type {HTMLInputElement | null} */
    document.getElementById("site-toggle")
  );
  var quietToggle = (
    /** @type {HTMLInputElement | null} */
    document.getElementById("quiet-bubble")
  );
  var pairRow = document.getElementById("pair-row");
  var setupRow = document.getElementById("setup-row");
  var pairSelect = (
    /** @type {HTMLSelectElement | null} */
    document.getElementById("pair")
  );
  var readerButton = document.getElementById("open-reader");
  var libraryButton = document.getElementById("open-library");
  var marksButton = document.getElementById("open-marks");
  var vocabularyButton = document.getElementById("open-vocabulary");
  var settingsButton = document.getElementById("open-settings");
  var supportButton = document.getElementById("open-support");
  var SUPPORT_URL = "https://reapps.eu/#support";
  var readerOnlyToggle = (
    /** @type {HTMLInputElement | null} */
    document.getElementById("reader-only")
  );
  var translationToggle = (
    /** @type {HTMLInputElement | null} */
    document.getElementById("no-translation")
  );
  var over = { tabId: null, hostname: null };
  var choices = [];
  async function currentTabId() {
    const tabs = await webext().tabs.query({ active: true, currentWindow: true });
    const id = tabs[0]?.id;
    return typeof id === "number" ? id : null;
  }
  async function askPage(tabId) {
    if (tabId === null) return null;
    try {
      const answer = asResult(await webext().tabs.sendMessage(tabId, { kind: Message.PAGE_INFO }));
      return answer.ok ? asPageInfo(answer.value) : null;
    } catch {
      return null;
    }
  }
  function renderPair(config) {
    if (pairSelect === null) return;
    pairSelect.replaceChildren();
    for (const choice of choices) {
      const option = document.createElement("option");
      option.value = choice.pair;
      option.textContent = pairLabel(choice.from, choice.to);
      option.selected = choice.from === config.sourceLang && choice.to === config.targetLang;
      pairSelect.append(option);
    }
  }
  function renderSite(info, config) {
    if (info?.reader === true) {
      if (readerButton !== null) readerButton.hidden = true;
      return;
    }
    if (info === null) {
      if (siteNote !== null) siteNote.hidden = false;
      return;
    }
    over.hostname = info.hostname;
    if (siteLabel !== null) siteLabel.textContent = t("popup_site_enabled", info.hostname);
    if (siteToggle !== null) siteToggle.checked = !config.disabledHosts.includes(info.hostname);
    if (siteRow !== null) siteRow.hidden = false;
  }
  async function toggleSite() {
    const host = over.hostname;
    if (host === null || siteToggle === null) return;
    const current = await readConfig();
    const hosts = siteToggle.checked ? current.disabledHosts.filter((one) => one !== host) : [...current.disabledHosts, host];
    await writeConfig({ disabledHosts: hosts });
  }
  async function toggleQuietBubble() {
    if (quietToggle === null) return;
    await writeConfig({ hideBubbleActions: quietToggle.checked });
  }
  async function toggleTranslationOff() {
    if (translationToggle === null) return;
    await writeConfig({ translationOff: translationToggle.checked });
    showRows(await readConfig(), (await installedModels()).length);
  }
  async function toggleReaderOnly() {
    if (readerOnlyToggle === null) return;
    await writeConfig({ readerOnly: readerOnlyToggle.checked });
  }
  async function choosePair() {
    if (pairSelect === null) return;
    const choice = choices.find((one) => one.pair === pairSelect.value);
    if (choice === void 0) return;
    await writeConfig({ sourceLang: choice.from, targetLang: choice.to });
  }
  async function openReader() {
    const request = over.tabId === null ? { kind: Message.OPEN_READER } : { kind: Message.OPEN_READER, sourceTabId: over.tabId };
    try {
      await webext().runtime.sendMessage(request);
    } catch {
    }
    window.close();
  }
  async function openLibrary() {
    try {
      await webext().runtime.sendMessage({ kind: Message.OPEN_LIBRARY });
    } catch {
    }
    window.close();
  }
  async function openMarks() {
    try {
      await webext().runtime.sendMessage({ kind: Message.OPEN_MARKS });
    } catch {
    }
    window.close();
  }
  async function openVocabulary() {
    try {
      await webext().runtime.sendMessage({ kind: Message.OPEN_VOCABULARY });
    } catch {
    }
    window.close();
  }
  async function openSettings() {
    await webext().runtime.openOptionsPage();
    window.close();
  }
  async function openSupport() {
    try {
      await webext().tabs.create({ url: SUPPORT_URL });
    } catch {
    }
    window.close();
  }
  siteToggle?.addEventListener("change", () => void toggleSite());
  quietToggle?.addEventListener("change", () => void toggleQuietBubble());
  readerOnlyToggle?.addEventListener("change", () => void toggleReaderOnly());
  translationToggle?.addEventListener("change", () => void toggleTranslationOff());
  pairSelect?.addEventListener("change", () => void choosePair());
  readerButton?.addEventListener("click", () => void openReader());
  libraryButton?.addEventListener("click", () => void openLibrary());
  marksButton?.addEventListener("click", () => void openMarks());
  vocabularyButton?.addEventListener("click", () => void openVocabulary());
  settingsButton?.addEventListener("click", () => void openSettings());
  supportButton?.addEventListener("click", () => void openSupport());
  setupRow?.addEventListener("click", () => void openSettings());
  async function installedModels() {
    return await listModels().catch(() => []);
  }
  function stand(row, shown) {
    if (row !== null) row.toggleAttribute("hidden", !shown);
  }
  function showRows(config, installed) {
    const rows = popupRows({ translationOff: config.translationOff, fresh: installed === 0 });
    stand(pairRow, rows.pair);
    stand(setupRow, rows.setup);
    stand(document.getElementById("translation-off-note"), rows.translationNote);
    stand(vocabularyButton, rows.vocabulary);
    stand(document.getElementById("quiet-row"), rows.quiet);
    stand(document.getElementById("reader-only-row"), rows.readerOnly);
    stand(document.getElementById("no-translation-row"), rows.translation);
  }
  async function render() {
    const [config, installed, tabId, os] = await Promise.all([
      readConfig(),
      installedModels(),
      currentTabId(),
      platformOs()
    ]);
    document.body.dataset["os"] = os;
    if (readerOnlyToggle !== null) readerOnlyToggle.checked = effectiveReaderOnly(config, os);
    over.tabId = tabId;
    showRows(config, installed.length);
    if (quietToggle !== null) quietToggle.checked = config.hideBubbleActions;
    if (translationToggle !== null) translationToggle.checked = config.translationOff;
    choices = pairChoices(config, installed);
    renderPair(config);
    renderSite(await askPage(tabId), config);
  }
  void render();
})();
//# sourceMappingURL=index.js.map
