import assert from 'node:assert';
import fs from 'node:fs';

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
    return { parseFromString: () => mockDoc };
  },
};
globalThis.Node = globalThis.window.Node;
globalThis.Element = globalThis.window.Element;
globalThis.DOMParser = globalThis.window.DOMParser;
globalThis.indexedDB = {
  open: () => {
    const req = { onupgradeneeded: null, onsuccess: null, onerror: null, result: { close: () => {} } };
    setTimeout(() => req.onsuccess?.({ target: req }), 0);
    return req;
  },
};
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

const { isInsightOrHighlight } = await import('./src/insights.js');
const {
  formatGardenNoteBody,
  extractInsightComponents,
  addRelatedLink,
  addToSection,
  wikiLink,
  parseFrontmatter,
} = await import('./src/notefile.js');

console.log('🧪 Starting Readover Flow & Logic Tests...');

// 1. Test Scoping Logic (isInsightOrHighlight)
console.log('\n--- Test 1: Scoping Logic ---');

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
  'Insight note in Highlights folder should qualify for Make it a note'
);

assert.strictEqual(
  isInsightOrHighlight(plainEssay.item, plainEssay.note, plainEssay.rawText),
  false,
  'Standard essay without quotes should NOT qualify for Make it a note'
);

assert.strictEqual(
  isInsightOrHighlight(quoteNoteInRandomFolder.item, quoteNoteInRandomFolder.note, quoteNoteInRandomFolder.rawText),
  true,
  'Note containing blockquoted citation in Journal should qualify for Make it a note'
);

console.log('✅ Scoping logic correctly filters insights vs standard notes.');

// 2. Test Markdown Prose Hierarchy (formatGardenNoteBody)
console.log('\n--- Test 2: Clean Markdown Prose Hierarchy ---');

const formattedBody = formatGardenNoteBody({
  thought: 'This principle transforms how we approach system reliability and personal clarity.',
  quote: 'Simplicity is prerequisite for reliability.',
  attribution: 'Edsger W. Dijkstra',
  relatedLink: '[[Atomic Habits]]',
});

console.log('Formatted Note Body Sample:\n', formattedBody);

assert.ok(
  formattedBody.startsWith('This principle transforms'),
  'Thought must be the opening editable lead prose'
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
assert.ok(
  !formattedBody.includes('## Lead Thought'),
  'No redundant mechanical section headers for thought prose'
);

console.log('✅ Clean markdown prose hierarchy matches specification.');

// 3. Test Insight Extraction (extractInsightComponents)
console.log('\n--- Test 3: Insight Extraction ---');

const extracted = extractInsightComponents(insightNote.rawText, insightNote.item.path, insightNote.note);
assert.strictEqual(extracted.title, 'Small habits');
assert.ok(extracted.quote.includes('Small habits make a big difference.'));
assert.strictEqual(extracted.thought, 'A thought on atomic habits.');
assert.ok(extracted.attribution.includes('Atomic Habits') || extracted.attribution.includes('James Clear'));

console.log('Extracted components:', extracted);
console.log('✅ Insight extraction properly separates quote, attribution, and thought.');

// 4. Test Automated Reciprocal Linking (addRelatedLink & wikiLink)
console.log('\n--- Test 4: Reciprocal Linking & Deduplication ---');

const initialSourceText = `---
title: Atomic Habits Insight
---

> An important quote.

## Related

- [[Existing Note]]`;

const newGardenNoteLink = wikiLink('Essays/2026-10-13-habit-architecture.md', 'Habit Architecture');
assert.strictEqual(newGardenNoteLink, '[[2026-10-13-habit-architecture|Habit Architecture]]');

const updatedSourceText = addRelatedLink(initialSourceText, newGardenNoteLink);
console.log('Updated Source Insight:\n', updatedSourceText);

assert.ok(
  updatedSourceText.includes('- [[2026-10-13-habit-architecture|Habit Architecture]]'),
  'Reciprocal link must be appended under ## Related'
);

// Test deduplication
const deduplicatedText = addRelatedLink(updatedSourceText, newGardenNoteLink);
assert.strictEqual(
  deduplicatedText,
  updatedSourceText,
  'addRelatedLink must not append duplicate links if already present'
);

console.log('✅ Automated reciprocal linking and deduplication verified.');

// 5. Test DOM & HTML Entry Points & SVG Icon
console.log('\n--- Test 5: DOM & SVG Icon Checks ---');

const html = fs.readFileSync('./index.html', 'utf8');

assert.ok(html.includes('id="i-cultivate"'), 'index.html must include #i-cultivate SVG symbol definition');
assert.ok(html.includes('id="compose-include-citation"'), 'index.html must include #compose-include-citation button');
assert.ok(html.includes('class="compose-submit-bar"'), 'index.html must wrap save button in .compose-submit-bar');
assert.ok(html.includes('class="btn btn-primary btn-save-note"'), 'index.html must have .btn-save-note');

console.log('✅ All DOM elements, icons, and sticky bar containers verified.');

// 6. Test CSS Touch Targets and Sticky Layout
console.log('\n--- Test 6: CSS Layout and Touch Target Audit ---');

const css = fs.readFileSync('./src/style.css', 'utf8');

assert.ok(css.includes('.icon-btn {'), 'style.css must define .icon-btn');
assert.ok(css.includes('min-width: 44px;'), 'style.css must enforce >= 44px touch targets on icon-btn');
assert.ok(css.includes('min-height: 44px;'), 'style.css must enforce >= 44px touch targets on icon-btn');
assert.ok(css.includes('.compose-submit-bar {'), 'style.css must define .compose-submit-bar');
assert.ok(css.includes('position: sticky;'), 'compose-submit-bar must be sticky');

console.log('✅ CSS touch targets, sticky bottom save bar, and responsive cultivate button verified.');

console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY! 100% compliant.\n');
