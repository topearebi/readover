# Readover review and refactor (October 2026)

What was wrong with v2, what changed, and what's worth doing next. The constraint throughout: **everything runs on GitHub and GitHub Pages**, with nothing else to maintain.

## Bugs found in v2

### Broken core flows
1. **"All Sources", the default view, didn't load.** Cards called `getReadingProgress()` and `getCachedThumbnail()` with no source, which threw *Database not initialized* whenever no single vault was active. Each failed card was swallowed, so the feed came up empty. Note text was fetched through the *active* vault's config, so in aggregate mode it came from the wrong repo or failed.
2. **Sync in "All Sources" threw** *No active vault configured*: `syncRepoManifest()` looked up the vault id `ALL_SOURCES`.
3. **PDF covers never rendered.** `extractPdfCover(path, blob, sourceId)` passed the source id as `targetWidth`, which gave a `NaN` scale. Covers and reading progress were also written to whichever database happened to be active.
4. **The feed wasn't random.** It was sorted least-recently-seen first. On a fresh install every item ties at 0, so you got repo tree order: the same alphabetical opening every time.
5. **Books didn't work from local folders on Safari, iOS or Firefox.** The fallback import kept only text, and after a reload nothing opened.

### Security
6. **Notes were rendered as unsanitised HTML** while a full-`repo`-scope token sat in `localStorage`. A note containing `<img onerror=…>` (from a shared or cloned repo, for example) could read the token.
7. The setup asked for a **classic PAT with `repo` scope**, which covers every repo you own.

### UX and platform
8. `user-select: none` was set on everything, so you couldn't select text anywhere. That's a real problem in a reading app.
9. Zooming was disabled (`maximum-scale=1, user-scalable=no`).
10. The header background was invalid CSS (`rgba(var(--card-bg), .88)` with a hex variable), so it was transparent.
11. **Gamepad polling ran `requestAnimationFrame` forever** on every device, draining battery.
12. Escape hid the PDF and EPUB readers without tearing them down. The documents stayed in memory, and arrow keys kept turning pages in the hidden EPUB.
13. Every deploy **force-reloaded the page** through `controllerchange`, even mid-reading. The cache version also had to be bumped by hand.
14. Favourites lived only in one browser, so they were lost if storage was cleared and differed between phone and laptop.

### "Runs on GitHub" violations
15. Five outside hosts at runtime: jsDelivr, esm.sh, Google Fonts (×2), and two different copies of PDF.js from two CDNs. The PDF worker was even fetched and re-wrapped as a blob URL.
16. Unauthenticated public repos spent one API call per note, against a 60-per-hour limit.

### Smaller issues
- The README described swipe-left/right triage that no longer existed.
- The manifest declared `file_handlers` with no `launchQueue` code behind them.
- The "maskable" icon was an SVG labelled 512×512, and there was no PNG for iOS.
- `getDBForSource()` built a new Dexie instance on every call.

## What changed

### Architecture
- **One IndexedDB database** (`readover`) for all sources, with every record keyed `sourceId|path`. There is no "active database" any more, which removes bugs 1–3 at the root. A ~60-line IndexedDB helper replaces Dexie.
- **Source adapters** (`sources/github.js`, `sources/local.js`) take the source config explicitly. `library.js` is the only module that knows about sources.
- **Weighted shuffle** (`feed.js`). Every open gets a new order. Weight rises from 0.15 for items seen today to 4 for items unseen for about three months or never seen; favourites get ×1.4. An item counts as seen after 1.5 seconds on screen.
- **Cards hydrate lazily.** A skeleton shows straight away and content loads as the card nears the screen, so the feed appears instantly from cache, and a background sync later reshuffles only what's still to come.
- **All dependencies are vendored** in `vendor/<name>-<version>/` and loaded only when needed: PDF.js for PDFs, epub.js and JSZip for EPUBs. fflate is gone because JSZip already reads covers.
- **Publishing from a branch with no version bump.** The service worker checks the app's files online first (falling back to the cache after 1.5 s), so a push to `main` is live on the next open. Libraries live in version-named folders and are cached permanently. Nothing reloads the page under you.
- **Overlay stack tied to browser history.** Android back, Escape and close buttons all behave the same and clean up properly.
- **Existing setups are migrated** on first run: v2 repo profiles, the token, local folder handles and favourites carry over, and the old per-vault databases are deleted.

### Features aligned with the brief
- **Highlights surface on their own, like Readwise:** blockquotes, `==marks==`, and lists under a *Highlights* heading (Readwise and Kindle export format).
- **EPUB highlighting** writes to `Highlights/<Book>.md` in your repo. Those highlights then come back in the feed as highlight cards, which closes the loop from reading to recall.
- **Favourites and hidden items sync through `.readover/state.json`** in each repo. Local changes are queued, survive going offline, and are merged with one retry on conflicting writes.
- **Hide** removes something from the feed (with Undo), and the **Hidden** view brings it back.
- **Relative images** in notes (`![](img/x.png)`) load from the same repo or folder.
- **Repo options:** paste any GitHub link (including `/tree/branch/folder`), limit to one folder, skip folders, detect the default branch automatically.
- **Public repos without a token** read from `raw.githubusercontent.com`, so they don't count against the anonymous API limit.
- **iOS and Safari folder import** copies files into the app's storage, so books open after a reload.

### Design
Read-first. The feed is the whole screen. Chrome is reduced to a wordmark (tap it to reshuffle), a scope chip, a favourites toggle and settings. The "+ new note" button is gone from the feed; capture lives behind `N` and the empty state.

- **Palette:** sage-grey paper and a green-black "reading lamp" dark theme, with one ink-green for actions and one highlighter yellow. The highlighter is the only loud element. It appears as a real swipe behind each line of a highlight card, and in the book reader.
- **Type:** Literata (bundled) for everything you read; the system sans for controls.
- **Light, dark or match device**, applied before first paint.
- Native `<dialog>` sheets, visible focus, reduced-motion support, and zoom allowed.

## Built since this review (October 2026)
1. **Publishing from a branch.** No Action and no version number; app files are checked online first, falling back to the cache.
2. **Sync between devices** through a data-home repo (`.readover/`), with per-entry merging, one commit per sync, and a save queue for edits that writes conflict copies instead of overwriting.
3. **Starting fresh:**
   - notes kept on the device;
   - a review schedule for new notes;
   - a gentle nudge, with a guided move to GitHub.
4. **Books:**
   - foliate-js (EPUB, MOBI, AZW3, FB2, CBZ);
   - PDF highlights via the text layer;
   - highlights with notes and anchors back to the passage;
   - the Shelf;
   - KOReader and Kindle exports.
5. **The Notes area:**
   - search, links and backlinks;
   - add a thought;
   - rename and move;
   - deleting a note, but never one that changed elsewhere.
6. **Engagement:**
   - section carousels for long notes;
   - a feed that learns on the device;
   - "On this day" and "From N years ago";
   - highlights coming back after 1, 3 and 7 days;
   - "Connected" cards;
   - an optional break card, today's count, and an app badge.

## After first real use (October 2026)
- **Editor fixed.** The edit box was two lines tall and scrolled to the last line, inside a scrolling page. It now grows to fit the note, so the page has one scroll area, and it opens at the top.
- **Linking without knowing the title.** The picker:
  - suggests *Similar notes* (shared distinctive words, title words counting more) and says which words they share;
  - searches the full text, with the matching passage shown;
  - previews a note when you tap it;
  - marks notes already linked.
- **Settings, shorter.**
  - The token is now a *GitHub account* section at the top. Readover checks it and shows whose it is.
  - Adding a repo asks only for the repo. Branch, folder, name and a per-repo token sit under *More options*.
  - Every explanation is cut to a line, and step-by-step help is folded away.
- **Web articles.** These are saved as Markdown notes via a bookmarklet, the Android share sheet, or pasting.
  - Mozilla Readability and Turndown are vendored for this.
  - Highlights work as they do in books and are saved to `Highlights/<title>.md`, with anchors back to the passage.
  - The page is never executed. It is parsed, converted, and sanitised again when shown.

## Still open
- **Saved `.html` files in a library**, read through the same article converter.
- **Fetching an article from a link alone.** The browser can't read other sites without their permission (CORS). A GitHub Action in the notes repo could fetch links pushed to an inbox file, keeping to "GitHub only", at the cost of one more setup step.
- **Search via a GitHub Action in the notes repo.** A workflow building `.readover/index.json` on push would make full-text search instant on a new device, without downloading every note.
- **Updating links when a note is renamed.** Today Readover warns that old `[[links]]` need updating; it could offer to rewrite them in one commit.
- **Learning that follows you across devices.** It's per-device by design for now.
