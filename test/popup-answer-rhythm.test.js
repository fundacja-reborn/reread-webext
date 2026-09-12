import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The rhythm of the look-up answer in the popup (D204): rows that only read
// give up the shelf's touch floor, the books' names keep theirs.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** @param {string} path */
const sheet = (path) => readFileSync(join(ROOT, path), "utf8");

/**
 * @param {string} css
 * @param {string} selector
 * @returns {string}
 */
function rule(css, selector) {
  const at = css.indexOf(`${selector} {`);
  assert.ok(at >= 0, `no rule for ${selector}`);
  return css.slice(at, css.indexOf("}", at));
}

describe("the popup's look-up answer", () => {
  it("keeps 32px rows and 44px names, from the shelf's own tokens", () => {
    const answer = rule(sheet("src/popup/popup.css"), ".popup-lookup-answer .lookup-answer");
    assert.match(answer, /--lookup-touch: 32px/);
    assert.match(answer, /--lookup-row-gap: 0\.3rem/);
    assert.match(answer, /--lookup-label-touch: 44px/);
  });

  it("has a name floor of its own on the pages' shelf, falling back to the rows'", () => {
    const shelf = rule(sheet("src/assets/page.css"), ".lookup-answer");
    assert.match(shelf, /--lookup-label-pad-top: max\(var\(--lookup-row-pad\), calc\(var\(--lookup-label-touch, var\(--lookup-touch\)\) - var\(--lookup-label-line\) - var\(--lookup-row-pad\)\)\)/);
    // The rows' pad still comes from the rows' floor alone.
    assert.match(shelf, /--lookup-row-pad: max\(var\(--lookup-row-gap\), calc\(\(var\(--lookup-touch\) - var\(--lookup-line-height, 1\.6em\)\) \/ 2\)\)/);
  });
});
