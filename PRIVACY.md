# Privacy policy for re/read

Last updated: 29 August 2026. This document is kept in the extension's repository, so
every change to it is a commit anyone can read: [`PRIVACY.md`](https://github.com/fundacja-reborn/reread-webext/blob/main/PRIVACY.md).

## The short version

re/read collects nothing. There is no account, no server, no telemetry, no analytics,
no advertising and no profiling. Nothing you read, select, save or search for leaves
your device.

The extension does not use any online service. There is no server it connects to, and the
publisher receives no data from it of any kind - not even a count of installations
beyond what the add-on stores themselves report to us.

## What re/read stores, and where

Everything the extension keeps is stored in your browser's local extension storage on
your device: four IndexedDB databases (`reread-vocab`, `reread-articles`, `reread-dicts`,
`reread-models`) and the extension's `storage.local`, which holds the settings and the
safety copies of the vocabulary, the highlights and the reading list. None of it is synced
to any account, and none of it can be read by the pages you visit; you can look at all of
it in the browser's developer tools, under the extension's own origin.

| What | Why it is stored |
|---|---|
| Saved phrases with their meanings | To underline them on later pages and show your meaning again |
| Translation models you downloaded | So translation works offline |
| Dictionaries you installed | So dictionary lookups work offline |
| Articles and books you saved to the reading list | So they open with no network, and after the original page has changed or gone |
| Highlights, notes and reading positions | To open a document again the way you left it |
| Settings, including the list of sites you switched re/read off on | To keep your choices between sessions |

Uninstalling the extension deletes all of it, because the browser deletes an
extension's storage together with the extension. You can also remove any part of it
from inside the extension itself: individual phrases (**Learned**), individual
articles and books (**Delete**), models and dictionaries (their sections in
Settings), and the per-site off switches (Settings, **Switched-off sites**). Deleting an
article or a book removes everything stored for it - text, pictures, highlights, notes and
the reading position - from the database and from the safety copy in `storage.local`.

You can export your data at any time to files on your disk: vocabulary as TSV, the
reading list as JSON (or as a `.zip` with its pictures), highlights as Markdown. The
browser saves those files the way it saves any download; they are not uploaded anywhere.

## What leaves your device

Requests go to exactly two servers, both with addresses built into the extension, and
only after you click a button on the Settings page:

- **`storage.googleapis.com`** - the storage where Mozilla publishes its translation
  models: the list of models and the model files themselves.
- **`download.wikdict.com`** - the [WikDict](https://www.wikdict.com/) catalogue: the
  list of available dictionaries and the dictionary files themselves.

These are ordinary file downloads. Like any download, they let the server that sends the
file see your IP address and your browser's user agent; re/read adds no identifier,
no cookie and no query of its own, and sends nothing about you, your vocabulary or
the pages you read. Opening the Settings page makes no request at all - the lists
shown there come from a copy included in the extension until you press **Update the list**,
and each list shows the date it was last fetched.

One more request happens only when you ask for it, and it is the only one to an address
that is not built into the extension: **Download pictures**, a row in the reader's menu
over a saved article, downloads that article's pictures from the site the article came
from - once, without cookies or referrer, and only when you press it. That site sees what
it saw when the page first showed you the pictures: your IP address and your browser's
user agent, nothing more. The extension never downloads a picture on its own; a saved
article contains only text until you press that row. Once the pictures are downloaded,
the same menu row changes to **Remove pictures**, which deletes them again.

There is no third server of the extension's own. No fonts, scripts or images are loaded
from outside the extension, there is no crash reporting, no A/B testing and no update
check of the extension's own (updates are handled by the browser and the add-on store you
installed from, under their policies).

You do not have to take our word for it: watch the network panel in the browser's
developer tools, read the source code (the extension is published unminified, exactly as it
is in the repository), or simply turn the network off - translation, dictionaries, the
reading list and everything else keep working.

## Reading aloud

Reading aloud uses the browser's own speech synthesis (the standard Web Speech API). The
extension passes the text to the browser and nothing else; it makes no network request
for speech.

Some browsers add online voices to that engine - Chrome's "Google ..." voices, Edge's
"... Online" voices - which send the text to the browser maker's server to be spoken.
The browser marks them as online voices, and re/read does not use them: they never appear
in a voice list and never speak. When the device has no offline voice for a language,
re/read does not read that language aloud and shows a message, instead of letting the
browser pick an online voice.

One thing remains outside the extension's control: a voice that the operating system
provides and the browser reports as offline can still be generated by the system over the
network, if the system is set up that way. That is a matter of your operating system and its
privacy policy, not of re/read, and it applies to every application that speaks on that
system.

## Page content

The part of the extension that runs on web pages reads the text of the pages you visit,
in order to find your saved phrases in it and underline them. This happens entirely in your browser's memory, on
your device. The text is not stored, not sent and not indexed; nothing is written
anywhere except when you yourself save a phrase or save the article to the reading
list.

A page you have switched re/read off on (the toolbar popup, or the list in Settings)
is not read at all.

## Permissions

| Permission | Why it is needed |
|---|---|
| `storage` | Your vocabulary and settings, in the browser's local extension storage. Never synced. |
| `unlimitedStorage` | Translation models are tens of megabytes and dictionaries can be larger; the browser's default quota is not enough for them. |
| `<all_urls>` (access to all websites) | Saved phrases are underlined on every page where they appear, so the content script has to be able to run everywhere. This is a broad permission: it means the extension can read the pages you visit. It reads them locally to find your saved phrases, and sends nothing. There is no narrower permission for "every page you might read". |
| `offscreen` (Chrome/Chromium package only) | Chromium runs the extension's background part as a service worker, which cannot start the worker thread the translation engine runs in. A single hidden document (offscreen document) runs that worker instead. It grants no access to any page or to any data. |

There is deliberately nothing else: no `tabs`, no `webRequest`, no `cookies`, no
`downloads`, no `history`, no `bookmarks`.

## Data sharing

re/read does not collect user data, so there is nothing to share. No data is sold,
rented, transferred to third parties, used for advertising, used to build profiles,
or used for creditworthiness or lending purposes. No data is used for any purpose
unrelated to the extension's single purpose, which is translating and saving phrases
while you read and keeping a local reading list.

## Children

The extension collects no data from anyone, of any age.

## Changes to this policy

If it changes, the change is a commit in the public repository, with the date at the
top of this file updated. The version of the policy that applies to you is the one
published here.

## Who is behind re/read

re/read is made by **Fundacja Reborn**, a non-profit foundation registered in Poland
(KRS 0000708416, NIP PL7343554397), ul. Lwowska 35/5, 33-300 Nowy Sącz. In the
language of the GDPR the foundation would be the data controller - but in this case there
is no data to control, because the extension sends it nothing and it operates no service
the extension connects to.

The foundation's [general privacy policy](https://reapps.eu/privacy/) covers re/notes
and re/task, which do have accounts and a server. re/read has neither, and this
document is its policy.

## Contact

Questions, or something here that does not match what the code does:
[open an issue](https://github.com/fundacja-reborn/reread-webext/issues) or write to
dev@reapps.eu.

re/read is free software under
[AGPL-3.0-or-later](https://github.com/fundacja-reborn/reread-webext/blob/main/LICENSE).
