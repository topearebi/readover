# Readover

Your notes, highlights and books as a full-screen feed: one thing at a time, in a new order every time you open it.

Note apps are built for writing. Readover is built for re-reading. It points at the Markdown notes you already keep in GitHub (or a folder on your device) and turns them into a swipeable feed. Old notes you had forgotten come round again, highlights from books show up on their own, and anything worth keeping close gets a star.

Everything runs on GitHub: the app is a static site on GitHub Pages, your notes stay in your repos, and favourites and highlights are saved back to those repos as plain files. There is no server, database or build step to look after.

## What it does

- **Random feed.** Each time you open the app it shuffles. Items you haven't seen for a long time, or have never seen, come up more often. Favourites get a small boost.
- **A feed that learns, on this device only.** What you open, favourite and stay on, and what you skip or hide, shift which folders and libraries come up, never more than twice as often and never less than half. Settings → *Feed learning* shows it in plain words, and you can turn it off or reset it.
- **Memories.** Notes with a date (frontmatter `date:`/`created:`, a date in the file name, or a year folder such as `Journal/2019`) come back as *On this day in 2023* or *From 5 years ago*. GitHub notes without one use when they last changed.
- **Long notes as sections.** A long note with `##` sections becomes a carousel you swipe through sideways (or press ← →). It starts on a different section each time.
- **Your highlights come back.** A passage you highlight in a book returns the next day, then after 3 and 7 days. Now and then a *Connected* card shows two notes that link to each other.
- **Healthy limits.** The end of a shuffle tells you how many notes you revisited today. An optional *Suggest a break* card appears after 20 or 40 cards. When installed, the app icon shows how many notes are due for review (no server involved).
- **New notes come back on a schedule.** A note you write (or one that newly appears in a library) comes back the next day, then after 3 days, a week and three weeks, at the front of the feed with a line such as *You wrote this 3 days ago*. After a month it joins the normal shuffle.
- **Start with nothing.** Open the app and write. Notes are kept in the browser until you're ready to connect GitHub, and then they move into your repo in one go.
- **Highlight cards.** If a note contains highlights, the feed sometimes shows a single highlight in large type instead of the whole note. Tap it to open the note at that passage. Highlights saved from a book open the book at that passage. Readover counts these as highlights:
  - blockquotes (`> …`), including Obsidian callouts; a last line starting with `—` is shown as the source
  - `==marked text==`
  - list items under a heading containing *Highlights*, *Quotes*, *Excerpts* or *Clippings* (this matches Readwise and Kindle exports)
- **Books.** EPUB, PDF, MOBI, AZW3, FB2 and CBZ (DRM-free) show their cover and how far you've got, and open in a built-in reader that remembers your place on every device.
- **Shelf.** The Shelf tab lists every book across your libraries: the ones you're reading first, most recently read first, so switching between books is one tap.
- **Highlight while you read.** Select text and tap **Highlight**, or **Add a note** to write why it matters. Highlights are drawn in the book and added to `Highlights/<Book title>.md` in your notes repo. Each one keeps a hidden link to its place in the book, so its card in the feed opens the book at that passage. This works in PDFs too, as long as they contain text (not scans).
- **Highlights from other readers.** Put a KOReader export (Markdown, or JSON in a folder with *highlights*, *koreader*, *kindle* or *clipping* in its name) or Kindle's `My Clippings.txt` anywhere in a library, and its highlights come up in the feed, with your notes and the book they came from.
- **Picks up where you left off on any device.** Favourites, hidden items, where you are in each book, what you've already seen, your list of libraries and your preferences sync through one repo you choose (your *data home*).
- **Notes: a place to work on your notes, separate from reading.** The Notes tab lets you browse by folder and search everything; full text is searched once a note is on the device, and **Download them** fetches the rest. Open a note to:
  - **edit** it;
  - **add a thought** (dated, under `## Thoughts`);
  - **link** it to another note (`[[name]]` under `## Related`, or at the cursor while editing);
  - **rename or move** it (a single commit, and favourites move with it);
  - **delete** it.

  `[[Links]]` and links to other `.md` files open the linked note, and every note lists the notes that link to it. Saving is instant, even offline; changes are committed in the background, and a note that was changed elsewhere is never overwritten or deleted.
- **Save web articles.** Send an article to Readover and it's saved as a Markdown note in `Articles/` (in the repo chosen under Settings → Reading → *Save highlights and articles to*), with its title, link, site, author and date in the frontmatter. It then reads, searches, links and resurfaces like any note. Select text to **Highlight** it or **Add a note**: highlights are marked in the article and added to `Highlights/<Article title>.md`, and their feed cards open the article at the passage. See [Saving articles](#saving-articles).
- **Works offline.** The app and everything you've already seen are cached on the device.

## Saving articles

There's no server, so the page has to be handed to Readover from your browser:

- **Bookmarklet (computer, and iPhone).** Settings → *Save articles* has a **Save to Readover** button. Drag it to your bookmarks bar. On an article, click the bookmark: Readover opens with a clean preview (navigation, ads and footers removed), and **Save and read** saves it.
  - iPhone/iPad: tap **Copy the bookmarklet** under *On a phone*, bookmark any page, edit that bookmark and paste the code as its address.
  - A few sites block this. Readover then opens with the link filled in and asks you to paste the article instead.
- **Share (Android).** With Readover added to your home screen, share a link to it. Sharing only passes the link, so copy the article on the page and paste it in, or save just the link.
- **Paste (anywhere).** Notes → **+ Article**, or **Save a web article instead** in the new-note sheet. Copy the article on the page and paste it into the box: headings, lists, links and emphasis are kept.

Article images stay on the original site and load from there.

## Start without any setup

Open Readover and press **Write your first note**. Notes are saved in the browser (Readover asks the browser to keep them). You can write from the pen button at the top at any time.

Once the notes start to matter (10 notes, or a few kept for 3 days), one card in the feed suggests keeping them safe on GitHub. **Keep them safe** opens a short guide:
1. A link to create a private repository, already filled in.
2. A link to create a token, already filled in. You only pick the repository.
3. Paste both. Readover moves your notes into the repo (with their favourites) and starts syncing.

**Not now** hides the suggestion for a week. You can also do it any time from **Settings → On this device → Move to GitHub**, or download the notes as a .zip from there. None of these steps are required: you can connect GitHub, folders or anything else from Settings on day one.

## Set up (about five minutes)

1. **Put the app on GitHub Pages.** Fork or push this repo, then go to **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, and pick `main` and `/ (root)`. Every push to `main` is live the next time anyone opens the app. There's nothing to build and no version number to bump.
2. **Open the site** (`https://<you>.github.io/readover/`) and choose **Add a GitHub repo**. You can type `owner/repo` or paste a GitHub link, including a link to a folder.
3. **Add a token** if your repos are private, or if you want favourites, highlights and edits to sync. It's one token for your account, used for every repo you add (a repo can have its own under *More options* if you need that). Settings → *GitHub account* → **How to get a token** links to GitHub's form with the name and permission filled in:
   - Repository access: **All repositories**, or only your notes and books repos
   - Permissions: **Contents: Read and write** (Metadata: read-only is added automatically)

   Paste it under **GitHub account**. Readover checks it and shows whose it is. It is stored only in that browser.
4. **Install it.** On a phone, use *Add to Home Screen* so it opens full screen.

Public repos work without a token. Readover reads their files from `raw.githubusercontent.com`, which isn't subject to GitHub's 60-requests-an-hour limit for anonymous use.

### Local folders

**Open a folder** reads `.md`, `.txt`, `.pdf` and `.epub` files from a folder on the device.

| Browser | How it works |
| --- | --- |
| Chrome, Edge (desktop and Android) | Live folder access. Rescan with **Sync**. Notes can be edited, and highlights saved, back into the folder. After a restart the browser asks once for permission again. |
| Safari, iOS, Firefox | The folder is copied into the app's storage. Use **Re-import** to pick up changes. Read only. |

## Sync between devices

With a token, Readover keeps its own data in a `.readover/` folder in one repo, chosen under **Settings → Sync**. It picks the first repo you connect with a token; you can switch to any other, including a small private repo kept just for this.

| File | Holds |
| --- | --- |
| `.readover/state.json` | Favourites and hidden items, for every library |
| `.readover/progress.json` | Where you are in each book, and your in-book highlights |
| `.readover/seen.json` | When each item last came up in the feed, which drives the shuffle |
| `.readover/prefs.json` | Theme, highlight mix and your list of GitHub libraries. **Tokens are never written here.** |

Open Readover on another device, paste the same token and connect the data-home repo. Your other libraries, favourites and reading positions follow.

How it stays safe:
- **Per-entry merging.** Every entry carries a timestamp and the newer one wins. Two devices that changed different things, or the same thing at different times, combine cleanly. Files are never overwritten wholesale.
- **One commit per sync,** made on top of the exact version that was read. If another device pushed in between, GitHub rejects the commit and Readover reads and merges again.
- **When it syncs:** 15 seconds after a change that matters, when you leave the app, and when you come back. Feed history alone never makes a commit; it travels with the next one.
- Files have one entry per line with sorted keys, so their history on GitHub is easy to read.

### Editing notes

Saving a note is instant and works offline. The change goes into a save queue on the device, and each change is committed on its own in the background. A small dot in the top bar shows what's happening: a ring while changes are waiting, filled when they're on GitHub, red if something needs attention (tap it for details).

If the note was changed somewhere else since you opened it, Readover keeps that version and saves yours alongside as `Note (conflict 2026-10-10 2211).md`, then tells you once. Nothing is ever overwritten. Highlights are appended, so highlighting the same book on two devices never clashes.

## Files Readover writes to your repos

| Path | When |
| --- | --- |
| `.readover/*.json` | In your data home only, when syncing (see above). |
| `Highlights/<Book>.md` | When you highlight in a book. Goes to your data-home repo by default (Settings → Reading → *Save book highlights to*), so highlights live with your notes rather than in a books repo. Without GitHub, they're kept on the device. |
| Any note you edit or create | When you press **Save**. |
| `<Note> (conflict …).md` | Only if a note you edited had changed elsewhere in the meantime. |

Folders that start with a dot (`.obsidian`, `.git`, `.readover`) are never shown. To skip other folders, set **Skip these folders** on the repo.

## Keyboard

`↓`/`J` next, `↑`/`K` previous, `←`/`→` sections of a long note, `Enter` open, `S` favourite, `X` hide, `R` shuffle again, `N` new note, `/` search notes, `Esc` close. A gamepad works too (D-pad, A to open, Y to favourite, B to close).

## How it's built

Plain ES modules, no build step. The heavy libraries are loaded only when needed and are served from this repo (`vendor/`), so the app depends on nothing outside GitHub.

```
index.html            App shell and sheets (native <dialog>)
sw.js                 Offline cache: app files network-first (1.5 s timeout), libraries cached permanently
src/app.js            Feed, card actions, sync orchestration, keyboard and gamepad
src/feed.js           Weighted shuffle
src/library.js        Sources: list, read, write
src/sync.js           Data home sync: per-entry merge, one commit per sync
src/outbox.js         Save queue for note edits, conflict copies
src/ui/setup.js       Keep-your-notes-safe guide; when to suggest it
src/store.js          One IndexedDB database for every source, plus settings
src/markdown.js       Markdown parsing, sanitising and highlight extraction
src/covers.js         Book covers and metadata (PDF.js and foliate-js)
src/imports.js        KOReader and Kindle highlight exports
src/sources/github.js GitHub REST API (trees, blobs, contents)
src/sources/local.js  File System Access API, with an import fallback
src/ui/*              Cards, note reader and editor, settings, new note, overlay stack
src/viewers/book.js   EPUB, MOBI/AZW3, FB2, CBZ reader (foliate-js) with highlights
src/viewers/pdf.js    PDF reader (pdf.js) with a selectable text layer and highlights
src/ui/shelf.js       The Shelf
src/ui/notes.js       The Notes tab: folders, search, new notes
src/notes-index.js    Search, link resolution and backlinks, built on the device
src/learn.js          What the feed learns from how you read (on this device)
src/dates.js          Dates for "On this day" and "From N years ago"
vendor/<lib>-<ver>/   marked, DOMPurify, pdf.js, foliate-js, Literata (see vendor/README.md)
```

### Updates and offline use

Publishing is just pushing to `main`. The service worker asks GitHub Pages for the app's files each time the app opens, which is a quick "not modified" check when nothing changed. If there's no answer within 1.5 seconds, it uses the cached copy instead, so the app still opens instantly on a bad connection or offline. After one slow response it stays on the cache for 30 seconds rather than waiting again on every file.

Libraries in `vendor/` live in folders named with their version, so a file at a given address never changes. They're cached permanently, and updating one means adding a new folder.

### Syncing

Syncing a repo makes one API call to list every file (the Git trees API). Note text is fetched when a card is about to appear and is cached by blob SHA, so unchanged notes are never downloaded twice. Books are cached the same way.

### Run it locally

```
python3 -m http.server 8000
```

Then open http://localhost:8000. Service workers and the folder picker both work on `localhost`.

## Security notes

- Your token sits in this browser's `localStorage`, as with any static site that talks to GitHub directly. Keep it fine-grained and limited to your notes repos.
- Note content is sanitised (DOMPurify) before it's shown, so a note can't run script on the page that holds your token.
- The app talks only to GitHub, except for images inside saved articles, which load from the site they came from (sent without a referrer).
- A page sent by the bookmarklet is only parsed, never run: Readover reads its text with `DOMParser`, converts it to Markdown, and sanitises it again when it's shown. It only accepts the page from the tab that opened it, and nothing is saved until you press **Save and read**.

## Licence of bundled libraries

See `vendor/README.md`.

### The highlight format

Book highlights are ordinary Markdown, so they read well on GitHub and in other note apps:

```markdown
> Attention is the rarest and purest form of generosity.
>
> — Chapter One: Noticing, p. 12
<!-- readover {"book":"gh:you/books|Library/Book.epub","at":"epubcfi(/6/4!/4/2,/1:13,/1:67)"} -->

Your note, if you added one.
```

The comment is invisible when the file is viewed. It tells Readover which book the highlight came from and where it sits (an EPUB location, or `page=N` for PDFs). You can edit or move these files freely.
