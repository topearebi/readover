// src/db.js
import Dexie from 'https://cdn.jsdelivr.net/npm/dexie@4.0.8/+esm';

// Cache open DB instances so switching between repos doesn't re-instantiate Dexie objects
const dbInstances = new Map();
let currentVaultId = null;

/**
 * Initializes and switches to an isolated IndexedDB database for a specific vault profile.
 * @param {string} vaultId - Unique identifier for the vault profile
 */
export function initVaultDB(vaultId) {
  if (!vaultId) {
    throw new Error('A valid vaultId is required to initialize the database.');
  }

  currentVaultId = vaultId;

  if (!dbInstances.has(vaultId)) {
    const dbName = `MarkdownDeckDB_${vaultId}`;
    const db = new Dexie(dbName);

    // Schema: 1 = true, 0 = false for numeric boolean indexing in IndexedDB
    db.version(1).stores({
      manifest: '&path, sha, folder, filename',
      content: '&path, fetchedAt',
      state: '&path, lastSeen, hidden, starred',
    });

    dbInstances.set(vaultId, db);
  }

  return dbInstances.get(vaultId);
}

/**
 * Returns the currently active database instance.
 */
export function getActiveDB() {
  if (!currentVaultId || !dbInstances.has(currentVaultId)) {
    throw new Error('No active vault database initialized. Call initVaultDB(vaultId) first.');
  }
  return dbInstances.get(currentVaultId);
}

/**
 * Ensures a state record exists for a note path without overwriting existing triage flags.
 */
export async function ensureNoteState(path) {
  const db = getActiveDB();
  const existing = await db.state.get(path);
  if (!existing) {
    await db.state.put({
      path,
      lastSeen: 0,
      hidden: 0,
      starred: 0,
    });
  }
}

/**
 * Marks a note as seen right now (Swipe Right / Keep in rotation).
 */
export async function markSeen(path) {
  const db = getActiveDB();
  await db.state.update(path, { lastSeen: Date.now() });
}

/**
 * Flags a note as hidden/archived from the swipe feed (Swipe Left / Archive).
 */
export async function toggleHide(path, hiddenStatus = 1) {
  const db = getActiveDB();
  await db.state.update(path, { hidden: hiddenStatus ? 1 : 0 });
}

/**
 * Toggles the starred flag (Bookmark).
 */
export async function toggleStar(path) {
  const db = getActiveDB();
  const current = await db.state.get(path);
  const nextVal = current && current.starred === 1 ? 0 : 1;
  await db.state.update(path, { starred: nextVal });
  return nextVal === 1;
}

/**
 * Resets all review timestamps in the current vault so notes recycle.
 */
export async function resetReviewHistory() {
  const db = getActiveDB();
  await db.state.toCollection().modify({ lastSeen: 0 });
}

/**
 * Restores all hidden notes in the current vault back into rotation.
 */
export async function restoreAllHidden() {
  const db = getActiveDB();
  await db.state.toCollection().modify({ hidden: 0 });
}

/**
 * Queries and prioritizes card candidates for the active vault.
 * @param {string|null} folderFilter - Optional folder path prefix
 * @param {number} limit - Number of card paths to return
 */
export async function getDeckQueue(folderFilter = null, limit = 50) {
  const db = getActiveDB();

  // 1. Fetch only paths that are NOT hidden
  const activeStates = await db.state
    .where('hidden')
    .equals(0)
    .toArray();

  const stateMap = new Map(activeStates.map((s) => [s.path, s]));

  // 2. Fetch manifest records matching active states
  let candidates = await db.manifest.toArray();

  if (folderFilter && folderFilter !== 'ALL') {
    candidates = candidates.filter((m) => m.folder.startsWith(folderFilter));
  }

  candidates = candidates.filter((m) => stateMap.has(m.path));

  // 3. Sort: unreviewed first (lastSeen === 0), then oldest lastSeen ASC + random jitter
  candidates.sort((a, b) => {
    const stateA = stateMap.get(a.path);
    const stateB = stateMap.get(b.path);

    const timeA = stateA ? stateA.lastSeen : 0;
    const timeB = stateB ? stateB.lastSeen : 0;

    if (timeA === 0 && timeB !== 0) return -1;
    if (timeB === 0 && timeA !== 0) return 1;

    // Jitter (± 1 hour) prevents deterministic card sequencing across runs
    const jitter = (Math.random() - 0.5) * 3600000;
    return timeA + jitter - timeB;
  });

  return candidates.slice(0, limit);
}

/**
 * Fetches cached raw Markdown content from the active vault's DB.
 */
export async function getCachedContent(path) {
  const db = getActiveDB();
  return await db.content.get(path);
}

/**
 * Writes or updates raw Markdown text into the active vault's cache.
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
 * Deletes the entire IndexedDB database for a given vault (used when deleting a profile).
 */
export async function deleteVaultDB(vaultId) {
  if (dbInstances.has(vaultId)) {
    const db = dbInstances.get(vaultId);
    db.close();
    dbInstances.delete(vaultId);
  }
  await Dexie.delete(`MarkdownDeckDB_${vaultId}`);
}
