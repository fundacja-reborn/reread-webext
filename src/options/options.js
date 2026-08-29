/**
 * The settings page, and the only place in this extension that touches the
 * network.
 *
 * Downloading here rather than in the background is deliberate. Firefox may
 * suspend the background event page whenever it likes, and a twenty-five
 * megabyte download that dies halfway through because nothing was on screen is
 * a bug nobody can reproduce. A page somebody is looking at stays alive for as
 * long as they are looking at it, which is exactly as long as the download is
 * meant to last.
 *
 * The other half of what this page does needs no network at all: putting a
 * model here from files on disk. That stays, whatever happens to the download
 * host - it is the way out on the day it stops answering.
 */

import { followTheme } from "../lib/appearance.js";
import { webext } from "../lib/browser.js";
import {
  BUBBLE_SCALE,
  CONFIG_KEY,
  TTS_RATE,
  effectiveLibraryCopy,
  effectiveReaderOnly,
  platformOs,
  readConfig,
  withDefaults,
  writeConfig,
} from "../lib/config.js";
import { aside, localizePage, megabytes, plural, t, uiLocale } from "../lib/i18n.js";
import { armBackArrow } from "../lib/back-arrow.js";
import { languageName, pairLabel } from "../lib/language.js";
import { catalogDictionaries, catalogSource } from "../lib/dict/catalog.js";
import { describeDictDownloadProblem, downloadArchive } from "../lib/dict/download.js";
import { readLiveDictionaries, refreshLiveDictionaries } from "../lib/dict/live.js";
import {
  aliasesOf,
  classifyDictionaryFiles,
  describeImportProblem,
  dictionaryFromZip,
  entriesOf,
  openDictionary,
} from "../lib/dict/import.js";
import { describeZipProblem, readZip } from "../lib/dict/zip.js";
import { entriesReadFrom, rowBatches } from "../lib/dict/rows.js";
import { afterMove } from "../lib/dict/order.js";
import {
  beginImport,
  deleteDictionary,
  finishImport,
  listDictionaries,
  openWriter,
  readSources,
  removeUnfinished,
  reorderDictionaries,
  stageSources,
} from "../lib/dict/store.js";
import { describeDownloadProblem, downloadModel } from "../lib/models/download.js";
import { classifyModelFiles, describeClassifyProblem, isGzip } from "../lib/models/files.js";
import { readLiveModels, refreshLiveModels } from "../lib/models/live.js";
import { modelRows, registryModels, registrySource } from "../lib/models/registry.js";
import { deleteModel, listModels, putModel } from "../lib/models/store.js";
import { modelSourceUrl, updateAvailable } from "../lib/models/upstream.js";
import { testLoadModel } from "../lib/models/validate.js";
import { Message } from "../lib/protocol.js";
import { ensurePersistent, isWebKit, persistenceNote, readStorage } from "../lib/storage-report.js";
import { readBackupSummary } from "../lib/store/backup.js";
import {
  buildLibraryCopy,
  clearLibraryCopy,
  completeLibraryCopy,
  readLibraryCopy,
} from "../lib/store/library-copy.js";
import { marksInBackup, readMarksBackup } from "../lib/store/marks-backup.js";
import { watchToolbarScheme } from "../lib/theme-icon.js";
import { canSpeak, speak, voicesFor } from "../lib/tts.js";
import {
  dictionaryRows,
  filterActive,
  firstStepsMove,
  matchesFilter,
  orderForDisplay,
  pairChoices,
  rowVisible,
  searchableText,
  showAllState,
} from "./models-view.js";

/**
 * The one download that may be in flight. One at a time on purpose: each holds
 * its files in memory until they are checked, and two at once would double that
 * for no gain on a single connection.
 *
 * @type {{ pair: string, controller: AbortController } | null}
 */
let running = null;

// First, so every row and status below lands on a page already speaking the
// catalogue's language.
localizePage();
// The toolbar icon follows the browser's scheme where the manifest cannot
// say so (Chromium, no theme_icons there) - a no-op on Firefox.
watchToolbarScheme();
// The paper follows the theme the Aa panels write (D104): this page has no
// content of its own to dress, but walking here from a sepia article must
// not flash a white room.
followTheme();

/** @type {import("../lib/config.js").Config} */
let config = withDefaults(undefined);

/** Which platform this is - learned once, part of what the mode switch shows. */
let os = "";

/**
 * The freshest model list this device has seen - the cache of Mozilla's index,
 * read at open and refreshed over the network only when the update button is
 * pressed. Null until the first refresh ever succeeds; the packaged registry
 * stands in until then, so day one works offline.
 *
 * @type {import("../lib/models/live.js").LiveModels | null}
 */
let liveList = null;

/** One refresh at a time - a double press must not race itself. */
let refreshing = false;

/**
 * The dictionary catalogue's twin of `liveList`: the freshest listing this
 * device has seen, read at open and refreshed over the network only when its
 * own update button is pressed. The packaged catalogue stands in until then.
 *
 * @type {import("../lib/dict/live.js").LiveDictionaries | null}
 */
let liveDictionaries = null;

/** One dictionary-list refresh at a time, for the same reason. */
let refreshingDictionaries = false;

/**
 * What the first-steps fold needs to know, each half learned by the frame
 * render that already sees its store. Null is "not looked yet": the fold
 * stays hidden until both halves have answered, so the first paint is
 * already the right shape rather than a guess that folds a heartbeat later.
 *
 * @type {boolean | null}
 */
let modelStored = null;

/** @type {boolean | null} */
let dictionaryStored = null;

/**
 * The installed dictionaries as the last render found them, in the order they
 * answer in. An arrow moves one row within the whole list, so the press has to
 * know the list - and reading it back off the screen would mean trusting the
 * screen about what the database holds.
 *
 * @type {string[]}
 */
let dictionaryOrder = [];

/** The verdict the fold last moved on - see `firstStepsMove`. @type {boolean | null} */
let setupDone = null;

/**
 * Whether each catalogue stands unfolded past its installed rows. A press on
 * "Show all" is remembered until the page closes; clearing the filter with
 * the list still folded returns to the installed rows alone.
 */
let modelsExpanded = false;

/** @type {boolean} */
let dictionariesExpanded = false;

/**
 * The fresh-install signpost, standing open while a model or a dictionary is
 * missing and folded to its heading once both are stored - never gone, so the
 * instructions can be reread at will. Both frame renders report here, because
 * every edge a model or a dictionary crosses already passes through one of
 * them. The fold only moves when the verdict changes, so a fold toggled by
 * hand keeps the reader's choice through every redraw in between.
 */
function renderFirstSteps() {
  const fold = document.getElementById("first-steps");
  if (!(fold instanceof HTMLDetailsElement)) return;
  if (modelStored === null || dictionaryStored === null) return;

  const move = firstStepsMove(setupDone, modelStored, dictionaryStored);
  setupDone = move.done;
  if (move.open !== null) fold.open = move.open;
  fold.hidden = false;
}

/**
 * @returns {import("../lib/models/registry.js").RegistryModel[]}
 */
function availableModels() {
  return liveList?.models ?? registryModels();
}

/**
 * @returns {string} the day the list on screen is from
 */
function listDate() {
  return liveList?.fetchedAt ?? registrySource().checkedAt;
}

/**
 * @returns {import("../lib/dict/catalog.js").CatalogDictionary[]}
 */
function availableDictionaries() {
  return liveDictionaries?.dictionaries ?? catalogDictionaries();
}

/**
 * @returns {string} the day the dictionary list on screen is from
 */
function dictionaryListDate() {
  return liveDictionaries?.fetchedAt ?? catalogSource().checkedAt;
}

/**
 * Asks the index's host what the list is today, and redraws what changed.
 *
 * Only ever called by the update button - the page itself never asks, so the
 * network stays quiet until somebody knowingly presses. Somebody asked, so
 * somebody is answered: success, failure and the date all land in the line
 * beside the button.
 */
async function refreshList() {
  if (refreshing) return;
  refreshing = true;
  refreshStatus(t("options_refreshing_list"), "busy");

  try {
    const result = await refreshLiveModels();
    if (!result.ok) {
      refreshStatus(t("options_refresh_failed", [aside(result.detail), listDate()]), "error");
      return;
    }

    liveList = result.value;
    fill("model-checked", listDate());
    // Success speaks through the date beside the button - a sentence saying
    // the same thing under it was a duplicate. Failure keeps its sentence,
    // because the date alone cannot say why nothing changed.
    refreshStatus("");
    // Not while a download or an import holds the screen: redrawing would
    // replace a live progress bar, and the next full render comes when it
    // finishes anyway - with this fresher list, because it is read then.
    // The select alone must not wait for that.
    if (running === null && !importing) await renderModels();
    else renderPair(modelRows(await listModels(), availableModels()));
  } finally {
    refreshing = false;
  }
}

/**
 * The dictionary list's own update button - the same manners as the model
 * list's: only ever called by a press, and answered beside the button.
 */
async function refreshDictionaryList() {
  if (refreshingDictionaries) return;
  refreshingDictionaries = true;
  dictionaryRefreshStatus(t("options_refreshing_dict_list"), "busy");

  try {
    const result = await refreshLiveDictionaries();
    if (!result.ok) {
      dictionaryRefreshStatus(t("options_refresh_failed", [aside(result.detail), dictionaryListDate()]), "error");
      return;
    }

    liveDictionaries = result.value;
    fill("dictionary-checked", dictionaryListDate());
    // The same manners as the model list's: the fresh date is the answer.
    dictionaryRefreshStatus("");
    if (running === null && !importing) await renderCatalog();
  } finally {
    refreshingDictionaries = false;
  }
}

/**
 * The reader-only switch shows the mode as it acts, not as it is stored: with
 * nothing chosen the box reflects the platform's default. The first press
 * stores a real choice, and from then on the platform has no say - which is
 * the point: a changed default in some future version must not overrule a
 * switch somebody has set.
 */
function renderReaderOnly() {
  const toggle = document.getElementById("reader-only");
  if (toggle instanceof HTMLInputElement) toggle.checked = effectiveReaderOnly(config, os);
}

/** The quiet-bubble switch (D81) - stored plainly, no platform in the picture. */
function renderQuietBubble() {
  const toggle = document.getElementById("quiet-bubble");
  if (toggle instanceof HTMLInputElement) toggle.checked = config.hideBubbleActions;
}

/** The default-keep switch (D124): whether the reader files what it opens. */
function renderKeepArticles() {
  const toggle = document.getElementById("keep-articles");
  if (toggle instanceof HTMLInputElement) toggle.checked = config.keepArticles;
}

/**
 * The reading list's copy switch, shown as it acts rather than as it is
 * stored - the unchosen state is on (`effectiveLibraryCopy`, D146).
 */
function renderLibraryCopy() {
  const toggle = document.getElementById("library-copy");
  if (toggle instanceof HTMLInputElement) toggle.checked = effectiveLibraryCopy(config);
}

/**
 * The translation-off switch (D120). The body class is the stylesheet's
 * handle on every `translation-only` part of this page - set at render so a
 * fresh open is already the right shape, and again whenever the setting
 * moves, from here or from anywhere else.
 */
function renderNoTranslation() {
  const toggle = document.getElementById("no-translation");
  if (toggle instanceof HTMLInputElement) toggle.checked = config.translationOff;
  document.body.classList.toggle("no-translation", config.translationOff);
}

/** The bubble-size stepper's value (D85), shown as the percent it is stored as. */
function renderBubbleScale() {
  const value = document.getElementById("bubble-scale-value");
  if (value !== null) value.textContent = `${config.bubbleScale}%`;
}

/**
 * One step of the bubble-size stepper. Read fresh first, because the buttons
 * step from wherever the setting is now and another page may have moved it;
 * shown from what was actually stored, because at either end of the scale the
 * honest answer is "it did not move" (`withDefaults` clamps).
 *
 * @param {number} by
 */
async function stepBubbleScale(by) {
  const current = (await readConfig()).bubbleScale;
  config = await writeConfig({ bubbleScale: current + by });
  renderBubbleScale();
}

/**
 * What the Listen button speaks. Digits on purpose: every language the engine
 * could offer has them and reads them in its own words, so one sample serves
 * the whole select with no catalogue entry per language - and a voice counting
 * to three is enough to judge it by.
 */
const VOICE_SAMPLE = "1, 2, 3";

/**
 * The voice select for the pair's source language (D83): the device's voices
 * able to read it, behind a first line that means "let the browser pick".
 * Redrawn whenever the config may have moved - the pair decides the filter -
 * and when the engine's list arrives: `getVoices` answers nothing until the
 * browser has loaded the voices, and `voiceschanged` is the only appointment
 * it keeps. On a device that cannot speak at all the row stays, disabled -
 * an honest sentence about why the bubble shows no speaker there.
 */
function renderVoice() {
  const select = document.getElementById("tts-voice");
  if (!(select instanceof HTMLSelectElement)) return;

  // The picker chooses a voice for the pair's source language, so with no
  // pair chosen there is no language to list voices for: the row stands
  // disabled on the browser default - the "cannot speak at all" manner - and
  // comes alive with the first pair.
  const source = config.sourceLang;
  const stored = source === null ? undefined : config.ttsVoices[source];
  const voices =
    canSpeak() && source !== null ? voicesFor(speechSynthesis.getVoices(), source) : [];

  select.replaceChildren();
  const fallback = document.createElement("option");
  fallback.value = "";
  fallback.textContent = t("options_tts_default");
  select.append(fallback);

  for (const voice of voices) {
    const option = document.createElement("option");
    option.value = voice.voiceURI;
    // The voice's own name plus its tag: two voices called "English" differ
    // by exactly the en-US / en-GB the name alone would hide.
    option.textContent = `${voice.name} (${voice.lang})`;
    option.selected = voice.voiceURI === stored;
    select.append(option);
  }

  select.disabled = !canSpeak();
  const listen = document.getElementById("tts-listen");
  if (listen instanceof HTMLButtonElement) listen.disabled = !canSpeak();
}

/**
 * The reading-speed stepper (D87), shown as the factor it means rather than
 * the percent it is stored as: `1.2x` is how every player says this, and the
 * percent is an implementation detail of the config. The reader's own panel
 * has the same two buttons over the same setting - this is where somebody who
 * only ever uses the bubble's speaker finds it.
 */
function renderRate() {
  const value = document.getElementById("tts-rate-value");
  if (value !== null) value.textContent = `${(config.ttsRate / 100).toFixed(1)}×`;
}

/**
 * @param {number} by
 */
async function stepRate(by) {
  const current = (await readConfig()).ttsRate;
  config = await writeConfig({ ttsRate: current + by });
  renderRate();
}

/**
 * @param {string} id
 * @param {string} value
 */
function fill(id, value) {
  const element = document.getElementById(id);
  if (element !== null) element.textContent = value;
}

/**
 * The storage row: how much the browser holds for this extension and whether
 * it has promised to keep it. Persistence is asked for here as well as at the
 * background's start, so a settings page opened right after installing
 * answers with the promise rather than with the state before anyone asked.
 * On WebKit the answer doubles as a diagnosis, and the note under the size
 * says what it means (`lib/storage-report.js`); an engine that will not say
 * leaves the line blank rather than guessing.
 */
async function renderStorage() {
  await ensurePersistent();
  const report = await readStorage();
  fill("storage-usage", report.usage === null ? "" : t("options_storage_value", megabytes(report.usage)));
  const note = document.getElementById("storage-note");
  if (note === null) return;
  const kind = persistenceNote({ persisted: report.persisted, webkit: isWebKit() });
  note.hidden = kind === null;
  note.textContent =
    kind === "granted" ? t("options_storage_persistent") : kind === "at-risk" ? t("options_storage_at_risk") : "";

  // The copy of the vocabulary that outlives the database: its size and its
  // date, in the reader's own calendar - or that there is none yet.
  /** @param {number} at */
  const when = (at) => new Date(at).toLocaleString(uiLocale(), { dateStyle: "short", timeStyle: "short" });
  const copy = await readBackupSummary();
  fill(
    "storage-backup",
    copy === null
      ? t("options_storage_backup_none")
      : plural(copy.count, "options_storage_backup", [when(copy.writtenAt)]),
  );
  // The highlights' copy beside it (`marks-backup.js`) - the other thing
  // nobody could type in again.
  const marks = await readMarksBackup();
  fill(
    "storage-marks-backup",
    marks === null
      ? t("options_storage_marks_backup_none")
      : plural(marksInBackup(marks), "options_storage_marks_backup", [when(marks.writtenAt)]),
  );
  // The reading list's copy (`library-copy.js`): off by the switch, none
  // yet, or how many documents it holds and what they take - completed
  // first, so a reading list saved before the copy was on by default (D146)
  // is counted here rather than promised for the next save.
  await completeLibraryCopy();
  const library = effectiveLibraryCopy(config) ? await readLibraryCopy() : "off";
  fill(
    "storage-library-copy",
    library === "off"
      ? t("options_storage_library_copy_off")
      : library === null
        ? t("options_storage_library_copy_none")
        : plural(library.docs, "options_storage_library_copy", [megabytes(library.bytes)]),
  );
}

/**
 * Two places report, because there are two things to report about and they are
 * a screen apart. A download starts at the list of models, so that is where it
 * has to say how it went - a sentence about a failed download printed below the
 * file picker is a sentence nobody scrolls to.
 *
 * @param {"model-status" | "refresh-status" | "file-status" | "dictionary-status" | "dictionary-file-status" | "dictionary-refresh-status"} id
 * @param {string} text
 * @param {"idle" | "busy" | "error"} [tone]
 */
function say(id, text, tone = "idle") {
  const element = document.getElementById(id);
  if (element === null) return;
  element.textContent = text;
  element.dataset["tone"] = tone;
}

/**
 * @param {string} text
 * @param {"idle" | "busy" | "error"} [tone]
 */
function status(text, tone = "idle") {
  say("model-status", text, tone);
}

/**
 * The update button's own line, above the list: what a press of it did has to
 * be said next to it, not below a frame of a hundred rows.
 *
 * @param {string} text
 * @param {"idle" | "busy" | "error"} [tone]
 */
function refreshStatus(text, tone = "idle") {
  say("refresh-status", text, tone);
}

/**
 * @param {string} text
 * @param {"idle" | "busy" | "error"} [tone]
 */
function fileStatus(text, tone = "idle") {
  say("file-status", text, tone);
}

/**
 * @param {string} tag
 * @param {string} className empty for an element the stylesheet reaches by context
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function element(tag, className, text) {
  const created = document.createElement(tag);
  if (className.length > 0) created.className = className;
  // Every string on this page is ours, but `textContent` is the habit the rest
  // of the extension keeps, and habits are what hold when the strings change.
  if (text !== undefined) created.textContent = text;
  return created;
}

/**
 * The one dangerous button of a row, asking with a second press: "Delete",
 * then "Sure?" in the same spot - the reading list's pattern, brought here
 * because the cost of a slip is re-downloading tens of megabytes. Arming is
 * only ever one button deep across the whole page, and a press elsewhere,
 * focus moving on or Escape stands the armed one down (the listeners at the
 * bottom of this file) - deliberately no timer, because a button that changes
 * back by itself under a slow finger is how the wrong thing gets deleted.
 *
 * @param {{ name: string, restAria: string, disabled: boolean, onConfirm: (button: HTMLButtonElement) => void }} spec
 *   `name` is what the aria labels quote; `restAria` the label at rest.
 * @returns {HTMLButtonElement}
 */
function deleteButton({ name, restAria, disabled, onConfirm }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "model-delete";
  button.textContent = t("action_delete");
  button.disabled = disabled;
  button.dataset["name"] = name;
  button.dataset["restAria"] = restAria;
  button.setAttribute("aria-label", restAria);
  button.addEventListener("click", () => {
    if (button.hasAttribute("data-armed")) onConfirm(button);
    else armDelete(button);
  });
  return button;
}

/**
 * @returns {HTMLButtonElement | null}
 */
function armedDelete() {
  const armed = document.querySelector("button.model-delete[data-armed]");
  return armed instanceof HTMLButtonElement ? armed : null;
}

function disarmDelete() {
  const armed = armedDelete();
  if (armed === null) return;
  armed.removeAttribute("data-armed");
  armed.textContent = t("action_delete");
  armed.setAttribute("aria-label", armed.dataset["restAria"] ?? "");
}

/**
 * @param {HTMLButtonElement} button
 */
function armDelete(button) {
  disarmDelete();
  button.setAttribute("data-armed", "");
  button.textContent = t("options_delete_confirm");
  button.setAttribute("aria-label", t("options_delete_confirm_aria", button.dataset["name"] ?? ""));
}

/**
 * @param {string} containerId
 * @returns {HTMLButtonElement[]}
 */
function deleteButtonsIn(containerId) {
  const container = document.getElementById(containerId);
  if (container === null) return [];
  /** @type {HTMLButtonElement[]} */
  const buttons = [];
  for (const one of container.querySelectorAll("button.model-delete")) {
    if (one instanceof HTMLButtonElement) buttons.push(one);
  }
  return buttons;
}

/**
 * After a delete the redraw took the pressed button with it; focus must not
 * fall to the body. The place the button held, counted before the delete,
 * names the successor - the next row's Delete, the previous one's after the
 * last, the section's filter once none are left.
 *
 * @param {string} containerId
 * @param {string} filterId
 * @param {number} at
 */
function focusDeleteIn(containerId, filterId, at) {
  const deletes = deleteButtonsIn(containerId);
  const successor = deletes[Math.min(at, deletes.length - 1)];
  if (successor !== undefined) successor.focus();
  else document.getElementById(filterId)?.focus();
}

/**
 * One row of the model list, always the same three cells - name, sizes,
 * actions - so the stylesheet can lay a phone and a desktop out from the one
 * DOM: one line on a desktop, the name over a right-aligned second line on a
 * phone.
 *
 * @param {import("../lib/models/registry.js").ModelRow} row
 * @returns {HTMLElement}
 */
function renderRow(row) {
  const container = element("div", "model");
  const name = element("span", "model-name", pairLabel(row.from, row.to));
  if (row.from === config.sourceLang && row.to === config.targetLang) {
    name.append(element("span", "badge", t("options_badge_reading")));
  }
  const meta = element("span", "model-meta");
  const act = element("span", "model-act");
  container.append(name, meta, act);

  if (row.installed !== null) {
    meta.append(element("span", "", t("options_size_here", megabytes(row.installed.bytes))));

    // The list names a different training run than the one this device holds:
    // one press replaces the model in place. A model with no recorded source -
    // added from files, or stored before sources were recorded - gets an
    // honest "version unknown" instead of a claim nobody can back.
    const fresher = row.available;
    if (fresher !== null && updateAvailable(row.installed, fresher)) {
      const update = document.createElement("button");
      update.type = "button";
      update.textContent = t("action_update");
      update.disabled = running !== null;
      update.addEventListener("click", () => void download(row, fresher));
      act.append(update);
    } else if (fresher !== null && row.installed.sourceUrl === undefined) {
      meta.append(element("span", "", t("options_version_unknown")));
    }

    act.append(
      deleteButton({
        name: pairLabel(row.from, row.to),
        restAria: t("options_delete_model_aria", pairLabel(row.from, row.to)),
        disabled: running !== null,
        onConfirm: (button) => void removeModel(row, button),
      }),
    );
    return container;
  }

  const available = row.available;
  if (available === null) return container;

  // The size alone: the button beside it already says what pressing it does,
  // and "to download" was the first thing to overflow a phone-wide row. An
  // entry off the live index knows only what unpacks, and sometimes nothing.
  const size = available.downloadBytes > 0 ? available.downloadBytes : available.bytes;
  if (size > 0) meta.append(element("span", "", megabytes(size)));

  const start = document.createElement("button");
  start.type = "button";
  start.textContent = t("action_download");
  start.disabled = running !== null;
  start.addEventListener("click", () => void download(row, available));
  act.append(start);
  return container;
}

/**
 * Swaps a row into the shape it keeps while downloading, and answers with the
 * function that moves its progress along. Built once rather than re-rendered
 * per chunk: a progress bar that is replaced fifty times a second is a progress
 * bar that flickers and loses the button next to it mid-click.
 *
 * @param {HTMLElement} container
 * @param {import("../lib/models/registry.js").RegistryModel} model
 * @param {AbortController} controller
 * @returns {(progress: import("../lib/models/download.js").DownloadProgress) => void}
 */
function renderDownloading(container, model, controller) {
  container.replaceChildren();
  container.append(element("span", "model-name", pairLabel(model.from, model.to)));

  // An entry off the live index may not say what crosses the wire; the bar
  // then runs without an end and the text counts what has arrived, the way a
  // dictionary download already does.
  const known = model.downloadBytes > 0;

  const bar = document.createElement("progress");
  bar.className = "model-progress";
  if (known) {
    bar.max = model.downloadBytes;
    bar.value = 0;
  }

  const size = element(
    "span",
    "",
    known ? t("options_progress_of", [megabytes(0), megabytes(model.downloadBytes)]) : megabytes(0),
  );

  const meta = element("span", "model-meta");
  meta.append(bar, size);

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = t("action_cancel");
  cancel.addEventListener("click", () => {
    cancel.disabled = true;
    controller.abort();
  });

  const act = element("span", "model-act");
  act.append(cancel);

  container.append(meta, act);

  let shown = "";
  return ({ received, total }) => {
    if (known) {
      bar.max = total;
      bar.value = received;
    }
    // Progress arrives a couple of thousand times over a download and the text
    // only changes every hundred kilobytes of it. Rewriting it anyway would be
    // a thousand pointless relayouts during the one operation that should feel
    // smooth.
    const text = known ? t("options_progress_of", [megabytes(received), megabytes(total)]) : megabytes(received);
    if (text !== shown) {
      shown = text;
      size.textContent = text;
    }
  };
}

/**
 * The confirmed second press of a row's Delete.
 *
 * @param {import("../lib/models/registry.js").ModelRow} row
 * @param {HTMLButtonElement} button
 */
async function removeModel(row, button) {
  if (running !== null) return;
  const at = deleteButtonsIn("models").indexOf(button);
  await deleteModel(row.pair);
  status(t("options_deleted_model", pairLabel(row.from, row.to)));
  await renderModels();
  focusDeleteIn("models", "model-filter", at);
}

/**
 * The first model on the device brings its pair with it: a fresh install has
 * nothing meaningful in the pair select yet, and whoever just fetched en->pl
 * plainly means to read it. Later models change nothing - by then the select
 * holds a real choice, already made. Called with the store already holding
 * the new model, from both roads a model arrives by (download and files).
 *
 * @param {string} from
 * @param {string} to
 */
async function adoptFirstPair(from, to) {
  const stored = await listModels();
  if (stored.length !== 1) return;
  if (config.sourceLang === from && config.targetLang === to) return;
  config = await writeConfig({ sourceLang: from, targetLang: to });
}

/**
 * @param {import("../lib/models/registry.js").ModelRow} row
 * @param {import("../lib/models/registry.js").RegistryModel} model
 */
async function download(row, model) {
  // Not while a dictionary is being imported either: both hold a file in memory
  // from end to end, and the two of them at once is twice the memory for no gain.
  if (running !== null || importing) return;

  const controller = new AbortController();
  running = { pair: row.pair, controller };
  const letGo = holdScreen();

  // Redrawn with the download already claimed, which is what greys out every
  // other button on the page; then this one row becomes a progress bar.
  await renderModels();
  const container = document.getElementById(`model-${row.pair}`);
  const onProgress = container === null ? undefined : renderDownloading(container, model, controller);
  status(t("options_downloading_model", [pairLabel(model.from, model.to), megabytes(model.downloadBytes)]), "busy");

  const result = await downloadModel(model, { signal: controller.signal, onProgress });

  if (!result.ok) {
    running = null;
    letGo();
    status(describeDownloadProblem(result.problem, result.detail), result.problem === "cancelled" ? "idle" : "error");
    await renderModels();
    return;
  }

  // The last rung of the ladder: only the engine can say these bytes are a
  // model. Still holding the download claim, because the trial load is part
  // of the one expensive job - and nothing is stored until it says yes.
  status(t("options_checking_model", pairLabel(model.from, model.to)), "busy");
  const verdict = await testLoadModel({ from: model.from, to: model.to }, result.value);
  running = null;
  letGo();

  if (!verdict.ok) {
    status(t("options_model_rejected", aside(verdict.detail)), "error");
    await renderModels();
    return;
  }

  try {
    const source = modelSourceUrl(model);
    const meta = await putModel(result.value, {
      from: model.from,
      to: model.to,
      ...(source === null ? {} : { sourceUrl: source }),
    });
    status(t("options_downloaded_model", [pairLabel(model.from, model.to), megabytes(meta.bytes)]));
    await adoptFirstPair(model.from, model.to);
  } catch (error) {
    // The download was fine; the browser would not keep it. Worth saying apart
    // from a failed download, because the answer is different - space, or a
    // second copy of this page holding the database open.
    status(t("options_store_failed", message(error)), "error");
  }

  await renderModels();
}

/**
 * The pair being read, and the only place it can be changed.
 *
 * The choices are the pairs that can actually translate: the models on this
 * device (see `pairChoices` for the rules, the configured-but-deleted edge
 * included). With nothing installed the select explains itself with one
 * disabled line - the note under it points at the models section either way,
 * and downloading the first model sets the pair by itself.
 *
 * @param {import("../lib/models/registry.js").ModelRow[]} rows
 */
function renderPair(rows) {
  const select = document.getElementById("pair");
  if (!(select instanceof HTMLSelectElement)) return;

  const choices = pairChoices(rows, config);
  select.replaceChildren();
  select.disabled = choices.length === 0;

  if (choices.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = t("options_pair_none");
    option.selected = true;
    select.append(option);
    return;
  }

  for (const row of choices) {
    const option = document.createElement("option");
    option.value = row.pair;
    option.textContent = pairLabel(row.from, row.to);
    option.selected = row.from === config.sourceLang && row.to === config.targetLang;
    select.append(option);
  }
}

/**
 * @param {string} pair
 */
async function choosePair(pair) {
  const rows = modelRows(await listModels(), availableModels());
  const row = rows.find((candidate) => candidate.pair === pair);
  if (row === undefined) return;

  config = await writeConfig({ sourceLang: row.from, targetLang: row.to });
  // Every open page notices through `storage.onChanged` and asks the background
  // for the vocabulary of the new pair, so nothing here has to tell them.
  await renderModels();
  await renderCatalog();
  status(
    row.installed === null
      ? t("options_reading_pair_missing", [languageName(row.from), languageName(row.to)])
      : t("options_reading_pair", [languageName(row.from), languageName(row.to)]),
  );
}

/**
 * Decides which rows of a list stand on screen: the installed ones, until
 * "Show all" unfolds the rest or the filter box asks for something (the rules
 * live in `rowVisible`). Called on every keystroke, after every re-render and
 * at every press of "Show all", because a render builds all rows and knows
 * nothing of the fold or the filter - visibility is a separate, cheaper pass
 * over what is already there. Two lists work this way (models and the
 * dictionary catalogue), each with its own box, fold and button, which is why
 * everything travels as arguments.
 *
 * @param {string} containerId
 * @param {string} inputId
 * @param {string} noneId
 * @param {string} showAllId
 * @param {boolean} expanded
 */
function applyFilterIn(containerId, inputId, noneId, showAllId, expanded) {
  const container = document.getElementById(containerId);
  if (container === null) return;

  const input = document.getElementById(inputId);
  const query = input instanceof HTMLInputElement ? input.value : "";

  let visible = 0;
  let total = 0;
  let installedCount = 0;
  for (const row of container.querySelectorAll(".model")) {
    if (!(row instanceof HTMLElement)) continue;
    total += 1;
    const installed = row.dataset["installed"] === "true";
    if (installed) installedCount += 1;
    const matches = matchesFilter(row.dataset["search"] ?? "", query);
    const shown = rowVisible({ installed, matches, expanded, query });
    row.hidden = !shown;
    if (shown) visible += 1;
  }

  // "The filter matched nothing" is only true of a filter: a folded list
  // showing none of its rows is answered by "Show all" below, not by this.
  const none = document.getElementById(noneId);
  if (none !== null) none.hidden = !filterActive(query) || visible > 0;

  const showAll = document.getElementById(showAllId);
  if (showAll instanceof HTMLButtonElement) {
    const state = showAllState({ total, installedCount, expanded, query });
    showAll.hidden = !state.shown;
    showAll.textContent = t("options_show_all", state.count.toLocaleString());
  }
}

function applyModelFilter() {
  applyFilterIn("models", "model-filter", "model-none", "models-show-all", modelsExpanded);
}

function applyCatalogFilter() {
  applyFilterIn("dictionary-catalog", "dictionary-filter", "dictionary-none", "dictionaries-show-all", dictionariesExpanded);
}

/**
 * The press that unfolds a list past its installed rows. The button dissolves
 * under the pointer, so focus is walked to the first row it revealed - the
 * same place the eye went.
 *
 * @param {"models" | "dictionary-catalog"} containerId
 */
function expandList(containerId) {
  if (containerId === "models") {
    modelsExpanded = true;
    applyModelFilter();
  } else {
    dictionariesExpanded = true;
    applyCatalogFilter();
  }
  const first = document.querySelector(`#${containerId} .model[data-installed="false"] button`);
  if (first instanceof HTMLElement) first.focus();
}

async function renderModels() {
  const container = document.getElementById("models");
  if (container === null) return;

  const stored = await listModels();
  const rows = orderForDisplay(modelRows(stored, availableModels()), config);

  // The select's choices ride the same read: a download or a delete lands in
  // the select at the very render that shows it in the list, with no reload.
  renderPair(rows);

  // The model half of the first-steps verdict, from the store itself rather
  // than the view rows - the rows answer "what to draw", not "what is here".
  modelStored = stored.length > 0;
  renderFirstSteps();

  container.replaceChildren();

  if (rows.length === 0) {
    container.append(element("p", "empty", t("options_no_models")));
  } else {
    for (const row of rows) {
      const rendered = renderRow(row);
      rendered.id = `model-${row.pair}`;
      rendered.dataset["search"] = searchableText(row);
      rendered.dataset["installed"] = String(row.installed !== null);
      container.append(rendered);
    }

    // Lives inside the list so that "the filter matched nothing" is said
    // where the missing rows would have been, not somewhere below them.
    const none = element("p", "empty", t("options_filter_no_match_models"));
    none.id = "model-none";
    none.hidden = true;
    container.append(none);
  }

  applyModelFilter();
}

/**
 * The sites the popup's switch has turned re/read off on. Listed here because
 * the popup can only switch the site somebody is standing on - cleaning the
 * list up must not require visiting every site on it.
 */
function renderDisabledHosts() {
  const container = document.getElementById("disabled-hosts");
  if (container === null) return;
  container.replaceChildren();

  if (config.disabledHosts.length === 0) {
    container.append(element("p", "empty", t("options_no_disabled")));
    return;
  }

  for (const host of config.disabledHosts) {
    const row = element("div", "model");
    row.append(element("span", "model-name", host));

    const restore = document.createElement("button");
    restore.type = "button";
    restore.textContent = t("options_turn_back_on");
    restore.addEventListener("click", () => void restoreHost(host));
    const act = element("span", "model-act");
    act.append(restore);
    row.append(act);
    container.append(row);
  }
}

/**
 * @param {string} host
 */
async function restoreHost(host) {
  // Read fresh before writing, because the popup writes the same list: the
  // write must lose exactly this entry, not whatever this page last saw.
  const current = await readConfig();
  config = await writeConfig({ disabledHosts: current.disabledHosts.filter((one) => one !== host) });
  renderDisabledHosts();
  // Open tabs of that site notice the same write and start on the spot -
  // nothing here has to find them, which is good, because nothing here could.
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function message(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Model files are published gzipped, and a reader who downloaded them should
 * not have to know that.
 *
 * @param {ArrayBuffer} buffer
 * @returns {Promise<ArrayBuffer>}
 */
async function gunzipIfNeeded(buffer) {
  if (!isGzip(buffer)) return buffer;
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).arrayBuffer();
}

async function addSelectedModel() {
  const input = /** @type {HTMLInputElement | null} */ (document.getElementById("model-files"));
  const chosen = [...(input?.files ?? [])];

  const classified = classifyModelFiles(chosen.map((file) => file.name));
  if (!classified.ok) {
    fileStatus(describeClassifyProblem(classified.problem, classified.detail), "error");
    return;
  }

  const { pair, from, to, byRole } = classified.value;
  fileStatus(t("options_reading_model_files", pairLabel(from, to)), "busy");

  try {
    /** @param {string} name */
    const read = async (name) => {
      const file = chosen.find((candidate) => candidate.name === name);
      if (file === undefined) throw new Error(t("options_file_disappeared", name));
      return gunzipIfNeeded(await file.arrayBuffer());
    };

    const [model, shortlist] = await Promise.all([read(byRole.model[0] ?? ""), read(byRole.shortlist[0] ?? "")]);
    const vocabs = await Promise.all(byRole.vocab.map(read));

    // The same gate a download passes: only the engine can say these files
    // are a model, and files picked by hand are the likelier ones to not be.
    fileStatus(t("options_checking_model", pairLabel(from, to)), "busy");
    const verdict = await testLoadModel({ from, to }, { pair, model, shortlist, vocabs });
    if (!verdict.ok) {
      fileStatus(t("options_model_rejected", aside(verdict.detail)), "error");
      return;
    }

    const meta = await putModel({ pair, model, shortlist, vocabs }, { from, to });
    if (input !== null) input.value = "";
    fileStatus(t("options_added_model", [pairLabel(from, to), megabytes(meta.bytes)]));
    await adoptFirstPair(from, to);
    await renderModels();
  } catch (error) {
    fileStatus(t("options_add_model_failed", message(error)), "error");
  }
}

/** Imports, like downloads, happen one at a time. @type {boolean} */
let importing = false;

/**
 * The dictionary being deleted right now, while it still has a row to show it
 * on. A large dictionary takes the database tens of seconds to let go of, and
 * a row that just sits there after the press looks like a press that did
 * nothing - and like a page safe to leave.
 *
 * @type {string | null}
 */
let deletingId = null;

/**
 * The screen, kept on while an import or a download runs.
 *
 * A dictionary of a million words takes a quarter of an hour to write on a
 * tablet, and a tablet whose screen has gone dark is a tablet whose apps
 * Android feels free to kill - which ends the import and throws away every row
 * written so far. The Screen Wake Lock API asks the system not to let the
 * screen time out. The browser drops the lock by itself whenever the page is
 * hidden, so it is asked for again each time the page comes back into view;
 * where the API is missing or refuses, nothing changes - the work runs exactly
 * the same, and the screen follows its own timeout.
 */
const wake = {
  /** whether some work wants the screen on right now */
  held: false,
  /** a request in flight, so two visibility changes do not take two locks */
  requesting: false,
  /** @type {WakeLockSentinel | null} */
  lock: null,
};

async function keepScreenOn() {
  if (!wake.held || wake.requesting || wake.lock !== null) return;
  if (document.visibilityState !== "visible" || !("wakeLock" in navigator)) return;

  wake.requesting = true;
  try {
    const lock = await navigator.wakeLock.request("screen");
    if (!wake.held) {
      await lock.release();
      return;
    }
    wake.lock = lock;
    lock.addEventListener("release", () => {
      if (wake.lock === lock) wake.lock = null;
    });
  } catch {
    // Not allowed on this page or not supported here: the import does not
    // depend on it, so there is nothing to say.
  } finally {
    wake.requesting = false;
  }
}

/**
 * @returns {() => void} what to call when the work is done
 */
function holdScreen() {
  wake.held = true;
  document.addEventListener("visibilitychange", keepScreenOn);
  void keepScreenOn();

  return () => {
    wake.held = false;
    document.removeEventListener("visibilitychange", keepScreenOn);
    void wake.lock?.release();
    wake.lock = null;
  };
}

/**
 * @param {string} text
 * @param {"idle" | "busy" | "error"} [tone]
 */
function dictionaryStatus(text, tone = "idle") {
  say("dictionary-status", text, tone);
}

/**
 * @param {string} text
 * @param {"idle" | "busy" | "error"} [tone]
 */
function dictionaryFileStatus(text, tone = "idle") {
  say("dictionary-file-status", text, tone);
}

/**
 * The dictionary update button's own line, for the same reason the model
 * one has its own: what a press did has to be said next to the button.
 *
 * @param {string} text
 * @param {"idle" | "busy" | "error"} [tone]
 */
function dictionaryRefreshStatus(text, tone = "idle") {
  say("dictionary-refresh-status", text, tone);
}

/**
 * @param {number} count
 * @returns {string}
 */
function words(count) {
  return plural(count, "words");
}

/**
 * The languages this build has a name for: whatever the model registry knows,
 * plus whatever is configured. Not a list of the world's languages - a
 * dictionary is only useful here for a language something can be read in.
 *
 * @returns {string[]}
 */
function knownLanguages() {
  /** @type {Set<string>} */
  const languages = new Set();
  if (config.sourceLang !== null) languages.add(config.sourceLang);
  if (config.targetLang !== null) languages.add(config.targetLang);
  for (const model of availableModels()) {
    languages.add(model.from);
    languages.add(model.to);
  }
  // By the name on screen, not the code behind it: the select shows "Basque",
  // and nobody looks for Basque under e.
  return [...languages].sort((a, b) => languageName(a).localeCompare(languageName(b)));
}

/**
 * @param {string} id
 * @param {string} selected
 */
function renderLanguageChoices(id, selected) {
  const select = document.getElementById(id);
  if (!(select instanceof HTMLSelectElement)) return;
  if (select.options.length > 0) return;

  for (const language of knownLanguages()) {
    const option = document.createElement("option");
    option.value = language;
    option.textContent = languageName(language);
    option.selected = language === selected;
    select.append(option);
  }
}

/**
 * @param {string} id
 * @param {string} fallback what the settings say, when the page has no answer
 * @returns {string}
 */
function chosenLanguage(id, fallback) {
  const select = document.getElementById(id);
  const chosen = select instanceof HTMLSelectElement ? select.value : "";
  // A dictionary stored under an empty language is a dictionary no lookup will
  // ever match, so anything is better than nothing here.
  return chosen.length > 0 ? chosen : fallback;
}

/**
 * One arrow of a stored dictionary's row.
 *
 * Two buttons rather than a drag: this page is read on a phone, on e-ink and
 * with a keyboard, and a list that can only be arranged by dragging cannot be
 * arranged on any of the three. The arrow is the whole label - "up" is not a
 * word that needs translating on a button this size - and the sentence naming
 * which dictionary moves rides in the accessible name, where a screen reader
 * reads it and a pointer finds it as a tooltip.
 *
 * @param {import("../lib/dict/store.js").Dictionary} dictionary
 * @param {-1 | 1} step
 * @param {boolean} enabled false at the end of the list it points towards
 * @returns {HTMLButtonElement}
 */
function moveButton(dictionary, step, enabled) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "model-move";
  button.textContent = step < 0 ? "↑" : "↓";
  button.disabled = !enabled || importing;
  // What the redraw after a move finds this button by - the row it belonged to
  // is gone by then, so the dictionary and the direction are the address.
  button.dataset["move"] = dictionary.id;
  button.dataset["step"] = String(step);

  const label =
    step < 0
      ? t("options_move_dictionary_up_aria", dictionary.name)
      : t("options_move_dictionary_down_aria", dictionary.name);
  button.setAttribute("aria-label", label);
  button.title = label;

  button.addEventListener("click", () => void moveDictionary(dictionary, step));
  return button;
}

/**
 * A stored dictionary's row - the same three cells a stored model gets, plus
 * what only a dictionary carries: its own name under the pair (two
 * dictionaries of one pair must be told apart), the arrows that move it up and
 * down the answering order, and its attribution, folded.
 *
 * @param {import("../lib/dict/store.js").Dictionary} dictionary
 * @param {{ at: number, total: number }} place among the stored dictionaries
 * @returns {HTMLElement}
 */
function renderDictionary(dictionary, place) {
  const container = element("div", "model");

  const name = element("span", "model-name", pairLabel(dictionary.langFrom, dictionary.langTo));
  if (dictionary.langFrom === config.sourceLang && dictionary.langTo === config.targetLang) {
    name.append(element("span", "badge", t("options_badge_reading")));
  }
  name.append(element("span", "dictionary-title", dictionary.name));
  container.append(name);

  if (dictionary.id === deletingId) {
    // Going: the counts give way to the one word that says so, and the
    // buttons go with them - there is nothing left to press on this row.
    const meta = element("span", "model-meta");
    meta.append(element("span", "", t("options_deleting_row")));
    container.append(meta);
    return container;
  }

  if (!dictionary.ready) {
    renderUnfinished(container, dictionary);
    return container;
  }

  const counted =
    dictionary.aliasCount > 0
      ? `${words(dictionary.entryCount)}, ${plural(dictionary.aliasCount, "spellings")}`
      : words(dictionary.entryCount);
  const meta = element("span", "model-meta");
  meta.append(element("span", "", counted));
  meta.append(element("span", "", megabytes(dictionary.bytes)));
  container.append(meta);

  const act = element("span", "model-act");
  // Only where there is something to arrange: one dictionary answers first
  // whatever the arrows say, and two dead buttons on its row would be a
  // control that does nothing standing next to one that deletes.
  if (place.total > 1) {
    act.append(moveButton(dictionary, -1, place.at > 0));
    act.append(moveButton(dictionary, 1, place.at < place.total - 1));
  }
  act.append(
    deleteButton({
      name: dictionary.name,
      restAria: t("options_delete_dictionary_aria", dictionary.name),
      disabled: importing,
      onConfirm: (button) => void removeDictionary(dictionary, button),
    }),
  );
  container.append(act);

  // Attribution is why this fold is here at all: the dictionaries worth having
  // are Wiktionary-derived and CC BY-SA, and naming their source is the whole
  // of what that asks for. Folded, not gone - the row stays scannable and the
  // credit stays, one press away, exactly as the dictionary wrote it.
  if (dictionary.credit !== null) {
    const about = element("details", "model-about");
    about.append(element("summary", "", t("options_about_dictionary")));
    about.append(element("p", "dictionary-credit", dictionary.credit));
    container.append(about);
  }

  return container;
}

/**
 * The rest of the row of a dictionary whose import stopped halfway (D137).
 *
 * Where a finished row counts its words, this one says how far it got, and
 * where the arrows would be there is Continue: the rows already written are
 * in the database, the files are kept beside them, and pressing it picks the
 * import up from its last batch. Delete is the other way out. Both wait
 * while an import runs - on this page, or, for as long as the lock is held,
 * on another.
 *
 * @param {HTMLElement} container
 * @param {import("../lib/dict/store.js").Dictionary} dictionary
 */
function renderUnfinished(container, dictionary) {
  const progress = dictionary.progress;
  const standing = importElsewhere
    ? t("options_import_elsewhere")
    : progress === undefined
      ? t("options_import_interrupted_early")
      : t("options_import_interrupted", [progress.done.toLocaleString(), progress.total.toLocaleString()]);
  const meta = element("span", "model-meta");
  meta.append(element("span", "", standing));
  container.append(meta);

  const act = element("span", "model-act");
  const go = document.createElement("button");
  go.type = "button";
  go.textContent = t("options_continue_import");
  go.setAttribute("aria-label", t("options_continue_import_aria", dictionary.name));
  go.disabled = importing || importElsewhere;
  go.addEventListener("click", () => void resumeImport(dictionary));
  act.append(go);
  act.append(
    deleteButton({
      name: dictionary.name,
      restAria: t("options_delete_dictionary_aria", dictionary.name),
      disabled: importing || importElsewhere,
      onConfirm: (button) => void removeDictionary(dictionary, button),
    }),
  );
  container.append(act);
}

/**
 * The arrow this dictionary wears for one direction, after the redraw that
 * replaced the one that was pressed.
 *
 * Walked rather than selected: an id goes into a `[data-move="..."]` selector
 * as text, and the day one carries a quote the selector is the bug rather than
 * the id.
 *
 * @param {string} id
 * @param {number} step
 * @returns {HTMLButtonElement | null}
 */
function moveButtonFor(id, step) {
  for (const button of document.querySelectorAll("#dictionary-catalog button.model-move")) {
    if (!(button instanceof HTMLButtonElement)) continue;
    if (button.dataset["move"] === id && button.dataset["step"] === String(step)) return button;
  }
  return null;
}

/**
 * Focus after a move, which took the pressed button with it.
 *
 * The same arrow of the same dictionary, so a second press keeps moving it -
 * unless that arrow is now the disabled one at the end of the list, where the
 * opposite arrow is what a hand that overshot reaches for. Neither found (the
 * row lost its arrows) leaves focus alone rather than sending it somewhere
 * surprising.
 *
 * @param {string} id
 * @param {number} step
 */
function focusMove(id, step) {
  const again = moveButtonFor(id, step);
  if (again !== null && !again.disabled) {
    again.focus();
    return;
  }
  const back = moveButtonFor(id, -step);
  if (back !== null && !back.disabled) back.focus();
}

/**
 * One press of an arrow: the neighbours swap, the database is renumbered, and
 * the list redraws in the order the bubble will now answer in.
 *
 * Said out loud afterwards, in the section's status line, because the row that
 * moved is the one place on screen where a screen reader cannot see what
 * happened - and because "third of three" is the answer to "did that do
 * anything" on a long page where the row may have moved out of sight.
 *
 * @param {import("../lib/dict/store.js").Dictionary} dictionary
 * @param {-1 | 1} step
 */
async function moveDictionary(dictionary, step) {
  // The same guard the delete keeps: an import is writing to this database,
  // and its dictionary is the one whose place would be rewritten underneath it.
  if (importing) return;

  const order = afterMove(dictionaryOrder, dictionary.id, step);
  if (order === null) return;

  try {
    await reorderDictionaries(order);
  } catch (error) {
    dictionaryStatus(t("options_reorder_failed", message(error)), "error");
    return;
  }

  await renderCatalog();

  // From the list the redraw just read, not from the list that was written: a
  // second page importing at that moment is part of the order now.
  const at = dictionaryOrder.indexOf(dictionary.id);
  if (at >= 0) {
    dictionaryStatus(
      t("options_dictionary_moved", [
        dictionary.name,
        (at + 1).toLocaleString(),
        dictionaryOrder.length.toLocaleString(),
      ]),
    );
  }
  focusMove(dictionary.id, step);
}

/**
 * The confirmed second press of a stored dictionary's Delete.
 *
 * @param {import("../lib/dict/store.js").Dictionary} dictionary
 * @param {HTMLButtonElement} button
 */
async function removeDictionary(dictionary, button) {
  if (importing) return;
  const at = deleteButtonsIn("dictionary-catalog").indexOf(button);

  // Held like an import, because it is the same thing to the database: one
  // writer at a time, the other buttons wait, a reload asks first. Said in
  // the status line and on the row itself before the first byte goes, since
  // for a million rows the delete is a transaction of tens of seconds on a
  // tablet with nothing to show for it until it commits.
  importing = true;
  deletingId = dictionary.id;
  const letGo = holdScreen();
  dictionaryStatus(t("options_deleting_dictionary", dictionary.name), "busy");
  await renderCatalog();

  try {
    await deleteDictionary(dictionary.id);
    dictionaryStatus(t("options_deleted_dictionary", dictionary.name));
  } catch (error) {
    dictionaryStatus(t("options_delete_dictionary_failed", [dictionary.name, message(error)]), "error");
  } finally {
    letGo();
    deletingId = null;
    importing = false;
  }
  await renderCatalog();
  focusDeleteIn("dictionary-catalog", "dictionary-filter", at);
}

/**
 * @param {import("../lib/dict/catalog.js").CatalogDictionary} entry
 * @returns {string}
 */
function catalogRowId(entry) {
  return `dictionary-${entry.from}-${entry.to}`;
}

/**
 * @param {import("../lib/dict/catalog.js").CatalogDictionary} entry
 * @returns {HTMLElement}
 */
function renderCatalogRow(entry) {
  const container = element("div", "model");
  container.append(element("span", "model-name", pairLabel(entry.from, entry.to)));

  const get = document.createElement("button");
  get.type = "button";
  get.textContent = t("action_download");
  get.disabled = running !== null || importing;
  get.addEventListener("click", () => void downloadDictionary(entry));
  const act = element("span", "model-act");
  act.append(get);
  container.append(act);
  return container;
}

/**
 * The one dictionary frame: what is stored first, each row with its delete
 * button, then every pair the catalogue offers - the same order the model
 * frame keeps. Redrawn at the edges of every download, import and delete, and
 * after a list refresh.
 */
async function renderCatalog() {
  const container = document.getElementById("dictionary-catalog");
  if (container === null) return;

  const stored = await listDictionaries();
  const rows = dictionaryRows(stored, availableDictionaries(), config);
  // Read once per redraw, for every unfinished row: whether its import is
  // running somewhere (then its buttons wait) or stopped (then it may go on).
  importElsewhere = !importing && (await importHeld());

  // What an arrow press moves within, and what the line above the list is
  // about - both read from the store, at the one moment the store was read.
  dictionaryOrder = stored.map((one) => one.id);
  const hint = document.getElementById("dictionary-order-hint");
  if (hint !== null) hint.hidden = stored.length < 2;

  // The dictionary half of the first-steps verdict. Ready ones only: a
  // half-imported dictionary answers no lookup, and must not fold the
  // instructions away.
  dictionaryStored = stored.some((one) => one.ready);
  renderFirstSteps();

  container.replaceChildren();

  if (rows.length === 0) {
    container.append(element("p", "empty", t("options_no_catalog")));
  } else {
    // Which place among the stored ones this row holds - the arrows need it,
    // and the rows arrive with the stored ones first, in their own order.
    let at = 0;
    for (const row of rows) {
      /** @type {HTMLElement} */
      let rendered;
      if (row.installed !== null) {
        rendered = renderDictionary(row.installed, { at, total: stored.length });
        at += 1;
        // Found by the pair either way it is spelled, and by the book's own name.
        rendered.dataset["search"] = `${searchableText(row)} ${row.installed.name.toLowerCase()}`;
      } else if (row.available !== null) {
        rendered = renderCatalogRow(row.available);
        rendered.id = catalogRowId(row.available);
        rendered.dataset["search"] = searchableText(row);
      } else {
        continue;
      }
      rendered.dataset["installed"] = String(row.installed !== null);
      container.append(rendered);
    }

    const none = element("p", "empty", t("options_filter_no_match_dictionaries"));
    none.id = "dictionary-none";
    none.hidden = true;
    container.append(none);
  }

  applyCatalogFilter();
}

/**
 * The catalogue row while its archive is on the wire. Unlike a model download
 * there may be no total to promise - the catalogue carries no sizes, so until
 * the server names one the bar runs without an end.
 *
 * @param {HTMLElement} container
 * @param {import("../lib/dict/catalog.js").CatalogDictionary} entry
 * @param {AbortController} controller
 * @returns {(progress: import("../lib/dict/download.js").DictDownloadProgress) => void}
 */
function renderFetching(container, entry, controller) {
  container.replaceChildren();
  container.append(element("span", "model-name", pairLabel(entry.from, entry.to)));

  const bar = document.createElement("progress");
  bar.className = "model-progress";

  const size = element("span", "", "");

  const meta = element("span", "model-meta");
  meta.append(bar, size);

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = t("action_cancel");
  cancel.addEventListener("click", () => {
    cancel.disabled = true;
    controller.abort();
  });

  const act = element("span", "model-act");
  act.append(cancel);

  container.append(meta, act);

  let shown = "";
  return ({ received, total }) => {
    if (total > 0) {
      bar.max = total;
      bar.value = received;
    }
    const text = total > 0 ? t("options_progress_of", [megabytes(received), megabytes(total)]) : megabytes(received);
    if (text !== shown) {
      shown = text;
      size.textContent = text;
    }
  };
}

/**
 * @param {import("../lib/dict/catalog.js").CatalogDictionary} entry
 */
async function downloadDictionary(entry) {
  if (running !== null || importing) return;

  // One flag for the whole journey - download, unzip, parse, store - because
  // the memory cost is the same as a file import's and the one-at-a-time rule
  // exists for memory, not ceremony.
  importing = true;
  const letGo = holdScreen();
  const controller = new AbortController();

  // Redrawn with the import already claimed, which greys out the other
  // buttons of the frame; then this one row becomes a progress bar.
  await renderCatalog();
  const container = document.getElementById(catalogRowId(entry));
  const onProgress = container === null ? undefined : renderFetching(container, entry, controller);
  const label = pairLabel(entry.from, entry.to);
  dictionaryStatus(t("options_downloading_dictionary", label), "busy");

  try {
    const fetched = await fetchDictionaryFiles(entry.url, controller.signal, onProgress);
    if (!fetched.ok) {
      dictionaryStatus(fetched.text, fetched.tone);
      return;
    }

    // The language sides come from the catalogue row, not from a select: a
    // WikDict archive is one direction, and its name already said which.
    const ran = await withImportLock(async () => {
      await storeDictionary(fetched.value.files, {
        base: fetched.value.base,
        langFrom: entry.from,
        langTo: entry.to,
        say: dictionaryStatus,
      });
    });
    if (!ran) dictionaryStatus(t("options_import_elsewhere"), "error");
  } finally {
    letGo();
    importing = false;
    await renderCatalog();
  }
}

/**
 * Downloads an archive and takes the files of one dictionary out of it.
 *
 * A function of its own so that what it returns is all that survives it: the
 * archive and the unpacked members it was cut from live in this frame, and
 * this frame is gone by the time the dictionary is being written. The caller's
 * frame lives for the whole import, and an archive held there would be an
 * archive held in memory for the whole import.
 *
 * @param {string} url
 * @param {AbortSignal} signal
 * @param {((progress: import("../lib/dict/download.js").DictDownloadProgress) => void) | undefined} onProgress
 * @returns {Promise<{ ok: true, value: { base: string, files: import("../lib/dict/import.js").DictionaryFiles } } | { ok: false, text: string, tone: "idle" | "error" }>}
 */
async function fetchDictionaryFiles(url, signal, onProgress) {
  const result = await downloadArchive(url, { signal, onProgress });
  if (!result.ok) {
    return {
      ok: false,
      text: describeDictDownloadProblem(result.problem, result.detail),
      tone: result.problem === "cancelled" ? "idle" : "error",
    };
  }

  const zip = await readZip(result.value);
  if (!zip.ok) return { ok: false, text: describeZipProblem(zip.problem, zip.detail), tone: "error" };

  const sorted = dictionaryFromZip(zip.value);
  if (!sorted.ok) {
    return { ok: false, text: describeImportProblem(sorted.problem, sorted.detail), tone: "error" };
  }

  return sorted;
}

/**
 * @returns {Promise<void>} a turn of the event loop, so the status line can paint
 */
function breathe() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * One import at a time across every page of this extension, not just this one.
 *
 * The settings page can be open twice, and since D137 an unfinished import is
 * a row with a Continue button on it: a second page pressing that while the
 * first is still writing would have two writers on one dictionary. A Web Lock
 * is held for the length of an import and released by the browser the moment
 * the page holding it is gone - killed, closed or navigated away - which is
 * exactly the distinction a resume needs: a lock still held means "being
 * added somewhere else", a lock free means "nobody is, go on". No permission,
 * no timer, nothing to go stale. Where the API is missing, imports run
 * unguarded, as they did before.
 */
const IMPORT_LOCK = "reread-dictionary-import";

/**
 * @param {() => Promise<void>} work
 * @returns {Promise<boolean>} false when another page holds the lock, and the work did not run
 */
async function withImportLock(work) {
  if (!("locks" in navigator)) {
    await work();
    return true;
  }
  return await navigator.locks.request(IMPORT_LOCK, { ifAvailable: true }, async (lock) => {
    if (lock === null) return false;
    await work();
    return true;
  });
}

/**
 * @returns {Promise<boolean>} whether some page - this one included - is importing right now
 */
async function importHeld() {
  if (!("locks" in navigator)) return false;
  const { held = [] } = await navigator.locks.query();
  return held.some((lock) => lock.name === IMPORT_LOCK);
}

/** What the last redraw of the dictionary frame found `importHeld` to be. */
let importElsewhere = false;

/**
 * @param {import("../lib/dict/import.js").FileSource} source
 * @returns {Blob} the same bytes as something the database stores as a file
 */
function blobOf(source) {
  if (source instanceof Blob) return source;
  // Nothing here is backed by shared memory; the narrower type is what a
  // Blob part has to be.
  return new Blob([/** @type {Uint8Array<ArrayBuffer> | ArrayBuffer} */ (source)]);
}

/**
 * The half of an import every source shares: files in, a dictionary in the
 * database or a sentence about why not. The file picker and the catalogue
 * differ only in where the files and the languages come from - and in which
 * status line they talk to, which is why `say` travels as an argument.
 *
 * The files are kept in the database before anything is read from them
 * (D137): an import on a small tablet can be killed at any moment, and what
 * it needs to go on is the files the page no longer has. The dictionary's row
 * exists from this moment as well, unready and with a provisional name - its
 * real one arrives with the first batch.
 *
 * @param {import("../lib/dict/import.js").DictionaryFiles} files
 * @param {{ base: string, langFrom: string, langTo: string, say: (text: string, tone?: "idle" | "busy" | "error") => void }} job
 * @returns {Promise<boolean>} whether a dictionary is now stored
 */
async function storeDictionary(files, { base, langFrom, langTo, say }) {
  /** @type {import("../lib/dict/store.js").Dictionary | null} */
  let dictionary = null;
  try {
    say(t("options_reading_file", base), "busy");
    dictionary = await beginImport({ name: base, langFrom, langTo, credit: null });
    await stageSources(dictionary.id, {
      ifo: blobOf(files.ifo),
      idx: blobOf(files.idx),
      dict: blobOf(files.dict),
      ...(files.syn === undefined ? {} : { syn: blobOf(files.syn) }),
    });

    const opened = await openDictionary(files, { fallbackName: base });
    if (!opened.ok) {
      await deleteDictionary(dictionary.id);
      say(describeImportProblem(opened.problem, opened.detail), "error");
      return false;
    }

    return await runImport(opened.value, dictionary, { say, progress: null });
  } catch (error) {
    // Whatever went wrong, the half-written dictionary is invisible and now
    // also gone, files and all: an import that failed with a sentence is not
    // one to offer going on with.
    if (dictionary !== null) await deleteDictionary(dictionary.id).catch(() => undefined);
    say(t("options_add_dictionary_failed", message(error)), "error");
    return false;
  }
}

/**
 * Picks an interrupted import up where its last batch stopped.
 *
 * The files come back out of the database, the dictionary is opened again,
 * and the batches resume from the progress its row carries (see `rowBatches`
 * on what is walked again and what is not). The row keeps its id, its place
 * in the order and the rows already written.
 *
 * @param {import("../lib/dict/store.js").Dictionary} dictionary
 */
async function resumeImport(dictionary) {
  if (importing || running !== null) return;

  importing = true;
  const letGo = holdScreen();
  await renderCatalog();

  try {
    const ran = await withImportLock(async () => {
      const sources = await readSources(dictionary.id);
      if (sources === null) {
        // The files went missing under it - the row is a leftover after all.
        await deleteDictionary(dictionary.id);
        dictionaryStatus(t("options_swept_unfinished", dictionary.name));
        return;
      }

      dictionaryStatus(t("options_reading_file", dictionary.name), "busy");
      const opened = await openDictionary(
        { ifo: sources.ifo, idx: sources.idx, dict: sources.dict, ...(sources.syn === undefined ? {} : { syn: sources.syn }) },
        { fallbackName: dictionary.name },
      );
      if (!opened.ok) {
        await deleteDictionary(dictionary.id);
        dictionaryStatus(describeImportProblem(opened.problem, opened.detail), "error");
        return;
      }

      // The row as the database has it now, not as the list drew it: the
      // progress may have moved on since, and it is the mark to go on from.
      const current = (await listDictionaries()).find((one) => one.id === dictionary.id) ?? dictionary;
      await runImport(opened.value, current, { say: dictionaryStatus, progress: current.progress ?? null });
    });
    if (!ran) dictionaryStatus(t("options_import_elsewhere"), "error");
  } catch (error) {
    await deleteDictionary(dictionary.id).catch(() => undefined);
    dictionaryStatus(t("options_add_dictionary_failed", message(error)), "error");
  } finally {
    letGo();
    importing = false;
    await renderCatalog();
  }
}

/**
 * The rows, batch after batch, from wherever the import stands.
 *
 * The dictionary is read and written in step, one batch at a time: a batch
 * is handed to the database, the next one is keyed while the first is being
 * written, and nothing of either outlives its write. Whatever the files
 * weigh, what this page holds is the unpacked .dict file and one batch. Each
 * batch lands together with where the import stands after it, so a page
 * killed between two batches has lost nothing but the batch in flight.
 *
 * @param {import("../lib/dict/import.js").OpenDictionary} opened
 * @param {import("../lib/dict/store.js").Dictionary} dictionary
 * @param {{ say: (text: string, tone?: "idle" | "busy" | "error") => void, progress: import("../lib/dict/store.js").ImportProgress | null }} job
 * @returns {Promise<boolean>} whether the dictionary is now stored
 */
async function runImport(opened, dictionary, { say, progress }) {
  const { name, credit } = opened;
  const total = opened.words + opened.synonyms;
  const batches = rowBatches(
    dictionary.id,
    {
      entries: entriesOf(opened, { readFrom: entriesReadFrom(progress) }),
      aliases: aliasesOf(opened),
    },
    { resume: progress },
  );

  const writer = await openWriter(dictionary.id);
  let appended = progress?.appended ?? 0;
  /** @type {import("../lib/dict/rows.js").RowSummary} */
  let summary;
  try {
    let step = batches.next();
    while (!step.done) {
      const batch = step.value;
      const writing = writer.put(batch.rows, batch.additions, {
        name,
        credit,
        progress: { ...batch.progress, total, appended },
      });
      say(t("options_storing_dictionary", [name, batch.done.toLocaleString(), total.toLocaleString()]), "busy");
      // The next batch is keyed while this one is on its way to the disk.
      step = batches.next();
      appended += await writing;
      // Waiting on the write yields too, but not for long enough to be sure
      // the status line painted; a hidden page has nobody to paint for, and
      // its timers are throttled to a second each.
      if (document.visibilityState === "visible") await breathe();
    }
    summary = step.value;
  } finally {
    writer.close();
  }

  if (summary.entryCount === 0) {
    // Every entry pointed past the end of the file, or none had a word in
    // it: what the index promised turned out to be nothing, and nothing is
    // what stays.
    await deleteDictionary(dictionary.id);
    say(describeImportProblem("no_entries", summary.skipped === 0 ? undefined : `${summary.skipped}`), "error");
    return false;
  }

  const ready = await finishImport(dictionary.id, {
    entryCount: summary.entryCount,
    aliasCount: summary.aliasCount,
    bytes: summary.bytes + appended,
  });

  const unreadable = summary.skipped === 0 ? "" : ` ${plural(summary.skipped, "options_skipped_entries")}`;
  say(t("options_added_dictionary", [ready.name, words(ready.entryCount), megabytes(ready.bytes)]) + unreadable);
  return true;
}

async function addSelectedDictionary() {
  if (importing || running !== null) return;

  const input = /** @type {HTMLInputElement | null} */ (document.getElementById("dictionary-files"));
  const chosen = [...(input?.files ?? [])];

  const classified = classifyDictionaryFiles(chosen.map((file) => file.name));
  if (!classified.ok) {
    dictionaryFileStatus(describeImportProblem(classified.problem, classified.detail), "error");
    return;
  }

  const langFrom = chosenLanguage("dictionary-from", config.sourceLang ?? "");
  const langTo = chosenLanguage("dictionary-to", config.targetLang ?? "");
  const { base, ifo, idx, dict, syn } = classified.value;

  importing = true;
  const letGo = holdScreen();
  await renderCatalog();

  try {
    // The files go as they are: the importer reads each from disk as it needs
    // it, and unpacks the big one as a stream, so nothing here ever holds a
    // compressed copy of the dictionary.
    /** @param {string} name */
    const file = (name) => {
      const found = chosen.find((candidate) => candidate.name === name);
      if (found === undefined) throw new Error(t("options_file_disappeared", name));
      return found;
    };

    const files = {
      ifo: file(ifo),
      idx: file(idx),
      dict: file(dict),
      ...(syn === undefined ? {} : { syn: file(syn) }),
    };

    let stored = false;
    const ran = await withImportLock(async () => {
      stored = await storeDictionary(files, { base, langFrom, langTo, say: dictionaryFileStatus });
    });
    if (!ran) dictionaryFileStatus(t("options_import_elsewhere"), "error");
    if (stored && input !== null) input.value = "";
  } catch (error) {
    dictionaryFileStatus(t("options_add_dictionary_failed", message(error)), "error");
  } finally {
    letGo();
    importing = false;
    await renderCatalog();
  }
}

async function render() {
  config = await readConfig();
  os = await platformOs();
  // The dated caches, and nothing asked of the network: each list stays as
  // it was until its update button is pressed, and the line above it says
  // how old that is.
  liveList = await readLiveModels();
  liveDictionaries = await readLiveDictionaries();
  // Android has no toolbar to pin anything to: the last step says where the
  // button already lives instead. Settled here, while the fold is still
  // hidden, so neither platform ever sees the other platform's wording.
  const pin = document.getElementById("first-steps-pin");
  if (pin !== null && os === "android") {
    pin.setAttribute("data-i18n", "options_first_steps_pin_android");
    pin.textContent = t("options_first_steps_pin_android");
  }
  fill("version", webext().runtime.getManifest().version);
  renderReaderOnly();
  renderQuietBubble();
  renderKeepArticles();
  renderLibraryCopy();
  renderNoTranslation();
  renderBubbleScale();
  renderVoice();
  renderRate();
  // Its own promise: the storage row waits on the engine, and nothing else on
  // this page should wait with it.
  void renderStorage();
  // With no pair chosen the selects open on their first language rather than
  // a preselected one - the import's own selects are still the full list.
  renderLanguageChoices("dictionary-from", config.sourceLang ?? "");
  renderLanguageChoices("dictionary-to", config.targetLang ?? "");

  const { source } = registrySource();
  const host = source === "" ? "" : new URL(source).host;
  fill("model-host", host);
  const modelSource = document.getElementById("model-host");
  if (modelSource instanceof HTMLAnchorElement && source !== "") modelSource.href = source;
  fill("model-checked", listDate());

  const dictionaries = catalogSource();
  fill("dictionary-host", dictionaries.source === "" ? "" : new URL(dictionaries.source).host);
  const dictionarySource = document.getElementById("dictionary-host");
  if (dictionarySource instanceof HTMLAnchorElement && dictionaries.source !== "") {
    dictionarySource.href = dictionaries.source;
  }
  fill("dictionary-checked", dictionaryListDate());

  await renderModels();
  renderDisabledHosts();

  // An import that died with its tab left rows behind that no lookup can see.
  // One that still has its files is a row with Continue on it (D137) and
  // stays; the rest is swept before the frame first draws, and this is the
  // moment somebody is here to be told about it.
  const swept = await removeUnfinished().catch(() => []);
  if (swept.length > 0) {
    dictionaryStatus(
      t("options_swept_unfinished", swept.map((one) => one.name).join(", ")),
    );
  }
  await renderCatalog();
}

/**
 * The popup writes the same settings this page shows, and can do it while this
 * page is open: the pair from its select, the site list from its switch. What
 * it wrote has to be what this page shows, so both are redrawn - the model
 * list too, because "what you are reading" rides on the pair. Not while a
 * download or an import holds the screen: redrawing would replace a live
 * progress bar, and the next full render comes when it finishes anyway.
 */
async function refresh() {
  config = await readConfig();
  renderReaderOnly();
  renderQuietBubble();
  renderKeepArticles();
  renderLibraryCopy();
  renderNoTranslation();
  renderBubbleScale();
  // The pair may have moved (the popup writes it too), and the pair decides
  // which language's voices the select is about.
  renderVoice();
  renderRate();
  renderDisabledHosts();
  // Both lists, because "what you are reading" rides on the pair in both -
  // and the select rides `renderModels`. While a download or an import holds
  // the screen only the select is refreshed, so the popup's writes still land.
  if (running === null && !importing) {
    await renderModels();
    await renderCatalog();
  } else {
    renderPair(modelRows(await listModels(), availableModels()));
  }
}

webext().storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || changes[CONFIG_KEY] === undefined) return;
  void refresh();
});

// The engine's voice list arrives on its own schedule - after first paint on
// desktop, sometimes never on Android - and the select redraws when it does.
if (canSpeak()) speechSynthesis.addEventListener("voiceschanged", renderVoice);

document.getElementById("reader-only")?.addEventListener("change", (event) => {
  const toggle = event.target;
  if (!(toggle instanceof HTMLInputElement)) return;
  // Open pages notice through `storage.onChanged` and change modes on the
  // spot - the launcher appears or the reading side starts, with no reload.
  void writeConfig({ readerOnly: toggle.checked }).then((written) => {
    config = written;
  });
});
document.getElementById("quiet-bubble")?.addEventListener("change", (event) => {
  const toggle = event.target;
  if (!(toggle instanceof HTMLInputElement)) return;
  // Same road as the mode switch: open pages hear it through storage and the
  // next bubble opens the way the box now says.
  void writeConfig({ hideBubbleActions: toggle.checked }).then((written) => {
    config = written;
  });
});
document.getElementById("keep-articles")?.addEventListener("change", (event) => {
  const toggle = event.target;
  if (!(toggle instanceof HTMLInputElement)) return;
  // The reader reads this fresh as each page opens (D124), so an open reader
  // tab obeys the new answer from the very next article - nothing to redraw
  // here, and nothing to reload there.
  void writeConfig({ keepArticles: toggle.checked }).then((written) => {
    config = written;
  });
});
document.getElementById("library-copy")?.addEventListener("change", (event) => {
  const toggle = event.target;
  if (!(toggle instanceof HTMLInputElement)) return;
  // The copy follows the switch at once - built from the whole reading list
  // on the way on, removed on the way off - and the storage row then says
  // what that left. The switch waits meanwhile: a second press during a
  // build would race the first.
  toggle.disabled = true;
  void (async () => {
    config = await writeConfig({ libraryCopy: toggle.checked });
    if (toggle.checked) await buildLibraryCopy();
    else await clearLibraryCopy();
    await renderStorage();
  })().finally(() => {
    toggle.disabled = false;
  });
});
document.getElementById("no-translation")?.addEventListener("change", (event) => {
  const toggle = event.target;
  if (!(toggle instanceof HTMLInputElement)) return;
  // This page reshapes on the spot; open pages hear it through storage the
  // way every switch travels - ordinary pages swap to the launcher, the
  // reader trims its bubble and drops its underlines, no reload anywhere
  // (D120).
  void writeConfig({ translationOff: toggle.checked }).then((written) => {
    config = written;
    renderNoTranslation();
  });
});
// The same road again (D85): open pages hear the size through storage, and
// the next bubble opens at it.
document.getElementById("bubble-scale-down")?.addEventListener("click", () => {
  void stepBubbleScale(-BUBBLE_SCALE.step);
});
document.getElementById("bubble-scale-up")?.addEventListener("click", () => {
  void stepBubbleScale(BUBBLE_SCALE.step);
});
document.getElementById("tts-voice")?.addEventListener("change", (event) => {
  const select = event.target;
  if (!(select instanceof HTMLSelectElement)) return;
  // A disabled picker fires no change, so this only runs with a pair chosen -
  // the guard is for the type and for a stale page mid-change.
  const source = config.sourceLang;
  if (source === null) return;
  // The whole map is written back (see `writeConfig`), which is what lets
  // "browser default" remove the entry rather than store an empty string.
  const map = { ...config.ttsVoices };
  if (select.value === "") delete map[source];
  else map[source] = select.value;
  void writeConfig({ ttsVoices: map }).then((written) => {
    config = written;
  });
});
document.getElementById("tts-listen")?.addEventListener("click", () => {
  // The selection on screen, not the stored one: the point of the button is
  // trying a voice out before living with it.
  const select = document.getElementById("tts-voice");
  const chosen = select instanceof HTMLSelectElement && select.value !== "" ? select.value : undefined;
  // At the speed that is set, because that is what living with it will sound
  // like - a sample read at a speed nobody uses is a sample of nothing. With
  // no pair the empty tag lets the engine's default voice read the sample.
  speak(VOICE_SAMPLE, config.sourceLang ?? "", chosen, config.ttsRate / 100);
});
document.getElementById("tts-rate-down")?.addEventListener("click", () => {
  void stepRate(-TTS_RATE.step);
});
document.getElementById("tts-rate-up")?.addEventListener("click", () => {
  void stepRate(TTS_RATE.step);
});
document.getElementById("add-model")?.addEventListener("click", () => void addSelectedModel());
document.getElementById("refresh-models")?.addEventListener("click", () => void refreshList());
document.getElementById("refresh-dictionaries")?.addEventListener("click", () => void refreshDictionaryList());
document.getElementById("model-filter")?.addEventListener("input", () => applyModelFilter());
document.getElementById("dictionary-filter")?.addEventListener("input", () => applyCatalogFilter());
document.getElementById("models-show-all")?.addEventListener("click", () => expandList("models"));
document.getElementById("dictionaries-show-all")?.addEventListener("click", () => expandList("dictionary-catalog"));
document.getElementById("add-dictionary")?.addEventListener("click", () => void addSelectedDictionary());

// The armed Delete stands down at any step away from it - a press elsewhere,
// focus moving on, Escape - and never on a clock. `pointerdown` rather than
// `click` so that the press that arms another row's Delete finds the previous
// one already disarmed when its own click handler runs.
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
document.getElementById("pair")?.addEventListener("change", (event) => {
  const select = event.target;
  if (select instanceof HTMLSelectElement) void choosePair(select.value);
});
// The bar's menu, the saved-phrases header's conduct exactly: one drawn
// button, the panel under the bar's line, and every row going through the
// background, which raises the page's one tab if it stands - or, since
// D147, turns this very tab into the page, the settings one Back away, so
// no press ever opens a copy of a page beside one. Nothing to do when a
// message fails mid-restart: the press can be repeated. There is no
// display panel here, so "one panel at a time" is just this one.
const pageBar = document.querySelector(".page-bar");
const menuButton = document.getElementById("menu");
const menuPanel = document.getElementById("menu-panel");
const panelScrim = document.getElementById("panel-scrim");

// The way back to the reading (D139-D142): walked here from the reader, the
// arrow pops the same history entry as the system's back gesture; raised
// here from the popup or the add-on manager with the reading standing in
// another tab, it brings that tab forward. The three states and their order
// live in `lib/back-arrow.js`, shared with the saved-phrases page.
armBackArrow();

/** @param {boolean} open */
function setMenu(open) {
  if (menuButton === null || menuPanel === null) return;
  menuPanel.hidden = !open;
  menuButton.setAttribute("aria-expanded", String(open));
  // The page dims under the open menu, and clears with it.
  if (panelScrim !== null) panelScrim.hidden = !open;
}

menuButton?.addEventListener("click", () => {
  setMenu(menuPanel?.hidden === true);
});

document.getElementById("nav-library")?.addEventListener("click", () => {
  setMenu(false);
  void webext().runtime.sendMessage({ kind: Message.OPEN_LIBRARY }).catch(() => {});
});
document.getElementById("nav-marks")?.addEventListener("click", () => {
  setMenu(false);
  void webext().runtime.sendMessage({ kind: Message.OPEN_MARKS }).catch(() => {});
});
document.getElementById("nav-vocabulary")?.addEventListener("click", () => {
  setMenu(false);
  void webext().runtime.sendMessage({ kind: Message.OPEN_VOCABULARY }).catch(() => {});
});

// An open menu yields to the page underneath, the other headers' rule: a
// press anywhere but the bar and the panel puts it away, and Escape does the
// same from the keyboard - handing focus back to the button whose panel held
// it.
document.addEventListener("pointerdown", (event) => {
  if (menuPanel?.hidden !== false) return;
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (pageBar?.contains(target) === true || menuPanel.contains(target)) return;
  setMenu(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || menuPanel?.hidden !== false) return;
  const focus = document.activeElement;
  if (focus instanceof Node && menuPanel.contains(focus)) menuButton?.focus();
  setMenu(false);
});

// A download or an import in flight is the one thing on this page that a reload
// would leave half-finished, and the browser will not warn about it by itself.
window.addEventListener("beforeunload", (event) => {
  if (running === null && !importing) return;
  event.preventDefault();
});

void render();
