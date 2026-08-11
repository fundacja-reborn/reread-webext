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
import { readConfig, writeConfig } from "../lib/config.js";
import { describeDownloadProblem, downloadModel } from "../lib/models/download.js";
import { classifyModelFiles, describeClassifyProblem, isGzip } from "../lib/models/files.js";
import { modelRows, registrySource } from "../lib/models/registry.js";
import { deleteModel, listModels, putModel } from "../lib/models/store.js";

/**
 * The one download that may be in flight. One at a time on purpose: each holds
 * its files in memory until they are checked, and two at once would double that
 * for no gain on a single connection.
 *
 * @type {{ pair: string, controller: AbortController } | null}
 */
let running = null;

/** @type {{ sourceLang: string, targetLang: string }} */
let config = { sourceLang: "en", targetLang: "pl" };

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
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/**
 * Two places report, because there are two things to report about and they are
 * a screen apart. A download starts at the list of models, so that is where it
 * has to say how it went - a sentence about a failed download printed below the
 * file picker is a sentence nobody scrolls to.
 *
 * @param {"model-status" | "file-status"} id
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
  const name = element("span", "model-pair", `${row.from} to ${row.to}`);
  if (row.from === config.sourceLang && row.to === config.targetLang) {
    name.append(element("span", "badge", "what you are reading"));
  }
  container.append(name);

  if (row.installed !== null) {
    container.append(element("span", "model-size", `${megabytes(row.installed.bytes)} here`));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Delete";
    remove.disabled = running !== null;
    remove.addEventListener("click", () => void removeModel(row));
    container.append(remove);
    return container;
  }

  const available = row.available;
  if (available === null) return container;

  container.append(element("span", "model-size", `${megabytes(available.downloadBytes)} to download`));

  const start = document.createElement("button");
  start.type = "button";
  start.textContent = "Download";
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
  container.append(element("span", "model-pair", `${model.from} to ${model.to}`));

  const bar = document.createElement("progress");
  bar.className = "model-progress";
  bar.max = model.downloadBytes;
  bar.value = 0;

  const size = element("span", "model-size", `0 of ${megabytes(model.downloadBytes)}`);

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
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
    const text = `${megabytes(received)} of ${megabytes(total)}`;
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
  status(`Deleted the ${row.from} to ${row.to} model.`);
  await renderModels();
}

/**
 * @param {import("../lib/models/registry.js").ModelRow} row
 * @param {import("../lib/models/registry.js").RegistryModel} model
 */
async function download(row, model) {
  if (running !== null) return;

  const controller = new AbortController();
  running = { pair: row.pair, controller };

  // Redrawn with the download already claimed, which is what greys out every
  // other button on the page; then this one row becomes a progress bar.
  await renderModels();
  const container = document.getElementById(`model-${row.pair}`);
  const onProgress = container === null ? undefined : renderDownloading(container, model, controller);
  status(`Downloading the ${model.from} to ${model.to} model - ${megabytes(model.downloadBytes)}.`, "busy");

  const result = await downloadModel(model, { signal: controller.signal, onProgress });
  running = null;

  if (!result.ok) {
    status(describeDownloadProblem(result.problem, result.detail), result.problem === "cancelled" ? "idle" : "error");
    await renderModels();
    return;
  }

  try {
    const meta = await putModel(result.value, { from: model.from, to: model.to });
    status(`Downloaded the ${model.from} to ${model.to} model, ${megabytes(meta.bytes)} on this device.`);
  } catch (error) {
    // The download was fine; the browser would not keep it. Worth saying apart
    // from a failed download, because the answer is different - space, or a
    // second copy of this page holding the database open.
    status(`The model downloaded but could not be stored: ${message(error)}`, "error");
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
  const choices = known
    ? rows
    : [{ pair: `${config.sourceLang}${config.targetLang}`, from: config.sourceLang, to: config.targetLang }, ...rows];

  select.replaceChildren();
  for (const row of choices) {
    const option = document.createElement("option");
    option.value = row.pair;
    option.textContent = `${row.from} to ${row.to}`;
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
      ? `Reading ${row.from}, translating into ${row.to} - and there is no model for this direction here yet.`
      : `Reading ${row.from}, translating into ${row.to}.`,
  );
}

async function renderModels() {
  const container = document.getElementById("models");
  if (container === null) return;

  const rows = modelRows(await listModels());
  container.replaceChildren();

  if (rows.length === 0) {
    container.append(element("p", "empty", "No models here, and none to download - this build lists none."));
    return;
  }

  for (const row of rows) {
    const rendered = renderRow(row);
    rendered.id = `model-${row.pair}`;
    container.append(rendered);
  }
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
  fileStatus(`Reading ${chosen.length} files for ${from} to ${to}...`, "busy");

  try {
    /** @param {string} name */
    const read = async (name) => {
      const file = chosen.find((candidate) => candidate.name === name);
      if (file === undefined) throw new Error(`${name} disappeared while reading`);
      return gunzipIfNeeded(await file.arrayBuffer());
    };

    const [model, shortlist] = await Promise.all([read(byRole.model[0] ?? ""), read(byRole.shortlist[0] ?? "")]);
    const vocabs = await Promise.all(byRole.vocab.map(read));

    const meta = await putModel({ pair, model, shortlist, vocabs }, { from, to });
    if (input !== null) input.value = "";
    fileStatus(`Added the ${from} to ${to} model, ${megabytes(meta.bytes)} on this device.`);
    await renderModels();
  } catch (error) {
    fileStatus(`Could not add the model: ${message(error)}`, "error");
  }
}

async function render() {
  config = await readConfig();
  fill("version", webext().runtime.getManifest().version);
  renderPair(modelRows(await listModels()));

  const { source, checkedAt } = registrySource();
  const host = source === "" ? "" : new URL(source).host;
  fill("model-host", host);
  fill("model-checked", checkedAt);

  await renderModels();
}

document.getElementById("add-model")?.addEventListener("click", () => void addSelectedModel());
document.getElementById("pair")?.addEventListener("change", (event) => {
  const select = event.target;
  if (select instanceof HTMLSelectElement) void choosePair(select.value);
});

// A download in flight is the one thing on this page that a reload would leave
// half-finished, and the browser will not warn about it by itself.
window.addEventListener("beforeunload", (event) => {
  if (running === null) return;
  event.preventDefault();
});

void render();
