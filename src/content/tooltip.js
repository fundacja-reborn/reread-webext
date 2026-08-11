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
 *
 * It does not repeat the phrase it is about. The phrase is on the page, a few
 * pixels away, selected or underlined; printing it again cost a line of the
 * article and gave nothing back. What is left is the gloss and the buttons.
 *
 * The sentence and the dictionary entries, when there are any, are a second
 * layer behind "More" - one line first, everything else on a deliberate second
 * press (G1). They live in their own elements and not in the body, because the
 * body is what gets saved: anything that leaked into it would end up in the
 * vocabulary and on a flashcard.
 *
 * A dictionary line is the one thing down there that is also a button. Pressing
 * it adds that meaning to the body, which is to say to the vocabulary, and
 * pressing it again takes it back out - the bubble still does not know what
 * saving means, it just reports the meanings it is showing the moment they
 * change.
 */

import { MEANING_SEPARATOR, afterChoosing, toMeanings } from "../lib/gloss.js";

const GAP = 8;
const VIEWPORT_MARGIN = 8;

const LABELS = Object.freeze({
  save: "Save",
  learned: "Learned",
  edit: "Edit",
  settings: "Open settings",
  cancel: "Cancel",
  more: "More",
});

/** The one button whose label changes with what it will do. */
const LESS_LABEL = "Less";

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

  .body { white-space: pre-wrap; }
  .body[data-tone="pending"] { opacity: 0.6; font-style: italic; }
  .body[data-tone="error"] { color: #a3341f; }

  /* Quieter than the gloss and separated from it: this is the sentence the
     phrase was in, not another meaning of it. */
  .context {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid rgba(0, 0, 0, 0.12);
    font-size: 13px;
    opacity: 0.85;
  }

  /* A dictionary entry can be long, and a bubble that grows past the window is
     a bubble that covers the sentence somebody was reading. It scrolls instead;
     the page underneath keeps the bubble open while it does. */
  .entries {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid rgba(0, 0, 0, 0.12);
    font-size: 13px;
    max-height: 40vh;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
  }

  /* macOS hides scrollbars until something scrolls, so an entry that runs past
     the bottom looks exactly like an entry that was cut off - which is how it
     was first reported. The shadow is the only thing saying there is more. */
  .entries[data-more="true"] {
    box-shadow: inset 0 -14px 12px -12px rgba(0, 0, 0, 0.28);
  }

  .entry + .entry { margin-top: 8px; }

  /* Which book this came from, and the word it actually found - the second one
     matters when the reader selected "watches" and the dictionary knows "watch". */
  .entry-label {
    font-size: 11px;
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
    padding: 2px 4px;
    font: inherit;
    text-align: left;
    color: inherit;
    background: none;
    border: 1px solid transparent;
    border-radius: 5px;
    white-space: pre-wrap;
    cursor: pointer;
  }
  .entry-sense[aria-pressed="false"]:hover:not(:disabled) { background: rgba(0, 0, 0, 0.06); }
  .entry-sense[aria-pressed="true"] {
    background: rgba(0, 0, 0, 0.07);
    border-color: rgba(0, 0, 0, 0.22);
  }
  /* Not faded while the edit box is open, unlike every other disabled button
     here: the entry is still there to be read, it just cannot be chosen for as
     long as the gloss is being typed by hand. */
  .entry-sense:disabled { opacity: 1; cursor: default; }

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
    .context, .entries { border-top-color: rgba(255, 255, 255, 0.14); }
    /* A shadow that reads as depth on white reads as nothing on dark. */
    .entries[data-more="true"] { box-shadow: inset 0 -14px 12px -12px rgba(0, 0, 0, 0.6); }
    .entry-sense[aria-pressed="false"]:hover:not(:disabled) { background: rgba(255, 255, 255, 0.08); }
    .entry-sense[aria-pressed="true"] {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.3);
    }
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
/** What the bubble can offer. @typedef {"save" | "learned" | "edit" | "settings" | "more"} Action */
/** What it reports - editing and unfolding never leave the bubble. @typedef {"save" | "learned" | "settings"} ReportedAction */

/**
 * One block of the second layer below the sentence: where it came from, and the
 * lines it has to show. The bubble is handed labels rather than dictionary
 * records on purpose - deciding whether a book's name or a headword is worth
 * repeating needs to know what the reader selected, and the bubble does not.
 *
 * One line is one meaning and therefore one button. The caller guarantees that,
 * because the caller is where a dictionary's idea of a line stops mattering:
 * whatever a book packed into one field, what a reader presses here has to be
 * something that can stand alone as the answer to a word.
 *
 * @typedef {{ label: string, lines: string[] }} Block
 */

/**
 * @typedef {object} Tooltip
 * @property {(options: { anchor: DOMRect, body: string, tone?: Tone, actions?: Action[] }) => void} show
 * @property {(body: string, tone?: Tone) => void} setBody
 * @property {(sentence: string | null) => void} setContext
 * @property {(blocks: Block[]) => void} setEntries
 * @property {(actions: Action[]) => void} setActions
 * @property {() => void} hide
 * @property {() => boolean} isOpen
 * @property {() => boolean} isEditing
 * @property {() => void} escape
 * @property {(target: EventTarget | null) => boolean} owns
 */

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
  let bodyElement = null;
  /** @type {HTMLDivElement | null} */
  let contextElement = null;
  /** @type {HTMLDivElement | null} */
  let entriesElement = null;
  /** @type {HTMLTextAreaElement | null} */
  let editor = null;
  /** @type {HTMLDivElement | null} */
  let actionsElement = null;

  /** Where the bubble is anchored, so it can be placed again when it changes size. */
  let anchor = new DOMRect();
  let editing = false;
  /** Whether the second layer is unfolded. Folded again for every new phrase. */
  let unfolded = false;
  /** What the buttons were before the edit box opened, to go back to on cancel. */
  /** @type {Action[]} */
  let restingActions = [];

  /**
   * What the bubble is showing as the gloss - which is the edit box while there
   * is one, because that is what a save would take.
   *
   * @returns {string}
   */
  function shownGloss() {
    if (editing && editor !== null) return editor.value;
    return bodyElement?.textContent ?? "";
  }

  /**
   * @returns {string[]}
   */
  function currentMeanings() {
    return toMeanings(shownGloss());
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
    bodyElement = document.createElement("div");
    bodyElement.className = "body";
    contextElement = document.createElement("div");
    contextElement.className = "context";
    contextElement.hidden = true;
    entriesElement = document.createElement("div");
    entriesElement.className = "entries";
    entriesElement.hidden = true;
    editor = document.createElement("textarea");
    editor.className = "editor";
    editor.hidden = true;
    editor.rows = 1;
    actionsElement = document.createElement("div");
    actionsElement.className = "actions";

    // Pressing a button must not take the selection away: the page's own
    // selection is what the bubble is about, and it disappearing under the
    // cursor reads as the extension breaking the page. The dictionary entries
    // are in this for the same reason now that a line of one can be pressed -
    // the bubble deliberately does not repeat the phrase it is about (D23), so
    // the selection is the only thing on the screen still saying which word all
    // of this is an answer to. The price is that text in there cannot be
    // selected with the mouse, which nothing in the bubble is for.
    for (const element of [actionsElement, entriesElement]) {
      element.addEventListener("mousedown", (event) => event.preventDefault());
    }
    editor.addEventListener("input", refreshControls);
    editor.addEventListener("keydown", onEditorKeyDown);
    // Typing in this box must not reach the page. Plenty of sites bind single
    // letters as shortcuts, and a correction typed into the bubble that also
    // scrolls the article is worse than no edit box at all. Our own Escape
    // handler is unaffected: it listens in the capture phase, which runs first.
    for (const type of ["keyup", "keypress"]) {
      editor.addEventListener(type, (event) => event.stopPropagation());
    }

    bubble.append(bodyElement, contextElement, entriesElement, editor, actionsElement);
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

  /**
   * Every control the bubble has, made to agree with what it is showing: there
   * is nothing to save when there is no meaning left, the chosen dictionary line
   * is the one the gloss came from, and none of them can be chosen while the
   * gloss is being typed by hand - a press that overwrote the edit box would
   * throw away what somebody was in the middle of writing.
   */
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
        // A line is marked when it is one of the meanings on show - which is
        // also true of a line the reader typed by hand into the edit box, and
        // that is honest: what the mark says is "this is in", not "you pressed
        // this".
        sense.setAttribute("aria-pressed", shown.has(sense.textContent ?? "") ? "true" : "false");
      }
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
    if (action === "more") {
      unfold(!unfolded);
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

  /**
   * A line of a dictionary entry, pressed.
   *
   * It goes out as a save and not as some announcement of its own, because it
   * means exactly what the Save button means: this is what the phrase means from
   * now on - one meaning longer, or one shorter. The caller does not have to
   * know which of the two the reader used, and the day it does, that is a second
   * callback and not a second rule.
   *
   * @param {string} sense
   */
  function choose(sense) {
    if (bodyElement === null) return;
    const next = afterChoosing(bodyElement.textContent ?? "", sense);
    // Taking out the last meaning there was. A phrase means something or it is
    // not kept at all, so this press does nothing rather than emptying it.
    if (next.length === 0) return;

    setBody(next);
    place();
    emit("save");
  }

  /**
   * @returns {boolean} whether the second layer has anything in it
   */
  function hasSecondLayer() {
    if ((contextElement?.textContent ?? "").length > 0) return true;
    return (entriesElement?.childElementCount ?? 0) > 0;
  }

  /**
   * @param {boolean} open
   */
  function unfold(open) {
    if (contextElement === null || entriesElement === null) return;
    unfolded = open && hasSecondLayer();
    contextElement.hidden = !unfolded || (contextElement.textContent ?? "").length === 0;
    entriesElement.hidden = !unfolded || entriesElement.childElementCount === 0;
    renderActions(editing ? ["save", "cancel"] : restingActions);
    place();
    // Asked after `place`, because a hidden element has no size to compare and
    // the bubble is only its final height once it has been positioned.
    entriesElement.dataset["more"] =
      !entriesElement.hidden && entriesElement.scrollHeight > entriesElement.clientHeight + 1 ? "true" : "false";
  }

  /**
   * @param {string | null} sentence
   */
  function setContext(sentence) {
    if (contextElement === null) return;
    contextElement.textContent = sentence ?? "";
    // A phrase whose sentence is gone cannot stay unfolded over nothing.
    unfold(unfolded);
  }

  /**
   * @param {Block[]} blocks
   */
  function setEntries(blocks) {
    if (entriesElement === null) return;
    entriesElement.replaceChildren();

    for (const block of blocks) {
      const entry = document.createElement("div");
      entry.className = "entry";

      if (block.label.length > 0) {
        const label = document.createElement("div");
        label.className = "entry-label";
        label.textContent = block.label;
        entry.append(label);
      }

      for (const line of block.lines) {
        const sense = document.createElement("button");
        sense.type = "button";
        sense.className = "entry-sense";
        // A toggle, and told as one: pressing it makes this the meaning, and
        // pressing it again gives back the one it replaced.
        sense.setAttribute("aria-pressed", "false");
        // Every string here came out of a file somebody downloaded, so it goes
        // in as text and never as markup - the same rule that governs text
        // coming off the page.
        sense.textContent = line;
        sense.addEventListener("click", () => choose(line));
        entry.append(sense);
      }

      entriesElement.append(entry);
    }

    unfold(unfolded);
    refreshControls();
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
      button.textContent = action === "more" && unfolded ? LESS_LABEL : LABELS[action];
      button.addEventListener("click", () => emit(action));
      actionsElement.append(button);
    }
    refreshControls();
  }

  function place() {
    if (host === null || bubble === null) return;

    host.style.setProperty("visibility", "hidden", "important");
    host.style.setProperty("left", "0px", "important");
    host.style.setProperty("top", "0px", "important");

    const size = bubble.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;

    // Above the selection by preference, below it only when there is no room.
    // Reading goes downwards, so the text above a phrase has been read and the
    // text below it is what comes next: covering the first costs nothing,
    // covering the second hides the rest of the paragraph.
    const above = anchor.top - GAP - size.height;
    const below = anchor.bottom + GAP;
    const top =
      above >= VIEWPORT_MARGIN
        ? above
        : Math.max(VIEWPORT_MARGIN, Math.min(below, viewportHeight - VIEWPORT_MARGIN - size.height));

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
    refreshControls();
  }

  function hideBubble() {
    if (host === null) return;
    host.remove();
    host = null;
    bubble = null;
    bodyElement = null;
    contextElement = null;
    entriesElement = null;
    editor = null;
    actionsElement = null;
    editing = false;
    unfolded = false;
    restingActions = [];
  }

  return {
    show({ anchor: rect, body, tone = "normal", actions = [] }) {
      build();
      anchor = rect;
      editing = false;
      // Folded again: this is another phrase, and the sentence behind "More"
      // belonged to the last one. Set directly rather than through `unfold`,
      // which would render and place a bubble that has no body yet.
      unfolded = false;
      if (contextElement !== null) {
        contextElement.textContent = "";
        contextElement.hidden = true;
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

    setContext(sentence) {
      setContext(sentence);
      place();
    },

    setEntries(blocks) {
      setEntries(blocks);
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
