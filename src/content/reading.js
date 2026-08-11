/**
 * Everything reading a text is made of: what a selection means, what the bubble
 * shows, what gets kept, and which words are underlined.
 *
 * It runs in two places and is the same code in both. On somebody else's page a
 * content script starts it against `document.body`; on the reader page it is
 * started against the article. That is the whole of D42 - a second highlighter
 * for our own page would be a second set of bugs, and the reader would be the
 * one place where the bubble is not the bubble people learned.
 *
 * The budget here is the whole justification for `<all_urls>`, and it is spent
 * carefully: one read of `storage.local` at startup, and a listener for when the
 * vocabulary changes in another tab. Nothing else happens until there is a
 * selection, and nothing is added to the page until there is a bubble to show.
 *
 * Knowing the vocabulary here rather than asking the background for it is what
 * makes a word the reader already kept appear instantly, with no message and no
 * engine - and it means an install that has saved nothing pays for one storage
 * read per page and not a single wake-up of the background.
 */

import { webext } from "../lib/browser.js";
import { CONFIG_KEY, withDefaults } from "../lib/config.js";
import { choosableLines } from "../lib/gloss.js";
import { keyTokens } from "../lib/matcher/tokenize.js";
import { describeError } from "../lib/messages.js";
import { normalize, trimPhrase } from "../lib/normalize.js";
import { ErrorCode, Message, asResult, asTranslation, fail } from "../lib/protocol.js";
import { sentenceAround } from "../lib/sentence.js";
import { MIRROR_KEY, asMirror, mirrorMatches } from "../lib/store/mirror.js";
import { clear, paint, phraseAt } from "./highlighter.js";
import { blockTextAround } from "./scan.js";
import { createTooltip } from "./tooltip.js";

/** @typedef {import("../lib/protocol.js").VocabEntry} VocabEntry */

/** Saved phrases of the pair being read: normalized form to its meanings. */
/** @type {Map<string, string[]>} */
let vocabulary = new Map();

/** What the bubble is about right now, in the form the page had it. */
/** @type {{ text: string, normalized: string } | null} */
let current = null;

/**
 * The "More" button, if this phrase has a sentence or a dictionary entry behind
 * it - kept here rather than read back off the bubble, because saving and
 * forgetting rebuild the buttons and would otherwise drop the second layer
 * along the way.
 *
 * @type {import("./tooltip.js").Action[]}
 */
let secondLayer = [];

/**
 * Bumped every time the bubble starts being about something else. Selections
 * come faster than translations and than round trips to the database, and an
 * answer for an older one is dropped rather than painted over a bubble that has
 * moved on.
 */
let generation = 0;

/**
 * How many words a phrase may have before keeping it becomes a decision rather
 * than a consequence.
 *
 * Looking a word up is already the decision: a reader reaches for a translation
 * when the context did not give the meaning away, and that is exactly the word
 * worth meeting again. Asking them to confirm it is asking twice, in the middle
 * of a sentence they were reading.
 *
 * Longer than this and the selection is usually a sentence somebody wanted to
 * read rather than a phrase they wanted to keep - so that one waits for Save.
 */
const AUTO_KEEP_MAX_WORDS = 4;

const tooltip = createTooltip({ onAction });

/** What gets walked for saved phrases. The body, unless a caller says otherwise. */
/** @type {Element | null} */
let root = null;
/** Whether to follow the document changing. A built document does not. */
let follow = true;
let started = false;

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
  else paint(vocabulary.keys(), { root: root ?? document.body, observe: follow });
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
 * @returns {{ text: string, rect: DOMRect, context: string | null } | null}
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

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  // A range inside a collapsed or hidden element measures as nothing, and a
  // bubble anchored to nothing lands in the corner of the screen.
  if (rect.width === 0 && rect.height === 0) return null;

  return { text, rect, context: contextOf(range) };
}

/**
 * The sentence around a selection, or null when the page does not offer one.
 *
 * Wrapped in a catch because it is an extra: a page that makes this throw -
 * a range whose nodes are being replaced underneath it, say - still gets its
 * translation, just without a second layer.
 *
 * @param {Range} range
 * @returns {string | null}
 */
function contextOf(range) {
  try {
    const block = blockTextAround(range);
    return block === null ? null : sentenceAround(block.text, block.start, block.end);
  } catch {
    return null;
  }
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
  if (action === "save") await keep(meanings);
  else await forget();
}

/**
 * Both halves of writing to the vocabulary do the same three things afterwards,
 * and the reason for the middle one is the point of the feature: the mirror
 * will say the same thing in a moment through the storage event, but doing it
 * here too is what makes the underline appear in the paragraph being read
 * rather than a beat later.
 *
 * @param {(phrase: { text: string, normalized: string }) => Promise<import("../lib/protocol.js").Result<null>>} write
 * @param {(phrase: { text: string, normalized: string }) => void} remember
 * @param {import("./tooltip.js").Action[] | null} next what the bubble offers once it
 *   worked, or `null` when the answer was the end of the exchange
 */
async function change(write, remember, next) {
  const phrase = current;
  if (phrase === null) return;
  const mine = generation;

  const result = await write(phrase);
  if (mine !== generation || !tooltip.isOpen()) return;

  if (!result.ok) {
    // A failure keeps the bubble open whatever was asked for: this is the one
    // moment the reader has to learn that the vocabulary did not change.
    tooltip.setBody(describeError(result.code), "error");
    tooltip.setActions([]);
    return;
  }

  remember(phrase);
  repaint();

  if (next === null) {
    tooltip.hide();
    current = null;
    secondLayer = [];
    return;
  }

  tooltip.setActions([...next, ...secondLayer]);
}

/**
 * @param {string[]} meanings
 */
async function keep(meanings) {
  await change(
    (phrase) => ask({ kind: Message.SAVE_PHRASE, text: phrase.text, translations: meanings }),
    (phrase) => vocabulary.set(phrase.normalized, meanings),
    ["learned", "edit"],
  );
}

/**
 * Learned closes the bubble, and that is the whole answer to it.
 *
 * Offering **Save** afterwards said the opposite of what was just pressed - it
 * read as "are you sure you learned it?" over a word somebody had settled. The
 * underline going away is the confirmation, the phrase is out of the
 * vocabulary, and there is nothing left to do here (G0: answer, then leave).
 *
 * The word is not gone for good either way: selecting it again translates it
 * and, if it is short enough, keeps it again (D22).
 */
async function forget() {
  await change(
    (phrase) => ask({ kind: Message.FORGET_PHRASE, text: phrase.text }),
    (phrase) => vocabulary.delete(phrase.normalized),
    null,
  );
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
  // No second layer here, and that is the point: a phrase the reader already
  // kept is answered from the database, without a message and without waking
  // the engine. Translating its sentence would undo exactly that.
  secondLayer = [];
  // Recall: the answer, and nothing else until it is asked for (D44). Somebody
  // who clicked an underline wanted to know what the word was, and Learned is a
  // rare press on a decision they have already made - it can wait inside.
  tooltip.show({ anchor, variant: "recall", body: meanings.join("\n"), actions: ["learned", "edit"] });
  return true;
}

/**
 * Dictionary entries as the bubble takes them: a label, and the lines under it.
 *
 * The label is where two things get decided, and both need to know what was
 * selected - which is why they are decided here and not in the bubble. The
 * dictionary's name only earns a line when there is more than one to tell
 * apart, and the headword only when it is not the word the reader selected: a
 * definition of `watch` under a selection of `watches` has to say so, while one
 * under `watch` would just be repeating the page back (D23).
 *
 * The lines are the entry's meanings one to a row, which is the same thing the
 * reader has always seen and now also the thing they can press. Nothing about
 * the entry moves or disappears; what changes is where one row ends.
 *
 * @param {import("../lib/protocol.js").DictEntry[]} entries
 * @param {string} normalized what the reader selected, as its key
 * @returns {import("./tooltip.js").Block[]}
 */
function entryBlocks(entries, normalized) {
  const books = new Set(entries.map((entry) => entry.dictionary)).size;

  return entries.map((entry) => {
    const parts = [];
    if (normalize(entry.headword) !== normalized && entry.headword.length > 0) parts.push(entry.headword);
    if (books > 1 && entry.dictionary.length > 0) parts.push(entry.dictionary);
    return { label: parts.join(" - "), lines: choosableLines(entry.senses) };
  });
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
    secondLayer = [];
    return;
  }

  const normalized = normalize(selection.text);
  if (showSaved(selection.rect, selection.text, normalized)) return;

  current = { text: selection.text, normalized };
  secondLayer = [];
  const mine = ++generation;

  // The other variant: a fresh selection is a phrase nothing has been decided
  // about yet, so what can be done with it is on show from the first frame.
  tooltip.show({ anchor: selection.rect, variant: "save", body: "Translating...", tone: "pending" });

  const request = selection.context === null
    ? { kind: Message.TRANSLATE, text: selection.text }
    : { kind: Message.TRANSLATE, text: selection.text, context: selection.context };

  /** @type {Promise<import("../lib/protocol.js").Result<import("../lib/protocol.js").Translation>>} */
  const answer = ask(request);

  void answer.then((result) => {
    if (mine !== generation || !tooltip.isOpen()) return;

    if (!result.ok) {
      tooltip.setBody(describeError(result.code), "error");
      tooltip.setActions(result.code === ErrorCode.MODEL_MISSING ? ["settings"] : []);
      return;
    }

    const { gloss, sentence, entries } = asTranslation(result.value);
    tooltip.setBody(gloss, "normal");
    // Folded. The reader asked about a word, and G0 is about answering that
    // word and getting out of the way; the sentence and whatever the
    // dictionaries said wait for a second press.
    tooltip.setContext(sentence);
    const blocks = entryBlocks(entries ?? [], normalized);
    tooltip.setEntries(blocks);
    secondLayer = (sentence !== null && sentence.length > 0) || blocks.length > 0 ? ["more"] : [];

    // A selection of nothing but punctuation has no key to save it under, and
    // a phrase with no translation has nothing to save.
    if (normalized.length === 0 || gloss.length === 0) {
      tooltip.setActions([...secondLayer]);
      return;
    }

    if (keyTokens(normalized).length > AUTO_KEEP_MAX_WORDS) {
      tooltip.setActions(["save", "edit", ...secondLayer]);
      return;
    }

    // Kept without being asked. The buttons flip first and the write follows,
    // because the write is local and instant, and a bubble that shows no
    // buttons for a moment reads as a bubble that is still thinking.
    tooltip.setActions(["learned", "edit", ...secondLayer]);
    void keep([gloss]);
  });
}

/**
 * @param {KeyboardEvent} event
 */
function onKeyDown(event) {
  if (event.key === "Escape" && tooltip.isOpen()) tooltip.escape();
}

/**
 * @param {{ root?: Element | null, observe?: boolean }} [where]
 *   what to underline inside, and whether it can change on its own
 */
export function start(where = {}) {
  root = where.root ?? null;
  follow = where.observe ?? true;

  // Called again when the reader renders another article, and the listeners
  // must not stack up behind it.
  if (!started) {
    started = true;
    // Capture phase: pages that stop propagation on their own selection handling
    // are exactly the pages where this has to keep working.
    document.addEventListener("mouseup", onMouseUp, { capture: true, passive: true });
    document.addEventListener("keydown", onKeyDown, { capture: true, passive: true });
    document.addEventListener(
      "scroll",
      (event) => {
        // Not while the edit box is open: a wheel nudge is not a reason to throw
        // away a translation somebody is in the middle of correcting. And not for
        // a scroll of the bubble's own second layer, which is a reader working
        // their way through a long dictionary entry - a scroll event does not
        // cross a shadow boundary, so this should never fire for one, but the day
        // it does it must not close the thing being read.
        if (!tooltip.isEditing() && !tooltip.owns(event.target)) tooltip.hide();
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
  }

  void loadVocabulary();
}

/**
 * The text under the same root is different now - the reader has rendered
 * another article. The vocabulary has not changed, so nothing is asked of
 * storage; the ranges are simply found again.
 */
export function rescan() {
  repaint();
}
