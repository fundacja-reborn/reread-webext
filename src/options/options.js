/**
 * The settings page. What it can do today is the part that matters most on the
 * day everything else fails: put a translation model on this device from files,
 * with no network involved.
 */

import { webext } from "../lib/browser.js";
import { readConfig } from "../lib/config.js";
import { classifyModelFiles, describeClassifyProblem, isGzip } from "../lib/models/files.js";
import { deleteModel, listModels, putModel } from "../lib/models/store.js";

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
 * @param {string} text
 * @param {"idle" | "busy" | "error"} [tone]
 */
function status(text, tone = "idle") {
  const element = document.getElementById("model-status");
  if (element === null) return;
  element.textContent = text;
  element.dataset["tone"] = tone;
}

async function renderModels() {
  const container = document.getElementById("models");
  if (container === null) return;
  container.replaceChildren();

  const models = await listModels();
  if (models.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No models yet. Nothing can be translated until one is added.";
    container.append(empty);
    return;
  }

  for (const model of models) {
    const row = document.createElement("div");
    row.className = "model";

    const name = document.createElement("span");
    name.className = "model-pair";
    name.textContent = `${model.from} to ${model.to}`;

    const size = document.createElement("span");
    size.className = "model-size";
    size.textContent = megabytes(model.bytes);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => {
      void deleteModel(model.pair).then(() => {
        status(`Deleted the ${model.from} to ${model.to} model.`);
        return renderModels();
      });
    });

    row.append(name, size, remove);
    container.append(row);
  }
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
    status(describeClassifyProblem(classified.problem, classified.detail), "error");
    return;
  }

  const { pair, from, to, byRole } = classified.value;
  status(`Reading ${chosen.length} files for ${from} to ${to}...`, "busy");

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
    status(`Added the ${from} to ${to} model, ${megabytes(meta.bytes)} on this device.`);
    await renderModels();
  } catch (error) {
    status(`Could not add the model: ${error instanceof Error ? error.message : String(error)}`, "error");
  }
}

async function render() {
  const config = await readConfig();
  fill("version", webext().runtime.getManifest().version);
  fill("source-lang", config.sourceLang);
  fill("target-lang", config.targetLang);
  await renderModels();
}

document.getElementById("add-model")?.addEventListener("click", () => void addSelectedModel());

void render();
