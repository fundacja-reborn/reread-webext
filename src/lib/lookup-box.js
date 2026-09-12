/**
 * The look-up field (D197): a word typed instead of selected, answered by the
 * dictionaries - the bubble with the page taken away.
 *
 * One component in two homes, and the two homes differ in what a press may
 * do. The saved-phrases page's "Add a phrase" fold is the full field: every
 * dictionary line is a row with a checkbox, ticked while the phrase is
 * saved with that meaning (D34; block 2 of the rebuild), and the list right
 * under the fold shows what a tick did. The toolbar popup's field only
 * reads (`readOnly`): a popup leaves at a click beside it, its answer
 * scrolls the "saved" line out of view, and a save nobody saw is the wrong
 * kind of surprise (Michał's call after the first smoke, 2026-09-11) - so
 * there the lines are prose, and the popup's own row leads to the page.
 *
 * The field does one thing and leaves the rest to the page around it (the
 * rebuild of 2026-09-11, block 1): it looks the word up and lets a meaning
 * be kept or taken back. It does not manage the whole entry - Edit and
 * Learned belong to the phrase's row in the list, and "Show in list" is
 * how the field points at that row. And it has one way out: the cross in
 * the field empties it and takes the answer down; the fold's own summary
 * folds the panel.
 *
 * Both are pages of this extension, so the field is ordinary DOM on the
 * page's own stylesheet (`.lookup-*` in assets/page.css) - no shadow root,
 * which is the bubble's armour against somebody else's page. What differs
 * between the homes travels in as `deps` and `options`: how the page asks
 * the background, what it already knows about a saved phrase, how it opens
 * the settings, which voice reads the pair's language, whether it has a
 * list to point at, and whether a press may write.
 *
 * The engine is never asked here, on purpose (Michał's call): a word on its
 * own has no sentence around it, and that is where the engine guesses worst.
 *
 * Every string that lands in the DOM goes in through `textContent`: the
 * entries came out of a file somebody downloaded, and the phrase is whatever
 * was typed.
 */

import { HINT_MAX_WORDS, linkedWord } from "./gloss.js";
import { t, uiLocale } from "./i18n.js";
import { languageName } from "./language.js";
import {
  afterPress,
  entryGroups,
  foldPoint,
  isSaved,
  lookupOutcome,
  lookupText,
  ownMeanings,
  paragraphsOf,
} from "./lookup.js";
import { keyTokens } from "./matcher/tokenize.js";
import { describeError } from "./messages.js";
import { collapseWhitespace } from "./normalize.js";
import { ErrorCode, Message, asLookUp } from "./protocol.js";
import { dictionarySourcesLink } from "./sources.js";
import { speakerIcon } from "./speaker-icon.js";
import { MAX_PHRASE_LENGTH } from "./store/phrase.js";
import { canSpeak, primaryLanguage, speak, speaking, stop as stopSpeaking } from "./tts.js";

/**
 * @typedef {object} LookupBoxDeps
 * @property {(request: import("./protocol.js").Request) => Promise<import("./protocol.js").Result<unknown>>} ask
 *   the background, the way the page already asks it - never throws
 * @property {(normalized: string) => Promise<string[]>} savedMeanings what the
 *   phrase means now, empty when it is not saved
 * @property {() => void} openDictionaries the settings at the dictionaries -
 *   the press inside "add one in the settings"
 * @property {() => { lang: string, voiceURI: string | undefined, rate: number } | null} voice
 *   how to read the phrase aloud - the pair's language, the voice stored for
 *   it, the speed - or null while no pair is chosen
 * @property {(phrase: { text: string, normalized: string }) => void} [showInList]
 *   the saved phrase's own row brought into view - the phrases page's list
 *   under the fold; a home without a list (the popup) leaves it out and the
 *   answer's standing line carries no link
 */

/**
 * What the field is showing, for the home to act on (D197): the popup turns
 * its rows into the results mode on it and names its door to the page.
 *
 * @typedef {{ phrase: { text: string, normalized: string } | null, saved: boolean, pending: boolean }} LookupState
 */

/**
 * @typedef {object} LookupBoxOptions
 * @property {boolean} [readOnly] the lines as prose and no press that writes:
 *   the popup's field, which only reads (see the header); the phrases page's
 *   writes
 * @property {(state: LookupState) => void} [onState] told after every draw
 */

/**
 * @typedef {object} LookupBox
 * @property {(text: string) => Promise<void>} search the field filled with
 *   `text` and asked, as if it had been typed - the page's arrival with a
 *   phrase from the popup
 * @property {() => void} reset the field emptied and the answer taken down -
 *   what a change of pair does, because the answer was in the old pair's
 *   language
 * @property {() => void} focus the field ready to type in
 */

/**
 * A run of words, a link out, or a press: the bubble's hint parts (`Hint` in
 * content/tooltip.js), drawn here on a page of ours.
 *
 * @typedef {string | { label: string, href: string } | { label: string, action: "dictionaries" }} Part
 */

/**
 * The dictionaries' verdict as parts (D164, D192), kept in step with
 * `dictionaryVerdict` in content/reading.js - a deliberate twin, because the
 * content script is bundled for somebody else's page and this one for ours.
 * The sentence about a missing dictionary makes its own word "settings" the
 * press that opens them; the sentence about a word no book knows offers the
 * page listing sources, its address as the link's own words, for a word or
 * two (`HINT_MAX_WORDS`) - past that a phrase is nothing a dictionary is
 * expected to hold.
 *
 * @param {"no-dictionary" | "not-in-dictionary"} note
 * @param {string} lang the language the dictionaries were asked in
 * @param {number} words how many words the phrase has
 * @returns {Part[]}
 */
function verdictParts(note, lang, words) {
  if (note === "no-dictionary") {
    const word = t("bubble_settings_word");
    const sentence = t("bubble_no_dictionary", [languageName(primaryLanguage(lang)), word]);
    const linked = linkedWord(sentence, word);
    if (linked === null) return [`${sentence}.`];
    return [linked.before, { label: linked.word, action: "dictionaries" }, `${linked.after}.`];
  }
  const miss = `${t("bubble_not_in_dictionary")}.`;
  if (words > HINT_MAX_WORDS) return [miss];
  return [`${miss} ${t("bubble_dictionary_sources")} `, dictionarySourcesLink(uiLocale())];
}

/**
 * @param {string} tag
 * @param {string} className
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * @param {string} className
 * @param {string} label
 * @returns {HTMLButtonElement}
 */
function button(className, label) {
  const node = document.createElement("button");
  node.type = "button";
  node.className = className;
  node.textContent = label;
  return node;
}

/**
 * Builds the field and wires it up: the form into `hosts.form`, the answer
 * into `hosts.answer` - two elements in the popup, where the form has to
 * stay stuck at the top while the answer scrolls, and one and the same on
 * the phrases page.
 *
 * @param {{ form: HTMLElement, answer: HTMLElement }} hosts empty elements of
 *   the page's own
 * @param {LookupBoxDeps} deps
 * @param {LookupBoxOptions} [options]
 * @returns {LookupBox}
 */
export function mountLookupBox(hosts, deps, { readOnly = false, onState } = {}) {
  /**
   * The phrase being shown, its meanings as saved (empty while it is not),
   * what the dictionaries said - or that they are still being asked - and
   * the meaning of the reader's own being typed, kept as state so that a
   * redraw after a tick does not eat it. State rather than DOM, so that
   * every change redraws the same way.
   *
   * @type {{ phrase: { text: string, normalized: string } | null, meanings: string[], outcome: import("./lookup.js").LookupOutcome | null, pending: boolean, error: string, ownDraft: string }}
   */
  const state = { phrase: null, meanings: [], outcome: null, pending: false, error: "", ownDraft: "" };

  /**
   * Which ask the answer belongs to: a second word typed while the first is
   * still being looked up must not have the first's answer land on it.
   */
  let generation = 0;

  /**
   * Which folds the reader opened or closed by hand, by the fold's key
   * (`group:<book>` for a book, `more:<book>` for the rest of its lines), so
   * that a redraw after a tick finds them as they were left. Emptied with
   * every new word: the folds' defaults - the first book open, the others
   * closed - are about this word's answer.
   *
   * @type {Map<string, boolean>}
   */
  let folds = new Map();

  const form = document.createElement("form");
  form.className = "lookup-form";
  const label = element("label", "lookup-label", t("lookup_label"));
  label.setAttribute("for", "lookup-input");
  // The field and its cross in one box, so the cross can stand inside the
  // field's own frame at its far end.
  const field = element("div", "lookup-field");
  const input = document.createElement("input");
  input.type = "search";
  input.id = "lookup-input";
  input.className = "lookup-input";
  input.placeholder = t("lookup_placeholder");
  input.autocomplete = "off";
  input.spellcheck = false;
  input.enterKeyHint = "search";
  // A word looked up is a word as the book spells it: no capital forced on
  // a phone's keyboard.
  input.setAttribute("autocapitalize", "off");
  // The one way to take the answer down: the field emptied and the answer
  // with it, the caret left in the field for the next word. Our own cross
  // rather than the browser's: Firefox draws none on a search field, and
  // Chromium's is a small target that fires no event a page can count on.
  // Hidden while there is nothing to clear.
  const clearButton = button("lookup-clear", String.fromCodePoint(0x00d7));
  clearButton.setAttribute("aria-label", t("lookup_clear"));
  clearButton.title = t("lookup_clear");
  clearButton.hidden = true;
  field.append(input, clearButton);
  const go = document.createElement("button");
  go.type = "submit";
  go.className = "lookup-go";
  go.textContent = t("lookup_action");
  form.append(label, field, go);
  hosts.form.append(form);

  const answer = element("div", "lookup-answer");
  answer.hidden = true;
  hosts.answer.append(answer);

  function tell() {
    onState?.({ phrase: state.phrase, saved: state.meanings.length > 0, pending: state.pending });
  }

  /** The cross stands while the field has anything in it to clear. */
  function showClear() {
    clearButton.hidden = input.value.length === 0;
  }

  /**
   * The answer taken down: nothing shown, nothing pending, an ask on its way
   * ignored when it lands. The field's text is the caller's business - the
   * field cleared by its cross is what calls this most often.
   */
  function clear() {
    generation += 1;
    state.phrase = null;
    state.meanings = [];
    state.outcome = null;
    state.pending = false;
    state.error = "";
    state.ownDraft = "";
    render();
  }

  /**
   * The phrase read aloud (D83: the phrase, never the meanings), in the
   * pair's language with the voice stored for it; a second press while it
   * sounds stops it.
   */
  async function speakPhrase() {
    const voice = deps.voice();
    if (state.phrase === null || voice === null) return;
    if (speaking()) {
      stopSpeaking();
      return;
    }
    const spoke = await speak(state.phrase.text, voice.lang, voice.voiceURI, voice.rate);
    // Refused for want of an offline voice (D155): said where the press was.
    if (!spoke) {
      state.error = t("speech_no_offline_voice");
      render();
    }
  }

  /**
   * The presses, one after another: three lines ticked in a row are three
   * saves, each computed from what the one before it left - two in flight
   * at once would each start from the same meanings and the second would
   * write over the first.
   *
   * @type {Promise<void>}
   */
  let queue = Promise.resolve();

  /**
   * A dictionary line ticked or unticked: the meaning joins the saved ones
   * or leaves them (D34), and the phrase is saved with what is left - or
   * forgotten with the last meaning taken back (`afterPress`). Queued behind
   * the press before it (see `queue`).
   *
   * @param {string} line
   * @param {string} [at] the row's mark (`data-line`), for the focus and the
   *   scroll to come back to it after the redraw
   */
  function press(line, at) {
    queue = queue.then(() => pressed(line, at)).catch(() => undefined);
    return queue;
  }

  /**
   * @param {string} line
   * @param {string} [at]
   */
  async function pressed(line, at) {
    if (state.phrase === null) return;
    const phrase = state.phrase;
    const next = afterPress(state.meanings, line);
    const result = await deps.ask(
      next.act === "forget"
        ? { kind: Message.FORGET_PHRASE, text: phrase.text }
        : { kind: Message.SAVE_PHRASE, text: phrase.text, translations: next.meanings },
    );
    // A word typed meanwhile has its own answer on the screen.
    if (state.phrase !== phrase) return;
    if (result.ok) {
      state.error = "";
      state.meanings = next.meanings;
    } else {
      state.error = describeError(result.code);
    }
    redrawAround(at);
  }

  /**
   * @param {string} at a row's mark
   * @returns {HTMLElement | null}
   */
  function rowAt(at) {
    const row = answer.querySelector(`[data-line="${at}"]`);
    return row instanceof HTMLElement ? row : null;
  }

  /**
   * The redraw after a tick, with the row ticked kept where it was: under
   * the finger on the screen (what stood above it may have grown by the
   * standing line - the page is scrolled by the difference) and under the
   * keyboard's focus (the checkbox is rebuilt, so the focus is handed to
   * its successor). A row that left with the redraw (an own meaning
   * unticked, block 4) hands the focus to the field for own meanings.
   *
   * @param {string} [at]
   */
  function redrawAround(at) {
    const before = at === undefined ? null : rowAt(at);
    const had = before !== null && before.contains(document.activeElement);
    const top = before?.getBoundingClientRect().top ?? null;
    render();
    if (at === undefined) return;
    const after = rowAt(at);
    if (after !== null && top !== null) {
      const moved = after.getBoundingClientRect().top - top;
      if (moved !== 0) window.scrollBy(0, moved);
    }
    if (!had) return;
    const box = after?.querySelector("input");
    if (box instanceof HTMLInputElement) box.focus({ preventScroll: true });
    else ownField()?.focus({ preventScroll: true });
  }

  /** The field for a meaning of the reader's own (block 4), when drawn. */
  function ownField() {
    const field = answer.querySelector("input.lookup-own-input");
    return field instanceof HTMLInputElement ? field : null;
  }

  /**
   * A meaning of the reader's own, typed and kept (block 4): it joins the
   * saved meanings after what is there - the phrase saved with it when it
   * was not saved yet. Typed as it was, whitespace folded, nothing else
   * changed: a marker like "☞" in the text is the reader's to keep. One
   * already saved - as a line ticked above, or as an own meaning - is not
   * saved again; the field is emptied and the row above says so. Queued
   * behind the ticks (see `queue`), and the caret stays in the field for
   * the next one.
   */
  function saveOwn() {
    queue = queue.then(() => savedOwn()).catch(() => undefined);
    return queue;
  }

  async function savedOwn() {
    if (state.phrase === null) return;
    const phrase = state.phrase;
    const own = collapseWhitespace(state.ownDraft);
    if (own.length === 0) return;
    if (!isSaved(state.meanings, own)) {
      const meanings = [...state.meanings, own];
      const result = await deps.ask({ kind: Message.SAVE_PHRASE, text: phrase.text, translations: meanings });
      if (state.phrase !== phrase) return;
      if (!result.ok) {
        // The draft stays: an error must not eat the text.
        state.error = describeError(result.code);
        render();
        ownField()?.focus();
        return;
      }
      state.error = "";
      state.meanings = meanings;
    }
    state.ownDraft = "";
    render();
    ownField()?.focus();
  }

  /**
   * The section for the reader's own meanings, last in the answer (block
   * 4): the saved meanings that match no line of the books - as rows
   * ticked, unticked the way a book's line is - and under them the field
   * for the next one, with Save beside it; Enter saves too. Always drawn
   * once the books have answered, the field at least: it is the way in
   * for a word no book knows, and the second meaning for one they do.
   *
   * @param {string[]} lines every line the books answered with
   * @returns {HTMLElement}
   */
  function ownSection(lines) {
    const section = element("section", "lookup-own");
    section.setAttribute("aria-label", t("lookup_own"));
    section.append(element("div", "lookup-own-label", t("lookup_own")));
    for (const [at, meaning] of ownMeanings(state.meanings, lines).entries()) {
      section.append(lineRow(meaning, `own:${at}`));
    }

    const form = document.createElement("form");
    form.className = "lookup-own-form";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "lookup-own-input";
    input.placeholder = t("lookup_own_placeholder");
    input.setAttribute("aria-label", t("lookup_own_placeholder"));
    input.autocomplete = "off";
    input.value = state.ownDraft;
    const save = button("lookup-own-save", t("bubble_save"));
    save.type = "submit";
    const empty = () => collapseWhitespace(input.value).length === 0;
    save.disabled = empty();
    input.addEventListener("input", () => {
      state.ownDraft = input.value;
      save.disabled = empty();
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!empty()) void saveOwn();
    });
    form.append(input, save);
    section.append(form);
    return section;
  }

  /**
   * A fold with its state remembered: open as the reader last left it, or
   * as the default says; every change of the reader's hand is written down
   * for the next redraw.
   *
   * @param {string} className
   * @param {string} key the fold's key in `folds`
   * @param {boolean} openByDefault
   * @param {HTMLElement} summary
   * @returns {HTMLDetailsElement}
   */
  function fold(className, key, openByDefault, summary) {
    const details = document.createElement("details");
    details.className = className;
    details.open = folds.get(key) ?? openByDefault;
    details.append(summary);
    details.addEventListener("toggle", () => {
      folds.set(key, details.open);
    });
    return details;
  }

  /**
   * The books' entries as one fold per book (block 3): the first open, the
   * others closed with the count in their name - the height of the answer
   * limited by structure, not by a scrollbar. Inside a book, the lines past
   * `LINES_OPEN` fold again under "Show all", which opens by itself when a
   * saved meaning would otherwise be out of sight. Where the field only
   * reads, a book's entries are prose, paragraph by paragraph, and the
   * count is not said: paragraphs are nothing to tick.
   *
   * @param {import("./lookup.js").EntryGroup[]} groups
   * @returns {HTMLElement}
   */
  function books(groups) {
    const entries = element("div", "lookup-entries");
    for (const [at, group] of groups.entries()) {
      const summary = element("summary", "lookup-group-label");
      summary.append(element("span", "lookup-entry-dict", group.dictionary));
      if (!readOnly) summary.append(` (${group.lines.length.toLocaleString()})`);
      const book = fold("lookup-group", `group:${group.dictionary}`, at === 0, summary);

      // Everything up to the cut goes straight into the book; the rest
      // goes into the "Show all" fold, headwords and lines alike.
      const { shown, unfolded } = foldPoint(group.lines, state.meanings);
      /** @type {HTMLElement | null} */
      let more = null;
      if (!readOnly && shown < group.lines.length) {
        const label = element("summary", "lookup-more-label");
        more = fold("lookup-more", `more:${group.dictionary}`, unfolded, label);
        const say = () => {
          label.textContent = more?.hasAttribute("open") === true ? t("lookup_show_fewer") : t("lookup_show_all", [group.lines.length.toLocaleString()]);
        };
        say();
        more.addEventListener("toggle", say);
      }
      let index = 0;
      for (const [entryAt, entry] of group.entries.entries()) {
        const into = more !== null && index >= shown ? more : book;
        if (entry.headword.length > 0) {
          into.append(element("div", "lookup-entry-headword", entry.headword));
        }
        if (readOnly) {
          // Prose, not presses (the header): the book's own paragraphs,
          // which the rows cut into lines - read off the entries as stored,
          // the group's entries being those in the answer's order.
          const stored = state.outcome?.kind === "entries" ? state.outcome.entries : [];
          const own = stored.filter((one) => one.dictionary === group.dictionary)[entryAt];
          for (const sense of own?.senses ?? []) {
            for (const paragraph of paragraphsOf(sense)) into.append(element("div", "lookup-paragraph", paragraph));
          }
          continue;
        }
        for (const line of entry.lines) {
          const home = more !== null && index >= shown ? more : book;
          home.append(lineRow(line, `${at}:${index}`));
          index += 1;
        }
      }
      if (more !== null) book.append(more);
      entries.append(book);
    }
    return entries;
  }

  /**
   * A dictionary line as a row to tick: a label over the whole row with a
   * native checkbox in it - it draws solidly on e-ink, reads as a checkbox
   * to a screen reader, and takes the space bar and Tab for nothing. What
   * says the meaning is kept is the checkbox's own mark and the weight of
   * the text (the stylesheet, off `data-saved`): a wash alone is one of the
   * 16 greys an e-ink panel rounds back to paper.
   *
   * @param {string} line
   * @param {string} at the row's mark, stable across redraws
   * @returns {HTMLElement}
   */
  function lineRow(line, at) {
    const row = element("label", "lookup-line");
    row.dataset["line"] = at;
    const saved = isSaved(state.meanings, line);
    row.dataset["saved"] = saved ? "true" : "false";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "lookup-line-box";
    box.checked = saved;
    box.addEventListener("change", () => void press(line, at));
    row.append(box, element("span", "lookup-line-text", line));
    return row;
  }

  /**
   * The field's question: the phrase as typed, the dictionaries asked and the
   * vocabulary consulted side by side. The engine is not asked at all - see
   * the header. Asked on submit alone - Enter or the button - never as the
   * word is typed: on e-ink every redraw is a flash.
   */
  async function lookUp() {
    const typed = input.value;
    const phrase = lookupText(typed);
    if (phrase === null) {
      // Nothing but punctuation is nothing to ask; a phrase past the store's
      // ceiling is the one refusal worth a sentence, the bubble's own.
      if (typed.length > MAX_PHRASE_LENGTH) {
        state.error = describeError(ErrorCode.TOO_LONG);
        render();
      }
      return;
    }
    const mine = ++generation;
    state.phrase = phrase;
    state.meanings = [];
    state.outcome = null;
    state.pending = true;
    state.error = "";
    state.ownDraft = "";
    folds = new Map();
    render();

    const [meanings, asked] = await Promise.all([
      deps.savedMeanings(phrase.normalized).catch(() => []),
      // The `look-up` the quiet vocabulary sends (D162), without a page's
      // language: the background asks the pair's dictionaries (D191).
      deps.ask({ kind: Message.LOOK_UP, text: phrase.text }),
    ]);
    if (mine !== generation) return;
    state.meanings = meanings;
    state.outcome = lookupOutcome(asked.ok ? asLookUp(asked.value) : null, phrase.normalized);
    state.pending = false;
    render();
    // A word no book knows: the one way to keep it is a meaning of the
    // reader's own, so the caret goes to that field (block 4).
    if (!readOnly && state.outcome.kind === "silence") ownField()?.focus();
  }

  /**
   * @param {Part[]} parts
   * @returns {HTMLElement}
   */
  function verdictLine(parts) {
    const line = element("p", "lookup-note");
    for (const part of parts) {
      if (typeof part === "string") {
        if (part.length > 0) line.append(part);
      } else if ("href" in part) {
        // A real link with its address as its words: it says where it leads
        // before it is pressed, and leaves for a page of ours in a new tab.
        const link = document.createElement("a");
        link.className = "lookup-link";
        link.href = part.href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = part.label;
        line.append(link);
      } else {
        const press = button("lookup-link", part.label);
        press.addEventListener("click", () => deps.openDictionaries());
        line.append(press);
      }
    }
    return line;
  }

  /**
   * The phrase's standing in the vocabulary, at the head's far end: how many
   * meanings it is kept with, and - where the home has a list - the way to
   * its own row there. Nothing at all while the phrase is not saved: the
   * lines below say so by not being marked.
   *
   * @param {{ text: string, normalized: string }} phrase
   * @returns {HTMLElement}
   */
  function standing(phrase) {
    const line = element("span", "lookup-standing");
    line.append(element("span", "lookup-saved-count", t("lookup_saved_count", [state.meanings.length.toLocaleString()])));
    if (deps.showInList !== undefined) {
      const dot = element("span", "lookup-standing-dot", String.fromCodePoint(0x00b7));
      dot.setAttribute("aria-hidden", "true");
      const show = button("lookup-show", t("lookup_show_in_list"));
      show.addEventListener("click", () => deps.showInList?.(phrase));
      line.append(dot, show);
    }
    return line;
  }

  function render() {
    answer.replaceChildren();
    if (state.phrase === null) {
      answer.hidden = true;
      tell();
      return;
    }
    answer.hidden = false;

    // The phrase with its speaker, and at the far end its standing in the
    // vocabulary once that is known.
    const head = element("div", "lookup-head");
    head.append(element("span", "lookup-phrase", state.phrase.text));
    if (canSpeak() && deps.voice() !== null) {
      const speaker = button("lookup-speak", "");
      speaker.setAttribute("aria-label", t("bubble_speak"));
      speaker.title = t("bubble_speak");
      speaker.append(speakerIcon());
      speaker.addEventListener("click", () => void speakPhrase());
      head.append(speaker);
    }
    if (state.meanings.length > 0) head.append(standing(state.phrase));
    answer.append(head);

    // Where the field only reads, what the phrase already means stands
    // before what the books say, as chips: the reader's own meaning
    // outranks a dictionary's (the recall bubble's order), and the popup
    // has no rows to tick that would show it. Where the field writes, the
    // ticked rows say it - one list with a state, not the same meanings
    // twice (block 2 of the rebuild).
    if (readOnly && state.meanings.length > 0) {
      const kept = element("div", "lookup-kept");
      kept.append(element("p", "lookup-kept-label", t("lookup_kept")));
      const chips = element("div", "lookup-chips");
      for (const meaning of state.meanings) chips.append(element("span", "lookup-chip", meaning));
      kept.append(chips);
      answer.append(kept);
    }

    if (state.pending) {
      const line = element("p", "lookup-note", t("bubble_looking_up"));
      line.dataset["tone"] = "pending";
      answer.append(line);
    } else if (state.outcome?.kind === "fault") {
      const line = element("p", "lookup-note", describeError(ErrorCode.INTERNAL));
      line.dataset["tone"] = "error";
      answer.append(line);
    } else if (state.outcome?.kind === "silence") {
      const words = keyTokens(state.phrase.normalized).length;
      answer.append(verdictLine(verdictParts(state.outcome.note, state.outcome.lang, words)));
    } else if (state.outcome?.kind === "entries") {
      answer.append(books(entryGroups(state.outcome.entries, state.phrase.normalized)));
    }

    // Last, where the field writes: the reader's own meanings and the field
    // for the next one - once the books have answered, whatever they said.
    if (!readOnly && !state.pending) {
      const lines =
        state.outcome?.kind === "entries"
          ? entryGroups(state.outcome.entries, state.phrase.normalized).flatMap((group) => group.lines)
          : [];
      answer.append(ownSection(lines));
    }

    if (state.error.length > 0) {
      const line = element("p", "lookup-note", state.error);
      line.dataset["tone"] = "error";
      answer.append(line);
    }

    tell();
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void lookUp();
  });

  clearButton.addEventListener("click", () => {
    input.value = "";
    showClear();
    clear();
    input.focus();
  });

  // Typing asks nothing (the header); the cross follows the text. The field
  // emptied by other means - Escape in it, the last character deleted -
  // takes the answer down with it too: an answer to a word no longer in the
  // field is an answer to nothing.
  input.addEventListener("input", () => {
    showClear();
    if (input.value.length === 0 && state.phrase !== null) clear();
  });

  return {
    search(text) {
      input.value = text;
      showClear();
      return lookUp();
    },
    reset() {
      input.value = "";
      showClear();
      clear();
    },
    focus() {
      input.focus();
    },
  };
}
