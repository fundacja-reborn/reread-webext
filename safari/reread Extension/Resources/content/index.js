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
  function within(value, range2, fallback) {
    if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
    return Math.min(range2.max, Math.max(range2.min, Math.round(value)));
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
  var PLATFORM_KEY = "platform";
  function osFrom(stored) {
    if (typeof stored !== "object" || stored === null) return "";
    const os2 = (
      /** @type {Record<string, unknown>} */
      stored["os"]
    );
    return typeof os2 === "string" ? os2 : "";
  }
  function effectiveReaderOnly(config2, os2) {
    return config2.readerOnly ?? os2 === "android";
  }
  function pageMode(config2, os2, hostname) {
    if (config2.disabledHosts.includes(hostname)) return "off";
    if (config2.translationOff) return "launcher";
    if (effectiveReaderOnly(config2, os2)) return "launcher";
    return "reading";
  }

  // src/lib/models/inventory.js
  var MODELS_KEY = "models";
  function modelPair(from, to) {
    return `${from}${to}`;
  }
  function asInventory(stored) {
    if (typeof stored !== "object" || stored === null) return null;
    const pairs = (
      /** @type {Record<string, unknown>} */
      stored["pairs"]
    );
    if (!Array.isArray(pairs)) return null;
    return { pairs: pairs.filter((one) => typeof one === "string" && one.length > 0) };
  }
  function needsModelHint(config2, inventory2) {
    if (config2.translationOff) return false;
    if (inventory2 === null) return false;
    const pair = chosenPair(config2);
    if (pair === null) return true;
    return !inventory2.pairs.includes(modelPair(pair.from, pair.to));
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
  var MAX_PAGE_HTML = 8e6;
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
  function asTranslation(value) {
    if (typeof value !== "object" || value === null) return { gloss: "", sentence: null, entries: [] };
    const { gloss, sentence, entries } = (
      /** @type {Record<string, unknown>} */
      value
    );
    const answer = typeof gloss === "string" ? gloss : "";
    const second = answer.length > 0 && typeof sentence === "string" ? sentence : null;
    return { gloss: answer, sentence: second, entries: answer.length > 0 ? asEntries(entries) : [] };
  }
  function asEntries(value) {
    if (!Array.isArray(value)) return [];
    const entries = [];
    for (const one of value) {
      if (typeof one !== "object" || one === null) continue;
      const { dictionary, headword, senses } = (
        /** @type {Record<string, unknown>} */
        one
      );
      if (!Array.isArray(senses)) continue;
      const lines = senses.filter((line) => typeof line === "string" && line.length > 0);
      if (lines.length === 0) continue;
      entries.push({
        dictionary: typeof dictionary === "string" ? dictionary : "",
        headword: typeof headword === "string" ? headword : "",
        senses: lines
      });
    }
    return entries;
  }
  function asPageRequest(message) {
    if (typeof message !== "object" || message === null) return null;
    const kind = (
      /** @type {{ kind?: unknown }} */
      message.kind
    );
    if (kind === Message.GRAB_PAGE) return { kind: Message.GRAB_PAGE };
    if (kind === Message.PAGE_INFO) return { kind: Message.PAGE_INFO };
    return null;
  }

  // src/lib/store/mirror.js
  var MIRROR_KEY = "vocabIndex";
  function asMirror(stored) {
    if (typeof stored !== "object" || stored === null) return null;
    const { from, to, entries } = (
      /** @type {Record<string, unknown>} */
      stored
    );
    if (typeof from !== "string" || typeof to !== "string" || !Array.isArray(entries)) return null;
    const clean = [];
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [normalized, translations] = entry;
      if (typeof normalized !== "string" || normalized.length === 0) continue;
      if (!Array.isArray(translations)) continue;
      const meanings = translations.filter((one) => typeof one === "string" && one.length > 0);
      if (meanings.length === 0) continue;
      clean.push([normalized, meanings]);
    }
    return { from, to, entries: clean };
  }
  function mirrorMatches(mirror, config2) {
    return mirror.from === (config2.sourceLang ?? "") && mirror.to === (config2.targetLang ?? "");
  }

  // src/lib/i18n.js
  function t(key, substitutions) {
    try {
      return webext().i18n.getMessage(key, substitutions);
    } catch {
      return "";
    }
  }

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

  // src/lib/selection.js
  var DRAG_SLOP = 4;
  var AUTO_KEEP_MAX_WORDS = 4;
  function madeSelection({ from, to, clicks }) {
    if (clicks >= 2) return true;
    if (from === null) return true;
    return Math.abs(to.x - from.x) > DRAG_SLOP || Math.abs(to.y - from.y) > DRAG_SLOP;
  }
  function keeping({ normalized, gloss, findable: findable2, deliberate = true }) {
    if (normalized.length === 0 || gloss.length === 0 || !findable2) return "none";
    if (!deliberate) return "ask";
    return keyTokens(normalized).length > AUTO_KEEP_MAX_WORDS ? "ask" : "automatic";
  }
  function touchPointer(pointerType) {
    return pointerType === "touch" || pointerType === "pen";
  }
  function copyCombo({ key, ctrl, meta, alt, shift }) {
    if (key !== "c" && key !== "C") return false;
    return ctrl !== meta && !alt && !shift;
  }

  // src/lib/gloss.js
  var MEANING_SEPARATOR = "\n";
  function toMeanings(text) {
    return text.split(MEANING_SEPARATOR).map((line) => line.trim()).filter((line) => line.length > 0);
  }
  function choosableLines(senses) {
    return senses.flatMap(toMeanings);
  }
  function afterChoosing(shown, sense) {
    const meanings = toMeanings(shown);
    const without = meanings.filter((meaning) => meaning !== sense);
    const next = without.length === meanings.length ? [...meanings, sense] : without;
    return next.join(MEANING_SEPARATOR);
  }

  // src/content/tooltip.js
  var GAP = 8;
  var VIEWPORT_MARGIN = 8;
  var SYSTEM_GAP = 64;
  var MIN_ENTRIES_HEIGHT = 96;
  function label(action) {
    switch (action) {
      case "save":
        return t("bubble_save");
      case "learned":
        return t("bubble_learned");
      case "edit":
        return t("bubble_edit");
      case "settings":
        return t("bubble_settings");
      case "cancel":
        return t("action_cancel");
      case "more":
        return t("bubble_more");
      case "reader":
        return t("bubble_reader");
      case "library":
        return t("reading_list");
      case "speak":
        return t("bubble_speak");
      case "copy":
        return t("bubble_copy");
      case "copy-original":
        return t("bubble_copy_original");
      case "copy-translation":
        return t("bubble_copy_translation");
    }
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
  function copyIcon() {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const front = document.createElementNS(NS, "rect");
    front.setAttribute("x", "8");
    front.setAttribute("y", "8");
    front.setAttribute("width", "11.5");
    front.setAttribute("height", "11.5");
    front.setAttribute("rx", "1.8");
    front.setAttribute("fill", "none");
    front.setAttribute("stroke", "currentColor");
    front.setAttribute("stroke-width", "1.9");
    svg.append(front);
    const back = document.createElementNS(NS, "path");
    back.setAttribute("d", "M16.2 4.9H7a2.1 2.1 0 0 0-2.1 2.1v9.2");
    back.setAttribute("fill", "none");
    back.setAttribute("stroke", "currentColor");
    back.setAttribute("stroke-width", "1.9");
    back.setAttribute("stroke-linecap", "round");
    svg.append(back);
    return svg;
  }
  function lessLabel() {
    return t("bubble_less");
  }
  function chevronIcon() {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const point = document.createElementNS(NS, "path");
    point.setAttribute("d", "M6 14.5l6-5 6 5");
    point.setAttribute("fill", "none");
    point.setAttribute("stroke", "currentColor");
    point.setAttribute("stroke-width", "2");
    point.setAttribute("stroke-linecap", "round");
    point.setAttribute("stroke-linejoin", "round");
    svg.append(point);
    return svg;
  }
  function foldLabel(clamped) {
    return clamped ? t("bubble_sentence_expand") : t("bubble_sentence_collapse");
  }
  function foldControl({ entries, overflows }) {
    if (!entries) return "absent";
    return overflows ? "shown" : "reserved";
  }
  var TOUCH_SIZES = `
    --type-body: 16px;
    --type-second: 15px;
    --type-label: 12px;
    --type-action: 14px;
    --type-cta: 15px;
    --gap-actions: 0.63em;
    --pad-sense: 0.4em 0.53em;
    --pad-action: 0.57em 0.43em;
    --pull-action: -0.43em;
    --pad-cta: 0.53em 1.07em;
    --icon: 1.43em;
`;
  var STYLE = `
  :host { all: initial; }
  * { box-sizing: border-box; }

  /* The hidden attribute is a rule in the browser's own stylesheet, and any
     rule of ours beats it: one display on .editor was enough to leave an empty
     text box sitting under every translation. */
  [hidden] { display: none !important; }

  .bubble {
    color-scheme: light dark;
    /* Hanging off the host's line (D77): the host is a full-width strip of no
       height pinned by top alone, and which way the bubble hangs off it is
       the data-grow rules below. */
    position: absolute;
    /* A column in the order of distance from the phrase - gloss, actions,
       second layer - which the mirror below reverses whole when the bubble
       stands above the phrase. */
    display: flex;
    flex-direction: column;
    /* Every size the bubble draws its type and its presses at, in two tiers
       (D84): these desktop values, and TOUCH_SIZES above, spliced in below -
       by the media query, or by the data-pointer attribute when the gesture
       that made the selection was a finger or a pen. The attribute exists
       because the media query can be wrong about a device: an Onyx e-ink
       tablet reports a fine primary pointer over its touch screen, and the
       gesture is the ground truth. Lengths that have to grow with the type
       are written in em; the fonts multiply by --bubble-scale, the reader's
       own knob over all of it (D85), which show() sets inline here. */
    --type-body: 14px;
    --type-second: 13px;
    --type-label: 11px;
    --type-action: 12px;
    --type-cta: 13px;
    --gap-actions: 0.43em;
    --pad-sense: 0.15em 0.31em;
    --pad-action: 0.17em 0.33em;
    --pull-action: -0.33em;
    --pad-cta: 0.23em 0.77em;
    --icon: 1.33em;
    /* One strength for every line the bubble draws, past 4.5:1 against its own
       paper. An e-ink panel quantizes the screen to 16 greys and rounds a
       near-white hairline back into it, so a tenth of a black is not a faint
       line there - it is no line at all, which is how the separators went
       missing on a Boox. The pages get two strengths (page.css: separators
       quieter than a control's edge), and the bubble had them too for one
       build - but read on paper the quieter one still looked like a mistake
       beside the louder, so the bubble keeps the one that survives. A solid
       color and not an alpha, because nothing here is laid over the page: the
       bubble's background is painted under its own border, so every line in it
       stands on paper we chose. The dark value is in the query at the bottom. */
    --edge: #6e7583;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: calc(var(--type-body) * var(--bubble-scale, 1));
    line-height: 1.45;
    max-width: min(calc(22rem * var(--bubble-scale, 1)), 90vw);
    padding: 10px 12px;
    border-radius: 10px;
    /* The edge, not the shadow, is what says where the bubble ends: an e-ink
       panel flattens the shadow into nothing, and it has to say so over any
       page's colors - so it holds --edge, the strength page.css gives a
       control's border, and not a hairline's. A third of a black said the
       same thing far too quietly there. */
    border: 1px solid var(--edge);
    background: #ffffff;
    color: #1f2430;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
    overflow-wrap: break-word;
  }

  /* Which way the bubble hangs. Only ever off the host's top-pinned line,
     never off a bottom computed from the viewport's height: Android's
     dynamic toolbar walks bottom-anchored fixed elements up and down with
     itself, and a bubble pinned that way landed on its own phrase (D77). */
  .bubble[data-grow="down"] { top: 0; }
  .bubble[data-grow="up"] { bottom: 0; }

  /* A flex item does not shrink below its own content unless it is told to, and
     one long word in a gloss would push the bubble past its maximum width. */
  .bubble > * { min-width: 0; }

  .body { white-space: pre-wrap; }
  .body[data-tone="pending"] { opacity: 0.6; font-style: italic; }
  .body[data-tone="error"] { color: #a3341f; }
  /* The launcher says nothing in its body - its signature is another element -
     and an empty line would still cost the row of pixels its line-height
     reserves. */
  .body:empty { display: none; }

  /* Quieter than the gloss and fenced off from the rest: this is the sentence
     the phrase was in, not another meaning of it. Style and colour go on every
     edge but width on one, so that the mirror below can move the line to the
     other side by widths alone and the colour stays one rule per theme.
     Inside, two columns (D96): the text gives way, the fold in the corner
     keeps its size - and the section's own inside never reorders, whichever
     way the mirror runs the bubble. */
  .context {
    display: flex;
    align-items: flex-start;
    gap: 0.5em;
    margin-top: 8px;
    padding-top: 8px;
    border: 0 solid var(--edge);
    border-top-width: 1px;
    font-size: calc(var(--type-second) * var(--bubble-scale, 1));
    opacity: 0.85;
  }
  .context-text {
    flex: 1;
    min-width: 0;
  }

  /* The same tones the body knows, for the one bubble that fetches its second
     layer on demand: a recalled phrase answers from the database, and the
     sentence starts being translated only when More asks for it. A note is
     the fetch coming back empty-handed - said in the pending line's quiet
     voice, because both are the layer talking about itself, not a sentence. */
  .context[data-tone="pending"],
  .context[data-tone="note"] { opacity: 0.6; font-style: italic; }
  .context[data-tone="error"] { color: #a3341f; }

  /* The clamp the fold buys (D96): one line, cut honestly with an ellipsis.
     The room it frees reaches the dictionary box through the next placement -
     the squeeze (D79) starts from scratch every time - not through anything
     written here. */
  .context[data-folded="true"] .context-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* The fold itself, dressed as a control on purpose: the triangle under the
     dictionary list is a passive mark of a cut box, and two identical glyphs
     of which only one answers a press would teach the wrong lesson about the
     other. So this one carries the frame pressable things get here - the
     edge's solid ink, which an e-ink panel can draw - and its chevron turns
     to point at what the press would do. No transition on the turn: a flip
     is one repaint, an animation is a smear on paper. */
  .context-toggle {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin: 0;
    padding: 0.25em;
    font: inherit;
    color: inherit;
    background: none;
    border: 1px solid var(--edge);
    border-radius: 5px;
    opacity: 0.7;
    cursor: pointer;
  }
  .context-toggle:hover { opacity: 1; }
  .context-toggle:focus-visible {
    opacity: 1;
    outline: 1px solid currentColor;
    outline-offset: 0;
  }
  .context-toggle svg {
    width: var(--icon);
    height: var(--icon);
    display: block;
  }
  .context[data-folded="true"] .context-toggle svg { transform: rotate(180deg); }

  /* A dictionary entry can be long, and a bubble that grows past the window is
     a bubble that covers the sentence somebody was reading. It scrolls instead;
     the page underneath keeps the bubble open while it does. */
  .entries {
    margin-top: 8px;
    padding-top: 8px;
    /* The strip the mark below stands in, kept clear of the text whether or
       not the mark is drawn: reserving it only when the list overflows would
       reflow the very list somebody is reading down. */
    padding-right: 0.9em;
    border: 0 solid var(--edge);
    border-top-width: 1px;
    font-size: calc(var(--type-second) * var(--bubble-scale, 1));
    max-height: 40vh;
    overflow-y: auto;
    overscroll-behavior: contain;
    /* Where a bar is drawn at all it is drawn in our ink. It cannot be the
       thing that says the list scrolls, though: Gecko fades its bar out again
       when nothing is moving, and on Android it is not there until a finger
       is (measured on a Boox - the mark below exists because of it). */
    scrollbar-width: thin;
    scrollbar-color: var(--edge) transparent;
  }

  /* A list longer than its box, said twice: the box closes on a line where it
     was cut, and a small triangle stands in the strip at that corner.

     An inset shadow said it first - macOS hides its scrollbars until something
     moves, so an entry running past the bottom read as an entry that ended
     there - but a shadow is the one thing an e-ink panel cannot draw: 16 greys
     turn it into either nothing or a grey smear lying across the very line it
     was meant to help read. The line that replaced it was honest and too
     quiet: on a Boox a cut and a separator are one and the same line, and a
     reader with no bar on the screen can miss that there is anything to
     scroll at all. So the triangle, and it is ink rather than a fade: one
     conic wedge with a hard stop, nothing for a panel to dither.

     What it says is that the box is cut, not that there is more below this
     exact spot - which is why it may stand still while the reader scrolls.
     The list is longer than the box wherever they have got to, and a mark that
     needs a scroll listener to stop lying would repaint an e-ink panel to say
     something the edge already said.

     Both ways the bubble hangs are covered: growing up the mirror has put the
     line here already. The width growing down adds costs the bubble nothing -
     a box that scrolls is a box already capped in height, and box-sizing is
     border-box. */
  .entries[data-more="true"] {
    border-bottom-width: 1px;
    background-image: conic-gradient(from -45deg at 50% 100%, var(--edge) 0 90deg, transparent 0);
    background-size: 0.7em 0.35em;
    background-position: right 0.1em bottom 0.3em;
    background-repeat: no-repeat;
  }

  .entry + .entry { margin-top: 8px; }

  /* Which book this came from, and the word it actually found - the second one
     matters when the reader selected "watches" and the dictionary knows "watch". */
  .entry-label {
    font-size: calc(var(--type-label) * var(--bubble-scale, 1));
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0.6;
    /* The border and the padding a meaning below it carries, so the two start
       at the same place on the screen. */
    padding-left: 5px;
  }

  /* A meaning is a line to read first and a choice second, so it keeps the shape
     of the text around it: a stack of things that look like buttons under a word
     reads as a form to fill in. What says it can be pressed is the cursor and
     the tint under it, and what says it was pressed is the mark that stays. */
  .entry-sense {
    display: block;
    width: 100%;
    margin: 0;
    padding: var(--pad-sense);
    font: inherit;
    text-align: left;
    color: inherit;
    background: none;
    border: 1px solid transparent;
    border-radius: 5px;
    white-space: pre-wrap;
    cursor: pointer;
  }
  /* The tint is the cursor's affordance, so it follows only a real mouse:
     under a finger :hover is an emulation, which paints the line a scroll
     happens to be passing through and stays on the last line touched after
     the finger lifts - a mark that reads as a choice nobody made, beside
     marks that are choices (reported from a Pixel). The media query cannot
     draw this line - a Boox answers it wrong (D84) - so the gate is the same
     attribute the gesture sets for the size tiers. A tap loses nothing: its
     feedback is the border that stays, and on an e-ink panel a transient
     wash was one more repaint of the list being scrolled. */
  .bubble:not([data-pointer="coarse"]) .entry-sense[aria-pressed="false"]:hover:not(:disabled) { background: rgba(0, 0, 0, 0.06); }
  /* The mark that stays, and the border is the whole of it where the tint
     cannot be seen: a wash this light is one of the 16 greys an e-ink panel
     rounds back to paper, and which meanings are already in the gloss is not
     something to leave to a wash. */
  .entry-sense[aria-pressed="true"] {
    background: rgba(0, 0, 0, 0.07);
    border-color: var(--edge);
  }
  /* Not faded while the edit box is open, unlike every other disabled button
     here: the entry is still there to be read, it just cannot be chosen for as
     long as the gloss is being typed by hand. */
  .entry-sense:disabled { opacity: 1; cursor: default; }
  /* The quiet bubble's lines are prose, not presses (D121) - the pointer must
     not promise a choice that does not exist. */
  .bubble[data-variant="quiet"] .entry-sense { cursor: default; }

  .editor {
    display: block;
    width: 100%;
    min-width: 16rem;
    margin: 0;
    padding: 4px 6px;
    font: inherit;
    color: inherit;
    background: rgba(0, 0, 0, 0.04);
    border: 1px solid var(--edge);
    border-radius: 6px;
    resize: none;
  }

  /* The row of actions, folded. The fold is a grid row going from zero to one
     fraction - the one way to animate to a height nobody knows in advance - and
     the clipped child below is what makes it read as unfolding rather than as
     text being squeezed. Folded is where every bubble starts; whether it is
     ever seen there is the reader's setting (D81, D131) - with the row asked
     for, the revealed class is on from the first frame (see show) and the fold
     is never seen; without it, the row waits for somebody to come looking. */
  .reveal {
    display: grid;
    grid-template-rows: 0fr;
    opacity: 0;
    transition: grid-template-rows 150ms ease, opacity 150ms ease;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--gap-actions);
    /* The two pixels on the far side are for a focus ring: a folded row is
       clipped, and a ring drawn flush with the edge would be clipped with it. */
    padding: 8px 0 2px;
    min-height: 0;
    overflow: hidden;
  }
  .actions:empty { display: none; }

  /* Three ways in, and the class is the one that keeps it: a row that folded
     itself away again on mouseleave would flicker at every brush of the
     bubble's edge, and nothing is gained by taking back an answer somebody has
     just gone looking for. The bubble closes in one piece soon enough.

     No branch for touch screens, and that is deliberate (D44): a finger arrives
     by pressing, and the press adds the same class every other way in ends at.
     A media query on hover bought nothing anyway - a hybrid reports hover:hover
     and would have kept the folding, while its taps emulate :hover and unfold
     it - so one rule for every device is also the only consistent one. */
  .bubble:hover .reveal,
  .bubble:focus-within .reveal,
  .bubble.revealed .reveal {
    grid-template-rows: 1fr;
    opacity: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    .reveal { transition: none; }
  }

  /* The mirror (D44). The edge nearest the phrase is pinned (see placement),
     and the gloss has to be the thing lying on it, so everything that appears
     or grows - the row unfolding, the second layer opening behind "More" -
     lands on the far side of the gloss and moves only the edge away from the
     line being read. One rule reverses the whole column, which is what keeps
     the two variants one layout: the same file of elements, read from the
     phrase outwards. */
  .bubble[data-grow="up"] { flex-direction: column-reverse; }
  .bubble[data-grow="up"] .actions { padding: 2px 0 8px; }

  /* Reversing the column moves no borders: the separators in front of the
     second layer change sides by width, colour and style stay put. */
  .bubble[data-grow="up"] .context,
  .bubble[data-grow="up"] .entries {
    margin: 0 0 8px;
    padding: 0 0 8px;
    border-width: 0 0 1px;
  }

  /* The strip for the scroll mark is not the mirror's business, and the
     shorthand above would take it away. */
  .bubble[data-grow="up"] .entries { padding-right: 0.9em; }

  /* The launcher is its row under its signature, so the row's padding - which
     exists to stand the row off a gloss that is not there - goes too; the
     signature's own margin is the whole gap above it. After the mirror, whose
     padding this outranks by standing below it. The quiet bubble (D120) is the
     same shape with two pictures in the row. */
  .bubble[data-variant="launcher"] .actions,
  .bubble[data-variant="quiet"] .actions { padding: 0; }

  /* An error bubble is not a translation, and it drops the mirror's rule for
     the same reason the mirror exists: the near edge belongs to the eye's way
     back, and when the bubble is an apology with one way out, the way out is
     what should lie on it. The order moves only the row of actions - a recall
     bubble whose save failed keeps its second layer where the mirror put it,
     borders and all. */
  .bubble[data-tone="error"][data-grow="up"] .reveal { order: -1; }
  .bubble[data-tone="error"][data-grow="up"] .actions { padding: 8px 0 2px; }

  /* The signature, on the two bubbles that have to say who is talking. A
     translation needs none - the answer is the point, and a header would cost
     the line D23 saved - but an error may be the first thing this extension
     ever shows somebody, and an unsigned complaint floating over a page reads
     as the page's own.

     The launcher (D126) has the same problem in a different tense: one
     unlabelled offer standing over somebody else's page, and on Android it is
     the default mode, so it is the first thing the extension does at all. The
     word is the answer to both halves of the question - who is asking, and
     where the press leads: it is the same word the reader page's own header
     says, so the offer and its destination sign the same name. */
  .brand {
    display: none;
    font-size: calc(11px * var(--bubble-scale, 1));
    font-weight: 600;
    letter-spacing: 0.03em;
    opacity: 0.6;
    margin-bottom: 4px;
  }
  .bubble[data-tone="error"] .brand,
  .bubble[data-variant="launcher"] .brand { display: block; }
  /* A signature signs at the top, also when the mirror reverses the column. */
  .bubble[data-tone="error"][data-grow="up"] .brand,
  .bubble[data-variant="launcher"][data-grow="up"] .brand { order: 1; }

  /* An action is a label and not a control. What makes one findable is standing
     where the reader is already looking; a box around it would make it the
     loudest thing in a bubble whose whole job is one line of translation. */
  .actions button {
    font: inherit;
    font-size: calc(var(--type-action) * var(--bubble-scale, 1));
    margin: 0;
    padding: var(--pad-action);
    color: inherit;
    background: none;
    border: 0;
    border-radius: 4px;
    opacity: 0.7;
    cursor: pointer;
  }
  /* A label carries padding so that a focus ring has somewhere to go, and the
     first one gives it back: the row has to start on the same vertical line as
     the gloss above it. Save, the launcher and Settings bring their own box
     and need no pulling. */
  .actions button:first-child:not([data-action="save"]):not([data-action="reader"]):not([data-action="settings"]) { margin-left: var(--pull-action); }
  .actions button:hover:not(:disabled) { opacity: 1; }
  .actions button:focus-visible {
    opacity: 1;
    outline: 1px solid currentColor;
    outline-offset: 0;
  }
  .actions button:disabled { opacity: 0.35; cursor: default; }

  /* The clipboard row (D110): an extra row the copy icon opens, so Save never
     leaves the screen for it. It reads like the action row - quiet labels,
     one starting line with the gloss - and lives outside the fold: the icon
     that opens it is inside the fold already, so a visible row implies an
     unfolded bubble. Put away by the hidden attribute, whose rule above
     outranks this display. */
  .copy-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--gap-actions);
    padding: 2px 0;
  }
  .copy-row button {
    font: inherit;
    font-size: calc(var(--type-action) * var(--bubble-scale, 1));
    margin: 0;
    padding: var(--pad-action);
    color: inherit;
    background: none;
    border: 0;
    border-radius: 4px;
    opacity: 0.7;
    cursor: pointer;
  }
  .copy-row button:first-child { margin-left: var(--pull-action); }
  .copy-row button:hover { opacity: 1; }
  .copy-row button:focus-visible {
    opacity: 1;
    outline: 1px solid currentColor;
    outline-offset: 0;
  }

  /* The speaker is the row's one picture (D83): universally readable where a
     "Read aloud" label would push the row past one line on a phone, and an
     honest signal that it acts on the phrase itself, not on the vocabulary.
     Inline-flex centers the icon in the same box the text labels get, and the
     icon matches their cap height, so the row keeps one baseline rhythm. */
  .actions button[data-action="speak"],
  .actions button[data-action="copy"] {
    display: inline-flex;
    align-items: center;
  }
  .actions button[data-action="speak"] svg,
  .actions button[data-action="copy"] svg {
    width: var(--icon);
    height: var(--icon);
    display: block;
  }

  /* The exception, and the only real call to action a bubble has: Save is the
     press that keeps a phrase which would otherwise be gone, the launcher's
     offer is what its bubble is for, and Settings is the one thing an error
     bubble can offer - none of the three ever shares a screen with another, so
     none outshouts the rest. The launcher's second door (D129) deliberately
     stays a plain label beside the framed one: it is the way to another room,
     not another answer to "what do I do with this page", and two frames side
     by side would make a menu out of an offer. */
  .actions button[data-action="save"],
  .actions button[data-action="reader"],
  .actions button[data-action="settings"] {
    font-size: calc(var(--type-cta) * var(--bubble-scale, 1));
    padding: var(--pad-cta);
    opacity: 1;
    /* What makes these three look pressable is the box, and the box has to be
       there on paper too: the tint inside it is the first thing an e-ink panel
       rounds away, and a Save that has lost its frame is one more label in a
       row of labels. */
    background: rgba(0, 0, 0, 0.05);
    border: 1px solid var(--edge);
    border-radius: 6px;
  }
  .actions button[data-action="save"]:hover:not(:disabled),
  .actions button[data-action="reader"]:hover:not(:disabled),
  .actions button[data-action="settings"]:hover:not(:disabled) { background: rgba(0, 0, 0, 0.1); }
  .actions button[data-action="save"]:disabled { opacity: 0.45; }

  /* A hand is not a cursor: where the primary pointer is a finger, the type
     steps up toward the page's own reading size and the presses grow into
     targets. Sizing only - the reveal mechanic deliberately has no touch
     branch (D44), and a hybrid using its mouse loses nothing to bigger type. */
  @media (pointer: coarse) {
    .bubble {${TOUCH_SIZES}}
  }

  /* The same tier by the gesture's own word (D84): the pointer that made the
     selection is the pointer about to press these buttons, and the media
     query can answer for the wrong device - a Boox e-ink tablet reports a
     fine primary pointer over its touch screen, and got desktop type on a
     7-inch slate. Only ever forced up, never down: a mouse selection on a
     device whose media query says coarse keeps the bigger type, for the
     hybrid's reason above. */
  .bubble[data-pointer="coarse"] {${TOUCH_SIZES}}

  @media (prefers-color-scheme: dark) {
    .bubble {
      /* A step lighter than the dark themes it floats over, because the
         shadow that separates the planes on glass does not exist on black
         and quantizes away on e-ink - the background difference and the
         border have to do it alone (reported from a phone: the bubble sank
         into the reader's dark theme). */
      background: #262c3a;
      color: #f2f4f8;
      /* The one strength against this paper instead of white, and a step
         lighter than page.css uses for the same job, because this paper is a
         step lighter than the pages' - 4.6:1 either way. Every line in the
         bubble reads it, so the dark theme is this one colour plus the washes
         that only glass can show. */
      --edge: #8d95a6;
      border-color: var(--edge);
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
    }
    .body[data-tone="error"],
    .context[data-tone="error"] { color: #f09a3e; }
    .bubble:not([data-pointer="coarse"]) .entry-sense[aria-pressed="false"]:hover:not(:disabled) { background: rgba(255, 255, 255, 0.08); }
    .entry-sense[aria-pressed="true"] { background: rgba(255, 255, 255, 0.1); }
    .editor { background: rgba(255, 255, 255, 0.06); }
    /* The quiet labels need nothing here: they are the bubble's own colour at
       seven tenths, which lands right on either background. */
    .actions button[data-action="save"],
    .actions button[data-action="reader"],
    .actions button[data-action="settings"] { background: rgba(255, 255, 255, 0.08); }
    .actions button[data-action="save"]:hover:not(:disabled),
    .actions button[data-action="reader"]:hover:not(:disabled),
    .actions button[data-action="settings"]:hover:not(:disabled) { background: rgba(255, 255, 255, 0.16); }
  }
`;
  function style(root2) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(STYLE);
      root2.adoptedStyleSheets = [sheet];
      if (root2.adoptedStyleSheets.length === 1) return;
    } catch {
    }
    const element = document.createElement("style");
    element.textContent = STYLE;
    root2.append(element);
  }
  function placement({ anchor, size, viewport, folded = 0, touch = false, line = 0, assist = false, covered = 0 }) {
    const height = size.height + folded;
    const maxLeft = Math.max(VIEWPORT_MARGIN, viewport.width - size.width - VIEWPORT_MARGIN);
    const left = Math.round(Math.min(Math.max(VIEWPORT_MARGIN, anchor.left), maxLeft));
    const gap = touch ? SYSTEM_GAP : GAP;
    const ceiling = covered + VIEWPORT_MARGIN;
    if (anchor.top - gap - height >= ceiling) {
      return { left, top: Math.round(anchor.top - gap), grow: "up" };
    }
    const below = anchor.bottom + gap;
    const room = viewport.height - VIEWPORT_MARGIN - height;
    if (!assist || below >= ceiling && below <= room) {
      return { left, top: Math.round(Math.max(ceiling, Math.min(below, room))), grow: "down" };
    }
    const whole = anchor.bottom - anchor.top;
    const kept = height + gap + whole <= viewport.height - VIEWPORT_MARGIN - ceiling || line <= 0 ? whole : Math.min(line, whole);
    const top = anchor.top + kept + gap;
    const need = top + height - (viewport.height - VIEWPORT_MARGIN);
    const cap = anchor.top - ceiling;
    return { left, top: Math.round(top), grow: "down", scroll: Math.round(Math.min(Math.max(0, need), cap)) };
  }
  function revealShift({ must, view }) {
    const floor = view.top + VIEWPORT_MARGIN - must.top;
    const ceil = view.bottom - VIEWPORT_MARGIN - must.bottom;
    if (floor > ceil) return Math.round(floor);
    return Math.round(Math.min(Math.max(0, floor), ceil));
  }
  function settleBack({ shown, now, carried }) {
    if (carried === 0) return 0;
    const drift = now - shown;
    return Math.abs(drift - carried) <= 2 ? -drift : 0;
  }
  function createTooltip({ onAction: onAction3, onHide, covered }) {
    const coveredAbove2 = covered ?? (() => 0);
    let host = null;
    let bubble = null;
    let bodyElement = null;
    let contextElement = null;
    let contextTextElement = null;
    let contextToggle = null;
    let entriesElement = null;
    let editor = null;
    let actionsElement = null;
    let copyRowElement = null;
    let anchor = new DOMRect();
    let anchorLine = 0;
    let onTouch = false;
    let page = null;
    let placedOffset = { top: 0, left: 0 };
    let carried = 0;
    let editing = false;
    let unfolded = false;
    let contextFolded = false;
    let swallowClick = false;
    let restingActions = [];
    let phraseText = "";
    let copied = null;
    function shownGloss() {
      if (editing && editor !== null) return editor.value;
      return bodyElement?.textContent ?? "";
    }
    function currentMeanings() {
      return toMeanings(shownGloss());
    }
    function build() {
      if (host !== null) return;
      host = document.createElement("div");
      host.style.setProperty("all", "initial", "important");
      host.style.setProperty("position", "fixed", "important");
      host.style.setProperty("z-index", "2147483647", "important");
      host.style.setProperty("top", "0px", "important");
      host.style.setProperty("left", "0px", "important");
      host.style.setProperty("width", "100%", "important");
      host.style.setProperty("height", "0px", "important");
      const root2 = host.attachShadow({ mode: "closed" });
      style(root2);
      bubble = document.createElement("div");
      bubble.className = "bubble";
      const brandElement = document.createElement("div");
      brandElement.className = "brand";
      brandElement.textContent = "re/read";
      bodyElement = document.createElement("div");
      bodyElement.className = "body";
      contextElement = document.createElement("div");
      contextElement.className = "context";
      contextElement.hidden = true;
      contextTextElement = document.createElement("div");
      contextTextElement.className = "context-text";
      contextToggle = document.createElement("button");
      contextToggle.type = "button";
      contextToggle.className = "context-toggle";
      contextToggle.hidden = true;
      contextToggle.append(chevronIcon());
      contextToggle.addEventListener("click", toggleContextFold);
      contextElement.append(contextTextElement, contextToggle);
      entriesElement = document.createElement("div");
      entriesElement.className = "entries";
      entriesElement.hidden = true;
      editor = document.createElement("textarea");
      editor.className = "editor";
      editor.hidden = true;
      editor.rows = 1;
      const revealElement = document.createElement("div");
      revealElement.className = "reveal";
      actionsElement = document.createElement("div");
      actionsElement.className = "actions";
      revealElement.append(actionsElement);
      copyRowElement = document.createElement("div");
      copyRowElement.className = "copy-row";
      copyRowElement.hidden = true;
      for (
        const choice of
        /** @type {CopyChoice[]} */
        ["copy-original", "copy-translation"]
      ) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset["action"] = choice;
        button.textContent = label(choice);
        button.addEventListener("click", () => copyOut(button, choice));
        copyRowElement.append(button);
      }
      for (const element of [actionsElement, copyRowElement, entriesElement, contextElement]) {
        element.addEventListener("mousedown", (event) => event.preventDefault());
      }
      editor.addEventListener("input", onEditorInput);
      editor.addEventListener("keydown", onEditorKeyDown);
      for (const type of ["keyup", "keypress"]) {
        editor.addEventListener(type, (event) => event.stopPropagation());
      }
      bubble.addEventListener("mouseenter", reveal);
      bubble.addEventListener("focusin", reveal);
      bubble.addEventListener("pointerdown", onPointerDown3);
      bubble.addEventListener("click", onClick, { capture: true });
      bubble.append(brandElement, bodyElement, editor, revealElement, copyRowElement, contextElement, entriesElement);
      root2.append(bubble);
      document.documentElement.append(host);
    }
    function reveal() {
      bubble?.classList.add("revealed");
    }
    function folded() {
      if (actionsElement === null) return false;
      return actionsElement.clientHeight === 0 && actionsElement.scrollHeight > 0;
    }
    function onPointerDown3() {
      swallowClick = folded();
      reveal();
    }
    function onClick(event) {
      if (!swallowClick) return;
      swallowClick = false;
      event.stopPropagation();
    }
    function onEditorKeyDown(event) {
      event.stopPropagation();
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        emit("save");
      }
    }
    function refreshControls() {
      const shown = new Set(currentMeanings());
      if (actionsElement !== null) {
        for (const button of actionsElement.querySelectorAll("button")) {
          if (button.dataset["action"] === "save") button.disabled = shown.size === 0;
        }
      }
      if (entriesElement !== null) {
        for (const sense of entriesElement.querySelectorAll("button")) {
          sense.disabled = editing;
          sense.setAttribute("aria-pressed", shown.has(sense.textContent ?? "") ? "true" : "false");
        }
      }
    }
    function settleCopy() {
      if (copied === null) return;
      window.clearTimeout(copied.timer);
      copied.button.textContent = label(copied.choice);
      copied.button.style.minWidth = "";
      copied = null;
    }
    function syncCopyIcon() {
      if (actionsElement === null || copyRowElement === null) return;
      const icon = actionsElement.querySelector('button[data-action="copy"]');
      icon?.setAttribute("aria-expanded", copyRowElement.hidden ? "false" : "true");
    }
    function hideCopyRow() {
      settleCopy();
      if (copyRowElement === null || copyRowElement.hidden) return;
      copyRowElement.hidden = true;
      syncCopyIcon();
      place();
    }
    function toggleCopyRow() {
      if (copyRowElement === null) return;
      if (!copyRowElement.hidden) {
        hideCopyRow();
        return;
      }
      const translationButton = copyRowElement.querySelector('button[data-action="copy-translation"]');
      if (translationButton instanceof HTMLElement) translationButton.hidden = shownGloss().length === 0;
      copyRowElement.hidden = false;
      syncCopyIcon();
      place();
    }
    async function copyOut(button, choice) {
      const text = choice === "copy-original" ? phraseText : shownGloss();
      if (text.length === 0) return;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        return;
      }
      settleCopy();
      if (button.isConnected === false) return;
      button.style.minWidth = `${button.getBoundingClientRect().width}px`;
      button.textContent = t("bubble_copied");
      copied = { timer: window.setTimeout(settleCopy, 1500), button, choice };
    }
    function emit(action) {
      if (action === "cancel") {
        stopEditing(false);
        return;
      }
      if (action === "copy") {
        toggleCopyRow();
        return;
      }
      if (action !== "speak") hideCopyRow();
      if (action === "edit") {
        startEditing();
        return;
      }
      if (action === "more") {
        const opening = !unfolded;
        unfold(opening);
        if (opening) onAction3("more", currentMeanings());
        return;
      }
      const meanings = currentMeanings();
      if (action === "save" || action === "choose") {
        if (meanings.length === 0) return;
        stopEditing(true);
      }
      onAction3(action, meanings);
    }
    function choose(sense) {
      if (bodyElement === null) return;
      const next = afterChoosing(bodyElement.textContent ?? "", sense);
      if (next.length === 0) return;
      setBody(next);
      place();
      emit("choose");
    }
    function applyContextFold() {
      if (contextElement === null || contextToggle === null) return;
      const clamped = contextFolded && (contextElement.dataset["tone"] ?? "normal") === "normal";
      contextElement.dataset["folded"] = clamped ? "true" : "false";
      contextToggle.setAttribute("aria-expanded", clamped ? "false" : "true");
      const name2 = foldLabel(clamped);
      contextToggle.setAttribute("aria-label", name2);
      contextToggle.title = name2;
    }
    function toggleContextFold() {
      contextFolded = !contextFolded;
      applyContextFold();
      unfold(unfolded);
    }
    function sentenceOverflows() {
      if (contextElement === null || contextTextElement === null) return false;
      if (contextElement.dataset["folded"] === "true") {
        return contextTextElement.scrollWidth > contextTextElement.clientWidth + 1;
      }
      const lines = document.createRange();
      lines.selectNodeContents(contextTextElement);
      return lines.getClientRects().length > 1;
    }
    function unfold(open) {
      if (contextElement === null || entriesElement === null) return;
      unfolded = open;
      const entriesThere = entriesElement.childElementCount > 0;
      contextElement.hidden = !unfolded || (contextTextElement?.textContent ?? "").length === 0;
      entriesElement.hidden = !unfolded || !entriesThere;
      if (contextToggle !== null) {
        contextToggle.hidden = foldControl({ entries: entriesThere, overflows: false }) === "absent";
      }
      renderActions(editing ? ["save", "cancel"] : restingActions);
      place();
      entriesElement.dataset["more"] = !entriesElement.hidden && entriesElement.scrollHeight > entriesElement.clientHeight + 1 ? "true" : "false";
      if (contextToggle !== null && !contextToggle.hidden) {
        contextToggle.style.visibility = foldControl({ entries: entriesThere, overflows: sentenceOverflows() }) === "shown" ? "" : "hidden";
      }
    }
    function setContext(sentence, tone = "normal") {
      if (contextElement === null || contextTextElement === null) return;
      contextTextElement.textContent = sentence ?? "";
      contextElement.dataset["tone"] = tone;
      applyContextFold();
      unfold(unfolded);
    }
    function setEntries(blocks) {
      if (entriesElement === null) return;
      entriesElement.replaceChildren();
      for (const block of blocks) {
        const entry = document.createElement("div");
        entry.className = "entry";
        if (block.label.length > 0) {
          const label2 = document.createElement("div");
          label2.className = "entry-label";
          label2.textContent = block.label;
          entry.append(label2);
        }
        const plain = bubble?.dataset["variant"] === "quiet";
        for (const line of block.lines) {
          if (plain) {
            const sense2 = document.createElement("div");
            sense2.className = "entry-sense";
            sense2.textContent = line;
            entry.append(sense2);
            continue;
          }
          const sense = document.createElement("button");
          sense.type = "button";
          sense.className = "entry-sense";
          sense.setAttribute("aria-pressed", "false");
          sense.textContent = line;
          sense.addEventListener("click", () => choose(line));
          entry.append(sense);
        }
        entriesElement.append(entry);
      }
      unfold(unfolded);
      refreshControls();
    }
    function sizeEditor() {
      if (editor === null) return;
      editor.rows = 1;
      const style2 = window.getComputedStyle(editor);
      const padding = parseFloat(style2.paddingTop) + parseFloat(style2.paddingBottom);
      const line = parseFloat(style2.lineHeight);
      if (!Number.isFinite(line) || line <= 0) return;
      const lines = Math.round((editor.scrollHeight - padding) / line);
      editor.rows = Math.min(7, Math.max(1, lines) + 1);
    }
    function onEditorInput() {
      refreshControls();
      if (editor === null) return;
      const rows = editor.rows;
      sizeEditor();
      if (editor.rows !== rows) place();
    }
    function watchKeyboard(on) {
      const vv = window.visualViewport;
      if (on) {
        vv?.addEventListener("resize", keepEditorVisible);
        vv?.addEventListener("scroll", keepEditorVisible);
        window.addEventListener("resize", keepEditorVisible);
      } else {
        vv?.removeEventListener("resize", keepEditorVisible);
        vv?.removeEventListener("scroll", keepEditorVisible);
        window.removeEventListener("resize", keepEditorVisible);
      }
    }
    function visibleBox() {
      const vv = window.visualViewport;
      const seen = vv === null ? { top: 0, bottom: document.documentElement.clientHeight } : { top: vv.offsetTop, bottom: vv.offsetTop + vv.height };
      return { top: Math.max(seen.top, coveredAbove2()), bottom: seen.bottom };
    }
    function keepEditorVisible() {
      if (!editing || host === null || bubble === null || editor === null) return;
      const view = visibleBox();
      const box = editor.getBoundingClientRect();
      let must = { top: box.top, bottom: box.bottom };
      const row = actionsElement?.getBoundingClientRect();
      if (row !== void 0 && row.height > 0) {
        must = { top: Math.min(must.top, row.top), bottom: Math.max(must.bottom, row.bottom) };
      }
      const whole = bubble.getBoundingClientRect();
      if (whole.height <= view.bottom - view.top - 2 * VIEWPORT_MARGIN) {
        must = { top: whole.top, bottom: whole.bottom };
      }
      const shift = revealShift({ must, view });
      if (shift === 0) return;
      if (page !== null) {
        const before = window.scrollY;
        window.scrollBy(0, -shift);
        carried += window.scrollY - before;
        return;
      }
      const top = parseFloat(host.style.top);
      if (!Number.isFinite(top)) return;
      host.style.setProperty("top", `${top + shift}px`, "important");
      placedOffset = { top: placedOffset.top + shift, left: placedOffset.left };
    }
    function startEditing() {
      if (editor === null || bodyElement === null) return;
      unfold(false);
      editing = true;
      editor.value = toMeanings(bodyElement.textContent ?? "").join(MEANING_SEPARATOR);
      editor.hidden = false;
      bodyElement.hidden = true;
      sizeEditor();
      renderActions(["save", "cancel"]);
      place();
      watchKeyboard(true);
      editor.focus({ preventScroll: true });
      editor.select();
      keepEditorVisible();
    }
    function stopEditing(keep2) {
      if (!editing || editor === null || bodyElement === null) return;
      if (keep2) setBody(toMeanings(editor.value).join(MEANING_SEPARATOR));
      editing = false;
      watchKeyboard(false);
      editor.hidden = true;
      bodyElement.hidden = false;
      renderActions(restingActions);
      place();
    }
    function renderActions(actions) {
      if (actionsElement === null) return;
      actionsElement.replaceChildren();
      for (const action of actions) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset["action"] = action;
        if (action === "speak" || action === "copy") {
          const name2 = label(action);
          button.setAttribute("aria-label", name2);
          button.title = name2;
          button.append(action === "speak" ? speakerIcon() : copyIcon());
          if (action === "copy") {
            button.setAttribute("aria-expanded", copyRowElement !== null && !copyRowElement.hidden ? "true" : "false");
          }
        } else {
          button.textContent = action === "more" && unfolded ? lessLabel() : label(action);
        }
        button.addEventListener("click", () => emit(action));
        actionsElement.append(button);
      }
      refreshControls();
    }
    function foldedHeight() {
      if (actionsElement === null || !folded()) return 0;
      return actionsElement.scrollHeight;
    }
    function place() {
      if (host === null || bubble === null) return;
      host.style.setProperty("visibility", "hidden", "important");
      host.style.setProperty("top", "0px", "important");
      bubble.style.left = "0px";
      if (entriesElement !== null) entriesElement.style.maxHeight = "";
      const viewport = {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight
      };
      const scrolled = page === null ? { x: 0, y: 0 } : { x: window.scrollX, y: window.scrollY };
      const drift = page === null ? { x: 0, y: 0 } : { x: page.x - scrolled.x, y: page.y - scrolled.y };
      const spotAnchor = { top: anchor.top + drift.y, bottom: anchor.bottom + drift.y, left: anchor.left + drift.x };
      const assist = page !== null;
      const kept = anchorLine > 0 ? Math.min(anchorLine, spotAnchor.bottom - spotAnchor.top) : spotAnchor.bottom - spotAnchor.top;
      const covered2 = Math.max(0, coveredAbove2());
      let size = bubble.getBoundingClientRect();
      const folded2 = foldedHeight();
      if (entriesElement !== null && !entriesElement.hidden) {
        const entriesHeight = entriesElement.clientHeight;
        if (entriesHeight > MIN_ENTRIES_HEIGHT) {
          const gap = onTouch ? SYSTEM_GAP : GAP;
          let room = Math.max(
            spotAnchor.top - gap - VIEWPORT_MARGIN - covered2,
            viewport.height - VIEWPORT_MARGIN - (spotAnchor.bottom + gap)
          );
          if (assist) room = Math.max(room, viewport.height - covered2 - 2 * VIEWPORT_MARGIN - gap - kept);
          const overflow = Math.ceil(size.height + folded2 - room);
          if (overflow > 0) {
            entriesElement.style.maxHeight = `${Math.max(MIN_ENTRIES_HEIGHT, entriesHeight - overflow)}px`;
            size = bubble.getBoundingClientRect();
          }
        }
      }
      const spot = placement({ anchor: spotAnchor, size, viewport, folded: folded2, touch: onTouch, line: anchorLine, assist, covered: covered2 });
      placedOffset = { top: spot.top - spotAnchor.top, left: spot.left - spotAnchor.left };
      bubble.style.left = `${spot.left + scrolled.x}px`;
      bubble.dataset["grow"] = spot.grow;
      host.style.setProperty("top", `${spot.top + scrolled.y}px`, "important");
      host.style.setProperty("visibility", "visible", "important");
      const ride = spot.scroll ?? 0;
      if (ride !== 0) {
        const before = window.scrollY;
        window.scrollBy(0, ride);
        carried += window.scrollY - before;
      }
      if (editing) keepEditorVisible();
    }
    function setBody(body, tone = "normal") {
      if (bodyElement === null) return;
      bodyElement.textContent = body;
      bodyElement.dataset["tone"] = tone;
      if (bubble !== null) bubble.dataset["tone"] = tone;
      refreshControls();
    }
    function hideBubble() {
      if (host === null) return;
      watchKeyboard(false);
      settleCopy();
      if (page !== null) {
        const back = settleBack({ shown: page.y, now: window.scrollY, carried });
        if (back !== 0) window.scrollBy(0, back);
      }
      carried = 0;
      host.remove();
      host = null;
      bubble = null;
      bodyElement = null;
      contextElement = null;
      contextTextElement = null;
      contextToggle = null;
      entriesElement = null;
      editor = null;
      actionsElement = null;
      copyRowElement = null;
      editing = false;
      unfolded = false;
      contextFolded = false;
      swallowClick = false;
      restingActions = [];
      phraseText = "";
      page = null;
      onHide?.();
    }
    return {
      show({
        anchor: rect,
        variant,
        body,
        tone = "normal",
        actions = [],
        touch = false,
        coarse = false,
        scale: scale2 = 1,
        folded: folded2,
        anchored: anchored2 = false,
        line = 0,
        phrase = ""
      }) {
        build();
        anchor = rect;
        anchorLine = line;
        onTouch = touch;
        page = anchored2 ? { x: window.scrollX, y: window.scrollY } : null;
        carried = 0;
        editing = false;
        phraseText = phrase;
        settleCopy();
        if (copyRowElement !== null) copyRowElement.hidden = true;
        if (host !== null) {
          host.style.setProperty("position", page === null ? "fixed" : "absolute", "important");
        }
        if (bubble !== null) {
          bubble.dataset["variant"] = variant;
          if (coarse) bubble.dataset["pointer"] = "coarse";
          else delete bubble.dataset["pointer"];
          if (Number.isFinite(scale2) && scale2 > 0 && scale2 !== 1) {
            bubble.style.setProperty("--bubble-scale", String(scale2));
          } else {
            bubble.style.removeProperty("--bubble-scale");
          }
          bubble.classList.toggle("revealed", folded2 !== true);
          swallowClick = false;
        }
        unfolded = variant === "quiet";
        contextFolded = false;
        if (contextElement !== null && contextTextElement !== null && contextToggle !== null) {
          contextTextElement.textContent = "";
          contextElement.hidden = true;
          contextToggle.hidden = true;
          contextToggle.style.visibility = "";
          applyContextFold();
        }
        if (entriesElement !== null) {
          entriesElement.replaceChildren();
          entriesElement.hidden = true;
        }
        if (editor !== null) editor.hidden = true;
        if (bodyElement !== null) bodyElement.hidden = false;
        setBody(body, tone);
        restingActions = actions;
        renderActions(actions);
        place();
      },
      setBody(body, tone = "normal") {
        setBody(body, tone);
        place();
      },
      setContext(sentence, tone = "normal") {
        setContext(sentence, tone);
        place();
      },
      setEntries(blocks) {
        setEntries(blocks);
        place();
      },
      setActions(actions) {
        restingActions = actions;
        settleCopy();
        if (copyRowElement !== null) copyRowElement.hidden = true;
        if (!editing) renderActions(actions);
        place();
      },
      follow(rect) {
        if (host === null || bubble === null) return;
        anchor = rect;
        bubble.style.left = `${Math.round(rect.left + placedOffset.left)}px`;
        host.style.setProperty("top", `${Math.round(rect.top + placedOffset.top)}px`, "important");
        if (editing) keepEditorVisible();
      },
      reveal,
      hide: hideBubble,
      isOpen() {
        return host !== null;
      },
      isEditing() {
        return editing;
      },
      escape() {
        if (editing) stopEditing(false);
        else if (copyRowElement !== null && !copyRowElement.hidden) hideCopyRow();
        else hideBubble();
      },
      owns(target) {
        return host !== null && target === host;
      }
    };
  }

  // src/content/launcher.js
  var SETTLE_MS = 300;
  var tooltip = createTooltip({ onAction });
  var timer = null;
  var started = false;
  var lastPointerType = "";
  var shownText = "";
  var scale = 1;
  var modelHint = false;
  function setLauncherScale(factor) {
    scale = factor;
  }
  function setLauncherHint(needed) {
    modelHint = needed;
  }
  function onAction(action) {
    const kind = action === "reader" ? Message.OPEN_READER : action === "library" ? Message.OPEN_LIBRARY : action === "settings" ? Message.OPEN_SETTINGS : null;
    if (kind === null) return;
    try {
      void webext().runtime.sendMessage({ kind }).catch(() => {
      });
    } catch {
    }
    tooltip.hide();
  }
  function settle() {
    timer = null;
    const selection = window.getSelection();
    if (selection === null || selection.isCollapsed || selection.rangeCount === 0) {
      tooltip.hide();
      return;
    }
    const text = selection.toString().trim();
    if (text.length === 0) {
      tooltip.hide();
      return;
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      tooltip.hide();
      return;
    }
    shownText = text;
    tooltip.show({
      anchor: rect,
      variant: "launcher",
      // With no model to translate with, the offer says so here rather than at
      // the end of the road in the reader's bubble - the same sentence, the
      // same tone and the same way out (the settings door) that bubble uses,
      // so the first selection after a fresh install meets the answer once.
      body: modelHint ? t("error_model_missing") : "",
      tone: modelHint ? "error" : "normal",
      // With the hint on, the sentence above points at the settings - so the
      // settings door stands directly under it, the reading-bubble error's own
      // order, then the reader offer, and the quiet library label closes the
      // column. The first cut had the quiet label between two framed buttons,
      // which read as three unrelated things (Michał's report, 0.5.12 on
      // Android); the order is his too.
      actions: modelHint ? ["settings", "reader", "library"] : ["reader", "library"],
      // A pen's selection wears the same system bar and handles (D80).
      touch: touchPointer(lastPointerType),
      // The same pointer also sizes the row for the finger about to press it
      // (D84) - the media query alone answers wrong on some devices.
      coarse: touchPointer(lastPointerType),
      scale
    });
  }
  function onSelectionChange() {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(settle, SETTLE_MS);
    if (!tooltip.isOpen()) return;
    const selection = window.getSelection();
    if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return;
    if (selection.toString().trim() === shownText) return;
    tooltip.hide();
  }
  function onPointerDown(event) {
    lastPointerType = event.pointerType;
  }
  function onScroll(event) {
    if (!tooltip.owns(event.target)) tooltip.hide();
  }
  function startLauncher() {
    if (started) return;
    started = true;
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    if (navigator.maxTouchPoints > 0) {
      document.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
    }
  }
  function stopLauncher() {
    if (!started) return;
    started = false;
    document.removeEventListener("selectionchange", onSelectionChange);
    document.removeEventListener("scroll", onScroll, { capture: true });
    document.removeEventListener("pointerdown", onPointerDown, { capture: true });
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    lastPointerType = "";
    shownText = "";
    tooltip.hide();
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

  // src/lib/sentence.js
  var HARD_STOP = "\n";
  var STOPS = /* @__PURE__ */ new Set([".", "!", "?", "\u2026"]);
  var CLOSERS = new RegExp(`[\\p{Pf}\\p{Pe}"']`, "u");
  var FOOTNOTE = new RegExp("\\[\\d+\\]", "yu");
  var LONGEST_ENDING = 8;
  var ABBREVIATIONS = /* @__PURE__ */ new Set([
    "mr",
    "mrs",
    "ms",
    "dr",
    "prof",
    "st",
    "sr",
    "jr",
    "vs",
    "etc",
    "fig",
    "no",
    "vol",
    "ok"
  ]);
  var MAX_SENTENCE_LENGTH = 600;
  function wordBefore(text, index2) {
    let start2 = index2 + 1;
    while (start2 > 0 && new RegExp("\\p{L}", "u").test(text[start2 - 1] ?? "")) start2 -= 1;
    return text.slice(start2, index2 + 1).toLowerCase();
  }
  function endOfEnding(text, stop3) {
    let at = stop3 + 1;
    for (; ; ) {
      const character = text[at];
      if (character === void 0) break;
      if (STOPS.has(character) || CLOSERS.test(character)) {
        at += 1;
        continue;
      }
      FOOTNOTE.lastIndex = at;
      if (FOOTNOTE.test(text)) {
        at = FOOTNOTE.lastIndex;
        continue;
      }
      break;
    }
    return at - 1;
  }
  function stopOf(text, index2) {
    for (let at = index2; at >= 0 && index2 - at <= LONGEST_ENDING; at -= 1) {
      if (STOPS.has(text[at] ?? "") && endOfEnding(text, at) === index2) return at;
    }
    return null;
  }
  function endsSentence(text, index2) {
    const character = text[index2];
    if (character === void 0) return false;
    if (character === HARD_STOP) return true;
    if (!STOPS.has(character) && !CLOSERS.test(character)) return false;
    const stop3 = stopOf(text, index2);
    if (stop3 === null) return false;
    const next = text[index2 + 1];
    if (next !== void 0 && !/\s/u.test(next)) return false;
    if (text[stop3] === ".") {
      const word = wordBefore(text, stop3 - 1);
      if (word.length === 1) return false;
      if (ABBREVIATIONS.has(word)) return false;
    }
    const following = text.slice(index2 + 1).match(/\S/u)?.[0];
    if (following === void 0) return true;
    return !/[\p{Ll}\p{N}]/u.test(following);
  }
  function sentenceAround(text, start2, end) {
    if (!Number.isInteger(start2) || !Number.isInteger(end)) return null;
    if (start2 < 0 || end > text.length || start2 >= end) return null;
    let from = 0;
    for (let index2 = start2 - 1; index2 >= 0; index2 -= 1) {
      if (endsSentence(text, index2)) {
        from = index2 + 1;
        break;
      }
    }
    let to = text.length;
    for (let index2 = Math.max(start2, end - 1); index2 < text.length; index2 += 1) {
      if (endsSentence(text, index2)) {
        to = index2 + 1;
        break;
      }
    }
    const sentence = text.slice(from, to).trim();
    if (sentence.length === 0 || sentence.length > MAX_SENTENCE_LENGTH) return null;
    if (trimPhrase(sentence) === trimPhrase(text.slice(start2, end))) return null;
    return sentence;
  }

  // src/lib/tts.js
  function canSpeak() {
    return typeof globalThis.speechSynthesis !== "undefined";
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

  // src/lib/matcher/index.js
  function buildIndex(keys) {
    const index2 = /* @__PURE__ */ new Map();
    for (const normalized of keys) {
      const tokens = keyTokens(normalized);
      const first = tokens[0];
      if (first === void 0) continue;
      const candidates = index2.get(first);
      if (candidates === void 0) index2.set(first, [{ tokens, normalized }]);
      else candidates.push({ tokens, normalized });
    }
    for (const candidates of index2.values()) {
      candidates.sort((a, b) => b.tokens.length - a.tokens.length);
    }
    return index2;
  }
  function matchesAt(tokens, at, wanted) {
    if (at + wanted.length > tokens.length) return false;
    for (let offset = 1; offset < wanted.length; offset += 1) {
      if (tokens[at + offset]?.text !== wanted[offset]) return false;
    }
    return true;
  }
  function findMatches(text, index2) {
    const tokens = tokenize(text);
    const matches = [];
    for (let at = 0; at < tokens.length; ) {
      const token = tokens[at];
      if (token === void 0) break;
      const candidate = index2.get(token.text)?.find((one) => matchesAt(tokens, at, one.tokens));
      if (candidate === void 0) {
        at += 1;
        continue;
      }
      const last = tokens[at + candidate.tokens.length - 1];
      if (last !== void 0) {
        matches.push({ start: token.start, end: last.end, normalized: candidate.normalized });
      }
      at += candidate.tokens.length;
    }
    return matches;
  }

  // src/lib/matcher/spans.js
  function joinPieces(pieces) {
    const spans = [];
    let at = 0;
    for (const piece of pieces) {
      spans.push({ start: at, end: at + piece.length });
      at += piece.length;
    }
    return { text: pieces.join(""), spans };
  }
  function locate(spans, index2) {
    let low = 0;
    let high = spans.length - 1;
    while (low <= high) {
      const middle = low + high >> 1;
      const span2 = spans[middle];
      if (span2 === void 0) return null;
      if (index2 < span2.start) high = middle - 1;
      else if (index2 >= span2.end) low = middle + 1;
      else return { piece: middle, offset: index2 - span2.start };
    }
    return null;
  }

  // src/content/scan.js
  var SKIP = /* @__PURE__ */ new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION", "SVG"]);
  var BLOCK = /* @__PURE__ */ new Set([
    "ADDRESS",
    "ARTICLE",
    "ASIDE",
    "BLOCKQUOTE",
    "BODY",
    "BR",
    "CAPTION",
    "DD",
    "DETAILS",
    "DIALOG",
    "DIV",
    "DL",
    "DT",
    "FIELDSET",
    "FIGCAPTION",
    "FIGURE",
    "FOOTER",
    "FORM",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "HEADER",
    "HR",
    "LI",
    "MAIN",
    "NAV",
    "OL",
    "P",
    "PRE",
    "SECTION",
    "SUMMARY",
    "TABLE",
    "TBODY",
    "TD",
    "TFOOT",
    "TH",
    "THEAD",
    "TR",
    "UL"
  ]);
  function blockAround(node) {
    const start2 = node.nodeType === Node.ELEMENT_NODE ? (
      /** @type {Element} */
      node
    ) : node.parentElement;
    for (let element = start2; element !== null; element = element.parentElement) {
      if (BLOCK.has(element.tagName)) return element;
    }
    return document.body;
  }
  function partsOf(block) {
    const parts = [];
    const walk = (node) => {
      for (let child = node.firstChild; child !== null; child = child.nextSibling) {
        if (child.nodeType === Node.TEXT_NODE) {
          const text = (
            /** @type {Text} */
            child
          );
          parts.push({ node: text, text: text.data });
          continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        const element = (
          /** @type {Element} */
          child
        );
        if (SKIP.has(element.tagName)) continue;
        if (element instanceof HTMLElement && element.isContentEditable) continue;
        if (BLOCK.has(element.tagName)) {
          parts.push({ node: null, text: "\n" });
          continue;
        }
        walk(element);
      }
    };
    walk(block);
    return parts;
  }
  function blockPieces(node) {
    const block = blockAround(node);
    if (block === null) return null;
    const parts = partsOf(block);
    const { text, spans } = joinPieces(parts.map((part) => part.text));
    return { block, parts, text, spans };
  }
  function blockTextAround(range2) {
    const pieces = blockPieces(range2.startContainer);
    if (pieces === null) return null;
    const { parts, text, spans } = pieces;
    const offsetOf = (container, offset) => {
      const index2 = parts.findIndex((part) => part.node === container);
      const span2 = spans[index2];
      if (index2 === -1 || span2 === void 0) return null;
      return span2.start + offset;
    };
    const start2 = offsetOf(range2.startContainer, range2.startOffset);
    const end = offsetOf(range2.endContainer, range2.endOffset);
    if (start2 === null || end === null) return null;
    return { text, start: start2, end };
  }
  function matchRun(pieces, index2, into) {
    if (pieces.length === 0) return;
    const { text, spans } = joinPieces(pieces.map((piece) => piece.data));
    for (const match of findMatches(text, index2)) {
      const from = locate(spans, match.start);
      const to = locate(spans, match.end - 1);
      const first = from === null ? void 0 : pieces[from.piece];
      const last = to === null ? void 0 : pieces[to.piece];
      if (from === null || to === null || first === void 0 || last === void 0) continue;
      const range2 = document.createRange();
      range2.setStart(first, from.offset);
      range2.setEnd(last, to.offset + 1);
      into.push({ range: range2, normalized: match.normalized });
    }
  }
  function scan(root2, index2) {
    const found = [];
    let run = [];
    const flush = () => {
      matchRun(run, index2, found);
      run = [];
    };
    const walk = (node) => {
      for (let child = node.firstChild; child !== null; child = child.nextSibling) {
        if (child.nodeType === Node.TEXT_NODE) {
          run.push(
            /** @type {Text} */
            child
          );
          continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        const element = (
          /** @type {Element} */
          child
        );
        if (SKIP.has(element.tagName)) continue;
        if (element instanceof HTMLElement && element.isContentEditable) continue;
        const boundary = BLOCK.has(element.tagName);
        if (boundary) flush();
        walk(element);
        if (boundary) flush();
      }
    };
    if (root2.nodeType === Node.TEXT_NODE) run.push(
      /** @type {Text} */
      root2
    );
    else walk(root2);
    flush();
    return found;
  }
  function findable(range2, normalized) {
    if (normalized.length === 0) return false;
    const block = blockAround(range2.startContainer);
    if (block === null) return false;
    return scan(block, buildIndex([normalized])).length > 0;
  }

  // src/content/highlighter.js
  var name = underlineName(DEFAULT_UNDERLINE);
  var ACTIVE = "reread-active";
  var IDLE_TIMEOUT = 500;
  var RESCAN_EVERYTHING = 40;
  var painted = [];
  var live = null;
  var index = /* @__PURE__ */ new Map();
  var observer = null;
  var scope = null;
  var pending = /* @__PURE__ */ new Set();
  var scheduled = false;
  function registry() {
    if (typeof CSS === "undefined" || !("highlights" in CSS)) return null;
    if (typeof Highlight !== "function") return null;
    return CSS.highlights;
  }
  function supported() {
    return registry() !== null;
  }
  function mark(range2) {
    const api = registry();
    if (api === null) return;
    api.set(ACTIVE, new Highlight(range2.cloneRange()));
  }
  function unmark() {
    registry()?.delete(ACTIVE);
  }
  function clear() {
    observer?.disconnect();
    observer = null;
    pending.clear();
    painted = [];
    live = null;
    scope = null;
    index = /* @__PURE__ */ new Map();
    const api = registry();
    for (const one of UNDERLINE_NAMES) api?.delete(one);
  }
  function paint(keys, where = {}) {
    const api = registry();
    const root2 = where.root ?? document.body;
    if (api === null || root2 === null) return 0;
    clear();
    name = underlineName(where.weight ?? DEFAULT_UNDERLINE);
    index = buildIndex(keys);
    if (index.size === 0) return 0;
    scope = root2;
    painted = scan(root2, index);
    live = new Highlight();
    for (const { range: range2 } of painted) live.add(range2);
    api.set(name, live);
    if (where.observe !== false) {
      observer = new MutationObserver(onMutations);
      observer.observe(root2, { subtree: true, childList: true, characterData: true });
    }
    return painted.length;
  }
  function onMutations(records) {
    for (const record of records) {
      const block = blockAround(record.target);
      if (block !== null) pending.add(block);
    }
    if (pending.size === 0 || scheduled) return;
    scheduled = true;
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(catchUp, { timeout: IDLE_TIMEOUT });
    } else {
      setTimeout(catchUp, IDLE_TIMEOUT);
    }
  }
  function outermost(blocks) {
    return blocks.filter((block) => !blocks.some((other) => other !== block && other.contains(block)));
  }
  function catchUp() {
    scheduled = false;
    const api = registry();
    if (api === null || live === null || scope === null) return;
    const changed = [...pending].filter((block) => block.isConnected);
    pending.clear();
    const areas = changed.length > RESCAN_EVERYTHING ? [scope] : outermost(changed);
    if (areas.length === 0) return;
    const kept = [];
    for (const entry of painted) {
      const container = entry.range.startContainer;
      const stale = !container.isConnected || areas.some((area) => area.contains(container));
      if (stale) live.delete(entry.range);
      else kept.push(entry);
    }
    painted = kept;
    for (const area of areas) {
      for (const entry of scan(area, index)) {
        live.add(entry.range);
        painted.push(entry);
      }
    }
  }
  function phraseAt(x, y) {
    for (const { range: range2, normalized } of painted) {
      for (const rect of range2.getClientRects()) {
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
        return { normalized, text: range2.toString(), rect, range: range2 };
      }
    }
    return null;
  }

  // src/lib/matcher/words.js
  function wordIndexAt(tokens, offset) {
    for (let index2 = 0; index2 < tokens.length; index2 += 1) {
      const token = tokens[index2];
      if (token !== void 0 && offset >= token.start && offset <= token.end) return index2;
    }
    return -1;
  }
  function besideSpan(span2, index2) {
    if (index2 < 0) return "apart";
    if (index2 >= span2.from && index2 <= span2.to) return "within";
    if (index2 === span2.from - 1) return "left";
    if (index2 === span2.to + 1) return "right";
    return "apart";
  }
  var WORD_CHARACTER = /[\p{L}\p{N}\p{M}]/u;
  var WHITESPACE = /\s/u;
  function glued(text, at) {
    const character = text[at];
    if (character === void 0) return false;
    return !WHITESPACE.test(character) && !WORD_CHARACTER.test(character);
  }
  function gluedStart(text, offset) {
    while (offset > 0 && glued(text, offset - 1)) offset -= 1;
    return offset;
  }
  function gluedEnd(text, offset) {
    while (glued(text, offset)) offset += 1;
    return offset;
  }
  function nearestWordIndex(tokens, offset) {
    let best = -1;
    let bestDistance = Infinity;
    for (let index2 = 0; index2 < tokens.length; index2 += 1) {
      const token = tokens[index2];
      if (token === void 0) continue;
      const distance = offset < token.start ? token.start - offset : offset > token.end ? offset - token.end : 0;
      if (distance < bestDistance) {
        best = index2;
        bestDistance = distance;
      }
      if (distance === 0) break;
    }
    return best;
  }

  // src/content/select.js
  var NAME = "reread-selection";
  var DRAFT = "reread-marker-draft";
  var HOLD_MS = 400;
  var TAP_SLOP = 10;
  var GRAB_SLOP = 8;
  var MOUSE_SLOP = 2;
  var COMPAT_MS = 500;
  var SCROLL_TAIL_MS = 100;
  var hooks = null;
  var started2 = false;
  function linkOwns(target) {
    if (!(target instanceof Element) || target.closest("a[href]") === null) return false;
    return hooks?.plainLinks?.() !== true;
  }
  function marking() {
    return hooks?.marking?.() === true;
  }
  function withinMarkRoot(block) {
    const root2 = hooks?.markRoot?.() ?? null;
    return root2 !== null && root2.contains(block);
  }
  var geometry = null;
  var span = null;
  var range = null;
  var highlight = null;
  var ink = null;
  var inkFocus = null;
  var inkHighlight = null;
  var gesture = null;
  var mouse = null;
  var touchedAt = -Infinity;
  var scrolledAt = 0;
  function touchById(touches, id) {
    for (const touch of touches) {
      if (touch.identifier === id) return touch;
    }
    return null;
  }
  function withinRects(target, x, y, slop) {
    for (const rect of target.getClientRects()) {
      if (x >= rect.left - slop && x <= rect.right + slop && y >= rect.top - slop && y <= rect.bottom + slop) {
        return true;
      }
    }
    return false;
  }
  function caretAt(x, y) {
    if (typeof document.caretPositionFromPoint !== "function") return null;
    const position = document.caretPositionFromPoint(x, y);
    const node = position === null ? null : position.offsetNode;
    if (!(node instanceof Text)) return null;
    return { node, offset: position === null ? 0 : position.offset };
  }
  function offsetIn(geo, node, offset) {
    const index2 = geo.parts.findIndex((part) => part.node === node);
    const piece = geo.spans[index2];
    if (index2 === -1 || piece === void 0) return null;
    return piece.start + offset;
  }
  function rangeOfSpan(geo, from, to) {
    const first = geo.tokens[from];
    const last = geo.tokens[to];
    if (first === void 0 || last === void 0) return null;
    const start2 = locate(geo.spans, first.start);
    const end = locate(geo.spans, last.end - 1);
    const startNode = start2 === null ? null : geo.parts[start2.piece]?.node ?? null;
    const endNode = end === null ? null : geo.parts[end.piece]?.node ?? null;
    if (start2 === null || end === null || startNode === null || endNode === null) return null;
    const built = document.createRange();
    built.setStart(startNode, start2.offset);
    built.setEnd(endNode, end.offset + 1);
    return built;
  }
  function paint2() {
    if (!supported() || range === null) return;
    if (highlight === null) {
      highlight = new Highlight();
      highlight.priority = 1;
      CSS.highlights.set(NAME, highlight);
    }
    highlight.clear();
    highlight.add(range);
  }
  function select(geo, from, to, anchor) {
    const built = rangeOfSpan(geo, from, to);
    if (built === null) return false;
    geometry = geo;
    span = { from, to, anchor };
    range = built;
    paint2();
    return true;
  }
  function clearSelection() {
    geometry = null;
    span = null;
    range = null;
    highlight = null;
    if (supported()) CSS.highlights.delete(NAME);
    clearInk();
  }
  function paintInk() {
    if (!supported() || ink === null) return;
    if (inkHighlight === null) {
      inkHighlight = new Highlight();
      inkHighlight.priority = 1;
      CSS.highlights.set(DRAFT, inkHighlight);
    }
    inkHighlight.clear();
    inkHighlight.add(ink.range);
  }
  function clearInk() {
    ink = null;
    inkFocus = null;
    inkHighlight = null;
    if (supported()) CSS.highlights.delete(DRAFT);
  }
  function inkStart(word) {
    const built = inkRange(word, word);
    if (built === null) return false;
    ink = { anchor: word, range: built };
    paintInk();
    hooks?.onMarkStart?.();
    return true;
  }
  function inkWordAt(caret) {
    const block = blockAround(caret.node);
    if (block === null || !withinMarkRoot(block)) return null;
    let geo = null;
    if (ink !== null && ink.anchor.geo.block === block) geo = ink.anchor.geo;
    else if (inkFocus !== null && inkFocus.block === block) geo = inkFocus;
    else {
      const pieces = blockPieces(caret.node);
      if (pieces === null) return null;
      geo = { ...pieces, tokens: tokenize(pieces.text) };
      inkFocus = geo;
    }
    const offset = offsetIn(geo, caret.node, caret.offset);
    if (offset === null) return null;
    const index2 = nearestWordIndex(geo.tokens, offset);
    if (index2 === -1) return null;
    return { geo, index: index2 };
  }
  function inkRange(a, b) {
    const first = rangeOfSpan(a.geo, a.index, a.index);
    const second = rangeOfSpan(b.geo, b.index, b.index);
    if (first === null || second === null) return null;
    const forward = first.compareBoundaryPoints(Range.START_TO_START, second) <= 0;
    const head = forward ? a : b;
    const tail = forward ? b : a;
    const headToken = head.geo.tokens[head.index];
    const tailToken = tail.geo.tokens[tail.index];
    if (headToken === void 0 || tailToken === void 0) return null;
    const from = locate(head.geo.spans, gluedStart(head.geo.text, headToken.start));
    const to = locate(tail.geo.spans, gluedEnd(tail.geo.text, tailToken.end) - 1);
    const fromNode = from === null ? null : head.geo.parts[from.piece]?.node ?? null;
    const toNode = to === null ? null : tail.geo.parts[to.piece]?.node ?? null;
    if (from === null || to === null || fromNode === null || toNode === null) return null;
    const built = document.createRange();
    built.setStart(fromNode, from.offset);
    built.setEnd(toNode, to.offset + 1);
    return built;
  }
  function extendInk(x, y) {
    const active = ink;
    if (active === null) return;
    const caret = caretAt(x, y);
    if (caret === null) return;
    const focus = inkWordAt(caret);
    if (focus === null) return;
    const built = inkRange(active.anchor, focus);
    if (built === null) return;
    active.range = built;
    paintInk();
  }
  function finishInk() {
    const done = ink?.range ?? null;
    clearInk();
    if (done !== null) hooks?.onMarked?.(done);
  }
  function wordAt(x, y, slop) {
    if (hooks === null) return null;
    const caret = caretAt(x, y);
    if (caret === null) return null;
    const pieces = blockPieces(caret.node);
    if (pieces === null || !hooks.root.contains(pieces.block)) return null;
    const geo = { ...pieces, tokens: tokenize(pieces.text) };
    const offset = offsetIn(geo, caret.node, caret.offset);
    if (offset === null) return null;
    const index2 = wordIndexAt(geo.tokens, offset);
    if (index2 === -1) return null;
    const word = rangeOfSpan(geo, index2, index2);
    if (word === null || !withinRects(word, x, y, slop)) return null;
    return { geo, index: index2 };
  }
  function hold() {
    const active = gesture;
    if (active === null || active.mode !== "hold" || hooks === null) return;
    if (linkOwns(active.target)) return;
    const word = wordAt(active.x, active.y, GRAB_SLOP);
    if (word === null) return;
    if (marking() && !withinMarkRoot(word.geo.block)) return;
    hooks.onSelectStart();
    if (marking()) {
      if (!inkStart(word)) return;
    } else if (!select(word.geo, word.index, word.index, word.index)) return;
    active.mode = "select";
    const activated = navigator.userActivation === void 0 || navigator.userActivation.hasBeenActive;
    if (activated && typeof navigator.vibrate === "function") navigator.vibrate(15);
  }
  function onTouchStart(event) {
    touchedAt = performance.now();
    if (hooks === null) return;
    if (gesture !== null) {
      if (gesture.mode === "hold") cancelGesture();
      return;
    }
    if (event.touches.length > 1) return;
    const touch = event.changedTouches[0];
    if (touch === void 0) return;
    if (hooks.owns(event.target)) return;
    const target = event.target;
    if (!(target instanceof Node) || !hooks.root.contains(target)) return;
    if (performance.now() - scrolledAt < SCROLL_TAIL_MS) return;
    gesture = {
      id: touch.identifier,
      x: touch.clientX,
      y: touch.clientY,
      fromX: touch.clientX,
      fromY: touch.clientY,
      target,
      timer: window.setTimeout(hold, HOLD_MS),
      mode: "hold"
    };
  }
  function cancelGesture() {
    if (gesture !== null) window.clearTimeout(gesture.timer);
    gesture = null;
  }
  function onTouchMove(event) {
    const active = gesture;
    if (active === null) return;
    const touch = touchById(event.changedTouches, active.id);
    if (touch === null) return;
    if (active.mode === "hold") {
      if (Math.abs(touch.clientX - active.fromX) > TAP_SLOP || Math.abs(touch.clientY - active.fromY) > TAP_SLOP) {
        cancelGesture();
        return;
      }
      active.x = touch.clientX;
      active.y = touch.clientY;
      return;
    }
    if (event.cancelable) event.preventDefault();
    extendTo(touch.clientX, touch.clientY);
  }
  function extendTo(x, y) {
    if (ink !== null) {
      extendInk(x, y);
      return;
    }
    const geo = geometry;
    const at = span;
    if (geo === null || at === null) return;
    const caret = caretAt(x, y);
    if (caret === null) return;
    const offset = offsetIn(geo, caret.node, caret.offset);
    if (offset === null) return;
    const focus = nearestWordIndex(geo.tokens, offset);
    if (focus === -1) return;
    const from = Math.min(at.anchor, focus);
    const to = Math.max(at.anchor, focus);
    if (from === at.from && to === at.to) return;
    select(geo, from, to, at.anchor);
  }
  function onTouchEnd(event) {
    touchedAt = performance.now();
    const active = gesture;
    if (active === null || hooks === null) return;
    const touch = touchById(event.changedTouches, active.id);
    if (touch === null) return;
    cancelGesture();
    if (active.mode === "select") {
      if (event.cancelable) event.preventDefault();
      if (ink !== null) {
        finishInk();
        return;
      }
      if (range === null) return;
      hooks.onSelected(range, "press");
      return;
    }
    tap(event, touch.clientX, touch.clientY);
  }
  function onTouchCancel(event) {
    touchedAt = performance.now();
    const active = gesture;
    if (active === null) return;
    if (touchById(event.changedTouches, active.id) === null) return;
    cancelGesture();
    if (active.mode !== "select") return;
    if (ink !== null) finishInk();
    else if (range !== null) hooks?.onSelected(range, "press");
  }
  function answerTap(target, x, y, slop) {
    const geo = geometry;
    const at = span;
    if (hooks === null || geo === null || at === null || range === null) return false;
    if (linkOwns(target)) return false;
    const word = wordAt(x, y, slop);
    if (word === null) {
      if (!withinRects(range, x, y, slop)) return false;
      hooks.onSelected(range, "again");
      return true;
    }
    if (word.geo.block !== geo.block) return false;
    const beside = besideSpan(at, word.index);
    if (beside === "apart") return false;
    if (beside === "within") {
      hooks.onSelected(range, "again");
      return true;
    }
    const from = beside === "left" ? at.from - 1 : at.from;
    const to = beside === "right" ? at.to + 1 : at.to;
    if (!select(geo, from, to, at.anchor) || range === null) return false;
    hooks.onSelected(range, "extend");
    return true;
  }
  function tap(event, x, y) {
    if (marking()) {
      const target = event.target;
      if (linkOwns(target)) return;
      if (!(target instanceof Node) || hooks === null || !hooks.root.contains(target)) return;
      hooks.onMarkTap?.(x, y, tappedWord(x, y, GRAB_SLOP));
      event.preventDefault();
      return;
    }
    if (answerTap(event.target, x, y, GRAB_SLOP)) event.preventDefault();
  }
  function tappedWord(x, y, slop) {
    const word = wordAt(x, y, slop);
    if (word === null || !withinMarkRoot(word.geo.block)) return void 0;
    return inkRange(word, word) ?? void 0;
  }
  function realMouse() {
    return performance.now() - touchedAt > COMPAT_MS;
  }
  function cancelMouse() {
    if (mouse !== null) window.clearTimeout(mouse.timer);
    mouse = null;
  }
  function endMouse() {
    const active = mouse;
    cancelMouse();
    if (active === null || active.mode !== "select") return;
    if (ink !== null) finishInk();
    else if (range !== null) hooks?.onSelected(range, "press");
  }
  function onMouseDown(event) {
    if (hooks === null) return;
    if (event.button !== 0 || event.ctrlKey || !realMouse()) return;
    cancelMouse();
    if (hooks.owns(event.target)) return;
    const target = event.target;
    if (!(target instanceof Node) || !hooks.root.contains(target)) return;
    if (linkOwns(target)) return;
    mouse = {
      x: event.clientX,
      y: event.clientY,
      fromX: event.clientX,
      fromY: event.clientY,
      timer: window.setTimeout(mouseHold, HOLD_MS),
      mode: "hold"
    };
  }
  function mouseHold() {
    const active = mouse;
    if (active === null || active.mode !== "hold" || hooks === null) return;
    const word = wordAt(active.x, active.y, MOUSE_SLOP);
    if (word === null) return;
    if (marking() && !withinMarkRoot(word.geo.block)) return;
    hooks.onSelectStart();
    if (marking()) {
      if (!inkStart(word)) return;
    } else if (!select(word.geo, word.index, word.index, word.index)) return;
    active.mode = "select";
  }
  function onMouseMove(event) {
    const active = mouse;
    if (active === null || hooks === null) return;
    if ((event.buttons & 1) === 0) {
      endMouse();
      return;
    }
    if (active.mode === "hold") {
      const from = { x: active.fromX, y: active.fromY };
      const to = { x: event.clientX, y: event.clientY };
      if (!madeSelection({ from, to, clicks: 1 })) {
        active.x = event.clientX;
        active.y = event.clientY;
        return;
      }
      const word = wordAt(from.x, from.y, MOUSE_SLOP);
      if (word === null || marking() && !withinMarkRoot(word.geo.block)) {
        cancelMouse();
        return;
      }
      hooks.onSelectStart();
      const took = marking() ? inkStart(word) : select(word.geo, word.index, word.index, word.index);
      if (!took) {
        cancelMouse();
        return;
      }
      active.mode = "select";
    }
    extendTo(event.clientX, event.clientY);
  }
  function releaseMouse(event) {
    if (hooks === null || event.button !== 0) return false;
    const active = mouse;
    cancelMouse();
    if (active === null) return false;
    if (active.mode === "select") {
      if (ink !== null) finishInk();
      else if (range !== null) hooks.onSelected(range, "press");
      return true;
    }
    if (marking()) {
      if (event.detail >= 2) {
        const word = wordAt(event.clientX, event.clientY, MOUSE_SLOP);
        if (word !== null && withinMarkRoot(word.geo.block)) {
          const one = inkRange(word, word);
          if (one !== null) {
            hooks.onMarked?.(one);
            return true;
          }
        }
      }
      hooks.onMarkTap?.(event.clientX, event.clientY, tappedWord(event.clientX, event.clientY, MOUSE_SLOP));
      return true;
    }
    if (answerTap(event.target, event.clientX, event.clientY, MOUSE_SLOP)) return true;
    if (event.detail >= 2) {
      if (linkOwns(event.target)) return false;
      const word = wordAt(event.clientX, event.clientY, MOUSE_SLOP);
      if (word === null) return false;
      hooks.onSelectStart();
      if (!select(word.geo, word.index, word.index, word.index) || range === null) return false;
      hooks.onSelected(range, "press");
      return true;
    }
    return false;
  }
  function onWindowBlur() {
    endMouse();
  }
  function onScroll2() {
    scrolledAt = performance.now();
    if (gesture?.mode === "hold") cancelGesture();
    if (mouse?.mode === "hold") cancelMouse();
  }
  function onContextMenu(event) {
    if (gesture?.mode === "select") event.preventDefault();
  }
  function startSelect(options) {
    if (started2) return;
    started2 = true;
    hooks = options;
    document.addEventListener("touchstart", onTouchStart, { capture: true, passive: false });
    document.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
    document.addEventListener("touchend", onTouchEnd, { capture: true, passive: false });
    document.addEventListener("touchcancel", onTouchCancel, { capture: true, passive: true });
    document.addEventListener("mousedown", onMouseDown, { capture: true, passive: true });
    document.addEventListener("mousemove", onMouseMove, { capture: true, passive: true });
    window.addEventListener("blur", onWindowBlur);
    document.addEventListener("contextmenu", onContextMenu, { capture: true });
    document.addEventListener("scroll", onScroll2, { capture: true, passive: true });
  }
  function stopSelect() {
    if (!started2) return;
    started2 = false;
    document.removeEventListener("touchstart", onTouchStart, { capture: true });
    document.removeEventListener("touchmove", onTouchMove, { capture: true });
    document.removeEventListener("touchend", onTouchEnd, { capture: true });
    document.removeEventListener("touchcancel", onTouchCancel, { capture: true });
    document.removeEventListener("mousedown", onMouseDown, { capture: true });
    document.removeEventListener("mousemove", onMouseMove, { capture: true });
    window.removeEventListener("blur", onWindowBlur);
    document.removeEventListener("contextmenu", onContextMenu, { capture: true });
    document.removeEventListener("scroll", onScroll2, { capture: true });
    hooks = null;
    scrolledAt = 0;
    touchedAt = -Infinity;
    cancelGesture();
    cancelMouse();
    clearSelection();
  }

  // src/content/reading.js
  var vocabulary = /* @__PURE__ */ new Map();
  var current = null;
  var secondLayer = [];
  var unfetched = null;
  var generation = 0;
  var anchorRange = null;
  var SPEAK = canSpeak() ? ["speak"] : [];
  var COPY = ["copy"];
  var KEPT = [...SPEAK, ...COPY, "learned", "edit"];
  var autoKept = null;
  var OFFERED = Object.freeze({
    /** Nothing to keep, so nothing to write - the speaker and the clipboard
     *  still stand, because a phrase too long to save is still a phrase worth
     *  hearing, and a whole translated sentence is exactly what gets copied
     *  out into notes (D110). */
    none: [...SPEAK, ...COPY],
    ask: (
      /** @type {import("./tooltip.js").Action[]} */
      [...SPEAK, ...COPY, "save", "edit"]
    ),
    automatic: KEPT
  });
  var tooltip2 = createTooltip({
    onAction: onAction2,
    onHide: () => {
      stop();
      unmark();
    },
    // Live, through the module variable: the tooltip is built once, but what
    // stands over the text is the ground's business and changes with `start`.
    covered: () => coveredAbove()
  });
  var hideActions = DEFAULTS.hideBubbleActions;
  var underline = DEFAULTS.underline;
  var noTranslation = DEFAULTS.translationOff;
  var quietLookup = null;
  var quietVoice = null;
  var bubbleScale = DEFAULTS.bubbleScale;
  var ttsLang = "";
  var ttsVoiceURI = void 0;
  var ttsRate = DEFAULTS.ttsRate;
  var press = null;
  var lastPointerType2 = "";
  var settleTimer = null;
  var SETTLE_MS2 = 300;
  var root = null;
  var follow = true;
  var anchored = false;
  var started3 = false;
  var coveredAbove = () => 0;
  var openSettings = null;
  var alsoOwns = () => false;
  var bridgeCopy = false;
  function owns(target) {
    return tooltip2.owns(target) || alsoOwns(target);
  }
  async function ask(request) {
    try {
      return asResult(await webext().runtime.sendMessage(request));
    } catch {
      return fail(ErrorCode.INTERNAL);
    }
  }
  function adopt(entries) {
    if (!started3) return;
    vocabulary = new Map(entries);
    repaint();
  }
  function repaint() {
    if (vocabulary.size === 0) clear();
    else paint(vocabulary.keys(), { root: root ?? document.body, observe: follow, weight: underline });
  }
  async function loadVocabulary(preloaded) {
    try {
      const stored = preloaded ?? await webext().storage.local.get([CONFIG_KEY, MIRROR_KEY]);
      const config2 = withDefaults(stored[CONFIG_KEY]);
      const mirror = asMirror(stored[MIRROR_KEY]);
      hideActions = config2.hideBubbleActions;
      underline = config2.underline;
      bubbleScale = config2.bubbleScale;
      ttsLang = config2.sourceLang ?? "";
      ttsVoiceURI = config2.sourceLang === null ? void 0 : config2.ttsVoices[config2.sourceLang];
      ttsRate = config2.ttsRate;
      noTranslation = config2.translationOff;
      if (noTranslation) {
        adopt([]);
        return;
      }
      if (mirror === null) {
        adopt([]);
        return;
      }
      if (mirrorMatches(mirror, config2)) {
        adopt(mirror.entries);
        return;
      }
      const result = await ask({ kind: Message.LIST_PHRASES });
      if (result.ok) adopt(result.value);
    } catch {
      adopt([]);
    }
  }
  function fromRange(range2) {
    const text = trimPhrase(range2.toString());
    if (text.length === 0) return null;
    const rect = range2.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    const normalized = normalize(text);
    return { text, normalized, rect, range: range2, context: contextOf(range2), findable: findable(range2, normalized) };
  }
  function readSelection() {
    const selection = window.getSelection();
    if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return null;
    const range2 = selection.getRangeAt(0);
    if (root !== null && !root.contains(range2.commonAncestorContainer)) return null;
    return fromRange(range2);
  }
  function firstLineOf(range2) {
    const first = range2.getClientRects()[0];
    return first === void 0 ? 0 : first.height;
  }
  function contextOf(range2) {
    try {
      const block = blockTextAround(range2);
      return block === null ? null : sentenceAround(block.text, block.start, block.end);
    } catch {
      return null;
    }
  }
  async function onAction2(action, meanings) {
    if (action === "reader") return;
    if (action === "settings") {
      if (openSettings !== null) openSettings();
      else void ask({ kind: Message.OPEN_SETTINGS });
      tooltip2.hide();
      return;
    }
    if (action === "speak") {
      if (speaking()) stop();
      else if (current !== null) {
        const voice = (noTranslation ? quietVoice?.() : null) ?? { lang: ttsLang, voiceURI: ttsVoiceURI };
        speak(current.text, voice.lang, voice.voiceURI, ttsRate / 100);
      }
      return;
    }
    if (action === "learned") {
      await forget();
      return;
    }
    if (action === "more") {
      await fillSecondLayer();
      return;
    }
    if (current !== null && !current.keepable) return;
    if (action === "save") await keep(meanings, null);
    else await keep(meanings, KEPT);
  }
  async function change(write, remember, next) {
    const phrase = current;
    if (phrase === null) return;
    const mine2 = generation;
    const result = await write(phrase);
    if (mine2 !== generation || !tooltip2.isOpen()) return;
    if (!result.ok) {
      tooltip2.setBody(describeError(result.code), "error");
      tooltip2.setActions([]);
      return;
    }
    remember(phrase);
    repaint();
    if (next === null) {
      tooltip2.hide();
      clearSelection();
      autoKept = null;
      current = null;
      secondLayer = [];
      unfetched = null;
      return;
    }
    tooltip2.setActions([...next, ...secondLayer]);
  }
  async function keep(meanings, next) {
    await change(
      (phrase) => ask({ kind: Message.SAVE_PHRASE, text: phrase.text, translations: meanings }),
      (phrase) => {
        const kept = autoKept;
        if (kept !== null && kept.normalized !== phrase.normalized) {
          autoKept = null;
          void ask({ kind: Message.FORGET_PHRASE, text: kept.text });
          vocabulary.delete(kept.normalized);
        }
        vocabulary.set(phrase.normalized, meanings);
      },
      next
    );
  }
  async function forget() {
    await change(
      (phrase) => ask({ kind: Message.FORGET_PHRASE, text: phrase.text }),
      (phrase) => vocabulary.delete(phrase.normalized),
      null
    );
  }
  function showSaved(anchor, text, normalized, context, how = {}) {
    const meanings = vocabulary.get(normalized);
    if (meanings === void 0) return false;
    stop();
    current = { text, normalized, keepable: true };
    generation += 1;
    anchorRange = how.range === void 0 ? null : how.range.cloneRange();
    if (how.range === void 0) unmark();
    else mark(how.range);
    secondLayer = ["more"];
    unfetched = { context };
    tooltip2.show({
      anchor,
      line: how.range === void 0 ? 0 : firstLineOf(how.range),
      variant: "recall",
      body: meanings.join("\n"),
      actions: [...KEPT, ...secondLayer],
      phrase: text,
      folded: hideActions,
      touch: how.touch === true,
      // Not `how.touch`, which a tap on an underline honestly lacks - the
      // system puts no handles around a tap. What sizes the bubble is the
      // pointer that pressed (D84), whichever way the press came in.
      coarse: touchPointer(lastPointerType2),
      scale: bubbleScale / 100,
      anchored
    });
    return true;
  }
  async function fillSecondLayer() {
    const phrase = current;
    const wanted = unfetched;
    if (phrase === null || wanted === null) return;
    unfetched = null;
    const mine2 = generation;
    tooltip2.setContext(t("bubble_translating"), "pending");
    const answer = ask(
      wanted.context === null ? { kind: Message.TRANSLATE, text: phrase.text } : { kind: Message.TRANSLATE, text: phrase.text, context: wanted.context }
    );
    const result = await answer;
    if (mine2 !== generation || !tooltip2.isOpen()) return;
    if (!result.ok) {
      unfetched = wanted;
      tooltip2.setContext(describeError(result.code), "error");
      return;
    }
    const { sentence, entries } = asTranslation(result.value);
    const blocks = entryBlocks(entries ?? [], phrase.normalized);
    if ((sentence === null || sentence.length === 0) && blocks.length === 0) {
      tooltip2.setContext(t("bubble_nothing_more"), "note");
      tooltip2.setEntries([]);
      return;
    }
    tooltip2.setContext(sentence);
    tooltip2.setEntries(blocks);
  }
  function entryBlocks(entries, normalized) {
    const books = new Set(entries.map((entry) => entry.dictionary)).size;
    return entries.map((entry) => {
      const parts = [];
      if (normalize(entry.headword) !== normalized && entry.headword.length > 0) parts.push(entry.headword);
      if (books > 1 && entry.dictionary.length > 0) parts.push(entry.dictionary);
      return { label: parts.join(" - "), lines: choosableLines(entry.senses) };
    });
  }
  function onMouseDown2(event) {
    press = { x: event.clientX, y: event.clientY, mine: owns(event.target) };
  }
  function onMouseUp(event) {
    if (releaseMouse(event)) {
      press = null;
      return;
    }
    if (owns(event.target)) return;
    const from = press;
    press = null;
    if (from?.mine === true) return;
    if (event.button !== 0) return;
    const gesture2 = { from, to: { x: event.clientX, y: event.clientY }, clicks: event.detail };
    const selection = madeSelection(gesture2) ? readSelection() : null;
    if (selection === null) {
      clearSelection();
      autoKept = null;
      const hit = phraseAt(event.clientX, event.clientY);
      if (hit !== null && showSaved(hit.rect, hit.text, hit.normalized, contextOf(hit.range), { range: hit.range })) {
        return;
      }
      tooltip2.hide();
      current = null;
      secondLayer = [];
      unfetched = null;
      return;
    }
    present(selection, { deliberate: true, touch: false });
  }
  function present(selection, { deliberate, touch, chain = false }) {
    if (!chain) autoKept = null;
    const { text, normalized } = selection;
    if (noTranslation) {
      stop();
      unmark();
      current = { text, normalized, keepable: false };
      secondLayer = [];
      unfetched = null;
      anchorRange = selection.range.cloneRange();
      const mine3 = ++generation;
      tooltip2.show({
        anchor: selection.rect,
        line: firstLineOf(selection.range),
        variant: "quiet",
        body: "",
        actions: [...SPEAK, ...COPY],
        phrase: text,
        touch,
        coarse: touchPointer(lastPointerType2),
        scale: bubbleScale / 100,
        anchored
      });
      if (quietLookup !== null) {
        void quietLookup(text).then((entries) => {
          if (mine3 !== generation || !tooltip2.isOpen()) return;
          if (entries.length > 0) tooltip2.setEntries(entryBlocks(entries, normalized));
        });
      }
      return;
    }
    if (showSaved(selection.rect, text, normalized, selection.context, { touch, range: selection.range })) return;
    stop();
    unmark();
    current = { text, normalized, keepable: selection.findable };
    secondLayer = [];
    unfetched = null;
    anchorRange = selection.range.cloneRange();
    const mine2 = ++generation;
    tooltip2.show({
      anchor: selection.rect,
      line: firstLineOf(selection.range),
      variant: "save",
      body: t("bubble_translating"),
      tone: "pending",
      phrase: text,
      touch,
      // Every way in remembers its pointer (`lastPointerType`), so one answer
      // serves them all (D84): the reader's own gesture and a settled native
      // selection size for the finger, a mouse gesture for the desk.
      coarse: touchPointer(lastPointerType2),
      scale: bubbleScale / 100,
      folded: hideActions,
      anchored
    });
    const request = selection.context === null ? { kind: Message.TRANSLATE, text } : { kind: Message.TRANSLATE, text, context: selection.context };
    const answer = ask(request);
    void answer.then((result) => {
      if (mine2 !== generation || !tooltip2.isOpen()) return;
      if (!result.ok) {
        tooltip2.setBody(describeError(result.code), "error");
        tooltip2.setActions(result.code === ErrorCode.MODEL_MISSING ? ["settings"] : []);
        tooltip2.reveal();
        return;
      }
      const { gloss, sentence, entries } = asTranslation(result.value);
      tooltip2.setBody(gloss, "normal");
      tooltip2.setContext(sentence);
      const blocks = entryBlocks(entries ?? [], normalized);
      tooltip2.setEntries(blocks);
      secondLayer = sentence !== null && sentence.length > 0 || blocks.length > 0 ? ["more"] : [];
      const decision = keeping({ normalized, gloss, findable: selection.findable, deliberate });
      tooltip2.setActions([...OFFERED[decision], ...secondLayer]);
      if (decision === "ask") tooltip2.reveal();
      if (decision === "automatic") {
        if (chain) autoKept = { text, normalized };
        void keep([gloss], KEPT);
      }
    });
  }
  function presentGesture(range2, kind) {
    const selection = fromRange(range2);
    if (selection === null) return;
    if (kind !== "extend" && tooltip2.isOpen() && current !== null && current.text === selection.text) return;
    if (kind === "press") autoKept = null;
    present(selection, { deliberate: kind === "press", touch: false, chain: true });
  }
  function onPointerDown2(event) {
    lastPointerType2 = event.pointerType;
  }
  function onSelectionChange2() {
    if (!touchPointer(lastPointerType2)) return;
    if (settleTimer !== null) window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(settled, SETTLE_MS2);
    yieldToSelection();
  }
  function yieldToSelection() {
    if (!tooltip2.isOpen() || tooltip2.isEditing()) return;
    const selection = window.getSelection();
    if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return;
    const text = trimPhrase(selection.toString());
    if (text.length === 0 || current !== null && text === current.text) return;
    tooltip2.hide();
    current = null;
    secondLayer = [];
    unfetched = null;
  }
  function settled() {
    settleTimer = null;
    if (tooltip2.isEditing()) return;
    const selection = readSelection();
    if (selection === null) return;
    if (tooltip2.isOpen() && current !== null && current.text === selection.text) return;
    present(selection, { deliberate: false, touch: true });
  }
  function chordTaken(target) {
    if (tooltip2.isEditing()) return true;
    if (target instanceof HTMLElement) {
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return true;
    }
    const selection = window.getSelection();
    return selection !== null && !selection.isCollapsed;
  }
  function onKeyDown(event) {
    if (!tooltip2.isOpen()) return;
    if (bridgeCopy && current !== null && copyCombo({ key: event.key, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey, shift: event.shiftKey }) && !chordTaken(event.target)) {
      void navigator.clipboard.writeText(current.text).catch(() => void 0);
      return;
    }
    if (event.key !== "Escape") return;
    tooltip2.escape();
    if (!tooltip2.isOpen()) {
      clearSelection();
      autoKept = null;
    }
  }
  function onScroll3(event) {
    if (anchored) return;
    if (!tooltip2.isOpen() || tooltip2.owns(event.target)) return;
    const rect = anchorRange === null ? null : anchorRange.getBoundingClientRect();
    if (rect !== null && rect.width > 0 && rect.height > 0) {
      tooltip2.follow(rect);
      return;
    }
    if (!tooltip2.isEditing()) tooltip2.hide();
  }
  function onStorageChanged(changes, area) {
    if (area !== "local") return;
    if (changes[MIRROR_KEY] === void 0 && changes[CONFIG_KEY] === void 0) return;
    void loadVocabulary();
  }
  function start(where = {}) {
    root = where.root ?? null;
    follow = where.observe ?? true;
    anchored = where.anchored ?? false;
    coveredAbove = where.covered ?? (() => 0);
    openSettings = where.openSettings ?? null;
    alsoOwns = where.alsoOwns ?? (() => false);
    quietLookup = where.quietLookup ?? null;
    quietVoice = where.quietVoice ?? null;
    bridgeCopy = where.ownSelection === true;
    if (!started3) {
      started3 = true;
      document.addEventListener("mousedown", onMouseDown2, { capture: true, passive: true });
      document.addEventListener("mouseup", onMouseUp, { capture: true, passive: true });
      document.addEventListener("keydown", onKeyDown, { capture: true, passive: true });
      document.addEventListener("scroll", onScroll3, { capture: true, passive: true });
      if (navigator.maxTouchPoints > 0) {
        document.addEventListener("pointerdown", onPointerDown2, { capture: true, passive: true });
        document.addEventListener("selectionchange", onSelectionChange2);
      }
      if (where.ownSelection === true) {
        startSelect({
          root: root ?? document.body,
          owns: (target) => owns(target),
          onSelected: presentGesture,
          onSelectStart: () => tooltip2.hide(),
          ...where.plainLinks === void 0 ? {} : { plainLinks: where.plainLinks },
          ...where.marking === void 0 ? {} : { marking: where.marking },
          ...where.markRoot === void 0 ? {} : { markRoot: where.markRoot },
          ...where.onMarked === void 0 ? {} : { onMarked: where.onMarked },
          ...where.onMarkStart === void 0 ? {} : { onMarkStart: where.onMarkStart },
          ...where.onMarkTap === void 0 ? {} : { onMarkTap: where.onMarkTap }
        });
      }
      webext().storage.onChanged.addListener(onStorageChanged);
    }
    void loadVocabulary(where.stored);
  }
  function stop2() {
    if (!started3) return;
    started3 = false;
    document.removeEventListener("mousedown", onMouseDown2, { capture: true });
    document.removeEventListener("mouseup", onMouseUp, { capture: true });
    document.removeEventListener("keydown", onKeyDown, { capture: true });
    document.removeEventListener("scroll", onScroll3, { capture: true });
    document.removeEventListener("pointerdown", onPointerDown2, { capture: true });
    document.removeEventListener("selectionchange", onSelectionChange2);
    stopSelect();
    webext().storage.onChanged.removeListener(onStorageChanged);
    if (settleTimer !== null) {
      window.clearTimeout(settleTimer);
      settleTimer = null;
    }
    tooltip2.hide();
    current = null;
    secondLayer = [];
    unfetched = null;
    autoKept = null;
    anchorRange = null;
    press = null;
    lastPointerType2 = "";
    anchored = false;
    coveredAbove = () => 0;
    openSettings = null;
    alsoOwns = () => false;
    quietLookup = null;
    quietVoice = null;
    bridgeCopy = false;
    vocabulary = /* @__PURE__ */ new Map();
    clear();
  }

  // src/content/index.js
  var mode = "off";
  var decided = false;
  var ready = false;
  var config = withDefaults(void 0);
  var os = "";
  var osKnown = false;
  var inventory = (
    /** @type {import("../lib/models/inventory.js").ModelInventory | null} */
    null
  );
  function decide() {
    return pageMode(config, os, location.hostname);
  }
  function apply(wanted, stored) {
    setLauncherScale(config.bubbleScale / 100);
    setLauncherHint(needsModelHint(config, inventory));
    if (wanted === mode) return;
    if (mode === "reading") stop2();
    if (mode === "launcher") stopLauncher();
    mode = wanted;
    if (wanted === "reading") start({ root: document.body, observe: true, stored });
    if (wanted === "launcher") startLauncher();
  }
  void webext().storage.local.get([CONFIG_KEY, MIRROR_KEY, PLATFORM_KEY, MODELS_KEY]).then((stored) => {
    if (decided) return;
    config = withDefaults(stored[CONFIG_KEY]);
    if (!osKnown) os = osFrom(stored[PLATFORM_KEY]);
    if (inventory === null) inventory = asInventory(stored[MODELS_KEY]);
    ready = true;
    apply(decide(), stored);
  }).catch(() => {
    if (decided) return;
    ready = true;
    apply("reading");
  });
  webext().storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const configChange = changes[CONFIG_KEY];
    const platformChange = changes[PLATFORM_KEY];
    const modelsChange = changes[MODELS_KEY];
    if (configChange === void 0 && platformChange === void 0 && modelsChange === void 0) {
      return;
    }
    if (platformChange !== void 0) {
      os = osFrom(platformChange.newValue);
      osKnown = true;
    }
    if (modelsChange !== void 0) inventory = asInventory(modelsChange.newValue);
    if (configChange !== void 0) {
      config = withDefaults(configChange.newValue);
      decided = true;
      ready = true;
    }
    if (ready) apply(decide());
  });
  webext().runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const request = asPageRequest(message);
    if (request === null) return false;
    if (request.kind === Message.PAGE_INFO) {
      sendResponse(ok({ hostname: location.hostname }));
      return false;
    }
    const html = document.documentElement.outerHTML;
    sendResponse(
      html.length > MAX_PAGE_HTML ? fail(ErrorCode.TOO_LONG) : ok({ url: location.href, title: document.title, html })
    );
    return false;
  });
})();
//# sourceMappingURL=index.js.map
