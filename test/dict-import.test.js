import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyDictionaryFiles,
  describeImportProblem,
  readDictionary,
} from "../src/lib/dict/import.js";
import { concat, cstring, gzip, ifo, index, syn, u32, utf8 } from "./stardict-fixture.js";

/** @type {import("../src/lib/dict/import.js").ImportProblem[]} */
const PROBLEMS = [
  "empty",
  "missing_ifo",
  "missing_idx",
  "missing_dict",
  "mixed",
  "not_stardict",
  "unpack",
  "no_entries",
];

const FILES = ["dict.ifo", "dict.idx", "dict.dict.dz", "dict.syn"];

describe("classifyDictionaryFiles", () => {
  it("sorts the four files of a dictionary out", () => {
    const classified = classifyDictionaryFiles(FILES);
    assert.equal(classified.ok, true);
    assert.deepEqual(classified.value, {
      base: "dict",
      ifo: "dict.ifo",
      idx: "dict.idx",
      dict: "dict.dict.dz",
      syn: "dict.syn",
    });
  });

  it("takes a dictionary without a synonym file", () => {
    const classified = classifyDictionaryFiles(["x.ifo", "x.idx", "x.dict"]);
    assert.equal(classified.ok, true);
    assert.equal(classified.value.syn, undefined);
  });

  it("sees through .gz and .dz", () => {
    const classified = classifyDictionaryFiles(["x.ifo.gz", "x.idx.gz", "x.dict.dz"]);
    assert.equal(classified.ok, true);
    assert.equal(classified.value.idx, "x.idx.gz");
  });

  it("ignores the other things a dictionary folder holds", () => {
    const classified = classifyDictionaryFiles([...FILES, "dict.idx.oft", "README", "res/logo.png"]);
    assert.equal(classified.ok, true);
    assert.equal(classified.value.base, "dict");
  });

  it("refuses two dictionaries at once, and says which", () => {
    const classified = classifyDictionaryFiles(["a.ifo", "a.idx", "a.dict", "b.ifo", "b.idx", "b.dict"]);
    assert.equal(classified.ok, false);
    assert.equal(classified.problem, "mixed");
    assert.equal(classified.detail, "a, b");
  });

  it("names the file that is missing", () => {
    /** @param {string[]} names */
    const problemOf = (names) => {
      const classified = classifyDictionaryFiles(names);
      return classified.ok ? null : classified.problem;
    };

    assert.equal(problemOf([]), "empty");
    assert.equal(problemOf(["x.txt"]), "missing_ifo");
    assert.equal(problemOf(["x.ifo"]), "missing_idx");
    assert.equal(problemOf(["x.ifo", "x.idx"]), "missing_dict");
  });
});

/**
 * A dictionary of three words, in the shape most real ones have: one meaning
 * per word, plain text, and a synonym file carrying an inflected form.
 *
 * @param {{ sametypesequence?: string }} [options]
 */
function dictionary({ sametypesequence = "m" } = {}) {
  const entries = [
    { word: "bank", data: utf8("brzeg") },
    { word: "go", data: utf8("iść") },
    { word: "watch", data: utf8("zegarek") },
  ];
  const built = index(sametypesequence === "" ? entries.map(withTypeByte) : entries);

  return {
    ifo: utf8(ifo({ version: "3.0.0", bookname: "Test Dictionary", wordcount: 3, sametypesequence })),
    idx: built.idx,
    dict: built.dict,
    syn: syn([{ word: "went", target: 1 }]),
  };
}

/**
 * @param {{ word: string, data: Uint8Array }} entry
 * @returns {{ word: string, data: Uint8Array }}
 */
function withTypeByte(entry) {
  return { word: entry.word, data: concat([utf8("m"), entry.data, [0]]) };
}

describe("readDictionary", () => {
  it("reads a dictionary end to end", async () => {
    const result = await readDictionary(dictionary());
    assert.equal(result.ok, true);
    assert.equal(result.value.name, "Test Dictionary");
    assert.deepEqual(result.value.entries, [
      { headword: "bank", senses: ["brzeg"] },
      { headword: "go", senses: ["iść"] },
      { headword: "watch", senses: ["zegarek"] },
    ]);
    assert.deepEqual(result.value.aliases, [{ headword: "went", target: 1 }]);
    assert.equal(result.value.skipped, 0);
  });

  it("reads one with a type byte on every field just the same", async () => {
    const result = await readDictionary(dictionary({ sametypesequence: "" }));
    assert.equal(result.ok, true);
    assert.equal(result.value.entries.length, 3);
  });

  it("unpacks whatever arrived compressed, whatever it is called", async () => {
    const files = dictionary();
    const result = await readDictionary({
      ifo: await gzip(files.ifo),
      idx: await gzip(files.idx),
      // A .dict.dz is a gzip file, so this is what one looks like from here.
      dict: await gzip(files.dict),
      syn: files.syn,
    });

    assert.equal(result.ok, true);
    assert.equal(result.value.entries.length, 3);
  });

  it("keeps a synonym pointing at the right word after a bad entry is dropped", async () => {
    const files = dictionary();
    // Break the first entry by sending it past the end of the body.
    const broken = concat([cstring("bank"), u32(9000), u32(5), files.idx.subarray(13)]);

    const result = await readDictionary({ ...files, idx: broken });
    assert.equal(result.ok, true);
    assert.equal(result.value.skipped, 1);
    assert.equal(result.value.entries[0]?.headword, "go");
    // `went` was the second word of the index and is the first of the list now.
    assert.deepEqual(result.value.aliases, [{ headword: "went", target: 0 }]);
  });

  it("takes the name from the file when the dictionary does not give one", async () => {
    const files = dictionary();
    const result = await readDictionary(
      { ...files, ifo: utf8(ifo({ version: "3.0.0", sametypesequence: "m" })) },
      { fallbackName: "wikdict-en-pl" },
    );

    assert.equal(result.ok, true);
    assert.equal(result.value.name, "wikdict-en-pl");
  });

  it("refuses something that is not a StarDict dictionary at all", async () => {
    const files = dictionary();
    const result = await readDictionary({ ...files, ifo: utf8("# just a text file\n") });
    assert.equal(result.ok, false);
    assert.equal(result.problem, "not_stardict");
  });

  it("refuses an index that points nowhere, rather than storing an empty dictionary", async () => {
    const files = dictionary();
    const result = await readDictionary({ ...files, dict: new Uint8Array(2) });
    assert.equal(result.ok, false);
    assert.equal(result.problem, "no_entries");
    assert.equal(result.detail, "3");
  });

  it("refuses an empty index without pretending it was a near miss", async () => {
    const files = dictionary();
    const result = await readDictionary({ ...files, idx: new Uint8Array() });
    assert.equal(result.ok, false);
    assert.equal(result.problem, "no_entries");
    assert.equal(result.detail, undefined);
  });

  it("reports on the way through a long index", async () => {
    /** @type {{ done: number, total: number }[]} */
    const seen = [];
    await readDictionary(dictionary(), { onProgress: (progress) => seen.push(progress) });
    assert.deepEqual(seen, [{ done: 3, total: 3 }]);
  });
});

describe("describeImportProblem", () => {
  it("has a different sentence for every problem", () => {
    const sentences = PROBLEMS.map((problem) => describeImportProblem(problem));
    assert.equal(new Set(sentences).size, PROBLEMS.length);
  });

  it("always says what happened to the data, because nothing did", () => {
    for (const problem of PROBLEMS) {
      assert.ok(describeImportProblem(problem).includes("Nothing was stored"), problem);
      assert.ok(describeImportProblem(problem, "detail").includes("Nothing was stored"), problem);
    }
  });

  it("says which dictionaries were mixed together", () => {
    assert.ok(describeImportProblem("mixed", "a, b").includes("a, b"));
  });
});
