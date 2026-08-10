# re/read

A browser extension for reading in a language you are still learning. Select a word or a
phrase, see what it means, keep it. Every phrase you keep is underlined on every page you
open afterwards, and one click marks it learned and makes the underline go away.

All of it happens on your device. The translation engine runs locally, the vocabulary
lives in the browser's own storage, and nothing you read or select is ever sent anywhere.

Sister project of [offlinetranslate-koplugin](https://github.com/fundacja-reborn/offlinetranslate-koplugin),
which does the same thing for KOReader. The two exchange vocabulary through the same TSV
file, so what you collect on an e-reader underlines itself in your browser and back.

## Status

**Early. This is a skeleton, not a tool yet.** What is in the repository today:

| Part | State |
|---|---|
| Extension loads in Firefox, bubble appears next to a selection | yes |
| Translation engine | Bergamot, inside the package |
| Translation models | downloaded on request, or added by hand from files |
| Settings page | shows the language pair, downloads, adds and removes models |
| Vocabulary database, highlighting saved phrases | not started |
| Reader mode | not started |
| Import / export (TSV) | not started |
| Chromium | builds, untested |

If you are looking for something to use rather than something to read, come back later.

## What it deliberately does not do

- **No accounts, no sync, no telemetry, no analytics.** There is no server to have an
  account on.
- **No spaced repetition, no flashcards, no quizzes.** Export to TSV and use Anki, which
  is better at it than anything that could be added here.
- **No inflection handling.** Matching is literal: saving `read` does not underline
  `reading`. A known limit, accepted on purpose.
- **No remote code.** Everything that runs is in the package you installed, which
  Manifest V3 enforces anyway.

## Privacy, and how to check it

The only network request this extension will ever make is downloading a translation model
for a language pair, once, when you ask for it. There is nothing else to send and nowhere
to send it: the page text, your selections and your vocabulary never leave the device.

That claim is checkable rather than promised - open the network panel in devtools and
read along, or read the source, which is deliberately shipped unminified.

### Permissions, and why each one is needed

| Permission | Why |
|---|---|
| `storage` | The vocabulary and the settings. Browser-local, per extension, never synced. |
| `unlimitedStorage` | Translation models are tens of megabytes; the default quota is not enough to keep one. |
| `<all_urls>` | The whole point is that saved phrases are underlined on **every** page, not on a list of sites you approved one by one. This is a broad permission and it is honest to say so: it means the extension can read the pages you visit. It reads them to find your saved phrases in the text, in a content script on your machine, and sends nothing. |

There is nothing else. No `tabs`, no `webRequest`, no `cookies`, no `downloads`.

## What is in the package that is not ours

One thing: the translation engine, [Bergamot](https://github.com/browsermt/bergamot-translator)
- Marian NMT compiled to WebAssembly, MPL-2.0. It is 5 MB of compiled C++ plus 80 KB of
generated glue, it is committed to this repository rather than installed, and it is the only
part of this package nobody reads line by line.

Manifest V3 forbids remotely hosted code and WebAssembly counts, so the engine has to be inside
the package - which is also why the manifest asks for `'wasm-unsafe-eval'` in its own content
security policy. Nothing else is relaxed.

What can be checked instead of read is in [`vendor/bergamot/README.md`](vendor/bergamot/README.md):
which published artifact it is, its SHA-256, and why that version. `tools/check-vendor.sh`
verifies those sums on every run of the quality gate.

Translation models are not in the package. They are data, they are downloaded or added by hand,
and they are stored locally in the browser's own database.

### Where models come from, and why you do not have to trust the host

Models are Mozilla's, [MPL-2.0](https://github.com/mozilla/translations), published in a Google
Cloud Storage bucket. What is in this package is a list: which pairs can be downloaded, the exact
address of each file, how big it is, and its SHA-256 - [`src/lib/models/registry.json`](src/lib/models/registry.json).
A downloaded file is checked against that sum before it is stored, so a host that served something
else would be serving it to a checksum that throws it away. Where the address moves, the repair is
that one file.

The sums are computed here rather than copied: Mozilla publishes one, for one file out of three,
and of its contents after unpacking - which is why this cannot be Subresource Integrity.
[`tools/models-registry.mjs`](tools/models-registry.mjs) is what downloads a pair and writes the
entry, and it refuses to do so if its own sum disagrees with the one Mozilla does publish.

Downloading needs no permission the extension does not already have, and adds nothing to the table
above. It happens on the settings page, while you watch it, and it can be cancelled.

## Requirements

Firefox 142 or newer. Two things set that floor: the CSS Custom Highlight API, which is
how phrases get underlined without touching the page's DOM, and the manifest key this
extension uses to declare that it collects no data at all.

## Development

```bash
npm install          # once
npm run build        # dist/firefox
npm start            # build, then launch Firefox with the extension loaded
tools/check.sh       # the quality gate: vendored engine, typecheck, tests, build, addons-linter

node tools/models-registry.mjs --pairs=en-pl,pl-en   # rewrite the model registry (needs the network)
```

`tools/models-registry.mjs` is deliberately outside the gate: it downloads tens of megabytes to
compute the checksums it writes. It is run by hand when a pair is added or a model is retrained,
and its output is committed.

`tools/check.sh` is exactly what CI runs. There is no step in one that is missing from
the other.

The extension is plain JavaScript with JSDoc types, checked by TypeScript in `--noEmit`
mode. esbuild bundles it - not to make it smaller, but because content scripts cannot be
ES modules - and the output is deliberately not minified.

```
src/
  background/    the only context that translates and owns the database
                 (index.js routes messages, engine.worker.js runs the engine)
  content/       what runs on every page: selection, bubble, highlighting
  reader/        the extension's own reader mode
  options/       settings
  lib/
    translator/  engine facade and its providers
    models/      translation models: which ones exist, how they are fetched
                 and checked, and where they are kept
    matcher/     tokenisation and phrase matching
    store/       IndexedDB, import and export
vendor/
  bergamot/      the engine, committed rather than installed
```

## Licence

[AGPL-3.0-or-later](LICENSE), the same as the KOReader plugin it exchanges files with.

Made by [Fundacja Reborn](https://github.com/fundacja-reborn).
