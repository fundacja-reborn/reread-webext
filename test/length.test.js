import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  WORDS_PER_MINUTE,
  asWordCount,
  countWords,
  readingTime,
  wordsIn,
} from "../src/lib/reader/length.js";

describe("countWords", () => {
  it("counts runs of letters and digits, as the matcher tokenizes", () => {
    assert.equal(countWords("Hello, world!"), 2);
    assert.equal(countWords("  spaced   out  "), 2);
    assert.equal(countWords("In 2024 there were 3 of them."), 7);
    assert.equal(countWords(""), 0);
    assert.equal(countWords(" \n\t "), 0);
    assert.equal(countWords("... - ?!"), 0);
  });

  it("splits where the tokenizer splits: apostrophes and hyphens", () => {
    assert.equal(countWords("don't"), 2);
    assert.equal(countWords("e-mail"), 2);
  });

  it("keeps a combining mark inside its word", () => {
    assert.equal(countWords("żołty"), 1);
  });

  it("counts Chinese and Japanese by the character, Korean by the run", () => {
    assert.equal(countWords("我爱北京天安门"), 7);
    assert.equal(countWords("東京に行きます。"), 7);
    assert.equal(countWords("안녕하세요 세계"), 2);
  });

  it("counts what stands glued to counted characters as one word more", () => {
    assert.equal(countWords("2024年"), 2);
    assert.equal(countWords("東京Tower"), 3);
  });
});

describe("wordsIn", () => {
  it("counts the text of our own markup, a block boundary ending a word", () => {
    assert.equal(wordsIn("<p>one</p><p>two</p>"), 2);
    assert.equal(wordsIn("<ul><li>a</li><li>b</li></ul>"), 2);
    assert.equal(wordsIn("one<br>two"), 2);
    assert.equal(wordsIn("<h1>Title</h1><p>Two words.</p><ul><li>three</li></ul>"), 4);
    assert.equal(wordsIn("<pre>a\nb</pre>"), 2);
  });

  it("lets an inline element stand inside a word", () => {
    assert.equal(wordsIn("<p>un<em>believ</em>able</p>"), 1);
    assert.equal(wordsIn('<p>see <a href="https://example.org/">this</a>.</p>'), 2);
    assert.equal(wordsIn("<P>Upper<SPAN>case</SPAN></P>"), 1);
  });

  it("reads character references as their characters, never as words", () => {
    assert.equal(wordsIn("<p>one&nbsp;two</p>"), 2);
    assert.equal(wordsIn("<p>&nbsp;</p>"), 0);
    assert.equal(wordsIn("<p>R&amp;D</p>"), 2);
    assert.equal(wordsIn("<p>&lt;p&gt;</p>"), 1);
    assert.equal(wordsIn("<p>&#233;t&#xE9;</p>"), 1);
    assert.equal(wordsIn("<p>caf&eacute;</p>"), 1);
    assert.equal(wordsIn("<p>&#xD800;</p>"), 0);
  });

  it("takes a tag whole, its quoted attributes included", () => {
    assert.equal(wordsIn('<p><a href="x>y" title=\'a > b\'>link</a></p>'), 1);
    assert.equal(wordsIn('<figure><img alt="two words"></figure>'), 0);
    assert.equal(wordsIn("<p>x<br/>y</p>"), 2);
  });

  it("counts nothing inside a comment", () => {
    assert.equal(wordsIn("<!-- three hidden words --><p>one</p>"), 1);
  });
});

describe("readingTime", () => {
  it("is never under a minute", () => {
    assert.deepEqual(readingTime(0), { hours: 0, minutes: 1 });
    assert.deepEqual(readingTime(50), { hours: 0, minutes: 1 });
    assert.deepEqual(readingTime(WORDS_PER_MINUTE), { hours: 0, minutes: 1 });
  });

  it("rounds to whole minutes under an hour", () => {
    assert.deepEqual(readingTime(300), { hours: 0, minutes: 2 });
    assert.deepEqual(readingTime(2400), { hours: 0, minutes: 12 });
    assert.deepEqual(readingTime(11800), { hours: 0, minutes: 59 });
  });

  it("says hours and minutes to the nearest five above an hour", () => {
    assert.deepEqual(readingTime(12000), { hours: 1, minutes: 0 });
    assert.deepEqual(readingTime(12400), { hours: 1, minutes: 0 });
    assert.deepEqual(readingTime(12600), { hours: 1, minutes: 5 });
    assert.deepEqual(readingTime(100000), { hours: 8, minutes: 20 });
  });

  it("carries fifty-eight minutes over into the next hour", () => {
    assert.deepEqual(readingTime(23600), { hours: 2, minutes: 0 });
  });

  it("is made at two hundred words a minute - a change here changes every row", () => {
    assert.equal(WORDS_PER_MINUTE, 200);
  });
});

describe("asWordCount", () => {
  it("keeps a whole count, zero included, and nothing else", () => {
    assert.equal(asWordCount(0), 0);
    assert.equal(asWordCount(1234), 1234);
    assert.equal(asWordCount(-1), null);
    assert.equal(asWordCount(1.5), null);
    assert.equal(asWordCount("12"), null);
    assert.equal(asWordCount(undefined), null);
    assert.equal(asWordCount(Number.NaN), null);
    assert.equal(asWordCount(Number.POSITIVE_INFINITY), null);
  });
});
