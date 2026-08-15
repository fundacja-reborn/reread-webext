import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canSpeak, chosenVoice, primaryLanguage, voicesFor } from "../src/lib/tts.js";

/**
 * A voice as the pure half sees one - the three fields `VoiceLike` names.
 *
 * @param {string} name
 * @param {string} lang
 * @param {string} [voiceURI]
 */
function voice(name, lang, voiceURI = name) {
  return { name, lang, voiceURI };
}

describe("primaryLanguage", () => {
  it("answers the part before any region, lowercased", () => {
    assert.equal(primaryLanguage("en"), "en");
    assert.equal(primaryLanguage("en-US"), "en");
    assert.equal(primaryLanguage("EN-us"), "en");
  });

  it("reads Android's underscore spelling as the same language", () => {
    // The system's engines name voices en_US where the web writes en-US, and
    // a filter that missed them would offer no voices exactly where choosing
    // one matters most.
    assert.equal(primaryLanguage("en_US"), "en");
    assert.equal(primaryLanguage("pl_PL"), "pl");
  });

  it("answers nothing for an empty tag", () => {
    assert.equal(primaryLanguage(""), "");
  });
});

describe("voicesFor", () => {
  const device = [
    voice("Zosia", "pl-PL"),
    voice("Brian", "en_GB"),
    voice("Alice", "en-US"),
    voice("Karl", "de-DE"),
    voice("Emma", "en-US"),
  ];

  it("offers every regional variant of the language being read", () => {
    assert.deepEqual(
      voicesFor(device, "en")
        .map((one) => one.name)
        .sort(),
      ["Alice", "Brian", "Emma"],
    );
  });

  it("sorts by tag and then by name, so the order holds between opens", () => {
    const sorted = voicesFor(
      [voice("Alice", "en-US"), voice("Colin", "en-GB"), voice("Brian", "en-GB")],
      "en",
    ).map((one) => one.name);
    // The en-GB pair stands together and alphabetically, ahead of en-US.
    assert.deepEqual(sorted, ["Brian", "Colin", "Alice"]);
  });

  it("answers none for a language with no voice, and for no language at all", () => {
    assert.deepEqual(voicesFor(device, "uk"), []);
    assert.deepEqual(voicesFor(device, ""), []);
  });

  it("leaves the list it was given as it was", () => {
    const given = [voice("B", "en"), voice("A", "en")];
    voicesFor(given, "en");
    assert.deepEqual(
      given.map((one) => one.name),
      ["B", "A"],
    );
  });
});

describe("chosenVoice", () => {
  const device = [voice("Alice", "en-US", "urn:alice"), voice("Zosia", "pl-PL", "urn:zosia")];

  it("finds the stored choice by its exact URI", () => {
    assert.equal(chosenVoice(device, "urn:zosia")?.name, "Zosia");
  });

  it("answers null when nothing was chosen", () => {
    assert.equal(chosenVoice(device, undefined), null);
    assert.equal(chosenVoice(device, ""), null);
  });

  it("answers null for a voice this device no longer has", () => {
    // A stale choice - an uninstalled voice, a profile from another machine -
    // must fall back to the engine's default, never mute the button.
    assert.equal(chosenVoice(device, "urn:gone"), null);
    assert.equal(chosenVoice([], "urn:alice"), null);
  });
});

describe("canSpeak", () => {
  it("is false under node, where the speaking half stays quiet", () => {
    assert.equal(canSpeak(), false);
  });
});
