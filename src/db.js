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

    // Indexed fields: path is primary key; lastSeen and starred are queryable
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
 * Ensures a state record exists for a note without overriding existing data.
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
 * Toggles the starred/favorite status.
 */
export async function toggleStar(path) {
  const db = getActiveDB();
  const current = await db.state.get(path);
  const nextVal = current && current.starred === 1 ? 0 : 1;
  await db.state.update(path, { starred: nextVal });
  return nextVal === 1;
}

/**
 * Resets all review timestamps in the current vault so notes recycle from the beginning.
 */
export async function resetReviewHistory() {
  const db = getActiveDB();
  await db.state.toCollection().modify({ lastSeen: 0 });
}

/**
 * Queries candidate notes for the infinite scroll stream.
 * 
 * Priority:
 * 1. Unseen notes (lastSeen === 0)
 * 2. Notes seen furthest in the past (lastSeen ASC)
 * 3. Soft jitter to avoid strictly deterministic ordering
 * 
 * @param {string|null} folderFilter - Optional folder path prefix
 * @param {number} limit - Number of card paths to return
 */
export async function getDeckQueue(folderFilter = null, limit = 20) {
  const db = getActiveDB();

  const allStates = await db.state.toArray();
  const stateMap = new Map(allStates.map((s) => [s.path, s]));

  let candidates = await db.manifest.toArray();

  if (folderFilter && folderFilter !== 'ALL') {
    candidates = candidates.filter((m) => m.folder.startsWith(folderFilter));
  }

  // Sort unseen first, then oldest seen with jitter
  candidates.sort((a, b) => {
    const stateA = stateMap.get(a.path);
    const stateB = stateMap.get(b.path);

    const timeA = stateA ? stateA.lastSeen : 0;
    const timeB = stateB ? stateB.lastSeen : 0;

    if (timeA === 0 && timeB !== 0) return -1;
    if (timeB === 0 && timeA !== 0) return 1;

    // Subtle random jitter (± 1 hour) keeps the feed feeling organic
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
