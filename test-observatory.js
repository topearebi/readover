import assert from 'node:assert';
import fs from 'node:fs';

// Mock minimal browser globals for Node.js test runner
globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
};
globalThis.document = {
  addEventListener: () => {},
  removeEventListener: () => {},
  getElementById: () => null,
};
globalThis.indexedDB = {
  open: () => {
    const mockStore = {
      get: () => ({ onsuccess: null, onerror: null }),
      put: () => ({ onsuccess: null, onerror: null }),
      delete: () => ({ onsuccess: null, onerror: null }),
      getAll: () => ({ onsuccess: null, onerror: null }),
      clear: () => ({ onsuccess: null, onerror: null }),
    };
    const mockDb = {
      close: () => {},
      transaction: () => ({
        objectStore: () => mockStore,
      }),
    };
    const req = { onupgradeneeded: null, onsuccess: null, onerror: null, result: mockDb };
    setTimeout(() => req.onsuccess?.({ target: req }), 0);
    return req;
  },
};

console.log('🧪 Starting Knowledge Observatory Verification Test Suite...\n');

const { computeObservatoryMetrics, plainBookTitle, extractNoteTags, computeLongestChain } = await import('./src/observatory.js');

/* =========================================================================
   Test 1: Macro Garden Health & Maturity Ratios
   ========================================================================= */
console.log('--- Test 1: Macro Garden Health & Maturity Ratios ---');

const testNotes = [
  {
    item: { key: 'src1|Zettelkasten/habits.md', path: 'Zettelkasten/habits.md', sourceId: 'src1' },
    title: 'Atomic Habits Architecture',
    aliases: ['Habits'],
    meta: { tags: ['habits', 'psychology'], book_ref: 'src1|Atomic Habits.epub' },
    text: 'Habits are compound interest. [[Systems Thinking]] #discipline',
    lower: 'habits are compound interest. [[systems thinking]] #discipline',
    links: [{ wiki: 'Systems Thinking', at: 29 }],
  },
  {
    item: { key: 'src1|Essays/systems.md', path: 'Essays/systems.md', sourceId: 'src1' },
    title: 'Systems Thinking',
    aliases: ['Systems'],
    meta: { tags: ['systems', 'design'] },
    text: 'Systems guide human action. [[Feedback Loops]]',
    lower: 'systems guide human action. [[feedback loops]]',
    links: [{ wiki: 'Feedback Loops', at: 29 }],
  },
  {
    item: { key: 'src1|Philosophy/cybernetics.md', path: 'Philosophy/cybernetics.md', sourceId: 'src1' },
    title: 'Feedback Loops',
    aliases: ['Feedback'],
    meta: { tags: ['cybernetics', 'systems'] },
    text: 'Feedback stabilizes or destabilizes complex dynamics.',
    lower: 'feedback stabilizes or destabilizes complex dynamics.',
    links: [],
  },
  {
    item: { key: 'src1|Inbox/fleeting.md', path: 'Inbox/fleeting.md', sourceId: 'src1' },
    title: 'Fleeting Idea',
    aliases: [],
    meta: { tags: ['inbox'] },
    text: 'A raw fleeting capture with no outgoing links.',
    lower: 'a raw fleeting capture with no outgoing links.',
    links: [],
  },
  {
    item: { key: 'src1|Archive/pruned-note.md', path: 'Archive/pruned-note.md', sourceId: 'src1' },
    title: 'Pruned Historical Note',
    aliases: [],
    meta: { pruned: true },
    text: 'Old pruned text.',
    lower: 'old pruned text.',
    links: [],
  },
];

const testGarden = new Map([
  ['src1|Zettelkasten/habits.md', { stage: 'tree', health: 'healthy', type: 'Zettelkasten', days: 4, resting: false }],
  ['src1|Essays/systems.md', { stage: 'sapling', health: 'thirsty', type: 'Essays', days: 45, resting: false }],
  ['src1|Philosophy/cybernetics.md', { stage: 'sprout', health: 'healthy', type: 'Philosophy', days: 10, resting: false }],
  ['src1|Inbox/fleeting.md', { stage: 'seed', health: 'wilting', type: 'Inbox', days: 95, resting: false }],
  ['src1|Archive/pruned-note.md', { stage: 'pruned', health: null, type: 'Archive', days: 300, resting: false }],
]);

const testBooks = [
  { key: 'src1|Atomic Habits.epub', name: 'Atomic Habits.epub', path: 'Atomic Habits.epub', sourceId: 'src1', kind: 'epub' },
];

const testProgress = [
  { key: 'src1|Atomic Habits.epub', highlights: [{ text: 'Highlight 1' }, { text: 'Highlight 2' }, { text: 'Highlight 3' }] },
];

const testThumbs = [
  { key: 'src1|Atomic Habits.epub', title: 'Atomic Habits', author: 'James Clear' },
];

const metrics = computeObservatoryMetrics({
  allNotes: testNotes,
  gardenMap: testGarden,
  allBooks: testBooks,
  progressList: testProgress,
  thumbsList: testThumbs,
});

assert.strictEqual(metrics.activeCount, 4, 'Active count must exclude pruned/archived notes');
assert.strictEqual(metrics.prunedCount, 1, 'Pruned count must identify archive notes');
assert.strictEqual(metrics.maturityProportions.seeds.count, 1);
assert.strictEqual(metrics.maturityProportions.sprouts.count, 1);
assert.strictEqual(metrics.maturityProportions.saplings.count, 1);
assert.strictEqual(metrics.maturityProportions.trees.count, 1);
assert.strictEqual(metrics.healthProportions.healthy.count, 2);
assert.strictEqual(metrics.healthProportions.thirsty.count, 1);
assert.strictEqual(metrics.healthProportions.wilting.count, 1);
assert.ok(metrics.velocityDiagnosis.length > 0, 'Velocity diagnosis must provide descriptive editorial narrative');

console.log('✅ Macro garden health, stages, and velocity verified.');

/* =========================================================================
   Test 2: Topological Graph Insights & Discovery
   ========================================================================= */
console.log('\n--- Test 2: Topological Graph Insights & Discovery ---');

// Average connectivity & density
assert.ok(Number(metrics.averageConnectivity) > 0, 'Average connectivity must be calculated');
assert.ok(metrics.density.includes('%'), 'Density must be formatted as percentage');

// Orphan detection
assert.strictEqual(metrics.orphans.length, 1, 'Exactly one orphan must be detected');
assert.strictEqual(metrics.orphans[0].title, 'Fleeting Idea');
assert.strictEqual(metrics.orphans[0].folder, 'Inbox');

// Conceptual Bridges
assert.ok(metrics.bridges.length >= 1, 'Conceptual bridges must be identified');
const systemBridge = metrics.bridges.find((b) => b.title === 'Systems Thinking');
assert.ok(systemBridge, 'Systems Thinking must bridge categories');
assert.strictEqual(systemBridge.ownFolder, 'Essays');
assert.ok(systemBridge.bridgedFolders.includes('Zettelkasten') && systemBridge.bridgedFolders.includes('Philosophy'), 'Must bridge Zettelkasten and Philosophy');

// Deepest Associative Pathway
assert.strictEqual(metrics.longestChain.length, 3, 'Longest chain must have 3 steps');
assert.strictEqual(metrics.longestChain[0].title, 'Atomic Habits Architecture');
assert.strictEqual(metrics.longestChain[1].title, 'Systems Thinking');
assert.strictEqual(metrics.longestChain[2].title, 'Feedback Loops');

console.log('✅ Graph topology, connectivity, orphan triage, bridges, and associative chains verified.');

/* =========================================================================
   Test 3: Literature Harvest & Provenance
   ========================================================================= */
console.log('\n--- Test 3: Literature Harvest & Provenance ---');

assert.strictEqual(metrics.booksHarvest.length, 1);
const harvested = metrics.booksHarvest[0];
assert.strictEqual(harvested.title, 'Atomic Habits');
assert.strictEqual(harvested.highlightsCount, 3);
assert.strictEqual(harvested.literatureNotesCount, 1);
assert.strictEqual(harvested.totalHarvest, 4);
assert.ok(harvested.citationYield >= 2, 'Citation yield must reflect downstream network linkages');

console.log('✅ Literature harvest, extracted highlights, and citation yield verified.');

/* =========================================================================
   Test 4: Vocabulary & Domain Distribution
   ========================================================================= */
console.log('\n--- Test 4: Vocabulary & Domain Distribution ---');

assert.strictEqual(metrics.folderDistribution.length, 4);
const tags = metrics.tagLandscape.map((t) => t.tag);
assert.ok(tags.includes('systems'));
assert.ok(tags.includes('habits'));
assert.ok(tags.includes('discipline'));
assert.ok(tags.includes('psychology'));

// 'systems' appears in 2 notes
const systemsTag = metrics.tagLandscape.find((t) => t.tag === 'systems');
assert.strictEqual(systemsTag.count, 2);

console.log('✅ Domain proportions, tag landscape, and concept clusters verified.');

/* =========================================================================
   Test 5: UI Elements, DOM and Accessibility Check
   ========================================================================= */
console.log('\n--- Test 5: UI Elements, DOM and Accessibility Check ---');

const indexHtml = fs.readFileSync('./index.html', 'utf8');
assert.ok(indexHtml.includes('id="observatory-sheet"'), 'index.html must include #observatory-sheet');
assert.ok(indexHtml.includes('class="sheet sheet-tall observatory-sheet"'), 'observatory-sheet must use sheet sheet-tall classes');
assert.ok(indexHtml.includes('Ctrl Shift O'), 'index.html must document Ctrl Shift O keyboard shortcut');

const styleCss = fs.readFileSync('./src/style.css', 'utf8');
assert.ok(styleCss.includes('.observatory-sheet'), 'style.css must define .observatory-sheet');
assert.ok(styleCss.includes('.health-bar'), 'style.css must define .health-bar');
assert.ok(styleCss.includes('.observatory-maturity-grid'), 'style.css must define .observatory-maturity-grid');
assert.ok(styleCss.includes('.topology-metrics-row'), 'style.css must define .topology-metrics-row');
assert.ok(styleCss.includes('.chain-track'), 'style.css must define .chain-track');
assert.ok(styleCss.includes('.observatory-book-card'), 'style.css must define .observatory-book-card');
assert.ok(styleCss.includes('.tag-chip'), 'style.css must define .tag-chip');
assert.ok(styleCss.includes('font-variant-numeric: tabular-nums;'), 'style.css must enforce tabular-nums for figures');

const notesJs = fs.readFileSync('./src/ui/notes.js', 'utf8');
assert.ok(notesJs.includes('notes-observatory-btn'), 'notes.js must include notes-observatory-btn');
assert.ok(notesJs.includes('openObservatory'), 'notes.js must import openObservatory');

const shelfJs = fs.readFileSync('./src/ui/shelf.js', 'utf8');
assert.ok(shelfJs.includes('shelf-observatory-btn'), 'shelf.js must include shelf-observatory-btn');
assert.ok(shelfJs.includes('openObservatory'), 'shelf.js must import openObservatory');

const appJs = fs.readFileSync('./src/app.js', 'utf8');
assert.ok(appJs.includes("e.key.toLowerCase() === 'o'"), 'app.js must bind Ctrl/Cmd+Shift+O to open Observatory');
assert.ok(appJs.includes('app.openObservatory'), 'app.js must expose app.openObservatory');

const swJs = fs.readFileSync('./sw.js', 'utf8');
assert.ok(swJs.includes("'./src/observatory.js'"), 'sw.js must precache ./src/observatory.js');
assert.ok(swJs.includes("'./src/ui/observatory.js'"), 'sw.js must precache ./src/ui/observatory.js');

console.log('✅ DOM, CSS, touch accessibility, toolbar buttons, and precache verified.');

console.log('\n🎉 ALL OBSERVATORY UNIT & CONTRACT TESTS PASSED WITH 100% SUCCESS!\n');
process.exit(0);
