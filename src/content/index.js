/**
 * What runs on every page the reader opens.
 *
 * The budget here is the whole justification for `<all_urls>`, and M2 spends a
 * little of it: one read of `storage.local` at startup, and a listener for when
 * the vocabulary changes in another tab. Nothing else happens until there is a
 * selection, and nothing is added to the page until there is a bubble to show.
 *
 * Knowing the vocabulary here rather than asking the background for it is what
 * makes a word the reader already kept appear instantly, with no message and no
 * engine - and it means an install that has saved nothing pays for one storage
 * read per page and not a single wake-up of the background.
 */

import { webext } from "../lib/browser.js";
import { CONFIG_KEY, withDefaults } from "../lib/config.js";
import { describeError } from "../lib/messages.js";
import { normalize, trimPhrase } from "../lib/normalize.js";
import { ErrorCode, Message, asResult, fail } from "../lib/protocol.js";
import { MIRROR_KEY, asMirror, mirrorMatches } from "../lib/store/mirror.js";
import { clear, paint, phraseAt } from "./highlighter.js";
import { createTooltip } from "./tooltip.js";

/** @typedef {import("../lib/protocol.js").VocabEntry} VocabEntry */

/** Saved phrases of the pair being read: normalized form to its meanings. */
/** @type {Map<string, string[]>} */
let vocabulary = new Map();

/** What the bubble is about right now, in the form the page had it. */
/** @type {{ text: string, normalized: string } | null} */
let current = null;

/**
 * Bumped every time the bubble starts being about something else. Selections
 * come faster than translations and than round trips to the database, and an
 * answer for an older one is dropped rather than painted over a bubble that has
 * moved on.
 */
let generation = 0;

const tooltip = createTooltip({ onAction });

/**
 * @template T
 * @param {import("../lib/protocol.js").Request} request
 * @returns {Promise<import("../lib/protocol.js").Result<T>>}
 */
async function ask(request) {
  try {
    return asResult(await webext().runtime.sendMessage(request));
  } catch {
    // The background can be asleep, restarting, or gone after an update. None
    // of that is worth an exception on a page somebody is reading.
    return fail(ErrorCode.INTERNAL);
  }
}

/**
 * @param {VocabEntry[]} entries
 */
function adopt(entries) {
  vocabulary = new Map(entries);
  repaint();
}

/**
 * An empty vocabulary is not painted white - it is not walked at all. That is
 * the difference between an extension that costs something on every page and
 * one that costs something on the pages of somebody who has saved a word.
 */
function repaint() {
  if (vocabulary.size === 0) clear();
  else paint(vocabulary.keys());
}

/**
 * Reads the settings and the vocabulary in one call, and decides which of three
 * situations this page is in:
 *
 *   - no mirror: the background has never saved anything, so there is nothing
 *     to know and nobody to ask,
 *   - a mirror for this language pair: use it, send nothing,
 *   - a mirror for another pair: it was left behind by a settings change, so
 *     ask the background, whose answer rebuilds it for every page after this.
 */
async function loadVocabulary() {
  // Nothing here may reject: the console this would land in belongs to the page
  // being read, and an extension that logs stack traces into it looks exactly
  // like an extension that broke it.
  try {
    const stored = await webext().storage.local.get([CONFIG_KEY, MIRROR_KEY]);
    const config = withDefaults(stored[CONFIG_KEY]);
    const mirror = asMirror(stored[MIRROR_KEY]);

    if (mirror === null) {
      adopt([]);
      return;
    }
    if (mirrorMatches(mirror, config)) {
      adopt(mirror.entries);
      return;
    }

    /** @type {import("../lib/protocol.js").Result<VocabEntry[]>} */
    const result = await ask({ kind: Message.LIST_PHRASES });
    if (result.ok) adopt(result.value);
  } catch {
    // Storage unreachable: the page keeps working, nothing is underlined, and
    // the next change to the vocabulary tries again.
    adopt([]);
  }
}

/**
 * @returns {{ text: string, rect: DOMRect } | null}
 */
function readSelection() {
  const selection = window.getSelection();
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return null;

  // Trimmed before anything is done with it, the engine included. Dragging over
  // a word catches the comma after it, and translating `Pacific,` gives back
  // `Pacyfiku,` - a comma nobody selected, saved into the vocabulary and
  // exported onto a flashcard. What is translated has to be what is stored.
  const text = trimPhrase(selection.toString());
  if (text.length === 0) return null;

  const rect = selection.getRangeAt(0).getBoundingClientRect();
  // A range inside a collapsed or hidden element measures as nothing, and a
  // bubble anchored to nothing lands in the corner of the screen.
  if (rect.width === 0 && rect.height === 0) return null;

  return { text, rect };
}

/**
 * @param {import("./tooltip.js").ReportedAction} action
 * @param {string[]} meanings what the bubble was showing when the button was pressed
 */
async function onAction(action, meanings) {
  if (action === "settings") {
    void ask({ kind: Message.OPEN_SETTINGS });
    tooltip.hide();
    return;
  }

  const phrase = current;
  if (phrase === null) return;
  const mine = generation;

  const result =
    action === "save"
      ? await ask({ kind: Message.SAVE_PHRASE, text: phrase.text, translations: meanings })
      : await ask({ kind: Message.FORGET_PHRASE, text: phrase.text });

  if (mine !== generation || !tooltip.isOpen()) return;

  if (!result.ok) {
    tooltip.setBody(describeError(result.code), "error");
    tooltip.setActions([]);
    return;
  }

  // The mirror will say the same thing in a moment, through the storage event.
  // Doing it here too is what makes the buttons flip and the underline appear
  // without a wait - saving a word and watching it underline itself in the
  // paragraph you are reading is the whole point of the feature.
  if (action === "save") vocabulary.set(phrase.normalized, meanings);
  else vocabulary.delete(phrase.normalized);
  repaint();
  tooltip.setActions(action === "save" ? ["learned", "edit"] : ["save", "edit"]);
}

/**
 * Nothing is asked of the engine for a phrase already saved: the reader has
 * decided what it means, and their answer is better than a fresh one - and it
 * is on the screen with no message and no waiting.
 *
 * @param {DOMRect} anchor
 * @param {string} text as the page has it
 * @param {string} normalized
 * @returns {boolean} whether it was known
 */
function showSaved(anchor, text, normalized) {
  const meanings = vocabulary.get(normalized);
  if (meanings === undefined) return false;

  current = { text, normalized };
  generation += 1;
  tooltip.show({ anchor, phrase: text, body: meanings.join("\n"), actions: ["learned", "edit"] });
  return true;
}

/**
 * @param {MouseEvent} event
 */
function onMouseUp(event) {
  if (tooltip.owns(event.target)) return;

  const selection = readSelection();
  if (selection === null) {
    // Nothing selected means a click, and a click may have landed on an
    // underline - which is the other half of what saving a phrase is for.
    const hit = phraseAt(event.clientX, event.clientY);
    if (hit !== null && showSaved(hit.rect, hit.text, hit.normalized)) return;

    tooltip.hide();
    current = null;
    return;
  }

  const normalized = normalize(selection.text);
  if (showSaved(selection.rect, selection.text, normalized)) return;

  current = { text: selection.text, normalized };
  const mine = ++generation;

  tooltip.show({
    anchor: selection.rect,
    phrase: selection.text,
    body: "Translating...",
    tone: "pending",
  });

  void ask({ kind: Message.TRANSLATE, text: selection.text }).then((result) => {
    if (mine !== generation || !tooltip.isOpen()) return;
    if (result.ok) {
      tooltip.setBody(typeof result.value === "string" ? result.value : "", "normal");
      // A selection of nothing but punctuation has no key, so there is nothing
      // to save it under.
      tooltip.setActions(normalized.length > 0 ? ["save", "edit"] : []);
    } else {
      tooltip.setBody(describeError(result.code), "error");
      tooltip.setActions(result.code === ErrorCode.MODEL_MISSING ? ["settings"] : []);
    }
  });
}

/**
 * @param {KeyboardEvent} event
 */
function onKeyDown(event) {
  if (event.key === "Escape" && tooltip.isOpen()) tooltip.escape();
}

// Capture phase: pages that stop propagation on their own selection handling
// are exactly the pages where this has to keep working.
document.addEventListener("mouseup", onMouseUp, { capture: true, passive: true });
document.addEventListener("keydown", onKeyDown, { capture: true, passive: true });
document.addEventListener(
  "scroll",
  () => {
    // Not while the edit box is open: a wheel nudge is not a reason to throw
    // away a translation somebody is in the middle of correcting.
    if (!tooltip.isEditing()) tooltip.hide();
  },
  { capture: true, passive: true },
);

// Both keys matter: the vocabulary changing in another tab, and the language
// pair changing in the settings - which makes the mirror describe a pair that
// is not being read here.
webext().storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[MIRROR_KEY] === undefined && changes[CONFIG_KEY] === undefined) return;
  void loadVocabulary();
});

void loadVocabulary();
