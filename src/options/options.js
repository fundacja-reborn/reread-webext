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
  READING_PACE,
  TTS_RATE,
  cleanFontFamily,
  effectiveLibraryCopy,
  effectiveReaderOnly,
  effectiveTouchTurn,
  isTouchTurn,
  isTurnEffect,
  platformOs,
  readConfig,
  withDefaults,
  writeConfig,
} from "../lib/config.js";
import { aside, localizePage, megabytes, plural, speedFactor, t, uiLocale } from "../lib/i18n.js";
import { compileUserCss } from "../lib/user-css.js";
import { privateNote } from "../lib/private-note.js";
import { armBackArrow } from "../lib/back-arrow.js";
import { askReader, framedInReader } from "../lib/room-frame.js";
import { languageName, pairLabel } from "../lib/language.js";
import { catalogDictionaries, catalogSource } from "../lib/dict/catalog.js";
import { describeDictDownloadProblem, downloadArchive } from "../lib/dict/download.js";
import { describeLinkProblem, parseDictionaryLink } from "../lib/dict/link.js";
import { describeHostProblem, parseHostname } from "../lib/host.js";
import { sameSite } from "../lib/site.js";
import { dictionarySourcesLink } from "../lib/sources.js";
import { readLiveDictionaries, refreshLiveDictionaries } from "../lib/dict/live.js";
import {
  aliasesOf,
  classifyDictionaryFiles,
  describeImportProblem,
  dictionaryFromZip,
  entriesOf,
  isDictionaryFile,
  openDictionary,
} from "../lib/dict/import.js";
import { describeZipProblem, readZip } from "../lib/dict/zip.js";
import { entriesReadFrom, rowBatches } from "../lib/dict/rows.js";
import { moveWithinSourceLanguage } from "../lib/dict/order.js";
import { DISPLAY_NAME_LIMIT, cleanDisplayName, fileNameWorthSaying, nameHolder, shownName } from "../lib/dict/display-name.js";
import {
  beginImport,
  deleteDictionary,
  finishImport,
  listDictionaries,
  openWriter,
  readSources,
  removeUnfinished,
  renameDictionary,
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
import { listArticles } from "../lib/store/articles.js";
import { listBooks } from "../lib/store/books.js";
import {
  buildLibraryCopy,
  clearLibraryCopy,
  completeLibraryCopy,
  readLibraryCopy,
} from "../lib/store/library-copy.js";
import { marksInBackup, readMarksBackup } from "../lib/store/marks-backup.js";
import { watchToolbarScheme } from "../lib/theme-icon.js";
import {
  canSpeak,
  canSpeakLang,
  offlineLanguages,
  primaryLanguage,
  setSpeechOff,
  speak,
  speechSupported,
  voiceLanguage,
  voicesFor,
} from "../lib/tts.js";
import { pinnedByBrowser, readSteps, stepsView, writeSteps } from "./first-steps.js";
import { armSearch } from "./search.js";
import { armSections, fillSectionSelect, land } from "./sections.js";
import {
  dictionaryRows,
  filterActive,
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
// Then the private-browsing sentence, when this page runs in one: what an
// empty list would otherwise say wrongly, said first and in the catalogue's
// words (`private-note.js`).
privateNote();
// Then the row notes' More (D254) - after the catalogue's text is in them,
// because the button says the catalogue's word for "more".
moreNotes();
// The toolbar icon follows the browser's scheme where the manifest cannot
// say so (Chromium, no theme_icons there) - a no-op on Firefox.
watchToolbarScheme();
// The paper follows the theme the Aa panels write (D104): this page has no
// content of its own to dress, but walking here from a dark article must not
// flash a white room. All but one paper: sepia is for reading long text with
// less blue light in it, and a page of controls is not that (D265, Michał's
// call) - it answers with the light paper, which is the same brightness a
// reader who chose sepia is already in.
followTheme({ without: "sepia" });
// Then the page's own navigation (D254): the table of contents beside the
// page, the same list in the bar's select, the marker that follows the
// reading, and the landing every address makes. After `localizePage`,
// because the select's lines are the column's links read back.
armSections();
// And the search over the settings (D254, P10), whose index is the page read
// once - so it too waits for the catalogue's words to be in it, and for the
// More paragraphs above, whose text it indexes.
armSearch();

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
 * The installed dictionaries as the last render found them: the order they
 * answer in, each with the language whose words it explains. An arrow moves a
 * row within its own language (D263), so the press has to know both - and
 * reading them back off the screen would mean trusting the screen about what
 * the database holds.
 *
 * @type {{ id: string, lang: string }[]}
 */
let dictionaryPlaces = [];

/**
 * Whether the card stood open the last time it was drawn. The fold is only
 * moved when that verdict changes, so a card folded or unfolded by hand keeps
 * the reader's choice through every redraw in between.
 *
 * @type {boolean | null}
 */
let stepsOpen = null;

/**
 * Whether each catalogue stands unfolded past its installed rows. A press on
 * "Show all" is remembered until the page closes; clearing the filter with
 * the list still folded returns to the installed rows alone.
 */
let modelsExpanded = false;

/** @type {boolean} */
let dictionariesExpanded = false;

/**
 * What the browser said about the toolbar button, and what the reader wrote
 * down about the card. Read once at open and kept here: the card redraws on
 * every model and every dictionary, and neither question changes with them.
 *
 * @type {import("./first-steps.js").StepsState}
 */
let stepsState = { hidden: false, pinned: false };

/** @type {boolean | null} */
let pinnedNow = null;

/**
 * The fresh install's three steps, counted from what is stored (D254, P6).
 * Both frame renders report here, because every edge a model or a dictionary
 * crosses already passes through one of them - so downloading a model ticks
 * its step at once, with no reload.
 *
 * The fold is only moved when the first step's verdict changes, so a card
 * folded or unfolded by hand keeps the reader's choice through every redraw
 * in between.
 */
function renderFirstSteps() {
  const fold = document.getElementById("first-steps");
  if (!(fold instanceof HTMLDetailsElement)) return;
  if (modelStored === null || dictionaryStored === null) return;

  const view = stepsView({
    model: modelStored,
    dictionary: dictionaryStored,
    pinned: pinnedNow === null ? stepsState.pinned : pinnedNow,
    hidden: stepsState.hidden,
  });

  fold.hidden = !view.show;
  const back = document.getElementById("first-steps-back");
  if (back !== null) back.hidden = view.show;
  const entry = document.getElementById("jump-first-steps");
  if (entry !== null) entry.hidden = !view.show;

  if (view.open !== stepsOpen) {
    fold.open = view.open;
    stepsOpen = view.open;
  }

  fill("first-steps-count", t("options_first_steps_count", [String(view.done), String(view.total)]));
  const intro = document.getElementById("first-steps-intro");
  if (intro !== null) intro.hidden = !view.intro;

  const rows = ["step-source", "step-pin"];
  rows.forEach((id, at) => {
    const row = document.getElementById(id);
    if (row === null) return;
    const done = view.steps[at] === true;
    row.classList.toggle("is-done", done);
    const mark = row.querySelector(".step-mark");
    // A tick and an empty circle, not a colour: the state has to survive the
    // sixteen greys an e-ink panel keeps.
    if (mark !== null) mark.textContent = done ? "\u2713" : "\u25CB";
    const state = row.querySelector(".step-state");
    if (state !== null) state.textContent = done ? t("options_step_done_state") : t("options_step_todo_state");
    // The way to the section is offered only while there is something to do
    // there; the pinning step's own two buttons - "How" and "Done" - follow
    // the same rule, and what "How" opened goes with them.
    for (const door of row.querySelectorAll(".step-door, .step-done, .note-more")) {
      if (door instanceof HTMLElement) door.hidden = done;
    }
    if (id === "step-pin" && done) {
      const help = document.getElementById("first-steps-pin");
      if (help !== null) help.hidden = true;
      document.getElementById("step-pin-how")?.setAttribute("aria-expanded", "false");
    }
  });

  // The bar's select is a snapshot of the column - it has to be taken again
  // whenever a line joins or leaves it.
  fillSectionSelect();
}

/**
 * @returns {import("../lib/models/registry.js").RegistryModel[]}
 */
function availableModels() {
  return liveList?.models ?? registryModels();
}

/**
 * A day the reader recognises, out of the `YYYY-MM-DD` both catalogue
 * snapshots are stamped with (D258, V7): `18.09.2026` in Polish, `18/09/2026`
 * in French - the shape the copies' dates already wear, so the page has one
 * way of writing a day rather than two.
 *
 * Built from the parts rather than handed to `new Date(text)`, which reads a
 * bare date as UTC midnight and shows the day before it west of Greenwich. A
 * stamp of any other shape comes back as itself: a raw date is poorer than a
 * written one, and honest.
 *
 * @param {string} stamp
 * @returns {string}
 */
function day(stamp) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(stamp);
  if (parts === null) return stamp;
  const at = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  return at.toLocaleDateString(uiLocale(), { dateStyle: "short" });
}

/**
 * @returns {string} the day the list on screen is from
 */
function listDate() {
  return day(liveList?.fetchedAt ?? registrySource().checkedAt);
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
  return day(liveDictionaries?.fetchedAt ?? catalogSource().checkedAt);
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
    else await renderPair(modelRows(await listModels(), availableModels()));
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

/** The page-count switch (D238) - stored plainly under the reader's settings. */
function renderPageNumber() {
  const toggle = document.getElementById("page-number");
  if (toggle instanceof HTMLInputElement) toggle.checked = config.reader.pageNumber;
}

/**
 * The two rows about how a page turns (D250, D251). The touch row shows the
 * gesture as it acts, not as it is stored: with nothing chosen the select
 * stands on what the window's width decides - and this page is read at the
 * width the reader is, whether it stands in a tab of its own or in a room
 * over the reading. The first press stores a real choice, and from then on
 * the width has no say, exactly as the reader-only switch works.
 */
function renderTurning() {
  const touch = document.getElementById("touch-turn");
  if (touch instanceof HTMLSelectElement) {
    touch.value = effectiveTouchTurn(config.reader, window.innerWidth);
    sayGesture(touch.value);
  }
  const effect = document.getElementById("turn-effect");
  if (effect instanceof HTMLSelectElement) {
    effect.value = config.reader.turnEffect;
    sayEffect(effect.value);
  }
}

/**
 * What the chosen gesture does, under the select (Michał's smoke,
 * 2026-09-18). Three names of three words each say what to press and
 * nothing about what happens: that a slide must not begin at the very edge
 * of a phone's screen, where the system's own back gesture lives, or that a
 * tap has to be brief and away from the edges to count. One sentence for
 * the choice in force rather than a paragraph about all three - and since
 * D264 the row's only sentence, the general one above it and the fold
 * behind that one both being what the select already says.
 *
 * Each key written out rather than built from the value, the way the error
 * sentences are (`lib/messages.js`): a key nothing names as a literal is a
 * key the catalogue tests cannot see, and one language quietly missing it
 * would show as an empty line.
 *
 * @param {string} gesture
 */
function sayGesture(gesture) {
  const note = document.getElementById("touch-turn-note");
  if (note === null) return;
  if (gesture === "zones") note.textContent = t("options_touch_turn_note_zones");
  else if (gesture === "swipe") note.textContent = t("options_touch_turn_note_swipe");
  else note.textContent = t("options_touch_turn_note_off");
}

/**
 * The same for the turn's effect: what a page turn will look like on this
 * screen, said where the choice is made - here the second half of the row's
 * one paragraph, after the sentence saying what the row is for (D264).
 *
 * @param {string} effect
 */
function sayEffect(effect) {
  const note = document.getElementById("turn-effect-note");
  if (note === null) return;
  note.textContent = effect === "off" ? t("options_turn_effect_note_off") : t("options_turn_effect_note_auto");
}

/** The quiet-bubble switch (D81) - stored plainly, no platform in the picture. */
function renderQuietBubble() {
  const toggle = document.getElementById("quiet-bubble");
  if (toggle instanceof HTMLInputElement) toggle.checked = config.hideBubbleActions;
}

/** The open-layer switch (D186): whether the sentence and the dictionary
 *  entries open with the bubble over a fresh selection. Stored plainly. */
function renderBubbleMore() {
  const toggle = document.getElementById("bubble-more");
  if (toggle instanceof HTMLInputElement) toggle.checked = config.showBubbleMore;
}

/** The other-forms switch (D208): whether a saved word is underlined in its
 *  other forms as well. Stored plainly. */
function renderUnderlineForms() {
  const toggle = document.getElementById("underline-forms");
  if (toggle instanceof HTMLInputElement) toggle.checked = config.underlineForms;
}

/** The sentence switch (D210): whether a phrase saved from the bubble keeps
 *  the sentence it stood in. Stored plainly. */
function renderSaveSentence() {
  const toggle = document.getElementById("save-sentence");
  if (toggle instanceof HTMLInputElement) toggle.checked = config.saveSentence;
}

/**
 * The pages' mirror rebuilt by the background, with the forms the
 * dictionaries vouch for now (D208). Asked after the switch is turned on and
 * after a dictionary comes or goes while it is on: the forms come out of the
 * dictionaries, this page is where the dictionaries change, and no storage
 * event tells the background so. `list-phrases` is the background's rebuild
 * by another name (the repair path pages take on a pair change); its answer
 * is not needed here. Quiet on failure - the next write to the vocabulary
 * rebuilds the mirror anyway.
 */
function refreshForms() {
  if (!config.underlineForms) return;
  void webext().runtime.sendMessage({ kind: Message.LIST_PHRASES }).catch(() => {});
}

/** The default-keep switch (D124): whether the reader files what it opens. */
function renderKeepArticles() {
  const toggle = document.getElementById("keep-articles");
  if (toggle instanceof HTMLInputElement) toggle.checked = config.keepArticles;
}

/**
 * The field previewing itself in the face it names: the one place a typed
 * value reaches a style, and it goes there cleaned and quoted - through the
 * same cleaning the config applies before storing (`cleanFontFamily`), so
 * nothing typed can carry quotes, backslashes or control characters into
 * the declaration. `style.fontFamily` is CSSOM, not a stylesheet string: an
 * invalid value is dropped whole, never parsed into something else.
 *
 * @param {HTMLInputElement} field
 */
function previewFontFamily(field) {
  const name = cleanFontFamily(field.value);
  field.style.fontFamily = name.length > 0 ? `"${name}"` : "";
}

/**
 * The reader's own rules (D176) - the field shows what is stored, unless
 * somebody has typed into it since: another page's write, or this page's own
 * refresh on any setting changing, must not eat a half-written sheet. Typed
 * is remembered by the input event rather than read off the focus, because
 * the focus leaves the field long before the press on Save.
 */
let customCssTyped = false;

/**
 * The two links to the page of dictionary sources - the dictionaries
 * section's intro (D192) and the link fold - pointed at the page in the
 * interface's language: the page is written in two, and a Polish interface
 * opens the Polish one. Links the reader follows, not requests the extension
 * makes.
 */
function linkDictionarySources() {
  const { href, label } = dictionarySourcesLink(uiLocale());
  for (const id of ["dictionary-sources-intro", "dictionary-sources-link"]) {
    const anchor = document.getElementById(id);
    if (!(anchor instanceof HTMLAnchorElement)) continue;
    anchor.href = href;
    anchor.textContent = label;
  }
}

/**
 * The stylesheets the reader's own rules address (D176), at the installed
 * version: the names can differ between versions, and a link to main would
 * show somebody a stylesheet they do not have. Releases are tagged `v<version>`;
 * a build whose version no tag names yet keeps the page's static href, main.
 *
 * @param {string} version
 */
function linkSources(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return;
  for (const link of document.querySelectorAll("a[data-source]")) {
    if (!(link instanceof HTMLAnchorElement)) continue;
    link.href = `https://github.com/fundacja-reborn/reread-webext/blob/v${version}/${link.dataset["source"] ?? ""}`;
  }
}

function renderCustomCss() {
  const field = document.getElementById("custom-css-text");
  if (!(field instanceof HTMLTextAreaElement)) return;
  if (!customCssTyped) field.value = config.customCss;
}

/** The reading font's name (D163) - the field shows what is stored. */
function renderFontCustom() {
  const field = document.getElementById("font-custom");
  if (!(field instanceof HTMLInputElement)) return;
  // Not while it is the thing being typed in: another page's write must not
  // eat a half-typed name.
  if (document.activeElement !== field) field.value = config.reader.fontFamily;
  previewFontFamily(field);
}

/**
 * The reader's own pace (D228) - the field shows what is stored, which is
 * the clamped number when a typed one fell outside the scale: at either end
 * the honest answer is "this is as far as it goes". The scale's ends are the
 * config's own, put on the field here so the browser's arrows and its
 * validity agree with the healer rather than with a copy in the markup.
 */
function renderPace() {
  const field = document.getElementById("reading-pace");
  if (!(field instanceof HTMLInputElement)) return;
  field.min = String(READING_PACE.min);
  field.max = String(READING_PACE.max);
  // Not while it is the thing being typed in, for the font name's reason.
  if (document.activeElement !== field) field.value = String(config.readingPace);
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
  // The mode takes whole sections off the page, the first-steps card among
  // them - so the bar's list of them is taken again (D254). The mode is also
  // the first step's other answer: reading without a model is translation set
  // up, and the card has to hear it.
  fillSectionSelect();
  renderFirstSteps();
  renderBubbleOff();
}

/**
 * The switch's sub-option (D149). Its row comes and goes with the switch over
 * it (`renderDependents`, D254) - which is why this rides in the switch's own
 * render - and the box shows the stored value whenever the row is on the page.
 */
function renderBubbleOff() {
  const toggle = document.getElementById("bubble-off");
  if (toggle instanceof HTMLInputElement) toggle.checked = config.bubbleOff;
  renderDependents();
}

/**
 * The reading-aloud switch (D148): the head of the two voice rows, which
 * leave the page with it (`renderDependents`, D254 - they used to go with a
 * body class, which said nothing about which row they belonged to). The
 * switch is handed to `lib/tts.js` here too, so the voice select and the
 * Listen button answer for it the way every other speaker does - and it lands
 * before `renderVoice` asks, on every road that redraws this page.
 */
function renderTts() {
  const toggle = document.getElementById("tts");
  if (toggle instanceof HTMLInputElement) toggle.checked = !config.ttsOff;
  setSpeechOff(config.ttsOff);
  renderDependents();
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
 * The language picked on this page for the voice row, for as long as the page
 * lives (D155): null until a hand picks one, and `voiceLanguage` answers for
 * the null. Not stored - the stored thing is the voice per language.
 *
 * @type {string | null}
 */
let voiceLang = null;

/**
 * @returns {string} the browser's own language, the voice row's default
 *   without a pair (D155, Michał's rule) - English where the browser names
 *   none, as `voiceLanguage` itself falls back to it
 */
function browserLanguage() {
  const language = primaryLanguage(navigator.language);
  return language === "" ? "en" : language;
}

/**
 * The languages the voice row offers, by their names in the reader's own
 * language: every language this device reads offline, and the pair's source
 * language even without a voice for it - that is the one the bubble reads
 * in, and the row must be able to say it has no voice. On a device that
 * lists no voices and has no pair, the browser's own language stands in:
 * the engine may still speak there (Android's clause), and a row with no
 * language at all could not even name its default line.
 *
 * @returns {string[]}
 */
function voiceLanguages() {
  const offered = new Set(canSpeak() ? offlineLanguages(speechSynthesis.getVoices()) : []);
  if (config.sourceLang !== null) offered.add(primaryLanguage(config.sourceLang));
  if (offered.size === 0) offered.add(browserLanguage());
  // By the name on screen, not the code behind it, the dictionary selects'
  // rule: nobody looks for Basque under e.
  return [...offered].sort((a, b) => languageName(a).localeCompare(languageName(b)));
}

/**
 * @returns {string | null} the language the voice row is about right now,
 *   read off its own select - the answer `renderVoice` last gave it
 */
function voiceRowLanguage() {
  const select = document.getElementById("tts-lang");
  return select instanceof HTMLSelectElement && select.value !== "" ? select.value : null;
}

/**
 * The voice row (D83, D155): a language, the device's offline voices able to
 * read it behind a first line that means "the device's default", and Listen.
 * The language is the pair's source unless a hand picked another here, and
 * without a pair the browser's own, else English (Michał's rule) - a fresh
 * install without a pair still reads articles aloud, and its settings page
 * had nothing to list until it could name a language (Michał's smoke,
 * 2026-08-29). Redrawn whenever the config may have moved and when the
 * engine's list arrives: `getVoices` answers nothing until the browser has
 * loaded the voices, and `voiceschanged` is the only appointment it keeps.
 * On a device that cannot speak at all the row stays, disabled - an honest
 * sentence about why the bubble shows no speaker there.
 */
function renderVoice() {
  const languageSelect = document.getElementById("tts-lang");
  const select = document.getElementById("tts-voice");
  if (!(languageSelect instanceof HTMLSelectElement) || !(select instanceof HTMLSelectElement)) {
    return;
  }

  const offered = voiceLanguages();
  const language = voiceLanguage(offered, {
    picked: voiceLang,
    source: config.sourceLang === null ? null : primaryLanguage(config.sourceLang),
    browser: browserLanguage(),
  });

  languageSelect.replaceChildren();
  for (const one of offered) {
    const option = document.createElement("option");
    option.value = one;
    option.textContent = languageName(one);
    option.selected = one === language;
    languageSelect.append(option);
  }

  const stored = language === null ? undefined : config.ttsVoices[language];
  const voices =
    canSpeak() && language !== null ? voicesFor(speechSynthesis.getVoices(), language) : [];

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

  // The device lists voices, and none of them reads this language offline
  // (D155) - the pair's language, listed without a voice exactly so this can
  // be said: the picker has its default line alone, the sentence under the
  // note says why, and Listen - which would be refused - waits.
  const mute = canSpeak() && language !== null && !canSpeakLang(language);
  const voiceStatus = document.getElementById("tts-voice-status");
  if (voiceStatus !== null) {
    voiceStatus.textContent = mute ? t("speech_no_offline_voice") : "";
    voiceStatus.hidden = !mute;
  }

  languageSelect.disabled = !canSpeak();
  select.disabled = !canSpeak();
  const listen = document.getElementById("tts-listen");
  if (listen instanceof HTMLButtonElement) listen.disabled = !canSpeak() || mute;
}

/**
 * The row notes' own More (D254, P5). Every note says one whole sentence,
 * always: the page used to clip each of them to two lines and an ellipsis in
 * mid-sentence, with a chevron beside it, which put grey noise in every row
 * and left no sentence anybody could finish reading. What is left over stands
 * in the paragraph under the note, hidden until the press - `hidden` and not a
 * clip, so a screen reader hears the sentence and the rest exactly as the eye
 * does, and so the search (D254) can open the one it matched.
 *
 * The button is markup, not something built here: which rows have more to say
 * is a fact about the catalogue, not about how a paragraph happens to wrap on
 * one screen, and the old measuring is what made a chevron promise more where
 * there was none.
 */
function moreNotes() {
  for (const button of document.querySelectorAll("button.note-more")) {
    if (!(button instanceof HTMLButtonElement)) continue;
    const rest = document.getElementById(button.getAttribute("aria-controls") ?? "");
    if (rest === null) {
      // A More with nothing behind it is a button that lies; there should be
      // none, and if the markup ever drifts the page drops it rather than
      // offering it.
      button.remove();
      continue;
    }
    armMore(button, rest);
  }
}

/**
 * One fold, wired: the trigger says whether it is open and the paragraph
 * behind it answers. The page's own Mores are wired once at the start
 * (`moreNotes`); a row the script draws - a dictionary's details - wires its
 * own as it is built, because there is no markup for it to be found in.
 *
 * @param {HTMLButtonElement} button
 * @param {HTMLElement} rest
 */
function armMore(button, rest) {
  button.addEventListener("click", () => {
    const opening = rest.hidden;
    rest.hidden = !opening;
    button.setAttribute("aria-expanded", String(opening));
  });
}

/**
 * The rows that only mean anything under another row (D254, §6.3): the voice
 * and its speed under reading aloud, the bubble switch under the mode. A
 * child is on the page exactly while its parent's box is ticked - `hidden`,
 * so it leaves the accessibility tree with the screen rather than standing
 * there as a control nobody can reach.
 *
 * The parent is named on the row (`data-parent`, its setting's name) and the
 * verdict is read off the parent's own box rather than the config: the box is
 * what the page is showing, and the two must never disagree mid-write.
 */
function renderDependents() {
  for (const row of document.querySelectorAll(".row[data-parent]")) {
    if (!(row instanceof HTMLElement)) continue;
    const parent = document.querySelector(`.row[data-setting="${row.dataset["parent"] ?? ""}"] input[type="checkbox"]`);
    if (!(parent instanceof HTMLInputElement)) continue;
    row.hidden = !parent.checked;
  }
}

/**
 * What was typed into a field is stored, said beside the field (D254, §6.5):
 * a name typed into a field that keeps it looks exactly like a name typed into
 * a field that lost it. The word stays until the next edit - never taken away
 * on a clock, because every disappearance is one more refresh of an e-ink
 * panel.
 *
 * @param {string} id the field's own id; its word is `<id>-saved`
 * @param {boolean} saved
 */
function tellSaved(id, saved) {
  const word = document.getElementById(`${id}-saved`);
  if (word !== null) word.hidden = !saved;
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
  if (value !== null) value.textContent = speedFactor(config.ttsRate);
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
  fill("storage-usage", report.usage === null ? "" : megabytes(report.usage));

  // Where the space went (F8). Each part counts what it holds, its copies
  // included; what the browser's estimate has over the four of them - the
  // databases' indexes, the caches, and a dictionary's several-fold cost over
  // the weight of its text - falls to Other, and the fold above says so. All
  // four come off metadata the page already reads: nothing here opens a
  // document or a dictionary row.
  const models = await listModels().catch(() => []);
  const dictionaries = await listDictionaries().catch(() => []);
  await completeLibraryCopy();
  const copy = effectiveLibraryCopy(config) ? await readLibraryCopy() : null;
  const vocabulary = await readBackupSummary();
  const marks = await readMarksBackup();

  const parts = {
    "storage-models": models.reduce((sum, model) => sum + model.bytes, 0),
    "storage-dictionaries": dictionaries.reduce((sum, one) => sum + one.bytes, 0),
    "storage-library": (await libraryBytes()) + (copy === null ? 0 : copy.bytes),
    // Measured on the copies, which hold the same phrases and the same
    // highlights as the live rows do - the live rows have no size written
    // down anywhere, and counting them would mean reading every one. Counted
    // once: whether the browser's estimate even sees the copies depends on
    // the engine (`storage.local` is its own store in Chromium), so doubling
    // would over-count there rather than under-count everywhere.
    "storage-phrases": (vocabulary?.bytes ?? 0) + (marks === null ? 0 : JSON.stringify(marks).length),
  };
  let known = 0;
  for (const [id, bytes] of Object.entries(parts)) {
    known += bytes;
    fill(id, megabytes(bytes));
  }
  fill("storage-other", megabytes(report.usage === null ? 0 : Math.max(0, report.usage - known)));

  const note = document.getElementById("storage-note");
  if (note === null) return;
  const kind = persistenceNote({ persisted: report.persisted, webkit: isWebKit() });
  note.hidden = kind === null;
  note.textContent =
    kind === "granted" ? t("options_storage_persistent") : kind === "at-risk" ? t("options_storage_at_risk") : "";

  // The three copies that outlive the database, each in three parts: what it
  // is, what it holds, and when it was last written (F8). A copy that does
  // not exist says so where its contents would stand, and the dash stands
  // where its date would.
  /** @param {number} at */
  const when = (at) => new Date(at).toLocaleString(uiLocale(), { dateStyle: "short", timeStyle: "short" });
  tellCopy("storage-backup", vocabulary === null ? null : plural(vocabulary.count, "options_copies_phrases"), vocabulary === null ? null : when(vocabulary.writtenAt));
  tellCopy("storage-marks-backup", marks === null ? null : plural(marksInBackup(marks), "options_copies_notes"), marks === null ? null : when(marks.writtenAt));
  // The reading list's copy says when it last changed, like the other two
  // (D260): the index it is accounted by is stamped at every write - a
  // document copied, a document deleted, a picture added - so this is the
  // last time the copy itself changed. An index written before the stamp
  // existed has none, and the line says so with a dash until the next change.
  tellCopy(
    "storage-library-copy",
    effectiveLibraryCopy(config)
      ? copy === null
        ? null
        : plural(copy.docs, "options_copies_docs", [megabytes(copy.bytes)])
      : t("options_copies_off"),
    copy === null || copy.writtenAt === null ? null : when(copy.writtenAt),
  );
}

/** Bytes a word of stored text costs, on the average of the languages re/read reads. */
const AVERAGE_WORD = 6;

/**
 * What the reading list holds, off the documents' own rows (F8): the pictures
 * are counted in bytes because their rows say so, and the text from what each
 * row knows of its length - a book its characters, an article its words. An
 * estimate, and the fold over the breakdown says the whole thing is one; what
 * it must not be is a read of every document each time this page opens.
 *
 * @returns {Promise<number>}
 */
async function libraryBytes() {
  const articles = await listArticles().catch(() => []);
  const books = await listBooks().catch(() => []);
  let bytes = 0;
  for (const article of articles) {
    bytes += article.pictures?.bytes ?? 0;
    bytes += (article.words ?? 0) * AVERAGE_WORD;
  }
  for (const book of books) {
    bytes += book.pictures?.bytes ?? 0;
    bytes += book.totalChars;
  }
  return bytes;
}

/**
 * One line of the copies block: what it holds and when it was written, or a
 * dash where there is no date to give.
 *
 * @param {string} id
 * @param {string | null} holds
 * @param {string | null} at
 */
function tellCopy(id, holds, at) {
  const row = document.getElementById(id);
  if (row === null) return;
  const what = row.querySelector(".copy-holds");
  const date = row.querySelector(".copy-when");
  if (what !== null) what.textContent = holds ?? t("options_copies_none");
  if (date !== null) date.textContent = at ?? "\u2014";
}

/**
 * Two places report, because there are two things to report about and they are
 * a screen apart. A download starts at the list of models, so that is where it
 * has to say how it went - a sentence about a failed download printed below the
 * file picker is a sentence nobody scrolls to.
 *
 * @param {"model-status" | "refresh-status" | "file-status" | "dictionary-status" | "dictionary-file-status" | "dictionary-link-status" | "dictionary-refresh-status" | "host-status"} id
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
 * last, and the block's own heading once none are left: since D263 the filter
 * belongs to the catalogue below, and the heading is what the row that was
 * deleted stood under. A heading is not focusable by itself, so it is made so
 * for the one moment it has to receive the focus.
 *
 * @param {string} containerId
 * @param {string} emptyId what takes the focus when the list has emptied
 * @param {number} at
 */
function focusDeleteIn(containerId, emptyId, at) {
  const deletes = deleteButtonsIn(containerId);
  const successor = deletes[Math.min(at, deletes.length - 1)];
  if (successor !== undefined) {
    successor.focus();
    return;
  }
  const heading = document.getElementById(emptyId);
  if (heading === null) return;
  if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
  heading.focus();
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
    meta.append(element("span", "", megabytes(row.installed.bytes)));

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
  focusDeleteIn("models", "translation-models-installed", at);
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
 * The choices are the pairs a phrase can be filed and answered under: the
 * models on this device, and the installed dictionaries' pairs (D158 - with
 * translation off the vocabulary lives on the dictionaries alone, so their
 * pairs must be choosable; see `pairChoices` for the rules, the
 * configured-but-deleted edge included). A pair only a dictionary vouches
 * for says so on its own line. With nothing installed the select explains
 * itself with one disabled line - the notes under it point at the sections
 * below either way, and the first model or dictionary sets the pair by
 * itself.
 *
 * @param {import("../lib/models/registry.js").ModelRow[]} rows
 */
async function renderPair(rows) {
  const select = document.getElementById("pair");
  if (!(select instanceof HTMLSelectElement)) return;

  const choices = pairChoices(rows, config, await listDictionaries());
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
    option.textContent = row.dictionaryOnly
      ? t("options_pair_dictionary_only", pairLabel(row.from, row.to))
      : pairLabel(row.from, row.to);
    option.selected = row.from === config.sourceLang && row.to === config.targetLang;
    select.append(option);
  }
}

/**
 * @param {string} pair
 */
async function choosePair(pair) {
  const rows = modelRows(await listModels(), availableModels());
  const row = pairChoices(rows, config, await listDictionaries()).find(
    (candidate) => candidate.pair === pair,
  );
  if (row === undefined) return;

  config = await writeConfig({ sourceLang: row.from, targetLang: row.to });
  // Every open page notices through `storage.onChanged` and asks the background
  // for the vocabulary of the new pair, so nothing here has to tell them.
  await renderModels();
  await renderCatalog();
  const modelHere = rows.some(
    (candidate) => candidate.pair === pair && candidate.installed !== null,
  );
  // With translation off the missing model is not missing anything - the
  // trim never asks the engine, and a warning about it would send somebody
  // to a section the switch has folded away.
  status(
    config.translationOff
      ? t("options_reading_pair_quiet", languageName(row.from))
      : modelHere
        ? t("options_reading_pair", [languageName(row.from), languageName(row.to)])
        : t("options_reading_pair_missing", [languageName(row.from), languageName(row.to)]),
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
 * @param {(query: string) => string} noMatch what the list says when the
 *   filter lets nothing through, in the words of the list it stands over
 */
function applyFilterIn(containerId, inputId, noneId, showAllId, expanded, noMatch) {
  const container = document.getElementById(containerId);
  if (container === null) return;

  const input = document.getElementById(inputId);
  const query = input instanceof HTMLInputElement ? input.value : "";

  // The rows the filter lets through, and the installed ones among them:
  // what the fold stands over and counts. Every row of either list says
  // whether it is installed; the models' rows and the dictionaries' are
  // shaped differently, and that is the one mark they share.
  // A query standing is a request to see what it matches (Michał,
  // 2026-09-19): the rows come out from behind the fold for as long as it
  // stands, and go back behind it when the field is cleared.
  const filtering = filterActive(query);

  let matching = 0;
  let installedMatching = 0;
  for (const row of container.querySelectorAll("[data-installed]")) {
    if (!(row instanceof HTMLElement)) continue;
    const installed = row.dataset["installed"] === "true";
    const matches = matchesFilter(row.dataset["search"] ?? "", query);
    if (matches) {
      matching += 1;
      if (installed) installedMatching += 1;
    }
    row.hidden = !rowVisible({ installed, matches, expanded, filtering });
  }

  // "The filter matched nothing" is only true of a filter: a folded list
  // showing none of its rows is answered by "Show all" below, not by this.
  // It quotes what was typed (D263, §7): on a page where two filters and a
  // search box stand within a screen of each other, a bare "nothing matches"
  // does not say which of them answered.
  const none = document.getElementById(noneId);
  if (none !== null) {
    none.hidden = !filtering || matching > 0;
    if (!none.hidden) none.textContent = noMatch(query.trim());
  }

  const showAll = document.getElementById(showAllId);
  if (showAll instanceof HTMLButtonElement) {
    const state = showAllState({ total: matching, installedCount: installedMatching, expanded, filtering });
    showAll.hidden = !state.shown;
    showAll.textContent = state.expanded ? t("options_show_fewer") : t("options_show_all", state.count.toLocaleString());
    showAll.setAttribute("aria-expanded", String(state.expanded));
  }
}

function applyModelFilter() {
  applyFilterIn("models-catalog", "model-filter", "model-none", "models-show-all", modelsExpanded, (query) =>
    t("options_filter_no_match_models", query),
  );
}

function applyCatalogFilter() {
  applyFilterIn(
    "dictionary-catalog",
    "dictionary-filter",
    "dictionary-none",
    "dictionaries-show-all",
    dictionariesExpanded,
    (query) => t("options_filter_no_match_dictionaries", query),
  );
}

/**
 * The press on a list's fold: unfolds it past its installed rows, or folds
 * it back (block 4 of the seventh brief). Unfolding walks the focus to the
 * first row it revealed - the same place the eye went; folding leaves it on
 * the button, which stays where it is to be pressed again.
 *
 * @param {"models-catalog" | "dictionary-catalog"} containerId
 */
function toggleList(containerId) {
  const opening = containerId === "models-catalog" ? !modelsExpanded : !dictionariesExpanded;
  if (containerId === "models-catalog") {
    modelsExpanded = opening;
    applyModelFilter();
  } else {
    dictionariesExpanded = opening;
    applyCatalogFilter();
  }
  if (!opening) return;
  // The first row on screen that the press revealed - not the first the
  // filter is hiding.
  const first = document.querySelector(`#${containerId} [data-installed="false"]:not([hidden]) button`);
  if (first instanceof HTMLElement) first.focus();
}

async function renderModels() {
  const container = document.getElementById("models");
  if (container === null) return;

  const stored = await listModels();
  const rows = orderForDisplay(modelRows(stored, availableModels()), config);

  // The select's choices ride the same read: a download or a delete lands in
  // the select at the very render that shows it in the list, with no reload.
  await renderPair(rows);

  // The model half of the first-steps verdict, from the store itself rather
  // than the view rows - the rows answer "what to draw", not "what is here".
  modelStored = stored.length > 0;
  renderFirstSteps();

  container.replaceChildren();

  // What is here, in the block that opens the subsection (D263), and what can
  // be fetched, in the catalogue below it. One render, two lists: the rows
  // come from one read of the store and one display order.
  const here = rows.filter((row) => row.installed !== null);
  sayCatalogHeading(
    "translation-models-available",
    t("options_list_available_models"),
    t("options_list_available_models_more"),
    here.length > 0,
  );
  if (here.length === 0) {
    container.append(
      emptyList(
        t("options_no_models_yet"),
        t("options_no_models_yet_rest"),
        "translation-models-available",
        "options_list_available_models",
      ),
    );
  } else {
    for (const row of here) {
      const rendered = renderRow(row);
      rendered.id = `model-${row.pair}`;
      container.append(rendered);
    }
  }

  const catalog = document.getElementById("models-catalog");
  if (catalog === null) return;
  catalog.replaceChildren();

  const offered = rows.filter((row) => row.installed === null);
  if (offered.length === 0) {
    catalog.append(element("p", "empty", t("options_no_models")));
  } else {
    for (const row of offered) {
      const rendered = renderRow(row);
      rendered.id = `model-${row.pair}`;
      rendered.dataset["search"] = searchableText(row);
      rendered.dataset["installed"] = "false";
      catalog.append(rendered);
    }

    // Lives inside the list so that "the filter matched nothing" is said
    // where the missing rows would have been, not somewhere below them.
    const none = element("p", "empty", "");
    none.id = "model-none";
    none.hidden = true;
    catalog.append(none);
  }

  applyModelFilter();
}

/**
 * The heading of a catalogue block, which says what a press there does - and
 * that depends on what is already here (Michał, 2026-09-19): "Download
 * dictionaries" while the device holds none, "Download more dictionaries"
 * once it holds one. The empty list's own door says the first of the two,
 * because an empty list is exactly when it is true.
 *
 * Both names arrive said, never glued from a key: a key built out of a value
 * is a key the catalogue tests cannot see (the rule `lib/messages.js` keeps).
 *
 * @param {string} id the heading's own id
 * @param {string} name what it says while nothing is here yet
 * @param {string} more what it says once something is
 * @param {boolean} anyHere
 */
function sayCatalogHeading(id, name, more, anyHere) {
  const heading = document.getElementById(id);
  if (heading !== null) heading.textContent = anyHere ? more : name;
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
 * Switches a site off by its typed address (D189), the popup's write by other
 * means: the popup reaches only the site somebody is standing on, and shows
 * its switch only while ordinary pages do anything at all - with the model
 * and the bubble both off it shows none, and somebody who read this section's
 * promise then found no switch (Gormagon's report of 0.5.47).
 */
async function addHostByHand() {
  const input = /** @type {HTMLInputElement | null} */ (document.getElementById("disabled-host"));
  const parsed = parseHostname(input?.value ?? "");
  if (!parsed.ok) {
    say("host-status", describeHostProblem(parsed.problem), "error");
    return;
  }
  const host = parsed.value;

  // Read fresh before writing, for the reason `restoreHost` does. Listed
  // under either of its names counts (D189): a www.reapps.eu from the popup
  // of an older version already covers reapps.eu.
  const current = await readConfig();
  const listed = current.disabledHosts.find((one) => sameSite(one, host));
  if (listed !== undefined) {
    say("host-status", t("options_host_listed", listed));
    return;
  }
  config = await writeConfig({ disabledHosts: [...current.disabledHosts, host] });
  renderDisabledHosts();
  if (input !== null) input.value = "";
  say("host-status", t("options_host_added", host));
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
 * The link fold's own line (D187): what a pasted address led to has to be
 * said next to the field it was pasted into.
 *
 * @param {string} text
 * @param {"idle" | "busy" | "error"} [tone]
 */
function dictionaryLinkStatus(text, tone = "idle") {
  say("dictionary-link-status", text, tone);
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
  // Said twice for the end of the list - the attribute and the state - so
  // an assistive technology that reads only one of them still hears it.
  if (button.disabled) button.setAttribute("aria-disabled", "true");
  // What the redraw after a move finds this button by - the row it belonged to
  // is gone by then, so the dictionary and the direction are the address.
  button.dataset["move"] = dictionary.id;
  button.dataset["step"] = String(step);

  const label = moveLabel(dictionary, step);
  button.setAttribute("aria-label", label);
  button.title = label;

  button.addEventListener("click", () => void moveDictionary(dictionary, step));
  return button;
}

/**
 * The sentence an arrow carries, naming the book by the name the reader
 * knows it by.
 *
 * @param {import("../lib/dict/store.js").Dictionary} dictionary
 * @param {number} step
 * @returns {string}
 */
function moveLabel(dictionary, step) {
  const shown = shownName(dictionary);
  return step < 0 ? t("options_move_dictionary_up_aria", shown) : t("options_move_dictionary_down_aria", shown);
}

/**
 * A row of the dictionary list, begun: the line every row opens with - the
 * pair, the badge of the pair being read, and room at its right edge for
 * the row's buttons - under a list item that stacks its lines. The same
 * stack at every width (the seventh brief, D2): a row is read top to bottom
 * on a phone and on a desktop alike, and its buttons keep one place.
 *
 * @param {string} from
 * @param {string} to
 * @returns {{ row: HTMLElement, head: HTMLElement }}
 */
function dictionaryRow(from, to) {
  const row = element("li", "dictionary-row");
  const head = element("div", "dictionary-head");
  head.append(element("span", "dictionary-pair", pairLabel(from, to)));
  if (from === config.sourceLang && to === config.targetLang) {
    head.append(element("span", "badge", t("options_badge_reading")));
  }
  row.append(head);
  return { row, head };
}

/**
 * The row's buttons, in the head's right edge: a group that never wraps
 * inside itself, so a narrow screen moves the whole of it under the pair.
 *
 * @param {HTMLElement} head
 * @param {HTMLElement[]} buttons
 */
function placeActions(head, buttons) {
  const actions = element("span", "dictionary-actions");
  actions.append(...buttons);
  head.append(actions);
}

/**
 * A row's line of small print, its items apart by a middle dot: the language
 * the book explains words in - or the one word for a book that explains a
 * language in itself - the count of its words and its size.
 *
 * Since Michał's second round on the panels it stands **inside** the fold
 * rather than on the row: a list of books is scanned by their names, and the
 * row is one line - the name, the door and the buttons - with everything else
 * a press away. Until then it was the row's second line and the fold's own
 * summary (D263, L1).
 *
 * The space before each dot is the no-break kind, so a line never opens with
 * a dot.
 *
 * @param {HTMLElement} meta the paragraph to fill, emptied first
 * @param {import("../lib/dict/store.js").Dictionary} dictionary
 */
function fillDictionaryMeta(meta, dictionary) {
  /** @type {(string | HTMLElement)[]} */
  const items = [];
  items.push(
    element(
      "span",
      "dictionary-count",
      dictionary.langFrom === dictionary.langTo
        ? t("options_dictionary_monolingual")
        : t("options_dictionary_into", languageName(dictionary.langTo)),
    ),
  );
  items.push(element("span", "dictionary-count", words(dictionary.entryCount)));
  items.push(element("span", "dictionary-count", megabytes(dictionary.bytes)));

  meta.replaceChildren();
  items.forEach((item, at) => {
    if (at > 0) meta.append("\u00a0· ");
    meta.append(item);
  });
}

/**
 * A stored dictionary's row, in two lines (D263, L1): the name the reader
 * knows the book by and the buttons on the first, its small print on the
 * second - and the second line is the fold's own summary, so "Details" stands
 * at the end of a line that is already there instead of opening a fourth.
 *
 * The pair used to open the row. It does not any more: the language a
 * dictionary explains is the heading its group stands under, and the language
 * it explains into is the first item of the small print - said once each,
 * where five rows of "English to Polish" said it five times.
 *
 * @param {import("../lib/dict/store.js").Dictionary} dictionary
 * @param {{ at: number, total: number }} place among the dictionaries of its
 *   own language, which is what the arrows move it within
 * @returns {HTMLElement}
 */
function renderDictionary(dictionary, place) {
  const row = element("li", "dictionary-row");
  const head = element("div", "dictionary-head");
  const shown = shownName(dictionary);
  head.append(element("p", "dictionary-name", shown));
  row.append(head);

  if (dictionary.id === deletingId) {
    // Going: the small print gives way to the one word that says so, and
    // the buttons go with it - there is nothing left to press on this row.
    row.append(element("p", "dictionary-meta", t("options_deleting_row")));
    return row;
  }

  if (!dictionary.ready) {
    renderUnfinished(row, head, dictionary);
    return row;
  }

  /** @type {HTMLElement[]} */
  const buttons = [];
  // Only where there is something to arrange: one dictionary of a language
  // answers first whatever the arrows say, and two dead buttons on its row
  // would be a control that does nothing standing next to one that deletes.
  if (place.total > 1) {
    buttons.push(moveButton(dictionary, -1, place.at > 0));
    buttons.push(moveButton(dictionary, 1, place.at < place.total - 1));
  }
  buttons.push(
    deleteButton({
      name: shown,
      restAria: t("options_delete_dictionary_aria", shown),
      disabled: importing,
      onConfirm: (button) => void removeDictionary(dictionary, button),
    }),
  );
  // The fold every finished book ends with (block 2 of the seventh brief):
  // the small print, the name the reader may give it instead of the file's
  // (D199), the file's name said in full - here it is information, not a
  // repeat - and, when the book wrote one, its attribution: the dictionaries
  // worth having are Wiktionary-derived and CC BY-SA, and naming their source
  // is the whole of what that asks for. Folded, not gone - the row stays one
  // line to scan, the rarely-used field is not a field per row on a list of
  // hundreds, and the credit stays one press away, exactly as the dictionary
  // wrote it. An unfinished book gets none of this: it is still being named
  // by its files.
  //
  // The page's own fold rather than a `<details>` (Michał's second round):
  // every other fold on this page is a trigger and a paragraph it names with
  // `aria-controls`, and the door has to stand on the row's first line, which
  // a summary wrapping the whole thing cannot do.
  const body = element("div", "dictionary-body");
  body.id = `dictionary-more-${dictionary.id}`;
  body.hidden = true;

  const more = document.createElement("button");
  more.type = "button";
  more.className = "note-more dictionary-more";
  more.textContent = t("options_details");
  more.setAttribute("aria-expanded", "false");
  more.setAttribute("aria-controls", body.id);
  more.setAttribute("aria-label", t("options_dictionary_details_aria", shown));
  armMore(more, body);
  head.append(more);

  const meta = element("p", "dictionary-meta");
  fillDictionaryMeta(meta, dictionary);
  body.append(meta);
  body.append(renameField(dictionary));
  // Only where the file's own name says something the title does not (V10,
  // D263): under a field whose placeholder is that very name, "File name:
  // dictionary" was the same word twice.
  if (fileNameWorthSaying(dictionary)) {
    body.append(element("p", "dictionary-file-name", t("options_dictionary_file_name", dictionary.name)));
  }
  if (dictionary.aliasCount > 0) {
    body.append(element("p", "dictionary-file-name", plural(dictionary.aliasCount, "spellings")));
  }
  if (dictionary.credit !== null) body.append(element("p", "dictionary-credit", dictionary.credit));
  placeActions(head, buttons);
  row.append(body);

  return row;
}

/**
 * Everything on a row that says the book's name, said again after the name
 * changed (block 2 of the seventh brief): the title, the small print (the
 * file's name stands there only while it differs), the arrows' and Delete's
 * sentences, and what the filter finds the row by. In place, on the row
 * that is there: a redraw of the list would shut the fold the name was
 * typed in and drop the focus on the page's floor.
 *
 * @param {HTMLElement} row
 * @param {import("../lib/dict/store.js").Dictionary} dictionary as the store now has it
 */
function refreshRowName(row, dictionary) {
  const shown = shownName(dictionary);
  const title = row.querySelector(".dictionary-name");
  if (title !== null) title.textContent = shown;
  const meta = row.querySelector(".dictionary-meta");
  if (meta instanceof HTMLElement) fillDictionaryMeta(meta, dictionary);

  for (const step of [-1, 1]) {
    const arrow = moveButtonFor(dictionary.id, step);
    if (arrow === null) continue;
    const label = moveLabel(dictionary, step);
    arrow.setAttribute("aria-label", label);
    arrow.title = label;
  }

  // The door to the details says which book's details it opens.
  const more = row.querySelector("button.dictionary-more");
  if (more instanceof HTMLButtonElement) more.setAttribute("aria-label", t("options_dictionary_details_aria", shown));

  const remove = row.querySelector("button.model-delete");
  if (remove instanceof HTMLButtonElement) {
    const restAria = t("options_delete_dictionary_aria", shown);
    remove.dataset["name"] = shown;
    remove.dataset["restAria"] = restAria;
    // An armed Delete is asking "Sure?" about this very book; its sentence
    // is rebuilt from the name at the press, and stands down to the rest one.
    if (!remove.hasAttribute("data-armed")) remove.setAttribute("aria-label", restAria);
  }

  row.dataset["search"] = dictionarySearchText(dictionary);
}

/**
 * What the filter finds a stored book's row by: the pair either way it is
 * spelled, the file's name, and the name the reader gave it (D199).
 *
 * @param {import("../lib/dict/store.js").Dictionary} dictionary
 * @returns {string}
 */
function dictionarySearchText(dictionary) {
  const own = dictionary.displayName === undefined ? "" : ` ${dictionary.displayName.toLowerCase()}`;
  return `${searchableText({ from: dictionary.langFrom, to: dictionary.langTo })} ${dictionary.name.toLowerCase()}${own}`;
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
 * @param {HTMLElement} row the list item, its head and name already in
 * @param {HTMLElement} head the row's first line, where the buttons go
 * @param {import("../lib/dict/store.js").Dictionary} dictionary
 */
function renderUnfinished(row, head, dictionary) {
  const progress = dictionary.progress;
  const standing = importElsewhere
    ? t("options_import_elsewhere")
    : progress === undefined
      ? t("options_import_interrupted_early")
      : t("options_import_interrupted", [progress.done.toLocaleString(), progress.total.toLocaleString()]);
  row.append(element("p", "dictionary-meta", standing));

  const go = document.createElement("button");
  go.type = "button";
  go.textContent = t("options_continue_import");
  go.setAttribute("aria-label", t("options_continue_import_aria", dictionary.name));
  go.disabled = importing || importElsewhere;
  go.addEventListener("click", () => void resumeImport(dictionary));
  placeActions(head, [
    go,
    deleteButton({
      name: dictionary.name,
      restAria: t("options_delete_dictionary_aria", dictionary.name),
      disabled: importing || importElsewhere,
      onConfirm: (button) => void removeDictionary(dictionary, button),
    }),
  ]);
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
  for (const button of document.querySelectorAll("#dictionary-list button.model-move")) {
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

  const order = moveWithinSourceLanguage(dictionaryPlaces, dictionary.id, step);
  if (order === null) return;

  try {
    await reorderDictionaries(order);
  } catch (error) {
    dictionaryStatus(t("options_reorder_failed", message(error)), "error");
    return;
  }

  await renderCatalog();

  // From the list the redraw just read, not from the list that was written: a
  // second page importing at that moment is part of the order now. The place
  // said out loud is the place in its own group (D263) - the list on screen
  // is grouped, and "third of seven" would name a row nobody can see.
  const group = dictionaryPlaces.filter((one) => one.lang === dictionary.langFrom);
  const at = group.findIndex((one) => one.id === dictionary.id);
  if (at >= 0) {
    dictionaryStatus(
      t("options_dictionary_moved", [
        shownName(dictionary),
        (at + 1).toLocaleString(),
        group.length.toLocaleString(),
        languageName(dictionary.langFrom),
      ]),
    );
  }
  focusMove(dictionary.id, step);
}

/**
 * The field a stored dictionary's own name is typed into (D199): the name its
 * groups stand under on the shelf - the panel, the popup, the bubble - and
 * the title of its row here, in place of what its file calls it. The file's
 * name is the placeholder, so an empty field says what it means; the field
 * stops where the record would cut.
 *
 * Saved when the field is left or Enter is pressed (`change`), not on every
 * keystroke: a name is a decision, and a half-typed one would be a database
 * write per letter. A label around the field is what a press on the caption
 * focuses; the accessible name says which dictionary's, since every row has
 * a field captioned the same.
 *
 * @param {import("../lib/dict/store.js").Dictionary} dictionary
 * @returns {HTMLElement}
 */
function renameField(dictionary) {
  const line = element("label", "dictionary-rename");
  line.append(element("span", "dictionary-rename-label", t("options_dictionary_display_name")));

  const field = document.createElement("input");
  field.type = "text";
  field.className = "dictionary-rename-field";
  field.maxLength = DISPLAY_NAME_LIMIT;
  field.placeholder = dictionary.name;
  field.value = dictionary.displayName ?? "";
  field.autocomplete = "off";
  field.spellcheck = false;
  field.setAttribute("aria-label", t("options_dictionary_display_name_aria", dictionary.name));
  // Held like the arrows while an import writes to this database: the redraw
  // at its end would take a half-typed name with it.
  field.disabled = importing;
  field.addEventListener("change", () => void renameFromField(dictionary, field));
  line.append(field);
  return line;
}

/**
 * What a change of the field does: the typed name, cleaned, becomes the
 * dictionary's own - or, emptied, gives the file's name back - and the row
 * says the new name at once, in place (`refreshRowName`): no redraw, so the
 * fold stays open and the focus stays in the field, and no sentence in the
 * status line - the title changing is the answer. Refused when another
 * dictionary is already shown under it, over the list as the store has it
 * now (a second page may have named one since this list was drawn): the
 * field goes back to what it held and the section's status line says why,
 * since a name that silently came back would read as a broken field.
 *
 * @param {import("../lib/dict/store.js").Dictionary} dictionary the row's own
 *   record, which learns the name so the row's later actions say it too
 * @param {HTMLInputElement} field
 */
async function renameFromField(dictionary, field) {
  const wanted = cleanDisplayName(field.value);
  const held = dictionary.displayName ?? null;
  if (wanted === held) {
    // Nothing to write - spaces around the same name, say - but the field
    // shows the name as the record would have kept it.
    field.value = held ?? "";
    return;
  }

  if (wanted !== null && nameHolder(await listDictionaries(), dictionary.id, wanted) !== null) {
    field.value = held ?? "";
    dictionaryStatus(t("options_dictionary_name_taken", wanted), "error");
    return;
  }

  try {
    await renameDictionary(dictionary.id, wanted);
  } catch (error) {
    field.value = held ?? "";
    dictionaryStatus(t("options_rename_failed", message(error)), "error");
    return;
  }

  if (wanted === null) delete dictionary.displayName;
  else dictionary.displayName = wanted;
  field.value = wanted ?? "";
  const row = field.closest(".dictionary-row");
  if (row instanceof HTMLElement) refreshRowName(row, dictionary);
}

/**
 * The confirmed second press of a stored dictionary's Delete.
 *
 * @param {import("../lib/dict/store.js").Dictionary} dictionary
 * @param {HTMLButtonElement} button
 */
async function removeDictionary(dictionary, button) {
  if (importing) return;
  const at = deleteButtonsIn("dictionary-list").indexOf(button);

  // Held like an import, because it is the same thing to the database: one
  // writer at a time, the other buttons wait, a reload asks first. Said in
  // the status line and on the row itself before the first byte goes, since
  // for a million rows the delete is a transaction of tens of seconds on a
  // tablet with nothing to show for it until it commits.
  importing = true;
  deletingId = dictionary.id;
  const letGo = holdScreen();
  const shown = shownName(dictionary);
  dictionaryStatus(t("options_deleting_dictionary", shown), "busy");
  await renderCatalog();

  try {
    await deleteDictionary(dictionary.id);
    dictionaryStatus(t("options_deleted_dictionary", shown));
    // The forms this book vouched for go with it (D208).
    refreshForms();
  } catch (error) {
    dictionaryStatus(t("options_delete_dictionary_failed", [shown, message(error)]), "error");
  } finally {
    letGo();
    deletingId = null;
    importing = false;
  }
  await renderCatalog();
  // The pair select lists the dictionaries' pairs too (D158), and one of
  // them may have just left with its last book.
  await renderPair(modelRows(await listModels(), availableModels()));
  focusDeleteIn("dictionary-list", "dictionaries-installed", at);
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
  const { row, head } = dictionaryRow(entry.from, entry.to);

  const get = document.createElement("button");
  get.type = "button";
  get.textContent = t("action_download");
  get.disabled = running !== null || importing;
  get.addEventListener("click", () => void downloadDictionary(entry));
  placeActions(head, [get]);
  return row;
}

/**
 * The line a list shows in place of its rows when there is nothing on this
 * device yet: a sentence, and the name of the block below it as the way
 * there (D263, §4). A link rather than the block's name in quotes: the two
 * blocks stand one above the other, and the eye that has just read "there is
 * nothing here" is looking for where to go.
 *
 * @param {string} sentence the sentence up to the door
 * @param {string} rest what follows it
 * @param {string} anchor the id of the catalogue block's heading
 * @param {string} name the catalogue block's own name, so the door says what
 *   the heading it lands on says
 * @returns {HTMLElement}
 */
function emptyList(sentence, rest, anchor, name) {
  const line = element("p", "empty");
  const door = document.createElement("a");
  door.href = `#${anchor}`;
  door.textContent = t(name);
  line.append(`${sentence} `, door, ` ${rest}`);
  return line;
}

/**
 * The stored dictionaries in groups, by the language whose words they explain
 * (D263, L2).
 *
 * That language is the only thing the order means anything within: a lookup
 * asks the dictionaries of the language being read and no others
 * (`lookupEntries` matches on `langFrom`), so the arrows arrange inside a
 * group and the badge of the pair being read belongs to a whole group rather
 * than to the rows whose target language happens to match the pair's.
 *
 * The group of the language being read stands first - those are the
 * dictionaries answering today - and the rest by name in the page's own
 * language, which is the order a reader looks a language up in.
 *
 * @param {import("../lib/dict/store.js").Dictionary[]} stored in answering order
 * @returns {{ lang: string, name: string, dictionaries: import("../lib/dict/store.js").Dictionary[] }[]}
 */
function dictionaryGroups(stored) {
  /** @type {Map<string, import("../lib/dict/store.js").Dictionary[]>} */
  const byLanguage = new Map();
  for (const dictionary of stored) {
    const group = byLanguage.get(dictionary.langFrom) ?? [];
    group.push(dictionary);
    byLanguage.set(dictionary.langFrom, group);
  }

  const collator = new Intl.Collator(uiLocale());
  return [...byLanguage.entries()]
    .map(([lang, dictionaries]) => ({ lang, name: languageName(lang), dictionaries }))
    .sort((one, two) => {
      const reading = (/** @type {{ lang: string }} */ group) => (group.lang === config.sourceLang ? 0 : 1);
      return reading(one) - reading(two) || collator.compare(one.name, two.name);
    });
}

/**
 * One group's heading: the language, and the badge when its dictionaries are
 * the ones the bubble is asking. It is a card's own label (D265), so it wears
 * the label's class and the card draws the hairline over it.
 *
 * @param {{ lang: string, name: string }} group
 * @returns {HTMLElement}
 */
function dictionaryGroupHeading(group) {
  const heading = element("h5", "dictionary-group card-head", group.name);
  if (group.lang === config.sourceLang) heading.append(element("span", "badge", t("options_badge_reading")));
  return heading;
}

/**
 * The dictionaries on this device: the rows with their arrows and their
 * delete buttons, under a heading per language where there is more than one
 * (D263). With a single language there is no heading - one group is not a
 * grouping, and the badge would then say of the whole list what the page
 * already says above it.
 *
 * @param {import("../lib/dict/store.js").Dictionary[]} stored in answering order
 */
function renderDictionaryList(stored) {
  const list = document.getElementById("dictionary-list");
  if (list === null) return;
  list.replaceChildren();

  if (stored.length === 0) {
    list.append(
      emptyList(
        t("options_no_dictionaries_yet"),
        t("options_no_dictionaries_yet_rest"),
        "dictionaries-available",
        "options_list_available_dictionaries",
      ),
    );
    return;
  }

  const groups = dictionaryGroups(stored);
  for (const group of groups) {
    if (groups.length > 1) list.append(dictionaryGroupHeading(group));
    const rows = element("ul", "models");
    group.dictionaries.forEach((dictionary, at) => {
      const row = renderDictionary(dictionary, { at, total: group.dictionaries.length });
      row.dataset["search"] = dictionarySearchText(dictionary);
      rows.append(row);
    });
    list.append(rows);
  }
}

/**
 * Both dictionary lists, out of one read of the store: what is here, and what
 * the catalogue offers that is not. Redrawn at the edges of every download,
 * import and delete, and after a list refresh.
 */
async function renderCatalog() {
  const container = document.getElementById("dictionary-catalog");
  if (container === null) return;

  const stored = await listDictionaries();
  // Read once per redraw, for every unfinished row: whether its import is
  // running somewhere (then its buttons wait) or stopped (then it may go on).
  importElsewhere = !importing && (await importHeld());

  // What an arrow press moves within, read at the one moment the store was.
  dictionaryPlaces = stored.map((one) => ({ id: one.id, lang: one.langFrom }));
  sayCatalogHeading(
    "dictionaries-available",
    t("options_list_available_dictionaries"),
    t("options_list_available_dictionaries_more"),
    stored.length > 0,
  );

  // The dictionary half of the first-steps verdict. Ready ones only: a
  // half-imported dictionary answers no lookup, and must not fold the
  // instructions away.
  dictionaryStored = stored.some((one) => one.ready);
  renderFirstSteps();

  renderDictionaryList(stored);

  // The catalogue alone below: a pair already answered for is not offered
  // again, and the rows that are here stand in the block above.
  const rows = dictionaryRows(stored, availableDictionaries(), config).filter((row) => row.available !== null);

  container.replaceChildren();

  if (rows.length === 0) {
    container.append(element("li", "empty", t("options_no_catalog")));
  } else {
    for (const row of rows) {
      const available = row.available;
      if (available === null) continue;
      const rendered = renderCatalogRow(available);
      rendered.id = catalogRowId(available);
      rendered.dataset["search"] = searchableText(row);
      rendered.dataset["installed"] = "false";
      container.append(rendered);
    }

    const none = element("li", "empty", "");
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
  const head = element("div", "dictionary-head");
  head.append(element("span", "dictionary-pair", pairLabel(entry.from, entry.to)));

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = t("action_cancel");
  cancel.addEventListener("click", () => {
    cancel.disabled = true;
    controller.abort();
  });
  placeActions(head, [cancel]);

  const bar = document.createElement("progress");
  bar.className = "model-progress";

  const size = element("span", "", "");

  const meta = element("p", "dictionary-meta dictionary-fetching");
  meta.append(bar, size);

  container.append(head, meta);

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
 * @param {{ anyHost?: boolean }} [options] `anyHost` for an address the reader pasted (D187): followed wherever its host sends it
 * @returns {Promise<{ ok: true, value: { base: string, files: import("../lib/dict/import.js").DictionaryFiles, host: string } } | { ok: false, text: string, tone: "idle" | "error" }>}
 *   `host` is the one that answered - the one asked, unless the address led elsewhere
 */
async function fetchDictionaryFiles(url, signal, onProgress, { anyHost = false } = {}) {
  const result = await downloadArchive(url, { signal, onProgress, anyHost });
  if (!result.ok) {
    return {
      ok: false,
      text: describeDictDownloadProblem(result.problem, result.detail),
      tone: result.problem === "cancelled" ? "idle" : "error",
    };
  }

  // Only the dictionary's own files are inflated: the pictures a Wiktionary
  // build ships beside them by the hundred stay packed and cost nothing.
  const zip = await readZip(result.value, { wanted: isDictionaryFile });
  if (!zip.ok) return { ok: false, text: describeZipProblem(zip.problem, zip.detail), tone: "error" };

  const sorted = dictionaryFromZip(zip.value);
  if (!sorted.ok) {
    return { ok: false, text: describeImportProblem(sorted.problem, sorted.detail), tone: "error" };
  }

  return { ok: true, value: { ...sorted.value, host: result.host } };
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
  await adoptDictionaryPair(ready.langFrom, ready.langTo);
  // A new book may vouch for forms the shelf did not before (D208).
  refreshForms();
  // The pair select lists the dictionaries' pairs too (D158): a fresh pair
  // lands in it with the book that brought it.
  await renderPair(modelRows(await listModels(), availableModels()));
  return true;
}

/**
 * A dictionary arriving on a device with no pair chosen brings its pair,
 * the way the first model does (`adoptFirstPair`): whoever just imported an
 * en->en dictionary plainly means to read English, and the quiet vocabulary
 * (D158) needs a pair to file phrases under before anything can be saved
 * without the engine. A chosen pair is never touched - by then it is a real
 * choice, already made.
 *
 * @param {string} from
 * @param {string} to
 */
async function adoptDictionaryPair(from, to) {
  if (config.sourceLang !== null) return;
  // A monolingual book adopts its own pair only as the last resort (D166):
  // where a model or another book already reads its language into another,
  // that pair is the shelf, and the monolingual book answers under it. The
  // select's own rule says which - the pair it offers for the language.
  const shelf =
    from === to
      ? pairChoices(modelRows(await listModels(), availableModels()), config, await listDictionaries()).find(
          (choice) => choice.from === from && choice.to !== from,
        )
      : undefined;
  config = await writeConfig(
    shelf === undefined ? { sourceLang: from, targetLang: to } : { sourceLang: shelf.from, targetLang: shelf.to },
  );
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

/**
 * Fetches a dictionary from an address the reader pasted, and adds it (D187).
 *
 * The catalogue's road with the reader's own address on it: the same
 * download, the same zip reader, the same importer, the same one-at-a-time
 * rule - and two things of its own. The address is judged first (`link.js`),
 * before a byte is asked for. And the answer may come from another host than
 * the one pasted, because a link a person copied is theirs to follow wherever
 * its host sends it, the way the browser's own download would go; where it
 * led is said on the status line once the dictionary is in, so the fold never
 * quietly names one server and reads from another.
 *
 * The language sides come from the fold's own selects, as for files: an
 * archive's name says nothing reliable about them, and the .ifo's `lang`
 * field is nobody's standard.
 */
async function downloadFromLink() {
  if (importing || running !== null) return;

  const input = /** @type {HTMLInputElement | null} */ (document.getElementById("dictionary-link"));
  const parsed = parseDictionaryLink(input?.value ?? "");
  if (!parsed.ok) {
    dictionaryLinkStatus(describeLinkProblem(parsed.problem), "error");
    return;
  }
  const url = parsed.value;
  const asked = new URL(url).host;
  const langFrom = chosenLanguage("link-from", config.sourceLang ?? "");
  const langTo = chosenLanguage("link-to", config.targetLang ?? "");

  importing = true;
  const letGo = holdScreen();
  const controller = new AbortController();
  await renderCatalog();

  // The fold's own progress row, shown for the download and gone after it:
  // the catalogue's bar, with the chosen pair for a name.
  const row = document.getElementById("dictionary-link-row");
  /** @type {((progress: import("../lib/dict/download.js").DictDownloadProgress) => void) | undefined} */
  let onProgress;
  if (row !== null) {
    row.hidden = false;
    onProgress = renderFetching(row, { from: langFrom, to: langTo, url }, controller);
  }
  dictionaryLinkStatus(t("options_downloading_link", asked), "busy");

  try {
    const fetched = await fetchDictionaryFiles(url, controller.signal, onProgress, { anyHost: true });
    if (!fetched.ok) {
      dictionaryLinkStatus(fetched.text, fetched.tone);
      return;
    }

    // Where the bytes came from rides on the import's last line rather than
    // standing before it: the import's own lines would paint over it at once.
    const { host } = fetched.value;
    /** @type {(text: string, tone?: "idle" | "busy" | "error") => void} */
    const say = (text, tone = "idle") =>
      dictionaryLinkStatus(tone === "idle" && host !== asked ? `${text} ${t("options_link_answered_by", host)}` : text, tone);

    let stored = false;
    const ran = await withImportLock(async () => {
      stored = await storeDictionary(fetched.value.files, { base: fetched.value.base, langFrom, langTo, say });
    });
    if (!ran) dictionaryLinkStatus(t("options_import_elsewhere"), "error");
    if (stored && input !== null) input.value = "";
  } finally {
    if (row !== null) {
      row.hidden = true;
      row.replaceChildren();
    }
    letGo();
    importing = false;
    await renderCatalog();
  }
}

async function render() {
  config = await readConfig();
  os = await platformOs();
  // The card's own state and the browser's answer about the toolbar, both
  // read once: neither changes with a model or a dictionary, and the card
  // redraws on every one of those.
  stepsState = await readSteps();
  pinnedNow = await pinnedByBrowser();
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
  linkSources(webext().runtime.getManifest().version);
  renderReaderOnly();
  renderPageNumber();
  renderTurning();
  renderQuietBubble();
  renderBubbleMore();
  renderUnderlineForms();
  renderSaveSentence();
  renderKeepArticles();
  renderLibraryCopy();
  renderFontCustom();
  renderPace();
  renderCustomCss();
  renderNoTranslation();
  renderBubbleScale();
  renderTts();
  renderVoice();
  renderRate();
  // Its own promise: the storage row waits on the engine, and nothing else on
  // this page should wait with it.
  void renderStorage();
  // With no pair chosen the selects open on their first language rather than
  // a preselected one - the import's own selects are still the full list.
  renderLanguageChoices("dictionary-from", config.sourceLang ?? "");
  renderLanguageChoices("dictionary-to", config.targetLang ?? "");
  renderLanguageChoices("link-from", config.sourceLang ?? "");
  renderLanguageChoices("link-to", config.targetLang ?? "");
  linkDictionarySources();

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
  renderPageNumber();
  renderTurning();
  renderQuietBubble();
  renderBubbleMore();
  renderUnderlineForms();
  renderSaveSentence();
  renderKeepArticles();
  renderLibraryCopy();
  renderFontCustom();
  renderPace();
  renderCustomCss();
  renderNoTranslation();
  renderBubbleScale();
  renderTts();
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
    await renderPair(modelRows(await listModels(), availableModels()));
  }
}

webext().storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || changes[CONFIG_KEY] === undefined) return;
  void refresh();
});

// The engine's voice list arrives on its own schedule - after first paint on
// desktop, sometimes never on Android - and the select redraws when it does.
// The bare API question: the listener watches the engine, whatever the switch
// says (D148), and the select it redraws asks `canSpeak` itself.
if (speechSupported()) speechSynthesis.addEventListener("voiceschanged", renderVoice);

document.getElementById("reader-only")?.addEventListener("change", (event) => {
  const toggle = event.target;
  if (!(toggle instanceof HTMLInputElement)) return;
  // Open pages notice through `storage.onChanged` and change modes on the
  // spot - the launcher appears or the reading side starts, with no reload.
  void writeConfig({ readerOnly: toggle.checked }).then((written) => {
    config = written;
  });
});
document.getElementById("page-number")?.addEventListener("change", (event) => {
  const toggle = event.target;
  if (!(toggle instanceof HTMLInputElement)) return;
  // The same road (D238): a reader open by pages hears it through storage,
  // gives the foot its line or takes it back, and keeps the page it is on.
  void writeConfig({ reader: { pageNumber: toggle.checked } }).then((written) => {
    config = written;
  });
});
document.getElementById("touch-turn")?.addEventListener("change", (event) => {
  const select = event.target;
  if (!(select instanceof HTMLSelectElement) || !isTouchTurn(select.value)) return;
  // The line under the select answers at once, before the write comes back
  // through storage: the choice is made here, and what it means should not
  // arrive a beat later.
  sayGesture(select.value);
  // The same road (D250): a reader open by pages hears it through storage,
  // and the next touch is read the new way. What is stored is a name and
  // never the null the default stands for - a press here is a choice made.
  void writeConfig({ reader: { touchTurn: select.value } }).then((written) => {
    config = written;
  });
});
document.getElementById("turn-effect")?.addEventListener("change", (event) => {
  const select = event.target;
  if (!(select instanceof HTMLSelectElement) || !isTurnEffect(select.value)) return;
  sayEffect(select.value);
  // The same road (D251): the next turn is dressed the way the select now
  // says, in every open reader, with no reload.
  void writeConfig({ reader: { turnEffect: select.value } }).then((written) => {
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
document.getElementById("bubble-more")?.addEventListener("change", (event) => {
  const toggle = event.target;
  if (!(toggle instanceof HTMLInputElement)) return;
  // The same road again (D186): the next bubble over a selection opens its
  // layer the way the box now says, on every open page, with no reload.
  void writeConfig({ showBubbleMore: toggle.checked }).then((written) => {
    config = written;
  });
});
document.getElementById("underline-forms")?.addEventListener("change", (event) => {
  const toggle = event.target;
  if (!(toggle instanceof HTMLInputElement)) return;
  // The pages hear the switch through storage and drop the forms on the
  // spot when it goes off (D208); turned on, they have nothing to match
  // until the background has computed the forms - so it is asked to, once
  // the switch is written and it can read it.
  void writeConfig({ underlineForms: toggle.checked }).then((written) => {
    config = written;
    refreshForms();
  });
});
document.getElementById("save-sentence")?.addEventListener("change", (event) => {
  const toggle = event.target;
  if (!(toggle instanceof HTMLInputElement)) return;
  // Read fresh by the background on every save (D210), so the very next
  // Save on any open page obeys the box - nothing to redraw here, nothing
  // to tell the pages.
  void writeConfig({ saveSentence: toggle.checked }).then((written) => {
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
// The reading font's name (D163), committed on change - blur or Enter - and
// not per keystroke: a storage write per letter would ping every open page
// for nothing. Typing a name is choosing it, so a non-empty name also sets
// the Type row's choice to Custom; an emptied field lets the config heal
// that choice back to the default preset. The name is cleaned before the
// write (the config would clean it again anyway), and what was actually
// stored comes back into the field.
document.getElementById("font-custom")?.addEventListener("change", (event) => {
  const field = event.target;
  if (!(field instanceof HTMLInputElement)) return;
  const name = cleanFontFamily(field.value);
  void writeConfig({
    reader: name.length > 0 ? { fontFamily: name, font: "custom" } : { fontFamily: name },
  }).then((written) => {
    config = written;
    renderFontCustom();
    tellSaved("font-custom", true);
  });
});
// The preview follows every keystroke; only the stored value waits for the
// change. Enter commits the way it does everywhere: by leaving the field.
document.getElementById("font-custom")?.addEventListener("input", (event) => {
  const field = event.target;
  if (field instanceof HTMLInputElement) previewFontFamily(field);
  // The word goes on the first keystroke after it: what stands in the field
  // is no longer what was stored.
  tellSaved("font-custom", false);
});
document.getElementById("font-custom")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target instanceof HTMLElement) event.target.blur();
});
// The reader's own pace (D228), committed on change - blur or Enter - the
// way the font's name is: a number is typed whole. What was actually stored
// comes back into the field, so a typed 1000 reads back as the scale's top;
// a field left empty or unreadable keeps the stored pace rather than writing
// nothing over it.
document.getElementById("reading-pace")?.addEventListener("change", (event) => {
  const field = event.target;
  if (!(field instanceof HTMLInputElement)) return;
  const typed = field.valueAsNumber;
  if (!Number.isFinite(typed)) {
    renderPace();
    return;
  }
  void writeConfig({ readingPace: typed }).then((written) => {
    config = written;
    renderPace();
    tellSaved("reading-pace", true);
  });
});
document.getElementById("reading-pace")?.addEventListener("input", () => {
  tellSaved("reading-pace", false);
});
document.getElementById("reading-pace")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target instanceof HTMLElement) event.target.blur();
});
// The reader's own rules (D176), stored on the press and not per keystroke:
// a stylesheet is finished when its author says so, and every write pings
// every open page. Screened before the write by the same parser that will
// apply the rules (`compileUserCss`): a text with a rule that would load
// anything is refused whole, said so under the field, and nothing is stored.
// What is stored is the text as typed - the screen runs again wherever the
// rules are applied - and an emptied field stores nothing, which is the
// default look back, said in its own words: a Save over an empty field once
// read as a rule saved (Michał's smoke, 2026-09-03 - the example then stood
// in the field as a placeholder, and looked typed).
/**
 * The field's own status line. A refusal wears the report's frame and the
 * error tone, because it lands under a tall field, and a line in the muted
 * grey there was read as no answer at all (Michał's smoke, 2026-09-03); what
 * was saved says so quietly, the way every status on this page does.
 *
 * @param {HTMLElement | null} status
 * @param {string} text
 * @param {"idle" | "error"} tone
 */
function tellCustomCss(status, text, tone) {
  if (status === null) return;
  status.hidden = false;
  status.className = tone === "error" ? "status report" : "status";
  status.dataset["tone"] = tone;
  status.textContent = text;
}

document.getElementById("custom-css-text")?.addEventListener("input", () => {
  customCssTyped = true;
});
document.getElementById("custom-css-save")?.addEventListener("click", () => {
  const field = document.getElementById("custom-css-text");
  const status = document.getElementById("custom-css-status");
  if (!(field instanceof HTMLTextAreaElement)) return;
  const text = field.value.trim().length > 0 ? field.value : "";
  const compiled = text.length > 0 ? compileUserCss(text) : null;
  if (compiled !== null && !compiled.ok) {
    tellCustomCss(status, t("options_custom_css_refused"), "error");
    return;
  }
  void writeConfig({ customCss: text }).then((written) => {
    config = written;
    customCssTyped = false;
    renderCustomCss();
    tellCustomCss(status, text.length > 0 ? t("options_custom_css_saved") : t("options_custom_css_cleared"), "idle");
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
document.getElementById("bubble-off")?.addEventListener("change", (event) => {
  const toggle = event.target;
  if (!(toggle instanceof HTMLInputElement)) return;
  // Open pages hear it through storage (D149): every ordinary page falls
  // silent or gets its launcher back on the spot, and the reader's next
  // selection is a bare highlight or a bubble again - no reload anywhere.
  void writeConfig({ bubbleOff: toggle.checked }).then((written) => {
    config = written;
  });
});
document.getElementById("tts")?.addEventListener("change", (event) => {
  const toggle = event.target;
  if (!(toggle instanceof HTMLInputElement)) return;
  // Stored for the off state (`ttsOff`), shown as the feature: a checked box
  // is a voice on offer. This page folds its two voice rows on the spot;
  // every open page hears it through storage - the next bubble opens without
  // its speaker, the reader's button leaves its bar, a voice mid-sentence
  // falls silent (D148).
  void writeConfig({ ttsOff: !toggle.checked }).then((written) => {
    config = written;
    renderTts();
    renderVoice();
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
document.getElementById("tts-lang")?.addEventListener("change", (event) => {
  const select = event.target;
  if (!(select instanceof HTMLSelectElement)) return;
  // The page's own pick, for as long as the page lives (D155); the voice
  // select beside it redraws for the language.
  voiceLang = select.value;
  renderVoice();
});
document.getElementById("tts-voice")?.addEventListener("change", (event) => {
  const select = event.target;
  if (!(select instanceof HTMLSelectElement)) return;
  // The language the row is about, off its own select - the guard is for the
  // type and for a stale page mid-change.
  const language = voiceRowLanguage();
  if (language === null) return;
  // The whole map is written back (see `writeConfig`), which is what lets
  // "default voice" remove the entry rather than store an empty string.
  const map = { ...config.ttsVoices };
  if (select.value === "") delete map[language];
  else map[language] = select.value;
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
  // like - a sample read at a speed nobody uses is a sample of nothing. In the
  // language the row is about; with none the empty tag lets the device's
  // default offline voice read the sample.
  void speak(VOICE_SAMPLE, voiceRowLanguage() ?? "", chosen, config.ttsRate / 100);
});
document.getElementById("tts-rate-down")?.addEventListener("click", () => {
  void stepRate(-TTS_RATE.step);
});
document.getElementById("tts-rate-up")?.addEventListener("click", () => {
  void stepRate(TTS_RATE.step);
});
// The card's own three presses (D254, §7): the toolbar step ticked by hand
// where the browser will not answer for it, the card put away for good, and
// the way back to it from the About section at the foot of the page.
document.getElementById("step-pin-done")?.addEventListener("click", () => {
  void writeSteps({ pinned: true }).then((now) => {
    stepsState = now;
    renderFirstSteps();
  });
});
document.getElementById("first-steps-hide")?.addEventListener("click", () => {
  void writeSteps({ hidden: true }).then((now) => {
    stepsState = now;
    renderFirstSteps();
    document.getElementById("first-steps-show")?.focus();
  });
});
document.getElementById("first-steps-show")?.addEventListener("click", () => {
  void writeSteps({ hidden: false }).then((now) => {
    stepsState = now;
    renderFirstSteps();
    const fold = document.getElementById("first-steps");
    if (fold instanceof HTMLDetailsElement) {
      fold.open = true;
      land("first-steps");
    }
  });
});
// How to pin it, under the step that asks for it, is wired by `moreNotes`
// with every other fold of the page: it is a `note-more` naming its paragraph
// with `aria-controls`, which is the one pattern here. It had a second
// listener of its own until Michał's smoke (2026-09-19) - two listeners on
// one press opened the paragraph and shut it again, so the button did
// nothing at all.
// The page the file export lives on (D254 §9, D260) - the menu's own road.
// The saved phrases' own export is a different file and a different format,
// and the note beside this door says so in a sentence rather than in a second
// door that promised the same thing.
document.getElementById("copy-library")?.addEventListener("click", () => {
  void webext().runtime.sendMessage({ kind: Message.OPEN_LIBRARY }).catch(() => {});
});
document.getElementById("add-model")?.addEventListener("click", () => void addSelectedModel());
document.getElementById("refresh-models")?.addEventListener("click", () => void refreshList());
document.getElementById("refresh-dictionaries")?.addEventListener("click", () => void refreshDictionaryList());
// The catalogues answer a press, not a keystroke (Michał, 2026-09-19): a
// hundred rows redrawn on every letter of "en pl" is a list flickering under
// the fingers, and on an e-ink panel it is a refresh per letter. The `search`
// event is Enter in the field and the field's own cross, so clearing puts the
// list back without a second listener.
for (const [field, button, apply] of /** @type {[string, string, () => void][]} */ ([
  ["model-filter", "model-search", applyModelFilter],
  ["dictionary-filter", "dictionary-search", applyCatalogFilter],
])) {
  document.getElementById(field)?.addEventListener("search", () => apply());
  document.getElementById(button)?.addEventListener("click", () => apply());
}
document.getElementById("models-show-all")?.addEventListener("click", () => toggleList("models-catalog"));
document.getElementById("dictionaries-show-all")?.addEventListener("click", () => toggleList("dictionary-catalog"));
document.getElementById("add-dictionary")?.addEventListener("click", () => void addSelectedDictionary());
document.getElementById("download-link")?.addEventListener("click", () => void downloadFromLink());
// Enter in the address field is the same press: an address is pasted and
// confirmed, and reaching for the button after it is a second gesture.
document.getElementById("dictionary-link")?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  void downloadFromLink();
});
document.getElementById("add-disabled-host")?.addEventListener("click", () => void addHostByHand());
document.getElementById("disabled-host")?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  void addHostByHand();
});

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
/**
 * Whether this page stands in a frame of the reader's own document (D243) -
 * asked once, because it cannot change while the page is open.
 */
const inReader = framedInReader();

armBackArrow();

// No full-screen tool on this page (F3): the settings are read in short
// visits, mostly beside the page they are about, and the row is busy with the
// search and the section list. The reader keeps its own.
/** @param {boolean} open */
function setMenu(open) {
  if (menuButton === null || menuPanel === null) return;
  menuPanel.hidden = !open;
  menuButton.setAttribute("aria-expanded", String(open));
  // The page dims under the open menu, and clears with it. The chrome needs
  // no holding meanwhile: it is stuck to the window's top (D219,
  // `.page-chrome` in page.css).
  if (panelScrim !== null) panelScrim.hidden = !open;
}

menuButton?.addEventListener("click", () => {
  setMenu(menuPanel?.hidden === true);
});

// The menu's rows. Standing inside the reader (D243) they ask it instead of
// sending the background anywhere: a frame that navigated would take the
// reading's own document with it, which is the whole thing this page is
// framed to avoid. On its own screen the rows are what they always were.
document.getElementById("nav-library")?.addEventListener("click", () => {
  setMenu(false);
  if (inReader) {
    askReader({ act: "view", view: "library" });
    return;
  }
  void webext().runtime.sendMessage({ kind: Message.OPEN_LIBRARY }).catch(() => {});
});
document.getElementById("nav-marks")?.addEventListener("click", () => {
  setMenu(false);
  if (inReader) {
    askReader({ act: "view", view: "marks" });
    return;
  }
  void webext().runtime.sendMessage({ kind: Message.OPEN_MARKS }).catch(() => {});
});
document.getElementById("nav-vocabulary")?.addEventListener("click", () => {
  setMenu(false);
  if (inReader) {
    askReader({ act: "room", room: "vocab" });
    return;
  }
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

// The toolbar can be changed while this page stands open - in the browser's
// own menu, a step away from here - so the card asks again whenever the page
// is looked at, and never on a clock.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  void pinnedByBrowser().then((now) => {
    if (now === pinnedNow) return;
    pinnedNow = now;
    renderFirstSteps();
  });
});

// A download or an import in flight is the one thing on this page that a reload
// would leave half-finished, and the browser will not warn about it by itself.
window.addEventListener("beforeunload", (event) => {
  if (running === null && !importing) return;
  event.preventDefault();
});

void render();

// Standing inside the reader (D243), the frame reports for duty: the reader
// writes the room's history entry on the strength of this one message, so a
// frame a policy ever refuses to load leaves no step back written for a room
// nobody can see - the reader falls back to walking to this page instead.
if (inReader) askReader({ act: "ready" });
