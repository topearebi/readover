// Readover — app controller: feed, actions, sync orchestration.
import * as store from './store.js';
import * as library from './library.js';
import * as local from './sources/local.js';
import { buildQueue, foldersFor } from './feed.js';
import { createCard, hydrateCard, createConnectionCard, createHubCard } from './ui/card.js';
import { openNote, addToSection, pickNote } from './ui/reader.js';
import { growthOf, isArchived, garden } from './garden.js';
import { GROWTH_FILTERS, counts as filterCounts, filterLabel, passes, typeList } from './filters.js';
import { renderTypeChecks, readTypeChecks } from './ui/types.js';
import { openGrowthSheet } from './ui/growth.js';
import { isoDay, updateFrontmatter, parseFrontmatter } from './notefile.js';
import { entries as noteEntries } from './notes-index.js';
import { sheet as buildSheet, menu } from './ui/sheet.js';
import { initSettings } from './ui/settings.js';
import { initCompose } from './ui/compose.js';
import { openSheet, toast, haptic, el, hasOverlay, closeTop } from './ui/overlay.js';
import { VERSION } from './version.js';
import * as dataSync from './sync.js';
import * as outbox from './outbox.js';
import { initStatus } from './ui/status.js';
import { initSetup, shouldNudge, snoozeNudge } from './ui/setup.js';
import { initShelf } from './ui/shelf.js';
import { initNotes } from './ui/notes.js';
import * as learn from './learn.js';
import * as insights from './insights.js';
import { askNote } from './ui/highlight-note.js';
import { wikiLink } from './notefile.js';
import { openCapture } from './ui/capture.js';
import { clipFromLocation } from './clip.js';
import * as clock from './clock.js';
import { linkedPairs, hubNotes } from './notes-index.js';


const $ = (id) => document.getElementById(id);
const feedEl = $('feed');
const BATCH = 4;
const SYNC_EVERY = 15 * 60 * 1000;

const app = {
  view: 'feed',
  queue: [],
  cursor: 0,
  states: new Map(),
  reasons: new Map(),
  current: null,
  syncing: new Set(),
};

let actions, settings, compose, setup, captureApp;

/* ---------------- Theme ---------------- */

function applyTheme() {
  const { theme } = store.getPrefs();
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  const paper = (typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement)?.getPropertyValue('--paper')?.trim() : '') || '#e8ebe3';
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    const media = m.getAttribute?.('media') || m.media || '';
    if (theme === 'system') m.setAttribute('content', media.includes('dark') ? '#141816' : '#e8ebe3');
    else m.setAttribute('content', paper || '#e8ebe3');
  });
}
window.matchMedia?.('(prefers-color-scheme: dark)')?.addEventListener?.('change', applyTheme);

/* ---------------- Scope ---------------- */

function scopeSourceIds() {
  const { scope } = store.getPrefs();
  const all = store.getSources().map((s) => s.id);
  return scope === 'all' || !all.includes(scope) ? all : [scope];
}

function updateScopeLabel() {
  const { scope, folder, filter, feedGrowth, feedTypes } = store.getPrefs();
  const src = store.getSource(scope);
  const parts = [];
  const f = filterLabel(feedGrowth, typeList(feedTypes)) || { notes: 'Notes', books: 'Books', starred: 'Favourites', hidden: 'Hidden' }[filter];
  if (f) parts.push(f);
  if (folder) parts.push(folder.split('/').pop());
  else if (src) parts.push(library.displayName(src));
  $('scope-label').textContent = parts.join(' in ') || 'Everything';
  $('scope-btn').setAttribute('aria-label', `What to show: ${$('scope-label').textContent}`);
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
  const filterInput = sheet.querySelector(`input[name=filter][value="${prefs.filter}"]`);
  if (filterInput) filterInput.checked = true;

  // Growth and type, each option with how many notes it would show here.
  const growthSel = $('scope-growth');
  const typeBox = $('scope-types');
  let chosenTypes = typeList(prefs.feedTypes);
  const map = await garden().catch(() => new Map());
  const byKey = new Map(allItems.map((i) => [i.key, i]));
  const fillFilters = (g = growthSel.value || prefs.feedGrowth || 'any') => {
    const ids = new Set(srcSel.value === 'all' ? sources.map((s) => s.id) : [srcSel.value]);
    const folder = folderSel.value;
    const here = [...map].filter(([k]) => {
      const it = byKey.get(k);
      return it && ids.has(it.sourceId) && (!folder || it.folder === folder || it.folder.startsWith(`${folder}/`));
    }).map(([, v]) => v);
    const c = filterCounts(here, g, chosenTypes);
    growthSel.replaceChildren(...GROWTH_FILTERS.map((f) => el('option', { value: f.id }, f.id === 'any' ? 'Any' : `${f.label} (${c.growth[f.id]})`)));
    growthSel.value = GROWTH_FILTERS.some((f) => f.id === g) ? g : g === 'resting' ? 'done' : 'any';
    renderTypeChecks(typeBox, c.types, chosenTypes, () => {
      chosenTypes = readTypeChecks(typeBox);
      fillFilters();
    });
  };
  fillFilters(prefs.feedGrowth || 'any');
  srcSel.onchange = () => {
    fillFolders('');
    fillFilters();
  };
  folderSel.onchange = () => fillFilters();
  growthSel.onchange = () => fillFilters();

  const result = await openSheet(sheet);
  if (result !== 'apply') return;
  store.setPrefs({
    scope: srcSel.value,
    folder: folderSel.value,
    filter: sheet.querySelector('input[name=filter]:checked').value,
    feedGrowth: growthSel.value,
    feedTypes: readTypeChecks(typeBox),
  });
  reload();
}

/* ---------------- Feed ---------------- */

const hydrateObserver = new IntersectionObserver(
  (entries) => entries.forEach((e) => e.isIntersecting && hydrateCard(e.target)),
  { root: feedEl, rootMargin: '120% 0px' }
);

let dwell = null;
// What you do with each card teaches the feed (learn.js) and moves review schedules on.
let viewing = { card: null, since: 0 };
function leaveCard(card) {
  const ms = Date.now() - viewing.since;
  if (!card?._item || !card._hydrated || card.classList.contains('card-error')) return;
  if (ms < 1200) learn.signal(card._item, 'skip');
  else if (ms > 8000) learn.signal(card._item, 'dwell');
}

const viewObserver = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const card = e.target;
      if (viewing.card !== card) {
        leaveCard(viewing.card);
        viewing = { card, since: Date.now() };
      }
      app.current = card;
      clearTimeout(dwell);
      if (card._item) {
        dwell = setTimeout(() => {
          store.markSeen(card._item).then((s) => app.states.set(card._item.key, s));
          countToday();
          maybeSuggestBreak(card);
        }, 1500);
      }
      const cards = feedEl.children;
      const idx = Array.prototype.indexOf.call(cards, card);
      if (idx >= cards.length - 3) appendBatch();
    }
  },
  { root: feedEl, threshold: 0.6 }
);

/* ---------------- Healthy limits ---------------- */

const todayKey = () => new Date().toISOString().slice(0, 10);
function countToday() {
  app.sessionSeen = (app.sessionSeen || 0) + 1;
  const t = store.readJSON('readover.today', {});
  store.writeJSON('readover.today', { day: todayKey(), n: t.day === todayKey() ? (t.n || 0) + 1 : 1 });
}
const seenToday = () => {
  const t = store.readJSON('readover.today', {});
  return t.day === todayKey() ? t.n || 0 : 0;
};

/** Optional (Settings → Reading): after N cards, a gentle card suggesting a break. */
function maybeSuggestBreak(card) {
  const limit = Number(store.getPrefs().breakAfter || 0);
  if (!limit || app.breakShown || app.sessionSeen < limit) return;
  app.breakShown = true;
  const brk = messageCard(
    `That's ${app.sessionSeen} cards.`,
    'A good place to stop? Whatever you read today will come round again.',
    [
      button('Keep going', () => {
        const next = brk.nextElementSibling;
        next?.scrollIntoView({ behavior: 'smooth' });
        setTimeout(() => brk.remove(), 400);
      }, true),
    ]
  );
  brk.classList.add('card-break');
  card.after(brk);
}

function cardContext() {
  return { states: app.states, reasons: app.reasons, forced: app.forced, growth: app.growth, mix: store.getPrefs().highlightMix, actions };
}

const CONNECTION_EVERY = 9;
function appendBatch(n = BATCH) {
  if (app.cursor >= app.queue.length) return;
  const ctx = cardContext();
  const end = Math.min(app.cursor + n, app.queue.length);
  for (; app.cursor < end; app.cursor++) {
    const card = createCard(app.queue[app.cursor], ctx);
    feedEl.append(card);
    hydrateObserver.observe(card);
    viewObserver.observe(card);
    // Now and then, two connected notes or a garden hub card.
    if (app.cursor > 0 && app.cursor % CONNECTION_EVERY === CONNECTION_EVERY - 1) {
      if (app.hubs?.length && (Math.random() < 0.5 || !app.pairs?.length)) {
        const hub = createHubCard(app.hubs.pop(), { openItem: (item) => openNoteItem(item) });
        feedEl.append(hub);
        viewObserver.observe(hub);
      } else if (app.pairs?.length) {
        const conn = createConnectionCard(app.pairs.pop(), { openItem: (item) => openNoteItem(item) });
        feedEl.append(conn);
        viewObserver.observe(conn);
      }
    }
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
  const n = seenToday();
  const today = n > 1 ? ` You've revisited ${n} today.` : '';
  return messageCard('You have reached the end of this shuffle.', `Everything in view has come round once.${today} Shuffle again for a new order, or write down something new.`, [
    button('Shuffle again', () => reload(), true),
    button('Write a note', () => compose.open()),
  ]);
}

/** Shown once the on-device notebook starts to matter. */
function nudgeCard() {
  const card = messageCard(
    'These notes only live in this browser.',
    "If this browser's data is ever cleared, they're gone. A private GitHub repository holds them for free, and they'll follow you to any device.",
    [
      button('Keep them safe', () => setup.open(), true),
      button('Not now', () => {
        snoozeNudge();
        const next = card.nextElementSibling;
        next?.scrollIntoView();
        setTimeout(() => card.remove(), 300);
      }),
    ]
  );
  card.classList.add('card-nudge');
  return card;
}

async function emptyCard() {
  const sources = store.getSources().filter((s) => s.type !== 'device');
  const { filter, folder, scope, feedGrowth, feedTypes } = store.getPrefs();
  const deviceNotes = library.deviceSource() ? (await store.items.byIndex('sourceId', library.DEVICE_ID)).length : 0;
  if (!sources.length && !deviceNotes) {
    return messageCard(
      'Your notes, one at a time.',
      "Write down something you want to remember. Readover keeps bringing it back, and shows each note growing as you add thoughts and graft it to others. Already keep notes in GitHub or a folder? Connect them instead.",
      [
        button('Write your first note', () => compose.open(), true),
        button('Connect GitHub', () => settings.open()),
        button('Open a folder', () => addFolder()),
      ]
    );
  }
  const inScope = (await store.items.all()).some((i) => scopeSourceIds().includes(i.sourceId));
  if (!inScope) {
    return messageCard('Nothing synced yet.', 'Sync to fetch the list of files from your libraries.', [
      button('Sync now', () => syncAll({ force: true, userGesture: true }), true),
    ]);
  }
  const reset = button('Show everything', () => {
    store.setPrefs({ filter: 'all', folder: '', scope: 'all', feedGrowth: 'any', feedTypes: [] });
    reload();
  });
  if (filter === 'starred') return messageCard('No favourites here yet.', 'Tap the star on anything worth coming back to.', [reset]);
  if (filter === 'hidden') return messageCard('Nothing hidden.', 'Items you hide from the feed are listed here so you can bring them back.', [reset]);
  const label = filterLabel(feedGrowth, typeList(feedTypes));
  if (label) return messageCard(`Nothing here: ${label}.`, feedGrowth === 'wilting' || feedGrowth === 'water' ? 'Everything in view is watered. Nice.' : 'No notes match these filters right now.', [reset]);
  if (folder || scope !== 'all' || filter !== 'all') return messageCard('Nothing matches this view.', 'Try a different folder or type.', [reset]);
  return messageCard('No readable files found.', 'Readover reads .md, .txt, .pdf and .epub files.', [reset]);
}

let generation = 0;
async function reload() {
  const gen = ++generation;
  updateScopeLabel();
  const { folder, filter, feedGrowth, feedTypes } = store.getPrefs();
  const [{ queue, states, reasons, forced, growth }, pairs, hubs] = await Promise.all([
    buildQueue({ sourceIds: scopeSourceIds(), folder, filter, growth: feedGrowth, types: typeList(feedTypes) }),
    linkedPairs().catch(() => []),
    hubNotes().catch(() => []),
  ]);
  if (gen !== generation) return; // a newer reload started meanwhile
  app.queue = queue;
  app.states = states;
  app.reasons = reasons;
  app.forced = forced;
  app.growth = growth;
  const scope = new Set(scopeSourceIds());
  app.pairs = pairs
    .filter((p) => scope.has(p.a.item.sourceId) && !states.get(p.a.item.key)?.hidden && !states.get(p.b.item.key)?.hidden)
    .sort(() => Math.random() - 0.5);
  app.hubs = (hubs || [])
    .filter((h) => scope.has(h.item.sourceId) && !states.get(h.item.key)?.hidden)
    .sort(() => Math.random() - 0.5);
  try {
    navigator.clearAppBadge?.(); // badges were for notes "due"; nothing is due any more
  } catch {}
  app.cursor = 0;
  clearTimeout(dwell);
  hydrateObserver.disconnect();
  viewObserver.disconnect();
  feedEl.replaceChildren();
  feedEl.scrollTop = 0;
  if (!queue.length) {
    const card = await emptyCard();
    if (gen === generation) feedEl.replaceChildren(card);
  } else {
    appendBatch();
    if (await shouldNudge()) {
      const anchor = feedEl.children[2] || null; // after a couple of cards, not in the way
      feedEl.insertBefore(nudgeCard(), anchor);
    }
  }
}

/** After a background sync: keep what's on screen, reshuffle what's still to come. */
async function refreshQueue() {
  const shown = new Set([...feedEl.children].map((c) => c.dataset.key).filter(Boolean));
  if (!shown.size) return reload();
  const gen = generation;
  const { folder, filter } = store.getPrefs();
  const { queue, states, reasons, forced } = await buildQueue({ sourceIds: scopeSourceIds(), folder, filter });
  if (gen !== generation) return;
  app.states = states;
  app.reasons = reasons;
  app.forced = forced;
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

/* ---------------- The garden: Water, Graft, Prune, Replant ---------------- */

const basename = (path) => path.split('/').pop();
/** The note as it is now (an earlier action may have saved a newer version). */
const latest = async (item) => (await store.items.get(item.key)) || item;
async function freePath(src, folder, name) {
  const dir = String(folder || '').replace(/^\/+|\/+$/g, '');
  const at = (n) => (dir ? `${dir}/${n}` : n);
  let path = at(name);
  for (let i = 2; await store.items.get(store.keyOf(src.id, path)); i++) path = at(name.replace(/(\.[^.]+)$/, `-${i}$1`));
  return path;
}

/** Water: a dated thought under ## Thoughts. */
async function waterItem(item, thought) {
  item = await latest(item);
  const lines = String(thought).trim().split('\n');
  const block = `- ${isoDay()}: ${lines[0]}${lines.slice(1).map((l) => `\n  ${l}`).join('')}`;
  const text = await library.readText(item);
  return library.writeNote(store.getSource(item.sourceId), item.path, addToSection(text, 'Thoughts', block), { message: `Readover: water ${item.path}` });
}

/** Graft: link to another note, under ## Related (reciprocal by default). */
async function graftItem(item) {
  item = await latest(item);
  const picked = await pickNote('Graft onto…', item);
  if (!picked) return null;
  const entries = await noteEntries();
  const ePicked = entries.find((x) => x.item.key === picked.key);
  const eItem = entries.find((x) => x.item.key === item.key);
  const { wikiLink } = await import('./notefile.js');
  const text = await library.readText(item);
  const linkToPicked = wikiLink(picked.path, ePicked?.title);
  const linkToItem = wikiLink(item.path, eItem?.title);

  const updated = await library.writeNote(store.getSource(item.sourceId), item.path, addToSection(text, 'Related', `- ${linkToPicked}`), {
    message: `Readover: graft ${item.path} onto ${picked.path}`,
  });

  try {
    const pickedSrc = store.getSource(picked.sourceId);
    if (library.canWrite(pickedSrc)) {
      const pickedText = await library.readText(picked);
      await library.writeNote(pickedSrc, picked.path, addToSection(pickedText, 'Related', `- ${linkToItem}`), {
        message: `Readover: reciprocal graft from ${item.path}`,
      });
    }
  } catch (err) {
    console.warn('Could not write reciprocal graft', err);
  }

  return updated;
}

/** Prune: into Archive/ (in the same library), with pruned: and pruned_from: — one commit. */
async function pruneItem(item, title) {
  const { value } = await buildSheet({
    title: `Prune “${title}”?`,
    fields: [el('p', { class: 'hint' }, 'It moves to Archive and leaves the feed. Its grafts stop counting. You can replant it any time.')],
    submit: 'Prune',
    danger: true,
  });
  if (value !== 'ok') return null;
  item = await latest(item);
  const src = store.getSource(item.sourceId);
  const root = (src.root || '').replace(/^\/+|\/+$/g, '');
  const to = await freePath(src, root ? `${root}/Archive` : 'Archive', basename(item.path));
  const moved = await library.moveNote(item, to, {
    frontmatter: { pruned: isoDay(), pruned_from: item.folder || '/' },
    message: `Readover: prune ${item.path}`,
  });
  toast('Pruned: moved to Archive', { label: 'Undo', run: () => replantItem(moved) });
  return moved;
}

/** Replant: back to where it was pruned from. */
async function replantItem(item) {
  item = await latest(item);
  const src = store.getSource(item.sourceId);
  const { meta } = parseFrontmatter(await library.readText(item));
  const from = String(meta.pruned_from || '');
  // Where it came from; if that isn't recorded, the top level of the library (Unsorted).
  const folder = from && from !== '/' ? from.replace(/^\/+|\/+$/g, '') : (src.root || '').replace(/^\/+|\/+$/g, '');
  const to = await freePath(src, folder, basename(item.path));
  const moved = await library.moveNote(item, to, { frontmatter: { pruned: null, pruned_from: null }, message: `Readover: replant ${item.path}` });
  toast(`Replanted in ${folder || 'the top level'}`);
  reload();
  return moved;
}

/** Change frontmatter keys of a note (status, canonical_url). */
async function setMeta(item, patch, message) {
  item = await latest(item);
  const text = await library.readText(item);
  return library.writeNote(store.getSource(item.sourceId), item.path, updateFrontmatter(text, patch), { message });
}

/** Re-draw a card after its note changed. */
function refreshCard(card, item) {
  card._item = { ...card._item, ...item };
  card.dataset.key = card._item.key;
  card._ctx = { ...card._ctx, growth: null };
  card._hydrated = false;
  card.className = 'card';
  hydrateCard(card);
}

actions = {
  /** 1-tap direct edit for notes from feed card rail. */
  async editNote(card) {
    if (!card._item || card._item.kind !== 'note') return;
    return compose.open({
      existingItem: card._item,
      onSaved: (item) => {
        refreshCard(card, item);
      },
    });
  },

  /** More actions menu for notes from feed card rail. */
  async cardMenu(card) {
    const item = card._item;
    if (!item || item.kind !== 'note') return;
    const src = store.getSource(item.sourceId);
    const writable = library.canWrite(src);
    const archived = isArchived(item.path);
    const rawText = (await store.content.get(item.key))?.text || '';
    const isInsight = Boolean(card._highlight) || insights.isInsightOrHighlight(item, card._note, rawText);
    const title = card._note?.title || item.title || item.path?.split('/').pop()?.replace(/\.md$/i, '') || 'Note';

    const menuActions = [];
    if (writable && !card._note?.imported) {
      menuActions.push({ id: 'edit', label: 'Edit note', icon: 'pen' });
      menuActions.push({ id: 'link', label: 'Graft: link to another note', icon: 'graft' });
    }
    if (writable) {
      menuActions.push({ id: 'move', label: 'Rename or move', icon: 'feed' });
    }
    if (writable && !archived) {
      menuActions.push({ id: 'prune', label: 'Prune: move to Archive', icon: 'hide' });
    } else if (writable && archived) {
      menuActions.push({ id: 'replant', label: 'Replant', icon: 'feed' });
    }
    menuActions.push({ id: 'share', label: 'Share', icon: 'share' });
    if (writable) {
      menuActions.push({ id: 'delete', label: 'Delete note', icon: 'close', danger: true });
    }

    const choice = await menu(title, menuActions);
    if (!choice) return;

    if (choice === 'edit') {
      return actions.editNote(card);
    }
    if (choice === 'move') {
      return openNoteItem(item, { card, startMove: true });
    }
    if (choice === 'link') {
      try {
        const updated = await graftItem(item);
        if (updated) {
          toast('Grafted');
          refreshCard(card, updated);
        }
      } catch (err) {
        toast(err.message);
      }
      return;
    }
    if (choice === 'prune') {
      try {
        if (await pruneItem(item, title)) {
          card.remove();
        }
      } catch (err) {
        toast(err.message);
      }
      return;
    }
    if (choice === 'replant') {
      try {
        await replantItem(item);
      } catch (err) {
        toast(err.message);
      }
      return;
    }
    if (choice === 'share') {
      return actions.share(card);
    }
    if (choice === 'delete') {
      const where = src.type === 'github' ? `It's removed from ${src.owner}/${src.repo}, and you can still restore it from the repository's history on GitHub.` : src.type === 'device' ? "It's removed from this device for good." : "It's removed from the folder on this device.";
      const { value } = await buildSheet({ title: `Delete “${title}”?`, fields: [el('p', { class: 'hint' }, where)], submit: 'Delete note', danger: true });
      if (value !== 'ok') return;
      try {
        await library.deleteNote(item);
        card.remove();
        toast('Deleted');
      } catch (err) {
        toast(err.message);
      }
      return;
    }
  },

  /** Water from the card's own field. Resolves true when saved. */
  async waterNote(card, thought) {
    try {
      const item = await waterItem(card._item, thought);
      learn.signal(card._item, 'open');
      toast('Watered');
      setTimeout(() => refreshCard(card, item), 900);
      return true;
    } catch (err) {
      toast(err.message);
      return false;
    }
  },

  /** Water / Add a thought to the note via a quick single-input sheet */
  async addThought(card) {
    const item = card._item;
    if (!item || item.kind !== 'note') return;
    const title = card._note?.title || item.title || item.name || 'Note';
    const input = el('textarea', {
      rows: '4',
      name: 'thought',
      placeholder: 'What do you make of it now? Has anything changed?',
      required: true,
      style: 'width:100%; box-sizing:border-box; min-height:90px; resize:vertical; padding:10px 12px; font-family:inherit; font-size:0.95rem;',
    });
    const { value } = await buildSheet({
      title: 'Water: add a thought',
      fields: [
        el('p', { class: 'hint' }, `Added under Thoughts in “${title}” with today's date.`),
        el('label', { class: 'field' }, 'Your thought', input),
      ],
      submit: 'Save thought',
      onOpen: () => setTimeout(() => input.focus(), 50),
    });
    if (value !== 'ok' || !input.value.trim()) return;
    return actions.waterNote(card, input.value.trim());
  },

  /** The growth tag: where the note stands, and Water / Graft / Prune. */
  async growth(card) {
    const item = card._item;
    const g = (await growthOf(item)) || card._growth;
    if (!g) return;
    const title = card._note?.title || item.name;
    const run = (fn) => async (...a) => {
      try {
        return await fn(...a);
      } catch (err) {
        toast(err.message);
      }
    };
    const rawText = (await store.content.get(item.key))?.text || '';
    await openGrowthSheet(title, g, {
      water: async () => actions.addThought(card),
      graft: run(async () => {
        const updated = await graftItem(item);
        if (updated) {
          toast('Grafted');
          refreshCard(card, updated);
        }
      }),
      prune: run(async () => {
        if (await pruneItem(item, title)) card.remove();
      }),
      replant: run(() => replantItem(item)),
      status: run(async (v) => {
        refreshCard(card, await setMeta(item, { status: v || null }, `Readover: mark ${item.path} ${v ? 'done' : 'in progress'}`));
        toast(v ? 'Marked done: it rests now' : 'Back in progress');
      }),
      canonical: run(async (url) => {
        refreshCard(card, await setMeta(item, { canonical_url: url || null }, `Readover: published link for ${item.path}`));
        toast(url ? 'Published link saved' : 'Published link removed');
      }),
    });
  },

  async star(card) {
    const item = card._item;
    const on = !app.states.get(item.key)?.starred;
    const st = await library.setFlag(item, 'starred', on);
    app.states.set(item.key, st);
    learn.signal(item, on ? 'star' : 'unstar');
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
    if (!unhide) learn.signal(item, 'hide');
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
    const title = card._note?.title || card._bookTitle || item?.title || item?.name || 'Note';
    let text = title;
    if (card._highlight) {
      text = `“${card._highlight.text.replace(/[>*_=]/g, '').trim()}”\n— ${title}`;
    } else if (item && item.kind === 'note') {
      try {
        const full = await library.readText(item);
        text = `${title}\n\n${full || card._note?.body || ''}`.trim();
      } catch {
        text = `${title}\n\n${card._note?.body || ''}`.trim();
      }
    } else if (card._note) {
      text = `${title}\n\n${card._note.body || ''}`.trim();
    }
    try {
      if (navigator.share) await navigator.share({ title, text });
      else {
        await navigator.clipboard.writeText(text);
        toast('Copied');
      }
    } catch {}
  },

  /** A seed from an export: write a thought and it becomes an insight. */
  async water(card) {
    const h = card._highlight;
    if (!h) return;
    const asked = await askNote(h.text.replace(/^…|…$/g, ''), { heading: 'Water this seed' });
    if (!asked) return;
    try {
      await insightFromNote(card._item, card._note, { text: h.text.replace(/^…|…$/g, ''), thought: asked.thought, title: asked.title, tags: asked.tags, h });
      learn.signal(card._item, 'open');
      card.querySelector('.seed-actions')?.replaceChildren(el('span', { class: 'seed-done' }, 'Saved as an insight'));
    } catch (err) {
      toast(err.message);
    }
  },

  async open(card, extra) {
    const item = card._item;
    haptic(6);
    learn.signal(item, 'open');
    if (item.kind === 'note') return openNoteItem(item, { card, highlight: card._highlight, section: extra?.section });
    await openBookItem(item, card._bookTitle);
  },

  /** A highlight card saved from a book: open the book at that passage with pre-flight check. */
  async openAt(card, at) {
    haptic(6);
    const item = await resolveBookRef(at.book);
    if (!item) {
      promptMissingBook(at.book, { card, at });
      return;
    }
    await openBookItem(item, null, at.at, { card, at });
  },
};

/** Open a note in the reader, from anywhere (feed card, Notes, a link in another note). */
async function openNoteItem(item, { card = null, highlight = null, section = '', startInEditor = false, startMove = false, stagingBanner = null } = {}) {
  try {
    await openNote(item, {
      stagingBanner,
      starred: Boolean((await store.state.get(item.key))?.starred),
      highlight,
      section,
      startInEditor,
      startMove,
      editNote: (noteItem, editOpts = {}) => {
        return compose.open({
          existingItem: noteItem,
          onSaved: async (savedItem, updatedText) => {
            if (card) {
              card._item = { ...card._item, ...savedItem };
              card.dataset.key = savedItem.key;
              card._hydrated = false;
              card.className = 'card';
              hydrateCard(card);
            }
            await editOpts.onSaved?.(savedItem, updatedText);
          },
        });
      },
      onStar: async (on) => {
        if (card) return actions.star(card);
        const st = await library.setFlag(item, 'starred', on);
        app.states.set(item.key, st);
      },
      onSaved: () => {
        if (!card) return;
        card._item = { ...card._item, ...item };
        card.dataset.key = item.key;
        card._hydrated = false;
        card.className = 'card';
        hydrateCard(card);
      },
      openItem: (other) => openNoteItem(other),
      openBookRef: async (bookRef, at) => {
        const bookItem = await resolveBookRef(bookRef);
        if (!bookItem) {
          promptMissingBook(bookRef, { at });
          return;
        }
        await openBookItem(bookItem, null, at, { at });
      },
      createNote: (title) => compose.open({ sourceId: item.sourceId, folder: item.folder, title }),
      makeInsight: (note, sel) => insightFromNote(item, note, sel),
      prune: (title) => pruneItem(item, title),
      replant: () => replantItem(item),
    });
  } catch (err) {
    toast(err.message);
  }
}


/** Search notes from anywhere in the app (feed header, keyboard shortcut /). */
async function searchNotesDialog() {
  const { search } = await import('./notes-index.js');
  const input = el('input', {
    type: 'search',
    class: 'feed-search-input',
    placeholder: 'Search notes, titles and text…',
    autocomplete: 'off',
    'aria-label': 'Search notes',
  });
  const resultsEl = el('div', { class: 'feed-search-results' });
  const statusEl = el('p', { class: 'hint feed-search-status' }, 'Type to search all your notes');
  let timer;
  let close = () => {};

  const runSearch = async () => {
    const q = input.value.trim();
    if (!q) {
      statusEl.textContent = 'Type to search all your notes';
      statusEl.hidden = false;
      resultsEl.replaceChildren();
      return;
    }
    statusEl.textContent = 'Searching…';
    statusEl.hidden = false;
    const found = await search(q, { limit: 40 });
    if (!found.length) {
      statusEl.textContent = `No notes match “${q}”`;
      resultsEl.replaceChildren();
      return;
    }
    statusEl.hidden = true;
    const rows = found.map((r) => {
      const src = store.getSource(r.item.sourceId);
      const where = [src?.name, r.item.folder].filter(Boolean).join(' / ');
      const b = el(
        'button',
        { type: 'button', class: 'feed-search-item' },
        el('b', {}, r.title),
        r.snippet ? el('span', { class: 'feed-search-snippet' }, r.snippet) : null,
        where ? el('small', {}, where) : null
      );
      b.onclick = () => {
        close();
        openNoteItem(r.item);
      };
      return b;
    });
    resultsEl.replaceChildren(...rows);
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(runSearch, 150);
  });

  await buildSheet({
    title: 'Search notes',
    fields: [input, statusEl, resultsEl],
    tall: true,
    onOpen: (form, dialog) => {
      close = () => dialog.close();
      setTimeout(() => input.focus(), 60);
    },
  });
}

/** "gh:owner/repo|path" (as stored in highlight anchors) → this device's item. */
async function resolveBookRef(ref) {
  if (!ref) return null;
  const i = ref.indexOf('|');
  if (i > 0) {
    const src = store.getSources().find((s) => store.sourceKey(s) === ref.slice(0, i));
    if (src) {
      const it = await store.items.get(store.keyOf(src.id, ref.slice(i + 1)));
      if (it) return it;
    }
  }
  // Check by file path or name across all local sources
  const targetPath = i > 0 ? ref.slice(i + 1) : ref;
  const allItems = await store.items.all();
  return (
    allItems.find(
      (it) =>
        it.kind !== 'note' &&
        (it.path === targetPath || it.path.endsWith(`/${targetPath}`) || it.name === targetPath)
    ) || null
  );
}

/** Pre-flight missing book prompt */
async function promptMissingBook(bookRef, { card = null, at = null, item = null } = {}) {
  const { sheet } = await import('./ui/sheet.js');
  const bookName = (item?.name || String(bookRef || '').split('|').pop().split('/').pop() || 'Source book').replace(/\.[^.]+$/, '');

  const msg = el(
    'div',
    { class: 'missing-book-prompt' },
    el('p', { class: 'hint' }, `“${bookName}” is not currently stored or downloaded on this device.`),
    el('p', { class: 'hint', style: 'margin-top:8px;' }, 'Connect your cloud storage vault in Settings to sync it, or add the book file directly.')
  );

  const actionsRow = el('div', { class: 'row-actions', style: 'margin-top:16px;' });
  const importInput = el('input', { type: 'file', accept: '.epub,.pdf', style: 'display:none;' });
  importInput.onchange = async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    toast(`Ingesting ${file.name}…`);
    try {
      await insights.saveBookToVault({ file });
      toast(`Saved ${file.name} to library`);
      const newItem = (await store.items.all()).find((it) => it.kind !== 'note' && it.name === file.name);
      if (newItem) {
        await openBookItem(newItem, null, at);
      }
    } catch (err) {
      toast(`Failed: ${err.message}`);
    }
  };
  const addBtn = el('button', { type: 'button', class: 'btn btn-primary', value: 'add' }, 'Add Book File');
  addBtn.onclick = () => importInput.click();
  const syncBtn = el('button', { type: 'button', class: 'btn btn-quiet', value: 'settings' }, '⚙ Settings & Sync');
  actionsRow.append(importInput, addBtn, syncBtn);
  if (card) {
    const noteBtn = el('button', { type: 'button', class: 'btn btn-quiet', value: 'note' }, 'Read Note Instead');
    actionsRow.append(noteBtn);
  }

  const { value } = await sheet({
    title: 'Source book not downloaded',
    fields: [msg, actionsRow],
    submit: false,
    cancel: 'Dismiss',
  });

  if (value === 'settings') {
    settings.open();
  } else if (value === 'note' && card) {
    actions.open(card);
  }
}

async function openBookItem(item, knownTitle, at, jumpOpts = {}) {
  let blob = (await store.blobs.get(item.key))?.blob;
  if (!blob) {
    const src = store.getSource(item.sourceId);
    if (src && src.type !== 'device') {
      const srcName = library.displayName(src);
      toast(`Downloading “${item.name}” from ${srcName}…`);
      try {
        blob = await library.readBlob(item);
        if (blob) {
          await store.blobs.put({
            key: item.key,
            sourceId: item.sourceId,
            sha: item.sha || `vault:${Date.now()}`,
            blob,
          });
        }
      } catch (readErr) {
        console.warn('Streaming download failed for', item.path, readErr);
      }
    }
  }
  if (!blob) {
    promptMissingBook(item.path, { item, at, ...jumpOpts });
    return;
  }
  toast('Opening…');
  try {
    const title = knownTitle || (await store.thumbs.get(item.key))?.title || item.name.replace(/\.[^.]+$/, '');
    const onHighlight = (h) => saveBookHighlight(item, title, h);
    if (item.kind === 'pdf') {
      const { openPdf } = await import('./viewers/pdf.js');
      await openPdf(item, blob, title, { at, onHighlight });
    } else {
      const { openBook } = await import('./viewers/book.js');
      await openBook(item, blob, title, { at, onHighlight });
    }
    document.getElementById('toast').classList.remove('show');
  } catch (err) {
    toast(err.message);
  }
}

/** A passage selected in a book or PDF becomes an insight note (see insights.js). */
async function saveBookHighlight(item, bookTitle, { text, comment = '', chapter = '', page = '', at = '', title = '', tags = '', progress = null }) {
  const where = [chapter, page ? `p. ${page}` : ''].filter(Boolean).join(', ');
  const src = store.getSource(item.sourceId);
  const bookRef = `${store.sourceKey(src)}|${item.path}`;
  const isPdf = item.kind === 'pdf' || item.path.endsWith('.pdf');

  return insights.createInsight({
    quote: text,
    title,
    tags,
    sourceTitle: bookTitle,
    attribution: [bookTitle, where].filter(Boolean).join(', '),
    anchor: {
      book: bookRef,
      format: isPdf ? 'pdf' : 'epub',
      at,
      page: page || (isPdf ? String(at).replace(/^page=/, '') : ''),
      chapter: chapter || '',
      progress: progress != null ? Number(progress) : null,
    },
    meta: {
      type: 'highlight',
      book_title: bookTitle,
      book_ref: bookRef,
      book_format: isPdf ? 'pdf' : 'epub',
      locator: {
        type: isPdf ? 'pdf_page' : 'epubcfi',
        cfi: isPdf ? undefined : at,
        page: page ? Number(page) || page : (isPdf ? parseInt(String(at).replace(/^page=/, ''), 10) : undefined),
        chapter: chapter || undefined,
        progress: progress != null ? Number(progress) : undefined,
      },
    },
    thought: comment,
  });
}

/**
 * Handles incoming Markdown note files opened from the OS or file picker.
 * Loads ephemeral session in memory/IDB, launches note reader, and docks the Staging Banner.
 */
export async function handleIncomingNoteFile(file) {
  if (!file) return;
  const title = file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');
  const text = await file.text();
  const tempKey = `session:note|${file.name}`;
  const item = {
    key: tempKey,
    sourceId: library.DEVICE_ID,
    path: file.name,
    folder: '',
    name: file.name,
    kind: 'note',
    text,
    isExternalSession: true,
  };
  await store.content.put({ key: tempKey, text, sourceId: library.DEVICE_ID });

  const stagingBanner = {
    file,
    type: 'note',
    onCommit: async () => {
      const home = insights.notesHome();
      const targetFolder = insights.highlightsFolder() || '';
      const targetPath = targetFolder ? `${targetFolder}/${file.name}` : file.name;
      const finalItem = {
        key: store.keyOf(home.id, targetPath),
        sourceId: home.id,
        path: targetPath,
        folder: targetFolder,
        name: file.name,
        kind: 'note',
        addedAt: Date.now(),
      };
      await store.items.put(finalItem);
      await store.content.put({ key: finalItem.key, sourceId: home.id, text });
      item.key = finalItem.key;
      item.sourceId = finalItem.sourceId;
      item.path = finalItem.path;
      item.folder = finalItem.folder;
      delete item.isExternalSession;

      const src = store.getSource(home.id);
      if (src && library.canWrite(src)) {
        try {
          await library.writeNote(finalItem, text);
        } catch (e) {
          console.warn('Could not write note to remote sync adapter:', e);
        }
      }
      toast(`Saved “${title}” to notes`);
      window.dispatchEvent(new CustomEvent('readover:notes-changed'));
    },
    onDismiss: () => {
      toast('Reading note in temporary session mode');
    },
  };

  await openNoteItem(item, { stagingBanner });
}

/**
 * Handles incoming Books (EPUB, PDF, MOBI, etc.) opened from the OS or file picker.
 * Sets up ephemeral blob storage in IDB session cache, immediately renders in viewer,
 * and docks the non-intrusive Staging Banner.
 */
export async function handleIncomingBookFile(file) {
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  const isPdf = ext === 'pdf';
  const title = file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');

  const mime = isPdf ? 'application/pdf' : (ext === 'epub' ? 'application/epub+zip' : 'application/octet-stream');
  const blob = file.type ? file : new Blob([await file.arrayBuffer()], { type: mime });
  const tempKey = `session:book|${file.name}`;
  const item = {
    key: tempKey,
    sourceId: library.DEVICE_ID,
    path: file.name,
    folder: '',
    name: file.name,
    kind: isPdf ? 'pdf' : ext,
    isExternalSession: true,
  };
  await store.blobs.put({ key: tempKey, sourceId: library.DEVICE_ID, sha: 'session', blob });

  const onHighlight = (h) => saveBookHighlight(item, title, h);

  const stagingBanner = {
    file,
    type: 'book',
    onCommit: async () => {
      const saved = await insights.saveBookToVault({
        blob,
        filename: file.name,
        title,
        format: isPdf ? 'pdf' : 'epub',
      });
      item.key = saved.key;
      item.sourceId = saved.sourceId;
      item.path = saved.path;
      delete item.isExternalSession;
      toast(`Added “${title}” to bookshelf`);
    },
    onDismiss: () => {
      toast('Reading book in temporary session mode');
    },
  };

  if (isPdf) {
    const { openPdf } = await import('./viewers/pdf.js');
    await openPdf(item, blob, title, { onHighlight, stagingBanner });
  } else {
    const { openBook } = await import('./viewers/book.js');
    await openBook(item, blob, title, { onHighlight, stagingBanner });
  }
}

/**
 * Native OS PWA File Handling ("Open With Readover"):
 * Dispatches to handleIncomingNoteFile or handleIncomingBookFile.
 */
export async function handleExternalFile(file) {
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  if (['md', 'markdown', 'txt'].includes(ext)) {
    return handleIncomingNoteFile(file);
  }
  if (['pdf', 'epub', 'mobi', 'azw3', 'azw', 'fb2', 'cbz'].includes(ext)) {
    return handleIncomingBookFile(file);
  }
  toast(`Unsupported file format: .${ext}`);
}


/**
 * Text selected in a note (or one highlight of an export) becomes an insight.
 * `h` is the export highlight it came from, if any.
 */
async function insightFromNote(item, note, { text, thought = '', title = '', tags = '', h = null }) {
  const src = store.getSource(item.sourceId);
  const sourceTitle = (h?.source || note.title || '').replace(/[*_`]/g, '');
  // From an export: name the book; from one of your notes: link back to it.
  const attribution = h ? [sourceTitle, h.note].filter(Boolean).join(', ') : wikiLink(item.path, note.title);
  const anchor = h?.at?.book ? h.at : { from: `${store.sourceKey(src)}|${item.path}` };
  const saved = await insights.createInsight({ quote: text, title, thought, tags, sourceTitle, attribution, anchor });
  toast(saved.where ? `Insight saved to ${saved.where}` : 'Insight saved on this device');
  return saved;
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
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key.toLowerCase() === 'u' || e.key.toLowerCase() === 'd')) {
    e.preventDefault();
    import('./ui/diagnostics.js').then((m) => m.openDiagnostics(app));
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
    e.preventDefault();
    import('./ui/observatory.js').then((m) => m.openObservatory(app));
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  if (e.key === 'Escape') {
    // <dialog> sheets handle Escape themselves (their 'cancel' event).
    if (hasOverlay() && !document.querySelector('dialog[open]')) closeTop();
    return;
  }
  if (hasOverlay()) return;
  // Enter and Space belong to a focused button or link, not to the feed.
  if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('button, a[href], summary, [role=button]')) return;
  if (e.key === '/') {
    e.preventDefault();
    searchNotesDialog();
    return;
  }
  if (app.view !== 'feed') {
    if (e.key.toLowerCase() === 'n' || e.key === '+') compose.open();
    return;
  }
  const card = app.current;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const run = {
    ArrowRight: () => card?._slideBy?.(1),
    ArrowLeft: () => card?._slideBy?.(-1),
    ArrowDown: () => scrollBy(1),
    j: () => scrollBy(1),
    ArrowUp: () => scrollBy(-1),
    k: () => scrollBy(-1),
    Enter: () => card?._item && actions.open(card),
    o: () => card?._item && actions.open(card),
    e: () => card?._item && actions.editNote?.(card),
    s: () => card?._item && actions.star(card),
    w: () => card?._item && (actions.addThought ? actions.addThought(card) : actions.water?.(card)),
    x: () => card?._item && actions.hide(card),
    r: () => reload(),
    n: () => compose.open(),
    '+': () => compose.open(),
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
  if (document.visibilityState === 'visible') syncAll();
});

/* ---------------- Data home sync results ---------------- */

window.addEventListener('readover:sync', async (e) => {
  const r = e.detail;
  if (r.phase || !r.ok || !r.at) return;
  if (r.prefsChanged) applyTheme();
  if (r.librariesAdded || r.librariesRemoved) {
    if (r.librariesAdded) toast(`Added ${r.librariesAdded} ${r.librariesAdded === 1 ? 'library' : 'libraries'} from your other devices`);
    settings.refresh();
    await syncAll(); // fetch file lists for the new libraries
    await reload();
  } else if (r.updated) {
    await refreshQueue(); // favourites/hidden from another device apply to what's still to come
  }
});

window.addEventListener('readover:conflict', (e) => {
  const name = e.detail.path.split('/').pop().replace(/\.md$/i, '');
  if (e.detail.kind === 'delete') toast(`“${name}” was changed elsewhere, so it wasn't deleted`);
  else toast(`“${name}” was changed elsewhere, so your edit was kept as a separate copy`);
  window.dispatchEvent(new CustomEvent('readover:notes-changed'));
});

/* ---------------- Boot ---------------- */

settings = initSettings({
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
  openSetup: () => setup.open(),
});
compose = initCompose({ showFirst });

setup = initSetup({
  afterConnect: async (src) => {
    await syncSource(src, { userGesture: true, quiet: true });
    settings.refresh();
  },
  afterMove: () => reload(),
});

$('brand').onclick = () => {
  reload();
  feedEl.focus({ preventScroll: true });
};
$('scope-btn').onclick = openScope;
$('search-btn').onclick = searchNotesDialog;
$('settings-btn').onclick = () => settings.open();
app.openSettings = (tab) => settings.open(tab);
app.openObservatory = () => import('./ui/observatory.js').then((m) => m.openObservatory(app));
app.openItem = (item) => (item.kind === 'note' ? openNoteItem(item) : openBookItem(item));
app.openBook = (item) => openBookItem(item);
app.handleExternalFile = handleExternalFile;
app.showView = showView;
app.compose = (presets) => compose.open(presets);
$('write-btn').onclick = () => compose.open();
// "Paste a quote": read the clipboard while the tap still counts as a tap (iPhone asks
// first), then switch from the new-note sheet to the capture sheet.
$('compose-paste').onclick = async () => {
  const reading = navigator.clipboard?.readText ? navigator.clipboard.readText().catch(() => '') : Promise.resolve('');
  await closeTop();
  openCapture({ text: await reading }, captureApp);
};

/* ---------------- Views: Feed and Shelf ---------------- */

const shelf = initShelf({
  openBook: (item) => openBookItem(item),
  connect: () => settings.open(),
});

const notesView = initNotes({
  openItem: (item) => openNoteItem(item),
  compose: (presets) => compose.open(presets),
});

/** Three views: Feed (reading), Shelf (books), Notes (working on notes). */
function showView(name) {
  app.view = name;
  feedEl.hidden = name !== 'feed';
  $('shelf').hidden = name !== 'shelf';
  $('notes').hidden = name !== 'notes';
  $('scope-btn').hidden = name !== 'feed'; // "What to show" filters the feed
  for (const v of ['feed', 'shelf', 'notes']) {
    const tab = $(`tab-${v}`);
    if (v === name) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  if (name === 'shelf') shelf.render();
  if (name === 'notes') notesView.render();
}
$('tab-feed').onclick = () => (app.view === 'feed' ? reload() : showView('feed'));
$('tab-shelf').onclick = () => showView('shelf');
$('tab-notes').onclick = () => showView('notes');

// A note deleted or moved: drop stale cards from the feed.
window.addEventListener('readover:notes-changed', async () => {
  for (const card of [...feedEl.querySelectorAll('.card[data-key]')]) {
    if (!(await store.items.get(card.dataset.key))) card.remove();
  }
});
let shelfTimer;
window.addEventListener('readover:progress', () => {
  clearTimeout(shelfTimer);
  shelfTimer = setTimeout(() => app.view === 'shelf' && shelf.render(), 800);
});
$('app-version').textContent = VERSION;

captureApp = { openItem: (item) => openNoteItem(item), showFirst };

async function boot() {
  applyTheme();
  await store.migrateLegacy();
  initStatus({ openSettings: () => settings.open() });
  // Opened to save a clip (share sheet, bookmarklet, Shortcut)? Tidy the address and
  // open the capture sheet once the feed is up.
  const incoming = clipFromLocation();
  if (incoming) history.replaceState(null, '', location.pathname);

  // Check for Dropbox OAuth 2.0 PKCE return (?code=...)
  if (typeof window !== 'undefined' && window.location?.search) {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code && typeof sessionStorage !== 'undefined' && sessionStorage.getItem('readover_dropbox_verifier')) {
      try {
        toast('Connecting Dropbox account…');
        const dropbox = await import('./sources/dropbox.js');
        const redirectUri = `${window.location.origin}${window.location.pathname}`;
        const { token, refreshToken, account_id } = await dropbox.exchangePKCECode(code, '', redirectUri);
        if (token) {
          const user = (await dropbox.whoami(token)) || '';
          let dbxSrc = store.getSources().find((s) => s.type === 'dropbox');
          if (!dbxSrc) {
            dbxSrc = {
              id: store.newId('dbx'),
              type: 'dropbox',
              token,
              name: user ? `Dropbox (${user})` : 'Dropbox (/Apps/Readover)',
              root: '',
              accountId: account_id || '',
              refreshToken: refreshToken || '',
            };
          } else {
            dbxSrc.token = token;
            if (refreshToken) dbxSrc.refreshToken = refreshToken;
            if (account_id) dbxSrc.accountId = account_id;
            if (user) dbxSrc.name = `Dropbox (${user})`;
          }
          await store.saveSource(dbxSrc);
          app.sourcesChanged?.();
          toast(`Connected ${dbxSrc.name}! Syncing…`);
        }
      } catch (err) {
        toast(`Dropbox connection failed: ${err.message}`);
      } finally {
        history.replaceState(null, '', location.pathname);
      }
    }

    const shareReceived = params.get('share-received');
    if (shareReceived) {
      history.replaceState(null, '', location.pathname);
      const sessionKey = `session:share|${shareReceived}`;
      const legacyKey = `shared:${shareReceived}`;
      (async () => {
        let record = await store.blobs.get(sessionKey);
        if (!record) record = await store.blobs.get(legacyKey);
        if (record?.blob) {
          await store.blobs.delete(sessionKey).catch(() => {});
          await store.blobs.delete(legacyKey).catch(() => {});
          const mimeType = record.blob.type || (shareReceived.endsWith('.md') ? 'text/markdown' : 'application/octet-stream');
          const file = new File([record.blob], shareReceived, { type: mimeType });
          handleExternalFile(file);
        }
      })().catch((err) => {
        console.warn('Failed to retrieve shared file:', err);
      });
    }

    const action = params.get('action');
    if (action) {
      history.replaceState(null, '', location.pathname);
      if (action === 'new-note') {
        if (typeof app.compose === 'function') app.compose();
        else compose.open();
      } else if (action === 'search') {
        searchNotesDialog();
      } else if (action === 'shelf') {
        showView('shelf');
      }
    }
  }
  await reload();
  if (incoming) openCapture(incoming, captureApp);
  dataSync.ensureDataHome();
  dataSync.startAutoSync();
  dataSync.syncNow({ includeSeen: false });
  outbox.kick(0);
  const hasItems = (await store.items.all()).length > 0;
  await syncAll({ force: !hasItems && store.getSources().length > 0 });
  showPermissionBanner();
  // The garden's clock: when each note last changed (in the background, cached).
  clock.fill().catch(() => {});
  navigator.storage?.persist?.().catch(() => {});
  dataSync.onBroadcastMessage((msg) => {
    if (msg.type === 'note-updated' || msg.type === 'sources-changed') {
      if (app.view === 'notes') notesView.render();
      if (app.view === 'shelf') shelf.render();
    }
  });
}


function setupServiceWorkerUpdates(registration) {
  function showUpdatePrompt() {
    const banner = document.getElementById('sw-update-banner');
    if (!banner) return;
    banner.hidden = false;
    banner.classList.add('is-visible');

    const updateBtn = document.getElementById('sw-update-btn');
    if (updateBtn) {
      updateBtn.onclick = () => {
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        } else {
          window.location.reload();
        }
      };
    }

    const dismissBtn = document.getElementById('sw-dismiss-btn');
    if (dismissBtn) {
      dismissBtn.onclick = () => {
        banner.classList.remove('is-visible');
        setTimeout(() => { banner.hidden = true; }, 250);
      };
    }
  }

  // If a worker is already waiting in background
  if (registration.waiting) {
    showUpdatePrompt();
  }

  registration.addEventListener('updatefound', () => {
    const newWorker = registration.installing;
    if (!newWorker) return;
    newWorker.addEventListener('statechange', () => {
      if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
        showUpdatePrompt();
      }
    });
  });
}

let swRefreshing = false;
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (swRefreshing) return;
    swRefreshing = true;
    window.location.reload();
  });
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // updateViaCache 'none': always check sw.js itself against the server.
  navigator.serviceWorker
    .register('./sw.js', { updateViaCache: 'none' })
    .then((reg) => {
      setupServiceWorkerUpdates(reg);
    })
    .catch((err) => console.warn('Service worker not registered', err));
}

/**
 * Native OS PWA File Handling (window.launchQueue)
 * Registers file handling consumer with W3C File Handling API.
 */
export function initFileLaunchHandler(appInstance) {
  if (typeof window === 'undefined' || !('launchQueue' in window)) return;
  try {
    window.launchQueue.setConsumer(async (launchParams) => {
      if (!launchParams?.files?.length) return;
      for (const handle of launchParams.files) {
        try {
          const file = await handle.getFile();
          await handleExternalFile(file);
        } catch (err) {
          console.warn('launchQueue file processing error:', err);
        }
      }
    });
  } catch (err) {
    console.warn('Failed to initialize launchQueue consumer:', err);
  }
}

initFileLaunchHandler(app);

boot();
