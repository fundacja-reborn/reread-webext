import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { bodyOf, openings } from "./openings.js";

/**
 * The bubble's hint line (D192): under the translation of a word or two that
 * no dictionary line answers, the bubble says which dictionary would have
 * known better, and offers the way to more of them.
 *
 * The rule itself is `dictionaryHint` (gloss.test.js). What this reads is the
 * call sites, like `bubble-fold` and `bubble-pending` do, because the
 * regressions here would be call sites saying nothing: a landing that stops
 * asking the rule, a phrase whose hint outlives it, a link that leaks the
 * page somebody was reading as its referrer.
 */

const ROOT = new URL("../src/content/", import.meta.url);

/** @param {string} name */
async function source(name) {
  return readFile(new URL(name, ROOT), "utf8");
}

describe("the hint line under a translated word", () => {
  it("is decided by the rule at the landing of a fresh selection, and offered with the layer", async () => {
    const reading = await source("reading.js");
    const fresh = openings(reading).filter((call) => call.includes('variant: "save"'));
    assert.equal(fresh.length, 1, "the translating fresh selection opens somewhere new");
    const after = reading.slice(reading.indexOf(fresh[0] ?? "") + (fresh[0] ?? "").length);
    const landing = after.slice(0, after.indexOf("const decision = keeping("));
    assert.match(landing, /dictionaryHint\(\{/, "the landing stopped asking the rule");
    assert.match(landing, /dictionaries,/, "the rule is asked without the translation's count");
    assert.match(landing, /tooltip\.setHint\(/, "the landing decides a hint and hands none to the bubble");
    // The layer is offered wherever the hint stands: with the open-layer
    // setting off, a hint with no sentence and no entries would otherwise
    // have no More to bring it out.
    assert.match(landing, /hint !== null \? \["more"\]/, "a hint alone does not offer More");
  });

  it("offers the way to more dictionaries under the quiet bubble's miss, and only there", async () => {
    const landing = bodyOf(await source("reading.js"), "landQuietAnswer");
    assert.match(landing, /dictionaryHint\(\{/, "the quiet landing stopped asking the rule");
    assert.match(
      landing,
      /hint === "not-in-dictionary" \? \{ text: "", link: sourcesLink\(\) \} : null/,
      "the quiet bubble's hint is not the link alone under the miss",
    );
  });

  it("belongs to one phrase: the bubble clears it on every opening and folds it with the layer", async () => {
    const tooltip = await source("tooltip.js");
    const opening = tooltip.slice(tooltip.indexOf("    show({"), tooltip.indexOf("    setBody(body, tone = \"normal\") {"));
    assert.match(opening, /hintElement\.replaceChildren\(\)/, "an opening keeps the last phrase's hint");
    const unfold = bodyOf(tooltip, "unfold");
    assert.match(unfold, /hintElement\.hidden = !unfolded/, "the hint stands outside the layer's fold");
  });

  it("links out with no opener and no referrer, in a new tab", async () => {
    const setHint = bodyOf(await source("tooltip.js"), "setHint");
    assert.match(setHint, /link\.target = "_blank"/, "the link leaves in the page's own tab");
    assert.match(setHint, /link\.rel = "noopener noreferrer"/, "the link hands the page being read to its destination");
    assert.match(setHint, /\.textContent = hint\.link\.label/, "the link's words go in as something other than text");
    assert.doesNotMatch(setHint, /innerHTML/, "the hint is written as markup");
  });
});
