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
import { languageName } from "../lib/language.js";
import {
  CONFIG_KEY,
  DEFAULTS,
  MEASURE,
  SIZE,
  TTS_RATE,
  isFont,
  isLinks,
  isTheme,
  readConfig,
  writeConfig,
} from "../lib/config.js";
import { describeError } from "../lib/messages.js";
import { ErrorCode, Message, asPage, asPageRequest, asResult, ok } from "../lib/protocol.js";
import { buildArticle } from "../lib/reader/article.js";
import { importKind } from "../lib/reader/import-kind.js";
import { speechAction } from "../lib/reader/keys.js";
import {
  POSITION_SAVE_DELAY,
  blockAtLine,
  fineScrollTop,
  measuredPercent,
  positionRecord,
  restoredIndex,
} from "../lib/reader/position.js";
import { READER_SOURCE_KEY, readReaderSource } from "../lib/session.js";
import {
  ARTICLES_FILENAME,
  fromArticlesFile,
  toArticlesFile,
} from "../lib/store/articles-file.js";
import {
  allArticles,
  allPositions,
  deleteArticle,
  getArticle,
  getArticleMeta,
  getPosition,
  importArticles,
  listArticles,
  putArticle,
  putPosition,
  setReadAt,
} from "../lib/store/articles.js";
import {
  deleteBook,
  getBook,
  getBookSegment,
  listBooks,
  setBookReadAt,
  sweepOrphanSegments,
} from "../lib/store/books.js";
import { Segment, emptySentence, savedArticle } from "../lib/store/saved-article.js";
import { watchToolbarScheme } from "../lib/theme-icon.js";
import { canSpeak, primaryLanguage, voicesFor } from "../lib/tts.js";
import { importEpub } from "./import-book.js";
import { articleEntry, bookEntry, libraryView } from "./list-view.js";
import {
  configureReading,
  forgetReading,
  readingState,
  readingVoice,
  skipSentence,
  stopReading,
  toggleReading,
} from "./read-aloud.js";

/** Vendored, loaded by its own script tag, and the only global this page uses. */
const Readability = /** @type {ReadabilityConstructor} */ (
  /** @type {Record<string, unknown>} */ (globalThis)["Readability"]
);

// First, so that everything after it - notices, rows, titles - lands on a page
// already speaking the catalogue's language.
localizePage();
// The toolbar icon follows the browser's scheme where the manifest cannot
// say so (Chromium, no theme_icons there) - a no-op on Firefox.
watchToolbarScheme();

const notice = document.getElementById("notice");
const article = document.getElementById("article");
const titleElement = document.getElementById("title");
const bylineElement = document.getElementById("byline");
const contentElement = document.getElementById("content");
const originalLink = document.getElementById("original");
const brandButton = document.getElementById("brand");
const displayButton = document.getElementById("display");
const displayPanel = document.getElementById("display-panel");
const menuButton = document.getElementById("menu");
const menuPanel = document.getElementById("menu-panel");
const navLibrary = document.getElementById("nav-library");
const navVocabulary = document.getElementById("nav-vocabulary");
const navSettings = document.getElementById("nav-settings");
// The box the bar and its panels stand in - measured, not styled, from here:
// while an article is on screen it is stuck over the text, and the voice needs
// to know how much of the window's top it covers.
const chromeBox = document.querySelector(".reader-chrome");
const sizeValue = document.getElementById("size-value");
const measureValue = document.getElementById("measure-value");
const listenButton = /** @type {HTMLButtonElement | null} */ (document.getElementById("listen"));
const voiceSetting = document.getElementById("voice-setting");
const voiceChoice = /** @type {HTMLSelectElement | null} */ (
  document.getElementById("voice-choice")
);
const rateSetting = document.getElementById("rate-setting");
const rateValue = document.getElementById("rate-value");
const speechBar = document.getElementById("speech-bar");
const speechPlayLabel = document.getElementById("speech-play-label");
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
const bookImportLine = document.getElementById("book-import-status");
const bookNote = document.getElementById("book-note");
const bookNoteText = document.getElementById("book-note-text");
const bookNoteSettings = document.getElementById("book-note-settings");
const segmentNavs = [
  document.getElementById("segment-nav"),
  document.getElementById("segment-nav-end"),
];
const segmentLabels = [
  document.getElementById("segment-label"),
  document.getElementById("segment-label-end"),
];
const segmentPrevs = [
  document.getElementById("segment-prev"),
  document.getElementById("segment-prev-end"),
];
const segmentNexts = [
  document.getElementById("segment-next"),
  document.getElementById("segment-next-end"),
];
const actions = document.getElementById("actions");
const toLibraryButton = document.getElementById("to-library");
const keepButton = document.getElementById("keep");
const removeButton = document.getElementById("remove");
const markReadButton = document.getElementById("mark-read");
// The same two acts again under the article's last line - a long article ends
// far from the bar above, and finishing is done where the finishing happens.
const actionsEnd = document.getElementById("actions-end");
const toLibraryEndButton = document.getElementById("to-library-end");
const markReadEndButton = document.getElementById("mark-read-end");

/**
 * What is on screen: a live page's article, a saved one, a book's segment, or
 * the list (null). A fresh object every time something renders, so a slow
 * answer can tell that the view it was fetched for is gone by identity alone.
 * For a book, `url` is its id - the same name it goes by everywhere else.
 *
 * @type {{ origin: "live" | "saved", url: string }
 *   | { origin: "book", url: string, segmentIndex: number, segmentCount: number }
 *   | null}
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
 * The settings as they stand. Held rather than read at every press because
 * reading aloud (D87) asks three questions of them - which voice, how fast,
 * which language - at every button and every article, and a round trip to
 * storage for each would buy nothing: the storage listener below already keeps
 * this current, in this tab and from any other.
 *
 * @type {import("../lib/config.js").Config}
 */
let settings = DEFAULTS;

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
 *   origin: "live" | "saved" | "book",
 *   url: string,
 *   title: string,
 *   credit: string[],
 *   dir: string | null,
 *   lang: string | null,
 *   link: string | null,
 *   segment?: { index: number, count: number },
 *   source: Element,
 * }} piece
 *   `url` is the document's name in the database (a book's id included);
 *   `link` is the address worth offering as "Open the original", which a
 *   book does not have.
 */
function renderArticle(piece) {
  if (article === null || contentElement === null || titleElement === null) return;
  epoch += 1;
  // The save a scroll had put off is about the article still on screen, and
  // its blocks are about to be replaced - measured now or never.
  flushPosition();
  // Whatever was being read aloud was this element's previous contents, and
  // they are about to be replaced: the voice stops here rather than reading a
  // sentence of one article into another (D87).
  forgetReading();
  // The book dressing is put on by `openBook` after this returns; every
  // other road through here takes it off.
  showSegmentNav(null);
  showBookNote(null);

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
  applyLinkStops(settings.reader.links);
  if (library !== null) library.hidden = true;
  article.hidden = false;
  hideNotice();

  // The underlines are found again now that there is different text under the
  // same element. Nothing is asked of storage: the vocabulary did not change,
  // only what it can be found in.
  rescan();

  if (originalLink instanceof HTMLAnchorElement) {
    if (piece.link === null) {
      originalLink.hidden = true;
    } else {
      originalLink.href = piece.link;
      originalLink.target = "_blank";
      originalLink.rel = "noreferrer noopener";
      originalLink.hidden = false;
    }
  }
  // With an article on screen the list is elsewhere, so the menu offers it.
  if (navLibrary !== null) navLibrary.hidden = false;
  document.title = `${piece.title} - re/read`;

  shown =
    piece.origin === "book"
      ? {
          origin: "book",
          url: piece.url,
          segmentIndex: piece.segment?.index ?? 0,
          segmentCount: piece.segment?.count ?? 1,
        }
      : { origin: piece.origin, url: piece.url };
  // The voice follows the article, not the pair: this one may be in another
  // language, and the select in the panel is about whatever is on screen.
  applySpeech();
  updateListen();
  scrollTo(0, 0);
  // The action rows are the caller's move, not taken here: the two callers
  // that restore a position must have them laid out BEFORE the scroll - the
  // bar stands above the article, and appearing later it would push the
  // restored block down the exact height it takes.
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
    link: page.url,
    source: new DOMParser().parseFromString(found.content, "text/html").body,
  });
  // A live page starts at the top, so the action rows may come when they come.
  void refreshActions();
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
    link: saved.url,
    // Our own serialized markup - and still not trusted back: parsed inert and
    // rebuilt through the allowed list again, like anything else rendered here.
    source: new DOMParser().parseFromString(saved.content, "text/html").body,
  });
}

/**
 * The reading position of a saved document: which top-level block was at the
 * top of the screen, written back to the database so that opening the
 * document again starts where its reader stopped. Structural rather than a
 * scroll offset, so a change of font size or measure changes nothing; only
 * for documents the database holds, because the position row leaves in the
 * same transaction as its document. No UI anywhere - the behaviour is meant
 * to be invisible, and losing a position only ever costs starting at the top.
 */

/** The debounced save a scroll has started, if one is pending. */
let positionTimer = /** @type {ReturnType<typeof setTimeout> | null} */ (null);

/** The article's rebuilt root: its children are the top-level blocks. */
function contentRoot() {
  return contentElement?.firstElementChild ?? null;
}

/**
 * How far down the window the stuck chrome reaches. Below this line is the
 * visible text; the voice keeps its spoken sentence under it, and the
 * position means the first block still under it. Measured at each ask,
 * because an open panel makes the chrome taller for as long as it is open.
 */
function chromeFold() {
  return Math.max(0, chromeBox?.getBoundingClientRect().bottom ?? 0);
}

/**
 * The block being read: the one at the top of the visible text, just under
 * the chrome. One `elementFromPoint` and a climb - nothing observes anything
 * between saves. The point can land on something that is not a block (the
 * margin between two paragraphs, the bubble standing over the text); then
 * the blocks' own rects answer instead.
 *
 * @returns {number | null}
 */
function topBlockIndex() {
  const root = contentRoot();
  if (root === null || root.children.length === 0) return null;
  const line = chromeFold() + 2;

  const hit = document.elementFromPoint(window.innerWidth / 2, line);
  for (let node = hit; node !== null && node !== root; node = node.parentElement) {
    if (node.parentElement === root) return Array.prototype.indexOf.call(root.children, node);
  }
  return blockAtLine(
    Array.from(root.children, (block) => block.getBoundingClientRect()),
    line,
  );
}

/**
 * Writes where the reading stands, now. Quiet on every failure: a position
 * is a convenience, and nothing about keeping one may interrupt the reading
 * it is about.
 */
function savePositionNow() {
  if (positionTimer !== null) {
    clearTimeout(positionTimer);
    positionTimer = null;
  }
  const target = shown;
  // Only documents the database holds: a live page has no row for the
  // position to belong to. A book's place is its segment and the block in it.
  if (target === null || target.origin === "live") return;
  const at = topBlockIndex();
  if (at === null) return;
  const segment = target.origin === "book" ? target.segmentIndex : 0;
  const percent = measuredPercent(
    window.scrollY,
    window.innerHeight,
    document.documentElement.scrollHeight,
  );
  const record = positionRecord(target.url, segment, at, Date.now(), percent);
  if (record !== null) void putPosition(record).catch(() => undefined);
}

/**
 * The save a scroll had put off, taken before the article leaves the screen:
 * turning back to the list must not lose the last second and a half of
 * scrolling to the debounce.
 */
function flushPosition() {
  if (positionTimer !== null) savePositionNow();
}

// Scrolling is the one signal that the place moved - including the scrolls
// reading aloud makes on its own, which is what keeps the position current
// while the page reads itself. One cheap read per save, at most every
// second and a half; nothing runs between scrolls.
//
// Listened for on the document in the capture phase, not on `window`: with
// the root's sideways overflow clipped (the sticky strip's underlay, D93),
// Firefox hands the viewport's scroll events to an element, and an element's
// scroll never bubbles - a window listener simply never fires there, and no
// scroll ever got saved. The capture path is the one road every engine's
// scroll must take, whichever node it decides to aim at. Scrolls inside an
// article's own boxes (code, tables) arm the debounce too; the save then
// re-measures the window and writes the same place - a spare write, never a
// wrong one.
document.addEventListener(
  "scroll",
  () => {
    if (shown === null || shown.origin === "live") return;
    if (positionTimer !== null) clearTimeout(positionTimer);
    positionTimer = setTimeout(savePositionNow, POSITION_SAVE_DELAY);
  },
  { capture: true, passive: true },
);

// The tab going away or to the background writes at once: the debounce is
// for scrolling, not for closing, and `pagehide` is the last word this page
// gets anywhere.
window.addEventListener("pagehide", () => savePositionNow());

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") savePositionNow();
});

/**
 * Puts a just-rendered document back where its reader stopped. Nothing to
 * restore - no row, another segment, an index past the end of a document
 * since overwritten - means the top, where `renderArticle` already left it.
 *
 * @param {import("../lib/reader/position.js").ReadingPosition | null} position
 * @param {number} [segmentIndex] the segment on screen - a book's, or an
 *   article's implicit zero
 */
function restorePosition(position, segmentIndex = 0) {
  const root = contentRoot();
  if (root === null) return;
  const at = restoredIndex(position, segmentIndex, root.children.length);
  if (at === null) return;
  const block = root.children[at];
  if (block === undefined) return;
  block.scrollIntoView({ behavior: "instant", block: "start" });
  // `scrollIntoView` puts the block at the window's very top, which the
  // sticky chrome covers; step back so its first line lands under the bar.
  scrollBy(0, -chromeFold());
  // A block taller than the window - one endless paragraph - is the shape
  // the anchor cannot answer for: its top may be screens away from where
  // the reading stopped. The stored percent finds the place inside it.
  const rect = block.getBoundingClientRect();
  const fine = fineScrollTop(
    rect.top + window.scrollY,
    rect.height,
    window.innerHeight,
    position?.percent,
    document.documentElement.scrollHeight,
  );
  if (fine !== null) scrollTo(0, fine);
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
  // The position rides along in the same round trip; render is synchronous,
  // so nothing can move between the article appearing and the scroll to it.
  const [saved, position] = await Promise.all([getArticle(url), getPosition(url)]);
  if (turn !== epoch) return;
  if (saved === null) {
    // Gone under us - deleted from another reader tab. The list knows.
    await refreshLibrary();
    return;
  }
  renderSaved(saved);
  // The action rows first, the scroll second: they stand above the article,
  // and a bar appearing after the scroll would shift the restored block by
  // its own height. Awaited before the epoch check - a row pressed during
  // the wait means this render is no longer the one on screen.
  const rendered = shown;
  await refreshActions();
  if (shown !== rendered) return;
  restorePosition(position);
}

/**
 * The two rows around a book's text: which part is on screen, and the way to
 * its neighbours. Or, with null, no rows at all - which is every view that
 * is not a book.
 *
 * @param {{ index: number, count: number } | null} segment
 */
function showSegmentNav(segment) {
  for (const nav of segmentNavs) {
    if (nav !== null) nav.hidden = segment === null;
  }
  if (segment === null) return;
  for (const label of segmentLabels) {
    if (label !== null) {
      label.textContent = t("reader_book_part_of", [
        (segment.index + 1).toLocaleString(),
        segment.count.toLocaleString(),
      ]);
    }
  }
  for (const button of segmentPrevs) {
    if (button instanceof HTMLButtonElement) button.disabled = segment.index <= 0;
  }
  for (const button of segmentNexts) {
    if (button instanceof HTMLButtonElement) button.disabled = segment.index >= segment.count - 1;
  }
}

/**
 * The quiet line over a book whose language is not what the current pair
 * translates from (O20): said once, with the settings one press away, and
 * never acted on by itself. Books that do not declare a language, and books
 * that match, say nothing.
 *
 * @param {import("../lib/store/book.js").BookMeta | null} book
 */
function showBookNote(book) {
  if (bookNote === null || bookNoteText === null) return;
  const declared = book === null ? "" : primaryLanguage(book.lang ?? "");
  const mismatch = declared.length > 0 && declared !== primaryLanguage(settings.sourceLang);
  bookNote.hidden = !mismatch;
  if (mismatch && book !== null) {
    bookNoteText.textContent = t("reader_book_pair_note", [
      languageName(declared),
      languageName(primaryLanguage(settings.sourceLang)),
    ]);
  }
}

/**
 * Opens a book at one of its segments - the remembered one when no segment
 * is asked for, which is what a press in the list means. The same round trip
 * and epoch guard as a saved article; the render is `renderArticle` whole,
 * so the panel, the bubble, the underlines and the voice work in a segment
 * exactly as they do in an article.
 *
 * @param {string} id
 * @param {number} [wanted] a specific segment - the neighbour rows' press
 */
async function openBook(id, wanted) {
  const turn = ++epoch;
  const [book, position] = await Promise.all([getBook(id), getPosition(id)]);
  if (turn !== epoch) return;
  if (book === null) {
    // Gone under us - deleted from another reader tab. The list knows.
    await refreshLibrary();
    return;
  }

  const remembered =
    position !== null && position.segmentIndex < book.segmentCount ? position.segmentIndex : 0;
  const index = Math.min(Math.max(0, wanted ?? remembered), book.segmentCount - 1);
  const segment = await getBookSegment(id, index);
  if (turn !== epoch) return;
  if (segment === null) {
    // A book whose row outlived its text - torn beyond rendering.
    showNotice(t("reader_book_unreadable"));
    if (shown === null) await showLibrary();
    return;
  }

  renderArticle({
    origin: "book",
    url: id,
    title: book.title,
    credit: book.author === null ? [] : [book.author],
    dir: null,
    lang: book.lang,
    link: null,
    segment: { index, count: book.segmentCount },
    // Our own rebuilt markup, stored at import - and still not trusted back:
    // parsed inert and rebuilt through the allowed list again.
    source: new DOMParser().parseFromString(segment.blocks.join(""), "text/html").body,
  });
  showSegmentNav({ index, count: book.segmentCount });
  showBookNote(book);
  // Same order as `openSaved`, for the same reason: everything that takes
  // room above the text lays out before the scroll that has to land on it.
  const rendered = shown;
  await refreshActions();
  if (shown !== rendered) return;
  restorePosition(position, index);
}

/**
 * One press on Previous or Next: the neighbouring segment in the same tab,
 * no navigation and no animation. The position of the segment being left was
 * flushed by `renderArticle` before its blocks went away.
 *
 * @param {number} step
 */
function turnSegment(step) {
  const target = shown;
  if (target === null || target.origin !== "book") return;
  const next = target.segmentIndex + step;
  if (next < 0 || next >= target.segmentCount) return;
  void openBook(target.url, next);
}

async function showLibrary() {
  epoch += 1;
  // Before `shown` moves: the pending save is about the article on screen.
  flushPosition();
  shown = null;
  // The article being read aloud is leaving the screen, and a voice reading a
  // page nobody can see is the extension talking to itself.
  forgetReading();
  updateListen();
  if (article !== null) article.hidden = true;
  if (actions !== null) actions.hidden = true;
  if (actionsEnd !== null) actionsEnd.hidden = true;
  if (originalLink !== null) originalLink.hidden = true;
  showSegmentNav(null);
  showBookNote(null);
  // The menu must not list the room it stands in: on the list view its list
  // row hides, leaving the pages that really are elsewhere.
  if (navLibrary !== null) navLibrary.hidden = true;
  if (library !== null) library.hidden = false;
  document.title = t("reader_title");
  scrollTo(0, 0);
  await refreshLibrary();
}

async function refreshLibrary() {
  if (libraryEmpty === null || libraryRows === null) return;
  // One list, two stores: books enter dressed as rows (`bookEntry`), with
  // their positions read in bulk - fifty rows must not mean fifty lookups.
  const [metas, books, positions] = await Promise.all([
    listArticles(),
    listBooks(),
    allPositions(),
  ]);
  const entries = [
    ...metas.map((meta) => articleEntry(meta, positions.get(meta.url) ?? null)),
    ...books.map((book) => bookEntry(book, positions.get(book.id) ?? null)),
  ];
  const view = libraryView(entries, { segment, query: libraryQuery, page: libraryPage });
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
  // On whether any *articles* are saved - books stay out of the file, so a
  // list of books alone still has nothing to export.
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
      libraryEmpty.textContent = emptySentence(entries.length, segment);
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
 * A book's detail line trades the site and the date for what a book has:
 * its author, the quiet word "Book", and how far in its reader is.
 *
 * @param {import("./list-view.js").LibraryEntry} entry
 */
function libraryRow(entry) {
  const item = document.createElement("li");
  item.className = "library-row";

  const text = document.createElement("div");
  text.className = "library-text";

  const open = document.createElement("button");
  open.type = "button";
  open.className = "library-open";
  open.setAttribute("data-url", entry.url);
  open.setAttribute("data-kind", entry.kind);
  open.textContent = entry.title;

  const detail = document.createElement("span");
  detail.className = "library-item-detail";
  // How far in the reading is, said only where it says anything: on an
  // unread row that was actually started. A read row's mark has said more,
  // and "0% read" on a row never opened is noise dressed as a number.
  const percent =
    entry.readAt === null && entry.percentRead !== null && entry.percentRead > 0
      ? t("reader_percent_read", entry.percentRead.toLocaleString())
      : "";
  if (entry.kind === "book") {
    const progress =
      entry.progress === null
        ? ""
        : t("reader_book_part_of", [
            entry.progress.at.toLocaleString(),
            entry.progress.of.toLocaleString(),
          ]);
    detail.textContent = [entry.hostname, t("reader_book_label"), progress, percent]
      .filter((part) => part.length > 0)
      .join(" - ");
  } else {
    const when = entry.savedAt > 0 ? new Date(entry.savedAt).toLocaleDateString() : "";
    detail.textContent = [entry.hostname, when, percent]
      .filter((part) => part.length > 0)
      .join(" - ");
  }

  text.append(open, detail);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "library-delete";
  remove.setAttribute("data-url", entry.url);
  remove.setAttribute("data-kind", entry.kind);
  remove.textContent = t("action_delete");
  // The visible "Delete" repeats fifty times a page; to a screen reader each
  // one carries its article, and the label follows the armed state below.
  remove.setAttribute("aria-label", t("reader_delete_aria", entry.title));

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
 * The title a Delete would take with it: the article's own for the button
 * above the article, the row's name for a row's.
 *
 * @param {HTMLElement} button
 * @returns {string}
 */
function deleteTitle(button) {
  if (button === removeButton) return titleElement?.textContent ?? "";
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
  // Every Delete stands down to the same pair of words - the bare verb to
  // see, the act with its title to hear; only the held width was the article
  // button's own.
  if (armed === removeButton) armed.style.removeProperty("min-width");
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
 * @param {string} kind
 */
async function removeRow(button, url, kind) {
  const deletes = () =>
    libraryRows === null ? [] : [...libraryRows.querySelectorAll("button.library-delete")];
  const at = deletes().indexOf(button);

  try {
    if (kind === "book") await deleteBook(url);
    else await deleteArticle(url);
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
 * The action rows around the article - the bar above it and the pair of
 * finishing acts under its last line - drawn from what the database says
 * right now. Whether this address is saved decides everything on them: the
 * save toggle's state on a live article, and whether there is a read mark
 * to offer at all. One function dresses both rows, so they cannot disagree.
 */
async function refreshActions() {
  if (actions === null) return;
  const target = shown;
  if (target === null) {
    actions.hidden = true;
    if (actionsEnd !== null) actionsEnd.hidden = true;
    return;
  }

  // The database row behind the view - an article's meta or a book's, both
  // answering the two questions asked here: is it kept, and is it read.
  const row =
    target.origin === "book"
      ? await getBook(target.url).catch(() => null)
      : await getArticleMeta(target.url).catch(() => null);
  if (shown !== target) return;

  actions.hidden = false;
  if (actionsEnd !== null) actionsEnd.hidden = false;
  if (toLibraryButton !== null) toLibraryButton.hidden = false;
  if (toLibraryEndButton !== null) toLibraryEndButton.hidden = false;

  if (keepButton !== null) {
    keepButton.hidden = target.origin !== "live";
    keepButton.textContent = row === null ? t("reader_save") : t("reader_saved");
    keepButton.setAttribute("aria-pressed", String(row !== null));
  }

  if (removeButton !== null) {
    // Delete stands over everything that lives only in this database: a
    // saved article, and a book.
    removeButton.hidden = target.origin === "live" || row === null;
    removeButton.removeAttribute("data-armed");
    removeButton.style.removeProperty("min-width");
    // The rows' pair of words: one visible verb, the act with its title as
    // the accessible name - a bare "Delete" names nothing over a whole page.
    removeButton.textContent = t("action_delete");
    removeButton.setAttribute("aria-label", t("reader_delete_aria", deleteTitle(removeButton)));
  }

  const read = row !== null && row.readAt !== null;
  // The read mark belongs to the whole document, and over a book the words
  // must say so: a bare "Mark as read" at part 3 of 32 left open whether the
  // part or the book was being marked (Michał's report, 2026-08-16) - it was
  // always the book. The twin under the text goes further: it stands only
  // under the LAST part, where "the book is finished" is the thing that just
  // happened - under any earlier part the honest next act is the pager's,
  // one row above. The bar's copy stays on every part, because filing a book
  // already read elsewhere must not cost paging to its end.
  const book = target.origin === "book";
  const label = book
    ? (read ? t("reader_book_marked_read") : t("reader_mark_book_read"))
    : (read ? t("reader_marked_read") : t("reader_mark_read"));
  const lastPart = target.origin !== "book" || target.segmentIndex >= target.segmentCount - 1;
  for (const button of [markReadButton, markReadEndButton]) {
    if (button === null) continue;
    button.hidden = row === null || (button === markReadEndButton && !lastPart);
    button.textContent = label;
    button.setAttribute("aria-pressed", String(read));
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
  if (target === null || target.origin === "live") return;
  if (!(removeButton instanceof HTMLButtonElement)) return;

  if (!removeButton.hasAttribute("data-armed")) {
    // The question must not move the target out from under the finger. Which
    // of verb and question runs longer now differs by catalogue ("Usuń" asks
    // "Na pewno?", "Supprimer" asks "Sûr ?"), so the width is held as
    // min-width, anchored on the left edge the row aligns to: the button
    // never shrinks, and can only grow rightward.
    removeButton.style.minWidth = `${removeButton.offsetWidth}px`;
    armDelete(removeButton);
    return;
  }

  try {
    if (target.origin === "book") await deleteBook(target.url);
    else await deleteArticle(target.url);
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
    if (target.origin === "book") {
      const book = await getBook(target.url);
      if (shown !== target || book === null) return;
      await setBookReadAt(target.url, book.readAt === null ? Date.now() : null);
    } else {
      const meta = await getArticleMeta(target.url);
      if (shown !== target || meta === null) return;
      await setReadAt(target.url, meta.readAt === null ? Date.now() : null);
    }
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
  root.dataset["readerLinks"] = reader.links;
  root.style.setProperty("--reader-size", `${reader.fontSize}px`);
  root.style.setProperty("--reader-measure", `${reader.measure}ch`);

  if (sizeValue !== null) sizeValue.textContent = String(reader.fontSize);
  if (measureValue !== null) measureValue.textContent = String(reader.measure);
  applyLinkStops(reader.links);

  for (const button of document.querySelectorAll("[data-theme], [data-font], [data-links]")) {
    const wanted =
      button.getAttribute("data-theme") ??
      button.getAttribute("data-font") ??
      button.getAttribute("data-links");
    const current = button.hasAttribute("data-theme")
      ? reader.theme
      : button.hasAttribute("data-font")
        ? reader.font
        : reader.links;
    button.setAttribute("aria-pressed", String(wanted === current));
  }
}

/**
 * The two ways an anchor stays a link even dressed as text (D95): the tab
 * order, where it would catch a focus ring on what reads as body text, and the
 * browser's link drag, which would eat the word-selection gesture right where
 * it is most wanted. Both taken away in plain mode, both given back in active.
 * The stylesheet handles the look and `onArticleLink` the press; this walk
 * runs again for every article rendered, because the anchors are new each time.
 *
 * @param {import("../lib/config.js").ReaderConfig["links"]} links
 */
function applyLinkStops(links) {
  if (contentElement === null) return;
  for (const anchor of contentElement.querySelectorAll("a[href]")) {
    if (links === "plain") {
      anchor.setAttribute("tabindex", "-1");
      anchor.setAttribute("draggable", "false");
    } else {
      anchor.removeAttribute("tabindex");
      anchor.removeAttribute("draggable");
    }
  }
}

/**
 * The language the article is written in, which is what a voice has to be told
 * (D87): a page that declares one knows better than the language pair does,
 * and a page that declares none is being read for the pair's sake, so the
 * source language is the honest guess. The full tag rides through - `en-GB`
 * picks a British voice where the device has one - while the *choice* of voice
 * is stored under the primary subtag, so one pick serves every variant and
 * agrees with the settings page, which only ever knows the pair.
 *
 * @returns {string}
 */
function speechLang() {
  const declared = article?.getAttribute("lang") ?? "";
  return primaryLanguage(declared).length > 0 ? declared : settings.sourceLang;
}

/**
 * @returns {import("./read-aloud.js").ReadingVoice}
 */
function speechVoice() {
  const lang = speechLang();
  return {
    lang,
    voiceURI: settings.ttsVoices[primaryLanguage(lang)],
    // The engine's factor, out of the percent the config stores.
    rate: settings.ttsRate / 100,
  };
}

/**
 * The voice select in the panel: this device's voices able to read the article
 * on screen, behind a first line that means "let the browser pick". Redrawn
 * whenever the language or the settings may have moved, and when the engine's
 * list arrives - `getVoices` answers nothing until the browser has loaded the
 * voices, and `voiceschanged` is the only appointment it keeps.
 */
function renderVoiceChoice() {
  if (voiceChoice === null) return;
  const lang = speechLang();
  const stored = settings.ttsVoices[primaryLanguage(lang)];
  const voices = canSpeak() ? voicesFor(speechSynthesis.getVoices(), lang) : [];

  const fallback = document.createElement("option");
  fallback.value = "";
  fallback.textContent = t("options_tts_default");
  fallback.selected = stored === undefined;

  voiceChoice.replaceChildren(
    fallback,
    ...voices.map((voice) => {
      const option = document.createElement("option");
      option.value = voice.voiceURI;
      // The voice's own name plus its tag: two voices called "English" differ
      // only by where they are from, and the name alone would be a coin toss.
      option.textContent = `${voice.name} (${voice.lang})`;
      option.selected = voice.voiceURI === stored;
      return option;
    }),
  );
}

/**
 * What the settings say about the voice, put where it is read from: the two
 * controls in the panel, and the reading itself - which starts the current
 * sentence again when one of them really moved, so a speed changed mid-article
 * is heard now rather than after the paragraph (`readingVoice`).
 */
function applySpeech() {
  if (rateValue !== null) rateValue.textContent = `${(settings.ttsRate / 100).toFixed(1)}×`;
  renderVoiceChoice();
  readingVoice(speechVoice());
}

/**
 * One road for everything the settings decide on this page - how it looks and
 * what the voice does. Fed with what was actually stored rather than with what
 * was asked for: at either end of a scale the honest answer is "it did not
 * move", and the controls should show that instead of pretending.
 *
 * @param {import("../lib/config.js").Config} config
 */
function adoptConfig(config) {
  settings = config;
  applyAppearance(config.reader);
  applySpeech();
}

/**
 * Whether reading aloud is on offer, and whether it is happening. The button
 * is there for an article and only for an article: the reading list has no
 * text to read, and a device whose browser cannot speak never sees it at all.
 */
function updateListen() {
  if (listenButton === null) return;
  listenButton.hidden = shown === null || !canSpeak();
  listenButton.setAttribute("aria-pressed", String(readingState() !== "off"));
}

/**
 * The bar is the whole of what the reader sees about the state of the voice:
 * there while it reads or waits, gone the moment it is neither. Which is also
 * why nothing else has to be told when the article ends - the end of the
 * article is `off`, and `off` takes the bar with it.
 *
 * @param {import("./read-aloud.js").ReadingState} state
 */
function showSpeechBar(state) {
  if (speechBar !== null) {
    speechBar.hidden = state === "off";
    speechBar.dataset["state"] = state;
  }
  if (speechPlayLabel !== null) {
    speechPlayLabel.textContent =
      state === "paused" ? t("reader_speech_play") : t("reader_speech_pause");
  }
  updateListen();
}

/**
 * One step of the reading speed, from wherever the setting is now - read fresh,
 * because another tab may have moved it since this one drew itself, and applied
 * from what was actually stored, because at either end of the scale the honest
 * answer is "it did not move".
 *
 * The speed is not part of `reader`: it is one setting for both places a voice
 * speaks (the bubble's phrase and this article), so it lives beside them in the
 * config rather than inside the reader's appearance.
 *
 * @param {number} by
 */
async function stepRate(by) {
  const current = (await readConfig()).ttsRate;
  adoptConfig(await writeConfig({ ttsRate: clamp(current + by, TTS_RATE) }));
}

/**
 * @param {Event} event
 */
async function onDisplayPress(event) {
  const button = event.target;
  if (!(button instanceof HTMLButtonElement)) return;

  const rate = button.getAttribute("data-rate");
  if (rate !== null) {
    await stepRate(Number(rate));
    return;
  }

  const theme = button.getAttribute("data-theme");
  const font = button.getAttribute("data-font");
  const links = button.getAttribute("data-links");
  const size = button.getAttribute("data-size");
  const measure = button.getAttribute("data-measure");

  /** @type {Partial<import("../lib/config.js").ReaderConfig>} */
  let patch = {};
  if (isTheme(theme)) patch = { theme };
  else if (isFont(font)) patch = { font };
  else if (isLinks(links)) patch = { links };
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
  adoptConfig(await writeConfig({ reader: patch }));
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

/**
 * The bar's two disclosure buttons and their panels. One panel at a time:
 * the chrome must never stand two panels tall over an article, so opening
 * either one puts the other away.
 *
 * @param {HTMLElement | null} button
 * @param {HTMLElement | null} panel
 * @param {boolean} open
 */
function setPanel(button, panel, open) {
  if (button === null || panel === null) return;
  panel.hidden = !open;
  button.setAttribute("aria-expanded", String(open));
}

displayButton?.addEventListener("click", () => {
  const opening = displayPanel?.hidden === true;
  setPanel(menuButton, menuPanel, false);
  setPanel(displayButton, displayPanel, opening);
});

menuButton?.addEventListener("click", () => {
  const opening = menuPanel?.hidden === true;
  setPanel(displayButton, displayPanel, false);
  setPanel(menuButton, menuPanel, opening);
});

function anyPanelOpen() {
  return displayPanel?.hidden === false || menuPanel?.hidden === false;
}

function closePanels() {
  setPanel(displayButton, displayPanel, false);
  setPanel(menuButton, menuPanel, false);
}

// An open panel yields to the page underneath (Michał's report, 2026-08-16):
// with the chrome stuck over the article, a panel left open is a curtain, and
// closing it must not cost a precise press on the button that opened it.
// `pointerdown`, the armed Delete's moment, so the press that closes the
// panel can also be the press that starts a selection. Presses inside the
// chrome are the panels' own business - the toggles' click handlers decide.
document.addEventListener("pointerdown", (event) => {
  if (!anyPanelOpen()) return;
  if (event.target instanceof Node && chromeBox !== null && chromeBox.contains(event.target)) return;
  closePanels();
});

// Escape closes the panel the way it stands down the armed Delete - and hands
// the focus back to the bar if it was inside, rather than dropping it on the
// body for a keyboard to hunt from the top.
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !anyPanelOpen()) return;
  const focus = document.activeElement;
  if (focus instanceof Node && displayPanel?.contains(focus) === true) displayButton?.focus();
  else if (focus instanceof Node && menuPanel?.contains(focus) === true) menuButton?.focus();
  closePanels();
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
  const kind = button.getAttribute("data-kind") ?? "article";

  if (button.classList.contains("library-delete")) {
    // Two presses on the same spot (D-e), asked with text, answered for real:
    // the second one deletes the row from the database, not from the screen.
    if (button.hasAttribute("data-armed")) void removeRow(button, url, kind);
    else armDelete(button);
    return;
  }
  if (kind === "book") void openBook(url);
  else void openSaved(url);
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

/**
 * One picker, two readers: the file itself says which it is (`importKind` -
 * name, then declared type, then the ZIP magic every EPUB opens with).
 * Whichever way it goes, the other reader's report goes quiet first: two
 * sentences about two different imports standing together would read as
 * one report.
 *
 * @param {File} file
 */
async function dispatchImport(file) {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (importKind({ name: file.name, type: file.type, head }) === "book") {
    closeImportOffer();
    transferStatus("");
    await runBookImport(file);
  } else {
    bookImportStatus("");
    await offerImport(file);
  }
}

importInput?.addEventListener("change", () => {
  if (importInput === null) return;
  const file = importInput.files?.[0];
  // Cleared so that the same file, picked again, fires this again.
  importInput.value = "";
  if (file !== undefined) void dispatchImport(file);
});

importRun?.addEventListener("click", () => void runImport());

importCancel?.addEventListener("click", () => {
  closeImportOffer();
  transferStatus("");
});

/**
 * The book import's own status line, in the transfer section with the
 * article import's report (`.status:empty` keeps it out of the flow while
 * it has nothing to say). Its own line rather than the shared one: this
 * one ticks per written part, and must not overwrite a standing report.
 *
 * @param {string} text
 * @param {"error"} [tone]
 */
function bookImportStatus(text, tone) {
  if (bookImportLine === null) return;
  bookImportLine.textContent = text;
  if (tone === undefined) delete bookImportLine.dataset["tone"];
  else bookImportLine.dataset["tone"] = tone;
}

/** One import at a time - the disabled button is the whole lock's UI. */
let importingBook = false;

/**
 * @param {File} file
 */
async function runBookImport(file) {
  if (importingBook) return;
  importingBook = true;
  if (importButton instanceof HTMLButtonElement) importButton.disabled = true;
  bookImportStatus(t("reader_book_importing", "1"));
  try {
    // Progress once per segment written, not per block - every repaint is a
    // flash on e-ink, and the segment is the honest unit of "saved so far".
    const outcome = await importEpub(file, (written) =>
      bookImportStatus(t("reader_book_importing", written.toLocaleString())),
    );
    if (outcome.ok) {
      bookImportStatus(t("reader_book_added", outcome.book.title));
      await refreshLibrary();
    } else {
      bookImportStatus(
        outcome.reason === "drm" ? t("reader_book_drm") : t("reader_book_unreadable"),
        "error",
      );
    }
  } finally {
    importingBook = false;
    if (importButton instanceof HTMLButtonElement) importButton.disabled = false;
  }
}

for (const button of segmentPrevs) button?.addEventListener("click", () => turnSegment(-1));
for (const button of segmentNexts) button?.addEventListener("click", () => turnSegment(1));

bookNoteSettings?.addEventListener("click", () => void webext().runtime.openOptionsPage());

// The leavings of an import a closed tab cut short, taken out at the door:
// this page is the only one with a key to the database, so its opening is
// the only "start" there is (O18). Quiet on failure - orphans are invisible,
// and the next opening will try again.
void sweepOrphanSegments().catch(() => undefined);

// One way back, two doors: the line above the article and the one under it.
for (const button of [toLibraryButton, toLibraryEndButton]) {
  button?.addEventListener("click", () => {
    hideNotice();
    void showLibrary();
  });
}

// The mark in the bar is the door to the settings - the one line standing over
// every view of this page. Its own tab (`openOptionsPage`, which raises the
// settings tab if one is already open), so the article on screen stays where it
// is; and asked here rather than through the background, because an extension
// page may call it itself.
brandButton?.addEventListener("click", () => void webext().runtime.openOptionsPage());

// The menu's rows, each putting the menu away when pressed: a hallway is for
// passing through, and every one of them leaves this tab standing - coming
// back must not find the hallway still open. The list row turns this page's
// own view, the same act as the arrows around the article. The phrases row
// goes through the background exactly as the popup's does (`vocab-tab.js`):
// the saved phrases are one tab, and a message is what raises it rather than
// opening a copy - while the article here stays where it was scrolled to.
// The settings row is the mark's press with a word on it.
navLibrary?.addEventListener("click", () => {
  setPanel(menuButton, menuPanel, false);
  hideNotice();
  void showLibrary();
});

navVocabulary?.addEventListener("click", () => {
  setPanel(menuButton, menuPanel, false);
  // A rejection means the background was mid-restart. The press can be
  // repeated; the popup's rows make the same bargain.
  void webext()
    .runtime.sendMessage({ kind: Message.OPEN_VOCABULARY })
    .catch(() => undefined);
});

navSettings?.addEventListener("click", () => {
  setPanel(menuButton, menuPanel, false);
  void webext().runtime.openOptionsPage();
});

keepButton?.addEventListener("click", () => void onKeepPress());
removeButton?.addEventListener("click", () => void onRemovePress());
markReadButton?.addEventListener("click", () => void onMarkReadPress());
markReadEndButton?.addEventListener("click", () => void onMarkReadPress());

// Reading aloud (D87). The module keeps the place and the voice; this page
// owns the two things a reader can see - the bar and the button - and hears
// about every change in one callback.
configureReading({
  article: () => article,
  // How far down the window the stuck chrome reaches (D93): a sentence under
  // it is covered paper, not visible text, and the voice must neither start
  // on one nor park the spoken line beneath the bar. The same line the
  // position save reads under, measured by the same function.
  fold: chromeFold,
  onChange: showSpeechBar,
  // The engine refusing is the one thing reading aloud can do that leaves
  // nothing on screen to explain itself, so it is said in the page's own
  // notice line rather than in a bar that has just disappeared.
  onFail: () => showNotice(t("reader_speech_failed")),
});

/**
 * A press with a pointer leaves no focus behind on the buttons that steer the
 * voice. While the reading is on, the space bar belongs to the reading - and a
 * transport button still holding focus from a click would swallow it and press
 * itself instead. That is exactly what happened: after Forward was clicked,
 * every space bar stepped another sentence.
 *
 * A press from the keyboard keeps its focus, because that is how the button
 * was reached and the ring is how somebody knows where they are. `detail` is
 * what tells them apart - zero for a click the keyboard produced, one or more
 * for a real pointer.
 *
 * @param {string} id
 * @param {() => void} act
 */
function onSpeechPress(id, act) {
  document.getElementById(id)?.addEventListener("click", (event) => {
    if (event.detail > 0 && event.currentTarget instanceof HTMLElement) {
      event.currentTarget.blur();
    }
    act();
  });
}

onSpeechPress("listen", () => toggleReading());
onSpeechPress("speech-play", () => toggleReading());
onSpeechPress("speech-stop", () => stopReading());
onSpeechPress("speech-back", () => skipSentence(-1));
onSpeechPress("speech-forward", () => skipSentence(1));

voiceChoice?.addEventListener("change", () => {
  if (voiceChoice === null) return;
  // The whole map is written back (see `writeConfig`), which is what lets the
  // first line remove the entry rather than store an empty choice. The key is
  // the article's language, so a German article read inside an en-pl pair
  // remembers its German voice without disturbing the pair's.
  const key = primaryLanguage(speechLang());
  const map = { ...settings.ttsVoices };
  if (voiceChoice.value === "") delete map[key];
  else map[key] = voiceChoice.value;
  void writeConfig({ ttsVoices: map }).then(adoptConfig);
});

/**
 * The keys a hand at a desk already knows, and **only while the voice is
 * reading**. That last part is the whole design: the space bar is how a page
 * is read on a desktop, and taking it away from somebody who is not listening
 * would be this feature reaching outside itself. While the bar is up the page
 * scrolls itself anyway, so the key is free to mean what it means in every
 * player.
 *
 *   space          pause, and press again to carry on
 *   left / right   a sentence back, a sentence on (the bar's own arrows)
 *   < / >          slower, faster (the step the panel's buttons take)
 *
 * Which press is ours is decided in `lib/reader/keys.js`, where it can be
 * tested: it was wrong twice, and both times because of what it said no to.
 *
 * @param {KeyboardEvent} event
 */
function onSpeechKey(event) {
  if (readingState() === "off") return;

  const target = event.target instanceof HTMLElement ? event.target : null;
  const action = speechAction({
    key: event.key,
    alt: event.altKey,
    ctrl: event.ctrlKey,
    meta: event.metaKey,
    tag: target?.tagName ?? "",
    editable: target?.isContentEditable ?? false,
  });
  if (action === null) return;

  if (action === "toggle") toggleReading();
  else if (action === "back") skipSentence(-1);
  else if (action === "forward") skipSentence(1);
  else void stepRate(action === "slower" ? -TTS_RATE.step : TTS_RATE.step);

  // Only now, and only for a press that meant something: the space bar keeps
  // scrolling and the arrows keep doing whatever they do, right up until the
  // voice is reading.
  event.preventDefault();
}

document.addEventListener("keydown", onSpeechKey);

// A tab going away mid-sentence has to take the voice with it: the queue
// behind `speechSynthesis` belongs to the browser, not to this page, and an
// utterance left in it goes on talking over a closed tab.
window.addEventListener("pagehide", () => stopReading());

// The rows exist only where they can do something, and the engine's voice list
// arrives on its own schedule - after first paint on most platforms, never at
// all on some (Android speaks anyway, see `lib/tts.js`).
if (canSpeak()) {
  if (voiceSetting !== null) voiceSetting.hidden = false;
  if (rateSetting !== null) rateSetting.hidden = false;
  speechSynthesis.addEventListener("voiceschanged", renderVoiceChoice);
}

// The settings can change in another reader tab, and the language pair on the
// settings page. Reading the whole thing back is cheaper than working out which
// half moved.
webext().storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || changes[CONFIG_KEY] === undefined) return;
  void readConfig().then(adoptConfig);
});

void readConfig().then(adoptConfig);

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

// A link set to plain text must not answer a press (D95): the stylesheet took
// its dress, this takes its click - including the Enter of a focus restored by
// other means, which arrives here as a click too. `auxclick` besides, because
// a middle click opens a tab without ever firing `click`. The mode is read at
// press time, so the switch in the panel needs no rewiring here.
/** @param {MouseEvent} event */
function onArticleLink(event) {
  if (settings.reader.links !== "plain") return;
  const pressed = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (pressed !== null) event.preventDefault();
}

contentElement?.addEventListener("click", onArticleLink);
contentElement?.addEventListener("auxclick", onArticleLink);

// The same reading side as on any other page, scoped to the article: the
// reader's own heading and links are not text anybody is learning from, and
// nothing in this document changes unless the code above changes it, so there
// is nothing for an observer to watch. Every pointer selects through our own
// gesture here (D80/D81, the mouse since D86) - this is our page, so refusing
// the native selection is allowed, and it is the one way to select whole
// words with no system menu in the way and the bubble landing exactly on the
// finger or the button lifting. For the same reason the bubble pins to the
// page rather than the viewport (`anchored`): it rides the scroll with its
// phrase like a margin note, which only a layout we control can promise to
// survive. `plainLinks` tells the gesture when links are dressed as plain
// text (D95): then a hold or a press on one selects its word like any other -
// without this, a word in a link could be neither followed nor selected.
start({
  root: article,
  observe: false,
  ownSelection: true,
  anchored: true,
  plainLinks: () => settings.reader.links === "plain",
});

void showPage();
