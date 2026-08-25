"use strict";
(() => {
  // src/lib/translator/providers/bergamot/config.js
  var DEFAULTS = Object.freeze({
    "beam-size": "1",
    normalize: "1.0",
    "word-penalty": "0",
    "cpu-threads": "0",
    "gemm-precision": "int8shiftAlphaAll",
    "skip-cost": "true"
  });
  var FIXED = Object.freeze({
    alignment: "soft",
    quiet: "true",
    "quiet-translation": "true",
    "max-length-break": "128",
    "mini-batch-words": "1024",
    workspace: "128",
    "max-length-factor": "2.0"
  });
  function modelConfigYaml(overrides = {}) {
    const config = { ...DEFAULTS };
    for (const [key, value] of Object.entries(overrides)) {
      if (typeof value === "object" || value === null || value === void 0) continue;
      config[key] = String(value);
    }
    if (config["gemm-precision"] === "int8") config["gemm-precision"] = "int8shiftAll";
    Object.assign(config, FIXED);
    return Object.entries(config).map(([key, value]) => `${key}: ${value}`).join("\n") + "\n";
  }

  // src/lib/translator/providers/bergamot/padding.js
  var COMPANIONS = /* @__PURE__ */ new Map([["en", "The old man wrote a short letter."]]);
  function companionFor(from, texts) {
    const companion = COMPANIONS.get(from);
    if (companion === void 0 || texts.length === 0) return null;
    if (!texts.some((text) => text.trim().length < companion.length)) return null;
    return companion;
  }

  // src/background/engine.worker.js
  var GEMM_FALLBACKS = Object.freeze({
    int8_prepare_a: "int8PrepareAFallback",
    int8_prepare_b: "int8PrepareBFallback",
    int8_prepare_b_from_transposed: "int8PrepareBFromTransposedFallback",
    int8_prepare_b_from_quantized_transposed: "int8PrepareBFromQuantizedTransposedFallback",
    int8_prepare_bias: "int8PrepareBiasFallback",
    int8_multiply_and_add_bias: "int8MultiplyAndAddBiasFallback",
    int8_select_columns_of_b: "int8SelectColumnsOfBFallback"
  });
  var ENGINE_GLUE = "../vendor/bergamot/bergamot-translator-worker.js";
  var ENGINE_BINARY = "../vendor/bergamot/bergamot-translator-worker.wasm";
  var starting = null;
  var service = null;
  var models = /* @__PURE__ */ new Map();
  function assetUrl(relative) {
    return new URL(relative, globalThis.location.href).href;
  }
  function gemmImports() {
    return Object.fromEntries(
      Object.entries(GEMM_FALLBACKS).map(([imported, exported]) => [
        imported,
        // Late-bound on purpose: `Module.asm` does not exist yet at the moment
        // these are handed to `WebAssembly.instantiate`.
        /** @param {number[]} args */
        (...args) => Module.asm[exported]?.(...args)
      ])
    );
  }
  async function startEngine() {
    const response = await fetch(assetUrl(ENGINE_BINARY));
    if (!response.ok) {
      throw new Error(`engine binary is missing from the package (HTTP ${response.status})`);
    }
    const binary = await response.arrayBuffer();
    return await new Promise((resolve, reject) => {
      const bootstrap = {
        instantiateWasm(imports, accept) {
          WebAssembly.instantiate(binary, { ...imports, wasm_gemm: gemmImports() }).then((result) => accept(result.instance)).catch(reject);
          return {};
        },
        onRuntimeInitialized() {
          resolve(Module);
        },
        print: (message) => console.log("[bergamot]", message),
        printErr: (message) => console.warn("[bergamot]", message)
      };
      globalThis.Module = /** @type {BergamotModule} */
      bootstrap;
      try {
        importScripts(assetUrl(ENGINE_GLUE));
      } catch (error) {
        reject(error);
      }
    });
  }
  function engine() {
    starting ??= startEngine();
    return starting;
  }
  function alignedCopy(module, buffer, alignment) {
    const bytes = new Int8Array(buffer);
    const memory = new module.AlignedMemory(bytes.byteLength, alignment);
    memory.getByteArrayView().set(bytes);
    return memory;
  }
  function keyOf({ from, to }) {
    return `${from}${to}`;
  }
  async function loadModel(pair, files) {
    const key = keyOf(pair);
    if (models.has(key)) return true;
    const module = await engine();
    const vocabs = new module.AlignedMemoryList();
    const unique = files.vocabs.filter((vocab, index) => files.vocabs.indexOf(vocab) === index);
    for (const vocab of unique) vocabs.push_back(alignedCopy(module, vocab, 64));
    models.set(
      key,
      new module.TranslationModel(
        modelConfigYaml(files.config ?? {}),
        alignedCopy(module, files.model, 256),
        alignedCopy(module, files.shortlist, 64),
        vocabs,
        null
      )
    );
    return true;
  }
  async function translate(pair, texts) {
    const key = keyOf(pair);
    const model = models.get(key);
    if (model === void 0) throw new Error(`no model loaded for ${key}`);
    const module = await engine();
    service ??= new module.BlockingService({ cacheSize: 0 });
    const companion = companionFor(pair.from, texts);
    const batch = companion === null ? texts : [...texts, companion];
    const input = new module.VectorString();
    const options = new module.VectorResponseOptions();
    for (const text of batch) {
      input.push_back(text);
      options.push_back({ alignment: false, html: false, qualityScores: false });
    }
    const responses = service.translate(model, input, options);
    const translated = texts.map((_, index) => responses.get(index).getTranslatedText());
    input.delete();
    options.delete();
    responses.delete();
    return translated;
  }
  async function unloadModel(pair) {
    const key = keyOf(pair);
    const model = models.get(key);
    if (model === void 0) return false;
    models.delete(key);
    model.delete();
    return true;
  }
  globalThis.addEventListener("message", (event) => {
    const message = (
      /** @type {MessageEvent} */
      event.data
    );
    if (typeof message !== "object" || message === null) return;
    const { id, name, args } = (
      /** @type {{ id?: unknown, name?: unknown, args?: unknown }} */
      message
    );
    if (typeof id !== "number" || typeof name !== "string" || !Array.isArray(args)) return;
    const call = async () => {
      switch (name) {
        case "load":
          return loadModel(args[0], args[1]);
        case "translate":
          return translate(args[0], args[1]);
        case "unload":
          return unloadModel(args[0]);
        case "loaded":
          return models.has(keyOf(args[0]));
        default:
          throw new Error(`unknown call: ${name}`);
      }
    };
    void call().then(
      (result) => globalThis.postMessage({ id, result }),
      // An Error does not survive a message port, and the thing the other side
      // needs is the sentence, not the class.
      (error) => globalThis.postMessage({ id, error: { message: String(error?.message ?? error) } })
    );
  });
})();
//# sourceMappingURL=engine.worker.js.map
