# End-to-End Test Suite, Runtime Stress Testing & Cross-Device Engineering (Revised)

A production-grade diagnostic framework, runtime stress testing suite, WCAG 2.1 AA accessibility hardening, mobile keyboard/100dvh viewport optimization, and multi-platform storage resilience system for Readover across phones, tablets, e-ink devices, and desktop workstations.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> The following revisions and hardening rules have been incorporated into the architectural plan:
> 1. **Environment-Aware OPDS Testing**: In-app diagnostics detect host capabilities: `/api/opds-proxy` is tested only when running against an active local Node/Express backend (`localhost` / custom backend), while static PWA and GitHub Pages environments strictly test direct CORS and user-configured external CORS proxies without reporting spurious 404 proxy errors.
> 2. **Storage Eviction Defense & PWA Cache Health**: Diagnostic checks explicitly query `navigator.storage.persisted()` and `navigator.storage.persist()` (defending against iOS WebKit's 7-day Intelligent Tracking Prevention cache purges) alongside Service Worker cache version verification to detect and prevent "stale app shell" PWA lockups.
> 3. **Mobile Keyboard Ergonomics (`interactive-widget=resizes-content` & `100dvh`)**: Mobile viewport meta is upgraded to `viewport-fit=cover, interactive-widget=resizes-content`, and sheet containers utilize `100dvh` so the virtual keyboard never obscures the note composer save bar, tags, or formatting controls.
> 4. **Safe Diagnostic Keyboard Shortcut**: To avoid colliding with ChromeOS (Bookmark All Tabs: `Ctrl+Shift+D`) and macOS Safari (Add to Reading List: `Cmd+Shift+D`), the diagnostics shortcut is mapped to `Ctrl/Cmd+Shift+U` (Audit/Utility) in addition to an accessible trigger button in Settings (Tab 4).
> 5. **Touch Target Density Balance**: Rather than artificially ballooning card and book cover dimensions to $48\times 48\text{px}$ (which damages mobile grid density), we use negative margin tap-target expansions (`pointer-events` hitboxes $\ge 44\text{px}$) that maintain compact visual elegance.
> 6. **Comprehensive Runtime & Stress Assertions ("Never Lose a Keystroke")**:
>    - *Storage Quota Overflow*: Gracefully handles failed blob writes with a clean `"Device storage full — reading directly without offline caching"` banner; guarantees "Clear cached books" purges `store.blobs` without touching user notes or garden items.
>    - *Multi-Tab Synchronization*: Leverages `BroadcastChannel` and storage listeners to propagate note edits and graph updates across open tabs without requiring page reloads.
>    - *Network Flakiness & 409 Conflicts*: Stashes unsaved drafts locally during auth expiration/revocation (HTTP 401); surfaces clean side-by-side Conflict Resolver sheets during 409 collisions.
>    - *Memory Leak Guards*: Enforces explicit `URL.revokeObjectURL()` lifecycle hooks across all OPDS and attachment object URLs during reader unmounts.
>    - *Hostile Path Sanitization*: Sanitizes and tests cross-platform path safety across GitHub, Dropbox (disallowing `:` and `\`), and Windows/WebDAV (disallowing `< > : " / \ | ? *`).

---

### 1. Overview & Core Concept

- **What It Does**: Unifies automated CLI assertions and a live in-app diagnostic suite with deep runtime stress tests, WCAG 2.1 AA accessibility hardening, mobile virtual keyboard adaptation, and offline PWA reliability across Android, iOS, Windows, macOS, and Linux.
- **Target Audience / Persona**: Readers and writers managing personal libraries across smartphones (one-handed thumb use, notches), tablets, and multi-monitor desktop environments.
- **Key Value**: Guarantees zero lost thoughts under unstable network conditions, defends against browser storage eviction, eliminates keyboard occlusion bugs, and provides instant health verification.

---

### 2. User Experience & Visual Design

#### Key User Flows
1. **Interactive Diagnostics & Runtime Stress Suite (In-App)**:
   - Accessed via Settings (Tab 4: App & Device) or shortcut `Ctrl/Cmd+Shift+U`.
   - Organizes tests into two distinct tabs:
     - **Core Health & Specs**: Storage object stores, OPDS parser/proxy, reader CFI locators, canvas WebP compression, and WCAG AA contrast/ARIA audit.
     - **Runtime & Stress Assertions**: Storage stress quota test (20MB blob allocation and cleanup), hostile path sanitizer test (10 edge-case strings), outbox integrity and offline queueing, multi-tab broadcast messaging, and Object URL leak inspection.
   - Provides live progress badges, actionable error remediation recommendations, and an **Export Health Report** button.
2. **Mobile Composer with Keyboard Adaptation**:
   - Tapping "Write note" or "Make it a note" opens the composer sheet sized with `height: 100dvh; max-height: 100dvh`.
   - As the virtual keyboard opens, `interactive-widget=resizes-content` ensures the viewport shrinks predictably.
   - The sticky `.compose-submit-bar` remains pinned directly above the mobile keyboard with `Save note` and citation triggers immediately reachable.
3. **PWA Standalone & Cold Offline Launch**:
   - Launches instantly offline from Service Worker cache.
   - Internal links (`readover://jump`, `[[WikiLink]]`) are trapped within the PWA frame rather than breaking out into new Safari/Chrome tabs.
   - Dynamic `<meta name="theme-color">` updates ensure the OS status bar harmonizes with light/dark theme switches.

#### Visual Identity & Theme
- **Theme Palette**:
  - Light: Canvas `#fbf9f5`, Surface `#ffffff`, Text `#1c1917` (15:1 contrast ratio), Borders `#e7e5e4`, Accent `#0284c7`.
  - Dark: Canvas `#141816`, Surface `#1c211e`, Text `#e8ebe3` (13:1 contrast ratio), Borders `#29332e`, Accent `#38bdf8`.
- **Typography & Proportions**:
  - `Literata` serif for editorial reading and highlights; system geometric sans for UI controls.
  - Tabular numerals (`tabular-nums font-mono`) for coordinates, quotas, and test metrics.
  - Focus rings: High-contrast `2px solid var(--accent)` with `outline-offset: 2px` on `:focus-visible`.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Environment-Specific OPDS Proxy Assertion**
  - *Chosen Approach*: Check `location.hostname` in diagnostics. If `localhost` or local dev IP, test `/api/opds-proxy`. If hosted on GitHub Pages or custom domain without a backend, test direct CORS and user-configured CORS proxy settings, skipping local endpoint tests.
  - *Why*: Eliminates false negative test failures on static PWA deployments while thoroughly testing the Node.js proxy in local/self-hosted environments.
- **Decision 2: Mobile Viewport Virtual Keyboard Resizing**
  - *Chosen Approach*: Set `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">` and style sheets with `100dvh`.
  - *Why*: Solves the classic mobile keyboard occlusion problem natively in Chromium and iOS 15.4+ WebKit without brittle JavaScript resize polling.
- **Decision 3: Keyboard Shortcut Mapping (`Ctrl/Cmd+Shift+U`)**
  - *Chosen Approach*: Replace `Ctrl/Cmd+Shift+D` with `Ctrl/Cmd+Shift+U` and provide a visible diagnostic button in Settings.
  - *Why*: Prevents OS-level browser shortcut conflicts on ChromeOS (Bookmark All Tabs) and macOS Safari (Reading List).
- **Decision 4: "Never Lose a Keystroke" Local Stashing**
  - *Chosen Approach*: On 401 auth expiration or unexpected network failure during a save, immediately stash the editor content in `localStorage('readover.draft.<key>')` and `store.outbox`, notify the user with a retry prompt, and never clear the active textarea.
  - *Why*: In a personal knowledge system, uncommitted thoughts must never be vaporized by network or credential errors.

---

### 4. Technical Architecture & Data Strategy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          READOVER PLATFORM RUNTIME                          │
├─────────────────────────────────────────────────────────────────────────────┤
│ Viewport & Ergonomics:                                                      │
│ • interactive-widget=resizes-content | 100dvh dynamic sheet sizing          │
│ • Safe-area insets: env(safe-area-inset-top), env(safe-area-inset-bottom)   │
│ • Tap hitboxes >= 44px via negative padding; compact visual typography      │
└───────────────┬─────────────────────────────────────────────┬───────────────┘
                │                                             │
                ▼                                             ▼
┌─────────────────────────────────────────┐   ┌───────────────────────────────┐
│     IN-APP DIAGNOSTICS & STRESS SUITE   │   │  MULTI-DEVICE SYNC & STORAGE  │
│        (src/ui/diagnostics.js)          │   │  • BroadcastChannel Cross-Tab │
│ ─────────────────────────────────────── │   │  • Persistent Storage Request │
│ Tab 1: Core System & Accessibility      │   │  • 409 Conflict Resolver Sheet│
│ • IndexedDB 7 stores + Quota check      │   │  • Outbox Queue with Backoff  │
│ • OPDS Parser & Host-Aware Proxy Test   │   │  • Object URL Memory Cleanup  │
│ • Annotation Deep-Link Locator Contract │   └───────────────┬───────────────┘
│ • Canvas WebP Compression Engine        │                   │
│ • WCAG AA Contrast, ARIA & Focus Audit  │                   │
│ ─────────────────────────────────────── │                   │
│ Tab 2: Runtime & Stress Assertions      │                   │
│ • 20MB Blob Quota Overflow Simulation   │                   │
│ • 10-Pattern Hostile Path Sanitizer     │                   │
│ • Outbox Serialization & Replay Check   │                   │
│ • Multi-Tab Broadcast Message Test      │                   │
└───────────────────┬─────────────────────┘                   │
                    │                                         │
                    ▼                                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       CORE REPOSITORY & SERVICE WORKER                      │
│ • sw.js (readover-shell-v6, cache migration, offline link-trapping)        │
│ • store.js & library.js (IndexedDB, fallback local storage, sanitizePath)   │
│ • notefile.js & markdown.js (prose formatting, wikilinks, image resolver)  │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Diagnostic Suite Test Specifications
1. **Storage & Persistence**:
   - `navigator.storage.persisted()` check; request persistence if ungranted.
   - Verify all 7 object stores exist and accept CRUD transactions.
   - Verify `readover.lastSync`, `readover.sources`, and dirty flags.
2. **OPDS & Network Environment**:
   - If running locally: test `/api/opds-proxy` with Atom XML sample.
   - If static/production: verify XML parser and check direct CORS or user proxy settings.
   - URL resolution: verify relative links resolve cleanly against feed bases.
3. **Cross-Tab & Sync**:
   - Emit event over `new BroadcastChannel('readover-sync')`; verify receipt in diagnostic listener.
4. **Stress & Error Resilience**:
   - Storage Stress: Generate temporary 20MB test payload, test write/read/delete cycle, report quota usage.
   - Cache Cleaner Isolation: Confirm book blob cleanup does not touch `items` or `garden` tables.
   - Path Sanitization: Verify paths with `/`, `\`, `:`, `?`, `*`, `<`, `>`, `"`, `|`, emoji, and trailing periods produce legal, deterministic identifiers across GitHub, Dropbox, and WebDAV.
   - Conflict Detection: Verify 409 simulation preserves baseSha and triggers merge/resolution rather than overwriting.

---

### 5. Implementation Steps

1. **Viewport & Keyboard Adaptation (`index.html`, `src/style.css`)**:
   - Update `<meta name="viewport">` in `index.html` to include `interactive-widget=resizes-content`.
   - Update `.sheet`, `.sheet-tall`, `.compose-sheet`, and modal overlays in `src/style.css` to use `height: 100dvh; max-height: 100dvh;` with safe-area bottom padding.
   - Ensure touch hitboxes have at least $44\text{px}$ effective tap areas via padding while keeping compact visual text.

2. **Cross-Tab Synchronization (`src/sync.js`, `src/app.js`)**:
   - Initialize a global `BroadcastChannel('readover-sync')` with `window.addEventListener('storage')` fallback.
   - Broadcast `readover:note-updated`, `readover:sources-changed`, and `readover:state-updated` events across tabs so secondary windows reflect edits without a reload.

3. **In-App Diagnostic & Stress Modal (`src/ui/diagnostics.js`)**:
   - Implement the complete diagnostic runner dialog with two view modes:
     - **Core Verification**: Storage stores, persistent storage status, host-aware OPDS parsing, annotation contracts, WebP compression, WCAG contrast & ARIA checklist.
     - **Runtime Stress Assertions**: Storage stress quota test, cross-platform path sanitizer test, multi-tab broadcast test, outbox serialization test, and Object URL revocation audit.
   - Bind to shortcut `Ctrl/Cmd+Shift+U` and add a button in Settings (Tab 4).
   - Add **Export Health Report** feature generating clean Markdown and JSON reports.

4. **Automated CLI Test Runner (`test-full-suite.js`)**:
   - Expand Node.js test script to run automated headless assertions on:
     - Scoping and insight extraction logic.
     - Markdown frontmatter and wikilink normalization.
     - Hostile path sanitizer matrix (Windows, Dropbox, Git illegal chars).
     - Outbox queue serialization and retry logic.
     - Atom XML & JSON-LD parsing algorithms.
   - Update `package.json` to include `"test": "node test-full-suite.js"`.

5. **Accessibility & PWA Hardening**:
   - Ensure all icon buttons have explicit `aria-label`s.
   - Set visible focus indicators (`:focus-visible`).
   - Add `@media (prefers-reduced-motion: reduce)` rules in `src/style.css`.
   - Add browser feature-check `<noscript>` / legacy fallback banner in `index.html`.
   - Ensure internal links do not break out of standalone PWA window.
   - Sync `<meta name="theme-color">` dynamically with active theme.
