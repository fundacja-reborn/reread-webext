import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * One checkbox, every bubble (D131).
 *
 * "Hide bubble actions by default" (D81) is a sentence about the bubble, not
 * about one of its variants - but it only ever reached the openings that
 * remembered to pass it, and the bubble over an underline did not: it folded
 * itself by variant, so for a year the setting had no effect on half the
 * bubbles somebody sees (Michał's report, 2026-08-22).
 *
 * That is a bug no unit test could have caught by asking a function a
 * question, because the bug was a call site saying nothing. So this test reads
 * the call sites: every opening either carries the setting, or is the one
 * variant with nothing to fold away.
 */

const ROOT = new URL("../src/content/", import.meta.url);

/**
 * The text of every `tooltip.show({ ... })` argument in a file, braces
 * balanced - the calls nest object literals, so a regex to the first `}`
 * would stop inside one.
 *
 * @param {string} source
 * @returns {string[]}
 */
function openings(source) {
  /** @type {string[]} */
  const found = [];
  const marker = "tooltip.show({";
  for (let at = source.indexOf(marker); at !== -1; at = source.indexOf(marker, at + 1)) {
    let depth = 0;
    for (let i = at + marker.length - 1; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") {
        depth--;
        if (depth === 0) {
          found.push(source.slice(at, i + 1));
          break;
        }
      }
    }
  }
  return found;
}

describe("where the bubble's actions start", () => {
  it("hands the setting to every opening that has a row to fold", async () => {
    const source = await readFile(new URL("reading.js", ROOT), "utf8");
    const calls = openings(source);
    assert.equal(calls.length, 3, "the reading side opens the bubble somewhere new");

    for (const call of calls) {
      // The trimmed bubble (D120) is the standing exception: with no gloss,
      // the speaker and the clipboard are the bubble's whole content, and a
      // row folded away would leave it empty.
      if (call.includes('variant: "quiet"')) continue;
      assert.match(
        call,
        /folded: hideActions/,
        "a bubble opens without asking the quiet-bubble setting",
      );
    }
  });

  it("leaves the decision to the caller, with no variant overruling it", async () => {
    const source = await readFile(new URL("tooltip.js", ROOT), "utf8");
    const toggle = /bubble\.classList\.toggle\("revealed",([^)]*)\)/.exec(source);
    assert.ok(toggle !== null, "the bubble stopped setting its own revealed class");
    // The regression this guards: a variant deciding here is a rule quietly
    // outvoting the reader's own.
    assert.doesNotMatch(String(toggle[1]), /variant/, "a variant decides the fold again");
    assert.match(String(toggle[1]), /folded/, "the caller's answer is no longer what decides");
  });
});
