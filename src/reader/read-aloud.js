/**
 * Reading the article aloud, on the reader page (D87).
 *
 * The rules about where an utterance begins and ends are next door, without a
 * DOM (`lib/reader/speech.js`); this is the half that has one. It does four
 * things and nothing else:
 *
 *   - joins the article's text nodes into the one string those rules work on,
 *     and keeps the arithmetic to get back out of it (`joinPieces`, `locate` -
 *     the matcher's own, so a character always means the same node here as it
 *     does under an underline);
 *   - speaks the chunks one after another, keeping the place;
 *   - paints the sentence being spoken and the word inside it, through the
 *     highlight registry - no node of the article is touched, exactly as with
 *     underlines and the reader's own selection;
 *   - keeps what is being spoken on the screen.
 *
 * **Only in the reader.** Reading a page aloud means walking all of its text
 * and painting over it, and on somebody else's page that is not ours to do -
 * the reader's article is our own markup, built here from the allowed list.
 *
 * **Pause is a cancel, not `speechSynthesis.pause()`.** Pausing is the one part
 * of this API platforms disagree about: Android's engine has no pause of its
 * own, and browsers on top of it have variously answered `pause()` by ignoring
 * it, by reporting a pause that never happened, and by dying at the next
 * `speak()`. Cancelling and starting again from the word last heard behaves the
 * same everywhere, and the place is kept in this module rather than in the
 * engine. What it costs is repeating one word, which nobody notices, and on a
 * device that sends no `boundary` events at all it repeats one sentence.
 *
 * **The queue is shared with the bubble** (D83, `lib/tts.js`): `cancel()`
 * flushes everything, so a phrase spoken from a bubble stops the article. That
 * reads as a pause here - the place is kept, the bar says Play - and starting
 * the article stops the bubble's voice the same way. One page, one voice.
 */

import { supported } from "../content/highlighter.js";
import { prosePieces } from "../content/scan.js";
import { joinPieces, locate } from "../lib/matcher/spans.js";
import { chunkText, wordSpan } from "../lib/reader/speech.js";
import { canSpeak, chosenVoice, shareVoice, stop as stopPhrase } from "../lib/tts.js";

/** Must be the names in `reader.css`. */
const SENTENCE = "reread-speaking";
const WORD = "reread-speaking-word";

/**
 * Where in the window the spoken line is kept, as fractions of its height. A
 * line already inside the band is left exactly where it is - scrolling on
 * every word would make an e-ink panel flash its way through the article - and
 * one outside it lands at `land`, with the paragraph it belongs to still above
 * it and room below for the sentences coming. The floor is well clear of the
 * bar at the bottom of the screen, which is at most a couple of rows tall.
 */
const BAND = Object.freeze({ top: 0.12, bottom: 0.75, land: 0.3 });

/**
 * What the reader page hands in once, at startup.
 *
 * @typedef {object} ReadingHooks
 * @property {() => Element | null} article what to read - asked each time,
 *   because the element is the same one from article to article and only its
 *   contents change
 * @property {(state: ReadingState) => void} onChange the bar's whole job
 * @property {() => void} onFail the engine refused, and the reader has to be
 *   told in words - a silent bar disappearing says nothing
 *
 * @typedef {"off" | "playing" | "paused"} ReadingState
 *
 * @typedef {object} ReadingVoice
 * @property {string} lang BCP-47, the language the article is in
 * @property {string | undefined} voiceURI the voice chosen for that language
 * @property {number} rate the engine's factor (1 = the voice's normal speed)
 *
 * @typedef {{
 *   parts: import("../content/scan.js").BlockPart[],
 *   spans: import("../lib/matcher/spans.js").Span[],
 *   text: string,
 *   chunks: import("../lib/reader/speech.js").Chunk[],
 * }} Plan
 */

/** @type {ReadingHooks | null} */
let hooks = null;

/**
 * The article as one string, with the way back to its nodes. Built on the
 * first press and thrown away when another article is rendered: it is a map of
 * text nodes, and the nodes of the article that has gone are gone with it.
 *
 * @type {Plan | null}
 */
let plan = null;

/** Which chunk is being spoken. */
let at = 0;
/** Where inside that chunk the utterance in flight began. */
let within = 0;
/** Where inside it the voice has got to - the resume point (see the header). */
let spoken = 0;

/**
 * The utterance this module is playing. Ours and only ours: every handler
 * checks it before answering, so the events a cancelled utterance still fires
 * cannot move a reading that has already gone somewhere else.
 *
 * @type {SpeechSynthesisUtterance | null}
 */
let mine = null;

/**
 * The next sentence, waiting out the engine's own event before it is spoken
 * (see `advance`). Null whenever nothing is waiting - and cleared by `hush`,
 * so a pause landing in that sliver of a moment really pauses.
 *
 * @type {number | null}
 */
let pending = null;

/** @type {ReadingState} */
let state = "off";

/** @type {ReadingVoice} */
let voice = { lang: "en", voiceURI: undefined, rate: 1 };

/** The two marks, kept rather than rebuilt: one repaint per word is enough. */
/** @type {Highlight | null} */
let sentenceMark = null;
/** @type {Highlight | null} */
let wordMark = null;

/**
 * @param {ReadingHooks} options
 */
export function configureReading(options) {
  hooks = options;
  // The bubble's speaker shares this page's queue and only appends to it, so
  // it asks the article to stand aside before it speaks (`shareVoice`). What
  // standing aside means here is a pause: the place is kept, the bar says
  // Resume, and a word looked up in the middle of a chapter costs one press to
  // get back from.
  shareVoice(pauseReading);
}

/**
 * The language, the voice and the speed, from the settings. Applied to the
 * utterance in flight by starting the current sentence again: a rate cannot be
 * changed once an utterance is speaking, and a change nobody hears until the
 * next paragraph reads as a control that does not work.
 *
 * @param {ReadingVoice} next
 */
export function readingVoice(next) {
  const moved =
    next.lang !== voice.lang || next.voiceURI !== voice.voiceURI || next.rate !== voice.rate;
  voice = next;
  if (moved && state === "playing") {
    within = spoken;
    hush();
    speakChunk();
  }
}

/** @returns {ReadingState} */
export function readingState() {
  return state;
}

/**
 * The article on screen is a different one now, or there is none. Everything
 * about the old one goes, silently: this is not somebody pressing stop.
 */
export function forgetReading() {
  stopReading();
  plan = null;
}

/**
 * Press: start, pause, or carry on. One button, because at any moment there is
 * exactly one thing pressing it can sensibly mean.
 */
export function toggleReading() {
  if (state === "playing") pauseReading();
  else if (state === "paused") speakChunk();
  else startReading();
}

/**
 * Reading starts at the first sentence still on the screen, not at the top of
 * the article: pressed at the beginning those are the same thing, and pressed
 * half way down the article they are not - somebody who read this far means
 * "go on from here", and making them scroll back up to be read to would be the
 * feature arguing with the reading.
 */
export function startReading() {
  if (!canSpeak() || !buildPlan()) return;
  // One page, one voice: whatever the bubble is saying about a phrase, the
  // article is the bigger statement and takes the queue (D83) - and a reading
  // already under way is replaced rather than queued behind, so that starting
  // twice can never come out as two voices.
  stopPhrase();
  hush();
  at = firstVisibleChunk();
  within = 0;
  speakChunk();
}

/** The place is kept, the voice stops. See the header for why this cancels. */
export function pauseReading() {
  if (state !== "playing") return;
  within = spoken;
  hush();
  state = "paused";
  announce();
}

/** Reading is over: no place kept, no marks left, the bar goes. */
export function stopReading() {
  if (state === "off") return;
  hush();
  clearMarks();
  at = 0;
  within = 0;
  spoken = 0;
  state = "off";
  announce();
}

/**
 * A sentence back or a sentence on - the one move a reader learning a language
 * makes constantly, because a sentence heard once is regularly a sentence
 * worth hearing twice. Back from the middle of a sentence means this sentence
 * from its beginning, the way it does on every music player: the first press
 * repeats, the second one steps back.
 *
 * Paused, it moves the place and the marks and stays paused. Pressing skip is
 * not pressing play.
 *
 * @param {number} step -1 or 1
 */
export function skipSentence(step) {
  if (plan === null || state === "off") return;

  const restart = step < 0 && spoken > 0;
  const next = restart ? at : at + step;
  if (next < 0 || next >= plan.chunks.length) {
    // Past the last sentence is the end of the article, which is what the
    // voice reaching it would say too. Before the first one, nothing moves.
    if (next >= plan.chunks.length) stopReading();
    return;
  }

  at = next;
  within = 0;
  spoken = 0;
  if (state === "playing") {
    hush();
    speakChunk();
    return;
  }
  markSentence();
}

/**
 * The article as one string, and the chunks a voice speaks it in. Kept until
 * another article is rendered (`forgetReading`), because the walk and the
 * cutting are the same answer for as long as the text is the same.
 *
 * @returns {boolean} whether there is anything to read
 */
function buildPlan() {
  if (plan !== null) return plan.chunks.length > 0;

  const article = hooks?.article() ?? null;
  if (article === null) return false;

  const parts = prosePieces(article);
  const { text, spans } = joinPieces(parts.map((part) => part.text));
  plan = { parts, spans, text, chunks: chunkText(text) };
  return plan.chunks.length > 0;
}

/**
 * Which chunk to start on: the first one that has not been scrolled off the
 * top of the window. Measured one after another from the beginning and stopped
 * at the first hit, so a reader at the top of the article pays for one
 * measurement and one at the bottom pays for the article - which is a button
 * press, once.
 *
 * @returns {number}
 */
function firstVisibleChunk() {
  if (plan === null) return 0;
  for (let index = 0; index < plan.chunks.length; index += 1) {
    const rect = rectOf(index);
    // A sliver rather than zero: a sentence whose last pixel row is still
    // above the fold is one the reader has read.
    if (rect !== null && rect.bottom > 4) return index;
  }
  return 0;
}

/**
 * @param {number} index
 * @returns {DOMRect | null}
 */
function rectOf(index) {
  const chunk = plan?.chunks[index];
  if (chunk === undefined) return null;
  const range = rangeOf(chunk.start, chunk.end);
  return range === null ? null : range.getBoundingClientRect();
}

/**
 * The DOM range of a run of the article's text, built the way the underline
 * painter and the reader's own selection build theirs: both ends mapped back
 * through the piece spans, the end taken as the last character rather than the
 * position after it, so an end on a piece boundary stays in the piece the word
 * is in.
 *
 * @param {number} from offset into the article's text
 * @param {number} to offset, exclusive
 * @returns {Range | null}
 */
function rangeOf(from, to) {
  if (plan === null || to <= from) return null;

  const start = locate(plan.spans, from);
  const end = locate(plan.spans, to - 1);
  const startNode = start === null ? null : (plan.parts[start.piece]?.node ?? null);
  const endNode = end === null ? null : (plan.parts[end.piece]?.node ?? null);
  if (start === null || end === null || startNode === null || endNode === null) return null;

  const range = document.createRange();
  range.setStart(startNode, start.offset);
  range.setEnd(endNode, end.offset + 1);
  return range;
}

/**
 * Speaks from wherever the place says, and says so. Everything that starts or
 * resumes sound goes through here, so there is one description of what an
 * utterance of ours looks like.
 */
function speakChunk() {
  const chunk = plan?.chunks[at];
  if (plan === null || chunk === undefined) {
    stopReading();
    return;
  }

  const text = plan.text.slice(chunk.start + within, chunk.end);
  if (text.trim().length === 0) {
    // Nothing left of this sentence - a resume point that landed on its last
    // character. The next one is the honest answer, not silence.
    advance();
    return;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = voice.lang;
  utterance.rate = voice.rate;
  const chosen = chosenVoice(speechSynthesis.getVoices(), voice.voiceURI);
  if (chosen !== null) utterance.voice = chosen;

  utterance.addEventListener("boundary", (event) => onBoundary(utterance, event));
  utterance.addEventListener("end", () => onEnd(utterance));
  utterance.addEventListener("error", (event) => onError(utterance, event));

  mine = utterance;
  spoken = within;
  state = "playing";
  markSentence();
  announce();
  speechSynthesis.speak(utterance);
}

/**
 * The engine saying where it has got to. Two things ride on it: the word to
 * paint, and the place to resume from. A device that never sends these is a
 * device where the sentence stays painted and a pause rewinds to its start -
 * which is the whole degradation, and it is why nothing else depends on them.
 *
 * @param {SpeechSynthesisUtterance} utterance
 * @param {SpeechSynthesisEvent} event
 */
function onBoundary(utterance, event) {
  const chunk = plan?.chunks[at];
  if (mine !== utterance || plan === null || chunk === undefined) return;
  // Some engines announce sentences as well as words. The sentence is already
  // painted, and taking its first word for the word being spoken would leave
  // the mark sitting there while the voice moved on.
  if (event.name === "sentence") return;

  const base = chunk.start + within;
  const length = typeof event.charLength === "number" ? event.charLength : 0;
  const word = wordSpan(plan.text, base + event.charIndex, length);
  if (word === null || word.start >= chunk.end) return;

  spoken = word.start - chunk.start;
  const range = rangeOf(word.start, Math.min(word.end, chunk.end));
  if (range === null) return;
  wordMark = mark(WORD, wordMark, range, 3);
  keepVisible(range);
}

/**
 * @param {SpeechSynthesisUtterance} utterance
 */
function onEnd(utterance) {
  if (mine !== utterance) return;
  advance();
}

/**
 * The next sentence, or the end of the article.
 *
 * Two precautions about *how* the next sentence is started, both from one
 * report (a Boox Page, reading a long article): the sentences themselves came
 * out fluently, but the gap between them grew with every sentence read, from
 * nothing to tens of seconds after a dozen or so. Nothing on this side grows -
 * the work per sentence is one range, one repaint and one string slice - which
 * leaves the engine's own queue, and there the shape of it fits: an entry that
 * is never dropped makes every following `speak()` wait behind everything
 * already said.
 *
 * So the queue is emptied before each sentence (`hush`, which is a `cancel()`
 * of a queue that should already be empty and costs nothing when it is), and
 * the next `speak()` is made from a task of its own rather than from inside
 * the engine's own `end` callback - a platform that takes its time about a
 * call made there is a thing that has been seen before, and a zero-delay timer
 * is the whole of the workaround.
 */
function advance() {
  hush();
  at += 1;
  within = 0;
  spoken = 0;
  if (plan === null || at >= plan.chunks.length) {
    stopReading();
    return;
  }
  pending = window.setTimeout(() => {
    pending = null;
    speakChunk();
  }, 0);
}

/**
 * @param {SpeechSynthesisUtterance} utterance
 * @param {SpeechSynthesisErrorEvent} event
 */
function onError(utterance, event) {
  if (mine !== utterance) return;
  mine = null;

  // Cancelled from outside: the bubble speaking a phrase flushes the shared
  // queue (D83). That is not a failure and must not read as one - the place
  // stands, the bar says Play, and pressing it carries on from the word the
  // voice had reached.
  if (event.error === "canceled" || event.error === "interrupted") {
    within = spoken;
    state = "paused";
    announce();
    return;
  }

  // Anything else is the engine refusing: a voice that has been uninstalled
  // since it was chosen, a language the device cannot speak, an engine that
  // died. Silence with the bar quietly disappearing would look like the button
  // doing nothing, so the page says it in words.
  clearMarks();
  state = "off";
  announce();
  hooks?.onFail();
}

/**
 * Our voice stops, and the events its cancelling fires answer to nobody. The
 * sentence waiting on its timer (`advance`) goes with it, so a pause, a stop
 * or a skip landing in that sliver of a moment is not overtaken by the
 * sentence it interrupted.
 */
function hush() {
  mine = null;
  if (pending !== null) {
    window.clearTimeout(pending);
    pending = null;
  }
  if (canSpeak()) speechSynthesis.cancel();
}

function announce() {
  hooks?.onChange(state);
}

/** The sentence being spoken, painted, and brought onto the screen. */
function markSentence() {
  const chunk = plan?.chunks[at];
  if (chunk === undefined) return;
  const range = rangeOf(chunk.start, chunk.end);
  if (range === null) return;
  sentenceMark = mark(SENTENCE, sentenceMark, range, 2);
  // The word's mark belongs to the sentence that has gone; leaving it would
  // show two places at once until the first boundary of the new one. Emptied
  // rather than thrown away and registered again: two entries in the registry
  // for the whole reading is less for the engine to keep track of than two
  // new ones per sentence, and this is a device that reads for an hour.
  wordMark?.clear();
  keepVisible(range);
}

/**
 * @param {string} name
 * @param {Highlight | null} held
 * @param {Range} range
 * @param {number} priority above the underlines and above the reader's own
 *   selection, which are older statements about the same words
 * @returns {Highlight | null}
 */
function mark(name, held, range, priority) {
  if (!supported()) return null;
  const highlight = held ?? new Highlight();
  highlight.priority = priority;
  highlight.clear();
  highlight.add(range);
  CSS.highlights.set(name, highlight);
  return highlight;
}

function clearMarks() {
  sentenceMark = null;
  wordMark = null;
  if (!supported()) return;
  CSS.highlights.delete(SENTENCE);
  CSS.highlights.delete(WORD);
}

/**
 * The line being spoken, kept on the screen - and only when it is not. A page
 * that scrolled on every word would never stand still, and standing still is
 * what an e-ink panel needs to be readable at all.
 *
 * @param {Range} range
 */
function keepVisible(range) {
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;

  const height = window.innerHeight;
  if (rect.top >= height * BAND.top && rect.bottom <= height * BAND.bottom) return;

  // Instant, like every other movement in the reader: on e-ink a smooth scroll
  // is a series of full-screen flashes.
  window.scrollTo({ top: window.scrollY + rect.top - height * BAND.land, behavior: "instant" });
}
