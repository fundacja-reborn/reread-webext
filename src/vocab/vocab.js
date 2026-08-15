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
import { exportFilename, fromTsv, pairFromFilename, toTsv } from "../lib/store/tsv.js";
import { listPairs, listPhrases } from "../lib/store/vocab.js";
import { watchToolbarScheme } from "../lib/theme-icon.js";
import { listView, markSegments, newestFirst, pairChoicesFor } from "./list-view.js";

// First, so the static text is already the catalogue's language when it shows.
localizePage();
// The toolbar icon follows the browser's scheme where the manifest cannot
// say so (Chromium, no theme_icons there) - a no-op on Firefox.
watchToolbarScheme();

/** @typedef {import("../lib/store/phrase.js").Phrase} Phrase */

const brandButton = document.getElementById("brand");
const pairSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById("pair"));
const introLine = document.getElementById("intro");
const countLine = document.getElementById("count");
const exportButton = /** @type {HTMLButtonElement | null} */ (document.getElementById("export"));
const importButton = /** @type {HTMLButtonElement | null} */ (document.getElementById("import"));
const importInput = /** @type {HTMLInputElement | null} */ (document.getElementById("import-file"));
const importConfirm = document.getElementById("import-confirm");
const importSummary = document.getElementById("import-summary");
const importSample = document.getElementById("import-sample");
const importPairSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById("import-pair"));
const importRun = /** @type {HTMLButtonElement | null} */ (document.getElementById("import-run"));
const importCancel = /** @type {HTMLButtonElement | null} */ (document.getElementById("import-cancel"));
const transferLine = document.getElementById("transfer-status");
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
 * The file waiting for the reader's yes: its name, its rows as parsed, and
 * how many lines were not rows at all. State rather than DOM for the same
 * reason the editor's draft is - a re-render must not eat it.
 */
/** @type {{ name: string, rows: import("../lib/store/tsv.js").TsvRow[], invalid: number } | null} */
let pending = null;

/**
 * What the confirmation's pair select offers, kept so the pressed choice can
 * be looked up the way the header select's is.
 */
/** @type {ReturnType<typeof pairChoicesFor>} */
let importChoices = [];

/** How many rows the confirmation quotes before asking. */
const SAMPLE_ROWS = 3;

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
 * The transfer's own status line, under its own buttons: an import report
 * next to the pager would be an answer far from its question.
 *
 * @param {string} text
 * @param {"error"} [tone]
 */
function transferStatus(text, tone) {
  if (transferLine === null) return;
  transferLine.textContent = text;
  if (tone === undefined) delete transferLine.dataset["tone"];
  else transferLine.dataset["tone"] = tone;
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
  renderList();
  // Exporting nothing would download an empty file; the button says so first.
  if (exportButton !== null) exportButton.disabled = phrases.length === 0;
}

function renderPair() {
  if (pairSelect === null || config === null) return;
  pairSelect.replaceChildren();
  for (const choice of choices) {
    const option = document.createElement("option");
    option.value = choice.pair;
    // No count in the options: the counter under the title is the one place
    // this page says how much a pair holds, and two numbers for one list
    // drift apart in the eye. (The import offer's select keeps its counts -
    // there they say what a file would land next to.)
    option.textContent = pairLabel(choice.from, choice.to);
    option.selected = choice.from === config.sourceLang && choice.to === config.targetLang;
    pairSelect.append(option);
  }
}

/**
 * The one counter, under the title: the whole pair, or "8 of 26" while the
 * filter narrows it down.
 *
 * @param {number} matching
 */
function renderCount(matching) {
  if (countLine === null) return;
  countLine.hidden = phrases.length === 0;
  countLine.textContent =
    query.trim().length > 0
      ? plural(phrases.length, "vocab_count_filtered", [matching.toLocaleString()])
      : plural(phrases.length, "phrases");
}

function renderList() {
  if (listContainer === null) return;

  const view = listView(phrases, { query, page });
  page = view.page;
  // The counter follows every repaint of the list, so a keystroke in the
  // filter and a phrase learned on another tab both keep it true.
  renderCount(view.matching);

  // A re-render can land mid-keystroke (a save on another tab rebuilds the
  // mirror); the draft survives as state, and the keyboard should too.
  const editorHadFocus =
    document.activeElement instanceof HTMLTextAreaElement &&
    listContainer.contains(document.activeElement);

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

/**
 * @param {{ page: number, pages: number }} view
 */
function renderPager(view) {
  if (pager === null) return;
  pager.hidden = view.pages <= 1;
  if (pageLabel !== null) {
    pageLabel.textContent = t("pager_page_of", [view.page.toLocaleString(), view.pages.toLocaleString()]);
  }
  if (prevButton !== null) prevButton.disabled = view.page <= 1;
  if (nextButton !== null) nextButton.disabled = view.page >= view.pages;
}

/**
 * The filter's matches lit up inside the text with <mark> - built from text
 * nodes, never markup, because the strings come from pages this extension
 * does not trust. With no filter the text goes in whole.
 *
 * @param {HTMLElement} node
 * @param {string} text
 */
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

/**
 * The filter came up empty: the sentence quotes the query, and the one move
 * that helps stands under it. Clearing hands focus back to the filter, ready
 * for a second try.
 *
 * @returns {HTMLElement}
 */
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

/**
 * @param {Phrase} phrase
 * @returns {HTMLElement}
 */
function phraseRow(phrase) {
  const row = element("div", "phrase-row");
  // How the closed editor finds its row again to hand focus back.
  row.dataset["key"] = phrase.normalized;

  const word = element("span", "phrase-word");
  fillHighlighted(word, phrase.phrase);
  // The day it was kept, on hover: useful now and then, clutter always.
  word.title = new Date(phrase.createdAt).toLocaleDateString(uiLocale());
  row.append(word);

  if (editing === phrase.normalized) {
    row.append(editorFor(phrase));
    return row;
  }

  const meanings = element("span", "phrase-meanings");
  fillHighlighted(meanings, phrase.translations.join("; "));
  row.append(meanings);

  // The buttons speak for themselves to the eye; to a screen reader a bare
  // "Edit" in a list of a hundred names nothing, so each carries its phrase.
  const edit = button(t("bubble_edit"));
  edit.className = "quiet";
  edit.setAttribute("aria-label", t("vocab_edit_aria", phrase.phrase));
  edit.addEventListener("click", () => {
    editing = phrase.normalized;
    draft = phrase.translations.join("\n");
    renderList();
    // The editor replaced the button that had focus; typing is what it is for.
    listContainer?.querySelector("textarea")?.focus();
  });

  const learned = button(t("bubble_learned"));
  learned.className = "quiet quiet-learned";
  learned.setAttribute("aria-label", t("vocab_learned_aria", phrase.phrase));
  learned.addEventListener("click", () => void forget(phrase, learned));

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

/**
 * Hands focus back to a row's first button (Edit) after the editor holding
 * it left the DOM - Escape, Cancel and Save all remove the textarea under
 * the keyboard, and without this the focus falls to the body.
 *
 * @param {string} key the row's normalized phrase
 */
function refocusRow(key) {
  if (listContainer === null) return;
  for (const row of listContainer.querySelectorAll(".phrase-row")) {
    if (row instanceof HTMLElement && row.dataset["key"] === key) {
      row.querySelector("button")?.focus();
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

/**
 * Removes the phrase the moment the button is pressed - no dialog, no undo:
 * a slip is repaired by selecting the phrase while reading, the ordinary
 * save path.
 *
 * @param {Phrase} phrase
 * @param {HTMLButtonElement} trigger the row's own Learned button
 */
async function forget(phrase, trigger) {
  // The pressed button is about to leave the DOM, and focus would fall to
  // the body. Its place in the list, counted first, names the successor:
  // the next row's Learned, the previous one's after the last row, the
  // filter once the list is empty.
  const learnedButtons = () =>
    listContainer === null ? [] : [...listContainer.querySelectorAll("button.quiet-learned")];
  const at = learnedButtons().indexOf(trigger);

  const answer = await ask({ kind: Message.FORGET_PHRASE, text: phrase.phrase });
  if (!answer.ok) {
    status(describeError(answer.code), "error");
    return;
  }
  status("");
  // The mirror event lands too; reloading here as well makes the row's
  // disappearance a consequence of the answer, not of an event arriving.
  await reload();

  if (at === -1) return;
  const successor = learnedButtons()[Math.min(at, learnedButtons().length - 1)];
  if (successor instanceof HTMLButtonElement) successor.focus();
  else filterInput?.focus();
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
  // Editing keeps the row's place (the store keeps id and createdAt), so
  // the button focus returns to is where the eye already is.
  refocusRow(phrase.normalized);
}

/**
 * The whole pair as a file - fresh from the database rather than from the
 * page's copy, because the copy is newest first and an export is the
 * vocabulary, not the view: oldest first, the order that keeps two exports
 * diffable. Downloading is a blob and an anchor; no permission asks for less.
 */
async function exportPhrases() {
  if (config === null) return;
  const pair = { langFrom: config.sourceLang, langTo: config.targetLang };
  try {
    const list = await listPhrases(pair);
    if (list.length === 0) return;
    const url = URL.createObjectURL(new Blob([toTsv(list)], { type: "text/tab-separated-values" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = exportFilename(pair);
    anchor.click();
    // The URL has to outlive the click long enough for the download to take
    // it. A minute is comfortably that, and then the blob can go.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    transferStatus("");
  } catch {
    transferStatus(describeError(ErrorCode.INTERNAL), "error");
  }
}

/**
 * @param {File} file
 */
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

/**
 * The moment of consent: what the file holds and where it would go, before
 * anything is written.
 */
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
      item.textContent = `${row.text} → ${row.translations.join("; ")}`;
      importSample.append(item);
    }
  }

  renderImportPair();
}

/**
 * The pair select starts on what the file's name says when it says anything,
 * and on the pair being shown when it does not - a guess is fine as a
 * starting point and never as a decision. A named pair with nothing saved
 * yet is offered too: vocabulary may arrive before its model does.
 */
function renderImportPair() {
  if (importPairSelect === null || config === null || pending === null) return;

  const named = pairFromFilename(pending.name);
  importChoices = [...choices];
  if (named !== null && !importChoices.some((one) => one.from === named.langFrom && one.to === named.langTo)) {
    importChoices.unshift({
      pair: `${named.langFrom}${named.langTo}`,
      from: named.langFrom,
      to: named.langTo,
      count: 0,
    });
  }

  const preferred =
    named !== null ? `${named.langFrom}${named.langTo}` : `${config.sourceLang}${config.targetLang}`;

  importPairSelect.replaceChildren();
  for (const choice of importChoices) {
    const option = document.createElement("option");
    option.value = choice.pair;
    option.textContent =
      choice.count > 0
        ? `${pairLabel(choice.from, choice.to)} (${choice.count.toLocaleString()})`
        : pairLabel(choice.from, choice.to);
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
  if (choice === undefined) return;

  importRun.disabled = true;
  try {
    // The same global switch the select at the top makes, committed by this
    // press: the import goes to the configured pair, like every message this
    // page sends, and the page follows the configuration to the result.
    if (config === null || config.sourceLang !== choice.from || config.targetLang !== choice.to) {
      await writeConfig({ sourceLang: choice.from, targetLang: choice.to });
    }

    const offered = pending;
    const answer = await ask({ kind: Message.IMPORT_PHRASES, rows: offered.rows });
    if (!answer.ok) {
      // The offer stays open: an error must not eat the file the reader
      // already picked and read.
      transferStatus(describeError(answer.code), "error");
      return;
    }

    const report = /** @type {import("../lib/protocol.js").ImportReport} */ (answer.value);
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

// The mark at the top is the door to the settings, the same one the reader's
// bar carries: its own tab (`openOptionsPage` raises the settings tab if one is
// already open), so the list on screen stays where it is.
brandButton?.addEventListener("click", () => void webext().runtime.openOptionsPage());

pairSelect?.addEventListener("change", () => {
  if (pairSelect === null) return;
  const choice = choices.find((one) => one.pair === pairSelect.value);
  if (choice === undefined) return;
  // The same write the popup makes. The storage listener below is the render
  // path, so switching here and switching there repaint this page the same way.
  void writeConfig({ sourceLang: choice.from, targetLang: choice.to });
});

exportButton?.addEventListener("click", () => void exportPhrases());

importButton?.addEventListener("click", () => importInput?.click());

importInput?.addEventListener("change", () => {
  if (importInput === null) return;
  const file = importInput.files?.[0];
  // Cleared so that the same file, picked again, fires this again.
  importInput.value = "";
  if (file !== undefined) void offerImport(file);
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
