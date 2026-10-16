# Implementation Plan: OPDS Catalog Integration, Deep-Linked Highlights, Agnostic Attachments & Export Suite (Revised)

This plan details the architecture and implementation for four major capabilities in Readover:
1. **OPDS Catalog Integration ("Browse Remote, Stash Local")** in Shelves with robust relative URL normalization and smart book acquisition.
2. **PDF & Book Highlights Deep-Linking & Provenance** with deterministic locator contracts and pre-flight missing-book recovery.
3. **Storage-Agnostic Image & Attachment Architecture** with client-side canvas WebP compression, unified composer (`compose.js`) and reader (`reader.js`) paste/drop support, unified destination routing, and dynamic Markdown rendering.
4. **Export & Sharing Suite** with dual-format rich clipboard copy, native OS sharing, and ink-friendly `@media print` vector CSS.

---

## User Review & Architecture Alignment

> [!NOTE]
> Key Architectural Rules:
> - **OPDS Relative URL Resolution:** All extracted `href` attributes in `src/sources/opds.js` (feed links, covers, icons, acquisition binaries, facets, and search templates) are strictly normalized against the current feed URL via `new URL(href, currentFeedUrl).href`.
> - **Unified Image Drop/Paste Support:** Image paste and drag-and-drop listeners are integrated into both the **Unified Note Composer** (`src/ui/compose.js`) and the **Note Reader/Editor** (`src/ui/reader.js`).
> - **OPDS Catalog Placement:** In **Shelves** as a dedicated "Catalogs" section with live search and feed traversal.
> - **Book Acquisition Flow:** Acquires directly to the configured books destination (`acquiredBooksHome`), with an inline override toggle to stash locally to "This Device".
> - **Attachment Links:** Always formatted as clean, portable relative Markdown paths (e.g. `![](attachments/2026-10-15-slug-a1b2.webp)`), dynamically resolved by the Readover Markdown renderer from IndexedDB cache or active cloud storage (R2/S3, Dropbox, WebDAV, GitHub, or Local).

---

## Proposed Changes

### 1. OPDS Catalog Integration: "Browse Remote, Stash Local"
- **New Module `src/sources/opds.js`**:
  - Supports OPDS 1.2 (Atom XML / Dublin Core) and OPDS 2.0 (JSON Navigation & Acquisition feeds).
  - Robust XML DOM parser for Atom entry elements (`<entry>`, `<link rel="http://opds-spec.org/acquisition" ...>`, `<link rel="http://opds-spec.org/image" ...>`, `<link rel="subsection" ...>`, `<link rel="search" ...>`).
  - **Full Relative URL Normalization**:
    ```javascript
    function resolveUrl(href, baseUrl) {
      if (!href) return null;
      try {
        return new URL(href, baseUrl).href;
      } catch {
        return href;
      }
    }
    ```
    Applied to all cover images, thumbnails, subsection feed links, acquisition downloads, and OpenSearch template descriptors.
  - Extract metadata: Title, Authors, Summary, Publication Date, Categories, Covers, and EPUB/PDF acquisition links.
  - **CORS & Auth Handling**:
    - Direct-first `fetch(url, { headers })` for CORS-enabled Calibre-Web, Kavita, Komga, or reverse proxy setups.
    - User-configurable **CORS Proxy URL** in Settings (Tab 1: Sources & Sync) for static deployments or strict remote instances.
    - HTTP Basic Auth / Bearer token support per catalog.
- **Store & Settings Additions**:
  - `store.js`: Add `catalogs` collection in local storage / IndexedDB (`id`, `name`, `url`, `authType`, `username`, `password`, `corsProxy`).
  - `settings.js`: Catalog manager (Add Catalog, Presets for Calibre-Web, Standard Ebooks, Feedbooks, Project Gutenberg) + "Acquired books go to" destination selector.
- **Shelves UI (`src/ui/types.js` & `src/ui/opds-catalog.js`)**:
  - Add a dedicated "Catalogs" section in the Shelves drawer.
  - Interactive catalog browser: navigate hierarchical feeds, search catalog titles, view cover grids and book detail sheets.
  - Book Detail Modal: Book cover, description, format tags (`EPUB`, `PDF`), and an **Acquire** button:
    - Primary action: `[ Acquire ]` (immediately streams book and saves to configured `acquiredBooksHome`).
    - Inline override: `(Saving to: Cloudflare R2 · Change)` allows one-tap switch to save only to "This Device".
    - Stashes book metadata to `store.items` and book binary to `store.blobs` or remote destination.

---

### 2. PDF & Book Highlights: Deep-Linking & Provenance
- **Highlight Locator Metadata Contract**:
  - Define deterministic locator contracts for EPUB and PDF highlights:
    ```markdown
    ---
    source_type: epub # or 'pdf'
    book_ref: "books/the-creative-act.epub" # or SHA hash / storage path
    book_title: "The Creative Act"
    cfi: "epubcfi(/6/14[chapter-2]!/4/2/12,/1:0,/1:142)"
    page: 42 # for PDF or estimated EPUB
    chapter: "Chapter 2: Tuning In"
    created_at: 2026-10-15T07:20:00Z
    ---

    > "The artist is not the originator of ideas; the artist is a receiver."
    — [The Creative Act, p. 42](readover://jump?book=books%2Fthe-creative-act.epub&cfi=epubcfi...)
    ```
- **Locator Extraction in Readers**:
  - `src/reader/foliate-view.js`: Capture CFI range, chapter title, and surrounding context on selection highlight.
  - `src/reader/pdf-view.js`: Capture page number, quad points/rectangles, and highlighted text on selection highlight.
- **Deep-Link Citation Jump Handler**:
  - Intercept citation links in `src/ui/reader.js` and `src/markdown.js`.
  - **Pre-flight check**:
    1. Check if `book_ref` exists in `store.items` and local `store.blobs`.
    2. If missing on current device, display friendly modal:
       `"Source book 'The Creative Act' is not cached on this device."`
       `[ Download from Library / R2 ] [ Dismiss ]`
    3. When present, seamlessly launch the EPUB or PDF viewer and seek directly to the exact CFI or page.

---

### 3. Images & Attachments: Storage-Agnostic Architecture
- **Attachment Pipeline (`src/attachments.js`)**:
  - **Unified Event Handling in Composer & Reader**:
    - Listen for `paste` and `drop` events on:
      1. `src/ui/compose.js` textarea (when creating a new note or fast capture).
      2. `src/ui/reader.js` textarea (when editing an existing note or adding a thought).
  - **Client-Side Canvas Compression**:
    - Auto-scale image to max dimension 1600px maintaining aspect ratio.
    - Export as `image/webp` with quality 0.8 (typically ~80–150 KB).
  - **Deterministic Naming**:
    - Pattern: `attachments/YYYY-MM-DD-${slug}-${hash.slice(0, 6)}.webp`.
  - **Unified Destination Routing**:
    - In Settings (Tab 2: Garden): `Attachments destination` option:
      - Default: `"Same provider as active note"` (saves into `attachments/` folder in the note's repository/storage).
      - Cloud Vault: `"Cloudflare R2 / S3 Bucket"` (direct upload to R2/S3 object storage, keeping Git notes pure text).
    - Save binary via unified storage adapter: `library.putAttachment(src, path, blob)`.
    - Cache in IndexedDB `store.blobs` for immediate offline-first access.
    - Insert clean, portable relative Markdown into editor: `![](attachments/2026-10-15-concept-a8f1.webp)`.
- **Markdown Interceptor & Resolver (`src/markdown.js`)**:
  - Catch all `<img src="...">` with relative or `attachments/` paths during rendering.
  - Resolve to IndexedDB blob cache or fetch via storage adapter.
  - Generate temporary Object URL `URL.createObjectURL(blob)`.
  - Track created Object URLs and revoke on view transition (`URL.revokeObjectURL`) to prevent mobile memory leaks.

---

### 4. Export & Sharing Suite and Print CSS
- **Rich Clipboard Copy (`navigator.clipboard.write`)**:
  - Dual-format clipboard entry with both `text/html` and `text/plain` payloads.
  - Fully enveloped HTML document with self-contained styles for blockquotes, italics, headings, and citations.
  - Bypasses mobile keyboard clipboard managers (like Gboard) that truncate plain text at 20,000 characters.
  - Preserves formatting cleanly when pasted into Substack, Medium, or Google Docs.
- **Native OS Share Sheet (`navigator.share`)**:
  - Integrated into note reader and card feed menus.
  - Provides native sharing with titles, excerpts, and URLs to Signal, WhatsApp, Apple Notes, or Mail.
- **Ink-Friendly Print / PDF Vector Export (`@media print`)**:
  - Dedicated print styles in `src/style.css`:
    - Strip all navigation bars, tab bars, action buttons, sheet overlays, and status footers.
    - Optimize typography with high-contrast text and crisp image rendering.
    - Style citation cards with delicate hairline borders and `page-break-inside: avoid;`.
    - Automatically append URLs to external links: `a[href^="http"]::after { content: " (" attr(href) ")"; font-size: 0.85em; opacity: 0.8; }`.
    - Trigger via `window.print()` in reader menu and Settings export card.

---

## Verification Plan

### Automated & Compilation Tests
- Run `compile_applet` to verify TypeScript/JavaScript syntax and build stability.
- Run `lint_applet` to verify no broken imports, undeclared variables, or syntax errors.

### Manual Verification
1. **OPDS Catalog**:
   - Add sample OPDS catalog (e.g. Standard Ebooks or Calibre-Web feed).
   - Test feed browsing, category pagination, search query handling, and cover loading with relative URL resolution.
   - Test `[ Acquire ]` with default destination and verify inline override to "This Device".
2. **Deep-Linked Highlights**:
   - Create a highlight in an EPUB and a PDF.
   - Verify frontmatter schema and Markdown citation link structure.
   - Click citation link: verify pre-flight verification, missing-book prompt, and jump directly to the highlighted CFI/page.
3. **Attachments & Image Compression**:
   - Test paste / drop in `compose.js` and `reader.js`.
   - Verify canvas WebP compression to ~100 KB and storage path `attachments/YYYY-MM-DD-...webp`.
   - Verify note rendering resolves relative image path smoothly offline and online.
4. **Export Suite & Print**:
   - Trigger Rich Copy and paste into test receiver; verify HTML headings and blockquote styling.
   - Test Print Dialog preview; verify chrome is completely stripped, citations have hairline borders, and URLs are printed cleanly.
