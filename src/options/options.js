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
import { localizePage, plural, t } from "../lib/i18n.js";
import { languageName, pairLabel } from "../lib/language.js";
import { catalogDictionaries, catalogSource } from "../lib/dict/catalog.js";
import { describeDictDownloadProblem, downloadArchive } from "../lib/dict/download.js";
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
import { modelRows, registryModels, registrySource } from "../lib/models/registry.js";
import { deleteModel, listModels, putModel } from "../lib/models/store.js";
import { matchesFilter, orderForDisplay, searchableText, sortByLabel } from "./models-view.js";

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
 * @param {"model-status" | "file-status" | "dictionary-status" | "dictionary-file-status" | "dictionary-get-status"} id
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
 * @param {string} text
 * @param {"idle" | "busy" | "error"} [tone]
 */
function fileStatus(text, tone = "idle") {
  say("file-status", text, tone);
}

/**
 * @param {string} tag
 * @param {string} className
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function element(tag, className, text) {
  const created = document.createElement(tag);
  created.className = className;
  // Every string on this page is ours, but `textContent` is the habit the rest
  // of the extension keeps, and habits are what hold when the strings change.
  if (text !== undefined) created.textContent = text;
  return created;
}

/**
 * @param {import("../lib/models/registry.js").ModelRow} row
 * @returns {HTMLElement}
 */
function renderRow(row) {
  const container = element("div", "model");
  const name = element("span", "model-pair", pairLabel(row.from, row.to));
  if (row.from === config.sourceLang && row.to === config.targetLang) {
    name.append(element("span", "badge", t("options_badge_reading")));
  }
  container.append(name);

  if (row.installed !== null) {
    container.append(element("span", "model-size", t("options_size_here", megabytes(row.installed.bytes))));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = t("action_delete");
    remove.disabled = running !== null;
    remove.addEventListener("click", () => void removeModel(row));
    container.append(remove);
    return container;
  }

  const available = row.available;
  if (available === null) return container;

  // The size alone: the button beside it already says what pressing it does,
  // and "to download" was the first thing to overflow a phone-wide row.
  container.append(element("span", "model-size", megabytes(available.downloadBytes)));

  const start = document.createElement("button");
  start.type = "button";
  start.textContent = t("action_download");
  start.disabled = running !== null;
  start.addEventListener("click", () => void download(row, available));
  container.append(start);
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
  container.append(element("span", "model-pair", pairLabel(model.from, model.to)));

  const bar = document.createElement("progress");
  bar.className = "model-progress";
  bar.max = model.downloadBytes;
  bar.value = 0;

  const size = element("span", "model-size", t("options_progress_of", [megabytes(0), megabytes(model.downloadBytes)]));

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = t("action_cancel");
  cancel.addEventListener("click", () => {
    cancel.disabled = true;
    controller.abort();
  });

  container.append(bar, size, cancel);

  let shown = "";
  return ({ received, total }) => {
    bar.max = total;
    bar.value = received;
    // Progress arrives a couple of thousand times over a download and the text
    // only changes every hundred kilobytes of it. Rewriting it anyway would be
    // a thousand pointless relayouts during the one operation that should feel
    // smooth.
    const text = t("options_progress_of", [megabytes(received), megabytes(total)]);
    if (text !== shown) {
      shown = text;
      size.textContent = text;
    }
  };
}

/**
 * @param {import("../lib/models/registry.js").ModelRow} row
 */
async function removeModel(row) {
  if (running !== null) return;
  await deleteModel(row.pair);
  status(t("options_deleted_model", pairLabel(row.from, row.to)));
  await renderModels();
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
  running = null;

  if (!result.ok) {
    status(describeDownloadProblem(result.problem, result.detail), result.problem === "cancelled" ? "idle" : "error");
    await renderModels();
    return;
  }

  try {
    const meta = await putModel(result.value, { from: model.from, to: model.to });
    status(t("options_downloaded_model", [pairLabel(model.from, model.to), megabytes(meta.bytes)]));
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
 * The choices are the directions this build knows about - what can be
 * downloaded, plus anything added by hand from files. A pair configured by hand
 * that matches neither is still offered rather than silently swapped for the
 * first row: a settings page must never disagree with the settings.
 *
 * @param {import("../lib/models/registry.js").ModelRow[]} rows
 */
function renderPair(rows) {
  const select = document.getElementById("pair");
  if (!(select instanceof HTMLSelectElement)) return;

  const known = rows.some((row) => row.from === config.sourceLang && row.to === config.targetLang);
  const sorted = sortByLabel(rows);
  const choices = known
    ? sorted
    : [{ pair: `${config.sourceLang}${config.targetLang}`, from: config.sourceLang, to: config.targetLang }, ...sorted];

  select.replaceChildren();
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
  const rows = modelRows(await listModels());
  const row = rows.find((candidate) => candidate.pair === pair);
  if (row === undefined) return;

  config = await writeConfig({ sourceLang: row.from, targetLang: row.to });
  // Every open page notices through `storage.onChanged` and asks the background
  // for the vocabulary of the new pair, so nothing here has to tell them.
  await renderModels();
  status(
    row.installed === null
      ? t("options_reading_pair_missing", [languageName(row.from), languageName(row.to)])
      : t("options_reading_pair", [languageName(row.from), languageName(row.to)]),
  );
}

/**
 * Hides the rows a filter box rules out. Called on every keystroke and after
 * every re-render, because a render builds all rows and knows nothing of the
 * filter - hiding is a separate, cheaper pass over what is already there.
 * Two lists filter this way (models and the dictionary catalogue), each with
 * its own box, which is why the ids travel as arguments.
 *
 * @param {string} containerId
 * @param {string} inputId
 * @param {string} noneId
 */
function applyFilterIn(containerId, inputId, noneId) {
  const container = document.getElementById(containerId);
  if (container === null) return;

  const input = document.getElementById(inputId);
  const query = input instanceof HTMLInputElement ? input.value : "";

  let visible = 0;
  for (const row of container.querySelectorAll(".model")) {
    if (!(row instanceof HTMLElement)) continue;
    const match = matchesFilter(row.dataset["search"] ?? "", query);
    row.hidden = !match;
    if (match) visible += 1;
  }

  const none = document.getElementById(noneId);
  if (none !== null) none.hidden = visible > 0;
}

function applyModelFilter() {
  applyFilterIn("models", "model-filter", "model-none");
}

function applyCatalogFilter() {
  applyFilterIn("dictionary-catalog", "dictionary-filter", "dictionary-none");
}

async function renderModels() {
  const container = document.getElementById("models");
  if (container === null) return;

  const rows = orderForDisplay(modelRows(await listModels()), config);
  container.replaceChildren();

  if (rows.length === 0) {
    container.append(element("p", "empty", t("options_no_models")));
    return;
  }

  for (const row of rows) {
    const rendered = renderRow(row);
    rendered.id = `model-${row.pair}`;
    rendered.dataset["search"] = searchableText(row);
    container.append(rendered);
  }

  // Lives inside the scrolled frame so that "the filter matched nothing" is
  // said where the missing rows would have been, not somewhere below the box.
  const none = element("p", "empty", t("options_filter_no_match_models"));
  none.id = "model-none";
  none.hidden = true;
  container.append(none);

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
    row.append(element("span", "model-pair", host));

    const restore = document.createElement("button");
    restore.type = "button";
    restore.textContent = t("options_turn_back_on");
    restore.addEventListener("click", () => void restoreHost(host));
    row.append(restore);
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

    const meta = await putModel({ pair, model, shortlist, vocabs }, { from, to });
    if (input !== null) input.value = "";
    fileStatus(t("options_added_model", [pairLabel(from, to), megabytes(meta.bytes)]));
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
 * @param {string} text
 * @param {"idle" | "busy" | "error"} [tone]
 */
function dictionaryGetStatus(text, tone = "idle") {
  say("dictionary-get-status", text, tone);
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
  for (const model of registryModels()) {
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
 * @param {import("../lib/dict/store.js").Dictionary} dictionary
 * @returns {HTMLElement}
 */
function renderDictionary(dictionary) {
  const container = element("div", "dictionary");

  const name = element("span", "dictionary-name", dictionary.name);
  const pair = element("span", "badge", pairLabel(dictionary.langFrom, dictionary.langTo));
  if (dictionary.langFrom === config.sourceLang) pair.classList.add("badge-on");
  name.append(pair);
  container.append(name);

  const counted =
    dictionary.aliasCount > 0
      ? `${words(dictionary.entryCount)}, ${plural(dictionary.aliasCount, "spellings")}`
      : words(dictionary.entryCount);
  container.append(element("span", "model-size", counted));
  container.append(element("span", "model-size", megabytes(dictionary.bytes)));

  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = t("action_delete");
  remove.disabled = importing;
  remove.addEventListener("click", () => void removeDictionary(dictionary));
  container.append(remove);

  // Attribution is why this is on screen at all: the dictionaries worth having
  // are Wiktionary-derived and CC BY-SA, and naming their source is the whole
  // of what that asks for.
  if (dictionary.credit !== null) {
    container.append(element("span", "dictionary-credit", dictionary.credit));
  }

  return container;
}

async function renderDictionaries() {
  const container = document.getElementById("dictionaries");
  if (container === null) return;

  const dictionaries = await listDictionaries();
  container.replaceChildren();

  if (dictionaries.length === 0) {
    container.append(
      element("p", "empty", t("options_no_dictionaries")),
    );
    return;
  }

  for (const dictionary of dictionaries) container.append(renderDictionary(dictionary));
}

/**
 * @param {import("../lib/dict/store.js").Dictionary} dictionary
 */
async function removeDictionary(dictionary) {
  if (importing) return;
  try {
    await deleteDictionary(dictionary.id);
    dictionaryStatus(t("options_deleted_dictionary", dictionary.name));
  } catch (error) {
    dictionaryStatus(t("options_delete_dictionary_failed", [dictionary.name, message(error)]), "error");
  }
  await renderDictionaries();
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
  container.append(element("span", "model-pair", pairLabel(entry.from, entry.to)));

  const get = document.createElement("button");
  get.type = "button";
  get.textContent = t("action_download");
  get.disabled = running !== null || importing;
  get.addEventListener("click", () => void downloadDictionary(entry));
  container.append(get);
  return container;
}

/**
 * The catalogue never changes while the page is open - what changes is
 * whether its buttons are pressable, so this is redrawn at the edges of every
 * download and import, the way the model list is.
 */
function renderCatalog() {
  const container = document.getElementById("dictionary-catalog");
  if (container === null) return;

  const entries = sortByLabel(catalogDictionaries());
  container.replaceChildren();

  if (entries.length === 0) {
    container.append(element("p", "empty", t("options_no_catalog")));
    return;
  }

  for (const entry of entries) {
    const rendered = renderCatalogRow(entry);
    rendered.id = catalogRowId(entry);
    rendered.dataset["search"] = searchableText(entry);
    container.append(rendered);
  }

  const none = element("p", "empty", t("options_filter_no_match_dictionaries"));
  none.id = "dictionary-none";
  none.hidden = true;
  container.append(none);

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
  container.append(element("span", "model-pair", pairLabel(entry.from, entry.to)));

  const bar = document.createElement("progress");
  bar.className = "model-progress";

  const size = element("span", "model-size", "");

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = t("action_cancel");
  cancel.addEventListener("click", () => {
    cancel.disabled = true;
    controller.abort();
  });

  container.append(bar, size, cancel);

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

  await renderDictionaries();
  renderCatalog();
  const container = document.getElementById(catalogRowId(entry));
  const onProgress = container === null ? undefined : renderFetching(container, entry, controller);
  const label = pairLabel(entry.from, entry.to);
  dictionaryGetStatus(t("options_downloading_dictionary", label), "busy");

  try {
    const result = await downloadArchive(entry.url, { signal: controller.signal, onProgress });
    if (!result.ok) {
      dictionaryGetStatus(
        describeDictDownloadProblem(result.problem, result.detail),
        result.problem === "cancelled" ? "idle" : "error",
      );
      return;
    }

    const zip = await readZip(result.value);
    if (!zip.ok) {
      dictionaryGetStatus(describeZipProblem(zip.problem, zip.detail), "error");
      return;
    }

    const sorted = dictionaryFromZip(zip.value);
    if (!sorted.ok) {
      dictionaryGetStatus(describeImportProblem(sorted.problem, sorted.detail), "error");
      return;
    }

    // The language sides come from the catalogue row, not from a select: a
    // WikDict archive is one direction, and its name already said which.
    await storeDictionary(sorted.value.files, {
      base: sorted.value.base,
      langFrom: entry.from,
      langTo: entry.to,
      say: dictionaryGetStatus,
    });
  } finally {
    importing = false;
    await renderDictionaries();
    renderCatalog();
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
  await renderDictionaries();
  renderCatalog();
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
    await renderDictionaries();
    renderCatalog();
  }
}

async function render() {
  config = await readConfig();
  os = await platformOs();
  fill("version", webext().runtime.getManifest().version);
  renderPair(modelRows(await listModels()));
  renderReaderOnly();
  renderLanguageChoices("dictionary-from", config.sourceLang);
  renderLanguageChoices("dictionary-to", config.targetLang);

  const { source, checkedAt } = registrySource();
  const host = source === "" ? "" : new URL(source).host;
  fill("model-host", host);
  fill("model-checked", checkedAt);

  const dictionaries = catalogSource();
  fill("dictionary-host", dictionaries.source === "" ? "" : new URL(dictionaries.source).host);
  fill("dictionary-checked", dictionaries.checkedAt);

  await renderModels();
  renderCatalog();
  renderDisabledHosts();

  // An import that died with its tab left rows behind that no lookup can see.
  // This is the moment somebody is here to be told about it.
  const swept = await removeUnfinished().catch(() => []);
  if (swept.length > 0) {
    dictionaryStatus(
      t("options_swept_unfinished", swept.map((one) => one.name).join(", ")),
    );
  }
  await renderDictionaries();
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
  renderPair(modelRows(await listModels()));
  renderReaderOnly();
  renderDisabledHosts();
  if (running === null && !importing) await renderModels();
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
document.getElementById("model-filter")?.addEventListener("input", () => applyModelFilter());
document.getElementById("dictionary-filter")?.addEventListener("input", () => applyCatalogFilter());
document.getElementById("add-dictionary")?.addEventListener("click", () => void addSelectedDictionary());
document.getElementById("pair")?.addEventListener("change", (event) => {
  const select = event.target;
  if (select instanceof HTMLSelectElement) void choosePair(select.value);
});

// A download or an import in flight is the one thing on this page that a reload
// would leave half-finished, and the browser will not warn about it by itself.
window.addEventListener("beforeunload", (event) => {
  if (running === null && !importing) return;
  event.preventDefault();
});

void render();
