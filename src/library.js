// Library: the one place that knows about sources. Listing, reading, writing.
// Favourites, progress and history sync through the data home (sync.js).
import * as store from './store.js';
import * as github from './sources/github.js';
import * as local from './sources/local.js';
import * as dropbox from './sources/dropbox.js';
import * as webdav from './sources/webdav.js';
import * as s3 from './sources/s3.js';
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

const adapter = (src) => {
  if (src.type === 'github') return github;
  if (src.type === 'dropbox') return dropbox;
  if (src.type === 'webdav') return webdav;
  if (src.type === 's3' || src.type === 'r2') return s3;
  if (src.type === 'device') return device;
  return local;
};

export function canWrite(src) {
  return src ? adapter(src).canWrite(src) : false;
}

export function displayName(src) {
  if (src.type === 'device') return 'This device';
  if (src.name) return src.name;
  if (src.type === 'github') return `${src.owner}/${src.repo}`;
  if (src.type === 'dropbox') return 'Dropbox (/Apps/Readover)';
  if (src.type === 'webdav') {
    try {
      return `WebDAV (${new URL(src.url).hostname})`;
    } catch {
      return 'WebDAV';
    }
  }
  if (src.type === 's3' || src.type === 'r2') return `${src.bucket} (${src.type === 'r2' ? 'R2' : 'S3'})`;
  return 'Folder';
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
  } else if (src.type === 'dropbox') {
    onProgress(`Checking Dropbox…`);
    files = await dropbox.listFiles(src);
  } else if (src.type === 'webdav') {
    onProgress(`Scanning WebDAV…`);
    files = await webdav.listFiles(src, acceptFor(src), onProgress);
  } else if (src.type === 's3' || src.type === 'r2') {
    onProgress(`Listing S3/R2 bucket…`);
    files = await s3.listFiles(src, acceptFor(src), onProgress);
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
  // A note moved or renamed elsewhere shows up as removed + added with the same
  // content (same sha): it keeps its last-change date, review schedule and copy.
  const gone = new Map();
  for (const k of removed) {
    const old = existing.get(k);
    if (old?.sha && !gone.has(old.sha)) gone.set(old.sha, old);
  }
  const carried = [];
  for (const i of changed) {
    const prev = existing.get(i.key);
    const was = !prev ? gone.get(i.sha) : null;
    if (was) {
      gone.delete(i.sha);
      if (was.changedSha === i.sha) Object.assign(i, { changedAt: was.changedAt, changedSha: was.changedSha });
      Object.assign(i, { addedAt: was.addedAt, written: was.written });
      carried.push([was.key, i.key]);
    } else if (prev?.addedAt) Object.assign(i, { addedAt: prev.addedAt, written: prev.written });
    else if (!prev && listedBefore) i.addedAt = now;
  }
  for (const [from, to] of carried) {
    const c = await content.get(from);
    if (c) await content.put({ ...c, key: to });
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

/** Books and media from cloud sources are cached by sha so they open offline and don't re-download. */
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
  const blob = await adapter(src).readBlob(src, item, type);
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

  // 1. Check local IndexedDB cache first
  const directKey = keyOf(item.sourceId, path);
  const cached = await blobs.get(directKey);
  if (cached?.blob) return cached.blob;

  // 2. Check on-device blob cache
  const deviceCached = await blobs.get(keyOf(DEVICE_ID, path));
  if (deviceCached?.blob) return deviceCached.blob;

  // 3. Check any configured S3 / R2 attachment vaults
  const s3Sources = store.getSources().filter((s) => s.type === 's3' || s.type === 'r2');
  for (const s3Src of s3Sources) {
    const s3Key = keyOf(s3Src.id, path);
    const s3Cached = await blobs.get(s3Key);
    if (s3Cached?.blob) return s3Cached.blob;
    try {
      const b = await s3.readBlob(s3Src, { path }, '');
      if (b) {
        blobs.put({ key: s3Key, sourceId: s3Src.id, sha: `att:${Date.now()}`, blob: b }).catch(() => {});
        return b;
      }
    } catch {}
  }

  // 4. Check any configured Dropbox attachment vaults
  const dbxSources = store.getSources().filter((s) => s.type === 'dropbox');
  for (const dbxSrc of dbxSources) {
    const dbxKey = keyOf(dbxSrc.id, path);
    const dbxCached = await blobs.get(dbxKey);
    if (dbxCached?.blob) return dbxCached.blob;
    try {
      const b = await dropbox.readBlob(dbxSrc, { path }, '');
      if (b) {
        blobs.put({ key: dbxKey, sourceId: dbxSrc.id, sha: `att:${Date.now()}`, blob: b }).catch(() => {});
        return b;
      }
    } catch {}
  }

  if (!src || src.type === 'device') throw new Error('Attachment not found locally.');
  const fake = { key: directKey, sourceId: item.sourceId, path, folder: '', sha: null };
  if (src.type === 'github') return github.readBlob(src, fake);
  if (src.type === 'dropbox') return dropbox.readBlob(src, fake);
  if (src.type === 'webdav') return webdav.readBlob(src, fake);
  if (src.type === 's3' || src.type === 'r2') return s3.readBlob(src, fake);
  return local.readFile(src, fake);
}

/**
 * Saves an attachment (compressed WebP image/sketch) to the appropriate vault
 * and caches in IndexedDB for instant offline-first rendering.
 */
export async function putAttachment(src, attachmentPath, blob) {
  const cleanPath = attachmentPath.replace(/^\/+/, '');
  const key = keyOf(src.id, cleanPath);

  // Always cache locally in IndexedDB first
  await blobs.put({ key, sourceId: src.id, sha: `att:${Date.now()}`, blob });

  if (src.type === 'device') {
    return { key, path: cleanPath, sourceId: src.id };
  }
  if (src.type === 's3' || src.type === 'r2') {
    await s3.putFile(src, cleanPath, blob);
  } else if (src.type === 'dropbox') {
    await dropbox.putFile(src, cleanPath, blob);
  } else if (src.type === 'webdav') {
    await webdav.putFile(src, cleanPath, blob);
  } else if (src.type === 'local') {
    await local.writeBlob(src, cleanPath, blob);
  }
  return { key, path: cleanPath, sourceId: src.id };
}

/**
 * Saves a book acquired from an OPDS catalog to the user's destination library.
 * Stashes metadata into items and binary into blobs and target storage provider.
 */
export async function saveAcquiredBook(targetSrc, filename, blob, meta = {}) {
  const parts = filename.split('/');
  const name = parts.pop();
  const folder = parts.join('/');
  const kind = kindOf(name) || 'epub';
  const sha = `opds:${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const key = keyOf(targetSrc.id, filename);

  const item = {
    key,
    sourceId: targetSrc.id,
    path: filename,
    folder,
    name,
    kind,
    sha,
    addedAt: Date.now(),
  };

  await items.put(item);
  await blobs.put({ key, sourceId: targetSrc.id, sha, blob });

  if (meta.title || meta.authors?.length) {
    await thumbs.put({
      key,
      sourceId: targetSrc.id,
      sha,
      title: meta.title || name.replace(/\.[^.]+$/, ''),
      author: Array.isArray(meta.authors) ? meta.authors.join(', ') : meta.authors || '',
      blob: meta.coverBlob || null,
    });
  }

  // Upload to remote storage if connected
  if (targetSrc.type === 's3' || targetSrc.type === 'r2') {
    s3.putFile(targetSrc, filename, blob).catch((err) => console.warn('Could not upload book to S3', err));
  } else if (targetSrc.type === 'dropbox') {
    dropbox.putFile(targetSrc, filename, blob).catch((err) => console.warn('Could not upload book to Dropbox', err));
  } else if (targetSrc.type === 'webdav') {
    webdav.putFile(targetSrc, filename, blob).catch((err) => console.warn('Could not upload book to WebDAV', err));
  } else if (targetSrc.type === 'local') {
    local.writeBlob(targetSrc, filename, blob).catch((err) => console.warn('Could not write book to local folder', err));
  }

  window.dispatchEvent(new CustomEvent('readover:progress'));
  return item;
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
 * Save a note. GitHub: committed by save queue.
 * Cloud/Local: written to provider directly and cached locally.
 */
export async function writeNote(src, path, text, { message } = {}) {
  if (!canWrite(src)) throw new Error(`"${displayName(src)}" is read-only. Check credentials in Settings.`);
  if (src.type === 'github') {
    const exists = await items.get(keyOf(src.id, path));
    return outbox.queueWrite(src, path, text, message || `Readover: ${exists ? 'edit' : 'add'} ${path}`);
  }
  if (src.type === 'device') return upsertText(src, path, text, `dev:${Date.now()}`);
  if (src.type === 'dropbox') {
    const sha = await dropbox.putFile(src, path, text);
    return upsertText(src, path, text, sha);
  }
  if (src.type === 'webdav') {
    const sha = await webdav.putFile(src, path, text);
    return upsertText(src, path, text, sha);
  }
  if (src.type === 's3' || src.type === 'r2') {
    const sha = await s3.putFile(src, path, text);
    return upsertText(src, path, text, sha);
  }
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
  let cur;
  try {
    cur = await adapter(src).readText(src, { path });
  } catch {}
  const text = `${(cur ?? header).replace(/\s*$/, '')}\n\n${block.trim()}\n`;
  if (src.type === 'dropbox') {
    const sha = await dropbox.putFile(src, path, text);
    return upsertText(src, path, text, sha);
  }
  if (src.type === 'webdav') {
    const sha = await webdav.putFile(src, path, text);
    return upsertText(src, path, text, sha);
  }
  if (src.type === 's3' || src.type === 'r2') {
    const sha = await s3.putFile(src, path, text);
    return upsertText(src, path, text, sha);
  }
  return upsertText(src, path, text, await local.writeText(src, path, text));
}

/* ---------------- Favourites & hidden ---------------- */

/** Stored on the device and synced through the data home (see sync.js). */
export function setFlag(item, flag, on) {
  return store.patchState(item, { [flag]: on ? Date.now() : 0 });
}

/* ---------------- Moving notes between storage libraries ---------------- */

/** All notes from a library (or folder) as a .zip of Markdown files. */
export async function sourceNotesZip(sourceId, folder = '') {
  const { makeZip } = await import('./lib/zip.js');
  const allNotes = await items.byIndex('sourceId', sourceId);
  const prefix = folder ? `${folder.replace(/^\/+|\/+$/g, '')}/` : '';
  const filtered = allNotes.filter((n) => {
    if (!/\.(md|markdown|txt)$/i.test(n.path)) return false;
    if (folder) return n.path === folder || n.path.startsWith(prefix);
    return true;
  });
  const files = [];
  for (const n of filtered) {
    const text = (await content.get(n.key))?.text ?? (await readText(n).catch(() => ''));
    const relPath = folder && n.path.startsWith(prefix) ? n.path.slice(prefix.length) : n.path;
    files.push({ path: relPath, text: text || '' });
  }
  return makeZip(files);
}

/** All on-device notes as a .zip of Markdown files (a backup for people without cloud storage). */
export async function deviceNotesZip() {
  const dev = deviceSource(false);
  return sourceNotesZip(dev?.id || DEVICE_ID);
}

/**
 * Move notes from one storage provider to another.
 * Works across Device, GitHub, Dropbox, WebDAV, Local, S3/R2.
 * @param {string} fromSourceId
 * @param {string} toSourceId
 * @param {object} [options]
 * @param {string[]} [options.noteKeys] - Specific note keys to move (if omitted, moves all notes from fromSourceId)
 * @param {string} [options.targetFolder] - Optional subfolder in destination
 * @param {function} [options.onProgress]
 */
export async function moveNotesBetweenSources(fromSourceId, toSourceId, { noteKeys = null, targetFolder = '', onProgress = () => {} } = {}) {
  if (fromSourceId === toSourceId) {
    throw new Error('Source and destination libraries must be different.');
  }
  const fromSrc = fromSourceId === DEVICE_ID ? deviceSource(false) || { id: DEVICE_ID, type: 'device', root: '', name: 'This device' } : store.getSource(fromSourceId);
  const destSrc = toSourceId === DEVICE_ID ? deviceSource(true) : store.getSource(toSourceId);

  if (!fromSrc) throw new Error('Source library not found.');
  if (!destSrc) throw new Error('Destination library not found.');
  if (!canWrite(destSrc)) throw new Error(`"${displayName(destSrc)}" is read-only.`);

  let notesToMove = [];
  if (noteKeys && Array.isArray(noteKeys) && noteKeys.length > 0) {
    const keySet = new Set(noteKeys);
    const candidateNotes = await items.byIndex('sourceId', fromSrc.id);
    notesToMove = candidateNotes.filter((n) => keySet.has(n.key) && /\.(md|markdown|txt)$/i.test(n.path));
  } else {
    const candidateNotes = await items.byIndex('sourceId', fromSrc.id);
    notesToMove = candidateNotes.filter((n) => /\.(md|markdown|txt)$/i.test(n.path));
  }

  if (!notesToMove.length) return 0;

  const destExisting = new Set((await items.byIndex('sourceId', destSrc.id)).map((i) => i.path));
  const destRoot = String(destSrc.root || '').replace(/^\/+|\/+$/g, '');
  const cleanTargetFolder = String(targetFolder || '').replace(/^\/+|\/+$/g, '');
  const prefix = [destRoot, cleanTargetFolder].filter(Boolean).join('/');

  // Prepare migration plan
  const plan = [];
  for (const n of notesToMove) {
    let destPath = prefix ? `${prefix}/${n.path}` : n.path;
    if (destRoot && destPath.startsWith(`${destRoot}/${destRoot}/`)) {
      destPath = destPath.slice(destRoot.length + 1);
    }
    if (destExisting.has(destPath)) {
      destPath = destPath.replace(/(\.[^.]+)$/, ` (from ${displayName(fromSrc)})$1`);
    }
    destExisting.add(destPath);
    const noteText = (await content.get(n.key))?.text ?? (await readText(n).catch(() => ''));
    plan.push({ from: n, destPath, text: noteText || '' });
  }

  onProgress(`Saving ${plan.length} ${plan.length === 1 ? 'note' : 'notes'} to ${displayName(destSrc)}…`);

  // Write files to destination provider
  if (destSrc.type === 'github') {
    const message = `Readover: move ${plan.length} ${plan.length === 1 ? 'note' : 'notes'} from ${displayName(fromSrc)}`;
    const files = Object.fromEntries(plan.map((p) => [p.destPath, p.text]));
    for (let attempt = 0; ; attempt++) {
      let head = await github.headSha(destSrc);
      try {
        if (!head) {
          const [first, ...rest] = plan;
          await github.putFile(destSrc, first.destPath, first.text, null, message);
          if (rest.length) {
            await github.commitFiles(destSrc, await github.headSha(destSrc), Object.fromEntries(rest.map((p) => [p.destPath, p.text])), message);
          }
        } else {
          await github.commitFiles(destSrc, head, files, message);
        }
        break;
      } catch (err) {
        if (attempt < 2 && (err.status === 422 || err.status === 409)) continue;
        throw err;
      }
    }
  } else if (destSrc.type === 'dropbox') {
    for (let i = 0; i < plan.length; i++) {
      const p = plan[i];
      onProgress(`Writing ${i + 1}/${plan.length}: ${p.destPath}…`);
      p.sha = await dropbox.putFile(destSrc, p.destPath, p.text);
    }
  } else if (destSrc.type === 'webdav') {
    for (let i = 0; i < plan.length; i++) {
      const p = plan[i];
      onProgress(`Writing ${i + 1}/${plan.length}: ${p.destPath}…`);
      p.sha = await webdav.putFile(destSrc, p.destPath, p.text);
    }
  } else if (destSrc.type === 's3' || destSrc.type === 'r2') {
    for (let i = 0; i < plan.length; i++) {
      const p = plan[i];
      onProgress(`Writing ${i + 1}/${plan.length}: ${p.destPath}…`);
      p.sha = await s3.putFile(destSrc, p.destPath, p.text);
    }
  } else if (destSrc.type === 'local') {
    for (let i = 0; i < plan.length; i++) {
      const p = plan[i];
      p.sha = await local.writeText(destSrc, p.destPath, p.text);
    }
  } else {
    // destSrc.type === 'device'
    for (const p of plan) {
      p.sha = `dev:${Date.now()}`;
    }
  }

  // Calculate git sha if needed for local index
  const { gitBlobSha } = await import('./lib/gitsha.js');

  // Re-home everything locally under destination library
  for (const p of plan) {
    const sha = p.sha || (await gitBlobSha(p.text));
    const newItem = {
      ...toItem(destSrc, { path: p.destPath, sha }),
      addedAt: p.from.addedAt,
      written: p.from.written,
    };
    const was = /^dev:(\d+)$/.exec(p.from.sha || '');
    if (was) Object.assign(newItem, { changedAt: Number(was[1]), changedSha: sha });
    await items.put(newItem);
    await content.put({ key: newItem.key, sourceId: destSrc.id, sha, text: p.text });

    const st = await state.get(p.from.key);
    if (st) {
      await state.put({
        ...st,
        key: newItem.key,
        sourceId: destSrc.id,
        path: p.destPath,
        flagsAt: st.flagsAt || (st.starred || st.hidden ? Date.now() : undefined),
      });
    }
  }

  // Delete from source provider
  onProgress('Cleaning up source library…');
  for (const p of plan) {
    try {
      if (fromSrc.type === 'github') {
        if (canWrite(fromSrc)) await outbox.queueDelete(fromSrc, p.from.path);
      } else if (fromSrc.type === 'dropbox') {
        if (canWrite(fromSrc)) await dropbox.deleteFile(fromSrc, p.from.path);
      } else if (fromSrc.type === 'webdav') {
        if (canWrite(fromSrc)) await webdav.deleteFile(fromSrc, p.from.path);
      } else if (fromSrc.type === 's3' || fromSrc.type === 'r2') {
        if (canWrite(fromSrc)) await s3.deleteFile(fromSrc, p.from.path);
      } else if (fromSrc.type === 'local') {
        if (canWrite(fromSrc)) await local.removeFile(fromSrc, p.from.path);
      }
    } catch (err) {
      console.warn(`Failed to delete source note ${p.from.path}:`, err);
    }
    await forget(p.from.key);
  }

  // If moving all notes from device, check if device notebook is empty and can be removed
  if (fromSrc.type === 'device') {
    const remaining = await items.byIndex('sourceId', fromSrc.id);
    if (!remaining.length) {
      await store.removeSource(fromSrc.id, { fromSync: true });
    }
  }

  store.markDirty('important');
  notesChanged();
  window.dispatchEvent(new CustomEvent('readover:sources-changed'));

  return plan.length;
}

export async function moveDeviceNotes(dest, folder = '', onProgress = () => {}) {
  const dev = deviceSource(false);
  if (!dev) return 0;
  return moveNotesBetweenSources(dev.id, dest.id, { targetFolder: folder, onProgress });
}

/* ---------------- Deleting, renaming, moving ---------------- */

const notesChanged = () => window.dispatchEvent(new CustomEvent('readover:notes-changed'));

async function forget(key) {
  await Promise.all([items, content, thumbs, progress, blobs].map((t) => t.delete(key)));
  const st = await state.get(key);
  if (st) await state.delete(key);
}

/**
 * Rename and/or move a note, retitle it, and update the links to it (relink.js
 * plans the changes). GitHub: one commit through the save queue. Local folders and
 * this device: file by file. Favourites and history move with it.
 */
export async function renameNote(item, newPath, plan, { message = '' } = {}) {
  const src = store.getSource(item.sourceId);
  if (!canWrite(src)) throw new Error(`"${displayName(src)}" is read-only.`);
  const { updateFrontmatter, applySubs } = await import('./notefile.js');
  const moving = newPath !== item.path;
  if (moving && (await items.get(keyOf(src.id, newPath)))) throw new Error(`There's already a note at ${newPath}.`);
  let text = await readText(item);
  if (plan.self.fmPatch) text = updateFrontmatter(text, plan.self.fmPatch);
  text = applySubs(text, plan.self.subs);
  const edits = [];
  for (const e of plan.edits) {
    const cur = await readText(e.item);
    edits.push({ item: e.item, path: e.item.path, subs: e.subs, text: applySubs(cur, e.subs) });
  }
  const retitled = Boolean(plan.self.fmPatch) || plan.self.subs.some(([a]) => /^#\s/.test(a));
  const n = plan.notes;
  const msg = message || `Readover: ${moving ? `rename ${item.path} to ${newPath}` : `retitle ${item.path}`}${n ? ` (links in ${n} ${n === 1 ? 'note' : 'notes'})` : ''}`;

  let moved;
  if (src.type === 'github') {
    moved = await outbox.queueRename(src, { from: item.path, to: newPath, text, fmPatch: plan.self.fmPatch, subs: plan.self.subs, edits, message: msg, keepClock: !retitled });
  } else if (src.type === 'local') {
    for (const e of edits) await upsertText(src, e.path, e.text, await local.writeText(src, e.path, e.text));
    const sha = await local.writeText(src, newPath, text);
    if (moving) await local.removeFile(src, item.path);
    moved = await upsertText(src, newPath, text, sha);
  } else {
    // On this device the version holds the time: link updates keep theirs.
    for (const e of edits) await upsertText(src, e.path, e.text, /^dev:/.test(e.item.sha || '') ? e.item.sha : `dev:${Date.now()}`);
    moved = await upsertText(src, newPath, text, !retitled && /^dev:/.test(item.sha || '') ? item.sha : `dev:${Date.now()}`);
  }
  if (moving) {
    moved = { ...moved, addedAt: item.addedAt, written: item.written };
    await items.put(moved);
    const st = await state.get(item.key);
    if (st) {
      const flagged = st.starred || st.hidden;
      await state.put({ ...st, key: moved.key, path: newPath, flagsAt: flagged ? Date.now() : st.flagsAt });
      if (flagged) store.markDirty('important');
    }
    await forget(item.key);
  }
  notesChanged();
  return moved;
}

/** Delete a note. GitHub: queued (and refused if it changed elsewhere meanwhile). */
export async function deleteNote(item) {
  const src = store.getSource(item.sourceId);
  if (!canWrite(src)) throw new Error(`"${displayName(src)}" is read-only.`);
  if (src.type === 'github') await outbox.queueDelete(src, item.path);
  else if (src.type === 'dropbox') await dropbox.deleteFile(src, item.path);
  else if (src.type === 'webdav') await webdav.deleteFile(src, item.path);
  else if (src.type === 's3' || src.type === 'r2') await s3.deleteFile(src, item.path);
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
export async function moveNote(item, newPath, { frontmatter = null, message = '' } = {}) {
  const src = store.getSource(item.sourceId);
  if (!canWrite(src)) throw new Error(`"${displayName(src)}" is read-only.`);
  if (newPath === item.path) return item;
  const newKey = keyOf(src.id, newPath);
  if (await items.get(newKey)) throw new Error(`There's already a note at ${newPath}.`);
  let text = await readText(item);
  if (frontmatter) {
    const { updateFrontmatter } = await import('./notefile.js');
    text = updateFrontmatter(text, frontmatter);
  }

  let moved;
  if (src.type === 'github') moved = await outbox.queueMove(src, item.path, newPath, text, frontmatter, message);
  else if (src.type === 'local') {
    const sha = await local.writeText(src, newPath, text);
    await local.removeFile(src, item.path);
    moved = await upsertText(src, newPath, text, sha);
  } else moved = await upsertText(src, newPath, text, !frontmatter && /^dev:/.test(item.sha || '') ? item.sha : `dev:${Date.now()}`); // a plain move keeps its date

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
