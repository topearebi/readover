# Readover

Your notes, highlights and books as a full-screen feed: one thing at a time, in a new order every time you open it.

Note apps are built for writing. Readover is built for re-reading. It points at the Markdown notes you already keep in GitHub (or a folder on your device) and turns them into a swipeable feed. Old notes you had forgotten come round again, highlights from books show up on their own, and anything worth keeping close gets a star.

Everything runs on GitHub: the app is a static site on GitHub Pages, your notes stay in your repos, and favourites and highlights are saved back to those repos as plain files. There is no server, database or build step to look after.

## What it does

- **Random feed.** Each time you open the app it shuffles. Items you haven't seen for a long time, or have never seen, come up more often. Favourites get a small boost.
- **A feed that learns, on this device only.** What you open, favourite and stay on, and what you skip or hide, shift which folders and libraries come up, never more than twice as often and never less than half. Settings → *Feed learning* shows it in plain words, and you can turn it off or reset it.
- **Memories.** Notes with a date (frontmatter `date:`/`created:`, a date in the file name, or a year folder such as `Journal/2019`) come back as *On this day in 2023* or *From 5 years ago*. GitHub notes without one use when they last changed.
- **Long notes as sections.** A long note with `##` sections becomes a carousel you swipe through sideways (or press ← →). It starts on a different section each time.
- **Connections.** Now and then a *Connected* card shows two notes that link to each other.
- **Healthy limits.** The end of a shuffle tells you how many notes you revisited today. An optional *Suggest a break* card appears after 20 or 40 cards.
- **A garden of notes.** Every card carries a small tag saying how developed the note is and how recently it was tended, e.g. **Seed · 2d** or **Sapling · 5mo**.
  - **Stages:** a *seed* has no thoughts or links yet; a *sprout* has one; a *sapling* has 2+ thoughts and 2+ links; a *tree* has 5+ links. Thoughts are your own words in the note plus each dated entry under `## Thoughts`; links count both ways.
  - **Health:** *healthy* (green glow), *thirsty* (amber) or *wilting* (brown-grey), from the time since the note last changed on GitHub or got a dated thought. The windows are longer for more developed notes: a seed wilts after 30 days, a tree after 2 years.
  - **The feed leans towards thirst.** A note past its healthy window comes up more often the further past it is, up to twice as often. Nothing is ever "due", and nothing nags.
  - **Water** a note from its card: write a thought in the field at the bottom and it's added, dated, under `## Thoughts`.
  - **Tap the tag** to see where the note stands (thoughts, links, time since tended) and to **Water**, **Graft** (link it to another note, under `## Related`) or **Prune** it.
  - **Prune** moves a note to `Archive/` in one commit, adding `pruned:` and `pruned_from:` to its frontmatter. It leaves the feed, and its links stop counting. **Replant** (in the note's ⋯ menu) puts it back.
  - **In progress or done.** Every note is in progress until you mark it done, in the new-note sheet or the tag sheet (`status: done`). Done notes rest: they don't wilt, they show when you last read them, and they come up a little more once unread for a year. (`submitted` and `published`, written by earlier versions, count as done.)
  - **Published version:** for any note, add where it was published (a magazine, a newspaper, your blog) and it's saved as `canonical_url:`. That's the field Jekyll sites use to point at the original, and the tag sheet links to it.
  - **Filter by growth or type.** "What to show" (the feed) and the Notes tab both filter:
    - **Growth:** Seeds, Needs water, Wilting, Trees, Done, Pruned.
    - **Types:** tick any of your top-level folders, plus *Unsorted* (the top level). None ticked means all. Folders with the same name in different libraries count as one type.
    - Each option shows how many notes it covers. Pruned notes only appear when you ask for them.
  - **Moving notes keeps their clock.** A note moved or renamed with its text unchanged, in Readover or anywhere else, keeps its last-change date. Editing it counts as tending.
  - **Sort in Notes:** Folders (browsing), Newest, Oldest, Recently tended, Least tended. Any sort other than Folders, or any filter, gives one flat list with each note's growth tag and date. Dates come from the note's own `date:` (with its time), then the date in its file name. The feed and Notes remember their own filters.
  - The numbers live in one block at the top of `src/garden.js`.
- **Types are folders.** A note's type is its top-level folder in the library (`Journal/`, `Essays/`, `Highlights/`…); subfolders belong to the type above them. Notes at the top level are *Unsorted*. There's nothing to configure and nothing written into notes for it, so any other app sees the same organisation. A library with no folders at all works too: no type picker, no *Unsorted* label. `Archive/` holds pruned notes and isn't a type. Settings → *Your notes* → *Organising your notes* has a short guide.
- **Notes in a consistent format.** A new note is saved as `YYYY-MM-DD-title-words.md` (the date is added for you, and the file name never changes, so links stay intact). The title is optional: without one, the first words name the note. The frontmatter is plain enough for any Markdown app, and a Jekyll site can use it as is:
  ```
  ---
  title: This is a note
  date: 2026-12-30 10:57 +0000
  status: done
  tags: [habits, writing]
  ---
  ```
  `status:` is only written when you mark a note done. In the new-note sheet you choose the library, the type (a folder, *Unsorted*, or **New type…** to start a folder), in progress or done (remembered per folder on this device) and tags. Existing notes are read as they are and never renamed. A note's title comes from `title:`, then its first heading, then its file name. Links Readover adds look like `[[2026-12-30-this-is-a-note|This is a note]]`.
- **Start with nothing.** Open the app and write. Notes are kept in the browser until you're ready to connect GitHub, and then they move into your repo in one go.
- **Highlight cards.** If a note contains highlights, the feed sometimes shows a single highlight in large type instead of the whole note. Tap it to open the note at that passage. Highlights saved from a book open the book at that passage. Readover counts these as highlights:
  - blockquotes (`> …`), including Obsidian callouts; a last line starting with `—` is shown as the source
  - `==marked text==`
  - list items under a heading containing *Highlights*, *Quotes*, *Excerpts* or *Clippings* (this matches Readwise and Kindle exports)
- **Books.** EPUB, PDF, MOBI, AZW3, FB2 and CBZ (DRM-free) show their cover and how far you've got, and open in a built-in reader that remembers your place on every device.
- **Shelf.** The Shelf tab lists every book across your libraries: the ones you're reading first, most recently read first, so switching between books is one tap.
- **Insights from anything you read.** Select text in a book, a PDF (one with text, not scans) or any note, and tap **Highlight**, or **Add a note** to write what you make of it. Each selection becomes its own *insight*: a small note holding the quote, where it came from and your thought, so different ideas from one book can connect to different things. Insights are saved in the library under Settings → *Your notes* → *New notes go to*, in the folder under *Highlights go to* (`Highlights/` unless you choose another; empty means the top level), named like any new note, with any tags you add. One from a book keeps a hidden link to its place, so its card opens the book at that passage. One from a note links back to it. New insights start as seeds in the garden below.
- **Clip from anywhere.** A clip is a quote, where it's from, and your thought, saved as an insight. Ways in:
  - **Android:** add Readover to your home screen, select text in any app, then **Share → Readover**.
  - **Computer:** drag *Clip to Readover* (Settings → *Clip from anywhere*) to your bookmarks bar. Select text on a page and click it.
  - **iPhone/iPad:** make the Shortcut described in Settings once. Then select text, tap **Copy**, and **Share → Readover**.
  - **Anywhere:** copy a passage, tap the pen, then **Paste a quote**.

  The capture sheet takes the quote, the source and its link, your thought, a title, and any notes to link it to. The source link opens the page at the quote. If you clip something you've already saved, Readover says so and offers to open it.
- **Highlights from other readers are an inbox.** Put a KOReader export (Markdown, or JSON in a folder with *highlights*, *koreader*, *kindle* or *clipping* in its name) or Kindle's `My Clippings.txt` anywhere in a library. Its highlights come up in the feed one at a time as **seeds**. Tap **Water** to write a thought and the seed becomes an insight. You can also open the export and select part of a highlight. Exports with more seeds waiting come up more often. Once every highlight has been taken in, the export leaves the feed (it stays in Notes). `Highlights/<Book>.md` files made by earlier versions of Readover work the same way.
- **Picks up where you left off on any device.** Favourites, hidden items, where you are in each book, what you've already seen, your list of libraries and your preferences sync through one repo you choose (your *data home*).
- **Notes: a place to work on your notes, separate from reading.** The Notes tab lets you browse by folder and search everything; full text is searched once a note is on the device, and **Download them** fetches the rest. Open a note to:
  - **edit** it;
  - **add a thought** (dated, under `## Thoughts`);
  - **link** it to another note (`[[name]]` under `## Related`, or at the cursor while editing);
  - **rename or move** it: change its title (the file name follows, keeping its date), its file name or its type. Readover first checks every note in the library for links to it, shows how many it will update, then renames the note and fixes those links in a single commit. `[[name]]`, `[[name|label]]`, `[[name#heading]]`, path links and relative Markdown links are updated; links by alias are left alone, and links from other libraries are counted but not changed. Notes whose links were updated keep their last-change date. Favourites move with it;
  - **delete** it.

  `[[Links]]` and links to other `.md` files open the linked note, and every note lists the notes that link to it. Saving is instant, even offline; changes are committed in the background, and a note that was changed elsewhere is never overwritten or deleted.
- **Works offline.** The app and everything you've already seen are cached on the device.

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
| `Highlights/YYYY-MM-DD-first-words.md` | A new insight, when you select text anywhere or save a clip. Goes to the library under Settings → *Your notes* → *New notes go to* (by default your data-home repo), in the *Highlights go to* folder, so insights live with your notes rather than in a books repo. Without GitHub, they're kept on the device. |
| Any note you edit or create | When you press **Save**. |
| `<Note> (conflict …).md` | Only if a note you edited had changed elsewhere in the meantime. |

Folders that start with a dot (`.obsidian`, `.git`, `.readover`) are never shown. To skip other folders, set **Skip these folders** on the repo.

## Keyboard

`↓`/`J` next, `↑`/`K` previous, `←`/`→` sections of a long note, `Enter` open, `S` favourite, `X` hide, `R` shuffle again, `N` new note (`Ctrl`/`⌘`+`Enter` saves it), `/` search notes, `Esc` close. Tab moves through a sheet or an open note without wandering off behind it, and closing returns you to where you were. A gamepad works too (D-pad, A to open, Y to favourite, B to close).

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
src/relink.js         Rename or move: finds and rewrites links to a note
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
- With a token, Readover asks GitHub when each note last changed (in batches, remembered until the note changes), so it can tell how recently a note was tended.
- The app talks only to GitHub, except for images a note links to on the web, which load from their own site (sent without a referrer).

## Licence of bundled libraries

See `vendor/README.md`.

### The insight format

An insight is an ordinary Markdown note, so it reads well on GitHub and in other tools:

```markdown
---
title: Attention is the rarest and purest form…
date: 2026-10-11 11:54 +0100
source: The Little Book of Attention
tags: []
---

> Attention is the rarest and purest form of generosity.
>
> — The Little Book of Attention, Chapter One: Noticing, p. 12
<!-- readover {"book":"gh:you/books|Library/Book.epub","at":"epubcfi(/6/4!/4/2,/1:13,/1:67)"} -->

Your thought, if you wrote one.
```

The comment is invisible when the file is viewed. It tells Readover where the quote came from:
- `{"book": …, "at": …}` for a book and its place (an EPUB location, or `page=N` for PDFs);
- `{"from": "<library>|<path>"}` for a note or an export;
- `{"url": …}` for a clip from the web. Clips also get `url:` (the plain page address) in their frontmatter, and a source line linking to the passage, such as `> — [Page title](https://…#:~:text=first%20words,last%20words)`. You can edit, rename or move these files freely; renaming in Readover keeps links to them working.

---

## Deployment & Production Troubleshooting Guide

### 1. Static Deployment Checklist (GitHub Pages & Static Hosts)

Readover is an entirely client-side, zero-backend progressive web app designed to run reliably on GitHub Pages, Cloudflare Pages, Netlify, or any static HTTP web server.

- [x] **Strict Relative Paths**: All script imports, CSS, and asset links in `index.html` and `manifest.json` use relative paths (`./src/...`, `./manifest.json`, `./icons/...`). This guarantees the app functions identically whether hosted at the apex domain (`https://notes.example.com/`) or under a repository subpath (`https://username.github.io/readover/`).
- [x] **Mandatory `.nojekyll` File**: GitHub Pages enables Jekyll processing by default. Jekyll ignores folders beginning with an underscore or dot, and can strip certain web files. The root `.nojekyll` file prevents Jekyll from interfering with static assets.
- [x] **Single-Page Application Fallback**: The service worker intercepts navigation requests (`req.mode === 'navigate' ? './' : req`), ensuring deep links and browser refreshes resolve correctly to the app shell without 404 errors.

---

### 2. OPDS & Calibre Remote Server CORS Configuration

When connecting Readover to self-hosted Calibre, Calibre-Web, Kavita, or remote OPDS book catalogs from a static deployment, the browser requires standard CORS (`Cross-Origin Resource Sharing`) headers to permit XML/JSON feed and blob acquisition.

#### Option A: Caddy Server Reverse Proxy (Recommended)
Add this block to your `Caddyfile` for your Calibre or OPDS catalog subdomain:
```caddy
opds.yourdomain.com {
    reverse_proxy 127.0.0.1:8083

    header {
        Access-Control-Allow-Origin *
        Access-Control-Allow-Methods "GET, OPTIONS"
        Access-Control-Allow-Headers "Authorization, Content-Type, Accept, Range"
        Access-Control-Expose-Headers "Content-Length, Content-Range, Content-Type"
    }
}
```

#### Option B: Nginx Reverse Proxy
Add the following directives inside your Nginx `location /` block:
```nginx
location / {
    proxy_pass http://127.0.0.1:8083;
    proxy_set_header Host $host;

    # CORS Headers for OPDS and EPUB streaming
    add_header 'Access-Control-Allow-Origin' '*' always;
    add_header 'Access-Control-Allow-Methods' 'GET, OPTIONS' always;
    add_header 'Access-Control-Allow-Headers' 'Authorization, Content-Type, Accept, Range' always;
    add_header 'Access-Control-Expose-Headers' 'Content-Length, Content-Range, Content-Type' always;

    if ($request_method = 'OPTIONS') {
        add_header 'Access-Control-Max-Age' 1728000;
        add_header 'Content-Type' 'text/plain charset=UTF-8';
        add_header 'Content-Length' 0;
        return 204;
    }
}
```

#### Option C: Cloudflare R2 / AWS S3 CORS Policy
If syncing your library directly from an S3-compatible bucket, apply the following CORS JSON configuration:
```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Type", "Content-Range"],
    "MaxAgeSeconds": 3600
  }
]
```

---

### 3. Progressive Web App (PWA) & Mobile Installation Matrix

Readover is fully installable across Android, iOS, iPadOS, macOS, Windows, and ChromeOS.

| Platform | Recommended Browser | Installation Method | Offline Storage Persistence |
| :--- | :--- | :--- | :--- |
| **Android** | Chrome / Brave / Edge | Tap **Add to Home screen** or **Install app** from browser menu | Automatic quota grant, supports Share Target API for quotes |
| **iOS / iPadOS** | Safari | Tap **Share** icon → **Add to Home Screen** | Automatically requests `navigator.storage.persist()`. Opening at least once every 7 days preserves local cache against WebKit ITP |
| **macOS / Windows** | Chrome / Edge | Click the **Install** icon in the address bar | Full desktop standalone window, multi-window broadcast sync |
| **ChromeOS** | Chrome | Click **Install** in address bar or launcher | Persistent local IndexedDB offline storage |

---

### 4. Diagnosing Stale Service Worker Cache & Startup Errors

#### The Symptom: "The page loads, but is blank or click events do not respond"
In JavaScript ES modules, a `SyntaxError` during initial script evaluation is fatal: it halts JavaScript execution before `app.js` runs any event listeners, leaving buttons unresponsive.

This almost always occurs in offline-first static deployments when a Service Worker has cached an older version of one module (e.g. `attachments.js`), while the rest of the application imports a newer export from it.

#### Mitigations Implemented in Readover:
1. **Service Worker Version Bump (`readover-shell-v4.0.0`)**: Ensures existing devices immediately detect a cache mismatch and flush older cached scripts.
2. **Interactive Update Notification Banner**: When a newer Service Worker installs in the background, a non-intrusive floating banner appears with **Update now**, allowing instant one-tap refresh.
3. **Boot-Time Script Error Trap (`#boot-error-boundary`)**: If an unhandled syntax or network error occurs before `app.js` finishes loading, Readover intercepts it and renders a clean recovery card with a **Clear cache & reload** button.
4. **Built-in System Diagnostics Suite**:
   - Press **`Ctrl + Shift + U`** or **`Ctrl + Shift + D`** (or open **Settings → Run system diagnostics**).
   - Runs live tests for IndexedDB storage health, WebKit persistence, OPDS parsing, WCAG AA compliance, and cross-tab BroadcastChannel communication.

---

### 5. Automated Test Stack & Module Linkage Verification

To mathematically prevent runtime syntax errors (`Uncaught SyntaxError: does not provide an export named ...`) and ensure zero boot-time crashes before shipping, Readover includes a multi-layered automated verification stack:

```bash
# Run the entire test suite (all 11 unit & regression tests + headless cold boot)
npm test

# Run the lightning-fast static AST module linkage checker
npm run test:ast

# Run the headless browser cold-boot assertion in JSDOM
npm run test:boot
```

#### Layer 1: Static AST Linkage Checker (`test-ast-linkage.js`)
- Uses `acorn` to parse the Abstract Syntax Tree of every JavaScript module across `src/` and `sw.js`.
- Recursively tracks all `export`, `export default`, star re-exports (`export * from '...'`), and named re-exports (`export { a as b } from '...'`).
- Validates that 100% of static named imports (`import { x } from '...'`), default imports, and dynamic literal imports (`import('...')`) target valid files and exported identifiers.
- Runs in milliseconds without browser overhead, guaranteeing complete export-import contract fidelity at development and commit time.

#### Layer 2: Headless DOM Cold-Boot Assertion (`test-cold-boot.js`)
- Loads the exact production `index.html` inside `jsdom` with real DOM hierarchy, custom events, CSS queries, and storage shims.
- Dynamically imports `src/app.js` and all UI controllers (`reader.js`, `settings.js`, `compose.js`, `shelf.js`, `notes.js`, `diagnostics.js`, `opds.js`, `sheet.js`, `growth.js`, `capture.js`).
- Evaluates the entire startup sequence all the way through to initial DOM paint, guaranteeing that all controllers attach cleanly without throwing unhandled exceptions or missing browser API errors.

