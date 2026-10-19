# Readover Design Notes & Reference Log

This document serves as the running, architectural record and design specification log for Readover. It details technical rationale, component behaviors, accessibility requirements, data flows, trade-offs, and open product questions across each engineering milestone.

---

## 1. Icon Geometry, Visual Symmetry & Book Card Presentation

### Architectural & Design Decisions
- **Droplet SVG ViewBox Normalization**: In `index.html` (`#i-drop`), replaced asymmetric path coordinates with a mathematically centered, symmetrical teardrop geometry inside an explicit `viewBox="0 0 24 24"` with `preserveAspectRatio="xMidYMid meet"`.
- **Strict Aspect-Ratio Preservation in CSS**: Added explicit square constraints (`width: 20px; height: 20px; aspect-ratio: 1 / 1; flex-shrink: 0;`) across `.water-btn svg`, `.rail .water-btn svg`, and `.reader-dock-btn svg` in `src/style.css`.
- **Trade-off**: Enforcing `aspect-ratio: 1 / 1` in CSS overrides any non-square viewBox inheritance from third-party icon libraries, ensuring geometric fidelity at the cost of requiring explicit width/height definitions.

### UI/UX & Component Behavior
- **Multi-Line Title Wrapping**: Removed `white-space: nowrap;` and `text-overflow: ellipsis;` from `.card-book-title`, replacing it with `-webkit-line-clamp: 2`, `display: -webkit-box`, `-webkit-box-orient: vertical`, and `overflow-wrap: break-word; word-break: break-word; hyphens: auto;`.
- **Centered Cover Spine Container**: Configured `.card-book-cover` as a centered flex container (`display: flex; align-items: center; justify-content: center; overflow: hidden; background: var(--bg-card); min-width: 48px; max-width: 64px; aspect-ratio: 2 / 3;`). Book spine and cover art maintain a standard 2:3 trade ratio without stretching or letterboxing distortion.
- **Empty & Error Cover States**: When no cover image exists, a fallback botanical book glyph is rendered with contrast ratio $\ge 4.5:1$ against the card surface.
- **Accessibility (WCAG 2.2 AA)**: Hit target for cards adheres to minimum $48\times 48\text{px}$ touch targets. Cover images specify `alt=""` and `aria-hidden="true"` when paired with text titles to avoid redundant screen reader announcements.

### API & Data Flow
- Book metadata extracted from EPUB packages or PDF catalog objects is cached in `store.items` (IndexedDB). Title strings undergo whitespace normalization (`title.trim().replace(/\s+/g, ' ')`) before card rendering.

### Open Questions & Assumptions
- *Assumption*: Maximum title clamp of 2 lines is sufficient for mobile viewports without truncating essential edition or author subtitles.
- *Review Item*: Verify whether large CJK titles require specialized word-breaking or line-breaking rules.

---

## 2. Distraction-Free Note Reader & Action Dock Stacking Context

### Architectural & Design Decisions
- **Isolated Reading Surface**: When an individual note is opened in `openNote()`, global application navigation tabs (`nav.tabbar` containing Feed, Shelf, Notes) are suppressed via both DOM state (`tabbar.classList.add('hidden')` / `tabbar.setAttribute('aria-hidden', 'true')`) and CSS (`body.is-reading .tabbar { display: none !important; }`).
- **Stacking Context Hierarchy**:
  - Global base content: `z-index: 1`
  - Overlays & sheets: `z-index: 1000`
  - Floating Note Action Dock (`.reader-dock`): `z-index: 1100; position: fixed; bottom: calc(env(safe-area-inset-bottom, 16px) + 16px); left: 50%; transform: translateX(-50%);`
  - Dialog / Modal Sheets: `z-index: 2000`
- **Safe-Area Padding**: Added `padding-bottom: max(96px, calc(env(safe-area-inset-bottom, 16px) + 80px))` to `.reader-scroll` to guarantee reflection text and footnotes are never occluded by the floating action dock.
- **Trade-off**: Suppressing global tabs during note reading enforces an immersive focus mode, requiring explicit Back navigation or Escape keys to return to the feed.

### UI/UX & Component Behavior
- **Action Dock Touch Ergonomics**: Dock actions (Water, Graft, Edit) maintain a minimum $44\times 44\text{px}$ touch hitbox with $8\text{px}$ inter-button margins.
- **Keyboard Navigation & Focus Trapping**:
  - `Escape`: Closes the topmost reader overlay or returns to prior view.
  - Long-press / Hold-to-Escape: Pressing Escape or back navigation for $> 300\text{ms}$ unwinds deep reflection chains back to garden root.
  - Tab order circles through note header, body text, and dock buttons.
- **Safe-Area Adaptability**: On mobile devices with dynamic island or home gesture bars, bottom margin responds dynamically to `env(safe-area-inset-bottom)`.

### API & Data Flow
- `openNote(item, { starred, onStar })` mounts `.reader` into document body, binds `.reader-dock`, and pushes state to history stack.
- Dock buttons dispatch granular events (`readover:water`, `readover:graft`, `readover:edit`), triggering immediate local mutations and debounced sync queue pushes.

### Open Questions & Assumptions
- *Assumption*: Users prefer single-step unwind on quick tap, and full root unwind on sustained press.
- *Review Item*: Confirm whether mobile gesture swipes (swipe right to pop reader) should be enabled globally across all WebKit touch surfaces.

---

## 3. Mutable Storage Provider Configuration (In-Place Edit Workflow)

### Architectural & Design Decisions
- **Immutable Source Limitation Removed**: Prior to this milestone, connected libraries (Dropbox, GitHub, WebDAV, Local Folder, S3/R2) could only be added or deleted. Deleting a library wiped local index caches and progress keys.
- **Dedicated Edit Surface (`#edit-source-sheet`)**: Introduced a non-destructive edit modal that updates connection metadata in place while preserving immutable database keys (`source.id`).
- **Separation of Identity vs. Parameters**:
  - Immutable: `id` (e.g. `dbx_1729...`), `type` (e.g. `dropbox`).
  - Mutable: `name` (user-friendly label), `token` / `credentials` (access token, app secret, password), `path` / `root` (targeted subfolder), `endpoint` / `bucket` (for S3/R2).
- **Trade-off**: Preserving `source.id` allows reading metrics and bookmark IDs to stay linked, but requires cautious handling of changed root paths to avoid orphan cache entries.

### UI/UX & Component Behavior
- **Form State Pre-Population**: Clicking **Edit** (`button.btn-edit-source[data-source-id]`) fetches the source record from `store.getSources()`, populates input values, and displays provider-specific input fields dynamically.
- **Credential Visibility Toggle**: Password and secret token fields include an `#i-eye` toggle button with `aria-label="Toggle password visibility"` and `aria-pressed="false|true"`.
- **Real-Time Validation & Disabling**: The Save button is disabled while required connection fields (display name, endpoint, auth token) are empty or malformed.
- **Loading & Error Feedback**: Saving triggers an immediate connectivity health check. If validation fails, an inline error notification renders inside `#edit-source-error` without closing the dialog.

### API & Data Flow
- `openEditSource(sourceId)` $\rightarrow$ loads source from `store.js` $\rightarrow$ binds submit handler $\rightarrow$ invokes `store.saveSource(updated)` $\rightarrow$ triggers `library.updateSource(updated)` $\rightarrow$ dispatches `readover:sources-changed` event $\rightarrow$ refreshes settings rows and shelf.
- Local blob cache keys (`${sourceId}:${path}`) remain valid unless the subfolder root path was altered.

### Open Questions & Assumptions
- *Assumption*: When a user edits a cloud library's subfolder path, existing local cache items should be re-indexed during the subsequent sync cycle rather than wiped immediately.
- *Review Item*: Design a background cache migration prompt when a user changes the target path of a large connected library (> 500 MB).

---

## 4. Media Destination Clean Labeling & Path Construction

### Architectural & Design Decisions
- **Separation of Storage Target from Folder Path**: In the Settings sheet under *Media & Diagram Vault*, option labels previously hardcoded `/attachments/` into the dropdown text (e.g., `Dedicated Dropbox /attachments/ (Dropbox (Abdullahi Arebi))`), while an adjacent text input allowed customizing the subfolder name. This led to user confusion and concatenated path bugs (`/attachments/attachments/photo.webp`).
- **Clean Dropdown Model**: The destination dropdown (`#attachments-source-select`) represents strictly the storage provider name and destination identity (`Same library as note`, `Local device only`, or specific cloud source `Dropbox (Work)`).
- **Path Construction Authority**: The folder text input (`#attachments-folder-input`) is the single source of truth for the subfolder path (default: `attachments`).
- **Trade-off**: Requiring the user to define folder paths in an input field rather than baking them into library names adds one setting, but eliminates path duplication and ambiguous mental models.

### UI/UX & Component Behavior
- **Dynamic Explanatory Copy**: Beneath the dropdown and input fields, a live preview element (`#attachments-path-hint`) renders real-time path interpolation:
  - If set to `Same library as note` and folder `assets`: `Images will save alongside notes in /[note-folder]/assets/`
  - If set to dedicated `Dropbox` and folder `_media`: `Images will save in Dropbox at /_media/`
- **Sanitization & Normalization**: Path inputs automatically strip leading/trailing slashes (`/`), duplicate slashes (`//`), and illegal characters (`\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`) on blur.

### API & Data Flow
- Module `src/attachments.js` exports:
  - `buildAttachmentPath(filename, { notePath, folder, sourceId })`: constructs normalized POSIX paths.
  - `resolveAttachmentSource(item, prefs)`: resolves target storage provider.
- `store.saveAttachment(blob, filename, noteItem)` writes binary payloads directly to the resolved target without intermediate base64 bloat.

### Open Questions & Assumptions
- *Assumption*: Standard default folder name `attachments` satisfies 95% of Obsidian and Markdown PKM workflows.
- *Review Item*: Verify whether users want date-formatted attachment subfolders (e.g., `attachments/YYYY-MM/`).

---

## 5. Remote Binary Upload Defense & Byte-Parity Contract

### Architectural & Design Decisions
- **The 0-Byte Ghost Upload Problem**: When ingesting books (EPUBs, PDFs) designated for remote cloud storage (Dropbox, S3, WebDAV), reader pipelines historically extracted metadata and covers using the original `Blob` stream. When the cloud sync adapter subsequently attempted to upload the blob, the stream was either consumed, detached, or passed through an empty buffer, committing a 0-byte ghost file to the remote server.
- **Fail-Fast Byte Length Pre-Flight**: Created dedicated binary validator [`src/utils/binary.js`](file:///home/ta/workspace/readover/src/utils/binary.js):
  - `validateBinaryPayload(payload, minBytes = 1)`: checks for non-null, valid `Blob`, `File`, `ArrayBuffer`, or `Uint8Array` instances with `byteLength > 0`.
  - `cloneBlob(sourceBlob)`: duplicates binary blobs via `sourceBlob.slice(0, sourceBlob.size, sourceBlob.type)` before passing streams to Foliate-js or PDF.js parser engines.
- **Remote Verification & Shelf Rollback**: Cloud storage providers (`dropbox.js`, `s3.js`, `webdav.js`) verify remote response payloads. If the committed remote file size reports 0 bytes, the upload is aborted, an exception is raised, and the local shelf transaction rolls back to prevent corrupted cloud state.
- **Trade-off**: Cloning blobs before ingestion consumes transient memory equal to file size during upload, but guarantees stream availability and zero-byte protection.

### UI/UX & Component Behavior
- **Ingestion Progress & Error Toasts**:
  - During upload: progress status displays `Uploading [book-title] (X.X MB)…`.
  - On 0-byte or network failure: toasts `Upload failed: Empty payload or connection dropped. Local copy retained.`
  - Shelf UI marks failed remote uploads with a retry indicator chip rather than removing the user's book locally.

### API & Data Flow
- Pipeline: User drops EPUB $\rightarrow$ `handleIncomingBookFile(file)` $\rightarrow$ `validateBinaryPayload(file)` $\rightarrow$ `cloneBlob(file)` for cover/metadata parse $\rightarrow$ `store.blobs.put(file)` $\rightarrow$ `cloudAdapter.upload(path, file)` $\rightarrow$ provider response assertions (`res.size === file.size`) $\rightarrow$ commit shelf catalog.

### Open Questions & Assumptions
- *Assumption*: Books larger than 250 MB should be rejected on mobile WebKit to prevent tab crashes due to RAM exhaustion during binary cloning.
- *Review Item*: Investigate `FileSystemWritableFileStream` chunked streaming for ultra-large PDF documents.

---

## 6. Shelf & Book Asset Management System

### Architectural & Design Decisions
- **Parity with Notes Management**: Previously, Notes had rich multi-select, migration, and export capabilities, while Shelf items (EPUB/PDF) had almost no operational visibility.
- **Book Management Sheet (`#book-manage-sheet`)**: Added a dedicated management sheet accessible via card overflow triggers (`···` button) on each book card.
- **Granular Storage Controls**:
  - **Storage Provider Badge**: Identifies whether the book resides on `This device`, `Dropbox`, `S3`, or `WebDAV`.
  - **Cache Status & Eviction**: Displays exact byte size on device. Allows deleting the local cache (`store.blobs.delete`) while preserving remote cloud references and reading progress.
  - **Cross-Provider Book Migration**: Moves book binaries between connected libraries (e.g. from local device to Dropbox, or Dropbox to S3) while maintaining reading positions, highlights, and annotations.
- **Trade-off**: Allowing local cache eviction means opening the book offline requires re-downloading from remote cloud storage.

### UI/UX & Component Behavior
- **Responsive Book Action Sheet**:
  - Actions: Open Book, Move to Library, Re-upload to Cloud, Clear Local Cache, Delete Permanently.
  - Warning Dialog on Permanent Delete: Requires explicit confirmation before issuing remote deletion.
- **Keyboard & Focus**:
  - Triggering `···` transfers focus directly to first actionable sheet item.
  - Pressing `Escape` closes the management sheet and returns focus to the origin card.

### API & Data Flow
- `evictBookCache(bookKey)`: removes binary blob from `store.blobs`, updates `item.cachedLocally = false`, leaves reading progress record intact.
- `migrateBook(bookItem, targetSourceId)`: reads binary from current source $\rightarrow$ validates byte length $\rightarrow$ writes to target cloud source $\rightarrow$ deletes from origin source $\rightarrow$ updates `item.sourceId` and `item.key`.

### Open Questions & Assumptions
- *Assumption*: Permanent deletion of a book should offer a 10-second Undo toast before triggering remote cloud purge.
- *Review Item*: Determine whether reading progress notes (Markdown reflections linked to book keys) should ever be deleted when a book binary is purged.

---

## 7. Storage Hierarchy & Notes / Types / Highlights Resolution

### Architectural & Design Decisions
- **Inverted Hierarchy Clarification**: In Settings under *Notes & Garden Home*, the interface formerly asked for *New notes go to* and *Highlights folder*, implying highlights were an isolated storage primitive separate from notes.
- **Unified Folder Hierarchy Model**:
  - Highlights and extracts are simply markdown notes with specific frontmatter tags (`status: seedling`, `kind: extract`).
  - Base Notes Location (`#notes-folder-input`): The root subfolder where all garden notes reside (e.g. `/notes/` or storage drive root `/`).
  - Types as Subfolders: Types (Journal, Essays, Highlights, Projects) are subfolders organized beneath the base notes folder:
    - Standard notes: `[base]/[type]/note-name.md`
    - Highlights: `[base]/[highlightsFolder]/highlight-name.md`
    - Root fallback: If base notes folder is blank, saves directly to `/[type]/note-name.md` without leading or double slashes.
- **Exclusion of Base Folder from Types**: In `src/ui/types.js`, `libraryTypes()` strips the base folder path so the container folder itself is never listed as a selectable note type.
- **Trade-off**: Enforcing strict subfolder hierarchy requires path sanitization to prevent accidental directory traversal (`../`).

### UI/UX & Component Behavior
- **Real-Time Dynamic Hierarchy Preview**: In Settings, editing `#notes-folder-input` or `#highlights-folder-input` instantly updates an explanatory hint badge:
  - Example: `Base folder: notes | Highlights folder: Extracts` $\rightarrow$ `Live: /notes/Extracts/book-extract.md`
- **Empty Base Folder Ergonomics**: When the input is left empty, the preview updates to `Live: /Extracts/book-extract.md (Library Root)`.

### API & Data Flow
- `library.resolveNotePath(type, filename)` queries `store.getNotesFolder()` and `store.getHighlightsFolder()`, sanitizes path segments, joins with `/`, and cleans double slashes.

### Open Questions & Assumptions
- *Assumption*: Existing notes in legacy root folders should remain readable and searchable without requiring forced mass migration.
- *Review Item*: Provide an optional "Reorganize to current folder schema" utility in System Diagnostics.

---

## 8. Application Versioning & Cache Lifecycle Management

### Architectural & Design Decisions
- **Single Source of Truth (`src/version.js`)**: Eliminated hardcoded version strings (`3.9`, `readover-shell-v6`, `readover-shell-v9`) across DOM templates, diagnostics, and service worker scripts.
- **Unified Milestone**: Centralized version declaration in `src/version.js`:
  ```javascript
  export const VERSION = '4.0.0';
  export const SHELL_CACHE = `readover-shell-v${VERSION}`;
  ```
- **Service Worker Cache Eviction Contract (`sw.js`)**:
  - Shell Cache: `readover-shell-v4.0.0` (precached app shell).
  - Vendor Cache: `readover-vendor-v2` (persistent third-party libraries: Literata font, PDF.js, Foliate-js).
  - Eviction: The Service Worker `activate` handler iterates all cache keys; any cache starting with `readover-shell-` that does not match `SHELL_CACHE` is deleted immediately. Vendor and data caches are preserved.
- **Trade-off**: Purging old shell caches on activation requires a full asset fetch for updated files, but guarantees clients never run mismatched JavaScript modules.

### UI/UX & Component Behavior
- **DOM & In-App Update Banner Alignment**:
  - Settings footer (`#app-version`) displays `Readover 4.0.0`.
  - In-app update notification banner (`#sw-update-banner`) dynamically displays `#sw-update-version` (`v4.0.0`) when a new service worker enters the `waiting` state.
  - Diagnostics modal header and clipboard export reflect exact version and cache name.

### API & Data Flow
- `src/version.js` imported by `src/app.js`, `src/ui/settings.js`, `src/ui/diagnostics.js`, and tested against `package.json` in automated suites.

### Open Questions & Assumptions
- *Assumption*: Semantic versioning milestone `4.0.0` represents the authoring canvas, multi-storage, and diagnostic overhaul.
- *Review Item*: Automate version sync between `package.json` and `src/version.js` via pre-commit or release script.

---

## 9. Quality Engineering, Test Suite Hardening & Hang Defense

### Architectural & Design Decisions
- **Pre-Commit Event-Loop Hang Root Cause**: Executing Git pre-commit hooks ran interactive DOM tests (`test-interactive-views.js`). Tests frequently halted and hung indefinitely without error output.
  - *Mechanism*: `openSheet` returned an unresolved promise waiting for modal closure. Tests calling `await settingsInstance.open()` without closing the sheet trapped the Node.js event loop because active promise handles never reached zero.
- **Decoupled Verification Layers**:
  - Layer 1: Static AST & Syntax Validation (`acorn` AST import linkage, `lint-no-undef.js`, `lint-css.js`).
  - Layer 2: Headless Cold-Boot Lifecycles (`test-cold-boot.js` - 10 passes).
  - Layer 3: Headless Interactive Views & Focus (`test-interactive-views.js` - 30 tests).
  - Layer 4: PWA, Manifest & Apple Safe-Area Audits (`test-pwa-capabilities.js` - 16 tests).
  - Layer 5: End-to-End Health Suite (`test-full-suite.js` - 11 test suites).
- **Hang-Resilience & Watchdog Harness**:
  - Top-level 15s unref'd watchdog timers (`watchdog = setTimeout(...).unref()`) across all test runners. If any handle traps execution, the watchdog dumps `process._getActiveHandles()` and exits with code 1.
  - Bounded 4s timeouts (`Promise.race`) in `testAsync()` runners.
- **Trade-off**: Synthetic DOM mocks require ongoing maintenance when adding new browser APIs, but execute 10x faster than full headless browser instances (Playwright/Puppeteer), maintaining a sub-4-second pre-commit turnaround.

### UI/UX & Component Behavior
- **Pre-Commit Pipeline Performance**:
  - Full suite execution time: **3.06 seconds** (well within $< 5\text{s}$ target).
  - Zero terminal freezes or untrapped promise deadlocks.

### API & Data Flow
- `.git/hooks/pre-commit` evaluates CSS AST $\rightarrow$ AST module linkage $\rightarrow$ linter $\rightarrow$ capability tests $\rightarrow$ interactive tests $\rightarrow$ cold boot $\rightarrow$ full suite before allowing commits.

### Open Questions & Assumptions
- *Assumption*: Mock DOM accurately mirrors browser WebKit/Blink stacking contexts for testing purposes.
- *Review Item*: Run periodic GitHub Actions CI with real WebKit/Chromium headless instances for cross-engine validation.

---

## 10. Global Error Trap & Benign ResizeObserver Timing Suppression

### Architectural & Design Decisions
- **The Benign ResizeObserver Notification Problem**: In Chromium, WebKit, and Gecko, `ResizeObserver` dispatches an unhandled layout timing notice (`ResizeObserver loop completed with undelivered notifications` or `ResizeObserver loop limit exceeded`) whenever DOM layout passes exceed a single frame budget. These are informational timing notices, not application errors.
- **Fatal Modal Premature Surfacing**: The pre-boot error trap in `index.html` intercepted all global `error` events and surfaced `#boot-error-boundary` ("Readover Startup Notice: The app encountered a script error while loading. [Clear cache & reload]"), causing fatal UI lockups during reader resizing, font rendering, or responsive flex changes.
- **Dual-Layer Suppression & Scoped Boundary Lifetime**:
  - Filter Logic: Extracted error messages across `e.message`, `e.error.message`, and `e.reason`, suppressing events matching `/ResizeObserver loop/i`, `/ResizeObserver loop completed with undelivered notifications/i`, or `/ResizeObserver loop limit exceeded/i`.
  - Scoped Lifetime: The emergency pre-boot error trap is designed exclusively to catch syntax errors or failed module imports before initial render. Once `boot()` successfully executes, `detachBootErrorTrap()` removes the startup listener from `window`.
  - Continuous Runtime Filter: Installed runtime error filtering in `src/app.js` to prevent unhandled layout loop notifications from generating console noise.
- **Trade-off**: Suppressing `ResizeObserver loop` errors hides layout notification timing in devtools, but eliminates false-positive crash cards for end users.

### UI/UX & Component Behavior
- **Startup Protection**: Real fatal script errors (e.g. `SyntaxError`, `Failed to fetch module`) during cold boot display the recovery card with "Clear cache & reload".
- **Runtime Reading Immersion**: Benign layout notifications during reader resize, annotation popups, or font scaling pass through silently without UI interruption.

### API & Data Flow
- `index.html`: Defines `handleBootError(e)`, checks `isBenign`, registers `window.__readoverDetachBootError`.
- `src/app.js`: Exports `isBenignLayoutError()`, `initBootErrorTrap()`, `detachBootErrorTrap()`. Invokes `initBootErrorTrap()` prior to boot, and `detachBootErrorTrap()` at the conclusion of `boot()`.

### Open Questions & Assumptions
- *Assumption*: Uncaught runtime errors after boot should log to console or System Diagnostics rather than showing the full-screen cache wipe modal.
- *Review Item*: Introduce a discreet, non-destructive in-app toast notification for non-fatal runtime errors occurring after boot.

---

## 11. Note Reader Selection Bar & Floating Action Dock Coordination

### Architectural & Design Decisions
- **The Stacking & Collision Problem**: Both the Floating Action Dock (`.reader-dock` with Water, Graft, and Edit buttons) and the Text Selection Action Bar (`.selection-bar` with Highlight, Add a Note, and Cancel) were anchored to the identical viewport bottom-center coordinates (`bottom: calc(20px + env(safe-area-inset-bottom, 0px)); left: 50%; transform: translateX(-50%);`).
  - `.reader-dock` possessed `z-index: 60`, while `.selection-bar` had `position: absolute; z-index: 5;`, causing the dock to physically obscure the selection toolbar and intercept touch events.
  - When text was selected in note prose, both elements were rendered simultaneously, creating visual cacophony and accidental mis-taps.
- **Mutually Exclusive Display Lifecycle**:
  - Implemented coordinated lifecycle helpers: `hideDock()`, `showDock()`, and `dropBar()` in `src/ui/reader.js`.
  - When text is selected ($\ge 3$ characters within `.prose`), `checkSelection()` drops any stale selection bar, hides `.reader-dock` with `hidden = true` and `.is-hidden`, and mounts `.selection-bar` at `z-index: 70`.
  - When text selection is cleared, dismissed via Cancel (`✕`), or completed via an action, `dropBar()` removes `.selection-bar` and invokes `showDock()`.
- **Read-Only & Imported Note Guarding**:
  - `showDock()` checks `if (writable && !note.imported && !editing)` to ensure that text selections within imported book notes, citations, or read-only connected libraries do not inadvertently reveal an unauthorized or non-functional action dock.
- **Race-Condition-Free Selection Snapshotting**:
  - In `keep.onclick` (Highlight) and `withNote.onclick` (Add a Note), selection text and metadata (`{ text, h }`) are snapshotted into a local `currentSel` reference *before* invoking `activeSel.removeAllRanges()` and `dropBar()`. This prevents asynchronous insight builders from receiving null ranges.
- **Strict Editor Boundary**:
  - Both `.reader-dock` and `.selection-bar` are strictly suppressed when note editing begins (`editing === true`), leaving the full viewport unobstructed for keyboard entry.

### UI/UX & Component Behavior
- **Design Alignment with Book Reader**:
  - Container: Dark charcoal `#1c1917` floating pill with subtle border (`rgba(255, 255, 255, 0.12)`), rounded pill geometry (`border-radius: 9999px`), and backdrop blur (`backdrop-filter: blur(12px)`).
  - Primary Action Pill: Highlight (`.btn-mark`) features a warm golden amber background (`#facc15`), dark charcoal text (`#1c1917`), and SVG marker icon (`20x20`).
- **WCAG 2.2 AA Touch Target Hitbox Compliance**:
  - All interactive buttons within `.selection-bar` enforce `min-height: 44px;` and generous horizontal padding (`14px`).
  - Dismiss button (`.btn-cancel`) enforces a square `min-width: 44px; min-height: 44px;` hit area.
- **Hardware-Accelerated Transitions**:
  - `.reader-dock` defines `transition: opacity 0.15s ease, transform 0.15s ease, visibility 0.15s ease;`.
  - State `.is-hidden` / `[hidden]` applies `opacity: 0; visibility: hidden; pointer-events: none; transform: translate(-50%, 8px);` to eliminate pop-in jitter.

### API & Data Flow
- `src/ui/reader.js`:
  - `hideDock()`, `showDock()`, `dropBar()` maintain dock state.
  - Debounced `checkSelection()` handles selection tracking.
  - Overlay `close()` cleans up listeners and drops `.selection-bar`.
  - Internal references `root._checkSelection` and `root._dropBar` exposed for testing.
- `src/style.css`:
  - `.selection-bar`: Fixed bottom-center coordinate anchoring with elevated `z-index: 70`.
  - `.reader-dock`: Transition and visibility rules.
- `test-interactive-views.js`:
  - Part 4 tests verifying mutual exclusivity, highlight action payload delivery, editor entry bar dismissal, and CSS touch target sizes ($\ge 44\text{px}$).

### Open Questions & Assumptions
- *Assumption*: Bottom-center anchoring provides the most natural single-thumb ergonomics on modern mobile devices.
- *Review Item*: On ultra-long text selections that scroll off-screen, evaluate surfacing a secondary floating action near the cursor selection handle.

---

## 12. Ghost Source Re-Creation Elimination & Background Sync Isolation

### Architectural & Design Decisions
- **Root Cause 1: Asymmetrical Source Tombstoning**:
  - `src/store.js` previously only recorded removed sources in `readover.removedSources` if `src.type === 'github'`.
  - When users removed Dropbox, WebDAV, or S3/R2 libraries, `readover.removedSources` had no record of the deletion (`myTime = 0`).
  - On subsequent sync passes, `applyLocally()` inspected `lib.t <= myTime`, which evaluated to false, resurrecting an unauthenticated placeholder (`token: ''`) under a newly minted ID (`store.newId('dbx')`).
- **Root Cause 2: Flawed Background Toast Condition**:
  - In `src/app.js`, `syncSource()` caught errors with `if (!quiet || err.code !== 'PERMISSION') toast(err.message)`.
  - Because `err.code` was undefined for missing Dropbox tokens, background sync (`quiet: true`) evaluated `err.code !== 'PERMISSION'` as `true`, continuously spamming the user with black error toasts (`"Dropbox is not connected. Add an access token in Settings."`).
- **Explicit Persistent Tombstoning (`removedSources`)**:
  - Added persistent `removedSources: []` array to `DEFAULT_PREFS` and `SYNCED_PREFS`.
  - When `store.removeSource(id)` or `store.deleteSource(id)` is called:
    1. The source ID is appended to `store.getPrefs().removedSources`.
    2. The source identity key (`sourceKey(src)`) is recorded in `readover.removedSources` with a timestamp for **all** storage providers (GitHub, Dropbox, WebDAV, S3/R2).
  - In `applyLocally()` in `src/sync.js`: Incoming sources from `merged.sources` or `merged.prefs.libraries` are filtered against `removedSources` (`!removed.has(s.id)` and `!removedKeys[sourceKey(s)]`), strictly preventing resurrection of deleted libraries.
  - In `snapshot()` in `src/sync.js`: Pruned sources are marked `{ t, removed: true }` in `libs[sk]`, ensuring cross-device deletion propagation.
- **Zero Passive Background Toasts & Credential Guarding**:
  - Added `hasValidCredentials(src)` helper in `src/app.js`.
  - Sources with missing credentials (or `src.readOnly === true`) are silently skipped before initiating network requests during background sync (`!userGesture`).
  - Error catching in `syncSource()` strictly isolates background errors: `if (userGesture && !quiet) toast(err.message)` surfaces toasts only during explicit user-initiated sync. Background failures log quietly to `console.warn` and set `syncDot.dataset.state = 'error'` on `#sync-dot`.
- **One-Time Startup Migration Cleanup**:
  - `cleanupGhostSources()` runs during `boot()`: safely identifies tokenless Dropbox placeholders with 0 items (when an active authenticated Dropbox source exists or default placeholder names match), deleting and tombstoning them automatically.

### UI/UX & Component Behavior
- **Connected Libraries Stability**: Removed sources remain permanently removed across app reloads, background sync passes, and cross-device sync merges.
- **Interruption-Free Reading**: Background sync runs completely silently without modal toasts or screen-obscuring error banners.
- **Discreet Diagnostics**: Secondary or unauthenticated sync errors indicate state on the top-bar status dot (`#sync-dot`) rather than interrupting reading prose.
- **Multi-Mount Support Preserved**: Multiple legitimate, authenticated accounts of the same provider type (e.g., Personal Dropbox and Team Dropbox) remain fully supported.

### API & Data Flow
- `src/store.js`:
  - `saveSource(source)`: clears tombstone on explicit connection.
  - `removeSource(id)` / `deleteSource(id)`: records `id` into `removedSources` array and `sourceKey` into `readover.removedSources`.
  - `DEFAULT_PREFS` & `SYNCED_PREFS`: includes `removedSources`.
- `src/sync.js`:
  - `snapshot()`: filters sources by `removedSources`, writes `removed: true` tombstones.
  - `mergePrefs()`: unions `removedSources` arrays across devices.
  - `applyLocally(merged, local)`: filters incoming payloads against tombstoned IDs and keys; prohibits tokenless ghost creations.
- `src/app.js`:
  - `hasValidCredentials(src)`: credential verification.
  - `cleanupGhostSources()`: startup migration.
  - `syncSource(src, { userGesture, quiet })`: silent skip and zero background toasts.
  - `syncAll({ force, userGesture })`: background filtering.
- `test-interactive-views.js`:
  - Part 14 test suite: verifies resurrection defense, silent background skip, and startup migration.

### Open Questions & Assumptions
- *Assumption*: Users who intentionally reconnect a previously removed source expect the tombstone to clear automatically (handled in `saveSource`).
- *Review Item*: Provide an explicit "Clear tombstones" button inside System Diagnostics for power users managing high-turnover test libraries.

