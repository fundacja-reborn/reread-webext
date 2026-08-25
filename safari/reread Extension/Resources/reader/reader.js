"use strict";
(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

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
  function matchesAt(tokens, at2, wanted) {
    if (at2 + wanted.length > tokens.length) return false;
    for (let offset = 1; offset < wanted.length; offset += 1) {
      if (tokens[at2 + offset]?.text !== wanted[offset]) return false;
    }
    return true;
  }
  function findMatches(text, index2) {
    const tokens = tokenize(text);
    const matches = [];
    for (let at2 = 0; at2 < tokens.length; ) {
      const token = tokens[at2];
      if (token === void 0) break;
      const candidate = index2.get(token.text)?.find((one) => matchesAt(tokens, at2, one.tokens));
      if (candidate === void 0) {
        at2 += 1;
        continue;
      }
      const last = tokens[at2 + candidate.tokens.length - 1];
      if (last !== void 0) {
        matches.push({ start: token.start, end: last.end, normalized: candidate.normalized });
      }
      at2 += candidate.tokens.length;
    }
    return matches;
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

  // src/lib/matcher/spans.js
  function joinPieces(pieces) {
    const spans = [];
    let at2 = 0;
    for (const piece of pieces) {
      spans.push({ start: at2, end: at2 + piece.length });
      at2 += piece.length;
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
  function prosePieces(root2) {
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
        const boundary = BLOCK.has(element.tagName);
        if (boundary) parts.push({ node: null, text: "\n" });
        walk(element);
        if (boundary) parts.push({ node: null, text: "\n" });
      }
    };
    walk(root2);
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
  var MAX_NOTE_LENGTH = 2e3;
  function asNote(value) {
    if (typeof value !== "string") return void 0;
    const kept = value.trim().slice(0, MAX_NOTE_LENGTH).trim();
    return kept.length === 0 ? void 0 : kept;
  }
  function isMarkColor(value) {
    return typeof value === "string" && MARK_COLORS.includes(
      /** @type {MarkColor} */
      value
    );
  }
  function isIndex(value) {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
  }
  function asPoint(value) {
    if (typeof value !== "object" || value === null) return null;
    const { block, offset } = (
      /** @type {Record<string, unknown>} */
      value
    );
    if (!isIndex(block) || !isIndex(offset)) return null;
    return { block, offset };
  }
  function comparePoints(a, b) {
    return a.block - b.block || a.offset - b.offset;
  }
  function compareMarks(a, b) {
    return a.segmentIndex - b.segmentIndex || comparePoints(a.start, b.start) || comparePoints(a.end, b.end);
  }
  function markRecord({ segmentIndex, start: start2, end, color, createdAt, text, note }) {
    if (!isIndex(segmentIndex)) return null;
    const from = asPoint(start2);
    const to = asPoint(end);
    if (from === null || to === null) return null;
    if (comparePoints(from, to) >= 0 || to.offset === 0) return null;
    if (!isMarkColor(color)) return null;
    if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) return null;
    if (typeof text !== "string" || text.length === 0) return null;
    const kept = asNote(note);
    return {
      segmentIndex,
      start: from,
      end: to,
      color,
      createdAt,
      text,
      ...kept === void 0 ? {} : { note: kept }
    };
  }
  function asMark(value) {
    if (typeof value !== "object" || value === null) return null;
    const { segmentIndex, start: start2, end, color, createdAt, text, note } = (
      /** @type {Record<string, unknown>} */
      value
    );
    return markRecord({
      segmentIndex: (
        /** @type {number} */
        segmentIndex
      ),
      start: (
        /** @type {MarkPoint} */
        start2
      ),
      end: (
        /** @type {MarkPoint} */
        end
      ),
      color: isMarkColor(color) ? color : DEFAULT_MARK_COLOR,
      createdAt: typeof createdAt === "number" && Number.isFinite(createdAt) ? createdAt : 0,
      text: (
        /** @type {string} */
        text
      ),
      note: typeof note === "string" ? note : void 0
    });
  }
  function joined(a, b) {
    if (a.segmentIndex !== b.segmentIndex) return false;
    return comparePoints(a.start, b.end) <= 0 && comparePoints(b.start, a.end) <= 0;
  }
  function mergePlan(marks, span2) {
    const absorbed = marks.filter((mark3) => joined(mark3, span2));
    let { start: start2, end } = span2;
    for (const mark3 of absorbed) {
      if (comparePoints(mark3.start, start2) < 0) start2 = mark3.start;
      if (comparePoints(mark3.end, end) > 0) end = mark3.end;
    }
    return { absorbed, span: { segmentIndex: span2.segmentIndex, start: start2, end } };
  }
  function mergedNote(absorbed) {
    const notes = [];
    for (const mark3 of [...absorbed].sort(compareMarks)) {
      if (mark3.note !== void 0 && !notes.includes(mark3.note)) notes.push(mark3.note);
    }
    return notes.length === 0 ? void 0 : notes.join("\n\n");
  }
  function placeMark(marks, absorbed, mark3) {
    const kept = marks.filter((one) => !absorbed.includes(one));
    return [...kept, mark3].sort(compareMarks);
  }
  function withoutMark(marks, mark3) {
    return marks.filter((one) => one !== mark3);
  }
  function marksInSegment(marks, segmentIndex) {
    return marks.filter((mark3) => mark3.segmentIndex === segmentIndex);
  }
  function headRect(rects) {
    let best = null;
    for (const rect of rects) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (best === null || rect.top < best.top || rect.top === best.top && rect.left < best.left) {
        best = rect;
      }
    }
    return best;
  }
  function tailRect(rects) {
    let best = null;
    for (const rect of rects) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (best === null || rect.bottom > best.bottom || rect.bottom === best.bottom && rect.right > best.right) {
        best = rect;
      }
    }
    return best;
  }
  function quoteOf(prose, start2, end) {
    const first = prose[0];
    const last = prose[prose.length - 1];
    if (first === void 0 || last === void 0) return null;
    if (prose.length !== end.block - start2.block + 1) return null;
    if (start2.offset >= first.length) return null;
    if (end.offset < 1 || end.offset > last.length) return null;
    if (prose.length === 1) return first.slice(start2.offset, end.offset);
    return [first.slice(start2.offset), ...prose.slice(1, -1), last.slice(0, end.offset)].join("\n");
  }

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
  async function readConfig() {
    const stored = await webext().storage.local.get(CONFIG_KEY);
    return withDefaults(stored[CONFIG_KEY]);
  }
  async function writeConfig(patch) {
    const current2 = await readConfig();
    const next = withDefaults({
      ...current2,
      ...patch,
      reader: { ...current2.reader, ...patch.reader }
    });
    await webext().storage.local.set({ [CONFIG_KEY]: next });
    return next;
  }

  // src/lib/gloss.js
  var MEANING_SEPARATOR = "\n";
  function toMeanings(text) {
    return text.split(MEANING_SEPARATOR).map((line) => line.trim()).filter((line) => line.length > 0);
  }
  function choosableLines(senses) {
    return senses.flatMap(toMeanings);
  }
  function afterChoosing(shown2, sense) {
    const meanings = toMeanings(shown2);
    const without = meanings.filter((meaning) => meaning !== sense);
    const next = without.length === meanings.length ? [...meanings, sense] : without;
    return next.join(MEANING_SEPARATOR);
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
    let at2 = stop3 + 1;
    for (; ; ) {
      const character = text[at2];
      if (character === void 0) break;
      if (STOPS.has(character) || CLOSERS.test(character)) {
        at2 += 1;
        continue;
      }
      FOOTNOTE.lastIndex = at2;
      if (FOOTNOTE.test(text)) {
        at2 = FOOTNOTE.lastIndex;
        continue;
      }
      break;
    }
    return at2 - 1;
  }
  function stopOf(text, index2) {
    for (let at2 = index2; at2 >= 0 && index2 - at2 <= LONGEST_ENDING; at2 -= 1) {
      if (STOPS.has(text[at2] ?? "") && endOfEnding(text, at2) === index2) return at2;
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
  function mirrorMatches(mirror, config) {
    return mirror.from === (config.sourceLang ?? "") && mirror.to === (config.targetLang ?? "");
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
    return voices.filter((voice2) => primaryLanguage(voice2.lang) === wanted).sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
  }
  function chosenVoice(voices, voiceURI) {
    if (voiceURI === void 0 || voiceURI === "") return null;
    return voices.find((voice2) => voice2.voiceURI === voiceURI) ?? null;
  }
  var mine = null;
  function speaking() {
    return mine !== null;
  }
  var sharing = null;
  function shareVoice(yieldQueue) {
    sharing = yieldQueue;
  }
  function speak(text, lang, voiceURI, rate = 1) {
    if (!canSpeak() || text.length === 0) return;
    sharing?.();
    stop();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = rate;
    const voice2 = chosenVoice(speechSynthesis.getVoices(), voiceURI);
    if (voice2 !== null) utterance.voice = voice2;
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
  function glued(text, at2) {
    const character = text[at2];
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
  function wordless(text) {
    return !WORD_CHARACTER.test(text);
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
  var started = false;
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
    const at2 = span;
    if (geo === null || at2 === null) return;
    const caret = caretAt(x, y);
    if (caret === null) return;
    const offset = offsetIn(geo, caret.node, caret.offset);
    if (offset === null) return;
    const focus = nearestWordIndex(geo.tokens, offset);
    if (focus === -1) return;
    const from = Math.min(at2.anchor, focus);
    const to = Math.max(at2.anchor, focus);
    if (from === at2.from && to === at2.to) return;
    select(geo, from, to, at2.anchor);
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
    const at2 = span;
    if (hooks === null || geo === null || at2 === null || range === null) return false;
    if (linkOwns(target)) return false;
    const word = wordAt(x, y, slop);
    if (word === null) {
      if (!withinRects(range, x, y, slop)) return false;
      hooks.onSelected(range, "again");
      return true;
    }
    if (word.geo.block !== geo.block) return false;
    const beside = besideSpan(at2, word.index);
    if (beside === "apart") return false;
    if (beside === "within") {
      hooks.onSelected(range, "again");
      return true;
    }
    const from = beside === "left" ? at2.from - 1 : at2.from;
    const to = beside === "right" ? at2.to + 1 : at2.to;
    if (!select(geo, from, to, at2.anchor) || range === null) return false;
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
  function onScroll() {
    scrolledAt = performance.now();
    if (gesture?.mode === "hold") cancelGesture();
    if (mouse?.mode === "hold") cancelMouse();
  }
  function onContextMenu(event) {
    if (gesture?.mode === "select") event.preventDefault();
  }
  function startSelect(options) {
    if (started) return;
    started = true;
    hooks = options;
    document.addEventListener("touchstart", onTouchStart, { capture: true, passive: false });
    document.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
    document.addEventListener("touchend", onTouchEnd, { capture: true, passive: false });
    document.addEventListener("touchcancel", onTouchCancel, { capture: true, passive: true });
    document.addEventListener("mousedown", onMouseDown, { capture: true, passive: true });
    document.addEventListener("mousemove", onMouseMove, { capture: true, passive: true });
    window.addEventListener("blur", onWindowBlur);
    document.addEventListener("contextmenu", onContextMenu, { capture: true });
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
  }
  function stopSelect() {
    if (!started) return;
    started = false;
    document.removeEventListener("touchstart", onTouchStart, { capture: true });
    document.removeEventListener("touchmove", onTouchMove, { capture: true });
    document.removeEventListener("touchend", onTouchEnd, { capture: true });
    document.removeEventListener("touchcancel", onTouchCancel, { capture: true });
    document.removeEventListener("mousedown", onMouseDown, { capture: true });
    document.removeEventListener("mousemove", onMouseMove, { capture: true });
    window.removeEventListener("blur", onWindowBlur);
    document.removeEventListener("contextmenu", onContextMenu, { capture: true });
    document.removeEventListener("scroll", onScroll, { capture: true });
    hooks = null;
    scrolledAt = 0;
    touchedAt = -Infinity;
    cancelGesture();
    cancelMouse();
    clearSelection();
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
  function settleBack({ shown: shown2, now, carried }) {
    if (carried === 0) return 0;
    const drift = now - shown2;
    return Math.abs(drift - carried) <= 2 ? -drift : 0;
  }
  function createTooltip({ onAction: onAction2, onHide, covered }) {
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
      bubble.addEventListener("pointerdown", onPointerDown2);
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
    function onPointerDown2() {
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
      const shown2 = new Set(currentMeanings());
      if (actionsElement !== null) {
        for (const button of actionsElement.querySelectorAll("button")) {
          if (button.dataset["action"] === "save") button.disabled = shown2.size === 0;
        }
      }
      if (entriesElement !== null) {
        for (const sense of entriesElement.querySelectorAll("button")) {
          sense.disabled = editing;
          sense.setAttribute("aria-pressed", shown2.has(sense.textContent ?? "") ? "true" : "false");
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
        if (opening) onAction2("more", currentMeanings());
        return;
      }
      const meanings = currentMeanings();
      if (action === "save" || action === "choose") {
        if (meanings.length === 0) return;
        stopEditing(true);
      }
      onAction2(action, meanings);
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
    function unfold(open3) {
      if (contextElement === null || entriesElement === null) return;
      unfolded = open3;
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
      const rows2 = editor.rows;
      sizeEditor();
      if (editor.rows !== rows2) place();
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
    function renderActions(actions2) {
      if (actionsElement === null) return;
      actionsElement.replaceChildren();
      for (const action of actions2) {
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
        actions: actions2 = [],
        touch = false,
        coarse = false,
        scale = 1,
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
          if (Number.isFinite(scale) && scale > 0 && scale !== 1) {
            bubble.style.setProperty("--bubble-scale", String(scale));
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
        restingActions = actions2;
        renderActions(actions2);
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
      setActions(actions2) {
        restingActions = actions2;
        settleCopy();
        if (copyRowElement !== null) copyRowElement.hidden = true;
        if (!editing) renderActions(actions2);
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
  var tooltip = createTooltip({
    onAction,
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
  var lastPointerType = "";
  var settleTimer = null;
  var SETTLE_MS = 300;
  var root = null;
  var follow = true;
  var anchored = false;
  var started2 = false;
  var coveredAbove = () => 0;
  var openSettings = null;
  var alsoOwns = () => false;
  var bridgeCopy = false;
  function owns(target) {
    return tooltip.owns(target) || alsoOwns(target);
  }
  async function ask(request) {
    try {
      return asResult(await webext().runtime.sendMessage(request));
    } catch {
      return fail(ErrorCode.INTERNAL);
    }
  }
  function adopt(entries) {
    if (!started2) return;
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
      const config = withDefaults(stored[CONFIG_KEY]);
      const mirror = asMirror(stored[MIRROR_KEY]);
      hideActions = config.hideBubbleActions;
      underline = config.underline;
      bubbleScale = config.bubbleScale;
      ttsLang = config.sourceLang ?? "";
      ttsVoiceURI = config.sourceLang === null ? void 0 : config.ttsVoices[config.sourceLang];
      ttsRate = config.ttsRate;
      noTranslation = config.translationOff;
      if (noTranslation) {
        adopt([]);
        return;
      }
      if (mirror === null) {
        adopt([]);
        return;
      }
      if (mirrorMatches(mirror, config)) {
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
  async function onAction(action, meanings) {
    if (action === "reader") return;
    if (action === "settings") {
      if (openSettings !== null) openSettings();
      else void ask({ kind: Message.OPEN_SETTINGS });
      tooltip.hide();
      return;
    }
    if (action === "speak") {
      if (speaking()) stop();
      else if (current !== null) {
        const voice2 = (noTranslation ? quietVoice?.() : null) ?? { lang: ttsLang, voiceURI: ttsVoiceURI };
        speak(current.text, voice2.lang, voice2.voiceURI, ttsRate / 100);
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
    if (mine2 !== generation || !tooltip.isOpen()) return;
    if (!result.ok) {
      tooltip.setBody(describeError(result.code), "error");
      tooltip.setActions([]);
      return;
    }
    remember(phrase);
    repaint();
    if (next === null) {
      tooltip.hide();
      clearSelection();
      autoKept = null;
      current = null;
      secondLayer = [];
      unfetched = null;
      return;
    }
    tooltip.setActions([...next, ...secondLayer]);
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
  function showSaved(anchor, text, normalized, context3, how = {}) {
    const meanings = vocabulary.get(normalized);
    if (meanings === void 0) return false;
    stop();
    current = { text, normalized, keepable: true };
    generation += 1;
    anchorRange = how.range === void 0 ? null : how.range.cloneRange();
    if (how.range === void 0) unmark();
    else mark(how.range);
    secondLayer = ["more"];
    unfetched = { context: context3 };
    tooltip.show({
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
      coarse: touchPointer(lastPointerType),
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
    tooltip.setContext(t("bubble_translating"), "pending");
    const answer = ask(
      wanted.context === null ? { kind: Message.TRANSLATE, text: phrase.text } : { kind: Message.TRANSLATE, text: phrase.text, context: wanted.context }
    );
    const result = await answer;
    if (mine2 !== generation || !tooltip.isOpen()) return;
    if (!result.ok) {
      unfetched = wanted;
      tooltip.setContext(describeError(result.code), "error");
      return;
    }
    const { sentence, entries } = asTranslation(result.value);
    const blocks = entryBlocks(entries ?? [], phrase.normalized);
    if ((sentence === null || sentence.length === 0) && blocks.length === 0) {
      tooltip.setContext(t("bubble_nothing_more"), "note");
      tooltip.setEntries([]);
      return;
    }
    tooltip.setContext(sentence);
    tooltip.setEntries(blocks);
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
      tooltip.hide();
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
      tooltip.show({
        anchor: selection.rect,
        line: firstLineOf(selection.range),
        variant: "quiet",
        body: "",
        actions: [...SPEAK, ...COPY],
        phrase: text,
        touch,
        coarse: touchPointer(lastPointerType),
        scale: bubbleScale / 100,
        anchored
      });
      if (quietLookup !== null) {
        void quietLookup(text).then((entries) => {
          if (mine3 !== generation || !tooltip.isOpen()) return;
          if (entries.length > 0) tooltip.setEntries(entryBlocks(entries, normalized));
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
    tooltip.show({
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
      coarse: touchPointer(lastPointerType),
      scale: bubbleScale / 100,
      folded: hideActions,
      anchored
    });
    const request = selection.context === null ? { kind: Message.TRANSLATE, text } : { kind: Message.TRANSLATE, text, context: selection.context };
    const answer = ask(request);
    void answer.then((result) => {
      if (mine2 !== generation || !tooltip.isOpen()) return;
      if (!result.ok) {
        tooltip.setBody(describeError(result.code), "error");
        tooltip.setActions(result.code === ErrorCode.MODEL_MISSING ? ["settings"] : []);
        tooltip.reveal();
        return;
      }
      const { gloss, sentence, entries } = asTranslation(result.value);
      tooltip.setBody(gloss, "normal");
      tooltip.setContext(sentence);
      const blocks = entryBlocks(entries ?? [], normalized);
      tooltip.setEntries(blocks);
      secondLayer = sentence !== null && sentence.length > 0 || blocks.length > 0 ? ["more"] : [];
      const decision = keeping({ normalized, gloss, findable: selection.findable, deliberate });
      tooltip.setActions([...OFFERED[decision], ...secondLayer]);
      if (decision === "ask") tooltip.reveal();
      if (decision === "automatic") {
        if (chain) autoKept = { text, normalized };
        void keep([gloss], KEPT);
      }
    });
  }
  function presentGesture(range2, kind) {
    const selection = fromRange(range2);
    if (selection === null) return;
    if (kind !== "extend" && tooltip.isOpen() && current !== null && current.text === selection.text) return;
    if (kind === "press") autoKept = null;
    present(selection, { deliberate: kind === "press", touch: false, chain: true });
  }
  function onPointerDown(event) {
    lastPointerType = event.pointerType;
  }
  function onSelectionChange() {
    if (!touchPointer(lastPointerType)) return;
    if (settleTimer !== null) window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(settled, SETTLE_MS);
    yieldToSelection();
  }
  function yieldToSelection() {
    if (!tooltip.isOpen() || tooltip.isEditing()) return;
    const selection = window.getSelection();
    if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return;
    const text = trimPhrase(selection.toString());
    if (text.length === 0 || current !== null && text === current.text) return;
    tooltip.hide();
    current = null;
    secondLayer = [];
    unfetched = null;
  }
  function settled() {
    settleTimer = null;
    if (tooltip.isEditing()) return;
    const selection = readSelection();
    if (selection === null) return;
    if (tooltip.isOpen() && current !== null && current.text === selection.text) return;
    present(selection, { deliberate: false, touch: true });
  }
  function chordTaken(target) {
    if (tooltip.isEditing()) return true;
    if (target instanceof HTMLElement) {
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return true;
    }
    const selection = window.getSelection();
    return selection !== null && !selection.isCollapsed;
  }
  function onKeyDown(event) {
    if (!tooltip.isOpen()) return;
    if (bridgeCopy && current !== null && copyCombo({ key: event.key, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey, shift: event.shiftKey }) && !chordTaken(event.target)) {
      void navigator.clipboard.writeText(current.text).catch(() => void 0);
      return;
    }
    if (event.key !== "Escape") return;
    tooltip.escape();
    if (!tooltip.isOpen()) {
      clearSelection();
      autoKept = null;
    }
  }
  function onScroll2(event) {
    if (anchored) return;
    if (!tooltip.isOpen() || tooltip.owns(event.target)) return;
    const rect = anchorRange === null ? null : anchorRange.getBoundingClientRect();
    if (rect !== null && rect.width > 0 && rect.height > 0) {
      tooltip.follow(rect);
      return;
    }
    if (!tooltip.isEditing()) tooltip.hide();
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
    if (!started2) {
      started2 = true;
      document.addEventListener("mousedown", onMouseDown2, { capture: true, passive: true });
      document.addEventListener("mouseup", onMouseUp, { capture: true, passive: true });
      document.addEventListener("keydown", onKeyDown, { capture: true, passive: true });
      document.addEventListener("scroll", onScroll2, { capture: true, passive: true });
      if (navigator.maxTouchPoints > 0) {
        document.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
        document.addEventListener("selectionchange", onSelectionChange);
      }
      if (where.ownSelection === true) {
        startSelect({
          root: root ?? document.body,
          owns: (target) => owns(target),
          onSelected: presentGesture,
          onSelectStart: () => tooltip.hide(),
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
    if (!started2) return;
    started2 = false;
    document.removeEventListener("mousedown", onMouseDown2, { capture: true });
    document.removeEventListener("mouseup", onMouseUp, { capture: true });
    document.removeEventListener("keydown", onKeyDown, { capture: true });
    document.removeEventListener("scroll", onScroll2, { capture: true });
    document.removeEventListener("pointerdown", onPointerDown, { capture: true });
    document.removeEventListener("selectionchange", onSelectionChange);
    stopSelect();
    webext().storage.onChanged.removeListener(onStorageChanged);
    if (settleTimer !== null) {
      window.clearTimeout(settleTimer);
      settleTimer = null;
    }
    tooltip.hide();
    current = null;
    secondLayer = [];
    unfetched = null;
    autoKept = null;
    anchorRange = null;
    press = null;
    lastPointerType = "";
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
  function dismiss() {
    clearSelection();
    autoKept = null;
    tooltip.hide();
    current = null;
    secondLayer = [];
    unfetched = null;
  }
  function rescan() {
    clearSelection();
    autoKept = null;
    repaint();
  }

  // src/lib/appearance.js
  function applyTheme(root2, theme) {
    root2.dataset["readerTheme"] = theme;
  }
  function applyReading(root2, reader) {
    applyTheme(root2, reader.theme);
    root2.dataset["readerFont"] = reader.font;
    root2.style.setProperty("--reader-size", `${reader.fontSize}px`);
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
    const offer = (form2) => {
      if (form2.length >= MIN_LENGTH && form2 !== word) forms.add(form2);
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
      ).forEach((dictionary, at2) => {
        if (dictionary.rank !== at2) meta.put({ ...dictionary, rank: at2 });
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
  async function lookupEntries(keys, langFrom) {
    if (keys.length === 0) return [];
    return await withStores([META, ENTRIES], "readonly", async (transaction) => {
      const installed = (
        /** @type {Dictionary[]} */
        await promisify(transaction.objectStore(META).getAll())
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
            await promisify(store.get([dictionary.id, key]))
          );
          if (row === void 0) continue;
          const target = row.aliasOf === void 0 ? row : (
            /** @type {import("./rows.js").DictionaryRow | undefined} */
            await promisify(store.get([dictionary.id, row.aliasOf]))
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

  // src/lib/reader/sanitize.js
  var KEPT2 = /* @__PURE__ */ new Set([
    "p",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "blockquote",
    "q",
    "cite",
    "pre",
    "code",
    "kbd",
    "samp",
    "var",
    "em",
    "strong",
    "i",
    "b",
    "u",
    "s",
    "del",
    "ins",
    "small",
    "mark",
    "sub",
    "sup",
    "abbr",
    "time",
    "span",
    "div",
    "br",
    "hr",
    "ul",
    "ol",
    "li",
    "dl",
    "dt",
    "dd",
    "figure",
    "figcaption",
    "table",
    "caption",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "th",
    "td",
    "a"
  ]);
  var DROPPED = /* @__PURE__ */ new Set([
    "script",
    "style",
    "noscript",
    "template",
    "head",
    "title",
    "meta",
    "link",
    "base",
    "iframe",
    "frame",
    "frameset",
    "object",
    "embed",
    "applet",
    "portal",
    "canvas",
    "svg",
    "math",
    "video",
    "audio",
    "source",
    "track",
    "img",
    "picture",
    "map",
    "area",
    "form",
    "input",
    "button",
    "select",
    "textarea",
    "option",
    "optgroup",
    "label",
    "fieldset",
    "legend",
    "dialog",
    "menu",
    "slot"
  ]);
  var ATTRIBUTES = /* @__PURE__ */ new Map([
    ["a", ["href"]],
    ["abbr", ["title"]],
    ["time", ["datetime"]],
    ["th", ["colspan", "rowspan", "scope"]],
    ["td", ["colspan", "rowspan"]],
    ["ol", ["start", "reversed", "type"]],
    ["li", ["value"]],
    ["blockquote", ["cite"]],
    ["q", ["cite"]]
  ]);
  var EVERYWHERE = ["lang", "dir"];
  var SAFE_SCHEMES = /* @__PURE__ */ new Set(["http:", "https:", "mailto:"]);
  function decide(tagName) {
    const name2 = tagName.toLowerCase();
    if (DROPPED.has(name2)) return "drop";
    if (KEPT2.has(name2)) return "keep";
    return "unwrap";
  }
  function allowedAttributes(tagName) {
    return [...ATTRIBUTES.get(tagName.toLowerCase()) ?? [], ...EVERYWHERE];
  }
  function safeHref(value, base) {
    if (typeof value !== "string" || value.length === 0) return null;
    try {
      const url = new URL(value, base);
      return SAFE_SCHEMES.has(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  }

  // src/lib/reader/article.js
  var ELEMENT_NODE = 1;
  var TEXT_NODE = 3;
  var URL_ATTRIBUTES = /* @__PURE__ */ new Set(["href", "cite"]);
  function buildArticle(source, target, options) {
    const root2 = target.createElement("div");
    appendChildren(source, root2, target, options.baseUrl);
    return root2;
  }
  function appendChildren(source, into, target, baseUrl) {
    for (const child of Array.from(source.childNodes)) {
      appendNode(child, into, target, baseUrl);
    }
  }
  function appendNode(node, into, target, baseUrl) {
    if (node.nodeType === TEXT_NODE) {
      const text = node.nodeValue ?? "";
      if (text.length > 0) into.appendChild(target.createTextNode(text));
      return;
    }
    if (node.nodeType !== ELEMENT_NODE) return;
    const element = (
      /** @type {Element} */
      node
    );
    const decision = decide(element.tagName);
    if (decision === "drop") return;
    if (decision === "unwrap") {
      appendChildren(element, into, target, baseUrl);
      return;
    }
    const name2 = element.tagName.toLowerCase();
    const rebuilt = target.createElement(name2);
    copyAttributes(element, rebuilt, name2, baseUrl);
    appendChildren(element, rebuilt, target, baseUrl);
    into.appendChild(rebuilt);
  }
  function copyAttributes(source, rebuilt, name2, baseUrl) {
    for (const attribute of allowedAttributes(name2)) {
      const value = source.getAttribute(attribute);
      if (typeof value !== "string" || value.length === 0) continue;
      if (URL_ATTRIBUTES.has(attribute)) {
        const href = safeHref(value, baseUrl);
        if (href !== null) rebuilt.setAttribute(attribute, href);
        continue;
      }
      rebuilt.setAttribute(attribute, value);
    }
    if (name2 === "a" && safeHref(source.getAttribute("href"), baseUrl) !== null) {
      rebuilt.setAttribute("target", "_blank");
      rebuilt.setAttribute("rel", "noreferrer noopener");
    }
  }

  // src/lib/reader/history-state.js
  var MARK = "reread";
  function docState(kind, url) {
    return { [MARK]: "doc", kind, url };
  }
  function asDocState(state2) {
    if (typeof state2 !== "object" || state2 === null) return null;
    const { [MARK]: mark3, kind, url } = (
      /** @type {Record<string, unknown>} */
      state2
    );
    if (mark3 !== "doc") return null;
    if (kind !== "article" && kind !== "book") return null;
    if (typeof url !== "string" || url.length === 0) return null;
    return { kind, url };
  }
  function marksState(scope2) {
    return { [MARK]: "marks", scope: scope2 };
  }
  function asMarksState(state2) {
    if (typeof state2 !== "object" || state2 === null) return null;
    const { [MARK]: mark3, scope: scope2 } = (
      /** @type {Record<string, unknown>} */
      state2
    );
    if (mark3 !== "marks") return null;
    if (scope2 !== null && (typeof scope2 !== "string" || scope2.length === 0)) return null;
    return { scope: scope2 };
  }

  // src/lib/reader/import-kind.js
  var ZIP_MAGIC = [80, 75];
  function importKind({ name: name2, type, head }) {
    const lower = name2.toLowerCase();
    if (lower.endsWith(".epub")) return "book";
    if (lower.endsWith(".json")) return "articles";
    if (type.includes("epub")) return "book";
    if (type.includes("json")) return "articles";
    if (ZIP_MAGIC.every((byte, at2) => head[at2] === byte)) return "book";
    return "articles";
  }

  // src/lib/reader/keys.js
  var TYPING = /* @__PURE__ */ new Set(["INPUT", "TEXTAREA", "SELECT"]);
  var PRESSABLE = /* @__PURE__ */ new Set(["BUTTON", "A", "SUMMARY"]);
  function speechAction(press2) {
    if (press2.alt || press2.ctrl || press2.meta) return null;
    if (press2.editable || TYPING.has(press2.tag)) return null;
    switch (press2.key) {
      case " ":
        return PRESSABLE.has(press2.tag) ? null : "toggle";
      case "ArrowLeft":
        return "back";
      case "ArrowRight":
        return "forward";
      // Shift and the comma, shift and the full stop: the speed pair every video
      // player has, on the two keys that carry these characters here.
      case "<":
        return "slower";
      case ">":
        return "faster";
      default:
        return null;
    }
  }

  // src/lib/reader/paging.js
  var TYPING2 = /* @__PURE__ */ new Set(["INPUT", "TEXTAREA", "SELECT"]);
  var PAGE_ITSELF = /* @__PURE__ */ new Set(["", "BODY", "HTML"]);
  function pageTurn(press2) {
    if (press2.alt || press2.ctrl || press2.meta) return null;
    if (press2.dialog) return null;
    if (press2.editable || TYPING2.has(press2.tag)) return null;
    switch (press2.key) {
      case "PageDown":
        return "down";
      case "PageUp":
        return "up";
      case " ":
        if (press2.reading || !PAGE_ITSELF.has(press2.tag)) return null;
        return press2.shift ? "up" : "down";
      default:
        return null;
    }
  }
  function pageStep(band, overlap) {
    const height = Math.max(0, band.bottom - band.top);
    return Math.max(overlap, height - overlap);
  }
  function foldSnap(turn, fold, line, limit) {
    if (line === null) return 0;
    if (line.top >= fold - 1 || line.bottom <= fold + 1) return 0;
    const nudge = turn === "down" ? line.top - fold : line.bottom - fold;
    return Math.abs(nudge) > limit ? 0 : nudge;
  }

  // src/lib/reader/position.js
  var POSITION_SAVE_DELAY = 1500;
  function isIndex2(value) {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
  }
  function isPercent(value) {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;
  }
  function positionRecord(docId, segmentIndex, blockIndex, now, percent) {
    if (typeof docId !== "string" || docId.length === 0) return null;
    if (!isIndex2(segmentIndex) || !isIndex2(blockIndex)) return null;
    if (typeof now !== "number" || !Number.isFinite(now)) return null;
    const record = { docId, segmentIndex, blockIndex, updatedAt: now };
    return isPercent(percent) ? { ...record, percent } : record;
  }
  function asPosition(value) {
    if (typeof value !== "object" || value === null) return null;
    const { docId, segmentIndex, blockIndex, updatedAt, percent } = (
      /** @type {Record<string, unknown>} */
      value
    );
    if (typeof docId !== "string" || docId.length === 0) return null;
    if (!isIndex2(segmentIndex) || !isIndex2(blockIndex)) return null;
    const row = {
      docId,
      segmentIndex,
      blockIndex,
      updatedAt: typeof updatedAt === "number" && Number.isFinite(updatedAt) ? updatedAt : 0
    };
    return isPercent(percent) ? { ...row, percent } : row;
  }
  function measuredPercent(scrollY, viewportHeight, scrollHeight) {
    if (!Number.isFinite(scrollY) || !Number.isFinite(viewportHeight) || !Number.isFinite(scrollHeight))
      return null;
    if (scrollHeight <= 0 || viewportHeight <= 0) return null;
    const edge = (scrollY + viewportHeight) / scrollHeight;
    return Math.min(100, Math.max(0, Math.round(edge * 100)));
  }
  function overallPercent(position, segmentCount) {
    if (position === null) return null;
    if (!Number.isInteger(segmentCount) || segmentCount <= 1) return position.percent ?? null;
    const within3 = (position.percent ?? 0) / 100;
    const whole = (position.segmentIndex + within3) / segmentCount;
    return Math.min(100, Math.max(0, Math.round(whole * 100)));
  }
  function fineScrollTop(blockTop, blockHeight, viewportHeight, percent, scrollHeight) {
    if (!isPercent(percent)) return null;
    if (!Number.isFinite(blockTop) || !Number.isFinite(blockHeight)) return null;
    if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return null;
    if (!Number.isFinite(scrollHeight) || scrollHeight <= 0) return null;
    if (blockHeight <= viewportHeight) return null;
    const fromPercent = percent / 100 * scrollHeight - viewportHeight;
    const lowest = blockTop + blockHeight - viewportHeight;
    return Math.round(Math.min(lowest, Math.max(blockTop, fromPercent)));
  }
  function restoredIndex(position, segmentIndex, blockCount) {
    if (position === null) return null;
    if (position.segmentIndex !== segmentIndex) return null;
    if (position.blockIndex >= blockCount) return null;
    return position.blockIndex;
  }
  function blockAtLine(rects, y) {
    if (rects.length === 0) return null;
    const at2 = rects.findIndex((rect) => rect.bottom > y);
    return at2 === -1 ? rects.length - 1 : at2;
  }

  // src/lib/reader/search.js
  var MIN_QUERY = 2;
  var DOC_HIT_CAP = 200;
  var SNIPPET_CONTEXT = 30;
  var LIBRARY_BATCH = 20;
  var DOC_HIT_LIMIT = 50;
  var SHOWN_SNIPPETS = 3;
  var ARTIFACT = new RegExp("^[\\u00AD\\u200B]+$");
  var COMBINING = new RegExp("^\\p{M}$", "u");
  var WHITESPACE2 = /^\s+$/u;
  function charLength(text, at2) {
    const code = text.codePointAt(at2) ?? 0;
    return code > 65535 ? 2 : 1;
  }
  function foldForSearch(text) {
    let folded = "";
    const starts = [];
    const ends = [];
    let at2 = 0;
    while (at2 < text.length) {
      let length = charLength(text, at2);
      while (at2 + length < text.length) {
        const mark3 = text.slice(at2 + length, at2 + length + charLength(text, at2 + length));
        if (!COMBINING.test(mark3)) break;
        length += mark3.length;
      }
      const end = at2 + length;
      const piece = text.slice(at2, end).normalize("NFC").toLowerCase();
      if (ARTIFACT.test(piece)) {
        at2 = end;
        continue;
      }
      if (WHITESPACE2.test(piece)) {
        if (folded.length === 0) {
        } else if (folded.endsWith(" ")) {
          ends[ends.length - 1] = end;
        } else {
          folded += " ";
          starts.push(at2);
          ends.push(end);
        }
        at2 = end;
        continue;
      }
      for (let unit = 0; unit < piece.length; unit += 1) {
        starts.push(at2);
        ends.push(end);
      }
      folded += piece;
      at2 = end;
    }
    return { folded, starts, ends };
  }
  function foldQuery(query) {
    return foldForSearch(query).folded.trim();
  }
  function isSearchableQuery(query) {
    return foldQuery(query).length >= MIN_QUERY;
  }
  function findHits(folded, foldedQuery) {
    if (foldedQuery.length === 0) return [];
    const hits = [];
    let from = 0;
    for (; ; ) {
      const at2 = folded.indexOf(foldedQuery, from);
      if (at2 === -1) return hits;
      hits.push({ start: at2, end: at2 + foldedQuery.length });
      from = at2 + foldedQuery.length;
    }
  }
  function hitsInText(text, foldedQuery) {
    const fold = foldForSearch(text);
    const spans = [];
    for (const hit of findHits(fold.folded, foldedQuery)) {
      const start2 = fold.starts[hit.start];
      const end = fold.ends[hit.end - 1];
      if (start2 === void 0 || end === void 0) continue;
      spans.push({ start: start2, end });
    }
    return spans;
  }
  function isHighSurrogate(code) {
    return code >= 55296 && code <= 56319;
  }
  function isLowSurrogate(code) {
    return code >= 56320 && code <= 57343;
  }
  function onOneLine(piece) {
    return piece.replace(/\s+/gu, " ");
  }
  function snippetAround(text, span2, budget = SNIPPET_CONTEXT) {
    const from = Math.max(0, span2.start - budget);
    const to = Math.min(text.length, span2.end + budget);
    let before = text.slice(from, span2.start);
    let after = text.slice(span2.end, to);
    if (before.length > 0 && isLowSurrogate(before.charCodeAt(0))) before = before.slice(1);
    if (after.length > 0 && isHighSurrogate(after.charCodeAt(after.length - 1))) {
      after = after.slice(0, -1);
    }
    return {
      before: (from > 0 ? "\u2026" : "") + onOneLine(before),
      match: onOneLine(text.slice(span2.start, span2.end)),
      after: onOneLine(after) + (to < text.length ? "\u2026" : "")
    };
  }
  function metaMatches(searchable, foldedQuery) {
    return foldedQuery.length > 0 && foldForSearch(searchable).folded.includes(foldedQuery);
  }
  function snippetPlan(total) {
    const shown2 = Math.min(Math.max(0, total), SHOWN_SNIPPETS);
    return { shown: shown2, more: Math.max(0, total) - shown2 };
  }
  function chapterOf(toc, segmentIndex, block) {
    let found = null;
    for (const entry of toc) {
      if (entry.segmentIndex < segmentIndex || entry.segmentIndex === segmentIndex && entry.blockIndex <= block) {
        found = entry;
      }
    }
    return found;
  }

  // src/lib/session.js
  var READER_TAB_KEY = "readerTabId";
  var READER_SOURCE_KEY = "readerSource";
  var BACK_ROAD_KEY = "reread.backRoad";
  async function writeTabId(key, tabId, session) {
    if (tabId === null) await session.remove(key);
    else await session.set({ [key]: tabId });
  }
  async function writeReaderTab(tabId, session = webext().storage.session) {
    await writeTabId(READER_TAB_KEY, tabId, session);
  }
  async function readReaderSource(session = webext().storage.session) {
    const stored = await session.get(READER_SOURCE_KEY);
    const source = stored[READER_SOURCE_KEY];
    if (typeof source !== "object" || source === null) return null;
    const { tabId, at: at2, marks } = (
      /** @type {Record<string, unknown>} */
      source
    );
    if (typeof at2 !== "number") return null;
    if (marks === true) return { marks: true, at: at2 };
    if (typeof tabId !== "number") return null;
    return { tabId, at: at2 };
  }

  // src/lib/store/saved-article.js
  var Segment = Object.freeze({
    UNREAD: "unread",
    READ: "read"
  });
  function savedArticle({ url, title, content, dir, lang, savedAt }) {
    if (typeof url !== "string" || url.length === 0) return null;
    if (typeof content !== "string" || content.length === 0) return null;
    if (typeof savedAt !== "number" || !Number.isFinite(savedAt)) return null;
    let hostname;
    try {
      hostname = new URL(url).hostname;
    } catch {
      return null;
    }
    const shown2 = typeof title === "string" ? title.trim() : "";
    return {
      url,
      hostname,
      title: shown2.length > 0 ? shown2 : hostname.length > 0 ? hostname : url,
      savedAt,
      readAt: null,
      content,
      dir: keptWord(dir),
      lang: keptWord(lang)
    };
  }
  function keptWord(value) {
    if (typeof value !== "string") return null;
    const word = value.trim();
    return word.length > 0 && word.length <= 40 ? word : null;
  }
  function asSavedMeta(value) {
    if (typeof value !== "object" || value === null) return null;
    const { url, hostname, title, savedAt, readAt } = (
      /** @type {Record<string, unknown>} */
      value
    );
    if (typeof url !== "string" || url.length === 0) return null;
    const host = typeof hostname === "string" ? hostname : "";
    const shown2 = typeof title === "string" && title.length > 0 ? title : host.length > 0 ? host : url;
    return {
      url,
      hostname: host,
      title: shown2,
      savedAt: typeof savedAt === "number" && Number.isFinite(savedAt) ? savedAt : 0,
      readAt: typeof readAt === "number" && Number.isFinite(readAt) ? readAt : null
    };
  }
  function listedRows(metas, segment2) {
    const activity = (meta) => Math.max(meta.savedAt, meta.lastReadAt ?? 0);
    return metas.filter((meta) => segment2 === Segment.READ ? meta.readAt !== null : meta.readAt === null).sort((a, b) => activity(b) - activity(a) || a.url.localeCompare(b.url));
  }
  function emptySentence(total, segment2) {
    if (total === 0) {
      return t("reader_empty_none", t("reader_save"));
    }
    return segment2 === Segment.READ ? t("reader_empty_none_read") : t("reader_empty_all_read");
  }

  // src/lib/store/articles-file.js
  var MAX_MARKS_PER_ARTICLE = 1e3;
  var FORMAT = "reread-articles";
  var VERSION = 1;
  var ARTICLES_FILENAME = "reread-articles.json";
  function toArticlesFile(articles, marks = /* @__PURE__ */ new Map()) {
    const rows2 = [...articles].sort((a, b) => a.savedAt - b.savedAt || a.url.localeCompare(b.url)).map(({ url, title, savedAt, readAt, content, dir, lang }) => {
      const kept = marks.get(url);
      return {
        url,
        title,
        savedAt,
        readAt,
        content,
        dir,
        lang,
        ...kept === void 0 || kept.length === 0 ? {} : { marks: kept }
      };
    });
    return JSON.stringify({ format: FORMAT, version: VERSION, articles: rows2 }, null, 2) + "\n";
  }
  function fromArticlesFile(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { articles: [], invalid: 0 };
    }
    if (typeof parsed !== "object" || parsed === null) return { articles: [], invalid: 0 };
    const { format, articles } = (
      /** @type {Record<string, unknown>} */
      parsed
    );
    if (format !== FORMAT || !Array.isArray(articles)) return { articles: [], invalid: 0 };
    const kept = [];
    let invalid = 0;
    for (const entry of articles) {
      const article2 = asFileArticle(entry);
      if (article2 === null) invalid += 1;
      else kept.push(article2);
    }
    return { articles: kept, invalid };
  }
  function asFileArticle(value) {
    if (typeof value !== "object" || value === null) return null;
    const { url, title, savedAt, readAt, content, dir, lang, marks } = (
      /** @type {Record<string, unknown>} */
      value
    );
    if (typeof url !== "string" || typeof content !== "string") return null;
    if (typeof savedAt !== "number") return null;
    if (content.length > MAX_PAGE_HTML) return null;
    const built = savedArticle({
      url,
      title: typeof title === "string" ? title : "",
      content,
      dir: typeof dir === "string" ? dir : null,
      lang: typeof lang === "string" ? lang : null,
      savedAt
    });
    if (built === null) return null;
    const kept = asFileMarks(marks);
    return {
      ...built,
      readAt: typeof readAt === "number" && Number.isFinite(readAt) ? readAt : null,
      ...kept.length === 0 ? {} : { marks: kept }
    };
  }
  function asFileMarks(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, MAX_MARKS_PER_ARTICLE).map(asMark).filter((mark3) => mark3 !== null).sort(compareMarks);
  }
  function importPlan(existingUrls, articles) {
    const taken = new Set(existingUrls);
    const toAdd = [];
    let skipped = 0;
    for (const article2 of articles) {
      if (taken.has(article2.url)) {
        skipped += 1;
        continue;
      }
      taken.add(article2.url);
      toAdd.push(article2);
    }
    return { toAdd, skipped };
  }

  // src/lib/store/library-db.js
  var DB_NAME2 = "reread-articles";
  var DB_VERSION2 = 4;
  var META2 = "meta";
  var CONTENT = "content";
  var POSITIONS = "positions";
  var BOOKS = "books";
  var BOOK_SEGMENTS = "bookSegments";
  var MARKS = "marks";
  var ALL_STORES = [META2, CONTENT, POSITIONS, BOOKS, BOOK_SEGMENTS, MARKS];
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
        if (!db.objectStoreNames.contains(META2)) db.createObjectStore(META2, { keyPath: "url" });
        if (!db.objectStoreNames.contains(CONTENT)) db.createObjectStore(CONTENT, { keyPath: "url" });
        if (!db.objectStoreNames.contains(POSITIONS)) {
          db.createObjectStore(POSITIONS, { keyPath: "docId" });
        }
        if (!db.objectStoreNames.contains(BOOKS)) db.createObjectStore(BOOKS, { keyPath: "id" });
        if (!db.objectStoreNames.contains(BOOK_SEGMENTS)) {
          db.createObjectStore(BOOK_SEGMENTS, { keyPath: ["bookId", "index"] });
        }
        if (!db.objectStoreNames.contains(MARKS)) db.createObjectStore(MARKS, { keyPath: "docId" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Cannot open the articles database"));
      request.onblocked = () => reject(new Error("The articles database is in use by another page"));
    });
  }
  async function withLibrary(mode, work) {
    const db = await open2();
    try {
      const transaction = db.transaction(ALL_STORES, mode);
      const stores = {
        meta: transaction.objectStore(META2),
        content: transaction.objectStore(CONTENT),
        positions: transaction.objectStore(POSITIONS),
        books: transaction.objectStore(BOOKS),
        bookSegments: transaction.objectStore(BOOK_SEGMENTS),
        marks: transaction.objectStore(MARKS)
      };
      const result = await work(stores);
      await new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve(void 0);
        transaction.onerror = () => reject(transaction.error ?? new Error("Articles transaction failed"));
        transaction.onabort = () => reject(transaction.error ?? new Error("Articles transaction aborted"));
      });
      return result;
    } finally {
      db.close();
    }
  }

  // src/lib/store/articles.js
  async function putArticle(article2) {
    const { content, dir, lang, ...meta } = article2;
    await withLibrary("readwrite", async (stores) => {
      await promisify2(stores.meta.put(meta));
      await promisify2(stores.content.put({ url: article2.url, content, dir, lang }));
      await promisify2(stores.positions.delete(article2.url));
      await promisify2(stores.marks.delete(article2.url));
    });
  }
  async function deleteArticle(url) {
    await withLibrary("readwrite", async (stores) => {
      await promisify2(stores.meta.delete(url));
      await promisify2(stores.content.delete(url));
      await promisify2(stores.positions.delete(url));
      await promisify2(stores.marks.delete(url));
    });
  }
  async function getPosition(docId) {
    const row = await withLibrary("readonly", (stores) => promisify2(stores.positions.get(docId)));
    return asPosition(row);
  }
  async function allPositions() {
    const rows2 = (
      /** @type {unknown[]} */
      await withLibrary("readonly", (stores) => promisify2(stores.positions.getAll()))
    );
    const positions = /* @__PURE__ */ new Map();
    for (const row of rows2) {
      const position = asPosition(row);
      if (position !== null) positions.set(position.docId, position);
    }
    return positions;
  }
  async function putPosition(position) {
    await withLibrary("readwrite", async (stores) => {
      await promisify2(stores.positions.put(position));
    });
  }
  async function getArticleMeta(url) {
    const row = await withLibrary("readonly", (stores) => promisify2(stores.meta.get(url)));
    return asSavedMeta(row);
  }
  async function listArticles() {
    const rows2 = (
      /** @type {unknown[]} */
      await withLibrary("readonly", (stores) => promisify2(stores.meta.getAll()))
    );
    return rows2.map(asSavedMeta).filter((meta) => meta !== null);
  }
  async function getArticle(url) {
    const { meta, stored } = await withLibrary("readonly", async (stores) => ({
      meta: asSavedMeta(await promisify2(stores.meta.get(url))),
      stored: (
        /** @type {unknown} */
        await promisify2(stores.content.get(url))
      )
    }));
    if (meta === null || typeof stored !== "object" || stored === null) return null;
    const { content, dir, lang } = (
      /** @type {Record<string, unknown>} */
      stored
    );
    if (typeof content !== "string" || content.length === 0) return null;
    return {
      ...meta,
      content,
      dir: typeof dir === "string" && dir.length > 0 ? dir : null,
      lang: typeof lang === "string" && lang.length > 0 ? lang : null
    };
  }
  async function allArticles() {
    const { metas, stored } = await withLibrary("readonly", async (stores) => ({
      metas: (
        /** @type {unknown[]} */
        await promisify2(stores.meta.getAll())
      ),
      stored: (
        /** @type {unknown[]} */
        await promisify2(stores.content.getAll())
      )
    }));
    const contents = /* @__PURE__ */ new Map();
    for (const row of stored) {
      if (typeof row !== "object" || row === null) continue;
      const { url, content, dir, lang } = (
        /** @type {Record<string, unknown>} */
        row
      );
      if (typeof url !== "string" || typeof content !== "string" || content.length === 0) continue;
      contents.set(url, {
        content,
        dir: typeof dir === "string" && dir.length > 0 ? dir : null,
        lang: typeof lang === "string" && lang.length > 0 ? lang : null
      });
    }
    const articles = [];
    for (const row of metas) {
      const meta = asSavedMeta(row);
      if (meta === null) continue;
      const held2 = contents.get(meta.url);
      if (held2 !== void 0) articles.push({ ...meta, ...held2 });
    }
    return articles;
  }
  async function importArticles(articles) {
    return await withLibrary("readwrite", async (stores) => {
      const keys = (
        /** @type {IDBValidKey[]} */
        await promisify2(stores.meta.getAllKeys())
      );
      const { toAdd, skipped } = importPlan(keys.map(String), articles);
      for (const article2 of toAdd) {
        const { content, dir, lang, marks, ...meta } = article2;
        await promisify2(stores.meta.put(meta));
        await promisify2(stores.content.put({ url: article2.url, content, dir, lang }));
        if (marks !== void 0 && marks.length > 0) {
          await promisify2(stores.marks.put({ docId: article2.url, marks }));
        }
      }
      return { added: toAdd.length, skipped };
    });
  }
  async function setReadAt(url, readAt) {
    return await withLibrary("readwrite", async (stores) => {
      const row = asSavedMeta(await promisify2(stores.meta.get(url)));
      if (row === null) return null;
      const updated = { ...row, readAt };
      await promisify2(stores.meta.put(updated));
      return updated;
    });
  }

  // src/lib/book/blocks.js
  var ELEMENT_NODE2 = 1;
  var TEXT_NODE2 = 3;
  function isWrapper(element) {
    let holdsElement = false;
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === ELEMENT_NODE2) {
        holdsElement = true;
        continue;
      }
      if (child.nodeType === TEXT_NODE2 && (child.nodeValue ?? "").trim().length > 0) {
        return false;
      }
    }
    return holdsElement;
  }
  function* packableBlocks(root2) {
    for (const child of Array.from(root2.childNodes)) {
      if (child.nodeType !== ELEMENT_NODE2) continue;
      const element = (
        /** @type {Element} */
        child
      );
      if (element.localName === "div" && isWrapper(element)) {
        yield* packableBlocks(element);
      } else {
        yield element;
      }
    }
  }

  // src/lib/book/segment.js
  var SEGMENT_CHAR_BUDGET = 2e4;
  var HEADING_CUT_FROM = 0.75;
  var TAIL_MERGE_BELOW = 0.25;
  function isHeadingTag(name2) {
    return name2 === "h1" || name2 === "h2" || name2 === "h3";
  }
  function segmenter(budget = SEGMENT_CHAR_BUDGET) {
    let open3 = [];
    let openChars = 0;
    let held2 = null;
    const asSegment2 = (blocks) => ({
      blocks: blocks.map((block) => block.payload),
      charCount: blocks.reduce((sum, block) => sum + block.chars, 0)
    });
    const tryClose = (emitted) => {
      let end = open3.length;
      while (end > 0 && open3[end - 1]?.heading === true) end -= 1;
      if (end === 0) return;
      const closing = open3.slice(0, end);
      const carried = open3.slice(end);
      if (held2 !== null) emitted.push(held2);
      held2 = asSegment2(closing);
      open3 = carried;
      openChars = carried.reduce((sum, block) => sum + block.chars, 0);
    };
    return {
      /**
       * @param {PackedBlock<T>} block
       * @returns {Array<Segment<T>>} segments finished by this block, oldest first
       */
      push(block) {
        const emitted = [];
        if (block.heading && openChars >= budget * HEADING_CUT_FROM) {
          tryClose(emitted);
        } else if (openChars >= budget * TAIL_MERGE_BELOW && openChars + block.chars > budget) {
          tryClose(emitted);
        }
        open3.push(block);
        openChars += block.chars;
        if (block.chars > budget) tryClose(emitted);
        return emitted;
      },
      /**
       * The end of the spine: closes what is open and lets the tail go. Here,
       * and only here, a segment may end on a heading - there is nothing after
       * the end of a book for the heading to belong to.
       *
       * @returns {Array<Segment<T>>} the remaining segments, oldest first
       */
      finish() {
        const emitted = [];
        const tail = open3.length > 0 ? asSegment2(open3) : null;
        open3 = [];
        openChars = 0;
        if (tail === null) {
          if (held2 !== null) emitted.push(held2);
        } else if (held2 !== null && tail.charCount < budget * TAIL_MERGE_BELOW) {
          emitted.push({
            blocks: [...held2.blocks, ...tail.blocks],
            charCount: held2.charCount + tail.charCount
          });
        } else {
          if (held2 !== null) emitted.push(held2);
          emitted.push(tail);
        }
        held2 = null;
        return emitted;
      }
    };
  }

  // src/lib/book/toc.js
  var TOC_ENTRY_CAP = 500;
  var TOC_TITLE_CAP = 120;
  var HEADING_BLOCK = /^<h([123])[\s>]/;
  var TAGS = /<[^>"']*(?:"[^"]*"[^>"']*|'[^']*'[^>"']*)*>/g;
  function tocTitle(text) {
    const shown2 = text.replace(/\s+/g, " ").trim();
    if (shown2.length === 0) return null;
    if (shown2.length <= TOC_TITLE_CAP) return shown2;
    return `${shown2.slice(0, TOC_TITLE_CAP - 1).trimEnd()}\u2026`;
  }
  function titleOf(block) {
    const text = block.replace(TAGS, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
    return tocTitle(text);
  }
  function headingEntries(blocks, segmentIndex) {
    const entries = [];
    for (const [blockIndex, block] of blocks.entries()) {
      const heading = HEADING_BLOCK.exec(block);
      if (heading === null) continue;
      const title = titleOf(block);
      if (title === null) continue;
      entries.push({
        title,
        level: (
          /** @type {1 | 2 | 3} */
          Number(heading[1])
        ),
        segmentIndex,
        blockIndex
      });
    }
    return entries;
  }
  function renderedEntries(blocks, segmentIndex) {
    const entries = [];
    for (const [blockIndex, block] of blocks.entries()) {
      if (!isHeadingTag(block.localName)) continue;
      const title = tocTitle(block.text);
      if (title === null) continue;
      entries.push({
        title,
        level: (
          /** @type {1 | 2 | 3} */
          Number(block.localName.slice(1))
        ),
        segmentIndex,
        blockIndex
      });
    }
    return entries;
  }
  function cappedToc(entries) {
    return entries.length <= TOC_ENTRY_CAP ? entries : entries.slice(0, TOC_ENTRY_CAP);
  }

  // src/lib/store/book.js
  function isCount(value) {
    return typeof value === "number" && Number.isInteger(value) && value > 0;
  }
  function keptWord2(value) {
    if (typeof value !== "string") return null;
    const word = value.trim();
    return word.length > 0 && word.length <= 80 ? word : null;
  }
  function isIndex3(value) {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
  }
  function asToc(value) {
    if (!Array.isArray(value)) return null;
    const entries = [];
    for (const entry of value) {
      if (typeof entry !== "object" || entry === null) return null;
      const { title, level, segmentIndex, blockIndex } = (
        /** @type {Record<string, unknown>} */
        entry
      );
      if (typeof title !== "string" || title.length === 0) return null;
      if (level !== 1 && level !== 2 && level !== 3) return null;
      if (!isIndex3(segmentIndex) || !isIndex3(blockIndex)) return null;
      entries.push({ title, level, segmentIndex, blockIndex });
    }
    return entries;
  }
  function bookRecord({ id, title, author, lang, segmentCount, totalChars, addedAt, toc }) {
    if (typeof id !== "string" || id.length === 0) return null;
    const shown2 = typeof title === "string" ? title.trim() : "";
    if (shown2.length === 0) return null;
    if (!isCount(segmentCount)) return null;
    if (typeof totalChars !== "number" || !Number.isFinite(totalChars) || totalChars <= 0) return null;
    if (typeof addedAt !== "number" || !Number.isFinite(addedAt)) return null;
    return {
      id,
      title: shown2,
      author: keptWord2(author),
      lang: keptWord2(lang),
      segmentCount,
      totalChars: Math.floor(totalChars),
      addedAt,
      readAt: null,
      // An import always scanned - a torn list is written as "scanned, nothing
      // found", never as the null that would put a fresh book in the backfill
      // queue for a list the import itself could not produce.
      toc: asToc(toc) ?? []
    };
  }
  function asBookMeta(value) {
    if (typeof value !== "object" || value === null) return null;
    const { id, title, author, lang, segmentCount, totalChars, addedAt, readAt, toc } = (
      /** @type {Record<string, unknown>} */
      value
    );
    if (typeof id !== "string" || id.length === 0) return null;
    if (!isCount(segmentCount)) return null;
    return {
      id,
      title: typeof title === "string" && title.length > 0 ? title : id,
      author: keptWord2(author),
      lang: keptWord2(lang),
      segmentCount: (
        /** @type {number} */
        segmentCount
      ),
      totalChars: typeof totalChars === "number" && Number.isFinite(totalChars) && totalChars > 0 ? totalChars : 0,
      addedAt: typeof addedAt === "number" && Number.isFinite(addedAt) ? addedAt : 0,
      readAt: typeof readAt === "number" && Number.isFinite(readAt) ? readAt : null,
      // Absent on rows from before D116 and whenever an entry does not narrow;
      // both read as "still owed a scan", which the next open provides.
      toc: asToc(toc)
    };
  }
  function asSegment(value) {
    if (typeof value !== "object" || value === null) return null;
    const { blocks, charCount } = (
      /** @type {Record<string, unknown>} */
      value
    );
    if (!Array.isArray(blocks) || blocks.length === 0) return null;
    if (!blocks.every((block) => typeof block === "string")) return null;
    return {
      blocks: (
        /** @type {string[]} */
        blocks
      ),
      charCount: typeof charCount === "number" && Number.isFinite(charCount) ? charCount : 0
    };
  }

  // src/lib/store/books.js
  function segmentRange(bookId) {
    return IDBKeyRange.bound([bookId, 0], [bookId, []]);
  }
  async function putBookSegment(segment2) {
    await withLibrary("readwrite", async (stores) => {
      await promisify2(stores.bookSegments.put(segment2));
    });
  }
  async function putBook(book) {
    await withLibrary("readwrite", async (stores) => {
      await promisify2(stores.books.put(book));
    });
  }
  async function getBook(id) {
    const row = await withLibrary("readonly", (stores) => promisify2(stores.books.get(id)));
    return asBookMeta(row);
  }
  async function listBooks() {
    const rows2 = (
      /** @type {unknown[]} */
      await withLibrary("readonly", (stores) => promisify2(stores.books.getAll()))
    );
    return rows2.map(asBookMeta).filter((book) => book !== null);
  }
  async function getBookSegment(bookId, index2) {
    const row = await withLibrary(
      "readonly",
      (stores) => promisify2(stores.bookSegments.get([bookId, index2]))
    );
    return asSegment(row);
  }
  async function deleteBook(id) {
    await withLibrary("readwrite", async (stores) => {
      await promisify2(stores.books.delete(id));
      await promisify2(stores.bookSegments.delete(segmentRange(id)));
      await promisify2(stores.positions.delete(id));
      await promisify2(stores.marks.delete(id));
    });
  }
  async function setBookReadAt(id, readAt) {
    return await withLibrary("readwrite", async (stores) => {
      const row = asBookMeta(await promisify2(stores.books.get(id)));
      if (row === null) return null;
      const updated = { ...row, readAt };
      await promisify2(stores.books.put(updated));
      return updated;
    });
  }
  async function setBookToc(id, toc) {
    return await withLibrary("readwrite", async (stores) => {
      const row = asBookMeta(await promisify2(stores.books.get(id)));
      if (row === null || row.toc !== null) return false;
      await promisify2(stores.books.put({ ...row, toc }));
      return true;
    });
  }
  async function sweepOrphanSegments() {
    await withLibrary("readwrite", async (stores) => {
      const bookIds = new Set(
        /** @type {IDBValidKey[]} */
        (await promisify2(stores.books.getAllKeys())).map(String)
      );
      const segmentKeys = (
        /** @type {Array<[string, number]>} */
        await promisify2(stores.bookSegments.getAllKeys())
      );
      const strays = /* @__PURE__ */ new Set();
      for (const [bookId] of segmentKeys) {
        if (!bookIds.has(bookId)) strays.add(bookId);
      }
      for (const bookId of strays) {
        await promisify2(stores.bookSegments.delete(segmentRange(bookId)));
        await promisify2(stores.positions.delete(bookId));
        await promisify2(stores.marks.delete(bookId));
      }
    });
  }

  // src/lib/store/marks-file.js
  var MARKS_FILENAME = "reread-highlights.md";
  function toMarksFile(docs) {
    const lines = ["# re/read highlights"];
    const ordered = [...docs].sort((a, b) => a.at - b.at || a.title.localeCompare(b.title));
    for (const doc of ordered) {
      lines.push("", `## ${doc.title}`, "");
      const where = doc.source === null || doc.source.length === 0 ? [] : [doc.source];
      const when = Number.isFinite(doc.at) && doc.at > 0 ? [isoDay(doc.at)] : [];
      const detail = [...where, ...when].join(" - ");
      if (detail.length > 0) lines.push(detail, "");
      for (const [index2, mark3] of doc.marks.entries()) {
        if (index2 > 0) lines.push("");
        for (const line of mark3.text.split("\n")) lines.push(`> ${line}`);
        if (mark3.note !== void 0) {
          lines.push("");
          for (const line of mark3.note.split("\n")) lines.push(line);
        }
      }
    }
    return lines.join("\n") + "\n";
  }
  function isoDay(at2) {
    return new Date(at2).toISOString().slice(0, 10);
  }

  // src/lib/store/marks.js
  async function getMarks(docId) {
    const row = await withLibrary("readonly", (stores) => promisify2(stores.marks.get(docId)));
    if (typeof row !== "object" || row === null) return [];
    const { marks } = (
      /** @type {Record<string, unknown>} */
      row
    );
    if (!Array.isArray(marks)) return [];
    return marks.map(asMark).filter((mark3) => mark3 !== null).sort(compareMarks);
  }
  async function putMarks(docId, marks) {
    await withLibrary("readwrite", async (stores) => {
      if (marks.length === 0) await promisify2(stores.marks.delete(docId));
      else await promisify2(stores.marks.put({ docId, marks }));
    });
  }
  async function allMarks() {
    const rows2 = (
      /** @type {unknown[]} */
      await withLibrary("readonly", (stores) => promisify2(stores.marks.getAll()))
    );
    const map = /* @__PURE__ */ new Map();
    for (const row of rows2) {
      if (typeof row !== "object" || row === null) continue;
      const { docId, marks } = (
        /** @type {Record<string, unknown>} */
        row
      );
      if (typeof docId !== "string" || docId.length === 0 || !Array.isArray(marks)) continue;
      const kept = marks.map(asMark).filter((mark3) => mark3 !== null).sort(compareMarks);
      if (kept.length > 0) map.set(docId, kept);
    }
    return map;
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

  // src/reader/marks-view.js
  var NAME_PREFIX = "reread-marker-";
  var painted2 = [];
  function blockProse(block) {
    const parts = prosePieces(block);
    const { text, spans } = joinPieces(parts.map((part) => part.text));
    return { parts, text, spans };
  }
  function topIndexOf(node, root2) {
    let element = node instanceof Element ? node : node.parentElement;
    for (; element !== null; element = element.parentElement) {
      if (element.parentElement === root2) {
        return Array.prototype.indexOf.call(root2.children, element);
      }
    }
    return null;
  }
  function proseOffset(prose, node, offset) {
    const index2 = prose.parts.findIndex((part) => part.node === node);
    const span2 = prose.spans[index2];
    if (index2 === -1 || span2 === void 0) return null;
    return span2.start + offset;
  }
  function anchorOf(range2, root2, segmentIndex) {
    const startBlock = topIndexOf(range2.startContainer, root2);
    const endBlock = topIndexOf(range2.endContainer, root2);
    if (startBlock === null || endBlock === null) return null;
    const first = root2.children[startBlock];
    const last = root2.children[endBlock];
    if (first === void 0 || last === void 0) return null;
    const start2 = proseOffset(blockProse(first), range2.startContainer, range2.startOffset);
    const end = proseOffset(blockProse(last), range2.endContainer, range2.endOffset);
    if (start2 === null || end === null) return null;
    return {
      segmentIndex,
      start: { block: startBlock, offset: start2 },
      end: { block: endBlock, offset: end }
    };
  }
  function quoteOfSpan(span2, root2) {
    const texts = [];
    for (let at2 = span2.start.block; at2 <= span2.end.block; at2 += 1) {
      const block = root2.children[at2];
      if (block === void 0) return null;
      texts.push(blockProse(block).text);
    }
    return quoteOf(texts, span2.start, span2.end);
  }
  function placeIn(prose, offset) {
    const place = locate(prose.spans, offset);
    const node = place === null ? null : prose.parts[place.piece]?.node ?? null;
    if (place === null || node === null) return null;
    return { node, offset: place.offset };
  }
  function rangeOfMark(mark3, root2) {
    if (quoteOfSpan(mark3, root2) !== mark3.text) return null;
    const first = root2.children[mark3.start.block];
    const last = root2.children[mark3.end.block];
    if (first === void 0 || last === void 0) return null;
    const start2 = placeIn(blockProse(first), mark3.start.offset);
    const end = placeIn(blockProse(last), mark3.end.offset - 1);
    if (start2 === null || end === null) return null;
    const range2 = document.createRange();
    range2.setStart(start2.node, start2.offset);
    range2.setEnd(end.node, end.offset + 1);
    return range2;
  }
  function rangeWithin(root2, blockIndex, from, to) {
    const block = root2.children[blockIndex];
    if (block === void 0 || to <= from) return null;
    const prose = blockProse(block);
    const start2 = placeIn(prose, from);
    const end = placeIn(prose, to - 1);
    if (start2 === null || end === null) return null;
    const range2 = document.createRange();
    range2.setStart(start2.node, start2.offset);
    range2.setEnd(end.node, end.offset + 1);
    return range2;
  }
  function paintMarks(marks, root2, segmentIndex) {
    clearMarkPaint();
    if (!supported() || root2 === null) return;
    const groups = /* @__PURE__ */ new Map();
    for (const mark3 of marksInSegment(marks, segmentIndex)) {
      const range2 = rangeOfMark(mark3, root2);
      if (range2 === null) continue;
      let group = groups.get(mark3.color);
      if (group === void 0) {
        group = new Highlight();
        group.priority = -1;
        groups.set(mark3.color, group);
      }
      group.add(range2);
      painted2.push({ mark: mark3, range: range2 });
    }
    for (const [color, group] of groups) CSS.highlights.set(NAME_PREFIX + color, group);
  }
  function clearMarkPaint() {
    painted2 = [];
    if (!supported()) return;
    for (const color of MARK_COLORS) CSS.highlights.delete(NAME_PREFIX + color);
  }
  function markAt(x, y) {
    for (const { mark: mark3, range: range2 } of painted2) {
      for (const rect of range2.getClientRects()) {
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
        return { mark: mark3, range: range2, rect };
      }
    }
    return null;
  }
  function paintedRangeOf(mark3) {
    for (const entry of painted2) {
      if (entry.mark === mark3) return entry.range;
    }
    return null;
  }
  function adoptPaintedMark(previous, next) {
    for (const entry of painted2) {
      if (entry.mark === previous) entry.mark = next;
    }
  }
  function charBox(node, from, to) {
    const tip = document.createRange();
    try {
      tip.setStart(node, from);
      tip.setEnd(node, to);
    } catch {
      return null;
    }
    const box = tip.getBoundingClientRect();
    return box.width > 0 && box.height > 0 ? box : null;
  }
  function markEdges(range2) {
    const head = charBox(range2.startContainer, range2.startOffset, range2.startOffset + 1) ?? headRect(range2.getClientRects());
    const tail = charBox(range2.endContainer, Math.max(0, range2.endOffset - 1), range2.endOffset) ?? tailRect(range2.getClientRects());
    return { head, tail };
  }
  function proseTextOf(root2, index2) {
    const block = root2.children[index2];
    return block === void 0 ? null : blockProse(block).text;
  }

  // src/reader/doc-search.js
  var dialog = (
    /** @type {HTMLDialogElement | null} */
    document.getElementById("search-dialog")
  );
  var form = document.getElementById("search-form");
  var input = (
    /** @type {HTMLInputElement | null} */
    document.getElementById("search-input")
  );
  var statusLine = document.getElementById("search-status");
  var rows = document.getElementById("search-rows");
  var closeButton = document.getElementById("search-close");
  var context = null;
  var held = null;
  var scanEpoch = 0;
  function configureDocSearch(wiring) {
    context = wiring;
  }
  function openDocSearch(prefill) {
    const doc = context?.doc() ?? null;
    if (dialog === null || input === null || doc === null) return;
    const remembered = held !== null && held.url === doc.url ? held : null;
    const rerun = prefill !== void 0 && (remembered === null || remembered.query !== prefill);
    if (remembered !== null && !rerun) {
      input.value = remembered.query;
      renderResults();
    } else {
      held = null;
      input.value = prefill ?? "";
      clearResults();
    }
    dialog.showModal();
    input.focus();
    input.select();
    if (rerun && prefill !== void 0) void runSearch(prefill);
  }
  function closeDocSearch() {
    if (dialog !== null && dialog.open) dialog.close();
  }
  function resetDocSearch() {
    scanEpoch += 1;
    held = null;
    if (input !== null) input.value = "";
    clearResults();
  }
  function clearResults() {
    rows?.replaceChildren();
    if (statusLine !== null) {
      statusLine.hidden = true;
      statusLine.textContent = "";
    }
  }
  function sayStatus(text) {
    if (statusLine === null) return;
    statusLine.hidden = false;
    statusLine.textContent = text;
  }
  function storedBlockText(html) {
    const block = new DOMParser().parseFromString(html, "text/html").body.firstElementChild;
    if (block === null) return "";
    return prosePieces(block).map((part) => part.text).join("");
  }
  function collectHits(text, segmentIndex, block, folded, into, cap) {
    for (const span2 of hitsInText(text, folded)) {
      if (into.length >= cap) return false;
      into.push({
        segmentIndex,
        block,
        from: span2.start,
        to: span2.end,
        ...snippetAround(text, span2)
      });
    }
    return into.length < cap;
  }
  async function runSearch(query) {
    const doc = context?.doc() ?? null;
    if (doc === null) return;
    if (!isSearchableQuery(query)) {
      held = null;
      rows?.replaceChildren();
      sayStatus(t("reader_search_short"));
      return;
    }
    const folded = foldQuery(query);
    const turn = ++scanEpoch;
    rows?.replaceChildren();
    const hits = [];
    let capped = false;
    if (doc.origin === "book") {
      for (let index2 = 0; index2 < doc.segmentCount; index2 += 1) {
        sayStatus(
          t("reader_book_part_of", [(index2 + 1).toLocaleString(), doc.segmentCount.toLocaleString()])
        );
        const segment2 = await getBookSegment(doc.url, index2);
        if (turn !== scanEpoch) return;
        if (segment2 === null) continue;
        let room = true;
        for (let block = 0; block < segment2.blocks.length && room; block += 1) {
          const text = storedBlockText(segment2.blocks[block] ?? "");
          room = collectHits(text, index2, block, folded, hits, DOC_HIT_CAP);
        }
        if (!room) {
          capped = true;
          break;
        }
      }
    } else {
      const root2 = context?.root() ?? null;
      const count = root2 === null ? 0 : root2.children.length;
      let room = true;
      for (let block = 0; block < count && room; block += 1) {
        const text = root2 === null ? null : proseTextOf(root2, block);
        room = collectHits(text ?? "", 0, block, folded, hits, DOC_HIT_CAP);
      }
      capped = !room;
    }
    if (turn !== scanEpoch) return;
    held = { url: doc.url, query, folded, hits, capped };
    renderResults();
  }
  function renderResults() {
    if (rows === null || held === null) return;
    const doc = context?.doc() ?? null;
    const book = doc !== null && doc.origin === "book" ? doc : null;
    const toc = book === null ? [] : context?.toc() ?? [];
    if (held.hits.length === 0) {
      rows.replaceChildren();
      sayStatus(t("reader_search_none"));
      return;
    }
    const count = plural(held.hits.length, "reader_search_count");
    sayStatus(
      held.capped ? `${count} ${t("reader_search_capped", [DOC_HIT_CAP.toLocaleString()])}` : count
    );
    const built = [];
    let lastLabel = "";
    held.hits.forEach((hit, index2) => {
      if (book !== null) {
        const chapter = chapterOf(toc, hit.segmentIndex, hit.block);
        const part = t("reader_book_part_of", [
          (hit.segmentIndex + 1).toLocaleString(),
          book.segmentCount.toLocaleString()
        ]);
        const label2 = chapter === null ? part : `${part} - ${chapter.title}`;
        if (label2 !== lastLabel) {
          const heading = document.createElement("p");
          heading.className = "search-part";
          heading.textContent = label2;
          built.push(heading);
          lastLabel = label2;
        }
      }
      const row = document.createElement("button");
      row.type = "button";
      row.dataset["index"] = String(index2);
      row.dir = "auto";
      const before = document.createElement("span");
      before.textContent = hit.before;
      const match = document.createElement("b");
      match.textContent = hit.match;
      const after = document.createElement("span");
      after.textContent = hit.after;
      row.append(before, match, after);
      built.push(row);
    });
    rows.replaceChildren(...built);
  }
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void runSearch(input?.value ?? "");
  });
  closeButton?.addEventListener("click", () => closeDocSearch());
  dialog?.addEventListener("close", () => {
    scanEpoch += 1;
  });
  dialog?.addEventListener("click", (event) => {
    if (event.target === dialog) closeDocSearch();
  });
  rows?.addEventListener("click", (event) => {
    const row = event.target instanceof Element ? event.target.closest("button") : null;
    if (!(row instanceof HTMLButtonElement) || row.dataset["index"] === void 0) return;
    const remembered = held;
    const hit = remembered === null ? void 0 : remembered.hits[Number(row.dataset["index"])];
    if (remembered === null || hit === void 0) return;
    closeDocSearch();
    context?.onJump(hit, remembered.folded);
  });

  // src/lib/book/opf.js
  var CONTENT_TYPES = /* @__PURE__ */ new Set(["application/xhtml+xml", "text/html"]);
  function elements(root2, localName) {
    const found = [];
    const queue2 = [root2];
    while (queue2.length > 0) {
      const el = (
        /** @type {XmlEl} */
        queue2.shift()
      );
      if (el.localName === localName) found.push(el);
      for (const child of el.children) queue2.push(child);
    }
    return found;
  }
  function firstText(root2, localName) {
    for (const el of elements(root2, localName)) {
      const text = (el.textContent ?? "").trim();
      if (text.length > 0) return text;
    }
    return null;
  }
  function containerOpfPath(containerRoot) {
    for (const rootfile of elements(containerRoot, "rootfile")) {
      if (rootfile.getAttribute("media-type") !== "application/oebps-package+xml") continue;
      const path = rootfile.getAttribute("full-path");
      if (typeof path === "string" && path.length > 0) return path;
    }
    return null;
  }
  function opfPackage(packageRoot) {
    const manifest = /* @__PURE__ */ new Map();
    for (const item of elements(packageRoot, "item")) {
      const id = item.getAttribute("id");
      const href = item.getAttribute("href");
      const mediaType = item.getAttribute("media-type") ?? "";
      if (typeof id === "string" && id.length > 0 && typeof href === "string" && href.length > 0) {
        manifest.set(id, { href, mediaType });
      }
    }
    const spineHrefs = [];
    for (const itemref of elements(packageRoot, "itemref")) {
      if (itemref.getAttribute("linear") === "no") continue;
      const idref = itemref.getAttribute("idref");
      if (typeof idref !== "string") continue;
      const item = manifest.get(idref);
      if (item !== void 0 && CONTENT_TYPES.has(item.mediaType)) spineHrefs.push(item.href);
    }
    return {
      title: firstText(packageRoot, "title"),
      author: firstText(packageRoot, "creator"),
      lang: firstText(packageRoot, "language"),
      spineHrefs
    };
  }
  function opfDirectory(opfPath) {
    const at2 = opfPath.lastIndexOf("/");
    return at2 === -1 ? "" : opfPath.slice(0, at2);
  }
  function resolveZipPath(baseDir, href) {
    const bare = href.split("#")[0]?.split("?")[0] ?? "";
    if (bare.length === 0) return null;
    let decoded;
    try {
      decoded = decodeURIComponent(bare);
    } catch {
      decoded = bare;
    }
    const fromRoot = decoded.startsWith("/");
    const start2 = fromRoot ? [] : baseDir.split("/").filter((part) => part.length > 0);
    const parts = start2;
    for (const part of decoded.split("/")) {
      if (part.length === 0 || part === ".") continue;
      if (part === "..") {
        if (parts.length === 0) return null;
        parts.pop();
        continue;
      }
      parts.push(part);
    }
    return parts.length === 0 ? null : parts.join("/");
  }
  function hasEncryption(names2) {
    return names2.includes("META-INF/encryption.xml");
  }
  function decodeXml(bytes) {
    const label2 = bytes.length >= 2 && bytes[0] === 255 && bytes[1] === 254 ? "utf-16le" : bytes.length >= 2 && bytes[0] === 254 && bytes[1] === 255 ? "utf-16be" : "utf-8";
    return new TextDecoder(label2).decode(bytes);
  }

  // src/reader/import-book.js
  var fflate = null;
  async function loadFflate() {
    if (fflate === null) {
      fflate = /** @type {FflateModule} */
      // @ts-expect-error - the path exists only in the built package (the
      // vendored file is copied, never bundled), so the checker cannot
      // resolve it from the source tree.
      await import("../vendor/fflate/browser.js");
    }
    return fflate;
  }
  function parseXml(text) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    return doc.getElementsByTagNameNS("*", "parsererror").length === 0 ? doc : null;
  }
  function yieldToUi() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  async function importEpub(file, onSegment) {
    let bytes;
    let unzipSync;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
      ({ unzipSync } = await loadFflate());
    } catch {
      return { ok: false, reason: "unreadable" };
    }
    const entry = (path) => {
      const out = unzipSync(bytes, { filter: (candidate) => candidate.name === path });
      return out[path] ?? null;
    };
    const names2 = [];
    try {
      unzipSync(bytes, {
        filter: (candidate) => {
          names2.push(candidate.name);
          return false;
        }
      });
    } catch {
      return { ok: false, reason: "unreadable" };
    }
    if (hasEncryption(names2)) return { ok: false, reason: "drm" };
    const bookId = crypto.randomUUID();
    try {
      const containerBytes = entry("META-INF/container.xml");
      const containerDoc = containerBytes === null ? null : parseXml(decodeXml(containerBytes));
      const opfPath = containerDoc === null ? null : containerOpfPath(containerDoc.documentElement);
      const opfBytes = opfPath === null ? null : entry(opfPath);
      const opfDoc = opfBytes === null ? null : parseXml(decodeXml(opfBytes));
      if (opfPath === null || opfDoc === null) return { ok: false, reason: "unreadable" };
      const pkg = opfPackage(opfDoc.documentElement);
      if (pkg.spineHrefs.length === 0) return { ok: false, reason: "unreadable" };
      const baseDir = opfDirectory(opfPath);
      const packer = (
        /** @type {ReturnType<typeof segmenter<string>>} */
        segmenter()
      );
      let written = 0;
      let totalChars = 0;
      const tocEntries = [];
      const writeSegments = async (segments) => {
        for (const segment2 of segments) {
          await putBookSegment({
            bookId,
            index: written,
            blocks: segment2.blocks,
            charCount: segment2.charCount
          });
          tocEntries.push(...headingEntries(segment2.blocks, written));
          written += 1;
          totalChars += segment2.charCount;
          onSegment(written);
        }
      };
      for (const href of pkg.spineHrefs) {
        await yieldToUi();
        const path = resolveZipPath(baseDir, href);
        const data = path === null ? null : entry(path);
        if (data === null) throw new Error(`spine entry missing: ${href}`);
        const chapter = new DOMParser().parseFromString(decodeXml(data), "text/html");
        const rebuilt = buildArticle(chapter.body, document, { baseUrl: "" });
        for (const block of packableBlocks(rebuilt)) {
          const text = block.textContent ?? "";
          if (text.trim().length === 0 && block.localName !== "hr") continue;
          await writeSegments(
            packer.push({
              chars: text.length,
              heading: isHeadingTag(block.localName),
              payload: block.outerHTML
            })
          );
        }
      }
      await writeSegments(packer.finish());
      const book = bookRecord({
        id: bookId,
        title: pkg.title ?? file.name.replace(/\.epub$/i, "").trim(),
        author: pkg.author,
        lang: pkg.lang,
        segmentCount: written,
        totalChars,
        addedAt: Date.now(),
        toc: cappedToc(tocEntries)
      });
      if (book === null) throw new Error("nothing to keep");
      await putBook(book);
      return { ok: true, book };
    } catch {
      await deleteBook(bookId).catch(() => void 0);
      return { ok: false, reason: "unreadable" };
    }
  }

  // src/options/models-view.js
  function matchesFilter(searchable, query) {
    const words = query.toLowerCase().split(/\s+/).filter((word) => word.length > 0);
    return words.every((word) => searchable.includes(word));
  }

  // src/reader/list-view.js
  var PAGE_SIZE = 50;
  function articleEntry(meta, position) {
    return {
      ...meta,
      kind: "article",
      progress: null,
      percentRead: overallPercent(position, 1),
      lastReadAt: lastReadFrom(position)
    };
  }
  function lastReadFrom(position) {
    return position !== null && position.updatedAt > 0 ? position.updatedAt : null;
  }
  function bookEntry(book, position) {
    const at2 = position === null ? 0 : Math.min(position.segmentIndex, book.segmentCount - 1);
    return {
      url: book.id,
      hostname: book.author ?? "",
      title: book.title,
      savedAt: book.addedAt,
      readAt: book.readAt,
      kind: "book",
      progress: { at: at2 + 1, of: book.segmentCount },
      percentRead: overallPercent(position, book.segmentCount),
      lastReadAt: lastReadFrom(position)
    };
  }
  function searchableArticle(meta) {
    return `${meta.title} ${meta.hostname}`.toLowerCase();
  }
  function libraryView(metas, { segment: segment2, query, page }) {
    const inSegment = listedRows(metas, segment2);
    const matching = inSegment.filter((meta) => matchesFilter(searchableArticle(meta), query));
    const pages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
    const current2 = Math.min(Math.max(1, page), pages);
    const elsewhere = metas.length - inSegment.length;
    return {
      rows: matching.slice((current2 - 1) * PAGE_SIZE, current2 * PAGE_SIZE),
      page: current2,
      pages,
      matching: matching.length,
      inSegment: inSegment.length,
      unread: segment2 === Segment.UNREAD ? inSegment.length : elsewhere,
      read: segment2 === Segment.READ ? inSegment.length : elsewhere
    };
  }

  // src/reader/library-search.js
  var statusLine2 = document.getElementById("library-search-status");
  var rowsList = document.getElementById("library-search-rows");
  var moreLine = document.getElementById("library-search-more-line");
  var moreButton = document.getElementById("library-search-more");
  var context2 = null;
  var search = null;
  var scanEpoch2 = 0;
  var batchesRunning = 0;
  function configureLibrarySearch(wiring) {
    context2 = wiring;
  }
  function librarySearchShown() {
    return search !== null;
  }
  function dismissLibrarySearch() {
    scanEpoch2 += 1;
    search = null;
    rowsList?.replaceChildren();
    if (statusLine2 !== null) {
      statusLine2.hidden = true;
      statusLine2.textContent = "";
    }
    if (moreLine !== null) moreLine.hidden = true;
  }
  async function startLibrarySearch(query) {
    const folded = foldQuery(query);
    const turn = ++scanEpoch2;
    const docs = await loadDocs();
    if (turn !== scanEpoch2) return;
    const metaDocs = [];
    docs.forEach((doc, index2) => {
      if (metaMatches(doc.searchable, folded)) metaDocs.push(index2);
    });
    search = { query, folded, docs, metaDocs, cursor: 0, found: [] };
    void runBatch();
  }
  async function loadDocs() {
    const [metas, books, positions] = await Promise.all([
      listArticles(),
      listBooks(),
      allPositions()
    ]);
    const entries = [
      ...metas.map((meta) => articleEntry(meta, positions.get(meta.url) ?? null)),
      ...books.map((book) => bookEntry(book, positions.get(book.id) ?? null))
    ];
    const ordered = [...listedRows(entries, Segment.UNREAD), ...listedRows(entries, Segment.READ)];
    return ordered.map((entry) => ({
      kind: entry.kind,
      url: entry.url,
      title: entry.title,
      searchable: searchableArticle(entry),
      detail: detailOf(entry),
      segments: entry.kind === "book" ? entry.progress?.of ?? 1 : 1
    }));
  }
  function detailOf(entry) {
    const tab = entry.readAt === null ? t("reader_segment_unread") : t("reader_segment_read");
    const parts = entry.kind === "book" ? [entry.hostname, t("reader_book_label"), tab] : [entry.hostname, tab];
    return parts.filter((part) => part.length > 0).join(" - ");
  }
  async function runBatch() {
    const state2 = search;
    if (state2 === null) return;
    const turn = ++scanEpoch2;
    batchesRunning += 1;
    renderSearch();
    try {
      let collected = 0;
      while (state2.cursor < state2.docs.length && collected < LIBRARY_BATCH) {
        updateStatus();
        const doc = state2.docs[state2.cursor];
        const hits = doc === void 0 ? [] : await scanDoc(doc, state2.folded);
        if (turn !== scanEpoch2) return;
        state2.cursor += 1;
        if (doc !== void 0 && hits.length > 0) {
          state2.found.push({ doc, hits });
          collected += hits.length;
        }
      }
    } finally {
      batchesRunning -= 1;
    }
    renderSearch();
  }
  async function scanDoc(doc, folded) {
    const hits = [];
    let room = true;
    if (doc.kind === "book") {
      for (let index2 = 0; index2 < doc.segments && room; index2 += 1) {
        const segment2 = await getBookSegment(doc.url, index2);
        if (segment2 === null) continue;
        for (let block = 0; block < segment2.blocks.length && room; block += 1) {
          const text = storedBlockText(segment2.blocks[block] ?? "");
          room = collectHits(text, index2, block, folded, hits, DOC_HIT_LIMIT);
        }
      }
      return hits;
    }
    const article2 = await getArticle(doc.url);
    if (article2 === null) return hits;
    const source = new DOMParser().parseFromString(article2.content, "text/html").body;
    const root2 = buildArticle(source, document, { baseUrl: doc.url });
    for (let block = 0; block < root2.children.length && room; block += 1) {
      const element = root2.children[block];
      const text = element === void 0 ? "" : prosePieces(element).map((part) => part.text).join("");
      room = collectHits(text, 0, block, folded, hits, DOC_HIT_LIMIT);
    }
    return hits;
  }
  function updateStatus() {
    const state2 = search;
    if (statusLine2 === null || state2 === null) return;
    const total = state2.found.reduce((sum, result) => sum + result.hits.length, 0);
    const done = state2.cursor >= state2.docs.length;
    const progress = t("reader_search_progress", [
      Math.min(state2.cursor, state2.docs.length).toLocaleString(),
      state2.docs.length.toLocaleString()
    ]);
    statusLine2.hidden = false;
    if (done && total === 0 && state2.metaDocs.length === 0) {
      statusLine2.textContent = t("reader_search_none");
    } else if (total === 0) {
      statusLine2.textContent = progress;
    } else {
      statusLine2.textContent = `${plural(total, "reader_search_count")} ${progress}`;
    }
  }
  function groupHeading(label2) {
    const heading = document.createElement("p");
    heading.className = "search-part";
    heading.textContent = label2;
    return heading;
  }
  function renderSearch() {
    const state2 = search;
    if (state2 === null || rowsList === null) return;
    const built = [];
    if (state2.metaDocs.length > 0) {
      built.push(groupHeading(t("reader_search_in_titles")));
      for (const index2 of state2.metaDocs) {
        const doc = state2.docs[index2];
        if (doc !== void 0) built.push(docRow(doc, null, state2.folded, state2.query));
      }
    }
    if (state2.found.length > 0) {
      built.push(groupHeading(t("reader_search_in_text")));
      for (const result of state2.found) {
        built.push(docRow(result.doc, result.hits, state2.folded, state2.query));
      }
    }
    rowsList.replaceChildren(...built);
    updateStatus();
    if (moreLine !== null) {
      moreLine.hidden = batchesRunning > 0 || state2.cursor >= state2.docs.length;
    }
  }
  function targetOf(hit, folded) {
    return {
      segmentIndex: hit.segmentIndex,
      block: hit.block,
      from: hit.from,
      to: hit.to,
      folded
    };
  }
  function docRow(doc, hits, folded, query) {
    const item = document.createElement("li");
    item.className = "library-row";
    const text = document.createElement("div");
    text.className = "library-text";
    const open3 = document.createElement("button");
    open3.type = "button";
    open3.className = "library-open";
    open3.textContent = doc.title;
    const first = hits === null ? void 0 : hits[0];
    open3.addEventListener(
      "click",
      () => context2?.onOpen(doc.kind, doc.url, first === void 0 ? void 0 : targetOf(first, folded))
    );
    const detail = document.createElement("span");
    detail.className = "library-item-detail";
    detail.textContent = doc.detail;
    text.append(open3, detail);
    if (hits !== null) {
      const plan2 = snippetPlan(hits.length);
      const snippets = document.createElement("div");
      snippets.className = "search-snippets";
      for (const hit of hits.slice(0, plan2.shown)) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "search-snippet";
        row.dir = "auto";
        const before = document.createElement("span");
        before.textContent = hit.before;
        const match = document.createElement("b");
        match.textContent = hit.match;
        const after = document.createElement("span");
        after.textContent = hit.after;
        row.append(before, match, after);
        row.addEventListener("click", () => context2?.onOpen(doc.kind, doc.url, targetOf(hit, folded)));
        snippets.append(row);
      }
      if (plan2.more > 0) {
        const more2 = document.createElement("button");
        more2.type = "button";
        more2.className = "search-snippet search-more-hits";
        more2.textContent = plural(plan2.more, "reader_search_more_hits");
        more2.addEventListener("click", () => context2?.onOpenSearch(doc.kind, doc.url, query));
        snippets.append(more2);
      }
      text.append(snippets);
    }
    item.append(text);
    return item;
  }
  moreButton?.addEventListener("click", () => void runBatch());

  // src/reader/marks-list.js
  var MARKS_PAGE_SIZE = 25;
  function markRows(metas, books, marks) {
    const docs = /* @__PURE__ */ new Map();
    for (const meta of metas) {
      docs.set(meta.url, { kind: "article", title: meta.title, lang: null, parts: 1 });
    }
    for (const book of books) {
      docs.set(book.id, { kind: "book", title: book.title, lang: book.lang, parts: book.segmentCount });
    }
    const groups = [];
    for (const [docId, list] of marks) {
      const doc = docs.get(docId);
      if (doc === void 0 || list.length === 0) continue;
      const newest = Math.max(...list.map((mark3) => mark3.createdAt));
      groups.push({ docId, doc, newest, list });
    }
    groups.sort((a, b) => b.newest - a.newest || a.doc.title.localeCompare(b.doc.title));
    return groups.flatMap(
      ({ docId, doc, list }) => list.map((mark3) => ({
        docId,
        kind: doc.kind,
        title: doc.title,
        lang: doc.lang,
        // Only a book of many parts has a part worth naming; an article's
        // implicit one and a one-part book would be a number saying nothing.
        part: doc.kind === "book" && doc.parts > 1 ? { at: mark3.segmentIndex + 1, of: doc.parts } : null,
        mark: mark3
      }))
    );
  }
  function searchableMark(row) {
    return `${row.mark.text} ${row.mark.note ?? ""} ${row.title}`.toLowerCase();
  }
  function marksListView(rows2, { scope: scope2, query, page }) {
    const inScope = scope2 === null ? rows2 : rows2.filter((row) => row.docId === scope2);
    const matching = inScope.filter((row) => matchesFilter(searchableMark(row), query));
    const pages = Math.max(1, Math.ceil(matching.length / MARKS_PAGE_SIZE));
    const current2 = Math.min(Math.max(1, page), pages);
    return {
      rows: matching.slice((current2 - 1) * MARKS_PAGE_SIZE, current2 * MARKS_PAGE_SIZE),
      page: current2,
      pages,
      matching: matching.length,
      total: inScope.length
    };
  }

  // src/lib/reader/speech.js
  var MAX_CHUNK = 300;
  var WORD2 = /[\p{L}\p{N}]/u;
  var JOINER = /[-\u0027\u2019\u02BC\u00AD\u2011]/u;
  function isSpace(character) {
    return /\s/u.test(character);
  }
  function continuesWord(text, at2) {
    const character = text[at2] ?? "";
    if (WORD2.test(character)) return true;
    return JOINER.test(character) && WORD2.test(text[at2 + 1] ?? "");
  }
  function add(into, text, from, to) {
    let start2 = from;
    let end = to;
    while (start2 < end && isSpace(text[start2] ?? "")) start2 += 1;
    while (end > start2 && isSpace(text[end - 1] ?? "")) end -= 1;
    if (end > start2) into.push({ start: start2, end });
  }
  function wrapPoint(text, from, limit) {
    for (let at2 = limit; at2 > from + 1; at2 -= 1) {
      if (isSpace(text[at2 - 1] ?? "")) return at2;
    }
    return limit;
  }
  function chunkText(text) {
    const chunks = [];
    let from = 0;
    let at2 = 0;
    while (at2 < text.length) {
      if (endsSentence(text, at2)) {
        add(chunks, text, from, at2 + 1);
        from = at2 + 1;
        at2 = from;
        continue;
      }
      if (at2 - from + 1 >= MAX_CHUNK) {
        const cut = wrapPoint(text, from, at2 + 1);
        add(chunks, text, from, cut);
        from = cut;
        at2 = from;
        continue;
      }
      at2 += 1;
    }
    add(chunks, text, from, text.length);
    return chunks;
  }
  function wordSpan(text, index2, length = 0) {
    if (!Number.isInteger(index2) || index2 < 0 || index2 >= text.length) return null;
    let start2 = index2;
    while (start2 < text.length && isSpace(text[start2] ?? "")) start2 += 1;
    if (start2 >= text.length) return null;
    let end = length > 0 && start2 === index2 ? Math.min(start2 + length, text.length) : start2;
    while (end < text.length && continuesWord(text, end)) end += 1;
    while (end > start2 && !WORD2.test(text[end - 1] ?? "")) end -= 1;
    return end > start2 ? { start: start2, end } : null;
  }

  // src/reader/read-aloud.js
  var SENTENCE = "reread-speaking";
  var WORD3 = "reread-speaking-word";
  var BAND = Object.freeze({ top: 0.12, bottom: 0.75, land: 0.3 });
  var hooks2 = null;
  var plan = null;
  var at = 0;
  var within2 = 0;
  var spoken = 0;
  var queue = [];
  var DEPTH = 2;
  var pending2 = null;
  var state = "off";
  var voice = { lang: "en", voiceURI: void 0, rate: 1 };
  var sentenceMark = null;
  var wordMark = null;
  function configureReading(options) {
    hooks2 = options;
    shareVoice(pauseReading);
  }
  function readingVoice(next) {
    const moved = next.lang !== voice.lang || next.voiceURI !== voice.voiceURI || next.rate !== voice.rate;
    voice = next;
    if (moved && state === "playing") {
      within2 = spoken;
      hush();
      speakHere();
    }
  }
  function readingState() {
    return state;
  }
  function forgetReading() {
    stopReading();
    plan = null;
  }
  function toggleReading() {
    if (state === "playing") pauseReading();
    else if (state === "paused") speakHere();
    else startReading();
  }
  function startReading() {
    if (!canSpeak() || !buildPlan()) return;
    stop();
    hush();
    at = firstVisibleChunk();
    within2 = 0;
    speakHere();
  }
  function pauseReading() {
    if (state !== "playing") return;
    within2 = spoken;
    hush();
    state = "paused";
    announce();
  }
  function stopReading() {
    if (state === "off") return;
    hush();
    clearMarks();
    at = 0;
    within2 = 0;
    spoken = 0;
    state = "off";
    announce();
  }
  function skipSentence(step) {
    if (plan === null || state === "off") return;
    const restart = step < 0 && spoken > 0;
    const next = restart ? at : at + step;
    if (next < 0 || next >= plan.chunks.length) {
      if (next >= plan.chunks.length) stopReading();
      return;
    }
    at = next;
    within2 = 0;
    spoken = 0;
    if (state === "playing") {
      hush();
      speakHere();
      return;
    }
    markSentence();
  }
  function buildPlan() {
    if (plan !== null) return plan.chunks.length > 0;
    const article2 = hooks2?.article() ?? null;
    if (article2 === null) return false;
    const parts = prosePieces(article2);
    const { text, spans } = joinPieces(parts.map((part) => part.text));
    plan = { parts, spans, text, chunks: chunkText(text) };
    return plan.chunks.length > 0;
  }
  function firstVisibleChunk() {
    if (plan === null) return 0;
    const fold = hooks2?.fold() ?? 0;
    for (let index2 = 0; index2 < plan.chunks.length; index2 += 1) {
      const rect = rectOf(index2);
      if (rect !== null && rect.bottom > fold + 4) return index2;
    }
    return 0;
  }
  function rectOf(index2) {
    const chunk = plan?.chunks[index2];
    if (chunk === void 0) return null;
    const range2 = rangeOf(chunk.start, chunk.end);
    return range2 === null ? null : range2.getBoundingClientRect();
  }
  function rangeOf(from, to) {
    if (plan === null || to <= from) return null;
    const start2 = locate(plan.spans, from);
    const end = locate(plan.spans, to - 1);
    const startNode = start2 === null ? null : plan.parts[start2.piece]?.node ?? null;
    const endNode = end === null ? null : plan.parts[end.piece]?.node ?? null;
    if (start2 === null || end === null || startNode === null || endNode === null) return null;
    const range2 = document.createRange();
    range2.setStart(startNode, start2.offset);
    range2.setEnd(endNode, end.offset + 1);
    return range2;
  }
  function speakHere() {
    while (plan !== null && at < plan.chunks.length && !hand(at, within2)) {
      at += 1;
      within2 = 0;
    }
    if (queue.length === 0) {
      stopReading();
      return;
    }
    state = "playing";
    adoptHead();
    announce();
    topUp();
  }
  function hand(sentence, from) {
    const chunk = plan?.chunks[sentence];
    if (plan === null || chunk === void 0) return false;
    const text = plan.text.slice(chunk.start + from, chunk.end);
    if (text.trim().length === 0) return false;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = voice.lang;
    utterance.rate = voice.rate;
    const chosen = chosenVoice(speechSynthesis.getVoices(), voice.voiceURI);
    if (chosen !== null) utterance.voice = chosen;
    const handed = { utterance, sentence, from };
    utterance.addEventListener("boundary", (event) => onBoundary(handed, event));
    utterance.addEventListener("end", () => onEnd(handed));
    utterance.addEventListener("error", (event) => onError(handed, event));
    queue.push(handed);
    speechSynthesis.speak(utterance);
    return true;
  }
  function topUp() {
    while (queue.length < DEPTH) {
      const last = queue[queue.length - 1];
      if (last === void 0 || plan === null) return;
      let next = last.sentence + 1;
      while (next < plan.chunks.length && !hand(next, 0)) next += 1;
      if (next >= plan.chunks.length) return;
    }
  }
  function adoptHead() {
    const head = queue[0];
    if (head === void 0) return;
    at = head.sentence;
    within2 = head.from;
    spoken = head.from;
    markSentence();
  }
  function onBoundary(handed, event) {
    const chunk = plan?.chunks[handed.sentence];
    if (queue[0] !== handed || plan === null || chunk === void 0) return;
    if (event.name === "sentence") return;
    const base = chunk.start + handed.from;
    const length = typeof event.charLength === "number" ? event.charLength : 0;
    const word = wordSpan(plan.text, base + event.charIndex, length);
    if (word === null || word.start >= chunk.end) return;
    spoken = word.start - chunk.start;
    const range2 = rangeOf(word.start, Math.min(word.end, chunk.end));
    if (range2 === null) return;
    wordMark = mark2(WORD3, wordMark, range2, 3);
    keepVisible(range2);
  }
  function onEnd(handed) {
    if (queue[0] !== handed) return;
    queue.shift();
    if (queue.length > 0) {
      adoptHead();
    } else if (more()) {
      at += 1;
      within2 = 0;
      spoken = 0;
    } else {
      stopReading();
      return;
    }
    if (pending2 !== null) window.clearTimeout(pending2);
    pending2 = window.setTimeout(() => {
      pending2 = null;
      if (queue.length === 0) speakHere();
      else topUp();
    }, 0);
  }
  function more() {
    const last = queue[queue.length - 1];
    const after = last === void 0 ? at : last.sentence;
    return plan !== null && after + 1 < plan.chunks.length;
  }
  function onError(handed, event) {
    if (queue[0] !== handed) {
      queue = queue.filter((one) => one !== handed);
      return;
    }
    queue = [];
    if (event.error === "canceled" || event.error === "interrupted") {
      within2 = spoken;
      state = "paused";
      announce();
      return;
    }
    clearMarks();
    state = "off";
    announce();
    hooks2?.onFail();
  }
  function hush() {
    queue = [];
    if (pending2 !== null) {
      window.clearTimeout(pending2);
      pending2 = null;
    }
    if (canSpeak()) speechSynthesis.cancel();
  }
  function announce() {
    hooks2?.onChange(state);
  }
  function markSentence() {
    const chunk = plan?.chunks[at];
    if (chunk === void 0) return;
    const range2 = rangeOf(chunk.start, chunk.end);
    if (range2 === null) return;
    sentenceMark = mark2(SENTENCE, sentenceMark, range2, 2);
    wordMark?.clear();
    keepVisible(range2);
  }
  function mark2(name2, held2, range2, priority) {
    if (!supported()) return null;
    const highlight2 = held2 ?? new Highlight();
    highlight2.priority = priority;
    highlight2.clear();
    highlight2.add(range2);
    CSS.highlights.set(name2, highlight2);
    return highlight2;
  }
  function clearMarks() {
    sentenceMark = null;
    wordMark = null;
    if (!supported()) return;
    CSS.highlights.delete(SENTENCE);
    CSS.highlights.delete(WORD3);
  }
  function keepVisible(range2) {
    const rect = range2.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    const height = window.innerHeight;
    const fold = hooks2?.fold() ?? 0;
    if (rect.top >= Math.max(height * BAND.top, fold) && rect.bottom <= height * BAND.bottom) return;
    window.scrollTo({
      top: window.scrollY + rect.top - Math.max(height * BAND.land, fold),
      behavior: "instant"
    });
  }

  // src/reader/reader.js
  var Readability = (
    /** @type {ReadabilityConstructor} */
    /** @type {Record<string, unknown>} */
    globalThis["Readability"]
  );
  localizePage();
  history.scrollRestoration = "manual";
  watchToolbarScheme();
  var versionSpan = document.getElementById("version");
  if (versionSpan !== null) versionSpan.textContent = webext().runtime.getManifest().version;
  var notice = document.getElementById("notice");
  var article = document.getElementById("article");
  var titleElement = document.getElementById("title");
  var bylineElement = document.getElementById("byline");
  var contentElement = document.getElementById("content");
  var originalLink = document.getElementById("original");
  var brandButton = document.getElementById("brand");
  var displayButton = document.getElementById("display");
  var displayPanel = document.getElementById("display-panel");
  var menuButton = document.getElementById("menu");
  var menuPanel = document.getElementById("menu-panel");
  var navToc = document.getElementById("nav-toc");
  var navSearch = document.getElementById("nav-search");
  var navLibrary = document.getElementById("nav-library");
  var navMarks = document.getElementById("nav-marks");
  var navVocabulary = document.getElementById("nav-vocabulary");
  var navSettings = document.getElementById("nav-settings");
  var chromeBox = document.querySelector(".reader-chrome");
  var sizeValue = document.getElementById("size-value");
  var measureValue = document.getElementById("measure-value");
  var listenButton = (
    /** @type {HTMLButtonElement | null} */
    document.getElementById("listen")
  );
  var voiceSetting = document.getElementById("voice-setting");
  var voiceChoice = (
    /** @type {HTMLSelectElement | null} */
    document.getElementById("voice-choice")
  );
  var underlineSetting = document.getElementById("underline-setting");
  var rateSetting = document.getElementById("rate-setting");
  var rateValue = document.getElementById("rate-value");
  var speechBar = document.getElementById("speech-bar");
  var speechPlayLabel = document.getElementById("speech-play-label");
  var library = document.getElementById("library");
  var librarySegments = document.getElementById("library-segments");
  var libraryCount = document.getElementById("library-count");
  var libraryEmpty = document.getElementById("library-empty");
  var libraryRows = document.getElementById("library-rows");
  var libraryFilter = (
    /** @type {HTMLInputElement | null} */
    document.getElementById("library-filter")
  );
  var librarySearchToggle = (
    /** @type {HTMLInputElement | null} */
    document.getElementById("library-search-toggle")
  );
  var librarySearchGo = (
    /** @type {HTMLButtonElement | null} */
    document.getElementById("library-search-go")
  );
  var librarySearchSection = document.getElementById("library-search");
  var libraryPager = document.getElementById("library-pager");
  var libraryPageLabel = document.getElementById("library-page-label");
  var libraryPrev = (
    /** @type {HTMLButtonElement | null} */
    document.getElementById("library-prev")
  );
  var libraryNext = (
    /** @type {HTMLButtonElement | null} */
    document.getElementById("library-next")
  );
  var exportButton = (
    /** @type {HTMLButtonElement | null} */
    document.getElementById("library-export")
  );
  var exportMarksButton = (
    /** @type {HTMLButtonElement | null} */
    document.getElementById("library-export-marks")
  );
  var importButton = document.getElementById("library-import");
  var importInput = (
    /** @type {HTMLInputElement | null} */
    document.getElementById("library-import-file")
  );
  var importConfirm = document.getElementById("library-import-confirm");
  var importSummary = document.getElementById("library-import-summary");
  var importSample = document.getElementById("library-import-sample");
  var importRun = (
    /** @type {HTMLButtonElement | null} */
    document.getElementById("library-import-run")
  );
  var importCancel = document.getElementById("library-import-cancel");
  var transferLine = document.getElementById("library-transfer-status");
  var marksSection = document.getElementById("marks");
  var marksDocLine = document.getElementById("marks-doc");
  var marksFilter = (
    /** @type {HTMLInputElement | null} */
    document.getElementById("marks-filter")
  );
  var marksCount = document.getElementById("marks-count");
  var marksEmpty = document.getElementById("marks-empty");
  var marksRowsList = document.getElementById("marks-rows");
  var marksPager = document.getElementById("marks-pager");
  var marksPageLabel = document.getElementById("marks-page-label");
  var marksPrev = (
    /** @type {HTMLButtonElement | null} */
    document.getElementById("marks-prev")
  );
  var marksNext = (
    /** @type {HTMLButtonElement | null} */
    document.getElementById("marks-next")
  );
  var marksExportButton = (
    /** @type {HTMLButtonElement | null} */
    document.getElementById("marks-export")
  );
  var marksCopyIcons = (
    /** @type {HTMLTemplateElement | null} */
    document.getElementById("marks-copy-icons")
  );
  var marksOpenIcon = (
    /** @type {HTMLTemplateElement | null} */
    document.getElementById("marks-open-icon")
  );
  var marksSpeakIcon = (
    /** @type {HTMLTemplateElement | null} */
    document.getElementById("marks-speak-icon")
  );
  var marksNoteIcon = (
    /** @type {HTMLTemplateElement | null} */
    document.getElementById("marks-note-icon")
  );
  var bookImportLine = document.getElementById("book-import-status");
  var bookNote = document.getElementById("book-note");
  var bookNoteText = document.getElementById("book-note-text");
  var bookNoteSettings = document.getElementById("book-note-settings");
  var segmentNavs = [
    document.getElementById("segment-nav"),
    document.getElementById("segment-nav-end")
  ];
  var segmentLabels = [
    document.getElementById("segment-label"),
    document.getElementById("segment-label-end")
  ];
  var segmentPrevs = [
    document.getElementById("segment-prev"),
    document.getElementById("segment-prev-end")
  ];
  var segmentNexts = [
    document.getElementById("segment-next"),
    document.getElementById("segment-next-end")
  ];
  var tocButtons = [document.getElementById("toc"), document.getElementById("toc-end")];
  var tocDialog = (
    /** @type {HTMLDialogElement | null} */
    document.getElementById("toc-dialog")
  );
  var tocRows = document.getElementById("toc-rows");
  var tocCloseButton = document.getElementById("toc-close");
  var actions = document.getElementById("actions");
  var toLibraryButton = document.getElementById("to-library");
  var keepButton = document.getElementById("keep");
  var removeButton = document.getElementById("remove");
  var markReadButton = document.getElementById("mark-read");
  var actionsEnd = document.getElementById("actions-end");
  var toLibraryEndButton = document.getElementById("to-library-end");
  var markReadEndButton = document.getElementById("mark-read-end");
  var markerButton = (
    /** @type {HTMLButtonElement | null} */
    document.getElementById("marker")
  );
  var markBar = document.getElementById("mark-bar");
  var markCopyButton = document.getElementById("mark-copy");
  var markCopyLabel = document.getElementById("mark-copy-label");
  var markNoteButton = document.getElementById("mark-note");
  var markDeleteButton = document.getElementById("mark-delete");
  var markPinStart = document.getElementById("mark-pin-start");
  var markPinEnd = document.getElementById("mark-pin-end");
  var markNoteBadges = document.getElementById("mark-note-badges");
  var noteDialog = (
    /** @type {HTMLDialogElement | null} */
    document.getElementById("note-dialog")
  );
  var noteQuote = document.getElementById("note-quote");
  var noteText = (
    /** @type {HTMLTextAreaElement | null} */
    document.getElementById("note-text")
  );
  var noteSaveButton = document.getElementById("note-save");
  var noteCancelButton = document.getElementById("note-cancel");
  var noteCloseButton = document.getElementById("note-close");
  var shown = null;
  var markerOn = false;
  var docMarks = [];
  var docToc = [];
  var tocBlocks = [];
  var tocScansRunning = /* @__PURE__ */ new Set();
  var activeMark = null;
  var copiedTimer = null;
  var segment = Segment.UNREAD;
  var libraryQuery = "";
  var libraryPage = 1;
  var marksShown = null;
  var marksQuery = "";
  var marksPage = 1;
  var marksOnScreen = [];
  var soundingMark = null;
  var unwindToList = false;
  var epoch = 0;
  var settings = DEFAULTS;
  var pendingImport = null;
  var SAMPLE_TITLES = 3;
  function showNotice(text) {
    if (notice === null) return;
    notice.textContent = text;
    notice.hidden = false;
  }
  function hideNotice() {
    if (notice !== null) notice.hidden = true;
  }
  function transferStatus(text, tone) {
    if (transferLine === null) return;
    transferLine.textContent = text;
    if (tone === void 0) delete transferLine.dataset["tone"];
    else transferLine.dataset["tone"] = tone;
  }
  function setBase(doc, url) {
    const existing = doc.querySelector("base[href]");
    if (existing !== null) {
      try {
        existing.setAttribute("href", new URL(existing.getAttribute("href") ?? "", url).href);
        return;
      } catch {
        existing.remove();
      }
    }
    const base = doc.createElement("base");
    base.setAttribute("href", url);
    doc.head.prepend(base);
  }
  function renderArticle(piece) {
    if (article === null || contentElement === null || titleElement === null) return;
    epoch += 1;
    flushPosition();
    forgetReading();
    stopMarkSpeech();
    document.body.dataset["view"] = "doc";
    if (shown === null || shown.url !== piece.url) {
      setMarker(false);
      resetDocSearch();
    }
    deselectMark();
    docMarks = [];
    clearMarkPaint();
    clearSearchWash();
    showNoteBadges();
    showSegmentNav(null);
    showBookNote(null);
    closeTocDialog();
    closeDocSearch();
    const rebuilt = buildArticle(piece.source, document, { baseUrl: piece.url });
    titleElement.textContent = piece.title;
    if (bylineElement !== null) {
      bylineElement.textContent = piece.credit.join(" - ");
      bylineElement.hidden = piece.credit.length === 0;
    }
    if (piece.dir !== null) article.setAttribute("dir", piece.dir);
    else article.removeAttribute("dir");
    if (piece.lang !== null) article.setAttribute("lang", piece.lang);
    else article.removeAttribute("lang");
    contentElement.replaceChildren(rebuilt);
    if (piece.origin === "book") {
      tocBlocks = [];
      docToc = [];
    } else {
      docToc = articleToc();
    }
    updateTocButtons();
    applyLinkStops(settings.reader.links);
    if (library !== null) library.hidden = true;
    if (marksSection !== null) marksSection.hidden = true;
    marksShown = null;
    article.hidden = false;
    hideNotice();
    rootReadingSide(article);
    rescan();
    if (originalLink instanceof HTMLAnchorElement) {
      if (piece.link === null) {
        originalLink.hidden = true;
      } else {
        originalLink.href = piece.link;
        originalLink.target = "_blank";
        originalLink.rel = "noreferrer noopener";
        originalLink.hidden = false;
      }
    }
    if (navLibrary !== null) navLibrary.hidden = false;
    if (navMarks !== null) navMarks.hidden = false;
    if (navSearch !== null) navSearch.hidden = false;
    setBackDoor(t("reader_back_to_list"), t("reading_list"));
    document.title = `${piece.title} - re/read`;
    shown = piece.origin === "book" ? {
      origin: "book",
      url: piece.url,
      segmentIndex: piece.segment?.index ?? 0,
      segmentCount: piece.segment?.count ?? 1
    } : { origin: piece.origin, url: piece.url };
    applySpeech();
    updateListen();
    updateMarker();
    scrollTo(0, 0);
  }
  function renderLive(page) {
    const parsed = new DOMParser().parseFromString(page.html, "text/html");
    setBase(parsed, page.url);
    const found = new Readability(parsed).parse();
    if (found === null || typeof found.content !== "string") {
      showNotice(t("reader_no_article"));
      if (shown === null) void showLibrary();
      return;
    }
    const credit = (
      /** @type {string[]} */
      [found.byline, found.siteName].filter((one) => typeof one === "string" && one)
    );
    renderArticle({
      origin: "live",
      url: page.url,
      title: typeof found.title === "string" && found.title !== "" ? found.title : page.title,
      credit,
      dir: typeof found.dir === "string" && found.dir !== "" ? found.dir : null,
      lang: typeof found.lang === "string" && found.lang !== "" ? found.lang : null,
      link: page.url,
      source: new DOMParser().parseFromString(found.content, "text/html").body
    });
    const rendered = shown;
    if (rendered !== null) void openLiveActions(rendered);
    void getMarks(page.url).then((marks) => {
      if (shown !== rendered) return;
      docMarks = marks;
      repaintMarks();
    }).catch(() => void 0);
  }
  function renderSaved(saved) {
    renderArticle({
      origin: "saved",
      url: saved.url,
      title: saved.title,
      credit: [],
      dir: saved.dir,
      lang: saved.lang,
      link: saved.url,
      // Our own serialized markup - and still not trusted back: parsed inert and
      // rebuilt through the allowed list again, like anything else rendered here.
      source: new DOMParser().parseFromString(saved.content, "text/html").body
    });
  }
  var positionTimer = (
    /** @type {ReturnType<typeof setTimeout> | null} */
    null
  );
  function contentRoot() {
    return contentElement?.firstElementChild ?? null;
  }
  function chromeFold() {
    return Math.max(0, chromeBox?.getBoundingClientRect().bottom ?? 0);
  }
  function topBlockIndex() {
    const root2 = contentRoot();
    if (root2 === null || root2.children.length === 0) return null;
    const line = chromeFold() + 2;
    const hit = document.elementFromPoint(window.innerWidth / 2, line);
    for (let node = hit; node !== null && node !== root2; node = node.parentElement) {
      if (node.parentElement === root2) return Array.prototype.indexOf.call(root2.children, node);
    }
    return blockAtLine(
      Array.from(root2.children, (block) => block.getBoundingClientRect()),
      line
    );
  }
  function savePositionNow() {
    if (positionTimer !== null) {
      clearTimeout(positionTimer);
      positionTimer = null;
    }
    const target = shown;
    if (target === null || target.origin === "live") return;
    const at2 = topBlockIndex();
    if (at2 === null) return;
    const segment2 = target.origin === "book" ? target.segmentIndex : 0;
    const percent = measuredPercent(
      window.scrollY,
      window.innerHeight,
      document.documentElement.scrollHeight
    );
    const record = positionRecord(target.url, segment2, at2, Date.now(), percent);
    if (record !== null) void putPosition(record).catch(() => void 0);
  }
  function flushPosition() {
    if (positionTimer !== null) savePositionNow();
  }
  document.addEventListener(
    "scroll",
    () => {
      if (shown === null || shown.origin === "live") return;
      if (positionTimer !== null) clearTimeout(positionTimer);
      positionTimer = setTimeout(savePositionNow, POSITION_SAVE_DELAY);
    },
    { capture: true, passive: true }
  );
  window.addEventListener("pagehide", () => savePositionNow());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") savePositionNow();
  });
  function restorePosition(position, segmentIndex = 0) {
    const root2 = contentRoot();
    if (root2 === null) return;
    const at2 = restoredIndex(position, segmentIndex, root2.children.length);
    if (at2 === null) return;
    const block = root2.children[at2];
    if (block === void 0) return;
    block.scrollIntoView({ behavior: "instant", block: "start" });
    scrollBy(0, -chromeFold());
    const rect = block.getBoundingClientRect();
    const fine = fineScrollTop(
      rect.top + window.scrollY,
      rect.height,
      window.innerHeight,
      position?.percent,
      document.documentElement.scrollHeight
    );
    if (fine !== null) scrollTo(0, fine);
  }
  function readableBand() {
    const view = window.visualViewport;
    const seen = view === null ? { top: 0, bottom: document.documentElement.clientHeight } : { top: view.offsetTop, bottom: view.offsetTop + view.height };
    let bottom = seen.bottom;
    for (const bar of [speechBar, markBar]) {
      if (bar === null || bar.hidden) continue;
      const edge = bar.getBoundingClientRect().top;
      if (edge > 0) bottom = Math.min(bottom, edge);
    }
    return { top: Math.max(chromeFold(), seen.top), bottom };
  }
  function readingLine() {
    const line = Number.parseFloat(getComputedStyle(document.body).lineHeight);
    return Number.isFinite(line) && line > 0 ? line : 24;
  }
  function foldLineBox(fold) {
    if (typeof document.caretPositionFromPoint !== "function") return null;
    if (contentElement === null) return null;
    const column = contentElement.getBoundingClientRect();
    const position = document.caretPositionFromPoint(column.left + column.width / 2, fold + 2);
    if (position === null) return null;
    const node = position.offsetNode;
    if (!(node instanceof Text) || node.length === 0 || !contentElement.contains(node)) return null;
    const at2 = Math.min(position.offset, node.length - 1);
    const range2 = document.createRange();
    range2.setStart(node, at2);
    range2.setEnd(node, at2 + 1);
    const rect = range2.getBoundingClientRect();
    return rect.height > 0 ? { top: rect.top, bottom: rect.bottom } : null;
  }
  function onPageKey(event) {
    if (article === null || article.hidden) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    const turn = pageTurn({
      key: event.key,
      shift: event.shiftKey,
      alt: event.altKey,
      ctrl: event.ctrlKey,
      meta: event.metaKey,
      tag: target?.tagName ?? "",
      editable: target?.isContentEditable ?? false,
      reading: readingState() !== "off",
      dialog: document.querySelector("dialog[open]") !== null
    });
    if (turn === null) return;
    event.preventDefault();
    const band = readableBand();
    const step = pageStep(band, readingLine());
    scrollBy(0, turn === "down" ? step : -step);
    const nudge = foldSnap(turn, band.top, foldLineBox(band.top), step / 2);
    if (nudge !== 0) scrollBy(0, nudge);
  }
  document.addEventListener("keydown", onPageKey);
  function currentMarkColor() {
    return settings.reader.markerColor;
  }
  function shownSegment() {
    return shown !== null && shown.origin === "book" ? shown.segmentIndex : 0;
  }
  function updateMarker() {
    if (markerButton === null) return;
    markerButton.hidden = shown === null || !supported();
    markerButton.setAttribute("aria-pressed", String(markerOn));
  }
  function setMarker(on) {
    if (markerOn !== on) {
      markerOn = on;
      deselectMark();
      if (markBar !== null) markBar.hidden = !on;
      if (on) {
        stopReading();
        closePanels();
        dismiss();
      }
    }
    updateMarker();
  }
  function repaintMarks() {
    paintMarks(docMarks, shown === null ? null : contentRoot(), shownSegment());
    showNoteBadges();
  }
  async function onMarked(range2) {
    const root2 = contentRoot();
    if (root2 === null) return;
    const span2 = anchorOf(range2, root2, shownSegment());
    if (span2 === null) return;
    await commitSpan(span2, currentMarkColor());
  }
  async function commitSpan(span2, color) {
    const target = shown;
    const root2 = contentRoot();
    if (target === null || root2 === null) return;
    deselectMark();
    const plan2 = mergePlan(docMarks, span2);
    const text = quoteOfSpan(plan2.span, root2);
    const mark3 = text === null ? null : markRecord({
      ...plan2.span,
      color,
      createdAt: Date.now(),
      text,
      note: mergedNote(plan2.absorbed)
    });
    if (mark3 === null) return;
    const before = docMarks;
    docMarks = placeMark(docMarks, plan2.absorbed, mark3);
    repaintMarks();
    const painted3 = paintedRangeOf(mark3);
    if (painted3 !== null) activateMark({ mark: mark3, range: painted3 });
    try {
      if (target.origin === "live") {
        const kept = await keptRow(target);
        if (shown !== target) return;
        if (!kept) throw new Error("The article could not be saved");
        void refreshActions();
      }
      await putMarks(target.url, docMarks);
    } catch {
      if (shown !== target) return;
      docMarks = before;
      deselectMark();
      repaintMarks();
      showNotice(t("reader_list_write_failed"));
    }
  }
  async function keptRow(target) {
    const existing = await getArticleMeta(target.url);
    if (shown !== target) return false;
    if (existing !== null) return true;
    return saveShownLive(target);
  }
  function onMarkTap(x, y, word) {
    const hit = markAt(x, y);
    if (hit !== null) {
      activateMark(hit);
      return;
    }
    if (word !== void 0 && growActiveBy(word)) return;
    setMarker(false);
  }
  function growActiveBy(word) {
    const active = activeMark;
    const root2 = contentRoot();
    if (active === null || root2 === null) return false;
    const span2 = anchorOf(word, root2, shownSegment());
    if (span2 === null || span2.segmentIndex !== active.segmentIndex) return false;
    if (span2.start.block === active.end.block && comparePoints(span2.start, active.end) >= 0) {
      const prose = proseTextOf(root2, active.end.block);
      if (prose === null || !wordless(prose.slice(active.end.offset, span2.start.offset))) return false;
      void commitSpan({ segmentIndex: span2.segmentIndex, start: active.start, end: span2.end }, active.color);
      return true;
    }
    if (span2.end.block === active.start.block && comparePoints(active.start, span2.end) >= 0) {
      const prose = proseTextOf(root2, active.start.block);
      if (prose === null || !wordless(prose.slice(span2.end.offset, active.start.offset))) return false;
      void commitSpan({ segmentIndex: span2.segmentIndex, start: span2.start, end: active.end }, active.color);
      return true;
    }
    return false;
  }
  function stepOut() {
    if (activeMark !== null) deselectMark();
    else setMarker(false);
  }
  function activateMark(hit) {
    activeMark = hit.mark;
    placeMarkPins(hit.range);
    refreshMarkBar();
  }
  function placeMarkPins(range2) {
    if (markPinStart === null || markPinEnd === null) return;
    const { head: first, tail: last } = markEdges(range2);
    if (first === null || last === null) return;
    markPinStart.style.left = `${Math.round(first.left + window.scrollX - 3)}px`;
    markPinStart.style.top = `${Math.round(first.top + window.scrollY)}px`;
    markPinStart.style.height = `${Math.round(first.height)}px`;
    markPinStart.hidden = false;
    markPinEnd.style.left = `${Math.round(last.right + window.scrollX + 1)}px`;
    markPinEnd.style.top = `${Math.round(last.top + window.scrollY)}px`;
    markPinEnd.style.height = `${Math.round(last.height)}px`;
    markPinEnd.hidden = false;
  }
  function refreshMarkBar() {
    if (markBar === null) return;
    const ink2 = activeMark === null ? settings.reader.markerColor : activeMark.color;
    for (const button of markBar.querySelectorAll("button[data-mark-ink]")) {
      button.setAttribute("aria-pressed", String(ink2 === button.getAttribute("data-mark-ink")));
    }
    if (markCopyButton !== null) markCopyButton.hidden = activeMark === null;
    if (markDeleteButton !== null) markDeleteButton.hidden = activeMark === null;
    if (markNoteButton !== null) {
      markNoteButton.hidden = activeMark === null;
      if (activeMark !== null) {
        const name2 = activeMark.note === void 0 ? t("marker_note_add") : t("marker_note_edit");
        markNoteButton.title = name2;
        markNoteButton.setAttribute("aria-label", name2);
        markNoteButton.toggleAttribute("data-has-note", activeMark.note !== void 0);
      }
    }
  }
  function deselectMark() {
    activeMark = null;
    if (markPinStart !== null) markPinStart.hidden = true;
    if (markPinEnd !== null) markPinEnd.hidden = true;
    if (markBar !== null && document.activeElement instanceof Element && (document.activeElement === markCopyButton || document.activeElement === markNoteButton || document.activeElement === markDeleteButton)) {
      markerButton?.focus();
    }
    refreshMarkBar();
  }
  async function onMarkDeletePress() {
    const target = shown;
    const active = activeMark;
    deselectMark();
    if (target === null || active === null) return;
    const before = docMarks;
    docMarks = withoutMark(docMarks, active);
    if (docMarks.length === before.length) return;
    repaintMarks();
    try {
      await putMarks(target.url, docMarks);
    } catch {
      if (shown !== target) return;
      docMarks = before;
      repaintMarks();
      showNotice(t("reader_list_write_failed"));
    }
  }
  async function onMarkCopyPress() {
    const active = activeMark;
    if (active === null || markCopyButton === null) return;
    try {
      await navigator.clipboard.writeText(active.text);
    } catch {
      return;
    }
    markCopyButton.setAttribute("data-copied", "");
    if (markCopyLabel !== null) markCopyLabel.textContent = t("marker_copied");
    if (copiedTimer !== null) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
      copiedTimer = null;
      markCopyButton.removeAttribute("data-copied");
      if (markCopyLabel !== null) markCopyLabel.textContent = t("marker_copy");
    }, 1500);
  }
  function showNoteBadges() {
    if (markNoteBadges === null) return;
    const badges = [];
    for (const mark3 of docMarks) {
      if (mark3.note === void 0) continue;
      const range2 = paintedRangeOf(mark3);
      if (range2 === null) continue;
      const last = markEdges(range2).tail;
      if (last === null) continue;
      const badge = document.createElement("button");
      badge.type = "button";
      badge.className = "mark-note-badge";
      badge.title = t("marker_note_edit");
      badge.setAttribute("aria-label", t("marker_note_edit"));
      if (marksNoteIcon !== null) badge.append(marksNoteIcon.content.cloneNode(true));
      const left = Math.min(
        Math.round(last.right + window.scrollX - 6),
        document.documentElement.clientWidth - 42
      );
      badge.style.left = `${left}px`;
      badge.style.top = `${Math.round(last.top + window.scrollY - 18)}px`;
      badge.addEventListener("click", () => onNoteBadgePress(mark3));
      badges.push(badge);
    }
    markNoteBadges.replaceChildren(...badges);
  }
  function onNoteBadgePress(mark3) {
    const target = shown;
    if (target === null) return;
    openNoteDialog(mark3, (text) => void applyNoteInDoc(target, mark3, text));
  }
  function onMarkNotePress() {
    const target = shown;
    const active = activeMark;
    if (target === null || active === null) return;
    openNoteDialog(active, (text) => void applyNoteInDoc(target, active, text));
  }
  var noteDialogSave = null;
  function openNoteDialog(mark3, onSave) {
    if (noteDialog === null || noteText === null) return;
    noteDialogSave = onSave;
    if (noteQuote !== null) {
      noteQuote.textContent = mark3.text;
      noteQuote.setAttribute("data-color", mark3.color);
    }
    noteText.value = mark3.note ?? "";
    noteDialog.showModal();
    sizeNoteBox();
  }
  function sizeNoteBox() {
    if (noteText === null) return;
    noteText.style.height = "auto";
    noteText.style.height = `${noteText.scrollHeight + 2}px`;
  }
  function closeNoteDialog() {
    noteDialogSave = null;
    if (noteDialog !== null && noteDialog.open) noteDialog.close();
  }
  function onNoteSavePress() {
    const save = noteDialogSave;
    noteDialogSave = null;
    if (noteDialog !== null && noteDialog.open) noteDialog.close();
    if (save !== null && noteText !== null) save(noteText.value);
  }
  async function applyNoteInDoc(target, mark3, text) {
    if (shown !== target || !docMarks.includes(mark3)) {
      if (await writeNoteByAnchor(target.url, mark3, text)) {
        showNotice(t("reader_list_write_failed"));
      }
      return;
    }
    const next = markRecord({ ...mark3, note: text });
    if (next === null || (next.note ?? "") === (mark3.note ?? "")) return;
    const before = docMarks;
    const wasActive = activeMark === mark3;
    docMarks = docMarks.map((one) => one === mark3 ? next : one);
    adoptPaintedMark(mark3, next);
    if (wasActive) activeMark = next;
    refreshMarkBar();
    showNoteBadges();
    try {
      await putMarks(target.url, docMarks);
    } catch {
      if (shown !== target) return;
      docMarks = before;
      adoptPaintedMark(next, mark3);
      if (activeMark === next) activeMark = mark3;
      refreshMarkBar();
      showNoteBadges();
      showNotice(t("reader_list_write_failed"));
    }
  }
  async function writeNoteByAnchor(docId, mark3, text) {
    try {
      const list = await getMarks(docId);
      const found = list.find((one) => compareMarks(one, mark3) === 0);
      if (found === void 0) return false;
      const next = markRecord({ ...found, note: text });
      if (next === null || (next.note ?? "") === (found.note ?? "")) return false;
      await putMarks(
        docId,
        list.map((one) => one === found ? next : one)
      );
      return false;
    } catch {
      return true;
    }
  }
  function noteMarkRow(row) {
    openNoteDialog(row.mark, (text) => {
      void (async () => {
        if (await writeNoteByAnchor(row.docId, row.mark, text)) {
          showNotice(t("reader_list_write_failed"));
        }
        if (marksShown !== null) await refreshMarks();
      })();
    });
  }
  async function onMarkInkPress(ink2) {
    const target = shown;
    const active = activeMark;
    if (!isMarkColor(ink2)) return;
    if (active === null) {
      adoptConfig(await writeConfig({ reader: { markerColor: ink2 } }));
      return;
    }
    if (target === null || active.color === ink2) return;
    const next = markRecord({ ...active, color: ink2 });
    if (next === null) return;
    const before = docMarks;
    docMarks = docMarks.map((one) => one === active ? next : one);
    activeMark = next;
    repaintMarks();
    refreshMarkBar();
    try {
      await putMarks(target.url, docMarks);
    } catch {
      if (shown !== target) return;
      docMarks = before;
      activeMark = active;
      repaintMarks();
      refreshMarkBar();
      showNotice(t("reader_list_write_failed"));
    }
  }
  markerButton?.addEventListener("click", () => setMarker(!markerOn));
  markCopyButton?.addEventListener("click", () => void onMarkCopyPress());
  markNoteButton?.addEventListener("click", () => onMarkNotePress());
  markDeleteButton?.addEventListener("click", () => void onMarkDeletePress());
  noteSaveButton?.addEventListener("click", () => onNoteSavePress());
  noteCancelButton?.addEventListener("click", () => closeNoteDialog());
  noteCloseButton?.addEventListener("click", () => closeNoteDialog());
  noteDialog?.addEventListener("close", () => {
    noteDialogSave = null;
  });
  noteDialog?.addEventListener("click", (event) => {
    if (event.target === noteDialog) closeNoteDialog();
  });
  noteText?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      onNoteSavePress();
    }
  });
  noteText?.addEventListener("input", () => sizeNoteBox());
  markBar?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const ink2 = target.closest("button[data-mark-ink]")?.getAttribute("data-mark-ink");
    if (typeof ink2 === "string") void onMarkInkPress(ink2);
  });
  document.addEventListener("pointerdown", (event) => {
    if (!markerOn) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (markBar?.contains(target) === true) return;
    if (markNoteBadges?.contains(target) === true) return;
    if (article?.contains(target) === true) return;
    if (chromeBox?.contains(target) === true) {
      deselectMark();
      return;
    }
    setMarker(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && markerOn && noteDialog?.open !== true) stepOut();
  });
  new ResizeObserver(() => showNoteBadges()).observe(document.body);
  window.addEventListener("resize", () => showNoteBadges());
  async function showPage(firstLoad = false) {
    const turn = ++epoch;
    const source = await readReaderSource();
    if (turn !== epoch) return;
    if (source === null) {
      const doc = asDocState(history.state);
      const quotes = asMarksState(history.state);
      if (doc === null && quotes === null) {
        await showLibrary();
      } else if (firstLoad) {
        if (quotes !== null) {
          await showMarks(quotes.scope, { fresh: true });
        } else if (doc !== null) {
          if (doc.kind === "book") await openBook(doc.url);
          else await openSaved(doc.url);
          if (shown === null) await showLibrary();
        }
      } else {
        unwindToList = true;
        history.back();
      }
      return;
    }
    if ("marks" in source) {
      hideNotice();
      const standing = asMarksState(history.state);
      if (standing === null || standing.scope !== null) history.pushState(marksState(null), "");
      await showMarks(null, { fresh: true });
      return;
    }
    const response = await webext().runtime.sendMessage({ kind: Message.READ_PAGE });
    if (turn !== epoch) return;
    const result = (
      /** @type {import("../lib/protocol.js").Result<unknown>} */
      asResult(response)
    );
    if (!result.ok) {
      showNotice(describeError(result.code));
      if (shown === null) await showLibrary();
      return;
    }
    const page = asPage(result.value);
    if (page === null) {
      showNotice(describeError(ErrorCode.INTERNAL));
      if (shown === null) await showLibrary();
      return;
    }
    renderLive(page);
  }
  async function openSaved(url, target) {
    const turn = ++epoch;
    const [saved, position, marks] = await Promise.all([
      getArticle(url),
      getPosition(url),
      getMarks(url).catch(() => [])
    ]);
    if (turn !== epoch) return;
    if (saved === null) {
      await refreshLibrary();
      return;
    }
    renderSaved(saved);
    docMarks = marks;
    repaintMarks();
    const rendered = shown;
    await refreshActions();
    if (shown !== rendered) return;
    const landed = target === void 0 ? false : "folded" in target ? scrollToSearchHit(target) : scrollToTargetMark(target);
    if (!landed) restorePosition(position);
    savePositionNow();
  }
  function showSegmentNav(segment2) {
    for (const nav of segmentNavs) {
      if (nav !== null) nav.hidden = segment2 === null;
    }
    if (segment2 === null) return;
    for (const label2 of segmentLabels) {
      if (label2 !== null) {
        label2.textContent = t("reader_book_part_of", [
          (segment2.index + 1).toLocaleString(),
          segment2.count.toLocaleString()
        ]);
      }
    }
    for (const button of segmentPrevs) {
      if (button instanceof HTMLButtonElement) button.disabled = segment2.index <= 0;
    }
    for (const button of segmentNexts) {
      if (button instanceof HTMLButtonElement) button.disabled = segment2.index >= segment2.count - 1;
    }
  }
  function showBookNote(book) {
    if (bookNote === null || bookNoteText === null) return;
    const declared = book === null ? "" : primaryLanguage(book.lang ?? "");
    const source = settings.translationOff ? null : settings.sourceLang;
    const mismatch = source !== null && declared.length > 0 && declared !== primaryLanguage(source);
    bookNote.hidden = !mismatch;
    if (mismatch && source !== null && book !== null) {
      bookNoteText.textContent = t("reader_book_pair_note", [
        languageName(declared),
        languageName(primaryLanguage(source))
      ]);
    }
  }
  function updateTocButtons() {
    for (const button of tocButtons) {
      if (button !== null) button.hidden = docToc.length === 0;
    }
    if (navToc !== null) navToc.hidden = docToc.length === 0;
  }
  function articleToc() {
    const root2 = contentRoot();
    tocBlocks = root2 === null ? [] : [...packableBlocks(root2)];
    return cappedToc(
      renderedEntries(
        tocBlocks.map((block) => ({
          localName: block.localName,
          text: block.textContent ?? ""
        })),
        0
      )
    );
  }
  function currentTocRow() {
    if (shown === null) return -1;
    if (shown.origin !== "book") {
      const line = chromeFold() + 2;
      let current3 = -1;
      for (const [index2, entry] of docToc.entries()) {
        const rect = tocBlocks[entry.blockIndex]?.getBoundingClientRect();
        if (rect !== void 0 && rect.top <= line) current3 = index2;
      }
      return current3;
    }
    const part = shownSegment();
    const block = topBlockIndex() ?? 0;
    let current2 = -1;
    for (const [index2, entry] of docToc.entries()) {
      if (entry.segmentIndex < part || entry.segmentIndex === part && entry.blockIndex <= block) {
        current2 = index2;
      }
    }
    return current2;
  }
  function openTocDialog() {
    if (tocDialog === null || tocRows === null || docToc.length === 0) return;
    let shallowest = 3;
    for (const entry of docToc) shallowest = Math.min(shallowest, entry.level);
    const current2 = currentTocRow();
    tocRows.replaceChildren(
      ...docToc.map((entry, index2) => {
        const row = document.createElement("button");
        row.type = "button";
        row.dataset["index"] = String(index2);
        row.dataset["depth"] = String(entry.level - shallowest);
        row.textContent = entry.title;
        if (index2 === current2) row.setAttribute("aria-current", "true");
        return row;
      })
    );
    tocDialog.showModal();
    const focus = current2 >= 0 ? tocRows.children[current2] : tocRows.firstElementChild;
    if (focus instanceof HTMLElement) {
      focus.focus({ preventScroll: true });
      tocRows.scrollTop = Math.max(
        0,
        focus.offsetTop - tocRows.offsetTop - (tocRows.clientHeight - focus.offsetHeight) / 2
      );
    }
  }
  function closeTocDialog() {
    if (tocDialog !== null && tocDialog.open) tocDialog.close();
  }
  function jumpToTocEntry(entry) {
    const target = shown;
    if (target === null) return;
    if (target.origin !== "book") {
      if (scrollToRect(tocBlocks[entry.blockIndex]?.getBoundingClientRect())) savePositionNow();
      return;
    }
    if (entry.segmentIndex === target.segmentIndex) {
      if (scrollToBlock(entry.blockIndex)) savePositionNow();
      return;
    }
    void openBook(target.url, entry.segmentIndex, {
      segmentIndex: entry.segmentIndex,
      block: entry.blockIndex
    });
  }
  async function backfillToc(book) {
    if (tocScansRunning.has(book.id)) return;
    tocScansRunning.add(book.id);
    try {
      const entries = [];
      for (let index2 = 0; index2 < book.segmentCount; index2 += 1) {
        const segment2 = await getBookSegment(book.id, index2);
        if (segment2 !== null) entries.push(...headingEntries(segment2.blocks, index2));
      }
      const toc = cappedToc(entries);
      if (!await setBookToc(book.id, toc)) return;
      if (shown !== null && shown.origin === "book" && shown.url === book.id) {
        docToc = toc;
        updateTocButtons();
      }
    } catch {
    } finally {
      tocScansRunning.delete(book.id);
    }
  }
  async function openBook(id, wanted, target) {
    const turn = ++epoch;
    const [book, position, marks] = await Promise.all([
      getBook(id),
      getPosition(id),
      getMarks(id).catch(() => [])
    ]);
    if (turn !== epoch) return;
    if (book === null) {
      await refreshLibrary();
      return;
    }
    const remembered = position !== null && position.segmentIndex < book.segmentCount ? position.segmentIndex : 0;
    const index2 = Math.min(Math.max(0, wanted ?? remembered), book.segmentCount - 1);
    const segment2 = await getBookSegment(id, index2);
    if (turn !== epoch) return;
    if (segment2 === null) {
      showNotice(t("reader_book_unreadable"));
      if (shown === null) await showLibrary();
      return;
    }
    renderArticle({
      origin: "book",
      url: id,
      title: book.title,
      credit: book.author === null ? [] : [book.author],
      dir: null,
      lang: book.lang,
      link: null,
      segment: { index: index2, count: book.segmentCount },
      // Our own rebuilt markup, stored at import - and still not trusted back:
      // parsed inert and rebuilt through the allowed list again.
      source: new DOMParser().parseFromString(segment2.blocks.join(""), "text/html").body
    });
    showSegmentNav({ index: index2, count: book.segmentCount });
    showBookNote(book);
    docToc = book.toc ?? [];
    updateTocButtons();
    if (book.toc === null) void backfillToc(book);
    docMarks = marks;
    repaintMarks();
    const rendered = shown;
    await refreshActions();
    if (shown !== rendered) return;
    const landed = target === void 0 ? false : "folded" in target ? scrollToSearchHit(target) : "start" in target ? scrollToTargetMark(target) : scrollToBlock(target.block);
    if (!landed) restorePosition(position, index2);
    savePositionNow();
  }
  var SEARCH_WASH = "reread-search";
  var disarmSearchWash = null;
  function washSearchHit(range2) {
    clearSearchWash();
    if (!supported()) return;
    CSS.highlights.set(SEARCH_WASH, new Highlight(range2));
    const clear2 = () => clearSearchWash();
    window.addEventListener("pointerdown", clear2, { once: true, capture: true });
    window.addEventListener("keydown", clear2, { once: true, capture: true });
    disarmSearchWash = () => {
      window.removeEventListener("pointerdown", clear2, true);
      window.removeEventListener("keydown", clear2, true);
    };
  }
  function clearSearchWash() {
    if (disarmSearchWash !== null) {
      disarmSearchWash();
      disarmSearchWash = null;
    }
    if (supported()) CSS.highlights.delete(SEARCH_WASH);
  }
  function scrollToSearchHit(target) {
    const root2 = contentRoot();
    const text = root2 === null ? null : proseTextOf(root2, target.block);
    if (root2 === null || text === null) return false;
    let best = null;
    for (const span2 of hitsInText(text, target.folded)) {
      if (best === null || Math.abs(span2.start - target.from) < Math.abs(best.start - target.from)) {
        best = span2;
      }
    }
    if (best === null) return scrollToBlock(target.block);
    const range2 = rangeWithin(root2, target.block, best.start, best.end);
    if (range2 === null) return scrollToBlock(target.block);
    washSearchHit(range2);
    return scrollToRect(range2.getClientRects()[0] ?? range2.getBoundingClientRect());
  }
  function scrollToTargetMark(target) {
    const mark3 = docMarks.find(
      (one) => one.segmentIndex === target.segmentIndex && comparePoints(one.start, target.start) === 0
    );
    if (mark3 === void 0) return false;
    const range2 = paintedRangeOf(mark3);
    const rect = range2?.getClientRects()[0] ?? contentRoot()?.children[mark3.start.block]?.getBoundingClientRect();
    if (rect === void 0) return false;
    scrollTo(0, Math.max(0, rect.top + window.scrollY - chromeFold() - 8));
    return true;
  }
  function scrollToRect(rect) {
    if (rect === void 0) return false;
    scrollTo(0, Math.max(0, rect.top + window.scrollY - chromeFold() - 8));
    return true;
  }
  function scrollToBlock(block) {
    return scrollToRect(contentRoot()?.children[block]?.getBoundingClientRect());
  }
  function turnSegment(step) {
    const target = shown;
    if (target === null || target.origin !== "book") return;
    const next = target.segmentIndex + step;
    if (next < 0 || next >= target.segmentCount) return;
    void openBook(target.url, next);
  }
  function leaveDocView() {
    epoch += 1;
    flushPosition();
    shown = null;
    forgetReading();
    stopMarkSpeech();
    updateListen();
    setMarker(false);
    docMarks = [];
    clearMarkPaint();
    showNoteBadges();
    if (article !== null) article.hidden = true;
    if (actions !== null) actions.hidden = true;
    if (actionsEnd !== null) actionsEnd.hidden = true;
    if (toLibraryButton !== null) toLibraryButton.hidden = true;
    if (originalLink !== null) originalLink.hidden = true;
    showSegmentNav(null);
    showBookNote(null);
    docToc = [];
    tocBlocks = [];
    updateTocButtons();
    closeTocDialog();
    clearSearchWash();
    closeDocSearch();
    resetDocSearch();
  }
  async function showLibrary() {
    leaveDocView();
    document.body.dataset["view"] = "list";
    marksShown = null;
    if (marksSection !== null) marksSection.hidden = true;
    if (navLibrary !== null) navLibrary.hidden = true;
    if (navMarks !== null) navMarks.hidden = false;
    if (navSearch !== null) navSearch.hidden = true;
    if (library !== null) library.hidden = false;
    document.title = t("reader_title");
    scrollTo(0, 0);
    await refreshLibrary();
  }
  async function showMarks(scope2, { fresh = false } = {}) {
    leaveDocView();
    document.body.dataset["view"] = "marks";
    marksShown = { scope: scope2 };
    if (fresh) {
      marksQuery = "";
      marksPage = 1;
      if (marksFilter !== null) marksFilter.value = "";
    }
    if (library !== null) library.hidden = true;
    if (navLibrary !== null) navLibrary.hidden = false;
    if (navMarks !== null) navMarks.hidden = true;
    if (navSearch !== null) navSearch.hidden = true;
    if (marksSection !== null) marksSection.hidden = false;
    if (toLibraryButton !== null) toLibraryButton.hidden = false;
    setBackDoor(t("reader_back_to_list"), t("reading_list"));
    document.title = `${t("reader_marks_title")} - re/read`;
    rootReadingSide(marksRowsList);
    scrollTo(0, 0);
    await refreshMarks();
  }
  async function refreshLibrary() {
    if (libraryEmpty === null || libraryRows === null) return;
    const [metas, books, positions, marks] = await Promise.all([
      listArticles(),
      listBooks(),
      allPositions(),
      allMarks().catch(() => /* @__PURE__ */ new Map())
    ]);
    const entries = [
      ...metas.map((meta) => articleEntry(meta, positions.get(meta.url) ?? null)),
      ...books.map((book) => bookEntry(book, positions.get(book.id) ?? null))
    ];
    const view = libraryView(entries, { segment, query: libraryQuery, page: libraryPage });
    libraryPage = view.page;
    for (const button of librarySegments?.querySelectorAll("button[data-segment]") ?? []) {
      const which = button.getAttribute("data-segment");
      button.setAttribute("aria-pressed", String(which === segment));
      button.textContent = which === Segment.READ ? t("reader_segment_read_count", view.read.toLocaleString()) : t("reader_segment_unread_count", view.unread.toLocaleString());
    }
    if (exportButton !== null) exportButton.disabled = metas.length === 0;
    if (exportMarksButton !== null) exportMarksButton.disabled = marks.size === 0;
    if (libraryCount !== null) {
      const filtering = libraryQuery.trim().length > 0;
      libraryCount.hidden = !filtering;
      if (filtering) {
        libraryCount.textContent = t("reader_filter_count", [
          view.matching.toLocaleString(),
          view.inSegment.toLocaleString()
        ]);
      }
    }
    if (view.rows.length === 0) {
      libraryEmpty.replaceChildren();
      if (view.inSegment > 0) {
        const sentence = document.createElement("p");
        sentence.textContent = t("reader_filter_no_match", libraryQuery);
        const clear2 = document.createElement("button");
        clear2.type = "button";
        clear2.textContent = t("reader_filter_clear");
        clear2.addEventListener("click", () => {
          libraryQuery = "";
          libraryPage = 1;
          if (libraryFilter !== null) {
            libraryFilter.value = "";
            libraryFilter.focus();
          }
          void refreshLibrary();
        });
        libraryEmpty.append(sentence, clear2);
      } else {
        libraryEmpty.textContent = emptySentence(entries.length, segment);
      }
      libraryEmpty.hidden = false;
    } else {
      libraryEmpty.hidden = true;
    }
    libraryRows.replaceChildren(...view.rows.map(libraryRow));
    renderLibraryPager(view);
    applyLibrarySearchVisibility();
  }
  function applyLibrarySearchVisibility() {
    const on = librarySearchShown();
    if (on) {
      const plain = [librarySegments, libraryCount, libraryEmpty, libraryRows, libraryPager];
      for (const element of plain) {
        if (element !== null) element.hidden = true;
      }
    } else {
      if (librarySegments !== null) librarySegments.hidden = false;
      if (libraryRows !== null) libraryRows.hidden = false;
    }
    if (librarySearchSection !== null) librarySearchSection.hidden = !on;
  }
  function updateSearchControls() {
    if (librarySearchGo === null || librarySearchToggle === null) return;
    librarySearchGo.hidden = !librarySearchToggle.checked;
    librarySearchGo.disabled = !isSearchableQuery(libraryFilter?.value ?? "");
  }
  async function runLibrarySearch() {
    const query = libraryFilter?.value ?? "";
    if (!isSearchableQuery(query)) return;
    await startLibrarySearch(query);
    applyLibrarySearchVisibility();
  }
  function renderLibraryPager(view) {
    if (libraryPager === null) return;
    libraryPager.hidden = view.pages <= 1;
    if (libraryPageLabel !== null) {
      libraryPageLabel.textContent = t("pager_page_of", [
        view.page.toLocaleString(),
        view.pages.toLocaleString()
      ]);
    }
    if (libraryPrev !== null) libraryPrev.disabled = view.page <= 1;
    if (libraryNext !== null) libraryNext.disabled = view.page >= view.pages;
  }
  function libraryRow(entry) {
    const item = document.createElement("li");
    item.className = "library-row";
    const text = document.createElement("div");
    text.className = "library-text";
    const open3 = document.createElement("button");
    open3.type = "button";
    open3.className = "library-open";
    open3.setAttribute("data-url", entry.url);
    open3.setAttribute("data-kind", entry.kind);
    open3.textContent = entry.title;
    const detail = document.createElement("span");
    detail.className = "library-item-detail";
    const percent = entry.readAt === null && entry.percentRead !== null && entry.percentRead > 0 ? t("reader_percent_read", entry.percentRead.toLocaleString()) : "";
    if (entry.kind === "book") {
      const progress = entry.progress === null ? "" : t("reader_book_part_of", [
        entry.progress.at.toLocaleString(),
        entry.progress.of.toLocaleString()
      ]);
      detail.textContent = [entry.hostname, t("reader_book_label"), progress, percent].filter((part) => part.length > 0).join(" - ");
    } else {
      const when = entry.savedAt > 0 ? new Date(entry.savedAt).toLocaleDateString() : "";
      detail.textContent = [entry.hostname, when, percent].filter((part) => part.length > 0).join(" - ");
    }
    text.append(open3, detail);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "library-delete";
    remove.setAttribute("data-url", entry.url);
    remove.setAttribute("data-kind", entry.kind);
    remove.textContent = t("action_delete");
    remove.setAttribute("aria-label", t("reader_delete_aria", entry.title));
    item.append(text, remove);
    return item;
  }
  async function refreshMarks() {
    if (marksRowsList === null || marksEmpty === null) return;
    const [metas, books, marks] = await Promise.all([
      listArticles(),
      listBooks(),
      allMarks().catch(() => /* @__PURE__ */ new Map())
    ]);
    const target = marksShown;
    if (target === null) return;
    const rows2 = markRows(metas, books, marks);
    const view = marksListView(rows2, { scope: target.scope, query: marksQuery, page: marksPage });
    marksPage = view.page;
    marksOnScreen = view.rows;
    const scopeTitle = target.scope === null ? null : metas.find((meta) => meta.url === target.scope)?.title ?? books.find((book) => book.id === target.scope)?.title ?? null;
    if (marksDocLine !== null) {
      marksDocLine.hidden = scopeTitle === null;
      marksDocLine.textContent = scopeTitle ?? "";
    }
    if (scopeTitle !== null) setBackDoor(t("reader_back_to_doc", scopeTitle), scopeTitle);
    if (marksExportButton !== null) marksExportButton.disabled = view.total === 0;
    if (marksCount !== null) {
      const filtering = marksQuery.trim().length > 0;
      marksCount.hidden = !filtering;
      if (filtering) {
        marksCount.textContent = t("reader_filter_count", [
          view.matching.toLocaleString(),
          view.total.toLocaleString()
        ]);
      }
    }
    if (view.rows.length === 0) {
      marksEmpty.replaceChildren();
      if (view.total > 0) {
        const sentence = document.createElement("p");
        sentence.textContent = t("reader_marks_no_match", marksQuery);
        const clear2 = document.createElement("button");
        clear2.type = "button";
        clear2.textContent = t("reader_filter_clear");
        clear2.addEventListener("click", () => {
          marksQuery = "";
          marksPage = 1;
          if (marksFilter !== null) {
            marksFilter.value = "";
            marksFilter.focus();
          }
          void refreshMarks();
        });
        marksEmpty.append(sentence, clear2);
      } else if (target.scope === null) {
        const sentence = document.createElement("p");
        sentence.textContent = t("reader_marks_empty");
        const toList = document.createElement("button");
        toList.type = "button";
        toList.textContent = t("reading_list");
        toList.addEventListener("click", () => leaveToList());
        marksEmpty.append(sentence, toList);
      } else {
        marksEmpty.textContent = t("reader_marks_empty_doc");
      }
      marksEmpty.hidden = false;
    } else {
      marksEmpty.hidden = true;
    }
    dismiss();
    marksRowsList.replaceChildren(
      ...view.rows.map((row, index2) => markRowElement(row, index2, target.scope === null))
    );
    rescan();
    if (marksPager !== null) {
      marksPager.hidden = view.pages <= 1;
      if (marksPageLabel !== null) {
        marksPageLabel.textContent = t("pager_page_of", [
          view.page.toLocaleString(),
          view.pages.toLocaleString()
        ]);
      }
      if (marksPrev !== null) marksPrev.disabled = view.page <= 1;
      if (marksNext !== null) marksNext.disabled = view.page >= view.pages;
    }
  }
  function markActButton(act, index2, name2, icon) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `marks-act marks-${act}`;
    button.setAttribute("data-act", act);
    button.setAttribute("data-row", String(index2));
    button.title = name2;
    button.setAttribute("aria-label", name2);
    if (icon !== null) button.append(icon.content.cloneNode(true));
    return button;
  }
  function markRowElement(row, index2, withTitle) {
    const item = document.createElement("li");
    item.className = "library-row marks-row";
    item.setAttribute("data-color", row.mark.color);
    const text = document.createElement("div");
    text.className = "library-text";
    const quote = document.createElement("div");
    quote.className = "marks-quote";
    for (const piece of row.mark.text.split("\n")) {
      const paragraph = document.createElement("p");
      paragraph.textContent = piece;
      quote.append(paragraph);
    }
    const detail = document.createElement("span");
    detail.className = "library-item-detail";
    const when = row.mark.createdAt > 0 ? new Date(row.mark.createdAt).toLocaleDateString() : "";
    const part = row.part === null ? "" : t("reader_book_part_of", [row.part.at.toLocaleString(), row.part.of.toLocaleString()]);
    detail.textContent = [withTitle ? row.title : "", part, when].filter((piece) => piece.length > 0).join(" - ");
    text.append(quote);
    if (row.mark.note !== void 0) {
      const note = document.createElement("p");
      note.className = "marks-note";
      note.textContent = row.mark.note;
      text.append(note);
    }
    text.append(detail);
    const acts = document.createElement("span");
    acts.className = "marks-row-acts";
    acts.append(markActButton("open", index2, t("reader_marks_open", row.title), marksOpenIcon));
    if (canSpeak()) {
      acts.append(markActButton("speak", index2, t("reader_listen"), marksSpeakIcon));
    }
    acts.append(markActButton("copy", index2, t("marker_copy"), marksCopyIcons));
    acts.append(
      markActButton(
        "note",
        index2,
        row.mark.note === void 0 ? t("marker_note_add") : t("marker_note_edit"),
        marksNoteIcon
      )
    );
    item.append(text, acts);
    return item;
  }
  async function openMarkRow(row) {
    hideNotice();
    history.pushState(docState(row.kind, row.docId), "");
    const target = { segmentIndex: row.mark.segmentIndex, start: row.mark.start };
    if (row.kind === "book") await openBook(row.docId, row.mark.segmentIndex, target);
    else await openSaved(row.docId, target);
    if (shown === null) {
      history.back();
      return;
    }
    setBackDoor(t("reader_marks_back"), t("reader_marks_title"));
  }
  async function copyMarkRow(button, row) {
    try {
      await navigator.clipboard.writeText(row.mark.text);
    } catch {
      return;
    }
    button.setAttribute("data-copied", "");
    button.title = t("marker_copied");
    button.setAttribute("aria-label", t("marker_copied"));
    setTimeout(() => {
      button.removeAttribute("data-copied");
      button.title = t("marker_copy");
      button.setAttribute("aria-label", t("marker_copy"));
    }, 1500);
  }
  function markRowKey(row) {
    const { mark: mark3 } = row;
    return `${row.docId}
${mark3.segmentIndex}:${mark3.start.block}:${mark3.start.offset}`;
  }
  function speakMarkRow(row) {
    const key = markRowKey(row);
    if (speaking() && soundingMark === key) {
      stop();
      soundingMark = null;
      return;
    }
    soundingMark = key;
    const lang = row.lang ?? settings.sourceLang ?? "";
    speak(row.mark.text, lang, settings.ttsVoices[primaryLanguage(lang)], settings.ttsRate / 100);
  }
  function stopMarkSpeech() {
    if (soundingMark === null) return;
    soundingMark = null;
    stop();
  }
  function deleteTitle(button) {
    if (button === removeButton) return titleElement?.textContent ?? "";
    return button.closest("li")?.querySelector(".library-open")?.textContent ?? "";
  }
  function armedDelete() {
    const armed = document.querySelector("button[data-armed]");
    return armed instanceof HTMLButtonElement ? armed : null;
  }
  function disarmDelete() {
    const armed = armedDelete();
    if (armed === null) return;
    armed.removeAttribute("data-armed");
    if (armed === removeButton) armed.style.removeProperty("min-width");
    armed.textContent = t("action_delete");
    armed.setAttribute("aria-label", t("reader_delete_aria", deleteTitle(armed)));
  }
  function armDelete(button) {
    disarmDelete();
    button.setAttribute("data-armed", "");
    button.textContent = t("reader_delete_confirm");
    button.setAttribute("aria-label", t("reader_delete_confirm_aria", deleteTitle(button)));
  }
  async function removeRow(button, url, kind) {
    const deletes = () => libraryRows === null ? [] : [...libraryRows.querySelectorAll("button.library-delete")];
    const at2 = deletes().indexOf(button);
    try {
      if (kind === "book") await deleteBook(url);
      else await deleteArticle(url);
    } catch {
      showNotice(t("reader_list_write_failed"));
    }
    await refreshLibrary();
    const successor = deletes()[Math.min(at2, deletes().length - 1)];
    if (successor instanceof HTMLButtonElement) successor.focus();
    else libraryFilter?.focus();
  }
  async function exportList() {
    try {
      const [articles, marks] = await Promise.all([allArticles(), allMarks()]);
      if (articles.length === 0) return;
      downloadFile(toArticlesFile(articles, marks), ARTICLES_FILENAME, "application/json");
      transferStatus("");
    } catch {
      transferStatus(describeError(ErrorCode.INTERNAL), "error");
    }
  }
  async function markedDocs(scope2) {
    const [metas, books, marks] = await Promise.all([listArticles(), listBooks(), allMarks()]);
    const docs = [];
    for (const meta of metas) {
      const kept = marks.get(meta.url);
      if (kept !== void 0 && (scope2 === null || meta.url === scope2)) {
        docs.push({ title: meta.title, source: meta.url, at: meta.savedAt, marks: kept });
      }
    }
    for (const book of books) {
      const kept = marks.get(book.id);
      if (kept !== void 0 && (scope2 === null || book.id === scope2)) {
        docs.push({ title: book.title, source: book.author, at: book.addedAt, marks: kept });
      }
    }
    return docs;
  }
  async function exportMarks() {
    try {
      const docs = await markedDocs(null);
      if (docs.length === 0) return;
      downloadFile(toMarksFile(docs), MARKS_FILENAME, "text/markdown");
      transferStatus("");
    } catch {
      transferStatus(describeError(ErrorCode.INTERNAL), "error");
    }
  }
  async function exportMarksPage() {
    try {
      const docs = await markedDocs(marksShown === null ? null : marksShown.scope);
      if (docs.length === 0) return;
      downloadFile(toMarksFile(docs), MARKS_FILENAME, "text/markdown");
    } catch {
      showNotice(describeError(ErrorCode.INTERNAL));
    }
  }
  function downloadFile(content, filename, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 6e4);
  }
  async function offerImport(file) {
    try {
      const parsed = fromArticlesFile(await file.text());
      if (parsed.articles.length === 0) {
        pendingImport = null;
        renderImportOffer();
        transferStatus(t("reader_import_nothing"), "error");
        return;
      }
      pendingImport = { name: file.name, articles: parsed.articles, invalid: parsed.invalid };
      transferStatus("");
      renderImportOffer();
    } catch {
      pendingImport = null;
      renderImportOffer();
      transferStatus(describeError(ErrorCode.INTERNAL), "error");
    }
  }
  function renderImportOffer() {
    if (importConfirm === null) return;
    importConfirm.hidden = pendingImport === null;
    if (pendingImport === null) return;
    if (importSummary !== null) {
      importSummary.textContent = plural(pendingImport.articles.length, "reader_import_summary", [
        pendingImport.name
      ]);
    }
    if (importSample !== null) {
      importSample.replaceChildren();
      for (const article2 of pendingImport.articles.slice(0, SAMPLE_TITLES)) {
        const item = document.createElement("li");
        item.textContent = article2.title;
        importSample.append(item);
      }
    }
  }
  function closeImportOffer() {
    pendingImport = null;
    renderImportOffer();
  }
  async function runImport() {
    if (pendingImport === null || importRun === null) return;
    const offered = pendingImport;
    importRun.disabled = true;
    try {
      const report = await importArticles(offered.articles);
      const sentences = [plural(report.added, "reader_import_added")];
      if (report.skipped > 0) sentences.push(plural(report.skipped, "reader_import_skipped"));
      if (offered.invalid > 0) sentences.push(plural(offered.invalid, "reader_import_unreadable"));
      transferStatus(sentences.join(" "));
      closeImportOffer();
      await refreshLibrary();
    } catch {
      transferStatus(t("reader_list_write_failed"), "error");
    } finally {
      importRun.disabled = false;
    }
  }
  async function refreshActions() {
    if (actions === null) return;
    const target = shown;
    if (target === null) {
      actions.hidden = true;
      if (actionsEnd !== null) actionsEnd.hidden = true;
      if (toLibraryButton !== null) toLibraryButton.hidden = true;
      return;
    }
    const row = target.origin === "book" ? await getBook(target.url).catch(() => null) : await getArticleMeta(target.url).catch(() => null);
    if (shown !== target) return;
    actions.hidden = false;
    if (actionsEnd !== null) actionsEnd.hidden = false;
    if (toLibraryButton !== null) toLibraryButton.hidden = false;
    if (toLibraryEndButton !== null) toLibraryEndButton.hidden = false;
    if (keepButton !== null) {
      keepButton.hidden = target.origin !== "live";
      keepButton.textContent = row === null ? t("reader_save") : t("reader_saved");
      keepButton.setAttribute("aria-pressed", String(row !== null));
    }
    if (removeButton !== null) {
      removeButton.hidden = target.origin === "live" || row === null;
      removeButton.removeAttribute("data-armed");
      removeButton.style.removeProperty("min-width");
      removeButton.textContent = t("action_delete");
      removeButton.setAttribute("aria-label", t("reader_delete_aria", deleteTitle(removeButton)));
    }
    const read = row !== null && row.readAt !== null;
    const book = target.origin === "book";
    const label2 = book ? read ? t("reader_book_marked_read") : t("reader_mark_book_read") : read ? t("reader_marked_read") : t("reader_mark_read");
    const lastPart = target.origin !== "book" || target.segmentIndex >= target.segmentCount - 1;
    for (const button of [markReadButton, markReadEndButton]) {
      if (button === null) continue;
      button.hidden = row === null || button === markReadEndButton && !lastPart;
      button.textContent = label2;
      button.setAttribute("aria-pressed", String(read));
    }
  }
  async function onKeepPress() {
    const target = shown;
    if (target === null || target.origin !== "live") return;
    try {
      const existing = await getArticleMeta(target.url);
      if (shown !== target) return;
      if (existing !== null) {
        await deleteArticle(target.url);
        if (shown === target) {
          docMarks = [];
          repaintMarks();
        }
      } else if (!await saveShownLive(target)) return;
    } catch {
      showNotice(t("reader_list_write_failed"));
      return;
    }
    if (shown === target) void refreshActions();
  }
  async function saveShownLive(target) {
    if (article === null || contentElement === null || titleElement === null) return false;
    const root2 = contentElement.firstElementChild;
    const record = savedArticle({
      url: target.url,
      title: titleElement.textContent ?? "",
      content: root2 === null ? "" : root2.innerHTML,
      dir: article.getAttribute("dir"),
      lang: article.getAttribute("lang"),
      savedAt: Date.now()
    });
    if (record === null) return false;
    await putArticle(record);
    return true;
  }
  async function openLiveActions(target) {
    try {
      const { keepArticles } = await readConfig();
      if (keepArticles && shown === target) await keptRow(target);
    } catch {
      showNotice(t("reader_list_write_failed"));
    }
    if (shown === target) await refreshActions();
  }
  async function onRemovePress() {
    const target = shown;
    if (target === null || target.origin === "live") return;
    if (!(removeButton instanceof HTMLButtonElement)) return;
    if (!removeButton.hasAttribute("data-armed")) {
      removeButton.style.minWidth = `${removeButton.offsetWidth}px`;
      armDelete(removeButton);
      return;
    }
    try {
      if (target.origin === "book") await deleteBook(target.url);
      else await deleteArticle(target.url);
    } catch {
      showNotice(t("reader_list_write_failed"));
      return;
    }
    if (shown !== target) return;
    onBackPress();
  }
  async function onMarkReadPress() {
    const target = shown;
    if (target === null) return;
    try {
      if (target.origin === "book") {
        const book = await getBook(target.url);
        if (shown !== target || book === null) return;
        await setBookReadAt(target.url, book.readAt === null ? Date.now() : null);
      } else {
        const meta = await getArticleMeta(target.url);
        if (shown !== target || meta === null) return;
        await setReadAt(target.url, meta.readAt === null ? Date.now() : null);
      }
    } catch {
      showNotice(t("reader_list_write_failed"));
      return;
    }
    if (shown === target) void refreshActions();
  }
  function applyAppearance(reader) {
    const root2 = document.documentElement;
    applyReading(root2, reader);
    root2.dataset["readerLinks"] = reader.links;
    root2.style.setProperty("--reader-measure", `${reader.measure}ch`);
    const pinned = reader.measure * DEFAULTS.reader.fontSize / reader.fontSize;
    root2.style.setProperty("--reader-measure-pinned", `${pinned.toFixed(2)}ch`);
    root2.style.setProperty("--reader-marker-current", `var(--reader-marker-${reader.markerColor})`);
    if (sizeValue !== null) sizeValue.textContent = String(reader.fontSize);
    if (measureValue !== null) measureValue.textContent = String(reader.measure);
    applyLinkStops(reader.links);
    for (const button of document.querySelectorAll(
      "[data-theme], [data-font], [data-links], [data-marker-color]"
    )) {
      const wanted = button.getAttribute("data-theme") ?? button.getAttribute("data-font") ?? button.getAttribute("data-links") ?? button.getAttribute("data-marker-color");
      const current2 = button.hasAttribute("data-theme") ? reader.theme : button.hasAttribute("data-font") ? reader.font : button.hasAttribute("data-links") ? reader.links : reader.markerColor;
      button.setAttribute("aria-pressed", String(wanted === current2));
    }
    refreshMarkBar();
    showNoteBadges();
  }
  function applyLinkStops(links) {
    if (contentElement === null) return;
    for (const anchor of contentElement.querySelectorAll("a[href]")) {
      if (links === "plain") {
        anchor.setAttribute("tabindex", "-1");
        anchor.setAttribute("draggable", "false");
      } else {
        anchor.removeAttribute("tabindex");
        anchor.removeAttribute("draggable");
      }
    }
  }
  function speechLang() {
    const declared = article?.getAttribute("lang") ?? "";
    return primaryLanguage(declared).length > 0 ? declared : settings.sourceLang ?? "";
  }
  function speechVoice() {
    const lang = speechLang();
    return {
      lang,
      voiceURI: settings.ttsVoices[primaryLanguage(lang)],
      // The engine's factor, out of the percent the config stores.
      rate: settings.ttsRate / 100
    };
  }
  function renderVoiceChoice() {
    if (voiceChoice === null) return;
    const lang = speechLang();
    const stored = settings.ttsVoices[primaryLanguage(lang)];
    const voices = canSpeak() ? voicesFor(speechSynthesis.getVoices(), lang) : [];
    const fallback = document.createElement("option");
    fallback.value = "";
    fallback.textContent = t("options_tts_default");
    fallback.selected = stored === void 0;
    voiceChoice.replaceChildren(
      fallback,
      ...voices.map((voice2) => {
        const option = document.createElement("option");
        option.value = voice2.voiceURI;
        option.textContent = `${voice2.name} (${voice2.lang})`;
        option.selected = voice2.voiceURI === stored;
        return option;
      })
    );
  }
  function applySpeech() {
    if (rateValue !== null) rateValue.textContent = `${(settings.ttsRate / 100).toFixed(1)}\xD7`;
    renderVoiceChoice();
    readingVoice(speechVoice());
  }
  function adoptConfig(config) {
    settings = config;
    applyAppearance(config.reader);
    applyUnderline(config);
    applySpeech();
    if (navVocabulary !== null) navVocabulary.hidden = config.translationOff;
  }
  function applyUnderline(config) {
    if (underlineSetting !== null) underlineSetting.hidden = config.translationOff;
    for (const button of document.querySelectorAll("[data-underline]")) {
      const wanted = button.getAttribute("data-underline");
      button.setAttribute("aria-pressed", String(wanted === config.underline));
    }
  }
  function updateListen() {
    if (listenButton === null) return;
    listenButton.hidden = shown === null || !canSpeak();
    listenButton.setAttribute("aria-pressed", String(readingState() !== "off"));
  }
  function showSpeechBar(state2) {
    if (state2 !== "off") setMarker(false);
    if (speechBar !== null) {
      speechBar.hidden = state2 === "off";
      speechBar.dataset["state"] = state2;
    }
    if (speechPlayLabel !== null) {
      speechPlayLabel.textContent = state2 === "paused" ? t("reader_speech_play") : t("reader_speech_pause");
    }
    updateListen();
  }
  async function stepRate(by) {
    const current2 = (await readConfig()).ttsRate;
    adoptConfig(await writeConfig({ ttsRate: clamp(current2 + by, TTS_RATE) }));
  }
  async function onDisplayPress(event) {
    const target = event.target;
    const button = target instanceof Element ? target.closest("button") : null;
    if (!(button instanceof HTMLButtonElement)) return;
    const rate = button.getAttribute("data-rate");
    if (rate !== null) {
      await stepRate(Number(rate));
      return;
    }
    const underline2 = button.getAttribute("data-underline");
    if (isUnderlineWeight(underline2)) {
      adoptConfig(await writeConfig({ underline: underline2 }));
      return;
    }
    const theme = button.getAttribute("data-theme");
    const font = button.getAttribute("data-font");
    const links = button.getAttribute("data-links");
    const markerColor = button.getAttribute("data-marker-color");
    const size = button.getAttribute("data-size");
    const measure = button.getAttribute("data-measure");
    let patch = {};
    if (isTheme(theme)) patch = { theme };
    else if (isFont(font)) patch = { font };
    else if (isLinks(links)) patch = { links };
    else if (isMarkColor(markerColor)) patch = { markerColor };
    else if (size !== null || measure !== null) {
      const current2 = (await readConfig()).reader;
      if (size !== null) {
        patch = { fontSize: clamp(current2.fontSize + Number(size), SIZE) };
      } else {
        patch = { measure: clamp(current2.measure + Number(measure), MEASURE) };
      }
    } else return;
    adoptConfig(await writeConfig({ reader: patch }));
  }
  function clamp(value, range2) {
    return Math.min(range2.max, Math.max(range2.min, value));
  }
  displayPanel?.addEventListener("click", (event) => void onDisplayPress(event));
  function setPanel(button, panel, open3) {
    if (button === null || panel === null) return;
    panel.hidden = !open3;
    button.setAttribute("aria-expanded", String(open3));
  }
  displayButton?.addEventListener("click", () => {
    const opening = displayPanel?.hidden === true;
    if (opening) setMarker(false);
    setPanel(menuButton, menuPanel, false);
    setPanel(displayButton, displayPanel, opening);
  });
  menuButton?.addEventListener("click", () => {
    const opening = menuPanel?.hidden === true;
    if (opening) setMarker(false);
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
  document.addEventListener("pointerdown", (event) => {
    if (!anyPanelOpen()) return;
    if (event.target instanceof Node && chromeBox !== null && chromeBox.contains(event.target)) return;
    closePanels();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !anyPanelOpen()) return;
    const focus = document.activeElement;
    if (focus instanceof Node && displayPanel?.contains(focus) === true) displayButton?.focus();
    else if (focus instanceof Node && menuPanel?.contains(focus) === true) menuButton?.focus();
    closePanels();
  });
  librarySegments?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const choice = target.closest("button[data-segment]")?.getAttribute("data-segment");
    if (choice === Segment.UNREAD || choice === Segment.READ) {
      segment = choice;
      libraryPage = 1;
      void refreshLibrary();
    }
  });
  libraryFilter?.addEventListener("input", () => {
    if (libraryFilter === null) return;
    if (librarySearchShown()) dismissLibrarySearch();
    updateSearchControls();
    libraryQuery = libraryFilter.value;
    libraryPage = 1;
    void refreshLibrary();
  });
  libraryFilter?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || librarySearchToggle?.checked !== true) return;
    event.preventDefault();
    void runLibrarySearch();
  });
  librarySearchToggle?.addEventListener("change", () => {
    updateSearchControls();
    if (librarySearchToggle?.checked !== true && librarySearchShown()) {
      dismissLibrarySearch();
      void refreshLibrary();
    }
  });
  librarySearchGo?.addEventListener("click", () => void runLibrarySearch());
  async function turnLibraryPage(step) {
    libraryPage += step;
    await refreshLibrary();
    libraryRows?.scrollIntoView({ behavior: "instant", block: "start" });
  }
  libraryPrev?.addEventListener("click", () => void turnLibraryPage(-1));
  libraryNext?.addEventListener("click", () => void turnLibraryPage(1));
  marksFilter?.addEventListener("input", () => {
    if (marksFilter === null) return;
    marksQuery = marksFilter.value;
    marksPage = 1;
    void refreshMarks();
  });
  async function turnMarksPage(step) {
    marksPage += step;
    await refreshMarks();
    marksRowsList?.scrollIntoView({ behavior: "instant", block: "start" });
  }
  marksPrev?.addEventListener("click", () => void turnMarksPage(-1));
  marksNext?.addEventListener("click", () => void turnMarksPage(1));
  marksRowsList?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest("button[data-row]");
    if (!(button instanceof HTMLButtonElement)) return;
    const row = marksOnScreen[Number(button.getAttribute("data-row"))];
    if (row === void 0) return;
    const act = button.getAttribute("data-act");
    if (act === "copy") void copyMarkRow(button, row);
    else if (act === "speak") speakMarkRow(row);
    else if (act === "open") void openMarkRow(row);
    else if (act === "note") noteMarkRow(row);
  });
  marksExportButton?.addEventListener("click", () => void exportMarksPage());
  libraryRows?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest("button[data-url]");
    if (!(button instanceof HTMLButtonElement)) return;
    const url = button.getAttribute("data-url") ?? "";
    if (url.length === 0) return;
    const kind = button.getAttribute("data-kind") ?? "article";
    if (button.classList.contains("library-delete")) {
      if (button.hasAttribute("data-armed")) void removeRow(button, url, kind);
      else armDelete(button);
      return;
    }
    history.pushState(docState(kind === "book" ? "book" : "article", url), "");
    if (kind === "book") void openBook(url);
    else void openSaved(url);
  });
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
  exportButton?.addEventListener("click", () => void exportList());
  exportMarksButton?.addEventListener("click", () => void exportMarks());
  importButton?.addEventListener("click", () => importInput?.click());
  async function dispatchImport(file) {
    const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    if (importKind({ name: file.name, type: file.type, head }) === "book") {
      closeImportOffer();
      transferStatus("");
      await runBookImport(file);
    } else {
      bookImportStatus("");
      await offerImport(file);
    }
  }
  importInput?.addEventListener("change", () => {
    if (importInput === null) return;
    const file = importInput.files?.[0];
    importInput.value = "";
    if (file !== void 0) void dispatchImport(file);
  });
  importRun?.addEventListener("click", () => void runImport());
  importCancel?.addEventListener("click", () => {
    closeImportOffer();
    transferStatus("");
  });
  function bookImportStatus(text, tone) {
    if (bookImportLine === null) return;
    bookImportLine.textContent = text;
    if (tone === void 0) delete bookImportLine.dataset["tone"];
    else bookImportLine.dataset["tone"] = tone;
  }
  var importingBook = false;
  async function runBookImport(file) {
    if (importingBook) return;
    importingBook = true;
    if (importButton instanceof HTMLButtonElement) importButton.disabled = true;
    bookImportStatus(t("reader_book_importing", "1"));
    try {
      const outcome = await importEpub(
        file,
        (written) => bookImportStatus(t("reader_book_importing", written.toLocaleString()))
      );
      if (outcome.ok) {
        bookImportStatus(t("reader_book_added", outcome.book.title));
        await refreshLibrary();
      } else {
        bookImportStatus(
          outcome.reason === "drm" ? t("reader_book_drm") : t("reader_book_unreadable"),
          "error"
        );
      }
    } finally {
      importingBook = false;
      if (importButton instanceof HTMLButtonElement) importButton.disabled = false;
    }
  }
  for (const button of segmentPrevs) button?.addEventListener("click", () => turnSegment(-1));
  for (const button of segmentNexts) button?.addEventListener("click", () => turnSegment(1));
  for (const button of tocButtons) button?.addEventListener("click", () => openTocDialog());
  tocCloseButton?.addEventListener("click", () => closeTocDialog());
  tocDialog?.addEventListener("click", (event) => {
    if (event.target === tocDialog) closeTocDialog();
  });
  tocRows?.addEventListener("click", (event) => {
    const row = event.target instanceof Element ? event.target.closest("button") : null;
    if (!(row instanceof HTMLButtonElement) || row.dataset["index"] === void 0) return;
    const entry = docToc[Number(row.dataset["index"])];
    if (entry === void 0) return;
    closeTocDialog();
    jumpToTocEntry(entry);
  });
  bookNoteSettings?.addEventListener("click", () => goToSettings());
  void sweepOrphanSegments().catch(() => void 0);
  function setBackDoor(sentence, room) {
    if (toLibraryButton !== null) {
      toLibraryButton.title = sentence;
      toLibraryButton.setAttribute("aria-label", sentence);
    }
    const word = toLibraryEndButton?.querySelector("span");
    if (word !== void 0 && word !== null) word.textContent = room;
  }
  function onBackPress() {
    hideNotice();
    if (asDocState(history.state) !== null || asMarksState(history.state) !== null) history.back();
    else void showLibrary();
  }
  function leaveToList() {
    hideNotice();
    if (asDocState(history.state) !== null || asMarksState(history.state) !== null) {
      unwindToList = true;
      history.back();
    } else void showLibrary();
  }
  for (const button of [toLibraryButton, toLibraryEndButton]) {
    button?.addEventListener("click", () => onBackPress());
  }
  window.addEventListener("popstate", (event) => {
    const doc = asDocState(event.state);
    const quotes = asMarksState(event.state);
    if (unwindToList) {
      if (doc !== null || quotes !== null) {
        history.back();
        return;
      }
      unwindToList = false;
      hideNotice();
      void showLibrary();
      return;
    }
    if (quotes !== null) {
      hideNotice();
      void showMarks(quotes.scope);
      return;
    }
    if (doc === null) {
      if (shown !== null || marksShown !== null) {
        hideNotice();
        void showLibrary();
      }
      return;
    }
    if (shown !== null && shown.url === doc.url) return;
    hideNotice();
    if (doc.kind === "book") void openBook(doc.url);
    else void openSaved(doc.url);
  });
  function walkTo(page) {
    try {
      sessionStorage.setItem(BACK_ROAD_KEY, "reader");
    } catch {
    }
    location.assign(webext().runtime.getURL(page));
  }
  function goToSettings() {
    walkTo("options/options.html");
  }
  window.addEventListener("pageshow", () => {
    void webext().tabs.getCurrent().then((tab) => typeof tab?.id === "number" ? writeReaderTab(tab.id) : void 0).catch(() => void 0);
  });
  window.addEventListener("pagehide", () => {
    void writeReaderTab(null).catch(() => void 0);
  });
  brandButton?.addEventListener("click", () => goToSettings());
  navToc?.addEventListener("click", () => {
    setPanel(menuButton, menuPanel, false);
    openTocDialog();
  });
  navSearch?.addEventListener("click", () => {
    setPanel(menuButton, menuPanel, false);
    openDocSearch();
  });
  navLibrary?.addEventListener("click", () => {
    setPanel(menuButton, menuPanel, false);
    leaveToList();
  });
  navMarks?.addEventListener("click", () => {
    setPanel(menuButton, menuPanel, false);
    hideNotice();
    const scope2 = shown === null ? null : shown.url;
    history.pushState(marksState(scope2), "");
    void showMarks(scope2, { fresh: true });
  });
  navVocabulary?.addEventListener("click", () => {
    setPanel(menuButton, menuPanel, false);
    walkTo("vocab/vocab.html");
  });
  navSettings?.addEventListener("click", () => {
    setPanel(menuButton, menuPanel, false);
    goToSettings();
  });
  keepButton?.addEventListener("click", () => void onKeepPress());
  removeButton?.addEventListener("click", () => void onRemovePress());
  markReadButton?.addEventListener("click", () => void onMarkReadPress());
  markReadEndButton?.addEventListener("click", () => void onMarkReadPress());
  configureDocSearch({
    doc: () => shown,
    root: contentRoot,
    toc: () => docToc,
    onJump: (hit, folded) => {
      if (shown === null) return;
      const target = {
        segmentIndex: hit.segmentIndex,
        block: hit.block,
        from: hit.from,
        to: hit.to,
        folded
      };
      if (shown.origin === "book" && hit.segmentIndex !== shown.segmentIndex) {
        void openBook(shown.url, hit.segmentIndex, target);
        return;
      }
      if (scrollToSearchHit(target)) savePositionNow();
    }
  });
  configureLibrarySearch({
    onOpen: (kind, url, target) => {
      hideNotice();
      history.pushState(docState(kind, url), "");
      if (kind === "book") void openBook(url, target?.segmentIndex, target);
      else void openSaved(url, target);
    },
    onOpenSearch: (kind, url, query) => {
      hideNotice();
      history.pushState(docState(kind, url), "");
      const opened = kind === "book" ? openBook(url) : openSaved(url);
      void opened.then(() => openDocSearch(query));
    }
  });
  configureReading({
    article: () => article,
    // How far down the window the stuck chrome reaches (D93): a sentence under
    // it is covered paper, not visible text, and the voice must neither start
    // on one nor park the spoken line beneath the bar. The same line the
    // position save reads under, measured by the same function.
    fold: chromeFold,
    onChange: showSpeechBar,
    // The engine refusing is the one thing reading aloud can do that leaves
    // nothing on screen to explain itself, so it is said in the page's own
    // notice line rather than in a bar that has just disappeared.
    onFail: () => showNotice(t("reader_speech_failed"))
  });
  function onSpeechPress(id, act) {
    document.getElementById(id)?.addEventListener("click", (event) => {
      if (event.detail > 0 && event.currentTarget instanceof HTMLElement) {
        event.currentTarget.blur();
      }
      act();
    });
  }
  onSpeechPress("listen", () => toggleReading());
  onSpeechPress("speech-play", () => toggleReading());
  onSpeechPress("speech-stop", () => stopReading());
  onSpeechPress("speech-back", () => skipSentence(-1));
  onSpeechPress("speech-forward", () => skipSentence(1));
  voiceChoice?.addEventListener("change", () => {
    if (voiceChoice === null) return;
    const key = primaryLanguage(speechLang());
    const map = { ...settings.ttsVoices };
    if (voiceChoice.value === "") delete map[key];
    else map[key] = voiceChoice.value;
    void writeConfig({ ttsVoices: map }).then(adoptConfig);
  });
  function onSpeechKey(event) {
    if (readingState() === "off") return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    const action = speechAction({
      key: event.key,
      alt: event.altKey,
      ctrl: event.ctrlKey,
      meta: event.metaKey,
      tag: target?.tagName ?? "",
      editable: target?.isContentEditable ?? false
    });
    if (action === null) return;
    if (action === "toggle") toggleReading();
    else if (action === "back") skipSentence(-1);
    else if (action === "forward") skipSentence(1);
    else void stepRate(action === "slower" ? -TTS_RATE.step : TTS_RATE.step);
    event.preventDefault();
  }
  document.addEventListener("keydown", onSpeechKey);
  window.addEventListener("pagehide", () => {
    stopReading();
    stopMarkSpeech();
  });
  if (canSpeak()) {
    if (voiceSetting !== null) voiceSetting.hidden = false;
    if (rateSetting !== null) rateSetting.hidden = false;
    speechSynthesis.addEventListener("voiceschanged", renderVoiceChoice);
  }
  webext().storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || changes[CONFIG_KEY] === void 0) return;
    void readConfig().then(adoptConfig);
  });
  void readConfig().then(adoptConfig);
  webext().storage.onChanged.addListener((changes, area) => {
    if (area !== "session") return;
    if (changes[READER_SOURCE_KEY] === void 0) return;
    void showPage();
  });
  webext().runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (asPageRequest(message)?.kind !== Message.PAGE_INFO) return false;
    sendResponse(ok({ reader: true }));
    return false;
  });
  function onArticleLink(event) {
    if (settings.reader.links !== "plain") return;
    const pressed = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (pressed !== null) event.preventDefault();
  }
  contentElement?.addEventListener("click", onArticleLink);
  contentElement?.addEventListener("auxclick", onArticleLink);
  var readingGround = null;
  function rootReadingSide(ground) {
    if (ground === null || ground === readingGround) return;
    readingGround = ground;
    stop2();
    start({
      root: ground,
      observe: false,
      ownSelection: true,
      anchored: true,
      // How far down the window our own chrome is stuck over the text (D138):
      // the bubble's placement and its scroll assist stop where the bar
      // begins, and the assist's kept line parks under the bar, not beneath
      // it. The same measure the reading position, the voice and the page
      // keys already live by (D93, D127); over the highlights page the chrome
      // scrolls away like any heading, and the measure honestly says so.
      covered: chromeFold,
      // The bubble's own door to the settings - an error's one button - walks
      // the same road as the bar's mark (D139): this tab, so the way back
      // exists. Everywhere else the bubble keeps asking the background.
      openSettings: () => goToSettings(),
      plainLinks: () => settings.reader.links === "plain",
      // The highlighter's hooks (D106): whether the pen is in the hand, where
      // marks may anchor (the rebuilt content - the reader's own title has no
      // block order to write against), what a finished stroke becomes, and what
      // a tap means while the pen is up. The delete bubble is ours the way the
      // translation bubble is - presses on it must not read as the page's.
      alsoOwns: (target) => target instanceof Node && markBar?.contains(target) === true,
      marking: () => markerOn,
      markRoot: () => contentRoot(),
      onMarked: (range2) => void onMarked(range2),
      // A stroke taking its first word: whatever mark was active is about to be
      // stale - its pins would stand over yesterday's outline while the new one
      // is drawn (Michał's report).
      onMarkStart: () => deselectMark(),
      onMarkTap,
      // The no-translation trim's two hands (D121): the dictionaries and the
      // voice of the document on screen, both by the rule the voice panel
      // already lives by (`speechLang`) - the document's own declaration first,
      // the pair's source as the stand-in. Only over a document: the quote rows
      // of the highlights page show many documents at once, and a lookup in a
      // guessed language would find real entries for words nobody asked about.
      quietLookup: (text) => shown === null ? Promise.resolve([]) : lookUp(text, primaryLanguage(speechLang())),
      quietVoice: () => shown === null ? null : { lang: speechLang(), voiceURI: settings.ttsVoices[primaryLanguage(speechLang())] }
    });
  }
  void showPage(true);
})();
//# sourceMappingURL=reader.js.map
