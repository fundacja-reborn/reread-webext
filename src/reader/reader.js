/**
 * The reader page: an article when the reader was pointed at one, the reading
 * list when it was not.
 *
 * Three things happen to a live page here and each is somewhere else's
 * decision:
 *
 *   - the page arrives as one answer to one question (`read-page`). Nothing
 *     about it is stored at either end;
 *   - Readability runs *here*, on a document parsed by `DOMParser`, which has no
 *     browsing context and therefore runs nothing and loads nothing. Not in the
 *     content script, where 88 KB would be paid for by every page anybody opens,
 *     and not in the background, which has no DOM in Chromium;
 *   - what comes out is rebuilt element by element from an allowed list
 *     (`src/lib/reader/`), never assigned as `innerHTML`.
 *
 * The reading list is the one deliberate exception to "nothing is stored": a
 * press on Save writes the *rebuilt* article - our own markup, exactly what is
 * on screen - to the extension's database, so it can be read again with no
 * network at all. On open it goes through the rebuild again: defence in depth,
 * cheap, and it means entries saved before a tightening of the allowed list
 * are held to the new list, not the old one.
 */

import { rescan, start } from "../content/reading.js";
import { webext } from "../lib/browser.js";
import { localizePage, plural, t } from "../lib/i18n.js";
import {
  CONFIG_KEY,
  MEASURE,
  SIZE,
  isFont,
  isTheme,
  readConfig,
  writeConfig,
} from "../lib/config.js";
import { describeError } from "../lib/messages.js";
import { ErrorCode, Message, asPage, asPageRequest, asResult, ok } from "../lib/protocol.js";
import { buildArticle } from "../lib/reader/article.js";
import { READER_SOURCE_KEY, readReaderSource } from "../lib/session.js";
import {
  ARTICLES_FILENAME,
  fromArticlesFile,
  toArticlesFile,
} from "../lib/store/articles-file.js";
import {
  allArticles,
  deleteArticle,
  getArticle,
  getArticleMeta,
  importArticles,
  listArticles,
  putArticle,
  setReadAt,
} from "../lib/store/articles.js";
import { Segment, emptySentence, savedArticle } from "../lib/store/saved-article.js";
import { libraryView } from "./list-view.js";

/** Vendored, loaded by its own script tag, and the only global this page uses. */
const Readability = /** @type {ReadabilityConstructor} */ (
  /** @type {Record<string, unknown>} */ (globalThis)["Readability"]
);

// First, so that everything after it - notices, rows, titles - lands on a page
// already speaking the catalogue's language.
localizePage();

const notice = document.getElementById("notice");
const article = document.getElementById("article");
const titleElement = document.getElementById("title");
const bylineElement = document.getElementById("byline");
const contentElement = document.getElementById("content");
const originalLink = document.getElementById("original");
const displayButton = document.getElementById("display");
const displayPanel = document.getElementById("display-panel");
const sizeValue = document.getElementById("size-value");
const measureValue = document.getElementById("measure-value");
const library = document.getElementById("library");
const librarySegments = document.getElementById("library-segments");
const libraryCount = document.getElementById("library-count");
const libraryEmpty = document.getElementById("library-empty");
const libraryRows = document.getElementById("library-rows");
const libraryFilter = /** @type {HTMLInputElement | null} */ (
  document.getElementById("library-filter")
);
const libraryPager = document.getElementById("library-pager");
const libraryPageLabel = document.getElementById("library-page-label");
const libraryPrev = /** @type {HTMLButtonElement | null} */ (
  document.getElementById("library-prev")
);
const libraryNext = /** @type {HTMLButtonElement | null} */ (
  document.getElementById("library-next")
);
const exportButton = /** @type {HTMLButtonElement | null} */ (
  document.getElementById("library-export")
);
const importButton = document.getElementById("library-import");
const importInput = /** @type {HTMLInputElement | null} */ (
  document.getElementById("library-import-file")
);
const importConfirm = document.getElementById("library-import-confirm");
const importSummary = document.getElementById("library-import-summary");
const importSample = document.getElementById("library-import-sample");
const importRun = /** @type {HTMLButtonElement | null} */ (
  document.getElementById("library-import-run")
);
const importCancel = document.getElementById("library-import-cancel");
const transferLine = document.getElementById("library-transfer-status");
const actions = document.getElementById("actions");
const toLibraryButton = document.getElementById("to-library");
const keepButton = document.getElementById("keep");
const removeButton = document.getElementById("remove");
const markReadButton = document.getElementById("mark-read");

/**
 * What is on screen: a live page's article, a saved one, or the list (null).
 * A fresh object every time something renders, so a slow answer can tell that
 * the view it was fetched for is gone by identity alone.
 *
 * @type {{ origin: "live" | "saved", url: string } | null}
 */
let shown = null;

/**
 * Which half of the list is showing. Starts on "to read" at every opening of
 * the page and is never stored (D-h): a remembered filter is hidden state that
 * makes the list look shorter than it is.
 *
 * @type {import("../lib/store/saved-article.js").SegmentValue}
 */
let segment = Segment.UNREAD;

/**
 * What the filter box holds and which page of the result is in view. The
 * query is not the hidden state D-h forbids - the box shows it - and the page
 * clamps itself against the list on every render (`libraryView`), so a delete
 * or a narrowing filter can never leave a blank page on screen.
 */
let libraryQuery = "";
let libraryPage = 1;

/**
 * Counts the times the view changed. An async entry takes the current count
 * and stops itself when the count has moved on - a slow `read-page` must not
 * replace the saved article somebody has meanwhile opened.
 */
let epoch = 0;

/**
 * The file waiting for the reader's yes: its name, its articles as parsed,
 * and how many entries were not articles at all. State rather than DOM for
 * the same reason the saved-phrases page keeps its offer as state - a list
 * refresh must not eat it.
 *
 * @type {{
 *   name: string,
 *   articles: import("../lib/store/saved-article.js").SavedArticle[],
 *   invalid: number,
 * } | null}
 */
let pendingImport = null;

/** How many titles the confirmation quotes before asking. */
const SAMPLE_TITLES = 3;

/**
 * @param {string} text
 */
function showNotice(text) {
  if (notice === null) return;
  notice.textContent = text;
  notice.hidden = false;
}

function hideNotice() {
  if (notice !== null) notice.hidden = true;
}

/**
 * The transfer's own status line, under its own buttons - an import report
 * in the top notice would be an answer far from its question.
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
 * Readability resolves relative links against the document's base URL, and a
 * document parsed here has ours - so without this every link in the article
 * would point inside the extension.
 *
 * A page that declares its own `<base>` keeps it, because that is what its own
 * links were written against; it only gets made absolute, since a relative base
 * would resolve against us just the same.
 *
 * @param {Document} doc
 * @param {string} url
 */
function setBase(doc, url) {
  const existing = doc.querySelector("base[href]");
  if (existing !== null) {
    try {
      existing.setAttribute("href", new URL(existing.getAttribute("href") ?? "", url).href);
      return;
    } catch {
      // An unparseable base is worth less than the address the page came from.
      existing.remove();
    }
  }

  const base = doc.createElement("base");
  base.setAttribute("href", url);
  doc.head.prepend(base);
}

/**
 * Puts one article on screen - the tail both origins share. The source element
 * holds parsed markup that has not been through the allowed list yet: the
 * rebuild happens here, unconditionally, which is what lets the saved path
 * hand over stored markup without vouching for it.
 *
 * @param {{
 *   origin: "live" | "saved",
 *   url: string,
 *   title: string,
 *   credit: string[],
 *   dir: string | null,
 *   lang: string | null,
 *   source: Element,
 * }} piece
 */
function renderArticle(piece) {
  if (article === null || contentElement === null || titleElement === null) return;
  epoch += 1;

  const rebuilt = buildArticle(piece.source, document, { baseUrl: piece.url });

  titleElement.textContent = piece.title;
  if (bylineElement !== null) {
    bylineElement.textContent = piece.credit.join(" - ");
    bylineElement.hidden = piece.credit.length === 0;
  }

  // The direction and language of the article, not of the extension: a page in
  // Arabic has to lay out as one, and `lang` is what a spell checker and a
  // screen reader go by. Cleared between articles - the previous article's
  // direction must not outlive it.
  if (piece.dir !== null) article.setAttribute("dir", piece.dir);
  else article.removeAttribute("dir");
  if (piece.lang !== null) article.setAttribute("lang", piece.lang);
  else article.removeAttribute("lang");

  contentElement.replaceChildren(rebuilt);
  if (library !== null) library.hidden = true;
  article.hidden = false;
  hideNotice();

  // The underlines are found again now that there is different text under the
  // same element. Nothing is asked of storage: the vocabulary did not change,
  // only what it can be found in.
  rescan();

  if (originalLink instanceof HTMLAnchorElement) {
    originalLink.href = piece.url;
    originalLink.target = "_blank";
    originalLink.rel = "noreferrer noopener";
    originalLink.hidden = false;
  }
  document.title = `${piece.title} - re/read`;

  shown = { origin: piece.origin, url: piece.url };
  scrollTo(0, 0);
  void refreshActions();
}

/**
 * @param {import("../lib/protocol.js").Page} page
 */
function renderLive(page) {
  const parsed = new DOMParser().parseFromString(page.html, "text/html");
  setBase(parsed, page.url);

  // Readability rewrites the document it is given. That document is this
  // throwaway parse of somebody else's page, which is the only kind it should
  // ever get - never a live one.
  const found = new Readability(parsed).parse();
  if (found === null || typeof found.content !== "string") {
    showNotice(t("reader_no_article"));
    if (shown === null) void showLibrary();
    return;
  }

  const credit = /** @type {string[]} */ (
    [found.byline, found.siteName].filter((one) => typeof one === "string" && one)
  );

  renderArticle({
    origin: "live",
    url: page.url,
    title: typeof found.title === "string" && found.title !== "" ? found.title : page.title,
    credit,
    dir: typeof found.dir === "string" && found.dir !== "" ? found.dir : null,
    lang: typeof found.lang === "string" && found.lang !== "" ? found.lang : null,
    source: new DOMParser().parseFromString(found.content, "text/html").body,
  });
}

/**
 * @param {import("../lib/store/saved-article.js").SavedArticle} saved
 */
function renderSaved(saved) {
  renderArticle({
    origin: "saved",
    url: saved.url,
    title: saved.title,
    credit: [],
    dir: saved.dir,
    lang: saved.lang,
    // Our own serialized markup - and still not trusted back: parsed inert and
    // rebuilt through the allowed list again, like anything else rendered here.
    source: new DOMParser().parseFromString(saved.content, "text/html").body,
  });
}

async function showPage() {
  const turn = ++epoch;

  // Opened with nothing to read - a restored tab after a restart, mostly.
  // That is not an error, it is the reading list's whole cue (D-c).
  const source = await readReaderSource();
  if (turn !== epoch) return;
  if (source === null) {
    await showLibrary();
    return;
  }

  const response = await webext().runtime.sendMessage({ kind: Message.READ_PAGE });
  if (turn !== epoch) return;
  const result = /** @type {import("../lib/protocol.js").Result<unknown>} */ (asResult(response));

  if (!result.ok) {
    // An article already on screen stays there. Pressing the button on a page
    // that cannot be read is a thing that happens; losing what somebody was
    // reading because of it would be a punishment for it. With nothing on
    // screen, the list is what a reader without a page shows.
    showNotice(describeError(result.code));
    if (shown === null) await showLibrary();
    return;
  }

  const page = asPage(result.value);
  if (page === null) {
    showNotice(describeError(ErrorCode.INTERNAL));
    if (shown === null) await showLibrary();
    return;
  }
  renderLive(page);
}

/**
 * @param {string} url
 */
async function openSaved(url) {
  const turn = ++epoch;
  const saved = await getArticle(url);
  if (turn !== epoch) return;
  if (saved === null) {
    // Gone under us - deleted from another reader tab. The list knows.
    await refreshLibrary();
    return;
  }
  renderSaved(saved);
}

async function showLibrary() {
  epoch += 1;
  shown = null;
  if (article !== null) article.hidden = true;
  if (actions !== null) actions.hidden = true;
  if (originalLink !== null) originalLink.hidden = true;
  if (library !== null) library.hidden = false;
  document.title = t("reader_title");
  scrollTo(0, 0);
  await refreshLibrary();
}

async function refreshLibrary() {
  if (libraryEmpty === null || libraryRows === null) return;
  const metas = await listArticles();
  const view = libraryView(metas, { segment, query: libraryQuery, page: libraryPage });
  libraryPage = view.page;

  // Each tab wears its whole segment's count - the entire half of the list,
  // not the page or the filter's slice, so the two labels always add up to
  // everything saved.
  for (const button of librarySegments?.querySelectorAll("button[data-segment]") ?? []) {
    const which = button.getAttribute("data-segment");
    button.setAttribute("aria-pressed", String(which === segment));
    button.textContent =
      which === Segment.READ
        ? t("reader_segment_read_count", view.read.toLocaleString())
        : t("reader_segment_unread_count", view.unread.toLocaleString());
  }

  // Exporting nothing would download an empty file; the button says so first.
  // On whether anything is saved at all - not on the segment.
  if (exportButton !== null) exportButton.disabled = metas.length === 0;

  // "3 of 12" while the filter narrows the segment down; the tabs already
  // carry the whole counts, so with no filter the line says nothing.
  if (libraryCount !== null) {
    const filtering = libraryQuery.trim().length > 0;
    libraryCount.hidden = !filtering;
    if (filtering) {
      libraryCount.textContent = t("reader_filter_count", [
        view.matching.toLocaleString(),
        view.inSegment.toLocaleString(),
      ]);
    }
  }

  if (view.rows.length === 0) {
    // Two kinds of nothing, two answers: a segment with nothing in it gets a
    // sentence, a filter that ruled everything out gets the sentence quoting
    // the query and the one button that undoes it.
    libraryEmpty.replaceChildren();
    if (view.inSegment > 0) {
      const sentence = document.createElement("p");
      sentence.textContent = t("reader_filter_no_match", libraryQuery);
      const clear = document.createElement("button");
      clear.type = "button";
      clear.textContent = t("reader_filter_clear");
      clear.addEventListener("click", () => {
        libraryQuery = "";
        libraryPage = 1;
        if (libraryFilter !== null) {
          libraryFilter.value = "";
          libraryFilter.focus();
        }
        void refreshLibrary();
      });
      libraryEmpty.append(sentence, clear);
    } else {
      libraryEmpty.textContent = emptySentence(metas.length, segment);
    }
    libraryEmpty.hidden = false;
  } else {
    libraryEmpty.hidden = true;
  }

  libraryRows.replaceChildren(...view.rows.map(libraryRow));
  renderLibraryPager(view);
}

/**
 * @param {{ page: number, pages: number }} view
 */
function renderLibraryPager(view) {
  if (libraryPager === null) return;
  libraryPager.hidden = view.pages <= 1;
  if (libraryPageLabel !== null) {
    libraryPageLabel.textContent = t("pager_page_of", [
      view.page.toLocaleString(),
      view.pages.toLocaleString(),
    ]);
  }
  if (libraryPrev !== null) libraryPrev.disabled = view.page <= 1;
  if (libraryNext !== null) libraryNext.disabled = view.page >= view.pages;
}

/**
 * One row: the title as the way in, the details under it, Delete beside it.
 * The title button's accessible name is the title alone, and a pseudo-element
 * in the stylesheet stretches its click over the whole text cell - the grid
 * gap keeps Delete a clear step outside that area, so a finger aiming at one
 * cannot land in the other. Titles came from somebody's page once, so they
 * enter as text - the same `textContent` rule as everywhere else.
 *
 * @param {import("../lib/store/saved-article.js").SavedMeta} meta
 */
function libraryRow(meta) {
  const item = document.createElement("li");
  item.className = "library-row";

  const text = document.createElement("div");
  text.className = "library-text";

  const open = document.createElement("button");
  open.type = "button";
  open.className = "library-open";
  open.setAttribute("data-url", meta.url);
  open.textContent = meta.title;

  const detail = document.createElement("span");
  detail.className = "library-item-detail";
  const when = meta.savedAt > 0 ? new Date(meta.savedAt).toLocaleDateString() : "";
  detail.textContent = [meta.hostname, when].filter((part) => part.length > 0).join(" - ");

  text.append(open, detail);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "library-delete";
  remove.setAttribute("data-url", meta.url);
  remove.textContent = t("action_delete");
  // The visible "Delete" repeats fifty times a page; to a screen reader each
  // one carries its article, and the label follows the armed state below.
  remove.setAttribute("aria-label", t("reader_delete_aria", meta.title));

  item.append(text, remove);
  return item;
}

/**
 * A Delete button asking its question, and taking it back - the rows' Delete
 * and the article's own share the one rule. Arming is only ever one button
 * deep: arming one disarms the other, and a press, a focus or an Escape
 * anywhere else stands the armed one down - deliberately no timer, because a
 * button that changes back by itself under a slow finger is how the wrong
 * article gets deleted.
 */

/**
 * @param {HTMLElement} button
 * @returns {string}
 */
function deleteTitle(button) {
  return button.closest("li")?.querySelector(".library-open")?.textContent ?? "";
}

function armedDelete() {
  const armed = document.querySelector("button[data-armed]");
  return armed instanceof HTMLButtonElement ? armed : null;
}

function disarmDelete() {
  const armed = armedDelete();
  if (armed === null) return;
  armed.removeAttribute("data-armed");
  if (armed === removeButton) {
    // The article's own Delete speaks for itself at rest - one button, one
    // article - so standing down also takes the armed aria-label and the
    // held width with it.
    armed.style.removeProperty("min-width");
    armed.textContent = t("reader_delete");
    armed.removeAttribute("aria-label");
    return;
  }
  armed.textContent = t("action_delete");
  armed.setAttribute("aria-label", t("reader_delete_aria", deleteTitle(armed)));
}

/**
 * @param {HTMLButtonElement} button
 */
function armDelete(button) {
  disarmDelete();
  button.setAttribute("data-armed", "");
  button.textContent = t("reader_delete_confirm");
  button.setAttribute("aria-label", t("reader_delete_confirm_aria", deleteTitle(button)));
}

/**
 * The confirmed press: the row leaves the database, and focus does not fall
 * to the body with it. Its place in the list, counted first, names the
 * successor - the next row's Delete, the previous one's after the last row,
 * the filter once the segment is empty. On a failed write the refresh keeps
 * the row, and the same count puts focus back on the button that asked.
 *
 * @param {HTMLButtonElement} button
 * @param {string} url
 */
async function removeRow(button, url) {
  const deletes = () =>
    libraryRows === null ? [] : [...libraryRows.querySelectorAll("button.library-delete")];
  const at = deletes().indexOf(button);

  try {
    await deleteArticle(url);
  } catch {
    showNotice(t("reader_list_write_failed"));
  }
  await refreshLibrary();

  const successor = deletes()[Math.min(at, deletes().length - 1)];
  if (successor instanceof HTMLButtonElement) successor.focus();
  else libraryFilter?.focus();
}

/**
 * The whole list as one file - fresh from the database rather than from the
 * rows on screen, because the screen shows one segment and an export is the
 * list, not the view. Downloading is a blob and an anchor; no permission asks
 * for less.
 */
async function exportList() {
  try {
    const articles = await allArticles();
    if (articles.length === 0) return;
    const url = URL.createObjectURL(
      new Blob([toArticlesFile(articles)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = ARTICLES_FILENAME;
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
    const parsed = fromArticlesFile(await file.text());
    if (parsed.articles.length === 0) {
      pendingImport = null;
      renderImportOffer();
      transferStatus(t("reader_import_nothing"), "error");
      return;
    }
    pendingImport = { name: file.name, articles: parsed.articles, invalid: parsed.invalid };
    transferStatus("");
    renderImportOffer();
  } catch {
    pendingImport = null;
    renderImportOffer();
    transferStatus(describeError(ErrorCode.INTERNAL), "error");
  }
}

/**
 * The moment of consent: what the file holds, before anything is written.
 * Titles came from somebody's page once, so they enter as text - the same
 * `textContent` rule as the rows above.
 */
function renderImportOffer() {
  if (importConfirm === null) return;
  importConfirm.hidden = pendingImport === null;
  if (pendingImport === null) return;

  if (importSummary !== null) {
    importSummary.textContent = plural(pendingImport.articles.length, "reader_import_summary", [
      pendingImport.name,
    ]);
  }

  if (importSample !== null) {
    importSample.replaceChildren();
    for (const article of pendingImport.articles.slice(0, SAMPLE_TITLES)) {
      const item = document.createElement("li");
      item.textContent = article.title;
      importSample.append(item);
    }
  }
}

function closeImportOffer() {
  pendingImport = null;
  renderImportOffer();
}

async function runImport() {
  if (pendingImport === null || importRun === null) return;
  const offered = pendingImport;
  importRun.disabled = true;
  try {
    const report = await importArticles(offered.articles);

    // "Added 12, skipped 3" is the whole reason to trust an import that
    // says nothing else - the same report the phrase import gives.
    const sentences = [plural(report.added, "reader_import_added")];
    if (report.skipped > 0) sentences.push(plural(report.skipped, "reader_import_skipped"));
    if (offered.invalid > 0) sentences.push(plural(offered.invalid, "reader_import_unreadable"));
    transferStatus(sentences.join(" "));

    closeImportOffer();
    await refreshLibrary();
  } catch {
    // The offer stays open: an error must not eat the file the reader
    // already picked and read.
    transferStatus(t("reader_list_write_failed"), "error");
  } finally {
    importRun.disabled = false;
  }
}

/**
 * The action row above the article, drawn from what the database says right
 * now. Whether this address is saved decides everything on it: the save
 * toggle's state on a live article, and whether there is a read mark to
 * offer at all.
 */
async function refreshActions() {
  if (actions === null) return;
  const target = shown;
  if (target === null) {
    actions.hidden = true;
    return;
  }

  const meta = await getArticleMeta(target.url).catch(() => null);
  if (shown !== target) return;

  actions.hidden = false;
  if (toLibraryButton !== null) toLibraryButton.hidden = false;

  if (keepButton !== null) {
    keepButton.hidden = target.origin !== "live";
    keepButton.textContent = meta === null ? t("reader_save") : t("reader_saved");
    keepButton.setAttribute("aria-pressed", String(meta !== null));
  }

  if (removeButton !== null) {
    removeButton.hidden = target.origin !== "saved";
    removeButton.removeAttribute("data-armed");
    removeButton.removeAttribute("aria-label");
    removeButton.style.removeProperty("min-width");
    removeButton.textContent = t("reader_delete");
  }

  if (markReadButton !== null) {
    const read = meta !== null && meta.readAt !== null;
    markReadButton.hidden = meta === null;
    markReadButton.textContent = read ? t("reader_marked_read") : t("reader_mark_read");
    markReadButton.setAttribute("aria-pressed", String(read));
  }
}

/**
 * Save this article, or take it back out - one press, no confirmation in
 * either direction (D-i): the source is a live page, and the same button puts
 * it straight back. What gets written is the rebuilt tree exactly as it is on
 * screen, serialized by reading it back - nothing here ever assigns markup.
 */
async function onKeepPress() {
  const target = shown;
  if (target === null || target.origin !== "live") return;
  if (article === null || contentElement === null || titleElement === null) return;

  try {
    const existing = await getArticleMeta(target.url);
    if (shown !== target) return;

    if (existing !== null) {
      await deleteArticle(target.url);
    } else {
      const root = contentElement.firstElementChild;
      const record = savedArticle({
        url: target.url,
        title: titleElement.textContent ?? "",
        content: root === null ? "" : root.innerHTML,
        dir: article.getAttribute("dir"),
        lang: article.getAttribute("lang"),
        savedAt: Date.now(),
      });
      if (record === null) return;
      await putArticle(record);
    }
  } catch {
    showNotice(t("reader_list_write_failed"));
    return;
  }
  if (shown === target) void refreshActions();
}

/**
 * Delete a saved article from its own view - two presses on the same spot,
 * because this copy is the only copy and offline there is no getting it back.
 * The question is asked by changing the text, not by a dialog or an undo
 * timer: both are flashes on e-ink, and neither is more honest. The same
 * armed state as the rows' Delete, so the same rules stand it down.
 */
async function onRemovePress() {
  const target = shown;
  if (target === null || target.origin !== "saved" || removeButton === null) return;

  if (!removeButton.hasAttribute("data-armed")) {
    disarmDelete();
    // The question must not shrink the target: "Sure?" is shorter than the
    // verb in every catalogue, and a button that contracts under the finger
    // turns the second press into a miss that disarms it. Held as min-width,
    // anchored on the left edge the row aligns to, so a longer question could
    // still only grow rightward.
    removeButton.style.minWidth = `${removeButton.offsetWidth}px`;
    removeButton.setAttribute("data-armed", "");
    removeButton.textContent = t("reader_delete_confirm");
    removeButton.setAttribute(
      "aria-label",
      t("reader_delete_confirm_aria", titleElement?.textContent ?? ""),
    );
    return;
  }

  try {
    await deleteArticle(target.url);
  } catch {
    showNotice(t("reader_list_write_failed"));
    return;
  }
  if (shown !== target) return;
  hideNotice();
  await showLibrary();
}

/**
 * Mark the article read, or unread again - only ever by hand, from here:
 * opening an article is not reading it (D-g).
 */
async function onMarkReadPress() {
  const target = shown;
  if (target === null) return;

  try {
    const meta = await getArticleMeta(target.url);
    if (shown !== target || meta === null) return;
    await setReadAt(target.url, meta.readAt === null ? Date.now() : null);
  } catch {
    showNotice(t("reader_list_write_failed"));
    return;
  }
  if (shown === target) void refreshActions();
}

/**
 * Puts the settings onto the document: two lengths as custom properties, the
 * theme and the typeface as attributes on the root. The stylesheet does the
 * rest, and this stays the only place that knows the names.
 *
 * Setting properties through the CSSOM rather than writing a `<style>` element,
 * which the content security policy of an extension page does not allow - the
 * same reason the bubble builds its stylesheet the way it does.
 *
 * @param {import("../lib/config.js").ReaderConfig} reader
 */
function applyAppearance(reader) {
  const root = document.documentElement;
  root.dataset["readerTheme"] = reader.theme;
  root.dataset["readerFont"] = reader.font;
  root.style.setProperty("--reader-size", `${reader.fontSize}px`);
  root.style.setProperty("--reader-measure", `${reader.measure}ch`);

  if (sizeValue !== null) sizeValue.textContent = String(reader.fontSize);
  if (measureValue !== null) measureValue.textContent = String(reader.measure);

  for (const button of document.querySelectorAll("[data-theme], [data-font]")) {
    const wanted = button.getAttribute("data-theme") ?? button.getAttribute("data-font");
    const current = button.hasAttribute("data-theme") ? reader.theme : reader.font;
    button.setAttribute("aria-pressed", String(wanted === current));
  }
}

/**
 * @param {Event} event
 */
async function onDisplayPress(event) {
  const button = event.target;
  if (!(button instanceof HTMLButtonElement)) return;

  const theme = button.getAttribute("data-theme");
  const font = button.getAttribute("data-font");
  const size = button.getAttribute("data-size");
  const measure = button.getAttribute("data-measure");

  /** @type {Partial<import("../lib/config.js").ReaderConfig>} */
  let patch = {};
  if (isTheme(theme)) patch = { theme };
  else if (isFont(font)) patch = { font };
  else if (size !== null || measure !== null) {
    // Read first, because the buttons step from wherever the setting is now,
    // and another reader tab may have moved it since this one drew itself.
    const current = (await readConfig()).reader;
    if (size !== null) {
      patch = { fontSize: clamp(current.fontSize + Number(size), SIZE) };
    } else {
      patch = { measure: clamp(current.measure + Number(measure), MEASURE) };
    }
  } else return;

  // Applied from what was actually stored, not from what was asked for: at
  // either end of the scale the answer is "it did not move", and the buttons
  // should show that rather than pretend.
  applyAppearance((await writeConfig({ reader: patch })).reader);
}

/**
 * @param {number} value
 * @param {{ min: number, max: number }} range
 * @returns {number}
 */
function clamp(value, range) {
  return Math.min(range.max, Math.max(range.min, value));
}

displayPanel?.addEventListener("click", (event) => void onDisplayPress(event));

displayButton?.addEventListener("click", () => {
  if (displayPanel === null) return;
  displayPanel.hidden = !displayPanel.hidden;
  displayButton.setAttribute("aria-expanded", String(!displayPanel.hidden));
});

librarySegments?.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const choice = target.closest("button[data-segment]")?.getAttribute("data-segment");
  if (choice === Segment.UNREAD || choice === Segment.READ) {
    segment = choice;
    // A different segment is a different list; page three of the old one
    // would be a position in a list no longer on screen.
    libraryPage = 1;
    void refreshLibrary();
  }
});

libraryFilter?.addEventListener("input", () => {
  if (libraryFilter === null) return;
  libraryQuery = libraryFilter.value;
  // Typing means "show me what matches", and that starts at the beginning -
  // the clamp would only catch a page that no longer exists.
  libraryPage = 1;
  void refreshLibrary();
});

/**
 * A turned page starts at its top - snapped there, not glided, because on
 * e-ink every animation is a flash.
 *
 * @param {number} step
 */
async function turnLibraryPage(step) {
  libraryPage += step;
  await refreshLibrary();
  libraryRows?.scrollIntoView({ behavior: "instant", block: "start" });
}

libraryPrev?.addEventListener("click", () => void turnLibraryPage(-1));

libraryNext?.addEventListener("click", () => void turnLibraryPage(1));

libraryRows?.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest("button[data-url]");
  if (!(button instanceof HTMLButtonElement)) return;
  const url = button.getAttribute("data-url") ?? "";
  if (url.length === 0) return;

  if (button.classList.contains("library-delete")) {
    // Two presses on the same spot (D-e), asked with text, answered for real:
    // the second one deletes the row from the database, not from the screen.
    if (button.hasAttribute("data-armed")) void removeRow(button, url);
    else armDelete(button);
    return;
  }
  void openSaved(url);
});

// The armed Delete - a row's or the article's - stands down at any step away
// from it: a press elsewhere, focus moving on, Escape, and never on a clock.
// `pointerdown` rather than `click` so that the press that arms another
// Delete finds the previous one already disarmed when its own click handler
// runs.
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

exportButton?.addEventListener("click", () => void exportList());

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

toLibraryButton?.addEventListener("click", () => {
  hideNotice();
  void showLibrary();
});

keepButton?.addEventListener("click", () => void onKeepPress());
removeButton?.addEventListener("click", () => void onRemovePress());
markReadButton?.addEventListener("click", () => void onMarkReadPress());

// The settings can change in another reader tab, and the language pair on the
// settings page. Reading the whole thing back is cheaper than working out which
// half moved.
webext().storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || changes[CONFIG_KEY] === undefined) return;
  void readConfig().then((config) => applyAppearance(config.reader));
});

void readConfig().then((config) => applyAppearance(config.reader));

// Two ways in, and they are the same question. On load, because the reader was
// probably just opened by the button; on a change to the session key, because
// the button was pressed again while this tab was already standing here.
webext().storage.onChanged.addListener((changes, area) => {
  if (area !== "session") return;
  if (changes[READER_SOURCE_KEY] === undefined) return;
  void showPage();
});

// The popup's one question, and the reader's whole answer: "I am the reader".
// The popup then hides the per-site switch and the reader button - there is no
// site here to switch off, and no page behind this one to read. `grab-page` is
// deliberately not answered: the reader is never a source, and `readInReader`
// refuses to point it at itself anyway.
webext().runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (asPageRequest(message)?.kind !== Message.PAGE_INFO) return false;
  sendResponse(ok({ reader: true }));
  return false;
});

// The same reading side as on any other page, scoped to the article: the
// reader's own heading and links are not text anybody is learning from, and
// nothing in this document changes unless the code above changes it, so there
// is nothing for an observer to watch. Touch selects through our own gesture
// here (D80) - this is our page, so refusing the native selection is allowed,
// and it is the one way to read on a touch screen with no system menu in the
// way and the bubble landing exactly on the finger lifting.
start({ root: article, observe: false, touchSelect: true });

void showPage();
