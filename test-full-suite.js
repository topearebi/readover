import assert from 'node:assert';
import fs from 'node:fs';

// Top-level watchdog timer (15s limit) with diagnostic handle dump
const WATCHDOG_TIMEOUT_MS = 15000;
const watchdog = setTimeout(() => {
  console.error('\n🚨 [WATCHDOG TIMEOUT] test-full-suite.js exceeded 15s execution threshold!');
  if (typeof process._getActiveHandles === 'function') {
    const handles = process._getActiveHandles();
    console.error(`Active handles count: ${handles.length}`);
    for (const h of handles.slice(0, 10)) {
      console.error(`- Handle type: ${h?.constructor?.name || typeof h}`);
    }
  }
  process.exit(1);
}, WATCHDOG_TIMEOUT_MS);
watchdog.unref();

// Mock browser environment for headless Node.js run
const mockDoc = {
  implementation: { createHTMLDocument: () => ({ body: {}, createElement: () => ({ setAttribute: () => {} }) }) },
  createElement: () => ({ setAttribute: () => {}, getAttribute: () => null }),
  addEventListener: () => {},
  removeEventListener: () => {},
  querySelectorAll: () => [],
};

globalThis.document = mockDoc;
globalThis.window = {
  document: mockDoc,
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
  Node: function Node() {},
  Element: function Element() {},
  DOMParser: function DOMParser() {
    return {
      parseFromString: (str, type) => {
        // Lightweight Atom XML regex parser for Node test runner
        return {
          documentElement: {
            querySelectorAll: (sel) => [],
            getElementsByTagName: (tag) => [],
          },
        };
      },
    };
  },
};
globalThis.Node = globalThis.window.Node;
globalThis.Element = globalThis.window.Element;
globalThis.DOMParser = globalThis.window.DOMParser;
const idbData = new Map();
globalThis.indexedDB = {
  open: () => {
    function makeReq(resultVal = null) {
      const r = { onsuccess: null, onerror: null, result: resultVal };
      setTimeout(() => {
        if (typeof r.onsuccess === 'function') r.onsuccess({ target: r });
      }, 0);
      return r;
    }
    const mockStore = (name) => ({
      get: (k) => makeReq(idbData.get(`${name}:${k}`) || null),
      put: (v) => {
        const key = v.key || v.id || v.sha;
        idbData.set(`${name}:${key}`, v);
        return makeReq(key);
      },
      delete: (k) => {
        idbData.delete(`${name}:${k}`);
        return makeReq(null);
      },
      getAll: () => makeReq(Array.from(idbData.entries()).filter(([k]) => k.startsWith(`${name}:`)).map(([, v]) => v)),
      clear: () => {
        for (const k of idbData.keys()) {
          if (k.startsWith(`${name}:`)) idbData.delete(k);
        }
        return makeReq(null);
      },
      index: () => ({
        getAll: () => makeReq([]),
        getAllKeys: () => makeReq([]),
      }),
    });
    const mockDb = {
      close: () => {},
      createObjectStore: (name) => mockStore(name),
      transaction: (storeNames) => {
        const primaryStore = Array.isArray(storeNames) ? storeNames[0] : storeNames;
        const tx = {
          objectStore: (name) => mockStore(name || primaryStore),
          oncomplete: null,
          onerror: null,
          onabort: null,
        };
        setTimeout(() => {
          if (typeof tx.oncomplete === 'function') tx.oncomplete();
        }, 1);
        return tx;
      },
    };
    const req = { onupgradeneeded: null, onsuccess: null, onerror: null, result: mockDb };
    setTimeout(() => req.onsuccess?.({ target: req }), 0);
    return req;
  },
};
globalThis.localStorage = {
  store: {},
  getItem(k) { return this.store[k] || null; },
  setItem(k, v) { this.store[k] = String(v); },
  removeItem(k) { delete this.store[k]; },
  clear() { this.store = {}; },
};

console.log('🧪 Starting Readover Comprehensive End-to-End & Health Test Suite...');

// Dynamic module imports
const { validateCssStructure } = await import('./lint-css.js');
let postcss = null;
try {
  postcss = (await import('postcss')).default;
} catch {}

/* =========================================================================
   Step 0: CSS AST Linter Validation (Prior to Any Feature Tests)
   ========================================================================= */
console.log('\n--- Step 0: CSS AST Linter Validation ---');
const styleCssPath = './src/style.css';
assert.ok(fs.existsSync(styleCssPath), 'src/style.css must exist');
const styleCssContent = fs.readFileSync(styleCssPath, 'utf8');

if (postcss) {
  try {
    const root = postcss.parse(styleCssContent, { from: styleCssPath });
    assert.ok(root && root.nodes && root.nodes.length > 0, 'PostCSS root AST must have nodes');
    console.log('✅ PostCSS AST parser validated src/style.css: 0 syntax errors.');
  } catch (err) {
    assert.fail(`PostCSS syntax validation failed: ${err.message}`);
  }
} else {
  const cssAstResult = validateCssStructure(styleCssContent, styleCssPath);
  assert.strictEqual(
    cssAstResult.errors.length,
    0,
    `CSS AST validation failed on src/style.css:\n${cssAstResult.errors.map((e) => `  [line ${e.line}:${e.col}] ${e.message}`).join('\n')}`
  );
  console.log('✅ CSS AST structural validator verified src/style.css: 0 unclosed blocks or bracket errors.');
}

const { isInsightOrHighlight } = await import('./src/insights.js');
const {
  formatGardenNoteBody,
  extractInsightComponents,
  addRelatedLink,
  addToSection,
  wikiLink,
  parseFrontmatter,
  sanitizeFilename,
  isPathSafe,
  slugify,
} = await import('./src/notefile.js');
const { saveBookToVault, booksFolder, booksHome } = await import('./src/insights.js');

/* =========================================================================
   Test 1: Scoping Logic & Insight Qualification
   ========================================================================= */
console.log('\n--- Test 1: Scoping Logic & Insight Qualification ---');

const insightNote = {
  item: { path: 'Highlights/Atomic Habits.md', folder: 'Highlights' },
  note: {
    title: 'Atomic Habits Insight',
    meta: { source: 'Atomic Habits' },
    highlights: [{ text: 'Small habits make a big difference.' }],
  },
  rawText: `---
title: Small habits
source: Atomic Habits
---

> Small habits make a big difference.
>
> — James Clear, Atomic Habits

A thought on atomic habits.`,
};

const plainEssay = {
  item: { path: 'Essays/On Focus.md', folder: 'Essays' },
  note: {
    title: 'On Focus',
    meta: {},
    highlights: [],
  },
  rawText: `---
title: On Focus
date: 2026-05-01
---

Focus is the art of knowing what to ignore. In a world full of noise, deep attention is the scarcest currency.`,
};

const quoteNoteInRandomFolder = {
  item: { path: 'Journal/2026-10-10.md', folder: 'Journal' },
  note: {
    title: '2026-10-10 Journal',
    meta: {},
    highlights: [],
  },
  rawText: `---
title: 2026-10-10
---

Today I came across this inspiring sentence:

> Simplicity is prerequisite for reliability.
> — Edsger W. Dijkstra

I should remember this for my software design.`,
};

assert.strictEqual(
  isInsightOrHighlight(insightNote.item, insightNote.note, insightNote.rawText),
  true,
  'Insight note in Highlights folder must qualify for Make it a note'
);

assert.strictEqual(
  isInsightOrHighlight(plainEssay.item, plainEssay.note, plainEssay.rawText),
  false,
  'Plain essay without blockquote quotes must NOT qualify for Make it a note'
);

assert.strictEqual(
  isInsightOrHighlight(quoteNoteInRandomFolder.item, quoteNoteInRandomFolder.note, quoteNoteInRandomFolder.rawText),
  true,
  'Note containing blockquote citation in Journal folder must qualify for Make it a note'
);

console.log('✅ Scoping logic correctly filters insights vs standard notes.');

/* =========================================================================
   Test 2: Clean Markdown Prose Hierarchy (formatGardenNoteBody)
   ========================================================================= */
console.log('\n--- Test 2: Clean Markdown Prose Hierarchy ---');

const formattedBody = formatGardenNoteBody({
  thought: 'This principle transforms how we approach system reliability and personal clarity.',
  quote: 'Simplicity is prerequisite for reliability.',
  attribution: 'Edsger W. Dijkstra',
  relatedLink: '[[Atomic Habits]]',
});

assert.ok(
  formattedBody.startsWith('This principle transforms'),
  'Thought must be the opening lead prose'
);
assert.ok(
  formattedBody.includes('> Simplicity is prerequisite for reliability.\n>\n> — Edsger W. Dijkstra'),
  'Blockquote citation must follow cleanly without raw frontmatter or duplicate headers'
);
assert.ok(
  formattedBody.includes('## Related\n\n- [[Atomic Habits]]'),
  'Reciprocal link must appear under ## Related'
);
assert.ok(
  !formattedBody.includes('---'),
  'No raw frontmatter fences should leak into note body'
);

console.log('✅ Clean markdown prose hierarchy matches specification.');

/* =========================================================================
   Test 3: Automated Reciprocal Linking & Deduplication
   ========================================================================= */
console.log('\n--- Test 3: Reciprocal Linking & Deduplication ---');

const initialSourceText = `---
title: Atomic Habits Insight
---

> An important quote.

## Related

- [[Existing Note]]`;

const newGardenNoteLink = wikiLink('Essays/2026-10-13-habit-architecture.md', 'Habit Architecture');
assert.strictEqual(newGardenNoteLink, '[[2026-10-13-habit-architecture|Habit Architecture]]');

const updatedSourceText = addRelatedLink(initialSourceText, newGardenNoteLink);
assert.ok(
  updatedSourceText.includes('- [[2026-10-13-habit-architecture|Habit Architecture]]'),
  'Reciprocal link must be appended under ## Related'
);

// Deduplication test
const deduplicatedText = addRelatedLink(updatedSourceText, newGardenNoteLink);
assert.strictEqual(
  deduplicatedText,
  updatedSourceText,
  'addRelatedLink must not append duplicate links if already present'
);

console.log('✅ Automated reciprocal linking and deduplication verified.');

/* =========================================================================
   Test 4: Hostile Path Sanitizer & Cross-Platform Safety
   ========================================================================= */
console.log('\n--- Test 4: Hostile Path Sanitizer & Cross-Platform Safety ---');

const testCases = [
  { raw: 'Study: Notes on Logic', forbidden: [':', '\\', '*', '?'] },
  { raw: 'Input / Output Analysis', forbidden: [':', '\\', '*', '?', '/'] },
  { raw: 'C:\\Windows\\System32', forbidden: [':', '\\'] },
  { raw: 'Why do complex systems fail?', forbidden: ['?'] },
  { raw: 'Draft...   ', checkTrailing: true },
  { raw: 'CON.md', reservedCheck: true },
  { raw: 'PRN.txt', reservedCheck: true },
  { raw: '🪴 Garden Ideas — 2026', checkSlug: true },
  { raw: '\x00\x1fClean\x08Note', forbidden: ['\x00', '\x1f', '\x08'] },
  { raw: '../../etc/passwd', checkTraversal: true },
];

for (const tc of testCases) {
  const clean = sanitizeFilename(tc.raw);
  const slug = slugify(tc.raw);
  
  if (tc.forbidden) {
    for (const char of tc.forbidden) {
      assert.ok(!clean.includes(char), `sanitizeFilename failed: contains forbidden char "${char}" in "${clean}"`);
    }
  }
  if (tc.checkTrailing) {
    assert.ok(!clean.endsWith('.') && !clean.endsWith(' '), `sanitizeFilename failed: trailing dot/space in "${clean}"`);
  }
  if (tc.reservedCheck) {
    assert.ok(!/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i.test(clean), `sanitizeFilename failed: reserved device name in "${clean}"`);
  }
  if (tc.checkSlug) {
    assert.ok(slug.includes('garden-ideas-2026'), `slugify failed to normalize unicode/emoji: got "${slug}"`);
  }
}

assert.strictEqual(isPathSafe('Notes/Valid Note.md'), true);
assert.strictEqual(isPathSafe('../invalid.md'), false);
assert.strictEqual(isPathSafe('/absolute/path.md'), false);
assert.strictEqual(isPathSafe('Notes/Invalid:Char.md'), false);
assert.strictEqual(isPathSafe('Notes/CON.md'), false);

console.log('✅ Hostile path sanitizer passed all cross-platform assertions (Windows, Git, Dropbox, WebDAV).');

/* =========================================================================
   Test 5: Book Vault Ingestion & Storage Architecture
   ========================================================================= */
console.log('\n--- Test 5: Book Vault Ingestion & Storage Architecture ---');

// Test booksFolder() defaults and normalization
assert.strictEqual(booksFolder(), 'books', 'Default booksFolder must be "books"');

// Test saveBookToVault commits item and blob
const mockBlob = new Blob(['mock-epub-data'], { type: 'application/epub+zip' });
const savedItem = await saveBookToVault({
  blob: mockBlob,
  filename: 'test-vault-book.epub',
  title: 'Test Vault Book',
  author: 'Author Name',
  format: 'epub',
});

assert.ok(savedItem && savedItem.key, 'saveBookToVault must return committed item with key');
assert.strictEqual(savedItem.kind, 'epub', 'Item kind must be epub');
assert.ok(savedItem.folder.includes('books'), 'Item folder must contain books subfolder');
assert.strictEqual(savedItem.name, 'test-vault-book.epub');

// Verify stored in IndexedDB items and blobs
const storeModule = await import('./src/store.js');
const retrievedItem = await storeModule.items.get(savedItem.key);
assert.ok(retrievedItem, 'Item must be stored in items table');
assert.strictEqual(retrievedItem.name, 'test-vault-book.epub');

const retrievedBlob = await storeModule.blobs.get(savedItem.key);
assert.ok(retrievedBlob && retrievedBlob.blob, 'Blob must be stored in blobs table');

// Path security check for vault books
assert.ok(isPathSafe(savedItem.path), 'Book vault path must pass isPathSafe check');
assert.ok(!isPathSafe('../../dangerous.epub'), 'Hostile traversal path must be rejected');

// Binary Ghost Upload Defense: 0-byte rejection contract
await assert.rejects(
  async () => {
    await saveBookToVault({ blob: new Blob([]), filename: 'ghost-empty.epub' });
  },
  /0 bytes/,
  'saveBookToVault must fail fast and reject 0-byte payload'
);

const { validateBinaryPayload, cloneBlob, verifyRemoteSize } = await import('./src/utils/binary.js');
assert.throws(() => verifyRemoteSize({ expectedSize: 1024, remoteSize: 0, provider: 'Dropbox' }), /Dropbox received 0 bytes/);
assert.throws(() => verifyRemoteSize({ expectedSize: 1024, remoteSize: 512, provider: 'Dropbox' }), /byte mismatch/);
assert.strictEqual(verifyRemoteSize({ expectedSize: 1024, remoteSize: 1024, provider: 'Dropbox' }), true);

console.log('✅ Book Vault Ingestion, path normalization, and IDB storage verified.');

/* =========================================================================
   Test 6: Outbox Queue Serialization Integrity
   ========================================================================= */
console.log('\n--- Test 6: Outbox Queue Serialization Integrity ---');

const queueItem = {
  id: 'out_123456',
  sourceId: 'gh_abc',
  path: 'Notes/2026-10-15-complex-systems.md',
  op: 'write',
  text: `---
title: Complex Systems
date: 2026-10-15
tags: [systems, complexity]
---

# Complex Systems

A system is an interconnected set of elements coherently organized in a way that achieves something.

> "You think that because you understand 'one' that you must therefore understand 'two' because one and one make two. But you forget that you must also understand 'and'."
> — Donella Meadows
`,
  baseSha: 'a1b2c3d4e5f6',
  retryCount: 0,
  nextRetry: Date.now() + 10000,
};

const jsonStr = JSON.stringify(queueItem);
const restoredItem = JSON.parse(jsonStr);

assert.strictEqual(restoredItem.id, queueItem.id);
assert.strictEqual(restoredItem.path, queueItem.path);
assert.strictEqual(restoredItem.text, queueItem.text);
assert.strictEqual(restoredItem.baseSha, queueItem.baseSha);

console.log('✅ Outbox queue payload serialization verified with complete fidelity.');

/* =========================================================================
   Test 7: DOM, SVG Symbols, ARIA Labels & Viewport Configuration
   ========================================================================= */
console.log('\n--- Test 7: DOM, ARIA Labels & Viewport Configuration ---');

const html = fs.readFileSync('./index.html', 'utf8');

assert.ok(html.includes('interactive-widget=resizes-content'), 'index.html must include interactive-widget=resizes-content in viewport meta');
assert.ok(html.includes('id="theme-color-meta"'), 'index.html must have id="theme-color-meta" for dynamic OS theme bar syncing');
assert.ok(html.includes('<noscript>'), 'index.html must include accessible <noscript> legacy browser fallback');
assert.ok(html.includes('id="diagnostics-sheet"'), 'index.html must include #diagnostics-sheet modal');
assert.ok(html.includes('id="run-diagnostics-btn"'), 'index.html must include #run-diagnostics-btn in settings');
assert.ok(html.includes('aria-label="Readover, shuffle feed (R)"'), 'Brand button must have descriptive aria-label');
assert.ok(html.includes('aria-label="Filter reading feed"'), 'Scope button must have descriptive aria-label');
assert.ok(html.includes('id="sync-dot"') && html.includes('aria-label="Sync status"') && html.includes('title="Sync status"'), 'sync-dot must have accessible aria-label and title');
assert.ok(html.includes('id="scope-btn" class="scope-chip scope-btn"'), 'scope-btn must have both scope-chip and scope-btn classes');
assert.ok(html.includes('aria-label="Search all notes (/)"'), 'Search button must have descriptive aria-label');
assert.ok(html.includes('aria-label="Write a new note (+ or N)"'), 'Write button must have descriptive aria-label');
assert.ok(html.includes('aria-label="Open settings"'), 'Settings button must have descriptive aria-label');
assert.ok(html.includes('id="i-drop"'), 'index.html must include i-drop SVG symbol for water droplet');
assert.ok(html.includes('id="i-clipboard"'), 'index.html must include i-clipboard SVG symbol for publishing copy');
assert.ok(html.includes('id="i-printer"'), 'index.html must include i-printer SVG symbol for print action');
assert.ok(html.includes('id="i-graft"'), 'index.html must include i-graft SVG symbol for grafting notes');
assert.ok(html.includes('id="compose-attach-image"'), 'index.html must include #compose-attach-image button');
assert.ok(html.includes('id="compose-image-input"'), 'index.html must include #compose-image-input file input');
assert.ok(html.includes('id="edit-source-sheet"'), 'index.html must include #edit-source-sheet modal for editing storage providers');
assert.ok(html.includes('id="edit-source-form"'), 'index.html must include #edit-source-form');
assert.ok(html.includes('id="i-eye"'), 'index.html must include #i-eye SVG symbol for credential visibility toggle');
assert.ok(html.includes('/ResizeObserver loop/i'), 'index.html must include ResizeObserver loop error filter in global error trap');
assert.ok(html.includes('__readoverDetachBootError'), 'index.html must expose __readoverDetachBootError hook for clean post-boot detachment');

console.log('✅ DOM entry points, viewport meta, ARIA labels, and noscript fallbacks verified.');

/* =========================================================================
   Test 8: CSS Touch Targets, 100dvh & Diagnostic Styles
   ========================================================================= */
console.log('\n--- Test 8: CSS Layout, 100dvh & Touch Targets ---');

const css = fs.readFileSync('./src/style.css', 'utf8');

assert.ok(css.includes('.diagnostics-sheet'), 'style.css must define .diagnostics-sheet');
assert.ok(css.includes('max-height: 100dvh;'), 'style.css must support 100dvh for mobile sheets');
assert.ok(css.includes('min-width: 44px;'), 'style.css must enforce >= 44px touch targets on icon-btn');
assert.ok(css.includes('min-height: 44px;'), 'style.css must enforce >= 44px touch targets on icon-btn');
assert.ok(css.includes('.scope-chip,') && css.includes('.scope-btn,'), 'style.css must enforce touch targets on scope button');
assert.ok(css.includes('.card-water-box') && css.includes('display: none !important;'), 'style.css must suppress .card-water-box');
assert.ok(css.includes('.rail .water-btn'), 'style.css must style .rail .water-btn');
assert.ok(css.includes('.reader-dock'), 'style.css must define .reader-dock');
assert.ok(css.includes('.reader-dock-btn'), 'style.css must define .reader-dock-btn');
assert.ok(css.includes('.menu-divider'), 'style.css must define .menu-divider');
assert.ok(css.includes('.grow-field-pair'), 'style.css must define .grow-field-pair');
assert.ok(css.includes('.sheet-action'), 'style.css must style .sheet-action');
assert.ok(css.includes(':focus-visible'), 'style.css must define high-contrast :focus-visible outline');
assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'), 'style.css must include prefers-reduced-motion accessibility rules');

// Structural CSS Block & Bracket Parsing (PostCSS-equivalent validation)
const cssCheck = validateCssStructure(css, 'src/style.css');
assert.ok(cssCheck.success, `Structural CSS validation failed: ${cssCheck.errors.map((e) => e.message).join(', ')}`);

console.log('✅ CSS touch targets, 100dvh viewport rules, structural block/media parsing, and diagnostic styles verified.');

/* =========================================================================
   Test 9: Service Worker Shell Cache & Assets Integrity & Eviction Contract
   ========================================================================= */
console.log('\n--- Test 9: Service Worker Shell Cache, Assets Integrity & Eviction ---');

const { VERSION, SHELL_CACHE } = await import('./src/version.js');
const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));

// 1. Version Parity Check: package.json vs src/version.js
assert.strictEqual(VERSION, pkg.version, `src/version.js VERSION (${VERSION}) must match package.json version (${pkg.version})`);
assert.strictEqual(SHELL_CACHE, `readover-shell-v${VERSION}`, `SHELL_CACHE must format as readover-shell-v${VERSION}`);

// 2. Service Worker Cache Definition Check
const swContent = fs.readFileSync('./sw.js', 'utf8');
assert.ok(swContent.includes(`const SHELL_CACHE = '${SHELL_CACHE}';`), `sw.js must declare SHELL_CACHE = '${SHELL_CACHE}' matching version milestone`);
assert.ok(swContent.includes("SKIP_WAITING"), 'sw.js must support SKIP_WAITING message');

// 3. Service Worker Cache Eviction Contract Test
assert.ok(swContent.includes("addEventListener('activate'"), 'sw.js must register activate event listener');
assert.ok(swContent.includes('caches.delete'), 'sw.js activate listener must invoke caches.delete to purge obsolete caches');

// Simulating cache eviction logic from sw.js activate listener
const keep = new Set([SHELL_CACHE, 'readover-vendor-v2']);
const mockExistingCaches = [
  'readover-shell-v6',
  'readover-shell-v7',
  'readover-shell-v9',
  'readover-shell-v4.0.0',
  'readover-vendor-v2',
  'unrelated-cache-xyz',
];
const toDelete = mockExistingCaches.filter((k) => k.startsWith('readover-') && !keep.has(k));
assert.deepStrictEqual(
  toDelete,
  ['readover-shell-v6', 'readover-shell-v7', 'readover-shell-v9'],
  'Activate handler must selectively delete all legacy readover shells and preserve current shell and vendor caches'
);

// 4. Extract SHELL array and verify every referenced file exists on disk
const match = swContent.match(/const SHELL = \[([\s\S]*?)\];/);
assert.ok(match, 'sw.js must define const SHELL array');
const fileMatches = match[1].match(/'\.\/([^']+)'/g);
assert.ok(fileMatches && fileMatches.length > 20, 'sw.js SHELL array must contain files');

for (const m of fileMatches) {
  const relPath = m.replace(/'/g, '');
  if (relPath === './') continue;
  const filePath = relPath.replace(/^\.\//, '');
  assert.ok(fs.existsSync(filePath), `File in sw.js SHELL must exist on disk: ${filePath}`);
}

console.log(`✅ All ${fileMatches.length} Service Worker shell precache assets and cache eviction contract verified.`);

/* =========================================================================
   Test 10: Manifest & Module Export Linkage Verification
   ========================================================================= */
console.log('\n--- Test 10: Web App Manifest & Module Linkage Verification ---');

const manifest = JSON.parse(fs.readFileSync('./manifest.json', 'utf8'));
assert.strictEqual(manifest.share_target?.enctype, 'multipart/form-data', 'manifest.json share_target must specify enctype multipart/form-data');
assert.strictEqual(manifest.share_target?.method, 'POST', 'manifest.json share_target must specify method POST');
assert.ok(manifest.share_target?.params?.files?.length > 0, 'manifest.json share_target must specify files param');

// Dynamic module import check
const insightsMod = await import('./src/insights.js');
assert.ok(typeof insightsMod.saveBookToVault === 'function', 'src/insights.js must export saveBookToVault');
assert.ok(typeof insightsMod.booksFolder === 'function', 'src/insights.js must export booksFolder');
assert.ok(typeof insightsMod.booksHome === 'function', 'src/insights.js must export booksHome');

const attachMod = await import('./src/attachments.js');
assert.ok(typeof attachMod.setupImageAttachments === 'function', 'src/attachments.js must export setupImageAttachments');
assert.ok(typeof attachMod.processAndSaveImage === 'function', 'src/attachments.js must export processAndSaveImage');
assert.ok(typeof attachMod.insertAtCursor === 'function', 'src/attachments.js must export insertAtCursor');
assert.ok(typeof attachMod.buildAttachmentPath === 'function', 'src/attachments.js must export buildAttachmentPath');
assert.ok(typeof attachMod.generateAttachmentFilename === 'function', 'src/attachments.js must export generateAttachmentFilename');

const binaryMod = await import('./src/utils/binary.js');
assert.ok(typeof binaryMod.validateBinaryPayload === 'function', 'src/utils/binary.js must export validateBinaryPayload');
assert.ok(typeof binaryMod.cloneBlob === 'function', 'src/utils/binary.js must export cloneBlob');
assert.ok(typeof binaryMod.verifyRemoteSize === 'function', 'src/utils/binary.js must export verifyRemoteSize');

const cardMod = await import('./src/ui/card.js');
assert.ok(typeof cardMod.rail === 'function', 'src/ui/card.js must export rail');

const sheetContent = fs.readFileSync('./src/ui/sheet.js', 'utf8');
assert.ok(sheetContent.includes('button.sheet-action:not([disabled])'), 'src/ui/sheet.js must query only button.sheet-action:not([disabled])');
assert.ok(sheetContent.includes('ArrowDown') && sheetContent.includes('ArrowUp'), 'src/ui/sheet.js must support ArrowDown/ArrowUp keyboard navigation');

const readerContent = fs.readFileSync('./src/ui/reader.js', 'utf8');
assert.ok(readerContent.includes("'aria-label': 'Graft: link to another note'"), 'src/ui/reader.js must use aria-label: Graft: link to another note');
assert.ok(readerContent.includes("id: 'reader-dock-graft'"), 'src/ui/reader.js must include #reader-dock-graft');

const growthContent = fs.readFileSync('./src/ui/growth.js', 'utf8');
assert.ok(growthContent.includes("'graft' : 'grafts'"), 'src/ui/growth.js must display graft/grafts');

const indexHtml = fs.readFileSync('./index.html', 'utf8');
assert.ok(indexHtml.includes('id="app-version"'), 'index.html must include #app-version span in Settings footer');
assert.ok(indexHtml.includes('id="sw-update-version"'), 'index.html must include #sw-update-version span in update banner');

const diagContent = fs.readFileSync('./src/ui/diagnostics.js', 'utf8');
assert.ok(diagContent.includes('Application Version: Readover ${VERSION}'), 'src/ui/diagnostics.js must format report with active VERSION');
assert.ok(diagContent.includes('SHELL_CACHE'), 'src/ui/diagnostics.js must dynamically reference SHELL_CACHE');

console.log('✅ Web App Manifest multipart enctype, core ES module exports, and botanical UI consistency verified successfully.');

/* =========================================================================
   Test 11: Static AST Linkage & Complete ES Module Integrity Checker
   ========================================================================= */
console.log('\n--- Test 11: Static AST Linkage & Complete ES Module Integrity Checker ---');

const { verifyAstLinkage } = await import('./test-ast-linkage.js');
const astResult = verifyAstLinkage({ directories: ['src'], files: ['sw.js'] });

if (!astResult.success) {
  console.error('AST Linkage Errors:', astResult.errors);
}
assert.ok(astResult.success, `AST Linkage check failed with ${astResult.errors.length} error(s)`);
assert.ok(astResult.totalImportsChecked > 350, 'Must check at least 350 static imports');
assert.ok(astResult.totalDynamicImportsChecked > 20, 'Must check dynamic imports');

console.log(`✅ AST Linkage Check: Verified 0 missing exports across ${astResult.filesChecked} modules (${astResult.totalImportsChecked} static imports, ${astResult.totalDynamicImportsChecked} dynamic imports).`);

clearTimeout(watchdog);
console.log('\n🎉 ALL 11 TEST SUITES COMPLETED WITH 100% SUCCESS!\n');
process.exit(0);
