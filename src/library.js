// Library: the one place that knows about sources. Listing, reading, writing.
// Favourites, progress and history sync through the data home (sync.js).
import * as store from './store.js';
import * as github from './sources/github.js';
import * as local from './sources/local.js';
import * as outbox from './outbox.js';

const { items, content, state, thumbs, progress, blobs, keyOf } = store;

// Notes are edited; books are read and highlighted. foliate-js opens everything
// except PDF (which has its own reader).
const KINDS = {
  md: 'note', markdown: 'note', txt: 'note',
  pdf: 'pdf',
  epub: 'epub', mobi: 'ebook', azw3: 'ebook', azw: 'ebook', fb2: 'ebook', fbz: 'ebook', cbz: 'ebook',
};
const MIME = { pdf: 'application/pdf', epub: 'application/epub+zip' };
export const isBook = (item) => item.kind !== 'note';

// JSON is only read when it looks like a highlights export (see imports.js).
const EXPORT_FOLDER = /(highlight|clipping|clipboard|koreader|kindle)/i;
export const kindOf = (path) => {
  const ext = path.split('.').pop().toLowerCase();
  if (ext === 'json') return EXPORT_FOLDER.test(path) ? 'note' : null;
  return KINDS[ext] || null;
};

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

/* Notes written before any library is connected live in this browser. */
export const DEVICE_ID = 'device';
const device = {
  canWrite: () => true,
  async readText(src, item) {
    const c = await content.get(item.key);
    if (!c) throw new Error('This note is missing from this device.');
    return c.text;
  },
};

/** The on-device notebook; created the first time it's needed. */
export function deviceSource(create = false) {
  let src = store.getSource(DEVICE_ID);
  if (!src && create) src = store.saveSource({ id: DEVICE_ID, type: 'device', name: 'This device' });
  return src;
}

const adapter = (src) => (src.type === 'github' ? github : src.type === 'device' ? device : local);

export function canWrite(src) {
  return src ? adapter(src).canWrite(src) : false;
}

export function displayName(src) {
  if (src.type === 'device') return 'This device';
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
    // Imported folders and the on-device notebook have nothing to re-list.
    return { total: (await items.byIndex('sourceId', src.id)).length, added: 0, removed: 0 };
  }
  return applyFileList(src, files, onProgress);
}

export async function applyFileList(src, files, onProgress = () => {}) {
  const accept = acceptFor(src);
  const wanted = files.filter((f) => accept(f.path)).map((f) => toItem(src, f));
  const existing = new Map((await items.byIndex('sourceId', src.id)).map((i) => [i.key, i]));
  const wantedKeys = new Set(wanted.map((i) => i.key));

  // Notes with unsent edits keep their local version until the save queue sends them.
  const pending = await outbox.pendingKeys();
  const changed = wanted.filter((i) => existing.get(i.key)?.sha !== i.sha && !pending.has(i.key));
  const removed = [...existing.keys()].filter((k) => !wantedKeys.has(k) && !pending.has(k));
  // Files that appear after the first listing are new: they get a review schedule.
  const listedBefore = existing.size > 0 || Boolean(localStorage.getItem(`readover.lastSync.${src.id}`));
  const now = Date.now();
  for (const i of changed) {
    const prev = existing.get(i.key);
    if (prev?.addedAt) Object.assign(i, { addedAt: prev.addedAt, written: prev.written });
    else if (!prev && listedBefore) i.addedAt = now;
  }

  if (changed.length) await items.bulkPut(changed);
  if (removed.length) {
    await Promise.all([items, content, thumbs, progress, state, blobs].map((t) => t.bulkDelete(removed)));
  }
  const added = changed.filter((i) => !existing.has(i.key)).length;
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
  if (src.type === 'device') throw new Error('Images are not stored on this device.');
  const fake = { key: keyOf(item.sourceId, path), sourceId: item.sourceId, path, folder: '', sha: null };
  if (src.type === 'github') return github.readBlob(src, fake);
  return local.readFile(src, fake);
}

/* ---------------- Writing ---------------- */

async function upsertText(src, path, text, sha) {
  const item = toItem(src, { path, sha });
  const prev = await items.get(item.key);
  // Notes you write come back on a review schedule (feed.js).
  Object.assign(item, prev ? { addedAt: prev.addedAt, written: prev.written } : { addedAt: Date.now(), written: true });
  await items.put(item);
  await content.put({ key: item.key, sourceId: src.id, sha, text });
  return item;
}

/**
 * Save a note. GitHub: shown locally at once, committed by the save queue.
 * Local folder: written straight to disk.
 */
export async function writeNote(src, path, text, { message } = {}) {
  if (!canWrite(src)) throw new Error(`"${displayName(src)}" is read-only. Add a GitHub token to edit.`);
  if (src.type === 'github') {
    const exists = await items.get(keyOf(src.id, path));
    return outbox.queueWrite(src, path, text, message || `Readover: ${exists ? 'edit' : 'add'} ${path}`);
  }
  if (src.type === 'device') return upsertText(src, path, text, `dev:${Date.now()}`);
  return upsertText(src, path, text, await local.writeText(src, path, text));
}

/** Append a markdown block to a file, creating it with `header` if needed. */
export async function appendToFile(src, path, header, block, message) {
  if (!canWrite(src)) throw new Error(`"${displayName(src)}" is read-only.`);
  if (src.type === 'github') return outbox.queueAppend(src, path, header, block, message);
  if (src.type === 'device') {
    const cur = (await content.get(keyOf(src.id, path)))?.text;
    const text = `${(cur ?? header).replace(/\s*$/, '')}\n\n${block.trim()}\n`;
    return upsertText(src, path, text, `dev:${Date.now()}`);
  }
  const text = `${((await local.getText(src, path)) ?? header).replace(/\s*$/, '')}\n\n${block.trim()}\n`;
  return upsertText(src, path, text, await local.writeText(src, path, text));
}

/* ---------------- Favourites & hidden ---------------- */

/** Stored on the device and synced through the data home (see sync.js). */
export function setFlag(item, flag, on) {
  return store.patchState(item, { [flag]: on ? Date.now() : 0 });
}

/* ---------------- Moving on-device notes into a repo ---------------- */

/**
 * Copy every note from the on-device notebook into a GitHub repo as ONE commit,
 * carry over favourites and history, then remove them from the device notebook.
 * Paths that already exist in the repo get " (from this device)" added.
 */
export async function moveDeviceNotes(dest, folder = '', onProgress = () => {}) {
  const dev = deviceSource();
  if (!dev) return 0;
  if (!github.canWrite(dest)) throw new Error(`Add a token that can write to ${dest.owner}/${dest.repo} first.`);
  const notes = await items.byIndex('sourceId', dev.id);
  if (!notes.length) return 0;

  const prefix = folder.replace(/^\/|\/$/g, '');
  const taken = new Set((await items.byIndex('sourceId', dest.id)).map((i) => i.path));
  const plan = [];
  for (const n of notes) {
    let path = prefix ? `${prefix}/${n.path}` : n.path;
    if (taken.has(path)) path = path.replace(/(\.[^.]+)$/, ' (from this device)$1');
    taken.add(path);
    plan.push({ from: n, path, text: (await content.get(n.key))?.text ?? '' });
  }

  onProgress(`Saving ${plan.length} ${plan.length === 1 ? 'note' : 'notes'} to ${dest.owner}/${dest.repo}…`);
  const message = `Readover: add ${plan.length} ${plan.length === 1 ? 'note' : 'notes'} from this device`;
  const files = Object.fromEntries(plan.map((p) => [p.path, p.text]));
  for (let attempt = 0; ; attempt++) {
    let head = await github.headSha(dest);
    try {
      if (!head) {
        // Empty repo: the first file makes the first commit, the rest go in one more.
        const [first, ...rest] = plan;
        await github.putFile(dest, first.path, first.text, null, message);
        if (rest.length) await github.commitFiles(dest, await github.headSha(dest), Object.fromEntries(rest.map((p) => [p.path, p.text])), message);
      } else {
        await github.commitFiles(dest, head, files, message);
      }
      break;
    } catch (err) {
      if (attempt < 2 && (err.status === 422 || err.status === 409)) continue; // branch moved; try again
      throw err;
    }
  }

  // Re-home everything locally under the repo.
  const { gitBlobSha } = await import('./lib/gitsha.js');
  for (const p of plan) {
    const sha = await gitBlobSha(p.text);
    const item = { ...toItem(dest, { path: p.path, sha }), addedAt: p.from.addedAt, written: p.from.written };
    await items.put(item);
    await content.put({ key: item.key, sourceId: dest.id, sha, text: p.text });
    const st = await state.get(p.from.key);
    if (st) {
      await state.put({ ...st, key: item.key, sourceId: dest.id, path: p.path, flagsAt: st.flagsAt || (st.starred || st.hidden ? Date.now() : undefined) });
    }
  }
  await store.removeSource(dev.id, { fromSync: true });
  store.markDirty('important');
  return plan.length;
}

/** All on-device notes as a .zip of Markdown files (a backup for people without GitHub). */
export async function deviceNotesZip() {
  const dev = deviceSource();
  const { makeZip } = await import('./lib/zip.js');
  const files = [];
  for (const n of dev ? await items.byIndex('sourceId', dev.id) : []) files.push({ path: n.path, text: (await content.get(n.key))?.text ?? '' });
  return makeZip(files);
}

/* ---------------- Deleting, renaming, moving ---------------- */

const notesChanged = () => window.dispatchEvent(new CustomEvent('readover:notes-changed'));

async function forget(key) {
  await Promise.all([items, content, thumbs, progress, blobs].map((t) => t.delete(key)));
  const st = await state.get(key);
  if (st) await state.delete(key);
}

/** Delete a note. GitHub: queued (and refused if it changed elsewhere meanwhile). */
export async function deleteNote(item) {
  const src = store.getSource(item.sourceId);
  if (!canWrite(src)) throw new Error(`"${displayName(src)}" is read-only.`);
  if (src.type === 'github') await outbox.queueDelete(src, item.path);
  else if (src.type === 'local') await local.removeFile(src, item.path);
  await forget(item.key);
  notesChanged();
}

/** "Folder/New name.md" from a folder and a name, tidied. */
export function notePath(folder, name) {
  const clean = name.replace(/[\\/:*?"<>|#^[\]]+/g, '').replace(/\s+/g, ' ').trim() || 'Untitled';
  const file = /\.(md|markdown|txt)$/i.test(clean) ? clean : `${clean}.md`;
  const dir = folder.replace(/^\/+|\/+$/g, '');
  return dir ? `${dir}/${file}` : file;
}

/** Rename and/or move a note within its library. Favourites and history move with it. */
export async function moveNote(item, newPath) {
  const src = store.getSource(item.sourceId);
  if (!canWrite(src)) throw new Error(`"${displayName(src)}" is read-only.`);
  if (newPath === item.path) return item;
  const newKey = keyOf(src.id, newPath);
  if (await items.get(newKey)) throw new Error(`There's already a note at ${newPath}.`);
  const text = await readText(item);

  let moved;
  if (src.type === 'github') moved = await outbox.queueMove(src, item.path, newPath, text);
  else if (src.type === 'local') {
    const sha = await local.writeText(src, newPath, text);
    await local.removeFile(src, item.path);
    moved = await upsertText(src, newPath, text, sha);
  } else moved = await upsertText(src, newPath, text, `dev:${Date.now()}`);

  // Keep its place in the review schedule and its favourite/hidden state.
  moved = { ...moved, addedAt: item.addedAt, written: item.written };
  await items.put(moved);
  const st = await state.get(item.key);
  if (st) {
    const flagged = st.starred || st.hidden;
    await state.put({ ...st, key: newKey, path: newPath, flagsAt: flagged ? Date.now() : st.flagsAt });
    if (flagged) store.markDirty('important');
  }
  await forget(item.key);
  notesChanged();
  return moved;
}
