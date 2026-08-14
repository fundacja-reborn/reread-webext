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

import { webext } from "../lib/browser.js";
import { CONFIG_KEY, effectiveReaderOnly, platformOs, readConfig, withDefaults, writeConfig } from "../lib/config.js";
import { aside, localizePage, plural, t } from "../lib/i18n.js";
import { languageName, pairLabel } from "../lib/language.js";
import { catalogDictionaries, catalogSource } from "../lib/dict/catalog.js";
import { describeDictDownloadProblem, downloadArchive } from "../lib/dict/download.js";
import { readLiveDictionaries, refreshLiveDictionaries } from "../lib/dict/live.js";
import { classifyDictionaryFiles, describeImportProblem, dictionaryFromZip, readDictionary } from "../lib/dict/import.js";
import { describeZipProblem, readZip } from "../lib/dict/zip.js";
import { toRows } from "../lib/dict/rows.js";
import {
  beginImport,
  deleteDictionary,
  finishImport,
  listDictionaries,
  putEntries,
  removeUnfinished,
} from "../lib/dict/store.js";
import { describeDownloadProblem, downloadModel } from "../lib/models/download.js";
import { classifyModelFiles, describeClassifyProblem, isGzip } from "../lib/models/files.js";
import { readLiveModels, refreshLiveModels } from "../lib/models/live.js";
import { modelRows, registryModels, registrySource } from "../lib/models/registry.js";
import { deleteModel, listModels, putModel } from "../lib/models/store.js";
import { modelSourceUrl, updateAvailable } from "../lib/models/upstream.js";
import { testLoadModel } from "../lib/models/validate.js";
import { Message } from "../lib/protocol.js";
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

/**
 * @param {string} id
 * @param {string} value
 */
function fill(id, value) {
  const element = document.getElementById(id);
  if (element !== null) element.textContent = value;
}

/**
 * @param {number} bytes
 * @returns {string}
 */
function megabytes(bytes) {
  // The reader's own decimal mark: `12.3` where the browser writes dots,
  // `12,3` where it writes commas. The unit needs no catalogue.
  const amount = (bytes / 1048576).toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${amount} MB`;
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

  // Redrawn with the download already claimed, which is what greys out every
  // other button on the page; then this one row becomes a progress bar.
  await renderModels();
  const container = document.getElementById(`model-${row.pair}`);
  const onProgress = container === null ? undefined : renderDownloading(container, model, controller);
  status(t("options_downloading_model", [pairLabel(model.from, model.to), megabytes(model.downloadBytes)]), "busy");

  const result = await downloadModel(model, { signal: controller.signal, onProgress });

  if (!result.ok) {
    running = null;
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

/**
 * How many rows go into the database at a time.
 *
 * A dictionary from Wiktionary is a few hundred thousand rows, and one
 * transaction holding all of them is a transaction that owns the database for
 * as long as it takes. Batches let the page say where it is and let the browser
 * breathe between them.
 */
const ENTRY_BATCH = 5000;

/** Imports, like downloads, happen one at a time. @type {boolean} */
let importing = false;

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
  const languages = new Set([config.sourceLang, config.targetLang]);
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
 * A stored dictionary's row - the same three cells a stored model gets, plus
 * what only a dictionary carries: its own name under the pair (two
 * dictionaries of one pair must be told apart) and its attribution, folded.
 *
 * @param {import("../lib/dict/store.js").Dictionary} dictionary
 * @returns {HTMLElement}
 */
function renderDictionary(dictionary) {
  const container = element("div", "model");

  const name = element("span", "model-name", pairLabel(dictionary.langFrom, dictionary.langTo));
  if (dictionary.langFrom === config.sourceLang && dictionary.langTo === config.targetLang) {
    name.append(element("span", "badge", t("options_badge_reading")));
  }
  name.append(element("span", "dictionary-title", dictionary.name));
  container.append(name);

  const counted =
    dictionary.aliasCount > 0
      ? `${words(dictionary.entryCount)}, ${plural(dictionary.aliasCount, "spellings")}`
      : words(dictionary.entryCount);
  const meta = element("span", "model-meta");
  meta.append(element("span", "", counted));
  meta.append(element("span", "", megabytes(dictionary.bytes)));
  container.append(meta);

  const act = element("span", "model-act");
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
 * The confirmed second press of a stored dictionary's Delete.
 *
 * @param {import("../lib/dict/store.js").Dictionary} dictionary
 * @param {HTMLButtonElement} button
 */
async function removeDictionary(dictionary, button) {
  if (importing) return;
  const at = deleteButtonsIn("dictionary-catalog").indexOf(button);
  try {
    await deleteDictionary(dictionary.id);
    dictionaryStatus(t("options_deleted_dictionary", dictionary.name));
  } catch (error) {
    dictionaryStatus(t("options_delete_dictionary_failed", [dictionary.name, message(error)]), "error");
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

  // The dictionary half of the first-steps verdict. Ready ones only: a
  // half-imported dictionary answers no lookup, and must not fold the
  // instructions away.
  dictionaryStored = stored.some((one) => one.ready);
  renderFirstSteps();

  container.replaceChildren();

  if (rows.length === 0) {
    container.append(element("p", "empty", t("options_no_catalog")));
  } else {
    for (const row of rows) {
      /** @type {HTMLElement} */
      let rendered;
      if (row.installed !== null) {
        rendered = renderDictionary(row.installed);
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
  const controller = new AbortController();

  // Redrawn with the import already claimed, which greys out the other
  // buttons of the frame; then this one row becomes a progress bar.
  await renderCatalog();
  const container = document.getElementById(catalogRowId(entry));
  const onProgress = container === null ? undefined : renderFetching(container, entry, controller);
  const label = pairLabel(entry.from, entry.to);
  dictionaryStatus(t("options_downloading_dictionary", label), "busy");

  try {
    const result = await downloadArchive(entry.url, { signal: controller.signal, onProgress });
    if (!result.ok) {
      dictionaryStatus(
        describeDictDownloadProblem(result.problem, result.detail),
        result.problem === "cancelled" ? "idle" : "error",
      );
      return;
    }

    const zip = await readZip(result.value);
    if (!zip.ok) {
      dictionaryStatus(describeZipProblem(zip.problem, zip.detail), "error");
      return;
    }

    const sorted = dictionaryFromZip(zip.value);
    if (!sorted.ok) {
      dictionaryStatus(describeImportProblem(sorted.problem, sorted.detail), "error");
      return;
    }

    // The language sides come from the catalogue row, not from a select: a
    // WikDict archive is one direction, and its name already said which.
    await storeDictionary(sorted.value.files, {
      base: sorted.value.base,
      langFrom: entry.from,
      langTo: entry.to,
      say: dictionaryStatus,
    });
  } finally {
    importing = false;
    await renderCatalog();
  }
}

/**
 * The half of an import every source shares: parsed files in, a dictionary in
 * the database or a sentence about why not. The file picker and the catalogue
 * differ only in where the bytes and the languages come from - and in which
 * status line they talk to, which is why `say` travels as an argument.
 *
 * @param {import("../lib/dict/import.js").DictionaryBytes} files
 * @param {{ base: string, langFrom: string, langTo: string, say: (text: string, tone?: "idle" | "busy" | "error") => void }} job
 * @returns {Promise<boolean>} whether a dictionary is now stored
 */
async function storeDictionary(files, { base, langFrom, langTo, say }) {
  try {
    const parsed = await readDictionary(files, {
      fallbackName: base,
      onProgress: ({ done, total }) => say(t("options_reading_dictionary_progress", [base, words(done), total.toLocaleString()]), "busy"),
    });

    if (!parsed.ok) {
      say(describeImportProblem(parsed.problem, parsed.detail), "error");
      return false;
    }

    const dictionary = await beginImport({
      name: parsed.value.name,
      langFrom,
      langTo,
      credit: parsed.value.credit,
    });

    const { rows, entryCount, aliasCount, bytes: stored } = toRows(dictionary.id, parsed.value);

    for (let at = 0; at < rows.length; at += ENTRY_BATCH) {
      await putEntries(rows.slice(at, at + ENTRY_BATCH));
      say(t("options_storing_dictionary", [parsed.value.name, Math.min(at + ENTRY_BATCH, rows.length).toLocaleString(), rows.length.toLocaleString()]), "busy");
    }

    const ready = await finishImport(dictionary.id, { entryCount, aliasCount, bytes: stored });

    const unreadable =
      parsed.value.skipped === 0 ? "" : ` ${plural(parsed.value.skipped, "options_skipped_entries")}`;
    say(t("options_added_dictionary", [ready.name, words(ready.entryCount), megabytes(ready.bytes)]) + unreadable);
    return true;
  } catch (error) {
    // Whatever went wrong, the half-written dictionary is still unready and
    // therefore invisible; this sweeps it away rather than leaving it to the
    // next time this page opens.
    await removeUnfinished().catch(() => []);
    say(t("options_add_dictionary_failed", message(error)), "error");
    return false;
  }
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

  const langFrom = chosenLanguage("dictionary-from", config.sourceLang);
  const langTo = chosenLanguage("dictionary-to", config.targetLang);
  const { base, ifo, idx, dict, syn } = classified.value;

  importing = true;
  await renderCatalog();
  dictionaryFileStatus(t("options_reading_file", base), "busy");

  try {
    /** @param {string} name */
    const read = async (name) => {
      const file = chosen.find((candidate) => candidate.name === name);
      if (file === undefined) throw new Error(t("options_file_disappeared", name));
      return new Uint8Array(await file.arrayBuffer());
    };

    const bytes = {
      ifo: await read(ifo),
      idx: await read(idx),
      dict: await read(dict),
      ...(syn === undefined ? {} : { syn: await read(syn) }),
    };

    const stored = await storeDictionary(bytes, { base, langFrom, langTo, say: dictionaryFileStatus });
    if (stored && input !== null) input.value = "";
  } catch (error) {
    dictionaryFileStatus(t("options_add_dictionary_failed", message(error)), "error");
  } finally {
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
  renderLanguageChoices("dictionary-from", config.sourceLang);
  renderLanguageChoices("dictionary-to", config.targetLang);

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
  // This is the moment somebody is here to be told about it - swept before
  // the frame first draws, so what draws is already clean.
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

document.getElementById("reader-only")?.addEventListener("change", (event) => {
  const toggle = event.target;
  if (!(toggle instanceof HTMLInputElement)) return;
  // Open pages notice through `storage.onChanged` and change modes on the
  // spot - the launcher appears or the reading side starts, with no reload.
  void writeConfig({ readerOnly: toggle.checked }).then((written) => {
    config = written;
  });
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
document.getElementById("open-vocabulary")?.addEventListener("click", () => {
  // The background raises the existing saved-phrases tab or opens one - the
  // same single tab the popup's row leads to. Nothing to do when it fails
  // mid-restart: the press can be repeated.
  void webext().runtime.sendMessage({ kind: Message.OPEN_VOCABULARY }).catch(() => {});
});
document.getElementById("open-library")?.addEventListener("click", () => {
  // The reading list, by the same door the popup uses: the background raises
  // the reader tab on its list or opens one.
  void webext().runtime.sendMessage({ kind: Message.OPEN_LIBRARY }).catch(() => {});
});

// A download or an import in flight is the one thing on this page that a reload
// would leave half-finished, and the browser will not warn about it by itself.
window.addEventListener("beforeunload", (event) => {
  if (running === null && !importing) return;
  event.preventDefault();
});

void render();
