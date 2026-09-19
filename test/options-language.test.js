import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * How the settings page talks to the reader (Michał's rule, 2026-09-18): plain
 * words, no metaphor, and nothing that is not a person standing, lying,
 * looking, saying or wanting. The comments in this repository are written the
 * other way round on purpose - a bubble stands, a row wears its frame - and
 * that voice kept leaking into the sentences people actually read.
 *
 * The check is a word list, not a grammar: it flags the verbs that carry the
 * habit, and a sentence that legitimately uses one - a reader's own hand
 * holding a device, "when you want to" - is named in `ALLOWED` with the
 * reason. The point is that adding a new one takes a deliberate line here.
 */

const ROOT = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

/**
 * The habit, in the two languages this project writes first.
 *
 * Polish is bounded by letters rather than by `\b`: JavaScript counts every
 * accented letter as a non-word character, so `\btrzymają\b` finds the verb
 * inside "trzymająca" - a participle about a reader's own hand - and the word
 * list would have to buy its way out with an exception for a sentence that
 * never broke the rule.
 */
const PL_HABIT = [
  "stoi", "stoją", "leży", "leżą", "mówi", "mówią", "patrzy", "widzi", "pyta", "czeka", "czekają",
  "pilnuje", "trzyma", "trzymają", "nosi", "siedzi", "żyje", "bierze", "waży", "ważą", "potrafi",
  "umie", "myśli", "decyduje", "odpowiada", "odpowiadają", "trafia", "trafiają", "ląduje", "lądują",
  "wjeżdża", "wjeżdżają", "wskakuje", "ucieka", "prosi", "proszą",
];

const HABITS = {
  en: /\b(stands?|lives?|sits?|lies|says?|asks?|waits?|watches|knows?|remembers|forgets|decides?|answers?|weighs?|holds?|wears?|walks?|sleeps?|listens?|promises?)\b/i,
  pl: new RegExp(`(?<!\\p{L})(?:${PL_HABIT.join("|")})(?!\\p{L})`, "iu"),
};

/**
 * Sentences where one of those words is about a person, or is the only word
 * there is for the thing - each with its reason, because the list is meant to
 * be read before anything is added to it.
 */
const ALLOWED = new Map([
  // The reader, wanting something.
  ["options_support_intro", "if you want to support"],
  // An instruction to the reader, not a description of a thing.
  ["options_import_elsewhere", "wait for it to finish"],
  // A voice reads aloud; there is no other word for what a voice does.
  ["options_tts_voice_hint", "the voice that speaks"],
  ["options_tts_voice_more", "the voice reads phrases and articles"],
]);

/**
 * The Polish catalogue's own rules (D258, §6.1): one term per thing, the
 * half-dash between clauses, and pronouns in lower case. These are not about
 * the settings page alone - a reader meets the same words in the bubble, the
 * popup and the reading view, and a term that changes between them is two
 * things as far as they can tell.
 */
/** @type {[RegExp, string][]} */
const PL_BANNED = [
  [/dymk\w* tłumaczeń/i, "the bubble is \"dymek (tłumaczenia)\", singular"],
  [/dymk\w* paska/i, "the toolbar's window is \"okienko re/read\", never a bubble"],
  [/przełącznik\w* pod ikoną/i, "the toolbar's window is named, not pointed at"],
  [/okienk\w* przycisku/i, "the toolbar's window is \"okienko re/read\""],
  [/stron\w+ czytnika/i, "the reading view is \"widok czytania\""],
  [/[Tt]apn|[Tt]apni/, "Polish Android says \"dotknięcie\" (H4)"],
];

describe("the settings page's language", () => {
  it("says nothing about a thing standing, lying, wanting or deciding", async () => {
    for (const locale of /** @type {("en" | "pl")[]} */ (["en", "pl"])) {
      const catalogue = JSON.parse(await source(`_locales/${locale}/messages.json`));
      for (const [key, entry] of Object.entries(catalogue)) {
        if (!key.startsWith("options_")) continue;
        // Labels and buttons are imperatives to the reader ("Listen", "Done")
        // and are too short to carry a habit; this rule is about the prose.
        if (entry.message.length < 40) continue;
        const found = HABITS[locale].exec(entry.message);
        if (found === null) continue;
        assert.ok(
          ALLOWED.has(key),
          `${locale}/${key} says "${found[0]}" of something that is not a person: ${entry.message.slice(Math.max(0, found.index - 50), found.index + 60)}`,
        );
      }
    }
  });

  it("keeps one Polish term for each thing, and never the dev's word for it (D258, §6.2)", async () => {
    const catalogue = JSON.parse(await source("_locales/pl/messages.json"));
    for (const [key, entry] of Object.entries(catalogue)) {
      // The search keywords are the words a reader might type, synonyms and
      // all - the one place a term outside the glossary belongs.
      if (key.startsWith("options_keywords_")) continue;
      for (const [pattern, why] of PL_BANNED) {
        assert.ok(!pattern.test(entry.message), `pl/${key}: ${why} - ${entry.message.slice(0, 120)}`);
      }
    }
  });

  it("writes a Polish dash as a half-dash, and a pronoun in lower case (D258, §6.1)", async () => {
    const catalogue = JSON.parse(await source("_locales/pl/messages.json"));
    for (const [key, entry] of Object.entries(catalogue)) {
      const message = entry.message;
      assert.ok(!message.includes(" - "), `pl/${key} writes a dash as a spaced hyphen`);
      assert.ok(!message.startsWith("- "), `pl/${key} opens on a spaced hyphen`);
      // Mid-sentence only: a sentence may still begin with "Twoje".
      const pronoun = /[^.!?:;\u201d"]\s+Tw(ój|oja|oje|oim|oimi|ojego|ojej|oich|oją|ojemu|oi|ojach)\b/.exec(message);
      assert.equal(pronoun, null, `pl/${key} capitalises a pronoun: ${message.slice(0, 120)}`);
    }
  });

  it("tells the reader where the data and the copies are, and what removing the extension does", async () => {
    // Michał's ask, 2026-09-18: somebody looking for the copy must not go
    // hunting through files on their computer, and somebody about to
    // uninstall must know the data goes with it.
    for (const locale of ["en", "pl", "de", "fr", "es", "uk"]) {
      const catalogue = JSON.parse(await source(`_locales/${locale}/messages.json`));
      const where = catalogue["options_storage_how_more"].message;
      assert.match(where, /IndexedDB/, `${locale} does not name the database the data is in`);
      // Said once, under the Backups heading (D260): where the copies are and
      // when they are written behind its fold, what uninstalling costs in the
      // note under the table.
      const copies = catalogue["options_copies_intro_more"].message;
      assert.match(copies, /IndexedDB/, `${locale} does not name the database`);
      assert.match(copies, /storage\.local/, `${locale} does not name where the copies are`);
      const uninstall = catalogue["options_copies_uninstall"].message;
      assert.match(uninstall, /re\/read/, `${locale} does not say what uninstalling re/read costs`);
      assert.match(catalogue["options_copies_uninstall_rest"].message, /reread-backup\.zip/, `${locale} does not name the file a copy is saved as`);
      assert.match(catalogue["options_copies_uninstall_rest"].message, /TSV/, `${locale} does not say the saved phrases export a different file`);
    }
    // And the sentence over the fold says the plain half of it: not a file on
    // your computer.
    const markup = await source("options/options.html");
    assert.match(markup, /data-i18n="options_copies_intro"/, "the copies say nothing about where they are");
    assert.match(markup, /aria-controls="more-copies"/, "the rest of it has no way in");
  });
});

/**
 * A checkbox is an instruction, so its name is a verb (Michał's rule,
 * 2026-09-18). "Reading aloud" stood under a heading that already said
 * "Reading aloud" - the subject named twice and the act not at all - and
 * "Copy of the reading list" named a thing where the switch is what makes
 * one. The act goes in the name; where to find what the act produces goes in
 * the sentence under it.
 *
 * English and Polish only: German and Ukrainian put the verb at the end of
 * the phrase, and this rule is about naming the act, not about word order.
 * The settings page only: the popup's third switch is named by a hostname.
 *
 * The opener lists are the deliberate line. A new checkbox named with a noun
 * fails here until somebody either names the act or writes its verb down.
 */
const TOGGLE_OPENERS = {
  en: new Set(["Show", "Save", "Underline", "Use", "Back", "Do"]),
  pl: new Set(["Pokazuj", "Zapisuj", "Podkreślaj", "Używaj", "Wykonuj", "Nie"]),
};

describe("the name of a checkbox", () => {
  it("says what the switch does, not what it is about (Michał, 2026-09-18)", async () => {
    const markup = await source("options/options.html");
    /** @type {string[]} */
    const named = [];
    // Since D265 the box opens the row and the label stands beside it, tied
    // to it by `for` - the whole row is the target, and the description it
    // points at with `aria-describedby` is not part of the name. A row whose
    // name says the whole of it carries no description, and then no
    // `aria-describedby` either (Michał, 2026-09-19): that the pointer and
    // the paragraph always come as a pair is held in `options-rows`.
    for (const found of markup.matchAll(/<div class="row row-check[^"]*"[\s\S]*?<\/label>/g)) {
      const block = found[0] ?? "";
      assert.match(block, /<input type="checkbox" id="([a-z-]+)"/, `a toggle row without a checkbox: ${block.slice(0, 80)}`);
      const key = /<label class="row-name" for="([a-z-]+)" data-i18n="([a-z_]+)"/.exec(block);
      assert.notEqual(key, null, `a checkbox without a name: ${block.slice(0, 80)}`);
      assert.match(block, new RegExp(`<input type="checkbox" id="${key?.[1]}"`), "the label names a box that is not the row's");
      named.push(String(key?.[2]));
    }
    // A regex that stopped matching would pass every assertion above by
    // finding nothing at all.
    assert.ok(named.length >= 11, `only ${named.length} checkboxes found on the settings page`);
    assert.ok(named.includes("options_tts"), "the reading-aloud switch is not among them");
    assert.ok(named.includes("options_library_copy"), "the copy switch is not among them");

    for (const locale of /** @type {("en" | "pl")[]} */ (["en", "pl"])) {
      const catalogue = JSON.parse(await source(`_locales/${locale}/messages.json`));
      for (const key of named) {
        const message = catalogue[key]?.message;
        assert.equal(typeof message, "string", `${locale} has no name for ${key}`);
        const opener = String(message).split(" ")[0] ?? "";
        assert.ok(
          TOGGLE_OPENERS[locale].has(opener),
          `${locale}/${key} opens on "${opener}", which is not one of the verbs a checkbox is named with: ${message}`,
        );
      }
    }
  });
});
