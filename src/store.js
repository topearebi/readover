// Single local database for every source. Records are keyed "<sourceId>|<path>",
// so any item can be resolved without an "active database" (the root cause of the
// old All-Sources bugs).
import { openDB, table, promisify } from './lib/idb.js';

const DB_NAME = 'readover';
const DB_VERSION = 1;

const dbPromise = openDB(DB_NAME, DB_VERSION, (db) => {
  const items = db.createObjectStore('items', { keyPath: 'key' });
  items.createIndex('sourceId', 'sourceId');
  const state = db.createObjectStore('state', { keyPath: 'key' });
  state.createIndex('sourceId', 'sourceId');
  for (const name of ['content', 'thumbs', 'progress', 'blobs']) {
    const s = db.createObjectStore(name, { keyPath: 'key' });
    s.createIndex('sourceId', 'sourceId');
  }
  db.createObjectStore('handles'); // FileSystemDirectoryHandle per local source (out-of-line key)
});

export const items = table(dbPromise, 'items'); // { key, sourceId, path, folder, name, kind, sha }
export const content = table(dbPromise, 'content'); // { key, sourceId, sha, text }
export const state = table(dbPromise, 'state'); // { key, sourceId, path, lastSeen, seen, starred, hidden }
export const thumbs = table(dbPromise, 'thumbs'); // { key, sourceId, sha, blob, title, author }
export const progress = table(dbPromise, 'progress'); // { key, sourceId, pct, loc, updatedAt, highlights[] }
export const blobs = table(dbPromise, 'blobs'); // { key, sourceId, blob } for folders imported without a handle (iOS)

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
  await state.put(next);
  return next;
}

export function markSeen(item) {
  return state.get(item.key).then((s) =>
    patchState(item, { lastSeen: Date.now(), seen: ((s && s.seen) || 0) + 1 })
  );
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
};

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn('Could not save settings', err);
  }
}

/** Source: { id, type: 'github'|'local', name, owner?, repo?, branch?, root?, token?, mode?: 'handle'|'import' } */
export function getSources() {
  return readJSON(LS.sources, []);
}
export function getSource(id) {
  return getSources().find((s) => s.id === id) || null;
}
export function saveSource(source) {
  const list = getSources();
  const idx = list.findIndex((s) => s.id === source.id);
  if (idx === -1) list.push(source);
  else list[idx] = source;
  writeJSON(LS.sources, list);
  return source;
}
export async function removeSource(id) {
  writeJSON(
    LS.sources,
    getSources().filter((s) => s.id !== id)
  );
  localStorage.removeItem(`readover.pending.${id}`);
  await purgeSource(id);
}

export function getToken() {
  return localStorage.getItem(LS.token) || '';
}
export function setToken(token) {
  if (token && token.trim()) localStorage.setItem(LS.token, token.trim());
  else localStorage.removeItem(LS.token);
}

const DEFAULT_PREFS = { theme: 'system', scope: 'all', folder: '', filter: 'all', highlightMix: 0.5 };
export function getPrefs() {
  return { ...DEFAULT_PREFS, ...readJSON(LS.prefs, {}) };
}
export function setPrefs(patch) {
  const next = { ...getPrefs(), ...patch };
  writeJSON(LS.prefs, next);
  return next;
}

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
