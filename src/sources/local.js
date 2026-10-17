// Local folder source adapter.
// mode 'handle': File System Access API (Chrome/Edge desktop & Android). Live, re-scannable, writable.
// mode 'import': <input webkitdirectory> fallback (Safari/iOS/Firefox). Files are copied into
//                IndexedDB so books still open after a reload.
import { getHandle, setHandle, blobs, keyOf } from '../store.js';
import { validateBinaryPayload, verifyRemoteSize } from '../utils/binary.js';

export const supportsHandles = () => 'showDirectoryPicker' in window;

export async function pickFolder() {
  return window.showDirectoryPicker({ id: 'readover', mode: 'read' });
}

export { setHandle };

/** 'granted' | 'prompt' | 'denied' | 'missing' */
export async function permissionState(src, write = false) {
  if (src.mode !== 'handle') return 'granted';
  const handle = await getHandle(src.id);
  if (!handle) return 'missing';
  return handle.queryPermission({ mode: write ? 'readwrite' : 'read' });
}

/** Must be called from a user gesture when state is 'prompt'. */
export async function requestPermission(src, write = false) {
  const handle = await getHandle(src.id);
  if (!handle) return false;
  const mode = write ? 'readwrite' : 'read';
  if ((await handle.queryPermission({ mode })) === 'granted') return true;
  return (await handle.requestPermission({ mode })) === 'granted';
}

const SKIP_DIRS = new Set(['node_modules', '__pycache__']);

/** Walk the folder. Returns [{ path, sha }] where sha is a cheap change marker. */
export async function listFiles(src, accept) {
  const root = await getHandle(src.id);
  if (!root) throw new Error(`Folder "${src.name}" needs to be picked again.`);
  if ((await root.queryPermission({ mode: 'read' })) !== 'granted') {
    const err = new Error(`Allow access to "${src.name}" to rescan it.`);
    err.code = 'PERMISSION';
    throw err;
  }
  const out = [];
  async function walk(dir, prefix) {
    for await (const [name, entry] of dir.entries()) {
      if (name.startsWith('.') || SKIP_DIRS.has(name)) continue;
      const path = prefix ? `${prefix}/${name}` : name;
      if (entry.kind === 'directory') await walk(entry, path);
      else if (accept(path)) {
        const file = await entry.getFile();
        out.push({ path, sha: `fs:${file.size}:${file.lastModified}` });
      }
    }
  }
  await walk(root, '');
  return out;
}

async function fileHandleFor(src, path, create = false) {
  const root = await getHandle(src.id);
  if (!root) throw new Error(`Folder "${src.name}" needs to be picked again.`);
  const parts = path.split('/');
  const name = parts.pop();
  let dir = root;
  for (const p of parts) dir = await dir.getDirectoryHandle(p, { create });
  return dir.getFileHandle(name, { create });
}

export async function readFile(src, item) {
  if (src.mode === 'import') {
    const rec = await blobs.get(item.key);
    if (!rec) throw new Error('This file was imported without its contents. Re-import the folder.');
    return rec.blob;
  }
  return (await fileHandleFor(src, item.path)).getFile();
}

export async function readText(src, item) {
  return (await readFile(src, item)).text();
}

export const canWrite = (src) => src.mode === 'handle';

/** Writes require a readwrite grant, which must come from a user gesture. */
export async function writeText(src, path, text) {
  if (!(await requestPermission(src, true))) throw new Error('Write access to the folder was not granted.');
  const fh = await fileHandleFor(src, path, true);
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
  const file = await fh.getFile();
  return `fs:${file.size}:${file.lastModified}`;
}

export async function writeBlob(src, path, blob) {
  const { body, size: expectedSize } = await validateBinaryPayload(blob);
  if (src.mode !== 'handle') {
    await blobs.put({ key: keyOf(src.id, path), sourceId: src.id, blob: body });
    return `fs:${expectedSize}:${Date.now()}`;
  }
  if (!(await requestPermission(src, true))) throw new Error('Write access to the folder was not granted.');
  const fh = await fileHandleFor(src, path, true);
  const w = await fh.createWritable();
  await w.write(body);
  await w.close();
  const file = await fh.getFile();
  verifyRemoteSize({ expectedSize, remoteSize: file.size, provider: 'Local Folder' });
  return `fs:${file.size}:${file.lastModified}`;
}

export const writeFile = writeBlob;

export async function getText(src, path) {
  try {
    return await (await fileHandleFor(src, path)).getFile().then((f) => f.text());
  } catch (err) {
    if (err.name === 'NotFoundError') return null;
    throw err;
  }
}

/** Fallback import: copy a FileList (from <input webkitdirectory>) into IndexedDB. */
export async function importFileList(src, fileList, accept, onProgress = () => {}) {
  const files = [];
  for (const file of fileList) {
    const rel = (file.webkitRelativePath || file.name).split('/');
    if (rel.length > 1) rel.shift(); // drop the picked folder's own name
    const path = rel.join('/');
    if (rel.some((p) => p.startsWith('.') || SKIP_DIRS.has(p)) || !accept(path)) continue;
    files.push({ path, file });
  }
  const records = [];
  for (let i = 0; i < files.length; i++) {
    const { path, file } = files[i];
    records.push({ key: keyOf(src.id, path), sourceId: src.id, blob: file });
    if (i % 50 === 0) onProgress(`Importing ${i + 1} of ${files.length}…`);
  }
  // Store File objects directly; IndexedDB keeps the bytes.
  for (let i = 0; i < records.length; i += 100) await blobs.bulkPut(records.slice(i, i + 100));
  return files.map(({ path, file }) => ({ path, sha: `fs:${file.size}:${file.lastModified}` }));
}

/** Delete a file from the folder (needs write permission, asked for on first use). */
export async function removeFile(src, path) {
  if (!(await requestPermission(src, true))) throw new Error('Write access to the folder was not granted.');
  const root = await getHandle(src.id);
  const parts = path.split('/');
  const name = parts.pop();
  let dir = root;
  for (const p of parts) dir = await dir.getDirectoryHandle(p);
  await dir.removeEntry(name);
}
