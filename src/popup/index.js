/**
 * The toolbar popup: the basic acts on top, the door to the settings at the
 * bottom, in the place every user already looks for them. Whether re/read
 * runs on this site, this page in the reader, which pair is being read, the
 * extension's own rooms, then the three reading preferences somebody flips
 * mid-article - the bubble's fold (D81), reader-only mode (D111) and
 * translation itself (D128) - the settings, and nothing else.
 *
 * The order is the popup's one rule: from what is pressed daily down to what
 * is flipped seldom. Which rows stand at all is `rows.js`, because a fresh
 * install and the translation-off setting each take some of them away.
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

import { followTheme } from "../lib/appearance.js";
import { webext } from "../lib/browser.js";
import { chosenPair, effectiveReaderOnly, platformOs, readConfig, writeConfig } from "../lib/config.js";
import { localizePage, t } from "../lib/i18n.js";
import { pairLabel } from "../lib/language.js";
import { listModels } from "../lib/models/store.js";
import { Message, asPageInfo, asResult } from "../lib/protocol.js";
import { watchToolbarScheme } from "../lib/theme-icon.js";
import { pairChoices } from "./choices.js";
import { popupRows } from "./rows.js";

// First, so the rows are already in the catalogue's language when they show.
localizePage();
// The toolbar icon follows the browser's scheme where the manifest cannot
// say so (Chromium, no theme_icons there) - a no-op on Firefox.
watchToolbarScheme();
// The paper follows the theme the Aa panels write (D104): a popup opened over
// a sepia article is part of the same room.
followTheme();

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
const marksButton = document.getElementById("open-marks");
const vocabularyButton = document.getElementById("open-vocabulary");
const settingsButton = document.getElementById("open-settings");
const supportButton = document.getElementById("open-support");

/**
 * The one outward address in the popup - the foundation's support page, the
 * same one the README and the settings' Support section name. Navigation on
 * a press, never a request the extension makes itself.
 */
const SUPPORT_URL = "https://reapps.eu/#support";
const readerOnlyToggle = /** @type {HTMLInputElement | null} */ (
  document.getElementById("reader-only")
);
const translationToggle = /** @type {HTMLInputElement | null} */ (
  document.getElementById("no-translation")
);

/** The tab under the popup, and what it said about itself. */
/** @type {{ tabId: number | null, hostname: string | null }} */
const over = { tabId: null, hostname: null };

/**
 * Whether the site row may stand at all (`rows.js`, D149): written by
 * `showRows`, read by `renderSite`, because the page answers which site this
 * is after the rows have been decided.
 */
let siteStands = true;

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
  if (siteRow !== null) siteRow.hidden = !siteStands;
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

async function toggleTranslationOff() {
  if (translationToggle === null) return;
  // The settings page's own write, and then the popup redraws itself: this is
  // the one switch here that changes what the popup is - the pair, the
  // phrases and the two switches below it come and go with it - and a hallway
  // left describing the mode before the press would be lying about the press
  // that was just made. Every open page follows the same write through
  // `storage.onChanged`, launcher or reading side, no reload.
  await writeConfig({ translationOff: translationToggle.checked });
  showRows(await readConfig(), (await installedModels()).length);
}

async function toggleReaderOnly() {
  if (readerOnlyToggle === null) return;
  // The settings page's own write: the first press stores a real choice, and
  // from then on the platform default has no say. Open pages change modes on
  // the spot through `storage.onChanged` - launcher or reading side, no
  // reload.
  await writeConfig({ readerOnly: readerOnlyToggle.checked });
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

async function openMarks() {
  try {
    // The highlights page is the reader tab's own view - the message both
    // turns it there and raises it, and carries nothing for the list's reason.
    await webext().runtime.sendMessage({ kind: Message.OPEN_MARKS });
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
  try {
    // Through the background like the other three rows (D147): the settings
    // tab raised if one stands, a tab of ours turned to it otherwise, a
    // fresh one last - where `openOptionsPage` knew only the first.
    await webext().runtime.sendMessage({ kind: Message.OPEN_SETTINGS });
  } catch {
    // Same as the others: repeatable beats stuck.
  }
  window.close();
}

async function openSupport() {
  try {
    await webext().tabs.create({ url: SUPPORT_URL });
  } catch {
    // The tab did not open - nothing to do but let the press be repeated.
  }
  window.close();
}

siteToggle?.addEventListener("change", () => void toggleSite());
quietToggle?.addEventListener("change", () => void toggleQuietBubble());
readerOnlyToggle?.addEventListener("change", () => void toggleReaderOnly());
translationToggle?.addEventListener("change", () => void toggleTranslationOff());
pairSelect?.addEventListener("change", () => void choosePair());
readerButton?.addEventListener("click", () => void openReader());
libraryButton?.addEventListener("click", () => void openLibrary());
marksButton?.addEventListener("click", () => void openMarks());
vocabularyButton?.addEventListener("click", () => void openVocabulary());
settingsButton?.addEventListener("click", () => void openSettings());
supportButton?.addEventListener("click", () => void openSupport());
// The signpost is a door to the same place the settings row leads.
setupRow?.addEventListener("click", () => void openSettings());

/**
 * The translation models on this device. A database that cannot be opened
 * reads as none, and the popup then points at the settings - which is where
 * the truth gets told either way.
 *
 * @returns {Promise<import("./choices.js").PairChoice[]>}
 */
async function installedModels() {
  return await listModels().catch(() => []);
}

/**
 * @param {Element | null} row
 * @param {boolean} shown
 */
function stand(row, shown) {
  if (row !== null) row.toggleAttribute("hidden", !shown);
}

/**
 * Which rows stand, from the rule in `rows.js` - the whole of what a fresh
 * install and the translation-off setting (D120) do to this popup. Called on
 * every draw and again the moment the switch that decides it is flipped.
 *
 * @param {import("../lib/config.js").Config} config
 * @param {number} installed how many models this device holds
 */
function showRows(config, installed) {
  const rows = popupRows({
    translationOff: config.translationOff,
    bubbleOff: config.bubbleOff,
    fresh: installed === 0,
    pair: chosenPair(config) !== null,
  });
  // The site row is revealed by the page's own answer (`renderSite`), which
  // arrives after this; the rule is kept for it - and applied here too, for
  // the switch pressed after that answer, which has to be able to take the
  // row away again.
  siteStands = rows.site;
  if (over.hostname !== null) stand(siteRow, rows.site);
  stand(pairRow, rows.pair);
  stand(setupRow, rows.setup);
  stand(document.getElementById("translation-off-note"), rows.translationNote);
  stand(vocabularyButton, rows.vocabulary);
  stand(document.getElementById("quiet-row"), rows.quiet);
  stand(document.getElementById("reader-only-row"), rows.readerOnly);
  stand(document.getElementById("no-translation-row"), rows.translation);
}

async function render() {
  const [config, installed, tabId, os] = await Promise.all([
    readConfig(),
    installedModels(),
    currentTabId(),
    platformOs(),
  ]);

  // The stylesheet reads the platform off the body: on Android the popup is a
  // page over the whole window and fills it, on desktop it is a panel that
  // measures the page. Which is which is runtime knowledge, not a media query.
  document.body.dataset["os"] = os;
  // The reader-only switch shows the mode as it acts, not as it is stored
  // (the settings page's rule): with nothing chosen, the box reflects the
  // platform's default - on this Android popup it opens checked.
  if (readerOnlyToggle !== null) readerOnlyToggle.checked = effectiveReaderOnly(config, os);

  over.tabId = tabId;
  showRows(config, installed.length);
  if (quietToggle !== null) quietToggle.checked = config.hideBubbleActions;
  if (translationToggle !== null) translationToggle.checked = config.translationOff;
  choices = pairChoices(config, installed);
  renderPair(config);
  renderSite(await askPage(tabId), config);
}

void render();
