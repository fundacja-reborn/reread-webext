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
| Keeping a phrase, correcting what it means, marking it learned | yes |
| Underlining saved phrases on the pages you read | yes |
| Dictionaries (StarDict) | imported from files and managed on the settings page |
| Reader mode | turns the page into an article in the extension's own tab |
| Toolbar popup | per-site switch, language pair, reader, settings |
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
- **Nothing inside embedded frames.** The content script runs in the page you opened and
  not in the advertisements, players and widgets embedded in it. Underlines stop at that
  boundary, and so does everything else this extension does.
- **No remote code.** Everything that runs is in the package you installed, which
  Manifest V3 enforces anyway.

## Privacy, and how to check it

The only network request this extension will ever make is downloading a translation model
for a language pair, once, when you ask for it. There is nothing else to send and nowhere
to send it: the page text, your selections and your vocabulary never leave the device.

That claim is checkable rather than promised - open the network panel in devtools and
read along, or read the source, which is deliberately shipped unminified.

Switching re/read off for a site writes that site's hostname to the browser's local extension
storage - one exact host per entry, written only on your own press of the switch, listed and
removable on the settings page.

### Permissions, and why each one is needed

| Permission | Why |
|---|---|
| `storage` | The vocabulary and the settings. Browser-local, per extension, never synced. |
| `unlimitedStorage` | Translation models are tens of megabytes and a dictionary can be more; the default quota is not enough to keep one. |
| `<all_urls>` | The whole point is that saved phrases are underlined on **every** page, not on a list of sites you approved one by one. This is a broad permission and it is honest to say so: it means the extension can read the pages you visit. It reads them to find your saved phrases in the text, in a content script on your machine, and sends nothing. |

There is nothing else. No `tabs`, no `webRequest`, no `cookies`, no `downloads`.

The toolbar button opens a small popup: a switch for the site you are on, the language pair,
this page in the reader, and the settings. None of it needs the `tabs` permission. The popup
learns which site it is standing over by asking the page itself - without the permission a tab
has an id and no address, so the content script that is already there answers with its
hostname, and a page this extension does not run on gets a sentence instead of a switch.
Opening the reader, coming back to the one reader tab instead of opening a second, and focusing
its window are all allowed without the permission too; reading the address or the title of a
tab is what it is actually for, and nothing here does that. Remembering which tab the reader is
in lasts until the browser closes, and it is a number. `Alt+Shift+R` opens the reader without
going through the popup.

## What is in the package that is not ours

Two things, both committed to this repository rather than installed, and both with the licence
and the provenance next to them.

**The translation engine, [Bergamot](https://github.com/browsermt/bergamot-translator)** - Marian
NMT compiled to WebAssembly, MPL-2.0. 5 MB of compiled C++ plus 80 KB of generated glue, and the
only part of this package nobody reads line by line.

Manifest V3 forbids remotely hosted code and WebAssembly counts, so the engine has to be inside
the package - which is also why the manifest asks for `'wasm-unsafe-eval'` in its own content
security policy. Nothing else is relaxed.

What can be checked instead of read is in [`vendor/bergamot/README.md`](vendor/bergamot/README.md):
which published artifact it is, its SHA-256, and why that version.

**The article extractor, [Readability](https://github.com/mozilla/readability)** - the library
behind Firefox's own reader view, Apache-2.0, 88 KB of plain JavaScript. It turns a page into an
article for the reader, and unlike the engine it is code you can read.

It runs on the reader page, on an inert copy of the page parsed by `DOMParser` - never on the
page you are reading and never in the background. What it produces is HTML built from somebody
else's page, so it is treated as such: the reader rebuilds it into its own document from a list
of allowed elements and attributes, and never assigns it as `innerHTML`. Details and the sums:
[`vendor/readability/README.md`](vendor/readability/README.md), including the fact that the npm
tarball and the GitHub tag agree byte for byte on the vendored file.

`tools/check-vendor.sh` verifies every one of those sums on every run of the quality gate, and
refuses a file that appeared in a vendored directory without being pinned.

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

The list carries every pair Mozilla has released - around a hundred. Where upstream releases two
builds of one pair, the registry takes the memory variant: it is the build Mozilla makes for the
same bergamot core this extension runs, where the larger desktop variant is tuned for Firefox's
native engine.

Downloading needs no permission the extension does not already have, and adds nothing to the table
above. It happens on the settings page, while you watch it, and it can be cancelled.

### Dictionaries, and where to get them

A translation has to choose. *Bank* is a riverbank and a place that keeps money, and a model
picking one of them cannot tell you about the other; a dictionary lists both. So dictionaries are
a second thing this extension reads, next to the engine and not instead of it.

They are read in **StarDict** format - `.ifo`, `.idx`, `.dict` or `.dict.dz`, and `.syn` when the
dictionary has one. That is the format [KOReader](https://koreader.rocks/) uses, so a dictionary
already on your e-reader works here as it is, and the sister project reads the same files.

**Nothing is downloaded, ever.** There is no list of dictionary addresses in this package and no
request is made for one: you unpack the archive yourself and pick the files on the settings page.
A dictionary is parsed once, when it is added, and stored as text in the browser's own database -
nothing reads a dictionary file while you are reading a page.

What a dictionary says sits behind **More** in the bubble, and any line of it can be pressed:
that meaning joins what the phrase is kept under. Press it again to take it back out. This is
what dictionaries are for here - a model has to pick one of *bank* and *riverbank* with no way to
ask which you meant, and a word usually means both anyway. Whatever you leave on is what ends up
on the card.

For English and Polish, [WikDict](https://www.wikdict.com/page/download) (CC BY-SA, built from
Wiktionary through DBnary) is the one to start with: 66 609 entries, and another 51 721 spellings
in its `.syn` file, which is what lets `elevations` find `elevation`. Its StarDict builds for
every pair sit at <https://download.wikdict.com/dictionaries/stardict/> - the same address the
settings page points at.

[FreeDict](https://freedict.org/downloads/) publishes an `eng-pol` dictionary (GPL) too, and its
**StarDict build is worth checking before you rely on it**: in release 0.2.1, 13 894 of its 15 817
entries carry nothing but a phonetic transcription and a part of speech - the Polish is missing
from the file itself, left as empty list items where the translations should be. Measured here on
2026-08-11; other FreeDict pairs may well be fine.

A dictionary that shows a pronunciation and a word class and no meaning is not being cut off by
this extension - it is being shown in full. Nothing here drops part of an entry.

Whatever a dictionary says about its author and origin is kept with it and shown on the settings
page, which is what CC BY-SA asks for and what makes it possible to tell two of them apart.

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
npm run sign         # gate, then have AMO sign the package (needs credentials, see below)

node tools/models-registry.mjs --all                 # rewrite the model registry (needs the network)
```

`tools/models-registry.mjs` is deliberately outside the gate: `--all` downloads a couple of
gigabytes to compute the checksums it writes (`--pairs=en-pl,pl-en` narrows it while working on
one pair). It is run by hand when Mozilla releases or retrains models, and its output is
committed.

`tools/check.sh` is exactly what CI runs. There is no step in one that is missing from
the other.

### Installing a build that survives a restart

Firefox only installs a signed package for good; anything loaded through `about:debugging`
or `web-ext run` is gone by the next restart, and the vocabulary database goes with it.
`npm run sign` runs the gate and then uploads `dist/firefox` to AMO, which validates it,
signs it and hands it straight back into `web-ext-artifacts/`.

That channel is **unlisted**, which is a different thing from published: nothing appears
in the add-on directory, no human review starts, and nobody else can find or install the
result. It is the same package, with a signature that makes Firefox accept it.

Signing needs an [AMO API key](https://addons.mozilla.org/developers/addon/api/key/). Copy
`.env.example` to `.env`, which is gitignored, and fill in the two values:

```bash
cp .env.example .env
```

```
WEB_EXT_API_KEY=user:12345678:123
WEB_EXT_API_SECRET=...
```

AMO keeps every version number it has seen and refuses anything that is not higher than
the last, so each signed build raises `version` in both `src/manifest.json` and
`package.json`. Builds are numbered `0.<milestone>.<build>`.

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
    dict/        StarDict dictionaries: reading the files, and where they are kept
    store/       IndexedDB, import and export
vendor/
  bergamot/      the engine, committed rather than installed
```

## Licence

[AGPL-3.0-or-later](LICENSE), the same as the KOReader plugin it exchanges files with.

Made by [Fundacja Reborn](https://github.com/fundacja-reborn).
