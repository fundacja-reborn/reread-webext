/**
 * The settings page's own navigation (D254): the table of contents beside the
 * page, the same list in the bar's select where there is no room for a column,
 * the marker that says which section is being read, and the landing every
 * `#address` makes.
 *
 * One list, two shapes. The links in the markup are the source: the select is
 * built from them, so a section can never be in one and missing from the
 * other, and a link the page has hidden - the first-steps card before it has
 * looked at the stores, everything about models with translation switched off
 * - leaves both at once.
 *
 * No smooth scrolling anywhere in here on purpose: an e-ink panel draws an
 * animated scroll as a smear, and every landing on this page is a jump.
 */

/** Where the marker moves: the heading whose section is being read. */
const CURRENT = "location";

/**
 * The links of the table of contents, in the page's order, with the heading
 * each of them names. A link whose heading is gone is dropped rather than
 * offered: it would be a line that lies.
 *
 * @returns {{ link: HTMLAnchorElement, id: string, heading: HTMLElement }[]}
 */
function entries() {
  /** @type {{ link: HTMLAnchorElement, id: string, heading: HTMLElement }[]} */
  const found = [];
  for (const link of document.querySelectorAll("#sections a[href^='#']")) {
    if (!(link instanceof HTMLAnchorElement)) continue;
    const id = link.hash.slice(1);
    const heading = document.getElementById(id);
    if (heading === null) continue;
    found.push({ link, id, heading });
  }
  return found;
}

/**
 * Whether an element is on the page at all - drawn, not merely present. The
 * mode switch hides whole sections with `display`, the first-steps card hides
 * itself with `hidden`, and neither should be offered anywhere.
 *
 * @param {HTMLElement} element
 */
function shown(element) {
  return element.offsetParent !== null || element.getClientRects().length > 0;
}

/**
 * The bar's select, rebuilt from the links that are on the page. Called again
 * whenever the page changes shape - the mode switch, the first-steps card -
 * because a select is a snapshot and the column is not.
 */
export function fillSectionSelect() {
  const select = document.getElementById("section-jump");
  if (!(select instanceof HTMLSelectElement)) return;
  const wanted = entries().filter(({ link }) => shown(link));
  const current = select.value;
  select.replaceChildren();
  for (const { link, id } of wanted) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = link.textContent ?? id;
    select.append(option);
  }
  // The reading has not moved because the list was rebuilt: the section that
  // was showing keeps the select, unless it is the one that just left.
  if (wanted.some(({ id }) => id === current)) select.value = current;
}

/**
 * Which section the reading is in: the last heading to have passed the upper
 * third of the window, measured under the stuck bar. At the very foot of the
 * page it is the last section, whatever the headings say - a short last
 * section never reaches the line, and the marker would stay one section
 * behind for the whole of it.
 *
 * @param {{ link: HTMLAnchorElement, id: string, heading: HTMLElement }[]} list
 * @returns {string | null}
 */
function readingNow(list) {
  const visible = list.filter(({ heading }) => shown(heading));
  if (visible.length === 0) return null;
  const foot = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
  if (foot) return String(visible[visible.length - 1]?.id);

  const bar = document.querySelector(".page-chrome");
  const under = bar instanceof HTMLElement ? bar.getBoundingClientRect().height : 0;
  const line = under + (window.innerHeight - under) / 3;
  let current = visible[0]?.id ?? null;
  for (const { id, heading } of visible) {
    if (heading.getBoundingClientRect().top > line) break;
    current = id;
  }
  return current === null ? null : String(current);
}

/**
 * The marker on the section being read: `aria-current` for a screen reader
 * and, through it, the edge marker the stylesheet draws. The select follows
 * the same verdict, so the two shapes of the list never disagree.
 *
 * @param {{ link: HTMLAnchorElement, id: string, heading: HTMLElement }[]} list
 */
function markCurrent(list) {
  const now = readingNow(list);
  for (const { link, id } of list) {
    if (id === now) link.setAttribute("aria-current", CURRENT);
    else link.removeAttribute("aria-current");
  }
  const select = document.getElementById("section-jump");
  if (select instanceof HTMLSelectElement && now !== null && select.value !== now) {
    // Only when the list already holds it: a rebuild is on its way otherwise.
    if ([...select.options].some((option) => option.value === now)) select.value = now;
  }
}

/**
 * Whatever the last landing marked, so the next press can clear it.
 *
 * @type {HTMLElement | null}
 */
let marked = null;

/** The mark goes at the next thing anybody does, and never on a clock. */
function clearMark() {
  if (marked === null) return;
  delete marked.dataset["landed"];
  marked = null;
}

document.addEventListener("pointerdown", clearMark);
document.addEventListener("keydown", clearMark);

/**
 * Where an address lands. A row whose switch is off is not on the page, and
 * an address that named it would scroll nowhere at all - so the landing walks
 * out to the nearest thing that is drawn: the row's own section, or the page's
 * top.
 *
 * A landing is also a focus, so a screen reader arrives where the eye does.
 * It is only *marked* when it lands on one row out of thirty (F5): a section
 * heading is the whole screen after the jump and needs no pointing at, and the
 * ring it used to wear read as a form field somebody had selected. The row's
 * mark is a bar at its leading edge, drawn inside the row so nothing shifts,
 * and it goes at the next press or key - not when the focus moves, because the
 * focus is where the reader is about to work.
 *
 * @param {string} id
 */
export function land(id) {
  /** @type {HTMLElement | null} */
  let target = document.getElementById(id);
  while (target !== null && !shown(target)) {
    target = target.parentElement === null ? null : target.parentElement.closest("section, [id]");
  }
  if (target === null) return;
  const landed = target;
  if (!landed.hasAttribute("tabindex")) landed.setAttribute("tabindex", "-1");
  landed.scrollIntoView();
  landed.focus({ preventScroll: true });
  clearMark();
  if (landed.classList.contains("row")) {
    landed.dataset["landed"] = "";
    marked = landed;
  }
}

/**
 * Wire the whole of it up. Called once, after the page is in its language:
 * the select's lines are the links' text, and the links only say the right
 * thing once `localizePage` has been through them.
 */
export function armSections() {
  fillSectionSelect();

  const list = entries();
  markCurrent(list);

  // The headings are watched rather than the scroll: a scroll listener on a
  // page this long is a measurement per frame, and what actually matters is
  // the moment a heading crosses the line. The verdict itself is taken by
  // measuring all nine headings, which is cheaper than it sounds and is the
  // only way to be right about "the last one past the line".
  if (typeof IntersectionObserver === "function") {
    const watch = new IntersectionObserver(() => markCurrent(entries()), {
      threshold: [0, 1],
    });
    for (const { heading } of list) watch.observe(heading);
  }
  // A window resized past the breakpoint changes which shape of the list is
  // on screen, and the line the verdict is measured against moves with it.
  window.addEventListener("resize", () => markCurrent(entries()));

  // A press in the column is a landing, not a navigation: the address still
  // goes into the bar, so the page can be shared and walked back to, but the
  // focus lands with the scroll.
  document.getElementById("sections")?.addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest("a[href^='#']") : null;
    if (!(link instanceof HTMLAnchorElement)) return;
    event.preventDefault();
    const id = link.hash.slice(1);
    history.replaceState(null, "", link.hash);
    land(id);
  });

  document.getElementById("section-jump")?.addEventListener("change", (event) => {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement) || select.value === "") return;
    history.replaceState(null, "", `#${select.value}`);
    land(select.value);
  });

  // Every other address on the page: the pair's way to the models, the
  // switched-off sites' way to the two switches it names, the first steps'
  // way to the sections they ask for.
  document.addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest("a[href^='#']") : null;
    if (!(link instanceof HTMLAnchorElement)) return;
    if (link.closest("#sections") !== null) return;
    event.preventDefault();
    history.replaceState(null, "", link.hash);
    land(link.hash.slice(1));
  });

  // Walked in with an address - from the popup, from the bubble's "no
  // dictionary" line, from a bookmark - and every change of it afterwards.
  if (location.hash.length > 1) land(location.hash.slice(1));
  window.addEventListener("hashchange", () => {
    if (location.hash.length > 1) land(location.hash.slice(1));
  });
}
