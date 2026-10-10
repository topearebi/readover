// Readover — app controller: feed, actions, sync orchestration.
import * as store from './store.js';
import * as library from './library.js';
import * as local from './sources/local.js';
import { buildQueue, foldersFor } from './feed.js';
import { createCard, hydrateCard } from './ui/card.js';
import { openNote } from './ui/reader.js';
import { initSettings } from './ui/settings.js';
import { initCompose } from './ui/compose.js';
import { openSheet, toast, haptic, el, hasOverlay, closeTop } from './ui/overlay.js';
import { VERSION } from './version.js';

const $ = (id) => document.getElementById(id);
const feedEl = $('feed');
const BATCH = 4;
const SYNC_EVERY = 15 * 60 * 1000;

const app = {
  queue: [],
  cursor: 0,
  states: new Map(),
  current: null,
  syncing: new Set(),
};

/* ---------------- Theme ---------------- */

function applyTheme() {
  const { theme } = store.getPrefs();
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  const paper = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim();
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    if (theme === 'system') m.setAttribute('content', m.media.includes('dark') ? '#141816' : '#e8ebe3');
    else m.setAttribute('content', paper);
  });
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

/* ---------------- Scope ---------------- */

function scopeSourceIds() {
  const { scope } = store.getPrefs();
  const all = store.getSources().map((s) => s.id);
  return scope === 'all' || !all.includes(scope) ? all : [scope];
}

function updateScopeLabel() {
  const { scope, folder, filter } = store.getPrefs();
  const src = store.getSource(scope);
  const parts = [];
  const f = { notes: 'Notes', books: 'Books', starred: 'Favourites', hidden: 'Hidden' }[filter];
  if (f) parts.push(f);
  if (folder) parts.push(folder.split('/').pop());
  else if (src) parts.push(library.displayName(src));
  $('scope-label').textContent = parts.join(' in ') || 'Everything';
  $('star-filter').setAttribute('aria-pressed', String(filter === 'starred'));
}

async function openScope() {
  const sheet = $('scope-sheet');
  const prefs = store.getPrefs();
  const sources = store.getSources();
  const srcSel = $('scope-source');
  const folderSel = $('scope-folder');
  srcSel.replaceChildren(
    el('option', { value: 'all' }, 'All libraries'),
    ...sources.map((s) => el('option', { value: s.id }, library.displayName(s)))
  );
  srcSel.value = sources.some((s) => s.id === prefs.scope) ? prefs.scope : 'all';
  const allItems = await store.items.all();
  const fillFolders = (keep) => {
    const ids = srcSel.value === 'all' ? sources.map((s) => s.id) : [srcSel.value];
    const folders = foldersFor(allItems, ids);
    folderSel.replaceChildren(
      el('option', { value: '' }, 'All folders'),
      ...folders.map((f) => el('option', { value: f }, `${' '.repeat(f.split('/').length - 1)}${f.split('/').pop()}`))
    );
    folderSel.value = folders.includes(keep) ? keep : '';
  };
  fillFolders(prefs.folder);
  srcSel.onchange = () => fillFolders('');
  sheet.querySelector(`input[name=filter][value="${prefs.filter}"]`).checked = true;

  const result = await openSheet(sheet);
  if (result !== 'apply') return;
  store.setPrefs({
    scope: srcSel.value,
    folder: folderSel.value,
    filter: sheet.querySelector('input[name=filter]:checked').value,
  });
  reload();
}

/* ---------------- Feed ---------------- */

const hydrateObserver = new IntersectionObserver(
  (entries) => entries.forEach((e) => e.isIntersecting && hydrateCard(e.target)),
  { root: feedEl, rootMargin: '120% 0px' }
);

let dwell = null;
const viewObserver = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      app.current = e.target;
      clearTimeout(dwell);
      const card = e.target;
      if (card._item) {
        dwell = setTimeout(() => {
          store.markSeen(card._item).then((s) => app.states.set(card._item.key, s));
        }, 1500);
      }
      const cards = feedEl.children;
      const idx = Array.prototype.indexOf.call(cards, card);
      if (idx >= cards.length - 3) appendBatch();
    }
  },
  { root: feedEl, threshold: 0.6 }
);

function cardContext() {
  return { states: app.states, mix: store.getPrefs().highlightMix, actions };
}

function appendBatch(n = BATCH) {
  if (app.cursor >= app.queue.length) return;
  const ctx = cardContext();
  const end = Math.min(app.cursor + n, app.queue.length);
  for (; app.cursor < end; app.cursor++) {
    const card = createCard(app.queue[app.cursor], ctx);
    feedEl.append(card);
    hydrateObserver.observe(card);
    viewObserver.observe(card);
  }
  if (app.cursor >= app.queue.length) feedEl.append(endCard());
}

function messageCard(title, text, buttons = []) {
  const card = el(
    'section',
    { class: 'card card-message' },
    el(
      'div',
      { class: 'card-body' },
      el('h2', {}, title),
      text ? el('p', {}, text) : null,
      buttons.length ? el('div', { class: 'row-actions' }, ...buttons) : null
    )
  );
  viewObserver.observe(card);
  return card;
}

function button(label, onclick, primary = false) {
  return el('button', { class: `btn${primary ? ' btn-primary' : ''}`, onclick }, label);
}

function endCard() {
  return messageCard('You have reached the end of this shuffle.', 'Everything in view has come round once. Shuffle again for a new order.', [
    button('Shuffle again', () => reload(), true),
  ]);
}

async function emptyCard() {
  const sources = store.getSources();
  const { filter, folder, scope } = store.getPrefs();
  if (!sources.length) {
    return messageCard(
      'Your notes, one at a time.',
      'Readover turns your Markdown notes, highlights and books into a full-screen feed, in a new order every time you open it. Old notes you had forgotten come back round.',
      [button('Add a GitHub repo', () => settings.open(), true), button('Open a folder', () => addFolder())]
    );
  }
  const inScope = (await store.items.all()).some((i) => scopeSourceIds().includes(i.sourceId));
  if (!inScope) {
    return messageCard('Nothing synced yet.', 'Sync to fetch the list of files from your libraries.', [
      button('Sync now', () => syncAll({ force: true, userGesture: true }), true),
    ]);
  }
  const reset = button('Show everything', () => {
    store.setPrefs({ filter: 'all', folder: '', scope: 'all' });
    reload();
  });
  if (filter === 'starred') return messageCard('No favourites here yet.', 'Tap the star on anything worth coming back to.', [reset]);
  if (filter === 'hidden') return messageCard('Nothing hidden.', 'Items you hide from the feed are listed here so you can bring them back.', [reset]);
  if (folder || scope !== 'all' || filter !== 'all') return messageCard('Nothing matches this view.', 'Try a different folder or type.', [reset]);
  return messageCard('No readable files found.', 'Readover reads .md, .txt, .pdf and .epub files.', [reset]);
}

let generation = 0;
async function reload() {
  const gen = ++generation;
  updateScopeLabel();
  const { folder, filter } = store.getPrefs();
  const { queue, states } = await buildQueue({ sourceIds: scopeSourceIds(), folder, filter });
  if (gen !== generation) return; // a newer reload started meanwhile
  app.queue = queue;
  app.states = states;
  app.cursor = 0;
  clearTimeout(dwell);
  hydrateObserver.disconnect();
  viewObserver.disconnect();
  feedEl.replaceChildren();
  feedEl.scrollTop = 0;
  if (!queue.length) {
    const card = await emptyCard();
    if (gen === generation) feedEl.replaceChildren(card);
  } else appendBatch();
}

/** After a background sync: keep what's on screen, reshuffle what's still to come. */
async function refreshQueue() {
  const shown = new Set([...feedEl.children].map((c) => c.dataset.key).filter(Boolean));
  if (!shown.size) return reload();
  const gen = generation;
  const { folder, filter } = store.getPrefs();
  const { queue, states } = await buildQueue({ sourceIds: scopeSourceIds(), folder, filter });
  if (gen !== generation) return;
  app.states = states;
  app.queue = queue.filter((i) => !shown.has(i.key));
  app.cursor = 0;
  feedEl.querySelectorAll('.card-message').forEach((c) => c.remove());
  appendBatch();
}

function showFirst(item) {
  const card = createCard(item, cardContext());
  const anchor = app.current || feedEl.firstElementChild;
  feedEl.insertBefore(card, anchor);
  if (anchor && !anchor.dataset.key) anchor.remove(); // replace an empty-state card
  hydrateObserver.observe(card);
  viewObserver.observe(card);
  card.scrollIntoView();
}

function scrollBy(dir) {
  const cards = [...feedEl.children];
  const idx = cards.indexOf(app.current);
  const target = cards[Math.max(0, idx + dir)];
  target?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

/* ---------------- Card actions ---------------- */

const actions = {
  async star(card) {
    const item = card._item;
    const on = !app.states.get(item.key)?.starred;
    const st = await library.setFlag(item, 'starred', on);
    app.states.set(item.key, st);
    const btn = card.querySelector('.star-btn');
    btn?.setAttribute('aria-pressed', String(on));
    btn?.classList.remove('pop');
    void btn?.offsetWidth;
    if (on) btn?.classList.add('pop');
    haptic(on ? [8, 30, 8] : 6);
    return on;
  },

  async hide(card) {
    const item = card._item;
    const unhide = store.getPrefs().filter === 'hidden';
    const st = await library.setFlag(item, 'hidden', !unhide);
    app.states.set(item.key, st);
    haptic(10);
    const next = card.nextElementSibling;
    const restore = () => {
      library.setFlag(item, 'hidden', unhide).then((s) => app.states.set(item.key, s));
      feedEl.insertBefore(card, next && next.isConnected ? next : null);
      card.scrollIntoView();
    };
    (next || card.previousElementSibling)?.scrollIntoView();
    setTimeout(() => card.remove(), 350);
    toast(unhide ? 'Back in your feed' : 'Hidden from your feed', { label: 'Undo', run: restore });
  },

  async share(card) {
    const item = card._item;
    const title = card._note?.title || card._bookTitle || item.name;
    let text = title;
    if (card._highlight) text = `“${card._highlight.text.replace(/[>*_=]/g, '').trim()}”\n— ${title}`;
    else if (card._note) text = `${title}\n\n${card._note.body.replace(/[#>*_`=]/g, '').slice(0, 400).trim()}`;
    try {
      if (navigator.share) await navigator.share({ title, text });
      else {
        await navigator.clipboard.writeText(text);
        toast('Copied');
      }
    } catch {}
  },

  async open(card) {
    const item = card._item;
    haptic(6);
    if (item.kind === 'note') {
      try {
        await openNote(item, {
          starred: Boolean(app.states.get(item.key)?.starred),
          highlight: card._highlight,
          onStar: () => actions.star(card),
          onSaved: () => {
            card._hydrated = false;
            card.className = 'card';
            hydrateCard(card);
          },
        });
      } catch (err) {
        toast(err.message);
      }
      return;
    }
    toast('Opening…');
    try {
      const blob = await library.readBlob(item);
      const title = card._bookTitle || item.name;
      if (item.kind === 'pdf') {
        const { openPdf } = await import('./viewers/pdf.js');
        await openPdf(item, blob, title);
      } else {
        const { openEpub } = await import('./viewers/epub.js');
        await openEpub(item, blob, title, { onHighlight: (h) => saveBookHighlight(item, title, h) });
      }
      document.getElementById('toast').classList.remove('show');
    } catch (err) {
      toast(err.message);
    }
  },
};

/** Book highlights become markdown in your library: Highlights/<Book>.md */
async function saveBookHighlight(item, bookTitle, { text, chapter }) {
  const own = store.getSource(item.sourceId);
  const sources = store.getSources();
  const dest =
    (library.canWrite(own) && own) ||
    sources.find((s) => s.type === 'github' && library.canWrite(s)) ||
    sources.find((s) => library.canWrite(s));
  if (!dest) throw new Error('Add a GitHub token or open a folder to keep highlights as notes.');
  const safe = bookTitle.replace(/[\\/:*?"<>|#^[\]]+/g, '').trim().slice(0, 90) || 'Book';
  const path = `Highlights/${safe}.md`;
  const date = new Date().toISOString().slice(0, 10);
  const header = `---\ntitle: ${safe}\nsource: ${item.path}\n---\n\n# ${safe}\n\nHighlights saved from Readover.`;
  const block = `> ${text}\n>\n> — ${chapter ? `${chapter}, ` : ''}${date}`;
  await library.appendToFile(dest, path, header, block, `Readover: highlight from ${safe}`);
  return library.displayName(dest);
}

/* ---------------- Sources & sync ---------------- */

async function syncSource(src, { userGesture = false, quiet = false } = {}) {
  if (app.syncing.has(src.id)) return null;
  app.syncing.add(src.id);
  try {
    if (src.type === 'local' && src.mode === 'handle') {
      const perm = await local.permissionState(src);
      if (perm !== 'granted') {
        if (!userGesture || !(await local.requestPermission(src))) {
          showPermissionBanner();
          return null;
        }
      }
    }
    const result = await library.sync(src, quiet ? () => {} : (m) => toast(m));
    localStorage.setItem(`readover.lastSync.${src.id}`, String(Date.now()));
    if (!quiet) {
      const bits = [`${result.total} items`];
      if (result.added) bits.push(`${result.added} new`);
      if (result.removed) bits.push(`${result.removed} removed`);
      toast(`${library.displayName(src)}: ${bits.join(', ')}`);
    }
    return result;
  } catch (err) {
    if (!quiet || err.code !== 'PERMISSION') toast(err.message);
    return null;
  } finally {
    app.syncing.delete(src.id);
  }
}

async function syncAll({ force = false, userGesture = false } = {}) {
  const due = store
    .getSources()
    .filter((s) => force || Date.now() - Number(localStorage.getItem(`readover.lastSync.${s.id}`) || 0) > SYNC_EVERY);
  if (!due.length) return;
  let changed = false;
  for (const src of due) {
    const r = await syncSource(src, { userGesture, quiet: !force });
    if (r && (r.added || r.removed)) changed = true;
  }
  if (changed || force) await refreshQueue();
  showPermissionBanner();
}

async function showPermissionBanner() {
  const banner = $('banner');
  const blocked = [];
  for (const s of store.getSources()) {
    if (s.type === 'local' && s.mode === 'handle' && (await local.permissionState(s).catch(() => 'missing')) === 'prompt') blocked.push(s);
  }
  if (!blocked.length) {
    banner.hidden = true;
    return;
  }
  const names = blocked.map((s) => `“${s.name}”`).join(', ');
  const allow = button('Allow', async () => {
    for (const s of blocked) await local.requestPermission(s).catch(() => false);
    banner.hidden = true;
    for (const s of blocked) await syncSource(s, { userGesture: true, quiet: true });
    refreshQueue();
  }, true);
  const later = button('Later', () => (banner.hidden = true));
  later.classList.add('btn-quiet');
  banner.replaceChildren(el('p', {}, `Allow Readover to read ${names} again.`), allow, later);
  banner.hidden = false;
}

async function addFolder() {
  if (!local.supportsHandles()) {
    $('folder-input').click();
    return;
  }
  try {
    const handle = await local.pickFolder();
    const src = store.saveSource({ id: store.newId('fs'), type: 'local', mode: 'handle', name: handle.name });
    await local.setHandle(src.id, handle);
    await syncSource(src, { userGesture: true });
    await reloadIfOpen();
  } catch (err) {
    if (err.name !== 'AbortError') toast(err.message);
  }
}

let reimportTarget = null;
async function importFiles(fileList) {
  if (!fileList?.length) return;
  const first = fileList[0].webkitRelativePath?.split('/')[0] || 'Folder';
  const src = reimportTarget || store.saveSource({ id: store.newId('fs'), type: 'local', mode: 'import', name: first });
  reimportTarget = null;
  try {
    const r = await library.importFolder(src, fileList, (m) => toast(m));
    localStorage.setItem(`readover.lastSync.${src.id}`, String(Date.now()));
    toast(`${src.name}: ${r.total} items imported`);
    await reloadIfOpen();
  } catch (err) {
    toast(err.message);
  } finally {
    $('folder-input').value = '';
  }
}

function reimport(src) {
  reimportTarget = src;
  $('folder-input').click();
}

async function reloadIfOpen() {
  if (feedEl.querySelector('.card-message') || !feedEl.children.length) await reload();
  else await refreshQueue();
}

/* ---------------- Input ---------------- */

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  if (e.key === 'Escape') {
    // <dialog> sheets handle Escape themselves (their 'cancel' event).
    if (hasOverlay() && !document.querySelector('dialog[open]')) closeTop();
    return;
  }
  if (hasOverlay()) return;
  const card = app.current;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const run = {
    ArrowDown: () => scrollBy(1),
    j: () => scrollBy(1),
    ArrowUp: () => scrollBy(-1),
    k: () => scrollBy(-1),
    Enter: () => card?._item && actions.open(card),
    o: () => card?._item && actions.open(card),
    s: () => card?._item && actions.star(card),
    x: () => card?._item && actions.hide(card),
    r: () => reload(),
    n: () => compose.open(),
  }[key];
  if (run) {
    e.preventDefault();
    run();
  }
});

// Gamepads (handy on handheld PCs / TVs). Polling only runs while one is connected.
let padLoop = null;
window.addEventListener('gamepadconnected', () => {
  if (padLoop) return;
  let last = {};
  const tick = () => {
    const gp = [...(navigator.getGamepads?.() || [])].find(Boolean);
    if (!gp) {
      padLoop = null;
      return;
    }
    const b = (i) => Boolean(gp.buttons[i]?.pressed);
    const now = { down: b(13) || gp.axes[1] > 0.6, up: b(12) || gp.axes[1] < -0.6, a: b(0), b: b(1), y: b(3) };
    const pressed = (k) => now[k] && !last[k];
    if (hasOverlay()) {
      if (pressed('b')) closeTop();
    } else {
      if (pressed('down')) scrollBy(1);
      if (pressed('up')) scrollBy(-1);
      if (pressed('a') && app.current?._item) actions.open(app.current);
      if (pressed('y') && app.current?._item) actions.star(app.current);
    }
    last = now;
    padLoop = requestAnimationFrame(tick);
  };
  padLoop = requestAnimationFrame(tick);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') library.flushPending();
  else syncAll();
});

/* ---------------- Boot ---------------- */

const settings = initSettings({
  syncSource: async (src, opts) => {
    const r = await syncSource(src, opts);
    await reloadIfOpen();
    return r;
  },
  addFolder,
  importFiles,
  reimport,
  sourcesChanged: () => reload(),
  applyTheme,
});
const compose = initCompose({ showFirst });

$('brand').onclick = () => {
  reload();
  feedEl.focus({ preventScroll: true });
};
$('scope-btn').onclick = openScope;
$('settings-btn').onclick = () => settings.open();
$('star-filter').onclick = () => {
  const { filter } = store.getPrefs();
  store.setPrefs({ filter: filter === 'starred' ? 'all' : 'starred' });
  reload();
};
$('app-version').textContent = VERSION === 'dev' ? '(development)' : VERSION.slice(0, 7);

async function boot() {
  applyTheme();
  await store.migrateLegacy();
  await reload();
  const hasItems = (await store.items.all()).length > 0;
  await syncAll({ force: !hasItems && store.getSources().length > 0 });
  showPermissionBanner();
  navigator.storage?.persist?.().catch(() => {});
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadController = Boolean(navigator.serviceWorker.controller); // false on first install
  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        sw?.addEventListener('statechange', () => {
          if (sw.state === 'activated' && hadController) {
            toast('Readover has been updated', { label: 'Reload', run: () => location.reload() });
          }
        });
      });
    })
    .catch((err) => console.warn('Service worker not registered', err));
}

boot();
