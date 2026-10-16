// Single local database for every source. Records are keyed "<sourceId>|<path>",
// so any item can be resolved without an "active database" (the root cause of the
// old All-Sources bugs).
import { openDB, table, promisify } from './lib/idb.js';

const DB_NAME = 'readover';
const DB_VERSION = 2;

const dbPromise = openDB(DB_NAME, DB_VERSION, (db, oldVersion) => {
  if (oldVersion < 1) {
    const items = db.createObjectStore('items', { keyPath: 'key' });
    items.createIndex('sourceId', 'sourceId');
    const state = db.createObjectStore('state', { keyPath: 'key' });
    state.createIndex('sourceId', 'sourceId');
    for (const name of ['content', 'thumbs', 'progress', 'blobs']) {
      const s = db.createObjectStore(name, { keyPath: 'key' });
      s.createIndex('sourceId', 'sourceId');
    }
    db.createObjectStore('handles'); // FileSystemDirectoryHandle per local source (out-of-line key)
  }
  if (oldVersion < 2) {
    // Save queue: note changes waiting to be committed to GitHub.
    const outbox = db.createObjectStore('outbox', { keyPath: 'id' });
    outbox.createIndex('key', 'key');
  }
});

export const items = table(dbPromise, 'items'); // { key, sourceId, path, folder, name, kind, sha }
export const content = table(dbPromise, 'content'); // { key, sourceId, sha, text }
export const state = table(dbPromise, 'state'); // { key, sourceId, path, lastSeen, seen, starred, hidden }
export const thumbs = table(dbPromise, 'thumbs'); // { key, sourceId, sha, blob, title, author }
export const progress = table(dbPromise, 'progress'); // { key, sourceId, pct, loc, updatedAt, highlights[] }
export const blobs = table(dbPromise, 'blobs'); // { key, sourceId, blob } for folders imported without a handle (iOS)
export const outbox = table(dbPromise, 'outbox'); // { id, key, sourceId, path, op, text, baseSha, ... } see outbox.js

export async function getHandle(sourceId) {
  const db = await dbPromise;
  return promisify(db.transaction('handles').objectStore('handles').get(sourceId));
}
export async function setHandle(sourceId, handle) {
  const db = await dbPromise;
  return promisify(db.transaction('handles', 'readwrite').objectStore('handles').put(handle, sourceId));
}
async function deleteHandle(sourceId) {
  const db = await dbPromise;
  return promisify(db.transaction('handles', 'readwrite').objectStore('handles').delete(sourceId));
}

export const keyOf = (sourceId, path) => `${sourceId}|${path}`;

/**
 * A source's identity across devices. Source ids are random per device, so synced
 * data is keyed by what the source *is*: the repo (and folder), or the folder's name.
 */
export function sourceKey(src) {
  if (!src) return null;
  if (src.type === 'github') {
    const root = (src.root || '').replace(/^\/|\/$/g, '');
    return `gh:${src.owner}/${src.repo}${root ? `/${root}` : ''}`.toLowerCase();
  }
  if (src.type === 'dropbox') return `dbx:${(src.name || 'app').toLowerCase()}`;
  if (src.type === 'webdav') return `dav:${(src.url || '').toLowerCase()}`;
  if (src.type === 's3' || src.type === 'r2') return `s3:${(src.bucket || '').toLowerCase()}`;
  if (src.type === 'device') return 'device';
  return `fs:${(src.name || '').toLowerCase()}`;
}

/* ---------- Changes waiting to sync ---------- */

// 'important' = favourites, hidden, reading progress, preferences, libraries.
// 'seen' = feed history: frequent and low stakes, so it rides along with other syncs.
export function markDirty(kind = 'important') {
  const d = readJSON('readover.sync.dirty', {});
  d[kind] = Date.now();
  writeJSON('readover.sync.dirty', d);
  window.dispatchEvent(new CustomEvent('readover:dirty', { detail: kind }));
}
export function getDirty() {
  return readJSON('readover.sync.dirty', {});
}
/** Clear dirty flags that haven't changed since `since` (changes made during a sync stay dirty). */
export function clearDirty(since, kinds = ['important', 'seen']) {
  const d = getDirty();
  for (const k of kinds) if (d[k] && d[k] <= since) delete d[k];
  writeJSON('readover.sync.dirty', d);
}

/* ---------- Per-item reading state ---------- */

export async function getState(key) {
  return (await state.get(key)) || null;
}

export async function patchState(item, patch) {
  const current = (await state.get(item.key)) || {
    key: item.key,
    sourceId: item.sourceId,
    path: item.path,
    lastSeen: 0,
    seen: 0,
    starred: 0,
    hidden: 0,
  };
  const next = { ...current, ...patch };
  if ('starred' in patch || 'hidden' in patch) next.flagsAt = Date.now(); // for merging across devices
  await state.put(next);
  markDirty('starred' in patch || 'hidden' in patch ? 'important' : 'seen');
  return next;
}

export function markSeen(item) {
  return state.get(item.key).then((s) =>
    patchState(item, { lastSeen: Date.now(), seen: ((s && s.seen) || 0) + 1 })
  );
}

/** Reading position and in-book highlights. */
export async function saveProgress(item, patch) {
  const current = (await progress.get(item.key)) || { key: item.key, sourceId: item.sourceId, pct: 0, loc: '', highlights: [] };
  const next = { ...current, ...patch, updatedAt: Date.now() };
  await progress.put(next);
  markDirty('important');
  window.dispatchEvent(new CustomEvent('readover:progress', { detail: item.key }));
  return next;
}

/** Remove everything stored for a source. */
export async function purgeSource(sourceId) {
  await Promise.all(
    [items, content, state, thumbs, progress, blobs].map((t) => t.deleteByIndex('sourceId', sourceId))
  );
  await deleteHandle(sourceId);
}

/* ---------- Settings (small, synchronous, localStorage) ---------- */

const LS = {
  sources: 'readover.sources',
  token: 'readover.token',
  prefs: 'readover.prefs',
  catalogs: 'readover.catalogs',
};

export function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
export function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn('Could not save settings', err);
  }
}

/** OPDS Catalogs: { id, name, url, authType, username, password, token, corsProxy } */
export const PRESET_CATALOGS = [
  {
    id: 'standard-ebooks',
    name: 'Standard Ebooks',
    url: 'https://standardebooks.org/opds/all',
    authType: 'none',
    description: 'Free, beautifully typeset public domain ebooks.',
  },
  {
    id: 'project-gutenberg',
    name: 'Project Gutenberg',
    url: 'https://m.gutenberg.org/ebooks.opds/',
    authType: 'none',
    description: 'Over 70,000 free digital books.',
  },
  {
    id: 'feedbooks',
    name: 'Feedbooks Public Domain',
    url: 'https://opds.feedbooks.com/catalog.atom',
    authType: 'none',
    description: 'Classical works and public domain literature.',
  },
];

export function getCatalogs() {
  const custom = readJSON(LS.catalogs, null);
  if (custom === null) {
    // Seed with standard presets on initial access
    writeJSON(LS.catalogs, PRESET_CATALOGS);
    return PRESET_CATALOGS;
  }
  return custom;
}

export function saveCatalog(catalog) {
  const list = getCatalogs();
  const idx = list.findIndex((c) => c.id === catalog.id);
  if (idx >= 0) list[idx] = catalog;
  else list.push(catalog);
  writeJSON(LS.catalogs, list);
  window.dispatchEvent(new CustomEvent('readover:catalogs-changed'));
  return catalog;
}

export function deleteCatalog(id) {
  const list = getCatalogs().filter((c) => c.id !== id);
  writeJSON(LS.catalogs, list);
  window.dispatchEvent(new CustomEvent('readover:catalogs-changed'));
}

/** Source: { id, type: 'github'|'local', name, owner?, repo?, branch?, root?, token?, mode?: 'handle'|'import' } */
export function getSources() {
  return readJSON(LS.sources, []);
}
export function getSource(id) {
  return getSources().find((s) => s.id === id) || null;
}
export function saveSource(source, { fromSync = false } = {}) {
  const list = getSources();
  const idx = list.findIndex((s) => s.id === source.id);
  if (!fromSync) source.updatedAt = Date.now();
  if (idx === -1) list.push(source);
  else list[idx] = source;
  writeJSON(LS.sources, list);
  if (source.type === 'github') {
    const tomb = readJSON('readover.removedSources', {});
    if (tomb[sourceKey(source)]) {
      delete tomb[sourceKey(source)];
      writeJSON('readover.removedSources', tomb);
    }
    if (!fromSync) markDirty('important');
  }
  return source;
}
export async function removeSource(id, { fromSync = false } = {}) {
  const src = getSource(id);
  writeJSON(
    LS.sources,
    getSources().filter((s) => s.id !== id)
  );
  if (src?.type === 'github' && !fromSync) {
    // Remember the removal so other devices remove it too.
    const tomb = readJSON('readover.removedSources', {});
    tomb[sourceKey(src)] = Date.now();
    writeJSON('readover.removedSources', tomb);
    markDirty('important');
  }
  if (getPrefs().dataHome === id) setPrefs({ dataHome: '' });
  await purgeSource(id);
}
export const getRemovedSources = () => readJSON('readover.removedSources', {});

export function getToken() {
  return localStorage.getItem(LS.token) || '';
}
export function setToken(token) {
  if (token && token.trim()) localStorage.setItem(LS.token, token.trim());
  else localStorage.removeItem(LS.token);
}

// dataHome: id of the GitHub source that holds .readover/ ('' = this device only).
const DEFAULT_PREFS = {
  theme: 'system',
  scope: 'all',
  folder: '',
  filter: 'all',
  highlightMix: 0.5,
  dataHome: '',
  corsProxyUrl: '',
  acquiredBooksHome: '',
  attachmentsDestination: 'note-provider', // 'note-provider' | 's3'
};
/** Preferences that follow you between devices. The rest (view filters, data home) are per device. */
export const SYNCED_PREFS = ['theme', 'highlightMix', 'corsProxyUrl', 'acquiredBooksHome', 'attachmentsDestination'];
export function getPrefs() {
  return { ...DEFAULT_PREFS, ...readJSON(LS.prefs, {}) };
}
export function setPrefs(patch, { fromSync = false } = {}) {
  const next = { ...getPrefs(), ...patch };
  writeJSON(LS.prefs, next);
  const synced = Object.keys(patch).filter((k) => SYNCED_PREFS.includes(k));
  if (synced.length && !fromSync) {
    const times = readJSON('readover.prefsAt', {});
    for (const k of synced) times[k] = Date.now();
    writeJSON('readover.prefsAt', times);
    markDirty('important');
  }
  return next;
}
export const getPrefTimes = () => readJSON('readover.prefsAt', {});

export const newId = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/* ---------- One-time migration from the v2 storage layout ---------- */

export async function migrateLegacy() {
  if (localStorage.getItem('readover.migrated') || localStorage.getItem(LS.sources)) {
    localStorage.setItem('readover.migrated', '1');
    return;
  }
  const oldVaults = readJSON('readover_vault_profiles', []);
  const oldLocals = readJSON('readover_local_profiles', []);
  const oldToken = localStorage.getItem('readover_github_global_token');
  if (oldToken) setToken(oldToken);

  const migrated = [];
  for (const v of oldVaults) {
    migrated.push({
      id: v.id,
      type: 'github',
      name: v.name || `${v.owner}/${v.repo}`,
      owner: v.owner,
      repo: v.repo,
      branch: v.branch || 'main',
      token: v.token || '',
    });
  }
  // Local folders with a stored handle can be carried over; plain imports cannot.
  const legacyHandles = await openLegacyHandles();
  for (const l of oldLocals) {
    const handle = legacyHandles ? await legacyHandles(l.id) : null;
    if (!handle) continue;
    migrated.push({ id: l.id, type: 'local', name: l.name, mode: 'handle' });
    await setHandle(l.id, handle);
  }
  writeJSON(LS.sources, migrated);

  // Carry over favourites from the old per-source databases, then drop them.
  for (const s of migrated) {
    try {
      const old = await openDB(`ReadOver_${s.id}`);
      if (old.objectStoreNames.contains('state')) {
        const rows = await promisify(old.transaction('state').objectStore('state').getAll());
        const starred = rows.filter((r) => r.starred === 1);
        await state.bulkPut(
          starred.map((r) => ({
            key: keyOf(s.id, r.path),
            sourceId: s.id,
            path: r.path,
            lastSeen: r.lastSeen || 0,
            seen: 0,
            starred: Date.now(),
            hidden: 0,
          }))
        );
      }
      old.close();
      indexedDB.deleteDatabase(`ReadOver_${s.id}`);
    } catch (err) {
      console.warn('Legacy migration skipped for', s.id, err);
    }
  }
  ['readover_vault_profiles', 'readover_local_profiles', 'readover_github_global_token', 'readover_active_vault_id'].forEach(
    (k) => localStorage.removeItem(k)
  );
  localStorage.setItem('readover.migrated', '1');
}

async function openLegacyHandles() {
  try {
    const db = await openDB('ReadOver_HandlesDB', 1, (d) => {
      if (!d.objectStoreNames.contains('dir_handles')) d.createObjectStore('dir_handles');
    });
    return (id) => promisify(db.transaction('dir_handles').objectStore('dir_handles').get(id));
  } catch {
    return null;
  }
}
