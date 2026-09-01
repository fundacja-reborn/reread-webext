import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LIMITS, about, fieldText, senses } from "../src/lib/dict/text.js";

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

  it("takes WikDict's source annotations out of a pronunciation line", () => {
    // Straight from the wikdict-en-pl build (Michał's screenshot): the
    // references and qualifiers ride as entities, so the tag strip cannot
    // touch them and the decoding is what surfaced them in the bubble. The
    // slash the note leans on goes with it, so no `//` is left behind.
    assert.equal(
      fieldText({
        type: "h",
        text:
          '/<font color="gray">ʃuːld/&lt;ref:&lt;&lt;name:Dobson&gt;&gt;&gt;</font>/, ' +
          '/<font color="gray">ʃəd</font>/',
      }),
      "/ʃuːld/, /ʃəd/",
    );
    assert.equal(
      fieldText({
        type: "h",
        text:
          "/ˈdænəl/&lt;a:obsolete&gt;&lt;ref:{{R:en:Dobson:1957|II|334|986}} !!! " +
          "{{R:Hall PGSMS|2|3}}&gt;/",
      }),
      "/ˈdænəl/",
    );
    // A plain field may carry the notation as itself.
    assert.equal(fieldText({ type: "m", text: "/wʊd/<a:Early Modern,weak form>/" }), "/wʊd/");
  });

  it("never mistakes an honest angle bracket for an annotation", () => {
    assert.equal(fieldText({ type: "h", text: "a &lt; b, and &lt;i&gt; stays" }), "a < b, and <i> stays");
    assert.equal(fieldText({ type: "m", text: "compare a < b" }), "compare a < b");
  });

  it("decodes the marks a book sets its entries in", () => {
    // Reported from a real entry: `From even +&lrm; handed` reached the bubble
    // with the ampersand still in it, because the invisible marks were not on
    // the list. The bidi mark is kept rather than dropped - in an entry quoting
    // a right-to-left script it is what puts the punctuation in the right place.
    assert.equal(
      fieldText({ type: "h", text: "From even +&lrm; handed" }),
      `From even +${String.fromCodePoint(0x200e)} handed`,
    );
    assert.equal(
      fieldText({ type: "h", text: "sense &mdash; gloss, 1914&ndash;1918, o&rsquo;clock, 40&deg;" }),
      `sense ${String.fromCodePoint(0x2014)} gloss, 1914${String.fromCodePoint(0x2013)}1918, o’clock, 40°`,
    );
  });

  it("tells two entities apart that differ only in case", () => {
    // `&Prime;` is the double prime of a measurement, `&prime;` the single one;
    // lower-casing every name would answer the second for both.
    assert.equal(fieldText({ type: "h", text: "5&prime;7&Prime; &AMP; more" }), "5′7″ & more");
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

describe("about", () => {
  it("turns what a dictionary says about itself into something printable", () => {
    const ifo =
      'Publisher: Karl Bartel<br>Licensed under the <a href="https://creativecommons.org/licenses/by-sa/4.0/legalcode">Creative Commons Attribution-ShareAlike 4.0 International</a> license<br>Base data from <a href="https://www.wiktionary.org/">Wiktionary.org</a> via DBnary.';

    assert.equal(
      about(ifo),
      "Publisher: Karl Bartel\nLicensed under the Creative Commons Attribution-ShareAlike 4.0 International license\nBase data from Wiktionary.org via DBnary.",
    );
  });

  it("cuts a description that is an essay, on a word", () => {
    const essay = `Publisher: FreeDict<br>${"This dictionary comes to you through nice people. ".repeat(40)}`;
    const shown = about(essay);

    assert.ok(shown !== null);
    assert.ok(shown.length <= LIMITS.credit + 3);
    assert.ok(shown.startsWith("Publisher: FreeDict\n"));
    assert.ok(shown.endsWith("..."));
  });

  it("answers null when there is nothing to say, or nothing left after the tags", () => {
    assert.equal(about(null), null);
    assert.equal(about(""), null);
    assert.equal(about("<br><br>"), null);
  });

  it("takes its own limit, because a name is not a paragraph", () => {
    assert.equal(about("Nowy <b>Slownik</b>", LIMITS.name), "Nowy Slownik");
  });
});
