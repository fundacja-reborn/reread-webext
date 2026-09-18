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

/** The habit, in the two languages this project writes first. */
const HABITS = {
  en: /\b(stands?|lives?|sits?|lies|says?|asks?|waits?|watches|knows?|remembers|forgets|decides?|answers?|weighs?|holds?|wears?|walks?|sleeps?|listens?|promises?)\b/i,
  pl: /\b(stoi|stoją|leży|leżą|mówi|mówią|patrzy|widzi|pyta|czeka|pilnuje|trzyma|trzymają|nosi|siedzi|żyje|bierze|waży|ważą|potrafi|umie|myśli|decyduje|odpowiada|odpowiadają)\b/i,
};

/**
 * Sentences where one of those words is about a person, or is the only word
 * there is for the thing - each with its reason, because the list is meant to
 * be read before anything is added to it.
 */
const ALLOWED = new Map([
  // The reader's own hand and thumb, holding a device.
  ["options_touch_turn_more", "the hand that holds the device"],
  ["options_touch_turn_note_zones", "the thumb holding the phone"],
  // The reader, wanting something.
  ["options_local_intro", "when you want to download"],
  ["options_models_intro", "the pair you want to translate"],
  ["options_support_intro", "if you want to support"],
  // An instruction to the reader, not a description of a thing.
  ["options_import_elsewhere", "wait for it to finish"],
  // A voice reads aloud; there is no other word for what a voice does.
  ["options_tts_voice_hint", "the voice that speaks"],
  ["options_tts_voice_more", "the voice reads phrases and articles"],
]);

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

  it("tells the reader where the data and the copies are, and what removing the extension does", async () => {
    // Michał's ask, 2026-09-18: somebody looking for the copy must not go
    // hunting through files on their computer, and somebody about to
    // uninstall must know the data goes with it.
    for (const locale of ["en", "pl", "de", "fr", "es", "uk"]) {
      const catalogue = JSON.parse(await source(`_locales/${locale}/messages.json`));
      const where = catalogue["options_storage_how_more"].message;
      assert.match(where, /IndexedDB/, `${locale} does not name the database the data is in`);
      const copies = catalogue["options_copies_safe_more"].message;
      assert.match(copies, /storage\.local/, `${locale} does not name where the copies are`);
      assert.match(copies, /re\/read/, `${locale} does not say what uninstalling re/read costs`);
      assert.match(copies, /reread-backup\.zip/, `${locale} does not name the file a copy is saved as`);
    }
    // And the sentence over the fold says the plain half of it: not a file on
    // your computer.
    const markup = await source("options/options.html");
    assert.match(markup, /data-i18n="options_copies_safe"/, "the copies say nothing about where they are");
    assert.match(markup, /aria-controls="more-copies"/, "the rest of it has no way in");
  });
});
