# Readover

Your notes, highlights and books as a full-screen feed: one thing at a time, in a new order every time you open it.

Note apps are built for writing. Readover is built for re-reading. It points at the Markdown notes you already keep in GitHub (or a folder on your device) and turns them into a swipeable feed. Old notes you had forgotten come round again, highlights from books show up on their own, and anything worth keeping close gets a star.

Everything runs on GitHub: the app is a static site on GitHub Pages, your notes stay in your repos, and favourites and highlights are saved back to those repos as plain files. There is no server, database or build step to look after.

## What it does

- **Random feed.** Each time you open the app it shuffles. Items you haven't seen for a long time, or have never seen, come up more often. Favourites get a small boost.
- **Highlight cards.** If a note contains highlights, the feed sometimes shows a single highlight in large type instead of the whole note. Tap it to open the note at that passage. Readover counts these as highlights:
  - blockquotes (`> …`), including Obsidian callouts; a last line starting with `—` is shown as the source
  - `==marked text==`
  - list items under a heading containing *Highlights*, *Quotes*, *Excerpts* or *Clippings* (this matches Readwise and Kindle exports)
- **Books.** PDFs and EPUBs show their cover and how far you've got. They open in a built-in reader that remembers your place.
- **Highlight while you read.** In an EPUB, select text and tap **Highlight**. It is added to `Highlights/<Book title>.md` in your repo, so it comes back in the feed later.
- **Favourites and hidden items sync across devices.** They are saved to `.readover/state.json` in each repo (this needs a token with write access).
- **Edit and capture.** You can edit a note in place, or add a quick note. Each save is a commit.
- **Works offline.** The app and everything you've already seen are cached on the device.

## Set up (about five minutes)

1. **Put the app on GitHub Pages.** Fork or push this repo, then go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**. The workflow in `.github/workflows/pages.yml` deploys every push to `main`. You can also choose *Deploy from a branch*; it still works, but deploys will take one extra visit to show up.
2. **Open the site** (`https://<you>.github.io/readover/`) and choose **Add a GitHub repo**. You can type `owner/repo` or paste a GitHub link, including a link to a folder.
3. **Add a token** if your notes repo is private, or if you want favourites, highlights and edits to sync. Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new):
   - Repository access: *Only select repositories* → your notes repos
   - Permissions: **Contents: Read and write** (Metadata: read-only is added automatically)

   Paste it under **GitHub token** in Settings. It is stored only in that browser.
4. **Install it.** On a phone, use *Add to Home Screen* so it opens full screen.

Public repos work without a token. Readover reads their files from `raw.githubusercontent.com`, which isn't subject to GitHub's 60-requests-an-hour limit for anonymous use.

### Local folders

**Open a folder** reads `.md`, `.txt`, `.pdf` and `.epub` files from a folder on the device.

| Browser | How it works |
| --- | --- |
| Chrome, Edge (desktop and Android) | Live folder access. Rescan with **Sync**. Notes can be edited, and highlights saved, back into the folder. After a restart the browser asks once for permission again. |
| Safari, iOS, Firefox | The folder is copied into the app's storage. Use **Re-import** to pick up changes. Read only. |

## Files Readover writes to your repo

| Path | When |
| --- | --- |
| `.readover/state.json` | When you star or hide something. Plain JSON, sorted, so diffs are easy to read. |
| `Highlights/<Book>.md` | When you highlight in an EPUB. |
| Any note you edit or create | When you press **Save**. |

Folders that start with a dot (`.obsidian`, `.git`, `.readover`) are never shown. To skip other folders, set **Skip these folders** on the repo.

## Keyboard

`↓`/`J` next, `↑`/`K` previous, `Enter` open, `S` favourite, `X` hide, `R` shuffle again, `N` new note, `Esc` close. A gamepad works too (D-pad, A to open, Y to favourite, B to close).

## How it's built

Plain ES modules, no build step. The heavy libraries are loaded only when needed and are served from this repo (`vendor/`), so the app depends on nothing outside GitHub.

```
index.html            App shell and sheets (native <dialog>)
sw.js                 Offline cache. Its version is stamped with the commit SHA on deploy
src/app.js            Feed, card actions, sync orchestration, keyboard and gamepad
src/feed.js           Weighted shuffle
src/library.js        Sources: sync, read, write, favourites stored in the repo
src/store.js          One IndexedDB database for every source, plus settings
src/markdown.js       Markdown parsing, sanitising and highlight extraction
src/covers.js         PDF and EPUB covers and metadata
src/sources/github.js GitHub REST API (trees, blobs, contents)
src/sources/local.js  File System Access API, with an import fallback
src/ui/*              Cards, note reader and editor, settings, new note, overlay stack
src/viewers/*         PDF (pdf.js) and EPUB (epub.js) readers
vendor/               marked, DOMPurify, pdf.js, epub.js, JSZip, Literata (see vendor/README.md)
```

Syncing a repo makes one API call to list every file (the Git trees API). Note text is fetched when a card is about to appear and is cached by blob SHA, so unchanged notes are never downloaded twice. Books are cached the same way.

### Run it locally

```
python3 -m http.server 8000
```

Then open http://localhost:8000. Service workers and the folder picker both work on `localhost`.

## Security notes

- Your token sits in this browser's `localStorage`, as with any static site that talks to GitHub directly. Keep it fine-grained and limited to your notes repos.
- Note content is sanitised (DOMPurify) before it's shown, so a note can't run script on the page that holds your token.
- The app makes no network requests except to GitHub.

## Licence of bundled libraries

See `vendor/README.md`.
