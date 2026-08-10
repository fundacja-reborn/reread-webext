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
 *
 * The bubble knows nothing about the database. It shows what it is given,
 * offers the buttons it is told to offer, and reports which one was pressed -
 * so what "save" means stays in one place, and that place is not here.
 */

const GAP = 8;
const VIEWPORT_MARGIN = 8;

/**
 * One line per meaning. A word has more than one, and separating them by
 * anything narrower than a line makes them read as one long sentence.
 */
const MEANING_SEPARATOR = "\n";

const LABELS = Object.freeze({
  save: "Save",
  learned: "Learned",
  edit: "Edit",
  settings: "Open settings",
  cancel: "Cancel",
});

const STYLE = `
  :host { all: initial; }
  * { box-sizing: border-box; }

  /* The hidden attribute is a rule in the browser's own stylesheet, and any
     rule of ours beats it: one display on .editor was enough to leave an empty
     text box sitting under every translation. */
  [hidden] { display: none !important; }

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

  .editor {
    display: block;
    width: 100%;
    min-width: 16rem;
    margin: 0;
    padding: 4px 6px;
    font: inherit;
    color: inherit;
    background: rgba(0, 0, 0, 0.04);
    border: 1px solid rgba(0, 0, 0, 0.2);
    border-radius: 6px;
    resize: none;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }
  .actions:empty { display: none; }

  button {
    font: inherit;
    font-size: 13px;
    padding: 3px 10px;
    color: inherit;
    background: rgba(0, 0, 0, 0.05);
    border: 1px solid rgba(0, 0, 0, 0.18);
    border-radius: 6px;
    cursor: pointer;
  }
  button:hover:not(:disabled) { background: rgba(0, 0, 0, 0.1); }
  button:disabled { opacity: 0.45; cursor: default; }

  @media (prefers-color-scheme: dark) {
    .bubble {
      background: #1f2430;
      color: #f2f4f8;
      border-color: rgba(255, 255, 255, 0.14);
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
    }
    .body[data-tone="error"] { color: #f0a83c; }
    .editor {
      background: rgba(255, 255, 255, 0.06);
      border-color: rgba(255, 255, 255, 0.24);
    }
    button {
      background: rgba(255, 255, 255, 0.08);
      border-color: rgba(255, 255, 255, 0.2);
    }
    button:hover:not(:disabled) { background: rgba(255, 255, 255, 0.16); }
  }
`;

/** @typedef {"normal" | "pending" | "error"} Tone */
/** What the bubble can offer. @typedef {"save" | "learned" | "edit" | "settings"} Action */
/** What it reports - editing never leaves the bubble. @typedef {"save" | "learned" | "settings"} ReportedAction */

/**
 * @typedef {object} Tooltip
 * @property {(options: { anchor: DOMRect, phrase: string, body: string, tone?: Tone, actions?: Action[] }) => void} show
 * @property {(body: string, tone?: Tone) => void} setBody
 * @property {(actions: Action[]) => void} setActions
 * @property {() => void} hide
 * @property {() => boolean} isOpen
 * @property {() => boolean} isEditing
 * @property {() => void} escape
 * @property {(target: EventTarget | null) => boolean} owns
 */

/**
 * @param {string} text
 * @returns {string[]} one meaning per line, blank ones dropped
 */
function toMeanings(text) {
  return text
    .split(MEANING_SEPARATOR)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * @param {object} options
 * @param {(action: ReportedAction, meanings: string[]) => void} options.onAction what the reader pressed, and what the bubble was showing when they did
 * @returns {Tooltip}
 */
export function createTooltip({ onAction }) {
  /** @type {HTMLDivElement | null} */
  let host = null;
  /** @type {HTMLDivElement | null} */
  let bubble = null;
  /** @type {HTMLDivElement | null} */
  let phraseElement = null;
  /** @type {HTMLDivElement | null} */
  let bodyElement = null;
  /** @type {HTMLTextAreaElement | null} */
  let editor = null;
  /** @type {HTMLDivElement | null} */
  let actionsElement = null;

  /** Where the bubble is anchored, so it can be placed again when it changes size. */
  let anchor = new DOMRect();
  let editing = false;
  /** What the buttons were before the edit box opened, to go back to on cancel. */
  /** @type {Action[]} */
  let restingActions = [];

  /**
   * @returns {string[]}
   */
  function currentMeanings() {
    if (editing && editor !== null) return toMeanings(editor.value);
    return toMeanings(bodyElement?.textContent ?? "");
  }

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
    editor = document.createElement("textarea");
    editor.className = "editor";
    editor.hidden = true;
    editor.rows = 1;
    actionsElement = document.createElement("div");
    actionsElement.className = "actions";

    // Pressing a button must not take the selection away: the page's own
    // selection is what the bubble is about, and it disappearing under the
    // cursor reads as the extension breaking the page.
    actionsElement.addEventListener("mousedown", (event) => event.preventDefault());
    editor.addEventListener("input", refreshDisabled);
    editor.addEventListener("keydown", onEditorKeyDown);
    // Typing in this box must not reach the page. Plenty of sites bind single
    // letters as shortcuts, and a correction typed into the bubble that also
    // scrolls the article is worse than no edit box at all. Our own Escape
    // handler is unaffected: it listens in the capture phase, which runs first.
    for (const type of ["keyup", "keypress"]) {
      editor.addEventListener(type, (event) => event.stopPropagation());
    }

    bubble.append(phraseElement, bodyElement, editor, actionsElement);
    root.append(style, bubble);
    // `documentElement` and not `body`: single-page applications replace the
    // body, and a bubble that vanishes with a re-render is a bug nobody can
    // reproduce.
    document.documentElement.append(host);
  }

  /**
   * @param {KeyboardEvent} event
   */
  function onEditorKeyDown(event) {
    event.stopPropagation();
    // Enter saves, shift+Enter is the way to add a second meaning. A textarea
    // whose Enter key does nothing but grow it would need the mouse for every
    // correction.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      emit("save");
    }
  }

  function refreshDisabled() {
    if (actionsElement === null) return;
    const empty = currentMeanings().length === 0;
    for (const button of actionsElement.querySelectorAll("button")) {
      if (button.dataset["action"] === "save") button.disabled = empty;
    }
  }

  /**
   * @param {Action | "cancel"} action
   */
  function emit(action) {
    // Editing is the bubble's own business: nobody outside needs to know that a
    // text box opened, only what it said when the reader was done with it.
    if (action === "cancel") {
      stopEditing(false);
      return;
    }
    if (action === "edit") {
      startEditing();
      return;
    }

    const meanings = currentMeanings();
    if (action === "save") {
      if (meanings.length === 0) return;
      // Optimistic: what was typed is what the bubble shows from now on. The
      // caller decides what it means, and says so by setting the buttons.
      stopEditing(true);
    }
    onAction(action, meanings);
  }

  function startEditing() {
    if (editor === null || bodyElement === null) return;
    editing = true;
    editor.value = toMeanings(bodyElement.textContent ?? "").join(MEANING_SEPARATOR);
    editor.rows = Math.min(6, Math.max(1, editor.value.split(MEANING_SEPARATOR).length));
    editor.hidden = false;
    bodyElement.hidden = true;
    renderActions(["save", "cancel"]);
    place();
    editor.focus();
    editor.select();
  }

  /**
   * @param {boolean} keep whether what was typed becomes what is shown
   */
  function stopEditing(keep) {
    if (!editing || editor === null || bodyElement === null) return;
    if (keep) setBody(toMeanings(editor.value).join(MEANING_SEPARATOR));
    editing = false;
    editor.hidden = true;
    bodyElement.hidden = false;
    renderActions(restingActions);
    place();
  }

  /**
   * @param {(Action | "cancel")[]} actions
   */
  function renderActions(actions) {
    if (actionsElement === null) return;
    actionsElement.replaceChildren();
    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset["action"] = action;
      button.textContent = LABELS[action];
      button.addEventListener("click", () => emit(action));
      actionsElement.append(button);
    }
    refreshDisabled();
  }

  function place() {
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
    refreshDisabled();
  }

  function hideBubble() {
    if (host === null) return;
    host.remove();
    host = null;
    bubble = null;
    phraseElement = null;
    bodyElement = null;
    editor = null;
    actionsElement = null;
    editing = false;
    restingActions = [];
  }

  return {
    show({ anchor: rect, phrase, body, tone = "normal", actions = [] }) {
      build();
      if (phraseElement === null) return;
      anchor = rect;
      editing = false;
      if (editor !== null) editor.hidden = true;
      if (bodyElement !== null) bodyElement.hidden = false;
      phraseElement.textContent = phrase;
      setBody(body, tone);
      restingActions = actions;
      renderActions(actions);
      place();
    },

    setBody(body, tone = "normal") {
      setBody(body, tone);
      place();
    },

    setActions(actions) {
      restingActions = actions;
      if (!editing) renderActions(actions);
      place();
    },

    hide: hideBubble,

    isOpen() {
      return host !== null;
    },

    isEditing() {
      return editing;
    },

    escape() {
      // One key, two meanings: leave the edit box first, close the bubble only
      // when there is nothing left to leave.
      if (editing) stopEditing(false);
      else hideBubble();
    },

    owns(target) {
      // The shadow root is closed, so every event coming out of the bubble is
      // retargeted to the host: comparing against it is enough.
      return host !== null && target === host;
    },
  };
}
