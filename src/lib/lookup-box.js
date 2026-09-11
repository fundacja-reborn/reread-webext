/**
 * The look-up field (D197): a word typed instead of selected, answered by the
 * dictionaries, saved with a press - the bubble with the page taken away.
 *
 * One component in two homes: the toolbar popup's "Look up a word" row and the
 * saved-phrases page's "Add a phrase" fold. Both are pages of this extension,
 * so the field is ordinary DOM on the page's own stylesheet (`.lookup-*` in
 * assets/page.css) - no shadow root, which is the bubble's armour against
 * somebody else's page. What differs between the two homes travels in as
 * `deps`: how the page asks the background, what it already knows about a
 * saved phrase, how it opens the settings, and which voice reads the pair's
 * language.
 *
 * The engine is never asked here, on purpose (Michał's call, 2026-09-11): a
 * word on its own has no sentence around it, and that is where the engine
 * guesses worst. The dictionaries answer, a line of theirs saves the phrase
 * with that meaning (D34), and "Own meaning" is the door for a phrase no
 * book knows - the quiet bubble's rules (D121, D158), in a field.
 *
 * Every string that lands in the DOM goes in through `textContent`: the
 * entries came out of a file somebody downloaded, and the phrase is whatever
 * was typed.
 */

import { HINT_MAX_WORDS, MEANING_SEPARATOR, linkedWord, toMeanings } from "./gloss.js";
import { t, uiLocale } from "./i18n.js";
import { languageName } from "./language.js";
import { afterPress, lookupOutcome, lookupText } from "./lookup.js";
import { keyTokens } from "./matcher/tokenize.js";
import { describeError } from "./messages.js";
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
 */

/**
 * @typedef {object} LookupBox
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
 * Builds the field inside `container` and wires it up.
 *
 * @param {HTMLElement} container an empty element of the page's own
 * @param {LookupBoxDeps} deps
 * @returns {LookupBox}
 */
export function mountLookupBox(container, deps) {
  /**
   * The phrase being shown, its meanings as saved (empty while it is not),
   * what the dictionaries said - or that they are still being asked - and
   * whether the editor is open. State rather than DOM, so that every change
   * redraws the same way.
   *
   * @type {{ phrase: { text: string, normalized: string } | null, meanings: string[], outcome: import("./lookup.js").LookupOutcome | null, pending: boolean, editing: boolean, error: string }}
   */
  const state = { phrase: null, meanings: [], outcome: null, pending: false, editing: false, error: "" };

  /**
   * Which ask the answer belongs to: a second word typed while the first is
   * still being looked up must not have the first's answer land on it.
   */
  let generation = 0;

  const form = document.createElement("form");
  form.className = "lookup-form";
  const label = element("label", "lookup-label", t("lookup_label"));
  label.setAttribute("for", "lookup-input");
  const input = document.createElement("input");
  input.type = "search";
  input.id = "lookup-input";
  input.className = "lookup-input";
  input.placeholder = t("lookup_placeholder");
  input.autocomplete = "off";
  input.spellcheck = false;
  input.enterKeyHint = "search";
  const go = document.createElement("button");
  go.type = "submit";
  go.className = "lookup-go";
  go.textContent = t("lookup_action");
  form.append(label, input, go);

  const answer = element("div", "lookup-answer");
  answer.hidden = true;
  container.append(form, answer);

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
   * A dictionary line pressed: the meaning joins the saved ones or leaves
   * them (D34), and the phrase is saved with what is left - or forgotten with
   * the last meaning taken back (`afterPress`).
   *
   * @param {string} line
   */
  async function press(line) {
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
    render();
  }

  /**
   * The editor's Save: the lines typed become the meanings, the way the
   * bubble's editor and the phrases page's editor keep them.
   *
   * @param {string} typed
   */
  async function saveTyped(typed) {
    if (state.phrase === null) return;
    const phrase = state.phrase;
    const meanings = toMeanings(typed);
    if (meanings.length === 0) return;
    const result = await deps.ask({ kind: Message.SAVE_PHRASE, text: phrase.text, translations: meanings });
    if (state.phrase !== phrase) return;
    if (!result.ok) {
      // The editor stays open with the draft: an error must not eat the text.
      state.error = describeError(result.code);
      render();
      return;
    }
    state.error = "";
    state.meanings = meanings;
    state.editing = false;
    render();
  }

  /** Learned: the phrase leaves the vocabulary; the entries stay to be read. */
  async function forget() {
    if (state.phrase === null) return;
    const phrase = state.phrase;
    const result = await deps.ask({ kind: Message.FORGET_PHRASE, text: phrase.text });
    if (state.phrase !== phrase) return;
    if (result.ok) {
      state.error = "";
      state.meanings = [];
    } else {
      state.error = describeError(result.code);
    }
    render();
  }

  /**
   * The field's question: the phrase as typed, the dictionaries asked and the
   * vocabulary consulted side by side. The engine is not asked at all - see
   * the header.
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
    state.editing = false;
    state.error = "";
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
   * The meanings as lines in a textarea, the phrases page's editor: Enter
   * keeps, Shift+Enter adds a line, Escape backs out, and there is nothing
   * to keep when no line has anything on it.
   *
   * @returns {HTMLElement}
   */
  function editor() {
    const wrap = element("div", "lookup-edit");
    const area = document.createElement("textarea");
    area.className = "lookup-editor";
    area.value = state.meanings.join(MEANING_SEPARATOR);
    area.rows = Math.max(2, state.meanings.length + 1);
    area.setAttribute("aria-label", t("lookup_own_meaning"));

    const save = button("lookup-save", t("bubble_save"));
    const cancel = button("lookup-cancel", t("action_cancel"));
    const empty = () => toMeanings(area.value).length === 0;
    save.disabled = empty();
    area.addEventListener("input", () => {
      save.disabled = empty();
    });
    area.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (!save.disabled) void saveTyped(area.value);
      }
      if (event.key === "Escape") {
        // The editor's own Escape; the page's (a panel closing, the popup)
        // must not also answer it.
        event.stopPropagation();
        closeEditor();
      }
    });
    save.addEventListener("click", () => void saveTyped(area.value));
    cancel.addEventListener("click", () => closeEditor());

    const actions = element("div", "lookup-actions");
    actions.append(save, cancel);
    wrap.append(area, actions);
    return wrap;
  }

  function openEditor() {
    state.editing = true;
    render();
    const area = answer.querySelector("textarea");
    if (area instanceof HTMLTextAreaElement) {
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
    }
  }

  function closeEditor() {
    state.editing = false;
    render();
    const own = answer.querySelector("button.lookup-own");
    if (own instanceof HTMLButtonElement) own.focus();
  }

  function render() {
    answer.replaceChildren();
    if (state.phrase === null) {
      answer.hidden = true;
      return;
    }
    answer.hidden = false;

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
    answer.append(head);

    // The phrase's standing in the vocabulary, before what the books say:
    // the reader's own meaning outranks a dictionary's (the recall bubble's
    // order), and a phrase already kept should say so at once.
    if (state.editing) {
      answer.append(editor());
    } else if (state.meanings.length > 0) {
      answer.append(element("p", "lookup-kept", t("lookup_kept")));
      answer.append(element("p", "lookup-meanings", state.meanings.join("; ")));
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
      const entries = element("div", "lookup-entries");
      for (const block of state.outcome.blocks) {
        const entry = element("div", "lookup-entry");
        if (block.headword.length > 0 || block.dictionary.length > 0) {
          const heading = element("div", "lookup-entry-label");
          if (block.headword.length > 0) {
            heading.append(element("span", "lookup-entry-headword", block.headword));
          }
          if (block.headword.length > 0 && block.dictionary.length > 0) heading.append(" - ");
          if (block.dictionary.length > 0) {
            heading.append(element("span", "lookup-entry-dict", block.dictionary));
          }
          entry.append(heading);
        }
        for (const line of block.lines) {
          const sense = button("lookup-sense", line);
          // A toggle, and told as one: the mark that stays says which meanings
          // are the phrase's now.
          sense.setAttribute("aria-pressed", state.meanings.includes(line) ? "true" : "false");
          // Not while the meanings are being typed by hand - the bubble's rule.
          sense.disabled = state.editing;
          sense.addEventListener("click", () => void press(line));
          entry.append(sense);
        }
        entries.append(entry);
      }
      answer.append(entries);
    }

    if (!state.pending && !state.editing) {
      const actions = element("div", "lookup-actions");
      const own = button("lookup-own", t("lookup_own_meaning"));
      own.addEventListener("click", () => openEditor());
      actions.append(own);
      if (state.meanings.length > 0) {
        const learned = button("lookup-learned", t("bubble_learned"));
        learned.addEventListener("click", () => void forget());
        actions.append(learned);
      }
      answer.append(actions);
    }

    if (state.error.length > 0) {
      const line = element("p", "lookup-note", state.error);
      line.dataset["tone"] = "error";
      answer.append(line);
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void lookUp();
  });

  return {
    reset() {
      generation += 1;
      input.value = "";
      state.phrase = null;
      state.meanings = [];
      state.outcome = null;
      state.pending = false;
      state.editing = false;
      state.error = "";
      render();
    },
    focus() {
      input.focus();
    },
  };
}
