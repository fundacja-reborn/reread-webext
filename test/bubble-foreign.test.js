import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { bodyOf, openings } from "./openings.js";

/**
 * A word the page's dictionary knew, with the engine on (D193).
 *
 * The engine translates from the pair's language or not at all, and a page
 * in the reader's own language fed it Polish (Michał's screenshot,
 * 2026-09-11): "książkach" glossed "księgowa", the sentence around it word
 * salad - and the guess kept itself in the vocabulary (D22). The rule is
 * `answeredElsewhere` (gloss.test.js); what this reads is the call sites,
 * like `bubble-hint` does, because the regressions would be call sites
 * saying nothing: a request that stops carrying the page's language, a
 * landing that shows the guess anyway or keeps it, a voice that ignores the
 * book that knew the word.
 */

const ROOT = new URL("../src/content/", import.meta.url);

/** @returns {Promise<string>} */
async function reading() {
  return readFile(new URL("reading.js", ROOT), "utf8");
}

/**
 * The landing of the translating fresh selection: from its opening to the
 * decision about keeping.
 *
 * @param {string} source
 */
function freshLanding(source) {
  const fresh = openings(source).filter((call) => call.includes('variant: "save"'));
  assert.equal(fresh.length, 1, "the translating fresh selection opens somewhere new");
  const after = source.slice(source.indexOf(fresh[0] ?? "") + (fresh[0] ?? "").length);
  return after.slice(0, after.indexOf("const decision = keeping("));
}

describe("a word the page's dictionary knew, with the engine on", () => {
  it("asks the dictionaries in the page's language too, from both translating bubbles", async () => {
    const source = await reading();
    const request = bodyOf(source, "translateRequest");
    assert.match(request, /request\.lang = lang/, "the request stopped carrying the page's language");
    assert.match(freshLanding(source), /translateRequest\(text, selection\.context, selection\.lang\)/, "the fresh selection asks without the page's language");
    assert.match(
      bodyOf(source, "fillSecondLayer"),
      /translateRequest\(phrase\.text, wanted\.context, phrase\.lang\)/,
      "the recall bubble's layer asks without the page's language",
    );
  });

  it("sets the engine's answer aside when the page's dictionary knew the word, and keeps nothing", async () => {
    const landing = freshLanding(await reading());
    const at = landing.indexOf("answeredElsewhere({");
    assert.ok(at !== -1, "the landing stopped asking whether another language's dictionary answered");
    const branch = landing.slice(at, landing.indexOf("return;", at));
    assert.match(branch, /tooltip\.setBody\("", "normal"\)/, "the engine's gloss stands over the page's word");
    assert.doesNotMatch(branch, /setContext\(sentence\)/, "the engine's sentence stands over the page's word");
    assert.doesNotMatch(branch, /keep\(\[/, "the engine's guess keeps itself in the vocabulary");
    assert.match(branch, /current\.answered = lang/, "the voice does not follow the book that knew the word");
    assert.match(branch, /bubble_saves_under/, "Save files under the pair without saying so (D167)");
    assert.match(branch, /tooltip\.expand\(\)/, "the entries can hide behind More, leaving a bubble of nothing but its row");
    assert.match(branch, /tooltip\.reveal\(\)/, "Save can hide behind the fold (D131)");
  });

  it("speaks in the dictionary's language then, with the engine on as well", async () => {
    const voice = bodyOf(await reading(), "readingLanguage");
    assert.match(
      voice,
      /if \(!noTranslation\) return current !== null && current\.answered\.length > 0 \? current\.answered : ttsLang;/,
      "the engine's bubble speaks in the pair's voice over a word of another language",
    );
  });
});
