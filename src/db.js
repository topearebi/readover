// src/db.js
import Dexie from 'https://cdn.jsdelivr.net/npm/dexie@4.0.8/+esm';

const DB_PREFIX = 'ReadOver_';
let activeDb = null;
let activeVaultId = null;

/**
 * Initializes and binds the active Dexie database instance for a specific vault.
 */
export function initVaultDB(vaultId) {
  if (activeDb && activeVaultId === vaultId) {
    return activeDb;
  }

  if (activeDb) {
    activeDb.close();
  }

  activeVaultId = vaultId;
  const dbName = `${DB_PREFIX}${vaultId}`;
  activeDb = new Dexie(dbName);

  activeDb.version(2).stores({
    manifest: '&path, folder, filename, mediaType, sourceType',
    content: '&path, fetchedAt',
    state: '&path, lastSeen, starred',
    thumbnails: '&path',
    progress: '&path, percentage, updatedAt',
  });

  return activeDb;
}

/**
 * Returns the currently active Dexie database instance.
 */
export function getActiveDB() {
  if (!activeDb) {
    throw new Error('Database not initialized. Call initVaultDB(vaultId) first.');
  }
  return activeDb;
}

/**
 * Instantiates an ephemeral, unmemoized Dexie handle to query a target source.
 */
export function getDBForSource(sourceId) {
  if (activeDb && activeVaultId === sourceId) {
    return activeDb;
  }
  const dbName = `${DB_PREFIX}${sourceId}`;
  const db = new Dexie(dbName);
  db.version(2).stores({
    manifest: '&path, folder, filename, mediaType, sourceType',
    content: '&path, fetchedAt',
    state: '&path, lastSeen, starred',
    thumbnails: '&path',
    progress: '&path, percentage, updatedAt',
  });
  return db;
}

/**
 * Ensures note state entry exists in target or active database.
 */
export async function ensureNoteState(path, targetDb = null) {
  const db = targetDb || getActiveDB();
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
 * Updates lastSeen timestamp for TikTok-style infinite looping.
 */
export async function markSeen(path, targetDb = null) {
  const db = targetDb || getActiveDB();
  const state = await db.state.get(path);
  if (state) {
    await db.state.update(path, { lastSeen: Date.now() });
  } else {
    await db.state.put({ path, lastSeen: Date.now(), starred: 0 });
  }
}

/**
 * Toggles favorite state.
 */
export async function toggleStar(path, isStarred, targetDb = null) {
  const db = targetDb || getActiveDB();
  const state = await db.state.get(path);
  if (state) {
    await db.state.update(path, { starred: isStarred ? 1 : 0 });
  } else {
    await db.state.put({
      path,
      lastSeen: 0,
      starred: isStarred ? 1 : 0,
    });
  }
}

/**
 * Queries the next batch of cards for an individual source.
 */
export async function getDeckQueue(folder = 'ALL', mediaFilter = 'all', limit = 15, targetDb = null) {
  const db = targetDb || getActiveDB();

  let manifestQuery = db.manifest;
  let manifestRecords = [];

  if (folder !== 'ALL') {
    manifestRecords = await manifestQuery
      .filter((item) => item.folder === folder || item.folder.startsWith(`${folder}/`))
      .toArray();
  } else {
    manifestRecords = await manifestQuery.toArray();
  }

  // Filter by media format if specified
  if (mediaFilter !== 'all' && mediaFilter !== 'starred') {
    manifestRecords = manifestRecords.filter((item) => item.mediaType === mediaFilter);
  }

  if (manifestRecords.length === 0) {
    return [];
  }

  const manifestMap = new Map();
  manifestRecords.forEach((item) => manifestMap.set(item.path, item));

  const validPaths = Array.from(manifestMap.keys());
  const states = await db.state.where('path').anyOf(validPaths).toArray();

  const stateMap = new Map();
  states.forEach((s) => stateMap.set(s.path, s));

  // Starred-only subfilter
  let candidatePaths = validPaths;
  if (mediaFilter === 'starred') {
    candidatePaths = validPaths.filter((p) => stateMap.get(p)?.starred === 1);
  }

  const deck = candidatePaths.map((p) => {
    const s = stateMap.get(p);
    return {
      path: p,
      lastSeen: s ? s.lastSeen : 0,
      starred: s ? s.starred : 0,
      item: manifestMap.get(p),
    };
  });

  // Least recently seen first
  deck.sort((a, b) => a.lastSeen - b.lastSeen);

  return deck.slice(0, limit).map((d) => d.item);
}

/**
 * Universal Feed Aggregator: Queries candidates across all connected databases
 * without cross-contaminating source schemas.
 * 
 * @param {Array<Object>} sources - Array of source profile objects { id, name, type }
 * @param {string} filter - Filter type ('all' | 'starred')
 * @param {number} totalLimit - Target batch size
 * @returns {Promise<Array<Object>>} Aggregated manifest items tagged with _sourceId & _sourceType
 */
export async function getAllSourcesDeckQueue(sources = [], filter = 'all', totalLimit = 20) {
  if (sources.length === 0) return [];

  const perSourceLimit = Math.max(Math.ceil(totalLimit / sources.length), 5);
  const sourceQueues = [];

  for (const src of sources) {
    try {
      const db = getDBForSource(src.id);
      const items = await getDeckQueue('ALL', filter, perSourceLimit, db);
      const tagged = items.map((item) => ({
        ...item,
        _sourceId: src.id,
        _sourceType: src.type,
      }));
      if (tagged.length > 0) {
        sourceQueues.push(tagged);
      }
    } catch (e) {
      console.warn(`Failed querying source ${src.id}:`, e);
    }
  }

  // Interleave sources for balanced discovery
  const interleaved = [];
  let index = 0;
  let added = true;

  while (added && interleaved.length < totalLimit) {
    added = false;
    for (const queue of sourceQueues) {
      if (index < queue.length) {
        interleaved.push(queue[index]);
        added = true;
        if (interleaved.length >= totalLimit) break;
      }
    }
    index++;
  }

  return interleaved;
}

/**
 * Reading progress persistence (CFI or page count + completion %).
 */
export async function saveReadingProgress(path, percentage, location, targetSourceId = null) {
  const db = targetSourceId ? getDBForSource(targetSourceId) : getActiveDB();
  await db.progress.put({
    path,
    percentage: Math.min(Math.max(percentage, 0), 1),
    location: String(location),
    updatedAt: Date.now(),
  });
}

export async function getReadingProgress(path, targetSourceId = null) {
  const db = targetSourceId ? getDBForSource(targetSourceId) : getActiveDB();
  return await db.progress.get(path);
}

/**
 * Thumbnail blob cache accessors.
 */
export async function setCachedThumbnail(path, blob, targetSourceId = null) {
  const db = targetSourceId ? getDBForSource(targetSourceId) : getActiveDB();
  await db.thumbnails.put({
    path,
    blob,
    cachedAt: Date.now(),
  });
}

export async function getCachedThumbnail(path, targetSourceId = null) {
  const db = targetSourceId ? getDBForSource(targetSourceId) : getActiveDB();
  const record = await db.thumbnails.get(path);
  return record ? record.blob : null;
}

/**
 * Content cache accessors.
 */
export async function getCachedContent(path, targetSourceId = null) {
  const db = targetSourceId ? getDBForSource(targetSourceId) : getActiveDB();
  return await db.content.get(path);
}

export async function setCachedContent(path, rawMarkdown, targetSourceId = null) {
  const db = targetSourceId ? getDBForSource(targetSourceId) : getActiveDB();
  await db.content.put({
    path,
    rawMarkdown,
    fetchedAt: Date.now(),
  });
}

export async function getNoteSha(path, targetSourceId = null) {
  const db = targetSourceId ? getDBForSource(targetSourceId) : getActiveDB();
  const item = await db.manifest.get(path);
  return item ? item.sha : null;
}

export async function upsertLocalNote(path, content, sha, mediaType = 'text', sourceType = 'github', targetSourceId = null) {
  const db = targetSourceId ? getDBForSource(targetSourceId) : getActiveDB();
  const segments = path.split('/');
  const filename = segments.pop();
  const folder = segments.join('/') || 'Root';

  await db.transaction('rw', [db.manifest, db.content, db.state], async () => {
    await db.manifest.put({
      path,
      sha,
      folder,
      filename,
      mediaType,
      sourceType,
    });
    await db.content.put({
      path,
      rawMarkdown: content,
      fetchedAt: Date.now(),
    });
    await ensureNoteState(path, db);
  });
}

export async function deleteVaultDB(vaultId) {
  const dbName = `${DB_PREFIX}${vaultId}`;
  if (activeDb && activeVaultId === vaultId) {
    activeDb.close();
    activeDb = null;
    activeVaultId = null;
  }
  await Dexie.delete(dbName);
}
