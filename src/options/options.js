/**
 * The settings page. It shows the settings it can read and says plainly that it
 * cannot change them yet - a page of controls that do nothing would be worse
 * than a page that admits what it is.
 */

import { webext } from "../lib/browser.js";
import { readConfig } from "../lib/config.js";
import { activeProviderId } from "../lib/translator/index.js";

/**
 * @param {string} id
 * @param {string} value
 */
function fill(id, value) {
  const element = document.getElementById(id);
  if (element !== null) element.textContent = value;
}

async function render() {
  const config = await readConfig();
  fill("version", webext().runtime.getManifest().version);
  fill("source-lang", config.sourceLang);
  fill("target-lang", config.targetLang);
  fill("engine", activeProviderId() === "none" ? "not installed yet" : activeProviderId());
}

void render();
