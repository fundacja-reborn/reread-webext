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
  function offscreenApi() {
    return webext().offscreen ?? null;
  }
  function commandsApi() {
    return webext().commands ?? null;
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
  function chosenPair(config) {
    if (config.sourceLang === null || config.targetLang === null) return null;
    return { from: config.sourceLang, to: config.targetLang };
  }
  async function readConfig() {
    const stored = await webext().storage.local.get(CONFIG_KEY);
    return withDefaults(stored[CONFIG_KEY]);
  }
  var PLATFORM_KEY = "platform";
  async function platformOs() {
    try {
      const info = await webext().runtime.getPlatformInfo();
      return info.os;
    } catch {
      return "";
    }
  }
  async function publishPlatform() {
    const os = await platformOs();
    await webext().storage.local.set({ [PLATFORM_KEY]: { os } });
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
  async function getModelMeta(pair) {
    const record = await withStores(
      [META],
      "readonly",
      (transaction) => promisify(transaction.objectStore(META).get(pair))
    );
    return record ?? null;
  }
  async function getModelFiles(pair) {
    const record = await withStores(
      [FILES],
      "readonly",
      (transaction) => promisify(transaction.objectStore(FILES).get(pair))
    );
    return record ?? null;
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
  function ok(value) {
    return { ok: true, value };
  }
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
  function asRequest(message) {
    if (typeof message !== "object" || message === null) return null;
    const kind = (
      /** @type {{ kind?: unknown }} */
      message.kind
    );
    if (kind === Message.OPEN_LIBRARY) return { kind: Message.OPEN_LIBRARY };
    if (kind === Message.OPEN_MARKS) return { kind: Message.OPEN_MARKS };
    if (kind === Message.OPEN_VOCABULARY) return { kind: Message.OPEN_VOCABULARY };
    if (kind === Message.OPEN_SETTINGS) return { kind: Message.OPEN_SETTINGS };
    if (kind === Message.LIST_PHRASES) return { kind: Message.LIST_PHRASES };
    if (kind === Message.READ_PAGE) return { kind: Message.READ_PAGE };
    const { text, translations, context, sourceTabId, rows } = (
      /** @type {Record<string, unknown>} */
      message
    );
    if (kind === Message.OPEN_READER) {
      return typeof sourceTabId === "number" ? { kind: Message.OPEN_READER, sourceTabId } : { kind: Message.OPEN_READER };
    }
    if (kind === Message.TRANSLATE) {
      if (typeof text !== "string") return null;
      return typeof context === "string" ? { kind: Message.TRANSLATE, text, context } : { kind: Message.TRANSLATE, text };
    }
    if (kind === Message.FORGET_PHRASE) {
      if (typeof text !== "string") return null;
      return { kind: Message.FORGET_PHRASE, text };
    }
    if (kind === Message.SAVE_PHRASE) {
      if (typeof text !== "string") return null;
      if (!Array.isArray(translations)) return null;
      if (!translations.every((one) => typeof one === "string")) return null;
      return { kind: Message.SAVE_PHRASE, text, translations };
    }
    if (kind === Message.IMPORT_PHRASES) {
      if (!Array.isArray(rows)) return null;
      const clean = [];
      for (const row of rows) {
        if (typeof row !== "object" || row === null) return null;
        const one = (
          /** @type {Record<string, unknown>} */
          row
        );
        if (typeof one["text"] !== "string") return null;
        if (!Array.isArray(one["translations"])) return null;
        if (!one["translations"].every((meaning) => typeof meaning === "string")) return null;
        clean.push({ text: one["text"], translations: one["translations"] });
      }
      return { kind: Message.IMPORT_PHRASES, rows: clean };
    }
    return null;
  }
  function asPage(value) {
    if (typeof value !== "object" || value === null) return null;
    const { url, title, html } = (
      /** @type {Record<string, unknown>} */
      value
    );
    if (typeof url !== "string" || typeof html !== "string") return null;
    if (html.length === 0) return null;
    return { url, title: typeof title === "string" ? title : "", html };
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

  // src/lib/translator/providers/none.js
  var noEngine = {
    id: "none",
    async translate() {
      return fail(ErrorCode.ENGINE_MISSING);
    }
  };

  // src/lib/translator/index.js
  var MAX_INPUT_LENGTH = 1e3;
  var provider = noEngine;
  function setProvider(next) {
    provider = next;
  }
  function usableContext(input, text) {
    const context = (input.context ?? "").trim();
    if (context.length === 0 || context.length > MAX_INPUT_LENGTH) return void 0;
    return context === text ? void 0 : context;
  }
  async function translate(input) {
    const text = input.text.trim();
    if (text.length === 0) return ok({ gloss: "", sentence: null });
    if (text.length > MAX_INPUT_LENGTH) return fail(ErrorCode.TOO_LONG);
    const context = usableContext(input, text);
    if (input.from === input.to) return ok({ gloss: text, sentence: context ?? null });
    try {
      return await provider.translate({ ...input, text, context });
    } catch {
      return fail(ErrorCode.INTERNAL);
    }
  }

  // src/lib/translator/providers/bergamot/host-protocol.js
  var ENGINE_HOST = "bergamot-host";
  function engineCall(job) {
    return { host: ENGINE_HOST, job };
  }
  function asSchemeReport(message) {
    if (typeof message !== "object" || message === null) return null;
    const { host, scheme } = (
      /** @type {Record<string, unknown>} */
      message
    );
    if (host !== ENGINE_HOST) return null;
    if (typeof scheme !== "object" || scheme === null) return null;
    const { dark } = (
      /** @type {Record<string, unknown>} */
      scheme
    );
    return typeof dark === "boolean" ? { dark } : null;
  }

  // src/lib/translator/providers/bergamot/index.js
  var WORKER_PATH = "background/engine.worker.js";
  var link = null;
  var serial = 0;
  var queue = Promise.resolve();
  function reset(reason) {
    const dying = link;
    link = null;
    loadedStamp.clear();
    if (dying === null) return;
    for (const { reject } of dying.pending.values()) reject(reason);
    dying.pending.clear();
    dying.worker.terminate();
  }
  function connect() {
    if (link !== null) return link;
    const worker = new Worker(webext().runtime.getURL(WORKER_PATH));
    const fresh = { worker, pending: /* @__PURE__ */ new Map() };
    worker.addEventListener("message", (event) => {
      const { id, result, error } = event.data ?? {};
      const waiting = fresh.pending.get(id);
      if (waiting === void 0) return;
      fresh.pending.delete(id);
      if (error) waiting.reject(new Error(error.message ?? "engine failed"));
      else waiting.resolve(result);
    });
    worker.addEventListener("error", (event) => {
      reset(new Error(`translation engine failed to start: ${event.message ?? "unknown error"}`));
    });
    link = fresh;
    return fresh;
  }
  function call(name, args, transfer = []) {
    const { worker, pending } = connect();
    const id = ++serial;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, name, args }, transfer);
    });
  }
  function serialized(work) {
    const result = queue.then(work, work);
    queue = result.then(
      () => void 0,
      () => void 0
    );
    return result;
  }
  var loadedStamp = /* @__PURE__ */ new Map();
  async function ensureModel(from, to) {
    const pair = `${from}${to}`;
    const meta = await getModelMeta(pair);
    if (meta === null) return false;
    if (loadedStamp.get(pair) === meta.addedAt && await call("loaded", [{ from, to }])) {
      return true;
    }
    const stored = await getModelFiles(pair);
    if (stored === null) return false;
    if (loadedStamp.has(pair)) await call("unload", [{ from, to }]);
    const buffers = [stored.model, stored.shortlist, ...stored.vocabs];
    const transfer = buffers.filter((buffer, index) => buffers.indexOf(buffer) === index);
    await call(
      "load",
      [
        { from, to },
        {
          model: stored.model,
          shortlist: stored.shortlist,
          vocabs: stored.vocabs,
          config: stored.config ?? {}
        }
      ],
      transfer
    );
    loadedStamp.set(pair, meta.addedAt);
    return true;
  }
  var bergamot = {
    id: "bergamot",
    translate({ text, context, from, to }) {
      return serialized(async () => {
        try {
          if (!await ensureModel(from, to)) return fail(ErrorCode.MODEL_MISSING);
          const texts = context === void 0 ? [text] : [text, context];
          const translated = await call("translate", [{ from, to }, texts]);
          const rows = Array.isArray(translated) ? translated : [];
          return ok({
            gloss: rows[0] ?? "",
            sentence: context === void 0 ? null : rows[1] ?? null
          });
        } catch (error) {
          reset(error instanceof Error ? error : new Error(String(error)));
          return fail(ErrorCode.INTERNAL);
        }
      });
    }
  };

  // src/lib/translator/providers/bergamot/remote.js
  var HOST_PAGE = "offscreen/engine-host.html";
  var HEARTBEAT_MS = 2e4;
  var creating = null;
  function ensureHost() {
    const offscreen = offscreenApi();
    if (offscreen === null) return Promise.reject(new Error("no offscreen API in this browser"));
    creating ??= offscreen.createDocument({
      url: HOST_PAGE,
      reasons: ["WORKERS"],
      justification: "Runs the packaged translation engine in a Web Worker; a service worker cannot spawn workers."
    }).catch(() => void 0).finally(() => {
      creating = null;
    });
    return creating;
  }
  function raiseEngineHost() {
    return ensureHost().catch(() => {
    });
  }
  async function callHost(job) {
    try {
      return await webext().runtime.sendMessage(engineCall(job));
    } catch {
      return void 0;
    }
  }
  var bergamotViaHost = {
    id: "bergamot-offscreen",
    async translate(job) {
      const heartbeat = setInterval(() => {
        void webext().runtime.getPlatformInfo().catch(() => {
        });
      }, HEARTBEAT_MS);
      try {
        let answer = await callHost(job);
        if (answer === void 0) {
          await ensureHost();
          answer = await callHost(job);
        }
        return (
          /** @type {import("../../../protocol.js").Result<import("../../../protocol.js").Translation>} */
          asResult(answer)
        );
      } catch {
        return fail(ErrorCode.INTERNAL);
      } finally {
        clearInterval(heartbeat);
      }
    }
  };

  // src/lib/matcher/tokenize.js
  var WORD = /[\p{L}\p{N}\p{M}]+/gu;
  function tokenize(text) {
    const tokens = [];
    WORD.lastIndex = 0;
    for (let match = WORD.exec(text); match !== null; match = WORD.exec(text)) {
      tokens.push({
        text: match[0].normalize("NFC").toLowerCase(),
        start: match.index,
        end: match.index + match[0].length
      });
    }
    return tokens;
  }
  function keyTokens(normalized) {
    return tokenize(normalized).map((token) => token.text);
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

  // src/lib/dict/deinflect.js
  var MIN_LENGTH = 2;
  var MAX_FORMS = 12;
  var RULES = Object.freeze([
    { suffix: "'s", replacement: "" },
    { suffix: String.fromCodePoint(8217) + "s", replacement: "" },
    { suffix: "iest", replacement: "y" },
    { suffix: "ies", replacement: "y" },
    { suffix: "ied", replacement: "y" },
    { suffix: "ier", replacement: "y" },
    { suffix: "ves", replacement: "f" },
    { suffix: "ves", replacement: "fe" },
    { suffix: "es", replacement: "" },
    { suffix: "s", replacement: "" },
    { suffix: "ed", replacement: "" },
    { suffix: "ed", replacement: "e" },
    { suffix: "ing", replacement: "" },
    { suffix: "ing", replacement: "e" },
    { suffix: "est", replacement: "" },
    { suffix: "est", replacement: "e" },
    { suffix: "er", replacement: "" },
    { suffix: "er", replacement: "e" },
    { suffix: "ly", replacement: "" }
  ]);
  var DOUBLED = /([bcdfghjklmnpqrstvwxz])\1$/u;
  function baseForms(word) {
    if (word.length < MIN_LENGTH) return [];
    const forms = /* @__PURE__ */ new Set();
    const offer = (form) => {
      if (form.length >= MIN_LENGTH && form !== word) forms.add(form);
    };
    for (const { suffix, replacement } of RULES) {
      if (!word.endsWith(suffix)) continue;
      const stem = word.slice(0, word.length - suffix.length) + replacement;
      offer(stem);
      if (replacement === "" && (suffix === "ed" || suffix === "ing") && DOUBLED.test(stem)) {
        offer(stem.slice(0, -1));
      }
    }
    return [...forms].slice(0, MAX_FORMS);
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

  // src/lib/dict/text.js
  var MARKUP = /* @__PURE__ */ new Set(["h", "g", "x", "w", "k"]);
  var READABLE = /* @__PURE__ */ new Set(["m", "l", "t", "y", "n", ...MARKUP]);
  var LIMITS = Object.freeze({ senseLength: 1e3, senses: 10, name: 120, credit: 400 });
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

  // src/lib/dict/store.js
  var DB_NAME2 = "reread-dicts";
  var DB_VERSION2 = 3;
  var META2 = "meta";
  var ENTRIES = "entries";
  var SOURCES = "sources";
  function promisify2(request) {
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
  function open2() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME2, DB_VERSION2);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(META2)) db.createObjectStore(META2, { keyPath: "id" });
        if (!db.objectStoreNames.contains(ENTRIES)) {
          db.createObjectStore(ENTRIES, { keyPath: ["dictId", "key"] });
        }
        if (!db.objectStoreNames.contains(SOURCES)) db.createObjectStore(SOURCES, { keyPath: "id" });
        const upgrade = request.transaction;
        if (upgrade !== null) rankExisting(upgrade.objectStore(META2));
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Cannot open the dictionary database"));
      request.onblocked = () => reject(new Error("The dictionary database is in use by another page"));
    });
  }
  async function withStores2(stores, mode, work) {
    const db = await open2();
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
  async function lookupEntries(keys, langFrom) {
    if (keys.length === 0) return [];
    return await withStores2([META2, ENTRIES], "readonly", async (transaction) => {
      const installed = (
        /** @type {Dictionary[]} */
        await promisify2(transaction.objectStore(META2).getAll())
      );
      const dictionaries = answerOrder(
        installed.filter((dictionary) => dictionary.ready && dictionary.langFrom === langFrom)
      );
      const store = transaction.objectStore(ENTRIES);
      const found = [];
      for (const dictionary of dictionaries) {
        for (const key of keys) {
          const row = (
            /** @type {import("./rows.js").DictionaryRow | undefined} */
            await promisify2(store.get([dictionary.id, key]))
          );
          if (row === void 0) continue;
          const target = row.aliasOf === void 0 ? row : (
            /** @type {import("./rows.js").DictionaryRow | undefined} */
            await promisify2(store.get([dictionary.id, row.aliasOf]))
          );
          if (target === void 0 || target.senses.length === 0) continue;
          found.push({ dictionary: dictionary.name, headword: target.headword, senses: target.senses });
          break;
        }
      }
      return found;
    });
  }

  // src/lib/dict/lookup.js
  var MAX_WORDS = 4;
  var DEINFLECTED = "en";
  function lookupKeys(text, langFrom) {
    const key = normalize(text);
    if (key.length === 0) return null;
    const words = keyTokens(key);
    if (words.length === 0 || words.length > MAX_WORDS) return null;
    const others = words.length === 1 && langFrom === DEINFLECTED ? baseForms(key) : [];
    return [key, ...others];
  }
  async function lookUp(text, langFrom) {
    const keys = lookupKeys(text, langFrom);
    if (keys === null) return [];
    try {
      return await lookupEntries(keys, langFrom);
    } catch {
      return [];
    }
  }

  // src/lib/session.js
  var READER_TAB_KEY = "readerTabId";
  var VOCAB_TAB_KEY = "vocabTabId";
  var READER_SOURCE_KEY = "readerSource";
  async function readTabId(key, session) {
    const stored = await session.get(key);
    const id = stored[key];
    return typeof id === "number" ? id : null;
  }
  async function writeTabId(key, tabId, session) {
    if (tabId === null) await session.remove(key);
    else await session.set({ [key]: tabId });
  }
  async function readReaderTab(session = webext().storage.session) {
    return readTabId(READER_TAB_KEY, session);
  }
  async function writeReaderTab(tabId, session = webext().storage.session) {
    await writeTabId(READER_TAB_KEY, tabId, session);
  }
  async function readVocabTab(session = webext().storage.session) {
    return readTabId(VOCAB_TAB_KEY, session);
  }
  async function writeVocabTab(tabId, session = webext().storage.session) {
    await writeTabId(VOCAB_TAB_KEY, tabId, session);
  }
  async function readReaderSource(session = webext().storage.session) {
    const stored = await session.get(READER_SOURCE_KEY);
    const source = stored[READER_SOURCE_KEY];
    if (typeof source !== "object" || source === null) return null;
    const { tabId, at, marks } = (
      /** @type {Record<string, unknown>} */
      source
    );
    if (typeof at !== "number") return null;
    if (marks === true) return { marks: true, at };
    if (typeof tabId !== "number") return null;
    return { tabId, at };
  }
  async function writeReaderSource(source, session = webext().storage.session) {
    await session.set({ [READER_SOURCE_KEY]: source });
  }
  async function clearReaderSource(now = Date.now, session = webext().storage.session) {
    await session.set({ [READER_SOURCE_KEY]: { at: now() } });
  }
  async function writeMarksSource(now = Date.now, session = webext().storage.session) {
    await session.set({ [READER_SOURCE_KEY]: { marks: true, at: now() } });
  }

  // src/background/page.js
  async function readPage(deps = {}) {
    const tabs = deps.tabs ?? webext().tabs;
    const session = deps.session ?? webext().storage.session;
    const source = await readReaderSource(session);
    if (source === null || "marks" in source) return fail(ErrorCode.NO_PAGE);
    let answer;
    try {
      answer = await tabs.sendMessage(source.tabId, { kind: Message.GRAB_PAGE });
    } catch {
      return fail(ErrorCode.NO_PAGE);
    }
    const result = asResult(answer);
    if (!result.ok) return result;
    const page = asPage(result.value);
    return page === null ? fail(ErrorCode.NO_PAGE) : ok(page);
  }

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

  // src/background/single-tab.js
  async function tabOnDuty({ read, url, ask }) {
    const stored = await read();
    const seen = await tabsShowing(url, ask);
    if (seen === null) return stored;
    if (stored !== null && seen.includes(stored)) return stored;
    return seen.length > 0 ? seen[0] ?? null : null;
  }
  async function focusTab(tabs, windows, id) {
    let tab;
    try {
      tab = await tabs.update(id, { active: true });
    } catch {
      return false;
    }
    if (typeof tab.windowId === "number") {
      try {
        await windows.update(tab.windowId, { focused: true });
      } catch {
      }
    }
    return true;
  }
  async function raiseOrOpen({ tabs, windows, url, read, write }) {
    const known = await read();
    if (known !== null && await focusTab(tabs, windows, known)) return;
    const opened = await tabs.create({ url });
    await write(typeof opened.id === "number" ? opened.id : null);
  }

  // src/background/reader-tab.js
  var READER_PAGE = "reader/reader.html";
  async function openReader(deps = {}) {
    const session = deps.session ?? webext().storage.session;
    const url = deps.url ?? webext().runtime.getURL(READER_PAGE);
    await raiseOrOpen({
      tabs: deps.tabs ?? webext().tabs,
      windows: deps.windows ?? webext().windows,
      url,
      // Not the stored id alone: the witness of what the tab really shows
      // (D140, `single-tab.js`) - a reader that walked to the settings in
      // place must not be raised as one, and a reader nobody remembered is
      // adopted rather than duplicated.
      read: () => tabOnDuty({ read: () => readReaderTab(session), url, ask: deps.contexts }),
      write: (tabId) => writeReaderTab(tabId, session)
    });
  }
  async function readInReader(tab, deps = {}) {
    const session = deps.session ?? webext().storage.session;
    const now = deps.now ?? Date.now;
    const known = await readReaderTab(session);
    if (typeof tab.id === "number" && tab.id !== known) {
      await writeReaderSource({ tabId: tab.id, at: now() }, session);
    }
    await openReader(deps);
  }
  async function openLibrary(deps = {}) {
    const session = deps.session ?? webext().storage.session;
    const now = deps.now ?? Date.now;
    await clearReaderSource(now, session);
    await openReader(deps);
  }
  async function openMarks(deps = {}) {
    const session = deps.session ?? webext().storage.session;
    const now = deps.now ?? Date.now;
    await writeMarksSource(now, session);
    await openReader(deps);
  }

  // src/background/vocab-tab.js
  var VOCAB_PAGE = "vocab/vocab.html";
  async function openVocabulary(deps = {}) {
    const session = deps.session ?? webext().storage.session;
    const url = deps.url ?? webext().runtime.getURL(VOCAB_PAGE);
    await raiseOrOpen({
      tabs: deps.tabs ?? webext().tabs,
      windows: deps.windows ?? webext().windows,
      url,
      // The witness, exactly the reader's (D140/D141, `single-tab.js`): since
      // the reader's menu walks to this page in place, a phrases tab can both
      // stop being one (it walked on) and start somewhere nobody remembered -
      // the walked-to page is adopted, so a popup press raises it rather than
      // opening a copy beside it.
      read: () => tabOnDuty({ read: () => readVocabTab(session), url, ask: deps.contexts }),
      write: (tabId) => writeVocabTab(tabId, session)
    });
  }

  // src/lib/store/mirror.js
  var MIRROR_KEY = "vocabIndex";
  function mirrorOf(config, phrases) {
    return {
      from: config.sourceLang ?? "",
      to: config.targetLang ?? "",
      entries: phrases.map((phrase) => [phrase.normalized, phrase.translations])
    };
  }
  async function writeMirror(mirror) {
    await webext().storage.local.set({ [MIRROR_KEY]: mirror });
  }

  // src/lib/store/phrase.js
  var MAX_PHRASE_LENGTH = 1e3;
  function cleanTranslations(translations) {
    const cleaned = [];
    for (const translation of translations) {
      const one = collapseWhitespace(translation);
      if (one.length > 0 && !cleaned.includes(one)) cleaned.push(one);
    }
    return cleaned;
  }
  function buildPhrase({ text, translations, langFrom, langTo, id, now }) {
    if (text.length > MAX_PHRASE_LENGTH) return fail(ErrorCode.TOO_LONG);
    const phrase = trimPhrase(text);
    const normalized = normalize(text);
    const meanings = cleanTranslations(translations);
    if (normalized.length === 0 || meanings.length === 0) return fail(ErrorCode.INTERNAL);
    return ok({ id, langFrom, langTo, phrase, normalized, translations: meanings, createdAt: now });
  }
  function resaved(existing, incoming) {
    return { ...existing, phrase: incoming.phrase, translations: incoming.translations };
  }

  // src/lib/store/vocab.js
  var DB_NAME3 = "reread-vocab";
  var DB_VERSION3 = 1;
  var PHRASES = "phrases";
  var BY_KEY = "by_key";
  var BY_PAIR = "by_pair";
  function promisify3(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    });
  }
  function open3() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME3, DB_VERSION3);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (db.objectStoreNames.contains(PHRASES)) return;
        const phrases = db.createObjectStore(PHRASES, { keyPath: "id" });
        phrases.createIndex(BY_KEY, ["langFrom", "langTo", "normalized"], { unique: true });
        phrases.createIndex(BY_PAIR, ["langFrom", "langTo"], { unique: false });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Cannot open the vocabulary database"));
      request.onblocked = () => reject(new Error("The vocabulary database is in use by another page"));
    });
  }
  async function withPhrases(mode, work) {
    const db = await open3();
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
  function indexKey({ langFrom, langTo, normalized }) {
    return [langFrom, langTo, normalized];
  }
  async function putPhrase(phrase) {
    await withPhrases("readwrite", async (store) => {
      const existing = (
        /** @type {Phrase | undefined} */
        await promisify3(store.index(BY_KEY).get(indexKey(phrase)))
      );
      await promisify3(store.put(existing === void 0 ? phrase : resaved(existing, phrase)));
    });
  }
  async function putMissingPhrases(phrases) {
    return await withPhrases("readwrite", async (store) => {
      const index = store.index(BY_KEY);
      let added = 0;
      let skipped = 0;
      for (const phrase of phrases) {
        const existing = await promisify3(index.getKey(indexKey(phrase)));
        if (existing === void 0) {
          await promisify3(store.put(phrase));
          added += 1;
        } else {
          skipped += 1;
        }
      }
      return { added, skipped };
    });
  }
  async function deletePhrase(key) {
    return await withPhrases("readwrite", async (store) => {
      const id = await promisify3(store.index(BY_KEY).getKey(indexKey(key)));
      if (id === void 0) return false;
      await promisify3(store.delete(id));
      return true;
    });
  }
  async function listPhrases(pair) {
    const records = (
      /** @type {Phrase[]} */
      await withPhrases(
        "readonly",
        (store) => promisify3(store.index(BY_PAIR).getAll([pair.langFrom, pair.langTo]))
      )
    );
    return records.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }

  // src/background/vocabulary.js
  function pairOf(config) {
    const pair = chosenPair(config);
    return pair === null ? null : { langFrom: pair.from, langTo: pair.to };
  }
  async function rebuildMirror(config) {
    const pair = pairOf(config);
    const phrases = pair === null ? [] : await listPhrases(pair);
    const mirror = mirrorOf(config, phrases);
    await writeMirror(mirror);
    return mirror.entries;
  }
  async function refreshVocabulary() {
    await rebuildMirror(await readConfig());
  }
  async function savePhrase(request) {
    const config = await readConfig();
    const pair = pairOf(config);
    if (pair === null) return fail(ErrorCode.MODEL_MISSING);
    const built = buildPhrase({
      text: request.text,
      translations: request.translations,
      langFrom: pair.langFrom,
      langTo: pair.langTo,
      id: crypto.randomUUID(),
      now: Date.now()
    });
    if (!built.ok) return built;
    await putPhrase(built.value);
    await rebuildMirror(config);
    return ok(null);
  }
  async function forgetPhrase(request) {
    const normalized = normalize(request.text);
    if (normalized.length === 0) return ok(null);
    const config = await readConfig();
    const pair = pairOf(config);
    if (pair === null) return ok(null);
    const forgotten = await deletePhrase({ ...pair, normalized });
    if (forgotten) await rebuildMirror(config);
    return ok(null);
  }
  async function importPhrases(request) {
    const config = await readConfig();
    const pair = pairOf(config);
    if (pair === null) return fail(ErrorCode.MODEL_MISSING);
    const now = Date.now();
    const rows = [];
    let invalid = 0;
    for (const [at, row] of request.rows.entries()) {
      const built = buildPhrase({
        text: row.text,
        translations: row.translations,
        langFrom: pair.langFrom,
        langTo: pair.langTo,
        id: crypto.randomUUID(),
        now: now + at
      });
      if (built.ok) rows.push(built.value);
      else invalid += 1;
    }
    const { added, skipped } = await putMissingPhrases(rows);
    if (added > 0) await rebuildMirror(config);
    return ok({ added, skipped, invalid });
  }
  async function listVocabulary() {
    return ok(await rebuildMirror(await readConfig()));
  }

  // src/background/index.js
  setProvider(offscreenApi() === null ? bergamot : bergamotViaHost);
  async function handle(request, sender) {
    switch (request.kind) {
      case Message.TRANSLATE: {
        const config = await readConfig();
        const pair = chosenPair(config);
        if (pair === null) return fail(ErrorCode.MODEL_MISSING);
        const [translated, entries] = await Promise.all([
          translate({
            text: request.text,
            context: request.context,
            from: pair.from,
            to: pair.to
          }),
          lookUp(request.text, pair.from)
        ]);
        return translated.ok ? ok({ ...translated.value, entries }) : translated;
      }
      case Message.OPEN_READER: {
        const sourceTabId = request.sourceTabId ?? sender.tab?.id;
        if (typeof sourceTabId === "number") await readInReader({ id: sourceTabId });
        else await openReader();
        return ok(null);
      }
      case Message.OPEN_LIBRARY: {
        await openLibrary();
        return ok(null);
      }
      case Message.OPEN_MARKS: {
        await openMarks();
        return ok(null);
      }
      case Message.OPEN_VOCABULARY: {
        await openVocabulary();
        return ok(null);
      }
      case Message.OPEN_SETTINGS: {
        await webext().runtime.openOptionsPage();
        return ok(null);
      }
      case Message.READ_PAGE:
        return await readPage();
      case Message.SAVE_PHRASE:
        return await savePhrase(request);
      case Message.FORGET_PHRASE:
        return await forgetPhrase(request);
      case Message.LIST_PHRASES:
        return await listVocabulary();
      case Message.IMPORT_PHRASES:
        return await importPhrases(request);
    }
  }
  webext().runtime.onMessage.addListener((message, sender, sendResponse) => {
    const scheme = asSchemeReport(message);
    if (scheme !== null) {
      void webext().action.setIcon({ path: toolbarIconFor(scheme.dark) }).catch(() => {
      });
      return false;
    }
    const request = asRequest(message);
    if (request === null) {
      sendResponse(fail(ErrorCode.UNKNOWN_MESSAGE));
      return false;
    }
    handle(request, sender).then(sendResponse, () => sendResponse(fail(ErrorCode.INTERNAL)));
    return true;
  });
  commandsApi()?.onCommand.addListener((command, tab) => {
    if (command !== Message.OPEN_READER) return;
    void (tab === void 0 ? openReader() : readInReader(tab));
  });
  webext().runtime.onInstalled.addListener(() => {
    void refreshVocabulary();
    void publishPlatform().catch(() => {
    });
    void listModels().then(writeInventory).catch(() => {
    });
  });
  webext().runtime.onStartup.addListener(() => {
    if (offscreenApi() !== null) void raiseEngineHost();
  });
})();
//# sourceMappingURL=index.js.map
