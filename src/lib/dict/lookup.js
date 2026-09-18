/**
 * Asking the installed dictionaries about a phrase.
 *
 * This is the half of a bubble the engine cannot produce. A translation has to
 * choose a sense and cannot mention the one it did not choose; a dictionary
 * lists them, which is what makes it the answer to `bank` rather than a second
 * opinion about it.
 *
 * Two callers, one function. The background runs it alongside the translation
 * (D31) and it never delays the gloss: a point read in IndexedDB against a
 * translation is nothing, and the reader who presses "More" finds it already
 * there. The reader page calls it directly for the quiet bubble (D121) - with
 * translation off there is no engine ride to share, and the reader page is an
 * extension page with the database in reach, the way the options page already
 * writes it (D14/D15). A dictionary that fails - a database that will not
 * open, a schema from a future version - costs the entries and nothing else:
 * extras do not get to break answers.
 */

import { keyTokens } from "../matcher/tokenize.js";
import { normalize } from "../normalize.js";
import { RULED_LANGUAGE, baseForms } from "./deinflect.js";
import { lookupEntries } from "./store.js";

/**
 * The same limit that decides whether a phrase saves itself: beyond it, a
 * selection is a sentence somebody is reading, not a word they want defined,
 * and no dictionary has an entry for it anyway.
 */
const MAX_WORDS = 4;

/**
 * The keys a phrase is asked under, or null when it is not a dictionary
 * question at all - the pure half of `lookUp`, split out so the rules can be
 * tested without a database. First the phrase as normalized, then - for a
 * single word in the one language whose endings this build knows - its
 * possible base forms. Other forms only for a single word: `takes off` is not
 * a phrase whose parts can be conjugated separately, and a dictionary that
 * has `take off` has it under that spelling.
 *
 * @param {string} text as the page had it
 * @param {string} langFrom the language being read
 * @returns {string[] | null}
 */
export function lookupKeys(text, langFrom) {
  const key = normalize(text);
  if (key.length === 0) return null;

  const words = keyTokens(key);
  if (words.length === 0 || words.length > MAX_WORDS) return null;

  const others = words.length === 1 && langFrom === RULED_LANGUAGE ? baseForms(key) : [];
  return [key, ...others];
}

/**
 * The languages a phrase is asked in, in order (D191): the pair's source
 * first - the language somebody said they are reading - and what the page
 * declares for the phrase second, for the word the pair's dictionaries did
 * not know on a page that says it is in another language. The same language
 * named twice is asked once; nothing named at all is nothing to ask, and the
 * caller answers null on it.
 *
 * Until D191 the page came first and the pair was the stand-in (D165) - and
 * every localised web app declares the language of its buttons, not of its
 * posts, so an English word on a Polish-interface page was looked up in
 * Polish and told there was no Polish dictionary. The pair is the one
 * choice somebody made on purpose, and it is on show in the popup; the
 * page's word still counts, one step later, so a Polish page with a Polish
 * dictionary reads without a trip to the settings.
 *
 * Since D193 a detector's verdict outranks the pair: a phrase the browser
 * read as being in another language (`foreignLanguage`) is asked in that
 * language and in the page's, and the pair's shelf is left alone - a Polish
 * "list" is not the English one, and an English dictionary that happens to
 * hold the spelling would answer about the wrong word.
 *
 * @param {{ pair: string | null, declared: string | null, detected?: string | null }} of the pair's
 *   source language, the page's declaration for the phrase and the
 *   detector's verdict, each null or empty for none - primary subtags, the
 *   way the callers already hold them
 * @returns {string[]}
 */
export function languagesToAsk({ pair, declared, detected = null }) {
  /** @type {string[]} */
  const languages = [];
  const first = (detected ?? "").trim();
  for (const candidate of first.length > 0 ? [first, declared] : [pair, declared]) {
    const lang = (candidate ?? "").trim();
    if (lang.length > 0 && !languages.includes(lang)) languages.push(lang);
  }
  return languages;
}

/**
 * What the dictionaries have on a phrase - how many of them were asked and
 * in which language, because "nothing in your dictionaries" and "no
 * dictionary for this language" are different sentences for a bubble to say
 * (D164), and the language has to be named (D191). The count comes out of the
 * read the lookup makes anyway, and is asked even for a phrase that is not a
 * dictionary question (a sentence, an empty selection): the bubble still has
 * to know which of the two silences it met. Null is no answer at all - no
 * language to ask in, a database that would not open - and the bubble says
 * nothing on it, by the header's rule: extras do not get to break answers,
 * and neither do they get to send anybody to the settings for a dictionary
 * that is there.
 *
 * Since D252 the pair's shelf gets a last word the list did not give it: a
 * detector's verdict takes the pair out of `languagesToAsk` (D193), and the
 * verdict is read on the sentence around the phrase, so an English term
 * quoted in a Polish sentence was asked of Polish dictionaries alone and
 * told it was in none of them - with the pair's English shelf holding it all
 * along (Michał's screenshot, 2026-09-18). Asked only where the named shelves
 * came back with nothing, and only where the pair was not among them, so the
 * common answer costs exactly what it did.
 *
 * It is a second read rather than a third entry in the list on purpose: the
 * silence has to stay the named shelves' own. `settle` describes whichever
 * shelf it could ask, and a reader with no Polish dictionary must still hear
 * "no dictionary for Polish yet" over a Polish word - not "not in your
 * dictionaries", said of an English shelf they never asked about. So the
 * first answer is kept whole, and the second one replaces it only by knowing
 * the word.
 *
 * @param {string} text as the page had it
 * @param {{ pair: string | null, declared: string | null, detected?: string | null }} languages the
 *   pair's source, the page's declaration and the detector's verdict, in
 *   `languagesToAsk`'s terms
 * @returns {Promise<import("../protocol.js").LookUp | null>}
 */
export async function lookUpAnswer(text, languages) {
  const asked = languagesToAsk(languages);
  const answer = await askShelves(text, asked);
  if (answer === null) return null;
  const again = shelfAfterSilence({ pair: languages.pair ?? null, asked, entries: answer.entries.length });
  if (again === null) return answer;
  const second = await askShelves(text, [again]);
  return second !== null && second.entries.length > 0 ? second : answer;
}

/**
 * The shelf worth one more read after the named ones came back with nothing
 * (D252), or null for none: the pair's own language, when a detector's
 * verdict has taken it out of the list. Nothing to add where the word was
 * found, where the pair was asked already, and where there is no pair. Pure,
 * so the rule can be tested without a database.
 *
 * @param {{ pair: string | null, asked: string[], entries: number }} of the pair's
 *   source language, the shelves read so far, and how many entries they
 *   returned between them
 * @returns {string | null}
 */
export function shelfAfterSilence({ pair, asked, entries }) {
  if (entries > 0) return null;
  const language = (pair ?? "").trim();
  return language.length === 0 || asked.includes(language) ? null : language;
}

/**
 * The shortest word that makes a phrase worth vouching for by its parts.
 * Three letters and under are where Polish and English collide by accident -
 * "to", "by", "pan", "ten" are all English headwords and all ordinary Polish
 * words - so a phrase built of nothing but those proves nothing about its
 * language.
 */
const SHORT_WORD = 3;

/**
 * The words a phrase would be vouched for by (D252's second half), or none
 * when it is not that kind of phrase: a term of several words that no
 * dictionary holds whole - "end-to-end encryption", "zero knowledge" - where
 * the parts are in the dictionaries even though the whole is not.
 *
 * A single word is not here: it was asked in full already, and a second ask
 * under the same key would be the same silence. Neither is a phrase longer
 * than the lookup's own ceiling, nor one made of short words only
 * (`SHORT_WORD`). Each word once, in order. Pure, so the rule can be tested
 * without a database.
 *
 * @param {string} text as the page had it
 * @returns {string[]}
 */
export function termWords(text) {
  const words = keyTokens(normalize(text));
  if (words.length < 2 || words.length > MAX_WORDS) return [];
  if (!words.some((word) => word.length > SHORT_WORD)) return [];
  return [...new Set(words)];
}

/**
 * Whether one language's dictionaries know **every** word of a term - the
 * witness that a phrase nobody holds whole is nevertheless that language's
 * (D252's second half, Michał's report of 2026-09-18: `end-to-end
 * encryption` in a Polish paragraph got no translation, because no shelf
 * holds the term and no shelf could vouch for it).
 *
 * Every word and not most of them, on purpose. It is the condition that
 * keeps a Polish phrase out of an English engine: Polish inflects, so its
 * words are not English headwords, and one word missing is enough to leave
 * the detector's verdict standing. The reader's own condition since D193,
 * and the one that must not be traded for reach.
 *
 * Read only where everything cheaper has already said nothing, so it costs
 * at most `MAX_WORDS` point reads on a phrase that was going to be answered
 * with silence anyway.
 *
 * @param {string} text as the page had it
 * @param {string} lang the language to vouch in - the pair's source
 * @returns {Promise<boolean>}
 */
export async function everyWordKnown(text, lang) {
  const language = lang.trim();
  const words = termWords(text);
  if (language.length === 0 || words.length === 0) return false;
  for (const word of words) {
    const answer = await askShelves(word, [language]);
    if (answer === null || answer.entries.length === 0) return false;
  }
  return true;
}

/**
 * The dictionaries of some languages asked about a phrase, in order - the
 * database half of `lookUpAnswer`, split out because the pair's shelf may be
 * asked a second time. A dictionary that fails costs the entries and nothing
 * else (the header's rule).
 *
 * @param {string} text as the page had it
 * @param {string[]} languages the shelves to read, in order
 * @returns {Promise<import("../protocol.js").LookUp | null>}
 */
async function askShelves(text, languages) {
  const asks = languages.map((lang) => ({ lang, keys: lookupKeys(text, lang) ?? [] }));
  if (asks.length === 0) return null;
  try {
    return await lookupEntries(asks);
  } catch {
    return null;
  }
}

