import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import * as acorn from 'acorn';
import { validateCssStructure } from './lint-css.js';

console.log('🧪 Running PWA & Capability Test Suite (test-pwa-capabilities.js)...\n');

let totalTests = 0;
let passedTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

async function testAsync(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

/* =========================================================================
   Section 1: Manifest Schema & Linkage Verification
   ========================================================================= */
console.log('--- Section 1: Manifest Schema & Linkage Verification ---');

const manifestPath = path.resolve('./manifest.json');
const manifestRaw = fs.readFileSync(manifestPath, 'utf8');
let manifest;

test('manifest.json is valid JSON', () => {
  manifest = JSON.parse(manifestRaw);
  assert.ok(manifest && typeof manifest === 'object', 'manifest must be a valid JSON object');
});

test('display_override includes window-controls-overlay and standalone', () => {
  assert.ok(Array.isArray(manifest.display_override), 'display_override must be an array');
  assert.ok(
    manifest.display_override.includes('window-controls-overlay'),
    'display_override must include "window-controls-overlay"'
  );
  assert.ok(
    manifest.display_override.includes('standalone'),
    'display_override must include "standalone"'
  );
});

test('shortcuts array exists with new-note, search, and shelf actions', () => {
  assert.ok(Array.isArray(manifest.shortcuts), 'shortcuts must be an array');
  assert.ok(manifest.shortcuts.length >= 3, 'shortcuts must define at least 3 entries');

  const actionUrls = manifest.shortcuts.map((s) => s.url);
  assert.ok(
    actionUrls.some((u) => u.includes('action=new-note')),
    'shortcuts must include action=new-note'
  );
  assert.ok(
    actionUrls.some((u) => u.includes('action=search')),
    'shortcuts must include action=search'
  );
  assert.ok(
    actionUrls.some((u) => u.includes('action=shelf')),
    'shortcuts must include action=shelf'
  );

  // Validate shortcut schema & icons exist on disk
  for (const sc of manifest.shortcuts) {
    assert.ok(sc.name, `Shortcut ${sc.url} must define a name`);
    assert.ok(sc.url.startsWith('./?action='), `Shortcut URL ${sc.url} must use relative ./?action= format`);
    assert.ok(Array.isArray(sc.icons) && sc.icons.length > 0, `Shortcut ${sc.url} must provide icons array`);
    for (const icon of sc.icons) {
      assert.ok(icon.src, `Shortcut ${sc.url} icon must specify src`);
      const iconDiskPath = path.resolve(icon.src);
      assert.ok(fs.existsSync(iconDiskPath), `Icon file ${icon.src} for shortcut ${sc.name} must exist on disk`);
    }
  }
});

test('share_target is configured with POST multipart/form-data for books and notes', () => {
  const st = manifest.share_target;
  assert.ok(st, 'manifest must define share_target');
  assert.strictEqual(st.method?.toUpperCase(), 'POST', 'share_target method must be POST');
  assert.strictEqual(st.enctype, 'multipart/form-data', 'share_target enctype must be multipart/form-data');
  assert.ok(st.params?.files, 'share_target must declare params.files');

  const fileAccepts = st.params.files.flatMap((f) => f.accept || []);
  const requiredTypes = [
    'application/epub+zip',
    '.epub',
    'application/pdf',
    '.pdf',
    'text/markdown',
    '.md',
    '.txt',
  ];
  for (const reqType of requiredTypes) {
    assert.ok(
      fileAccepts.includes(reqType),
      `share_target accepts must include ${reqType}`
    );
  }
});

test('apple-touch-icon is declared in index.html referencing existing PNG file', () => {
  const indexHtml = fs.readFileSync(path.resolve('./index.html'), 'utf8');
  const appleIconMatch = indexHtml.match(/<link\s+[^>]*rel=["']apple-touch-icon["'][^>]*href=["']([^"']+)["']/i) ||
    indexHtml.match(/<link\s+[^>]*href=["']([^"']+)["'][^>]*rel=["']apple-touch-icon["']/i);
  assert.ok(appleIconMatch, 'index.html must declare a <link rel="apple-touch-icon" ...>');

  const iconHref = appleIconMatch[1];
  const diskPath = path.resolve(iconHref);
  assert.ok(fs.existsSync(diskPath), `apple-touch-icon referenced file (${iconHref}) must exist on disk`);
  assert.ok(iconHref.toLowerCase().endsWith('.png'), 'apple-touch-icon must point to a PNG file');
});

/* =========================================================================
   Section 2: AST Checking of CSS Safe-Area Rules & Structure
   ========================================================================= */
console.log('\n--- Section 2: AST Checking of CSS Safe-Area Rules & Structure ---');

const cssPath = path.resolve('./src/style.css');
const cssText = fs.readFileSync(cssPath, 'utf8');

test('src/style.css has balanced blocks, brackets, and comments', () => {
  const result = validateCssStructure(cssText, 'src/style.css');
  assert.strictEqual(
    result.errors.length,
    0,
    `CSS structure errors detected:\n${result.errors.map((e) => `  [line ${e.line}:${e.col}] ${e.message}`).join('\n')}`
  );
});

test('safe-area inset rules (env(safe-area-inset-...)) are defined for viewport ergonomics', () => {
  assert.ok(
    cssText.includes('env(safe-area-inset-bottom'),
    'src/style.css must define rules with env(safe-area-inset-bottom)'
  );
  assert.ok(
    cssText.includes('env(safe-area-inset-top'),
    'src/style.css must define rules with env(safe-area-inset-top)'
  );
  assert.ok(
    cssText.includes('--tabbar: calc(54px + env(safe-area-inset-bottom))'),
    'src/style.css must define --tabbar with safe-area-inset-bottom'
  );
  assert.ok(
    cssText.includes('.reader-scroll'),
    'src/style.css must declare .reader-scroll'
  );
  assert.ok(
    cssText.includes('padding-bottom: calc(80px + env(safe-area-inset-bottom'),
    '.reader-scroll must use safe-area padding-bottom with minimum 80px'
  );
});

test('desktop window controls overlay (WCO) rules are defined with titlebar-area variables', () => {
  assert.ok(
    cssText.includes('@media (display-mode: window-controls-overlay)'),
    'src/style.css must define @media (display-mode: window-controls-overlay)'
  );
  assert.ok(
    cssText.includes('env(titlebar-area-x'),
    'src/style.css must use env(titlebar-area-x)'
  );
  assert.ok(
    cssText.includes('env(titlebar-area-width'),
    'src/style.css must use env(titlebar-area-width)'
  );
  assert.ok(
    cssText.includes('env(titlebar-area-height'),
    'src/style.css must use env(titlebar-area-height)'
  );
  assert.ok(
    cssText.includes('app-region: drag'),
    'src/style.css must define drag regions for native window controls'
  );
  assert.ok(
    cssText.includes('app-region: no-drag'),
    'src/style.css must define non-draggable interactive controls'
  );
});

/* =========================================================================
   Section 3: AST Checking of Action Param Routing in src/app.js
   ========================================================================= */
console.log('\n--- Section 3: AST Checking of Action Param Routing in src/app.js ---');

const appPath = path.resolve('./src/app.js');
const appCode = fs.readFileSync(appPath, 'utf8');

test('src/app.js parses cleanly with Acorn AST parser', () => {
  const ast = acorn.parse(appCode, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    locations: true,
  });
  assert.ok(ast && ast.type === 'Program', 'AST must parse as Program');

  // Traverse AST to assert the presence of binary/equality checks for 'new-note', 'search', and 'shelf'
  const actionLiteralsFound = new Set();
  let foundActionParamCheck = false;

  function walk(node) {
    if (!node || typeof node !== 'object') return;

    // Check for params.get('action')
    if (
      node.type === 'CallExpression' &&
      node.callee?.type === 'MemberExpression' &&
      node.callee.property?.name === 'get' &&
      node.arguments?.[0]?.value === 'action'
    ) {
      foundActionParamCheck = true;
    }

    // Check for BinaryExpression comparisons against action strings
    if (node.type === 'BinaryExpression' && (node.operator === '===' || node.operator === '==')) {
      if (typeof node.left?.value === 'string') actionLiteralsFound.add(node.left.value);
      if (typeof node.right?.value === 'string') actionLiteralsFound.add(node.right.value);
    }

    // Check for switch statement cases
    if (node.type === 'SwitchCase' && typeof node.test?.value === 'string') {
      actionLiteralsFound.add(node.test.value);
    }

    for (const key of Object.keys(node)) {
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) walk(item);
      } else if (child && typeof child === 'object') {
        walk(child);
      }
    }
  }

  walk(ast);

  assert.ok(foundActionParamCheck, 'AST must query URLSearchParams for "action"');
  assert.ok(actionLiteralsFound.has('new-note'), 'AST must check for action === "new-note"');
  assert.ok(actionLiteralsFound.has('search'), 'AST must check for action === "search"');
  assert.ok(actionLiteralsFound.has('shelf'), 'AST must check for action === "shelf"');
});

/* =========================================================================
   Section 4: WakeLock API Mock & Lifecycle Verification
   ========================================================================= */
console.log('\n--- Section 4: WakeLock API Mock & Lifecycle Verification ---');

await testAsync('WakeLock lifecycle: acquire, visibilitychange release, and unmount release', async () => {
  // Set up WakeLock Sentinel Mock
  class MockWakeLockSentinel {
    constructor() {
      this.released = false;
      this.type = 'screen';
      this._listeners = new Map();
    }
    addEventListener(event, fn) {
      if (!this._listeners.has(event)) this._listeners.set(event, []);
      this._listeners.get(event).push(fn);
    }
    removeEventListener(event, fn) {
      const list = this._listeners.get(event);
      if (list) {
        const idx = list.indexOf(fn);
        if (idx >= 0) list.splice(idx, 1);
      }
    }
    async release() {
      this.released = true;
      const fns = this._listeners.get('release') || [];
      for (const fn of fns) fn();
      return Promise.resolve();
    }
  }

  let requestCount = 0;
  let activeMockSentinel = null;

  const mockNavigator = {
    wakeLock: {
      async request(type = 'screen') {
        if (type !== 'screen') throw new Error('Unsupported wake lock type');
        requestCount++;
        activeMockSentinel = new MockWakeLockSentinel();
        return activeMockSentinel;
      },
    },
  };

  const docListeners = new Map();
  const mockDocument = {
    visibilityState: 'visible',
    addEventListener(event, fn) {
      if (!docListeners.has(event)) docListeners.set(event, []);
      docListeners.get(event).push(fn);
    },
    removeEventListener(event, fn) {
      const list = docListeners.get(event);
      if (list) {
        const idx = list.indexOf(fn);
        if (idx >= 0) list.splice(idx, 1);
      }
    },
    dispatchEvent(event) {
      const list = docListeners.get(event.type) || [];
      for (const fn of list) fn(event);
    },
  };

  Object.defineProperty(globalThis, 'navigator', {
    value: mockNavigator,
    configurable: true,
    writable: true,
  });
  globalThis.document = mockDocument;

  // Import wakelock module
  const wakelockMod = await import(`./src/wakelock.js?test=${Date.now()}`);
  const { acquireWakeLock, releaseWakeLock, getWakeLockSentinel, setReaderMounted, initWakeLock } = wakelockMod;

  initWakeLock();

  // Test 1: acquireWakeLock acquires screen lock
  const sentinel1 = await acquireWakeLock();
  assert.ok(sentinel1, 'acquireWakeLock must return a sentinel');
  assert.strictEqual(sentinel1.released, false, 'Sentinel must not be released initially');
  assert.strictEqual(getWakeLockSentinel(), sentinel1, 'getWakeLockSentinel must return the active sentinel');

  // Test 2: setReaderMounted(true) maintains lock
  await setReaderMounted(true);
  assert.strictEqual(sentinel1.released, false, 'Lock must remain active when reader is mounted');

  // Test 3: Document visibility changes to 'hidden' -> lock must be released
  mockDocument.visibilityState = 'hidden';
  mockDocument.dispatchEvent({ type: 'visibilitychange' });
  await new Promise((r) => setTimeout(r, 10));

  assert.strictEqual(sentinel1.released, true, 'Sentinel must be released when visibilityState becomes hidden');
  assert.strictEqual(getWakeLockSentinel(), null, 'Sentinel must be null after visibility hidden');

  // Test 4: Document visibility returns to 'visible' while reader mounted -> lock re-acquired
  mockDocument.visibilityState = 'visible';
  mockDocument.dispatchEvent({ type: 'visibilitychange' });
  await new Promise((r) => setTimeout(r, 10));

  const sentinel2 = getWakeLockSentinel();
  assert.ok(sentinel2, 'Lock must be re-acquired automatically when document becomes visible and reader is mounted');
  assert.strictEqual(sentinel2.released, false, 'Re-acquired sentinel must be active');
  assert.notStrictEqual(sentinel1, sentinel2, 'A fresh sentinel must have been created');

  // Test 5: setReaderMounted(false) releases lock
  await setReaderMounted(false);
  assert.strictEqual(sentinel2.released, true, 'Lock must be released when reader unmounts');
  assert.strictEqual(getWakeLockSentinel(), null, 'Sentinel must be null after reader unmount');

  // Test 6: Visibility toggle while reader is NOT mounted does not acquire lock
  mockDocument.visibilityState = 'hidden';
  mockDocument.dispatchEvent({ type: 'visibilitychange' });
  mockDocument.visibilityState = 'visible';
  mockDocument.dispatchEvent({ type: 'visibilitychange' });
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(getWakeLockSentinel(), null, 'Wake lock must not be acquired when reader is not mounted');
});

test('src/utils/wakelock.js exists and exports core WakeLock functions', async () => {
  const utilsWakelockPath = path.resolve('./src/utils/wakelock.js');
  assert.ok(fs.existsSync(utilsWakelockPath), 'src/utils/wakelock.js must exist on disk');
  const mod = await import(`./src/utils/wakelock.js?test=${Date.now()}`);
  assert.ok(typeof mod.acquireWakeLock === 'function', 'acquireWakeLock must be exported');
  assert.ok(typeof mod.releaseWakeLock === 'function', 'releaseWakeLock must be exported');
  assert.ok(typeof mod.getWakeLockSentinel === 'function', 'getWakeLockSentinel must be exported');
  assert.ok(typeof mod.setReaderMounted === 'function', 'setReaderMounted must be exported');
  assert.ok(typeof mod.initWakeLock === 'function', 'initWakeLock must be exported');
});

test('sw.js intercepts POST share target and stages data into session:share IDB cache', () => {
  const swContent = fs.readFileSync(path.resolve('./sw.js'), 'utf8');
  assert.ok(swContent.includes("req.method === 'POST'"), 'sw.js must intercept POST requests');
  assert.ok(swContent.includes('session:share|'), 'sw.js must cache shared items with session:share| key');
  assert.ok(swContent.includes('share-received='), 'sw.js must redirect with share-received query parameter');
});

/* =========================================================================
   Section 5: Apple / iOS WebKit Hardening & Platform Ergonomics
   ========================================================================= */
console.log('\n--- Section 5: Apple / iOS WebKit Hardening & Platform Ergonomics ---');

test('all fixed bottom bars enforce iOS safe-area insets (env(safe-area-inset-bottom, 16px))', () => {
  const targets = ['.tabbar', '.reader-dock', '.writer-accessory-bar', '.staging-banner'];
  for (const t of targets) {
    const rx = new RegExp(`(?:nav\\.[a-z0-9_-]+,\\s*)?${t.replace('.', '\\.')}(?![a-zA-Z0-9_-])[^{]*\\{([^}]+)\\}`, 'i');
    const m = cssText.match(rx);
    assert.ok(m, `Rule for ${t} must exist in src/style.css`);
    const body = m[1];
    assert.ok(
      body.includes('padding-bottom: env(safe-area-inset-bottom, 16px)'),
      `${t} must declare padding-bottom: env(safe-area-inset-bottom, 16px)`
    );
    assert.ok(
      body.includes('padding-top: env(safe-area-inset-top, 0px)'),
      `${t} must declare padding-top: env(safe-area-inset-top, 0px)`
    );
  }
});

test('overscroll & pull-to-refresh defense is active on reader, composer, and observatory', () => {
  assert.ok(
    cssText.includes('.reader-scroll'),
    'src/style.css must define .reader-scroll'
  );
  const readerScrollMatch = cssText.match(/\.reader-scroll\s*\{([^}]+)\}/);
  assert.ok(
    readerScrollMatch?.[1].includes('overscroll-behavior-y: contain'),
    '.reader-scroll must specify overscroll-behavior-y: contain'
  );

  const writerMeasureMatch = cssText.match(/\.writer-measure\s*\{([^}]+)\}/);
  assert.ok(
    writerMeasureMatch?.[1].includes('overscroll-behavior-y: contain'),
    '.writer-measure must specify overscroll-behavior-y: contain'
  );

  const obsInnerMatch = cssText.match(/#observatory-sheet\s+\.sheet-inner\s*\{([^}]+)\}/);
  assert.ok(
    obsInnerMatch?.[1].includes('overscroll-behavior-y: contain'),
    '#observatory-sheet .sheet-inner must specify overscroll-behavior-y: contain'
  );
});

test('apple-touch-icon is an unmasked solid-background 180x180 PNG', () => {
  const iconPath = path.resolve('./icons/apple-touch-icon.png');
  assert.ok(fs.existsSync(iconPath), 'icons/apple-touch-icon.png must exist');
  const buf = fs.readFileSync(iconPath);
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  assert.strictEqual(buf.readUInt32BE(0), 0x89504E47, 'File must be a valid PNG');
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  assert.strictEqual(width, 180, 'apple-touch-icon width must be 180px');
  assert.strictEqual(height, 180, 'apple-touch-icon height must be 180px');
});

test('settings sheet provides an Apple Shortcuts helper card in Reading & Export tab', () => {
  const indexHtml = fs.readFileSync(path.resolve('./index.html'), 'utf8');
  assert.ok(
    indexHtml.includes('id="ios-shortcut-card"'),
    'index.html must include #ios-shortcut-card in Settings'
  );
  assert.ok(
    indexHtml.includes('id="ios-shortcut-copy-btn"'),
    'index.html must include #ios-shortcut-copy-btn'
  );
  assert.ok(
    indexHtml.includes('readover://'),
    'Settings guidance must reference readover:// URL scheme'
  );
});

console.log(`\n🎉 All ${passedTests}/${totalTests} PWA & Capability checks PASSED!\n`);
process.exit(process.exitCode || 0);

