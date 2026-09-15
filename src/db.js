// src/db.js
import Dexie from 'https://cdn.jsdelivr.net/npm/dexie@4.0.8/+esm';

const dbInstances = new Map();
let currentVaultId = null;

/**
 * Initializes and switches to an isolated IndexedDB database for a vault or local folder.
 * Migrates smoothly from v1 (Markdown-only) to v2 (Multi-format media engine).
 * 
 * @param {string} vaultId - Unique identifier for the vault or folder
 * @returns {Dexie} The configured Dexie instance
 */
export function initVaultDB(vaultId) {
  if (!vaultId) {
    throw new Error('A valid vaultId is required to initialize the database.');
  }

  currentVaultId = vaultId;

  if (!dbInstances.has(vaultId)) {
    const dbName = `MarkdownDeckDB_${vaultId}`;
    const db = new Dexie(dbName);

    // Version 1: Legacy GitHub Markdown schema
    db.version(1).stores({
      manifest: '&path, sha, folder, filename',
      content: '&path, fetchedAt',
      state: '&path, lastSeen, starred',
    });

    // Version 2: Multi-format local/remote media schema
    db.version(2).stores({
      manifest: '&path, sha, folder, filename, mediaType, sourceType',
      content: '&path, fetchedAt',
      state: '&path, lastSeen, starred',
      thumbnails: '&path, updatedAt',
      progress: '&path, percentage, updatedAt',
    }).upgrade(async (tx) => {
      // Backfill existing records to default mediaType
      await tx.table('manifest').toCollection().modify((record) => {
        if (!record.mediaType) record.mediaType = 'text';
        if (!record.sourceType) record.sourceType = 'github';
      });
    });

    dbInstances.set(vaultId, db);
  }

  return dbInstances.get(vaultId);
}

/**
 * Returns the active Dexie database instance.
 */
export function getActiveDB() {
  if (!currentVaultId || !dbInstances.has(currentVaultId)) {
    throw new Error('No active vault database initialized. Call initVaultDB(vaultId) first.');
  }
  return dbInstances.get(currentVaultId);
}

/**
 * Returns the active vault/folder ID string.
 */
export function getCurrentVaultId() {
  return currentVaultId;
}

/**
 * Ensures a state record exists for an item without overwriting existing data.
 */
export async function ensureNoteState(path) {
  const db = getActiveDB();
  const existing = await db.state.get(path);
  if (!existing) {
    await db.state.put({
      path,
      lastSeen: 0,
      starred: 0,
    });
  }
}

/**
 * Updates the lastSeen timestamp when a card snaps into view.
 */
export async function markSeen(path) {
  const db = getActiveDB();
  await db.state.update(path, { lastSeen: Date.now() });
}

/**
 * Toggles the favorite / starred status.
 */
export async function toggleStar(path) {
  const db = getActiveDB();
  const current = await db.state.get(path);
  const nextVal = current && current.starred === 1 ? 0 : 1;
  await db.state.update(path, { starred: nextVal });
  return nextVal === 1;
}

/**
 * Retrieves the Git or content SHA for an item from the manifest.
 */
export async function getNoteSha(path) {
  const db = getActiveDB();
  const record = await db.manifest.get(path);
  return record ? record.sha : null;
}

/**
 * Updates local content and manifest immediately following a save or file import.
 */
export async function upsertLocalNote(path, rawMarkdown, sha, mediaType = 'text', sourceType = 'github') {
  const db = getActiveDB();
  const segments = path.split('/');
  const filename = segments.pop();
  const folder = segments.join('/') || 'Root';

  await db.transaction('rw', [db.manifest, db.content, db.state], async () => {
    await db.manifest.put({
      path,
      sha: sha || `local_${Date.now()}`,
      folder,
      filename,
      mediaType,
      sourceType,
    });

    if (rawMarkdown !== null) {
      await db.content.put({
        path,
        rawMarkdown,
        fetchedAt: Date.now(),
      });
    }

    await ensureNoteState(path);
  });
}

/**
 * Saves or updates a cached binary thumbnail image blob.
 * 
 * @param {string} path - Document relative path
 * @param {Blob} imageBlob - WebP/JPEG image blob
 */
export async function setCachedThumbnail(path, imageBlob) {
  const db = getActiveDB();
  await db.thumbnails.put({
    path,
    blob: imageBlob,
    updatedAt: Date.now(),
  });
}

/**
 * Retrieves a cached cover thumbnail blob.
 * 
 * @param {string} path - Document relative path
 * @returns {Promise<Blob|null>}
 */
export async function getCachedThumbnail(path) {
  const db = getActiveDB();
  const record = await db.thumbnails.get(path);
  return record ? record.blob : null;
}

/**
 * Saves reading progress position and percentage.
 * 
 * @param {string} path - Document relative path
 * @param {number} percentage - Decimal between 0.0 and 1.0
 * @param {string|number} location - Page number or EPUB CFI string
 */
export async function saveReadingProgress(path, percentage, location) {
  const db = getActiveDB();
  await db.progress.put({
    path,
    percentage: Math.min(Math.max(percentage, 0), 1),
    location: String(location),
    updatedAt: Date.now(),
  });
}

/**
 * Retrieves reading progress for a given document.
 * 
 * @param {string} path - Document relative path
 * @returns {Promise<Object|null>} { percentage, location, updatedAt }
 */
export async function getReadingProgress(path) {
  const db = getActiveDB();
  return await db.progress.get(path);
}

/**
 * Resets all review timestamps in the current vault so cards recycle.
 */
export async function resetReviewHistory() {
  const db = getActiveDB();
  await db.state.toCollection().modify({ lastSeen: 0 });
}

/**
 * Queries candidate items for the infinite scroll stream with support for folder
 * and media type filters.
 * 
 * @param {string|null} folderFilter - Folder prefix or 'ALL'
 * @param {string} mediaFilter - 'all', 'text', 'epub', 'pdf'
 * @param {number} limit - Number of candidates to return
 */
export async function getDeckQueue(folderFilter = null, mediaFilter = 'all', limit = 20) {
  const db = getActiveDB();

  const allStates = await db.state.toArray();
  const stateMap = new Map(allStates.map((s) => [s.path, s]));

  let candidates = await db.manifest.toArray();

  if (folderFilter && folderFilter !== 'ALL') {
    candidates = candidates.filter((m) => m.folder.startsWith(folderFilter));
  }

  if (mediaFilter && mediaFilter !== 'all') {
    candidates = candidates.filter((m) => m.mediaType === mediaFilter);
  }

  // Sort unseen items first, then oldest reviewed items with soft jitter
  candidates.sort((a, b) => {
    const stateA = stateMap.get(a.path);
    const stateB = stateMap.get(b.path);

    const timeA = stateA ? stateA.lastSeen : 0;
    const timeB = stateB ? stateB.lastSeen : 0;

    if (timeA === 0 && timeB !== 0) return -1;
    if (timeB === 0 && timeA !== 0) return 1;

    const jitter = (Math.random() - 0.5) * 3600000;
    return timeA + jitter - timeB;
  });

  return candidates.slice(0, limit);
}

/**
 * Retrieves cached text content for notes.
 */
export async function getCachedContent(path) {
  const db = getActiveDB();
  return await db.content.get(path);
}

/**
 * Caches text content for notes.
 */
export async function setCachedContent(path, rawMarkdown) {
  const db = getActiveDB();
  await db.content.put({
    path,
    rawMarkdown,
    fetchedAt: Date.now(),
  });
}

/**
 * Purges the database instance and stored data for a vault or directory.
 */
export async function deleteVaultDB(vaultId) {
  if (dbInstances.has(vaultId)) {
    const db = dbInstances.get(vaultId);
    db.close();
    dbInstances.delete(vaultId);
  }
  await Dexie.delete(`MarkdownDeckDB_${vaultId}`);
}
