/**
 * The reader page: ask for the page the button was pressed on, turn it into an
 * article, and render it.
 *
 * Three things happen here and each is somewhere else's decision:
 *
 *   - the page arrives as one answer to one question (`read-page`). Nothing
 *     about it is stored at either end;
 *   - Readability runs *here*, on a document parsed by `DOMParser`, which has no
 *     browsing context and therefore runs nothing and loads nothing. Not in the
 *     content script, where 88 KB would be paid for by every page anybody opens,
 *     and not in the background, which has no DOM in Chromium;
 *   - what comes out is rebuilt element by element from an allowed list
 *     (`src/lib/reader/`), never assigned as `innerHTML`.
 */

import { rescan, start } from "../content/reading.js";
import { webext } from "../lib/browser.js";
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
import { ErrorCode, Message, asPage, asResult } from "../lib/protocol.js";
import { buildArticle } from "../lib/reader/article.js";
import { READER_SOURCE_KEY } from "../lib/session.js";

/** Vendored, loaded by its own script tag, and the only global this page uses. */
const Readability = /** @type {ReadabilityConstructor} */ (
  /** @type {Record<string, unknown>} */ (globalThis)["Readability"]
);

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

/**
 * @param {string} text
 */
function showNotice(text) {
  if (notice === null) return;
  notice.textContent = text;
  notice.hidden = false;
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
 * @param {import("../lib/protocol.js").Page} page
 */
function render(page) {
  if (article === null || contentElement === null || titleElement === null) return;

  const parsed = new DOMParser().parseFromString(page.html, "text/html");
  setBase(parsed, page.url);

  // Readability rewrites the document it is given. That document is this
  // throwaway parse of somebody else's page, which is the only kind it should
  // ever get - never a live one.
  const found = new Readability(parsed).parse();
  if (found === null || typeof found.content !== "string") {
    showNotice("There was no article to find on that page.");
    return;
  }

  const body = new DOMParser().parseFromString(found.content, "text/html").body;
  const rebuilt = buildArticle(body, document, { baseUrl: page.url });

  titleElement.textContent = found.title ?? page.title;
  if (bylineElement !== null) {
    const credit = [found.byline, found.siteName].filter((one) => typeof one === "string" && one);
    bylineElement.textContent = credit.join(" - ");
    bylineElement.hidden = credit.length === 0;
  }

  // The direction and language of the article, not of the extension: a page in
  // Arabic has to lay out as one, and `lang` is what a spell checker and a
  // screen reader go by.
  if (typeof found.dir === "string" && found.dir !== "") article.setAttribute("dir", found.dir);
  if (typeof found.lang === "string" && found.lang !== "") article.setAttribute("lang", found.lang);

  contentElement.replaceChildren(rebuilt);
  article.hidden = false;
  if (notice !== null) notice.hidden = true;

  // The underlines are found again now that there is different text under the
  // same element. Nothing is asked of storage: the vocabulary did not change,
  // only what it can be found in.
  rescan();

  if (originalLink instanceof HTMLAnchorElement) {
    originalLink.href = page.url;
    originalLink.target = "_blank";
    originalLink.rel = "noreferrer noopener";
    originalLink.hidden = false;
  }
  document.title = `${titleElement.textContent} - re/read`;
}

async function showPage() {
  const response = await webext().runtime.sendMessage({ kind: Message.READ_PAGE });
  const result = /** @type {import("../lib/protocol.js").Result<unknown>} */ (asResult(response));

  if (!result.ok) {
    // An article already on screen stays there. Pressing the button on a page
    // that cannot be read is a thing that happens; losing what somebody was
    // reading because of it would be a punishment for it.
    showNotice(describeError(result.code));
    return;
  }

  const page = asPage(result.value);
  if (page === null) {
    showNotice(describeError(ErrorCode.INTERNAL));
    return;
  }
  render(page);
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

// The same reading side as on any other page, scoped to the article: the
// reader's own heading and links are not text anybody is learning from, and
// nothing in this document changes unless the code above changes it, so there
// is nothing for an observer to watch.
start({ root: article, observe: false });

void showPage();
