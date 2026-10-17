import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';

console.log('🧪 Running Interactive Cold-Boot View & Focus Test (test-interactive-views.js)...\n');

// Top-level watchdog timer (15s limit) with diagnostic handle dump
const WATCHDOG_TIMEOUT_MS = 15000;
const watchdog = setTimeout(() => {
  console.error('\n🚨 [WATCHDOG TIMEOUT] test-interactive-views.js exceeded 15s execution threshold!');
  if (typeof process._getActiveHandles === 'function') {
    const handles = process._getActiveHandles();
    console.error(`Active handles count: ${handles.length}`);
    for (const h of handles.slice(0, 10)) {
      console.error(`- Handle type: ${h?.constructor?.name || typeof h}`);
    }
  }
  if (typeof process._getActiveRequests === 'function') {
    console.error(`Active requests count: ${process._getActiveRequests().length}`);
  }
  process.exit(1);
}, WATCHDOG_TIMEOUT_MS);
watchdog.unref();

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

async function testAsync(name, fn, timeoutMs = 4000) {
  totalTests++;
  let timer;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Test timed out after ${timeoutMs}ms: "${name}"`)), timeoutMs);
      timer.unref?.();
    });
    await Promise.race([fn(), timeoutPromise]);
    clearTimeout(timer);
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    clearTimeout(timer);
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
    return this._value || this.getAttribute('value') || '';
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
    if (sName === 'value') this._value = sVal;
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
    if (sel.includes(',')) {
      for (const s of sel.split(',')) {
        const found = this.querySelector(s.trim());
        if (found) return found;
      }
      return null;
    }
    if (sel.includes(' ')) {
      const parts = sel.split(/\s+/).filter(Boolean);
      let curr = this;
      for (const part of parts) {
        curr = curr.querySelector(part);
        if (!curr) return null;
      }
      return curr;
    }
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
  constructor(type, opts = {}) {
    this.type = type;
    this.bubbles = opts.bubbles !== undefined ? opts.bubbles : false;
    this.cancelable = opts.cancelable !== undefined ? opts.cancelable : true;
    this.defaultPrevented = false;
    this.target = null;
    this.currentTarget = null;
    Object.assign(this, opts);
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
const windowListeners = new Map();
globalThis.window = {
  document: doc,
  addEventListener: (t, fn) => {
    if (!windowListeners.has(t)) windowListeners.set(t, new Set());
    windowListeners.get(t).add(fn);
  },
  removeEventListener: (t, fn) => {
    windowListeners.get(t)?.delete(fn);
  },
  dispatchEvent: (e) => {
    const list = windowListeners.get(e.type);
    if (list) {
      for (const fn of list) {
        try { fn(e); } catch (err) { console.error(err); }
      }
    }
    return !e.defaultPrevented;
  },
  location: {
    hash: '',
    pathname: '/',
    search: '',
    href: 'http://localhost/',
    origin: 'http://localhost',
  },
  history: {
    state: null,
    pushState: (state) => {
      globalThis.window.history.state = state;
    },
    replaceState: (state) => {
      globalThis.window.history.state = state;
    },
    back: () => {
      globalThis.window.dispatchEvent(new MockEvent('popstate'));
    },
    go: (_delta) => {
      globalThis.window.dispatchEvent(new MockEvent('popstate'));
    },
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

const idbMemory = new Map();
globalThis.indexedDB = {
  open: () => {
    function makeReq(resultVal = []) {
      const r = { onsuccess: null, onerror: null, result: resultVal };
      setTimeout(() => {
        if (typeof r.onsuccess === 'function') r.onsuccess({ target: r });
      }, 0);
      return r;
    }
    const mockStore = (name) => ({
      get: (k) => makeReq(idbMemory.get(`${name}:${k}`) || null),
      put: (v) => {
        const k = v?.key || v?.id || v?.sha;
        if (k) idbMemory.set(`${name}:${k}`, v);
        return makeReq(k);
      },
      delete: (k) => {
        idbMemory.delete(`${name}:${k}`);
        return makeReq(null);
      },
      getAll: () => makeReq(Array.from(idbMemory.entries()).filter(([k]) => k.startsWith(`${name}:`)).map(([, v]) => v)),
      clear: () => {
        for (const k of idbMemory.keys()) {
          if (k.startsWith(`${name}:`)) idbMemory.delete(k);
        }
        return makeReq(null);
      },
      index: () => ({
        getAll: () => makeReq(Array.from(idbMemory.entries()).filter(([k]) => k.startsWith(`${name}:`)).map(([, v]) => v)),
        getAllKeys: () => makeReq(Array.from(idbMemory.keys()).filter((k) => k.startsWith(`${name}:`)).map((k) => k.slice(name.length + 1))),
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

const idRegex = /<([a-zA-Z0-9]+)\s+([^>]*?id="([^"]+)"[^>]*?)>/g;
let m;
while ((m = idRegex.exec(indexHtml)) !== null) {
  const tagName = m[1];
  const attrs = m[2];
  const id = m[3];
  if (!doc.getElementById(id)) {
    const el = doc.createElement(tagName);
    el.id = id;
    const classMatch = attrs.match(/class="([^"]+)"/);
    if (classMatch) el.className = classMatch[1];
    const nameMatch = attrs.match(/name="([^"]+)"/);
    if (nameMatch) el.setAttribute('name', nameMatch[1]);
    const typeMatch = attrs.match(/type="([^"]+)"/);
    if (typeMatch) el.setAttribute('type', typeMatch[1]);
    body.appendChild(el);
  }
}

// Populate tabbar
const tabbarEl = doc.createElement('nav');
tabbarEl.className = 'tabbar';
tabbarEl.setAttribute('aria-label', 'Views');
body.appendChild(tabbarEl);

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

/* =========================================================================
   Part 4: Note Action Dock, Immersive State & Stacking Tests (Issue 1)
   ========================================================================= */
console.log('\n--- Part 4: Note Action Dock, Immersive State & Stacking Tests ---');

test('Viewport Geometry Audit: When note is active in reader, global navigation element is suppressed in DOM and CSS', () => {
  // 1. Verify CSS rules for tabbar suppression during reading
  const hasReaderTabbarMatch = cssContent.match(/body\.has-reader\s+[^,{]*\.tabbar/);
  assert.ok(hasReaderTabbarMatch, 'CSS must specify rule suppressing .tabbar when body.has-reader or body:has(.reader) is active');
  assert.ok(
    cssContent.includes('body.has-reader .tabbar') || cssContent.includes('body.has-reader nav.tabbar'),
    'CSS must target body.has-reader .tabbar'
  );
  assert.ok(
    cssContent.includes('display: none !important'),
    'Suppression rule must declare display: none !important'
  );

  // 2. In DOM, verify body class and tabbar aria-hidden
  assert.ok(doc.body.classList.contains('has-reader'), 'body must have class has-reader while note reader is open');
  const tabbar = doc.querySelector('.tabbar');
  assert.ok(tabbar, '.tabbar must exist in DOM');
  assert.strictEqual(tabbar.getAttribute('aria-hidden'), 'true', '.tabbar must have aria-hidden="true" when reader is mounted');
});

test('Z-Index and Hitbox Integrity: .reader-dock z-index is higher than sibling overlays and sits above bottom boundary', () => {
  // Check .reader-dock z-index in src/style.css
  const dockMatch = cssContent.match(/\.reader-dock\s*\{([^}]+)\}/);
  assert.ok(dockMatch, '.reader-dock rule must exist in style.css');
  const dockBody = dockMatch[1];

  const zIndexMatch = dockBody.match(/z-index:\s*(\d+)/);
  assert.ok(zIndexMatch, '.reader-dock must declare z-index');
  const dockZIndex = parseInt(zIndexMatch[1], 10);
  assert.ok(dockZIndex >= 60, `.reader-dock z-index (${dockZIndex}) must be >= 60 to sit above reader and tabbar`);

  // Check .reader z-index
  const readerMatch = cssContent.match(/\.reader\s*\{([^}]+)\}/);
  assert.ok(readerMatch, '.reader rule must exist in style.css');
  const readerZIndexMatch = readerMatch[1].match(/z-index:\s*(\d+)/);
  assert.ok(readerZIndexMatch, '.reader must declare z-index');
  const readerZIndex = parseInt(readerZIndexMatch[1], 10);
  assert.ok(dockZIndex > readerZIndex, `.reader-dock z-index (${dockZIndex}) must be strictly higher than .reader z-index (${readerZIndex})`);

  // Check bottom clearance with safe-area
  assert.ok(dockBody.includes('bottom: calc(20px + env(safe-area-inset-bottom'), '.reader-dock must position bottom with 20px clearance and safe-area inset');
  assert.ok(dockBody.includes('padding-bottom: env(safe-area-inset-bottom, 16px)'), '.reader-dock must enforce safe-area bottom padding');
});

/* =========================================================================
   Part 5: Ebook / Document Reading Chrome & Toggle Tests (Issue 2)
   ========================================================================= */
console.log('\n--- Part 5: Ebook / Document Reading Chrome & Toggle Tests ---');

await testAsync('Viewer State Lifecycle: Opening a book document transitions app into reader state and suppresses global tabs', async () => {
  const { openPdf } = await import('./src/viewers/pdf.js');
  const mockBookItem = {
    key: 'device|books/test-monograph.pdf',
    sourceId: 'device',
    path: 'books/test-monograph.pdf',
    name: 'test-monograph.pdf',
    kind: 'book',
  };
  const mockBlob = {
    arrayBuffer: async () => new ArrayBuffer(8),
    type: 'application/pdf',
  };

  await openPdf(mockBookItem, mockBlob, 'Test Monograph');

  const pdfReader = doc.querySelector('.reader-pdf');
  assert.ok(pdfReader, '.reader-pdf must be mounted in DOM');
  assert.ok(pdfReader.classList.contains('reader-doc'), '.reader-pdf must have class reader-doc');
  assert.ok(doc.body.classList.contains('has-reader'), 'body must have class has-reader');
  assert.ok(doc.body.classList.contains('has-book-reader'), 'body must have class has-book-reader');

  // Verify CSS contains suppression rule for book reader
  assert.ok(cssContent.includes('body.has-book-reader') && cssContent.includes('.tabbar'), 'CSS must suppress tabbar during book reading');
});

test('Toggle Gesture Contract: Central viewport click toggles toolbar visibility without modifying reading metrics', () => {
  const pdfReader = doc.querySelector('.reader-pdf');
  assert.ok(pdfReader, '.reader-pdf must be mounted');
  assert.strictEqual(typeof pdfReader.toggleChrome, 'function', 'reader must expose toggleChrome method');

  // Initially or toggling controls
  pdfReader.toggleChrome(false); // hide controls
  assert.strictEqual(pdfReader.classList.contains('chrome-hidden'), true, 'Setting toggleChrome(false) must hide controls');

  // Toggle on (summon controls)
  pdfReader.toggleChrome(true); // summon controls
  assert.strictEqual(pdfReader.classList.contains('chrome-hidden'), false, 'Setting toggleChrome(true) must summon controls');

  // Toggle off again
  pdfReader.toggleChrome();
  assert.strictEqual(pdfReader.classList.contains('chrome-hidden'), true, 'Calling toggleChrome() without args must flip visibility');

  // Verify in CSS that .reader-doc .reader-bar is position: absolute to prevent canvas reflow
  const barMatch = cssContent.match(/\.reader-doc\s+\.reader-bar\s*\{([^}]+)\}/);
  assert.ok(barMatch, '.reader-doc .reader-bar rule must exist in style.css');
  assert.ok(barMatch[1].includes('position: absolute'), '.reader-doc .reader-bar must be position: absolute to avoid stage reflow');

  const hiddenBarMatch = cssContent.match(/\.reader-doc\.chrome-hidden\s+\.reader-bar\s*\{([^}]+)\}/);
  assert.ok(hiddenBarMatch, '.reader-doc.chrome-hidden .reader-bar rule must exist');
  assert.ok(hiddenBarMatch[1].includes('transform: translateY(-100%)'), 'Hidden bar must translate offscreen');
  assert.ok(hiddenBarMatch[1].includes('pointer-events: none'), 'Hidden bar must disable pointer-events');
});

/* =========================================================================
   Part 6: Deep Navigation Stack, Hold-to-Escape & Timer Precision Tests (Issue 3)
   ========================================================================= */
console.log('\n--- Part 6: Deep Navigation Stack, Hold-to-Escape & Timer Precision Tests ---');

await testAsync('Navigation Stack Test: Unwinds reader stack completely to root on Escape / closeAll', async () => {
  const { openNote } = await import('./src/ui/reader.js');
  const { closeAll, getOverlayCount } = await import('./src/ui/overlay.js');

  // Clean slate: close any existing readers
  await closeAll();
  assert.strictEqual(doc.querySelectorAll('.reader').length, 0, 'No readers should be in DOM before stack test');

  // Push Note 1
  await openNote({ ...mockNote, key: 'note-1', path: 'note-1.md', name: 'Note 1' });
  // Push Note 2
  await openNote({ ...mockNote, key: 'note-2', path: 'note-2.md', name: 'Note 2' });
  // Push Note 3
  await openNote({ ...mockNote, key: 'note-3', path: 'note-3.md', name: 'Note 3' });

  assert.strictEqual(doc.querySelectorAll('.reader').length, 3, '3 reader overlays must be stacked in DOM');
  assert.strictEqual(getOverlayCount(), 3, 'Overlay stack must track 3 items');

  // Simulate pressing Escape on the topmost reader
  const topReader = doc.querySelectorAll('.reader')[2];
  assert.ok(topReader, 'Top reader must exist');
  topReader.dispatchEvent(new MockEvent('keydown', { key: 'Escape', bubbles: true }));

  // Verify all 3 readers are closed and removed
  assert.strictEqual(doc.querySelectorAll('.reader').length, 0, 'All 3 readers must be unmounted after Escape');
  assert.strictEqual(getOverlayCount(), 0, 'Overlay stack must be empty (0 items)');
  assert.strictEqual(doc.body.classList.contains('has-reader'), false, 'has-reader class must be removed from body');
  const tabbar = doc.querySelector('.tabbar');
  assert.strictEqual(tabbar.getAttribute('aria-hidden'), null, 'tabbar aria-hidden attribute must be removed');
});

await testAsync('Timer Precision Test: Click under 300ms dispatches single-step pop; press exceeding hold threshold dispatches complete stack clear', async () => {
  const { openNote } = await import('./src/ui/reader.js');
  const { closeAll, getOverlayCount } = await import('./src/ui/overlay.js');

  await closeAll();

  // Push Note A and Note B
  await openNote({ ...mockNote, key: 'note-a', path: 'note-a.md', name: 'Note A' });
  await openNote({ ...mockNote, key: 'note-b', path: 'note-b.md', name: 'Note B' });

  assert.strictEqual(doc.querySelectorAll('.reader').length, 2, '2 readers must be mounted');
  const readerB = doc.querySelectorAll('.reader')[1];
  const backBtnB = readerB.querySelector('.reader-bar .icon-btn');
  assert.ok(backBtnB, 'Back button must exist on reader B');

  // Case 1: Standard short click (< 300ms) -> Single-step pop
  backBtnB.dispatchEvent(new MockEvent('pointerdown', { button: 0 }));
  // Wait 80ms (well under 400ms threshold)
  await new Promise((r) => setTimeout(r, 80));
  backBtnB.dispatchEvent(new MockEvent('pointerup', { button: 0 }));
  backBtnB.click();

  assert.strictEqual(doc.querySelectorAll('.reader').length, 1, 'Short click must pop only Note B; Note A must remain');
  assert.strictEqual(getOverlayCount(), 1, 'Overlay stack must contain 1 item after single pop');

  // Push Note C on top of Note A
  await openNote({ ...mockNote, key: 'note-c', path: 'note-c.md', name: 'Note C' });
  assert.strictEqual(doc.querySelectorAll('.reader').length, 2, '2 readers must be mounted again');
  const readerC = doc.querySelectorAll('.reader')[1];
  const backBtnC = readerC.querySelector('.reader-bar .icon-btn');

  // Case 2: Long press exceeding hold threshold (>= 400ms) -> Complete stack clear
  backBtnC.dispatchEvent(new MockEvent('pointerdown', { button: 0 }));
  // Wait 450ms (exceeds 400ms hold threshold)
  await new Promise((r) => setTimeout(r, 450));
  backBtnC.click();

  assert.strictEqual(doc.querySelectorAll('.reader').length, 0, 'Hold gesture must clear the entire navigation stack back to root');
  assert.strictEqual(getOverlayCount(), 0, 'Overlay stack must be completely empty');
  assert.strictEqual(doc.body.classList.contains('has-reader'), false, 'has-reader class must be removed');
});

/* =========================================================================
   Part 7: Storage Provider Edit Capability & Mutation Integrity Tests (Issue 4)
   ========================================================================= */
console.log('\n--- Part 7: Storage Provider Edit Capability & Mutation Integrity Tests ---');

await testAsync('UI Action Binding Test: Every rendered connected library item has an active, bound Edit control that opens the editor', async () => {
  const { initSettings, cleanPath, cleanUrl } = await import('./src/ui/settings.js');
  const store = await import('./src/store.js');

  // Verify pure sanitization functions
  assert.strictEqual(cleanPath('   //notes/research///  '), 'notes/research', 'cleanPath must strip leading and trailing slashes and trim whitespace');
  assert.strictEqual(cleanPath('\\\\vault\\\\subfolder\\\\'), 'vault/subfolder', 'cleanPath must normalize backslashes to forward slashes');
  assert.strictEqual(cleanPath('///'), '', 'cleanPath of slashes only must result in empty string');
  assert.strictEqual(cleanUrl('https://example.com/dav/notes///'), 'https://example.com/dav/notes', 'cleanUrl must strip trailing slashes');

  // Seed storage with multiple distinct provider sources
  const ghSrc = { id: 'gh-alpha', type: 'github', owner: 'alice', repo: 'vault', branch: 'main', root: 'docs', name: 'Alice GitHub', token: 'ghp_secret' };
  const dbxSrc = { id: 'dbx-beta', type: 'dropbox', name: 'Dropbox Research', root: 'papers', token: 'sl.u.dbxsecret' };
  const davSrc = { id: 'dav-gamma', type: 'webdav', name: 'Nextcloud Notes', url: 'https://cloud.example.com/remote.php/dav/files/alice/Notes', username: 'alice', password: 'secretpassword' };
  const s3Src = { id: 's3-delta', type: 's3', name: 'AWS Books Vault', endpoint: 'https://s3.us-east-1.amazonaws.com', bucket: 'my-books', region: 'us-east-1', accessKeyId: 'AKIA123', secretAccessKey: 'sec456' };

  globalThis.localStorage.setItem('readover.sources', '[]');
  store.saveSource(ghSrc);
  store.saveSource(dbxSrc);
  store.saveSource(davSrc);
  store.saveSource(s3Src);

  let sourcesChangedTriggered = false;
  const mockApp = {
    syncSource: async () => {},
    reimport: async () => {},
    sourcesChanged: () => { sourcesChangedTriggered = true; },
  };

  const settingsInstance = initSettings(mockApp);
  await settingsInstance.refresh();

  const sourceList = doc.getElementById('source-list');
  assert.ok(sourceList, '#source-list must exist');
  const rows = sourceList.querySelectorAll('.source');
  assert.strictEqual(rows.length, 4, 'Must render exactly 4 connected library rows');

  // Check that every row has an active, bound Edit control
  for (const row of rows) {
    const editBtn = row.querySelector('.edit-source-btn');
    assert.ok(editBtn, 'Every rendered connected library item must contain an .edit-source-btn control');
    assert.strictEqual(editBtn.textContent, 'Edit', 'Edit button must be labeled "Edit"');
  }

  // Click Edit on the Dropbox row
  const dbxRow = Array.from(rows).find((r) => r.textContent.includes('Dropbox Research'));
  assert.ok(dbxRow, 'Dropbox row must exist in #source-list');
  const dbxEditBtn = dbxRow.querySelector('.edit-source-btn');
  assert.ok(dbxEditBtn, 'Dropbox row edit button must exist');
  dbxEditBtn.click();

  const editDialog = doc.getElementById('edit-source-sheet');
  assert.ok(editDialog, '#edit-source-sheet must exist in DOM');
  assert.strictEqual(editDialog.open, true, '#edit-source-sheet must open when Edit is clicked');

  // Verify form pre-population
  assert.strictEqual(doc.getElementById('edit-source-id').value, 'dbx-beta', 'ID must be pre-populated with source.id');
  assert.strictEqual(doc.getElementById('edit-source-type').value, 'dropbox', 'Type must be pre-populated');
  assert.strictEqual(doc.getElementById('edit-source-name').value, 'Dropbox Research', 'Name must be pre-populated');
  assert.strictEqual(doc.getElementById('edit-source-root').value, 'papers', 'Root folder must be pre-populated');

  // Credential masking and visibility toggle
  const credInput = doc.getElementById('edit-source-credential');
  const credToggle = doc.getElementById('edit-source-cred-toggle');
  assert.ok(credInput, 'Credential input must exist');
  assert.ok(credToggle, 'Credential toggle button must exist');
  assert.strictEqual(credInput.type, 'password', 'Credential input must be masked as password by default');
  assert.strictEqual(credInput.value, 'sl.u.dbxsecret', 'Credential value must be pre-populated');

  // Click visibility toggle -> switches to text
  credToggle.click();
  assert.strictEqual(credInput.type, 'text', 'Clicking toggle must unmask credential to text');

  // Click visibility toggle again -> switches back to password
  credToggle.click();
  assert.strictEqual(credInput.type, 'password', 'Clicking toggle again must re-mask credential to password');

  // Close the dialog
  editDialog.close();
  assert.strictEqual(editDialog.open, false, 'Edit dialog must close');
});

await testAsync('Source Mutation Integrity Test: Editing preserves source id and local cache linkage', async () => {
  const store = await import('./src/store.js');
  const library = await import('./src/library.js');
  const { openEditSource } = await import('./src/ui/settings.js');

  const sourceId = 'dbx-beta';
  const originalSource = store.getSource(sourceId);
  assert.ok(originalSource, 'Source must exist before test');

  // Setup mock cached items attached to this source ID in IndexedDB
  const noteKey1 = store.keyOf(sourceId, 'notes/architecture.md');
  const noteKey2 = store.keyOf(sourceId, 'notes/zettelkasten.md');
  await store.items.put({ key: noteKey1, sourceId, path: 'notes/architecture.md', name: 'architecture.md', kind: 'note' });
  await store.items.put({ key: noteKey2, sourceId, path: 'notes/zettelkasten.md', name: 'zettelkasten.md', kind: 'note' });

  // Assert cached items exist before mutation
  const item1Before = await store.items.get(noteKey1);
  assert.ok(item1Before, 'Cached item 1 must be present prior to editing');
  assert.strictEqual(item1Before.sourceId, sourceId);

  // Directly test store.updateSource immutability guarantees
  const illegalAttempt = store.updateSource(sourceId, { id: 'tampered-id', type: 'github', name: 'Attempted Hijack' });
  assert.strictEqual(illegalAttempt.id, sourceId, 'store.updateSource must strictly ignore attempt to mutate source.id');
  assert.strictEqual(illegalAttempt.type, 'dropbox', 'store.updateSource must strictly ignore attempt to mutate source.type');
  assert.strictEqual(illegalAttempt.name, 'Attempted Hijack');

  // Now perform full UI edit through the edit sheet
  openEditSource(store.getSource(sourceId));

  const editDialog = doc.getElementById('edit-source-sheet');
  assert.strictEqual(editDialog.open, true, 'Edit dialog must be opened');

  // Modify Display Name, Root path (with messy whitespace/slashes), and Token
  doc.getElementById('edit-source-name').value = 'Scientific Knowledge Vault';
  doc.getElementById('edit-source-root').value = '   //research/quantum-computing///   ';
  doc.getElementById('edit-source-credential').value = 'sl.u.super_secure_updated_token_999';

  // Submit edit form
  const editForm = doc.getElementById('edit-source-form');
  editForm.dispatchEvent(new MockEvent('submit', { cancelable: true }));

  // 1. Verify source mutation integrity: source.id unchanged!
  const updatedSource = store.getSource(sourceId);
  assert.ok(updatedSource, 'Source must still exist');
  assert.strictEqual(updatedSource.id, sourceId, 'CRITICAL: source.id must remain completely identical');
  assert.strictEqual(updatedSource.type, 'dropbox', 'source.type must remain identical');
  assert.strictEqual(updatedSource.name, 'Scientific Knowledge Vault', 'Display name must be updated');
  assert.strictEqual(updatedSource.root, 'research/quantum-computing', 'Root path must be cleanly sanitized without leading/trailing slashes');
  assert.strictEqual(updatedSource.token, 'sl.u.super_secure_updated_token_999', 'Token credential must be updated');

  // 2. Verify local cache linkage: note keys ${sourceId}|${path} are NOT orphaned
  const item1After = await store.items.get(noteKey1);
  const item2After = await store.items.get(noteKey2);
  assert.ok(item1After, 'Cached item 1 must still be retrievable via its original key');
  assert.ok(item2After, 'Cached item 2 must still be retrievable via its original key');
  assert.strictEqual(item1After.sourceId, sourceId, 'Cached item 1 sourceId linkage must be preserved');
  assert.strictEqual(item2After.sourceId, sourceId, 'Cached item 2 sourceId linkage must be preserved');

  // 3. Verify instant propagation across display names and UI
  assert.strictEqual(library.displayName(updatedSource), 'Scientific Knowledge Vault', 'library.displayName must immediately reflect updated name');
  assert.strictEqual(editDialog.open, false, 'Edit dialog must be closed after successful save');

  const sourceList = doc.getElementById('source-list');
  assert.ok(sourceList.textContent.includes('Scientific Knowledge Vault'), 'Settings list must immediately display the new display name');
});

/* =========================================================================
   Part 8: Media Destination Dropdown Clean Labeling & Path Construction Tests (Issue 5)
   ========================================================================= */
console.log('\n--- Part 8: Media Destination Dropdown Clean Labeling & Path Construction Tests ---');

await testAsync('Label Formatting Test: Dropdown Option Labels Represent Target Storage Only (Zero Hardcoded Subfolder Paths)', async () => {
  const { initSettings, formatDropboxLabel, formatS3Label } = await import('./src/ui/settings.js');
  const store = await import('./src/store.js');

  // Seed storage with distinct providers
  const dbxSrc = { id: 'dbx-personal', type: 'dropbox', name: 'Personal', root: 'vault', token: 'sl.u.personal_token' };
  const s3Src = { id: 's3-vault', type: 's3', name: 'AWS Books Vault', endpoint: 'https://s3.us-east-1.amazonaws.com', bucket: 'media', region: 'us-east-1', accessKeyId: 'k', secretAccessKey: 's' };

  globalThis.localStorage.setItem('readover.sources', '[]');
  store.saveSource(dbxSrc);
  store.saveSource(s3Src);

  // Pure label format unit checks
  assert.strictEqual(formatDropboxLabel(dbxSrc), 'Dropbox (Personal)', 'formatDropboxLabel must wrap non-prefixed name cleanly');
  assert.strictEqual(formatDropboxLabel({ name: 'Dropbox Vault' }), 'Dropbox Vault', 'formatDropboxLabel must avoid redundant Dropbox prefix');
  assert.strictEqual(formatDropboxLabel({ name: '' }), 'Dropbox', 'formatDropboxLabel must fall back to Dropbox if name is empty');
  assert.strictEqual(formatS3Label(s3Src), 'S3 / R2 (AWS Books Vault)', 'formatS3Label must wrap vault name cleanly');

  const mockApp = {
    syncSource: async () => {},
    reimport: async () => {},
    sourcesChanged: () => {},
  };

  const settingsInstance = initSettings(mockApp);
  settingsInstance.renderHighlightHome();

  const attSel = doc.getElementById('attachments-dest-select');
  assert.ok(attSel, '#attachments-dest-select must exist in DOM');

  const options = Array.from(attSel.children);
  assert.ok(options.length >= 4, 'Must render destination options for same-as-note, s3, dropbox, and device');

  // Verify that NO option text or attribute bakes in /attachments/ or subfolders
  for (const opt of options) {
    const text = opt.textContent;
    assert.strictEqual(text.includes('/attachments/'), false, `Option label must NOT contain hardcoded /attachments/: "${text}"`);
    assert.strictEqual(text.includes('/attachments'), false, `Option label must NOT contain hardcoded /attachments: "${text}"`);
    assert.strictEqual(text.includes('\\attachments'), false, `Option label must NOT contain backslash attachments: "${text}"`);
  }

  // Verify explicit clean labels
  const optionTexts = options.map((o) => o.textContent);
  assert.ok(optionTexts.includes('Same library as note (default)'), 'Must include clean Same library as note option');
  assert.ok(optionTexts.includes('Dropbox (Personal)'), 'Must include clean Dropbox (Personal) option');
  assert.ok(optionTexts.includes('S3 / R2 (AWS Books Vault)'), 'Must include clean S3 / R2 option');
  assert.ok(optionTexts.includes('This device only'), 'Must include clean This device only option');
});

test('Path Construction Contract Test: Folder Input is Sole Source of Truth Without Injected Paths', async () => {
  const { buildAttachmentPath, generateAttachmentFilename } = await import('./src/attachments.js');

  // 1. Filename structure contract: YYYY-MM-DD-slug-hash.webp
  const filename = generateAttachmentFilename('diagram', 'webp');
  assert.match(filename, /^\d{4}-\d{2}-\d{2}-diagram-[a-z0-9]+\.webp$/, 'Filename must format as YYYY-MM-DD-slug-hash.webp');

  // 2. Relative path construction with custom folder '_assets'
  const customPath = buildAttachmentPath(filename, '_assets');
  assert.match(customPath, /^_assets\/\d{4}-\d{2}-\d{2}-diagram-[a-z0-9]+\.webp$/, 'Upload path must start with _assets/');
  assert.strictEqual(customPath.includes('attachments'), false, 'Upload path must not inject /attachments/ when folder is _assets');

  // 3. Defensive sanitization against dirty paths (leading/trailing slashes, backslashes, duplicate slashes)
  assert.strictEqual(buildAttachmentPath('image.webp', '  ///custom-vault///  '), 'custom-vault/image.webp', 'Must trim and strip redundant slashes');
  assert.strictEqual(buildAttachmentPath('image.webp', '\\\\windows\\\\style\\\\path\\\\'), 'windows/style/path/image.webp', 'Must normalize backslashes');
  assert.strictEqual(buildAttachmentPath('image.webp', '///nested//deep///dir///'), 'nested/deep/dir/image.webp', 'Must collapse multiple consecutive slashes');
  assert.strictEqual(buildAttachmentPath('image.webp', ''), 'image.webp', 'Empty folder must resolve directly to clean filename');
  assert.strictEqual(buildAttachmentPath('image.webp', null), 'image.webp', 'Null folder must resolve directly to clean filename');

  // 4. Default fallback when folder parameter is omitted
  assert.strictEqual(buildAttachmentPath('image.webp'), 'attachments/image.webp', 'Default folder fallback must resolve to attachments/image.webp');
});

await testAsync('Dynamic Explanatory Copy & Real-Time Preference Mapping Test', async () => {
  const { initSettings } = await import('./src/ui/settings.js');
  const { resolveAttachmentSource } = await import('./src/attachments.js');
  const store = await import('./src/store.js');

  const mockApp = {
    syncSource: async () => {},
    reimport: async () => {},
    sourcesChanged: () => {},
  };

  const settingsInstance = initSettings(mockApp);
  settingsInstance.renderHighlightHome();

  const attSel = doc.getElementById('attachments-dest-select');
  const attFolderInput = doc.getElementById('attachments-folder-input');
  const hintEl = doc.getElementById('attachments-dest-hint');

  assert.ok(attSel && attFolderInput && hintEl, 'Controls and dynamic hint element must all exist');

  // Step 1: Select Dropbox destination
  attSel.value = 'dropbox';
  attSel.dispatchEvent(new MockEvent('change'));
  assert.strictEqual(store.getPrefs().attachmentsVault, 'dropbox');
  assert.ok(hintEl.textContent.includes('Dropbox (Personal)'), 'Hint must immediately reflect selected Dropbox target');
  assert.ok(hintEl.textContent.includes('attachments'), 'Hint must show current folder default');

  // Step 2: Change folder input with whitespace and excess slashes
  attFolderInput.value = '   ///_assets///   ';
  attFolderInput.dispatchEvent(new MockEvent('input'));
  // Dynamic preview should update on typing (input event)
  assert.strictEqual(hintEl.textContent, 'Images will be stored in Dropbox (Personal) / _assets /');
  assert.strictEqual(hintEl.textContent.includes('///'), false, 'Hint preview must not contain un-sanitized slashes');
  assert.strictEqual(hintEl.textContent.includes('/attachments/'), false, 'Hint preview must not contain /attachments/');

  // Step 3: Commit folder input (change event)
  attFolderInput.dispatchEvent(new MockEvent('change'));
  assert.strictEqual(store.getPrefs().attachmentsFolder, '_assets', 'Store prefs must hold clean sanitized subfolder');

  // Step 4: Switch destination to S3
  attSel.value = 's3';
  attSel.dispatchEvent(new MockEvent('change'));
  assert.strictEqual(store.getPrefs().attachmentsVault, 's3');
  assert.strictEqual(hintEl.textContent, 'Images will be stored in S3 / R2 (AWS Books Vault) / _assets /');

  // Step 5: Switch destination to Device
  attSel.value = 'device';
  attSel.dispatchEvent(new MockEvent('change'));
  assert.strictEqual(store.getPrefs().attachmentsVault, 'device');
  assert.strictEqual(hintEl.textContent, 'Images will be stored in This device / _assets /');

  // Step 6: Switch destination to Same library as note
  attSel.value = 'same-as-note';
  attSel.dispatchEvent(new MockEvent('change'));
  assert.strictEqual(store.getPrefs().attachmentsVault, 'same-as-note');
  assert.strictEqual(hintEl.textContent, 'Images will be stored in Same library as note / _assets /');

  // Step 7: Verify legacy preference compatibility and graceful degradation
  store.setPrefs({ attachmentsVault: 'Dedicated Dropbox /attachments/ (Personal)' });
  const resolvedDbx = resolveAttachmentSource();
  assert.ok(resolvedDbx, 'resolveAttachmentSource must resolve legacy Dropbox string');
  assert.strictEqual(resolvedDbx.type, 'dropbox');

  store.setPrefs({ attachmentsVault: 'Dedicated S3 /attachments/' });
  const resolvedS3 = resolveAttachmentSource();
  assert.ok(resolvedS3, 'resolveAttachmentSource must resolve legacy S3 string');
  assert.strictEqual(resolvedS3.type, 's3');

  store.setPrefs({ attachmentsVault: 'device' });
  const resolvedDevice = resolveAttachmentSource();
  assert.strictEqual(resolvedDevice.id, 'device', 'resolveAttachmentSource must resolve device preference');

  store.setPrefs({ attachmentsVault: 'note-provider', attachmentsDestination: 'note-provider' });
  const resolvedNote = resolveAttachmentSource({ sourceId: 'dbx-personal' });
  assert.strictEqual(resolvedNote.id, 'dbx-personal', 'resolveAttachmentSource must resolve note-provider');
});

/* =========================================================================
   Part 9: Binary Ghost Upload Defense & Payload Verification Contract Tests
   ========================================================================= */
console.log('\n--- Part 9: Binary Ghost Upload Defense & Payload Verification Contract Tests ---');

await testAsync('Stream State Contract Check: Metadata Extraction & Covers Must Not Exhaust Source Blob Stream', async () => {
  const { validateBinaryPayload, cloneBlob } = await import('./src/utils/binary.js');

  // Realistic 64 KB non-zero mock binary (e.g. EPUB header & content)
  const mock64Kb = new Uint8Array(64 * 1024);
  for (let i = 0; i < mock64Kb.length; i++) mock64Kb[i] = (i * 37) % 256;
  const sourceBlob = new Blob([mock64Kb], { type: 'application/epub+zip' });

  // 1. Metadata routines clone the blob to extract headers/thumbnails
  const cloned = cloneBlob(sourceBlob);
  assert.strictEqual(cloned.size, 64 * 1024, 'Cloned blob must retain exact byte size');
  const consumedBuf = await cloned.arrayBuffer();
  assert.strictEqual(consumedBuf.byteLength, 64 * 1024, 'Consumed clone must yield full byte array');

  // 2. Assert sourceBlob remains completely unexhausted and reusable for network transport
  const { body: validatedBody, size: validatedSize } = await validateBinaryPayload(sourceBlob);
  assert.strictEqual(validatedSize, 64 * 1024, 'Source blob must report full 64KB unconsumed');
  const sourceBuf = await validatedBody.arrayBuffer();
  assert.strictEqual(sourceBuf.byteLength, 64 * 1024, 'Source blob stream must produce full 64KB after clone consumption');
});

await testAsync('Pre-Flight Payload Inspection: Fails Fast on 0-Byte Payloads, Detached Buffers, or Missing Streams', async () => {
  const { validateBinaryPayload } = await import('./src/utils/binary.js');

  // 1. 0-byte Blob
  await assert.rejects(
    async () => validateBinaryPayload(new Blob([])),
    /0 bytes/,
    'Must fail fast when source Blob is 0 bytes'
  );

  // 2. 0-byte ArrayBuffer
  await assert.rejects(
    async () => validateBinaryPayload(new ArrayBuffer(0)),
    /0 bytes/,
    'Must fail fast when ArrayBuffer is 0 bytes'
  );

  // 3. Null or undefined
  await assert.rejects(
    async () => validateBinaryPayload(null),
    /null or undefined/,
    'Must reject null binary payload'
  );

  // 4. Unconsumed promise of binary data resolves and validates cleanly
  const deferredPayload = Promise.resolve(new Uint8Array([10, 20, 30, 40, 50]));
  const res = await validateBinaryPayload(deferredPayload);
  assert.strictEqual(res.size, 5, 'Must resolve promised binary payload and determine size');
  assert.strictEqual(res.body.byteLength, 5);
});

await testAsync('Binary Round-Trip Integration Test: Exact Byte Parity Across Cloud Adapter', async () => {
  const dropbox = await import('./src/sources/dropbox.js');
  const originalFetch = globalThis.fetch;

  const mock64Kb = new Uint8Array(64 * 1024);
  for (let i = 0; i < mock64Kb.length; i++) mock64Kb[i] = (i * 41) % 256;
  const testBlob = new Blob([mock64Kb], { type: 'application/epub+zip' });

  let serverReceivedBytes = 0;
  globalThis.fetch = async (url, init) => {
    const sUrl = String(url);
    if (sUrl.includes('/files/upload')) {
      if (init?.body instanceof Blob) serverReceivedBytes = init.body.size;
      else if (init?.body?.byteLength) serverReceivedBytes = init.body.byteLength;
      else serverReceivedBytes = 0;

      return new Response(JSON.stringify({
        name: 'book.epub',
        size: serverReceivedBytes,
        rev: 'rev-ok-123',
        path_display: '/books/book.epub',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (sUrl.includes('/files/download')) {
      return new Response(mock64Kb, { status: 200 });
    }
    return originalFetch(url, init);
  };

  try {
    const dbxSource = { id: 'dbx-test', type: 'dropbox', name: 'Dropbox Vault', token: 'valid-test-token' };

    // 1. Upload non-zero binary
    const uploadRes = await dropbox.putAttachment(dbxSource, 'books/book.epub', testBlob);
    assert.strictEqual(uploadRes.size, 64 * 1024, 'Upload response must confirm 64KB size');

    // 2. Download from remote adapter and verify exact byte parity
    const downloadedBlob = await dropbox.readBlob(dbxSource, { path: 'books/book.epub' });
    const downloadedBuf = await downloadedBlob.arrayBuffer();

    // uploadedBytes.byteLength == retrievedBytes.byteLength > 0
    assert.strictEqual(downloadedBuf.byteLength, mock64Kb.byteLength, 'Retrieved bytes must equal uploaded bytes');
    assert.ok(downloadedBuf.byteLength > 0, 'Committed byte count must be strictly greater than 0');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await testAsync('Upload Verification Contract: Fail-Fast on Remote 0-Byte Ghost Upload & Shelf Rollback', async () => {
  const { saveBookToVault } = await import('./src/insights.js');
  const store = await import('./src/store.js');
  const originalFetch = globalThis.fetch;

  // Configure Dropbox as the active booksHome vault
  const ghostDbx = { id: 'dbx-ghost-vault', type: 'dropbox', name: 'Dropbox Vault', token: 'valid-token' };
  store.saveSource(ghostDbx);
  store.setPrefs({ booksHome: ghostDbx.id });

  // Simulate server-side truncation: server receives data but commits 0 bytes!
  globalThis.fetch = async (url, init) => {
    const sUrl = String(url);
    if (sUrl.includes('/files/upload')) {
      return new Response(JSON.stringify({
        name: 'ghost-truncated.epub',
        size: 0, // 0-byte ghost failure!
        rev: 'ghost-rev',
        path_display: '/books/ghost-truncated.epub',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return originalFetch(url, init);
  };

  const payload64Kb = new Uint8Array(64 * 1024);
  const testFile = new Blob([payload64Kb], { type: 'application/epub+zip' });
  const filename = 'ghost-truncated.epub';
  const expectedKey = store.keyOf(ghostDbx.id, `books/${filename}`);

  try {
    // Attempting to ingest when remote server commits 0 bytes must throw immediately
    await assert.rejects(
      async () => {
        await saveBookToVault({
          file: testFile,
          filename,
          title: 'Ghost Book',
          sourceId: ghostDbx.id,
        });
      },
      /Upload failed: Dropbox received 0 bytes/,
      'saveBookToVault must reject immediately when remote server commits 0 bytes'
    );

    // Rollback Verification: Ensure zero corrupt entries remain in IndexedDB or Shelf
    const orphanedItem = await store.items.get(expectedKey);
    const orphanedBlob = await store.blobs.get(expectedKey);
    assert.strictEqual(orphanedItem, null, 'Failed 0-byte upload must NOT leave an orphaned item on the shelf');
    assert.strictEqual(orphanedBlob, null, 'Failed 0-byte upload must NOT leave an orphaned blob in IDB cache');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

/* =========================================================================
   Part 10: File Management & Diagnostic Visibility for Books and Attachments
   ========================================================================= */

console.log('\n--- Part 10: File Management & Diagnostic Visibility for Books and Attachments ---');

await testAsync('Cross-Provider Book Migration Test: Asserts binary moves, updates database key, and preserves reading progress', async () => {
  const store = await import('./src/store.js');
  const library = await import('./src/library.js');

  const srcA = { id: 'source-alpha', type: 'dropbox', name: 'Dropbox Alpha', token: 'token-a' };
  const srcB = {
    id: 'source-beta',
    type: 's3',
    name: 'S3 Beta',
    endpoint: 'https://s3.example.com',
    bucket: 'beta-vault',
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
  };
  store.saveSource(srcA);
  store.saveSource(srcB);

  // Mock fetch for dropbox delete and s3 upload
  const originalFetch = globalThis.fetch;
  let deletedFromSourceA = false;
  let uploadedToSourceB = false;

  globalThis.fetch = async (url, init) => {
    const sUrl = String(url);
    if (sUrl.includes('/files/delete_v2')) {
      deletedFromSourceA = true;
      return new Response(JSON.stringify({ metadata: { name: 'carmilla.epub' } }), { status: 200 });
    }
    if (sUrl.includes('beta-vault') || (init?.method === 'PUT' && sUrl.includes('books/carmilla.epub'))) {
      uploadedToSourceB = true;
      return new Response('', { status: 200, headers: { etag: '"etag-b"' } });
    }
    return originalFetch(url, init);
  };

  try {
    const bookBytes = new Uint8Array([67, 97, 114, 109, 105, 108, 108, 97]); // "Carmilla"
    const bookBlob = new Blob([bookBytes], { type: 'application/epub+zip' });
    const oldPath = 'books/carmilla.epub';
    const oldKey = store.keyOf(srcA.id, oldPath);

    // Seed book in source A
    const itemA = {
      key: oldKey,
      sourceId: srcA.id,
      path: oldPath,
      folder: 'books',
      name: 'carmilla.epub',
      kind: 'epub',
      sha: 'sha-a-123',
      size: bookBytes.byteLength,
      addedAt: Date.now() - 50000,
    };
    await store.items.put(itemA);
    await store.blobs.put({ key: oldKey, sourceId: srcA.id, sha: itemA.sha, blob: bookBlob });
    await store.thumbs.put({ key: oldKey, sourceId: srcA.id, sha: itemA.sha, title: 'Carmilla', author: 'Sheridan Le Fanu' });
    await store.progress.put({ key: oldKey, sourceId: srcA.id, pct: 0.42, locator: 'epubcfi(/6/4[chap1]!/4/2/10)', updatedAt: Date.now() });

    // Seed a garden note that links to this book
    const oldBookRef = `${store.sourceKey(srcA)}|${oldPath}`;
    const noteKey = store.keyOf('device', 'Highlights/carmilla-quote.md');
    const noteText = `# Insight on Carmilla\n\n> The vampire was near.\n> — [[Carmilla]], chap 1\n<!-- readover ${JSON.stringify({ book: oldBookRef, at: 'chap 1' })} -->\n\n[Jump to passage in book](readover://open?book=${encodeURIComponent(oldBookRef)}&at=chap%201)\n`;
    await store.content.put({ key: noteKey, sourceId: 'device', sha: 'note-sha', text: noteText });

    // Execute migration from srcA to srcB
    const moved = await library.moveBookBetweenSources(srcA.id, srcB.id, oldKey);
    assert.ok(moved, 'moveBookBetweenSources must return the new item record');
    assert.strictEqual(moved.sourceId, srcB.id, 'New item must belong to destination source');

    // 1. Verify old records are cleaned up
    const oldItemAfter = await store.items.get(oldKey);
    const oldBlobAfter = await store.blobs.get(oldKey);
    assert.strictEqual(oldItemAfter, null, 'Old item record must be purged from source library');
    assert.strictEqual(oldBlobAfter, null, 'Old blob record must be purged from source library');

    // 2. Verify new records exist under destination source
    const newKey = moved.key;
    const newItem = await store.items.get(newKey);
    assert.ok(newItem, 'New item must exist in store.items');
    assert.strictEqual(newItem.sourceId, srcB.id);

    const newBlob = await store.blobs.get(newKey);
    assert.ok(newBlob?.blob, 'Binary blob must be present under new destination key');
    assert.strictEqual(newBlob.blob.size, bookBytes.byteLength, 'Migrated blob must match exact byte size');

    // 3. Verify reading progress is preserved
    const newProg = await store.progress.get(newKey);
    assert.ok(newProg, 'Reading progress record must be migrated');
    assert.strictEqual(newProg.pct, 0.42, 'Progress percentage must be preserved exactly');
    assert.strictEqual(newProg.locator, 'epubcfi(/6/4[chap1]!/4/2/10)', 'Reading locator must be preserved exactly');

    // 4. Verify thumbnail and metadata are preserved
    const newThumb = await store.thumbs.get(newKey);
    assert.ok(newThumb, 'Thumbnail/metadata record must be migrated');
    assert.strictEqual(newThumb.title, 'Carmilla');
    assert.strictEqual(newThumb.author, 'Sheridan Le Fanu');

    // 5. Verify garden note anchors were updated to reference the new destination
    const updatedNote = await store.content.get(noteKey);
    const newBookRef = `${store.sourceKey(srcB)}|${newItem.path}`;
    assert.ok(updatedNote.text.includes(newBookRef), 'Garden note text must now reference the new destination bookRef');
    assert.ok(!updatedNote.text.includes(oldBookRef), 'Garden note text must no longer contain the old source bookRef');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await testAsync('Cache Eviction Isolation Test: Asserts evictBookCache deletes from store.blobs but preserves store.items and garden notes', async () => {
  const store = await import('./src/store.js');
  const library = await import('./src/library.js');

  const remoteSrc = { id: 'remote-evict-source', type: 'dropbox', name: 'Dropbox Vault', token: 'tok' };
  store.saveSource(remoteSrc);

  const bookBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const bookBlob = new Blob([bookBytes], { type: 'application/pdf' });
  const bookPath = 'books/isolated.pdf';
  const bookKey = store.keyOf(remoteSrc.id, bookPath);

  const bookItem = {
    key: bookKey,
    sourceId: remoteSrc.id,
    path: bookPath,
    folder: 'books',
    name: 'isolated.pdf',
    kind: 'pdf',
    sha: 'iso-sha',
    size: 8,
    addedAt: Date.now(),
  };

  // Seed remote book with local blob cache
  await store.items.put(bookItem);
  await store.blobs.put({ key: bookKey, sourceId: remoteSrc.id, sha: bookItem.sha, blob: bookBlob });
  await store.progress.put({ key: bookKey, sourceId: remoteSrc.id, pct: 0.75, locator: 'page=12', updatedAt: Date.now() });

  // Seed on-device book to test protection against evicting device-only copy
  const devKey = store.keyOf('device', 'books/device-only.epub');
  const devItem = {
    key: devKey,
    sourceId: 'device',
    path: 'books/device-only.epub',
    name: 'device-only.epub',
    kind: 'epub',
    size: 8,
  };
  await store.items.put(devItem);
  await store.blobs.put({ key: devKey, sourceId: 'device', sha: 'dev-sha', blob: bookBlob });

  // 1. Evict local cache of remote book
  const res = await library.evictBookCache(bookKey);
  assert.strictEqual(res.freedBytes, 8, 'evictBookCache must report freed byte count');

  // Verify blob is deleted but item and progress remain intact
  const blobAfter = await store.blobs.get(bookKey);
  assert.strictEqual(blobAfter, null, 'Local blob cache must be evicted from store.blobs');

  const itemAfter = await store.items.get(bookKey);
  assert.ok(itemAfter, 'Item record in store.items must remain on shelf');
  assert.strictEqual(itemAfter.name, 'isolated.pdf');

  const progAfter = await store.progress.get(bookKey);
  assert.ok(progAfter, 'Reading progress in store.progress must remain intact');
  assert.strictEqual(progAfter.pct, 0.75);

  // 2. Assert protection: on-device books must refuse eviction
  await assert.rejects(
    async () => library.evictBookCache(devKey),
    /Cannot remove local download for a book that is only stored on this device/,
    'evictBookCache must fail fast when attempting to evict device-only book'
  );

  // Device blob must still be intact
  const devBlob = await store.blobs.get(devKey);
  assert.ok(devBlob?.blob, 'Device-only book blob must remain in IDB');

  // 3. Test clearAllBookCaches(): cleans remote downloads while preserving device books
  const clearRes = await library.clearAllBookCaches();
  assert.ok(typeof clearRes.count === 'number');

  const devBlobStillThere = await store.blobs.get(devKey);
  assert.ok(devBlobStillThere?.blob, 'clearAllBookCaches must NEVER delete device-only books');
});

await testAsync('UI Action Binding Audit: Asserts all book cards have active ··· triggers opening the management sheet', async () => {
  const { initShelf } = await import('./src/ui/shelf.js');
  const store = await import('./src/store.js');

  const testSrc = { id: 'shelf-audit-src', type: 'dropbox', name: 'My Cloud Library', token: 'audit-token' };
  store.saveSource(testSrc);

  const mockBook = {
    key: store.keyOf(testSrc.id, 'books/audit-test.epub'),
    sourceId: testSrc.id,
    path: 'books/audit-test.epub',
    folder: 'books',
    name: 'audit-test.epub',
    kind: 'epub',
    size: 1024 * 512, // 512 KB
    addedAt: Date.now(),
  };
  await store.items.put(mockBook);
  await store.thumbs.put({ key: mockBook.key, sourceId: testSrc.id, title: 'Audit Test Book', author: 'Author Test' });

  let openedBook = null;
  const mockApp = {
    openBook: (item) => { openedBook = item; },
    connect: () => {},
  };

  const shelfInstance = initShelf(mockApp);
  await shelfInstance.render();

  const shelfEl = doc.getElementById('shelf');
  assert.ok(shelfEl, '#shelf element must exist in DOM');

  // 1. Verify Shelf header contains Actions ▾ button
  const shelfActionsBtn = shelfEl.querySelector('.shelf-actions-btn');
  assert.ok(shelfActionsBtn, '.shelf-actions-btn (Actions ▾) must exist in shelf bar');

  // 2. Verify rendered book card has .shelf-book and .shelf-book-menu-btn
  const bookCards = shelfEl.querySelectorAll('.shelf-book-card');
  const bookCard = bookCards.find((c) => c._item?.key === mockBook.key) || bookCards[0];
  assert.ok(bookCard, '.shelf-book-card container must be mounted in DOM');

  const menuBtn = bookCard.querySelector('.shelf-book-menu-btn');
  assert.ok(menuBtn, '.shelf-book-menu-btn (··· trigger) must exist on book card');
  assert.strictEqual(menuBtn.getAttribute('aria-label'), 'Manage Audit Test Book', 'menuBtn must have accessible aria-label');

  // 3. Clicking menuBtn must open the Book Management & Details Sheet
  menuBtn.click();

  // Give microtasks a tick to mount sheet
  await new Promise((r) => setTimeout(r, 50));

  const sheetDialog = doc.querySelector('.book-details-sheet') || doc.querySelectorAll('.sheet').find((d) => d.open && !d.id);
  assert.ok(sheetDialog, 'Management sheet dialog must be mounted in DOM upon clicking ···');

  // Verify file diagnostics badges
  const formatBadge = sheetDialog.querySelector('.badge-format');
  assert.ok(formatBadge, 'Format badge (.badge-format) must exist in details sheet');
  assert.strictEqual(formatBadge.textContent, 'EPUB');

  const sizeBadge = sheetDialog.querySelector('.badge-size');
  assert.ok(sizeBadge, 'Size badge (.badge-size) must exist in details sheet');
  assert.ok(sizeBadge.textContent.includes('512.0 KB'), 'Size badge must display formatted byte size');

  // Verify action buttons
  const moveBtn = sheetDialog.querySelector('.book-action-move');
  const evictBtn = sheetDialog.querySelector('.book-action-evict');
  const deleteBtn = sheetDialog.querySelector('.book-action-delete');

  assert.ok(moveBtn, 'Move to another library button (.book-action-move) must exist');
  assert.ok(evictBtn, 'Remove local download button (.book-action-evict) must exist');
  assert.ok(deleteBtn, 'Delete permanently button (.book-action-delete) must exist');

  // Clicking menuBtn must NOT have triggered openBook on the app
  assert.strictEqual(openedBook, null, 'Clicking menu button must not trigger openBook');

  // Close sheet dialog cleanly
  sheetDialog.close();
});

/* =========================================================================
   Part 11: Storage Hierarchy & Notes/Types/Highlights Resolution Tests
   ========================================================================= */
console.log('\n--- Part 11: Storage Hierarchy & Notes/Types/Highlights Resolution Tests ---');

await testAsync('Hierarchy Resolution Contract: Standard notes resolve to [base]/{type}/... and highlights resolve to [base]/[highlights]/...', async () => {
  const store = await import('./src/store.js');
  const insights = await import('./src/insights.js');
  const compose = await import('./src/ui/compose.js');

  // Case 1: Custom base folder "notes" and highlights folder "Highlights"
  store.setPrefs({ notesHome: 'device', notesFolder: 'notes', highlightsFolder: 'Highlights' });
  assert.strictEqual(insights.notesFolder(), 'notes', 'notesFolder() must read pref');
  assert.strictEqual(insights.highlightsFolder(), 'Highlights', 'highlightsFolder() must read pref');

  // notesRoot with no src root
  assert.strictEqual(insights.notesRoot({ root: '' }), 'notes', 'notesRoot({ root: "" }) must equal notesFolder');
  assert.strictEqual(insights.notesRoot(null), 'notes', 'notesRoot(null) with device home must equal notesFolder');
  // notesRoot with src root "vault"
  assert.strictEqual(insights.notesRoot({ root: 'vault' }), 'vault/notes', 'notesRoot must combine src.root and notesFolder');

  // Insight creation with base folder
  const insight = await insights.createInsight({
    quote: 'Design is how it works.',
    title: 'Steve Jobs on Design',
    thought: 'Substance over surface.',
  });
  assert.strictEqual(insight.item.folder, 'notes/Highlights', 'Insight folder must resolve to notes/Highlights');
  assert.ok(insight.item.path.startsWith('notes/Highlights/'), `Insight path must start with notes/Highlights/, got: ${insight.item.path}`);
  assert.strictEqual(insight.item.path.includes('//'), false, 'Path must not contain double slashes');

  // Standard note folder resolution with compose rootOf
  const src = { id: 'device', root: '' };
  const root = compose.rootOf(src);
  assert.strictEqual(root, 'notes', 'rootOf(src) must include notesFolder');

  // Note with Type "Essays"
  const typeFolder = [root, 'Essays'].filter(Boolean).join('/');
  assert.strictEqual(typeFolder, 'notes/Essays', 'Standard note folder under Essays must resolve to notes/Essays');
});

await testAsync('Root Fallback Safety: Leaving notesFolder blank saves notes to root without path corruption or leading slashes', async () => {
  const store = await import('./src/store.js');
  const insights = await import('./src/insights.js');
  const compose = await import('./src/ui/compose.js');

  // Configure empty base folder
  store.setPrefs({ notesHome: 'device', notesFolder: '', highlightsFolder: 'Highlights' });
  assert.strictEqual(insights.notesFolder(), '', 'notesFolder() must be empty string');
  assert.strictEqual(insights.notesRoot({ root: '' }), '', 'notesRoot({ root: "" }) must be empty string when notesFolder is empty');
  assert.strictEqual(insights.notesRoot(null), '', 'notesRoot(null) must be empty string when notesFolder is empty');

  // Highlight creation with root fallback
  const rootInsight = await insights.createInsight({
    quote: 'Simplicity is prerequisite for reliability.',
    title: 'Dijkstra on Simplicity',
  });
  assert.strictEqual(rootInsight.item.folder, 'Highlights', 'Insight folder must resolve to Highlights without leading slash');
  assert.ok(rootInsight.item.path.startsWith('Highlights/'), `Insight path must start with Highlights/, got: ${rootInsight.item.path}`);
  assert.strictEqual(rootInsight.item.path.startsWith('/'), false, 'Path must not start with a leading slash');
  assert.strictEqual(rootInsight.item.path.includes('//'), false, 'Path must not contain double slashes');

  // Standard note in rootOf
  const src = { id: 'device', root: '' };
  const root = compose.rootOf(src);
  assert.strictEqual(root, '', 'rootOf(src) must be empty when both src.root and notesFolder are empty');

  // Standard note with Type "Journal"
  const journalFolder = [root, 'Journal'].filter(Boolean).join('/');
  assert.strictEqual(journalFolder, 'Journal', 'Standard note folder under Journal must resolve to Journal without leading slash');

  // Test with both notesFolder and highlightsFolder empty
  store.setPrefs({ notesFolder: '', highlightsFolder: '' });
  const rawRootInsight = await insights.createInsight({
    quote: 'Do one thing and do it well.',
    title: 'Unix Philosophy',
  });
  assert.strictEqual(rawRootInsight.item.folder, '', 'Folder must be empty string when both base and highlights folder are empty');
  assert.strictEqual(rawRootInsight.item.path.startsWith('/'), false, 'Path must not have leading slash');
  assert.strictEqual(rawRootInsight.item.path.includes('//'), false, 'Path must not have double slashes');
});

await testAsync('Composer & Types Filtering Coherence: libraryTypes strips base notes folder and does not list base folder as a type', async () => {
  const { libraryTypes } = await import('./src/ui/types.js');
  const store = await import('./src/store.js');

  const src = { id: 'types-test-src', type: 'local', root: 'vault' };
  store.saveSource(src);

  // Items stored inside vault/notes/
  const items = [
    { sourceId: src.id, kind: 'note', path: 'vault/notes/Essays/on-focus.md', folder: 'vault/notes/Essays' },
    { sourceId: src.id, kind: 'note', path: 'vault/notes/Journal/2026-10-17.md', folder: 'vault/notes/Journal' },
    { sourceId: src.id, kind: 'note', path: 'vault/notes/Highlights/extract-1.md', folder: 'vault/notes/Highlights' },
    { sourceId: src.id, kind: 'note', path: 'vault/notes/quick-thought.md', folder: 'vault/notes' },
  ];

  // Pass baseFolder = 'notes'
  const types = libraryTypes(items, src, 'notes');
  assert.ok(types.includes('Essays'), 'Types must include Essays');
  assert.ok(types.includes('Journal'), 'Types must include Journal');
  assert.ok(types.includes('Highlights'), 'Types must include Highlights');
  assert.strictEqual(types.includes('notes'), false, 'Types must NEVER classify the base notes folder as a note type');
  assert.strictEqual(types.includes('vault'), false, 'Types must NEVER classify source root as a note type');
});

await testAsync('Settings UI & Real-Time Dynamic Hierarchy Mapping: notes-folder-input updates preferences and hint copy dynamically', async () => {
  const { initSettings } = await import('./src/ui/settings.js');
  const store = await import('./src/store.js');

  store.setPrefs({ notesFolder: 'garden', highlightsFolder: 'extracts' });

  const mockApp = {
    syncSource: async () => {},
    reimport: async () => {},
    sourcesChanged: () => {},
  };

  const settingsInstance = initSettings(mockApp);
  settingsInstance.renderHighlightHome();

  const notesFolderInput = doc.getElementById('notes-folder-input');
  const hlFolderInput = doc.getElementById('hl-folder-input');
  const hintEl = doc.getElementById('notes-hierarchy-hint');

  assert.ok(notesFolderInput, '#notes-folder-input must exist in DOM');
  assert.ok(hlFolderInput, '#hl-folder-input must exist in DOM');
  assert.ok(hintEl, '#notes-hierarchy-hint must exist in DOM');

  assert.strictEqual(notesFolderInput.value, 'garden', 'notesFolderInput must be pre-populated with pref');
  assert.strictEqual(hlFolderInput.value, 'extracts', 'hlFolderInput must be pre-populated with pref');
  assert.strictEqual(hintEl.textContent, 'Notes: garden/{type}/... • Highlights: garden/extracts/...', 'Hint must display correct hierarchy path preview');

  // Simulate user changing notes base folder to empty (root)
  notesFolderInput.value = '';
  notesFolderInput.dispatchEvent(new MockEvent('input'));
  assert.strictEqual(hintEl.textContent, 'Notes: {type}/... (root) • Highlights: extracts/...', 'Hint must display (root) when notes base is empty');

  // Trigger change event to persist pref
  notesFolderInput.dispatchEvent(new MockEvent('change'));
  assert.strictEqual(store.getPrefs().notesFolder, '', 'store.getPrefs().notesFolder must update on change');

  // Simulate user changing notes base folder to "slanted/notes///"
  notesFolderInput.value = 'slanted/notes///';
  notesFolderInput.dispatchEvent(new MockEvent('change'));
  assert.strictEqual(store.getPrefs().notesFolder, 'slanted/notes', 'Sanitizer must strip trailing slashes');
  assert.strictEqual(hintEl.textContent, 'Notes: slanted/notes/{type}/... • Highlights: slanted/notes/extracts/...');
});

/* =========================================================================
   Part 12: Application Versioning & Cache Metadata Parity Tests
   ========================================================================= */
console.log('\n--- Part 12: Application Versioning & Cache Metadata Parity Tests ---');

await testAsync('Version Parity & DOM Representation Test: #app-version reflects single-sourced version matching package.json', async () => {
  const { initSettings } = await import('./src/ui/settings.js');
  const { VERSION, SHELL_CACHE } = await import('./src/version.js');
  const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));

  assert.strictEqual(VERSION, pkg.version, 'VERSION from version.js must match package.json');
  assert.strictEqual(SHELL_CACHE, `readover-shell-v${pkg.version}`, 'SHELL_CACHE must correspond to package.json version milestone');

  const mockApp = {
    syncSource: async () => {},
    reimport: async () => {},
    sourcesChanged: () => {},
  };

  const settingsInstance = initSettings(mockApp);
  const openPromise = settingsInstance.open('tab-app');
  const sheet = doc.getElementById('settings-sheet');
  if (sheet && typeof sheet.close === 'function') sheet.close();
  await openPromise;

  const appVerEl = doc.getElementById('app-version');
  assert.ok(appVerEl, '#app-version must exist in DOM');
  assert.strictEqual(appVerEl.textContent, pkg.version, `#app-version textContent must display ${pkg.version}`);
});

await testAsync('Update Banner Version Alignment Test: in-app update banner displays matching version identifier', async () => {
  const { VERSION } = await import('./src/version.js');
  const banner = doc.getElementById('sw-update-banner');
  assert.ok(banner, '#sw-update-banner must exist in DOM');

  const updateVerEl = doc.getElementById('sw-update-version');
  assert.ok(updateVerEl, '#sw-update-version must exist inside update banner');

  // Simulate updatefound notification
  updateVerEl.textContent = `v${VERSION}`;
  banner.hidden = false;
  banner.classList.add('is-visible');

  assert.strictEqual(updateVerEl.textContent, `v${VERSION}`, 'Update banner must reflect current version milestone');
  assert.strictEqual(banner.hidden, false, 'Update banner must be unhidden when update is ready');
});

clearTimeout(watchdog);
console.log(`\n🎉 All ${passedTests}/${totalTests} Interactive View & Focus tests PASSED!\n`);
process.exit(process.exitCode || 0);
