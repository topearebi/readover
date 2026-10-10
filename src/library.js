// Library: the one place that knows about sources. Sync, read, write, favourites.
import * as store from './store.js';
import * as github from './sources/github.js';
import * as local from './sources/local.js';

const { items, content, state, thumbs, progress, blobs, keyOf } = store;

const KINDS = { md: 'note', markdown: 'note', txt: 'note', pdf: 'pdf', epub: 'epub' };
const MIME = { pdf: 'application/pdf', epub: 'application/epub+zip' };
export const STATE_FILE = '.readover/state.json';

export const kindOf = (path) => KINDS[path.split('.').pop().toLowerCase()] || null;

function acceptFor(src) {
  const ignores = (src.ignore || '')
    .split(',')
    .map((s) => s.trim().replace(/^\/|\/$/g, ''))
    .filter(Boolean);
  const root = (src.root || '').replace(/^\/|\/$/g, '');
  return (path) => {
    if (!kindOf(path)) return false;
    const parts = path.split('/');
    if (parts.some((p) => p.startsWith('.') || p === 'node_modules')) return false;
    if (root && !path.startsWith(`${root}/`)) return false;
    if (ignores.some((ig) => path === ig || path.startsWith(`${ig}/`))) return false;
    return true;
  };
}

const adapter = (src) => (src.type === 'github' ? github : local);

export function canWrite(src) {
  return src ? adapter(src).canWrite(src) : false;
}

export function displayName(src) {
  return src.name || (src.type === 'github' ? `${src.owner}/${src.repo}` : 'Folder');
}

function toItem(src, f) {
  const parts = f.path.split('/');
  const name = parts.pop();
  return {
    key: keyOf(src.id, f.path),
    sourceId: src.id,
    path: f.path,
    folder: parts.join('/'),
    name,
    kind: kindOf(f.path),
    sha: f.sha,
  };
}

/* ---------------- Sync ---------------- */

export async function sync(src, onProgress = () => {}) {
  const label = displayName(src);
  let files;
  if (src.type === 'github') {
    onProgress(`Checking ${label}…`);
    files = await github.listFiles(src);
  } else if (src.mode === 'handle') {
    onProgress(`Scanning ${label}…`);
    files = await local.listFiles(src, acceptFor(src));
  } else {
    return { total: (await items.byIndex('sourceId', src.id)).length, added: 0, removed: 0 };
  }
  return applyFileList(src, files, onProgress);
}

export async function applyFileList(src, files, onProgress = () => {}) {
  const accept = acceptFor(src);
  const wanted = files.filter((f) => accept(f.path)).map((f) => toItem(src, f));
  const existing = new Map((await items.byIndex('sourceId', src.id)).map((i) => [i.key, i]));
  const wantedKeys = new Set(wanted.map((i) => i.key));

  const changed = wanted.filter((i) => existing.get(i.key)?.sha !== i.sha);
  const removed = [...existing.keys()].filter((k) => !wantedKeys.has(k));

  if (changed.length) await items.bulkPut(changed);
  if (removed.length) {
    await Promise.all([items, content, thumbs, progress, state, blobs].map((t) => t.bulkDelete(removed)));
  }
  const added = changed.filter((i) => !existing.has(i.key)).length;

  if (src.type === 'github') {
    onProgress(`Syncing favourites for ${displayName(src)}…`);
    try {
      await pullRemoteState(src);
      await pushPending(src);
    } catch (err) {
      console.warn('Favourites sync skipped:', err.message);
    }
  }
  return { total: wanted.length, added, removed: removed.length };
}

/** Folder import for browsers without the File System Access API. */
export async function importFolder(src, fileList, onProgress) {
  const files = await local.importFileList(src, fileList, acceptFor(src), onProgress);
  return applyFileList(src, files, onProgress);
}

/* ---------------- Reading ---------------- */

export async function readText(item) {
  const cached = await content.get(item.key);
  if (cached && cached.sha === item.sha) return cached.text;

  const src = store.getSource(item.sourceId);
  if (!src) throw new Error('This source was removed.');
  try {
    const text = await adapter(src).readText(src, item);
    await content.put({ key: item.key, sourceId: item.sourceId, sha: item.sha, text });
    return text;
  } catch (err) {
    if (cached) return cached.text; // stale beats nothing when offline
    throw err;
  }
}

/** Books from GitHub are cached by sha so they open offline and don't re-download. */
export async function readBlob(item) {
  const src = store.getSource(item.sourceId);
  if (!src) throw new Error('This source was removed.');
  const type = MIME[item.kind] || '';
  if (src.type === 'local') {
    const file = await local.readFile(src, item);
    return file.type ? file : new Blob([file], { type });
  }
  const cached = await blobs.get(item.key);
  if (cached && cached.sha === item.sha) return cached.blob;
  const blob = await github.readBlob(src, item, type);
  blobs.put({ key: item.key, sourceId: item.sourceId, sha: item.sha, blob }).catch(() => {});
  return blob;
}

export async function hasOfflineCopy(item) {
  if (item.kind === 'note') return Boolean(await content.get(item.key));
  return Boolean(await blobs.get(item.key));
}

/** Resolve a relative image/link path inside a note to a blob URL. */
export async function readRelative(item, relPath) {
  const parts = item.folder ? item.folder.split('/') : [];
  for (const seg of decodeURI(relPath).split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  const path = parts.join('/');
  const src = store.getSource(item.sourceId);
  const fake = { key: keyOf(item.sourceId, path), sourceId: item.sourceId, path, folder: '', sha: null };
  if (src.type === 'github') return github.readBlob(src, fake);
  return local.readFile(src, fake);
}

/* ---------------- Writing ---------------- */

async function upsertText(src, path, text, sha) {
  const item = toItem(src, { path, sha });
  await items.put(item);
  await content.put({ key: item.key, sourceId: src.id, sha, text });
  return item;
}

export async function writeNote(src, path, text, { message } = {}) {
  if (!canWrite(src)) throw new Error(`"${displayName(src)}" is read-only. Add a GitHub token to edit.`);
  let sha;
  if (src.type === 'github') {
    const existing = await github.getFile(src, path);
    sha = await github.putFile(src, path, text, existing?.sha, message || `Readover: ${existing ? 'edit' : 'add'} ${path}`);
  } else {
    sha = await local.writeText(src, path, text);
  }
  return upsertText(src, path, text, sha);
}

/** Append a markdown block to a file (creating it with `header` if needed). */
export async function appendToFile(src, path, header, block, message) {
  if (!canWrite(src)) throw new Error(`"${displayName(src)}" is read-only.`);
  const merge = (current) => `${(current ?? header).replace(/\s*$/, '')}\n\n${block.trim()}\n`;
  let text;
  let sha;
  if (src.type === 'github') {
    sha = await github.updateFile(src, path, (cur) => (text = merge(cur)), message);
  } else {
    text = merge(await local.getText(src, path));
    sha = await local.writeText(src, path, text);
  }
  return upsertText(src, path, text, sha);
}

/* ---------------- Favourites & hidden, synced through the repo ---------------- */

const pendingKey = (id) => `readover.pending.${id}`;
const readPending = (id) => {
  try {
    return JSON.parse(localStorage.getItem(pendingKey(id)) || '{}');
  } catch {
    return {};
  }
};
const writePending = (id, p) =>
  Object.keys(p).length ? localStorage.setItem(pendingKey(id), JSON.stringify(p)) : localStorage.removeItem(pendingKey(id));

const pushTimers = new Map();

export async function setFlag(item, flag, on) {
  const next = await store.patchState(item, { [flag]: on ? Date.now() : 0 });
  const src = store.getSource(item.sourceId);
  if (src?.type === 'github' && github.canWrite(src)) {
    const pending = readPending(src.id);
    pending[item.path] = { ...(pending[item.path] || {}), [flag]: Boolean(on) };
    writePending(src.id, pending);
    clearTimeout(pushTimers.get(src.id));
    pushTimers.set(
      src.id,
      setTimeout(() => pushPending(src).catch((e) => console.warn('Favourites push failed:', e.message)), 4000)
    );
  }
  return next;
}

export function flushPending() {
  for (const [id, t] of pushTimers) {
    clearTimeout(t);
    const src = store.getSource(id);
    if (src) pushPending(src).catch(() => {});
  }
  pushTimers.clear();
}

function parseStateFile(text) {
  try {
    const data = JSON.parse(text);
    return { starred: data.starred || {}, hidden: data.hidden || {} };
  } catch {
    return { starred: {}, hidden: {} };
  }
}

async function pullRemoteState(src) {
  let text = null;
  if (github.canWrite(src)) text = (await github.getFile(src, STATE_FILE))?.text ?? null;
  else {
    try {
      text = await github.readText(src, { path: STATE_FILE });
    } catch {
      text = null;
    }
  }
  if (text === null) return;
  const remote = parseStateFile(text);
  const pending = readPending(src.id);
  const rows = new Map((await state.byIndex('sourceId', src.id)).map((r) => [r.path, r]));
  const srcItems = await items.byIndex('sourceId', src.id);
  const updates = [];
  for (const it of srcItems) {
    if (pending[it.path]) continue; // local change not pushed yet wins
    const row = rows.get(it.path) || {
      key: it.key, sourceId: src.id, path: it.path, lastSeen: 0, seen: 0, starred: 0, hidden: 0,
    };
    const starred = remote.starred[it.path] ? Date.parse(remote.starred[it.path]) || 1 : 0;
    const hidden = remote.hidden[it.path] ? Date.parse(remote.hidden[it.path]) || 1 : 0;
    if (Boolean(row.starred) !== Boolean(starred) || Boolean(row.hidden) !== Boolean(hidden)) {
      updates.push({ ...row, starred, hidden });
    }
  }
  if (updates.length) await state.bulkPut(updates);
}

async function pushPending(src) {
  if (!github.canWrite(src)) return;
  const snapshot = readPending(src.id);
  if (!Object.keys(snapshot).length) return;
  const now = new Date().toISOString();
  await github.updateFile(
    src,
    STATE_FILE,
    (current) => {
      const data = current ? parseStateFile(current) : { starred: {}, hidden: {} };
      for (const [path, flags] of Object.entries(snapshot)) {
        for (const flag of ['starred', 'hidden']) {
          if (!(flag in flags)) continue;
          if (flags[flag]) data[flag][path] = data[flag][path] || now;
          else delete data[flag][path];
        }
      }
      const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
      return `${JSON.stringify({ version: 1, starred: sorted(data.starred), hidden: sorted(data.hidden) }, null, 2)}\n`;
    },
    'Readover: update favourites'
  );
  // Drop only what we pushed; keep anything toggled meanwhile.
  const latest = readPending(src.id);
  for (const [path, flags] of Object.entries(snapshot)) {
    if (JSON.stringify(latest[path]) === JSON.stringify(flags)) delete latest[path];
  }
  writePending(src.id, latest);
}
