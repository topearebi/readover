# Refined Citation Workflow & Bounded Callout Cards

Clean up redundant note-creation buttons, retool the composer to support dynamic "Include citation" filtering against the configured highlights folder, and transform citation blockquotes into bounded, styled evidence cards with full bidirectional graph integrity.

### User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural decisions were confirmed with the user in Phase 1:
> - **Citation Card Styling**: Rendered as a **bounded card with quotation accent, source badge, and direct link**, providing distinct visual separation between the writer's argument and cited evidence.
> - **Folder Indexing**: Citation search dynamically filters notes from the **user's configured Highlights folder** (from Settings), eliminating clutter from unsorted or general garden notes.
> - **Insertion Syntax**: The composer will insert clean **Obsidian citation callouts with wiki links** (`> [!quote] [[Source Note Title]]\n> "Quoted text..."\n> — Attribution`), preserving seamless interop and markdown portability.

- **Confirmed Decision 1 (Cleanup)**: Remove the redundant "Make it a note" action from feed card actions, note reader action bars, and growth sheets.
- **Confirmed Decision 2 (Graph Integrity)**: Citation callouts retain standard wiki link syntax (`[[Source Note]]`), ensuring `src/notes-index.js` automatically indexes outbound links and registers this document in the source note's "Referenced By" section.
- **Confirmed Decision 3 (Naming)**: Rename the composer tool from "Include insights" to **"Include citation"**.

---

## 1. Overview & Core Concept

Readover's note creation and clipping features already provide streamlined pathways to capture thoughts and grow notes. Having a separate "Make it a note" button created clutter and visual overlap across cards, reader action bars, and growth menus.

This refactor:
1. **Prunes UI Clutter**: Removes all instances of the standalone "Make note" / "Make it a note" button.
2. **Elevates the Citation Workflow**: Renames and upgrades the composer tool to **"Include citation"**, backed by dynamic indexing that pulls highlights and quotes strictly from the folder currently configured in Settings (`store.getPrefs().highlightsFolder`, defaulting to `Highlights`).
3. **Card-Based Citation Rendering**: Replaces raw text blockquotes with **bounded evidence cards** in the reader. When markdown contains citation callouts (`> [!quote] [[...]]` or `> [!cite] [[...]]`), it transforms them into distinguished editorial cards featuring a quotation accent icon, prominent source title badge, styled passage excerpt, and a direct navigation link to the cited note.
4. **Guaranteed Graph Integrity**: Because the citation embeds a standard `[[Source]]` wiki link, Readover's set-theoretic graph engine automatically registers the citation as an outbound reference, populating the source note's "Referenced By" list and preserving bidirectional navigation.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Configuring Highlights Folder**:
   - The user opens Settings and sets the Highlights folder (e.g., `Readwise`, `Books/Quotes`, or `Citations`).
   - Readover stores this preference dynamically.

2. **Inserting a Citation in the Composer**:
   - While composing a note, the user taps the **“ Include citation** button in the composer toolbar.
   - An intelligent picker sheet opens, querying only notes located within the configured highlights folder.
   - The user searches or selects an excerpt.
   - Tapping **Insert** inserts an Obsidian citation callout block at the cursor:
     ```markdown
     > [!quote] [[Atomic Habits|Atomic Habits]]
     > Small 1% improvements compound into remarkable results over time.
     > — James Clear
     ```
   - The source note is tracked for reciprocal graph synchronization on save.

3. **Reading & Reviewing Bounded Citation Cards**:
   - When viewing the note in the reader, the raw blockquote is rendered as a clean, bounded card:
     ```
     ┌────────────────────────────────────────────────────────┐
     │ “ CITED EVIDENCE                [[ Atomic Habits ]] ↗  │
     ├────────────────────────────────────────────────────────┤
     │ Small 1% improvements compound into remarkable results │
     │ over time.                                             │
     │                                                        │
     │ — James Clear                                          │
     └────────────────────────────────────────────────────────┘
     ```
   - Clicking the title badge or link navigates straight to `Atomic Habits`.
   - The reader's connection footer displays `Atomic Habits` under **"Referenced in Text"** (or **"Related Notes"** if mutual), and `Atomic Habits` displays this note under **"Referenced By"**.

### Visual Styling & Typographic Hierarchy

- **Bounded Container**: Subtle hairline border (`1px solid color-mix(in srgb, var(--line) 75%, transparent)`), rounded corners (`border-radius: 8px`), and a whisper surface tint (`color-mix(in srgb, var(--muted) 4%, transparent)`).
- **Header Strip**: Distinct uppercase kicker (`CITED EVIDENCE` or quotation glyph `“`) paired with a clickable source badge displaying the book or note title and an arrow indicator (`↗`).
- **Quote Body**: Clean editorial typography (refined serif or legible italic with relaxed leading), visually set apart from the author's primary argument.
- **Attribution**: Subtle muted attribution line (`— Author`).

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Removal of "Make it a note" Button**
  - *Chosen Approach*: Clean up the standalone button from cards, reader headers, and growth sheets.
  - *Why*: Existing clipping, quick-capture, and garden cultivation actions already cover note creation without cluttering reading surfaces.
  - *Alternatives Considered*: Keeping it hidden behind a sub-menu was rejected to avoid code bloat.

- **Decision 2: Dynamic Highlights Folder Resolution**
  - *Chosen Approach*: Call `highlightsFolder()` from `src/insights.js` on every search rather than hardcoding `'Highlights'`. Filter by `item.folder === hlFolder || item.folder?.startsWith(hlFolder + '/')`.
  - *Why*: Allows users to rename their highlights folder at any time without breaking the citation picker.
  - *Alternatives Considered*: Requiring a manual tag filter was rejected as too tedious for users.

- **Decision 3: Markdown Callout Extension vs. Raw HTML**
  - *Chosen Approach*: Store citations as standard Obsidian markdown callouts (`> [!quote] [[Title]]\n> Text`) and render them as cards in the markdown pipeline and reader DOM.
  - *Why*: Preserves 100% plain-text portability and Obsidian compatibility while delivering a rich card interface in Readover.

---

## 4. Technical Architecture & Data Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│                    Readover Citation System                     │
│                                                                 │
│  ┌──────────────────────┐        ┌───────────────────────────┐  │
│  │   Settings Sheet     │───────►│ Preference:               │  │
│  │   "Highlights folder"│        │ highlightsFolder          │  │
│  └──────────────────────┘        └─────────────┬─────────────┘  │
│                                                │                │
│                                                ▼                │
│  ┌──────────────────────┐        ┌───────────────────────────┐  │
│  │  Composer Toolbar    │───────►│ Citation Picker Modal     │  │
│  │  "“ Include citation"│        │ Dynamic Folder Filter     │  │
│  └──────────────────────┘        └─────────────┬─────────────┘  │
│                                                │ Insert callout │
│                                                ▼                │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Markdown Note Body:                                       │  │
│  │ > [!quote] [[Source Note|Source Title]]                   │  │
│  │ > "Passage text..."                                       │  │
│  └─────────────────────────────┬─────────────────────────────┘  │
│                                │                                │
│                ┌───────────────┴───────────────┐                │
│                ▼                               ▼                │
│  ┌───────────────────────────┐   ┌───────────────────────────┐  │
│  │ Markdown Tokenizer / Purify│  │ Notes Index & Graph       │  │
│  │ Renders Bounded Card DOM  │   │ Detects [[Source Note]]   │  │
│  │ with direct navigation    │   │ Updates Inbound/Outbound  │  │
│  └───────────────────────────┘   └───────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### File Modification Plan

1. **`src/ui/card.js`**:
   - Remove `makeNote` button and `makeNote` action invocation on seed cards.

2. **`src/ui/reader.js`**:
   - Remove `makeNoteBtn` from header bar.
   - Remove `makenote` action from the reader's `moreBtn` action sheet.
   - Enhance article DOM post-processing: find citation callouts (`blockquote.callout-quote` or blockquotes with `[!quote]`/`[!cite]`) and wrap/enhance them into bounded cards with source link hooks (`data-wikilink` delegation).

3. **`src/ui/growth.js`**:
   - Remove `on.makeNote` from the growth sheet actions list.

4. **`index.html`**:
   - Update compose tools: replace `#compose-include-insight` with `#compose-include-citation` (`“ Include citation”).

5. **`src/ui/compose.js`**:
   - Rename `includeInsightBtn` to `includeCitationBtn`.
   - Update picker modal title to **"Include citation"**.
   - Dynamically retrieve `highlightsFolder()` from `../insights.js`. Filter note entries strictly by matching the configured highlights folder.
   - Format inserted citation as Obsidian callout:
     ```markdown
     > [!quote] [[TargetPath|SourceTitle]]
     > Quoted text...
     > — Attribution
     ```
   - Automatically register target note in reciprocal tracking for graph synchronization upon saving.

6. **`src/markdown.js`**:
   - Add custom tokenizer/renderer rule for `[!quote]` / `[!cite]` Obsidian callouts, producing `<div class="citation-card" data-wikilink="...">` containing the header, quote body, and attribution.

7. **`src/style.css`**:
   - Style `.citation-card`: bounded card, clean hairline border, subtle background tint, quotation mark icon, source badge link, and responsive touch layout.
   - Remove deprecated `.make-note-btn` and `.make-note-seed-btn` CSS rules.

---

## 5. Verification & Completed Implementation

- [x] **UI Cleanup Complete**: "Make note" / "Make it a note" buttons successfully removed from seed cards (`src/ui/card.js`), reader header action bar and more menu (`src/ui/reader.js`), growth sheets (`src/ui/growth.js`), and card menu handlers (`src/app.js`).
- [x] **Dynamic Highlights Folder Indexing**:
  - `src/ui/compose.js` dynamically pulls `highlightsFolder()` from preferences.
  - Citation picker indexes only notes matching the configured highlights folder path, preventing library bloating.
  - Search input dynamically indicates the target directory (`Search citations in <folder>...`).
- [x] **Renamed to "Include citation"**:
  - `index.html`: `#compose-include-citation` button labeled `“ Include citation…`.
  - `src/ui/compose.js`: modal sheet titled `Include citation`.
- [x] **Obsidian Callout Syntax Insertion**:
  - Inserts standard `> [!quote] [[TargetPath|Title]]\n> Quoted passage\n> — Source`.
  - Reciprocal link tracked on save for graph synchronization.
- [x] **Bounded Citation Card Rendering**:
  - `src/ui/reader.js`: `transformCitationCards()` transforms citation callouts and blockquotes with source links into bounded cards.
  - Header displays quotation accent (`“`) and `CITED EVIDENCE` kicker with direct clickable source link (`[Title] ↗`).
  - Styled with distinct typography (`src/style.css`), hairline borders, and subtle background contrast.
- [x] **Graph Integrity Maintained**:
  - Standard `[[WikiLinks]]` inside callouts are indexed by `notes-index.js`.
  - Outbound references and inbound "Referenced By" links are accurately populated.
- [x] **Compilation & Linting Verified**: Zero build or lint errors (`compile_applet` passed).
