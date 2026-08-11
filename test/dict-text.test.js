import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LIMITS, fieldText, senses } from "../src/lib/dict/text.js";

describe("fieldText", () => {
  it("passes plain text through, tidied", () => {
    assert.equal(fieldText({ type: "m", text: "  brzeg   rzeki \n\n  bank  " }), "brzeg rzeki\nbank");
  });

  it("takes the tags off HTML and keeps the line breaks they stood for", () => {
    const html = "<b>bank</b><br>1. brzeg<br />2. instytucja<p>3. ława</p>";
    assert.equal(fieldText({ type: "h", text: html }), "bank\n1. brzeg\n2. instytucja\n3. ława");
  });

  it("decodes the entities markup arrives with", () => {
    assert.equal(fieldText({ type: "h", text: "R&amp;D &lt;i&gt; &#65; &#x42; &nbsp;end" }), "R&D <i> A B end");
  });

  it("leaves an unknown entity alone rather than eating it", () => {
    assert.equal(fieldText({ type: "h", text: "&zzz; &#x110000;" }), "&zzz; &#x110000;");
  });

  it("drops the headword XDXF repeats in front of every entry", () => {
    assert.equal(fieldText({ type: "x", text: "<k>bank</k><def>brzeg</def>" }), "brzeg");
  });

  it("strips Pango markup", () => {
    assert.equal(fieldText({ type: "g", text: '<span foreground="blue">brzeg</span>' }), "brzeg");
  });

  it("has nothing to show for a sound, a picture or a file list", () => {
    for (const type of ["W", "P", "X", "r"]) {
      assert.equal(fieldText({ type, text: "whatever" }), "");
    }
  });
});

describe("senses", () => {
  it("makes one meaning of each field", () => {
    const found = senses([
      { type: "m", text: "brzeg" },
      { type: "m", text: "instytucja" },
    ]);
    assert.deepEqual(found, ["brzeg", "instytucja"]);
  });

  it("keeps a transcription on the line of the meaning it belongs to", () => {
    const found = senses([
      { type: "t", text: "/wɒtʃ/" },
      { type: "m", text: "zegarek" },
    ]);
    assert.deepEqual(found, ["/wɒtʃ/ zegarek"]);
  });

  it("shows a transcription that has nothing after it rather than losing it", () => {
    assert.deepEqual(senses([{ type: "t", text: "/wɒtʃ/" }]), ["/wɒtʃ/"]);
  });

  it("drops fields that reduce to nothing", () => {
    assert.deepEqual(senses([{ type: "h", text: "<br><br>" }, { type: "m", text: "brzeg" }]), ["brzeg"]);
  });

  it("cuts a meaning that is an article, and says it was cut", () => {
    const long = `${"słowo ".repeat(400)}koniec`;
    const [only] = senses([{ type: "m", text: long }]);
    assert.ok(only !== undefined);
    assert.ok(only.length <= LIMITS.senseLength + 3);
    assert.ok(only.endsWith("..."));
    // Cut on a word boundary, not in the middle of one.
    assert.ok(!only.includes("słow..."));
  });

  it("keeps a meaning that is exactly at the limit whole", () => {
    const exact = "a".repeat(LIMITS.senseLength);
    assert.deepEqual(senses([{ type: "m", text: exact }]), [exact]);
  });

  it("stops at the tenth meaning", () => {
    const many = Array.from({ length: 30 }, (_, at) => ({ type: "m", text: `znaczenie ${at}` }));
    assert.equal(senses(many).length, LIMITS.senses);
  });

  it("has nothing to say about an entry of only pictures", () => {
    assert.deepEqual(senses([{ type: "P", text: "binary" }]), []);
  });
});
