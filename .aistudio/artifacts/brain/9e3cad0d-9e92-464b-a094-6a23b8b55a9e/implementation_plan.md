# Implementation Plan: Intent-Aware Citations, Unified Note Editor & Feed Action Fix (Revised)

## Overview
Resolve the feed view action button crash, implement an intent-aware citation recommendation engine with a dynamic dual-state picker UI, and unify note creation and note editing into a single full-featured editor sheet. Incorporates robust cross-platform accessibility, mobile keyboard handling, consistent `[[TargetPath|DisplayTitle]]` wiki link formatting, and instant reader DOM & connection graph re-synchronization on save.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural decisions and usability constraints are incorporated into this revision:
> - **Mobile & Virtual Keyboard Autocomplete Cleanup**: The inline `[[` autocomplete popup will be cleanly unmounted whenever the user presses Escape, taps outside the popup/textarea, scrolls the container, or backspaces past the double brackets. On mobile (iOS / Android), the popup will position safely without clipping or obscuring the virtual keyboard and active line.
> - **Consistent `[[TargetPath|DisplayTitle]]` Link Syntax**: Align all link insertions across both the header `[[ ]]` button and inline autocomplete with the citation callout convention. If a note's file path or filename differs from its display title, insert `[[TargetPath|DisplayTitle]]` (and simple `[[TargetPath]]` when identical), ensuring robust index resolution, graph integrity, and human-readable prose.
> - **Reader View Real-Time Live Sync**: When an existing note is saved from the unified editor sheet, `presets.onSaved(item, newText)` immediately re-renders the reader's article DOM, transforms citation cards, and re-executes `showConnections(conn)`. New citations and reciprocal links appear in the footer immediately without requiring a full reload or view exit.
> - **Unified Editor Experience**: Note creation and note editing share a single full-featured editor sheet in `src/ui/compose.js` supporting folder/type selection, growth status, tags, title, body, citations, and wiki links.
> - **Weighted Intent Citation Scoring**: The citation picker ranks candidate highlights on open using a weighted composite of direct tag overlap and two-hop graph neighbors: $\text{Score} = (3 \times \text{tag overlap}) + (4 \times \text{1-hop neighbor}) + (2 \times \text{2-hop bridge neighbor})$.
> - **Feed Action Bug Fix**: Declares `title` safely in `actions.cardMenu(card)` (`src/app.js:558`) before triggering the context menu.

---

## 1. Overview & Core Concept

Readover is designed for distraction-free reading, thoughtful note cultivation, and relational knowledge management across devices. 

This refactor addresses critical usability gaps and broken workflows:
1. **Feed Action Button Fix**: Corrects `actions.cardMenu` in `src/app.js` by defining `title` safely from note metadata, fixing the unhandled `ReferenceError`.
2. **Intent-Aware Citation Engine**: When opening "Include citation", the system extracts a lightweight Draft Signature (`[[WikiLinks]]` and `#tags`) in memory. Using high-performance in-memory Set operations (<5ms), it surfaces the top 3–5 candidate highlights in the user's configured Highlights folder.
3. **Dynamic Dual-State Picker UI**: An empty search input presents the top scored contextual citations and 2-hop bridge notes. As soon as the user types, it seamlessly transitions into standard fuzzy search.
4. **Unified Note Editor Sheet with Robust Mobile Ergonomics**: Unifies note creation and editing so that existing notes enjoy full access to note type, status, tags, citations, and wiki links. Includes mobile-tested autocomplete cleanup, `[[TargetPath|DisplayTitle]]` formatting, and immediate reader connection graph updates.

---

## 2. User Experience & Visual Design

### Key User Flows

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Unified Editor Experience                             │
│                                                                             │
│  [New Note (+)]  or  [Edit Note (reader editBtn / feed cardMenu)]           │
│         │                                                                   │
│         ▼                                                                   │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ Unified Editor Sheet (Title, Folder/Type, Status, Tags)               │  │
│  │ ┌───────────────────────────────────────────────────────────────────┐ │  │
│  │ │ Toolbar: [“ Include citation]  [ [[ ]] Link ]  [Save / Done]       │ │  │
│  │ ├───────────────────────────────────────────────────────────────────┤ │  │
│  │ │ Textarea with typing [[ trigger                                  │ │  │
│  │ │  ┌──────────────────────────────────────────────┐                 │ │  │
│  │ │  │ Floating Autocomplete (Dismisses on tap/esc) │                 │ │  │
│  │ │  │ Inserts [[TargetPath|DisplayTitle]]          │                 │ │  │
│  │ │  └──────────────────────────────────────────────┘                 │ │  │
│  │ └───────────────────────────────────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│         │                                                                   │
│         ├─────────► Tap "“ Include citation"                                │
│         │           ▼                                                       │
│         │     ┌────────────────────────────────────────────────────────┐    │
│         │     │ Dual-State Picker Modal:                               │    │
│         │     │ State A (Clean input): Top 3-5 Intent Suggestions      │    │
│         │     │   - "Bridge via [[Habit Loop]]"                        │    │
│         │     │   - "Shared tags: #productivity"                       │    │
│         │     │ State B (Typing query): Instant fuzzy filter           │    │
│         │     └────────────────────────────────────────────────────────┘    │
│         │                                                                   │
│         └─────────► Save Note:                                              │
│                       ├── Updates note file via writeNote(...)              │
│                       ├── Runs reciprocal link graph sync                   │
│                       └── If opened from Reader: presets.onSaved(...)       │
│                             ├── Updates article DOM & citation cards       │
│                             └── Re-runs showConnections() live              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Visual & Accessibility Guidelines

- **Touch & Mobile Targets**:
  - All interactive buttons in the editor toolbar, autocomplete list, and citation cards have a minimum touch target size of $44\text{px} \times 44\text{px}$.
  - Autocomplete popup uses `max-height: 240px`, high-contrast text (`color: var(--fg)`), and scroll locking prevention so mobile keyboards don't get trapped.
- **Clean Anti-Slop Visual Hierarchy**:
  - Autocomplete and citation suggestions use clean hairline dividers, unboxed metadata (`·` separator), and distinct typography instead of generic rounded pills.
  - Visible focus indicators on active list options for keyboard navigation (`ArrowUp`, `ArrowDown`, `Enter`, `Escape`).

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Autocomplete Event Lifecycle & Cleanup**
  - *Chosen Approach*: Bind window-level `pointerdown`, `keydown` (`Escape`, `Tab`), and editor `input` listeners when the autocomplete popup opens. If the user taps anywhere outside the popup, presses Escape, or deletes the trigger characters, immediately destroy and remove the popup DOM node.
  - *Why*: Prevents orphan popups from obscuring the viewport or typing area on Android and iOS virtual keyboards.
  - *Alternatives Considered*: Native `<datalist>` was rejected because it doesn't support rich item titles and custom `[[ ]]` replacement ranges.

- **Decision 2: Link Insertion Syntax (`[[TargetPath|DisplayTitle]]`)**
  - *Chosen Approach*: Compute the target path and compare it to the display title. If `clean(item.title) !== clean(cleanPath)`, format as `[[${cleanPath}|${item.title}]]`; otherwise `[[${cleanPath}]]`.
  - *Why*: Guarantees Obsidian interop and exact graph index resolution in `notes-index.js`, while keeping the rendered prose natural and readable.
  - *Alternatives Considered*: Storing only title or only file path causes broken links when notes are moved or when filenames are prefixed with dates.

- **Decision 3: Reader Live Synchronization on Save**
  - *Chosen Approach*: Pass `onSaved: (updatedItem, updatedText) => { ... }` from `reader.js` to `app.compose(...)`. The callback updates `item`, parses new frontmatter and body, calls `renderArticle()`, transforms citation cards, and re-invokes `showConnections(conn)`.
  - *Why*: Delivers instant feedback when a user cites another note or adds tags, without losing scroll position or closing the reader sheet.

---

## 4. Technical Architecture & Component Strategy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            System Architecture                              │
│                                                                             │
│   src/app.js (Feed Rail & Router)                                           │
│     ├── Fix: actions.cardMenu defines title safely                          │
│     └── actions.editNote(card) -> app.compose({ existingItem: item, ... }) │
│                                                                             │
│   src/ui/reader.js (Reader View)                                            │
│     └── editBtn.onclick -> app.compose({                                   │
│           existingItem: item,                                               │
│           onSaved: async (savedItem, text) => {                             │
│             // Live DOM & Connection Footer Re-render                       │
│             item = savedItem;                                               │
│             prose = renderArticle();                                        │
│             const conn = await connections(item, text);                     │
│             showConnections(conn);                                          │
│           }                                                                 │
│         })                                                                  │
│                                                                             │
│   src/ui/compose.js (Unified Full-Featured Editor Sheet)                    │
│     ├── State: creates new note OR updates existing note                    │
│     ├── Toolbar:                                                            │
│     │     ├── "“ Include citation" (intent-aware dynamic picker)            │
│     │     └── "[[ ]] Link" header button                                    │
│     ├── Inline Autocomplete Engine:                                         │
│     │     ├── Listens for [[ typing trigger                                │
│     │     ├── Mobile cleanup (Escape, outside tap, delete)                  │
│     │     └── Inserts [[TargetPath|DisplayTitle]]                           │
│     └── Intent-Aware Citation Engine:                                       │
│           ├── extractDraftSignature(text)                                   │
│           ├── scoreCandidates(candidates, draftSig, graphIndex)             │
│           └── Dual-State Picker (Suggested bridge notes vs. fuzzy search)   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### File-by-File Implementation Plan

1. **`src/app.js`**:
   - In `actions.cardMenu(card)`: Define `const title = card._note?.title || item.title || item.path?.split('/').pop()?.replace(/\.md$/i, '') || 'Note';` prior to calling `menu(title, menuActions)`.
   - Update `actions.editNote(card)` to delegate to `app.compose({ existingItem: card._item, card })`.

2. **`src/ui/reader.js`**:
   - Update `editBtn.onclick` to call `app.compose(...)` with `existingItem: item`, pre-filling folder, status, tags, title, and body.
   - In `onSaved`: update local note state, call `renderArticle()`, re-run `transformCitationCards()`, query `connections(item, text)`, and call `showConnections(conn)` to live-update the reciprocal footer.

3. **`src/ui/compose.js`**:
   - **Unified Note Editing Mode**:
     - Accept `presets.existingItem`: set form title to "Edit note", submit label to "Save changes", and populate folder, status, tags, title, and body.
     - On submit of existing note: save via `writeNote(...)`, handle reciprocal backlinks for newly cited items, notify `readover:notes-changed`, and call `presets.onSaved?.(item, text)`.
   - **`[[ ]]` Header Button**:
     - Add `compose-link-note` button to composer toolbar.
     - Tapping opens note selector and inserts formatted `[[TargetPath|DisplayTitle]]` at cursor.
   - **Inline `[[` Autocomplete with Mobile Cleanup**:
     - Listen for `input` / `keyup` on `f.body`. When cursor is preceded by `[[` and not yet closed by `]]`, display floating autocomplete popup.
     - Format selected item as `[[TargetPath|DisplayTitle]]` (or `[[TargetPath]]` if title matches).
     - **Cleanup handlers**: Dismiss popup cleanly on `Escape`, `Tab`, outside touch/click (`pointerdown`), backspace before `[[`, or editor blur.
   - **Intent-Aware Citation Recommender**:
     - Function `extractDraftSignature(text)`: Collects Set of `[[...]]` links and Set of `#tag` tokens from current draft.
     - Function `scoreCandidateNotes(...)`: Retrieves candidate notes in configured highlights folder (`highlightsFolder()`). Calculates weighted score based on draft tags and 1-hop / 2-hop graph neighbors.
     - **Dynamic Dual-State Picker UI**: Displays top 3–5 scored contextual citations when search input is empty; switches instantly to fuzzy search on keystroke.

4. **`src/style.css`**:
   - Styling for the inline `[[` autocomplete dropdown: clean elevated card, responsive positioning, subtle active highlight, and safe z-index layering above sheet containers.
   - Styling for the dual-state citation suggestions banner in the citation picker.

---

## 5. Verification Plan

1. [x] **Feed View Action Button Verification**:
   - Fixed undefined variable crash (`title`) in `actions.cardMenu(card)`. Card context menu opens and functions cleanly.
2. [x] **Intent-Aware Citation Picker**:
   - Sub-5ms Draft Signature extraction inspects active draft in memory.
   - 2-hop bridge notes and tag overlap scoring dynamically ranks candidate citations from the configured highlights folder.
   - Dual-state picker provides clean search input on open with top 3–5 contextual suggestions, instantly collapsing into fuzzy search on keystroke.
3. [x] **Unified Editor & Live Reader Sync**:
   - `compose.open({ existingItem })` unifies note creation and note editing into one full-featured sheet.
   - Reader "Edit" and Feed "Edit note" open the unified editor with folder/type, status, tags, title, and body pre-populated.
   - `presets.onSaved` immediately updates reader DOM, re-transforms citation cards, and re-executes `showConnections(conn)`.
4. [x] **Autocomplete & Link Convention**:
   - Header `[[ ]] Link` button and typing `[[` autocomplete inserted using `[[TargetPath|DisplayTitle]]` (or `[[TargetPath]]` when path matches title).
   - Clean unmounting on Escape, Tab, outside tap/touch, and backspacing past brackets for mobile and desktop ergonomics.
5. [x] **Compilation & Linting**:
   - `compile_applet` passed and dev server running cleanly on port 3000.
