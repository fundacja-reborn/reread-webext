# re/read user guide

This guide describes re/read screen by screen: what each screen shows, what each button and setting does, and the details that the [README](../README.md) leaves out. The README has the short version and the install links; [PRIVACY.md](../PRIVACY.md) says what is stored and what leaves the device; [DEVELOPMENT.md](DEVELOPMENT.md) is for people who build the extension.

Names in bold are the names of buttons, rows and settings as the extension shows them in English.

**Contents:** [The offline reading list](#the-offline-reading-list) · [Books and other files](#books-and-other-files) · [The reader](#the-reader) · [Highlights and notes](#highlights-and-notes) · [Reading aloud](#reading-aloud) · [The bubble and the underlines](#the-bubble-and-the-underlines) · [Reading without a translation model](#reading-without-a-translation-model) · [The saved phrases page](#the-saved-phrases-page) · [The toolbar popup](#the-toolbar-popup) · [Backup and safety copies](#backup-and-safety-copies) · [The settings page](#the-settings-page) · [Firefox on Android](#firefox-on-android) · [Keyboard shortcuts](#keyboard-shortcuts)

## The offline reading list

The reading list opens from the toolbar popup, from the reader's menu, and from the right-click menu on any page (**re/read** → **Offline reading list**). It is split into **To read** and **Read**, with a search box and one row per saved article or book.

**What is saved.** A saved article is stored in full on your device: it opens with no network, also when the original page has moved or disappeared. Pages opened in the reader are saved by default; the setting **Save pages you open to the offline reading list** turns that off, and a single page can then still be saved with **Save to reading list** in the reader. A page already in the list is never overwritten.

**Length.** Every row shows how long the text is: its words, and about how many minutes they take at your own reading speed, which you type once in the settings (**Reading speed** under **Reading view**; 200 words a minute until you do), so you can pick what to read next by its length. A book's row shows how many words the whole book holds and about how many hours it takes. The same numbers appear under the title in the reader, together with how many of your saved phrases were found in the text.

**Mark as read, delete.** Both are shown next to the title and under the last line of a document in the reader, and in the reader's menu. Deleting a document removes everything stored for it (text, pictures, highlights and notes, reading position) from the database and from the reading list's safety copy. Saved phrases are not part of a document: a phrase you saved while reading an article stays in your vocabulary, with no record of where it came from.

**Search across the list.** The search box searches titles, sites and your notes on documents, and, with **Search in the texts too** ticked, the stored texts, with snippets; clicking a snippet opens the document at that place. A row found by its note shows the note under the title.

**Select.** **Select** ticks articles or books, for a backup of only those (see [Backup and safety copies](#backup-and-safety-copies)) or for exporting each as a file of its own (see [Export a document](#export-a-document)).

### Pictures

Pictures are not saved by default; a saved article contains only text until you ask for them. **Download pictures** in the reader's menu, or **Download and show in the text** on the line under the article's title, stores an article's pictures with it, on one press, scaled down to screen size where that saves space. The pictures are downloaded from the addresses the article's pictures point at, once, without cookies or referrer (see [PRIVACY.md](../PRIVACY.md)). Once they are stored, the line under the title disappears and the menu row changes to **Remove pictures**, which deletes them again. The reading list shows how many pictures an article or a book keeps and how much space they take.

### Private tabs in Firefox

In a private tab Firefox gives the extension's pages (reading list, reader, saved phrases) a separate database and deletes it when the private session ends. The pages fill it from the safety copies, so the reading list and the highlights show there as they are, but an article saved, a book imported, a highlight made or anything deleted in a private tab is gone with the session: the copies are read in private browsing and never written. Saved phrases are the one exception: they go through the extension's background, which is never private, and are kept. The pages show a notice about this at the top. Nothing is lost, because the database of your normal tabs is unchanged; open re/read from a normal tab again (Firefox shows a mask icon in private mode).

## Books and other files

### EPUB books

**Import** on the reading list takes an `.epub` file and adds the book to the list. The import takes the text and the pictures in the file: no publisher styling, no fonts, and no DRM; a protected book is not imported, and a message says why. Links inside the book's text, its own contents page included, are not followed. A file imported again becomes a second copy.

**Table of contents.** **Contents** in the reader's menu shows the table of contents saved in the book file (`nav.xhtml` in EPUB 3, `toc.ncx` in EPUB 2), the same one other reading apps show, read once at import. When the file has no table, or only a few rows, such as the cover and the title page, while the text has more chapter headings, the chapter headings found in the text are listed instead. A book that was already in the reading list keeps the table it has; to get the one from the file, import the file again. When a long book has neither a table in its file nor chapter headings, **Contents** lists places in the book instead: each row shows the first words found at that place and how far into the book it is, in percent. This list is made when the book is opened and is not stored.

**Reading a long book.** A long book is read as one text. By pages, turning the last page shown carries on with the book. Scrolled, scrolling on at the very end of the loaded text opens what follows, and scrolling back at its very beginning opens what came before, with `PgDn`/`PgUp`, the space bar, the arrow keys, the mouse wheel, a trackpad or a finger. The scrolling has to start at the end of the text: fast scrolling that only reaches the end opens nothing, and neither does a key held down. **Continue reading** under the text and **Earlier text** over it do the same with one press.

**Footnotes.** A footnote's text is stored with the book at import and opens in a small card next to its number; the page does not scroll anywhere.

**Pictures.** The pictures in the book file are kept with it and shown in the text, scaled down to screen size where that saves space, with no network involved. The list shows how many pictures a book keeps and how much space they take, and **Remove pictures** in the reader's menu deletes them.

### Markdown texts

**Import** on the reading list also takes a `.md` file: a note from re/notes or Obsidian, or a document exported from the reader's menu (below). It joins the list the way a book does: headings as the table of contents, footnotes as pop-up notes, links to the web kept, pictures kept only as the addresses written in the file (nothing is fetched for them). The first heading is the title; a front matter block's title, author and language are read too. Raw HTML in the file goes through the same filter as any page. A file imported again becomes a second copy, as a book does.

### Export a document

Any saved article or imported book can be exported as a file of its own. **Export as EPUB** in the reader's menu writes a book file for e-readers and reading apps: the text as the reader shows it, the pictures kept with the document, the same table of contents the reader shows (an article's headings, a book's chapters), and a book's footnotes as pop-up notes. **Export as Markdown (.md)** writes a plain-text page with headings, lists, quotes and links (an article's pictures by their web addresses) for notes and other apps. The same two buttons are inside the reading list's selection, one file per ticked document. The file is named after the title and written from the stored copy on this device; nothing is fetched for it. An exported `.md` file imports back the same way (see [Markdown texts](#markdown-texts)), so a document can be exported and imported again without loss.

## The reader

### Opening a page in the reader

The reader shows a page as a clean article in the extension's own tab. It opens from the right-click menu (**re/read** → **Open in reading view**), from the page icon in the translation bubble, with `Alt`+`Shift`+`R`, or from the toolbar popup. Translation, saving and underlining work in the reader as on any page.

Under the title the reader shows the author, and the site the article came from with an arrow beside it that opens the original page in a new tab. The next line gives the length of the text: its words, and about how many minutes they take at your own reading speed, which you type once in the settings (200 words a minute until you do), together with how many of your saved phrases were found in the text. A book's line shows how many words the whole book holds and about how many hours it takes. An article whose pictures are not stored yet has one more line, with how many pictures it has and a **Download and show in the text** button.

### The reader's menu

The ⋮ button in the reader's bar opens the menu:

- **Contents**: the table of contents (an article's headings, a book's chapters). It is a panel at the left side of the window, as tall as the window, so a long table of contents is easy to scroll; on a wide window the text stays visible next to it.
- **Search in text**: search inside the open document (see [Search](#search)).
- **Highlights**: the highlights of this document (see [Highlights and notes](#highlights-and-notes)).
- **Mark as read** and **Delete from the reading list**, for a document that is in the reading list: the same two buttons that are next to the title and under the last line, so they are available anywhere in a long article or book. After the first press **Delete from the reading list** changes to **Sure?**, and the second press deletes the document.
- **Download pictures**, which changes to **Remove pictures** once the pictures are stored (see [Pictures](#pictures)).
- **Export as EPUB** and **Export as Markdown (.md)** (see [Export a document](#export-a-document)).
- **Add a note to this document**, which reads **Edit this document's note** once a note is written (see [A note on a whole document](#a-note-on-a-whole-document)).
- **Full screen** (below).
- **Saved phrases**, **Offline reading list** and **Settings**: the extension's other pages.
- **Open the original**: the page the article came from, in a new tab.

### Full screen

**Full screen** in the reader's menu gives the article the whole screen: the browser hides its own bars until you press Back or `Esc`. The row reads **Exit full screen** meanwhile and does the same. A browser accepts the request only from a press, never from a page on its own, so after the browser reopens the reader's tab the row has to be pressed again.

Where the bar has room for it (a desktop, a tablet or an e-reader; a phone held upright usually does not), the bar of every page (the reader in each of its views, the saved phrases, the settings) also carries a full-screen button next to the menu: one press asks for the whole screen, and the same button, or Back, or `Esc` on a desktop, leaves it. The bar itself stays where it is, pinned to the top of every page; the small tab at the edge of the reader's bar is what hides that bar.

The settings and the saved phrases opened from the reader's own menu keep the full screen: they are shown inside the reader's own page, so nothing is reloaded and the browser's bars stay hidden. Back, the back gesture or the arrow in their bar brings the reading back exactly where it was. Opened any other way (from the toolbar popup, from the bubble on a web page, or from the browser's own add-ons manager) they are pages of their own.

On Android see also [Full screen on a phone](#full-screen-on-a-phone).

### Appearance: the Aa panel

The **Aa** button in the reader's bar opens the appearance panel:

- **Theme**: light, sepia, dark and e-ink. The e-ink theme is black on white in the greys an e-ink screen can show, with stronger highlighter colours and nothing animated.
- **Layout**: **Pages** or **Scroll** (see [Pages and scroll](#pages-and-scroll)).
- **Type**: serif or sans, or any font installed on the device, typed by name in the settings (**Custom font** under **Reading view**) and offered here as **Custom**.
- **Size**, **Width** and **Line spacing** of the text.
- **Alignment**: left-aligned or justified lines.
- **Hyphenation**: the browser's own, in the language the page or book declares. Which languages it covers depends on the browser and the system, a page that declares no language is not hyphenated, and nothing is downloaded for it (see [PRIVACY.md](../PRIVACY.md), "Hyphenation").
- **Paragraphs**: set apart by a blank line, by an indented first line as in a book, or by both.
- **Links**: active, or shown as plain text, so that a book is shown without blue links.
- **Highlighter**: the colour the highlighter marks with.
- **Underline**: three thicknesses for the dotted underline of saved phrases.
- **Voice** and its speed, for reading aloud.

A small tab at the edge of the reader's bar hides the bar; the tab stays at the window's edge, and pressing it again brings the bar back.

### Pages and scroll

The **Layout** row of the Aa panel chooses between **Pages** and **Scroll**. **Pages** is the default: the first time a text is opened, a note at the top says that it is divided into pages and has a **Scroll** button for going back to scrolling; the note is shown until you press that button, close the note, or choose a layout in the Aa panel.

Read by pages, the text moves only by whole pages, each beginning and ending with a whole line. A finger, the arrow keys, `PgDn`/`PgUp`, `Home`/`End` and the mouse wheel turn it; a finger or a wheel cannot scroll it part-way. With **Scroll**, the text is one long column; `PgDn`/`PgUp` and the space bar move it by a screenful with the last line kept on top, whole lines under the bar.

**Turning pages by touch.** What a finger does is chosen in the settings, under **Pages layout**: **Turning pages by touch** offers a tap on the left or right third of the page, sliding a finger sideways, or nothing at all. Until you choose, it is a slide by default on a narrow screen, where the hand holding the device rests on the glass and only a gesture that moves is safe from it, and a tap on a wide one, where nothing rests on the screen. A slide left shows the next page; on a phone it must not begin at the very edge of the screen, which the system keeps for its own back gesture. Sliding a finger up shows the next page too, and down the previous one (the movement a hand makes to scroll), with either of the two touch settings; a mouse that moves with its button down is selecting text and never turns a page. A tap turns a page only when it is short, still and away from the edges of the screen, so that a thumb holding a phone turns nothing; a pen never turns a page.

**The page footer.** A page count is shown at the foot of the window (**Show the page footer with reading progress** under **Pages layout** in the settings, on by default); switched off, the count is shown in the reader's bar next to re/read on a wide screen, and it is read by screen readers either way. When the text has a table of contents, a small **Contents** button is shown at the other end of the same line, under the first letters of the text; it opens the same panel as **Contents** in the reader's menu. In a long book the count is how much of the whole book you have read, in whole percent, the same number the book's row in the reading list shows, because only the pages of the text around you are laid out, and a page number of the whole book could not be given.

**Bars at the foot of the page.** When the read-aloud or highlighter bar is at the foot, or the page footer is switched on, the page being read keeps its first line and only its last lines go behind the bar. With the highlighter switched on, a tap on the text makes or changes a highlight, so the highlighter's toolbar carries two arrows for turning the page: the lines the toolbar covers move to the page after it, and the arrows turn to it.

**Selections and the bubble.** Read by pages, a highlight or a selection dragged to the foot of the page turns it after a moment and goes on onto the next page (a line appears on the page's edge while the turn is waiting; the same works upward at the head); the page keys and the mouse wheel turn pages without closing a selection being dragged or a highlight being edited. While the translation bubble is open, the mouse wheel over the bubble scrolls its dictionary list, and so do the keys after a click into the list; over the text, the wheel, the keys and a finger sliding on the page close the bubble and turn the page (a tap on the text only closes it).

**Page turn effect**, in the same section of the settings, shows that the page has turned, which is easy to miss when you are reading the middle of one. Three values, and the reader picks: a smooth slide, which is the default; a dark flash of the text area, for e-ink screens (barely visible on the panel it is meant for, where it also helps clear ghosting, and a distinct dark flash on an ordinary one); or nothing at all. Nothing happens when your system asks for less motion, and nothing when the page is turned by reading aloud or by dragging a selection to the edge of the page. The effect was made for e-ink screens, where a page turn is one clean refresh, and it is independent of the theme.

### Reading position

Every saved document reopens where you stopped.

### Search

**Search in text** in the reader's menu searches inside the open document: articles, whole books, live pages too. In a book the results are grouped by chapter. The reading list has its own search across every saved document (see [The offline reading list](#the-offline-reading-list)).

## Highlights and notes

**Making a highlight.** The highlighter in the reader marks a passage of the text. Highlights snap to whole words, can span paragraphs, come in a choice of colours and are stored with the saved copy of the document. Tap a highlight and drag either of its two pins to make it shorter or longer, word by word. The highlighter's toolbar at the foot of the page has **Copy**, **Note**, the four colours, **Delete**, and two arrows that turn the page.

**The Highlights page** lists every mark with its note, and a highlight from a book with the title of its chapter (the search inside a book groups its results by chapter the same way). Each row can be read aloud, copied, opened in its document or deleted. **Export as notes (.md)** writes the highlights as a Markdown file of quotes and notes for your own notes; that file cannot be imported as highlights.

**A highlight whose text has moved** (a paragraph added above it, a book imported again) is found by its quote and shown at the right place. When the quoted text itself has changed, a message says so instead of the wrong words being marked.

**Highlights in the backup.** The highlights are included in the backup of everything (see [Backup and safety copies](#backup-and-safety-copies)), for books too: a book can be deleted and imported again from the same `.epub` file without losing its highlights (nothing already there is changed or removed). When the backup's highlights are imported into a book that is already in the list, each one is placed where its words are in the book as it is now, wherever in the book that is; a highlight whose words cannot be found exactly once stays on the Highlights page, and the import report says how many.

**A highlight without its article.** A highlight whose article is no longer in the reading list is kept: you can open the original page, delete the highlight, or delete all highlights of that page.

### A note on a whole document

A note can also be written on a whole document, not only on a highlight. **Add a note to this document** in the reader's menu opens the same note window over the document's title, and the row reads **Edit this document's note** once one is written. The note is shown under the title in the reader, with a button beside it that opens it for editing, and on that document's Highlights page. It goes into the exported Markdown file under the document's title, is included in the backup with the highlights (a document that already has a note keeps it), and stays when the same page is saved again.

## Reading aloud

A whole article or book can be read aloud in the reader, with **Read aloud** in the reader's bar, and a phrase from the bubble, with its **Read aloud** button. In the reader the word being spoken is highlighted as it is read, and the read-aloud bar has pause and resume, sentence skip and speed control; the keys are listed under [Keyboard shortcuts](#keyboard-shortcuts). A long book is read aloud without a break: after the last sentence of the loaded text, the text that follows is opened and reading aloud continues, until you pause or stop it or the book ends. The rows of the saved phrases page and of the Highlights page can be read aloud as well.

Only the device's offline voices are used: the online voices some browsers add (Chrome's "Google ..." voices, for example) are never listed and never used, and when the device has no offline voice for a language, nothing is read aloud and a message says so. With the translation model off, dictionary meanings are read aloud in the voice of their language.

The **Reading aloud** section of the settings has a voice for each language (**Voice for reading aloud**) and the **Voice speed**. Its switch **Show the read-aloud buttons** turns reading aloud off altogether when unticked: no speaker in the bubble, no **Read aloud** button in the reader, none in the lists. The voice and the speed you chose are remembered and apply again when you turn it back on.

## The bubble and the underlines

### Translation on selection

Select a word or phrase on a web page, or in the reader, and a bubble under the selection shows its translation. The translation engine (Bergamot, the technology behind Firefox's built-in page translation) is included in the extension and runs on your device, so translation works with no network, in airplane mode too. `Esc` closes the bubble.

Translation models are downloaded once, in the **Languages** section of the settings page, or added from your own files, and stored on the device. About a hundred language pairs are available. An installed pair shows an **Update** button when Mozilla publishes a new build.

The bubble has buttons to save the phrase, hear it, copy it, edit its meaning and mark it **Learned**, and a page icon that opens the page you are reading in the reader. The setting **Show the action buttons in the translation bubble only after a click** keeps the bubble to the translation until you click it.

### Dictionary entries under the translation

A translation model has to pick one meaning; a dictionary lists them all. Installed StarDict dictionaries (a catalogue of more than four hundred WikDict pairs installable with one click, or your own files; see [Dictionaries](#dictionaries) under the settings page) show their entries in the bubble under the translation. Clicking a line attaches that meaning to the saved phrase.

The setting **Show the sentence and dictionary entries right away** decides whether the entries and the translated sentence are shown at once or only after a press on **More**. The bubble over a phrase you saved earlier shows only the saved translation; its sentence and dictionary entries appear after a press on **More**. With several dictionaries installed, the bubble shows their entries in the order the settings page lists them; two arrows on each dictionary's row there change that order.

Dictionaries are matched by the language of their headwords, not by the language pair. A monolingual dictionary (English-English, for example) added from files or from a link is therefore shown next to the bilingual ones.

A translation model often gets a single word wrong, and a dictionary is the better answer to one. So when you select a word or two and no dictionary entry is shown under the translation, a line in the bubble says why, one of two things: no dictionary for the language is installed yet (the word "settings" in that line opens the settings at the dictionaries), or the installed ones do not know the word (with a link to the list of dictionary sources, its address shown on the link).

### The language check before the model

The model translates only from the pair's language, and a page in your own language can hand it the wrong one: a Polish word on a Polish page, under English → Polish, comes back as nonsense. So before the model is asked, the extension checks which language the selection is in, on the device. The browser's own language detector reads the sentence around the selection (Firefox and Chromium build one in; it needs no permission and no network; see [PRIVACY.md](../PRIVACY.md), "Language detection"). The dictionaries are then asked in the language it found, or, when it is not sure, in the pair's language first and in the language the page declares second.

When the sentence reads as your own language, or when a dictionary of another language knows the selected word while the pair's dictionaries do not, the model is not asked at all. The bubble shows that language's dictionary entries instead, or says that no dictionary for it is installed yet, or that none of yours knows the word. It also says where **Save** would file the phrase, reads it aloud in that language, and stores nothing by itself. The detector's verdict counts only when it names the pair's target language or the language the page declares; a page in some third language still gets the model's answer, and a single word with no sentence around it is left to the dictionaries.

### Saving a phrase, and the sentence with it

**Save** in the bubble keeps the phrase with its meaning: the translation, a dictionary line you clicked, or a meaning you typed after **Edit**. From then on the phrase is underlined on every page where it appears.

The setting **Save the sentence with the phrase** (off until you turn it on) saves, with every phrase you save from the bubble, the sentence around it: the sentence as the page shows it, never its translation. It is shown under the phrase on the saved phrases page, folded to one line, and it is what makes a sentence card in Anki (see [TSV import and export](#tsv-import-and-export)). Only the first sentence is kept: saving the phrase again changes the meanings, not the sentence. For a phrase saved without a sentence (before you turned the setting on, from the **Add a phrase** field, or from a two-column file) the sentence around it is saved the next time you open its bubble on a page. The sentence is stored with the phrase, not with the article: deleting the article does not delete it. The bubble over a saved phrase does not show the stored sentence, because while you read, the sentence on the page is the one you need.

### Underlines

A saved phrase is underlined on every page where it appears; click the underline to see your meaning again. The underline is dotted and thin on purpose, so that it does not distract while you read; the reader's **Aa** panel offers three thicknesses for screens on which the thinnest one is hard to see.

Matching is exact by default: saving `read` underlines `read`. The setting **Underline other forms of saved words** extends it to `reads` and `reading`: the forms your installed dictionary confirms, English only for now. The bubble over such a form shows what you saved and names the saved word.

The setting **Show the underlines and the bubble only in the reader** keeps ordinary pages free of underlines and of the translation bubble. Selecting text on an ordinary page then shows a small bubble with two buttons instead: open the page in the reader, and go to the reading list. On a phone this is the default (see [Firefox on Android](#firefox-on-android)).

### Learned

**Learned**, in the bubble or on the saved phrases page, takes the phrase off every page in one click: its underline goes, and the phrase moves to the **Learned** list on the saved phrases page, with its meanings, sentence and counts kept. A vocabulary file from another device cannot bring it back to the pages, and **Back to learning** on that list can. Deleting a phrase for good is a separate act on the Learned list (see [The saved phrases page](#the-saved-phrases-page)).

## Reading without a translation model

re/read also works without machine translation. If you read in your own language, or with dictionaries instead of a translation model, one switch in the settings, **Use without a translation model**, turns the model off. The reader, the offline reading list, the highlighter, reading aloud and search all keep working.

Dictionaries and saved phrases keep working too. With a language pair chosen (the first dictionary you install sets it), selecting a word shows its dictionary meanings: looked up in the pair's language first, and then in the language the page declares when your dictionaries for the pair do not know the word. So an English word on a site whose interface is in Polish is read with your English dictionaries, and a Polish word on a Polish page still finds your Polish ones. The meanings are shown in the same rows as on the saved phrases page: one folding block per dictionary, a checkbox per meaning. Ticking one saves the phrase (under the pair) at once, unticking takes the meaning back, and **Edit** in the bubble lets you type your own meaning, for a longer phrase for example. When there is nothing to show, a one-line message in the bubble says why: a partial word was selected, the word is not in your dictionaries (with a link to the list of dictionary sources), or no dictionary for that language is installed; the word "settings" in that line opens the settings at the dictionaries. Saved phrases stay underlined wherever you read, on ordinary pages as well, unless the **Show the underlines and the bubble only in the reader** switch keeps them to the reading view. A monolingual dictionary works the same way, and meanings can be read aloud in that language's voice. Nothing is deleted: saved phrases and models stay on the device and come back as soon as you switch the model on again.

A sub-option under that switch, **Do not show the bubble when selecting text**, is for people who select text to keep their place while reading. On ordinary pages nothing appears when you select text (the reader opens from the right-click menu, the toolbar button or with `Alt`+`Shift`+`R`), and in the reader a selection only highlights the text: no bubble appears, a tap or `Esc` removes the selection, and `Ctrl`+`C` copies it.

## The saved phrases page

The saved phrases page opens from the toolbar popup, from the reader's menu and from the settings. It shows all your phrases for the chosen language pair on two lists, **To learn** and **Learned**, with filtering, pagination, editing and **Learned** per row.

**Counts.** Beside a phrase are two counts, a magnifier and a book: how many times you checked it (opened its bubble), and how many times it occurred in the texts you finished in the reader (a book's text as you read on past it, an article you marked as read). The list can be ordered by either count, newest first, or alphabetically.

**The Learned list.** A phrase on the Learned list can go **Back to learning**, or be deleted for good: one phrase after a second press, or every learned phrase at once. This is the only way a phrase is ever deleted.

**The sentence.** When the setting **Save the sentence with the phrase** is on, the sentence a phrase was saved in is shown under the phrase, folded to one line (see [Saving a phrase, and the sentence with it](#saving-a-phrase-and-the-sentence-with-it)).

### Add a phrase

**Add a phrase** takes a word or phrase you type and shows your dictionaries' entries for it. A tick on a meaning saves the phrase with that meaning, an untick takes it back, **Your own** at the end takes a meaning you write yourself, and **Show in list** brings the saved phrase's row into view. The translation model is not asked here on purpose: a word on its own has no sentence around it, and without a sentence the model is at its least reliable. The toolbar popup has the same look-up field, but it only reads; its button **Save on the phrases page** brings you here with the word already looked up.

### TSV import and export

**Export** writes your vocabulary as a two-column TSV file, to move it to Anki or between devices; **Import** reads such a file, and importing the same file twice never duplicates a phrase. In the file's meaning cell a semicolon followed by a space separates meanings, and a semicolon without a space stays inside its meaning. When you type several meanings of your own at once (in the page's field or in the edit box), a semicolon separates them; a dictionary's own line with a semicolon in it stays one meaning until you edit that line.

A second button, **Export for Anki**, writes a three-column file: phrase, meanings, and the sentence the phrase was saved in (empty when none was kept), for Anki's sentence cards. Either file can be imported back; the three-column one includes the sentences, and for a phrase already saved the file's sentence is added only when the phrase has none of its own.

Phrases marked Learned are in neither file, and importing a file never changes whether a phrase is learned; only the backup of everything (see [Backup and safety copies](#backup-and-safety-copies)) carries the Learned list.

The same TSV format is written by the [offlinetranslate-koplugin](https://github.com/fundacja-reborn/offlinetranslate-koplugin) for KOReader, so vocabulary collected on an e-reader can be imported here, and the other way round.

## The toolbar popup

The popup opens from the re/read button in the browser's toolbar; on Firefox for Android, from the ⋮ menu, under **Extensions**. It holds:

- a per-site off switch for the site you are on (a site can also be added by its address in the settings, under **Switched-off sites**),
- the language pair,
- a field to look up a word in your dictionaries (the popup only reads; its button **Save on the phrases page** takes you to the saved phrases page with the word already looked up),
- the reader for the current page, the offline reading list, the saved phrases page and the settings.

The extension's own pages (reader, reading list, highlights, saved phrases, settings) share one tab instead of opening a new one each time.

## Backup and safety copies

**Safety copies.** Your saved phrases, your highlights with their notes and the reading list keep a second copy in the extension's own storage (`storage.local`), apart from the database. The copies are written again at every change. If the browser ever clears the databases, they are restored from the copies automatically. The copy of the reading list doubles the space the list takes, so the setting **Back up the reading list** under **Data and copies** turns that one off; the copies of the phrases and the highlights are always made. The same section shows a table of the copies: what each holds and when it was last updated.

**Backup of everything.** **Export** on the reading list writes one `reread-backup.zip` with everything re/read keeps: the reading list with its highlights and reading positions (and its pictures when you tick **Export with pictures**), every saved phrase of every language pair with its sentence and counts, every document's highlights, books' too, and the settings. Models and dictionaries are not in it; they can be downloaded again. **Import** reads that file back part by part, adding what is missing and never overwriting what is here: an article already saved is not replaced, a saved phrase's meanings are not changed and only a missing sentence or a higher count is added, a highlight already here is left out, and the settings are restored only when you tick the box. The older files (the list's `.json` or `.zip`, the highlights' `.json`) still import.

**Books in the backup.** Books go into the backup only when you tick **Export with books**: their text and pictures, with the reading positions, and a book already in the list is never replaced. Otherwise a book's backup is its `.epub` file, and its highlights come back from the backup imported after the book.

**A selection.** Press **Select**, tick some articles or books and export only those: a `reread-selection.zip` of the same kind, cut to what you ticked, for sharing. A ticked book goes with its pictures, a ticked article's pictures when you tick the box.

**What the list tells you.** After every export a line under the button says what went into which file, and its size. Another line under the buttons says when the backup was last written and how much more is here since (or, before any backup, what is here to lose): in grey, and in the text's own colour once a month has passed with something new. The same date is shown in the backup table in the settings.

**Other files.** Vocabulary alone is exported as TSV from the saved phrases page (see [TSV import and export](#tsv-import-and-export)), and a single article or book as an EPUB or Markdown file from the reader's menu or the selection (see [Export a document](#export-a-document)). Uninstalling re/read deletes all of its data, the copies with it, so export a backup first.

## The settings page

The settings page is grouped into sections: **Languages**, **Bubble and phrases**, **Reading view**, **Reading aloud**, **Data and copies**, **Switched-off sites**, **Custom CSS** and **About re/read**. A table of contents beside it follows what you are reading. The search field over it narrows the page to the settings whose name or description contains what you type; accents need not be typed. Every setting has its own address (`#s-<name>`), so a link to one lands on it. A **First steps** block at the top lists what a fresh installation still needs: a translation model or a dictionary, and the toolbar button pinned.

### Languages

- **Language pair**: the pair you translate from and to. The first dictionary you install sets it when no model is installed.
- **Translation models**: the installed models, each with an **Update** button when Mozilla publishes a new build, the catalogue of models to download, and a way to add a model from your own files. **Update the list** fetches Mozilla's current index, on that press only; the list shows the date it was fetched. Every download is verified before it is stored and can be cancelled (see the README's [Translation models](../README.md#translation-models)).
- **Use without a translation model** and its sub-option **Do not show the bubble when selecting text**: see [Reading without a translation model](#reading-without-a-translation-model).
- **Dictionaries**: below.

#### Dictionaries

The dictionaries section carries a catalogue of more than four hundred [WikDict](https://www.wikdict.com/) pairs; one click downloads and installs one. **Update the list** fetches WikDict's current listing, on that press only. A dictionary from anywhere else you add yourself: from files (StarDict: `.ifo`, `.idx`, `.dict` or `.dict.dz`, optional `.syn`), or by pasting the address of its `.zip` archive under **Add a dictionary from a link**. The sources we know of, each stating its licence, are listed at [reapps.eu/read](https://reapps.eu/read#faq-dictionary-sources). Installed dictionaries are listed at the top, each with **Remove** and its attribution.

Two arrows on each row set the order in which the dictionaries' entries are shown: put the English-English one above the English-Polish one and its entries come first.

A dictionary's name comes from its file and can be a whole sentence, which breaks the heading of its entries into several lines. The **Display name** field under **Details** on its row takes a shorter one, up to 40 characters, and that name is the row's title and heads the dictionary's entries in the bubble, in the popup and on the phrases page; clearing the field brings the file's name back. Two dictionaries cannot be shown under one name.

For English-Polish, WikDict is the recommended start: 66,609 entries plus 51,721 alternative spellings in its `.syn` file (which is what lets `elevations` find `elevation`). FreeDict's `eng-pol` StarDict build (release 0.2.1) is mostly missing the Polish translations (checked 2026-08-11); other FreeDict pairs may be fine.

### Bubble and phrases

- **Show the underlines and the bubble only in the reader**: see [Underlines](#underlines) and [Firefox on Android](#firefox-on-android).
- **Show the sentence and dictionary entries right away**: see [Dictionary entries under the translation](#dictionary-entries-under-the-translation).
- **Show the action buttons in the translation bubble only after a click**: the bubble opens with the translation alone, and its buttons appear when you click it.
- **Bubble text size**: the size of the text and the buttons inside the bubble, on every page.
- **Save the sentence with the phrase**: see [Saving a phrase, and the sentence with it](#saving-a-phrase-and-the-sentence-with-it).
- **Underline other forms of saved words**: see [Underlines](#underlines).

### Reading view

- **Save pages you open to the offline reading list**: see [The offline reading list](#the-offline-reading-list).
- **Custom font**: the name of a font installed on the device, offered as **Custom** in the Aa panel's **Type** row.
- **Reading speed**: the number of words you read in a minute, used only for the reading time shown in the reading list and under a title.
- **Pages layout**: **Show the page footer with reading progress**, **Turning pages by touch** and **Page turn effect** (see [Pages and scroll](#pages-and-scroll)).

### Reading aloud

**Show the read-aloud buttons**, **Voice for reading aloud** (one per language) and **Voice speed**: see [Reading aloud](#reading-aloud).

### Data and copies

How much the extension stores, the table of the safety copies with the date of the last backup file, and **Back up the reading list**: see [Backup and safety copies](#backup-and-safety-copies).

### Switched-off sites

The sites on which re/read does nothing: the list of the hostnames switched off from the toolbar popup, a field to add one by its address, and a way to remove each.

### Custom CSS

A field near the end of the settings page takes CSS rules of your own for the bubble, the reader page and the toolbar popup: never for the pages you read, and never for the settings page itself, so a wrong rule can always be undone there (clear the field and save). Rules that would load anything from the network (`url()`, `@import`, `@font-face`) are refused before they are stored. The names come from the stylesheets in the repository (`src/content/tooltip.js` for the bubble, `src/reader/reader.css`, `src/popup/popup.css`, `src/assets/page.css`), which the settings page links to at the installed version; they are kept from version to version where possible, and a change is announced in the release notes.

### About re/read

The installed version, a reminder that everything happens on this device, the link to the source code, **Show the first steps**, and **Support**: the ways to support the project and **Rate re/read**, aimed at the store your browser installed from.

## Firefox on Android

The same package works on Android, same version floor (Firefox 142). The popup opens from the ⋮ menu, under **Extensions**.

**Reader-only mode.** On a phone the extension starts in reader-only mode: ordinary pages are left alone, and selecting text offers two actions, opening the page in the reader (where translation, saving and underlining work as usual) and going to the reading list. The reason: the translation bubble and Android's own copy menu compete for the same spot on the screen. The mode is a regular setting (**Show the underlines and the bubble only in the reader**) and can be switched off for the full desktop behaviour.

**Getting to the reading list.** Press and hold on the text of any page and choose **Offline reading list** in the bubble, or open the popup (⋮ menu, **Extensions**, re/read). For a shortcut, open the reading list and choose **Add to shortcuts** in the Firefox menu: a tile on Firefox's start page (the page a new tab opens with) then opens it; a bookmark to the reading list page works the same way. **Add to Home screen** does not work for any extension's pages: the shortcut on the phone's home screen either never appears or shows a message that the app is not installed. That is a Firefox for Android limitation ([bug 1875695](https://bugzilla.mozilla.org/show_bug.cgi?id=1875695), open since 2024; Firefox accepts only `http` and `https` addresses in home-screen shortcuts), not something an extension can change. The tile and the bookmark contain the extension's internal address: it stays the same after an update, but changes after an uninstall and a fresh install, and the tile and the bookmark then have to be added again.

### Full screen on a phone

The reader's menu (the ⋮ button in the reader's own bar) has a **Full screen** row: Firefox hides its address bar, Android hides its status bar, and the article gets the whole screen. The Back button or the back gesture brings them back; the row reads **Exit full screen** meanwhile and does the same. Firefox's own setting **Scroll to hide toolbar** hides the address bar only while a finger scrolls down and shows it again at every scroll up; the page-turn keys of an e-reader never hide it. A browser accepts the request only from a press, never from a page on its own, so after Firefox reopens the reader's tab the row has to be pressed again. The rest of what full screen does (the button in the bar of every page where the bar has room for it, the settings and the saved phrases opened from the reader's menu staying in full screen) is described under [Full screen](#full-screen).

**Private tabs** are described under [Private tabs in Firefox](#private-tabs-in-firefox).

## Keyboard shortcuts

| Key | Where | Action |
|---|---|---|
| `Alt`+`Shift`+`R` | any page | open the page in the reader |
| `Esc` | any page | close the bubble |
| `PgDn` / `PgUp` | reader | turn the page: a screenful of text with the last line kept on top, whole lines under the bar |
| `⌥`+`↓` / `⌥`+`↑` | reader, macOS | the same page turn, for keyboards without page keys |
| `Space` / `Shift`+`Space` | reader, voice off | the same page turn |
| `↓` `↑` | reader, Pages layout | next / previous page |
| `→` `←` | reader, Pages layout, voice off | next / previous page |
| `Home` / `End` | reader, Pages layout | first / last page of the text (in a long book: of the text around the page shown) |
| `Space` | reader, during read-aloud | pause / resume |
| `←` `→` | reader, during read-aloud | previous / next sentence |
| `<` `>` | reader, during read-aloud | slower / faster |

The read-aloud keys work only while the voice is reading; with the voice off, Space turns the page like `PgDn`. Keys pressed inside text fields, in open dialogs or on focused buttons are left alone.
