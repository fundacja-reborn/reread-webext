/**
 * The bubble shown next to a selection.
 *
 * It lives in a closed shadow root under one element appended to the page, and
 * that is the whole isolation strategy: the page cannot style it, cannot reach
 * into it, and gets nothing back except one extra child of `<html>`. The host
 * carries no identifying attribute either - an extension is detectable by a
 * determined page anyway, but there is no reason to hand out a selector.
 *
 * Text always goes in through `textContent`. The strings here come from the
 * page being read, and the one thing a bubble must never do is parse them.
 */

const GAP = 8;
const VIEWPORT_MARGIN = 8;

const STYLE = `
  :host { all: initial; }
  * { box-sizing: border-box; }

  .bubble {
    color-scheme: light dark;
    font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
    max-width: min(22rem, 90vw);
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid rgba(0, 0, 0, 0.12);
    background: #ffffff;
    color: #1f2430;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
    overflow-wrap: break-word;
  }

  .phrase {
    font-weight: 600;
    margin-bottom: 4px;
  }

  .body { white-space: pre-wrap; }
  .body[data-tone="pending"] { opacity: 0.6; font-style: italic; }
  .body[data-tone="error"] { color: #a3341f; }

  @media (prefers-color-scheme: dark) {
    .bubble {
      background: #1f2430;
      color: #f2f4f8;
      border-color: rgba(255, 255, 255, 0.14);
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
    }
    .body[data-tone="error"] { color: #f0a83c; }
  }
`;

/** @typedef {"normal" | "pending" | "error"} Tone */

/**
 * @typedef {object} Tooltip
 * @property {(options: { anchor: DOMRect, phrase: string, body: string, tone?: Tone }) => void} show
 * @property {(body: string, tone?: Tone) => void} setBody
 * @property {() => void} hide
 * @property {() => boolean} isOpen
 * @property {(target: EventTarget | null) => boolean} owns
 */

/**
 * @returns {Tooltip}
 */
export function createTooltip() {
  /** @type {HTMLDivElement | null} */
  let host = null;
  /** @type {HTMLDivElement | null} */
  let bubble = null;
  /** @type {HTMLDivElement | null} */
  let phraseElement = null;
  /** @type {HTMLDivElement | null} */
  let bodyElement = null;

  function build() {
    if (host !== null) return;

    host = document.createElement("div");
    // Inline and important, because `:host { all: initial }` inside the shadow
    // root cannot win against a page rule that targets our element from outside.
    host.style.setProperty("all", "initial", "important");
    host.style.setProperty("position", "fixed", "important");
    host.style.setProperty("z-index", "2147483647", "important");
    host.style.setProperty("top", "0px", "important");
    host.style.setProperty("left", "0px", "important");

    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = STYLE;

    bubble = document.createElement("div");
    bubble.className = "bubble";
    phraseElement = document.createElement("div");
    phraseElement.className = "phrase";
    bodyElement = document.createElement("div");
    bodyElement.className = "body";

    bubble.append(phraseElement, bodyElement);
    root.append(style, bubble);
    // `documentElement` and not `body`: single-page applications replace the
    // body, and a bubble that vanishes with a re-render is a bug nobody can
    // reproduce.
    document.documentElement.append(host);
  }

  /**
   * @param {DOMRect} anchor
   */
  function place(anchor) {
    if (host === null || bubble === null) return;

    host.style.setProperty("visibility", "hidden", "important");
    host.style.setProperty("left", "0px", "important");
    host.style.setProperty("top", "0px", "important");

    const size = bubble.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;

    const belowFits = anchor.bottom + GAP + size.height <= viewportHeight - VIEWPORT_MARGIN;
    const top = belowFits ? anchor.bottom + GAP : Math.max(VIEWPORT_MARGIN, anchor.top - GAP - size.height);

    const preferred = anchor.left;
    const maxLeft = Math.max(VIEWPORT_MARGIN, viewportWidth - size.width - VIEWPORT_MARGIN);
    const left = Math.min(Math.max(VIEWPORT_MARGIN, preferred), maxLeft);

    host.style.setProperty("left", `${Math.round(left)}px`, "important");
    host.style.setProperty("top", `${Math.round(top)}px`, "important");
    host.style.setProperty("visibility", "visible", "important");
  }

  /**
   * @param {string} body
   * @param {Tone} [tone]
   */
  function setBody(body, tone = "normal") {
    if (bodyElement === null) return;
    bodyElement.textContent = body;
    bodyElement.dataset["tone"] = tone;
  }

  return {
    show({ anchor, phrase, body, tone = "normal" }) {
      build();
      if (phraseElement === null) return;
      phraseElement.textContent = phrase;
      setBody(body, tone);
      place(anchor);
    },

    setBody,

    hide() {
      if (host === null) return;
      host.remove();
      host = null;
      bubble = null;
      phraseElement = null;
      bodyElement = null;
    },

    isOpen() {
      return host !== null;
    },

    owns(target) {
      // The shadow root is closed, so every event coming out of the bubble is
      // retargeted to the host: comparing against it is enough.
      return host !== null && target === host;
    },
  };
}
