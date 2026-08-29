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
 * A touch-capable device pays for two listeners more (D73): a selection made by
 * long-press and by the system's handles ends in no mouse gesture at all, so
 * there the document's `selectionchange` is listened to as well, behind a
 * settle timer and a pointer-type gate - at rest both amount to one comparison
 * per event, and a mouse-only device does not even install them. The reader
 * page alone adds a third way in (D80/D81, mouse too since D86, `select.js`):
 * its article refuses the native selection outright and selects through our
 * own gesture - a finger held on a word or a mouse press travelling, dragged
 * on to stretch whole words - whose end the page can hear, so there the
 * bubble, the translation and the keeping land exactly on the finger or the
 * button lifting, with no system menu in the way.
 *
 * Knowing the vocabulary here rather than asking the background for it is what
 * makes a word the reader already kept appear instantly, with no message and no
 * engine - and it means an install that has saved nothing pays for one storage
 * read per page and not a single wake-up of the background.
 */

import { webext } from "../lib/browser.js";
import { CONFIG_KEY, DEFAULTS, withDefaults } from "../lib/config.js";
import { choosableLines } from "../lib/gloss.js";
import { t } from "../lib/i18n.js";
import { describeError } from "../lib/messages.js";
import { normalize, trimPhrase } from "../lib/normalize.js";
import { ErrorCode, Message, asResult, asTranslation, fail } from "../lib/protocol.js";
import { copyCombo, keeping, madeSelection, touchPointer } from "../lib/selection.js";
import { sentenceAround } from "../lib/sentence.js";
import { MIRROR_KEY, asMirror, mirrorMatches } from "../lib/store/mirror.js";
import { canSpeak, setSpeechOff, speak, speaking, stop as stopSpeaking } from "../lib/tts.js";
import { clear, mark, paint, phraseAt, unmark } from "./highlighter.js";
import { blockTextAround, findable } from "./scan.js";
import { claimsNativeSelection, clearSelection, releaseMouse, startSelect, stopSelect } from "./select.js";
import { createTooltip } from "./tooltip.js";

/** @typedef {import("../lib/protocol.js").VocabEntry} VocabEntry */

/** Saved phrases of the pair being read: normalized form to its meanings. */
/** @type {Map<string, string[]>} */
let vocabulary = new Map();

/**
 * What the bubble is about right now, in the form the page had it - and whether
 * the vocabulary may be written for it at all. A phrase earns that either by
 * being findable on a page (`findable` in `scan.js`) or by already being saved,
 * and nothing else gets in: not Save, and not a dictionary line either.
 */
/** @type {{ text: string, normalized: string, keepable: boolean } | null} */
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
 * What More still has to fetch: the sentence around a recalled phrase, when the
 * bubble opened straight from the database and no engine has run (D27). Null
 * whenever there is nothing left to ask for - a fresh selection's layer arrives
 * with its translation, and a fetched layer stays fetched. The sentence rides
 * in a wrapper because it can honestly be null with the fetch still worth
 * making: the dictionaries answer without one.
 *
 * @type {{ context: string | null } | null}
 */
let unfetched = null;

/**
 * Bumped every time the bubble starts being about something else. Selections
 * come faster than translations and than round trips to the database, and an
 * answer for an older one is dropped rather than painted over a bubble that has
 * moved on.
 */
let generation = 0;

/**
 * The range of the phrase the open bubble stands by, cloned at showing so it
 * keeps meaning that phrase whatever the live selection does afterwards. On
 * the pages where the bubble is a viewport thing it is how the bubble follows
 * its phrase through a scroll (D82) - the reader's document-pinned bubble
 * rides without it. Written by every show, read only while the bubble is
 * open; a closed bubble makes whatever is left here meaningless.
 *
 * @type {Range | null}
 */
let anchorRange = null;

/**
 * The speaker, where a voice is on offer (D83): every row about a phrase
 * leads with it, because hearing the phrase is about the phrase and not
 * about the vocabulary - the one action here that never writes. Asked at
 * every opening rather than once at startup: a device without the API never
 * shows the button, and neither does a reader who switched reading aloud off
 * in the settings (D148) - a flip that reaches an open page through the same
 * storage read as everything else here (`loadVocabulary`).
 *
 * @returns {import("./tooltip.js").Action[]}
 */
function speakActions() {
  return canSpeak() ? ["speak"] : [];
}

/**
 * The clipboard's icon (D110), second picture of the row: it opens the copy
 * row, and copying writes nothing - so it stands wherever there is a finished
 * gloss to stand over, the unkeepable phrases included. Only the pending and
 * error states go without, because "copy translation" over "Translating..."
 * or over an apology would copy the furniture.
 *
 * @type {import("./tooltip.js").Action[]}
 */
const COPY = ["copy"];

/**
 * What the bubble offers for a phrase that is in the vocabulary.
 *
 * @returns {import("./tooltip.js").Action[]}
 */
function kept() {
  return [...speakActions(), ...COPY, "learned", "edit"];
}

/**
 * The phrase the current chain of the reader's own selection kept without
 * asking, if any.
 * The chain's opening gesture keeps its phrase when it is short enough (D22),
 * and the taps and clicks that grow the phrase afterwards deliberately do
 * not (D81) - they offer Save instead, and the Save that lands is what takes this
 * scaffolding step back out of the vocabulary (`keep`): what survives the
 * chain is the reader's last answered gesture, never both. Cleared when a
 * chain ends - a dismissal leaves the kept step standing, because nothing
 * ever replaced it - and never set for a phrase that was already in the
 * vocabulary: those the reader put there on purpose.
 *
 * @type {{ text: string, normalized: string } | null}
 */
let autoKept = null;

/**
 * The three answers of `keeping()` as rows of buttons. The rule is in
 * `src/lib/selection.js`, where it can be tested; what it looks like is here,
 * because that is a question about the bubble.
 *
 * @param {ReturnType<typeof keeping>} decision
 * @returns {import("./tooltip.js").Action[]}
 */
function offered(decision) {
  switch (decision) {
    // Nothing to keep, so nothing to write - the speaker and the clipboard
    // still stand, because a phrase too long to save is still a phrase worth
    // hearing, and a whole translated sentence is exactly what gets copied
    // out into notes (D110).
    case "none":
      return [...speakActions(), ...COPY];
    case "ask":
      return [...speakActions(), ...COPY, "save", "edit"];
    default:
      return kept();
  }
}

// A bubble gone is a phrase not worth talking about any more, whichever way
// it went - mid-word is exactly when a dismissal should go quiet (D83), and
// the mark under the phrase leaves with the bubble it belongs to (D89).
const tooltip = createTooltip({
  onAction,
  onHide: () => {
    stopSpeaking();
    unmark();
  },
  // Live, through the module variable: the tooltip is built once, but what
  // stands over the text is the ground's business and changes with `start`.
  covered: () => coveredAbove(),
});

/**
 * The quiet-bubble setting (D81), mirrored from the config the way the
 * vocabulary is: while this is on, a bubble opens with its action row folded -
 * every bubble, the answer to a fresh selection and the answer to a tap on an
 * underline alike (D131) - and the row comes out on a press, on approach - or
 * by itself when Save or an error's one button is the point, which no setting
 * may hide.
 */
let hideActions = DEFAULTS.hideBubbleActions;

/**
 * How heavily saved phrases are underlined (D130), mirrored the same way. It
 * decides which highlight registration the paint goes on, so a change here is
 * a repaint - which is what the storage listener does with every change
 * anyway.
 *
 * @type {import("../lib/underline.js").UnderlineWeight}
 */
let underline = DEFAULTS.underline;

/**
 * The translation-off setting (D120), mirrored the same way. On ordinary
 * pages this module never even starts under it (`pageMode`); on the reader
 * page it keeps running - the gesture is also the highlighter's, and the
 * article refuses the native selection - but with the translation half gone:
 * no vocabulary, no underlines, no engine, and a bubble trimmed to the
 * phrase's own two acts, hearing it and copying it - plus, since D121,
 * whatever the installed dictionaries have to say.
 */
let noTranslation = DEFAULTS.translationOff;

/**
 * The reader page's two hands into the quiet bubble (D121), null everywhere
 * else: a dictionary lookup in the language of the document on screen, and
 * the voice that language should be spoken with. Only the reader can offer
 * them - the dictionaries' database is the extension's own, out of a content
 * script's reach, and only the reader knows what language it is showing.
 * Both are consulted solely in the no-translation trim; the translating
 * bubble keeps its pair-bound language (D83) and its background ride (D31).
 *
 * @type {((text: string) => Promise<import("../lib/protocol.js").DictEntry[]>) | null}
 */
let quietLookup = null;

/** @type {(() => { lang: string, voiceURI: string | undefined } | null) | null} */
let quietVoice = null;

/**
 * The bubble-size knob (D85), mirrored the same way: every show hands the
 * bubble a plain factor, and the settings page changing it reaches every open
 * page through the storage listener already paid for.
 */
let bubbleScale = DEFAULTS.bubbleScale;

/**
 * The speaker's half of the config (D83), mirrored for the same reason: the
 * phrase is spoken in the language being read, with the voice chosen for it,
 * and reading storage at press time would cost a round trip the storage
 * listener already pays for everybody.
 *
 * Empty while no pair is chosen: an utterance with an empty `lang` speaks in
 * the engine's own default, which is the only honest voice for a phrase
 * whose language nobody has named.
 */
let ttsLang = "";

/** @type {string | undefined} */
let ttsVoiceURI = undefined;

/**
 * How fast the voice reads, mirrored like the rest (D87). One setting for both
 * places a voice speaks: somebody who set the reader's article to half speed
 * wants the phrase in the bubble at half speed too, because what is slow is
 * the language, not the surface.
 */
let ttsRate = DEFAULTS.ttsRate;

/** Where the press this release belongs to started, and whether it was ours. */
/** @type {{ x: number, y: number, mine: boolean } | null} */
let press = null;

/** The last press's pointer type, so the settle path answers touch alone. */
let lastPointerType = "";

/** The touch path's settle timer, alive only while a selection is moving. */
/** @type {number | null} */
let settleTimer = null;

/**
 * How long a touch selection has to hold still before it is answered - the
 * launcher's number (`launcher.js`), for the launcher's reason: long enough to
 * outlast the `selectionchange` storm of a drag, short enough that nobody
 * waits on it. Here a settling costs an engine run, but the timer starting
 * over with every change means a drag in motion never pays it.
 */
const SETTLE_MS = 300;

/** What gets walked for saved phrases. The body, unless a caller says otherwise. */
/** @type {Element | null} */
let root = null;
/** Whether to follow the document changing. A built document does not. */
let follow = true;
/**
 * Whether bubbles pin to the page rather than to the viewport - the reader's
 * mode (D81): there a bubble is a margin note that rides with the text when
 * the page scrolls. On somebody else's page the bubble stays a viewport
 * thing and follows its phrase through a scroll by hand instead
 * (`onScroll`, D82) - either way a scroll no longer means "close", and only
 * a deliberate press elsewhere does.
 */
let anchored = false;
let started = false;

/**
 * How far down the window the reader page's own bar reaches - stuck over the
 * text while an article is on screen (D93). The bubble asks on every
 * placement (D138): the room it may stand in and the scroll assist's ceiling
 * both start under the bar, or the assist parks the very line it kept for
 * the reader beneath the one thing on our page that covers text. On every
 * other page nothing of ours stands over the text, and the answer stays 0 -
 * a foreign page's sticky bars are as unknowable as its scroll is
 * untouchable (D97).
 *
 * @type {() => number}
 */
let coveredAbove = () => 0;

/**
 * The reader page's own way to the settings (D139), for the bubble's
 * settings button: a walk in the page's one tab, so the way back exists on
 * a phone. Null everywhere else, where the button asks the background for
 * the settings tab instead - a content script never navigates its host.
 *
 * @type {(() => void) | null}
 */
let openSettings = null;

/**
 * What else counts as ours besides the bubble - the reader's delete bubble
 * for a highlighter mark, mostly (D106). Presses on it must read the way
 * presses on the tooltip read: not the page's, so no dismissal, no recall
 * hit-test through it, no gesture armed under it. A callback because the
 * element appears and hides on the reader's own schedule.
 *
 * @type {(target: EventTarget | null) => boolean}
 */
let alsoOwns = () => false;

/**
 * Whether Ctrl+C copies the open bubble's phrase - the clipboard bridge
 * (D110), and only ever the reader page's (`ownSelection`): its article
 * refuses the native selection (D80, D86), so the chord is dead there unless
 * the page answers it. On somebody else's page the bubble stands over a live
 * native selection and the chord already copies it - answering too would be
 * changing how their page works.
 */
let bridgeCopy = false;

/**
 * @param {EventTarget | null} target
 * @returns {boolean} whether a press there is ours rather than the page's
 */
function owns(target) {
  return tooltip.owns(target) || alsoOwns(target);
}

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
  // Stopped while the read was in flight - the popup's switch can land between
  // a page loading and its vocabulary arriving. Painting now would put
  // underlines, and an observer, on a page that was just switched off.
  if (!started) return;
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
  else paint(vocabulary.keys(), { root: root ?? document.body, observe: follow, weight: underline });
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
 *
 * @param {Record<string, unknown>} [preloaded] the same two keys, already
 *   read. The content script reads storage once per page and that read decides
 *   whether this starts at all - handing it in here is what keeps "one read at
 *   startup" true now that somebody reads before starting.
 */
async function loadVocabulary(preloaded) {
  // Nothing here may reject: the console this would land in belongs to the page
  // being read, and an extension that logs stack traces into it looks exactly
  // like an extension that broke it.
  try {
    const stored = preloaded ?? (await webext().storage.local.get([CONFIG_KEY, MIRROR_KEY]));
    const config = withDefaults(stored[CONFIG_KEY]);
    const mirror = asMirror(stored[MIRROR_KEY]);
    // Rides the same read and the same storage listener as the vocabulary:
    // flipping the switch in the popup reaches every open page on the spot.
    hideActions = config.hideBubbleActions;
    // Repainted below with every other change this read carries: the weight
    // is a registration name, so a new one is a repaint, not a restyle (D130).
    underline = config.underline;
    bubbleScale = config.bubbleScale;
    ttsLang = config.sourceLang ?? "";
    ttsVoiceURI = config.sourceLang === null ? undefined : config.ttsVoices[config.sourceLang];
    ttsRate = config.ttsRate;
    // The reading-aloud switch (D148), handed to the one question every
    // speaker asks: the next bubble opens without its speaker, and a phrase
    // being read when the flip lands falls silent.
    setSpeechOff(config.ttsOff);
    noTranslation = config.translationOff;

    // With translation off there is no vocabulary to know (D120): nothing is
    // underlined, no mirror is adopted and the background is never asked.
    // An empty adopt rather than a plain return, because the switch can flip
    // over a page already painted - the underlines have to leave with it.
    if (noTranslation) {
      adopt([]);
      return;
    }

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
 * A range read into everything presenting needs, wherever the range came from:
 * the native selection's first range, or the one the reader's touch selection
 * built (D80). Null when there is nothing to present - no text, or nothing on
 * the screen to anchor a bubble to. The range itself rides along, because a
 * bubble that follows its phrase through a scroll (D82) has to ask where the
 * phrase is now, and only the range can answer that.
 *
 * @param {Range} range
 * @returns {{ text: string, normalized: string, rect: DOMRect, range: Range, context: string | null, findable: boolean } | null}
 */
function fromRange(range) {
  // Trimmed before anything is done with it, the engine included. Dragging over
  // a word catches the comma after it, and translating `Pacific,` gives back
  // `Pacyfiku,` - a comma nobody selected, saved into the vocabulary and
  // exported onto a flashcard. What is translated has to be what is stored.
  const text = trimPhrase(range.toString());
  if (text.length === 0) return null;

  const rect = range.getBoundingClientRect();
  // A range inside a collapsed or hidden element measures as nothing, and a
  // bubble anchored to nothing lands in the corner of the screen.
  if (rect.width === 0 && rect.height === 0) return null;

  const normalized = normalize(text);
  // Asked here, while the range is the one the reader just made: by the time
  // the translation comes back the page may have moved on, and whether a phrase
  // can be found again is a question about the page, not about the answer.
  return { text, normalized, rect, range, context: contextOf(range), findable: findable(range, normalized) };
}

/**
 * @returns {ReturnType<typeof fromRange>}
 */
function readSelection() {
  const selection = window.getSelection();
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  // A scoped start reads nothing outside its scope. On the reader page the
  // root is the article - the one text being read - and a native selection
  // can only exist outside it (the article refuses it, select.js): in the
  // library list, the bar, the transfer section. Those are somebody using
  // the page, not reading a text, and answering them translated the page's
  // own chrome - and quietly kept it (D22). A content script starts
  // unscoped, so somebody else's page keeps every selection it ever had.
  if (root !== null && !root.contains(range.commonAncestorContainer)) return null;
  return fromRange(range);
}

/**
 * The height of a range's first line - the one part of a long phrase the
 * bubble's scroll assist promises to keep on the screen when it cannot keep
 * every line (D97). A range starting mid-line begins with that line's
 * fragment, whose height is the line's; zero when the range has nothing on
 * the screen, which the bubble reads as "keep the whole rect".
 *
 * @param {Range} range
 * @returns {number}
 */
function firstLineOf(range) {
  const first = range.getClientRects()[0];
  return first === undefined ? 0 : first.height;
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
  // The launcher bubble's one button, which this side never offers - the guard
  // is here so the type can say so without a stray report ever writing.
  if (action === "reader") return;
  if (action === "settings") {
    // The reader page walks to the settings in its own tab (D139) - the way
    // back must exist on a phone - and hands the walk down; on somebody
    // else's page the background opens the settings tab instead, because a
    // content script never navigates the page it is a guest on.
    if (openSettings !== null) openSettings();
    else void ask({ kind: Message.OPEN_SETTINGS });
    tooltip.hide();
    return;
  }
  if (action === "speak") {
    // Start or stop, decided by what is playing: hearing the phrase writes
    // nothing, so no keepable gate - and what is spoken is the page's own
    // text, never the gloss (D83). In the no-translation trim the reader
    // hands down the document's own language and its voice (D121) - there is
    // no pair being read, so the pair may not choose the voice; everywhere
    // else the pair-bound language stands.
    if (speaking()) stopSpeaking();
    else if (current !== null) {
      const voice = (noTranslation ? quietVoice?.() : null) ?? { lang: ttsLang, voiceURI: ttsVoiceURI };
      speak(current.text, voice.lang, voice.voiceURI, ttsRate / 100);
    }
    return;
  }
  if (action === "learned") {
    await forget();
    return;
  }
  if (action === "more") {
    await fillSecondLayer();
    return;
  }

  // Both of the remaining two write to the vocabulary, so both answer to the
  // same rule: a phrase no scan could ever find does not get in - not through
  // Save, which is not offered for one, and not through the second layer
  // either, where a dictionary line is a press that saves.
  if (current !== null && !current.keepable) return;

  // Save closes the bubble, for the reason Learned does: a decision answered
  // with another question asks it twice (D34). The phrase is kept, the
  // underline is under it, and there is nothing left here to press.
  //
  // Choosing a dictionary line writes exactly the same thing and is exactly not
  // that: it is somebody assembling a meaning, and the next line has to still
  // be there to press - as does the same line, to take it back out (D34).
  if (action === "save") await keep(meanings, null);
  else await keep(meanings, kept());
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
    // The answer was the end of the exchange, and it takes the touch
    // selection with it (D81): the phrase is kept or forgotten, the underline
    // says which, and a highlight left standing would ask the question again.
    tooltip.hide();
    clearSelection();
    autoKept = null;
    current = null;
    secondLayer = [];
    unfetched = null;
    return;
  }

  tooltip.setActions([...next, ...secondLayer]);
}

/**
 * @param {string[]} meanings
 * @param {import("./tooltip.js").Action[] | null} next what the bubble offers
 *   afterwards, or `null` to close it - see `onAction`
 */
async function keep(meanings, next) {
  await change(
    (phrase) => ask({ kind: Message.SAVE_PHRASE, text: phrase.text, translations: meanings }),
    (phrase) => {
      // A save that lands replaces the chain's earlier automatic keep (D81):
      // that step was scaffolding for the phrase it grew into, and leaving it
      // would put two overlapping entries in the vocabulary and onto the
      // flashcards. Fire and forget, literally - a failure leaves a word the
      // reader can Learned away, not worth holding this save for.
      const kept = autoKept;
      if (kept !== null && kept.normalized !== phrase.normalized) {
        autoKept = null;
        void ask({ kind: Message.FORGET_PHRASE, text: kept.text });
        vocabulary.delete(kept.normalized);
      }
      vocabulary.set(phrase.normalized, meanings);
    },
    next,
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
 *
 * Save ends the same way and for the same reason (`onAction`) - the two are one
 * rule seen from either side of the vocabulary.
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
 * @param {string | null} context the sentence around the phrase, when the page has one
 * @param {{ touch?: boolean, range?: Range }} [how]
 *   whether the anchor is a native selection made by touch, and the range the
 *   anchor rect was measured from - what following a scroll follows (D82)
 * @returns {boolean} whether it was known
 */
function showSaved(anchor, text, normalized, context, how = {}) {
  const meanings = vocabulary.get(normalized);
  if (meanings === undefined) return false;

  // The bubble is reused from phrase to phrase without passing through hide,
  // and a voice still reading the last phrase may not talk over this one.
  stopSpeaking();
  // In the vocabulary already, which is the whole of what getting here means -
  // so its meanings may be corrected from anywhere, however it was reached.
  current = { text, normalized, keepable: true };
  generation += 1;
  anchorRange = how.range === undefined ? null : how.range.cloneRange();
  // The page's half of the recall bubble (D89): the bubble does not repeat
  // its phrase, and a tap on an underline - unlike a fresh selection - leaves
  // nothing else on the screen saying which word this is the answer to. Where
  // a live selection does say it, the wash simply disappears beneath it.
  if (how.range === undefined) unmark();
  else mark(how.range);
  // The layer itself is empty, and stays empty until it is asked for: the
  // answer comes from the database, without a message and without waking the
  // engine (D27). More is the press that says the sentence and the
  // dictionaries are worth an engine ride after all, and only then do they go
  // to the background (`fillSecondLayer`).
  secondLayer = ["more"];
  unfetched = { context };
  // Recall: the answer first, and the row of actions with it or behind a fold,
  // exactly as the quiet-bubble setting says (D131). D44 made this variant the
  // folded one on its own - somebody who clicked an underline wanted to know
  // what the word was, and Learned is a rare press on a decision they have
  // already made - but that was a rule about one of the two bubbles, and the
  // setting is a sentence about all of them: with it off, nothing hides.
  tooltip.show({
    anchor,
    line: how.range === undefined ? 0 : firstLineOf(how.range),
    variant: "recall",
    body: meanings.join("\n"),
    actions: [...kept(), ...secondLayer],
    phrase: text,
    folded: hideActions,
    touch: how.touch === true,
    // Not `how.touch`, which a tap on an underline honestly lacks - the
    // system puts no handles around a tap. What sizes the bubble is the
    // pointer that pressed (D84), whichever way the press came in.
    coarse: touchPointer(lastPointerType),
    scale: bubbleScale / 100,
    anchored,
  });
  return true;
}

/**
 * The second layer of a recall bubble, fetched on the press that first opens
 * it. One `translate` round trip brings everything the eager path gets - the
 * translated sentence and the dictionary entries, side by side (D31) - and the
 * fresh gloss it also brings is dropped: the reader has decided what the
 * phrase means, and their answer stays the body.
 */
async function fillSecondLayer() {
  const phrase = current;
  const wanted = unfetched;
  if (phrase === null || wanted === null) return;
  // Taken rather than marked: a second press while this one is in flight finds
  // nothing left to ask for, and a failure puts it back so More can try again.
  unfetched = null;
  const mine = generation;

  tooltip.setContext(t("bubble_translating"), "pending");

  /** @type {Promise<import("../lib/protocol.js").Result<import("../lib/protocol.js").Translation>>} */
  const answer = ask(
    wanted.context === null
      ? { kind: Message.TRANSLATE, text: phrase.text }
      : { kind: Message.TRANSLATE, text: phrase.text, context: wanted.context },
  );
  const result = await answer;
  if (mine !== generation || !tooltip.isOpen()) return;

  if (!result.ok) {
    unfetched = wanted;
    // In the layer, not the body: the saved meanings are still the answer, and
    // this is only the extra failing to arrive.
    tooltip.setContext(describeError(result.code), "error");
    return;
  }

  const { sentence, entries } = asTranslation(result.value);
  const blocks = entryBlocks(entries ?? [], phrase.normalized);

  // Nothing behind More after all - no sentence to translate (a selected
  // phrase that is a whole short sentence, common in a book's dialogue),
  // nothing in the dictionaries. The layer still answers: this build took
  // the button away instead, and the bubble snapping shut on the press that
  // opened it read as the UI breaking. The line stays for as long as the
  // bubble does, and More goes on folding it like any other layer.
  if ((sentence === null || sentence.length === 0) && blocks.length === 0) {
    tooltip.setContext(t("bubble_nothing_more"), "note");
    tooltip.setEntries([]);
    return;
  }

  tooltip.setContext(sentence);
  tooltip.setEntries(blocks);
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
function onMouseDown(event) {
  press = { x: event.clientX, y: event.clientY, mine: owns(event.target) };
}

/**
 * @param {MouseEvent} event
 */
function onMouseUp(event) {
  // The reader's own selection hears the release first (D86): a drag or a
  // hold ending gets its bubble there, and a click on the selection's
  // neighbour grows the phrase - either way this listener's own reading of
  // the release (a dismissal, an underline, the native selection) must not
  // also run. A no-op on every page but the reader, where the module starts.
  if (releaseMouse(event)) {
    press = null;
    return;
  }

  if (owns(event.target)) return;

  const from = press;
  press = null;
  // A press that began inside the bubble was not about the page: the bubble
  // swallows its own `mousedown` (D23), so nothing down there moved.
  if (from?.mine === true) return;
  // Only the first button. The others open a context menu over the text
  // somebody is reading, and neither the menu nor the bubble should move for
  // it - least of all by translating the selection the menu is about to act on.
  if (event.button !== 0) return;

  const gesture = { from, to: { x: event.clientX, y: event.clientY }, clicks: event.detail };
  const selection = madeSelection(gesture) ? readSelection() : null;

  if (selection === null) {
    // No selection made, which means a click - and a click may have landed on
    // an underline, which is the other half of what saving a phrase is for.
    // Either way the reader's own chain is over: a click or a tap that got
    // this far is one the selection module stepped aside for.
    clearSelection();
    autoKept = null;
    const hit = phraseAt(event.clientX, event.clientY);
    if (hit !== null && showSaved(hit.rect, hit.text, hit.normalized, contextOf(hit.range), { range: hit.range })) {
      return;
    }

    tooltip.hide();
    current = null;
    secondLayer = [];
    unfetched = null;
    return;
  }

  present(selection, { deliberate: true, touch: false });
}

/**
 * A selection, answered: recall when it is already in the vocabulary, a
 * translation on its way otherwise. Every listener ends here - the mouse
 * gesture releasing, a native touch selection holding still, and the reader's
 * own gesture ending (D80, D86) - and `how` is the whole of the difference
 * they hand down.
 *
 * @param {NonNullable<ReturnType<typeof fromRange>>} selection
 * @param {object} how
 * @param {boolean} how.deliberate whether a gesture ended exactly here - what
 *   `keeping` may write on (a selection that settled under a timer, and a tap
 *   or click growing the reader's own selection, never keep by themselves)
 * @param {boolean} how.touch whether the anchor is a *native* touch selection,
 *   wearing the system's bar and handles: the bubble then stands a system
 *   strip away (D74). The reader's own selection wears nothing and
 *   keeps D23's close gap.
 * @param {boolean} [how.chain] whether this came through the reader's own
 *   selection (D81, D86), whose Save revises the chain's automatic keep
 *   (`autoKept`)
 */
function present(selection, { deliberate, touch, chain = false }) {
  // Any other channel answering is a chain ending mid-thought: what the chain
  // kept stands - its last gesture was deliberate - but nothing about the new
  // phrase may revise it.
  if (!chain) autoKept = null;

  const { text, normalized } = selection;

  // The no-translation trim (D120): the gesture keeps working - on the reader
  // page it is also the highlighter's, and the article refuses the native
  // selection (D80/D86), so without a bubble nothing could be copied at all -
  // but the phrase is not translated, not kept and not looked up. What is
  // left is the phrase's own two acts: hearing it and copying it. Never
  // folded, whatever the quiet-bubble setting says - the two buttons are the
  // bubble's whole content, and folded away they would leave it empty.
  if (noTranslation) {
    stopSpeaking();
    unmark();
    current = { text, normalized, keepable: false };
    secondLayer = [];
    unfetched = null;
    anchorRange = selection.range.cloneRange();
    const mine = ++generation;
    tooltip.show({
      anchor: selection.rect,
      line: firstLineOf(selection.range),
      variant: "quiet",
      body: "",
      actions: [...speakActions(), ...COPY],
      phrase: text,
      touch,
      coarse: touchPointer(lastPointerType),
      scale: bubbleScale / 100,
      anchored,
    });
    // The dictionaries still answer without the engine (D121): the reader
    // hands the lookup down, in the language of the document on screen. The
    // entries land in the bubble the moment they arrive - the quiet variant
    // keeps no fold, because with no gloss the definitions are not an extra
    // behind the answer, they are the answer. An empty result changes
    // nothing: the bubble already stands on its two buttons.
    if (quietLookup !== null) {
      void quietLookup(text).then((entries) => {
        if (mine !== generation || !tooltip.isOpen()) return;
        if (entries.length > 0) tooltip.setEntries(entryBlocks(entries, normalized));
      });
    }
    return;
  }

  if (showSaved(selection.rect, text, normalized, selection.context, { touch, range: selection.range })) return;

  // The same cut `showSaved` makes: this show does not pass through hide either.
  stopSpeaking();
  // A fresh selection marks itself; a recall mark left over from the last
  // phrase may not keep pointing at it (D89).
  unmark();
  current = { text, normalized, keepable: selection.findable };
  secondLayer = [];
  unfetched = null;
  anchorRange = selection.range.cloneRange();
  const mine = ++generation;

  // The other variant: a fresh selection is a phrase nothing has been decided
  // about yet, so what can be done with it is on show from the first frame -
  // unless the quiet-bubble setting says the answer comes first and the row
  // waits to be asked for (D81). The same one answer as the recall bubble's
  // above (D131): one checkbox, every opening. What the setting never hides
  // is a Save or an error's button: those reveal on their own when the answer
  // lands (`reveal`).
  tooltip.show({
    anchor: selection.rect,
    line: firstLineOf(selection.range),
    variant: "save",
    body: t("bubble_translating"),
    tone: "pending",
    phrase: text,
    touch,
    // Every way in remembers its pointer (`lastPointerType`), so one answer
    // serves them all (D84): the reader's own gesture and a settled native
    // selection size for the finger, a mouse gesture for the desk.
    coarse: touchPointer(lastPointerType),
    scale: bubbleScale / 100,
    folded: hideActions,
    anchored,
  });

  const request = selection.context === null
    ? { kind: Message.TRANSLATE, text }
    : { kind: Message.TRANSLATE, text, context: selection.context };

  /** @type {Promise<import("../lib/protocol.js").Result<import("../lib/protocol.js").Translation>>} */
  const answer = ask(request);

  void answer.then((result) => {
    if (mine !== generation || !tooltip.isOpen()) return;

    if (!result.ok) {
      tooltip.setBody(describeError(result.code), "error");
      tooltip.setActions(result.code === ErrorCode.MODEL_MISSING ? ["settings"] : []);
      // A chain's bubble opens with the row folded, and an error's one real
      // button must not be behind a fold nobody knows is there.
      tooltip.reveal();
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

    const decision = keeping({ normalized, gloss, findable: selection.findable, deliberate });
    tooltip.setActions([...offered(decision), ...secondLayer]);
    // A phrase that is a question rather than an answer - too long to keep
    // itself, or grown by a tap (D81) - leads with the asking: Save is the
    // point of this bubble, so the row it sits in comes out on its own.
    if (decision === "ask") tooltip.reveal();

    // Kept without being asked. The buttons flip first and the write follows,
    // because the write is local and instant, and a bubble that shows no
    // buttons for a moment reads as a bubble that is still thinking. In a
    // touch chain the keep is also remembered, so that the Save of a phrase
    // grown out of it can take this step back out (`keep`) - remembered
    // before the write lands, because forgetting something that never got
    // written costs nothing and the other order leaks scaffolding.
    if (decision === "automatic") {
      if (chain) autoKept = { text, normalized };
      void keep([gloss], kept());
    }
  });
}

/**
 * The reader's own selection, answered (D80, reshaped by D81, the mouse's
 * too since D86). `press` is the selecting gesture ending - the finger
 * lifting off a hold-and-drag, the mouse button releasing a drag or a hold,
 * a double click taking its word - a fresh statement of the whole phrase,
 * and the start of a chain; `extend` is a tap or click growing the standing
 * phrase by its neighbour; `again` is one on the selection itself - a knock
 * on a bubble that may have closed over it.
 *
 * Only the gesture's end may keep by itself (`deliberate`): the finger or
 * the button lifted exactly there, asserting the whole phrase, and D22 does
 * the rest. The taps and clicks that grow the phrase afterwards ask instead
 * - Save, revealed - both because a phrase built in steps is exploration
 * that deserves a look before it lands in the vocabulary, and because each
 * growing step would otherwise write an entry of its own. The Save that
 * lands takes the chain's automatic keep back out (`keep`); a chain
 * dismissed instead keeps what its last answered gesture kept.
 *
 * @param {Range} range the selection as the module built it
 * @param {import("./select.js").GestureKind} kind
 */
function presentGesture(range, kind) {
  const selection = fromRange(range);
  if (selection === null) return;

  // The phrase the bubble is already open about, tapped once more - nothing
  // new to answer, and answering would ride the engine to repaint it.
  if (kind !== "extend" && tooltip.isOpen() && current !== null && current.text === selection.text) return;

  // A fresh statement starts a chain of its own; whatever the last one kept
  // was its final word, and stands.
  if (kind === "press") autoKept = null;

  // Never `touch` in the D74 sense: this selection is the reader page's own,
  // no system bar or handles around it, so the bubble may stand close (D23) -
  // which is half the point of having it (D80).
  present(selection, { deliberate: kind === "press", touch: false, chain: true });
}

/**
 * @param {PointerEvent} event
 */
function onPointerDown(event) {
  lastPointerType = event.pointerType;
}

/**
 * The touch half of listening (D73). The launcher already answers handles with
 * `selectionchange` behind a settle timer, and D47's terms not applying to
 * them is argued there (`launcher.js`); this is the same answer with the mouse
 * kept out of it, because the mouse has a better listener - a gesture with an
 * end - and reading the document mid-gesture is exactly what D47 is about.
 */
function onSelectionChange() {
  // A pen is a finger here (D80): the system wraps its selection in the same
  // bar and handles, which end in no gesture a page can hear.
  if (!touchPointer(lastPointerType)) return;
  if (settleTimer !== null) window.clearTimeout(settleTimer);
  settleTimer = window.setTimeout(settled, SETTLE_MS);
  yieldToSelection();
}

/**
 * An open bubble stands aside the moment the selection under it moves again
 * (D75). Dragging a system handle sends the page no pointer event at all, so
 * the selection changing is the only signal there is - and a bubble that
 * stayed put covered the very words the handle was heading for, which is how
 * this was reported. The settle timer then answers the selection that ends up
 * made.
 *
 * Two changes fall through on purpose. A ghost - the system's toolbar poking
 * a selection that did not move - carries the phrase already shown and may
 * not blink it. A collapse carries no phrase at all, and is the tap's
 * business: its compatibility mouse events already decide what closing means,
 * and hiding here would close the recall bubble a tap on an underline just
 * opened (D73).
 */
function yieldToSelection() {
  if (!tooltip.isOpen() || tooltip.isEditing()) return;

  const selection = window.getSelection();
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return;
  // On the reader that native selection is nobody's: the article refuses
  // native selecting, and what appears there anyway is iOS's parallel
  // long-press machinery, already being taken back by select.js - which
  // registers after this listener, so the selection still reads as standing
  // here. Yielding to it would close the bubble over the painted selection
  // and orphan the paint (the iPad spike's stale wash, 2026-08-25).
  if (claimsNativeSelection(selection.anchorNode)) return;
  const text = trimPhrase(selection.toString());
  if (text.length === 0 || (current !== null && text === current.text)) return;

  tooltip.hide();
  current = null;
  secondLayer = [];
  unfetched = null;
}

/** The selection as it stands once it has held still under a finger. */
function settled() {
  settleTimer = null;
  // Not over the edit box: caret moves in there fire `selectionchange` too,
  // and a bubble being retyped must not be swapped for the bubble reopening.
  if (tooltip.isEditing()) return;

  const selection = readSelection();
  // Nothing settled - a tap collapsed the selection, and the tap's own
  // compatibility mouse events already said what that meant. Hiding from here
  // would close the recall bubble a tap on an underline has just opened.
  if (selection === null) return;

  // The phrase the bubble is already about, holding still again: the system's
  // toolbar poking the selection, a change event with nothing behind it.
  // Answering again would run the engine to repaint what is already shown.
  if (tooltip.isOpen() && current !== null && current.text === selection.text) return;

  present(selection, { deliberate: false, touch: true });
}

/**
 * Whether a key press belongs to something being typed or natively copied -
 * the presses the clipboard bridge must never take (D110). The bubble's own
 * edit box hides behind its closed shadow root, so it is asked by name; a
 * standing native selection anywhere on the page (the reader's chrome allows
 * one - only the article refuses) keeps the chord too, because the platform's
 * copy of a visible selection is what the hand asked for.
 *
 * @param {EventTarget | null} target
 * @returns {boolean}
 */
function chordTaken(target) {
  if (tooltip.isEditing()) return true;
  if (target instanceof HTMLElement) {
    const tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return true;
  }
  const selection = window.getSelection();
  return selection !== null && !selection.isCollapsed;
}

/**
 * @param {KeyboardEvent} event
 */
function onKeyDown(event) {
  if (!tooltip.isOpen()) return;
  // The clipboard bridge (D110): on the reader page, the platform's copy
  // chord copies the phrase the bubble is about - the original, exactly what
  // a native selection would have given. Fire and forget like the copy row's
  // own presses: a clipboard that refuses has nothing to show it by.
  if (
    bridgeCopy &&
    current !== null &&
    copyCombo({ key: event.key, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey, shift: event.shiftKey }) &&
    !chordTaken(event.target)
  ) {
    void navigator.clipboard.writeText(current.text).catch(() => undefined);
    return;
  }
  if (event.key !== "Escape") return;
  tooltip.escape();
  // An Escape that closed the bubble - rather than the edit box inside it -
  // ends the selection chain with it: a highlight left with no bubble would
  // ask the question the bubble just stopped answering.
  if (!tooltip.isOpen()) {
    clearSelection();
    autoKept = null;
  }
}

/**
 * A scroll with a bubble open keeps the bubble, on every page (D82): in the
 * reader by construction, everywhere else by hand.
 *
 * @param {Event} event
 */
function onScroll(event) {
  // An anchored bubble (the reader's, D81) is pinned to the page and rides
  // the scroll with its phrase - scrolling there is how the reader gets back
  // to the sentence, not a way of saying "close".
  if (anchored) return;
  // Not for a scroll of the bubble's own second layer, which is a reader
  // working their way through a long dictionary entry - a scroll event does
  // not cross a shadow boundary, so this should never fire for one, but the
  // day it does it must not move or close the thing being read.
  if (!tooltip.isOpen() || tooltip.owns(event.target)) return;

  // A viewport-pinned bubble follows its phrase by asking the range where
  // the phrase is now (D82) - which answers for every kind of scrolling at
  // once, the page's own and any scrolling box inside it, and is why this
  // does not pin to the document the way the reader does: on somebody
  // else's page there is no promise the document is even the thing that
  // scrolls. Riding scroll events means riding a step behind the
  // compositor's own scrolling; the bubble may trail the phrase for a
  // moment and lands exactly on it the moment the page rests.
  const rect = anchorRange === null ? null : anchorRange.getBoundingClientRect();
  if (rect !== null && rect.width > 0 && rect.height > 0) {
    tooltip.follow(rect);
    return;
  }

  // Nothing left to stand by - the phrase's nodes are gone, or a bubble
  // opened with no range to follow. Leaving is the old answer, except while
  // the edit box is open: a wheel nudge is not a reason to throw away a
  // translation somebody is in the middle of correcting.
  if (!tooltip.isEditing()) tooltip.hide();
}

/**
 * Both keys matter: the vocabulary changing in another tab, and the language
 * pair changing in the settings - which makes the mirror describe a pair that
 * is not being read here.
 *
 * @param {Record<string, { oldValue?: unknown, newValue?: unknown }>} changes
 * @param {string} area
 */
function onStorageChanged(changes, area) {
  if (area !== "local") return;
  if (changes[MIRROR_KEY] === undefined && changes[CONFIG_KEY] === undefined) return;
  void loadVocabulary();
}

/**
 * @param {{ root?: Element | null, observe?: boolean, stored?: Record<string, unknown>, ownSelection?: boolean, anchored?: boolean, covered?: () => number, openSettings?: () => void, plainLinks?: () => boolean, alsoOwns?: (target: EventTarget | null) => boolean, marking?: () => boolean, markRoot?: () => Element | null, onMarked?: (range: Range) => void, onMarkStart?: () => void, onMarkTap?: (x: number, y: number, word?: Range) => void, quietLookup?: (text: string) => Promise<import("../lib/protocol.js").DictEntry[]>, quietVoice?: () => { lang: string, voiceURI: string | undefined } | null }} [where]
 *   what to underline inside, whether it can change on its own, the startup
 *   read of `storage.local` when the caller already made one, whether the
 *   page selects through our own gesture rather than the browser's - every
 *   pointer's gesture, finger and mouse alike (D80, D86) - whether
 *   bubbles pin to the page instead of the viewport (D81), and whether the
 *   article's links are dressed as plain text right now (D95), which hands
 *   presses on them to the gesture. Everything after `stored` is a reader
 *   page flag, never a content script's: refusing the native selection on
 *   somebody else's page would be changing how their page works, pinning to
 *   the document trusts a page layout only our own page can promise, and
 *   undressing links changes how a page works too. `covered` says how far
 *   down the reader page's own stuck bar reaches (D138), so no placement
 *   and no assist scroll parks anything beneath it - a reader flag as well,
 *   because only our page knows what it stuck over its text. `openSettings`
 *   is the reader page's own walk to the settings (D139), taken by the
 *   bubble's settings button instead of asking the background for a tab -
 *   a reader flag too, because navigating away is only ever ours to do on
 *   our own page. The last four belong to
 *   the reader's highlighter (D106) and ride through to `select.js` -
 *   `alsoOwns` besides names the reader's own floating UI (the mark-delete
 *   bubble), whose presses must not read as the page's. `quietLookup` and
 *   `quietVoice` are the reader's hands into the no-translation trim (D121):
 *   the dictionaries and the voice of the document on screen - reader flags
 *   too, because only an extension page has the database in reach and only
 *   the reader knows what language it is showing.
 */
export function start(where = {}) {
  root = where.root ?? null;
  follow = where.observe ?? true;
  anchored = where.anchored ?? false;
  coveredAbove = where.covered ?? (() => 0);
  openSettings = where.openSettings ?? null;
  alsoOwns = where.alsoOwns ?? (() => false);
  quietLookup = where.quietLookup ?? null;
  quietVoice = where.quietVoice ?? null;
  // The page that took the native selection away answers the copy chord
  // itself (D110) - and only that page.
  bridgeCopy = where.ownSelection === true;

  // Called again when the reader renders another article, and the listeners
  // must not stack up behind it.
  if (!started) {
    started = true;
    // Capture phase: pages that stop propagation on their own selection handling
    // are exactly the pages where this has to keep working. The press is
    // listened for only to know what the release means (see `madeSelection`).
    document.addEventListener("mousedown", onMouseDown, { capture: true, passive: true });
    document.addEventListener("mouseup", onMouseUp, { capture: true, passive: true });
    document.addEventListener("keydown", onKeyDown, { capture: true, passive: true });
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    // Only where a finger can select (D73): on a mouse-only device the pair
    // above already hears every selection there is, and `selectionchange`
    // fires on every caret move of every text box - a listener that would
    // never answer has no business costing that.
    if (navigator.maxTouchPoints > 0) {
      document.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
      document.addEventListener("selectionchange", onSelectionChange);
    }
    // The reader's own gesture, every pointer's since D86 - which is why it
    // starts outside the touch gate. The settle path above stays installed
    // and naturally silent beside it: the article refuses the native
    // selection, so there is nothing for `selectionchange` to say about it,
    // and no selection ever has two listeners.
    if (where.ownSelection === true) {
      startSelect({
        root: root ?? document.body,
        owns: (target) => owns(target),
        onSelected: presentGesture,
        onSelectStart: () => tooltip.hide(),
        ...(where.plainLinks === undefined ? {} : { plainLinks: where.plainLinks }),
        ...(where.marking === undefined ? {} : { marking: where.marking }),
        ...(where.markRoot === undefined ? {} : { markRoot: where.markRoot }),
        ...(where.onMarked === undefined ? {} : { onMarked: where.onMarked }),
        ...(where.onMarkStart === undefined ? {} : { onMarkStart: where.onMarkStart }),
        ...(where.onMarkTap === undefined ? {} : { onMarkTap: where.onMarkTap }),
      });
    }
    webext().storage.onChanged.addListener(onStorageChanged);
  }

  void loadVocabulary(where.stored);
}

/**
 * Everything `start` put on the page, taken back: the listeners, the bubble,
 * the underlines with their registry entry and observer (`clear`), and the
 * held vocabulary. This is what switching re/read off for a site means, and it
 * has to leave the page as if the extension had never run - the message
 * listener in `content/index.js` is the one thing that stays, because it is
 * how the switch can be turned back on without a reload.
 */
export function stop() {
  if (!started) return;
  started = false;

  document.removeEventListener("mousedown", onMouseDown, { capture: true });
  document.removeEventListener("mouseup", onMouseUp, { capture: true });
  document.removeEventListener("keydown", onKeyDown, { capture: true });
  document.removeEventListener("scroll", onScroll, { capture: true });
  // Removing what was never added is a no-op, so no second capability check.
  document.removeEventListener("pointerdown", onPointerDown, { capture: true });
  document.removeEventListener("selectionchange", onSelectionChange);
  stopSelect();
  webext().storage.onChanged.removeListener(onStorageChanged);

  if (settleTimer !== null) {
    window.clearTimeout(settleTimer);
    settleTimer = null;
  }
  tooltip.hide();
  current = null;
  secondLayer = [];
  unfetched = null;
  autoKept = null;
  anchorRange = null;
  press = null;
  lastPointerType = "";
  anchored = false;
  coveredAbove = () => 0;
  openSettings = null;
  alsoOwns = () => false;
  quietLookup = null;
  quietVoice = null;
  bridgeCopy = false;
  vocabulary = new Map();
  clear();
}

/**
 * The bubble and the selection stood down by the caller rather than by a
 * gesture - what picking up the highlighter does (D106): the pen changes what
 * every gesture means, and a bubble left standing would be an answer from the
 * grammar that just ended. Exactly the dismissal an empty tap performs, minus
 * the tap.
 */
export function dismiss() {
  clearSelection();
  autoKept = null;
  tooltip.hide();
  current = null;
  secondLayer = [];
  unfetched = null;
}

/**
 * The text under the same root is different now - the reader has rendered
 * another article. The vocabulary has not changed, so nothing is asked of
 * storage; the ranges are simply found again. The reader's own selection was
 * ranges into the old text and goes with it - its chain too, because the
 * phrase the chain kept belongs to a page that is done being read.
 */
export function rescan() {
  clearSelection();
  autoKept = null;
  repaint();
}
