// src/local-fs.js
import { getActiveDB, ensureNoteState } from './db.js';

const HANDLES_DB_NAME = 'ReadOver_HandlesDB';
const HANDLES_STORE_NAME = 'dir_handles';
const LOCAL_PROFILES_KEY = 'readover_local_profiles';

const SUPPORTED_EXTENSIONS = {
  md: 'text',
  txt: 'text',
  epub: 'epub',
  pdf: 'pdf',
};

/**
 * Lightweight IndexedDB wrapper to persist FileSystemDirectoryHandle instances.
 */
function openHandlesDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HANDLES_DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(HANDLES_STORE_NAME)) {
        db.createObjectStore(HANDLES_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function setStoredHandle(id, handle) {
  const db = await openHandlesDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLES_STORE_NAME, 'readwrite');
    tx.objectStore(HANDLES_STORE_NAME).put(handle, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getStoredHandle(id) {
  const db = await openHandlesDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLES_STORE_NAME, 'readonly');
    const req = tx.objectStore(HANDLES_STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function removeStoredHandle(id) {
  const db = await openHandlesDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLES_STORE_NAME, 'readwrite');
    tx.objectStore(HANDLES_STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Local Folder Profiles
 */
export function getLocalProfiles() {
  const data = localStorage.getItem(LOCAL_PROFILES_KEY);
  return data ? JSON.parse(data) : [];
}

export function saveLocalProfile(profile) {
  const profiles = getLocalProfiles();
  const idx = profiles.findIndex((p) => p.id === profile.id);
  if (idx !== -1) {
    profiles[idx] = profile;
  } else {
    profiles.push(profile);
  }
  localStorage.setItem(LOCAL_PROFILES_KEY, JSON.stringify(profiles));
}

export async function deleteLocalProfile(id) {
  let profiles = getLocalProfiles();
  profiles = profiles.filter((p) => p.id !== id);
  localStorage.setItem(LOCAL_PROFILES_KEY, JSON.stringify(profiles));
  await removeStoredHandle(id);
}

/**
 * Checks and requests permission to read from a persisted DirectoryHandle.
 */
export async function verifyPermission(fileHandle, readWrite = false) {
  const options = { mode: readWrite ? 'readwrite' : 'read' };
  if ((await fileHandle.queryPermission(options)) === 'granted') {
    return true;
  }
  if ((await fileHandle.requestPermission(options)) === 'granted') {
    return true;
  }
  return false;
}

/**
 * Triggers native Directory Picker, stores handle, and records local profile.
 */
export async function pickLocalDirectory() {
  if (!('showDirectoryPicker' in window)) {
    throw new Error('NATIVE_PICKER_UNSUPPORTED');
  }

  const handle = await window.showDirectoryPicker({
    mode: 'read',
  });

  const profileId = `local_${Date.now()}`;
  const profile = {
    id: profileId,
    name: handle.name || 'Local Library',
    type: 'local',
  };

  await setStoredHandle(profileId, handle);
  saveLocalProfile(profile);

  return { profile, handle };
}

/**
 * Retrieves the persisted DirectoryHandle for a given profile ID.
 */
export async function getDirectoryHandle(profileId) {
  const handle = await getStoredHandle(profileId);
  if (!handle) {
    throw new Error('Directory handle not found. Re-select the folder.');
  }
  const hasPermission = await verifyPermission(handle);
  if (!hasPermission) {
    throw new Error('Permission denied to access local directory.');
  }
  return handle;
}

/**
 * Recursively scans a DirectoryHandle and indexes supported documents.
 * 
 * @param {string} profileId - Local profile ID
 * @param {Function} onProgress - Progress reporter callback
 * @returns {Promise<Array<string>>} List of unique discovered folder paths
 */
export async function scanLocalDirectory(profileId, onProgress = () => {}) {
  const rootHandle = await getDirectoryHandle(profileId);
  const db = getActiveDB();
  const discoveredPaths = new Set();
  const folders = new Set();

  onProgress('Scanning local documents...');

  async function walk(dirHandle, relativePath = '') {
    for await (const [name, entry] of dirHandle.entries()) {
      if (name.startsWith('.')) continue; // skip hidden folders (.git, .obsidian)

      const entryRelPath = relativePath ? `${relativePath}/${name}` : name;

      if (entry.kind === 'directory') {
        folders.add(entryRelPath);
        await walk(entry, entryRelPath);
      } else if (entry.kind === 'file') {
        const ext = name.split('.').pop().toLowerCase();
        const mediaType = SUPPORTED_EXTENSIONS[ext];

        if (mediaType) {
          discoveredPaths.add(entryRelPath);
          const folder = relativePath || 'Root';

          await db.manifest.put({
            path: entryRelPath,
            sha: `fs_${entry.name}_${Date.now()}`,
            folder,
            filename: name,
            mediaType,
            sourceType: 'local',
          });

          await ensureNoteState(entryRelPath);
        }
      }
    }
  }

  await walk(rootHandle);

  // Purge removed records
  const localRecords = await db.manifest.toArray();
  for (const record of localRecords) {
    if (record.sourceType === 'local' && !discoveredPaths.has(record.path)) {
      await db.manifest.delete(record.path);
      await db.content.delete(record.path);
      await db.state.delete(record.path);
      if (db.thumbnails) await db.thumbnails.delete(record.path);
      if (db.progress) await db.progress.delete(record.path);
    }
  }

  onProgress(`Discovered ${discoveredPaths.size} documents.`);
  return Array.from(folders).sort();
}

/**
 * Traverses a relative path down a DirectoryHandle to retrieve a File object.
 * 
 * @param {string} profileId - Local profile ID
 * @param {string} relativePath - Relative path to file (e.g., "books/design.epub")
 * @returns {Promise<File>}
 */
export async function getLocalFileBlob(profileId, relativePath) {
  const rootHandle = await getDirectoryHandle(profileId);
  const segments = relativePath.split('/');
  const filename = segments.pop();

  let currentDir = rootHandle;
  for (const segment of segments) {
    currentDir = await currentDir.getDirectoryHandle(segment);
  }

  const fileHandle = await currentDir.getFileHandle(filename);
  return await fileHandle.getFile();
}

/**
 * Fallback scanner for FileList objects (iOS Safari / <input webkitdirectory>)
 */
export async function indexFallbackDirectory(fileList, onProgress = () => {}) {
  const db = getActiveDB();
  const folders = new Set();
  let count = 0;

  for (const file of fileList) {
    const relPath = file.webkitRelativePath || file.name;
    const ext = file.name.split('.').pop().toLowerCase();
    const mediaType = SUPPORTED_EXTENSIONS[ext];

    if (mediaType) {
      count++;
      const segments = relPath.split('/');
      segments.shift(); // Remove root directory name
      const cleanPath = segments.join('/');
      const filename = file.name;
      const folder = segments.slice(0, -1).join('/') || 'Root';

      if (folder !== 'Root') folders.add(folder);

      await db.manifest.put({
        path: cleanPath || filename,
        sha: `fallback_${file.name}_${file.lastModified}`,
        folder,
        filename,
        mediaType,
        sourceType: 'local_fallback',
      });

      // For fallback mode without handles, cache small text files directly
      if (mediaType === 'text') {
        const text = await file.text();
        await db.content.put({
          path: cleanPath || filename,
          rawMarkdown: text,
          fetchedAt: Date.now(),
        });
      }

      await ensureNoteState(cleanPath || filename);
    }
  }

  onProgress(`Indexed ${count} documents.`);
  return Array.from(folders).sort();
}
