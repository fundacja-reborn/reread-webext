/**
 * Searching the settings (D254, P10). Thirty settings across nine sections is
 * more than anybody scans, and Ctrl+F only finds the words that happen to be
 * on screen - not the half of a description folded away, and not the section a
 * row belongs to.
 *
 * The index is the page itself, read once: a row's name, the sentence under
 * it, the rest behind its More, the names of the section and subsection it
 * stands in, and whatever keywords the catalogue offers for it. What is
 * deliberately not in it: the hundreds of catalogue rows of models and
 * dictionaries, the list of switched-off sites, and whatever somebody typed
 * into the CSS field - those are data, and a search over them would answer
 * with the data rather than with the setting.
 *
 * A row hidden because its own switch is off is still found (Michał's call,
 * 2026-09-18): it comes back disabled, with a line saying which switch brings
 * it - so "bubble" finds "No bubble when selecting text" even when the mode it
 * belongs to is off.
 */

import { plural, t } from "../lib/i18n.js";

/** How long after the last keystroke the page redraws. */
const SETTLE = 200;

/**
 * A word as the index and the query both spell it: lower case, and without the
 * marks a keyboard makes hard to reach. NFD takes the accents off the Latin
 * letters that decompose; the Polish crossed l does not decompose at all and
 * is named here, which is the whole of the exception. Cyrillic is left as it
 * is - it has no such marks to take off, and the decomposition would only
 * split the letters that carry breves.
 *
 * @param {string} text
 * @returns {string}
 */
export function folded(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036F]", "g"), "")
    .replace(new RegExp("\\u0142", "g"), "l");
}

/**
 * The words a query asks for. Every one of them has to be somewhere in a row
 * for the row to answer - the way a person types "voice speed" meaning both.
 *
 * @param {string} query
 * @returns {string[]}
 */
export function tokens(query) {
  return folded(query)
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

/**
 * @param {string} haystack already folded
 * @param {string[]} wanted
 */
function holdsAll(haystack, wanted) {
  return wanted.every((word) => haystack.includes(word));
}

/**
 * Whether a piece of the page answers a query - the whole of the rule, in one
 * place, so it can be held to examples without a browser: every word of the
 * query somewhere in the text, each of them folded the same way.
 *
 * @param {string} text
 * @param {string} query
 * @returns {boolean}
 */
export function answers(text, query) {
  const wanted = tokens(query);
  return wanted.length > 0 && holdsAll(folded(text), wanted);
}

/**
 * The page's own index, built from the DOM once the catalogue's words are in
 * it. Each row carries what it can be found by; each section carries its name,
 * so a hit on "dictionaries" shows the whole subsection rather than the one
 * row that happens to say the word.
 *
 * @typedef {{ element: HTMLElement, text: string, control: HTMLElement | null,
 *   name: HTMLElement | null, hint: HTMLElement | null, more: HTMLElement | null }} Row
 * @typedef {{ element: HTMLElement, heading: HTMLElement, text: string, rows: Row[], sections: Part[], blocks: HTMLElement[] }} Part
 */

/** @type {Part[]} */
let index = [];

/** Which More paragraphs stood open before a search began. */
let opened = new Set();

/** Whether a query is in force - the page reads differently while one is. */
let searching = false;

/**
 * What a row can be found by: its name, its sentence, the rest of it, and the
 * keywords the catalogue offers.
 *
 * @param {HTMLElement} row
 * @param {string} inherited the names of the section and subsection above it
 * @returns {Row}
 */
function readRow(row, inherited) {
  const name = row.querySelector(".row-name");
  const hint = row.querySelector(".row-note:not(.row-more) > span[data-i18n], .row-note[data-i18n]");
  const more = row.querySelector(".row-more");
  const keywords = row.dataset["keywords"] ?? "";
  const words = [
    name?.textContent ?? "",
    hint?.textContent ?? "",
    more?.textContent ?? "",
    keywords.length > 0 ? t(keywords) : "",
    inherited,
  ];
  return {
    element: row,
    text: folded(words.join(" ")),
    control: row.querySelector("input, select, button:not(.note-more)"),
    name: name instanceof HTMLElement ? name : null,
    hint: hint instanceof HTMLElement ? hint : null,
    more: more instanceof HTMLElement ? more : null,
  };
}

/**
 * One section and everything under it. The blocks are a section's own content
 * that is not a row - its intro, the catalogues, the by-hand folds: shown
 * whole when the section itself answers the query, and out of the way when
 * only one of its rows does.
 *
 * @param {HTMLElement} section
 * @param {string} inherited
 * @returns {Part}
 */
function readSection(section, inherited) {
  const heading = section.querySelector("h2, h3");
  const title = heading?.textContent ?? "";
  const keywords = section.dataset["keywords"] ?? "";
  const text = folded([inherited, title, keywords.length > 0 ? t(keywords) : ""].join(" "));

  /** @type {Row[]} */
  const rows = [];
  /** @type {Part[]} */
  const sections = [];
  /** @type {HTMLElement[]} */
  const blocks = [];
  for (const child of section.children) {
    if (!(child instanceof HTMLElement)) continue;
    if (child === heading) continue;
    if (child.tagName === "SECTION") {
      sections.push(readSection(child, text));
      continue;
    }
    if (child.classList.contains("rows")) {
      for (const row of child.querySelectorAll(":scope > .row")) {
        if (row instanceof HTMLElement) rows.push(readRow(row, text));
      }
      blocks.push(child);
      continue;
    }
    blocks.push(child);
  }
  return { element: section, heading: heading instanceof HTMLElement ? heading : section, text, rows, sections, blocks };
}

/** Read the page. Called once, after it is in the catalogue's language. */
function build() {
  const main = document.querySelector("main");
  if (main === null) return;
  index = [];
  for (const section of main.children) {
    if (section instanceof HTMLElement && section.tagName === "SECTION") index.push(readSection(section, ""));
  }
}

/**
 * Put `<mark>` around what was typed, inside one element that holds text only.
 * The element's own words are kept the first time, so clearing the query puts
 * them back exactly - no re-reading of a page the search has already changed.
 *
 * @param {HTMLElement | null} element
 * @param {string[]} wanted
 */
function markHits(element, wanted) {
  if (element === null) return;
  const plain = element.dataset["plain"] ?? element.textContent ?? "";
  element.dataset["plain"] = plain;
  if (wanted.length === 0) {
    element.textContent = plain;
    return;
  }
  const haystack = folded(plain);
  /** @type {[number, number][]} */
  const spans = [];
  for (const word of wanted) {
    let at = haystack.indexOf(word);
    while (at >= 0) {
      spans.push([at, at + word.length]);
      at = haystack.indexOf(word, at + word.length);
    }
  }
  spans.sort((one, two) => one[0] - two[0]);
  element.replaceChildren();
  let at = 0;
  for (const [from, to] of spans) {
    if (from < at) continue;
    if (from > at) element.append(plain.slice(at, from));
    const hit = document.createElement("mark");
    hit.className = "hit";
    hit.textContent = plain.slice(from, to);
    element.append(hit);
    at = to;
  }
  if (at < plain.length) element.append(plain.slice(at));
}

/**
 * A row the page is showing only because the search found it, with the switch
 * that would bring it switched off (Michał's call, 2026-09-18). It stands
 * there with its controls dead and one line saying what to press - "bubble"
 * has to find the bubble switch whatever mode the page is in.
 *
 * @param {Row} row
 * @param {boolean} blocked
 */
function block(row, blocked) {
  // Only a dependent row is ever blocked, and only a blocked row is ever
  // re-enabled: the page disables controls of its own (the Listen button with
  // no offline voice, the copy switch mid-build), and a search clearing itself
  // must not hand those back.
  if (row.element.dataset["parent"] === undefined) return;
  const was = row.element.classList.contains("row-blocked");
  if (was === blocked) return;
  row.element.classList.toggle("row-blocked", blocked);
  for (const control of row.element.querySelectorAll("input, select, button:not(.note-more)")) {
    if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLButtonElement)) {
      continue;
    }
    if (blocked) {
      if (control.disabled) control.dataset["wasOff"] = "";
      control.disabled = true;
    } else {
      control.disabled = "wasOff" in control.dataset;
      delete control.dataset["wasOff"];
    }
  }
  const existing = row.element.querySelector(".row-why");
  if (!blocked) {
    existing?.remove();
    return;
  }
  if (existing !== null) return;

  const parent = document.querySelector(`.row[data-setting="${row.element.dataset["parent"] ?? ""}"]`);
  const label = parent?.querySelector(".row-name")?.textContent ?? "";
  const why = document.createElement("p");
  why.className = "row-note row-why";
  why.append(`${t("options_blocked_by")} `);
  const door = document.createElement("a");
  door.href = `#${parent?.id ?? ""}`;
  door.textContent = label;
  why.append(door, t("options_blocked_by_rest"));
  row.element.append(why);
}

/**
 * Show what answers the query and put the rest away.
 *
 * @param {Part} part
 * @param {string[]} wanted
 * @param {boolean} inherited whether a section above already answered
 * @returns {number} how many rows are on screen under this part
 */
function filterPart(part, wanted, inherited) {
  const whole = inherited || (wanted.length > 0 && holdsAll(part.text, wanted));
  let shown = 0;

  for (const row of part.rows) {
    const hit = whole || holdsAll(row.text, wanted);
    // A row whose switch is off is found all the same, and says what to press.
    const dependent = row.element.dataset["parent"] !== undefined;
    const parent = dependent
      ? document.querySelector(`.row[data-setting="${row.element.dataset["parent"]}"] input[type="checkbox"]`)
      : null;
    const off = parent instanceof HTMLInputElement && !parent.checked;
    row.element.hidden = !hit;
    block(row, hit && dependent && off);
    if (hit) {
      shown += 1;
      markHits(row.name, wanted);
      markHits(row.hint, wanted);
      if (row.more !== null) {
        // Open where the rest of the note is what matched, and closed again
        // when the next query no longer needs it - unless the reader had it
        // open before the search began.
        const inRest = !whole && holdsAll(folded(row.more.dataset["plain"] ?? row.more.textContent ?? ""), wanted);
        const open = inRest || opened.has(row.more.id);
        row.more.hidden = !open;
        row.more.previousElementSibling?.querySelector(".note-more")?.setAttribute("aria-expanded", String(open));
      }
    }
  }

  for (const inner of part.sections) shown += filterPart(inner, wanted, whole);

  // A section's own content - its intro, the catalogues, the by-hand folds -
  // belongs to the section, not to a row: it stands when the section itself
  // answered, and steps aside when only one of its rows did.
  for (const element of part.blocks) {
    if (element.classList.contains("rows")) continue;
    element.hidden = !whole;
  }
  part.element.hidden = !whole && shown === 0;
  return shown;
}

/** Put the page back the way it was before anybody typed. */
function clearFilter() {
  for (const part of index) restorePart(part);
  const steps = document.getElementById("first-steps");
  if (steps !== null && steps.dataset["searchHid"] !== undefined) {
    steps.hidden = false;
    delete steps.dataset["searchHid"];
  }
}

/** @param {Part} part */
function restorePart(part) {
  part.element.hidden = false;
  for (const row of part.rows) {
    row.element.hidden = false;
    block(row, false);
    markHits(row.name, []);
    markHits(row.hint, []);
    if (row.more !== null) {
      const open = opened.has(row.more.id);
      row.more.hidden = !open;
      row.more.previousElementSibling?.querySelector(".note-more")?.setAttribute("aria-expanded", String(open));
    }
  }
  for (const element of part.blocks) {
    if (!element.classList.contains("rows")) element.hidden = false;
  }
  for (const inner of part.sections) restorePart(inner);
}

/**
 * The table of contents while a query is in force: the sections with nothing
 * to show are dimmed rather than removed, so the list keeps its shape and a
 * press on one of them is refused rather than silently doing nothing.
 */
function dimSections() {
  for (const link of document.querySelectorAll("#sections a[href^='#']")) {
    if (!(link instanceof HTMLAnchorElement)) continue;
    const section = document.getElementById(link.hash.slice(1));
    const owner = section?.closest("section, details") ?? null;
    const empty = searching && (owner === null || (owner instanceof HTMLElement && owner.hidden !== false));
    link.setAttribute("aria-disabled", String(empty));
    link.classList.toggle("is-empty", empty === true);
  }
}

/**
 * Say what was found, under the field. A number of settings, or - when there
 * are none - what was asked for and the way out of it.
 *
 * @param {number} found
 * @param {string} query
 */
function tell(found, query) {
  const line = document.getElementById("search-status");
  if (line === null) return;
  line.replaceChildren();
  if (query.length === 0) {
    line.hidden = true;
    return;
  }
  line.hidden = false;
  if (found > 0) {
    line.append(plural(found, "options_search_found"));
    return;
  }
  line.append(`${t("options_search_none", query)} `);
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "note-more";
  clear.textContent = t("options_search_clear");
  clear.addEventListener("click", () => {
    const field = document.getElementById("settings-search-field");
    if (field instanceof HTMLInputElement) {
      field.value = "";
      field.focus();
    }
    run("");
  });
  line.append(clear);
}

/**
 * @param {string} query
 */
function run(query) {
  const wanted = tokens(query);
  const was = searching;
  searching = wanted.length > 0;
  document.body.classList.toggle("searching", searching);

  if (!was && searching) {
    // Which Mores stood open is the reader's own doing, and it comes back
    // when the query goes.
    opened = new Set();
    for (const rest of document.querySelectorAll(".row-more")) {
      if (rest instanceof HTMLElement && !rest.hidden) opened.add(rest.id);
    }
    const steps = document.getElementById("first-steps");
    if (steps !== null && !steps.hidden) {
      steps.hidden = true;
      steps.dataset["searchHid"] = "";
    }
  }

  if (!searching) {
    // Only undo what a search did: Escape on an empty field is not a reason
    // to close the notes somebody opened by hand.
    if (was) clearFilter();
    tell(0, "");
    dimSections();
    return;
  }

  let found = 0;
  for (const part of index) found += filterPart(part, wanted, false);
  tell(found, query.trim());
  dimSections();
}

/**
 * The bar's two shapes (F4). Below 60rem the bar holds one thing at a time:
 * the section being read, as a title, or the search field over it. Above it
 * both stand - the title's place is the wordmark's, and the field has the
 * column of text to itself.
 *
 * @param {boolean} open
 */
function setOpen(open) {
  const wide = window.matchMedia("(min-width: 60rem)").matches;
  const searching = open && !wide;
  document.getElementById("search-open")?.setAttribute("aria-expanded", String(open));
  const magnifier = document.getElementById("search-open");
  const cross = document.getElementById("search-close");
  if (magnifier instanceof HTMLElement) magnifier.hidden = wide || searching;
  if (cross instanceof HTMLElement) cross.hidden = wide || !searching;
  const field = document.getElementById("settings-search");
  if (field instanceof HTMLElement) field.hidden = !wide && !searching;
  const jump = document.getElementById("section-jump");
  if (jump instanceof HTMLElement) jump.hidden = wide || searching;
}

/**
 * The bar, dressed for the width it has now. Called at open and whenever the
 * window crosses the breakpoint: the field is always in the bar, so nothing
 * moves in the DOM - only which of the bar's things are drawn changes.
 */
function fitBar() {
  const wide = window.matchMedia("(min-width: 60rem)").matches;
  setOpen(wide ? false : document.getElementById("search-open")?.getAttribute("aria-expanded") === "true");
}

/** Wire it all up. Called once, after the page is in its language. */
export function armSearch() {
  build();
  fitBar();
  window.matchMedia("(min-width: 60rem)").addEventListener("change", fitBar);

  const field = document.getElementById("settings-search-field");
  if (!(field instanceof HTMLInputElement)) return;

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let settling;
  field.addEventListener("input", () => {
    clearTimeout(settling);
    // A redraw per keystroke is a full refresh per keystroke on an e-ink
    // panel; the page waits for the typing to stop.
    settling = setTimeout(() => run(field.value), SETTLE);
  });

  field.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      field.value = "";
      clearTimeout(settling);
      run("");
      closeField();
      return;
    }
    if (event.key !== "Enter") return;
    // Enter hands the reading over to what was found: the first row's own
    // control, which is what somebody came here to change.
    event.preventDefault();
    clearTimeout(settling);
    run(field.value);
    for (const part of index) {
      const first = firstControl(part);
      if (first !== null) {
        first.focus();
        return;
      }
    }
  });

  document.getElementById("search-close")?.addEventListener("click", () => {
    field.value = "";
    run("");
    closeField();
  });

  document.getElementById("search-open")?.addEventListener("click", () => {
    const open = document.getElementById("search-open")?.getAttribute("aria-expanded") === "true";
    setOpen(!open);
  });

  // The slash every search field on the web answers to - unless the typing is
  // going somewhere else already.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
    const focus = document.activeElement;
    if (focus instanceof HTMLInputElement || focus instanceof HTMLTextAreaElement || focus instanceof HTMLSelectElement) return;
    event.preventDefault();
    setOpen(true);
    field.focus();
  });
}

/**
 * The first control the search left on screen, in the page's own order.
 *
 * @param {Part} part
 * @returns {HTMLElement | null}
 */
function firstControl(part) {
  if (part.element.hidden) return null;
  for (const row of part.rows) {
    if (!row.element.hidden && row.control instanceof HTMLElement && !row.element.classList.contains("row-blocked")) {
      return row.control;
    }
  }
  for (const inner of part.sections) {
    const found = firstControl(inner);
    if (found !== null) return found;
  }
  return null;
}

/** The bar's field folds away again, on Escape and on the cross. */
function closeField() {
  if (window.matchMedia("(min-width: 60rem)").matches) return;
  setOpen(false);
  document.getElementById("search-open")?.focus();
}
