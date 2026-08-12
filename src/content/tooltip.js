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
 *
 * It comes in two variants, and they are two answers rather than one layout
 * with buttons hidden inside it (D44). A phrase already kept is a question -
 * what was this again - so `recall` answers it in one line and offers nothing;
 * the row of actions unfolds only when somebody arrives inside the bubble, with
 * a cursor, with a press or with the keyboard. A fresh selection is the other
 * way round: what to do with it is the whole of why the bubble is open, so
 * `save` shows everything from the start.
 */

import { MEANING_SEPARATOR, afterChoosing, toMeanings } from "../lib/gloss.js";
import { t } from "../lib/i18n.js";

const GAP = 8;
const VIEWPORT_MARGIN = 8;

/**
 * Read when a button is rendered, not when the module loads: this module is
 * also imported by tests that have no catalogue to ask, and a bubble never
 * renders there.
 *
 * @param {Action | "cancel"} action
 * @returns {string}
 */
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
  }
}

/** The one button whose label changes with what it will do. */
function lessLabel() {
  return t("bubble_less");
}

const STYLE = `
  :host { all: initial; }
  * { box-sizing: border-box; }

  /* The hidden attribute is a rule in the browser's own stylesheet, and any
     rule of ours beats it: one display on .editor was enough to leave an empty
     text box sitting under every translation. */
  [hidden] { display: none !important; }

  .bubble {
    color-scheme: light dark;
    /* A column, so that one row of it can change sides: the actions unfold
       above the gloss when the bubble stands above the phrase (order below). */
    display: flex;
    flex-direction: column;
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

  /* A flex item does not shrink below its own content unless it is told to, and
     one long word in a gloss would push the bubble past its maximum width. */
  .bubble > * { min-width: 0; }

  .body { white-space: pre-wrap; }
  .body[data-tone="pending"] { opacity: 0.6; font-style: italic; }
  .body[data-tone="error"] { color: #a3341f; }
  /* The launcher has nothing to say above its one button, and an empty line
     would still cost the row of pixels its line-height reserves. */
  .body:empty { display: none; }

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

  /* The row of actions, and the whole of the difference between the two
     variants (D44): there from the start in "save", folded away in "recall"
     until somebody looks for it. The fold is a grid row going from zero to one
     fraction - the one way to animate to a height nobody knows in advance - and
     the clipped child below is what makes it read as unfolding rather than as
     text being squeezed. */
  .reveal {
    display: grid;
    grid-template-rows: 1fr;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    /* The two pixels on the far side are for a focus ring: a folded row is
       clipped, and a ring drawn flush with the edge would be clipped with it. */
    padding: 8px 0 2px;
    min-height: 0;
    overflow: hidden;
  }
  .actions:empty { display: none; }

  /* The launcher is its one button and nothing else, so the row's padding -
     which exists to stand the row off a gloss that is not there - goes too. */
  .bubble[data-variant="launcher"] .actions { padding: 0; }

  .bubble[data-variant="recall"] .reveal {
    grid-template-rows: 0fr;
    opacity: 0;
    transition: grid-template-rows 150ms ease, opacity 150ms ease;
  }
  /* Three ways in, and the class is the one that keeps it: a row that folded
     itself away again on mouseleave would flicker at every brush of the
     bubble's edge, and nothing is gained by taking back an answer somebody has
     just gone looking for. The bubble closes in one piece soon enough.

     No branch for touch screens, and that is deliberate (D44): a finger arrives
     by pressing, and the press adds the same class every other way in ends at.
     A media query on hover bought nothing anyway - a hybrid reports hover:hover
     and would have kept the folding, while its taps emulate :hover and unfold
     it - so one rule for every device is also the only consistent one. */
  .bubble[data-variant="recall"]:hover .reveal,
  .bubble[data-variant="recall"]:focus-within .reveal,
  .bubble[data-variant="recall"].revealed .reveal {
    grid-template-rows: 1fr;
    opacity: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    .bubble[data-variant="recall"] .reveal { transition: none; }
  }

  /* Above the gloss when the bubble stands above the phrase. The edge nearest
     the phrase is pinned (see placement), so a row unfolding underneath the
     gloss would slide the gloss upwards as it appeared - and the line somebody
     is reading is the one thing here that may not move. */
  .bubble[data-variant="recall"][data-grow="up"] .reveal { order: -1; }
  .bubble[data-variant="recall"][data-grow="up"] .actions { padding: 2px 0 8px; }

  /* An action is a label and not a control. What makes one findable is standing
     where the reader is already looking; a box around it would make it the
     loudest thing in a bubble whose whole job is one line of translation. */
  .actions button {
    font: inherit;
    font-size: 12px;
    margin: 0;
    padding: 2px 4px;
    color: inherit;
    background: none;
    border: 0;
    border-radius: 4px;
    opacity: 0.7;
    cursor: pointer;
  }
  /* A label carries padding so that a focus ring has somewhere to go, and the
     first one gives it back: the row has to start on the same vertical line as
     the gloss above it. Save and the launcher bring their own box and need no
     pulling. */
  .actions button:first-child:not([data-action="save"]):not([data-action="reader"]) { margin-left: -4px; }
  .actions button:hover:not(:disabled) { opacity: 1; }
  .actions button:focus-visible {
    opacity: 1;
    outline: 1px solid currentColor;
    outline-offset: 0;
  }
  .actions button:disabled { opacity: 0.35; cursor: default; }

  /* The exception, and the only real call to action either bubble has: Save is
     the press that keeps a phrase which would otherwise be gone, and the
     launcher's one button is the whole of the bubble it is in - the two never
     share a screen, so neither outshouts the other. */
  .actions button[data-action="save"],
  .actions button[data-action="reader"] {
    font-size: 13px;
    padding: 3px 10px;
    opacity: 1;
    background: rgba(0, 0, 0, 0.05);
    border: 1px solid rgba(0, 0, 0, 0.18);
    border-radius: 6px;
  }
  .actions button[data-action="save"]:hover:not(:disabled),
  .actions button[data-action="reader"]:hover:not(:disabled) { background: rgba(0, 0, 0, 0.1); }
  .actions button[data-action="save"]:disabled { opacity: 0.45; }

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
    /* The quiet labels need nothing here: they are the bubble's own colour at
       seven tenths, which lands right on either background. */
    .actions button[data-action="save"],
    .actions button[data-action="reader"] {
      background: rgba(255, 255, 255, 0.08);
      border-color: rgba(255, 255, 255, 0.2);
    }
    .actions button[data-action="save"]:hover:not(:disabled),
    .actions button[data-action="reader"]:hover:not(:disabled) { background: rgba(255, 255, 255, 0.16); }
  }
`;

/** @typedef {"normal" | "pending" | "error"} Tone */
/** Which of the three bubbles this is. `launcher` is reader-only mode's one
 *  offer: no gloss, one button. @typedef {"recall" | "save" | "launcher"} Variant */
/** What the bubble can offer. @typedef {"save" | "learned" | "edit" | "settings" | "more" | "reader"} Action */
/** What it reports - editing and unfolding never leave the bubble. @typedef {"save" | "choose" | "learned" | "settings" | "reader"} ReportedAction */

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
 * @property {(options: { anchor: DOMRect, variant: Variant, body: string, tone?: Tone, actions?: Action[] }) => void} show
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
 * Puts the bubble's stylesheet into its shadow root, two ways.
 *
 * A constructed sheet first, because the bubble also opens on the extension's
 * own reader page, where the content security policy allows no inline style -
 * and a sheet built through the CSSOM is not inline style to CSP.
 *
 * The `<style>` element second, because a constructed sheet has to cross the
 * boundary between a content script and the page it runs in, and that is
 * exactly the kind of thing a browser is allowed to refuse quietly. It is
 * checked rather than assumed: an assignment that did not take leaves the list
 * empty, and the fallback is what worked on every page before this. On the
 * reader page the fallback would be blocked by CSP, which is the right way
 * round - an unstyled bubble in one place beats an unstyled bubble everywhere.
 *
 * @param {ShadowRoot} root
 */
function style(root) {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(STYLE);
    root.adoptedStyleSheets = [sheet];
    if (root.adoptedStyleSheets.length === 1) return;
  } catch {
    // Not supported, or refused. Either way there is another way to do it.
  }

  const element = document.createElement("style");
  element.textContent = STYLE;
  root.append(element);
}

/**
 * Where the bubble goes, given where the phrase is and how much room there is
 * around it.
 *
 * The answer is one edge and not a rectangle, and that is the point: the bubble
 * is pinned by the edge nearest the phrase, so everything that makes it taller -
 * a row of actions unfolding, a sentence arriving - moves the far edge and
 * leaves the line being read exactly where it was. Above the phrase by
 * preference, which is to say pinned by its bottom: reading goes downwards, so
 * the text above has been read and the text below is what comes next (D23).
 *
 * Pinning it in CSS rather than placing it again is what lets the row unfold in
 * the stylesheet: by the time it starts growing there is nothing here left to
 * run.
 *
 * @param {object} where
 * @param {{ top: number, bottom: number, left: number }} where.anchor the phrase, in viewport coordinates
 * @param {{ width: number, height: number }} where.size what the bubble measures now
 * @param {{ width: number, height: number }} where.viewport
 * @param {number} [where.folded] how much taller it is still going to get on its own
 * @returns {{ left: number, top: number } | { left: number, bottom: number }}
 */
export function placement({ anchor, size, viewport, folded = 0 }) {
  // The room to look for is the room the bubble may come to need, not the room
  // it needs now - a folded row unfolds with nobody left to move anything.
  const height = size.height + folded;

  const maxLeft = Math.max(VIEWPORT_MARGIN, viewport.width - size.width - VIEWPORT_MARGIN);
  const left = Math.round(Math.min(Math.max(VIEWPORT_MARGIN, anchor.left), maxLeft));

  if (anchor.top - GAP - height >= VIEWPORT_MARGIN) {
    return { left, bottom: Math.round(viewport.height - (anchor.top - GAP)) };
  }

  // Below it, and pushed up only by the bottom of the window: the top edge is
  // the near one now, so this is the same rule the other way round.
  const below = anchor.bottom + GAP;
  const room = viewport.height - VIEWPORT_MARGIN - height;
  return { left, top: Math.round(Math.max(VIEWPORT_MARGIN, Math.min(below, room))) };
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
  /** Whether the click the last press becomes is the one that unfolded the row. */
  let swallowClick = false;
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
    style(root);

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
    // The row of actions inside the one element that folds. Nothing outside
    // this function ever needs the wrapper: what unfolds it is a stylesheet.
    const revealElement = document.createElement("div");
    revealElement.className = "reveal";
    actionsElement = document.createElement("div");
    actionsElement.className = "actions";
    revealElement.append(actionsElement);

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
    // Only the half of the unfolding that a stylesheet cannot do (see `reveal`):
    // showing the row is a `:hover` rule, so no cursor is tracked anywhere and
    // nothing on the page below gains a listener. A press is the exception and
    // has to be a listener, because CSS cannot tell the press that asks for the
    // row from the press that uses it - and on a touch screen they are the same
    // gesture twice (see `onPointerDown`).
    bubble.addEventListener("mouseenter", reveal);
    bubble.addEventListener("focusin", reveal);
    bubble.addEventListener("pointerdown", onPointerDown);
    // Capture, which is the whole of how a swallowed click is swallowed: stopped
    // here, it never reaches the button it would have pressed.
    bubble.addEventListener("click", onClick, { capture: true });

    bubble.append(bodyElement, contextElement, entriesElement, editor, revealElement);
    root.append(bubble);
    // `documentElement` and not `body`: single-page applications replace the
    // body, and a bubble that vanishes with a re-render is a bug nobody can
    // reproduce.
    document.documentElement.append(host);
  }

  /**
   * The row of actions, out and staying out.
   *
   * What shows it is a `:hover` rule, and CSS keeps it shown for exactly as long
   * as the pointer is inside. This is the rest: once somebody has gone looking
   * for the actions, they are there until the bubble is gone. A class and not a
   * hover state, because the two disagree the moment the pointer leaves - and
   * the row winking out mid-reach is the flicker this is here to avoid.
   */
  function reveal() {
    bubble?.classList.add("revealed");
  }

  /**
   * Whether the row of actions is clipped away to nothing at this moment.
   *
   * Asked of the element and not of the variant or of the class, because both
   * can disagree with the screen: a bubble that opens under a resting cursor is
   * unfolded by `:hover` alone, with nothing in here ever told about it. What
   * the callers need to know is whether there is anything to press, and only the
   * element knows that.
   *
   * @returns {boolean}
   */
  function folded() {
    if (actionsElement === null) return false;
    return actionsElement.clientHeight === 0 && actionsElement.scrollHeight > 0;
  }

  /**
   * A press inside the bubble, and on a touch screen the only way in: a finger
   * cannot arrive anywhere without pressing it.
   *
   * So the press unfolds the row, exactly as a cursor arriving would - and then
   * has to answer for what it unfolded under itself. The finger is still down
   * where a button is about to be, so the click this press turns into is
   * swallowed: the gesture that asks for the actions may not also use one.
   * Touching an underline is a decision about recall, not about managing a
   * phrase (D22 draws the same line), and Learned is one press further in.
   *
   * Every press decides this again, which is also what disarms it: the press
   * that follows finds the row out and goes through untouched.
   */
  function onPointerDown() {
    swallowClick = folded();
    reveal();
  }

  /**
   * @param {Event} event
   */
  function onClick(event) {
    if (!swallowClick) return;
    swallowClick = false;
    event.stopPropagation();
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
   * @param {Action | "cancel" | "choose"} action
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
    if (action === "save" || action === "choose") {
      if (meanings.length === 0) return;
      // Optimistic: what was typed is what the bubble shows from now on. The
      // caller decides what it means, and says so by setting the buttons - or
      // by taking the bubble away.
      stopEditing(true);
    }
    onAction(action, meanings);
  }

  /**
   * A line of a dictionary entry, pressed.
   *
   * It writes what Save writes: this is what the phrase means from now on - one
   * meaning longer, or one shorter. It goes out under its own name all the same,
   * because the two presses end differently. Save is somebody finished with a
   * phrase and the bubble gets out of the way; a line is somebody assembling
   * one, and the next line has to still be there to press.
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
    emit("choose");
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
      button.textContent = action === "more" && unfolded ? lessLabel() : label(action);
      button.addEventListener("click", () => emit(action));
      actionsElement.append(button);
    }
    refreshControls();
  }

  /**
   * How much taller the bubble is going to get without being asked.
   *
   * A folded row is clipped to no height at all, so the bubble measures as if
   * it were not there - and by the time CSS unfolds it, there is nothing here
   * left to run. Measured rather than worked out from the variant, because a
   * recall bubble is folded only until somebody looks: once the row is out it
   * stays out, and a bubble placed again after that would otherwise have room
   * reserved for a row it is already showing.
   *
   * @returns {number}
   */
  function foldedHeight() {
    if (actionsElement === null || !folded()) return 0;
    return actionsElement.scrollHeight;
  }

  function place() {
    if (host === null || bubble === null) return;

    host.style.setProperty("visibility", "hidden", "important");
    host.style.setProperty("left", "0px", "important");
    host.style.setProperty("top", "0px", "important");
    host.style.removeProperty("bottom");

    const size = bubble.getBoundingClientRect();
    const spot = placement({
      anchor,
      size,
      viewport: {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      },
      folded: foldedHeight(),
    });

    host.style.setProperty("left", `${spot.left}px`, "important");
    // Which edge is pinned decides which way the bubble grows, and the
    // stylesheet has to know it too: the row unfolds on the far side of the
    // gloss, or the gloss would be pushed off the line it was read on.
    if ("top" in spot) {
      bubble.dataset["grow"] = "down";
      host.style.setProperty("top", `${spot.top}px`, "important");
    } else {
      bubble.dataset["grow"] = "up";
      host.style.removeProperty("top");
      host.style.setProperty("bottom", `${spot.bottom}px`, "important");
    }
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
    swallowClick = false;
    restingActions = [];
  }

  return {
    show({ anchor: rect, variant, body, tone = "normal", actions = [] }) {
      build();
      anchor = rect;
      editing = false;
      if (bubble !== null) {
        bubble.dataset["variant"] = variant;
        // The bubble is reused from phrase to phrase, and a row left out was
        // out for the last one. So is a press that never became a click: a
        // finger dragged back out of the bubble may not eat the next press.
        bubble.classList.remove("revealed");
        swallowClick = false;
      }
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
