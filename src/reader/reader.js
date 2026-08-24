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

import { supported as highlightsSupported } from "../content/highlighter.js";
import { dismiss, rescan, start, stop as stopReadingSide } from "../content/reading.js";
import { applyReading } from "../lib/appearance.js";
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
import { lookUp } from "../lib/dict/lookup.js";
import { describeError } from "../lib/messages.js";
import { ErrorCode, Message, asPage, asPageRequest, asResult, ok } from "../lib/protocol.js";
import { buildArticle } from "../lib/reader/article.js";
import { asDocState, asMarksState, docState, marksState } from "../lib/reader/history-state.js";
import { importKind } from "../lib/reader/import-kind.js";
import { speechAction } from "../lib/reader/keys.js";
import { wordless } from "../lib/matcher/words.js";
import {
  compareMarks,
  comparePoints,
  isMarkColor,
  markRecord,
  mergePlan,
  mergedNote,
  placeMark,
  withoutMark,
} from "../lib/reader/marks.js";
import { pageStep, pageTurn } from "../lib/reader/paging.js";
import {
  POSITION_SAVE_DELAY,
  blockAtLine,
  fineScrollTop,
  measuredPercent,
  positionRecord,
  restoredIndex,
} from "../lib/reader/position.js";
import { hitsInText, isSearchableQuery } from "../lib/reader/search.js";
import { isUnderlineWeight } from "../lib/underline.js";
import { READER_SOURCE_KEY, readReaderSource, writeReaderTab } from "../lib/session.js";
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
import { packableBlocks } from "../lib/book/blocks.js";
import { cappedToc, headingEntries, renderedEntries } from "../lib/book/toc.js";
import {
  deleteBook,
  getBook,
  getBookSegment,
  listBooks,
  setBookReadAt,
  setBookToc,
  sweepOrphanSegments,
} from "../lib/store/books.js";
import { MARKS_FILENAME, toMarksFile } from "../lib/store/marks-file.js";
import { allMarks, getMarks, putMarks } from "../lib/store/marks.js";
import { Segment, emptySentence, savedArticle } from "../lib/store/saved-article.js";
import { watchToolbarScheme } from "../lib/theme-icon.js";
import {
  canSpeak,
  primaryLanguage,
  speak,
  speaking,
  stop as stopTts,
  voicesFor,
} from "../lib/tts.js";
import {
  closeDocSearch,
  configureDocSearch,
  openDocSearch,
  resetDocSearch,
} from "./doc-search.js";
import { importEpub } from "./import-book.js";
import {
  configureLibrarySearch,
  dismissLibrarySearch,
  librarySearchShown,
  startLibrarySearch,
} from "./library-search.js";
import { articleEntry, bookEntry, libraryView } from "./list-view.js";
import { markRows, marksListView } from "./marks-list.js";
import {
  adoptPaintedMark,
  anchorOf,
  clearMarkPaint,
  markAt,
  markEdges,
  paintMarks,
  paintedRangeOf,
  proseTextOf,
  quoteOfSpan,
  rangeWithin,
} from "./marks-view.js";
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
// The views own their scroll: the list starts at its top, a document at its
// remembered place (D98). A browser also restoring offsets on history steps
// (D102) would fight both - and always a beat late, over a view just rebuilt.
history.scrollRestoration = "manual";
// The toolbar icon follows the browser's scheme where the manifest cannot
// say so (Chromium, no theme_icons there) - a no-op on Firefox.
watchToolbarScheme();
// The colophon's version, from the one place that knows it. The line itself
// shows only over the list views (reader.css) - the document view is somebody
// else's text and the room disappears around it.
const versionSpan = document.getElementById("version");
if (versionSpan !== null) versionSpan.textContent = webext().runtime.getManifest().version;

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
const navToc = document.getElementById("nav-toc");
const navSearch = document.getElementById("nav-search");
const navLibrary = document.getElementById("nav-library");
const navMarks = document.getElementById("nav-marks");
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
const underlineSetting = document.getElementById("underline-setting");
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
// The deep search's own furniture (D119): the checkbox line under the
// filter, and the section its results stand in.
const librarySearchToggle = /** @type {HTMLInputElement | null} */ (
  document.getElementById("library-search-toggle")
);
const librarySearchGo = /** @type {HTMLButtonElement | null} */ (
  document.getElementById("library-search-go")
);
const librarySearchSection = document.getElementById("library-search");
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
const exportMarksButton = /** @type {HTMLButtonElement | null} */ (
  document.getElementById("library-export-marks")
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
// The highlights page (D108): the reading list's furniture repeated - a
// filter, an empty state, the rows, a pager - plus the scoped page's title
// line, its own export, and the template a row's copy button is cloned from.
const marksSection = document.getElementById("marks");
const marksDocLine = document.getElementById("marks-doc");
const marksFilter = /** @type {HTMLInputElement | null} */ (
  document.getElementById("marks-filter")
);
const marksCount = document.getElementById("marks-count");
const marksEmpty = document.getElementById("marks-empty");
const marksRowsList = document.getElementById("marks-rows");
const marksPager = document.getElementById("marks-pager");
const marksPageLabel = document.getElementById("marks-page-label");
const marksPrev = /** @type {HTMLButtonElement | null} */ (document.getElementById("marks-prev"));
const marksNext = /** @type {HTMLButtonElement | null} */ (document.getElementById("marks-next"));
const marksExportButton = /** @type {HTMLButtonElement | null} */ (
  document.getElementById("marks-export")
);
const marksCopyIcons = /** @type {HTMLTemplateElement | null} */ (
  document.getElementById("marks-copy-icons")
);
const marksOpenIcon = /** @type {HTMLTemplateElement | null} */ (
  document.getElementById("marks-open-icon")
);
const marksSpeakIcon = /** @type {HTMLTemplateElement | null} */ (
  document.getElementById("marks-speak-icon")
);
const marksNoteIcon = /** @type {HTMLTemplateElement | null} */ (
  document.getElementById("marks-note-icon")
);
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
// The book's table of contents (D116): the two doors in the pagers, and the
// dialog they open.
const tocButtons = [document.getElementById("toc"), document.getElementById("toc-end")];
const tocDialog = /** @type {HTMLDialogElement | null} */ (
  document.getElementById("toc-dialog")
);
const tocRows = document.getElementById("toc-rows");
const tocCloseButton = document.getElementById("toc-close");
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
// The highlighter (D106): the pen in the bar, the toolbar standing at the
// foot of the window for as long as the pen is in the hand (D107), and the
// two pins that point out the mark the toolbar is about.
const markerButton = /** @type {HTMLButtonElement | null} */ (document.getElementById("marker"));
const markBar = document.getElementById("mark-bar");
const markCopyButton = document.getElementById("mark-copy");
const markCopyLabel = document.getElementById("mark-copy-label");
const markNoteButton = document.getElementById("mark-note");
const markDeleteButton = document.getElementById("mark-delete");
const markPinStart = document.getElementById("mark-pin-start");
const markPinEnd = document.getElementById("mark-pin-end");

// The note dialog and the badges of the noted marks (D118).
const markNoteBadges = document.getElementById("mark-note-badges");
const noteDialog = /** @type {HTMLDialogElement | null} */ (
  document.getElementById("note-dialog")
);
const noteQuote = document.getElementById("note-quote");
const noteText = /** @type {HTMLTextAreaElement | null} */ (document.getElementById("note-text"));
const noteSaveButton = document.getElementById("note-save");
const noteCancelButton = document.getElementById("note-cancel");
const noteCloseButton = document.getElementById("note-close");

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
 * Whether the highlighter is on (D106) - a tool in the hand, never a setting:
 * every document opens with the pen away, and nothing about it is stored.
 */
let markerOn = false;

/**
 * The marks of the document on screen, in reading order, as the database has
 * them - every segment of a book, not just the part showing. Mutated
 * optimistically: a stroke paints the moment it lands and the write follows,
 * with `shown`'s identity guarding the answer like every other slow reply.
 *
 * @type {import("../lib/reader/marks.js").Mark[]}
 */
let docMarks = [];

/**
 * The table of contents of the document on screen (D116/D117) - a book's
 * stored, whole-book list, an article's map read straight off its rendered
 * blocks, empty for a document without headings. What the pagers' TOC
 * buttons and the menu row show themselves for and the dialog renders from;
 * follows `shown` the way the marks do.
 *
 * @type {import("../lib/book/toc.js").TocEntry[]}
 */
let docToc = [];

/**
 * The rendered blocks an article's TOC entries index into - the dissolved
 * walk, not `contentRoot().children`: Readability hands back the whole
 * article inside one wrapper `div` (kept by the sanitizer, a `div` may be
 * a paragraph), so the headings live a level or two down, and only the
 * walk that dissolves packaging sees them - the same `packableBlocks` the
 * book import runs before storing. Empty over a book, whose entries anchor
 * to stored top-level blocks instead; rebuilt with every render, so no
 * element here ever outlives the DOM it points into.
 *
 * @type {Element[]}
 */
let tocBlocks = [];

/**
 * Books whose TOC backfill is running in this page - one scan per book at a
 * time. A finished scan needs no memory here: the row it wrote is what stops
 * the next one, and a failed scan should indeed run again.
 *
 * @type {Set<string>}
 */
const tocScansRunning = new Set();

/**
 * The mark the toolbar is about, while it shows (D107). Which one it is on
 * screen is said by the recall wash painted over it - `reread-active`, the
 * same registration the bubble uses, safe to borrow because the pen and the
 * bubble never stand at once (marker mode claims every tap).
 *
 * @type {import("../lib/reader/marks.js").Mark | null}
 */
let activeMark = null;

/** The copy button's feedback standing down, if a copy just happened. */
/** @type {ReturnType<typeof setTimeout> | null} */
let copiedTimer = null;

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
 * The highlights page, while it is the view (D108) - null otherwise, the
 * same way `shown` is null off the documents. `scope` narrows the quotes to
 * one document's; null shows everybody's.
 *
 * @type {{ scope: string | null } | null}
 */
let marksShown = null;

/**
 * The highlights page's filter box and page, the reading list's pair
 * repeated - and kept across a Back from a quote's article, so the browse
 * (open a quote, step back, take the next) does not retype its search.
 * A visit through the menu starts both fresh.
 */
let marksQuery = "";
let marksPage = 1;

/**
 * The rows on screen, exactly as rendered - the press handlers' lookup:
 * a row's buttons carry an index into this list rather than dressing the
 * DOM in offsets.
 *
 * @type {import("./marks-list.js").MarkRow[]}
 */
let marksOnScreen = [];

/**
 * The quote on its way out loud, by the mark's own name - the saved-phrases
 * page's rule repeated: pressing that row's speaker again stops it, any
 * other row's simply speaks (the engine replaces what was playing), and a
 * key gone stale is harmless because `speaking()` answers for the engine.
 *
 * @type {string | null}
 */
let soundingMark = null;

/**
 * Whether a walk back to the list is in progress (the menu's list row over
 * stacked entries): popstate keeps stepping while the entries are this
 * page's own, and shows the list on the first one that is not.
 */
let unwindToList = false;

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
  // sentence of one article into another (D87). A quote a row's speaker was
  // reading goes the same way - its page is leaving the screen.
  forgetReading();
  stopMarkSpeech();
  // The column breathes with the text size only under an article (see the
  // measure rules in reader.css); the attribute is which rule applies.
  document.body.dataset["view"] = "doc";
  // A different document never inherits the pen (D106) or the other one's
  // search (D119): both survive only a book turning its own parts - a
  // search's hits are the whole book's. The active mark and the paint go
  // either way - they stood over blocks about to be replaced - and the marks
  // themselves are the opener's to reload once the new blocks stand.
  if (shown === null || shown.url !== piece.url) {
    setMarker(false);
    resetDocSearch();
  }
  deselectMark();
  docMarks = [];
  clearMarkPaint();
  clearSearchWash();
  showNoteBadges();
  // The book dressing is put on by `openBook` after this returns; every
  // other road through here takes it off. The dialogs too: a Back can land
  // here with one still standing over a document that is leaving.
  showSegmentNav(null);
  showBookNote(null);
  closeTocDialog();
  closeDocSearch();

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
  // The document's own map (D117), read off the blocks that just stood up.
  // A book's is the stored, whole-book list instead - `openBook` puts it on
  // right after this returns, the way it dresses everything else book-shaped.
  if (piece.origin === "book") {
    tocBlocks = [];
    docToc = [];
  } else {
    docToc = articleToc();
  }
  updateTocButtons();
  applyLinkStops(settings.reader.links);
  if (library !== null) library.hidden = true;
  if (marksSection !== null) marksSection.hidden = true;
  marksShown = null;
  article.hidden = false;
  hideNotice();

  // The learning side back on the article, if a view moved it elsewhere
  // (D109), and the underlines found again now that there is different text
  // under the ground. Nothing is asked of storage: the vocabulary did not
  // change, only what it can be found in.
  rootReadingSide(article);
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
  // With an article on screen the list is elsewhere, so the menu offers it -
  // and the highlights are always elsewhere from here. The search row shows
  // over any document (D119); the list views have filters of their own.
  if (navLibrary !== null) navLibrary.hidden = false;
  if (navMarks !== null) navMarks.hidden = false;
  if (navSearch !== null) navSearch.hidden = false;
  // The back arrow means the list again until a door says otherwise - the
  // quotes' door relabels it after this render (D108).
  setBackDoor(t("reader_back_to_list"), t("reading_list"));
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
  updateMarker();
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
  // A live page starts at the top, so the action rows may come when they come
  // - and with the default keep (D124) they wait for the database to have its
  // say about this address, rather than saying Save for a moment first.
  const rendered = shown;
  if (rendered !== null) void openLiveActions(rendered);
  // The marks a past reading left under this address (D106) arrive on their
  // own: paint takes no room, so nothing waits on it.
  void getMarks(page.url)
    .then((marks) => {
      if (shown !== rendered) return;
      docMarks = marks;
      repaintMarks();
    })
    .catch(() => undefined);
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

/**
 * The strip of the window the article is actually read in (D127): under the
 * stuck chrome, above whichever bar stands at the foot of the window. In
 * viewport coordinates, measured at each ask - an open panel makes the chrome
 * taller, and either bar comes and goes.
 *
 * The visual viewport rather than the window's own height, for the reason the
 * bubble's `visibleBox` gives (D97): on Android the browser's address bar
 * slides in and out of the window's height, and paging by a height that
 * counts a bar standing over the text would hide the very lines this measures
 * to keep.
 *
 * @returns {{ top: number, bottom: number }}
 */
function readableBand() {
  const view = window.visualViewport;
  const seen =
    view === null
      ? { top: 0, bottom: document.documentElement.clientHeight }
      : { top: view.offsetTop, bottom: view.offsetTop + view.height };

  let bottom = seen.bottom;
  for (const bar of [speechBar, markBar]) {
    if (bar === null || bar.hidden) continue;
    const edge = bar.getBoundingClientRect().top;
    // A bar measured at nothing is a bar that is not laid out; taking that
    // for the floor of the text would page by one line forever.
    if (edge > 0) bottom = Math.min(bottom, edge);
  }
  return { top: Math.max(chromeFold(), seen.top), bottom };
}

/**
 * One line of the text being read, which is what a page turn keeps on screen.
 * Read off the body, where the article's type lives (`reader.css`), so the
 * overlap grows with the reader's own size setting rather than with a number
 * written here.
 *
 * @returns {number}
 */
function readingLine() {
  const line = Number.parseFloat(getComputedStyle(document.body).lineHeight);
  return Number.isFinite(line) && line > 0 ? line : 24;
}

/**
 * Turning the page with the keyboard (D127) - the hardware page keys of an
 * e-reader among them, which is where this came from: the browser pages by a
 * screenful it measures against the whole window, and the reader's chrome is
 * stuck over the top of that window, so a few lines of every page landed
 * behind the bar and had to be scrolled back to (reported from a Boox Page).
 *
 * Only while an article is on screen, which is the stylesheet's own condition
 * for sticking the chrome: over the reading list and the highlights page
 * nothing stands over the text and the browser's own paging is already right.
 * Which press is ours is decided in `lib/reader/paging.js`, where it can be
 * tested, and so is how far one goes.
 *
 * @param {KeyboardEvent} event
 */
function onPageKey(event) {
  if (article === null || article.hidden) return;

  const target = event.target instanceof HTMLElement ? event.target : null;
  const turn = pageTurn({
    key: event.key,
    shift: event.shiftKey,
    alt: event.altKey,
    ctrl: event.ctrlKey,
    meta: event.metaKey,
    tag: target?.tagName ?? "",
    editable: target?.isContentEditable ?? false,
    reading: readingState() !== "off",
    dialog: document.querySelector("dialog[open]") !== null,
  });
  if (turn === null) return;

  event.preventDefault();
  const step = pageStep(readableBand(), readingLine());
  // Instantly, and nothing here says otherwise: a smooth scroll on an e-ink
  // panel is a page of smeared refreshes. The scroll itself arms the position
  // save like any other, so where the reading stands follows the keys.
  scrollBy(0, turn === "down" ? step : -step);
}

document.addEventListener("keydown", onPageKey);

/**
 * The highlighter (D106): the pen in the bar hands the selection gesture to
 * the marker - a hold and a drag draw a lasting mark, across paragraphs if
 * the hand goes there - and a tap on a mark, pen in hand, raises the one-word
 * bubble that takes it back. The gesture itself lives in `select.js`, the
 * anchors and the paint in `marks-view.js`, the rules in `lib/reader/marks.js`
 * and the rows in `lib/store/marks.js`; what lives here is the mode, the
 * bubble, and the writes with their `shown`-identity guards.
 */

/**
 * What a new mark is drawn in: the Aa panel's pick. The record has carried
 * its colour since the first mark ever written, so the choice only ever
 * says what the next stroke wears - and repainting an old mark is drawing
 * over it, which merges and takes the current ink.
 */
function currentMarkColor() {
  return settings.reader.markerColor;
}

/** The segment the marks on screen belong to - a book's part, an article's zero. */
function shownSegment() {
  return shown !== null && shown.origin === "book" ? shown.segmentIndex : 0;
}

/**
 * The pen offered only where it can write: over a document, on an engine
 * that has the highlight registry at all - without it the marks could not
 * even be shown, and a pen that writes invisibly is worse than none.
 */
function updateMarker() {
  if (markerButton === null) return;
  markerButton.hidden = shown === null || !highlightsSupported();
  markerButton.setAttribute("aria-pressed", String(markerOn));
}

/**
 * Picking the pen up or putting it away. Picking it up stands the bubble and
 * the selection down (`dismiss`): the pen changes what every gesture means,
 * and an answer from the old grammar must not outlive the grammar. The
 * toolbar comes and goes with the pen (D107, Michał's wish: choose the ink
 * before the first stroke), opening in its pen state - no mark active until
 * one is tapped.
 *
 * @param {boolean} on
 */
function setMarker(on) {
  if (markerOn !== on) {
    markerOn = on;
    deselectMark();
    if (markBar !== null) markBar.hidden = !on;
    if (on) {
      // One tool in the hand at a time (Michał's word, 2026-08-17): picking
      // the pen up stops a reading and takes its bar with it, the way the
      // voice starting puts the pen away (`showSpeechBar`).
      stopReading();
      // The panels are the same rule's other half (D123): the bar lights one
      // tool, so the pen picked up closes whatever hangs under Aa or the
      // menu, and opening either puts the pen away (their click handlers).
      closePanels();
      dismiss();
    }
  }
  updateMarker();
}

function repaintMarks() {
  paintMarks(docMarks, shown === null ? null : contentRoot(), shownSegment());
  // The badges stand on the painted ranges, so they follow every repaint.
  showNoteBadges();
}

/**
 * A finished stroke becoming a mark: anchored against the block order,
 * merged with whatever standing marks it touched (drawing over a mark is how
 * a mark grows), painted at once, and then written - with the paint taken
 * back and the failure said out loud if the write does not land. On a live
 * page the first mark saves the article first (D106): a mark needs a row to
 * belong to, and the same door the Save button uses is the honest way in.
 *
 * @param {Range} range
 */
async function onMarked(range) {
  const root = contentRoot();
  if (root === null) return;
  const span = anchorOf(range, root, shownSegment());
  if (span === null) return;
  await commitSpan(span, currentMarkColor());
}

/**
 * A span becoming the standing mark: merged with whatever it touched,
 * painted, made the active mark - a fresh mark opens with its pins and its
 * acts ready, because deleting or copying what was just drawn is the next
 * thing a hand does (D107, Michał's report) - and then written, with the
 * paint taken back and the failure said out loud if the write does not
 * land. The colour is the caller's word: the pen's ink for a stroke, the
 * mark's own for a growth by its neighbour.
 *
 * @param {import("../lib/reader/marks.js").MarkSpan} span
 * @param {string} color
 */
async function commitSpan(span, color) {
  const target = shown;
  const root = contentRoot();
  if (target === null || root === null) return;
  deselectMark();

  const plan = mergePlan(docMarks, span);
  const text = quoteOfSpan(plan.span, root);
  // A growth or a merge inherits every absorbed note (`mergedNote`): drawing
  // over an annotated mark grows the mark, and the words somebody wrote on
  // it must not be the price.
  const mark =
    text === null
      ? null
      : markRecord({
          ...plan.span,
          color,
          createdAt: Date.now(),
          text,
          note: mergedNote(plan.absorbed),
        });
  if (mark === null) return;

  const before = docMarks;
  docMarks = placeMark(docMarks, plan.absorbed, mark);
  repaintMarks();
  const painted = paintedRangeOf(mark);
  if (painted !== null) activateMark({ mark, range: painted });

  try {
    if (target.origin === "live") {
      const kept = await keptRow(target);
      if (shown !== target) return;
      if (!kept) throw new Error("The article could not be saved");
      // A first mark that had to write the row moves the bar's toggle to
      // its kept state. Asked after every mark rather than only after a
      // write: one small read beats carrying "was it me who saved it" back.
      void refreshActions();
    }
    await putMarks(target.url, docMarks);
  } catch {
    if (shown !== target) return;
    docMarks = before;
    deselectMark();
    repaintMarks();
    showNotice(t("reader_list_write_failed"));
  }
}

/**
 * The row a live article belongs to, made sure of - present already, or
 * written now through the same path the Save button uses. Two hands knock:
 * the first mark on a live page (D106), which needs a row to hang marks on,
 * and the default keep as the article opens (D124).
 *
 * Never a write over a row that is already there. `putArticle` clears the
 * marks and the reading position under the address as it writes (its rule
 * for content being replaced) - which is exactly right for the marks caller,
 * who writes the whole list right after, and would be a quiet loss for
 * anybody else. The action rows are the caller's business; both have their
 * own moment to redraw them.
 *
 * @param {NonNullable<typeof shown>} target
 * @returns {Promise<boolean>} whether the row is there to write against
 */
async function keptRow(target) {
  const existing = await getArticleMeta(target.url);
  if (shown !== target) return false;
  if (existing !== null) return true;
  return saveShownLive(target);
}

/**
 * A tap while the pen is in the hand: a mark under it turns the toolbar to
 * that mark; the word right beside the active mark grows it by that word
 * (D107, the translation gesture's own one-step grammar); bare text puts
 * the pen down whole - one tap, active mark or not. An outward ladder was
 * tried here first and Michał overruled it after living with it: a tap
 * away means "done marking", and paying two taps for it read as the page
 * not listening. Escape alone keeps the ladder - stepping outward is what
 * that key means everywhere.
 *
 * @param {number} x
 * @param {number} y
 * @param {Range} [word] the glued range of the tapped word, when there was one
 */
function onMarkTap(x, y, word) {
  const hit = markAt(x, y);
  if (hit !== null) {
    activateMark(hit);
    return;
  }
  if (word !== undefined && growActiveBy(word)) return;
  setMarker(false);
}

/**
 * The active mark grown by a tapped neighbour, when the tap really named
 * one: the word stands in the same paragraph as the mark's edge, with
 * nothing wordlike between them - across a paragraph break or past another
 * word, the tap keeps meaning what a tap on bare text means. The growth
 * keeps the mark's own ink: this is "this word too", never a repaint.
 *
 * @param {Range} word
 * @returns {boolean} whether the tap was answered here
 */
function growActiveBy(word) {
  const active = activeMark;
  const root = contentRoot();
  if (active === null || root === null) return false;

  const span = anchorOf(word, root, shownSegment());
  if (span === null || span.segmentIndex !== active.segmentIndex) return false;

  if (span.start.block === active.end.block && comparePoints(span.start, active.end) >= 0) {
    const prose = proseTextOf(root, active.end.block);
    if (prose === null || !wordless(prose.slice(active.end.offset, span.start.offset))) return false;
    void commitSpan({ segmentIndex: span.segmentIndex, start: active.start, end: span.end }, active.color);
    return true;
  }
  if (span.end.block === active.start.block && comparePoints(active.start, span.end) >= 0) {
    const prose = proseTextOf(root, active.start.block);
    if (prose === null || !wordless(prose.slice(span.end.offset, active.start.offset))) return false;
    void commitSpan({ segmentIndex: span.segmentIndex, start: span.start, end: active.end }, active.color);
    return true;
  }
  return false;
}

/** Escape's one step outward: the active mark down, or - with none - the pen. */
function stepOut() {
  if (activeMark !== null) deselectMark();
  else setMarker(false);
}

/**
 * The toolbar turned to one mark: the pins at its ends say which one, in
 * the mark's own true ink - a strip at the window's foot cannot point the
 * way a bubble beside the line could, and the wash tried first read as a
 * darker, wrong colour over the mark (Michał's report).
 *
 * @param {{ mark: import("../lib/reader/marks.js").Mark, range: Range }} hit
 */
function activateMark(hit) {
  activeMark = hit.mark;
  placeMarkPins(hit.range);
  refreshMarkBar();
}

/**
 * The two pins on a mark's first and last line: a stem the line's height
 * with a dot at the outer end - the shape every platform's selection
 * handles taught, though these only point (nothing drags). Page
 * coordinates, so they ride the scroll with their mark.
 *
 * @param {Range} range
 */
function placeMarkPins(range) {
  if (markPinStart === null || markPinEnd === null) return;
  // The boxes of the mark's first and last character (`markEdges`), never
  // the range's full rect list - Brave's diverges from Chrome's on a range
  // crossing blocks, and the end pin reads the same geometry the badge does.
  const { head: first, tail: last } = markEdges(range);
  if (first === null || last === null) return;

  markPinStart.style.left = `${Math.round(first.left + window.scrollX - 3)}px`;
  markPinStart.style.top = `${Math.round(first.top + window.scrollY)}px`;
  markPinStart.style.height = `${Math.round(first.height)}px`;
  markPinStart.hidden = false;

  markPinEnd.style.left = `${Math.round(last.right + window.scrollX + 1)}px`;
  markPinEnd.style.top = `${Math.round(last.top + window.scrollY)}px`;
  markPinEnd.style.height = `${Math.round(last.height)}px`;
  markPinEnd.hidden = false;
}

/**
 * The toolbar dressed for its state (D107): with a mark active the swatches
 * wear its ink and the copy and the bin stand ready; with none they speak
 * for the pen - the same setting the Aa panel writes - and the two acts
 * step away, having nothing to act on.
 */
function refreshMarkBar() {
  if (markBar === null) return;
  const ink = activeMark === null ? settings.reader.markerColor : activeMark.color;
  for (const button of markBar.querySelectorAll("button[data-mark-ink]")) {
    button.setAttribute("aria-pressed", String(ink === button.getAttribute("data-mark-ink")));
  }
  if (markCopyButton !== null) markCopyButton.hidden = activeMark === null;
  if (markDeleteButton !== null) markDeleteButton.hidden = activeMark === null;
  if (markNoteButton !== null) {
    markNoteButton.hidden = activeMark === null;
    if (activeMark !== null) {
      // The dot on the glyph says "annotated" at a glance; the name says
      // which act the press really is.
      const name = activeMark.note === undefined ? t("marker_note_add") : t("marker_note_edit");
      markNoteButton.title = name;
      markNoteButton.setAttribute("aria-label", name);
      markNoteButton.toggleAttribute("data-has-note", activeMark.note !== undefined);
    }
  }
}

/**
 * The active mark stood down - pins away, the toolbar back in its pen
 * state. The bar itself stays for as long as the pen does; any focus the
 * departing acts held goes back to the pen's own button rather than to the
 * body.
 */
function deselectMark() {
  activeMark = null;
  if (markPinStart !== null) markPinStart.hidden = true;
  if (markPinEnd !== null) markPinEnd.hidden = true;
  if (
    markBar !== null &&
    document.activeElement instanceof Element &&
    (document.activeElement === markCopyButton ||
      document.activeElement === markNoteButton ||
      document.activeElement === markDeleteButton)
  ) {
    markerButton?.focus();
  }
  refreshMarkBar();
}

/**
 * The bin pressed: the mark leaves the list and the paint, then the row -
 * with the same take-back as writing one, because a delete that only looked
 * deleted would be the worse failure.
 */
async function onMarkDeletePress() {
  const target = shown;
  const active = activeMark;
  deselectMark();
  if (target === null || active === null) return;

  const before = docMarks;
  docMarks = withoutMark(docMarks, active);
  if (docMarks.length === before.length) return;
  repaintMarks();

  try {
    await putMarks(target.url, docMarks);
  } catch {
    if (shown !== target) return;
    docMarks = before;
    repaintMarks();
    showNotice(t("reader_list_write_failed"));
  }
}

/**
 * The copy pressed: the mark's own quote - the same text the exports carry,
 * block breaks as line breaks - onto the clipboard. This is the named cost
 * of D80/D86 paid back at last: the article refuses drag-to-copy, and this
 * is now the way a passage gets out without leaving the page. The feedback
 * is the button itself turning into a check for a breath: on a narrow
 * screen its word is clipped, so the glyph is the only place feedback can
 * live.
 */
async function onMarkCopyPress() {
  const active = activeMark;
  if (active === null || markCopyButton === null) return;
  try {
    await navigator.clipboard.writeText(active.text);
  } catch {
    // The clipboard refusing (no user activation, a locked-down profile) has
    // no state to show: the button simply does not claim a copy it did not
    // make.
    return;
  }
  markCopyButton.setAttribute("data-copied", "");
  if (markCopyLabel !== null) markCopyLabel.textContent = t("marker_copied");
  if (copiedTimer !== null) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    copiedTimer = null;
    markCopyButton.removeAttribute("data-copied");
    if (markCopyLabel !== null) markCopyLabel.textContent = t("marker_copy");
  }, 1500);
}

/**
 * The badges of the noted marks (D118): one small button at the tail of
 * every painted mark that carries a note - the footnote's spot. The mark's
 * own text cannot take this tap (a word inside it means "translate this"),
 * so the note gets a door of its own, standing outside the article the way
 * the pins do: absolute in page coordinates, riding the scroll with the
 * text. Rebuilt whole from the painted ranges on every repaint, on resize
 * and on an Aa change - the boxes they stand on move with any reflow - and
 * cleared by the same call once nothing is painted. A document without
 * notes costs exactly nothing here.
 */
function showNoteBadges() {
  if (markNoteBadges === null) return;
  /** @type {HTMLButtonElement[]} */
  const badges = [];
  for (const mark of docMarks) {
    if (mark.note === undefined) continue;
    const range = paintedRangeOf(mark);
    if (range === null) continue;
    // The box of the mark's last character (`markEdges`), never the range's
    // full rect list - Brave's diverges from Chrome's on a range crossing
    // blocks, and the badge stood mid-mark on it.
    const last = markEdges(range).tail;
    if (last === null) continue;

    const badge = document.createElement("button");
    badge.type = "button";
    badge.className = "mark-note-badge";
    badge.title = t("marker_note_edit");
    badge.setAttribute("aria-label", t("marker_note_edit"));
    if (marksNoteIcon !== null) badge.append(marksNoteIcon.content.cloneNode(true));
    // The footnote's raise past the line's top, just off the mark's last
    // box - and held inside the page, so a mark ending against the right
    // edge cannot push a scrollbar under the article. The offsets centre
    // the glyph at the box's old spot while the 40px target grows outward
    // (mostly rightward and into the line gap above, where no word pays
    // for it).
    const left = Math.min(
      Math.round(last.right + window.scrollX - 6),
      document.documentElement.clientWidth - 42,
    );
    badge.style.left = `${left}px`;
    badge.style.top = `${Math.round(last.top + window.scrollY - 18)}px`;
    badge.addEventListener("click", () => onNoteBadgePress(mark));
    badges.push(badge);
  }
  markNoteBadges.replaceChildren(...badges);
}

/**
 * A badge pressed: the dialog over that mark. The badge and the toolbar's
 * note act are two doors to the same room, so the write goes the same way.
 *
 * @param {import("../lib/reader/marks.js").Mark} mark
 */
function onNoteBadgePress(mark) {
  const target = shown;
  if (target === null) return;
  openNoteDialog(mark, (text) => void applyNoteInDoc(target, mark, text));
}

/** The toolbar's note act (D118): the dialog over the active mark. */
function onMarkNotePress() {
  const target = shown;
  const active = activeMark;
  if (target === null || active === null) return;
  openNoteDialog(active, (text) => void applyNoteInDoc(target, active, text));
}

/**
 * What Save should do with the box's text, while the dialog stands - null
 * while it does not. Cancel, Esc, the X and the backdrop all leave it
 * unread; only Save collects it.
 *
 * @type {((text: string) => void) | null}
 */
let noteDialogSave = null;

/**
 * The note dialog over one mark (D118), whichever door led here: the mark's
 * quote up top for context, its ink on the stripe, the box holding the note
 * as it stands. What Save does with the text is the caller's `onSave` - the
 * document view edits its live list, the highlights page writes through by
 * anchor. An emptied box saved means the note removed: absence is the only
 * "no note" there is, and `markRecord` narrows emptiness into absence.
 *
 * @param {import("../lib/reader/marks.js").Mark} mark
 * @param {(text: string) => void} onSave
 */
function openNoteDialog(mark, onSave) {
  if (noteDialog === null || noteText === null) return;
  noteDialogSave = onSave;
  if (noteQuote !== null) {
    // textContent only - the quote came off somebody's page. Its newlines
    // collapse in the clamped line: this is context, not the passage.
    noteQuote.textContent = mark.text;
    noteQuote.setAttribute("data-color", mark.color);
  }
  noteText.value = mark.note ?? "";
  noteDialog.showModal();
  // After showModal: a closed dialog is display:none, where nothing has a
  // scrollHeight to measure.
  sizeNoteBox();
}

/**
 * The box grown to the words it holds, so an existing note opens whole
 * instead of through a five-line slot (Michał's report). Collapsed first,
 * so a shrinking note shrinks the box too; the dialog's own cap and the
 * flex shrink bound the growth, and past the cap the box scrolls inside
 * itself. The two pixels are the borders the global border-box folds into
 * `height` but `scrollHeight` never counts.
 */
function sizeNoteBox() {
  if (noteText === null) return;
  noteText.style.height = "auto";
  noteText.style.height = `${noteText.scrollHeight + 2}px`;
}

/** The dialog down without saving - every way out except Save. */
function closeNoteDialog() {
  noteDialogSave = null;
  if (noteDialog !== null && noteDialog.open) noteDialog.close();
}

/** Save pressed, or its keyboard twin: the box's text to the opener's door. */
function onNoteSavePress() {
  const save = noteDialogSave;
  noteDialogSave = null;
  if (noteDialog !== null && noteDialog.open) noteDialog.close();
  if (save !== null && noteText !== null) save(noteText.value);
}

/**
 * The note landing on a mark of the document on screen: the record replaced
 * in place (a note is part of the mark the way its colour is), the toolbar
 * and the badges told, the row written - with the take-back and the notice
 * if the write does not land, the colour change's own manner. When the view
 * or the list moved while the dialog stood (a history step under the
 * modal), the edit still lands: it falls through to the anchor door, which
 * writes against whatever the row holds now.
 *
 * @param {NonNullable<typeof shown>} target
 * @param {import("../lib/reader/marks.js").Mark} mark
 * @param {string} text
 */
async function applyNoteInDoc(target, mark, text) {
  if (shown !== target || !docMarks.includes(mark)) {
    if (await writeNoteByAnchor(target.url, mark, text)) {
      showNotice(t("reader_list_write_failed"));
    }
    return;
  }

  const next = markRecord({ ...mark, note: text });
  if (next === null || (next.note ?? "") === (mark.note ?? "")) return;

  const before = docMarks;
  const wasActive = activeMark === mark;
  docMarks = docMarks.map((one) => (one === mark ? next : one));
  // The paint keeps its range - a note moves no endpoint - but must answer
  // for the new record: the badge about to be shown asks the paint by
  // identity, and so does the next tap on the mark.
  adoptPaintedMark(mark, next);
  if (wasActive) activeMark = next;
  refreshMarkBar();
  showNoteBadges();

  try {
    await putMarks(target.url, docMarks);
  } catch {
    if (shown !== target) return;
    docMarks = before;
    adoptPaintedMark(next, mark);
    if (activeMark === next) activeMark = mark;
    refreshMarkBar();
    showNoteBadges();
    showNotice(t("reader_list_write_failed"));
  }
}

/**
 * The note written under a document that is not (or no longer) on screen:
 * fetch the row, find the mark by its anchor - two marks cannot share one
 * (`placeMark`'s promise), so the anchor is the name that survives a
 * refetch - replace, write the list back. A mark that left the row
 * meanwhile is not a failure: the note has nothing to land on, and the
 * refreshed page will show what stands.
 *
 * @param {string} docId
 * @param {import("../lib/reader/marks.js").Mark} mark
 * @param {string} text
 * @returns {Promise<boolean>} whether the write failed and somebody should say so
 */
async function writeNoteByAnchor(docId, mark, text) {
  try {
    const list = await getMarks(docId);
    const found = list.find((one) => compareMarks(one, mark) === 0);
    if (found === undefined) return false;
    const next = markRecord({ ...found, note: text });
    if (next === null || (next.note ?? "") === (found.note ?? "")) return false;
    await putMarks(
      docId,
      list.map((one) => (one === found ? next : one)),
    );
    return false;
  } catch {
    return true;
  }
}

/**
 * A quote row's note act (D118): the dialog over the row's mark, the write
 * through the anchor door - the rows carry copies from a bulk read, never
 * the database's own list. The page refreshes either way: the note under
 * the quote must show what was written, and a mark that vanished meanwhile
 * should stop being offered.
 *
 * @param {import("./marks-list.js").MarkRow} row
 */
function noteMarkRow(row) {
  openNoteDialog(row.mark, (text) => {
    void (async () => {
      if (await writeNoteByAnchor(row.docId, row.mark, text)) {
        showNotice(t("reader_list_write_failed"));
      }
      if (marksShown !== null) await refreshMarks();
    })();
  });
}

/**
 * A swatch pressed, and the state says whom for (D107). With no mark active
 * the swatches ARE the pen: the press writes the same setting the Aa
 * panel's row writes, so the ink can be chosen right where the marking
 * happens - Michał's wish behind the always-standing bar. With a mark
 * active, this one mark changes its ink in place - the record is replaced
 * (its colour is part of it), painted, written, and the toolbar stays up so
 * a second thought costs one more press; the pen's own ink is not touched.
 *
 * @param {string} ink
 */
async function onMarkInkPress(ink) {
  const target = shown;
  const active = activeMark;
  if (!isMarkColor(ink)) return;

  if (active === null) {
    // The pen state: applied from what was actually stored, the panel's own
    // manner - `adoptConfig` repaints the swatches here and in Aa alike.
    adoptConfig(await writeConfig({ reader: { markerColor: ink } }));
    return;
  }
  if (target === null || active.color === ink) return;

  const next = markRecord({ ...active, color: ink });
  if (next === null) return;
  const before = docMarks;
  docMarks = docMarks.map((one) => (one === active ? next : one));
  activeMark = next;
  repaintMarks();
  refreshMarkBar();

  try {
    await putMarks(target.url, docMarks);
  } catch {
    if (shown !== target) return;
    docMarks = before;
    activeMark = active;
    repaintMarks();
    refreshMarkBar();
    showNotice(t("reader_list_write_failed"));
  }
}

markerButton?.addEventListener("click", () => setMarker(!markerOn));
markCopyButton?.addEventListener("click", () => void onMarkCopyPress());
markNoteButton?.addEventListener("click", () => onMarkNotePress());
markDeleteButton?.addEventListener("click", () => void onMarkDeletePress());

noteSaveButton?.addEventListener("click", () => onNoteSavePress());
noteCancelButton?.addEventListener("click", () => closeNoteDialog());
noteCloseButton?.addEventListener("click", () => closeNoteDialog());

// Esc closes a native dialog on its own; ours is only to drop the pending
// save with it, whichever way the dialog went down.
noteDialog?.addEventListener("close", () => {
  noteDialogSave = null;
});

// A click that reaches the dialog element itself hit the backdrop - the
// TOC dialog's own tell (the dialog carries no padding of its own).
noteDialog?.addEventListener("click", (event) => {
  if (event.target === noteDialog) closeNoteDialog();
});

// Ctrl/Cmd+Enter saves from inside the box; Enter alone stays what it is in
// a textarea - the note's own line break.
noteText?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    onNoteSavePress();
  }
});

// The box follows the words as they are typed - growth per line, never a
// scrollbar before the dialog's cap says so.
noteText?.addEventListener("input", () => sizeNoteBox());

markBar?.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const ink = target.closest("button[data-mark-ink]")?.getAttribute("data-mark-ink");
  if (typeof ink === "string") void onMarkInkPress(ink);
});

// A press away from the toolbar, while the pen is in the hand. Presses on
// the article are not decided here - the tap they end resolves through
// `onMarkTap`, which can tell a mark from a neighbour word from bare text;
// presses on the chrome only stand the active mark down here, leaving what
// they mean to the button pressed (the two panels put the pen away whole
// when they open, D123); a press anywhere else - the margins, the action
// rows - puts the pen down whole, the bare-text tap's one-step rule.
document.addEventListener("pointerdown", (event) => {
  if (!markerOn) return;
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (markBar?.contains(target) === true) return;
  // A badge press means its note, not "done marking" - the badge's own
  // click handler answers it.
  if (markNoteBadges?.contains(target) === true) return;
  if (article?.contains(target) === true) return;
  if (chromeBox?.contains(target) === true) {
    deselectMark();
    return;
  }
  setMarker(false);
});

// Escape keeps the outward ladder the taps gave up (Michał's call): the
// active mark stands down first, the pen second - stepping outward is what
// the key means everywhere else on this page too. With the note dialog up,
// the same press is the dialog's to answer (the keydown still bubbles here
// while the engine closes it): one Esc, one step.
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && markerOn && noteDialog?.open !== true) stepOut();
});

// A badge holds a box it measured once, and the boxes move twice over:
// the first render's layout is not the settled page's (the config lands
// async and re-wraps the article under its own text size, the action rows
// unhide once the database answers), and later the whole column travels.
// Naming every reflow source is a losing game, so the observer watches
// the effect: anything that re-wraps the text changes the body's box.
// What it cannot see is the one move that keeps the box: the body is a
// fixed-measure column centred by auto margins, so a window resize slides
// it whole without resizing it (Michał's report - the text walked out
// sideways from under a standing badge); the resize listener covers that
// travel. The paint needs nothing either way - the highlight registry
// follows its ranges by itself - and the badges are absolute, outside the
// body's own box, so replacing them cannot ring the observer back. A
// document without notes re-builds nothing on either signal.
new ResizeObserver(() => showNoteBadges()).observe(document.body);
window.addEventListener("resize", () => showNoteBadges());

/**
 * @param {boolean} [firstLoad] whether this is the load-time call - the one
 *   that may find a reloaded or session-restored tab, whose history still
 *   names the document that was on screen
 */
async function showPage(firstLoad = false) {
  const turn = ++epoch;

  // Opened with nothing to read - a restored tab after a restart, mostly.
  // That is not an error, it is the reading list's whole cue (D-c).
  const source = await readReaderSource();
  if (turn !== epoch) return;
  if (source === null) {
    const doc = asDocState(history.state);
    const quotes = asMarksState(history.state);
    if (doc === null && quotes === null) {
      await showLibrary();
    } else if (firstLoad) {
      // A reload or a restored session, standing on an entry this page
      // pushed (D102): coming back should mean that entry's view again - a
      // document with its position riding along, or the highlights page
      // (D108), fresh the way any visit begins. If the database no longer
      // holds the document, the opener quietly refreshed the list instead;
      // make that the view, or the page would stand blank.
      if (quotes !== null) {
        await showMarks(quotes.scope, { fresh: true });
      } else if (doc !== null) {
        if (doc.kind === "book") await openBook(doc.url);
        else await openSaved(doc.url);
        if (shown === null) await showLibrary();
      }
    } else {
      // Asked for the list (the popup's row, D93) while this page's own
      // entries are on top: leave through history - however many of ours
      // stand stacked (a document under the highlights under a document),
      // the walk in popstate steps through all of them, so the next Back
      // over the list keeps meaning "leave this page", not "reread that
      // article".
      unwindToList = true;
      history.back();
    }
    return;
  }

  // The Highlights row pressed on another of this extension's pages (the
  // popup, the saved phrases, the settings): the view the menu's own row
  // opens, every document's quotes, fresh the way any menu visit begins. A
  // real entry unless one is already on top, so Back keeps meaning "the view
  // this landed over" - and never stacks two copies of the same room.
  if ("marks" in source) {
    hideNotice();
    const standing = asMarksState(history.state);
    if (standing === null || standing.scope !== null) history.pushState(marksState(null), "");
    await showMarks(null, { fresh: true });
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
 * @param {MarkTarget | SearchTarget} [target] a spot to land on instead of
 *   the reading position: a mark for the highlights page's press (D108), a
 *   found phrase for a search row's (D119)
 */
async function openSaved(url, target) {
  const turn = ++epoch;
  // The position and the marks ride along in the same round trip; render is
  // synchronous, so nothing can move between the article appearing and the
  // scroll to it. Marks that cannot be read are an empty list, not a failed
  // opening - the article is the errand here.
  const [saved, position, marks] = await Promise.all([
    getArticle(url),
    getPosition(url),
    getMarks(url).catch(() => []),
  ]);
  if (turn !== epoch) return;
  if (saved === null) {
    // Gone under us - deleted from another reader tab. The list knows.
    await refreshLibrary();
    return;
  }
  renderSaved(saved);
  docMarks = marks;
  repaintMarks();
  // The action rows first, the scroll second: they stand above the article,
  // and a bar appearing after the scroll would shift the restored block by
  // its own height. Awaited before the epoch check - a row pressed during
  // the wait means this render is no longer the one on screen.
  const rendered = shown;
  await refreshActions();
  if (shown !== rendered) return;
  const landed =
    target === undefined
      ? false
      : "folded" in target
        ? scrollToSearchHit(target)
        : scrollToTargetMark(target);
  if (!landed) restorePosition(position);
  // Opening is reading's first act, and the position row's clock is what
  // orders the list - so the open itself must wind it, or a document read
  // without a single scroll would never rise. Written after the restore, the
  // save re-measures the place the restore just took: the same anchor, a
  // fresh `updatedAt`.
  savePositionNow();
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
  // With translation off (D120) - or no pair chosen at all - there is no
  // pair to mismatch: the note would warn about a translation nobody is
  // getting.
  const source = settings.translationOff ? null : settings.sourceLang;
  const mismatch =
    source !== null && declared.length > 0 && declared !== primaryLanguage(source);
  bookNote.hidden = !mismatch;
  if (mismatch && source !== null && book !== null) {
    bookNoteText.textContent = t("reader_book_pair_note", [
      languageName(declared),
      languageName(primaryLanguage(source)),
    ]);
  }
}

/**
 * The doors to the table of contents - the pagers' two icons and the menu's
 * row (D117) - shown only over a document that has one. The menu row is the
 * stuck bar's door: the pagers scroll away with the text, the bar does not.
 */
function updateTocButtons() {
  for (const button of tocButtons) {
    if (button !== null) button.hidden = docToc.length === 0;
  }
  if (navToc !== null) navToc.hidden = docToc.length === 0;
}

/**
 * The map of the document on screen (D117), read off the rendered blocks
 * the moment they stand - nothing stored and nothing asked of storage: for
 * an article the screen is the source. The blocks come from the dissolving
 * walk (see `tocBlocks` for why), and the entries' `blockIndex` names a
 * place in that walk - resolved back to an element, never to a child of
 * `contentRoot()`, whose numbering the wrapper makes a different thing.
 *
 * @returns {import("../lib/book/toc.js").TocEntry[]}
 */
function articleToc() {
  const root = contentRoot();
  tocBlocks = root === null ? [] : [...packableBlocks(root)];
  return cappedToc(
    renderedEntries(
      tocBlocks.map((block) => ({
        localName: block.localName,
        text: block.textContent ?? "",
      })),
      0,
    ),
  );
}

/**
 * Where the reading stands in the table of contents: the last row at or
 * before the part and block on screen, -1 before the first. What the dialog
 * marks and lands its focus on - opened mid-book it answers "where am I"
 * before "where next".
 *
 * @returns {number}
 */
function currentTocRow() {
  if (shown === null) return -1;
  if (shown.origin !== "book") {
    // An article's entries index the dissolved walk, where the top-block
    // arithmetic of a book's parts says nothing - but every heading is an
    // element on this very screen, so the headings themselves answer: the
    // last one that has reached the reading line is the section being read.
    const line = chromeFold() + 2;
    let current = -1;
    for (const [index, entry] of docToc.entries()) {
      const rect = tocBlocks[entry.blockIndex]?.getBoundingClientRect();
      if (rect !== undefined && rect.top <= line) current = index;
    }
    return current;
  }
  const part = shownSegment();
  const block = topBlockIndex() ?? 0;
  let current = -1;
  for (const [index, entry] of docToc.entries()) {
    if (entry.segmentIndex < part || (entry.segmentIndex === part && entry.blockIndex <= block)) {
      current = index;
    }
  }
  return current;
}

/**
 * Opens the table of contents over the document: rows built fresh from
 * `docToc`, the titles entering as text only - they are the text's own
 * words. Depth is measured from the shallowest heading the document uses,
 * so one written all in h2 reads flat rather than uniformly indented.
 */
function openTocDialog() {
  if (tocDialog === null || tocRows === null || docToc.length === 0) return;
  let shallowest = 3;
  for (const entry of docToc) shallowest = Math.min(shallowest, entry.level);
  const current = currentTocRow();
  tocRows.replaceChildren(
    ...docToc.map((entry, index) => {
      const row = document.createElement("button");
      row.type = "button";
      row.dataset["index"] = String(index);
      row.dataset["depth"] = String(entry.level - shallowest);
      row.textContent = entry.title;
      if (index === current) row.setAttribute("aria-current", "true");
      return row;
    }),
  );
  tocDialog.showModal();
  const focus = current >= 0 ? tocRows.children[current] : tocRows.firstElementChild;
  if (focus instanceof HTMLElement) {
    // By hand rather than letting focus scroll "nearest": the current
    // chapter mid-list, not clinging to the box's edge. The offsets share
    // the dialog as their positioned ancestor, so the difference is the
    // row's place inside the scrolling rows.
    focus.focus({ preventScroll: true });
    tocRows.scrollTop = Math.max(
      0,
      focus.offsetTop - tocRows.offsetTop - (tocRows.clientHeight - focus.offsetHeight) / 2,
    );
  }
}

/** Puts the dialog away, wherever the closing came from - a row, the X,
 *  Esc, the backdrop, or the view changing under it. */
function closeTocDialog() {
  if (tocDialog !== null && tocDialog.open) tocDialog.close();
}

/**
 * One row pressed: the chapter with its heading under the bar. The part
 * already on screen - which is every jump an article can ask for - is
 * landed by scroll alone: a re-render is a repaint, and on e-ink a repaint
 * is a flash. A book's other part takes the same road as a pressed quote
 * (D108), with the heading's block as the target.
 *
 * @param {import("../lib/book/toc.js").TocEntry} entry
 */
function jumpToTocEntry(entry) {
  const target = shown;
  if (target === null) return;
  if (target.origin !== "book") {
    // An article's entry names an element of the dissolved walk; the
    // landing is a reading position like any scroll's, written at once so
    // a tab closed right after the jump reopens on the section. (A live
    // page has no row to write, and the save itself knows that.)
    if (scrollToRect(tocBlocks[entry.blockIndex]?.getBoundingClientRect())) savePositionNow();
    return;
  }
  if (entry.segmentIndex === target.segmentIndex) {
    if (scrollToBlock(entry.blockIndex)) savePositionNow();
    return;
  }
  void openBook(target.url, entry.segmentIndex, {
    segmentIndex: entry.segmentIndex,
    block: entry.blockIndex,
  });
}

/**
 * Builds the table of contents a book imported before D116 never got, from
 * the headings that survived in its stored blocks - once, on an open of the
 * book, and written back so every later open just reads it. The reading is
 * not held up: every segment fetch is an await, and the part on screen
 * renders before this starts. `setBookToc` re-reads the row in its own
 * transaction, so a book deleted mid-scan stays deleted and a faster tab's
 * scan stands; failure leaves `toc` null, and the next open tries again.
 *
 * @param {import("../lib/store/book.js").BookMeta} book
 */
async function backfillToc(book) {
  if (tocScansRunning.has(book.id)) return;
  tocScansRunning.add(book.id);
  try {
    /** @type {import("../lib/book/toc.js").TocEntry[]} */
    const entries = [];
    for (let index = 0; index < book.segmentCount; index += 1) {
      const segment = await getBookSegment(book.id, index);
      // A torn segment reads as absent; the list keeps what is readable.
      if (segment !== null) entries.push(...headingEntries(segment.blocks, index));
    }
    const toc = cappedToc(entries);
    if (!(await setBookToc(book.id, toc))) return;
    if (shown !== null && shown.origin === "book" && shown.url === book.id) {
      docToc = toc;
      updateTocButtons();
    }
  } catch {
    // A closed database or a torn book: no TOC today, another try at the
    // next open.
  } finally {
    tocScansRunning.delete(book.id);
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
 * @param {MarkTarget | BlockTarget | SearchTarget} [target] a spot to land
 *   on instead of the reading position: a mark for the highlights page's
 *   press (D108), a block for a table-of-contents row (D116), a found
 *   phrase for a search row's (D119) - each asking for its own segment
 *   through `wanted` as well
 */
async function openBook(id, wanted, target) {
  const turn = ++epoch;
  const [book, position, marks] = await Promise.all([
    getBook(id),
    getPosition(id),
    getMarks(id).catch(() => []),
  ]);
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
  docToc = book.toc ?? [];
  updateTocButtons();
  // A row from before the TOC existed is owed its scan (D116) - behind the
  // reading, never in its way.
  if (book.toc === null) void backfillToc(book);
  // The whole book's marks, painted for the part on screen; a turned part
  // reloads them fresh, which is also what keeps two reader tabs honest.
  docMarks = marks;
  repaintMarks();
  // Same order as `openSaved`, for the same reason: everything that takes
  // room above the text lays out before the scroll that has to land on it.
  const rendered = shown;
  await refreshActions();
  if (shown !== rendered) return;
  const landed =
    target === undefined
      ? false
      : "folded" in target
        ? scrollToSearchHit(target)
        : "start" in target
          ? scrollToTargetMark(target)
          : scrollToBlock(target.block);
  if (!landed) restorePosition(position, index);
  // Same reason as `openSaved`: the open winds the position row's clock. For
  // a book this also writes which part is on screen, so a part reached with
  // Next and left without a scroll is still the part the book reopens at.
  savePositionNow();
}

/**
 * How the highlights page names a mark across the reopen (D108): the fields
 * that place it, not the object - the list on screen is a different read of
 * the database than the one the open just made. The start alone identifies
 * it: two marks sharing a start cannot survive `placeMark`.
 *
 * @typedef {{ segmentIndex: number, start: { block: number, offset: number } }} MarkTarget
 */

/**
 * How a table-of-contents row names its chapter across the part turn (D116):
 * the block its heading stands in. The shape a mark's target takes when
 * there is no mark - just a place to land.
 *
 * @typedef {{ segmentIndex: number, block: number }} BlockTarget
 */

/**
 * How a search row names its hit across the reopen (D119): the block in the
 * reading position's numbering, the span in that block's prose, and the
 * folded query - the proof the landing holds the text to.
 *
 * @typedef {{ segmentIndex: number, block: number, from: number, to: number,
 *   folded: string }} SearchTarget
 */

/**
 * The search wash's registry name (D119), styled in `reader.css`. One range,
 * worn until the first deliberate act.
 */
const SEARCH_WASH = "reread-search";

/**
 * Disarms the standing wash's one-shot listeners, or nothing to disarm.
 *
 * @type {(() => void) | null}
 */
let disarmSearchWash = null;

/**
 * Washes the found phrase and arms its leaving: the first tap or key takes
 * it away - never a timer, because a fade is a repaint for its own sake, and
 * on e-ink a flash. The render clears it too, like every paint on this page.
 *
 * @param {Range} range
 */
function washSearchHit(range) {
  clearSearchWash();
  if (!highlightsSupported()) return;
  CSS.highlights.set(SEARCH_WASH, new Highlight(range));
  const clear = () => clearSearchWash();
  window.addEventListener("pointerdown", clear, { once: true, capture: true });
  window.addEventListener("keydown", clear, { once: true, capture: true });
  disarmSearchWash = () => {
    window.removeEventListener("pointerdown", clear, true);
    window.removeEventListener("keydown", clear, true);
  };
}

/** The wash off the registry and its listeners disarmed - idempotent. */
function clearSearchWash() {
  if (disarmSearchWash !== null) {
    disarmSearchWash();
    disarmSearchWash = null;
  }
  if (highlightsSupported()) CSS.highlights.delete(SEARCH_WASH);
}

/**
 * Scrolls the just-rendered document to one search hit and washes it - the
 * mark guard's bargain held the other way around: the hit is re-proven by
 * finding its own phrase in the prose on screen, and when the text moved
 * since the scan, the nearest occurrence stands in. A phrase no longer in
 * its block lands on the block alone, unwashed; false only when even the
 * block is gone, and the caller falls back to the reading position.
 *
 * @param {SearchTarget} target
 * @returns {boolean}
 */
function scrollToSearchHit(target) {
  const root = contentRoot();
  const text = root === null ? null : proseTextOf(root, target.block);
  if (root === null || text === null) return false;
  /** @type {{ start: number, end: number } | null} */
  let best = null;
  for (const span of hitsInText(text, target.folded)) {
    if (best === null || Math.abs(span.start - target.from) < Math.abs(best.start - target.from)) {
      best = span;
    }
  }
  if (best === null) return scrollToBlock(target.block);
  const range = rangeWithin(root, target.block, best.start, best.end);
  if (range === null) return scrollToBlock(target.block);
  washSearchHit(range);
  return scrollToRect(range.getClientRects()[0] ?? range.getBoundingClientRect());
}

/**
 * Scrolls the just-rendered document to one of its marks. The painted range
 * knows exactly where the quote sits; a mark the guard refused to paint (or
 * an engine without the registry) still has its start block to land on. False
 * when the mark is not in the document's list at all - deleted since its row
 * was drawn - and the caller falls back to the reading position.
 *
 * @param {MarkTarget} target
 * @returns {boolean}
 */
function scrollToTargetMark(target) {
  const mark = docMarks.find(
    (one) =>
      one.segmentIndex === target.segmentIndex && comparePoints(one.start, target.start) === 0,
  );
  if (mark === undefined) return false;
  const range = paintedRangeOf(mark);
  const rect =
    range?.getClientRects()[0] ??
    contentRoot()?.children[mark.start.block]?.getBoundingClientRect();
  if (rect === undefined) return false;
  // The quote's first line under the stuck bar, the position restore's own
  // landing - plus a breath of air, so the wash reads as found, not clipped.
  scrollTo(0, Math.max(0, rect.top + window.scrollY - chromeFold() - 8));
  return true;
}

/**
 * The landing every table-of-contents jump shares (D116): the named spot's
 * first line under the stuck bar, plus the found mark's own breath of air.
 * False when there is nothing there to land on, and the caller decides what
 * that falls back to.
 *
 * @param {DOMRect | undefined} rect
 * @returns {boolean}
 */
function scrollToRect(rect) {
  if (rect === undefined) return false;
  scrollTo(0, Math.max(0, rect.top + window.scrollY - chromeFold() - 8));
  return true;
}

/**
 * Scrolls the just-rendered part to one of its top-level blocks - the
 * heading a book's table-of-contents row named (D116). False when the block
 * is not there to land on - a torn row's entry - and the caller falls back
 * to the reading position.
 *
 * @param {number} block
 * @returns {boolean}
 */
function scrollToBlock(block) {
  return scrollToRect(contentRoot()?.children[block]?.getBoundingClientRect());
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

/**
 * The teardown the list and the highlights page share: whatever document
 * stood here leaves the screen whole - its pending position save taken, its
 * voice stopped, its pen put away, its dressing removed.
 */
function leaveDocView() {
  epoch += 1;
  // Before `shown` moves: the pending save is about the article on screen.
  flushPosition();
  shown = null;
  // The article being read aloud is leaving the screen, and a voice reading a
  // page nobody can see is the extension talking to itself. A quote a row's
  // speaker was reading goes with it when the highlights page is the one
  // being left.
  forgetReading();
  stopMarkSpeech();
  updateListen();
  // The pen goes away with the article: the list has nothing to mark, and
  // whatever paint stood was about blocks no longer on screen.
  setMarker(false);
  docMarks = [];
  clearMarkPaint();
  showNoteBadges();
  if (article !== null) article.hidden = true;
  if (actions !== null) actions.hidden = true;
  if (actionsEnd !== null) actionsEnd.hidden = true;
  // The bar's way back stands outside the action rows, so hiding them does
  // not take it along; the highlights page shows it again on its own terms.
  if (toLibraryButton !== null) toLibraryButton.hidden = true;
  if (originalLink !== null) originalLink.hidden = true;
  showSegmentNav(null);
  showBookNote(null);
  docToc = [];
  tocBlocks = [];
  updateTocButtons();
  closeTocDialog();
  // The search leaves with its document (D119): the wash was over blocks
  // now gone, and the held hits were that text's.
  clearSearchWash();
  closeDocSearch();
  resetDocSearch();
}

async function showLibrary() {
  leaveDocView();
  document.body.dataset["view"] = "list";
  marksShown = null;
  if (marksSection !== null) marksSection.hidden = true;
  // The menu must not list the room it stands in: on the list view its list
  // row hides, leaving the pages that really are elsewhere. The search row
  // is the open document's and hides with it - the list has its filter.
  if (navLibrary !== null) navLibrary.hidden = true;
  if (navMarks !== null) navMarks.hidden = false;
  if (navSearch !== null) navSearch.hidden = true;
  if (library !== null) library.hidden = false;
  document.title = t("reader_title");
  scrollTo(0, 0);
  await refreshLibrary();
}

/**
 * The highlights page as the view (D108): the same room-turning the list
 * does, with the quotes standing where the rows of titles stand. A visit
 * through a menu row is `fresh` - the filter and the page start over - while
 * a history step back onto the page keeps both, so browsing quote by quote
 * does not retype its search.
 *
 * @param {string | null} scope one document's quotes, or everybody's
 * @param {{ fresh?: boolean }} [visit]
 */
async function showMarks(scope, { fresh = false } = {}) {
  leaveDocView();
  document.body.dataset["view"] = "marks";
  marksShown = { scope };
  if (fresh) {
    marksQuery = "";
    marksPage = 1;
    if (marksFilter !== null) marksFilter.value = "";
  }
  if (library !== null) library.hidden = true;
  // The list really is elsewhere from here, so the menu offers it; the
  // highlights row hides, being the room itself, and the search row hides
  // with the document it was about - this page has a filter of its own.
  if (navLibrary !== null) navLibrary.hidden = false;
  if (navMarks !== null) navMarks.hidden = true;
  if (navSearch !== null) navSearch.hidden = true;
  if (marksSection !== null) marksSection.hidden = false;
  // The way back in the bar: one step through history, to whatever the page
  // was opened over - the list, or the document whose menu led here. The
  // label starts as the list and the refresh renames it once the scoped
  // document's title is read.
  if (toLibraryButton !== null) toLibraryButton.hidden = false;
  setBackDoor(t("reader_back_to_list"), t("reading_list"));
  document.title = `${t("reader_marks_title")} - re/read`;
  // The quotes are reading text (D109): the learning side moves its ground
  // to the rows, so the underlines, the recall tap and the selection bubble
  // work on a kept passage exactly as they do in the article it came from.
  rootReadingSide(marksRowsList);
  scrollTo(0, 0);
  await refreshMarks();
}

async function refreshLibrary() {
  if (libraryEmpty === null || libraryRows === null) return;
  // One list, two stores: books enter dressed as rows (`bookEntry`), with
  // their positions read in bulk - fifty rows must not mean fifty lookups.
  // The marks ride in the same round trip only to answer one button's grey;
  // unreadable marks must not cost the list, so they read as none.
  const [metas, books, positions, marks] = await Promise.all([
    listArticles(),
    listBooks(),
    allPositions(),
    allMarks().catch(() => new Map()),
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
  // list of books alone still has nothing to export. The highlights button
  // reads its own store: a mark anywhere, articles and books alike, is
  // something to export.
  if (exportButton !== null) exportButton.disabled = metas.length === 0;
  if (exportMarksButton !== null) exportMarksButton.disabled = marks.size === 0;

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
  applyLibrarySearchVisibility();
}

/**
 * Which furniture the list area shows (D119): the plain list, or the deep
 * search's results standing in its place. Runs after every list refresh -
 * the refresh decides the plain elements' own hidden flags, and this hides
 * them again wholesale while results stand; segments and rows are unhidden
 * on the way back because no refresh ever touches those two.
 */
function applyLibrarySearchVisibility() {
  const on = librarySearchShown();
  if (on) {
    const plain = [librarySegments, libraryCount, libraryEmpty, libraryRows, libraryPager];
    for (const element of plain) {
      if (element !== null) element.hidden = true;
    }
  } else {
    if (librarySegments !== null) librarySegments.hidden = false;
    if (libraryRows !== null) libraryRows.hidden = false;
  }
  if (librarySearchSection !== null) librarySearchSection.hidden = !on;
}

/**
 * The deep search's two states of the button under the filter (D119): there
 * only while the checkbox asks for it, pressable only over a phrase worth
 * scanning for - the same two-characters rule the document dialog keeps.
 */
function updateSearchControls() {
  if (librarySearchGo === null || librarySearchToggle === null) return;
  librarySearchGo.hidden = !librarySearchToggle.checked;
  librarySearchGo.disabled = !isSearchableQuery(libraryFilter?.value ?? "");
}

/** One press on Search, however it came - the button or Enter in the box. */
async function runLibrarySearch() {
  const query = libraryFilter?.value ?? "";
  if (!isSearchableQuery(query)) return;
  await startLibrarySearch(query);
  applyLibrarySearchVisibility();
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
 * The highlights page filled from the stores (D108) - the same three reads
 * the export makes: the marks, and the two lists that dress them in titles.
 * No document's content is ever opened for this; the quotes already live in
 * the marks' own rows. The rules of what shows are `marks-list.js`'s.
 */
async function refreshMarks() {
  if (marksRowsList === null || marksEmpty === null) return;
  const [metas, books, marks] = await Promise.all([
    listArticles(),
    listBooks(),
    allMarks().catch(() => new Map()),
  ]);
  const target = marksShown;
  // The view moved on while the database answered; the section is hidden,
  // and filling it would only shout into a closed room.
  if (target === null) return;
  const rows = markRows(metas, books, marks);
  const view = marksListView(rows, { scope: target.scope, query: marksQuery, page: marksPage });
  marksPage = view.page;
  marksOnScreen = view.rows;

  // The scoped page says whose quotes these are, and the back arrow names
  // the same document - the one step it takes leads there. A scope whose
  // document is gone keeps the arrow on the list, which is where the step
  // will land anyway once the entry beneath stops answering.
  const scopeTitle =
    target.scope === null
      ? null
      : (metas.find((meta) => meta.url === target.scope)?.title ??
        books.find((book) => book.id === target.scope)?.title ??
        null);
  if (marksDocLine !== null) {
    marksDocLine.hidden = scopeTitle === null;
    marksDocLine.textContent = scopeTitle ?? "";
  }
  if (scopeTitle !== null) setBackDoor(t("reader_back_to_doc", scopeTitle), scopeTitle);

  // Exporting nothing would download an empty file; the button says so
  // first - the transfer section's own rule, over this page's scope.
  if (marksExportButton !== null) marksExportButton.disabled = view.total === 0;

  // "3 of 12" while the filter narrows the page down, like the list's line.
  if (marksCount !== null) {
    const filtering = marksQuery.trim().length > 0;
    marksCount.hidden = !filtering;
    if (filtering) {
      marksCount.textContent = t("reader_filter_count", [
        view.matching.toLocaleString(),
        view.total.toLocaleString(),
      ]);
    }
  }

  if (view.rows.length === 0) {
    // Two kinds of nothing, two answers - the reading list's split: a filter
    // that ruled everything out quotes itself and offers the undo; a page
    // with nothing highlighted says so, in the scope's own words.
    marksEmpty.replaceChildren();
    if (view.total > 0) {
      const sentence = document.createElement("p");
      sentence.textContent = t("reader_marks_no_match", marksQuery);
      const clear = document.createElement("button");
      clear.type = "button";
      clear.textContent = t("reader_filter_clear");
      clear.addEventListener("click", () => {
        marksQuery = "";
        marksPage = 1;
        if (marksFilter !== null) {
          marksFilter.value = "";
          marksFilter.focus();
        }
        void refreshMarks();
      });
      marksEmpty.append(sentence, clear);
    } else if (target.scope === null) {
      // Nothing highlighted anywhere - and whoever is reading this may have
      // arrived through a menu on another page, never having held the pen.
      // The sentence says where highlights are made; the button under it is
      // the door to that place, by the menu's own walk (`leaveToList`).
      const sentence = document.createElement("p");
      sentence.textContent = t("reader_marks_empty");
      const toList = document.createElement("button");
      toList.type = "button";
      toList.textContent = t("reading_list");
      toList.addEventListener("click", () => leaveToList());
      marksEmpty.append(sentence, toList);
    } else {
      marksEmpty.textContent = t("reader_marks_empty_doc");
    }
    marksEmpty.hidden = false;
  } else {
    marksEmpty.hidden = true;
  }

  // The rows about to be replaced may hold an open bubble's phrase and the
  // selection under it - both stand down first (D109), the way a rendered
  // article drops the previous one's; then the underlines are found again
  // in the fresh rows.
  dismiss();
  marksRowsList.replaceChildren(
    ...view.rows.map((row, index) => markRowElement(row, index, target.scope === null)),
  );
  rescan();

  if (marksPager !== null) {
    marksPager.hidden = view.pages <= 1;
    if (marksPageLabel !== null) {
      marksPageLabel.textContent = t("pager_page_of", [
        view.page.toLocaleString(),
        view.pages.toLocaleString(),
      ]);
    }
    if (marksPrev !== null) marksPrev.disabled = view.page <= 1;
    if (marksNext !== null) marksNext.disabled = view.page >= view.pages;
  }
}

/**
 * One of a quote row's act buttons: a drawn glyph cloned from its template,
 * the act's name as the accessible words, and the row's index for the one
 * dispatch below.
 *
 * @param {string} act
 * @param {number} index
 * @param {string} name
 * @param {HTMLTemplateElement | null} icon
 * @returns {HTMLButtonElement}
 */
function markActButton(act, index, name, icon) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `marks-act marks-${act}`;
  button.setAttribute("data-act", act);
  button.setAttribute("data-row", String(index));
  button.title = name;
  button.setAttribute("aria-label", name);
  if (icon !== null) button.append(icon.content.cloneNode(true));
  return button;
}

/**
 * One quote as a row (D108): the quote as text - plain prose in the reading
 * face, not a control (Michał's revision: the whole quote as a button both
 * hid where the press would lead and stood in the way of the quotes ever
 * being reading text) - the document named under it, and the acts one step
 * aside in the reading list's own grid: the arrow that opens the document
 * at the mark, the speaker that reads the quote aloud, and the copy. The
 * quote and the title came off somebody's page once, so both enter as
 * text; the mark's colour enters as an attribute the stylesheet matches by
 * value, a registry name from the checked list and never free text.
 *
 * @param {import("./marks-list.js").MarkRow} row
 * @param {number} index into `marksOnScreen`, which the press handlers read back
 * @param {boolean} withTitle the global page names each document; the scoped one already has
 */
function markRowElement(row, index, withTitle) {
  const item = document.createElement("li");
  item.className = "library-row marks-row";
  item.setAttribute("data-color", row.mark.color);

  const text = document.createElement("div");
  text.className = "library-text";

  const quote = document.createElement("div");
  quote.className = "marks-quote";
  // The quote's newlines are the block breaks `quoteOf` wrote at every
  // boundary; each part becomes a paragraph of its own, so a spanning
  // quote reads as paragraphs - and the scan keeps its everywhere-else
  // rule here too: a phrase never matches across a block break.
  for (const piece of row.mark.text.split("\n")) {
    const paragraph = document.createElement("p");
    paragraph.textContent = piece;
    quote.append(paragraph);
  }

  const detail = document.createElement("span");
  detail.className = "library-item-detail";
  const when = row.mark.createdAt > 0 ? new Date(row.mark.createdAt).toLocaleDateString() : "";
  const part =
    row.part === null
      ? ""
      : t("reader_book_part_of", [row.part.at.toLocaleString(), row.part.of.toLocaleString()]);
  detail.textContent = [withTitle ? row.title : "", part, when]
    .filter((piece) => piece.length > 0)
    .join(" - ");
  text.append(quote);
  // The reader's own words under the document's (D118): under, because the
  // quote is what the note is about. textContent with `pre-wrap` in the
  // stylesheet - the note's line breaks are its only structure.
  if (row.mark.note !== undefined) {
    const note = document.createElement("p");
    note.className = "marks-note";
    note.textContent = row.mark.note;
    text.append(note);
  }
  text.append(detail);

  const acts = document.createElement("span");
  acts.className = "marks-row-acts";
  acts.append(markActButton("open", index, t("reader_marks_open", row.title), marksOpenIcon));
  // No speaker on an engine that cannot speak - the voice rows' own rule.
  if (canSpeak()) {
    acts.append(markActButton("speak", index, t("reader_listen"), marksSpeakIcon));
  }
  acts.append(markActButton("copy", index, t("marker_copy"), marksCopyIcons));
  acts.append(
    markActButton(
      "note",
      index,
      row.mark.note === undefined ? t("marker_note_add") : t("marker_note_edit"),
      marksNoteIcon,
    ),
  );

  item.append(text, acts);
  return item;
}

/**
 * A quote pressed: its document opens at the mark itself, with the step
 * written into history exactly as a list row writes it (D102) - Back lands
 * on this page again, filter and all. A document that left the database
 * between the render and the press takes the fresh entry back out, and the
 * re-entered page reads the loss.
 *
 * @param {import("./marks-list.js").MarkRow} row
 */
async function openMarkRow(row) {
  hideNotice();
  history.pushState(docState(row.kind, row.docId), "");
  const target = { segmentIndex: row.mark.segmentIndex, start: row.mark.start };
  if (row.kind === "book") await openBook(row.docId, row.mark.segmentIndex, target);
  else await openSaved(row.docId, target);
  if (shown === null) {
    history.back();
    return;
  }
  // The way back in the bar leads to the quotes now, and its words follow.
  setBackDoor(t("reader_marks_back"), t("reader_marks_title"));
}

/**
 * A row's copy: the quote onto the clipboard, the button a check for a
 * breath - the mark toolbar's own feedback, repeated per row. A refresh may
 * replace the rows before the breath is over; the detached button takes the
 * reset without anybody watching, which costs nothing.
 *
 * @param {HTMLButtonElement} button
 * @param {import("./marks-list.js").MarkRow} row
 */
async function copyMarkRow(button, row) {
  try {
    await navigator.clipboard.writeText(row.mark.text);
  } catch {
    // The clipboard refusing has no state to show: the button simply does
    // not claim a copy it did not make.
    return;
  }
  button.setAttribute("data-copied", "");
  button.title = t("marker_copied");
  button.setAttribute("aria-label", t("marker_copied"));
  setTimeout(() => {
    button.removeAttribute("data-copied");
    button.title = t("marker_copy");
    button.setAttribute("aria-label", t("marker_copy"));
  }, 1500);
}

/**
 * The mark's own name across renders, for the speaker's toggle: the same
 * fields the open press carries, joined - a page turn or a refresh replaces
 * the row objects, and the quote still sounding must answer to its button.
 *
 * @param {import("./marks-list.js").MarkRow} row
 * @returns {string}
 */
function markRowKey(row) {
  const { mark } = row;
  return `${row.docId}\n${mark.segmentIndex}:${mark.start.block}:${mark.start.offset}`;
}

/**
 * A row's speaker: the quote out loud, the saved-phrases page's own manner -
 * pressing the sounding row again stops it, any other row simply speaks.
 * The language is the document's where it declared one (a book's meta);
 * an article's meta holds none, and the pair's source language stands in -
 * the assumption the whole extension already makes about what is being read.
 *
 * @param {import("./marks-list.js").MarkRow} row
 */
function speakMarkRow(row) {
  const key = markRowKey(row);
  if (speaking() && soundingMark === key) {
    stopTts();
    soundingMark = null;
    return;
  }
  soundingMark = key;
  // The row's own language first; with none and no pair, the empty tag reads
  // in the engine's default voice - `speechLang`'s manner.
  const lang = row.lang ?? settings.sourceLang ?? "";
  speak(row.mark.text, lang, settings.ttsVoices[primaryLanguage(lang)], settings.ttsRate / 100);
}

/**
 * The row speech stood down - leaving the highlights page takes the voice
 * with it, exactly as leaving an article takes the read-aloud: a quote
 * nobody can see is the extension talking to itself.
 */
function stopMarkSpeech() {
  if (soundingMark === null) return;
  soundingMark = null;
  stopTts();
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
    const [articles, marks] = await Promise.all([allArticles(), allMarks()]);
    if (articles.length === 0) return;
    downloadFile(toArticlesFile(articles, marks), ARTICLES_FILENAME, "application/json");
    transferStatus("");
  } catch {
    transferStatus(describeError(ErrorCode.INTERNAL), "error");
  }
}

/**
 * The highlights' documents dressed in what the lists know about them -
 * title, address or author, the day each entered - the .md file's input,
 * cut to one document when the page asking is scoped (D108). The quotes are
 * already in the marks' own rows, so no document's content is ever opened
 * for this.
 *
 * @param {string | null} scope
 * @returns {Promise<import("../lib/store/marks-file.js").MarkedDoc[]>}
 */
async function markedDocs(scope) {
  const [metas, books, marks] = await Promise.all([listArticles(), listBooks(), allMarks()]);

  /** @type {import("../lib/store/marks-file.js").MarkedDoc[]} */
  const docs = [];
  for (const meta of metas) {
    const kept = marks.get(meta.url);
    if (kept !== undefined && (scope === null || meta.url === scope)) {
      docs.push({ title: meta.title, source: meta.url, at: meta.savedAt, marks: kept });
    }
  }
  for (const book of books) {
    const kept = marks.get(book.id);
    if (kept !== undefined && (scope === null || book.id === scope)) {
      docs.push({ title: book.title, source: book.author, at: book.addedAt, marks: kept });
    }
  }
  return docs;
}

/**
 * The highlights as one Markdown page (D106): every marked document,
 * articles and books alike. The transfer section's button, so failure
 * speaks in the transfer's own status line.
 */
async function exportMarks() {
  try {
    const docs = await markedDocs(null);
    if (docs.length === 0) return;
    downloadFile(toMarksFile(docs), MARKS_FILENAME, "text/markdown");
    transferStatus("");
  } catch {
    transferStatus(describeError(ErrorCode.INTERNAL), "error");
  }
}

/**
 * The highlights page's own export (D108): the same file, cut to the page's
 * scope. Failure speaks in the page notice - the transfer section's status
 * line lives in the list view, hidden here.
 */
async function exportMarksPage() {
  try {
    const docs = await markedDocs(marksShown === null ? null : marksShown.scope);
    if (docs.length === 0) return;
    downloadFile(toMarksFile(docs), MARKS_FILENAME, "text/markdown");
  } catch {
    showNotice(describeError(ErrorCode.INTERNAL));
  }
}

/**
 * Downloading is a blob and an anchor; no permission asks for less. The URL
 * has to outlive the click long enough for the download to take it - a
 * minute is comfortably that, and then the blob can go.
 *
 * @param {string} content
 * @param {string} filename
 * @param {string} type
 */
function downloadFile(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
 * right now, along with the chrome's way back to the list (D102), which
 * stands in every article view. Whether this address is saved decides
 * everything on them: the save toggle's state on a live article, and whether
 * there is a read mark to offer at all. One function dresses all of it, so
 * the rows cannot disagree.
 */
async function refreshActions() {
  if (actions === null) return;
  const target = shown;
  if (target === null) {
    actions.hidden = true;
    if (actionsEnd !== null) actionsEnd.hidden = true;
    if (toLibraryButton !== null) toLibraryButton.hidden = true;
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

  try {
    const existing = await getArticleMeta(target.url);
    if (shown !== target) return;

    if (existing !== null) {
      await deleteArticle(target.url);
      // The marks were part of the copy that just left (they went with the
      // row); paint saying otherwise would be showing what is not there.
      if (shown === target) {
        docMarks = [];
        repaintMarks();
      }
    } else if (!(await saveShownLive(target))) return;
  } catch {
    showNotice(t("reader_list_write_failed"));
    return;
  }
  if (shown === target) void refreshActions();
}

/**
 * The saving half of the toggle above, shared with the highlighter's first
 * mark on a live page (D106): one door into the database, whoever knocks.
 * False when there was nothing whole to save - the caller decides whether
 * that is a quiet end (the button) or a failure (a mark with no row).
 *
 * @param {NonNullable<typeof shown>} target
 * @returns {Promise<boolean>} whether the row is written
 */
async function saveShownLive(target) {
  if (article === null || contentElement === null || titleElement === null) return false;
  const root = contentElement.firstElementChild;
  const record = savedArticle({
    url: target.url,
    title: titleElement.textContent ?? "",
    content: root === null ? "" : root.innerHTML,
    dir: article.getAttribute("dir"),
    lang: article.getAttribute("lang"),
    savedAt: Date.now(),
  });
  if (record === null) return false;
  await putArticle(record);
  return true;
}

/**
 * A live article's action rows, drawn once the database has had its say about
 * this address (D124). With "Save in the offline reading list by default" on
 * - and it is on unless somebody turned it off - a page opened here is saved
 * as it opens, so the rows wait for that write: a bar offering Save for a
 * moment and then saying the page is in the list would be a flicker on e-ink
 * and wrong for as long as it lasted.
 *
 * The keep is only ever on the way in and only when the address is not in the
 * list yet (`keptRow`): a stored copy carries the highlights and the reading
 * position, and reopening a page must never be the thing that erases them.
 *
 * The setting is read fresh rather than taken from this page's copy: the
 * first render can outrun the settings load at the foot of this file, and a
 * default that saves would then save against a switch somebody turned off.
 *
 * @param {NonNullable<typeof shown>} target
 */
async function openLiveActions(target) {
  try {
    const { keepArticles } = await readConfig();
    if (keepArticles && shown === target) await keptRow(target);
  } catch {
    // The same word the Save button uses for a write that did not land. The
    // rows drawn below will say Save, which is then the truth.
    showNotice(t("reader_list_write_failed"));
  }
  if (shown === target) await refreshActions();
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
  onBackPress();
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
 * rest. The shared part - paper, typeface, text size - goes through
 * `lib/appearance.js`, where the names live (D104: the phrases page wears the
 * same three); the column's measure and the links mode are this page's own.
 *
 * Setting properties through the CSSOM rather than writing a `<style>` element,
 * which the content security policy of an extension page does not allow - the
 * same reason the bubble builds its stylesheet the way it does.
 *
 * @param {import("../lib/config.js").ReaderConfig} reader
 */
function applyAppearance(reader) {
  const root = document.documentElement;
  applyReading(root, reader);
  root.dataset["readerLinks"] = reader.links;
  root.style.setProperty("--reader-measure", `${reader.measure}ch`);
  // The measure again with the text size cancelled out of it: `ch` scales
  // with the font, which is right for the article's column (a measure counts
  // characters) and wrong for the list views, whose width is layout - the
  // whole page breathed when the size stepped (Michał's report). The same
  // count re-expressed against the default size stands still however the
  // text grows; reader.css caps the list and highlights views on this twin.
  const pinned = (reader.measure * DEFAULTS.reader.fontSize) / reader.fontSize;
  root.style.setProperty("--reader-measure-pinned", `${pinned.toFixed(2)}ch`);
  // The wet stroke's ink (D106): an alias onto the chosen colour's own
  // per-theme variable, so the draft follows both the pick and the theme.
  root.style.setProperty("--reader-marker-current", `var(--reader-marker-${reader.markerColor})`);

  if (sizeValue !== null) sizeValue.textContent = String(reader.fontSize);
  if (measureValue !== null) measureValue.textContent = String(reader.measure);
  applyLinkStops(reader.links);

  for (const button of document.querySelectorAll(
    "[data-theme], [data-font], [data-links], [data-marker-color]",
  )) {
    const wanted =
      button.getAttribute("data-theme") ??
      button.getAttribute("data-font") ??
      button.getAttribute("data-links") ??
      button.getAttribute("data-marker-color");
    const current = button.hasAttribute("data-theme")
      ? reader.theme
      : button.hasAttribute("data-font")
        ? reader.font
        : button.hasAttribute("data-links")
          ? reader.links
          : reader.markerColor;
    button.setAttribute("aria-pressed", String(wanted === current));
  }

  // The mark toolbar's swatches speak for the pen while no mark is active
  // (D107), so a new ink - picked in Aa, on the bar itself, or in another
  // tab - has to reach them through the same road every setting takes.
  refreshMarkBar();
  // A size or measure change reflows the article under the note badges;
  // reading fresh boxes here sees the layout the new variables made.
  showNoteBadges();
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
 * With no pair chosen and no declaration the answer is `""` - a language
 * nobody has named. Every caller already has a manner for it: an utterance
 * with an empty `lang` speaks in the engine's default, and the quiet
 * lookup's own guard skips a dictionary it cannot name a language for.
 *
 * @returns {string}
 */
function speechLang() {
  const declared = article?.getAttribute("lang") ?? "";
  return primaryLanguage(declared).length > 0 ? declared : (settings.sourceLang ?? "");
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
  applyUnderline(config);
  applySpeech();
  // With translation off (D120) the saved phrases page loses its door here,
  // the way it does in the popup and the settings menu - the page itself
  // stays untouched, and unlocks with the switch.
  if (navVocabulary !== null) navVocabulary.hidden = config.translationOff;
}

/**
 * The underline row (D130): which weight is pressed, and whether the row is
 * on the panel at all. Outside `applyAppearance`, which dresses this page
 * from `config.reader` - the underline is worn by every page being read, so
 * it lives a level up in the settings, and the pages wearing it repaint
 * themselves off the same storage change this handler answers.
 *
 * Gone with translation switched off (D120), where nothing is underlined: a
 * dial over an invisible line is a promise the panel cannot keep.
 *
 * @param {import("../lib/config.js").Config} config
 */
function applyUnderline(config) {
  if (underlineSetting !== null) underlineSetting.hidden = config.translationOff;
  for (const button of document.querySelectorAll("[data-underline]")) {
    const wanted = button.getAttribute("data-underline");
    button.setAttribute("aria-pressed", String(wanted === config.underline));
  }
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
  // One tool in the hand at a time (Michał's word, 2026-08-17, repealing
  // D107's stacked pair): the voice starting puts the pen away, and the pen
  // picked up stops the voice (`setMarker`) - on a phone two strips stacked
  // over the window's foot cost more article than either tool was worth.
  if (state !== "off") setMarker(false);
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
 * A press in the panel belongs to the button it landed in, not to the element
 * that caught it (D132). Two of these rows draw the thing they are about
 * *inside* their buttons - the highlighter's ink, the underline's own line -
 * and aiming at that thing, which is the whole reason it is drawn, used to
 * land on it and be dropped (Michał's report, 2026-08-22: the first press on
 * an underline swatch did nothing, and only a second one, landing a pixel
 * off the line, took). The mark bar's inks have always been read this way.
 *
 * @param {Event} event
 */
async function onDisplayPress(event) {
  const target = event.target;
  const button = target instanceof Element ? target.closest("button") : null;
  if (!(button instanceof HTMLButtonElement)) return;

  const rate = button.getAttribute("data-rate");
  if (rate !== null) {
    await stepRate(Number(rate));
    return;
  }

  // A setting of the whole extension rather than of this page (D130), so it
  // is written a level up from `reader` - like the voice and its speed, the
  // panel's other two knobs that outlive the page they are set on. Every open
  // page repaints its underlines off the same write.
  const underline = button.getAttribute("data-underline");
  if (isUnderlineWeight(underline)) {
    adoptConfig(await writeConfig({ underline }));
    return;
  }

  const theme = button.getAttribute("data-theme");
  const font = button.getAttribute("data-font");
  const links = button.getAttribute("data-links");
  const markerColor = button.getAttribute("data-marker-color");
  const size = button.getAttribute("data-size");
  const measure = button.getAttribute("data-measure");

  /** @type {Partial<import("../lib/config.js").ReaderConfig>} */
  let patch = {};
  if (isTheme(theme)) patch = { theme };
  else if (isFont(font)) patch = { font };
  else if (isLinks(links)) patch = { links };
  else if (isMarkColor(markerColor)) patch = { markerColor };
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

/**
 * A panel opening is one more tool taken in hand (D123, Michał's report:
 * pressing Aa with the pen out left both lit and both strips standing), so
 * it puts the pen away with its toolbar - the rule D113 gave the pen and the
 * voice, reaching the two disclosures. The voice is deliberately left alone:
 * the Aa panel is where its voice and its speed are steered from, and a
 * reading stopped by opening its own controls would be the panel undoing
 * itself. The panels sit at the head and the speech bar at the foot, so
 * unlike the pen's strip they never crowd each other.
 */
displayButton?.addEventListener("click", () => {
  const opening = displayPanel?.hidden === true;
  if (opening) setMarker(false);
  setPanel(menuButton, menuPanel, false);
  setPanel(displayButton, displayPanel, opening);
});

menuButton?.addEventListener("click", () => {
  const opening = menuPanel?.hidden === true;
  if (opening) setMarker(false);
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
  // An edited box asks a new question: standing deep results are dismissed
  // (D119) and the plain filter answers live again; the refresh below puts
  // the list back on screen.
  if (librarySearchShown()) dismissLibrarySearch();
  updateSearchControls();
  libraryQuery = libraryFilter.value;
  // Typing means "show me what matches", and that starts at the beginning -
  // the clamp would only catch a page that no longer exists.
  libraryPage = 1;
  void refreshLibrary();
});

// Enter in the box runs the deep search while the checkbox asks for it -
// the same press the button makes, for hands that never leave the keys
// (and for the search key a phone keyboard shows).
libraryFilter?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || librarySearchToggle?.checked !== true) return;
  event.preventDefault();
  void runLibrarySearch();
});

librarySearchToggle?.addEventListener("change", () => {
  updateSearchControls();
  // Unticking the box takes the results with it: they were its question.
  if (librarySearchToggle?.checked !== true && librarySearchShown()) {
    dismissLibrarySearch();
    void refreshLibrary();
  }
});

librarySearchGo?.addEventListener("click", () => void runLibrarySearch());

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

// The highlights page's own furniture (D108), each piece the list's pattern
// repeated: typing filters from the first page, a turned page snaps to the
// rows' top (e-ink), and a press on a row goes through the one lookup - the
// buttons carry an index into what is rendered, never data of their own.
marksFilter?.addEventListener("input", () => {
  if (marksFilter === null) return;
  marksQuery = marksFilter.value;
  marksPage = 1;
  void refreshMarks();
});

/**
 * @param {number} step
 */
async function turnMarksPage(step) {
  marksPage += step;
  await refreshMarks();
  marksRowsList?.scrollIntoView({ behavior: "instant", block: "start" });
}

marksPrev?.addEventListener("click", () => void turnMarksPage(-1));

marksNext?.addEventListener("click", () => void turnMarksPage(1));

marksRowsList?.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest("button[data-row]");
  if (!(button instanceof HTMLButtonElement)) return;
  const row = marksOnScreen[Number(button.getAttribute("data-row"))];
  if (row === undefined) return;
  const act = button.getAttribute("data-act");
  if (act === "copy") void copyMarkRow(button, row);
  else if (act === "speak") speakMarkRow(row);
  else if (act === "open") void openMarkRow(row);
  else if (act === "note") noteMarkRow(row);
});

marksExportButton?.addEventListener("click", () => void exportMarksPage());

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
  // The press writes the step it takes (D102): one entry over the list, for
  // the way back to retrace. Only here - a book turning its own segments and
  // the popstate reopenings walk on entries that already exist.
  history.pushState(docState(kind === "book" ? "book" : "article", url), "");
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

exportMarksButton?.addEventListener("click", () => void exportMarks());

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

for (const button of tocButtons) button?.addEventListener("click", () => openTocDialog());
tocCloseButton?.addEventListener("click", () => closeTocDialog());
// To a click the backdrop is the dialog element itself - everything inside
// is covered by the header and the rows, which carry the padding.
tocDialog?.addEventListener("click", (event) => {
  if (event.target === tocDialog) closeTocDialog();
});
tocRows?.addEventListener("click", (event) => {
  const row = event.target instanceof Element ? event.target.closest("button") : null;
  if (!(row instanceof HTMLButtonElement) || row.dataset["index"] === undefined) return;
  const entry = docToc[Number(row.dataset["index"])];
  if (entry === undefined) return;
  closeTocDialog();
  jumpToTocEntry(entry);
});

bookNoteSettings?.addEventListener("click", () => void goToSettings());

// The leavings of an import a closed tab cut short, taken out at the door:
// this page is the only one with a key to the database, so its opening is
// the only "start" there is (O18). Quiet on failure - orphans are invisible,
// and the next opening will try again.
void sweepOrphanSegments().catch(() => undefined);

/**
 * What the way back in the bar claims to lead to: the arrow's accessible
 * name (a whole sentence) and the word on the door under the article's last
 * line. The one step back varies its destination now that the highlights
 * page stands between rooms (D108); the labels follow the door that was
 * actually taken, and every plain render resets them to the list.
 *
 * @param {string} sentence
 * @param {string} room
 */
function setBackDoor(sentence, room) {
  if (toLibraryButton !== null) {
    toLibraryButton.title = sentence;
    toLibraryButton.setAttribute("aria-label", sentence);
  }
  const word = toLibraryEndButton?.querySelector("span");
  if (word !== undefined && word !== null) word.textContent = room;
}

/**
 * The bar's way back (D102, widened by D108): standing on an entry this page
 * pushed - a document's or the highlights' - leaving is a real step back,
 * the same step the browser's Back button, Alt+Left, a mouse's back button
 * and Android's back gesture take, so every one of them lands on the same
 * view (the popstate below does the showing). With no entry beneath - the
 * reader was pointed straight at a live page - the view just turns, and
 * history is left alone.
 */
function onBackPress() {
  hideNotice();
  if (asDocState(history.state) !== null || asMarksState(history.state) !== null) history.back();
  else void showLibrary();
}

/**
 * The menu's list row: to the list however deep this page's own entries
 * stand - a document under the highlights under a document leaves the row
 * meaning the same one room. The walk is real history steps (the flag makes
 * popstate keep stepping over entries of ours), so the Back that follows
 * still means "leave this page".
 */
function leaveToList() {
  hideNotice();
  if (asDocState(history.state) !== null || asMarksState(history.state) !== null) {
    unwindToList = true;
    history.back();
  } else void showLibrary();
}

// One way back, two doors: the arrow in the bar and the line under the
// article's last word.
for (const button of [toLibraryButton, toLibraryEndButton]) {
  button?.addEventListener("click", () => onBackPress());
}

/**
 * The browser walking its history over this page (D102): Back from an
 * article, Forward onto one again - by button, keyboard, mouse or the
 * system's own gesture, which is the whole point of writing entries at all.
 * A custom swipe was deliberately not built instead: a horizontal drag on
 * the text is the phrase-selection gesture (D80/D86), and the screen's edges
 * belong to the system.
 */
window.addEventListener("popstate", (event) => {
  const doc = asDocState(event.state);
  const quotes = asMarksState(event.state);
  // Mid-walk to the list (the menu's list row over stacked entries, D108):
  // keep stepping while the entries are this page's own, and show the list
  // on the first one that is not.
  if (unwindToList) {
    if (doc !== null || quotes !== null) {
      history.back();
      return;
    }
    unwindToList = false;
    hideNotice();
    void showLibrary();
    return;
  }
  // Back or Forward onto a highlights visit (D108): the page as it stood -
  // `showMarks` without `fresh` keeps the filter and the page, so browsing
  // quote by quote does not retype its search.
  if (quotes !== null) {
    hideNotice();
    void showMarks(quotes.scope);
    return;
  }
  if (doc === null) {
    // Back under every entry this page pushed. The list is what lies there -
    // but only if an article or the highlights page is actually on screen: a
    // fragment jump on the list view (the transfer anchor) walks through
    // here too, and rebuilding the list over it would tear the jump away
    // mid-scroll.
    if (shown !== null || marksShown !== null) {
      hideNotice();
      void showLibrary();
    }
    return;
  }
  // Forward to a document - or a stale entry naming the one already on
  // screen, which asks for nothing.
  if (shown !== null && shown.url === doc.url) return;
  hideNotice();
  if (doc.kind === "book") void openBook(doc.url);
  else void openSaved(doc.url);
});

/**
 * The road to the settings, walked in this same tab (D139). It used to be
 * `openOptionsPage` - a tab of its own, so the article stayed on screen - and
 * on a phone that tab had no way back at all: no gesture, no arrow, and the
 * article to be dug out again through the menus (Michał's report,
 * 2026-08-24). A real navigation instead makes the settings a step in this
 * tab's walk, so every way back the platform offers - the system's back
 * gesture, the browser's Back, the settings page's own arrow (see
 * `options.js`) - pops the same entry and lands here, where the article and
 * the place in it come back from this page's own history entry (D102).
 *
 * The stored reader-tab id is handed back first: while this tab shows the
 * settings it is not a reader, and the popup's rows must open a real one
 * rather than raise a settings page mid-visit. Quiet on failure - the id
 * going stale was always survivable (`single-tab.js` treats it as gone).
 */
async function goToSettings() {
  await writeReaderTab(null).catch(() => undefined);
  location.assign(webext().runtime.getURL("options/options.html"));
}

// The other half of handing the id back (D139): this tab is the reader tab
// for as long as the reader is what it shows, said on every arrival - the
// first load and every return through history from the settings walk, the
// back/forward cache included, which is why `pageshow` and not a plain run.
// Before D139 only the background wrote the id, at the moment it created
// the tab; a reader come back to by Back was a stranger to its own popup.
window.addEventListener("pageshow", () => {
  void webext()
    .tabs.getCurrent()
    .then((tab) => (typeof tab?.id === "number" ? writeReaderTab(tab.id) : undefined))
    .catch(() => undefined);
});

// The mark in the bar is the door to the settings - the one line standing over
// every view of this page. The same walk as the menu row's (D139).
brandButton?.addEventListener("click", () => void goToSettings());

// The menu's rows, each putting the menu away when pressed: a hallway is for
// passing through, and every one of them leaves this tab standing - coming
// back must not find the hallway still open. The list row turns this page's
// own view, the same act as the arrows around the article. The phrases row
// goes through the background exactly as the popup's does (`vocab-tab.js`):
// the saved phrases are one tab, and a message is what raises it rather than
// opening a copy - while the article here stays where it was scrolled to.
// The settings row is the mark's press with a word on it.
// The contents row (D117): the same dialog the book pagers open, reached
// from the bar that is always on screen - the pagers scroll away with the
// text, the bar does not.
navToc?.addEventListener("click", () => {
  setPanel(menuButton, menuPanel, false);
  openTocDialog();
});

// The search row (D119): the dialog over whatever document is on screen.
navSearch?.addEventListener("click", () => {
  setPanel(menuButton, menuPanel, false);
  openDocSearch();
});

navLibrary?.addEventListener("click", () => {
  setPanel(menuButton, menuPanel, false);
  leaveToList();
});

// The highlights row (D108): over a document it opens that document's own
// quotes, over the list everybody's - one view either way, told apart by the
// scope in the entry it pushes (a real step, like a row press writes, so
// Back retraces it). A menu visit is a fresh one: filter and page start over.
navMarks?.addEventListener("click", () => {
  setPanel(menuButton, menuPanel, false);
  hideNotice();
  const scope = shown === null ? null : shown.url;
  history.pushState(marksState(scope), "");
  void showMarks(scope, { fresh: true });
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
  void goToSettings();
});

keepButton?.addEventListener("click", () => void onKeepPress());
removeButton?.addEventListener("click", () => void onRemovePress());
markReadButton?.addEventListener("click", () => void onMarkReadPress());
markReadEndButton?.addEventListener("click", () => void onMarkReadPress());

// Search in the open document (D119). The module keeps the dialog, the scan
// and the held results; this page owns the landing, which is the quotes' and
// the contents' own road: the part on screen by scroll alone, another part
// through `openBook` with the hit riding as the target.
configureDocSearch({
  doc: () => shown,
  root: contentRoot,
  toc: () => docToc,
  onJump: (hit, folded) => {
    if (shown === null) return;
    /** @type {SearchTarget} */
    const target = {
      segmentIndex: hit.segmentIndex,
      block: hit.block,
      from: hit.from,
      to: hit.to,
      folded,
    };
    if (shown.origin === "book" && hit.segmentIndex !== shown.segmentIndex) {
      void openBook(shown.url, hit.segmentIndex, target);
      return;
    }
    // The landing is a reading position like any scroll's, written at once
    // so a tab closed right after the jump reopens on the found place. (A
    // live page has no row to write, and the save itself knows that.)
    if (scrollToSearchHit(target)) savePositionNow();
  },
});

// Search through the reading list (D119). The module keeps the snapshot,
// the cursor and the rows; this page owns the two ways out of a result -
// both the very road a list row's press takes, history entry included, so
// Back from a found place is the same step back as from any opened row.
configureLibrarySearch({
  onOpen: (kind, url, target) => {
    hideNotice();
    history.pushState(docState(kind, url), "");
    if (kind === "book") void openBook(url, target?.segmentIndex, target);
    else void openSaved(url, target);
  },
  onOpenSearch: (kind, url, query) => {
    hideNotice();
    history.pushState(docState(kind, url), "");
    const opened = kind === "book" ? openBook(url) : openSaved(url);
    // The document's own dialog opens over the landing, the phrase already
    // in it - the list's "and m more" is a door into the full search.
    void opened.then(() => openDocSearch(query));
  },
});

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
// utterance left in it goes on talking over a closed tab. The rows' quote
// speech rides the same queue and leaves the same way.
window.addEventListener("pagehide", () => {
  stopReading();
  stopMarkSpeech();
});

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

// The same reading side as on any other page, on whichever ground the view
// stands: the article in the document views, the quote rows on the
// highlights page (D109) - the quotes are the reader's own kept passages,
// and rereading them with the underlines and the bubble is exactly what
// this extension is for. The reader's own heading, the lists' furniture and
// the links in the menu are not text anybody is learning from, and nothing
// under either ground changes unless the code above changes it, so there is
// nothing for an observer to watch. Every pointer selects through our own
// gesture here (D80/D81, the mouse since D86) - this is our page, so
// refusing the native selection is allowed, and it is the one way to select
// whole words with no system menu in the way and the bubble landing exactly
// on the finger or the button lifting. For the same reason the bubble pins
// to the page rather than the viewport (`anchored`): it rides the scroll
// with its phrase like a margin note, which only a layout we control can
// promise to survive. `plainLinks` tells the gesture when links are dressed
// as plain text (D95): then a hold or a press on one selects its word like
// any other - without this, a word in a link could be neither followed nor
// selected. A quote holds no links, so over the rows the flag simply never
// answers.

/** The element the learning side stands on right now - null until a view roots it. */
/** @type {Element | null} */
let readingGround = null;

/**
 * Points the learning side at one element's text (D109). Re-rooting is a
 * full stop-and-start, because the gesture takes its ground once at start;
 * the same ground asks for nothing - `rescan` already serves new text under
 * old ground, and the vocabulary held by the running side is not re-read
 * for no reason. One config for every ground: the highlighter's hooks
 * consult the pen (D106), and only the document views ever put it in the
 * hand - over the quote rows `marking()` is always false, so the marker
 * grammar never wakes there.
 *
 * @param {Element | null} ground
 */
function rootReadingSide(ground) {
  if (ground === null || ground === readingGround) return;
  readingGround = ground;
  stopReadingSide();
  start({
    root: ground,
    observe: false,
    ownSelection: true,
    anchored: true,
    // How far down the window our own chrome is stuck over the text (D138):
    // the bubble's placement and its scroll assist stop where the bar
    // begins, and the assist's kept line parks under the bar, not beneath
    // it. The same measure the reading position, the voice and the page
    // keys already live by (D93, D127); over the highlights page the chrome
    // scrolls away like any heading, and the measure honestly says so.
    covered: chromeFold,
    // The bubble's own door to the settings - an error's one button - walks
    // the same road as the bar's mark (D139): this tab, so the way back
    // exists. Everywhere else the bubble keeps asking the background.
    openSettings: () => void goToSettings(),
    plainLinks: () => settings.reader.links === "plain",
    // The highlighter's hooks (D106): whether the pen is in the hand, where
    // marks may anchor (the rebuilt content - the reader's own title has no
    // block order to write against), what a finished stroke becomes, and what
    // a tap means while the pen is up. The delete bubble is ours the way the
    // translation bubble is - presses on it must not read as the page's.
    alsoOwns: (target) => target instanceof Node && markBar?.contains(target) === true,
    marking: () => markerOn,
    markRoot: () => contentRoot(),
    onMarked: (range) => void onMarked(range),
    // A stroke taking its first word: whatever mark was active is about to be
    // stale - its pins would stand over yesterday's outline while the new one
    // is drawn (Michał's report).
    onMarkStart: () => deselectMark(),
    onMarkTap,
    // The no-translation trim's two hands (D121): the dictionaries and the
    // voice of the document on screen, both by the rule the voice panel
    // already lives by (`speechLang`) - the document's own declaration first,
    // the pair's source as the stand-in. Only over a document: the quote rows
    // of the highlights page show many documents at once, and a lookup in a
    // guessed language would find real entries for words nobody asked about.
    quietLookup: (text) =>
      shown === null ? Promise.resolve([]) : lookUp(text, primaryLanguage(speechLang())),
    quietVoice: () =>
      shown === null
        ? null
        : { lang: speechLang(), voiceURI: settings.ttsVoices[primaryLanguage(speechLang())] },
  });
}

// The load-time ask is the one that may be a reload standing on a document's
// history entry - the only caller allowed to reopen from it (D102).
void showPage(true);
