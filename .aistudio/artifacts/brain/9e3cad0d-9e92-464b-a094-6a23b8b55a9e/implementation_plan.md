# Readover Navigation, Feed Actions & Bidirectional Linking Plan

Detailed implementation plan for resolving feed action menus, fixing direct edit mode, replacing header icons, adding feed-level search, enforcing default bidirectional linking with reciprocal writes, adding a reader Home escape button, and providing a Discard button in editor mode.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> The following core decisions and clarifications have been finalized:
> - **Default Bidirectional Linking**: When creating a link via Graft or the link picker, Readover will automatically write reciprocal links into both markdown files by default (inserting `[[link]]` under `## Related` in the destination note), ensuring complete two-way navigability in any Markdown tool.
> - **Search from Feed**: A dedicated Search button (`icon('search')`) will be added to the topbar header next to the scope chip. Clicking it (or pressing `/`) opens a fast, full-text search sheet querying `notes-index.js` that allows jumping straight into any note.
> - **Header & Rail Icon De-duplication**:
>   - The header button for creating notes will change from a pen icon to a clear `+` icon (`icon('plus')`).
>   - The redundant pen icon will be removed from the feed card rail, leaving the rail clean and distinct: `[Star] [⋯ Actions] [Hide] [Open]`.
> - **Direct Edit Mode Fix**: Fixed the callback sequencing in `reader.js` so that choosing "Edit note" immediately activates the full textarea editor with pre-focused input.
> - **Rename or Move in Card Menu**: Restored the missing "Rename or move" action in the feed card `⋯` menu, linking directly into the interactive renaming and link re-indexing pipeline.
> - **Home Escape Button in Reader**: A Home button (`icon('home')`) will sit adjacent to the Back button in the reader header, allowing users nested 10+ layers deep in link rabbit holes to escape back to the feed in a single tap.
> - **Discard Button in Editor**: A "Discard" button will appear alongside "Save" during note editing to let users safely abandon accidental edits without applying changes.

---

## 1. Overview & Core Concept

Readover is an offline-first personal reading feed and digital garden for personal knowledge management (PKM). This update addresses key ergonomics, navigation, and editing workflows:

1. **Seamless Editing & Maintenance**:
   - Choosing "Edit note" in the feed card `⋯` menu immediately places the user into the Markdown editing interface.
   - The editor provides both a primary **Save** button and a quiet **Discard** button to cleanly abandon unwanted changes.
   - Feed cards provide complete garden lifecycle controls: Edit, Graft, Rename/Move, Prune (Archive), Share, and Delete.
2. **Effortless Discovery & Navigation**:
   - Quick Search icon in the feed header unlocks instant full-text retrieval across titles and note bodies without leaving the feed.
   - Home escape button in the reader allows returning to the feed root from any link depth.
3. **True Two-Way Bidirectional Connections**:
   - Creating a link between Note A and Note B automatically adds reciprocal `[[wiki links]]` in both files under `## Related`, keeping links transparent, human-readable, and platform-agnostic.
   - Reader connection cards display rich snippets, source libraries, and `⇄ Mutual link` status indicators.

---

## 2. User Experience & Visual Design

### Design Tokens & Layout Consistency
- Paper canvas: `--paper: #e8ebe3` (dark: `--paper: #141816`).
- Ink & Accent: `--accent: #2e5b4f`, `--ink: #1f2623` (dark: `#e3e8e5`).
- Typography: Literata serif for reading; system sans for controls, inputs, and button labels.
- Zero-pill discipline: Clean unboxed metadata with dot separators (`Essays · 3 backlinks · ⇄ Mutual link`).

### UI Component Updates

#### 1. Header Topbar (`index.html`)
- **Brand**: `Readover`
- **Scope Chip**: `Everything ▼`
- **Search Button**: `<button id="search-btn" class="icon-btn" title="Search notes (/)">` with SVG search icon.
- **New Note Button**: Changed icon from `pen` to `+` (`icon('plus')`), title "New note (+ or N)".
- **Settings**: Gear icon.

#### 2. Feed Card Rail (`src/ui/card.js`)
- Monochromatic, reels-style circular buttons along the right edge:
  - `Star` (Favourite / `S`)
  - `⋯` (Note actions: Edit, Graft, Rename/Move, Prune, Share, Delete)
  - `Hide` (Hide from feed / `X`)
  - `Open` (Open note reader / `Enter`)

#### 3. Note Reader Header (`src/ui/reader.js`)
- Left side controls:
  - `Back` arrow (`icon('back')`) — steps back one navigation level.
  - `Home` icon (`icon('home')`) — immediately closes all reader layers and returns to the feed.
- Center: Note title and auto-save status.
- Right side controls:
  - `Star` button.
  - `[[ ]]` link insertion button (visible only during edit).
  - `Discard` button (visible only during edit, quiet style).
  - `Edit` / `Save` button (primary style when editing).
  - `⋯` More menu.

#### 4. Feed Search Modal (`src/ui/search-sheet.js` / `src/app.js`)
- Full-screen or tall sheet with immediate autofocus on search input.
- Real-time search as you type, querying `notes-index.js`.
- Result cards show: Note title, folder/type breadcrumb, and excerpt with matched keyword context.
- Tapping any result opens the note directly.

---

## 3. Key Technical Decisions & Architecture

### System Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      Readover Application                       │
├───────────────────────────────┬─────────────────────────────────┤
│          Feed View            │           Reader View           │
│ ┌───────────────────────────┐ │ ┌─────────────────────────────┐ │
│ │ Topbar Header:            │ │ │ Topbar Bar:                 │ │
│ │  ├─ Brand ("Readover")    │ │ │  ├─ Back (1 level)          │ │
│ │  ├─ Scope ("Everything")  │ │ │  ├─ Home (Escape to Feed)   │ │
│ │  ├─ Search ([/] button)   │ │ │  ├─ Title & Status          │ │
│ │  ├─ New Note ('+' button) │ │ │  ├─ Discard (when editing)  │ │
│ │  └─ Settings (Gear)       │ │ │  ├─ Save/Edit button        │ │
│ ├───────────────────────────┤ │ │  └─ More (⋯) Menu           │ │
│ │ Card Rail:                │ │ ├─────────────────────────────┤ │
│ │  ├─ Star                  │ │ │ Markdown Prose or Textarea  │ │
│ │  ├─ Note Actions (⋯)      │ │ ├─────────────────────────────┤ │
│ │  │   ├─ Edit note (fixed) │ │ │ Connections & Links Section:│ │
│ │  │   ├─ Graft (reciprocal)│ │ │  ├─ Outgoing Cards          │ │
│ │  │   ├─ Rename or move    │ │ │  ├─ Incoming Cards          │ │
│ │  │   ├─ Prune (Archive)   │ │ │  └─ ⇄ Mutual Indicator      │ │
│ │  │   ├─ Share             │ │ └──────────────┬──────────────┘ │
│ │  │   └─ Delete            │ │                │                │
│ │  ├─ Hide                  │ │                │                │
│ │  └─ Open                  │ │                │                │
│ └─────────────┬─────────────┘ │                │                │
└───────────────┼────────────────────────────────┼────────────────┘
                ▼                                ▼
┌─────────────────────────────────────────────────────────────────┐
│              Reciprocal Grafting & Linking Engine               │
│  1. `graftItem(fromItem, toItem)`:                             │
│     - Writes `[[toItem|Title]]` under `## Related` in `from`    │
│     - Automatically writes `[[fromItem|Title]]` in `to`         │
│     - Emits single commit/save for each and clears link cache   │
│  2. `notes-index.js`: Recomputes graph with mutual connections  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Implementation Steps

1. **SVG Icons**:
   - Add `#i-home` and `#i-search` symbols to `<svg>` defs in `index.html`.
2. **Header Markup & Wiring (`index.html`, `src/app.js`)**:
   - Update `#write-btn` to use `#i-plus`.
   - Add `#search-btn` with `#i-search`.
   - Wire `#search-btn` and keyboard shortcut `/` to open the full-text search dialog.
3. **Feed Rail Cleanup (`src/ui/card.js`)**:
   - Remove redundant `editBtn` from `rail()`. Keep `[Star] [⋯ Actions] [Hide] [Open]`.
4. **Feed Card Actions Menu (`src/app.js`)**:
   - Ensure `actions.cardMenu(card)` includes `move` ("Rename or move").
   - Fix `actions.editNote(card)` to ensure it reliably starts the reader in textarea edit mode.
5. **Reader Editing & Navigation (`src/ui/reader.js`)**:
   - Fix `startInEditor`: trigger edit mode after `editBtn.onclick` handler is defined.
   - Add `cancelBtn` ("Discard") during `editing = true`. Restores original `text` without saving.
   - Add `homeBtn` to reader header: closes reader and all stacked overlays.
6. **Default Reciprocal Linking (`src/app.js`, `src/ui/reader.js`)**:
   - Update grafting logic: when grafting `A` to `B`, write `[[B|Title]]` to `A` AND write `[[A|Title]]` to `B` under `## Related`.
7. **Verification**:
   - Verify syntax via `node --check`.
   - Verify compilation with `compile_applet`.
   - Test all user flows end-to-end.
