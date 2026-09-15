// src/db.js
import Dexie from 'https://cdn.jsdelivr.net/npm/dexie@4.0.8/+esm';

export const db = new Dexie('MarkdownDeckDB');

// Define database schema
// 1 = true, 0 = false for boolean indices in IndexedDB compatibility
db.version(1).stores({
  manifest: '&path, sha, folder, filename',
  content: '&path, fetchedAt',
  state: '&path, lastSeen, hidden, starred'
});

/**
 * Ensures a state record exists for a note path without overwriting existing data.
 */
export async function ensureNoteState(path) {
  const existing = await db.state.get(path);
  if (!existing) {
    await db.state.put({
      path,
      lastSeen: 0,
      hidden: 0,
      starred: 0
    });
  }
}

/**
 * Marks a note as seen right now (Swipe Right / Keep in rotation).
 */
export async function markSeen(path) {
  await db.state.update(path, { lastSeen: Date.now() });
}

/**
 * Hides a note from the feed permanently (Swipe Left / Archive).
 */
export async function toggleHide(path, hiddenStatus = 1) {
  await db.state.update(path, { hidden: hiddenStatus ? 1 : 0 });
}

/**
 * Toggles the starred flag (Star / Bookmark).
 */
export async function toggleStar(path) {
  const current = await db.state.get(path);
  const nextVal = current && current.starred === 1 ? 0 : 1;
  await db.state.update(path, { starred: nextVal });
  return nextVal === 1;
}

/**
 * Resets all review timestamps so the entire collection recycles.
 */
export async function resetReviewHistory() {
  await db.state.toCollection().modify({ lastSeen: 0 });
}

/**
 * Restores all hidden notes back into active rotation.
 */
export async function restoreAllHidden() {
  await db.state.toCollection().modify({ hidden: 0 });
}

/**
 * Queries and orders candidate paths for the swipe deck.
 * @param {string|null} folderFilter Optional folder path prefix (e.g. "Books")
 * @param {number} limit Number of card paths to return
 */
export async function getDeckQueue(folderFilter = null, limit = 50) {
  // 1. Get all paths that are NOT hidden
  const activeStates = await db.state
    .where('hidden')
    .equals(0)
    .toArray();

  const stateMap = new Map(activeStates.map(s => [s.path, s]));

  // 2. Fetch matching manifest records
  let manifestQuery = db.manifest;
  let candidates = await manifestQuery.toArray();

  // Apply folder filter if specified
  if (folderFilter && folderFilter !== 'ALL') {
    candidates = candidates.filter(m => m.folder.startsWith(folderFilter));
  }

  // 3. Filter only those present in active (unhidden) state
  candidates = candidates.filter(m => stateMap.has(m.path));

  // 4. Sort: unread first (lastSeen === 0), then oldest lastSeen ASC, with slight random variance
  candidates.sort((a, b) => {
    const stateA = stateMap.get(a.path);
    const stateB = stateMap.get(b.path);

    const timeA = stateA ? stateA.lastSeen : 0;
    const timeB = stateB ? stateB.lastSeen : 0;

    if (timeA === 0 && timeB !== 0) return -1;
    if (timeB === 0 && timeA !== 0) return 1;

    // Subtle random jitter (± 1 hour) so cards don't surface in strictly identical sequences
    const jitter = (Math.random() - 0.5) * 3600000;
    return (timeA + jitter) - (timeB);
  });

  return candidates.slice(0, limit);
}

/**
 * Fetches cached Markdown content for a given path.
 */
export async function getCachedContent(path) {
  return await db.content.get(path);
}

/**
 * Saves or updates raw Markdown text in the local cache.
 */
export async function setCachedContent(path, rawMarkdown) {
  await db.content.put({
    path,
    rawMarkdown,
    fetchedAt: Date.now()
  });
}
