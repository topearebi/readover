// src/github.js
import { getActiveDB, ensureNoteState, setCachedContent, getCachedContent } from './db.js';

const PROFILES_KEY = 'md_deck_vault_profiles';
const ACTIVE_VAULT_KEY = 'md_deck_active_vault_id';

/**
 * Retrieves all saved vault profiles.
 */
export function getVaultProfiles() {
  const data = localStorage.getItem(PROFILES_KEY);
  return data ? JSON.parse(data) : [];
}

/**
 * Saves or updates a vault profile.
 * Profile schema: { id, name, owner, repo, branch, token }
 */
export function saveVaultProfile(profile) {
  const profiles = getVaultProfiles();
  const existingIdx = profiles.findIndex((p) => p.id === profile.id);

  if (existingIdx !== -1) {
    profiles[existingIdx] = profile;
  } else {
    profiles.push(profile);
  }

  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));

  // If no active vault set yet, set this as active
  if (!getActiveVaultId()) {
    setActiveVaultId(profile.id);
  }
}

/**
 * Deletes a vault profile from storage.
 */
export function deleteVaultProfile(id) {
  let profiles = getVaultProfiles();
  profiles = profiles.filter((p) => p.id !== id);
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));

  if (getActiveVaultId() === id) {
    const nextActive = profiles.length > 0 ? profiles[0].id : null;
    if (nextActive) {
      setActiveVaultId(nextActive);
    } else {
      localStorage.removeItem(ACTIVE_VAULT_KEY);
    }
  }
}

/**
 * Gets the current active vault profile ID.
 */
export function getActiveVaultId() {
  return localStorage.getItem(ACTIVE_VAULT_KEY);
}

/**
 * Sets the active vault profile ID.
 */
export function setActiveVaultId(id) {
  localStorage.setItem(ACTIVE_VAULT_KEY, id);
}

/**
 * Gets the active vault configuration object.
 */
export function getActiveVaultConfig() {
  const activeId = getActiveVaultId();
  if (!activeId) return null;
  const profiles = getVaultProfiles();
  return profiles.find((p) => p.id === activeId) || null;
}

/**
 * Authenticated fetch helper against GitHub API endpoints.
 */
async function ghFetch(url, token, options = {}) {
  const headers = {
    Accept: 'application/vnd.github.v3+json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    throw new Error(`GitHub API Error: ${res.status} ${res.statusText}`);
  }
  return res;
}

/**
 * Syncs the repository manifest using the Git Trees API into the active vault DB.
 */
export async function syncRepoManifest(onProgress = () => {}) {
  const cfg = getActiveVaultConfig();
  if (!cfg || !cfg.owner || !cfg.repo) {
    throw new Error('Missing configuration for active vault.');
  }

  onProgress('Fetching repository file tree...');
  const treeUrl = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/git/trees/${cfg.branch || 'main'}?recursive=1`;
  const res = await ghFetch(treeUrl, cfg.token);
  const data = await res.json();

  if (data.truncated) {
    console.warn('Repository file tree is truncated (>100,000 files).');
  }

  // Filter for markdown files and ignore dotfiles
  const mdFiles = data.tree.filter(
    (item) => item.type === 'blob' && item.path.endsWith('.md') && !item.path.startsWith('.')
  );

  onProgress(`Found ${mdFiles.length} Markdown files. Updating local index...`);

  const db = getActiveDB();
  const remotePaths = new Set();
  const folders = new Set();

  await db.transaction('rw', [db.manifest, db.state], async () => {
    for (const file of mdFiles) {
      remotePaths.add(file.path);
      const segments = file.path.split('/');
      const filename = segments.pop();
      const folder = segments.join('/') || 'Root';

      folders.add(folder);

      await db.manifest.put({
        path: file.path,
        sha: file.sha,
        folder,
        filename,
      });

      await ensureNoteState(file.path);
    }

    // Purge local records for files removed remotely
    const localRecords = await db.manifest.toArray();
    for (const record of localRecords) {
      if (!remotePaths.has(record.path)) {
        await db.manifest.delete(record.path);
        await db.content.delete(record.path);
        await db.state.delete(record.path);
      }
    }
  });

  onProgress('Sync complete.');
  return Array.from(folders).sort();
}

/**
 * Fetches raw Markdown content using GitHub Contents API with application/vnd.github.raw.
 * Resolves CORS preflight issues on private repositories.
 */
export async function fetchNoteContent(path) {
  const cached = await getCachedContent(path);
  if (cached && cached.rawMarkdown) {
    return cached.rawMarkdown;
  }

  const cfg = getActiveVaultConfig();
  if (!cfg) throw new Error('No active vault configuration found.');

  // Encode each path segment while keeping directory slashes intact
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const apiUrl = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${encodedPath}?ref=${cfg.branch || 'main'}`;

  const res = await ghFetch(apiUrl, cfg.token, {
    headers: {
      Accept: 'application/vnd.github.raw',
    },
  });

  const rawMarkdown = await res.text();
  await setCachedContent(path, rawMarkdown);
  return rawMarkdown;
}

/**
 * Preloads a batch of note contents with concurrency control.
 */
export async function preloadBatchContent(paths, concurrency = 5) {
  const pool = [...paths];
  const workers = Array(concurrency).fill(0).map(async () => {
    while (pool.length > 0) {
      const path = pool.shift();
      try {
        await fetchNoteContent(path);
      } catch (err) {
        console.warn(`Failed to preload ${path}:`, err);
      }
    }
  });
  await Promise.all(workers);
}
