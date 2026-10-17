import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';

console.log('🧪 Running Interactive Cold-Boot View & Focus Test (test-interactive-views.js)...\n');

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
   Part 1: DOM Environment Setup & HTML Mock
   ========================================================================= */

class MockNode {
  constructor(nodeType = 1, nodeName = '#element') {
    this.nodeType = nodeType;
    this.nodeName = nodeName.toUpperCase();
    this.childNodes = [];
    this.parentNode = null;
    this.isConnected = true;
  }

  get children() {
    return this.childNodes.filter((n) => n.nodeType === 1);
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

  get nextSibling() {
    if (!this.parentNode) return null;
    const idx = this.parentNode.childNodes.indexOf(this);
    return idx >= 0 ? this.parentNode.childNodes[idx + 1] || null : null;
  }

  get previousSibling() {
    if (!this.parentNode) return null;
    const idx = this.parentNode.childNodes.indexOf(this);
    return idx > 0 ? this.parentNode.childNodes[idx - 1] || null : null;
  }

  appendChild(child) {
    if (!child) return child;
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    child.isConnected = this.isConnected;
    this.childNodes.push(child);
    return child;
  }

  append(...nodes) {
    for (const n of nodes) {
      if (typeof n === 'string') {
        this.appendChild(new MockTextNode(n));
      } else if (n) {
        this.appendChild(n);
      }
    }
  }

  prepend(...nodes) {
    for (const n of [...nodes].reverse()) {
      if (typeof n === 'string') {
        const textNode = new MockTextNode(n);
        textNode.parentNode = this;
        this.childNodes.unshift(textNode);
      } else if (n) {
        if (n.parentNode) n.parentNode.removeChild(n);
        n.parentNode = this;
        this.childNodes.unshift(n);
      }
    }
  }

  removeChild(child) {
    const idx = this.childNodes.indexOf(child);
    if (idx >= 0) {
      this.childNodes.splice(idx, 1);
      child.parentNode = null;
      child.isConnected = false;
    }
    return child;
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  replaceWith(...nodes) {
    if (!this.parentNode) return;
    const parent = this.parentNode;
    const idx = parent.childNodes.indexOf(this);
    if (idx < 0) return;
    this.remove();
    let insertAt = idx;
    for (const n of nodes) {
      if (typeof n === 'string') {
        const textNode = new MockTextNode(n);
        textNode.parentNode = parent;
        parent.childNodes.splice(insertAt++, 0, textNode);
      } else if (n) {
        if (n.parentNode) n.parentNode.removeChild(n);
        n.parentNode = parent;
        parent.childNodes.splice(insertAt++, 0, n);
      }
    }
  }

  replaceChildren(...nodes) {
    for (const child of [...this.childNodes]) {
      this.removeChild(child);
    }
    this.append(...nodes);
  }
}

class MockTextNode extends MockNode {
  constructor(text = '') {
    super(3, '#text');
    this.textContent = String(text);
  }
}

class MockElement extends MockNode {
  constructor(tagName = 'div') {
    super(1, tagName);
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.listeners = new Map();
    this._value = '';
    this.open = false;
    this.hidden = false;
    this._disabled = false;
    this._readOnly = false;
    this._focused = false;
    this.checked = false;
    this.tabIndex = 0;
    this.returnValue = '';
    this._innerHTML = '';
  }

  get id() {
    return this.getAttribute('id') || '';
  }
  set id(val) {
    this.setAttribute('id', val);
  }

  get className() {
    return this.getAttribute('class') || '';
  }
  set className(val) {
    this.setAttribute('class', val);
  }

  get classList() {
    const self = this;
    return {
      add(...classes) {
        const set = new Set((self.className || '').split(/\s+/).filter(Boolean));
        for (const c of classes) if (c) set.add(c);
        self.className = [...set].join(' ');
      },
      remove(...classes) {
        const set = new Set((self.className || '').split(/\s+/).filter(Boolean));
        for (const c of classes) set.delete(c);
        self.className = [...set].join(' ');
      },
      toggle(cls, force) {
        const set = new Set((self.className || '').split(/\s+/).filter(Boolean));
        const shouldAdd = force !== undefined ? Boolean(force) : !set.has(cls);
        if (shouldAdd) set.add(cls);
        else set.delete(cls);
        self.className = [...set].join(' ');
        return shouldAdd;
      },
      contains(cls) {
        return (self.className || '').split(/\s+/).includes(cls);
      },
    };
  }

  get value() {
    return this._value;
  }
  set value(val) {
    this._value = String(val ?? '');
  }

  get disabled() {
    return this.hasAttribute('disabled') || this._disabled;
  }
  set disabled(val) {
    this._disabled = Boolean(val);
    if (val) this.setAttribute('disabled', '');
    else this.removeAttribute('disabled');
  }

  get readOnly() {
    return this.hasAttribute('readonly') || this._readOnly;
  }
  set readOnly(val) {
    this._readOnly = Boolean(val);
    if (val) this.setAttribute('readonly', '');
    else this.removeAttribute('readonly');
  }

  get innerHTML() {
    return this._innerHTML;
  }
  set innerHTML(htmlStr) {
    this._innerHTML = String(htmlStr ?? '');
    this.replaceChildren();
  }

  get textContent() {
    return this.childNodes.map((c) => c.textContent || '').join('');
  }
  set textContent(val) {
    this.replaceChildren(new MockTextNode(val));
  }

  setAttribute(name, value) {
    const sName = String(name).toLowerCase();
    const sVal = String(value);
    this.attributes.set(sName, sVal);
    if (sName === 'id') this.attributes.set('id', sVal);
    if (sName === 'hidden') this.hidden = true;
    if (sName === 'disabled') this._disabled = true;
    if (sName === 'readonly') this._readOnly = true;
    if (sName.startsWith('data-')) {
      const prop = sName.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[prop] = sVal;
    }
  }

  getAttribute(name) {
    const sName = String(name).toLowerCase();
    return this.attributes.has(sName) ? this.attributes.get(sName) : null;
  }

  hasAttribute(name) {
    return this.attributes.has(String(name).toLowerCase());
  }

  removeAttribute(name) {
    const sName = String(name).toLowerCase();
    this.attributes.delete(sName);
    if (sName === 'hidden') this.hidden = false;
    if (sName === 'disabled') this._disabled = false;
    if (sName === 'readonly') this._readOnly = false;
    if (sName.startsWith('data-')) {
      const prop = sName.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      delete this.dataset[prop];
    }
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    const list = this.listeners.get(type);
    if (list) {
      const idx = list.indexOf(listener);
      if (idx >= 0) list.splice(idx, 1);
    }
  }

  dispatchEvent(event) {
    event.target = this;
    event.currentTarget = this;
    const list = this.listeners.get(event.type) || [];
    for (const fn of list) {
      try {
        fn.call(this, event);
      } catch (e) {
        console.error(`Error in event listener for ${event.type}:`, e);
      }
    }
    const propName = `on${event.type}`;
    if (typeof this[propName] === 'function') {
      try {
        this[propName].call(this, event);
      } catch (e) {
        console.error(`Error in ${propName} handler:`, e);
      }
    }
    if (event.bubbles && this.parentNode?.dispatchEvent) {
      this.parentNode.dispatchEvent(event);
    }
    return !event.defaultPrevented;
  }

  click() {
    this.dispatchEvent(new MockEvent('click', { bubbles: true }));
  }

  focus() {
    if (globalThis.document) {
      globalThis.document.activeElement = this;
    }
    this._focused = true;
    this.dispatchEvent(new MockEvent('focus', { bubbles: false }));
  }

  blur() {
    if (globalThis.document?.activeElement === this) {
      globalThis.document.activeElement = null;
    }
    this._focused = false;
    this.dispatchEvent(new MockEvent('blur', { bubbles: false }));
  }

  get inert() {
    return this.hasAttribute('inert');
  }
  set inert(val) {
    if (val) this.setAttribute('inert', '');
    else this.removeAttribute('inert');
  }

  setSelectionRange(start, end) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }

  getBoundingClientRect() {
    return { top: 0, left: 0, bottom: 600, right: 400, width: 400, height: 600 };
  }

  scrollIntoView() {}
  reset() {}

  showModal() {
    this.open = true;
    this.setAttribute('open', '');
  }

  close(retVal = '') {
    this.open = false;
    this.removeAttribute('open');
    this.returnValue = retVal;
    this.dispatchEvent(new MockEvent('close'));
  }

  closest(selector) {
    let curr = this;
    while (curr && curr.nodeType === 1) {
      if (curr.matches && curr.matches(selector)) return curr;
      curr = curr.parentNode;
    }
    return null;
  }

  matches(sel) {
    if (!sel) return false;
    if (sel.startsWith('#')) return this.id === sel.slice(1);
    if (sel.startsWith('.')) return this.classList.contains(sel.slice(1));
    if (sel.includes('[open]')) return this.open;
    if (sel.includes('[data-wikilink]')) return this.hasAttribute('data-wikilink');
    if (sel.includes('[data-close]')) return this.hasAttribute('data-close');
    return this.tagName.toLowerCase() === sel.toLowerCase();
  }

  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }

  querySelectorAll(sel) {
    const results = [];
    const selectors = sel.split(',').map((s) => s.trim());

    function matchNode(node) {
      if (node.nodeType === 1) {
        for (const s of selectors) {
          if (s.startsWith('#') && node.id === s.slice(1)) {
            results.push(node);
            return;
          } else if (s.startsWith('.') && node.classList.contains(s.slice(1))) {
            results.push(node);
            return;
          } else if (s === node.tagName.toLowerCase()) {
            results.push(node);
            return;
          } else if (node.matches && node.matches(s)) {
            results.push(node);
            return;
          }
        }
      }
      for (const child of node.childNodes) {
        matchNode(child);
      }
    }

    for (const child of this.childNodes) {
      matchNode(child);
    }
    return results;
  }
}

class MockEvent {
  constructor(type, { bubbles = false, cancelable = true } = {}) {
    this.type = type;
    this.bubbles = bubbles;
    this.cancelable = cancelable;
    this.defaultPrevented = false;
    this.target = null;
    this.currentTarget = null;
  }
  preventDefault() {
    this.defaultPrevented = true;
  }
  stopPropagation() {}
}

class MockCustomEvent extends MockEvent {
  constructor(type, { detail = null, bubbles = false } = {}) {
    super(type, { bubbles });
    this.detail = detail;
  }
}

// Minimal DOM document setup
const doc = new MockElement('#document');
const docElement = new MockElement('html');
const body = new MockElement('body');
doc.appendChild(docElement);
docElement.appendChild(body);
doc.body = body;
doc.documentElement = docElement;
doc.activeElement = body;

doc.createElement = (tag) => new MockElement(tag);
doc.createElementNS = (_ns, tag) => new MockElement(tag);
doc.createTextNode = (text) => new MockTextNode(text);
doc.getElementById = (id) => doc.querySelector(`#${id}`);
doc.querySelector = (sel) => doc.querySelectorAll(sel)[0] || null;
doc.querySelectorAll = (sel) => docElement.querySelectorAll(sel);

// Global browser simulation
globalThis.window = {
  document: doc,
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
  location: {
    hash: '',
    pathname: '/',
    search: '',
    href: 'http://localhost/',
    origin: 'http://localhost',
  },
  history: {
    state: null,
    pushState: () => {},
    replaceState: () => {},
    back: () => {},
  },
  localStorage: {
    store: {},
    getItem(k) { return this.store[k] || null; },
    setItem(k, v) { this.store[k] = String(v); },
    removeItem(k) { delete this.store[k]; },
    clear() { this.store = {}; },
  },
  sessionStorage: {
    store: {},
    getItem(k) { return this.store[k] || null; },
    setItem(k, v) { this.store[k] = String(v); },
    removeItem(k) { delete this.store[k]; },
  },
  getComputedStyle: () => ({
    getPropertyValue: () => '#e8ebe3',
    boxSizing: 'border-box',
    maxHeight: '100dvh',
  }),
  requestAnimationFrame: (cb) => {
    return setTimeout(() => {
      try { cb(Date.now()); } catch (e) { console.error(e); }
    }, 0);
  },
  cancelAnimationFrame: (id) => clearTimeout(id),
  confirm: () => true,
  alert: () => {},
  prompt: () => '',
};

globalThis.document = doc;
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'NodeInteractiveTest', clipboard: { readText: async () => '' } },
  configurable: true,
  writable: true,
});
globalThis.location = globalThis.window.location;
globalThis.history = globalThis.window.history;
globalThis.localStorage = globalThis.window.localStorage;
globalThis.sessionStorage = globalThis.window.sessionStorage;
globalThis.confirm = globalThis.window.confirm;
globalThis.alert = globalThis.window.alert;
globalThis.prompt = globalThis.window.prompt;
globalThis.HTMLElement = MockElement;
globalThis.Element = MockElement;
globalThis.Node = MockNode;
globalThis.Event = MockEvent;
globalThis.CustomEvent = MockCustomEvent;
globalThis.getComputedStyle = globalThis.window.getComputedStyle;
globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
globalThis.cancelAnimationFrame = globalThis.window.cancelAnimationFrame;

globalThis.IntersectionObserver = class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

globalThis.indexedDB = {
  open: () => {
    function makeReq(resultVal = []) {
      const r = { onsuccess: null, onerror: null, result: resultVal };
      setTimeout(() => {
        if (typeof r.onsuccess === 'function') r.onsuccess({ target: r });
      }, 0);
      return r;
    }
    const mockStore = {
      get: () => makeReq(null),
      put: () => makeReq(null),
      delete: () => makeReq(null),
      getAll: () => makeReq([]),
      clear: () => makeReq(null),
      index: () => ({
        getAll: () => makeReq([]),
        getAllKeys: () => makeReq([]),
      }),
    };
    const mockDb = {
      close: () => {},
      createObjectStore: () => mockStore,
      transaction: () => {
        const tx = {
          objectStore: () => mockStore,
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
    const openReq = { onupgradeneeded: null, onsuccess: null, onerror: null, result: mockDb };
    setTimeout(() => {
      if (typeof openReq.onsuccess === 'function') openReq.onsuccess({ target: openReq });
    }, 0);
    return openReq;
  },
};

// Populate elements from index.html
const htmlPath = path.resolve('./index.html');
const indexHtml = fs.readFileSync(htmlPath, 'utf8');

const idRegex = /<([a-zA-Z0-9]+)\s+[^>]*?id="([^"]+)"[^>]*?>/g;
let m;
while ((m = idRegex.exec(indexHtml)) !== null) {
  const tagName = m[1];
  const id = m[2];
  if (!doc.getElementById(id)) {
    const el = doc.createElement(tagName);
    el.id = id;
    body.appendChild(el);
  }
}

// Populate writer canvas internal inputs and action controls
const writerCanvas = doc.getElementById('writer-canvas');
if (writerCanvas) {
  const titleInput = doc.createElement('input');
  titleInput.id = 'writer-title';
  titleInput.setAttribute('name', 'title');
  writerCanvas.appendChild(titleInput);

  const bodyTextarea = doc.createElement('textarea');
  bodyTextarea.id = 'writer-body';
  bodyTextarea.className = 'writer-body';
  bodyTextarea.setAttribute('name', 'body');
  writerCanvas.appendChild(bodyTextarea);

  const controls = [
    'writer-done',
    'writer-back',
    'writer-btn-cite',
    'writer-btn-graft',
    'writer-btn-tag',
    'writer-btn-meta',
    'compose-attach-image',
  ];
  for (const cid of controls) {
    if (!doc.getElementById(cid)) {
      const btn = doc.createElement('button');
      btn.id = cid;
      btn.setAttribute('type', 'button');
      writerCanvas.appendChild(btn);
    }
  }
}

// Populate sample note for testing
const mockNote = {
  key: 'device|notes/test-interactive.md',
  sourceId: 'device',
  path: 'notes/test-interactive.md',
  folder: 'notes',
  name: 'test-interactive.md',
  kind: 'note',
  text: '---\ntitle: Interactive Exploration\nstatus: seedling\ntags: [research, focus]\n---\nVerifying keyboard focus and button responsiveness.\n',
};

/* =========================================================================
   Part 2: Screen Mounting & Focus Tests
   ========================================================================= */
console.log('--- Part 2: Screen Mounting & Focus Tests ---');

await testAsync('openWriterCanvas() mounts textarea, asserts not disabled/readonly, receives focus, and wires buttons', async () => {
  const { openWriterCanvas, compose } = await import('./src/ui/compose.js');
  assert.ok(typeof openWriterCanvas === 'function', 'openWriterCanvas must be exported');
  assert.ok(typeof compose === 'function', 'compose must be exported');

  // Open writer canvas in edit mode with existing item
  await openWriterCanvas({ existingItem: mockNote });

  const canvas = doc.getElementById('writer-canvas');
  assert.ok(canvas, '#writer-canvas must exist in document');
  assert.strictEqual(canvas.hidden, false, '#writer-canvas must be unhidden');
  assert.strictEqual(canvas.inert, false, '#writer-canvas must not be inert');

  const textarea = doc.getElementById('writer-body');
  assert.ok(textarea, '#writer-body textarea must exist');
  assert.strictEqual(textarea.disabled, false, '#writer-body textarea must not be disabled');
  assert.strictEqual(textarea.readOnly, false, '#writer-body textarea must not be readonly');

  // Verify focus engagement
  // Allow rAF to trigger focus()
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(
    textarea._focused || doc.activeElement === textarea,
    '#writer-body textarea must receive focus when canvas opens'
  );

  // Assert buttons exist and handle clicks without unhandled rejections
  const btnDone = doc.getElementById('writer-done');
  const btnBack = doc.getElementById('writer-back');
  const btnCite = doc.getElementById('writer-btn-cite');
  const btnGraft = doc.getElementById('writer-btn-graft');

  assert.ok(btnDone, '#writer-done button must exist');
  assert.ok(btnBack, '#writer-back button must exist');
  assert.ok(btnCite, '#writer-btn-cite button must exist');
  assert.ok(btnGraft, '#writer-btn-graft button must exist');

  // Exercise click dispatches
  btnCite.click();
  btnGraft.click();
  btnDone.click();
  btnBack.click();
});

await testAsync('openNote() mounts reader and .reader-dock with Water, Graft, and Edit buttons', async () => {
  const { openNote } = await import('./src/ui/reader.js');
  assert.ok(typeof openNote === 'function', 'openNote must be exported from reader.js');

  await openNote(mockNote, {
    starred: false,
    onStar: async () => {},
  });

  const reader = doc.querySelector('.reader');
  assert.ok(reader, '.reader dialog must be mounted in DOM');

  const readerDock = doc.querySelector('.reader-dock');
  assert.ok(readerDock, '.reader-dock must be mounted in reader');
  assert.strictEqual(readerDock.hidden, false, '.reader-dock must be visible for writable notes');

  const dockWater = doc.getElementById('reader-dock-water');
  const dockGraft = doc.getElementById('reader-dock-graft');
  const dockEdit = doc.getElementById('reader-dock-edit');

  assert.ok(dockWater, '#reader-dock-water must exist in .reader-dock');
  assert.ok(dockGraft, '#reader-dock-graft must exist in .reader-dock');
  assert.ok(dockEdit, '#reader-dock-edit must exist in .reader-dock');

  assert.ok(dockWater.textContent.includes('Water'), '#reader-dock-water must display label "Water"');
  assert.ok(dockGraft.textContent.includes('Graft'), '#reader-dock-graft must display label "Graft"');
  assert.ok(dockEdit.textContent.includes('Edit'), '#reader-dock-edit must display label "Edit"');

  // Exercise clicks
  dockWater.click();
  dockGraft.click();
  dockEdit.click();
});

/* =========================================================================
   Part 3: Safe-Area & CSS Boundaries Tests
   ========================================================================= */
console.log('\n--- Part 3: Safe-Area & CSS Boundaries Tests ---');

const cssPath = path.resolve('./src/style.css');
const cssContent = fs.readFileSync(cssPath, 'utf8');

test('.reader-scroll enforces padding-bottom >= 80px in src/style.css', () => {
  const readerScrollMatch = cssContent.match(/\.reader-scroll\s*\{([^}]+)\}/);
  assert.ok(readerScrollMatch, '.reader-scroll rule must be present in style.css');

  const ruleBody = readerScrollMatch[1];
  const pbMatch = ruleBody.match(/padding-bottom:\s*([^;]+);/);
  assert.ok(pbMatch, '.reader-scroll must specify padding-bottom');

  const pbVal = pbMatch[1];
  assert.ok(
    pbVal.includes('80px'),
    `.reader-scroll padding-bottom (${pbVal}) must enforce a minimum of 80px clearance`
  );
  assert.ok(
    pbVal.includes('env(safe-area-inset-bottom'),
    `.reader-scroll padding-bottom (${pbVal}) must account for env(safe-area-inset-bottom)`
  );
});

test('modal containers enforce box-sizing: border-box and do not overflow 100dvh', () => {
  // Global box-sizing
  const globalBoxSizing = cssContent.match(/\*,\s*\*::before,\s*\*::after\s*\{([^}]+)\}/);
  assert.ok(globalBoxSizing, 'Universal selector (*, *::before, *::after) must be defined');
  assert.ok(
    globalBoxSizing[1].includes('box-sizing: border-box'),
    'Universal box-sizing: border-box must be enforced across all DOM elements'
  );

  // Sheets max-height constraint
  const sheetRuleMatch = cssContent.match(/\.sheet\s*\{([^}]+)\}/);
  assert.ok(sheetRuleMatch, '.sheet base rule must exist');
  const sheetMaxHeight = sheetRuleMatch[1].match(/max-height:\s*([^;]+);/);
  assert.ok(sheetMaxHeight, '.sheet must specify max-height');

  // Ensure dvh unit is used and does not exceed 100dvh
  const maxHeightVal = sheetMaxHeight[1].trim();
  const dvhMatch = maxHeightVal.match(/^(\d+)dvh$/);
  if (dvhMatch) {
    const val = parseInt(dvhMatch[1], 10);
    assert.ok(val <= 100, `.sheet max-height (${val}dvh) must not exceed 100dvh`);
  }

  // Mobile full-screen sheets constraint
  const mobileSheetMatch = cssContent.match(/@media\s*\([^)]*max-width:\s*639px[^)]*\)\s*\{([^}]+(\{[^}]+\}[^}]*)+)\}/);
  assert.ok(mobileSheetMatch, 'Mobile responsive media query (max-width: 639px) must exist');
  assert.ok(
    mobileSheetMatch[0].includes('max-height: 100dvh'),
    'Mobile modal sheets must be bounded to max-height: 100dvh'
  );
});

console.log(`\n🎉 All ${passedTests}/${totalTests} Interactive View & Focus tests PASSED!\n`);
process.exit(process.exitCode || 0);
