/**
 * The toolbar popup: the basic acts on top, the door to the settings at the
 * bottom, in the place every user already looks for them. Seven rows -
 * whether re/read runs on this site, which pair is being read, whether the
 * bubble keeps its actions folded (D81 - a reading preference somebody flips
 * mid-article), this page in the reader, the reading list, the saved
 * phrases, the settings - and nothing else.
 *
 * The popup knows which tab it stands over and nothing more: `tabs.query`
 * without the `tabs` permission answers with an id and no address, on purpose.
 * The address never becomes its business either - it asks the tab itself
 * (`page-info`), and the content script that is already on every ordinary page
 * answers with its hostname. No answer means a page this extension does not
 * run on (`about:`, the add-ons site, the PDF viewer), and the row says so
 * instead of showing a switch; the reader answers "I am the reader", and the
 * switch and the reader button disappear together, because neither means
 * anything there.
 *
 * The switch and the pair are both one write to the settings, the same write
 * the settings page makes. Every open tab reacts through `storage.onChanged` -
 * the toggle tears the page's reading side down or starts it, with no reload
 * and no message addressed to anybody.
 */

import { webext } from "../lib/browser.js";
import { effectiveReaderOnly, platformOs, readConfig, writeConfig } from "../lib/config.js";
import { localizePage, t } from "../lib/i18n.js";
import { pairLabel } from "../lib/language.js";
import { listModels } from "../lib/models/store.js";
import { Message, asPageInfo, asResult } from "../lib/protocol.js";
import { watchToolbarScheme } from "../lib/theme-icon.js";
import { pairChoices } from "./choices.js";

// First, so the rows are already in the catalogue's language when they show.
localizePage();
// The toolbar icon follows the browser's scheme where the manifest cannot
// say so (Chromium, no theme_icons there) - a no-op on Firefox.
watchToolbarScheme();

const siteRow = document.getElementById("site-row");
const siteLabel = document.getElementById("site-label");
const siteNote = document.getElementById("site-note");
const siteToggle = /** @type {HTMLInputElement | null} */ (document.getElementById("site-toggle"));
const quietToggle = /** @type {HTMLInputElement | null} */ (document.getElementById("quiet-bubble"));
const pairRow = document.getElementById("pair-row");
const setupRow = document.getElementById("setup-row");
const pairSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById("pair"));
const readerButton = document.getElementById("open-reader");
const libraryButton = document.getElementById("open-library");
const vocabularyButton = document.getElementById("open-vocabulary");
const settingsButton = document.getElementById("open-settings");
const modeLine = document.getElementById("mode-line");

/** The tab under the popup, and what it said about itself. */
/** @type {{ tabId: number | null, hostname: string | null }} */
const over = { tabId: null, hostname: null };

/** @type {import("./choices.js").PairChoice[]} */
let choices = [];

/**
 * @returns {Promise<number | null>}
 */
async function currentTabId() {
  const tabs = await webext().tabs.query({ active: true, currentWindow: true });
  const id = tabs[0]?.id;
  return typeof id === "number" ? id : null;
}

/**
 * @param {number | null} tabId
 * @returns {Promise<import("../lib/protocol.js").PageInfo | null>}
 */
async function askPage(tabId) {
  if (tabId === null) return null;
  try {
    const answer = asResult(await webext().tabs.sendMessage(tabId, { kind: Message.PAGE_INFO }));
    return answer.ok ? asPageInfo(answer.value) : null;
  } catch {
    // Nothing in the tab is listening - no content script runs there. That is
    // an answer too, just not one that travels as a message.
    return null;
  }
}

/**
 * @param {import("../lib/config.js").Config} config
 */
function renderPair(config) {
  if (pairSelect === null) return;
  pairSelect.replaceChildren();
  for (const choice of choices) {
    const option = document.createElement("option");
    option.value = choice.pair;
    option.textContent = pairLabel(choice.from, choice.to);
    option.selected = choice.from === config.sourceLang && choice.to === config.targetLang;
    pairSelect.append(option);
  }
}

/**
 * @param {import("../lib/protocol.js").PageInfo | null} info
 * @param {import("../lib/config.js").Config} config
 */
function renderSite(info, config) {
  if (info?.reader === true) {
    // On the reader both rows about "this page" go: there is no site behind it
    // to switch off, and no page behind it to read.
    if (readerButton !== null) readerButton.hidden = true;
    return;
  }

  if (info === null) {
    if (siteNote !== null) siteNote.hidden = false;
    return;
  }

  over.hostname = info.hostname;
  // Named, not just shown: a bare hostname next to a checkbox says nothing
  // about which way the checkbox points. "Enabled on ..." does.
  if (siteLabel !== null) siteLabel.textContent = t("popup_site_enabled", info.hostname);
  if (siteToggle !== null) siteToggle.checked = !config.disabledHosts.includes(info.hostname);
  if (siteRow !== null) siteRow.hidden = false;
}

async function toggleSite() {
  const host = over.hostname;
  if (host === null || siteToggle === null) return;

  // Read fresh before writing: another surface may have moved the list since
  // this popup drew itself, and the write must lose only this one entry.
  const current = await readConfig();
  const hosts = siteToggle.checked
    ? current.disabledHosts.filter((one) => one !== host)
    : [...current.disabledHosts, host];
  await writeConfig({ disabledHosts: hosts });
}

async function toggleQuietBubble() {
  if (quietToggle === null) return;
  // The same write the settings page makes; every open page's bubble follows
  // through `storage.onChanged`, next selection onwards.
  await writeConfig({ hideBubbleActions: quietToggle.checked });
}

async function choosePair() {
  if (pairSelect === null) return;
  const choice = choices.find((one) => one.pair === pairSelect.value);
  if (choice === undefined) return;

  // The same write the settings page makes: every open page notices through
  // `storage.onChanged` and asks the background for the vocabulary of the new
  // pair, so nothing here has to tell them.
  await writeConfig({ sourceLang: choice.from, targetLang: choice.to });
}

async function openReader() {
  const request =
    over.tabId === null
      ? { kind: Message.OPEN_READER }
      : { kind: Message.OPEN_READER, sourceTabId: over.tabId };
  try {
    await webext().runtime.sendMessage(request);
  } catch {
    // The background was mid-restart. The press can be repeated; a popup that
    // throws instead of closing cannot.
  }
  window.close();
}

async function openLibrary() {
  try {
    // Its own message, carrying nothing: the list is not about any tab, least
    // of all the one this popup happens to live in on Android.
    await webext().runtime.sendMessage({ kind: Message.OPEN_LIBRARY });
  } catch {
    // Same as the reader: repeatable beats stuck.
  }
  window.close();
}

async function openVocabulary() {
  try {
    // Carries nothing for the reading list's reason: the page shows the pair
    // from the settings, and no tab is any of its business.
    await webext().runtime.sendMessage({ kind: Message.OPEN_VOCABULARY });
  } catch {
    // Same again: repeatable beats stuck.
  }
  window.close();
}

async function openSettings() {
  await webext().runtime.openOptionsPage();
  window.close();
}

siteToggle?.addEventListener("change", () => void toggleSite());
quietToggle?.addEventListener("change", () => void toggleQuietBubble());
pairSelect?.addEventListener("change", () => void choosePair());
readerButton?.addEventListener("click", () => void openReader());
libraryButton?.addEventListener("click", () => void openLibrary());
vocabularyButton?.addEventListener("click", () => void openVocabulary());
settingsButton?.addEventListener("click", () => void openSettings());
// The signpost is a door to the same place the settings row leads.
setupRow?.addEventListener("click", () => void openSettings());
// The status line is also the shortest way to where the mode is changed.
modeLine?.addEventListener("click", () => void openSettings());

async function render() {
  const [config, installed, tabId, os] = await Promise.all([
    readConfig(),
    // A database that cannot be opened reads as no models, and the popup then
    // points at the settings - which is where the truth gets told either way.
    listModels().catch(() => []),
    currentTabId(),
    platformOs(),
  ]);

  // The stylesheet reads the platform off the body: on Android the popup is a
  // page over the whole window and fills it, on desktop it is a panel that
  // measures the page. Which is which is runtime knowledge, not a media query.
  document.body.dataset["os"] = os;
  // Whether ordinary pages only offer the reader. On Android this popup is the
  // extension's main surface, so the mode must be readable from it - and the
  // per-site switch above stays: in this mode it silences the launcher.
  if (modeLine !== null) modeLine.hidden = !effectiveReaderOnly(config, os);

  over.tabId = tabId;
  // A fresh install has no model at all, and a pair select would promise a
  // translation nothing can deliver. The signpost stands in the row's place
  // until the first model lands.
  const fresh = installed.length === 0;
  if (pairRow !== null) pairRow.hidden = fresh;
  if (setupRow !== null) setupRow.hidden = !fresh;
  if (quietToggle !== null) quietToggle.checked = config.hideBubbleActions;
  choices = pairChoices(config, installed);
  renderPair(config);
  renderSite(await askPage(tabId), config);
}

void render();
