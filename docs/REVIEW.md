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
- **Web articles** were tried (a whole-page bookmarklet, Readability and Turndown) and then removed. In real use they captured only fragments of pages, and saving whole articles works against the point of the app. They are replaced by clips (a quote, its source, and your thought) in the garden plan.

## The garden plan (agreed October 2026)
The full spec is in the project's design notes. In short: every note is an atomic insight that carries your own writing. Selecting text anywhere creates one. Notes grow from seed to sprout, sapling and tree through thoughts and connections; growing types show health (healthy, thirsty, wilting) on an honest clock; pruned notes move to `Archive/`.

Built so far:
1. **Groundwork.**
   - A real frontmatter parser (`src/notefile.js`).
   - New notes named `YYYY-MM-DD-title-words.md`, with `title`, `date`, `type` and `tags` frontmatter.
   - Titles resolved from frontmatter, then the first heading, then the file name.
   - Types, inferred when missing.
   - Links written as `[[file-name|Title]]`.
   - Whole-article saving removed.
2. **Insights from any selection.**
   - Selecting text in a book, a PDF or any note creates one insight note (`src/insights.js`): the quote, the source, a hidden anchor, and your thought.
   - One shared sheet for saving them, with an editable title.
   - KOReader/Kindle exports and the older grouped `Highlights/<Book>.md` files are an inbox. Their highlights show as seed cards with **Water**, a highlight counts as taken in once any note quotes it, and an export with nothing left leaves the feed.
   - Settings → *New notes go to* (a library and a folder) is used by new notes and insights. (Stage 7 splits this: a library for new notes, and a highlights folder.)
   - The separate 1/3/7-day return for book highlights is retired; insights follow the new-note review schedule.
3. **Capture.**
   - Clips arrive at `#clip?text&url&title` (bookmarklet, iOS Shortcut) or `?title&text&url` (the Android share target).
   - `src/clip.js` tidies them (it separates a quote from the link Android appends), builds text-fragment links to the passage, and writes the selection-only bookmarklet.
   - The capture sheet (`src/ui/capture.js`) takes the quote, source, link, thought, title and **Link to a note**. It flags quotes already saved.
   - **Paste a quote** in the new-note sheet.
   - Settings → *Clip from anywhere*, with a guide for each device.
4. **The growth engine** (nothing visible yet; it is shown in stage 5).
   - `src/garden.js` works out each note's stage and health:
     - **Stages:** seed, sprout, sapling, tree, plus pruned, pending and inbox.
     - **Health:** healthy, thirsty or wilting for growing types; none for finished types.
     - **Thoughts:** own words outside `## Thoughts`/`## Related`, plus dated entries.
     - **Connections:** distinct links in and out, leaving out quote source lines and pruned notes.
     - **Thresholds:** one `THRESHOLDS` block.
   - `src/clock.js` is the honest clock: when each note last changed.
     - **GitHub:** GraphQL in batches of 50, falling back to one REST request per note (up to 1,000 per app open).
     - **Local folders and this device:** from the file version.
     - Results are cached per version. A commit made by Readover records its own time.
   - "Download them" now also refreshes notes whose cached copy is out of date.
5. **Growth in the app.**
   - **Tags on every card and in the reader:** stage icon, time since tended and health colour; a second line (type · status) for essays, poems and stories; resting notes show when they were last read.
   - **Water:** a one-line field on cards adds a dated thought.
   - **The tag sheet:** stage ladder, thoughts, links, time since tended, Water, Graft, Prune, plus status and published link for writing.
   - **Prune and Replant:** Prune moves the note to `Archive/` with `pruned:` and `pruned_from:` in one commit (moves can now carry a frontmatter change). Replant moves it back.
   - **Writing:** a status for essays, poetry and fiction (idea, draft, revising, done, submitted, published), set in the new-note sheet or tag sheet, plus `canonical_url:` for the published version. Done, submitted and published pieces, and journal entries, rest instead of wilting.
   - **The feed:** weighted by thirst (×1 to ×2) and leaves out pruned notes. The 1/3/7/21-day review schedule, its "You wrote this…" lines and the app badge are retired.
6. **Filters and sorting.**
   - `src/filters.js` defines growth filters (Seeds, Needs water, Wilting, Trees, Resting, Pruned) and type filters (each type plus Unfinished writing), shared by the feed and Notes, with counts.
   - **What to show:** adds Growth and Type, and the chip names what's active.
   - **Notes:** a Sort menu (Folders, Newest, Oldest, Recently tended, Least tended) and a Filter sheet; sorted or filtered views are one flat list.
   - **Rows:** each shows a small growth tag and the note's date.
   - **Welcome card:** no longer promises a review schedule.
7. **Folders as types, one status, simpler notes** (stage 7a, v3.8).
   - **Types are top-level folders** (`typeOf` in `src/notefile.js`); subfolders inherit them, the top level is Unsorted, `Archive/` and dot-folders aren't types. `type:` is no longer written or read for this, and nothing is guessed. A pruned note keeps the type of the folder it came from.
   - **Status:** `status: done` rests; no status is in progress. Old `submitted`/`published` count as done. Writing lifecycles, folder behaviours, Fragment/Note/Auto and the Unfinished writing filter are gone. Any note can have a published link.
   - **New notes:** optional title (the first words name the file otherwise); a type picker of the library's folders plus Unsorted and **New type…** (hidden, with a quiet link instead, when there are no folders); In progress/Done, remembered per folder on the device; Tags. A note started inside a subfolder stays there.
   - **Insights and clips:** a Tags field; saved to Settings → *Your notes* → *Highlights go to* (`Highlights/` by default, empty = top level). Insights no longer write `type:`; the inbox test uses `date:` instead.
   - **Filters:** a checklist of folders (plus Unsorted) with counts in What to show and Notes, combinable; growth filter *Done* replaces Resting. Notes not yet downloaded pass a type filter.
   - **Settings:** a *Your notes* section with two folded guides, *Organising your notes* and *How the garden works*.
   - **Moves keep the clock:** a note moved or renamed elsewhere with the same content (same blob sha) keeps its last-change date and cached copy; a plain move in Readover keeps it too, while queued and after.
   - Fixed: the Note field in the new-note sheet had picked up the growth tag's pill styles (`.grow` class clash).
8. **Rename or move, with links** (stage 7b, v3.9).
   - **The sheet** (a note's ⋯ menu): Title, File name (follows the title and keeps a date prefix; plain names stay plain), Type (every folder, Unsorted, New type…). Title only, same file name: just a retitle, where the title came from (frontmatter, or the first heading).
   - **`src/relink.js`:** `planRename(item, {newPath, newTitle})` downloads nothing itself; the sheet fetches the library's missing notes first ("Checking links…"), then shows "Updates N links in M notes", the list, and links from other libraries that won't change. Only links that resolve to this exact note are rewritten. Title links change only if the title does and keep their words (`[[new-name|Old words]]`); a label equal to the old title becomes the new one; alias links stay.
   - **One commit:** `outbox.queueRename` carries the move plus each linking note as exact string substitutions. If a note changed elsewhere first, the substitutions are applied to the newer text. Linking notes keep their clock; the renamed note does too unless retitled. Edits made after a queued rename wait for it (`after`), instead of becoming conflict copies.
   - **Local folders and this device:** the same changes, file by file.

## Quality check before release (October 2026, v3.9)
An audit of every screen and sheet at 320, 390, 768 and 1280 px, light and dark, with axe-core (WCAG 2.2 AA plus best practice), a keyboard walkthrough, and a new journeys suite (`journey-test.mjs`). Fixed:
- **Contrast:** the faint and muted text colours (tab labels, dates, file paths, hints) were below 4.5:1 in both themes; now they pass. The wilting tag text too.
- **Overflow:** long unbroken titles, paths and names ran past the screen in cards, the reader and Notes; they wrap now. Tables keep readable columns and scroll sideways. On 320 px phones the top bar pushed Settings off-screen, and paired fields cramped; the chip shrinks and fields stack.
- **New-note sheet:** with type, status and tags it had grown past the screen, hiding Save; the note box now gives way so everything fits, and Save stays in reach. Ctrl/⌘+Enter saves.
- **Keyboard:** Enter on a focused button opened the current card instead of pressing the button. Tab escaped an open note into the page behind; readers now keep focus inside and give it back to what opened them. Wide code blocks and tables can be reached and scrolled by keyboard.
- **Touch targets:** the sync dot, checkbox and disclosure rows meet 24 px.
- **Notes rows:** previews showed raw `[[links]]` and image markup.
- **Rename:** a clash with an existing note is shown before Save, not after; notes that couldn't be downloaded to check (offline) are named, instead of the preview quietly saying there's nothing to update.
- **Libraries that are one folder of a repo:** insights and notes moved from this device landed outside the library (at the repo's top); they go inside it now.
- **Moving device notes to GitHub** reset every note's clock; they keep it now.

## Still open
- **Search via a GitHub Action in the notes repo.** A workflow building `.readover/index.json` on push would make full-text search instant on a new device, without downloading every note.
- **A broken-links check** in Notes, for links left behind by renames made outside Readover (agreed for later).
- **Learning that follows you across devices.** It's per-device by design for now.
