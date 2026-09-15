// src/db.js
import Dexie from 'https://cdn.jsdelivr.net/npm/dexie@4.0.8/+esm';

const dbInstances = new Map();
let currentVaultId = null;

/**
 * Initializes and switches to an isolated IndexedDB database for a vault profile.
 */
export function initVaultDB(vaultId) {
  if (!vaultId) {
    throw new Error('A valid vaultId is required to initialize the database.');
  }

  currentVaultId = vaultId;

  if (!dbInstances.has(vaultId)) {
    const dbName = `MarkdownDeckDB_${vaultId}`;
    const db = new Dexie(dbName);

    db.version(1).stores({
      manifest: '&path, sha, folder, filename',
      content: '&path, fetchedAt',
      state: '&path, lastSeen, starred',
    });

    dbInstances.set(vaultId, db);
  }

  return dbInstances.get(vaultId);
}

/**
 * Returns the active Dexie instance.
 */
export function getActiveDB() {
  if (!currentVaultId || !dbInstances.has(currentVaultId)) {
    throw new Error('No active vault database initialized. Call initVaultDB(vaultId) first.');
  }
  return dbInstances.get(currentVaultId);
}

/**
 * Ensures a state record exists for a note without overriding existing triage data.
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
 * Updates lastSeen timestamp when a card snaps into view.
 */
export async function markSeen(path) {
  const db = getActiveDB();
  await db.state.update(path, { lastSeen: Date.now() });
}

/**
 * Toggles the starred status.
 */
export async function toggleStar(path) {
  const db = getActiveDB();
  const current = await db.state.get(path);
  const nextVal = current && current.starred === 1 ? 0 : 1;
  await db.state.update(path, { starred: nextVal });
  return nextVal === 1;
}

/**
 * Retrieves the Git SHA for a given path from the manifest.
 */
export async function getNoteSha(path) {
  const db = getActiveDB();
  const record = await db.manifest.get(path);
  return record ? record.sha : null;
}

/**
 * Updates local content and manifest immediately following a successful save/create.
 */
export async function upsertLocalNote(path, rawMarkdown, newSha) {
  const db = getActiveDB();
  const segments = path.split('/');
  const filename = segments.pop();
  const folder = segments.join('/') || 'Root';

  await db.transaction('rw', [db.manifest, db.content, db.state], async () => {
    await db.manifest.put({
      path,
      sha: newSha,
      folder,
      filename,
    });

    await db.content.put({
      path,
      rawMarkdown,
      fetchedAt: Date.now(),
    });

    await ensureNoteState(path);
  });
}

/**
 * Resets all review timestamps in the current vault so notes recycle.
 */
export async function resetReviewHistory() {
  const db = getActiveDB();
  await db.state.toCollection().modify({ lastSeen: 0 });
}

/**
 * Queries candidate notes for the infinite scroll stream.
 */
export async function getDeckQueue(folderFilter = null, limit = 20) {
  const db = getActiveDB();

  const allStates = await db.state.toArray();
  const stateMap = new Map(allStates.map((s) => [s.path, s]));

  let candidates = await db.manifest.toArray();

  if (folderFilter && folderFilter !== 'ALL') {
    candidates = candidates.filter((m) => m.folder.startsWith(folderFilter));
  }

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
 * Retrieves raw Markdown text from the active vault's local cache.
 */
export async function getCachedContent(path) {
  const db = getActiveDB();
  return await db.content.get(path);
}

/**
 * Stores raw Markdown text in the active vault's local cache.
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
 * Purges the database for a specific vault profile.
 */
export async function deleteVaultDB(vaultId) {
  if (dbInstances.has(vaultId)) {
    const db = dbInstances.get(vaultId);
    db.close();
    dbInstances.delete(vaultId);
  }
  await Dexie.delete(`MarkdownDeckDB_${vaultId}`);
}
