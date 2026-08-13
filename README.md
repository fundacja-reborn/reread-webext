# re/read

A browser extension for reading in a language you are still learning. Select a word or a
phrase, see what it means, keep it. Every phrase you keep is underlined on every page you
open afterwards, and one click marks it learned and makes the underline go away.

All of it happens on your device, and it keeps working when the network does not:
translating, the dictionary and the reading list are local from end to end, and nothing
you read or select is ever sent anywhere.

Sister project of [offlinetranslate-koplugin](https://github.com/fundacja-reborn/offlinetranslate-koplugin),
which does the same thing for KOReader. The two exchange vocabulary through the same TSV
file, so what you collect on an e-reader underlines itself in your browser and back.

## Offline by design

Offline is not a degraded mode here - it is the mode.

- **Translation needs no connection.** The engine is inside the package and the model is
  on your disk, downloaded once. In airplane mode the bubble answers exactly as it does
  at home, because translating never involved a server in the first place.
- **The reading list is a shelf of copies, not a list of links.** Saving an article
  stores the article itself. It opens with no network, and it keeps opening when the
  original has moved or disappeared.
- **The vocabulary is a local database.** No account, no sync, no server that could shut
  down and take your collection with it.

The network serves this extension in exactly two ways, both on the settings page and
both at your press: downloading a translation model or a dictionary, and updating the
list of models. Both go only to the two addresses written into the package, and nowhere
else. How to verify all of this is a section of its own,
[below](#privacy-and-how-to-check-it).

## Status

**Early. This is a skeleton, not a tool yet.** What is in the repository today:

| Part | State |
|---|---|
| Extension loads in Firefox, bubble appears next to a selection | yes |
| Translation engine | Bergamot, inside the package - translates offline |
| Translation models | downloaded on request, or added by hand from files |
| Settings page | shows the language pair, downloads, adds and removes models |
| Keeping a phrase, correcting what it means, marking it learned | yes |
| Underlining saved phrases on the pages you read | yes |
| Dictionaries (StarDict) | downloaded from the WikDict catalogue or imported from files |
| Reader mode | turns the page into an article in the extension's own tab |
| Reading list (offline) | articles saved from the reader, listed and readable with no network at all |
| Saved phrases page | every kept phrase for a pair, filterable and paged, with Learned and Edit per row |
| Toolbar popup | per-site switch, language pair, reader, reading list, saved phrases, settings |
| UI languages | English, Polish, German, French, Spanish, Ukrainian - follows the browser's UI language, English otherwise |
| Firefox on Android | declared and built, reader-only by default; not yet tested on a phone |
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

This extension contacts exactly two places: Mozilla's bucket, for the list of models and
the models themselves, and WikDict, for the list of dictionaries and the dictionaries
themselves. Nothing is asked for without your press: downloads happen when you press them,
and each list refreshes only when you press its own update button - the settings page says
which day the list on screen is from, and an address read off a fresh list is refused
unless it sits under the same packaged source. Every host this extension is willing to
talk to is written down in the package before it ships. There is nothing else to send and nowhere to send it: the page
text, your selections and your vocabulary never leave the device.

That claim is checkable rather than promised - open the network panel in devtools and
read along, or read the source, which is deliberately shipped unminified. Or check it the
blunt way: turn the network off and keep reading. Translation, dictionary and reading
list carry on, because none of them ever used it.

Switching re/read off for a site writes that site's hostname to the browser's local extension
storage - one exact host per entry, written only on your own press of the switch, listed and
removable on the settings page.

Saving an article to the reading list stores its title, address and extracted text in the
browser's local extension storage, so it can be opened again with no network at all. That is a
heavier trace than a hostname, and the defence is the same: an entry exists only because you
pressed Save on that article, nothing is saved by itself, nothing leaves the device, and
deleting an entry deletes it - there is no archive and no trash to empty. What is stored is the
article as the reader rebuilt it, not the page itself, and it is filtered through the same
allowed list again every time it is opened.

### Permissions, and why each one is needed

| Permission | Why |
|---|---|
| `storage` | The vocabulary and the settings. Browser-local, per extension, never synced. |
| `unlimitedStorage` | Translation models are tens of megabytes and a dictionary can be more; the default quota is not enough to keep one. |
| `<all_urls>` | The whole point is that saved phrases are underlined on **every** page, not on a list of sites you approved one by one. This is a broad permission and it is honest to say so: it means the extension can read the pages you visit. It reads them to find your saved phrases in the text, in a content script on your machine, and sends nothing. |

There is nothing else. No `tabs`, no `webRequest`, no `cookies`, no `downloads`.

The toolbar button opens a small popup: a switch for the site you are on, the language pair,
this page in the reader, the reading list, the saved phrases, and the settings. None of it
needs the `tabs` permission. The popup
learns which site it is standing over by asking the page itself - without the permission a tab
has an id and no address, so the content script that is already there answers with its
hostname, and a page this extension does not run on gets a sentence instead of a switch.
Opening the reader or the saved-phrases page, coming back to the one tab each of them is
instead of opening a second, and focusing
its window are all allowed without the permission too; reading the address or the title of a
tab is what it is actually for, and nothing here does that. Remembering which tab each page is
in lasts until the browser closes, and it is a number per page. `Alt+Shift+R` opens the reader
without going through the popup.

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

### Where models come from, and what a download is held to

Models are Mozilla's - the same models Firefox's own page translation runs on -
[MPL-2.0](https://github.com/mozilla/translations), published in a Google Cloud Storage bucket.
The list of what can be downloaded is Mozilla's own index of released models, fetched when the
settings page opens from an address written into the package, and cached with its date; the
packaged snapshot [`src/lib/models/registry.json`](src/lib/models/registry.json) is the baseline
that makes day one work offline, and the way out on the day the index stops answering. An address
read off the index is refused unless it sits under the packaged bucket - the list can be fresh,
but where bytes come from is decided by the package.

A download is held to everything declared about it, and then asked to prove itself: sizes where
the index states them, Mozilla's published SHA-256 where one exists (they publish one for the
model file, of its contents after unpacking), and last a trial load - a fresh copy of the
translation engine is handed the files and must stand up with them before anything is stored.
What fails any of those steps is thrown away rather than kept.

The list carries every pair Mozilla has released - around a hundred. Where upstream releases two
builds of one pair, the memory variant wins: it is the build Mozilla makes for the same bergamot
core this extension runs, where the larger desktop variant is tuned for Firefox's native engine.
A model on this device remembers which published build it came from, so when the list starts
naming a different one, its row offers Update - one press replaces it.

[`tools/models-registry.mjs`](tools/models-registry.mjs) still writes the packaged snapshot: it
downloads every file of a pair, computes all three sums itself, and refuses an entry whose sums
disagree with the ones Mozilla publishes - the snapshot's downloads are checked against those
recorded sums to the byte.

Downloading needs no permission the extension does not already have, and adds nothing to the table
above. It happens on the settings page, while you watch it, and it can be cancelled.

### Dictionaries, and where to get them

A translation has to choose. *Bank* is a riverbank and a place that keeps money, and a model
picking one of them cannot tell you about the other; a dictionary lists both. So dictionaries are
a second thing this extension reads, next to the engine and not instead of it.

They are read in **StarDict** format - `.ifo`, `.idx`, `.dict` or `.dict.dz`, and `.syn` when the
dictionary has one. That is the format [KOReader](https://koreader.rocks/) uses, so a dictionary
already on your e-reader works here as it is, and the sister project reads the same files.

The settings page carries a catalogue of [WikDict](https://www.wikdict.com/)'s five-hundred-odd
pairs: one press downloads the archive from
<https://download.wikdict.com/dictionaries/stardict/>, unpacks it in the extension and stores
it. The addresses are written in the package
([`src/lib/dict/catalog.json`](src/lib/dict/catalog.json)) and the catalogue refreshes only
when you press its update button - the fresh list is read off the same packaged listing, and
every address is built here from that listing and the archive's name, never taken from the
page. The request happens only on your press, and files you add by hand keep working exactly
as before - that path stays as the way out on the day the host stops answering.

Honesty requires one distinction here: unlike models, dictionary downloads carry **no pinned
checksum**. WikDict rebuilds its files in place, so a sum recorded at release would break with
every rebuild. What stands in its place is that a dictionary is data, not code: the archive
must be a plain zip of StarDict files ([`src/lib/dict/zip.js`](src/lib/dict/zip.js) reads
nothing else and verifies the archive's own sizes and CRCs), it goes through the same
defensive parser as a hand-picked file, and what comes out is text in the browser's own
database. A dictionary is parsed once, when it is added - nothing reads a dictionary file
while you are reading a page.

What a dictionary says sits behind **More** in the bubble, and any line of it can be pressed:
that meaning joins what the phrase is kept under. Press it again to take it back out. This is
what dictionaries are for here - a model has to pick one of *bank* and *riverbank* with no way to
ask which you meant, and a word usually means both anyway. Whatever you leave on is what ends up
on the card.

For English and Polish, [WikDict](https://www.wikdict.com/page/download) (CC BY-SA, built from
Wiktionary through DBnary) is the one to start with: 66 609 entries, and another 51 721 spellings
in its `.syn` file, which is what lets `elevations` find `elevation`. The settings page
downloads it for you; the files also sit at
<https://download.wikdict.com/dictionaries/stardict/> for adding by hand.

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

### Firefox on Android

The same package declares Android support, with the same version floor. The popup lives
where Android puts every extension - the ⋮ menu, under **Extensions** - and opens over the
whole window rather than next to a button.

On a phone the extension starts in **reader-only mode**: an ordinary page is left alone,
and selecting text offers exactly one thing, opening the page in the reader - where
translation, keeping and underlining work as they do anywhere else. The reason is the
screen: a translation bubble over a selection and Android's own copy menu fight for the
same spot. The mode is a switch on the settings page - **Only in the reader** - and it is
the same switch on every platform; Android only differs in where it starts. Switching it
off gives a phone the full desktop behaviour, and the popup shows a status line whenever
the mode is on.

## Development

```bash
npm install          # once
npm run build        # dist/firefox
npm start            # build, then launch Firefox with the extension loaded
tools/check.sh       # the quality gate: vendored engine, typecheck, tests, build, addons-linter
npm run sign         # gate, then have AMO sign the package (needs credentials, see below)

node tools/models-registry.mjs --all                 # rewrite the model registry (needs the network)
node tools/wikdict-catalog.mjs                       # rewrite the dictionary catalogue (needs the network)
```

`tools/models-registry.mjs` is deliberately outside the gate: `--all` downloads a couple of
gigabytes to compute the checksums it writes (`--pairs=en-pl,pl-en` narrows it while working on
one pair). It is run by hand when Mozilla releases or retrains models, and its output is
committed. `tools/wikdict-catalog.mjs` fetches one directory listing and rewrites
`src/lib/dict/catalog.json` the same way.

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
