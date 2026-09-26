/**
 * Reading a phrase aloud with the browser's own speech synthesis (D83).
 *
 * The engine is `speechSynthesis` - a Web API, so no permission, nothing added
 * to the package, and the same code serves a content script and the reader
 * page alike. It runs where the button is pressed on purpose: Chromium's
 * background is a worker without speech, Firefox's can be put to sleep in the
 * middle of a word, and a page somebody is reading is exactly as alive as the
 * sentence being spoken.
 *
 * The voices belong to the device and change without warning - between
 * machines, between browsers, sometimes between restarts. Everything here is
 * therefore forgiving: a stored voice that is gone falls back to the device's
 * own default for the language, and an empty voice list is no reason not to
 * speak - the utterance carries its language, and the engine does the rest.
 * That last part is Android's clause: there `getVoices()` has been known to
 * answer nothing while `speak()` works all the same.
 *
 * **Offline voices only** (D155). The settings page promises that nothing
 * read aloud is sent anywhere, and a browser can break that promise on its
 * own: Chrome lists Google's network voices next to the system's, Edge lists
 * Microsoft's "Online" ones, and each sends the text to its maker's server to
 * be spoken. The engine marks them (`localService: false`), so this module
 * never offers one in a picker and never lets one speak - and when the device
 * has voices but none of them reads a language offline, it does not speak at
 * all rather than let the engine pick a network one (`offlineAvailable`).
 *
 * The rules (which voices can read a language, which one speaks) are pure
 * functions, tested without a browser; the speaking half stays quiet anywhere
 * `speechSynthesis` does not exist.
 */

/**
 * What the pure half needs to know about a voice - structural, so the tests
 * can hand in plain objects and the browser's `SpeechSynthesisVoice` passes
 * as it is. The two flags are the engine's own words: `localService` false
 * names a voice spoken on somebody's server, `default` the one the engine
 * would pick by itself.
 *
 * @typedef {{ name: string, lang: string, voiceURI: string, localService?: boolean, default?: boolean }} VoiceLike
 */

/**
 * @returns {boolean} whether this context has the API at all - false in the
 *   tests, and on the day a browser ships without it nothing here is ever
 *   asked to speak
 */
export function speechSupported() {
  return typeof globalThis.speechSynthesis !== "undefined";
}

/**
 * The reading-aloud switch (D148), mirrored from the settings by every page
 * that speaks: the content script, the reader, the saved phrases and the
 * settings page each hand the stored value down as they read their config.
 * Here rather than in each of them, because the one question every speaker
 * already asks is `canSpeak`, and a switch folded into that question reaches
 * every button, every row and every key at once - and `speak` itself, so
 * nothing left over on a screen drawn before the flip can talk.
 */
let switchedOff = false;

/**
 * @param {boolean} off whether reading aloud is switched off in the settings
 */
export function setSpeechOff(off) {
  switchedOff = off;
  // A voice mid-phrase when the switch lands is a voice that was just asked
  // to be quiet.
  if (off) stop();
}

/**
 * @returns {boolean} whether this context may speak: the API exists and the
 *   reader has not switched reading aloud off. What every speaker, button
 *   and row asks before it offers a voice; `speechSupported` is the bare
 *   API question, for the listeners that only ever watch the engine.
 */
export function canSpeak() {
  return speechSupported() && !switchedOff;
}

/**
 * The primary language subtag, lowercased - the part before any region:
 * "en-US", "en_US" and "en" all answer "en". The underscore is Android's:
 * its engines name voices `en_US` where the web writes `en-US`, and a filter
 * that missed them would offer no voices exactly where choosing one matters
 * most.
 *
 * @param {string} tag
 * @returns {string}
 */
export function primaryLanguage(tag) {
  return tag.toLowerCase().split(/[-_]/, 1)[0] ?? "";
}

/**
 * Whether a voice speaks on this device. The flag missing - the tests' plain
 * objects - counts as offline: every browser sets it, and the doubt would
 * otherwise mute a voice for nothing.
 *
 * @param {VoiceLike} voice
 * @returns {boolean}
 */
function offline(voice) {
  return voice.localService !== false;
}

/**
 * One entry per voice, where the engine listed a voice twice.
 *
 * `voiceURI` names one voice, so two entries sharing it are one voice seen
 * twice - and one of them can be a decoy. Brave's fingerprinting shield
 * (brave-core, `chromium_src/.../speech/speech_synthesis.cc`) adds a fake
 * voice to every site's list: a clone of the engine's default voice under a
 * made-up name drawn per site ("Hubert", "Vernon", "Alva"...), with the URI
 * left as it was. A pick by URI could land on the clone, and did: Chromium's
 * browser side matches an utterance's voice by NAME, nothing is named
 * Hubert, and macOS then reads with the voice of the SYSTEM language - an
 * English word came out in Polish, on exactly the sites whose made-up name
 * sorted before the real one (Michał's report, 2026-09-01). Kept per URI:
 * the entry whose name is its own URI (how Chromium lists the platform's
 * voices), else the engine's default, else the one listed first.
 *
 * @template {VoiceLike} V
 * @param {readonly V[]} voices
 * @returns {V[]}
 */
function oneOfEach(voices) {
  /** @param {V} voice */
  const genuine = (voice) => (voice.name === voice.voiceURI ? 2 : voice.default === true ? 1 : 0);
  /** @type {Map<string, V>} */
  const kept = new Map();
  for (const voice of voices) {
    const before = kept.get(voice.voiceURI);
    if (before === undefined || genuine(voice) > genuine(before)) kept.set(voice.voiceURI, voice);
  }
  return [...kept.values()];
}

/**
 * Variants together, and the same order from one open to the next.
 *
 * @param {VoiceLike} a
 * @param {VoiceLike} b
 * @returns {number}
 */
function byTagAndName(a, b) {
  return a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name);
}

/**
 * The offline voices able to read a language, for the pickers: same primary
 * subtag, regional variants included - a reader of `en` chooses among en-US,
 * en-GB and whatever else the device offers. Sorted by tag and then by name,
 * so variants stand together and the order holds from one open to the next;
 * the list handed in is left as it was.
 *
 * @template {VoiceLike} V
 * @param {readonly V[]} voices
 * @param {string} lang
 * @returns {V[]}
 */
export function voicesFor(voices, lang) {
  const wanted = primaryLanguage(lang);
  if (wanted === "") return [];
  return oneOfEach(voices.filter((voice) => offline(voice) && primaryLanguage(voice.lang) === wanted)).sort(
    byTagAndName,
  );
}

/**
 * The offline voices an utterance in `lang` may be given: the language's own
 * where one is named, and with no language named (no pair chosen, a document
 * without a tag) every offline voice the device has - the engine's own default
 * answered a nameless phrase before, and the default among these is as close
 * as an offline-only pick comes to it.
 *
 * @template {VoiceLike} V
 * @param {readonly V[]} voices
 * @param {string} lang
 * @returns {V[]}
 */
function offlinePool(voices, lang) {
  if (primaryLanguage(lang) !== "") return voicesFor(voices, lang);
  return oneOfEach(voices.filter(offline)).sort(byTagAndName);
}

/**
 * Whether this device reads a language without the network: it lists an
 * offline voice for it - or it lists nothing at all, which is Android's clause
 * from the header, where the engine speaks from the system's own voices while
 * saying nothing about them.
 *
 * @param {readonly VoiceLike[]} voices what the engine lists right now
 * @param {string} lang
 * @returns {boolean}
 */
export function offlineAvailable(voices, lang) {
  return voices.length === 0 || offlinePool(voices, lang).length > 0;
}

/**
 * The stored choice, if this device still has it among the voices given.
 * Everything else - no choice made, a voice uninstalled since, a profile
 * carried to another machine - answers null.
 *
 * @template {VoiceLike} V
 * @param {readonly V[]} voices
 * @param {string | undefined} voiceURI
 * @returns {V | null}
 */
export function chosenVoice(voices, voiceURI) {
  if (voiceURI === undefined || voiceURI === "") return null;
  return voices.find((voice) => voice.voiceURI === voiceURI) ?? null;
}

/**
 * The voice an utterance in `lang` is given: the stored choice if the device
 * still has it among its offline voices, else the device's own default among
 * them, else the first of them. A stale choice - or one made before network
 * voices were kept out - moves to an offline voice rather than muting the
 * button. Null means there is none to give: either `offlineAvailable` said no
 * and the caller must not speak, or the device lists nothing and the engine
 * picks by itself (Android's clause).
 *
 * @template {VoiceLike} V
 * @param {readonly V[]} voices what the engine lists right now
 * @param {string} lang
 * @param {string | undefined} voiceURI the choice stored for that language, if any
 * @returns {V | null}
 */
export function offlineVoice(voices, lang, voiceURI) {
  const offered = offlinePool(voices, lang);
  return (
    chosenVoice(offered, voiceURI) ??
    offered.find((voice) => voice.default === true) ??
    offered[0] ??
    null
  );
}

/**
 * @param {string} lang
 * @returns {boolean} whether this context may speak this language: `canSpeak`,
 *   and an offline voice for it on the device (or a device that lists none).
 *   What a speaker asks before it offers its button for one language.
 */
export function canSpeakLang(lang) {
  return canSpeak() && offlineAvailable(speechSynthesis.getVoices(), lang);
}

/**
 * The languages this device reads offline: the primary subtags of its offline
 * voices, each once, in the order the engine lists them - the settings page
 * sorts them by their names in the reader's own language.
 *
 * @param {readonly VoiceLike[]} voices
 * @returns {string[]}
 */
export function offlineLanguages(voices) {
  /** @type {Set<string>} */
  const languages = new Set();
  for (const voice of voices) {
    if (!offline(voice)) continue;
    const language = primaryLanguage(voice.lang);
    if (language !== "") languages.add(language);
  }
  return [...languages];
}

/**
 * Which language the settings page's voice row is about (D155, Michał's
 * rule): the one picked on the page while it is on offer, else the pair's
 * source language (translation on means reading in it), else the browser's
 * own language, else English - the language most devices have a voice for -
 * else the first on offer. Null only with nothing on offer at all.
 *
 * @param {readonly string[]} offered primary subtags, the row's choices
 * @param {{ picked: string | null, source: string | null, browser: string }} of
 * @returns {string | null}
 */
export function voiceLanguage(offered, of) {
  for (const candidate of [of.picked, of.source, of.browser, "en"]) {
    if (candidate !== null && offered.includes(candidate)) return candidate;
  }
  return offered[0] ?? null;
}

/**
 * The utterance this module is playing, if any. Ours and only ours, because
 * the queue behind `speechSynthesis` is shared with the page being read and
 * `cancel()` flushes all of it: `stop` may only ever fire while this is set,
 * so a page speaking on its own never loses its words to our button.
 *
 * @type {SpeechSynthesisUtterance | null}
 */
let mine = null;

/**
 * @returns {boolean} whether our utterance is still on its way out loud
 */
export function speaking() {
  return mine !== null;
}

/**
 * Where the voice is (D287): `idle` with nothing of ours on its way,
 * `pending` from a press until the engine's own `start`, `speaking` from
 * there to `end`. The wait before `start` is real: the voice list may take a
 * moment (`voicesSoon`), and a cold engine takes seconds - an e-ink tablet
 * binds Android's speech service and loads a voice on the first press of a
 * session, five to ten seconds during which the button used to change
 * nothing, and a second press, taken for a stop, cancelled the wait. Every
 * speaker paints its button from this phase (`reflectSpeech`) and refuses a
 * press while pending: nobody wants to interrupt a voice being prepared.
 *
 * @typedef {"idle" | "pending" | "speaking"} SpeechPhase
 */

/** @type {SpeechPhase} */
let phase = "idle";

/**
 * Whose press the phase belongs to: the token the speaker handed `speak` -
 * its button, or a symbol of its own - so that a page with several speakers
 * paints the one that is sounding and rests the others. Null at rest.
 *
 * @type {unknown}
 */
let owner = null;

/**
 * The owner the watchers were last told of, so that a new press under the
 * same phase is still news to them.
 *
 * @type {unknown}
 */
let announced = null;

/** @type {Set<(phase: SpeechPhase, owner: unknown) => void>} */
const watchers = new Set();

/**
 * How long a press may stay pending before it is given up. An engine that
 * answers nothing - no `start`, no `error` - would otherwise hold every
 * speaker's button busy for good, with every press refused. A phrase is
 * seconds long and a cold start is seconds long; half a minute is past both.
 */
export const PENDING_CEILING = 30000;

/** @type {ReturnType<typeof setTimeout> | null} */
let ceiling = null;

/**
 * The presses still awaiting the voice list, counted so that an older press
 * refused (no offline voice) does not put the button to rest under a newer
 * one still on its way.
 */
let inFlight = 0;

/**
 * Bumped by every stop: a press that finds it changed when the voice list
 * arrives was stopped while it waited - the bubble closed, the switch
 * flipped - and is abandoned rather than spoken late over nothing.
 */
let generation = 0;

/**
 * @param {SpeechPhase} next
 */
function setPhase(next) {
  if (next !== "pending" && ceiling !== null) {
    clearTimeout(ceiling);
    ceiling = null;
  }
  if (next === "pending" && ceiling === null) {
    ceiling = setTimeout(() => {
      ceiling = null;
      if (phase === "pending") stop();
    }, PENDING_CEILING);
  }
  if (phase === next && owner === announced) return;
  phase = next;
  const of = owner;
  announced = of;
  if (next === "idle") {
    owner = null;
    announced = null;
  }
  for (const watcher of watchers) watcher(next, of);
}

/**
 * @returns {SpeechPhase} where the voice is right now
 */
export function speechPhase() {
  return phase;
}

/**
 * @returns {unknown} the token of the press the voice belongs to; null at rest
 */
export function speechOwner() {
  return owner;
}

/**
 * @param {(phase: SpeechPhase, owner: unknown) => void} watcher told of every
 *   change of phase, and of every new press, with the token of the press the
 *   phase belongs to - at `idle`, the one that just ended
 * @returns {() => void} forgets the watcher
 */
export function watchSpeech(watcher) {
  watchers.add(watcher);
  return () => {
    watchers.delete(watcher);
  };
}

/**
 * Paints a speaker's button with the phase: `aria-busy` while the voice is
 * being prepared, `aria-pressed` while it speaks (the press that stops it),
 * neither at rest. The attributes are what the stylesheets draw the two
 * standings from - ink on paper, one repaint, nothing animated, so that an
 * e-ink panel draws them - and what a screen reader says of the button. A
 * page paints the sounding button alone; every other speaker rests.
 *
 * @param {{ setAttribute(name: string, value: string): void, removeAttribute(name: string): void }} button
 * @param {SpeechPhase} of
 */
export function reflectSpeech(button, of) {
  if (of === "pending") button.setAttribute("aria-busy", "true");
  else button.removeAttribute("aria-busy");
  button.setAttribute("aria-pressed", of === "speaking" ? "true" : "false");
}

/**
 * Somebody else on this page speaking through the same queue, and able to step
 * aside for a phrase. Exactly one such reader exists: the reader page reading
 * a whole article aloud (D87, `reader/read-aloud.js`), which registers itself
 * here when the page starts.
 *
 * The hook is needed because the queue only ever appends. Without it, pressing
 * the speaker on a word while an article is being read would not speak the
 * word - it would put it *after* the sentence in flight, and the answer to a
 * press would arrive several seconds late, in the middle of something else.
 * With it, the article stands aside at the word it had reached and the phrase
 * is spoken now.
 *
 * A content script never registers anything here, which is the whole of D83's
 * old promise: on somebody else's page the queue may be theirs, and this
 * module still takes nothing from it that it did not put there.
 *
 * @type {(() => void) | null}
 */
let sharing = null;

/**
 * @param {() => void} yieldQueue what to do before this module speaks
 */
export function shareVoice(yieldQueue) {
  sharing = yieldQueue;
}

/**
 * The engine's voice list, awaited where a fresh context answers empty.
 * Chromium loads the list lazily per page: the first `getVoices()` answers
 * an empty array and the real list arrives with `voiceschanged` a moment
 * later (measured on nytimes.com: 0 voices on the first ask, 227 after the
 * event). Speaking inside that gap sent the utterance out with no voice
 * object, and the engine's own default read it - an English word in the
 * system's Polish voice (Michał's report). One short wait, one shot: a
 * device that truly lists nothing (Android's clause in the header) settles
 * by the timer and the utterance goes out by `lang` alone, as it always
 * has.
 *
 * @returns {Promise<SpeechSynthesisVoice[]>}
 */
function voicesSoon() {
  const now = speechSynthesis.getVoices();
  if (now.length > 0) return Promise.resolve(now);
  return new Promise((resolve) => {
    const settle = () => {
      clearTimeout(timer);
      speechSynthesis.removeEventListener("voiceschanged", settle);
      resolve(speechSynthesis.getVoices());
    };
    const timer = setTimeout(settle, 1500);
    speechSynthesis.addEventListener("voiceschanged", settle);
  });
}

/**
 * Speaks, replacing whatever this module was saying before. The voice list is
 * asked at speak time rather than held: it loads asynchronously and can
 * change, and the voice is picked when it is needed - the stored choice, or
 * the fallback described at `offlineVoice` - waiting out the empty answer a
 * fresh page gives first (`voicesSoon`).
 *
 * @param {string} text as the page has it - the phrase, never the gloss
 * @param {string} lang BCP-47, the language being read
 * @param {string | undefined} voiceURI the choice stored for that language, if any
 * @param {number} [rate] the speed the reader set, as the engine's factor
 *   (1 = the voice's own normal speed); the config stores it as a percent
 * @param {unknown} [by] the speaker's token (D287): its button, or a symbol
 *   of its own - what the watchers are told the phase belongs to
 * @returns {Promise<boolean>} whether anything was handed to the engine -
 *   false with nothing to say, with speech off, and where the device has
 *   voices but no offline one for the language (the caller says so; this
 *   module only refuses)
 */
export async function speak(text, lang, voiceURI, rate = 1, by = null) {
  if (!canSpeak() || text.length === 0) return false;
  // Pending from the press, not from the hand-over: the voice list may take
  // a moment, and the button is to say so from the first instant.
  const pressed = generation;
  inFlight += 1;
  owner = by;
  setPhase("pending");
  const voices = await voicesSoon();
  inFlight -= 1;
  // The press ends without a word when a stop came while the list loaded
  // (the bubble closed, the switch flipped: a phrase spoken late over a
  // closed bubble is the extension talking to itself), when the switch is
  // off, or when this device reads the language only through the browser's
  // network voices - the settings page's promise (D155), asked before
  // anybody is told to step aside, so that a refusal never interrupts what
  // the page is saying. The button rests then, unless a newer press is
  // still on its way or a phrase of ours is still out loud.
  if (pressed !== generation || !canSpeak() || !offlineAvailable(voices, lang)) {
    if (inFlight === 0 && mine === null) setPhase("idle");
    return false;
  }
  // Whoever else is using this queue on this page steps aside first, or the
  // phrase would be spoken after whatever they are saying (see `shareVoice`).
  sharing?.();
  cancelMine();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = rate;
  const voice = offlineVoice(voices, lang, voiceURI);
  if (voice !== null) utterance.voice = voice;

  // Each only if the module has not moved on: a cancelled utterance reports
  // in after `mine` already names its successor.
  utterance.addEventListener("start", () => {
    if (mine === utterance) setPhase("speaking");
  });
  const done = () => {
    if (mine !== utterance) return;
    mine = null;
    setPhase("idle");
  };
  utterance.addEventListener("end", done);
  utterance.addEventListener("error", done);

  mine = utterance;
  speechSynthesis.speak(utterance);
  return true;
}

/**
 * Stops our utterance - and only ever ours, see `mine` - and puts every
 * speaker's button to rest. A press still awaiting the voice list is
 * abandoned too (`generation`): closing the bubble means no phrase now.
 */
export function stop() {
  generation += 1;
  cancelMine();
  setPhase("idle");
}

/**
 * Takes our utterance off the engine's queue, if one is there. The phase is
 * the caller's to set: a phrase replacing another must not blink the button
 * through rest on the way.
 */
function cancelMine() {
  if (mine === null) return;
  mine = null;
  speechSynthesis.cancel();
}
