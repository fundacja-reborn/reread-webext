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

import {
  refresh as refreshHighlights,
  supported as highlightsSupported,
  unregister as unregisterHighlight,
} from "../content/highlighter.js";
import { bubbleOpen, dismiss, reportRead, rescan, restretch, start, stop as stopReadingSide } from "../content/reading.js";
import { applyReading } from "../lib/appearance.js";
import { ReadLedger } from "../lib/counting.js";
import { dresser } from "../lib/user-css.js";
import { webext } from "../lib/browser.js";
import { fileSize, localizePage, megabytes, plural, t, uiLocale } from "../lib/i18n.js";
import { whenIdle } from "../lib/idle.js";
import { privateNote } from "../lib/private-note.js";
import { languageName, pairLabel } from "../lib/language.js";
import {
  CONFIG_KEY,
  DEFAULTS,
  MEASURE,
  SIZE,
  TTS_RATE,
  chosenPair,
  isAlign,
  isFont,
  isHyphens,
  isLineHeight,
  isLayout,
  isLinks,
  isParagraphs,
  isTheme,
  readConfig,
  writeConfig,
} from "../lib/config.js";
import { armFullscreenTool } from "../lib/fullscreen-tool.js";
import { lookUpAnswer } from "../lib/dict/lookup.js";
import { describeError } from "../lib/messages.js";
import { ErrorCode, Message, asPage, asPageRequest, asResult, ok } from "../lib/protocol.js";
import { NO_BASE, buildArticle } from "../lib/reader/article.js";
import { MAX_DOWNLOAD_BYTES, pictureSources, picturesState, picturesSummary } from "../lib/reader/pictures.js";
import { sourceOf, webAddress } from "../lib/reader/source.js";
import {
  ARTICLES_ENTRY,
  archiveAccount,
  archivePictures,
  articlesEntry,
  bookPictureEntryName,
  fromArchiveText,
  pictureEntries,
} from "../lib/store/articles-archive.js";
import { fileOrder } from "../lib/store/articles-file.js";
import { asDocState, asMarksState, asRoomState, docState, marksState, roomState } from "../lib/reader/history-state.js";
import { asRoomRequest } from "../lib/room-frame.js";
import { importKind } from "../lib/reader/import-kind.js";
import { speechAction } from "../lib/reader/keys.js";
import { readingTime, wordsIn } from "../lib/reader/length.js";
import { wordless } from "../lib/matcher/words.js";
import {
  compareMarks,
  comparePoints,
  fitsProse,
  handleAt,
  isMarkColor,
  markRecord,
  mergePlan,
  mergedNote,
  placeMark,
  reanchorMarks,
  reshapePlan,
  withoutMark,
} from "../lib/reader/marks.js";
import {
  EDGE_TURN_FIRST_MS,
  EDGE_TURN_REPEAT_MS,
  curtainTop,
  edgeTurn,
  edgeZone,
  onPage,
  pageAt,
  pagePercent,
  pageTops,
  revealTarget,
  tapZone,
  turnTarget,
  wheelTurn,
} from "../lib/reader/pages.js";
import { foldSnap, pageStep, pageTurn } from "../lib/reader/paging.js";
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
import { BACK_ROAD_KEY, READER_SOURCE_KEY, readReaderSource, writeReaderTab } from "../lib/session.js";
import {
  fromArticlesFile,
  importPlan,
} from "../lib/store/articles-file.js";
import {
  allArticles,
  allPositions,
  deleteArticle,
  deletePictures,
  getArticle,
  getArticleMeta,
  getPictures,
  getPosition,
  importArticles,
  listArticles,
  putArticle,
  putPicture,
  putPosition,
  setPictures,
  setReadAt,
  setWords,
} from "../lib/store/articles.js";
import { exportDocument } from "./export-doc.js";
import { importMarkdown } from "./import-markdown.js";
import { savePictures } from "./pictures.js";
import { entryReader, listEntries, packArchive } from "./zip.js";

/** @typedef {import("../lib/store/saved-article.js").SavedMeta} SavedMeta */
/** @typedef {import("../lib/store/book.js").BookMeta} BookMeta */
/** @typedef {import("../lib/store/articles-archive.js").PictureRef} PictureRef */
import { packableBlocks } from "../lib/book/blocks.js";
import { cappedToc, headingEntries, renderedEntries } from "../lib/book/toc.js";
import {
  allBookPictures,
  allBookSegments,
  deleteBook,
  deleteBookPictures,
  getBook,
  getBookPictures,
  getBookSegment,
  listBooks,
  putBook,
  putBookPicture,
  putBookSegment,
  setBookReadAt,
  setBookToc,
  setBookWords,
  sweepOrphanSegments,
} from "../lib/store/books.js";
import {
  BOOKS_ENTRY,
  MAX_BOOK_TEXT_BYTES,
  bookPictureRows,
  bookTextEntryName,
  booksAccount,
  booksImportPlan,
  fromBookText,
  fromBooksIndex,
  toBookText,
  toBooksIndex,
} from "../lib/store/books-file.js";
import {
  BACKUP_ENTRIES,
  BACKUP_FILENAME,
  SELECTION_FILENAME,
  backupEntries,
  fromManifest,
  isNewerBackup,
} from "../lib/store/backup-file.js";
import { booksOf, fromMarksCopy, isMarksCopy, marksImportPlan, missingByKind } from "../lib/store/marks-copy.js";
import { MARKS_FILENAME, toMarksFile } from "../lib/store/marks-file.js";
import { fromSettingsFile } from "../lib/store/settings-file.js";
import { allPhrases } from "../lib/store/vocab.js";
import { fromVocabularyFile } from "../lib/store/vocabulary-file.js";
import { completeLibraryCopy, restoreLibrary } from "../lib/store/library-copy.js";
import { allMarks, getMarks, putMarks, putMarksRows, restoreMarks } from "../lib/store/marks.js";
import { keptTitles, readMarksBackup } from "../lib/store/marks-backup.js";
import { Segment, emptySentence, savedArticle } from "../lib/store/saved-article.js";
import { watchToolbarScheme } from "../lib/theme-icon.js";
import {
  canSpeak,
  primaryLanguage,
  setSpeechOff,
  speak,
  speaking,
  speechSupported,
  stop as stopTts,
  voicesFor,
} from "../lib/tts.js";
import {
  closeDocSearch,
  configureDocSearch,
  openDocSearch,
  resetDocSearch,
  storedBlockText,
} from "./doc-search.js";
import { importEpub } from "./import-book.js";
import {
  configureLibrarySearch,
  dismissLibrarySearch,
  librarySearchShown,
  startLibrarySearch,
} from "./library-search.js";
import {
  articleEntry,
  bookEntry,
  keptPicks,
  libraryView,
  pickedState,
  searchButtonState,
  uncounted,
  withAllPicked,
} from "./list-view.js";
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
  startReading,
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
// Then the private-browsing sentence, when this page runs in one: what an
// empty list would otherwise say wrongly, said first and in the catalogue's
// words (`private-note.js`).
privateNote();
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
const noticeText = document.getElementById("notice-text");
const noticeAct = /** @type {HTMLButtonElement | null} */ (document.getElementById("notice-act"));
const noticeClose = document.getElementById("notice-close");
const article = document.getElementById("article");
const titleElement = document.getElementById("title");
const bylineElement = document.getElementById("byline");
const factsElement = document.getElementById("facts");
const contentElement = document.getElementById("content");
const originalLink = document.getElementById("original");
// The site under the title (D232): the line, the link in it and the name the
// link shows - the menu row's door, where a reader who never opens the menu
// meets it.
const sourceLine = document.getElementById("source");
const sourceLink = document.getElementById("source-link");
const sourceSite = document.getElementById("source-site");
const brandButton = document.getElementById("brand");
const displayButton = document.getElementById("display");
const displayPanel = document.getElementById("display-panel");
const menuButton = document.getElementById("menu");
const menuPanel = document.getElementById("menu-panel");
const panelScrim = document.getElementById("panel-scrim");
const navToc = document.getElementById("nav-toc");
const navSearch = document.getElementById("nav-search");
const navLibrary = document.getElementById("nav-library");
const navMarks = document.getElementById("nav-marks");
const navVocabulary = document.getElementById("nav-vocabulary");
const navSettings = document.getElementById("nav-settings");
const navPictures = document.getElementById("nav-pictures");
const navFullscreen = document.getElementById("nav-fullscreen");
const fullscreenTool = document.getElementById("fullscreen");
/**
 * Asks the bar's full-screen tool (`lib/fullscreen-tool.js`) whether the row
 * still has room for it - the one change it cannot see for itself is the
 * bar unfolding from behind its ribbon, which lays the row out again. A
 * no-op until the tool is armed, below with the other wiring.
 */
let refreshFullscreenTool = () => {};
// The row's two lines live inside the button (Michał's smoke, 2026-08-29: a
// hint standing under the row behind its own separator read as a second,
// dead row): the label, and the line that says where the press reaches or
// how it went.
const navPicturesLabel = document.getElementById("nav-pictures-label");
const navPicturesHint = document.getElementById("nav-pictures-hint");
// The line under the header (D231): the row's offer where a reader who never
// opens the menu meets it - the sentence, and the one press beside it.
const picturesOffer = document.getElementById("pictures-offer");
const picturesOfferText = document.getElementById("pictures-offer-text");
const picturesOfferButton = document.getElementById("pictures-offer-button");
// The export rows (D229): the document on screen as a book file or as a
// text page, each with the line under it that says what the file is and,
// after a press, what was written.
const navExportEpub = /** @type {HTMLButtonElement | null} */ (
  document.getElementById("nav-export-epub")
);
const navExportEpubHint = document.getElementById("nav-export-epub-hint");
const navExportMarkdown = /** @type {HTMLButtonElement | null} */ (
  document.getElementById("nav-export-markdown")
);
const navExportMarkdownHint = document.getElementById("nav-export-markdown-hint");
// The box the bar and its panels stand in - measured, not styled, from here:
// while an article is on screen it is stuck over the text, and the voice needs
// to know how much of the window's top it covers.
const chromeBox = document.querySelector(".reader-chrome");
const chromeTab = document.getElementById("chrome-tab");
const sizeValue = document.getElementById("size-value");
const measureValue = document.getElementById("measure-value");
const fontOwn = /** @type {HTMLButtonElement | null} */ (document.getElementById("font-own"));
const listenButton = /** @type {HTMLButtonElement | null} */ (document.getElementById("listen"));
const voiceSetting = document.getElementById("voice-setting");
const voiceChoice = /** @type {HTMLSelectElement | null} */ (
  document.getElementById("voice-choice")
);
const underlineSetting = document.getElementById("underline-setting");
const rateSetting = document.getElementById("rate-setting");
const rateValue = document.getElementById("rate-value");
const speechBar = document.getElementById("speech-bar");
// The paged layout's pieces of chrome (D233, D238): the paper over the cut
// line at the foot of a page and over its head, the foot's strip with the
// page count, the count's second home in the bar, and the count as a
// screen reader hears it.
const pageCurtain = document.getElementById("page-curtain");
const pageHead = document.getElementById("page-head");
const pageFooter = document.getElementById("page-footer");
const pageCount = document.getElementById("page-count");
const pageLive = document.getElementById("page-live");
// The line of ink on the page's edge while a stretched range waits there
// for the page to turn (D239).
const pageEdge = document.getElementById("page-edge");
const speechPlayButton = document.getElementById("speech-play");
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
// The selection's furniture (D152): the Select button on the list's line
// over the rows, and the bar that stands in that line's place inside the
// mode - the Select all box, the count, and the cross that closes it.
const libraryPickToggle = /** @type {HTMLButtonElement | null} */ (
  document.getElementById("library-pick")
);
const libraryPickLine = document.getElementById("library-pick-line");
const libraryPickAll = /** @type {HTMLInputElement | null} */ (
  document.getElementById("library-pick-all")
);
const libraryPickCount = document.getElementById("library-pick-count");
const libraryPickClose = document.getElementById("library-pick-close");
const exportButton = /** @type {HTMLButtonElement | null} */ (
  document.getElementById("library-export")
);
// The selection's two file buttons (D229): every ticked document as a
// file of its own.
const exportEpubButton = /** @type {HTMLButtonElement | null} */ (
  document.getElementById("library-export-epub")
);
const exportMarkdownButton = /** @type {HTMLButtonElement | null} */ (
  document.getElementById("library-export-markdown")
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
// The backup of everything's offer (D213): one line per part the file
// holds, and the box that decides about the settings.
const importParts = document.getElementById("library-import-parts");
const importSettingsRow = document.getElementById("library-import-settings-row");
const importSettings = /** @type {HTMLInputElement | null} */ (
  document.getElementById("library-import-settings")
);
const transferLine = document.getElementById("library-transfer-status");
const exportPicturesRow = document.getElementById("library-export-pictures-row");
const exportPictures = /** @type {HTMLInputElement | null} */ (
  document.getElementById("library-export-pictures")
);
const exportPicturesLabel = document.getElementById("library-export-pictures-label");
const exportBooksRow = document.getElementById("library-export-books-row");
const exportBooks = /** @type {HTMLInputElement | null} */ (
  document.getElementById("library-export-books")
);
const exportBooksLabel = document.getElementById("library-export-books-label");
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
// The way down to the export over the rows (D152/D153), the line under the
// export button that says what it wrote, and the heading that says whose
// quotes the page holds.
const marksTransferLink = document.getElementById("marks-transfer-link");
const marksTitle = document.getElementById("marks-title");
// The notes export's own line (each report under its own press, D153).
const marksNotesLine = document.getElementById("marks-notes-status");
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
const marksOriginalIcon = /** @type {HTMLTemplateElement | null} */ (
  document.getElementById("marks-original-icon")
);
const marksDeleteIcon = /** @type {HTMLTemplateElement | null} */ (
  document.getElementById("marks-delete-icon")
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
/** The Next under the text alone: the one that says a part was read to its end (D209). */
const segmentNextEndButton = document.getElementById("segment-next-end");
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
// The finishing acts again under the article's last line - a long article
// ends far from the bar above, and finishing is done where the finishing
// happens: the read mark, and since D185 Delete beside it.
const actionsEnd = document.getElementById("actions-end");
const toLibraryEndButton = document.getElementById("to-library-end");
const markReadEndButton = document.getElementById("mark-read-end");
const removeEndButton = document.getElementById("remove-end");
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
// The two turns in that toolbar (D242), offered in the paged layout alone.
const markTurnPrev = document.getElementById("mark-turn-prev");
const markTurnNext = document.getElementById("mark-turn-next");

// The room of this extension standing over the reading (D243): the settings
// or the saved phrases, in a frame this page builds and takes away.
const roomBox = document.getElementById("room");

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
 * The save of pictures under way, if one is (D145): which article's, the
 * handle that stops it, and the row's label as of the last picture - kept
 * here because the row is redrawn whenever the actions are, and a redraw
 * during a save must show where the save stands.
 *
 * @type {{ url: string, controller: AbortController, label: string } | null}
 */
let picturesTask = null;

/**
 * What the last press of the pictures row came to - "11 of 12 pictures
 * saved", "Pictures removed" - shown under the row for the article it was
 * about, until another one is on screen.
 *
 * @type {{ url: string, text: string } | null}
 */
let picturesNote = null;

/**
 * Whether a document is being written as a file of its own (D229) - by an
 * export row of the menu or by the selection's buttons. One at a time: a
 * document's whole text and pictures stand in memory while its file is
 * written, and the rows and buttons grey until it is.
 */
let documentExport = false;

/**
 * What the last press of an export row came to - "Exported to X (1.2 MB)",
 * "The document could not be exported" - shown under the row for the
 * document and the format it was about, until another document is on
 * screen; the pictures row's own pattern.
 *
 * @type {{ url: string, format: import("./export-doc.js").ExportFormat, text: string } | null}
 */
let exportNote = null;

/**
 * The `blob:` addresses the pictures on screen are shown through, revoked
 * when the article leaves the screen (`renderArticle`).
 *
 * @type {string[]}
 */
let shownPictures = [];

/**
 * The two facts the header line says about the text on screen (D226): how
 * many words it holds - counted off the same markup a save would write, so
 * the header and the list row can never disagree - and how many of the
 * reader's saved phrases the paint found in it: null until something is
 * painted, and wherever there is nothing to paint (`onPainted`).
 */
let shownWords = 0;
/** @type {number | null} */
let foundPhrases = null;

/**
 * The addresses whose reader said no on this way in: deleted from the
 * article, or from the list. The default keep (D124) is only ever on the way
 * in - and this tab's way in is the live page, which a reload of the tab, or
 * Back onto it from the settings walk, renders again. Without this the page
 * would be kept again the moment after it was deleted (Michał's report,
 * 2026-08-29: Delete, then Back, and the article stood on the list again).
 * Kept in `sessionStorage` so a reload of the tab remembers.
 *
 * A no is about one way in, not about the address for good: the press that
 * pointed the reader here is stamped (`ReaderSource.at` - the same stamp
 * that makes a second press on the same tab reach the reader at all), and
 * the no is stored under that stamp. A reload replays the same press and
 * finds the no; a new press is a new way in, with the keep by default the
 * setting promises. The first cut (#253) remembered the no for the tab's
 * whole life, and a reader who deleted a page and then opened it again by
 * hand was refused a save nobody had declined (Michał's report,
 * 2026-09-05). A new tab was always a new way in, and keeps. Pressing Save
 * by hand takes an address off the list: that is a yes.
 */
const DECLINED_KEEPS = "reread:declined-keeps";

/**
 * The stamp of the press this page stands on (`ReaderSource.at`), or 0 when
 * it stands on no source - the list opened for its own sake, which renders
 * no live page and keeps nothing.
 */
let sourceAt = 0;

/** @returns {Set<string>} the addresses declined on this way in */
function declinedKeeps() {
  try {
    /** @type {unknown} */
    const stored = JSON.parse(sessionStorage.getItem(DECLINED_KEEPS) ?? "null");
    if (typeof stored !== "object" || stored === null) return new Set();
    const { at, urls } = /** @type {Record<string, unknown>} */ (stored);
    // Another press's declines are not this one's - and the array the first
    // cut wrote, a tab that lived across the update, reads as nobody's.
    if (at !== sourceAt || !Array.isArray(urls)) return new Set();
    return new Set(urls.filter((url) => typeof url === "string"));
  } catch {
    return new Set();
  }
}

/**
 * @param {string} url
 * @param {boolean} declined
 */
function setKeepDeclined(url, declined) {
  const urls = declinedKeeps();
  if (declined) urls.add(url);
  else urls.delete(url);
  try {
    sessionStorage.setItem(DECLINED_KEEPS, JSON.stringify({ at: sourceAt, urls: [...urls] }));
  } catch {
    // Storage that will not take it forgets the no; the keep is a default
    // the reader can undo again, not a loss.
  }
}

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
 * Books whose words are being summed in this page (D226) - the same
 * one-at-a-time guard the TOC scan has, for the same reason.
 *
 * @type {Set<string>}
 */
const wordScansRunning = new Set();

/**
 * The rows the length pass (D226, `fillLengths`) has already tried on this
 * page: a row that could not be counted must not be tried again on every
 * refresh - and the refresh the pass makes when it is done lists the very
 * rows it just filled. Keyed the way the list keys its rows: an article's
 * address, a book's id.
 *
 * @type {Set<string>}
 */
const lengthsTried = new Set();

/** One pass at a time: the refresh at a pass's end starts none. */
let lengthPassRunning = false;

/**
 * How long a row of the length pass may wait for the page's quiet moment
 * before it goes anyway: long enough to stay out of a scroll's way, short
 * enough that a page never idle still fills its rows.
 */
const LENGTH_PASS_TIMEOUT = 1000;

/**
 * The mark the toolbar is about, while it shows (D107). Which one it is on
 * screen is said by the recall wash painted over it - `reread-active`, the
 * same registration the bubble uses, safe to borrow because the pen and the
 * bubble never stand at once (marker mode claims every tap).
 *
 * @type {import("../lib/reader/marks.js").Mark | null}
 */
let activeMark = null;

/**
 * The mark a handle drag is reshaping (D181), from the drag taking to its
 * end: painted by nothing while it lasts - the wet stroke stands in for it,
 * and a shrink could not show under its own dried paint - and rewritten to
 * the stroke's range when the drag ends. Apart from `activeMark`, which
 * stays what the toolbar is about throughout.
 *
 * @type {import("../lib/reader/marks.js").Mark | null}
 */
let reshaping = null;

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
 * The selection over the list (D152): whether the rows wear boxes, and the
 * articles ticked so far - by address, across tabs, filters and pages, until
 * Done. Held in memory only: a selection is a moment's intent, not state to
 * outlive the page, and the box beside every row shows all of it.
 */
let picking = false;
/** @type {Set<string>} */
let picked = new Set();

/**
 * What the last refresh read, kept so a tick can redraw the selection's
 * furniture and the export buttons without reading the stores again - and
 * without rebuilding the rows, which would take the focus off the box just
 * pressed and flash the whole list on e-ink.
 *
 * `bookRows` are every book's light rows, whichever tab, for the box that
 * offers them to the backup (D218) - a backup is everything - and for the
 * selection's export, which takes the ticked ones among them.
 *
 * @type {{
 *   selectable: string[],
 *   metas: SavedMeta[],
 *   bookRows: import("../lib/store/book.js").BookMeta[],
 * }}
 */
let libraryShown = { selectable: [], metas: [], bookRows: [] };

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
 * A `.zip` backup (D145) keeps its bytes here too, with the pictures each
 * article names and what they come to: the pictures are read out of the
 * archive only for the articles the import actually adds, after the
 * consent, one entry at a time.
 *
 * @type {{
 *   name: string,
 *   articles: import("../lib/store/saved-article.js").SavedArticle[],
 *   invalid: number,
 *   pictures?: { bytes: Uint8Array, refs: Map<string, PictureRef[]>, account: { count: number, bytes: number } },
 * } | null}
 */
let pendingImport = null;

/**
 * The backup of everything a picked file turned out to be (D213), waiting
 * for the reader's yes: each part parsed by its own reader, and what of it
 * the library already holds where the offer can say so. The old files come
 * here too - a highlights `.json` as a backup with one part; the list's own
 * `.json` and `.zip` keep their offer above. State rather than DOM, the
 * articles' offer's own reason.
 *
 * @type {{
 *   name: string,
 *   manifest: import("../lib/store/backup-file.js").BackupManifest | null,
 *   articles: import("../lib/store/articles-file.js").FileArticle[],
 *   newArticles: number,
 *   invalid: number,
 *   pictures?: { bytes: Uint8Array, refs: Map<string, PictureRef[]>, account: { count: number, bytes: number } },
 *   phrases: import("../lib/protocol.js").RestoreRow[],
 *   highlights: import("../lib/store/marks-copy.js").CopyDoc[],
 *   settings: import("../lib/config.js").ConfigPatch | null,
 *   books: {
 *     rows: import("../lib/store/books-file.js").FileBook[],
 *     plan: { toAdd: import("../lib/store/books-file.js").FileBook[], skipped: number },
 *     account: { count: number, bytes: number },
 *     bytes: Uint8Array,
 *   } | null,
 * } | null}
 */
let pendingBackup = null;

/**
 * How many titles the confirmation quotes before asking - a sample to
 * recognise the file by, never the whole list: a backup of a few hundred
 * articles would push the two buttons off the screen. The rest is counted
 * in one line under the sample, so the sample never reads as the total.
 */
const SAMPLE_TITLES = 3;

/**
 * The mark the notice's act would take out - the one the landing could not
 * paint (D151) - and null under every other sentence.
 *
 * @type {import("../lib/reader/marks.js").Mark | null}
 */
let noticeMark = null;

/**
 * @param {string} text
 */
function showNotice(text) {
  if (notice === null || noticeText === null) return;
  noticeText.textContent = text;
  offerMarkRemoval(null);
  notice.hidden = false;
}

function hideNotice() {
  if (notice === null) return;
  notice.hidden = true;
  offerMarkRemoval(null);
}

/**
 * The act under the notice's sentence (D151, Michał's smoke: a sentence
 * stuck over the text with nothing to do about it): the highlight the page
 * no longer reads, taken out right here - the reader was just told it
 * cannot be shown, and the trash for it stood a trip away on the highlights
 * page. Null takes the act off: every other sentence, and the notice
 * leaving. Armed like every Delete of this page (`armDelete`), and back to
 * its own words on the way down - the document-wide act's road, through
 * `data-label`. The quote is the title the armed question names.
 *
 * @param {import("../lib/reader/marks.js").Mark | null} mark
 */
function offerMarkRemoval(mark) {
  noticeMark = mark;
  if (noticeAct === null) return;
  if (noticeAct.hasAttribute("data-armed")) disarmDelete();
  noticeAct.hidden = mark === null;
  if (mark === null) return;
  const label = t("marker_delete");
  noticeAct.setAttribute("data-label", label);
  noticeAct.setAttribute("data-title", mark.text);
  noticeAct.style.removeProperty("min-width");
  noticeAct.textContent = label;
  noticeAct.setAttribute("aria-label", label);
}

/**
 * The confirmed press on the notice's act: the mark leaves the document's
 * list and the database, and the sentence leaves with it - there is nothing
 * left to say. Matched by position, `deleteMarkRow`'s way, because the
 * object the landing held may have been replaced under it by a later edit
 * of the list. Optimistic like the toolbar's own Delete, rolled back when
 * the write fails, the failure standing where the sentence stood.
 */
async function removeNoticeMark() {
  const target = shown;
  const mark = noticeMark;
  hideNotice();
  if (target === null || mark === null) return;
  const before = docMarks;
  docMarks = docMarks.filter((one) => compareMarks(one, mark) !== 0);
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
 * The line under the notes export - its own, so a report about the .md
 * never stands under the backup's buttons, nor the other way round (D153).
 *
 * @param {string} text
 * @param {"error"} [tone]
 */
function marksNotesStatus(text, tone) {
  if (marksNotesLine === null) return;
  marksNotesLine.textContent = text;
  if (tone === undefined) delete marksNotesLine.dataset["tone"];
  else marksNotesLine.dataset["tone"] = tone;
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
 *   pictures?: import("../lib/reader/article.js").Pictures,
 * }} piece
 *   `url` is the document's name in the database (a book's id included);
 *   `link` is the address worth offering as "Open the original", which a
 *   book does not have; `pictures` is how the saved pictures are shown
 *   (D145, and a book's, D183) - absent, the text keeps its pictures'
 *   addresses and shows none.
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
  // A save of pictures belongs to the article it was pressed on (D145): a
  // different document on screen is the stop. The pictures shown so far
  // were reached through addresses of this page's making, given back now
  // that nothing on screen will ask for them.
  if (picturesTask !== null && picturesTask.url !== piece.url) picturesTask.controller.abort();
  for (const address of shownPictures) URL.revokeObjectURL(address);
  shownPictures = [];

  const rebuilt = buildArticle(piece.source, document, {
    // A book came from no address (D230): a link its text kept - a Markdown
    // text's - stands when absolute and goes when relative, and its id,
    // which is no URL, is not asked to resolve anything.
    baseUrl: piece.origin === "book" ? NO_BASE : piece.url,
    pictures: piece.pictures ?? true,
    // A book's pictures are addressed inside its archive (D183), and the
    // stored address is whole already - resolved against the root.
    ...(piece.origin === "book" ? { archive: "" } : {}),
  });

  titleElement.textContent = piece.title;
  if (bylineElement !== null) {
    bylineElement.textContent = piece.credit.join(" - ");
    bylineElement.hidden = piece.credit.length === 0;
  }
  // The pictures line (D231) waits for the database's say like the action
  // rows do: the offer of the document just left must not stand over this one.
  if (picturesOffer !== null) picturesOffer.hidden = true;

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
  // The footnote marks of the text that just stood up - and whatever note
  // was open belonged to the text that just left.
  hideNotePopover();
  applyNoteMarks();
  if (library !== null) library.hidden = true;
  if (marksSection !== null) marksSection.hidden = true;
  marksShown = null;
  article.hidden = false;
  hideNotice();

  // The learning side back on the article, if a view moved it elsewhere
  // (D109), and the underlines found again now that there is different text
  // under the ground. Nothing is asked of storage: the vocabulary did not
  // change, only what it can be found in.
  // The header's facts (D226): the words counted now, off the markup exactly
  // as a save would serialize it; the phrases once the paint has spoken -
  // which the rescan below does at once when the vocabulary is already in,
  // and `onPainted` does later when it arrives.
  shownWords = wordsIn(rebuilt.innerHTML);
  foundPhrases = null;
  rootReadingSide(article);
  rescan();
  renderFacts();

  // The same door the orphan rows' links go through (D150, `webAddress`):
  // a stored address is data, and only the web's two schemes belong in an
  // `href` this page hands out (D171) - a `file:` page cannot be opened
  // from here anyway, and anything stranger has no business being a link.
  // Said in two places over the one rule (`sourceOf`): the menu's row, and
  // the site under the title (D232), where a reader who never opens the
  // menu meets it - the host the list row shows, as a link to the page in
  // a new tab. No web address, no row and no line.
  const from = sourceOf(piece.link);
  if (originalLink instanceof HTMLAnchorElement) {
    if (from === null) {
      originalLink.hidden = true;
    } else {
      originalLink.href = from.href;
      originalLink.target = "_blank";
      originalLink.rel = "noreferrer noopener";
      originalLink.hidden = false;
    }
  }
  if (sourceLine !== null && sourceLink instanceof HTMLAnchorElement && sourceSite !== null) {
    if (from === null) {
      sourceLine.hidden = true;
    } else {
      sourceSite.textContent = from.host;
      sourceLink.href = from.href;
      sourceLink.target = "_blank";
      sourceLink.rel = "noreferrer noopener";
      sourceLine.hidden = false;
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
  updateChromeTab();
  scrollTo(0, 0);
  // The action rows are the caller's move, not taken here: the two callers
  // that restore a position must have them laid out BEFORE the scroll - the
  // bar stands above the article, and appearing later it would push the
  // restored block down the exact height it takes.
}

/**
 * The line under the byline (D226): how long the text on screen is, and how
 * many of the reader's saved phrases stand in it. Each piece only where it
 * says something: a text of pictures alone has no words to count, and the
 * phrases are said once something has been painted - never where there is
 * nothing to paint, so a reader who has saved nothing yet is not told
 * "none" over every text.
 */
function renderFacts() {
  if (factsElement === null) return;
  /** @type {string[]} */
  const pieces = [];
  if (shownWords > 0) pieces.push(plural(shownWords, "reader_words"), timeLabel(shownWords));
  if (foundPhrases !== null) {
    pieces.push(
      foundPhrases === 0 ? t("reader_phrases_here_none") : plural(foundPhrases, "reader_phrases_here"),
    );
  }
  factsElement.textContent = pieces.join(" · ");
  factsElement.hidden = pieces.length === 0;
}

/**
 * About how long a count of words takes to read at the reader's own pace
 * (`readingPace`, D228), said the way the catalogue says it: minutes under
 * an hour, hours - and minutes, when there are any - above it
 * (`readingTime`). One place for the list's rows and the header.
 *
 * @param {number} words
 * @returns {string}
 */
function timeLabel(words) {
  const { hours, minutes } = readingTime(words, settings.readingPace);
  if (hours === 0) return t("reader_time_minutes", minutes.toLocaleString());
  if (minutes === 0) return t("reader_time_hours", hours.toLocaleString());
  return t("reader_time_hours_minutes", [hours.toLocaleString(), minutes.toLocaleString()]);
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
 * @param {import("../lib/reader/article.js").Pictures} [pictures] the saved
 *   pictures, by the addresses the text asks for
 */
function renderSaved(saved, pictures) {
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
    pictures,
  });
}

/**
 * The saved pictures as the rebuild shows them (D145): each one behind a
 * `blob:` address of this page's making, found by the address the text
 * asks for. The addresses are the caller's to remember - they are revoked
 * when the article leaves the screen, and a render made before they stand
 * would revoke them first.
 *
 * @param {import("../lib/reader/pictures.js").PictureRow[]} rows
 * @returns {{ resolve: import("../lib/reader/article.js").Pictures, addresses: string[] }}
 */
function shownPictureSet(rows) {
  /** @type {Map<string, { url: string, width: number, height: number }>} */
  const bySource = new Map();
  /** @type {string[]} */
  const addresses = [];
  for (const row of rows) {
    if (bySource.has(row.src)) continue;
    const address = URL.createObjectURL(new Blob([row.data], { type: row.mime }));
    addresses.push(address);
    bySource.set(row.src, { url: address, width: row.width, height: row.height });
  }
  return { resolve: (src) => bySource.get(src) ?? null, addresses };
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
  let fold = barFold();
  // The panels hang under the bar as sheets since D233's smoke (reader.css)
  // rather than growing the box: open, a sheet is chrome over the text all
  // the same - the voice must not park a line under it, nor the bubble
  // stand beneath it - so the fold reaches to its foot while it stands.
  for (const panel of [displayPanel, menuPanel]) {
    if (panel === null || panel.hidden) continue;
    fold = Math.max(fold, panel.getBoundingClientRect().bottom);
  }
  return fold;
}

/**
 * How far down the window the bar itself reaches - the stuck box without
 * the sheets that may hang under it. What the pages are cut under (D233):
 * a sheet opening over the text must not re-cut them, and closing it must
 * not move the reading.
 */
function barFold() {
  return Math.max(0, chromeBox?.getBoundingClientRect().bottom ?? 0);
}

/**
 * Where the visible text begins: under the chrome - and, read by pages
 * (D233), under the page's head as well, its curtain and its margin. The
 * strip between the bar's edge and the page's first line is paper over the
 * tail of the page before, and whatever measures "the first visible line"
 * from the bar's edge finds that tail instead: the voice began a page on
 * the paragraph before it, and the position saved under the curtain reopened
 * a page early (Michał's smoke, 2026-09-17). The voice, the position and the
 * bubble's room all measure from here.
 *
 * @returns {number}
 */
function textFold() {
  return paged() ? pageBand().top : chromeFold();
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
  const line = textFold() + 2;

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
  // Read by pages, "read" is the page on screen out of the part's pages
  // (D233): the window's edge would count the screen of padding the
  // layout keeps under the last line.
  const pages = pagesNow();
  const percent =
    pages === null
      ? measuredPercent(window.scrollY, window.innerHeight, document.documentElement.scrollHeight)
      : pagePercent(pageShown(pages), pages.tops.length);
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
  if (at === null) {
    // The top - and, read by pages, the first page squared under the bar
    // with its curtain drawn (D233).
    settlePage();
    return;
  }
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
  const blockTop = rect.top + window.scrollY;
  const fine = fineScrollTop(
    blockTop,
    rect.height,
    window.innerHeight,
    position?.percent,
    document.documentElement.scrollHeight,
  );
  if (fine !== null) scrollTo(0, fine);
  // Read by pages, the place is the page the block's first line stands on -
  // or, inside a block taller than a page, the page the fine scroll reached.
  landOnPageOf(fine !== null ? fine + textFold() : blockTop);
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
 * @param {number} [fold] the chrome's reach to measure under - the whole
 *   chrome with any open sheet by default; the bar alone for the pages
 * @returns {{ top: number, bottom: number }}
 */
function readableBand(fold = chromeFold()) {
  const view = window.visualViewport;
  const seen =
    view === null
      ? { top: 0, bottom: document.documentElement.clientHeight }
      : { top: view.offsetTop, bottom: view.offsetTop + view.height };

  let bottom = seen.bottom;
  // The page's foot (D233, D238) stands at the window's foot like the bars,
  // and is measured like them - and like them measures as nothing while it
  // is not laid out. Whatever stands lowest ends the band: the pages are
  // cut above a bar as the scroll layout's turns are (D238 - the page keeps
  // its first line when a bar stands up, and gives its last lines to the
  // curtain), so nothing is ever laid under one.
  for (const bar of [speechBar, markBar, pageFooter]) {
    if (bar === null || bar.hidden) continue;
    const edge = bar.getBoundingClientRect().top;
    // A bar measured at nothing is a bar that is not laid out; taking that
    // for the floor of the text would page by one line forever.
    if (edge > 0) bottom = Math.min(bottom, edge);
  }
  return { top: Math.max(fold, seen.top), bottom };
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
 * The line box straddling the fold, measured where the article's own text
 * stands: one caret hit just under the stuck chrome, in the middle of the
 * text column, and the rect of the character the hit lands on. Null when
 * there is nothing to measure - the fold in a picture or in the gap between
 * paragraphs, a bubble standing over the point, an engine without
 * `caretPositionFromPoint` - and every null leaves the turn where the step
 * put it, which is where every turn landed before this measured anything.
 *
 * @param {number} fold
 * @returns {{ top: number, bottom: number } | null}
 */
function foldLineBox(fold) {
  if (typeof document.caretPositionFromPoint !== "function") return null;
  if (contentElement === null) return null;
  const column = contentElement.getBoundingClientRect();
  const position = document.caretPositionFromPoint(column.left + column.width / 2, fold + 2);
  if (position === null) return null;
  const node = position.offsetNode;
  if (!(node instanceof Text) || node.length === 0 || !contentElement.contains(node)) return null;
  const at = Math.min(position.offset, node.length - 1);
  const range = document.createRange();
  range.setStart(node, at);
  range.setEnd(node, at + 1);
  const rect = range.getBoundingClientRect();
  return rect.height > 0 ? { top: rect.top, bottom: rect.bottom } : null;
}

/**
 * Whether this is an Apple platform, where Option with an arrow is the
 * system's own paging pair (D170): Blink maps Alt-Up/Down to PageUp/Down on
 * the Mac alone, Gecko does the same through Cocoa's key bindings, and an
 * iPad with a hardware keyboard pages like the Mac it reports itself as
 * (`MacIntel`) - the `iP` prefix catches the ones that still say `iPad`.
 */
const macPaging = navigator.platform.startsWith("Mac") || navigator.platform.startsWith("iP");

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
 * tested; so is how far one goes, and the nudge that squares the landing
 * with the text so every page opens on a whole first line.
 *
 * @param {KeyboardEvent} event
 */
function onPageKey(event) {
  if (article === null || article.hidden) return;
  // A room over the reading (D243) owns the window; the keys inside its
  // frame are its own, and a key that reaches this document must not turn
  // a page nobody can see.
  if (roomShown !== null) return;

  const target = event.target instanceof HTMLElement ? event.target : null;
  const turn = pageTurn({
    key: event.key,
    shift: event.shiftKey,
    alt: event.altKey,
    ctrl: event.ctrlKey,
    meta: event.metaKey,
    mac: macPaging,
    tag: target?.tagName ?? "",
    editable: target?.isContentEditable ?? false,
    reading: readingState() !== "off",
    dialog: document.querySelector("dialog[open]") !== null,
    paged: paged(),
  });
  if (turn === null) return;

  event.preventDefault();
  // Read by pages (D233), a turn is a page of the table, not a screenful:
  // the arithmetic below is the scroll layout's.
  if (paged()) {
    turnPage(turn);
    return;
  }
  if (turn === "first" || turn === "last") return;
  const band = readableBand();
  const step = pageStep(band, readingLine());
  // Instantly, and nothing here says otherwise: a smooth scroll on an e-ink
  // panel is a page of smeared refreshes. The scroll itself arms the position
  // save like any other, so where the reading stands follows the keys.
  scrollBy(0, turn === "down" ? step : -step);
  // The step lands where it lands; the line it leaves cut at the fold is
  // measured and given back (or tucked away) before the browser paints, so
  // even an e-ink panel shows one turn, opening on a whole first line.
  const nudge = foldSnap(turn, band.top, foldLineBox(band.top), step / 2);
  if (nudge !== 0) scrollBy(0, nudge);
}

document.addEventListener("keydown", onPageKey);

/**
 * Reading by pages (D233): the document stays the window's scroller, and
 * moves only by whole pages.
 *
 * A page is a stretch of the column that fits the readable band, cut so
 * that it opens and closes on a whole line: the table of page tops is cut
 * from the flow's blocks and, where a page's edge falls inside a block,
 * from that block's own line boxes (`lib/reader/pages.js`, where the rule is
 * tested). A turn is one `scrollTo` to a page's top under the stuck chrome
 * plus the curtain drawn over whatever the window still shows below the
 * page's last line - both in one task, so an e-ink panel sees one refresh,
 * the same bargain D127 and D143 made. The finger and the wheel do not
 * scroll the window (the stylesheet), a tap on the page's outer thirds
 * turns it, and every scroll the reader makes for its own reasons - a
 * position restored, a search hit, a heading, the spoken line - lands on
 * the page its target stands on.
 *
 * The table is measured on the ask and kept while nothing that cuts pages
 * has changed: the band's height (a panel opening, a bar standing up, the
 * window resized), the document's height (a picture arriving, the type
 * resized) and the document itself (`epoch`). What it measures is blocks
 * first and lines only where a cut falls, so a book's part costs one or
 * two line walks a page.
 */

/** Whether the document on screen is being read by pages right now. */
function paged() {
  return settings.reader.layout === "paged" && article !== null && !article.hidden;
}

/**
 * @typedef {object} PageTable
 * @property {number[]} tops where every page begins, document coordinates
 * @property {number} height the band the pages were cut for
 * @property {number} extent the document's scroll height they were cut from
 * @property {number} epoch the document they were cut from
 * @property {Element[]} blocks the flow's blocks the pages were cut from
 * @property {import("../lib/reader/pages.js").Box[]} boxes their boxes,
 *   document coordinates, as they stood at the cut
 * @property {number | null} anchor the top of the page turned to last (D238):
 *   the page the window is on while nothing has moved it, and the one it
 *   goes back to when something has - the bubble's ride, the text
 *   re-wrapped under a re-cut. Null for a table nobody has turned in yet.
 */

/** @type {PageTable | null} */
let pageTable = null;

/** The page under the chrome (`main#page`): the flow's own box. */
const pageMain = document.getElementById("page");

/**
 * One of the stylesheet's lengths (`--page-air`, `--page-foot-air` in
 * reader.css) in CSS pixels, read rather than repeated: two copies of one
 * margin would part on the first edit. In the interface's own unit there,
 * so a margin grows with a device's text zoom the way the bar does.
 *
 * @param {string} name the custom property
 * @param {number} fallback in rem, for a stylesheet that does not say
 * @returns {number}
 */
function airToken(name, fallback) {
  const root = getComputedStyle(document.documentElement);
  const rem = Number.parseFloat(root.fontSize);
  const unit = Number.isFinite(rem) && rem > 0 ? rem : 16;
  const declared = /^\s*([\d.]+)\s*(rem|px)\s*$/.exec(root.getPropertyValue(name));
  if (declared === null) return unit * fallback;
  const amount = Number.parseFloat(declared[1] ?? "");
  if (!Number.isFinite(amount)) return unit * fallback;
  return declared[2] === "px" ? amount : amount * unit;
}

/**
 * A page's top margin: the room a page of paper keeps between the bar's
 * edge and its first line (Michał's smoke, 2026-09-17: the first line
 * stood against the bar's border, and against the window's edge with the
 * bar folded).
 *
 * @returns {number}
 */
function pageAir() {
  return airToken("--page-air", 0.75);
}

/**
 * A page's bottom margin (D238): only as much as keeps the last line's
 * descenders off whatever stands at the foot - the window's edge, the
 * count's line, a bar's border - and no more. The first cuts kept a strip
 * the bars' height under every page, and on the Boox it read as three or
 * four empty lines (Michał's photos, 2026-09-17).
 *
 * @returns {number}
 */
function pageFootAir() {
  return airToken("--page-foot-air", 0.5);
}

/**
 * The strip of the window a page's lines stand in: the readable band less
 * the margins, and under the bookmark tab - which hangs below the bar,
 * folded or not, over the first line's right end (the same smoke: "key"
 * read as "ke[v]h"). Under the bar alone, never under an open sheet: the
 * Aa panel and the menu hang over the text and leave the pages as they
 * are. Its top is also the first page's top in the flow: the chrome stands
 * at the document's head, stuck, so its edge in the window is its edge in
 * the flow before anything has scrolled. Its foot is a small margin above
 * whatever actually stands lowest in the window, measured off it (D238):
 * the page's foot strip - the count's one line when the setting shows it,
 * the phone's safe area alone otherwise - or a bar standing up, the
 * voice's or the pen's. A bar shortens the band, then, and the pages are
 * cut again for it; the page being read keeps its first line through that
 * (`pagesNow`, the anchor), so what the reader sees is the last lines
 * going behind the curtain, never the text moving. `floor` is the edge of
 * what stands lowest - where the curtain has nothing left to cover.
 *
 * @returns {{ top: number, bottom: number, floor: number }}
 */
function pageBand() {
  const band = readableBand(barFold());
  let top = band.top;
  if (chromeTab !== null && !chromeTab.hidden) {
    const edge = chromeTab.getBoundingClientRect().bottom;
    if (edge > top) top = edge;
  }
  top += pageAir();
  return { top, bottom: Math.max(top, band.bottom - pageFootAir()), floor: band.bottom };
}

/**
 * The blocks of the flow between the stuck chrome and the document's end,
 * in order: everything under the page's box that stands in the flow - the
 * part pager, the note over a book's language, the article's header pieces
 * and the content's own blocks, the pager and the action row under the
 * text - with the fixed and the stuck pieces left out, whose rects say
 * nothing about the flow. The boxes that only hold the flow (the page, the
 * article, the content) are opened, not counted: counted, the page would
 * be one block, and every cut would walk every line of the text. Hidden
 * rows measure as nothing and are dropped by the cutter.
 *
 * @returns {Element[]}
 */
function flowBlocks() {
  /** @type {Element[]} */
  const blocks = [];
  /**
   * @param {Element} box
   * @param {boolean} placed whether the children may be positioned out of
   *   the flow - true for the body's and the page's own children, never
   *   for the text's blocks, which a style read apiece would slow down
   */
  const open = (box, placed) => {
    for (const child of box.children) {
      if (child === pageMain || child === article || child === contentElement) {
        open(child, child === pageMain);
        continue;
      }
      if (child.tagName === "DIALOG" || child.tagName === "TEMPLATE" || child.tagName === "SCRIPT") continue;
      if (placed) {
        const position = getComputedStyle(child).position;
        if (position === "fixed" || position === "sticky" || position === "absolute") continue;
      }
      blocks.push(child);
    }
  };
  open(document.body, true);
  return blocks;
}

/**
 * The controls a page's edge must never cut through (D245): a button, a
 * chooser, a field, the summary of a fold.
 */
const CONTROLS = new Set(["BUTTON", "SELECT", "TEXTAREA", "INPUT", "SUMMARY"]);

/**
 * Whether a node stands inside a control rather than in the text - a
 * button's word, the glyph drawn beside it. The walk goes up to and
 * including the block itself, because a block can BE a control: the way
 * back to the reading list under the last paragraph is a button of its own.
 *
 * Nothing inside a control is a line, so a block whose whole content is
 * controls has no lines at all, and the cutter moves it onto the next page
 * whole (`pagesOn`, `pagesBack` - the rule a picture already lives by).
 * Until D245 the words in those buttons were lines like any others, and the
 * row of acts under an article came out halved: the frames on one page, the
 * words on the next (Michał's photos, 2026-09-18).
 *
 * @param {Node} node
 * @param {Element} block the block being measured
 * @returns {boolean}
 */
function withinControl(node, block) {
  let at = node instanceof Element ? node : node.parentElement;
  while (at !== null) {
    if (CONTROLS.has(at.tagName)) return true;
    if (at === block) return false;
    at = at.parentElement;
  }
  return false;
}

/**
 * The line boxes of one block, document coordinates, sorted, one box per
 * line: the rects of its text, and of the pictures set in its text, with
 * the boxes of one line - a line runs through several rects wherever an
 * inline element begins - merged into one. Asked only for a block a page's
 * edge cuts.
 *
 * @param {Element} block
 * @returns {import("../lib/reader/pages.js").Box[]}
 */
function lineBoxes(block) {
  /** @type {import("../lib/reader/pages.js").Box[]} */
  const boxes = [];
  const scrolled = window.scrollY;
  const range = document.createRange();
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (!(node instanceof Text) || node.data.trim().length === 0) continue;
    if (withinControl(node, block)) continue;
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      if (rect.height > 0) boxes.push({ top: rect.top + scrolled, bottom: rect.bottom + scrolled });
    }
  }
  for (const picture of block.querySelectorAll("img, svg, video, canvas")) {
    if (withinControl(picture, block)) continue;
    const rect = picture.getBoundingClientRect();
    if (rect.height > 0) boxes.push({ top: rect.top + scrolled, bottom: rect.bottom + scrolled });
  }
  boxes.sort((a, b) => a.top - b.top);
  /** @type {import("../lib/reader/pages.js").Box[]} */
  const lines = [];
  for (const box of boxes) {
    const last = lines[lines.length - 1];
    // Overlapping in height is the same line: a rect beginning above the
    // last line's foot belongs to it (an inline element's box, a taller
    // glyph); one beginning at or under it is the next line.
    if (last !== undefined && box.top < last.bottom - 1) {
      last.top = Math.min(last.top, box.top);
      last.bottom = Math.max(last.bottom, box.bottom);
    } else {
      lines.push({ top: box.top, bottom: box.bottom });
    }
  }
  return lines;
}

/**
 * The first line of the page turned to, kept as a place in the text
 * (D238): the block it stands in and, for a line inside the block, the text
 * node and the offset of the line's first character. Measured again when
 * the pages have to be cut again for the same document, so the page keeps
 * its first line whatever moved: a bar standing up only shortens the band,
 * and the line's coordinate holds; the bar folded away, a picture arrived
 * or the type resized re-wrap the text, and the line is found again where
 * its words went. Nothing for a page opening on a block's own top edge but
 * the block, and nothing when the line cannot be pinned to a character (a
 * page cut inside a picture): then the next cut runs from the head, as
 * every cut did before the anchor existed.
 *
 * @type {{ block: Element, node: Text | null, offset: number } | null}
 */
let pageAnchor = null;

/**
 * Whether a pointer is down on the page - a hold, a stroke, a handle's
 * drag. The pages are never cut again under a finger (D238): with the
 * anchor nothing would move, but the curtain would, and a curtain jumping
 * under a stretching selection is the gesture losing its end. A cut asked
 * for meanwhile waits for the lift (`settleWanted`).
 */
let pointerHeld = false;
let settleWanted = false;

/**
 * Whether the table has to be cut again although nothing it was keyed on
 * has measurably changed yet - the Aa panel about to re-wrap the text, the
 * count's line about to stand at the foot. Kept rather than dropped, so the
 * re-cut still has the page being read to begin from (D238).
 */
let pagesStale = false;

/**
 * Keeps the page's first line as a place in the text (`pageAnchor`).
 *
 * @param {PageTable} pages
 * @param {number} page
 */
function keepPageAnchor(pages, page) {
  pageAnchor = null;
  const top = pages.tops[page];
  if (top === undefined) return;
  // The block the page opens in: the one whose box holds the page's top,
  // or begins on it.
  const at = pages.boxes.findIndex((box) => box.top <= top + 1 && box.bottom > top + 1);
  const block = pages.blocks[at];
  const box = pages.boxes[at];
  if (block === undefined || box === undefined) return;
  if (box.top >= top - 1) {
    pageAnchor = { block, node: null, offset: 0 };
    return;
  }
  const found = lineStartIn(block, top);
  if (found !== null) pageAnchor = { block, node: found.node, offset: found.offset };
}

/**
 * The first character of the line standing at `top` inside a block: the
 * first text node with a box on or under that line, and in it the first
 * character whose box stands there. A node's characters never climb back
 * up the page, so the edge is found by halves - a handful of boxes asked
 * for, whatever the paragraph's length.
 *
 * @param {Element} block
 * @param {number} top the line's top, document coordinates
 * @returns {{ node: Text, offset: number } | null}
 */
function lineStartIn(block, top) {
  const scrolled = window.scrollY;
  const range = document.createRange();
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (!(node instanceof Text) || node.length === 0) continue;
    range.selectNodeContents(node);
    let reaches = false;
    for (const rect of range.getClientRects()) {
      if (rect.height > 0 && rect.top + scrolled >= top - 1) {
        reaches = true;
        break;
      }
    }
    if (!reaches) continue;
    let low = 0;
    let high = node.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      range.setStart(node, mid);
      range.setEnd(node, mid + 1);
      const rect = range.getClientRects()[0];
      // A character with no box - a collapsed space at a line's end - is
      // the line before's.
      if (rect !== undefined && rect.top + scrolled >= top - 1) high = mid;
      else low = mid + 1;
    }
    return { node, offset: low };
  }
  return null;
}

/**
 * Where the kept first line stands now, document coordinates, snapped to
 * the top of its line box the way the cutter measures lines (a character's
 * own box can stand a hair under a taller neighbour's on the same line) -
 * or undefined when nothing is kept, or what was kept is gone.
 *
 * @returns {number | undefined}
 */
function anchorY() {
  const kept = pageAnchor;
  if (kept === null || !kept.block.isConnected) return undefined;
  const scrolled = window.scrollY;
  if (kept.node === null) return kept.block.getBoundingClientRect().top + scrolled;
  if (!kept.node.isConnected || kept.offset >= kept.node.length) return undefined;
  const range = document.createRange();
  range.setStart(kept.node, kept.offset);
  range.setEnd(kept.node, kept.offset + 1);
  const rect = range.getClientRects()[0];
  if (rect === undefined) return undefined;
  const y = rect.top + scrolled;
  const line = lineBoxes(kept.block).find((one) => one.top <= y + 1 && one.bottom > y + 1);
  return line === undefined ? y : line.top;
}

/**
 * The page table as it stands, cut now if nothing usable is kept - or null
 * when the document is not read by pages.
 *
 * Cut again for the same document - the band shortened by a bar or the
 * browser's own bar, lengthened by the bar folding away, the type resized,
 * a picture arrived - the table is cut from the page being read (D238):
 * its first line, found again in the text, opens the same page in the new
 * table, and the pages before it are cut back from there. The window then
 * stands where it stood, and only the curtain moves. Never under a finger:
 * a held pointer gets the table it has, and the cut waits for the lift.
 *
 * @returns {PageTable | null}
 */
function pagesNow() {
  if (!paged()) return null;
  // The foot stands before the band is measured - the band ends above it,
  // and a table cut for a band without it would be a line too long.
  if (pageFooter !== null) pageFooter.hidden = false;
  const band = pageBand();
  const height = Math.max(0, band.bottom - band.top);
  const extent = document.documentElement.scrollHeight;
  const kept = pageTable;
  if (
    kept !== null &&
    !pagesStale &&
    kept.height === height &&
    kept.extent === extent &&
    kept.epoch === epoch
  ) {
    return kept;
  }
  const same = kept !== null && kept.epoch === epoch;
  if (same && pointerHeld) {
    settleWanted = true;
    return kept;
  }
  pagesStale = false;
  const blocks = flowBlocks();
  const scrolled = window.scrollY;
  const boxes = blocks.map((block) => {
    const rect = block.getBoundingClientRect();
    return { top: rect.top + scrolled, bottom: rect.bottom + scrolled };
  });
  const anchor = same ? anchorY() : undefined;
  // The first page begins where the band does, before anything has
  // scrolled: under the chrome and its tab, a margin down (`pageBand`).
  const tops = pageTops(
    boxes,
    (index) => {
      const block = blocks[index];
      return block === undefined ? [] : lineBoxes(block);
    },
    height,
    band.top,
    anchor,
  );
  pageTable = {
    tops,
    height,
    extent,
    epoch,
    blocks,
    boxes,
    anchor: anchor === undefined ? null : (tops[pageAt(tops, anchor)] ?? null),
  };
  return pageTable;
}

/**
 * The page on screen: the one the line under the stuck chrome belongs to -
 * or, with the window off any page (the bubble's ride, the text re-wrapped
 * under a re-cut), the page turned to last, which the window goes back to.
 *
 * @param {PageTable} pages
 * @returns {number}
 */
function pageShown(pages) {
  const band = pageBand();
  const under = pageAt(pages.tops, window.scrollY + band.top);
  if (pages.anchor === null || onPage(window.scrollY, pages.tops[under] ?? 0, band.top)) return under;
  return pageAt(pages.tops, pages.anchor);
}

/**
 * Turns to one page of the table: the scroll, and the curtain, in one task.
 * The page turned to is the one the table keeps (`anchor`), and its first
 * line the place the next cut is measured from.
 *
 * @param {PageTable} pages
 * @param {number} page
 */
function showPageOf(pages, page) {
  const top = pages.tops[page];
  if (top === undefined) return;
  // Instantly, like every movement in the reader: a smooth scroll on an
  // e-ink panel is a page of smeared refreshes. The scroll arms the
  // position save like any other.
  scrollTo(0, Math.max(0, top - pageBand().top));
  pages.anchor = top;
  keepPageAnchor(pages, page);
  refreshCurtain();
  // A range being stretched under a held pointer grows onto the page just
  // turned to (D239) - read again at the pointer, which stands over other
  // words now, in the same task as the turn: one refresh. Nothing while no
  // stretch is on.
  restretch();
}

/**
 * A turn: the next page, the one before, either end - and past a part's
 * last page the next part of the book, past its first page the last page
 * of the part before, the way a book's pages run on across its parts. The
 * turn on past the last page counts the part as read to its end (D209:
 * arriving counts, the way the Next under the text does), and an article's
 * last page is where an article ends.
 *
 * @param {import("../lib/reader/paging.js").PageTurn} turn
 */
function turnPage(turn) {
  const pages = pagesNow();
  if (pages === null) return;
  const target = turnTarget(pages.tops, pageShown(pages), turn);
  if (target !== null) {
    showPageOf(pages, target);
    return;
  }
  const book = shown;
  if (book === null || book.origin !== "book") return;
  if (turn === "down" && book.segmentIndex < book.segmentCount - 1) {
    countFinished();
    turnSegment(1);
  } else if (turn === "up" && book.segmentIndex > 0) {
    void openBook(book.url, book.segmentIndex - 1, { end: true });
  }
}

/**
 * The page a document coordinate stands on, turned to - the landing every
 * scroll the reader makes takes when the document is read by pages. False
 * when it is not, and the caller scrolls its own way.
 *
 * @param {number} docY
 * @returns {boolean}
 */
function landOnPageOf(docY) {
  const pages = pagesNow();
  if (pages === null) return false;
  showPageOf(pages, pageAt(pages.tops, docY));
  return true;
}

/**
 * The last page of the part just rendered (D233): where a turn back from
 * the next part's first page lands. False when the document is not read
 * by pages, and the opener falls back to the reading position.
 *
 * @returns {boolean}
 */
function landOnLastPage() {
  const pages = pagesNow();
  if (pages === null) return false;
  showPageOf(pages, pages.tops.length - 1);
  return true;
}

/**
 * The spoken sentence kept on its page (D233, `read-aloud.js`): nothing
 * while a line of it stands on the page shown - a sentence straddling the
 * page's head is read from its start with its head behind the curtain - and
 * a turn to its first line's page when none does. True whenever the
 * document is read by pages, so the voice never scrolls a paged document
 * into its band.
 *
 * @param {Range} range
 * @param {"sentence" | "word"} kind the sentence being begun, or the word
 *   being spoken - which never turns the page back (`revealTarget`)
 * @returns {boolean}
 */
function revealOnPage(range, kind) {
  const pages = pagesNow();
  if (pages === null) return false;
  const shownPage = pageShown(pages);
  const scrolled = window.scrollY;
  /** @type {number[]} */
  const lines = [];
  for (const rect of range.getClientRects()) {
    if (rect.height > 0) lines.push(rect.top + scrolled);
  }
  const top = pages.tops[shownPage] ?? 0;
  // The window shown off its page - a scroll that was not a turn - goes to
  // the sentence's page outright; on a page, the rule decides (`pages.js`):
  // a sentence with a line on the page shown is read where it stands, and
  // a word turns the page on, never back.
  if (!onPage(scrolled, top, pageBand().top)) {
    const first = lines[0];
    if (first !== undefined && kind === "sentence") showPageOf(pages, pageAt(pages.tops, first));
    return true;
  }
  const target = revealTarget(pages.tops, shownPage, lines, kind === "word");
  if (target !== null) showPageOf(pages, target);
  return true;
}

/**
 * The window squared with the page it shows: the page under the line at
 * the top of the screen, turned to unless the window stands on it already.
 * Taken after every scroll that was not a turn - the layout switched under
 * a scrolled document, a hash the browser jumped to, the bubble's scrolling
 * undone as it left - and never while a bubble stands: its scrolling is
 * deliberate, keeping its edit box above the keyboard (D97) or making room
 * for itself (D138), and the page waits for it to leave.
 */
function settlePage() {
  // Not under a finger (D238): the lift settles the page.
  if (pointerHeld) {
    settleWanted = true;
    return;
  }
  const pages = pagesNow();
  if (pages === null) {
    refreshCurtain();
    return;
  }
  if (bubbleOpen()) {
    refreshCurtain();
    return;
  }
  const page = pageShown(pages);
  const top = pages.tops[page] ?? 0;
  if (onPage(window.scrollY, top, pageBand().top)) refreshCurtain();
  else showPageOf(pages, page);
}

/**
 * The curtain and the page count, as they stand for the window's position:
 * the curtain over the foot of the page shown - and only while the window
 * stands on a page, because shown off its top the page's foot is somewhere
 * else - and the count of the page shown out of the part's pages, said in
 * three places (D238): at the foot, where the stylesheet shows it only
 * when the setting asks (off, the foot is the phone's safe area alone);
 * in the bar beside the brand while the foot keeps none, on a screen wide
 * enough (the stylesheet again); and for a screen reader always, in the
 * live region, whatever the eye is shown. All gone when the document is
 * not read by pages.
 */
function refreshCurtain() {
  if (pageCurtain === null || pageHead === null || pageFooter === null) return;
  const reading = paged();
  // The foot stands before the band is measured: the band ends above it.
  pageFooter.hidden = !reading;
  const pages = pagesNow();
  if (pages === null) {
    pageCurtain.hidden = true;
    pageHead.hidden = true;
    if (pageCount !== null) pageCount.hidden = true;
    if (pageLive !== null && pageLive.textContent !== "") pageLive.textContent = "";
    dressMarkPins();
    return;
  }
  const band = pageBand();
  // The head's curtain: from the window's top down to the first line's
  // stand, over the margin and the strip under the tab, where the page
  // before would otherwise show its tail. Drawn whatever the window's
  // position - a page shown off its top shows text there too.
  pageHead.hidden = false;
  pageHead.style.height = `${band.top}px`;
  const page = pageShown(pages);
  const top = pages.tops[page] ?? 0;
  // The curtain runs down to the window's foot, under the foot's strip or a
  // bar; what decides whether there is anything to cover is that edge, not
  // the page's bottom margin above it.
  const cover = onPage(window.scrollY, top, band.top)
    ? curtainTop(pages.tops, page, window.scrollY, band.floor)
    : null;
  pageCurtain.hidden = cover === null;
  if (cover !== null) pageCurtain.style.top = `${cover}px`;
  const count = pages.tops.length;
  const said = `${(page + 1).toLocaleString()} / ${count.toLocaleString()}`;
  if (pageFooter.textContent !== said) pageFooter.textContent = said;
  if (pageCount !== null) {
    pageCount.hidden = settings.reader.pageNumber;
    if (pageCount.textContent !== said) pageCount.textContent = said;
  }
  if (pageLive !== null) {
    // Written only on a change: a live region repeats whatever is written
    // into it, and the curtain is refreshed on every scroll.
    const spoken = t("reader_page_of", [(page + 1).toLocaleString(), count.toLocaleString()]);
    if (pageLive.textContent !== spoken) pageLive.textContent = spoken;
  }
  // The active mark's pins, on this page or not (D239).
  dressMarkPins();
}

/**
 * A click or a tap that found nothing to put away (`reading.js`): read by
 * pages, the outer thirds of the window turn the page - the way every
 * e-reader turns, and the way the pen's hand stays free, because with the
 * pen in the hand every tap is the marker's and never reaches here. Not
 * from a press on anything that answers presses itself - a button, a live
 * link, a pager, a bar, the chrome, the dimmed page under an open panel -
 * and not from the press that closed a panel or a footnote: a press that
 * found something to close has done its work.
 *
 * @param {number} x
 * @param {number} y
 * @param {EventTarget | null} target
 */
function onBareTap(x, y, target) {
  if (!paged() || markerOn || pressHadWork || roomShown !== null) return;
  if (
    target instanceof Element &&
    target.closest(
      "button, a[href], input, select, textarea, summary, dialog, .reader-chrome, .panel-scrim, .speech-bar, .mark-bar, .pager, .article-actions, .note-popover, #mark-note-badges",
    ) !== null
  ) {
    return;
  }
  const turn = tapZone(x, window.innerWidth);
  if (turn !== null) turnPage(turn);
}

/**
 * Whether the press now ending had something to close when it began: a
 * panel, a footnote, the active mark's toolbar. Read at `pointerdown`,
 * before the closers on the same event do their closing, and asked by the
 * bare tap at `mouseup`, by which time everything looks closed.
 */
let pressHadWork = false;

document.addEventListener(
  "pointerdown",
  () => {
    pressHadWork = anyPanelOpen() || noteMarkShown !== null || activeMark !== null;
  },
  { capture: true, passive: true },
);

/** When the wheel last turned a page - the cooldown's clock. */
let wheelTurnedAt = -Infinity;

// The wheel turns pages the way it scrolls: a notch on, a notch back, a
// flick one page and not a chapter (`wheelTurn`, with its cooldown). Not
// over the chrome or a dialog, whose own lists scroll under the wheel.
document.addEventListener(
  "wheel",
  (event) => {
    if (!paged() || roomShown !== null) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target !== null && target.closest(".reader-chrome, dialog, .speech-bar, .mark-bar, .note-popover") !== null) return;
    const now = performance.now();
    const turn = wheelTurn(
      { deltaX: event.deltaX, deltaY: event.deltaY, ctrl: event.ctrlKey },
      now,
      wheelTurnedAt,
    );
    if (turn === null) return;
    wheelTurnedAt = now;
    turnPage(turn);
  },
  { passive: true },
);

// A turn to the page under the fold or the curtain; the curtain follows
// every scroll (the bubble's, the browser's), so a page shown off its top
// never wears the wrong curtain - and once the scroll ends, a scroll that
// was not a turn squares with the page (`scrollend`: Gecko and Blink; an
// engine without it keeps the curtain right and squares on the next turn).
// On the document in the capture phase, for the reason the position save's
// listener gives: the clipped root hands Firefox's viewport scrolls to an
// element.
document.addEventListener("scroll", () => refreshCurtain(), { capture: true, passive: true });
document.addEventListener("scrollend", () => settlePage(), { capture: true, passive: true });

// The window resized, the browser's bar slid in or out (the visual
// viewport), a picture arrived, the type grew: the pages are cut again on
// the next ask - from the page being read (D238), so its first line stays
// - and the window squares with that page.
window.addEventListener("resize", () => settlePage());
window.visualViewport?.addEventListener("resize", () => settlePage());
new ResizeObserver(() => settlePage()).observe(document.body);
// A bar standing up or down at the foot - the voice's, the pen's - shortens
// or lengthens the band without touching the body's box: read by pages the
// body keeps its own screen of padding whatever stands at the foot, so the
// observer above never hears it, and the last line ran on under the pen's
// toolbar (Michał's smoke, 2026-09-17). The bars are watched themselves.
const barWatcher = new MutationObserver(() => settlePage());
for (const bar of [speechBar, markBar]) {
  if (bar !== null) barWatcher.observe(bar, { attributes: true, attributeFilter: ["hidden"] });
}

// A pointer down and up (D238): the pages are never cut again under a
// finger, and a cut asked for meanwhile - the pen's bar standing up from a
// stroke, the browser's bar sliding - lands on the lift. The window losing
// the pointer altogether counts as a lift, or a settle could wait forever.
document.addEventListener(
  "pointerdown",
  () => {
    pointerHeld = true;
  },
  { capture: true, passive: true },
);
function onPointerLift() {
  // A turn armed at the edge dies with the pointer (D239), whatever the
  // gesture said - the gesture's own end says it too, but a lift the
  // gesture never heard of must not leave a timer running.
  disarmEdge();
  if (!pointerHeld) return;
  pointerHeld = false;
  if (!settleWanted) return;
  settleWanted = false;
  settlePage();
}
document.addEventListener("pointerup", onPointerLift, { capture: true, passive: true });
document.addEventListener("pointercancel", onPointerLift, { capture: true, passive: true });
window.addEventListener("blur", onPointerLift);

/**
 * The page turned from the window's edge while a range is being stretched
 * (D239): a hold's drag, a handle's drag or the pen's stroke reaching the
 * foot of the page - the curtain, the margin, the foot's strip, a bar (the
 * pointer is captured, so the bar hears nothing) - or its head turns the
 * page under the finger, the way Kindle, Apple Books and KOReader turn
 * theirs, and the range grows onto the new page. The document is the
 * window's scroller (D233), so a range across the page's edge already
 * exists - the wheel proved it mid-drag; what was missing was the turn
 * inside the gesture. Nothing turns at once: a finger grazing the edge
 * to take the last line must not lose the page. Entering the zone draws
 * a line of ink on the band's edge (`#page-edge`) - the one still signal,
 * no animation, no countdown - and the first turn comes after a stay of
 * `EDGE_TURN_FIRST_MS`, the next ones every `EDGE_TURN_REPEAT_MS` while
 * the pointer stays (an e-ink panel needs the time to refresh, the eye to
 * find the new page); leaving the zone disarms it, and so does the lift.
 * In the zone the range's end sticks to the end of the page's last line
 * (`stretchPoint`), never to a word behind the curtain; after a turn the
 * pointer is still in the zone, so the whole new page joins the range,
 * and a finger moving back up shortens it to the word under it - "at the
 * edge I take whole pages, away from it I stop here", which is Kindle's
 * grammar. The part's last page has no zone at its foot and its first
 * none at its head: the range cannot leave the part, whose next page is
 * another document. The pages are never cut again meanwhile (`pointerHeld`).
 *
 * @type {{ zone: import("../lib/reader/pages.js").EdgeZone, x: number, y: number, enteredAt: number, turnedAt: number | null, timer: number } | null}
 */
let edgeStay = null;

/**
 * Where the page's last full line ends, window coordinates: the curtain's
 * edge while it is drawn, the band's foot otherwise (the part's last page,
 * or a page whose last line ends on the margin).
 *
 * @param {PageTable} pages
 * @param {number} page
 * @param {{ top: number, bottom: number, floor: number }} band
 * @returns {number}
 */
function lastLineEnd(pages, page, band) {
  const cover = onPage(window.scrollY, pages.tops[page] ?? 0, band.top)
    ? curtainTop(pages.tops, page, window.scrollY, band.floor)
    : null;
  return cover === null ? band.bottom : cover;
}

/**
 * The edge zone a pointer stands in, or null (`edgeZone`, pages.js).
 *
 * @param {number} y window coordinates
 * @returns {import("../lib/reader/pages.js").EdgeZone | null}
 */
function edgeZoneAt(y) {
  const pages = pagesNow();
  if (pages === null) return null;
  const page = pageShown(pages);
  const band = pageBand();
  const view = window.visualViewport;
  const bottom = view === null ? document.documentElement.clientHeight : view.offsetTop + view.height;
  return edgeZone(y, band.top, lastLineEnd(pages, page, band), bottom, {
    up: turnTarget(pages.tops, page, "up") !== null,
    down: turnTarget(pages.tops, page, "down") !== null,
  });
}

/**
 * The pointer moved while stretching a range (the gesture's `onStretch`):
 * in a zone the stay goes on or begins, out of one it ends.
 *
 * @param {number} x
 * @param {number} y
 */
function onStretch(x, y) {
  if (!paged()) return;
  const zone = edgeZoneAt(y);
  if (zone === null) {
    disarmEdge();
    return;
  }
  const stay = edgeStay;
  if (stay !== null && stay.zone === zone) {
    stay.x = x;
    stay.y = y;
    return;
  }
  disarmEdge();
  edgeStay = { zone, x, y, enteredAt: performance.now(), turnedAt: null, timer: 0 };
  showEdgeLine(zone);
  scheduleEdgeTurn();
}

/** The stay's next turn, on the clock `edgeTurn` keeps. */
function scheduleEdgeTurn() {
  const stay = edgeStay;
  if (stay === null) return;
  const due =
    stay.turnedAt === null ? stay.enteredAt + EDGE_TURN_FIRST_MS : stay.turnedAt + EDGE_TURN_REPEAT_MS;
  stay.timer = window.setTimeout(onEdgeDue, Math.max(0, due - performance.now()));
}

/**
 * The stay's clock rang: the turn, and the range grown onto the new page
 * in the same task (`showPageOf` reads the stretch again) - one refresh.
 * Still in the zone after the turn, unless the page turned to is the
 * part's end, where the zone is dead and the stay is over.
 */
function onEdgeDue() {
  const stay = edgeStay;
  if (stay === null) return;
  const now = performance.now();
  if (!edgeTurn(stay.zone, stay.enteredAt, stay.turnedAt, now)) {
    scheduleEdgeTurn();
    return;
  }
  turnPage(stay.zone);
  stay.turnedAt = now;
  if (edgeZoneAt(stay.y) !== stay.zone) {
    disarmEdge();
    return;
  }
  scheduleEdgeTurn();
}

/** The stay over: the clock stopped, the line gone. */
function disarmEdge() {
  const stay = edgeStay;
  if (stay === null) return;
  window.clearTimeout(stay.timer);
  edgeStay = null;
  if (pageEdge !== null) pageEdge.hidden = true;
}

/**
 * The line of ink on the edge the stay waits at: the foot's - the last
 * full line's end - or the head's, just above the first line.
 *
 * @param {import("../lib/reader/pages.js").EdgeZone} zone
 */
function showEdgeLine(zone) {
  if (pageEdge === null) return;
  const pages = pagesNow();
  if (pages === null) return;
  const band = pageBand();
  const y = zone === "down" ? lastLineEnd(pages, pageShown(pages), band) : band.top - 2;
  pageEdge.style.top = `${Math.round(y)}px`;
  pageEdge.hidden = false;
}

/**
 * Where a stretch is read while the pointer stands in an edge zone (the
 * gesture's `stretchPoint`): the end of the page's last full line for the
 * foot, the start of its first line for the head - the range grows to the
 * page's edge, never to a word behind the curtain. The pointer's own point
 * everywhere else. The line's end is at the column's far side, which is
 * the left one in a right-to-left text.
 *
 * @param {number} x
 * @param {number} y
 * @returns {{ x: number, y: number }}
 */
function stretchPoint(x, y) {
  if (!paged()) return { x, y };
  const zone = edgeZoneAt(y);
  if (zone === null) return { x, y };
  const pages = pagesNow();
  const column = (contentElement ?? pageMain)?.getBoundingClientRect();
  if (pages === null || column === undefined) return { x, y };
  const band = pageBand();
  const rtl = article !== null && getComputedStyle(article).direction === "rtl";
  const half = readingLine() / 2;
  if (zone === "down") {
    return { x: rtl ? column.left + 3 : column.right - 3, y: lastLineEnd(pages, pageShown(pages), band) - half };
  }
  return { x: rtl ? column.right - 3 : column.left + 3, y: band.top + half };
}

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
 * The bookmark tab offered only where the bar can fold: over a document. The
 * list always keeps its whole chrome (the stylesheet scopes the folding the
 * same way), so over it the ribbon would be a control with nothing to
 * control. The chevron's word and the ARIA state follow the stored choice.
 */
function updateChromeTab() {
  if (chromeTab === null) return;
  chromeTab.hidden = shown === null;
  const folded = settings.reader.chromeHidden;
  chromeTab.setAttribute("aria-expanded", String(!folded));
  const label = folded ? t("reader_bar_show") : t("reader_bar_hide");
  chromeTab.title = label;
  chromeTab.setAttribute("aria-label", label);
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
  // A mark under a handle drag is the wet stroke's to show (D181): its own
  // dried paint would stand over a shrink.
  const marks = reshaping === null ? docMarks : withoutMark(docMarks, reshaping);
  const healed = paintMarks(marks, shown === null ? null : contentRoot(), shownSegment());
  if (healed.length > 0) adoptHealedMarks(healed);
  // The badges stand on the painted ranges, so they follow every repaint.
  showNoteBadges();
}

/**
 * Marks the paint found again by their quotes (D169), adopted into the
 * document's list under the anchors they stand at now and written back - so
 * the next open finds them without a search, the highlights page's arrow
 * lands on them, and the copy in `storage.local` carries them healed. Quiet
 * on a failed write: the paint is right regardless, and the next paint
 * heals them again.
 *
 * @param {{ from: import("../lib/reader/marks.js").Mark, to: import("../lib/reader/marks.js").Mark }[]} healed
 */
function adoptHealedMarks(healed) {
  const target = shown;
  if (target === null) return;
  docMarks = docMarks.map((one) => healed.find((pair) => pair.from === one)?.to ?? one);
  const active = healed.find((pair) => pair.from === activeMark);
  if (active !== undefined) activeMark = active.to;
  void putMarks(target.url, docMarks).catch(() => undefined);
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
 * mark's own for a growth by its neighbour - and for a handle drag, whose
 * `reshaped` mark the span replaces whatever it covers (D181): its day and
 * its note ride into the record the way its ink does, and the old outline
 * is never unioned back in, or no mark could ever get shorter.
 *
 * @param {import("../lib/reader/marks.js").MarkSpan} span
 * @param {string} color
 * @param {import("../lib/reader/marks.js").Mark} [reshaped]
 */
async function commitSpan(span, color, reshaped) {
  const target = shown;
  const root = contentRoot();
  if (target === null || root === null) return;
  deselectMark();

  const plan = reshaped === undefined ? mergePlan(docMarks, span) : reshapePlan(docMarks, reshaped, span);
  const text = quoteOfSpan(plan.span, root);
  // A growth or a merge inherits every absorbed note (`mergedNote`): drawing
  // over an annotated mark grows the mark, and the words somebody wrote on
  // it must not be the price. The reshaped mark counts as absorbed, so its
  // own note rides the same way.
  const mark =
    text === null
      ? null
      : markRecord({
          ...plan.span,
          color,
          createdAt: reshaped === undefined ? Date.now() : reshaped.createdAt,
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
  // A tap on a pin's own drawing is the handle's and means nothing (D181):
  // a grab that never travelled must not put the pen down, and the pins are
  // transparent to the pointer, so the text under them would have answered.
  if (onPin(x, y, PIN_TAP_REACH)) return;
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
 * handles taught, and since D181 handles in fact: a press that travels
 * from one drags that end of the mark (`markHandleAt`). Page coordinates,
 * so they ride the scroll with their mark.
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
  dressMarkPins();
}

/**
 * The pins drawn only on the page shown (D239): a mark across the page's
 * edge has one end on another page, and its pin is simply not drawn - not
 * pulled to the edge, where it would say the mark ends there. The pins
 * ride the scroll in page coordinates (D181) and the curtains cover most
 * of a pin behind them, but a pin's dot stands above its stem and showed
 * in the leading over the curtain's edge. Asked again with the curtain, at
 * every turn and scroll; the scroll layout draws both pins always. Kept
 * apart from `hidden`, which says the pins are down altogether.
 */
function dressMarkPins() {
  if (markPinStart === null || markPinEnd === null || markPinStart.hidden) return;
  const pages = pagesNow();
  if (pages === null) {
    markPinStart.style.visibility = "";
    markPinEnd.style.visibility = "";
    return;
  }
  const band = pageBand();
  const foot = lastLineEnd(pages, pageShown(pages), band);
  for (const pin of [markPinStart, markPinEnd]) {
    const rect = pin.getBoundingClientRect();
    const shown = rect.top >= band.top - 1 && rect.bottom <= foot + 1;
    pin.style.visibility = shown ? "" : "hidden";
  }
}

/**
 * How far around a pin's stem a press still takes the pin for a drag: the
 * note badge's own reach (D118), a thumb's - one size on every device,
 * because the pointer media query lies on e-ink (D84). The named cost is
 * the badge's too: a drag begun on the mark's first or last word, or on
 * the strip of the lines above and below its ends, is the handle's. A tap
 * there still means the text - only a tap on the pin's own drawing
 * (`PIN_TAP_REACH`, the dot and a fingertip's slack) means nothing, so the
 * word beside the mark keeps its tap and the growth it asks for (D107).
 */
const PIN_DRAG_REACH = 20;
const PIN_TAP_REACH = 8;

/**
 * Which pin of the active mark a point lies on, if either, from `reach`
 * around its stem - null too while the pins are down: with no mark active,
 * or one the guard left unpainted, there is nothing to grab.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} reach
 * @returns {"start" | "end" | null}
 */
function pinAt(x, y, reach) {
  if (activeMark === null || markPinStart === null || markPinEnd === null || markPinStart.hidden) return null;
  return handleAt(x, y, markPinStart.getBoundingClientRect(), markPinEnd.getBoundingClientRect(), reach);
}

/**
 * @param {number} x
 * @param {number} y
 * @param {number} reach
 * @returns {boolean}
 */
function onPin(x, y, reach) {
  return pinAt(x, y, reach) !== null;
}

/**
 * Which pin of the active mark a press lands on, if either (D181) - the
 * gesture's question before it decides what a press on the article is.
 * Answered by geometry, the way underlines and marks are hit-tested: the
 * pins stay transparent to the pointer, so a tap on one keeps meaning what
 * a tap there means.
 *
 * @param {number} x
 * @param {number} y
 * @returns {{ edge: "start" | "end", range: Range } | null}
 */
function markHandleAt(x, y) {
  const active = activeMark;
  const edge = active === null ? null : pinAt(x, y, PIN_DRAG_REACH);
  const range = active === null || edge === null ? null : paintedRangeOf(active);
  return edge === null || range === null ? null : { edge, range };
}

/**
 * A handle's drag taking (D181): the mark's dried paint comes off - the wet
 * stroke stands in for it, and a shrink could not show through it - and
 * the stroke wears the mark's own ink rather than the pen's, because what
 * it will become is this mark. The pins stay up and ride the stroke
 * (`onMarkStretch`): the first cut took them down for the drag, and Michał
 * asked from Chrome whether showing them would not be better - it is, the
 * way every platform's handles stay under the finger and say where the
 * end will land before it lifts. The toolbar stays about the mark:
 * nothing about its ink, its note or its acts changes under a drag.
 */
function onMarkResizeStart() {
  const active = activeMark;
  if (active === null) return;
  reshaping = active;
  wearDraftInk(active.color);
  repaintMarks();
}

/**
 * The stroke of a handle's drag moved to another word (D181): the pins
 * follow it, the dragged one under the finger, the other standing where
 * the mark's far end stays. The wet stroke's range has the same shape the
 * paint's has - both edge characters on the inside - so the pins measure
 * it the way they measure a painted mark.
 *
 * @param {Range} range
 */
function onMarkStretch(range) {
  if (reshaping === null) return;
  placeMarkPins(range);
}

/**
 * A handle's drag ended (D181): the mark rewritten to the stroke's range,
 * its ink, its note and its day kept - a drag says "this far", it makes no
 * new mark - and whatever other mark the new outline reaches absorbed the
 * way a stroke absorbs it. A drag that came back to where it started
 * writes nothing, and a range that cannot anchor leaves the mark as it
 * was; either way the paint and the pins return.
 *
 * @param {Range} range
 */
async function onMarkResized(range) {
  const mark = reshaping;
  reshaping = null;
  wearDraftInk(settings.reader.markerColor);
  if (mark === null) return;
  const root = contentRoot();
  const span = root === null ? null : anchorOf(range, root, shownSegment());
  const unchanged =
    span !== null &&
    span.segmentIndex === mark.segmentIndex &&
    comparePoints(span.start, mark.start) === 0 &&
    comparePoints(span.end, mark.end) === 0;
  if (span === null || unchanged || !docMarks.includes(mark)) {
    repaintMarks();
    const painted = paintedRangeOf(mark);
    if (painted !== null && activeMark === mark) placeMarkPins(painted);
    return;
  }
  await commitSpan(span, mark.color, mark);
  // A commit that did not land - the quote refused, a write rolled back -
  // leaves the mark in the list, and the list is what gets painted.
  if (docMarks.includes(mark)) repaintMarks();
}

/**
 * The ink the wet stroke wears: an alias onto the chosen colour's own
 * per-theme variable, so the draft follows the pick and the theme alike -
 * the pen's ink while drawing (D106), the mark's own under a handle drag
 * (D181), because the preview is the result.
 *
 * @param {string} color
 */
function wearDraftInk(color) {
  document.documentElement.style.setProperty("--reader-marker-current", `var(--reader-marker-${color})`);
}

/**
 * The toolbar dressed for its state (D107): with a mark active the swatches
 * wear its ink and the copy and the bin stand ready; with none they speak
 * for the pen - the same setting the Aa panel writes - and the two acts
 * step away, having nothing to act on. The two page turns (D242) follow the
 * layout instead of the mark: they are the only way to turn a page with the
 * pen in the hand, and the scrolling layout needs none - a drag that never
 * held still scrolls the article there as it always did.
 */
function refreshMarkBar() {
  if (markBar === null) return;
  const turning = paged();
  if (markTurnPrev !== null) markTurnPrev.hidden = !turning;
  if (markTurnNext !== null) markTurnNext.hidden = !turning;
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
markCopyButton?.addEventListener("click", (event) => {
  releasePress(event);
  void onMarkCopyPress();
});
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

// The paint settled after every modal dialog on this page - the note, the
// contents, the search: a modal makes the rest of the document inert, and
// WebKit up to Safari 18 anchors every highlight in inert text to nothing,
// so the marks and the underlines step out from under the dialog and did not
// always step back when it closed (`refreshHighlights` has the story). Two
// frames rather than one: the close event's task can run before the
// rendering update that takes the dialog down, and the re-anchoring has to
// land in the first frame drawn without it.
for (const dialog of document.querySelectorAll("dialog")) {
  dialog.addEventListener("close", () => {
    requestAnimationFrame(() => requestAnimationFrame(() => refreshHighlights()));
  });
}

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

/**
 * A press on a button that acts and holds nothing, made with a finger or a
 * mouse: the focus stays on the button afterwards, and the bar's own rules
 * dress a focused button in a frame and a wash - which on this bar is what
 * the swatch beside it means by "chosen" (Michał's photo from the Boox,
 * 2026-09-18: the page turn read as pressed for good after every turn). The
 * button hands the focus back, so it goes straight back to its resting
 * look. A press made with the keyboard keeps it - `detail` counts a
 * pointer's clicks and is zero for Enter and Space - or the next Tab would
 * start again from the top of the page.
 *
 * Only for the acts that leave the bar standing as it was: the note opens a
 * dialog that wants the focus back when it closes, and the bin takes its own
 * button away with the mark.
 *
 * @param {MouseEvent} event
 */
function releasePress(event) {
  if (event.detail !== 0 && event.currentTarget instanceof HTMLElement) event.currentTarget.blur();
}

// The two page turns of the pen's toolbar (D242). The pen stays in the
// hand and the active mark stays active - a press inside this bar is not a
// press away (the rule below) - so a mark whose tail moved onto the next
// page when the bar stood up is reached by turning to it, marked, reshaped
// or deleted there, as it would be anywhere else on the page.
markTurnPrev?.addEventListener("click", (event) => {
  releasePress(event);
  turnPage("up");
});
markTurnNext?.addEventListener("click", (event) => {
  releasePress(event);
  turnPage("down");
});

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
  // The press this visit stands on: the stamp the declines of the default
  // keep are filed under (D124), so a reload finds them and a new press
  // does not.
  sourceAt = source?.at ?? 0;
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
  // The pictures too (D145): an article without any costs one range query,
  // and one that cannot read its pictures opens without them, as it would
  // have before they were saved.
  const [saved, position, marks, pictures] = await Promise.all([
    getArticle(url),
    getPosition(url),
    getMarks(url).catch(() => []),
    getPictures(url).catch(() => []),
  ]);
  if (turn !== epoch) return;
  if (saved === null) {
    // Gone under us - deleted from another reader tab. The list knows.
    await refreshLibrary();
    return;
  }
  const shownSet = shownPictureSet(pictures);
  renderSaved(saved, shownSet.resolve);
  shownPictures = shownSet.addresses;
  // A row from before the count (D226) gets it now, from the text the
  // render just counted for the header - behind the reading, never in its
  // way, and the row is what stops the next open from counting again.
  if (saved.words === undefined) void setWords(url, shownWords).catch(() => undefined);
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
 * is not a book - and none over a book of one part either (a Markdown text
 * that fit in one, a short EPUB; Michał's smoke, 2026-09-16): with no
 * neighbour to turn to, "Part 1 of 1" between two dead buttons said
 * nothing, and the contents stay a menu row away (D117).
 *
 * @param {{ index: number, count: number } | null} segment
 */
function showSegmentNav(segment) {
  const shown = segment !== null && segment.count > 1;
  for (const nav of segmentNavs) {
    if (nav !== null) nav.hidden = !shown;
  }
  if (segment === null || !shown) return;
  for (const label of segmentLabels) {
    if (label !== null) {
      label.textContent = t("reader_book_part_of", [
        (segment.index + 1).toLocaleString(),
        segment.count.toLocaleString(),
      ]);
    }
  }
  // A button with nowhere to go leaves the row rather than standing greyed
  // (Michał, 2026-09-16): "Previous" over the first part, "Next" under the
  // last. It keeps its slot (`.pager-blank`), so the label and the other
  // button do not move between two turns.
  for (const button of segmentPrevs) blankPager(button, segment.index <= 0);
  for (const button of segmentNexts) blankPager(button, segment.index >= segment.count - 1);
}

/**
 * @param {HTMLElement | null} button
 * @param {boolean} blank whether the button has nowhere to go
 */
function blankPager(button, blank) {
  if (!(button instanceof HTMLButtonElement)) return;
  button.disabled = blank;
  button.classList.toggle("pager-blank", blank);
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
    const line = textFold() + 2;
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
 * A book from before the count (D226) gets it now: every part read once,
 * behind the reading, and the sum written to the row - which is what stops
 * the next open from summing again. The parts are read one at a time, as
 * the TOC scan reads them, so a long book never stands whole in memory.
 *
 * @param {BookMeta} book
 * @returns {Promise<boolean>} whether the row was filled by this scan
 */
async function backfillWords(book) {
  if (wordScansRunning.has(book.id)) return false;
  wordScansRunning.add(book.id);
  try {
    let words = 0;
    for (let index = 0; index < book.segmentCount; index += 1) {
      const segment = await getBookSegment(book.id, index);
      // A torn part reads as absent; the row keeps the count of what is readable.
      if (segment !== null) words += wordsIn(segment.blocks.join(""));
    }
    return await setBookWords(book.id, words);
  } catch {
    // A closed database or a torn book: no count today, another try at the
    // next open.
    return false;
  } finally {
    wordScansRunning.delete(book.id);
  }
}

/**
 * A promise of the page's next quiet moment - or of the deadline, on a page
 * that never has one (`whenIdle`).
 *
 * @returns {Promise<void>}
 */
function quietMoment() {
  return new Promise((resolve) => whenIdle(() => resolve(), LENGTH_PASS_TIMEOUT));
}

/**
 * The rows from before the count (D226) filled behind the list, once: each
 * read in one of the page's quiet moments and written through the same
 * doors an open would use - an article's text counted as the header counts
 * it, a book's parts summed as its open sums them. The list is drawn first,
 * and from the light rows alone, as always; this is the one pass that reads
 * documents nobody opened, each once and never again once its row carries
 * the number (the row is what stops the next pass, on this page and in any
 * other tab - the writes take only a row without one). A row that will not
 * count is left as it is and not asked again on this page. When the pass
 * ends with something filled and the list still on screen, the list is
 * drawn again so the numbers show.
 *
 * Why not leave the old rows to their next open: the rows without a number
 * are exactly the texts nobody has opened yet - the ones a reader chooses
 * among by length (Michał's smoke of PR #391).
 *
 * @param {import("./list-view.js").LibraryEntry[]} entries the list as it
 *   was just drawn
 */
async function fillLengths(entries) {
  const owed = uncounted(entries, lengthsTried);
  if (owed.length === 0 || lengthPassRunning) return;
  lengthPassRunning = true;
  let filled = 0;
  try {
    for (const entry of owed) {
      lengthsTried.add(entry.url);
      // The list, or whatever somebody opened meanwhile, comes first.
      await quietMoment();
      try {
        if (entry.kind === "book") {
          const book = await getBook(entry.url);
          if (book !== null && book.words === undefined && (await backfillWords(book))) filled += 1;
        } else {
          const saved = await getArticle(entry.url);
          if (saved !== null && saved.words === undefined && (await setWords(entry.url, wordsIn(saved.content)))) {
            filled += 1;
          }
        }
      } catch {
        // A closed database or a torn row: the row stays as it is.
      }
    }
  } finally {
    lengthPassRunning = false;
  }
  if (filled > 0 && library !== null && !library.hidden) await refreshLibrary();
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
 * @param {MarkTarget | BlockTarget | SearchTarget | EndTarget} [target] a spot
 *   to land on instead of the reading position: a mark for the highlights
 *   page's press (D108), a block for a table-of-contents row (D116), a
 *   found phrase for a search row's (D119), the last page for a page turned
 *   back past a part's first (D233) - each asking for its own segment
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
  // This part's pictures and no other's (D183): a part without any costs
  // nothing, and one that cannot read its pictures opens without them.
  const pictures = await getBookPictures(id, segment.pictures ?? [], book.pictures ?? null).catch(
    () => [],
  );
  if (turn !== epoch) return;

  const shownSet = shownPictureSet(pictures);
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
    pictures: shownSet.resolve,
  });
  shownPictures = shownSet.addresses;
  showSegmentNav({ index, count: book.segmentCount });
  showBookNote(book);
  docToc = book.toc ?? [];
  updateTocButtons();
  // A row from before the TOC existed is owed its scan (D116) - behind the
  // reading, never in its way.
  if (book.toc === null) void backfillToc(book);
  // A book from before the count (D226) is owed its sum the same way.
  if (book.words === undefined) void backfillWords(book);
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
          : "end" in target
            ? landOnLastPage()
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
 * @typedef {{ segmentIndex: number, start: { block: number, offset: number }, text?: string }} MarkTarget
 */

/**
 * How a table-of-contents row names its chapter across the part turn (D116):
 * the block its heading stands in. The shape a mark's target takes when
 * there is no mark - just a place to land.
 *
 * @typedef {{ segmentIndex: number, block: number }} BlockTarget
 *
 * The last page of a part (D233): where a turn back from the first page of
 * the next one lands, read by pages. Never asked for by the scroll layout.
 *
 * @typedef {{ end: true }} EndTarget
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
  unregisterHighlight(SEARCH_WASH);
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
 * A refusal is said out loud (D151): the arrow promised a wash, and a reader
 * landing on plain prose has to hear why - the page's text no longer reads
 * the quote at its anchor, the way a page corrected since it was highlighted
 * does not (Michał's T625: a price changed under the quote). The notice
 * stands in the stuck chrome, so it is read here and not at a top of the
 * page the landing has just scrolled away from; it is raised before the
 * landing is measured, because `chromeFold` grows by its height. An engine
 * without the registry promised no wash and is told nothing.
 *
 * @param {MarkTarget} target
 * @returns {boolean}
 */
function scrollToTargetMark(target) {
  const mark =
    docMarks.find(
      (one) =>
        one.segmentIndex === target.segmentIndex && comparePoints(one.start, target.start) === 0,
    ) ??
    // A mark healed since its row was drawn (D169) stands at another anchor
    // now; its quote is the same, and the heal paints one quote of a segment
    // only where it stands once.
    docMarks.find(
      (one) =>
        target.text !== undefined &&
        one.segmentIndex === target.segmentIndex &&
        one.text === target.text,
    );
  if (mark === undefined) return false;
  const root = contentRoot();
  const range = paintedRangeOf(mark);
  if (range === null && root !== null && quoteOfSpan(mark, root) !== mark.text) {
    showNotice(t("reader_mark_text_changed"));
    offerMarkRemoval(mark);
  }
  const rect =
    range?.getClientRects()[0] ?? root?.children[mark.start.block]?.getBoundingClientRect();
  if (rect === undefined) return false;
  // The quote's first line under the stuck bar, the position restore's own
  // landing - plus a breath of air, so the wash reads as found, not clipped.
  landAt(rect.top + window.scrollY);
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
  landAt(rect.top + window.scrollY);
  return true;
}

/**
 * Every landing's last step: the named spot's line under the stuck bar with
 * a breath of air - or, read by pages (D233), the page that line stands on,
 * squared and curtained, because a page shown off its top is no page.
 *
 * @param {number} docY the spot, in document coordinates
 */
function landAt(docY) {
  if (landOnPageOf(docY)) return;
  scrollTo(0, Math.max(0, docY - chromeFold() - 8));
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
  // A save of pictures was pressed on the article leaving the screen, and
  // is stopped with it (D145); the pictures it showed are given back.
  if (picturesTask !== null) picturesTask.controller.abort();
  for (const address of shownPictures) URL.revokeObjectURL(address);
  shownPictures = [];
  // The article being read aloud is leaving the screen, and a voice reading a
  // page nobody can see is the extension talking to itself. A quote a row's
  // speaker was reading goes with it when the highlights page is the one
  // being left.
  forgetReading();
  stopMarkSpeech();
  updateListen();
  updateChromeTab();
  // An open footnote was about the text leaving the screen.
  hideNotePopover();
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
  // The menu's pictures row (D145) is the document's as well, and stands
  // outside the action rows like the bar's way back: over the list and the
  // highlights page there is nothing to download or remove (Michał's
  // report, 2026-09-05 - the row of the article just left stood over the
  // list, count and all).
  if (navPictures !== null) navPictures.hidden = true;
  if (navPicturesHint !== null) navPicturesHint.hidden = true;
  // The export rows (D229) are the document's too, and stand outside the
  // action rows for the same reason.
  if (navExportEpub !== null) navExportEpub.hidden = true;
  if (navExportMarkdown !== null) navExportMarkdown.hidden = true;
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
  // The curtain and the page count were the document's (D233); over a list
  // there are no pages, and the window scrolls as it always did.
  refreshCurtain();
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
  // A report of the last visit's export is that visit's; the lines start
  // clear, the transfer sections' way - and a file offered on the last
  // visit is not offered on this one.
  marksNotesStatus("");
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
  // Whatever the browser deleted comes back from its copies before the list
  // reads - the highlights first (`marks-backup.js`, whose rule wants an
  // empty library), then the reading list itself where its copy is on
  // (`library-copy.js`). Five counts on every ordinary refresh - and, once
  // per page, the copy completed with whatever the library holds that the
  // copy does not (D146): a reading list saved while the copy was off, or
  // before it was on by default.
  await restoreMarks();
  await restoreLibrary();
  await completeLibraryCopy();
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
  // The selection held to the list as it stands (D152), and what this read
  // found kept for the ticks that follow it.
  picked = keptPicks(picked, entries);
  libraryShown = { selectable: view.selectable, metas, bookRows: books };

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
        updateSearchControls();
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
  renderPickLine();
  renderLibraryPager(view);
  applyLibrarySearchVisibility();
  // The rows from before the count (D226), filled behind the list once it
  // stands - never before: the list is drawn from the light rows alone.
  void fillLengths(entries);
}

/**
 * The selection's furniture drawn from what is held (D152): the Select
 * button, or in its place the bar - the Select all box in one of its three
 * states over the rows it covers, and the count of everything ticked - and
 * the export buttons under the list, which say what they will take. Called
 * by the refresh and by every tick; no store is read here.
 */
function renderPickLine() {
  if (libraryPickToggle !== null) {
    // The bar stands where the button stood; nothing to choose from greys
    // the button, the way Export greys over an empty list.
    libraryPickToggle.hidden = picking;
    libraryPickToggle.disabled = libraryShown.metas.length === 0;
  }
  if (libraryPickLine !== null) libraryPickLine.hidden = !picking;
  if (libraryPickAll !== null) {
    const state = pickedState(libraryShown.selectable, picked);
    libraryPickAll.checked = state === "all";
    libraryPickAll.indeterminate = state === "some";
    libraryPickAll.disabled = libraryShown.selectable.length === 0;
  }
  if (libraryPickCount !== null) {
    libraryPickCount.textContent = plural(picked.size, "reader_pick_count");
  }
  renderExportControls();
}

/**
 * The Export button and the boxes under the list, over what they will
 * take: the whole list, or - inside the selection (D152) - the ticked
 * documents, articles and books alike (D218), which the button then
 * counts in its own words.
 *
 * Exporting nothing would download an empty file; the button says so
 * first. The pictures kept with articles (D145) ride in the file only
 * when asked: the row stands while some article going has any, and says
 * how many and what they take - the size the file will grow by, before
 * the press. A ticked book goes with its pictures whatever the box says:
 * they are the book's own, out of its .epub, and cannot be downloaded
 * again the way an article's can.
 */
function renderExportControls() {
  const { metas } = libraryShown;
  const going = picking ? metas.filter((meta) => picked.has(meta.url)) : metas;
  if (exportButton !== null) {
    // Outside the selection the export is the backup of everything (D213),
    // which always has something to write - the settings at the least.
    exportButton.disabled = picking && picked.size === 0;
    exportButton.textContent = picking
      ? t("reader_export_selected", picked.size.toLocaleString())
      : t("action_export");
  }
  // The selection's own two buttons (D229): every ticked document as a
  // file of its own - the book file, or the text page - counted like the
  // Export button; greyed with nothing ticked, and while files are being
  // written. Outside the selection they hide: the whole list as separate
  // files is nobody's ask, and the backup is one file.
  if (exportEpubButton !== null) {
    exportEpubButton.hidden = !picking;
    exportEpubButton.disabled = picked.size === 0 || documentExport;
    exportEpubButton.textContent = t("reader_export_epub_selected", picked.size.toLocaleString());
  }
  if (exportMarkdownButton !== null) {
    exportMarkdownButton.hidden = !picking;
    exportMarkdownButton.disabled = picked.size === 0 || documentExport;
    exportMarkdownButton.textContent = t("reader_export_markdown_selected", picked.size.toLocaleString());
  }
  const kept = going.reduce(
    (sum, meta) =>
      meta.pictures === undefined
        ? sum
        : { count: sum.count + meta.pictures.count, bytes: sum.bytes + meta.pictures.bytes },
    { count: 0, bytes: 0 },
  );
  if (exportPicturesRow !== null) exportPicturesRow.hidden = kept.count === 0;
  if (exportPicturesLabel !== null) {
    // The count with its unit, a middle dot, the size: two bare numbers
    // in one bracket read as one number (Michał, 2026-09-13).
    exportPicturesLabel.textContent = plural(kept.count, "reader_export_pictures", [megabytes(kept.bytes)]);
  }
  // The books' box (D218): outside the selection alone - inside it the
  // ticks decide which books go - and only while there is a book to
  // offer. The label counts them and what they take, text and pictures,
  // off the light rows.
  const shelf = booksAccount(libraryShown.bookRows);
  if (exportBooksRow !== null) exportBooksRow.hidden = picking || shelf.count === 0;
  if (exportBooksLabel !== null) {
    exportBooksLabel.textContent = plural(shelf.count, "reader_export_books", [megabytes(shelf.bytes)]);
  }
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
    // The selection's door and line (D152) go with the rows: the results
    // wear no boxes, and a mode with nothing to tick would only confuse.
    // Whatever is ticked already waits for the rows to come back.
    const plain = [
      librarySegments,
      libraryCount,
      libraryEmpty,
      libraryRows,
      libraryPager,
      libraryPickToggle,
      libraryPickLine,
    ];
    for (const element of plain) {
      if (element !== null) element.hidden = true;
    }
  } else {
    if (librarySegments !== null) librarySegments.hidden = false;
    if (libraryRows !== null) libraryRows.hidden = false;
    // The button comes back only outside the mode: inside it the bar has
    // its place, and the refresh has just said which of the two stands.
    if (libraryPickToggle !== null) libraryPickToggle.hidden = picking;
  }
  if (librarySearchSection !== null) librarySearchSection.hidden = !on;
}

/**
 * The Search button beside the field (D173): always there, since nothing
 * narrows the list without a press; greyed while a press would do nothing,
 * lit while the list stands behind the field's words - the cue that a press
 * is wanted. The rule itself lives in `list-view.js`, under test.
 */
function updateSearchControls() {
  if (librarySearchGo === null || librarySearchToggle === null) return;
  const { enabled, stale } = searchButtonState({
    query: libraryFilter?.value ?? "",
    applied: libraryQuery,
    texts: librarySearchToggle.checked,
  });
  librarySearchGo.disabled = !enabled;
  if (stale) librarySearchGo.setAttribute("data-stale", "");
  else librarySearchGo.removeAttribute("data-stale");
}

/**
 * One press on Search, however it came - the button, Enter in the box, or
 * the box ticked over a phrase (D173): the field's words become the list's,
 * over the titles and sites alone or over the saved texts too.
 */
async function pressLibrarySearch() {
  const query = libraryFilter?.value ?? "";
  if (librarySearchToggle?.checked === true) {
    if (!isSearchableQuery(query)) return;
    // The plain list under the results narrows to the same words, so
    // unticking the box lands on the titles' answer to the same question.
    libraryQuery = query;
    libraryPage = 1;
    await startLibrarySearch(query);
    applyLibrarySearchVisibility();
  } else {
    if (query.trim().length === 0) return;
    if (librarySearchShown()) dismissLibrarySearch();
    libraryQuery = query;
    // A new question starts at the beginning - the clamp would only catch
    // a page that no longer exists.
    libraryPage = 1;
    await refreshLibrary();
  }
  updateSearchControls();
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
 * Inside the selection (D152) the row is a box and its label instead: the
 * title, stretched over the same cell, ticks the box - the whole row is the
 * target, which a finger needs more than a box does - and Delete steps
 * away with the act it served. A book's row wears the box like an
 * article's since D218: the selection's file carries both.
 *
 * @param {import("./list-view.js").LibraryEntry} entry
 */
function libraryRow(entry) {
  const item = document.createElement("li");
  item.className = "library-row";

  const text = document.createElement("div");
  text.className = "library-text";

  if (picking) {
    item.classList.add("library-row-pick");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "library-pick";
    box.id = `library-pick-${pickBoxes++}`;
    box.setAttribute("data-url", entry.url);
    box.checked = picked.has(entry.url);
    const label = document.createElement("label");
    label.className = "library-open";
    label.htmlFor = box.id;
    label.textContent = entry.title;
    text.append(label, detailLine(entry));
    item.append(box, text);
    return item;
  }

  const open = document.createElement("button");
  open.type = "button";
  open.className = "library-open";
  open.setAttribute("data-url", entry.url);
  open.setAttribute("data-kind", entry.kind);
  open.textContent = entry.title;

  text.append(open, detailLine(entry));

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
 * Ids for the boxes of the selection (D152), one per rendered row and never
 * reused: a label finds its box by id, and the rows are rebuilt on every
 * refresh.
 */
let pickBoxes = 0;

/**
 * The line under a row's title: where it came from and when, what it
 * costs in pictures, how far in the reading is.
 *
 * @param {import("./list-view.js").LibraryEntry} entry
 */
function detailLine(entry) {
  const detail = document.createElement("span");
  detail.className = "library-item-detail";
  // How far in the reading is, said only where it says anything: on an
  // unread row that was actually started. A read row's mark has said more,
  // and "0% read" on a row never opened is noise dressed as a number.
  const percent =
    entry.readAt === null && entry.percentRead !== null && entry.percentRead > 0
      ? t("reader_percent_read", entry.percentRead.toLocaleString())
      : "";
  // The pictures kept with the document and what they take (D145, D183) -
  // the one place the space a document costs is said before it is opened.
  const pictures =
    entry.pictures === undefined
      ? ""
      : plural(entry.pictures.count, "library_pictures", [megabytes(entry.pictures.bytes)]);
  // How long the text is (D226): its words and about how many minutes they
  // take, on a row that has been counted - a row from before the count says
  // nothing until its next open fills it, and a text of pictures alone says
  // nothing rather than "0 words".
  const length =
    entry.words === undefined || entry.words === 0
      ? ""
      : `${plural(entry.words, "reader_words")} · ${timeLabel(entry.words)}`;
  if (entry.kind === "book") {
    const progress =
      entry.progress === null
        ? ""
        : t("reader_book_part_of", [
            entry.progress.at.toLocaleString(),
            entry.progress.of.toLocaleString(),
          ]);
    detail.textContent = [entry.hostname, t("reader_book_label"), progress, length, pictures, percent]
      .filter((part) => part.length > 0)
      .join(" - ");
  } else {
    const when = entry.savedAt > 0 ? new Date(entry.savedAt).toLocaleDateString() : "";
    detail.textContent = [entry.hostname, when, length, pictures, percent]
      .filter((part) => part.length > 0)
      .join(" - ");
  }
  return detail;
}

/**
 * The highlights page filled from the stores (D108) - the same three reads
 * the export makes: the marks, and the two lists that dress them in titles.
 * No document's content is ever opened for this; the quotes already live in
 * the marks' own rows. The rules of what shows are `marks-list.js`'s.
 */
async function refreshMarks() {
  if (marksRowsList === null || marksEmpty === null) return;
  // Whatever the browser deleted comes back from its copy before the page
  // reads; the copy is read too, for the titles of the documents that are
  // gone (`marks-backup.js`).
  await restoreMarks();
  const [metas, books, marks, backup] = await Promise.all([
    listArticles(),
    listBooks(),
    allMarks().catch(() => new Map()),
    readMarksBackup(),
  ]);
  const target = marksShown;
  // The view moved on while the database answered; the section is hidden,
  // and filling it would only shout into a closed room.
  if (target === null) return;
  const kept = keptTitles(backup);
  const rows = markRows(metas, books, marks, kept);
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

  // The heading says which page this is (Michał's smoke, 2026-08-29): every
  // document's quotes, or one article's or one book's - the title line under
  // it then names the one. A scope nobody can name any more reads as an
  // article, the kind an address is.
  const scopeKind =
    target.scope === null
      ? null
      : metas.some((meta) => meta.url === target.scope)
        ? "article"
        : books.some((book) => book.id === target.scope)
          ? "book"
          : (kept.get(target.scope)?.kind ?? "article");
  const heading =
    scopeKind === null
      ? t("reader_marks_title_all")
      : scopeKind === "book"
        ? t("reader_marks_title_book")
        : t("reader_marks_title_article");
  if (marksTitle !== null) marksTitle.textContent = heading;
  document.title = `${heading} - re/read`;

  // Exporting nothing would download an empty file; the button says so
  // first - the transfer section's own rule, over this page's scope. The
  // link over the rows leads down to the button (D152/D153) - a long list
  // puts it a page away - and stands only while there is something to
  // write.
  if (marksExportButton !== null) marksExportButton.disabled = view.total === 0;
  if (marksTransferLink !== null) marksTransferLink.hidden = view.total === 0;

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
 * at the mark, the speaker that reads the quote aloud, the copy, the note
 * and the trash. The
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
  // A quote whose document is gone says so under its detail line - it came
  // back from the copy, and it has nowhere to open until the same address
  // is saved again (`marks-backup.js`). The document-wide deletion (D150)
  // stands in that very sentence, where the document is named and counted:
  // a quiet text act, because "all" is a scope only words can carry - and
  // only where there is more than the one quote the row's own trash takes.
  if (row.missing) {
    const missing = document.createElement("p");
    missing.className = "marks-missing";
    missing.textContent = t("reader_marks_missing_doc");
    if (row.count > 1) {
      const all = document.createElement("button");
      all.type = "button";
      all.className = "marks-delete-all";
      all.setAttribute("data-act", "delete-all");
      all.setAttribute("data-row", String(index));
      all.setAttribute("data-title", row.title);
      // Its own words kept aside, for the way back from "Sure?".
      const label = plural(row.count, "reader_marks_delete_all");
      all.setAttribute("data-label", label);
      all.textContent = label;
      missing.append(" ", all);
    }
    text.append(missing);
  }

  const acts = document.createElement("span");
  acts.className = "marks-row-acts";
  if (!row.missing) {
    acts.append(markActButton("open", index, t("reader_marks_open", row.title), marksOpenIcon));
  } else if (row.kind === "article" && webAddress(row.docId)) {
    // Where the arrow would stand: the original page, the one door a quote
    // whose document is gone still has (D150) - exactly what the note under
    // it asks for. A real link, so the browser's own gestures (a middle
    // click, "copy link") work and no permission is asked; opening it does
    // not save the page by itself - the toolbar button does that, and the
    // first save adopts the quotes (`articles.js`).
    acts.append(markOriginalLink(row.docId));
  }
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
  // The row's own trash, last, after everything that keeps the quote. D150
  // gave it to the orphan rows alone - a quote with a document is taken out
  // in the document, over the mark itself, where what goes is in sight - and
  // D151 to every row: a mark the guard refused to paint has no wash there
  // to tap, and this row is its one way down (Michał's remark after T625).
  // Armed like the list's Delete: the first press asks, the second answers,
  // on the same spot.
  const trash = markActButton("delete", index, t("marker_delete"), marksDeleteIcon);
  trash.setAttribute("data-title", row.title);
  acts.append(trash);

  item.append(text, acts);
  return item;
}

/**
 * The orphan row's door to its page (D150): an anchor dressed as the acts'
 * quiet icon button, so it stands in the column where the arrow would.
 *
 * @param {string} url
 * @returns {HTMLAnchorElement}
 */
function markOriginalLink(url) {
  const link = document.createElement("a");
  link.className = "marks-act marks-original";
  link.href = url;
  link.target = "_blank";
  link.rel = "noreferrer noopener";
  link.title = t("reader_open_original");
  link.setAttribute("aria-label", t("reader_open_original"));
  if (marksOriginalIcon !== null) link.append(marksOriginalIcon.content.cloneNode(true));
  return link;
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
  // The quote rides along for a mark the paint heals on the way (D169): its
  // anchor moves, its words do not.
  const target = { segmentIndex: row.mark.segmentIndex, start: row.mark.start, text: row.mark.text };
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
 * The confirmed press on a quote whose document is gone (D150): this one
 * quote, or every quote of its document, out of the marks store. The store
 * is read fresh rather than trusted from the screen - another tab may have
 * moved it - and matched by position, the row's own key, because the
 * objects on screen are not the store's. With the write the copy is rebuilt
 * (`putMarks`), so a document whose last quote goes leaves the copy too,
 * title and all: nothing is left to come back. The page redraws from the
 * database, and focus lands on the next trash the way the list's Delete
 * hands it on - or on the filter when none is left.
 *
 * @param {HTMLButtonElement} button the armed act that was pressed
 * @param {import("./marks-list.js").MarkRow} row
 * @param {boolean} whole every quote of the document rather than this one
 */
async function deleteMarkRow(button, row, whole) {
  const trashes = () =>
    marksRowsList === null
      ? []
      : [...marksRowsList.querySelectorAll("button[data-act='delete']")];
  const at = Math.max(0, trashes().indexOf(button));

  try {
    const standing = await getMarks(row.docId);
    const kept = whole ? [] : standing.filter((one) => compareMarks(one, row.mark) !== 0);
    if (kept.length !== standing.length || whole) await putMarks(row.docId, kept);
  } catch {
    showNotice(t("reader_list_write_failed"));
  }
  await refreshMarks();

  const successor = trashes()[Math.min(at, trashes().length - 1)];
  if (successor instanceof HTMLButtonElement) successor.focus();
  else marksFilter?.focus();
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
async function speakMarkRow(row) {
  const key = markRowKey(row);
  if (speaking() && soundingMark === key) {
    stopTts();
    soundingMark = null;
    return;
  }
  soundingMark = key;
  // The row's own language first; with none and no pair, the empty tag reads
  // in the device's default offline voice - `speechLang`'s manner.
  const lang = row.lang ?? settings.sourceLang ?? "";
  const spoke = await speak(
    row.mark.text,
    lang,
    settings.ttsVoices[primaryLanguage(lang)],
    settings.ttsRate / 100,
  );
  // Refused for want of an offline voice (D155): the row's speaker has no bar
  // of its own to say so, so the page's notice line does.
  if (!spoke) {
    soundingMark = null;
    showNotice(t("speech_no_offline_voice"));
  }
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
  if (button === removeButton || button === removeEndButton) return titleElement?.textContent ?? "";
  // A quote row's acts carry their document's title themselves (D150): the
  // row names it in a detail line, not in a button of its own.
  const own = button.getAttribute("data-title");
  if (own !== null) return own;
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
  // A quote row's two acts (D150) stand down to what they were: the trash to
  // its glyph, the document-wide act to its own counted words.
  const act = armed.getAttribute("data-act");
  if (act === "delete") {
    armed.replaceChildren();
    if (marksDeleteIcon !== null) armed.append(marksDeleteIcon.content.cloneNode(true));
    armed.title = t("marker_delete");
    armed.setAttribute("aria-label", t("marker_delete"));
    return;
  }
  // The notice's act (D151) stands down the same road: its own words are
  // in `data-label` too.
  if (act === "delete-all" || act === "remove-mark") {
    const label = armed.getAttribute("data-label") ?? "";
    armed.style.removeProperty("min-width");
    armed.textContent = label;
    armed.setAttribute("aria-label", label);
    return;
  }
  // Every other Delete stands down to the same pair of words - the bare verb
  // to see, the act with its title to hear; only the held width was the
  // article buttons' own.
  if (armed === removeButton || armed === removeEndButton) armed.style.removeProperty("min-width");
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
    // This tab may be the live page's own: Back onto it must not keep it again.
    if (kind !== "book") setKeepDeclined(url, true);
  } catch {
    showNotice(t("reader_list_write_failed"));
  }
  await refreshLibrary();

  const successor = deletes()[Math.min(at, deletes().length - 1)];
  if (successor instanceof HTMLButtonElement) successor.focus();
  else libraryFilter?.focus();
}

/**
 * The export: inside the selection (D152) the ticked articles as the list's
 * own file - a file to hand somebody; otherwise the backup of everything
 * (D213): the whole list with its highlights and reading positions (and
 * its pictures when the box is ticked), every saved phrase of every pair
 * with its sentence and counts, every document's highlights - books' too -
 * the settings, and the books themselves when their box is ticked (D218),
 * in one archive. Fresh from the databases rather than from the rows on
 * screen, because the screen shows one segment and a backup is
 * everything. Packed as a stream, each article's pictures and each book
 * read when its turn comes. Downloading is a blob and an anchor; no
 * permission asks for less.
 */
async function exportList() {
  try {
    if (picking) {
      await exportSelection();
      return;
    }
    const [articles, marks, positions, phrases, docs, config, shelf] = await Promise.all([
      allArticles(),
      allMarks(),
      allPositions(),
      allPhrases(),
      marksDocs(() => true),
      readConfig(),
      listBooks(),
    ]);
    const withPictures = exportPictures !== null && !exportPicturesRow?.hidden && exportPictures.checked;
    // The books only when their box says so (D218): unticked, the backup
    // is the light file it was, and a book's backup is its .epub.
    const withBooks = exportBooks !== null && !exportBooksRow?.hidden && exportBooks.checked;
    const books = withBooks ? shelf : [];
    const archive = await packArchive(
      backupStream({
        app: webext().runtime.getManifest().version,
        now: Date.now(),
        articles,
        marks,
        pictures: withPictures,
        positions,
        phrases,
        highlights: docs.map(copyDocOf),
        settings: config,
        books,
      }),
    );
    const size = downloadFile(archive, BACKUP_FILENAME, "application/zip");
    // What the file holds, said where the press was (D153): each count in
    // its own words and the settings as a word - a download is a quiet
    // thing, and this one is the whole of somebody's reading. The books
    // only when they went in: "0 books" would say the file leaves them
    // out, which the list's own point says already.
    const highlights = docs.reduce((sum, doc) => sum + doc.marks.length, 0);
    const parts = [
      plural(articles.length, "reader_backup_articles"),
      ...(withBooks ? [plural(books.length, "reader_backup_books")] : []),
      plural(phrases.length, "phrases"),
      plural(highlights, "reader_backup_highlights"),
      t("reader_backup_settings_word"),
    ];
    transferStatus(t("reader_backup_done", [BACKUP_FILENAME, fileSize(size), parts.join(", ")]));
  } catch {
    transferStatus(describeError(ErrorCode.INTERNAL), "error");
  }
}

/**
 * The entries of the backup, one at a time (D218, D222): the manifest and
 * the light parts first, as `backupEntries` writes them; then, when the
 * box says so, each article's pictures - its rows read from the store
 * only when its turn comes, in the file's order, so that a library of
 * pictures never stands in memory whole beside its own archive - and
 * `articles.json` after them, carrying their names; then every book
 * asked for - its text read the same way, its pictures after it - and
 * the books' index last, once every book's pictures have entries to be
 * referred to. The order inside the archive is nobody's concern: an
 * import reads entries by name. A book whose text is not all there is
 * left out - a row over parts that are not there would be a book nobody
 * could open.
 *
 * @param {import("../lib/store/backup-file.js").BackupInput & {
 *   books: import("../lib/store/book.js").BookMeta[],
 * }} input
 * @returns {AsyncGenerator<import("../lib/store/articles-archive.js").ArchiveEntry>}
 */
async function* backupStream(input) {
  yield* backupEntries(input);
  const articles = fileOrder(input.articles);
  /** @type {Map<string, import("../lib/store/articles-archive.js").PictureRef[]>} */
  const refs = new Map();
  if (input.pictures) {
    for (const [at, article] of articles.entries()) {
      // Only the articles whose row says there are any: the row is the
      // account, and the rows come back from the copy where the database
      // has lost them.
      if (article.pictures === undefined) continue;
      const kept = pictureEntries(at, await getPictures(article.url));
      if (kept.refs.length === 0) continue;
      yield* kept.entries;
      refs.set(article.url, kept.refs);
    }
  }
  yield articlesEntry(articles, input.marks, input.positions, refs);
  if (input.books.length === 0) return;
  /** @type {Parameters<typeof toBooksIndex>[0]} */
  const index = [];
  for (const book of input.books) {
    const segments = await allBookSegments(book);
    if (segments === null) continue;
    const at = index.length;
    yield { name: bookTextEntryName(book.id), data: new TextEncoder().encode(toBookText(book.id, segments)), deflate: true };
    /** @type {import("../lib/store/articles-archive.js").PictureRef[]} */
    const refs = [];
    for (const picture of await allBookPictures(book)) {
      const file = bookPictureEntryName(at, picture);
      yield { name: file, data: new Uint8Array(picture.data), deflate: false };
      refs.push({
        index: picture.index,
        file,
        src: picture.src,
        mime: picture.mime,
        width: picture.width,
        height: picture.height,
      });
    }
    const position = input.positions.get(book.id);
    index.push({ meta: book, ...(position === undefined ? {} : { position }), pictures: refs });
  }
  yield { name: BOOKS_ENTRY, data: new TextEncoder().encode(toBooksIndex(index)), deflate: true };
}

/**
 * The ticked documents as a file to hand somebody (D152) - since D218 the
 * backup's own format cut to the selection: the ticked articles with
 * their highlights and reading positions (and their pictures when the box
 * is ticked), the ticked books whole - text, pictures, position - and
 * the highlights of both; neither the vocabulary nor the settings, which
 * are nobody's to hand on. Written by the same stream, read back by the
 * same import, under a name that says what it is. A row torn or gone
 * since its tick is left out, the reading `getArticle` gives one. The
 * export says what it wrote (D153) in the section's own line.
 */
async function exportSelection() {
  const [shelf, marks, positions, docs] = await Promise.all([
    listBooks(),
    allMarks(),
    allPositions(),
    marksDocs((docId) => picked.has(docId)),
  ]);
  const books = shelf.filter((book) => picked.has(book.id));
  const ids = new Set(shelf.map((book) => book.id));
  const read = await Promise.all([...picked].filter((url) => !ids.has(url)).map((url) => getArticle(url)));
  const articles = read.filter((article) => article !== null);
  if (articles.length === 0 && books.length === 0) return;
  const withPictures = exportPictures !== null && !exportPicturesRow?.hidden && exportPictures.checked;
  const archive = await packArchive(
    backupStream({
      app: webext().runtime.getManifest().version,
      now: Date.now(),
      articles,
      marks,
      pictures: withPictures,
      positions,
      phrases: [],
      highlights: docs.map(copyDocOf),
      settings: null,
      books,
      selection: true,
    }),
  );
  const size = downloadFile(archive, SELECTION_FILENAME, "application/zip");
  transferStatus(plural(articles.length + books.length, "reader_export_done", [SELECTION_FILENAME, fileSize(size)]));
}

/**
 * The selection's documents each as a file of its own (D229): the ticked
 * articles and books written one by one as the format's file - a book
 * file or a text page - and each handed to the browser as a download; the
 * line under the buttons counts what was written and what could not be
 * (a book whose text is torn, a row gone since its tick). One at a time
 * on purpose: a document's whole text and pictures stand in memory while
 * its file is written, the bargain every export here keeps. Which kind a
 * ticked key is - an article's address or a book's id - the shelf says.
 *
 * @param {import("./export-doc.js").ExportFormat} format
 */
async function exportPickedDocuments(format) {
  if (documentExport || picked.size === 0) return;
  documentExport = true;
  renderExportControls();
  let exported = 0;
  let failed = 0;
  let bytes = 0;
  try {
    const shelf = await listBooks();
    const ids = new Set(shelf.map((book) => book.id));
    for (const key of [...picked]) {
      try {
        const file = await exportDocument(ids.has(key) ? "book" : "article", key, format);
        if (file === null) {
          failed += 1;
          continue;
        }
        bytes += downloadFile(file.content, file.filename, file.type);
        exported += 1;
      } catch {
        failed += 1;
      }
    }
  } finally {
    documentExport = false;
    renderExportControls();
  }
  if (exported === 0) {
    transferStatus(t("reader_export_doc_failed"), "error");
    return;
  }
  const sentences = [plural(exported, "reader_export_files_done", [fileSize(bytes)])];
  if (failed > 0) sentences.push(plural(failed, "reader_export_files_failed"));
  transferStatus(sentences.join(" "));
}

/**
 * One document of the highlights as the lists know it - its kind and key,
 * its title, a book's author, the day it entered - and its marks: the input
 * of both files the page writes, cut to the documents `wanted` says yes to:
 * one, when the page asking is scoped (D108); everybody's otherwise. The
 * quotes are already in the marks' own rows, so no document's content is
 * ever opened for this.
 *
 * @typedef {{
 *   docId: string,
 *   kind: "article" | "book",
 *   title: string,
 *   author: string | null,
 *   at: number,
 *   marks: import("../lib/reader/marks.js").Mark[],
 * }} MarksDoc
 */

/**
 * @param {(docId: string) => boolean} wanted
 * @returns {Promise<MarksDoc[]>}
 */
async function marksDocs(wanted) {
  const [metas, books, marks, backup] = await Promise.all([
    listArticles(),
    listBooks(),
    allMarks(),
    readMarksBackup(),
  ]);

  /** @type {MarksDoc[]} */
  const docs = [];
  for (const meta of metas) {
    const kept = marks.get(meta.url);
    if (kept !== undefined && wanted(meta.url)) {
      docs.push({
        docId: meta.url,
        kind: "article",
        title: meta.title,
        author: null,
        at: meta.savedAt,
        marks: kept,
      });
    }
  }
  for (const book of books) {
    const kept = marks.get(book.id);
    if (kept !== undefined && wanted(book.id)) {
      docs.push({
        docId: book.id,
        kind: "book",
        title: book.title,
        author: book.author,
        at: book.addedAt,
        marks: kept,
      });
    }
  }
  // The quotes whose documents are gone, under the titles the copy kept
  // (`marks-backup.js`): the files are the one place they can still be taken
  // from whole, and a quote is no less the reader's for having lost its page.
  const named = new Set([...metas.map((meta) => meta.url), ...books.map((book) => book.id)]);
  for (const [docId, remembered] of keptTitles(backup)) {
    const kept = marks.get(docId);
    if (kept === undefined || named.has(docId) || !wanted(docId)) continue;
    docs.push({ docId, kind: remembered.kind, title: remembered.title, author: null, at: 0, marks: kept });
  }
  return docs;
}

/**
 * A document as the notes file wants it: its source is an article's address
 * or a book's author, whichever it has.
 *
 * @param {MarksDoc} doc
 * @returns {import("../lib/store/marks-file.js").MarkedDoc}
 */
function notesDocOf(doc) {
  return {
    title: doc.title,
    source: doc.kind === "article" ? doc.docId : doc.author,
    at: doc.at,
    marks: doc.marks,
  };
}

/**
 * A document as the backup wants it (D168): what it is found by again - an
 * article's address, which is its key, a book's title and author.
 *
 * @param {MarksDoc} doc
 * @returns {import("../lib/store/marks-copy.js").CopyDoc}
 */
function copyDocOf(doc) {
  return doc.kind === "article"
    ? { kind: "article", url: doc.docId, title: doc.title, marks: doc.marks }
    : { kind: "book", title: doc.title, author: doc.author, marks: doc.marks };
}

/**
 * The highlights as one Markdown page (D106), from the highlights page alone
 * since D152 (it stood in the list's transfer section too, a third button
 * there; the quotes' own page is where the act belongs - Michał's call): the
 * button under the rows writes the file, cut to the page's scope (D108), and
 * the link over the rows leads to the button. What was written, or why it
 * could not be, is said in the line under the button (D153).
 */
async function exportMarksPage() {
  try {
    const scope = marksShown === null ? null : marksShown.scope;
    const docs = await marksDocs((docId) => scope === null || docId === scope);
    if (docs.length === 0) return;
    const size = downloadFile(toMarksFile(docs.map(notesDocOf)), MARKS_FILENAME, "text/markdown");
    marksNotesStatus(
      plural(docs.length, "reader_export_marks_done", [MARKS_FILENAME, fileSize(size)]),
    );
  } catch {
    marksNotesStatus(describeError(ErrorCode.INTERNAL), "error");
  }
}

/**
 * The file's book documents laid against the books the library holds
 * (D223), one document per copy: a copy this import did not just write is
 * read back from the database, part by part, and the document's marks are
 * set where their words stand in it - so a highlight made in the book as
 * it was cut on another day, or on another device, is found where its
 * words are and not where its numbers were. Every article document, and a
 * book the library does not hold, goes through as it is: the plan names
 * the missing. What could not be placed - a quote found nowhere in the
 * book, or twice - is written all the same, as it was, and counted for the
 * report: it stands on the highlights page, unpainted in the book, the
 * guard's bargain (D169).
 *
 * @param {import("../lib/store/marks-copy.js").CopyDoc[]} documents
 * @param {BookMeta[]} books the library's books as they stand at the press
 * @param {Set<string>} written the ids of the books this import wrote from
 *   the same file - their parts are the file's own, so the anchors fit
 * @returns {Promise<{
 *   documents: import("../lib/store/marks-copy.js").CopyDoc[],
 *   healed: number,
 *   unplaced: { title: string, count: number }[],
 * }>}
 */
async function layBookMarks(documents, books, written) {
  /** @type {import("../lib/store/marks-copy.js").CopyDoc[]} */
  const laid = [];
  let healed = 0;
  /** @type {{ title: string, count: number }[]} */
  const unplaced = [];
  for (const doc of documents) {
    if (doc.kind !== "book") {
      laid.push(doc);
      continue;
    }
    const copies = booksOf(doc, books);
    if (copies.length === 0) {
      laid.push(doc);
      continue;
    }
    for (const book of copies) {
      if (written.has(book.id)) {
        laid.push({ ...doc, docId: book.id });
        continue;
      }
      const placed = await placeBookMarks(book, doc.marks);
      healed += placed.healed;
      if (placed.lost > 0) unplaced.push({ title: book.title, count: placed.lost });
      laid.push({ ...doc, docId: book.id, marks: placed.marks });
    }
  }
  return { documents: laid, healed, unplaced };
}

/**
 * One document's marks against one book (D223): the parts the marks name
 * are read first and alone - a file written against this very cut costs
 * the parts it marks and nothing more - and only when an anchor does not
 * read its quote is the whole book read, part by part, for `reanchorMarks`
 * to lay every mark where its words stand.
 *
 * @param {BookMeta} book
 * @param {import("../lib/reader/marks.js").Mark[]} marks
 * @returns {Promise<{ marks: import("../lib/reader/marks.js").Mark[], healed: number, lost: number }>}
 */
async function placeBookMarks(book, marks) {
  /** @type {Map<number, string[] | null>} */
  const parts = new Map();
  /** @param {number} index */
  const proseAt = async (index) => {
    let prose = parts.get(index);
    if (prose === undefined) {
      prose = await bookPartProse(book.id, index);
      parts.set(index, prose);
    }
    return prose;
  };
  let fit = true;
  for (const mark of marks) {
    const prose = await proseAt(mark.segmentIndex);
    if (prose === null || !fitsProse(prose, mark)) {
      fit = false;
      break;
    }
  }
  if (fit) return { marks, healed: 0, lost: 0 };
  /** @type {string[][]} */
  const whole = [];
  for (let index = 0; index < book.segmentCount; index += 1) whole.push((await proseAt(index)) ?? []);
  return reanchorMarks(whole, marks);
}

/**
 * One part's prose as the marks count it, without the screen: the stored
 * blocks parsed inert and walked by `storedBlockText` - the search's own
 * reading of a stored block, one arithmetic with the paint's `blockProse`
 * (a stored block is one rebuilt block, and the render's second pass
 * through the allowed list moves none, which is what the search's landing
 * stands on too). Null for a part that is not there.
 *
 * @param {string} bookId
 * @param {number} index
 * @returns {Promise<string[] | null>}
 */
async function bookPartProse(bookId, index) {
  const segment = await getBookSegment(bookId, index);
  return segment === null ? null : segment.blocks.map(storedBlockText);
}

/**
 * The report's sentence about the marks no book could place (D223) - only
 * when there are any: their count and a sample of the books' titles. The
 * marks are written all the same and stand on the highlights page.
 *
 * @param {{ title: string, count: number }[]} unplaced
 * @returns {string[]}
 */
function unplacedNotes(unplaced) {
  const count = unplaced.reduce((sum, row) => sum + row.count, 0);
  if (count === 0) return [];
  return [plural(count, "reader_marks_import_unplaced", [titleSample(unplaced.map((row) => row.title))])];
}

/**
 * A sample of titles for a sentence: the first few and an ellipsis for the
 * rest - the count says how many there are, and a file of hundreds must
 * not become a paragraph.
 *
 * @param {string[]} titles
 * @returns {string}
 */
function titleSample(titles) {
  const shown = titles.slice(0, SAMPLE_TITLES);
  if (titles.length > SAMPLE_TITLES) shown.push("...");
  return shown.join(", ");
}

/**
 * What a file's import leaves out and why, as sentences: the documents the
 * reading list does not hold (a sample of their titles - the count says how
 * many there are, and a file of hundreds must not become a paragraph) -
 * the books apart from the articles, because what to do about them
 * differs: a book comes back from its .epub file, and its highlights are
 * not written anywhere until it does, so the sentence says to import the
 * file again after the book - then the marks standing here already, the
 * marks meeting one, the entries that were not marks. Under the offer's
 * rows - and alone, in the report line, when the file has nothing else to
 * say.
 *
 * @param {import("../lib/store/marks-copy.js").MarksImportPlan} plan
 * @param {number} invalid
 * @returns {string[]}
 */
function marksImportNotes(plan, invalid) {
  /** @type {string[]} */
  const sentences = [];
  /** @param {import("../lib/store/marks-copy.js").CopyDoc[]} docs */
  const sampleOf = (docs) => titleSample(docs.map((doc) => doc.title));
  const { books, articles } = missingByKind(plan.missing);
  if (books.length > 0) {
    sentences.push(plural(books.length, "reader_marks_import_books", [sampleOf(books)]));
  }
  if (articles.length > 0) {
    sentences.push(plural(articles.length, "reader_marks_import_missing", [sampleOf(articles)]));
  }
  if (plan.twins > 0) sentences.push(plural(plan.twins, "reader_marks_import_twins"));
  if (plan.overlapping > 0) sentences.push(plural(plan.overlapping, "reader_marks_import_overlap"));
  if (invalid > 0) sentences.push(plural(invalid, "reader_import_unreadable"));
  return sentences;
}

/**
 * Downloading is a blob and an anchor; no permission asks for less. The URL
 * has to outlive the click long enough for the download to take it - a
 * minute is comfortably that, and then the blob can go.
 *
 * @param {string | Uint8Array<ArrayBuffer> | Blob} content text, the bytes of a file, or the
 *   archive as the stream packed it (D218)
 * @param {string} filename
 * @param {string} type
 * @returns {number} the file's size in bytes, for the line that says what was written
 */
function downloadFile(content, filename, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return blob.size;
}

/**
 * @param {File} file
 */
async function offerImport(file) {
  try {
    const text = await file.text();
    // The highlights' old backup (D168) is a .json too: since D213 it is a
    // part of the backup of everything, and it is offered as one - its
    // marks laid against the library at the press, as an archive's are.
    if (isMarksCopy(text)) {
      await offerParts(file.name, {
        manifest: null,
        articles: null,
        vocabulary: null,
        highlights: fromMarksCopy(text),
        settings: null,
      });
      return;
    }
    const parsed = fromArticlesFile(text);
    offerParsed(file.name, parsed);
  } catch {
    pendingImport = null;
    renderImportOffer();
    transferStatus(describeError(ErrorCode.INTERNAL), "error");
  }
}

/**
 * The `.zip` backup (D145) offered the way the `.json` is: its
 * `articles.json` read and parsed, the pictures it names counted from the
 * directory - no picture entry is opened before the consent.
 *
 * @param {File} file
 * @param {Uint8Array} bytes the whole archive, read once
 * @param {import("./zip.js").ZipEntryInfo[]} entries its directory
 */
async function offerArchive(file, bytes, entries) {
  try {
    const read = await entryReader(bytes);
    const text = read(ARTICLES_ENTRY, Number.POSITIVE_INFINITY);
    const parsed = fromArchiveText(text === null ? "" : new TextDecoder().decode(text));
    const account = archiveAccount(parsed.refs, entries);
    offerParsed(
      file.name,
      parsed,
      account.count === 0 ? undefined : { bytes, refs: parsed.refs, account },
    );
  } catch {
    pendingImport = null;
    renderImportOffer();
    transferStatus(describeError(ErrorCode.INTERNAL), "error");
  }
}

/**
 * @param {string} name
 * @param {import("../lib/store/articles-file.js").ArticlesFile} parsed
 * @param {NonNullable<typeof pendingImport>["pictures"]} [pictures]
 */
function offerParsed(name, parsed, pictures) {
  if (parsed.articles.length === 0) {
    pendingImport = null;
    renderImportOffer();
    transferStatus(t("reader_import_nothing"), "error");
    return;
  }
  pendingImport = {
    name,
    articles: parsed.articles,
    invalid: parsed.invalid,
    ...(pictures === undefined ? {} : { pictures }),
  };
  transferStatus("");
  renderImportOffer();
}

/**
 * The moment of consent: what the file holds, before anything is written.
 * Titles came from somebody's page once, so they enter as text - the same
 * `textContent` rule as the rows above.
 */
function renderImportOffer() {
  if (importConfirm === null) return;
  // The backup of everything's offer (D213) wears the same frame; the
  // list's own file shows none of its parts.
  if (pendingBackup !== null) {
    renderBackupOffer();
    return;
  }
  if (importParts !== null) importParts.hidden = true;
  if (importSettingsRow !== null) importSettingsRow.hidden = true;
  importConfirm.hidden = pendingImport === null;
  if (pendingImport === null) return;

  if (importSummary !== null) {
    const sentences = [
      plural(pendingImport.articles.length, "reader_import_summary", [pendingImport.name]),
    ];
    // A `.zip` backup says what its pictures come to (D145) before the
    // press: the one number that decides whether the space is wanted.
    const pictures = pendingImport.pictures;
    if (pictures !== undefined) {
      sentences.push(
        plural(pictures.account.count, "reader_import_pictures", [megabytes(pictures.account.bytes)]),
      );
    }
    importSummary.textContent = sentences.join(" ");
  }

  if (importSample !== null) {
    importSample.replaceChildren();
    for (const article of pendingImport.articles.slice(0, SAMPLE_TITLES)) {
      const item = document.createElement("li");
      item.textContent = article.title;
      importSample.append(item);
    }
    // The titles above are a sample; the line under them says how much of
    // the file they leave out, so three names never read as three articles.
    const rest = pendingImport.articles.length - SAMPLE_TITLES;
    if (rest > 0) {
      const more = document.createElement("li");
      more.className = "import-more";
      more.textContent = plural(rest, "reader_import_more");
      importSample.append(more);
    }
  }
}

function closeImportOffer() {
  pendingImport = null;
  pendingBackup = null;
  renderImportOffer();
}

/**
 * The archive with a manifest (D213): every part read by its own reader
 * before the offer - no picture entry is opened before the consent, and
 * nothing is written. A file from a newer re/read is refused whole: the
 * parts this version knows might depend on ones it does not.
 *
 * @param {File} file
 * @param {Uint8Array} bytes the whole archive, read once
 * @param {import("./zip.js").ZipEntryInfo[]} entries its directory
 */
async function offerBackup(file, bytes, entries) {
  try {
    const read = await entryReader(bytes);
    /** @param {string} name */
    const textOf = (name) => {
      const data = read(name, Number.POSITIVE_INFINITY);
      return data === null ? null : new TextDecoder().decode(data);
    };
    const manifest = fromManifest(textOf(BACKUP_ENTRIES.manifest) ?? "");
    if (manifest !== null && isNewerBackup(manifest)) {
      closeImportOffer();
      transferStatus(t("reader_backup_newer", [manifest.app]), "error");
      return;
    }
    const articlesText = textOf(BACKUP_ENTRIES.articles);
    const articles = articlesText === null ? null : fromArchiveText(articlesText);
    const account = articles === null ? null : archiveAccount(articles.refs, entries);
    const vocabularyText = textOf(BACKUP_ENTRIES.vocabulary);
    const highlightsText = textOf(BACKUP_ENTRIES.highlights);
    const settingsText = textOf(BACKUP_ENTRIES.settings);
    // The books' index (D218): light, so no book's text is read before
    // the consent; the texts and the pictures wait in the archive.
    const booksText = textOf(BACKUP_ENTRIES.books);
    await offerParts(file.name, {
      manifest,
      articles,
      ...(articles !== null && account !== null && account.count > 0
        ? { pictures: { bytes, refs: articles.refs, account } }
        : {}),
      vocabulary: vocabularyText === null ? null : fromVocabularyFile(vocabularyText),
      highlights: highlightsText === null ? null : fromMarksCopy(highlightsText),
      settings: settingsText === null ? null : fromSettingsFile(settingsText),
      books: booksText === null ? null : { index: fromBooksIndex(booksText), bytes, entries },
    });
  } catch {
    closeImportOffer();
    transferStatus(describeError(ErrorCode.INTERNAL), "error");
  }
}

/**
 * The parts a backup holds, as the offer will show them: the articles laid
 * against the list so the offer can say how many are new, the rest
 * counted. A file with nothing in any part is said so, not offered.
 *
 * @param {string} name
 * @param {{
 *   manifest: import("../lib/store/backup-file.js").BackupManifest | null,
 *   articles: import("../lib/store/articles-file.js").ArticlesFile | null,
 *   pictures?: NonNullable<typeof pendingBackup>["pictures"],
 *   vocabulary: { rows: import("../lib/protocol.js").RestoreRow[], invalid: number } | null,
 *   highlights: { documents: import("../lib/store/marks-copy.js").CopyDoc[], invalid: number } | null,
 *   settings: import("../lib/config.js").ConfigPatch | null,
 *   books?: {
 *     index: { books: import("../lib/store/books-file.js").FileBook[], invalid: number },
 *     bytes: Uint8Array,
 *     entries: import("./zip.js").ZipEntryInfo[],
 *   } | null,
 * }} parts
 */
async function offerParts(name, parts) {
  const articles = parts.articles?.articles ?? [];
  const phrases = parts.vocabulary?.rows ?? [];
  const highlights = parts.highlights?.documents ?? [];
  const settings = parts.settings;
  const filed = parts.books?.index.books ?? [];
  if (articles.length === 0 && phrases.length === 0 && highlights.length === 0 && settings === null && filed.length === 0) {
    closeImportOffer();
    transferStatus(t("reader_backup_nothing"), "error");
    return;
  }
  const metas = articles.length === 0 ? [] : await listArticles();
  // The books (D218) laid against the list the same way, so the offer
  // says how many are new; their pictures counted off the directory.
  const shelf = filed.length === 0 ? [] : await listBooks();
  const books =
    parts.books === undefined || parts.books === null
      ? null
      : {
          rows: filed,
          plan: booksImportPlan(filed, { books: shelf }),
          account: archiveAccount(new Map(filed.map((book) => [book.meta.id, book.pictures ?? []])), parts.books.entries),
          bytes: parts.books.bytes,
        };
  pendingImport = null;
  pendingBackup = {
    name,
    manifest: parts.manifest,
    articles,
    newArticles: importPlan(metas.map((meta) => meta.url), articles).toAdd.length,
    invalid:
      (parts.articles?.invalid ?? 0) +
      (parts.vocabulary?.invalid ?? 0) +
      (parts.highlights?.invalid ?? 0) +
      (parts.books?.index.invalid ?? 0),
    ...(parts.pictures === undefined ? {} : { pictures: parts.pictures }),
    phrases,
    highlights,
    settings,
    books,
  };
  transferStatus("");
  renderImportOffer();
}

/**
 * The moment of consent for the backup of everything (D213): what the file
 * is - when and by which version it was written - and what it holds, one
 * line per part, with the sample of titles the articles' offer shows and
 * the box that decides about the settings. Titles came from somebody's
 * page once, so they enter as text - the rows' own rule.
 */
function renderBackupOffer() {
  if (importConfirm === null || pendingBackup === null) return;
  const offer = pendingBackup;
  importConfirm.hidden = false;

  if (importSummary !== null) {
    importSummary.textContent =
      offer.manifest === null
        ? t("reader_backup_summary_highlights", [offer.name])
        : t("reader_backup_summary", [
            offer.name,
            new Date(offer.manifest.createdAt).toLocaleDateString(uiLocale()),
            offer.manifest.app,
          ]);
  }

  if (importParts !== null) {
    /** @type {string[]} */
    const lines = [];
    if (offer.articles.length > 0) {
      lines.push(plural(offer.articles.length, "reader_backup_part_articles", [offer.newArticles.toLocaleString()]));
    }
    // The books (D218) beside the articles, with how many are new; the
    // pictures' line counts the articles' and the books' together - one
    // number for what the file's pictures come to.
    if (offer.books !== null && offer.books.rows.length > 0) {
      lines.push(
        plural(offer.books.rows.length, "reader_backup_part_books", [offer.books.plan.toAdd.length.toLocaleString()]),
      );
    }
    const pictured = {
      count: (offer.pictures?.account.count ?? 0) + (offer.books?.account.count ?? 0),
      bytes: (offer.pictures?.account.bytes ?? 0) + (offer.books?.account.bytes ?? 0),
    };
    if (pictured.count > 0) {
      lines.push(plural(pictured.count, "reader_import_pictures", [megabytes(pictured.bytes)]));
    }
    if (offer.phrases.length > 0) {
      // The pairs by name, not by count: a count would need its own plural
      // inside a sentence that already has one.
      const pairs = [...new Set(offer.phrases.map((row) => `${row.langFrom}\t${row.langTo}`))].map((key) => {
        const [from = "", to = ""] = key.split("\t");
        return pairLabel(from, to);
      });
      lines.push(plural(offer.phrases.length, "reader_backup_part_phrases", [pairs.join(", ")]));
    }
    const marks = offer.highlights.reduce((sum, doc) => sum + doc.marks.length, 0);
    if (marks > 0) lines.push(plural(marks, "reader_backup_part_highlights"));
    if (offer.invalid > 0) lines.push(plural(offer.invalid, "reader_import_unreadable"));
    importParts.replaceChildren(
      ...lines.map((line) => {
        const item = document.createElement("li");
        item.textContent = line;
        return item;
      }),
    );
    importParts.hidden = lines.length === 0;
  }

  if (importSample !== null) {
    importSample.replaceChildren();
    for (const article of offer.articles.slice(0, SAMPLE_TITLES)) {
      const item = document.createElement("li");
      item.textContent = article.title;
      importSample.append(item);
    }
    const rest = offer.articles.length - SAMPLE_TITLES;
    if (rest > 0) {
      const more = document.createElement("li");
      more.className = "import-more";
      more.textContent = plural(rest, "reader_import_more");
      importSample.append(more);
    }
  }

  if (importSettingsRow !== null) importSettingsRow.hidden = offer.settings === null;
  if (importSettings !== null) importSettings.checked = true;
}

/**
 * The press that writes the backup (D213), part by part, each through the
 * importer it always had and every one adding, never overwriting: the
 * articles with their pictures and positions first; then the books
 * (D218), each the way its own import writes it; then the vocabulary,
 * through the background, which owns every write to it; then the
 * highlights - after the articles and the books, so the marks that came
 * in with an article meet themselves and are left out, and a book's find
 * their book and are laid against its text (D223); the settings last,
 * when the box says so. One report, the parts' sentences in a row.
 */
async function runBackup() {
  if (pendingBackup === null || importRun === null) return;
  const offered = pendingBackup;
  importRun.disabled = true;
  try {
    /** @type {string[]} */
    const sentences = [];
    if (offered.articles.length > 0) {
      const report = await importArticles(offered.articles);
      const pictured = await writePictures(offered.pictures, report.urls);
      sentences.push(plural(report.added, "reader_import_added"));
      if (report.skipped > 0) sentences.push(plural(report.skipped, "reader_import_skipped"));
      if (pictured.count > 0) {
        sentences.push(plural(pictured.count, "reader_import_pictures_added", [megabytes(pictured.bytes)]));
      }
    }
    if (offered.books !== null && offered.books.rows.length > 0) {
      const report =
        offered.books.plan.toAdd.length > 0
          ? await importBooks(offered.books.plan.toAdd, offered.books.bytes)
          : { added: 0, unreadable: 0 };
      sentences.push(plural(report.added, "reader_import_books_added"));
      if (offered.books.plan.skipped > 0) {
        sentences.push(plural(offered.books.plan.skipped, "reader_import_books_skipped"));
      }
      if (report.unreadable > 0) sentences.push(plural(report.unreadable, "reader_import_unreadable"));
    }
    if (offered.phrases.length > 0) {
      const answer = asResult(
        await webext().runtime.sendMessage({ kind: Message.RESTORE_VOCABULARY, rows: offered.phrases }),
      );
      if (answer.ok) {
        const report = /** @type {import("../lib/protocol.js").RestoreReport} */ (answer.value);
        sentences.push(plural(report.added, "vocab_import_added"));
        if (report.skipped > 0) sentences.push(plural(report.skipped, "vocab_import_skipped"));
        if (report.sentenced > 0) sentences.push(plural(report.sentenced, "vocab_import_sentenced"));
        if (report.counted > 0) sentences.push(plural(report.counted, "reader_backup_phrases_counted"));
      } else {
        sentences.push(describeError(answer.code));
      }
    }
    if (offered.highlights.length > 0) {
      await restoreMarks();
      const [articles, books, marks] = await Promise.all([listArticles(), listBooks(), allMarks()]);
      // A book's marks laid against its text first (D223): a book that
      // stood here before this import may be cut otherwise than the one
      // the file's anchors count on. A book this same import just wrote
      // came with the file's own parts, so its anchors fit as they are.
      const written = new Set(offered.books === null ? [] : offered.books.plan.toAdd.map((book) => book.meta.id));
      const laid = await layBookMarks(offered.highlights, books, written);
      const plan = marksImportPlan(laid.documents, { articles, books, marks });
      if (plan.added > 0) await putMarksRows(plan.targets.map(({ docId, marks }) => ({ docId, marks })));
      sentences.push(plural(plan.added, "reader_marks_import_done"), ...marksImportNotes(plan, 0), ...unplacedNotes(laid.unplaced));
    }
    if (offered.settings !== null && importSettings !== null && importSettings.checked) {
      await writeConfig(offered.settings);
      sentences.push(t("reader_backup_settings_done"));
    }
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
 * The books of a backup written into the library (D218), one at a time,
 * each the way an import from its .epub writes it: the segments first,
 * the pictures as the file holds them under the indexes the segments
 * name, the row last (`putBook` - the write that makes the book exist,
 * and copies it), then where the reader stopped - only with a book
 * actually added, as an article's position comes only with the article.
 * The row's account of its pictures is written from the rows that
 * actually came out of the archive. A book whose text will not read, or
 * whose parts are not the number the row promises, is left out and
 * counted; a write cut short leaves nothing behind (`deleteBook` takes
 * what a failure wrote, the orphan sweep covers the rest).
 *
 * @param {import("../lib/store/books-file.js").FileBook[]} books the ones the plan adds
 * @param {Uint8Array} bytes the whole archive
 * @returns {Promise<{ added: number, unreadable: number }>}
 */
async function importBooks(books, bytes) {
  const read = await entryReader(bytes);
  let added = 0;
  let unreadable = 0;
  for (const book of books) {
    const id = book.meta.id;
    const text = read(book.text, MAX_BOOK_TEXT_BYTES);
    const segments = text === null ? null : fromBookText(new TextDecoder().decode(text), id);
    if (segments === null || segments.length !== book.meta.segmentCount) {
      unreadable += 1;
      continue;
    }
    try {
      for (const [index, segment] of segments.entries()) {
        await putBookSegment({ bookId: id, index, ...segment });
      }
      const rows = bookPictureRows(id, book.pictures ?? [], (name) => read(name, MAX_DOWNLOAD_BYTES));
      for (const row of rows) await putBookPicture(row);
      const summary = picturesSummary(rows);
      const { pictures: claimed, ...meta } = book.meta;
      void claimed;
      await putBook(summary.count === 0 ? meta : { ...meta, pictures: summary });
      if (book.position !== undefined) await putPosition(book.position);
      added += 1;
    } catch (error) {
      console.warn("re/read: a book of the backup could not be written", error);
      await deleteBook(id).catch(() => undefined);
      unreadable += 1;
    }
  }
  return { added, unreadable };
}

/**
 * The pictures of a `.zip` backup (D145), for the articles just added and
 * no other - an article already saved keeps its copy whole - read out of
 * the archive one entry at a time and written one row at a time, the way a
 * save writes them.
 *
 * @param {NonNullable<typeof pendingImport>["pictures"]} pictures
 * @param {string[]} urls the addresses actually added
 * @returns {Promise<{ count: number, bytes: number }>}
 */
async function writePictures(pictures, urls) {
  let pictured = { count: 0, bytes: 0 };
  if (pictures === undefined) return pictured;
  const read = await entryReader(pictures.bytes);
  for (const url of urls) {
    const refs = pictures.refs.get(url);
    if (refs === undefined) continue;
    const rows = archivePictures(url, refs, (name) => read(name, MAX_DOWNLOAD_BYTES));
    if (rows.length === 0) continue;
    for (const row of rows) await putPicture(row);
    const summary = picturesSummary(rows);
    await setPictures(url, summary);
    pictured = { count: pictured.count + summary.count, bytes: pictured.bytes + summary.bytes };
  }
  return pictured;
}

async function runImport() {
  if (pendingImport === null || importRun === null) return;
  const offered = pendingImport;
  importRun.disabled = true;
  try {
    const report = await importArticles(offered.articles);

    const pictured = await writePictures(offered.pictures, report.urls);

    // "Added 12, skipped 3" is the whole reason to trust an import that
    // says nothing else - the same report the phrase import gives.
    const sentences = [plural(report.added, "reader_import_added")];
    if (report.skipped > 0) sentences.push(plural(report.skipped, "reader_import_skipped"));
    if (offered.invalid > 0) sentences.push(plural(offered.invalid, "reader_import_unreadable"));
    if (pictured.count > 0) {
      sentences.push(plural(pictured.count, "reader_import_pictures_added", [megabytes(pictured.bytes)]));
    }
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
 * The action rows around the article - the bar above it and the finishing
 * acts under its last line - drawn from what the database says right now,
 * along with the chrome's way back to the list (D102), which stands in every
 * article view. Whether this address is in the list decides everything on
 * them, and the door it came through decides nothing (D185): a page in the
 * list offers Delete and the read mark whether it was opened from the list
 * or from a live tab, and a live page not in the list offers Save. The
 * toggle that used to stand over a saved live page - "In the reading list",
 * a second press taking the copy out in one go - read as a state, not an
 * act, and nobody looked under it for Delete (Michał's report, 2026-09-05).
 * One function dresses all of it, so the rows cannot disagree.
 */
async function refreshActions() {
  if (actions === null) return;
  const target = shown;
  if (target === null) {
    actions.hidden = true;
    if (actionsEnd !== null) actionsEnd.hidden = true;
    if (toLibraryButton !== null) toLibraryButton.hidden = true;
    if (navPictures !== null) navPictures.hidden = true;
    if (navPicturesHint !== null) navPicturesHint.hidden = true;
    if (picturesOffer !== null) picturesOffer.hidden = true;
    if (navExportEpub !== null) navExportEpub.hidden = true;
    if (navExportMarkdown !== null) navExportMarkdown.hidden = true;
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

  // Save is an offer to a live page the list does not have yet - a plain
  // verb, one press; the copy it writes is undone by Delete, not by a second
  // press here.
  if (keepButton !== null) {
    keepButton.hidden = target.origin !== "live" || row !== null;
    keepButton.textContent = t("reader_save");
  }

  const book = target.origin === "book";
  // The twins under the text stand only where the document finishes: under
  // an article's last line, and under a book's LAST part - under any earlier
  // part the honest next act is the pager's, one row above. The bar's copies
  // stay on every part, because filing or dropping a book must not cost
  // paging to its end.
  const lastPart = !book || target.segmentIndex >= target.segmentCount - 1;

  // Delete stands over everything that lives only in this database - a
  // saved article, whichever door it came through, and a book - and under
  // the last line as the other way of being done with a document (D185).
  for (const button of [removeButton, removeEndButton]) {
    if (button === null) continue;
    button.hidden = row === null || (button === removeEndButton && !lastPart);
    button.removeAttribute("data-armed");
    button.style.removeProperty("min-width");
    // The rows' pair of words: one visible verb, the act with its title as
    // the accessible name - a bare "Delete" names nothing over a whole page.
    button.textContent = t("action_delete");
    button.setAttribute("aria-label", t("reader_delete_aria", deleteTitle(button)));
  }

  const read = row !== null && row.readAt !== null;
  // The read mark belongs to the whole document, and over a book the words
  // must say so: a bare "Mark as read" at part 3 of 32 left open whether the
  // part or the book was being marked (Michał's report, 2026-08-16) - it was
  // always the book.
  const label = book
    ? (read ? t("reader_book_marked_read") : t("reader_mark_book_read"))
    : (read ? t("reader_marked_read") : t("reader_mark_read"));
  for (const button of [markReadButton, markReadEndButton]) {
    if (button === null) continue;
    button.hidden = row === null || (button === markReadEndButton && !lastPart);
    button.textContent = label;
    button.setAttribute("aria-pressed", String(read));
  }

  refreshPicturesRow(target, row);
  refreshExportRows(target, row);
}

/**
 * The export rows of the menu (D229), over the document on screen: the
 * book file and the text page, each with its line - what the file is
 * before the press, what the last press came to after it (`exportNote`,
 * the pictures row's own pattern). Nothing over a page not yet saved: the
 * file is written from the stored copy, and there is none. Greyed while a
 * file is being written, so a second press does not start a second one.
 *
 * @param {NonNullable<typeof shown>} target
 * @param {SavedMeta | BookMeta | null} row
 */
function refreshExportRows(target, row) {
  if (navExportEpub !== null) {
    navExportEpub.hidden = row === null;
    navExportEpub.disabled = documentExport;
  }
  if (navExportMarkdown !== null) {
    navExportMarkdown.hidden = row === null;
    navExportMarkdown.disabled = documentExport;
  }
  const note = exportNote !== null && exportNote.url === target.url ? exportNote : null;
  if (navExportEpubHint !== null) {
    navExportEpubHint.textContent =
      note !== null && note.format === "epub" ? note.text : t("reader_export_epub_hint");
  }
  if (navExportMarkdownHint !== null) {
    navExportMarkdownHint.textContent =
      note !== null && note.format === "markdown" ? note.text : t("reader_export_markdown_hint");
  }
}

/**
 * An export row pressed (D229): the document on screen written as the
 * file the row names and handed to the browser as a download, the row's
 * line saying what was written - or that it could not be (a book whose
 * text the database no longer holds whole). The menu stays open, the
 * pictures row's manner: the line under the row is the report. The
 * document is the one the press was made on, whatever is on screen when
 * the file is done; the line is redrawn only if it still is.
 *
 * @param {import("./export-doc.js").ExportFormat} format
 */
async function onExportPress(format) {
  const target = shown;
  if (target === null || documentExport) return;
  documentExport = true;
  for (const button of [navExportEpub, navExportMarkdown]) if (button !== null) button.disabled = true;
  /** @type {string} */
  let text;
  try {
    const file = await exportDocument(target.origin === "book" ? "book" : "article", target.url, format);
    if (file === null) {
      text = t("reader_export_doc_failed");
    } else {
      const size = downloadFile(file.content, file.filename, file.type);
      text = t("reader_export_doc_done", [file.filename, fileSize(size)]);
    }
  } catch {
    text = t("reader_export_doc_failed");
  }
  documentExport = false;
  exportNote = { url: target.url, format, text };
  for (const button of [navExportEpub, navExportMarkdown]) if (button !== null) button.disabled = false;
  if (shown?.url !== target.url) return;
  const hint = format === "epub" ? navExportEpubHint : navExportMarkdownHint;
  if (hint !== null) hint.textContent = text;
}

/**
 * The pictures row of the menu (D145), over the document on screen. Three
 * states, told apart by the database's light row and the save under way:
 * the offer, with how many pictures the text asks for; the save, with its
 * progress and the stop; the removal, with what the pictures take. Nothing
 * over a page not yet saved, or an article whose text asks for no picture -
 * the articles saved before pictures among them, since their text kept no
 * address to ask for. Over a book (D183) only the third state: its
 * pictures came with the file, and the file is not here to ask again.
 *
 * @param {NonNullable<typeof shown>} target
 * @param {SavedMeta | BookMeta | null} row
 */
function refreshPicturesRow(target, row) {
  if (navPictures === null || navPicturesLabel === null || navPicturesHint === null) return;
  const book = target.origin === "book";
  const root = contentRoot();
  const task = picturesTask !== null && picturesTask.url === target.url ? picturesTask : null;
  const state = picturesState({
    saved: row !== null,
    book,
    asked: book || row === null || root === null ? 0 : pictureSources(root).length,
    kept: row?.pictures ?? null,
    saving: task !== null,
  });
  const note = picturesNote !== null && picturesNote.url === target.url ? picturesNote.text : null;

  navPictures.hidden = state.kind === "hidden";
  navPicturesHint.hidden = state.kind === "hidden";
  if (state.kind === "saving") {
    navPicturesLabel.textContent = task?.label ?? "";
    navPicturesHint.textContent = t("reader_pictures_stop");
  } else if (state.kind === "kept") {
    navPicturesLabel.textContent = t("reader_pictures_remove", megabytes(state.bytes));
    navPicturesHint.textContent = note ?? (book ? t("reader_pictures_book_hint") : t("reader_pictures_hint"));
  } else if (state.kind === "offer") {
    navPicturesLabel.textContent = t("reader_pictures_save", state.count.toLocaleString());
    navPicturesHint.textContent = note ?? t("reader_pictures_hint");
  }

  // The line under the header (D231) carries the offer and the save only:
  // downloaded pictures stand in the text and are their own announcement,
  // and the removal stays a menu act. What the last press came to - none
  // could be downloaded, pictures removed - takes the sentence's place,
  // with the press beside it to try again.
  if (picturesOffer === null || picturesOfferText === null || picturesOfferButton === null) return;
  if (state.kind === "saving") {
    picturesOfferText.textContent = task?.label ?? "";
    picturesOfferButton.textContent = t("reader_pictures_offer_stop");
  } else if (state.kind === "offer") {
    picturesOfferText.textContent = note ?? plural(state.count, "reader_pictures_offer");
    picturesOfferButton.textContent = t("reader_pictures_offer_button");
  }
  picturesOffer.hidden = state.kind !== "saving" && state.kind !== "offer";
}

/**
 * The pictures row pressed: the stop of a save under way, the removal of
 * pictures kept, or the save of the ones the text asks for - one press,
 * the same row, what it says decided by `refreshPicturesRow`. The document
 * is opened again from the database when the press has done its work, so
 * what is on screen is what is stored, pictures included or not; the
 * reading position rides through the reopening like through any other -
 * a book at the part that was on screen.
 */
async function onPicturesPress() {
  const target = shown;
  if (target === null) return;
  if (target.origin === "book") {
    const book = await getBook(target.url).catch(() => null);
    if (shown !== target || book === null || book.pictures === undefined) return;
    try {
      await deleteBookPictures(target.url);
      picturesNote = { url: target.url, text: t("reader_pictures_removed") };
    } catch {
      picturesNote = { url: target.url, text: t("reader_pictures_failed") };
    }
    if (shown === target) await openBook(target.url, target.segmentIndex);
    return;
  }
  if (picturesTask !== null) {
    if (picturesTask.url === target.url) picturesTask.controller.abort();
    return;
  }
  const meta = await getArticleMeta(target.url).catch(() => null);
  if (shown !== target || meta === null) return;

  if (meta.pictures !== undefined) {
    try {
      await deletePictures(target.url);
      picturesNote = { url: target.url, text: t("reader_pictures_removed") };
    } catch {
      picturesNote = { url: target.url, text: t("reader_pictures_failed") };
    }
    if (shown === target) await openSaved(target.url);
    return;
  }

  const root = contentRoot();
  const sources = root === null ? [] : pictureSources(root);
  if (sources.length === 0) return;
  const controller = new AbortController();
  /** @param {number} done @param {number} bytes */
  const progress = (done, bytes) =>
    t("reader_pictures_progress", [done.toLocaleString(), sources.length.toLocaleString(), megabytes(bytes)]);
  picturesTask = { url: target.url, controller, label: progress(0, 0) };
  refreshPicturesRow(target, meta);
  try {
    const result = await savePictures(target.url, sources, {
      signal: controller.signal,
      onProgress: ({ done, bytes }) => {
        if (picturesTask?.controller !== controller) return;
        picturesTask.label = progress(done, bytes);
        if (shown?.url === target.url) {
          if (navPicturesLabel !== null) navPicturesLabel.textContent = picturesTask.label;
          if (picturesOfferText !== null) picturesOfferText.textContent = picturesTask.label;
        }
      },
    });
    picturesNote = result.aborted
      ? null
      : {
          url: target.url,
          text:
            result.saved === 0
              ? t("reader_pictures_none")
              : plural(result.of, "reader_pictures_done", [
                  result.saved.toLocaleString(),
                  megabytes(result.bytes),
                ]),
        };
  } catch {
    picturesNote = { url: target.url, text: t("reader_pictures_failed") };
  } finally {
    if (picturesTask?.controller === controller) picturesTask = null;
  }
  if (shown === target) await openSaved(target.url);
}

/**
 * Save this live page - one press, no confirmation: a copy written is
 * nothing lost. Taking it out again is Delete's act, with its two presses,
 * the same over this page as over a copy opened from the list (D185): the
 * second press of the toggle that once stood here dropped the copy with its
 * highlights in one go, while the same copy asked "Sure?" from the list.
 * What gets written is the rebuilt tree exactly as it is on screen,
 * serialized by reading it back - nothing here ever assigns markup. The press
 * is a yes that outlives the row: the address comes off this tab's declined
 * list (D124).
 */
async function onKeepPress() {
  const target = shown;
  if (target === null || target.origin !== "live") return;

  try {
    // Never over an existing row: the copy carries highlights and the
    // reading position, and rewriting it would take them (D124). A row that
    // got here first only means the bar is behind - it catches up below.
    const existing = await getArticleMeta(target.url);
    if (shown !== target) return;
    if (existing === null) {
      if (!(await saveShownLive(target))) return;
      setKeepDeclined(target.url, false);
    }
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
 * moment and then Delete and the read mark would be a flicker on e-ink and
 * wrong for as long as it lasted.
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
    if (keepArticles && shown === target && !declinedKeeps().has(target.url)) await keptRow(target);
  } catch {
    // The same word the Save button uses for a write that did not land. The
    // rows drawn below will say Save, which is then the truth.
    showNotice(t("reader_list_write_failed"));
  }
  if (shown === target) await refreshActions();
}

/**
 * Delete the document on screen from its own view - two presses on the same
 * spot, because this copy is the only copy and offline there is no getting
 * it back. The question is asked by changing the text, not by a dialog or an
 * undo timer: both are flashes on e-ink, and neither is more honest. The same
 * armed state as the rows' Delete, so the same rules stand it down. Two
 * spots ask it - the bar and the row under the last line - and either leads
 * to the list: over a live page too, and from however deep this page's own
 * entries stand, the walk the menu's list row takes (Michał's calls,
 * 2026-09-05 - a plain step back from a document opened off its own
 * highlights page landed on the highlights of a document that was no longer
 * there). The press was about the copy, and once it is gone the list is
 * where the reader expects to stand. The tab's live page stays declined
 * (D124), so Back onto it does not keep it again.
 *
 * @param {HTMLElement | null} button the Delete that was pressed
 */
async function onRemovePress(button) {
  const target = shown;
  if (target === null) return;
  if (!(button instanceof HTMLButtonElement)) return;

  if (!button.hasAttribute("data-armed")) {
    // The question must not move the target out from under the finger. Which
    // of verb and question runs longer now differs by catalogue ("Usuń" asks
    // "Na pewno?", "Supprimer" asks "Sûr ?"), so the width is held as
    // min-width, anchored on the left edge the row aligns to: the button
    // never shrinks, and can only grow rightward.
    button.style.minWidth = `${button.offsetWidth}px`;
    armDelete(button);
    return;
  }

  try {
    if (target.origin === "book") await deleteBook(target.url);
    else await deleteArticle(target.url);
  } catch {
    showNotice(t("reader_list_write_failed"));
    return;
  }
  if (target.origin !== "book") setKeepDeclined(target.url, true);
  if (shown !== target) return;
  leaveToList();
}

/**
 * Which parts of the document on screen were already counted as finished
 * (D209): one document deep, forgotten when another opens.
 */
const readLedger = new ReadLedger();

/**
 * The part on screen counted as finished (D209): its underlined occurrences
 * go to the saved phrases they belong to, through the reading side's report.
 * Once per part per opening of the document, whichever gesture says so - the
 * Next under the text, or Mark as read - and never for the whole book: the
 * parts already left through Next are counted, and the mark over a book
 * counts only the part it was pressed on.
 */
function countFinished() {
  const target = shown;
  if (target === null) return;
  const part = target.origin === "book" ? target.segmentIndex : 0;
  if (!readLedger.claim(target.url, part)) return;
  reportRead();
}

/**
 * Mark the article read, or unread again - only ever by hand, from here:
 * opening an article is not reading it (D-g).
 */
async function onMarkReadPress() {
  const target = shown;
  if (target === null) return;

  try {
    // Marking counts the part on screen as finished (D209) - marking, never
    // unmarking, and over a book only this part: the parts before it were
    // counted as Next under their text left them, and the mark is the last
    // part's way of arriving. Before the write, while the page still shows
    // what is being marked.
    if (target.origin === "book") {
      const book = await getBook(target.url);
      if (shown !== target || book === null) return;
      if (book.readAt === null) countFinished();
      await setBookReadAt(target.url, book.readAt === null ? Date.now() : null);
    } else {
      const meta = await getArticleMeta(target.url);
      if (shown !== target || meta === null) return;
      if (meta.readAt === null) countFinished();
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
  // The typography rows (D225), stamped the way the links mode is: each
  // a name with a rule in reader.css under it, and each default a name
  // no rule matches - the article as it has always been drawn.
  root.dataset["readerLineHeight"] = reader.lineHeight;
  root.dataset["readerAlign"] = reader.align;
  root.dataset["readerHyphens"] = reader.hyphens;
  root.dataset["readerParagraphs"] = reader.paragraphs;
  // The layout (D233), stamped the same way: the stylesheet takes the
  // finger's scroll away under it, and the page table below answers to it.
  root.dataset["readerLayout"] = reader.layout;
  // Whether the page count stands at the foot (D238): the stylesheet gives
  // the foot its line under this, and the band ends above it either way.
  root.dataset["readerPageNumber"] = String(reader.pageNumber);
  root.style.setProperty("--reader-measure", `${reader.measure}ch`);
  // The measure again with the text size cancelled out of it: `ch` scales
  // with the font, which is right for the article's column (a measure counts
  // characters) and wrong for the list views, whose width is layout - the
  // whole page breathed when the size stepped (Michał's report). The same
  // count re-expressed against the default size stands still however the
  // text grows; reader.css caps the list and highlights views on this twin.
  const pinned = (reader.measure * DEFAULTS.reader.fontSize) / reader.fontSize;
  root.style.setProperty("--reader-measure-pinned", `${pinned.toFixed(2)}ch`);
  // The wet stroke's ink (D106): the pen's, until a handle drag borrows the
  // mark's own for its duration (D181).
  wearDraftInk(reader.markerColor);

  if (sizeValue !== null) sizeValue.textContent = String(reader.fontSize);
  if (measureValue !== null) measureValue.textContent = String(reader.measure);
  // The Custom choice stands only while the settings hold a name (D163) -
  // a choice of nothing would be a button that does nothing - and wears the
  // name itself as its title, so a hover says which font "Custom" means.
  if (fontOwn !== null) {
    fontOwn.hidden = reader.fontFamily.length === 0;
    fontOwn.title = reader.fontFamily;
  }
  // The bar folded or out (the bookmark tab's stored choice), stamped for
  // the stylesheet - which folds it only over an article, the same scope
  // the stuck bar lives by.
  root.dataset["readerChrome"] = reader.chromeHidden ? "hidden" : "shown";
  updateChromeTab();
  // The bar laid out again after a fold is the one room change the
  // full-screen tool cannot see for itself.
  refreshFullscreenTool();
  applyLinkStops(reader.links);

  // The rows of named choices, each button's attribute against the name
  // in force: one list for all of them, so a row is one line here.
  /** @type {[string, string][]} */
  const named = [
    ["data-theme", reader.theme],
    ["data-font", reader.font],
    ["data-line-height", reader.lineHeight],
    ["data-align", reader.align],
    ["data-hyphens", reader.hyphens],
    ["data-paragraphs", reader.paragraphs],
    ["data-layout", reader.layout],
    ["data-links", reader.links],
    ["data-marker-color", reader.markerColor],
  ];
  for (const [attribute, current] of named) {
    for (const button of document.querySelectorAll(`[${attribute}]`)) {
      button.setAttribute("aria-pressed", String(button.getAttribute(attribute) === current));
    }
  }

  // The mark toolbar's swatches speak for the pen while no mark is active
  // (D107), so a new ink - picked in Aa, on the bar itself, or in another
  // tab - has to reach them through the same road every setting takes.
  refreshMarkBar();
  // The panel's own rows just changed height with the text size, and one of
  // them may have come or gone (D246): what stands below its fold changed
  // with them.
  dressPanelMore();
  // A size or measure change reflows the article under the note badges;
  // reading fresh boxes here sees the layout the new variables made.
  showNoteBadges();
  // The same reflow cuts the pages elsewhere (D233): the table is measured
  // again on the next ask - from the page being read, whose first line is
  // found again in the re-wrapped text (D238) - and the window squares
  // with that page. The layout just switched, there is no table to keep,
  // and the page is the one under the line at the top of the screen.
  pagesStale = true;
  settlePage();
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
  // The two rows stand only where a voice can be had - not on an engine
  // without the API, and not with reading aloud switched off (D148): an
  // empty voice select would be a promise nothing keeps.
  if (voiceSetting !== null) voiceSetting.hidden = !canSpeak();
  if (rateSetting !== null) rateSetting.hidden = !canSpeak();
  if (rateValue !== null) rateValue.textContent = `${(settings.ttsRate / 100).toFixed(1)}×`;
  renderVoiceChoice();
  readingVoice(speechVoice());
}

/**
 * The reader's own rules (D176) on this page - the whole page, bar and lists
 * included, since the product owner's call of 2026-09-04: somebody who wants
 * another bar should be able to have it, and a wrong rule is undone on the
 * settings page, which the rules never reach. `dresser` keeps the adopted
 * sheet and swaps it as the text changes.
 */
const dressPage = dresser(document);

/**
 * One road for everything the settings decide on this page - how it looks and
 * what the voice does. Fed with what was actually stored rather than with what
 * was asked for: at either end of a scale the honest answer is "it did not
 * move", and the controls should show that instead of pretending.
 *
 * @param {import("../lib/config.js").Config} config
 */
function adoptConfig(config) {
  const spoke = canSpeak();
  const paceMoved = settings.readingPace !== config.readingPace;
  settings = config;
  // The reading-aloud switch (D148) lands before anything below asks
  // `canSpeak`: the panel's rows, the bar's button and the quotes' speakers
  // all read their answer from it. Off takes the article's voice and a
  // quote's with it - a voice mid-sentence when the switch lands is a voice
  // that was just asked to be quiet.
  setSpeechOff(config.ttsOff);
  if (config.ttsOff) {
    stopReading();
    stopMarkSpeech();
  }
  applyAppearance(config.reader);
  dressPage(config.customCss);
  applyUnderline(config);
  applySpeech();
  updateListen();
  // The highlights page draws its speakers row by row: a flip while it is on
  // screen redraws it, so no row keeps a button that would do nothing.
  if (spoke !== canSpeak() && marksShown !== null) void refreshMarks();
  // With translation off (D120) the saved phrases page loses its door here,
  // the way it does in the popup and the settings menu - the page itself
  // stays untouched, and unlocks with the switch. Unless a pair is chosen:
  // then the quiet vocabulary lives on this very page (D158), and a
  // vocabulary being written needs its door.
  if (navVocabulary !== null) {
    navVocabulary.hidden = config.translationOff && chosenPair(config) === null;
  }
  // The reading times are made at the reader's own pace (D228), and a pace
  // changed on the settings page reaches this tab the way every setting
  // does: the line under the title is redrawn from the count it holds, and
  // the list, when it is the room on screen, is read again - its rows carry
  // the minutes in their text. On the first adoption the stored pace
  // replaces the default's, and whatever is already drawn is redrawn with it.
  if (paceMoved) {
    renderFacts();
    if (document.body.dataset["view"] === "list") void refreshLibrary();
  }
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
    // A keyboard's focus can be standing on the transport when the bar goes
    // (a keyboard start parks it there, `onListenPress`; a pointer's press
    // leaves none behind). It goes back to the switch that opened the bar,
    // the way the panels hand theirs back on Escape, rather than dropping
    // on the body for a keyboard to hunt from the top.
    if (state === "off" && speechBar.contains(document.activeElement)) listenButton?.focus();
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
  const lineHeight = button.getAttribute("data-line-height");
  const align = button.getAttribute("data-align");
  const hyphens = button.getAttribute("data-hyphens");
  const paragraphs = button.getAttribute("data-paragraphs");
  const layout = button.getAttribute("data-layout");
  const links = button.getAttribute("data-links");
  const markerColor = button.getAttribute("data-marker-color");
  const size = button.getAttribute("data-size");
  const measure = button.getAttribute("data-measure");

  /** @type {Partial<import("../lib/config.js").ReaderConfig>} */
  let patch = {};
  if (isTheme(theme)) patch = { theme };
  else if (isFont(font)) patch = { font };
  else if (isLineHeight(lineHeight)) patch = { lineHeight };
  else if (isAlign(align)) patch = { align };
  else if (isHyphens(hyphens)) patch = { hyphens };
  else if (isParagraphs(paragraphs)) patch = { paragraphs };
  else if (isLayout(layout)) patch = { layout };
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
  // The page dims under whichever panel is open, and clears with the last.
  // The chrome needs no holding meanwhile: it is stuck to the window's top
  // in every view (D219, `.page-chrome` in page.css).
  if (panelScrim !== null) panelScrim.hidden = !anyPanelOpen();
  // A panel just opened is measured before anything has scrolled it.
  dressPanelMore();
}

/**
 * Whether an open panel has anything below its fold (D246), said at its
 * foot by the strip standing there (`.panel-more`, reader.css). The Aa
 * panel's thirteen rows outgrow a phone's window at Firefox for Android's
 * 125%, and the panel scrolled with nothing to say so: on Android the
 * browser's scrollbar is an overlay that fades, and on an e-ink panel a
 * fade is not there at all (Michał, 2026-09-18).
 *
 * Measured, never guessed: the rows' height moves with the text size, the
 * window's with the browser's own bars, and a row can come and go (the Type
 * row's Custom choice). So this is asked on every opening, every scroll of
 * a panel, every resize and every settings change.
 */
function dressPanelMore() {
  for (const panel of [displayPanel, menuPanel]) {
    if (panel === null) continue;
    const more = !panel.hidden && panel.scrollHeight - panel.scrollTop - panel.clientHeight > 1;
    const said = more ? "true" : "false";
    if (panel.dataset["more"] !== said) panel.dataset["more"] = said;
    // The strip is the panel's paper either way; it is a press only while
    // there is something below to bring up, and a stop on the way through
    // the rows only while it is a press.
    const foot = panelFoot(panel);
    const dead = !more;
    if (foot === null || foot.disabled === dead) continue;
    // A button disabled under the focus drops it on the body, and the next
    // Tab starts again from the top of the page: the panel's own button
    // takes it back, the way Escape hands it back from inside a panel.
    if (dead && document.activeElement === foot) (panel === displayPanel ? displayButton : menuButton)?.focus();
    foot.disabled = dead;
  }
}

/**
 * The strip at a panel's foot (`.panel-more`, reader.html).
 *
 * @param {HTMLElement} panel
 * @returns {HTMLButtonElement | null}
 */
function panelFoot(panel) {
  const foot = panel.querySelector(".panel-more");
  return foot instanceof HTMLButtonElement ? foot : null;
}

for (const panel of [displayPanel, menuPanel]) {
  if (panel === null) continue;
  panel.addEventListener("scroll", () => dressPanelMore(), { passive: true });
  // A press on the strip does what its chevron says (D247): it brings up
  // what stands below. One panel's worth of rows less the strip itself, so
  // the row the chevron stood over comes up whole instead of being stepped
  // past - and in one frame, because this is drawn on e-ink panels where a
  // smooth scroll is a smear.
  panelFoot(panel)?.addEventListener("click", () => {
    const foot = panelFoot(panel);
    const step = panel.clientHeight - (foot === null ? 0 : foot.offsetHeight);
    panel.scrollBy({ top: Math.max(step, panel.clientHeight / 2), behavior: "instant" });
  });
}
window.addEventListener("resize", () => dressPanelMore());

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

// The bookmark tab (Michał's design, after a mobileread request): fold the
// bar away, bring it back - a stored choice about the reading surface, so it
// rides the config like every appearance knob and survives the article.
// Folding closes the panels first: they live in the bar being folded, and a
// panel left open under a bar that is gone would be a curtain with no rod.
chromeTab?.addEventListener("click", async () => {
  const folding = !settings.reader.chromeHidden;
  if (folding) closePanels();
  adoptConfig(await writeConfig({ reader: { chromeHidden: folding } }));
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

// Typing asks nothing yet (D173, Michał's call: until then the field filtered
// titles live and the button appeared with the box, so a ticked box could
// stand over a list that had never been asked about the texts): the list
// stands as it is until Search is pressed, and the button lights up
// meanwhile. An emptied box is the one exception - taking the question back
// needs no press: the deep results go and the whole list comes back at once.
libraryFilter?.addEventListener("input", () => {
  if (libraryFilter === null) return;
  if (libraryFilter.value.trim().length === 0 && (libraryQuery.length > 0 || librarySearchShown())) {
    if (librarySearchShown()) dismissLibrarySearch();
    libraryQuery = "";
    libraryPage = 1;
    void refreshLibrary();
  }
  updateSearchControls();
});

// Enter in the box is the button's press, whichever the scope - for hands
// that never leave the keys, and for the search key a phone keyboard shows.
libraryFilter?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  void pressLibrarySearch();
});

// The box changes the scope of the question on screen, not only of the next
// one (D173): ticked over a phrase worth scanning for it runs the deep
// search now, so it never stands over a list that was asked about titles
// alone; unticked it takes the results back to the titles' answer to the
// same words (the list under them narrowed to those at the press).
librarySearchToggle?.addEventListener("change", () => {
  if (librarySearchToggle?.checked === true) {
    if (isSearchableQuery(libraryFilter?.value ?? "")) void pressLibrarySearch();
  } else if (librarySearchShown()) {
    dismissLibrarySearch();
    void refreshLibrary();
  }
  updateSearchControls();
});

librarySearchGo?.addEventListener("click", () => void pressLibrarySearch());
updateSearchControls();

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

// The selection (D152): Select opens it, the bar's cross closes it, and the
// ticks are dropped on the way out - closing means the mode is over, not
// that the choice is kept for a next time nobody can see. The rows are
// rebuilt either way, with or without their boxes. Focus follows the door:
// onto the cross on the way in (the button it stood on is gone), back onto
// the button on the way out.
libraryPickToggle?.addEventListener("click", () => {
  picking = true;
  picked = new Set();
  void refreshLibrary().then(() => libraryPickClose?.focus());
});

libraryPickClose?.addEventListener("click", () => {
  picking = false;
  picked = new Set();
  void refreshLibrary().then(() => libraryPickToggle?.focus());
});

// Select all over the rows it covers: the boxes on screen follow without
// a rebuild - the rows stand, only their ticks change.
libraryPickAll?.addEventListener("change", () => {
  if (libraryPickAll === null) return;
  picked = withAllPicked(picked, libraryShown.selectable, libraryPickAll.checked);
  for (const box of libraryRows?.querySelectorAll("input.library-pick") ?? []) {
    if (box instanceof HTMLInputElement) box.checked = picked.has(box.getAttribute("data-url") ?? "");
  }
  renderPickLine();
});

// One row's box, ticked by itself or through its title: the address joins
// or leaves the selection, and the furniture says so.
libraryRows?.addEventListener("change", (event) => {
  const box = event.target;
  if (!(box instanceof HTMLInputElement) || !box.classList.contains("library-pick")) return;
  const url = box.getAttribute("data-url") ?? "";
  if (url.length === 0) return;
  if (box.checked) picked.add(url);
  else picked.delete(url);
  renderPickLine();
});

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
  else if (act === "speak") void speakMarkRow(row);
  else if (act === "open") void openMarkRow(row);
  else if (act === "note") noteMarkRow(row);
  else if (act === "delete" || act === "delete-all") {
    // The two deletions ask first (D150): the list's own two presses, the
    // second one on the very spot the first one landed. The trash keeps that
    // promise by growing leftward from the column's right edge; the counted
    // words under the note hold their width the article's Delete way - the
    // question is shorter than the label, and a box that shrank to it would
    // leave the finger over paper (Michał's smoke, 2026-08-29).
    if (button.hasAttribute("data-armed")) void deleteMarkRow(button, row, act === "delete-all");
    else {
      if (act === "delete-all") button.style.minWidth = `${button.offsetWidth}px`;
      armDelete(button);
    }
  }
});

marksExportButton?.addEventListener("click", () => void exportMarksPage());

// The link over the rows leads to the export by scrolling, not by its
// fragment: a fragment jump writes a history entry with no state of ours,
// and the popstate that follows reads that as Back under the highlights -
// onto the list, which is where the press landed (Michał's smoke,
// 2026-08-29). The href stays for what a link is; focus lands on the button
// the link is about, the way a same-page link's does.
marksTransferLink?.addEventListener("click", (event) => {
  event.preventDefault();
  document
    .getElementById("marks-transfer")
    ?.scrollIntoView({ behavior: "instant", block: "start" });
  marksExportButton?.focus({ preventScroll: true });
});

noticeClose?.addEventListener("click", () => hideNotice());

noticeAct?.addEventListener("click", () => {
  if (noticeAct === null) return;
  if (noticeAct.hasAttribute("data-armed")) void removeNoticeMark();
  else {
    // The width held for "Sure?", the document-wide act's way: the question
    // is shorter than the words, and the second press must land where the
    // first one did.
    noticeAct.style.minWidth = `${noticeAct.offsetWidth}px`;
    armDelete(noticeAct);
  }
});

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

// The selection's file buttons (D229): each ticked document as a file of
// its own, in the format the button names.
exportEpubButton?.addEventListener("click", () => void exportPickedDocuments("epub"));
exportMarkdownButton?.addEventListener("click", () => void exportPickedDocuments("markdown"));

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
  const kind = importKind({ name: file.name, type: file.type, head });
  if (kind === "book" || kind === "markdown") {
    closeImportOffer();
    transferStatus("");
    await runBookImport(file, kind);
    return;
  }
  if (kind === "archive") {
    // A ZIP nobody has named: its directory says whether it is the list's
    // backup with pictures (D145) or a book - `articles.json` is the word.
    const bytes = new Uint8Array(await file.arrayBuffer());
    const entries = await listEntries(bytes).catch(() => []);
    if (entries.some((entry) => entry.name === BACKUP_ENTRIES.manifest)) {
      // The backup of everything (D213): the manifest is the word.
      bookImportStatus("");
      await offerBackup(file, bytes, entries);
    } else if (entries.some((entry) => entry.name === ARTICLES_ENTRY)) {
      bookImportStatus("");
      await offerArchive(file, bytes, entries);
    } else {
      closeImportOffer();
      transferStatus("");
      await runBookImport(file, "book");
    }
    return;
  }
  bookImportStatus("");
  await offerImport(file);
}

importInput?.addEventListener("change", () => {
  if (importInput === null) return;
  const file = importInput.files?.[0];
  // Cleared so that the same file, picked again, fires this again.
  importInput.value = "";
  if (file !== undefined) void dispatchImport(file);
});

importRun?.addEventListener("click", () => void (pendingBackup !== null ? runBackup() : runImport()));

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
 * A file into the list as a book: an EPUB, or a Markdown text (D230) -
 * the same lock, the same line, the same report, with the words told
 * apart where a text is not a book.
 *
 * @param {File} file
 * @param {"book" | "markdown"} kind
 */
async function runBookImport(file, kind) {
  if (importingBook) return;
  importingBook = true;
  if (importButton instanceof HTMLButtonElement) importButton.disabled = true;
  const importing = (/** @type {string} */ part) =>
    kind === "markdown" ? t("reader_text_importing", part) : t("reader_book_importing", part);
  bookImportStatus(importing("1"));
  try {
    // Progress once per segment written and once per picture kept, not per
    // block - every repaint is a flash on e-ink, and those two are the
    // honest units of "saved so far".
    const importer = kind === "markdown" ? importMarkdown : importEpub;
    const outcome = await importer(file, ({ segments, pictures, bytes }) => {
      const part = Math.max(1, segments).toLocaleString();
      bookImportStatus(
        pictures === 0
          ? importing(part)
          : t("reader_book_importing_pictures", [part, pictures.toLocaleString(), megabytes(bytes)]),
      );
    });
    if (outcome.ok) {
      // With its pictures, where the file held any (D183): the one place
      // the space the book costs is said before its row is opened.
      const kept = outcome.book.pictures;
      bookImportStatus(
        [
          t("reader_book_added", outcome.book.title),
          kept === undefined
            ? ""
            : plural(kept.count, "reader_import_pictures", [megabytes(kept.bytes)]),
        ]
          .filter((sentence) => sentence.length > 0)
          .join(" "),
      );
      await refreshLibrary();
    } else {
      bookImportStatus(
        outcome.reason === "drm"
          ? t("reader_book_drm")
          : kind === "markdown"
            ? t("reader_markdown_unreadable")
            : t("reader_book_unreadable"),
        "error",
      );
    }
  } finally {
    importingBook = false;
    if (importButton instanceof HTMLButtonElement) importButton.disabled = false;
  }
}

for (const button of segmentPrevs) button?.addEventListener("click", () => turnSegment(-1));
// The Next under the text counts the part it leaves as finished (D209),
// registered before the turn so the count reads the part still on screen.
// Only that one: the bar's Next above is a way of moving, the one under the
// last line is a way of arriving, and only arriving counts.
segmentNextEndButton?.addEventListener("click", () => countFinished());
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

bookNoteSettings?.addEventListener("click", () => goToSettings());

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
  // A room over the reading (D243) is the first thing a step reads. Forward
  // into one opens it again; a step out of one takes it away and stops
  // there, because the view underneath never left - unless the room was
  // left FOR somewhere, which its menu's rows ask for on the way out.
  const room = asRoomState(event.state);
  if (room !== null) {
    openRoom(room.kind, room.section, true);
    return;
  }
  const leavingFor = roomLeavingTo;
  roomLeavingTo = null;
  if (roomShown !== null) {
    closeRoom();
    if (afterRoom(leavingFor)) return;
    if (!unwindToList) return;
  }
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
 * The marker in the tab's own `sessionStorage` is the arrow's licence
 * (D140): only a tab that walked there from us has a reader entry behind
 * it, and the tab's own storage is the one store our pages share exactly
 * per-tab. The referrer was the first witness and read empty on both
 * engines - browsers carry referrers only between http(s) documents, and
 * an extension page's scheme is not one. A tab that refuses its storage
 * refuses the arrow; the walk itself still works.
 *
 * Two rooms are walked to: the settings, and since D141 the saved phrases
 * (Michał's call - two neighbouring menu rows must not speak two grammars,
 * and the reading place must stay one gesture away). The highlights row
 * needs no walk at all: the highlights are a view of this very page.
 *
 * Since D147 the walk goes through the background, like every other door
 * to a room of ours: the room's own tab is raised if one stands, and this
 * tab is turned to the room otherwise - which is the walk exactly, history
 * entry and all, since the background navigates this tab the way
 * `location.assign` did. What changes is the first case: a settings tab
 * already open no longer gets a twin. The marker is set before the message
 * either way; it is read only by a settings or phrases page arriving in
 * this tab, and one that arrives here always has this entry behind it. A
 * background mid-restart answers nothing - then the walk is made here, as
 * it was.
 *
 * @param {string} page
 * @param {typeof Message.OPEN_SETTINGS | typeof Message.OPEN_VOCABULARY} kind
 * @param {string} [section] a section of the page to land on, by its anchor
 *   (D192) - carried in the message, and on the fallback as the fragment
 */
function walkTo(page, kind, section) {
  try {
    sessionStorage.setItem(BACK_ROAD_KEY, "reader");
  } catch {
    // The arrow is an enhancement; history carries the gesture regardless.
  }
  const fragment = section === undefined ? "" : `#${section}`;
  void webext()
    .runtime.sendMessage(section === undefined ? { kind } : { kind, section })
    .catch(() => location.assign(webext().runtime.getURL(page) + fragment));
}

/**
 * The rooms of this extension, shown over the reading instead of walked to
 * (D243).
 *
 * The settings and the saved phrases are pages of their own and stay pages:
 * the browser's own Options button opens one, the popup and the bubble open
 * either, and both have to work with no reader anywhere. But walking to them
 * from here cost the full screen every single time - it belongs to the
 * document (the Fullscreen spec ends it in the unloading document cleanup
 * steps) and a walk is a new document, while the reader's own three views
 * keep it because they are three sections of one file. Michał, 2026-09-17,
 * after the 0.5.67 smoke: "theoretically it is one press, but every loss is
 * the picture rescaling and the browser's bar coming back (...) could they
 * not all work like those three?". They can: the page comes here, in a frame
 * of this document, and nothing navigates.
 *
 * The frame is built on opening and taken away on closing, never reused: a
 * frame's FIRST address rewrites its own initial entry, while every later one
 * adds an entry to this tab's history - so a frame thrown away leaves the
 * history exactly as clean as the reader's own views leave it, one entry per
 * opening, and the step back that every platform already offers is the way
 * out (`popstate` below). A framed page cannot walk anywhere by itself, so
 * its bar asks instead (`lib/room-frame.js`), and the asks are read here the
 * way a history entry is read: field by field, source and origin checked.
 */

/** Where each room's page lives, relative to the extension's root. */
const ROOM_PAGE = /** @type {const} */ ({
  settings: "options/options.html",
  vocab: "vocab/vocab.html",
});

/** Which room stands over the reading, or null while the reading has it. */
/** @type {import("../lib/room-frame.js").RoomKind | null} */
let roomShown = null;

/** Whether this tab's history already carries the standing room's entry. */
let roomEntry = false;

/** The entry the standing room will write once its frame reports for duty. */
/** @type {{ kind: import("../lib/room-frame.js").RoomKind, section: string | undefined, replace: boolean } | null} */
let roomPending = null;

/** What the focus goes back to when the room goes. */
/** @type {HTMLElement | null} */
let roomOpener = null;

/** Where the standing room asked to be left for - read by the step back. */
/** @type {"library" | "marks" | null} */
let roomLeavingTo = null;

/**
 * How long a frame has to report for duty before the room gives up on it.
 * Loading a page of our own from the package is a matter of milliseconds;
 * this is not a load budget but the one honest answer to a frame that will
 * never load at all - a policy that refuses it, a page that is not there.
 */
const ROOM_READY_MS = 2000;
let roomWatch = 0;

/**
 * A room opened over the reading. Whatever the reading had in hand is put
 * down first: the room takes the whole window, and a pen, a voice or a
 * bubble left armed underneath it would answer gestures nobody could see.
 * A walk did the same by ending this document; this has to do it on purpose.
 *
 * @param {import("../lib/room-frame.js").RoomKind} kind
 * @param {string} [section] where in the room to land (D192)
 * @param {boolean} [fromHistory] the step into an entry that already names
 *   this room - a forward step, or a reload standing on one; the entry is
 *   there, so none is written
 */
function openRoom(kind, section, fromHistory = false) {
  if (roomBox === null) {
    walkToRoom(kind, section);
    return;
  }
  const standing = roomShown !== null;
  closePanels();
  setMarker(false);
  stopReading();
  dismiss();
  if (!standing) {
    roomOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  const frame = document.createElement("iframe");
  // The room's own name, for whoever hears the frame rather than sees it.
  frame.title = t(kind === "settings" ? "settings" : "saved_phrases");
  frame.src = webext().runtime.getURL(ROOM_PAGE[kind] + (section === undefined ? "" : `#${section}`));
  roomBox.replaceChildren(frame);
  roomBox.hidden = false;
  roomShown = kind;
  // Nothing behind the room answers a key either: the sheet covers the
  // reading, and a Tab that walked into the article under it would move a
  // focus ring nobody can see.
  dressRoomRest(true);
  roomEntry = fromHistory;
  roomPending = null;
  window.clearTimeout(roomWatch);
  frame.focus();
  if (fromHistory) return;
  // The entry is written when the frame reports for duty, not before: a
  // frame that never loads must not leave a step back written for a room
  // nobody can see. Until then the room is a sheet this page can take away.
  roomPending = { kind, section, replace: standing };
  roomWatch = window.setTimeout(() => {
    if (roomShown !== kind || roomEntry) return;
    closeRoom();
    walkToRoom(kind, section);
  }, ROOM_READY_MS);
}

/**
 * The frame reported for duty: the room is real, so it gets its history
 * entry - a new one over the reading, or the standing room's own rewritten
 * when one room leads to the other, because the rooms are one layer over the
 * reading and a step back from either means the reading.
 */
function roomReported() {
  window.clearTimeout(roomWatch);
  const pending = roomPending;
  roomPending = null;
  if (pending === null || roomEntry) return;
  const state = roomState(pending.kind, pending.section);
  if (pending.replace) history.replaceState(state, "");
  else history.pushState(state, "");
  roomEntry = true;
}

/**
 * The room taken away, leaving the view it stood over exactly as it was -
 * this document never left, which is the whole point. The focus goes back to
 * whatever opened the room.
 */
function closeRoom() {
  window.clearTimeout(roomWatch);
  roomPending = null;
  roomShown = null;
  roomEntry = false;
  if (roomBox !== null) {
    roomBox.replaceChildren();
    roomBox.hidden = true;
  }
  dressRoomRest(false);
  const opener = roomOpener;
  roomOpener = null;
  if (opener !== null && opener.isConnected) opener.focus();
}

/**
 * The rest of the page put out of reach while a room stands over it, and
 * given back when it goes: `inert` on everything of ours but the room, so
 * the keyboard and the screen reader stay inside the frame. A browser that
 * does not know the attribute ignores it, and the sheet still covers the
 * reading.
 *
 * @param {boolean} away
 */
function dressRoomRest(away) {
  for (const node of document.body.children) {
    if (node !== roomBox) node.toggleAttribute("inert", away);
  }
}

/**
 * The room's own way out - its bar's arrow - taken as the step back the
 * system's gesture takes, so both land in one place. With no entry written
 * yet there is nothing to step over, and the sheet is simply taken away.
 */
function leaveRoom() {
  if (roomEntry) {
    history.back();
    return;
  }
  // No entry to step over - a frame that has not reported yet. The room is
  // taken away here, and whatever it was left for happens right away rather
  // than waiting for a step that will never come.
  const leavingFor = roomLeavingTo;
  roomLeavingTo = null;
  closeRoom();
  afterRoom(leavingFor);
}

/**
 * What a room was left FOR, done once it is gone: nothing at all for the
 * plain way out, because the view underneath never left - and otherwise the
 * row its menu pressed, answered in the reader's own grammar (D108, D243).
 *
 * @param {"library" | "marks" | null} leavingFor
 * @returns {boolean} whether the leaving was answered here
 */
function afterRoom(leavingFor) {
  if (leavingFor === "library") {
    leaveToList();
    return true;
  }
  if (leavingFor === "marks") {
    hideNotice();
    const scope = shown === null ? null : shown.url;
    history.pushState(marksState(scope), "");
    void showMarks(scope, { fresh: true });
    return true;
  }
  return false;
}

/**
 * The walk this room replaced (D139/D141), kept for the one case that has to
 * survive a frame: no room box in the markup, or a frame that never loaded.
 *
 * @param {import("../lib/room-frame.js").RoomKind} kind
 * @param {string} [section]
 */
function walkToRoom(kind, section) {
  if (kind === "settings") walkTo(ROOM_PAGE.settings, Message.OPEN_SETTINGS, section);
  else walkTo(ROOM_PAGE.vocab, Message.OPEN_VOCABULARY);
}

// What a framed room asks for. Only the standing frame's own window is heard,
// and only from this extension's origin: `message` is a doorway anything can
// knock on, and the ask is validated field by field (`lib/room-frame.js`).
window.addEventListener("message", (event) => {
  if (roomShown === null || roomBox === null) return;
  const frame = roomBox.firstElementChild;
  if (!(frame instanceof HTMLIFrameElement) || event.source !== frame.contentWindow) return;
  if (event.origin !== location.origin) return;
  const ask = asRoomRequest(event.data);
  if (ask === null) return;
  if (ask.act === "ready") {
    roomReported();
    return;
  }
  if (ask.act === "close") {
    leaveRoom();
    return;
  }
  if (ask.act === "view") {
    // A room's menu naming one of the reader's own views: the step back
    // takes the room away first, and the view is shown where that step
    // lands - so the history keeps the grammar the reader's own rows keep.
    roomLeavingTo = ask.view;
    leaveRoom();
    return;
  }
  openRoom(ask.room, ask.section);
});

/**
 * @param {import("../lib/protocol.js").SettingsSection} [section] where on the
 *   page to land (D192) - the top when nothing is named
 */
function goToSettings(section) {
  openRoom("settings", section);
}

// The reader-tab bookkeeping, both halves (D139/D140): this tab is the
// reader for exactly as long as the reader is what it shows. Signed in on
// every arrival - the first load and every return through history, the
// back/forward cache included, which is why `pageshow` and not a plain run -
// and signed out on every way out (`pagehide`): the settings walk, a link
// followed, the tab closing. So the popup's rows raise a real reader, never
// whatever this tab became. A sign-out the browser drops mid-departure is
// caught one floor down anyway: the background verifies the stored id
// against `runtime.getContexts` before raising it (`reader-tab.js`), and
// the same witness adopts a reader this bookkeeping never met.
window.addEventListener("pageshow", () => {
  void webext()
    .tabs.getCurrent()
    .then((tab) => (typeof tab?.id === "number" ? writeReaderTab(tab.id) : undefined))
    .catch(() => undefined);
});
window.addEventListener("pagehide", () => {
  void writeReaderTab(null).catch(() => undefined);
});

// The mark in the bar is the door to the settings - the one line standing over
// every view of this page. The same walk as the menu row's (D139).
brandButton?.addEventListener("click", () => goToSettings());

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

// The pictures row (D145) keeps the panel open: what it starts is watched
// from where it was started - the row is the progress and the stop.
navPictures?.addEventListener("click", () => {
  void onPicturesPress();
});
// The line under the header (D231) presses the same act as the menu's row:
// one handler, one state, two places to meet it.
picturesOfferButton?.addEventListener("click", () => {
  void onPicturesPress();
});

// The export rows (D229) keep the panel open like the pictures row: the
// line under the pressed row is where the report lands.
navExportEpub?.addEventListener("click", () => {
  void onExportPress("epub");
});
navExportMarkdown?.addEventListener("click", () => {
  void onExportPress("markdown");
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
  // The settings row's walk, not the popup's raise (D141): a message used to
  // bring the one phrases tab forward, and the article was left behind with
  // no way back - two neighbouring rows, two grammars (Michał's report). The
  // popup and the settings menu keep raising: no reading place stands behind
  // them. Since D243 the row opens the phrases HERE, in a frame of this
  // document, so the visit costs neither the reading's place nor the full
  // screen; the walk stays underneath it as the fallback (`walkToRoom`).
  openRoom("vocab");
});

navSettings?.addEventListener("click", () => {
  setPanel(menuButton, menuPanel, false);
  goToSettings();
});

// The full-screen row (D180). Firefox for Android folds its address bar
// only under a finger scrolling down and brings it back with every scroll
// up - and never moves it for the page keys an e-reader turns pages with
// (`NestedGeckoView` hands the toolbar touch moves and nothing else), so on
// a Boox the bar stood over the article for good (Michał's photo,
// 2026-09-04). The Fullscreen API is the one door a browser leaves open to
// a page: Fenix takes its toolbar and Android's status bar away and gives
// them back on Back, a desktop on Esc. The request has to ride a press of
// the reader's own - a browser refuses one made on load - so the row is the
// whole mechanism: no setting remembers the choice, and a reloaded tab asks
// again. The root, not the body, so the fixed bars keep their viewport.
// Hidden where the browser has no full screen to give (the API absent, or
// switched off); a request refused after that is the browser's word in its
// own console, and nothing the page could add to.
if (navFullscreen !== null) navFullscreen.hidden = !document.fullscreenEnabled;
navFullscreen?.addEventListener("click", () => {
  setPanel(menuButton, menuPanel, false);
  if (document.fullscreenElement !== null) void document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
});

// The bar's own full-screen tool (D195, Michał's ask for the Boox), the one
// every page wears since D220 (`lib/fullscreen-tool.js`): the request
// inside the press, the open panel put away first, the name and the room
// following the browser and the row - in every view, the list's included,
// on every platform. It no longer folds the bar (D220): the bar stays, and
// the ribbon folds it on its own.
refreshFullscreenTool = armFullscreenTool(fullscreenTool, closePanels);

keepButton?.addEventListener("click", () => void onKeepPress());
for (const button of [removeButton, removeEndButton]) {
  button?.addEventListener("click", () => void onRemovePress(button));
}
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
  fold: textFold,
  // Read by pages (D233), the spoken line is kept on screen by turning to
  // its page, not by scrolling it into a band - the page it is on stays
  // exactly as it stands until the voice leaves it.
  reveal: revealOnPage,
  onChange: showSpeechBar,
  // The engine refusing is the one thing reading aloud can do that leaves
  // nothing on screen to explain itself, so it is said in the page's own
  // notice line rather than in a bar that has just disappeared.
  onFail: () => showNotice(t("reader_speech_failed")),
  // The same line for the one refusal that is ours, not the engine's (D155):
  // the device has voices, and none of them reads this language offline.
  onNoVoice: () => showNotice(t("speech_no_offline_voice")),
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
 * @param {(keyboard: boolean) => void} act told which kind of press it was
 */
function onSpeechPress(id, act) {
  document.getElementById(id)?.addEventListener("click", (event) => {
    const keyboard = event.detail === 0;
    if (!keyboard && event.currentTarget instanceof HTMLElement) {
      event.currentTarget.blur();
    }
    act(keyboard);
  });
}

/**
 * The speaker in the bar at the top is the switch, and the bar at the bottom
 * is the transport (D227). Lit, the voice is on - reading or paused - and a
 * press on it lit turns the voice off, the way the pen beside it pressed again
 * puts the pen down. Pause and resume live on the transport and on the space
 * bar; a third copy of them up here, far from the thumb on a phone, left a lit
 * speaker over silence (Michał, 2026-09-15: the speaker pressed, the bar
 * saying Resume).
 *
 * A start from the keyboard hands the focus to the transport's Pause. The
 * button pressed keeps the focus otherwise (`onSpeechPress`), and a focused
 * button answers the space bar by pressing itself (`lib/reader/keys.js`) -
 * which, with the speaker now a switch, would make the first space bar after a
 * keyboard start stop the reading instead of pausing it. On the transport the
 * space bar means what it means in every player.
 *
 * @param {boolean} keyboard
 */
function onListenPress(keyboard) {
  if (readingState() !== "off") {
    stopReading();
    return;
  }
  startReading();
  // Only when the voice really started: an engine that refused, or a language
  // no voice on this device reads offline, leaves no bar to stand on.
  if (keyboard && readingState() !== "off") speechPlayButton?.focus();
}

onSpeechPress("listen", onListenPress);
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

// The engine's voice list arrives on its own schedule - after first paint on
// most platforms, never at all on some (Android speaks anyway, see
// `lib/tts.js`). The bare API question, not `canSpeak`: the listener watches
// the engine, and the rows it redraws follow the settings (`applySpeech`).
if (speechSupported()) speechSynthesis.addEventListener("voiceschanged", renderVoiceChoice);

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

// Footnotes (mobileread request, accepted plan): a book's noterefs arrive as
// `a[data-note]` - the note's text resolved at import (import-book.js), no
// href, no navigation. A press opens the text in a small popover beside the
// mark; the next press, a press anywhere else, or Escape takes it away.
// One popover, reused - created on first use, filled through textContent
// alone, absolutely positioned so it rides the document with its mark.

/** @type {HTMLElement | null} */
let notePopover = null;
/** The mark the popover stands by; its aria-expanded is the state. */
/** @type {Element | null} */
let noteMarkShown = null;

function hideNotePopover() {
  if (notePopover !== null) notePopover.hidden = true;
  noteMarkShown?.setAttribute("aria-expanded", "false");
  noteMarkShown = null;
}

/** @param {Element} mark */
function showNotePopover(mark) {
  if (notePopover === null) {
    notePopover = document.createElement("div");
    notePopover.className = "note-popover";
    // Plain prose, announced as a note; focus stays on the mark, whose
    // aria-expanded says what happened.
    notePopover.setAttribute("role", "note");
    document.body.append(notePopover);
  }
  noteMarkShown?.setAttribute("aria-expanded", "false");
  notePopover.textContent = mark.getAttribute("data-note") ?? "";
  notePopover.hidden = false;
  noteMarkShown = mark;
  mark.setAttribute("aria-expanded", "true");

  // Placed after the text is in, because width decides height. Below the
  // mark, clamped to the window's edges; above it only when below would
  // run off the screen and above actually fits.
  const rect = mark.getBoundingClientRect();
  notePopover.style.left = "0px";
  notePopover.style.top = "0px";
  const box = notePopover.getBoundingClientRect();
  const width = document.documentElement.clientWidth;
  const left = Math.max(8, Math.min(rect.left, width - box.width - 8));
  let top = rect.bottom + 6;
  if (top + box.height > window.innerHeight && rect.top - 6 - box.height > 0) {
    top = rect.top - 6 - box.height;
  }
  notePopover.style.left = `${left + window.scrollX}px`;
  notePopover.style.top = `${top + window.scrollY}px`;
}

/** @param {Element} mark */
function toggleNotePopover(mark) {
  if (noteMarkShown === mark) hideNotePopover();
  else showNotePopover(mark);
}

/**
 * The marks dressed for the hand and the keyboard, after every render: an
 * anchor without an href is not focusable on its own, and a screen reader
 * should hear what the little number does.
 */
function applyNoteMarks() {
  if (contentElement === null) return;
  for (const mark of contentElement.querySelectorAll("a[data-note]")) {
    mark.setAttribute("tabindex", "0");
    mark.setAttribute("role", "button");
    mark.setAttribute("aria-expanded", "false");
    mark.setAttribute("aria-label", t("reader_footnote_aria", (mark.textContent ?? "").trim()));
  }
}

// A press anywhere else puts the note away - except on the mark itself,
// whose click is about to toggle it (closing here would reopen it there).
document.addEventListener("pointerdown", (event) => {
  if (noteMarkShown === null) return;
  const target = event.target;
  if (target instanceof Node && notePopover?.contains(target) === true) return;
  if (target instanceof Node && noteMarkShown.contains(target)) return;
  hideNotePopover();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && noteMarkShown !== null) hideNotePopover();
});

// The keyboard's press on a mark: role=button promises Enter and Space, and
// an anchor without an href delivers neither on its own.
contentElement?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const mark = event.target instanceof Element ? event.target.closest("a[data-note]") : null;
  if (mark === null) return;
  event.preventDefault();
  toggleNotePopover(mark);
});

// A link set to plain text must not answer a press (D95): the stylesheet took
// its dress, this takes its click - including the Enter of a focus restored by
// other means, which arrives here as a click too. `auxclick` besides, because
// a middle click opens a tab without ever firing `click`. The mode is read at
// press time, so the switch in the panel needs no rewiring here.
/** @param {MouseEvent} event */
function onArticleLink(event) {
  // A footnote mark answers in place, whatever the links mode says - it is
  // not a link any more, and nothing about it navigates.
  const mark = event.target instanceof Element ? event.target.closest("a[data-note]") : null;
  if (mark !== null) {
    event.preventDefault();
    if (event.type === "click" && event.button === 0) toggleNotePopover(mark);
    return;
  }
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
    covered: textFold,
    // The bubble's own door to the settings - an error's one button - walks
    // the same road as the bar's mark (D139): this tab, so the way back
    // exists. Everywhere else the bubble keeps asking the background.
    openSettings: (section) => goToSettings(section),
    plainLinks: () => settings.reader.links === "plain",
    // The bubble dresses for the paper it stands on: the reader's theme by
    // name, asked live because the Aa panel can change it mid-session.
    // `auto` names nothing - the browser answers there, and so does the
    // bubble's own media query.
    scheme: () => (settings.reader.theme === "auto" ? null : settings.reader.theme),
    // How many saved phrases the paint found in the text (D226), for the
    // header line - only over a document: the highlights page roots the
    // side over its quote rows, and their count is nobody's text.
    onPainted: (found) => {
      if (readingGround !== article) return;
      foundPhrases = found;
      renderFacts();
    },
    // A press that found nothing to put away (D233): read by pages, the
    // page turns on it - the outer thirds of the window, the way every
    // e-reader turns - and nothing happens on it otherwise, as before.
    onBareTap,
    // The highlighter's hooks (D106): whether the pen is in the hand, where
    // marks may anchor (the rebuilt content - the reader's own title has no
    // block order to write against), what a finished stroke becomes, and what
    // a tap means while the pen is up. The delete bubble is ours the way the
    // translation bubble is - presses on it must not read as the page's. So
    // are the pictures line under the header (D231) and the site line over
    // it (D232): a hold on the press is a press held, a hold on the arrow is
    // the browser's own gesture on a link, and the site's name is no word
    // to look up - none of them a word to select.
    alsoOwns: (target) =>
      target instanceof Node &&
      (markBar?.contains(target) === true ||
        picturesOffer?.contains(target) === true ||
        sourceLine?.contains(target) === true),
    marking: () => markerOn,
    markRoot: () => contentRoot(),
    onMarked: (range) => void onMarked(range),
    // A stroke taking its first word: whatever mark was active is about to be
    // stale - its pins would stand over yesterday's outline while the new one
    // is drawn (Michał's report).
    onMarkStart: () => deselectMark(),
    onMarkTap,
    // The active mark's pins as handles (D181): where a press finds one,
    // what the drag taking lifts, and what its end rewrites.
    markHandleAt,
    onMarkResizeStart,
    onMarkStretch,
    onMarkResized: (range) => void onMarkResized(range),
    // The page turned under a range stretched to the window's edge
    // (D239): where the pointer stands, when the stretch is over, and
    // where the stretch is read at the edge - the page's own edge.
    onStretch,
    onStretchEnd: disarmEdge,
    stretchPoint,
    // The no-translation trim's two hands (D121): the dictionaries and the
    // voice of the document on screen. The dictionaries by the one rule every
    // page asks in (D191, `languagesToAsk`): the pair's source first, the
    // document's own declaration second, for the word the pair's dictionaries
    // did not know. The voice by the rule the voice panel already lives by
    // (`speechLang`) - the document's own declaration first, the pair's
    // source as the stand-in - because reading the whole document aloud has
    // to go in one voice, and the bubble's is the same one. Only over a
    // document: the quote rows of the highlights page show many documents at
    // once, and a lookup in a guessed language would find real entries for
    // words nobody asked about.
    quietLookup: (text) =>
      shown === null
        ? Promise.resolve(null)
        : lookUpAnswer(text, { pair: settings.sourceLang, declared: primaryLanguage(article?.getAttribute("lang") ?? "") }),
    quietVoice: () =>
      shown === null
        ? null
        : { lang: speechLang(), voiceURI: settings.ttsVoices[primaryLanguage(speechLang())] },
  });
}

// The load-time ask is the one that may be a reload standing on a document's
// history entry - the only caller allowed to reopen from it (D102).
void showPage(true);

// A reload standing on a room's entry (D243) opens that room again, over
// whatever view the line above lands on: the entry says a room stood here,
// and a reload that swallowed the visit would be a step nobody took.
const roomStanding = asRoomState(history.state);
if (roomStanding !== null) openRoom(roomStanding.kind, roomStanding.section, true);
