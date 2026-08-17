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

import { applyReading } from "../lib/appearance.js";
import { webext } from "../lib/browser.js";
import { CONFIG_KEY, SIZE, TTS_RATE, isFont, isTheme, readConfig, writeConfig } from "../lib/config.js";
import { localizePage, plural, t, uiLocale } from "../lib/i18n.js";
import { pairLabel } from "../lib/language.js";
import { describeError } from "../lib/messages.js";
import { ErrorCode, Message, asResult, fail } from "../lib/protocol.js";
import { MIRROR_KEY } from "../lib/store/mirror.js";
import { exportFilename, fromTsv, pairFromFilename, toTsv } from "../lib/store/tsv.js";
import { listPairs, listPhrases } from "../lib/store/vocab.js";
import { watchToolbarScheme } from "../lib/theme-icon.js";
import { canSpeak, primaryLanguage, speak, speaking, stop as stopSpeaking, voicesFor } from "../lib/tts.js";
import { listView, markSegments, newestFirst, pairChoicesFor } from "./list-view.js";

// First, so the static text is already the catalogue's language when it shows.
localizePage();
// The toolbar icon follows the browser's scheme where the manifest cannot
// say so (Chromium, no theme_icons there) - a no-op on Firefox.
watchToolbarScheme();

/** @typedef {import("../lib/store/phrase.js").Phrase} Phrase */

const brandButton = document.getElementById("brand");
// The bar the header wears: presses inside it (or inside either panel) are
// the panels' own business, the way presses inside the reader's chrome are
// (see the pointerdown below).
const pageBar = document.querySelector(".page-bar");
const displayButton = document.getElementById("display");
const displayPanel = document.getElementById("display-panel");
const sizeValue = document.getElementById("size-value");
const voiceSetting = document.getElementById("voice-setting");
const voiceChoice = /** @type {HTMLSelectElement | null} */ (
  document.getElementById("voice-choice")
);
const rateSetting = document.getElementById("rate-setting");
const rateValue = document.getElementById("rate-value");
const menuButton = document.getElementById("menu");
const menuPanel = document.getElementById("menu-panel");
const navLibrary = document.getElementById("nav-library");
const navMarks = document.getElementById("nav-marks");
const navSettings = document.getElementById("nav-settings");
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
 * The row whose phrase is on its way out loud, by its key: pressing that
 * row's speaker again stops it, pressing any other row's simply speaks - the
 * engine replaces what was playing. A key gone stale (the utterance ended on
 * its own) is harmless, because `speaking()` answers for the engine.
 *
 * @type {string | null}
 */
let sounding = null;

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
 * The speaker, the bubble's own drawing (`speakerIcon` in
 * `content/tooltip.js`) by the same DOM calls: `currentColor` hands the icon
 * the quiet button's text color, so its resting, hover and focus states are
 * already handled by the button's own rules.
 *
 * @returns {SVGSVGElement}
 */
function speakerIcon() {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  // Decoration to assistive tech - the button's aria-label carries the words.
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

/**
 * Speaks a row's phrase - the phrase as the page had it, never the meanings
 * (D83) - or stops it when it is the one already sounding. The language is
 * the row's own, the voice and the speed are the settings every speaker of
 * this extension reads (`ttsVoices`, `ttsRate`).
 *
 * @param {Phrase} phrase
 */
function speakPhrase(phrase) {
  if (config === null) return;
  if (speaking() && sounding === phrase.normalized) {
    stopSpeaking();
    sounding = null;
    return;
  }
  sounding = phrase.normalized;
  // The voice is stored under the primary subtag (the rule every speaker of
  // this extension shares), so the row's language is narrowed the same way.
  speak(
    phrase.phrase,
    phrase.langFrom,
    config.ttsVoices[primaryLanguage(phrase.langFrom)],
    config.ttsRate / 100,
  );
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
 * One road for everything the config decides about this page's dress (D104):
 * the paper, the face and size the phrases wear, the panel's own controls,
 * and the voice the rows' speakers use. Fed with what was actually stored
 * rather than with what was asked for - at either end of a scale the honest
 * answer is "it did not move", and the controls should show that (the
 * reader's rule).
 *
 * @param {import("../lib/config.js").Config} fresh
 */
function adoptConfig(fresh) {
  config = fresh;
  applyReading(document.documentElement, fresh.reader);
  if (sizeValue !== null) sizeValue.textContent = String(fresh.reader.fontSize);
  if (rateValue !== null) rateValue.textContent = `${(fresh.ttsRate / 100).toFixed(1)}×`;
  for (const button of document.querySelectorAll("[data-theme], [data-font]")) {
    const wanted = button.getAttribute("data-theme") ?? button.getAttribute("data-font");
    const current = button.hasAttribute("data-theme") ? fresh.reader.theme : fresh.reader.font;
    button.setAttribute("aria-pressed", String(wanted === current));
  }
  renderVoiceChoice();
}

/**
 * The voice select in the panel: this device's voices able to read the
 * phrases' language - the pair's source - behind a first line that means
 * "let the browser pick". Redrawn when the settings move and when the
 * engine's list arrives: `getVoices` answers nothing until the browser has
 * loaded the voices, and `voiceschanged` is the only appointment it keeps.
 */
function renderVoiceChoice() {
  if (voiceChoice === null || config === null) return;
  const lang = config.sourceLang;
  const stored = config.ttsVoices[primaryLanguage(lang)];
  const voices = canSpeak() ? voicesFor(speechSynthesis.getVoices(), lang) : [];

  const fallback = document.createElement("option");
  fallback.value = "";
  fallback.textContent = t("options_tts_default");
  fallback.selected = stored === undefined;

  voiceChoice.replaceChildren(
    fallback,
    ...voices.map((voice) => {
      const option = document.createElement("option");
      option.value = voice.voiceURI;
      // The voice's own name plus its tag: two voices called "English"
      // differ only by where they are from, and the name alone would be a
      // coin toss.
      option.textContent = `${voice.name} (${voice.lang})`;
      option.selected = voice.voiceURI === stored;
      return option;
    }),
  );
}

/**
 * The panel's presses - the reader's handler, minus the rows this page does
 * not carry (measure, links). The steppers read first and step from wherever
 * the setting is now, because another page may have moved it since this one
 * drew itself.
 *
 * @param {Event} event
 */
async function onDisplayPress(event) {
  const button = event.target;
  if (!(button instanceof HTMLButtonElement)) return;

  const rate = button.getAttribute("data-rate");
  if (rate !== null) {
    const current = (await readConfig()).ttsRate;
    adoptConfig(await writeConfig({ ttsRate: clamp(current + Number(rate), TTS_RATE) }));
    return;
  }

  const theme = button.getAttribute("data-theme");
  const font = button.getAttribute("data-font");
  const size = button.getAttribute("data-size");

  /** @type {Partial<import("../lib/config.js").ReaderConfig>} */
  let patch = {};
  if (isTheme(theme)) patch = { theme };
  else if (isFont(font)) patch = { font };
  else if (size !== null) {
    const current = (await readConfig()).reader;
    patch = { fontSize: clamp(current.fontSize + Number(size), SIZE) };
  } else return;

  adoptConfig(await writeConfig({ reader: patch }));
}

/**
 * @param {number} value
 * @param {{ min: number, max: number }} range
 * @returns {number}
 */
function clamp(value, range) {
  return Math.min(range.max, Math.max(range.min, value));
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
    const fresh = await readConfig();
    adoptConfig(fresh);
    const pair = `${fresh.sourceLang}${fresh.targetLang}`;
    // A different pair is a different list, and page 7 of the old one means
    // nothing on it.
    if (pair !== shownPair) {
      shownPair = pair;
      page = 1;
    }

    const [saved, list] = await Promise.all([
      listPairs(),
      listPhrases({ langFrom: fresh.sourceLang, langTo: fresh.targetLang }),
    ]);
    choices = pairChoicesFor(fresh, saved);
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
  edit.className = "quiet quiet-edit";
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
  // The speaker leads the row where the device can speak at all, the bubble's
  // own order (D83): hearing the phrase is about the phrase, not about the
  // vocabulary - the one action here that never writes.
  if (canSpeak()) {
    const speaker = button("");
    speaker.className = "quiet quiet-speak";
    speaker.setAttribute("aria-label", t("vocab_speak_aria", phrase.phrase));
    speaker.title = t("bubble_speak");
    speaker.append(speakerIcon());
    speaker.addEventListener("click", () => speakPhrase(phrase));
    actions.append(speaker);
  }
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
 * Hands focus back to a row's Edit button - the one that opened the editor -
 * after the editor holding it left the DOM: Escape, Cancel and Save all
 * remove the textarea under the keyboard, and without this the focus falls
 * to the body.
 *
 * @param {string} key the row's normalized phrase
 */
function refocusRow(key) {
  if (listContainer === null) return;
  for (const row of listContainer.querySelectorAll(".phrase-row")) {
    if (row instanceof HTMLElement && row.dataset["key"] === key) {
      const edit = row.querySelector("button.quiet-edit");
      if (edit instanceof HTMLButtonElement) edit.focus();
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

/**
 * The bar's two disclosure buttons and their panels, the reader's rule: one
 * panel at a time, so the header never stands two panels tall.
 *
 * @param {HTMLElement | null} button
 * @param {HTMLElement | null} panel
 * @param {boolean} open
 */
function setPanel(button, panel, open) {
  if (button === null || panel === null) return;
  panel.hidden = !open;
  button.setAttribute("aria-expanded", String(open));
}

displayButton?.addEventListener("click", () => {
  const opening = displayPanel?.hidden === true;
  setPanel(menuButton, menuPanel, false);
  setPanel(displayButton, displayPanel, opening);
});

// The menu behind the bar's drawn button - the reader's, minus the row for
// this page (D93).
menuButton?.addEventListener("click", () => {
  const opening = menuPanel?.hidden === true;
  setPanel(displayButton, displayPanel, false);
  setPanel(menuButton, menuPanel, opening);
});

function anyPanelOpen() {
  return displayPanel?.hidden === false || menuPanel?.hidden === false;
}

// Every menu row leaves this tab standing, so each one also puts the panels
// away - coming back must not find the hallway still open.
function closePanels() {
  setPanel(displayButton, displayPanel, false);
  setPanel(menuButton, menuPanel, false);
}

displayPanel?.addEventListener("click", (event) => void onDisplayPress(event));

// The voice for the phrases' language, the same stored choice the reader's
// panel writes: the patch replaces the whole map (config.js's rule), and the
// first line means "no stored choice" - the engine's default for the language.
voiceChoice?.addEventListener("change", () => {
  if (voiceChoice === null || config === null) return;
  const key = primaryLanguage(config.sourceLang);
  if (key === "") return;
  const map = { ...config.ttsVoices };
  if (voiceChoice.value === "") delete map[key];
  else map[key] = voiceChoice.value;
  void writeConfig({ ttsVoices: map }).then(adoptConfig);
});

// The voice rows exist only where they can do something, and the engine's
// voice list arrives on its own schedule - after first paint on most
// platforms, never at all on some (Android speaks anyway, see lib/tts.js).
if (canSpeak()) {
  if (voiceSetting !== null) voiceSetting.hidden = false;
  if (rateSetting !== null) rateSetting.hidden = false;
  speechSynthesis.addEventListener("voiceschanged", renderVoiceChoice);
}

// The reading-list row goes through the background exactly as the popup's
// does: `openLibrary` points the reader at nothing and raises its one tab
// (`reader-tab.js`), while this tab stays the saved-phrases page the tab
// registry says it is. A rejection means the background was mid-restart -
// the press can be repeated; the popup's rows make the same bargain.
navLibrary?.addEventListener("click", () => {
  closePanels();
  void webext()
    .runtime.sendMessage({ kind: Message.OPEN_LIBRARY })
    .catch(() => undefined);
});

// The highlights row goes the reading list's way: the same one reader tab,
// turned to the highlights page by the message, while this tab stays put.
navMarks?.addEventListener("click", () => {
  closePanels();
  void webext()
    .runtime.sendMessage({ kind: Message.OPEN_MARKS })
    .catch(() => undefined);
});

// The settings row is the mark's press with a word on it.
navSettings?.addEventListener("click", () => {
  closePanels();
  void webext().runtime.openOptionsPage();
});

// An open panel yields to the page underneath, exactly as the reader's panels
// do (Michał's report, 2026-08-16): a press anywhere but the bar and the
// panels puts them away, and Escape does the same from the keyboard - handing
// focus back to the button whose panel held it. Presses inside the bar and
// the panels are their own business, the reader's rule for its chrome: the
// toggles' click handlers decide.
document.addEventListener("pointerdown", (event) => {
  if (!anyPanelOpen()) return;
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (
    pageBar?.contains(target) === true ||
    displayPanel?.contains(target) === true ||
    menuPanel?.contains(target) === true
  ) {
    return;
  }
  closePanels();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !anyPanelOpen()) return;
  const focus = document.activeElement;
  if (focus instanceof Node && displayPanel?.contains(focus) === true) displayButton?.focus();
  else if (focus instanceof Node && menuPanel?.contains(focus) === true) menuButton?.focus();
  closePanels();
});

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
  // The mirror is how a vocabulary write anywhere - a bubble on some tab,
  // this page itself - announces itself: the list is stale, reload it.
  if (changes[MIRROR_KEY] !== undefined) {
    void reload();
    return;
  }
  if (changes[CONFIG_KEY] === undefined) return;
  // The config carries the pair and the dress. A change that kept the pair
  // only dressed the page - the rows stand as they are, which on e-ink is
  // the difference between nothing and a flash per stepper press.
  void readConfig().then((fresh) => {
    const pair = `${fresh.sourceLang}${fresh.targetLang}`;
    adoptConfig(fresh);
    if (pair !== shownPair) void reload();
  });
});

// The intro quotes the bubble's own button labels, so the two can never drift
// apart - which is also why it cannot be a `data-i18n` swap.
const intro = t("vocab_intro", [t("bubble_learned"), t("bubble_edit")]);
if (introLine !== null && intro.length > 0) introLine.textContent = intro;

void reload();
