/**
 * The saved-phrases page: everything kept for the pair being read, with the
 * two acts the bubble offers - Learned and Edit - available in one place
 * instead of wherever the word last appeared.
 *
 * Reads go straight to the vocabulary database, the way the settings page
 * reads the model store: extension pages share the extension's origin, and a
 * read takes no message and changes nothing. Writes still travel through the
 * background (`save-phrase`, `forget-phrase`), because a vocabulary write is
 * two steps - the row, then the mirror - and `background/vocabulary.js` is
 * where that rule is enforced.
 *
 * The pair select is the popup's control by another door: it writes the
 * settings, and this page follows them. The whole extension has one notion of
 * "the pair being read" - a pair private to this page would be a second one,
 * and the messages the buttons send would act on the wrong vocabulary.
 *
 * Freshness rides on `storage.onChanged`: every vocabulary write ends in the
 * mirror, so the mirror doubles as the change signal, and a phrase learned in
 * a bubble on some other tab leaves this list by itself.
 */

import { webext } from "../lib/browser.js";
import { CONFIG_KEY, readConfig, writeConfig } from "../lib/config.js";
import { localizePage, plural, t, uiLocale } from "../lib/i18n.js";
import { pairLabel } from "../lib/language.js";
import { describeError } from "../lib/messages.js";
import { ErrorCode, Message, asResult, fail } from "../lib/protocol.js";
import { MIRROR_KEY } from "../lib/store/mirror.js";
import { listPairs, listPhrases } from "../lib/store/vocab.js";
import { listView, newestFirst, pairChoicesFor } from "./list-view.js";

// First, so the static text is already the catalogue's language when it shows.
localizePage();

/** @typedef {import("../lib/store/phrase.js").Phrase} Phrase */

const pairSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById("pair"));
const introLine = document.getElementById("intro");
const countLine = document.getElementById("count");
const filterInput = /** @type {HTMLInputElement | null} */ (document.getElementById("filter"));
const listContainer = document.getElementById("list");
const statusLine = document.getElementById("status");
const pager = document.getElementById("pager");
const pageLabel = document.getElementById("page-label");
const prevButton = /** @type {HTMLButtonElement | null} */ (document.getElementById("prev"));
const nextButton = /** @type {HTMLButtonElement | null} */ (document.getElementById("next"));

/** @type {import("../lib/config.js").Config | null} */
let config = null;
/** @type {Phrase[]} newest first */
let phrases = [];
/** @type {ReturnType<typeof pairChoicesFor>} */
let choices = [];
/** Which pair the list on screen belongs to, so a change resets the page. */
let shownPair = "";
let query = "";
let page = 1;

/**
 * The row being edited, by its key, and the editor's unsaved text. State
 * rather than a DOM node, so that a re-render - a save on another tab, a
 * pressed filter - rebuilds the editor with the draft intact instead of
 * pulling the text out from under the keyboard.
 */
/** @type {string | null} */
let editing = null;
let draft = "";

/**
 * @param {string} tag
 * @param {string} className
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * @param {string} label
 * @returns {HTMLButtonElement}
 */
function button(label) {
  const node = document.createElement("button");
  node.type = "button";
  node.textContent = label;
  return node;
}

/**
 * @param {string} text
 * @param {"error"} [tone]
 */
function status(text, tone) {
  if (statusLine === null) return;
  statusLine.textContent = text;
  if (tone === undefined) delete statusLine.dataset["tone"];
  else statusLine.dataset["tone"] = tone;
}

/**
 * @param {import("../lib/protocol.js").Request} request
 * @returns {Promise<import("../lib/protocol.js").Result<unknown>>}
 */
async function ask(request) {
  try {
    return asResult(await webext().runtime.sendMessage(request));
  } catch {
    // The background was mid-restart. The press can be repeated.
    return fail(ErrorCode.INTERNAL);
  }
}

async function reload() {
  try {
    config = await readConfig();
    const pair = `${config.sourceLang}${config.targetLang}`;
    // A different pair is a different list, and page 7 of the old one means
    // nothing on it.
    if (pair !== shownPair) {
      shownPair = pair;
      page = 1;
    }

    const [saved, list] = await Promise.all([
      listPairs(),
      listPhrases({ langFrom: config.sourceLang, langTo: config.targetLang }),
    ]);
    choices = pairChoicesFor(config, saved);
    phrases = newestFirst(list);

    // The phrase being edited can be learned from a bubble on another tab; an
    // editor for a row that no longer exists must not lie in wait for the day
    // the phrase is saved again.
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
  renderCount();
  renderList();
}

function renderPair() {
  if (pairSelect === null || config === null) return;
  pairSelect.replaceChildren();
  for (const choice of choices) {
    const option = document.createElement("option");
    option.value = choice.pair;
    // The count is part of the choice: which pairs hold anything is exactly
    // what somebody opening this select wants to know.
    option.textContent =
      choice.count > 0
        ? `${pairLabel(choice.from, choice.to)} (${choice.count.toLocaleString()})`
        : pairLabel(choice.from, choice.to);
    option.selected = choice.from === config.sourceLang && choice.to === config.targetLang;
    pairSelect.append(option);
  }
}

function renderCount() {
  if (countLine === null) return;
  countLine.hidden = phrases.length === 0;
  countLine.textContent = plural(phrases.length, "phrases");
}

function renderList() {
  if (listContainer === null) return;

  const view = listView(phrases, { query, page });
  page = view.page;

  // A re-render can land mid-keystroke (a save on another tab rebuilds the
  // mirror); the draft survives as state, and the keyboard should too.
  const editorHadFocus =
    document.activeElement instanceof HTMLTextAreaElement &&
    listContainer.contains(document.activeElement);

  listContainer.replaceChildren();

  if (phrases.length === 0) {
    listContainer.append(element("p", "empty", t("vocab_empty", t("bubble_save"))));
  } else if (view.matching === 0) {
    listContainer.append(element("p", "empty", t("vocab_filter_no_match")));
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

/**
 * @param {{ page: number, pages: number }} view
 */
function renderPager(view) {
  if (pager === null) return;
  pager.hidden = view.pages <= 1;
  if (pageLabel !== null) {
    pageLabel.textContent = t("vocab_page_of", [view.page.toLocaleString(), view.pages.toLocaleString()]);
  }
  if (prevButton !== null) prevButton.disabled = view.page <= 1;
  if (nextButton !== null) nextButton.disabled = view.page >= view.pages;
}

/**
 * @param {Phrase} phrase
 * @returns {HTMLElement}
 */
function phraseRow(phrase) {
  const row = element("div", "phrase-row");

  const word = element("span", "phrase-word", phrase.phrase);
  // The day it was kept, on hover: useful now and then, clutter always.
  word.title = new Date(phrase.createdAt).toLocaleDateString(uiLocale());
  row.append(word);

  if (editing === phrase.normalized) {
    row.append(editorFor(phrase));
    return row;
  }

  row.append(element("span", "phrase-meanings", phrase.translations.join("; ")));

  const edit = button(t("bubble_edit"));
  edit.addEventListener("click", () => {
    editing = phrase.normalized;
    draft = phrase.translations.join("\n");
    renderList();
  });

  const learned = button(t("bubble_learned"));
  learned.addEventListener("click", () => void forget(phrase));

  const actions = element("div", "phrase-actions");
  actions.append(edit, learned);
  row.append(actions);
  return row;
}

/**
 * The row, unfolded: the meanings as lines in a textarea, the bubble's editor
 * by other means - Enter keeps, Shift+Enter adds a line, Escape backs out,
 * and there is nothing to keep when no line has anything on it.
 *
 * @param {Phrase} phrase
 * @returns {HTMLElement}
 */
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

function closeEditor() {
  editing = null;
  draft = "";
  renderList();
}

/**
 * @param {Phrase} phrase
 */
async function forget(phrase) {
  const answer = await ask({ kind: Message.FORGET_PHRASE, text: phrase.phrase });
  if (!answer.ok) {
    status(describeError(answer.code), "error");
    return;
  }
  status("");
  // The mirror event lands too; reloading here as well makes the row's
  // disappearance a consequence of the answer, not of an event arriving.
  await reload();
}

/**
 * @param {Phrase} phrase
 */
async function saveEdit(phrase) {
  const translations = draft
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (translations.length === 0) return;

  const answer = await ask({ kind: Message.SAVE_PHRASE, text: phrase.phrase, translations });
  if (!answer.ok) {
    // The editor stays open with the draft: an error must not eat the text.
    status(describeError(answer.code), "error");
    return;
  }
  status("");
  editing = null;
  draft = "";
  await reload();
}

pairSelect?.addEventListener("change", () => {
  if (pairSelect === null) return;
  const choice = choices.find((one) => one.pair === pairSelect.value);
  if (choice === undefined) return;
  // The same write the popup makes. The storage listener below is the render
  // path, so switching here and switching there repaint this page the same way.
  void writeConfig({ sourceLang: choice.from, targetLang: choice.to });
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
  // The settings carry the pair; the mirror is how a vocabulary write anywhere
  // - a bubble on some tab, this page itself - announces itself.
  if (changes[CONFIG_KEY] === undefined && changes[MIRROR_KEY] === undefined) return;
  void reload();
});

// The intro quotes the bubble's own button labels, so the two can never drift
// apart - which is also why it cannot be a `data-i18n` swap.
const intro = t("vocab_intro", [t("bubble_learned"), t("bubble_edit")]);
if (introLine !== null && intro.length > 0) introLine.textContent = intro;

void reload();
