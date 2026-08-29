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
 * therefore forgiving: a stored voice that is gone falls back to the engine's
 * own default for the language, and an empty voice list is no reason not to
 * speak - the utterance carries its language, and the engine does the rest.
 * That last part is Android's clause: there `getVoices()` has been known to
 * answer nothing while `speak()` works all the same.
 *
 * The rules (which voices can read a language, which one was chosen) are pure
 * functions, tested without a browser; the speaking half stays quiet anywhere
 * `speechSynthesis` does not exist.
 */

/**
 * What the pure half needs to know about a voice - structural, so the tests
 * can hand in plain objects and the browser's `SpeechSynthesisVoice` passes
 * as it is.
 *
 * @typedef {{ name: string, lang: string, voiceURI: string }} VoiceLike
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
 * The voices able to read a language, for the settings page's picker: same
 * primary subtag, regional variants included - a reader of `en` chooses among
 * en-US, en-GB and whatever else the device offers. Sorted by tag and then by
 * name, so variants stand together and the order holds from one open to the
 * next; the list handed in is left as it was.
 *
 * @template {VoiceLike} V
 * @param {readonly V[]} voices
 * @param {string} lang
 * @returns {V[]}
 */
export function voicesFor(voices, lang) {
  const wanted = primaryLanguage(lang);
  if (wanted === "") return [];
  return voices
    .filter((voice) => primaryLanguage(voice.lang) === wanted)
    .sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
}

/**
 * The stored choice, if this device still has it. Everything else - no choice
 * made, a voice uninstalled since, a profile carried to another machine -
 * answers null, and null means the engine's default for the utterance's
 * language: a stale choice must never mute the button.
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
 * Speaks, replacing whatever this module was saying before. The voice list is
 * asked at speak time rather than held: it loads asynchronously and can
 * change, and the chosen voice is looked up when it is needed - or quietly
 * not found, which is the fallback described at `chosenVoice`.
 *
 * @param {string} text as the page has it - the phrase, never the gloss
 * @param {string} lang BCP-47, the language being read
 * @param {string | undefined} voiceURI the choice stored for that language, if any
 * @param {number} [rate] the speed the reader set, as the engine's factor
 *   (1 = the voice's own normal speed); the config stores it as a percent
 */
export function speak(text, lang, voiceURI, rate = 1) {
  if (!canSpeak() || text.length === 0) return;
  // Whoever else is using this queue on this page steps aside first, or the
  // phrase would be spoken after whatever they are saying (see `shareVoice`).
  sharing?.();
  stop();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = rate;
  const voice = chosenVoice(speechSynthesis.getVoices(), voiceURI);
  if (voice !== null) utterance.voice = voice;

  const done = () => {
    // Only if the module has not moved on: a cancelled utterance reports in
    // after `mine` already names its successor.
    if (mine === utterance) mine = null;
  };
  utterance.addEventListener("end", done);
  utterance.addEventListener("error", done);

  mine = utterance;
  speechSynthesis.speak(utterance);
}

/**
 * Stops our utterance - and only ever ours, see `mine`.
 */
export function stop() {
  if (mine === null) return;
  mine = null;
  speechSynthesis.cancel();
}
