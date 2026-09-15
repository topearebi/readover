// src/github.js
import { getActiveDB, ensureNoteState, setCachedContent, getCachedContent } from './db.js';

const PROFILES_KEY = 'md_deck_vault_profiles';
const ACTIVE_VAULT_KEY = 'md_deck_active_vault_id';
const GLOBAL_TOKEN_KEY = 'md_deck_global_token';
const LAST_COMMIT_PREFIX = 'md_deck_last_commit_';

/**
 * Global Account Token helpers (Classic PAT with repo scope or fine-grained)
 */
export function getGlobalToken() {
  return (localStorage.getItem(GLOBAL_TOKEN_KEY) || '').trim();
}

export function setGlobalToken(token) {
  if (token && token.trim()) {
    localStorage.setItem(GLOBAL_TOKEN_KEY, token.trim());
  } else {
    localStorage.removeItem(GLOBAL_TOKEN_KEY);
  }
}

/**
 * Vault Profile Management
 */
export function getVaultProfiles() {
  const data = localStorage.getItem(PROFILES_KEY);
  return data ? JSON.parse(data) : [];
}

export function saveVaultProfile(profile) {
  const profiles = getVaultProfiles();
  const existingIdx = profiles.findIndex((p) => p.id === profile.id);

  if (existingIdx !== -1) {
    profiles[existingIdx] = profile;
  } else {
    profiles.push(profile);
  }

  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));

  if (!getActiveVaultId()) {
    setActiveVaultId(profile.id);
  }
}

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

export function getActiveVaultId() {
  return localStorage.getItem(ACTIVE_VAULT_KEY);
}

export function setActiveVaultId(id) {
  localStorage.setItem(ACTIVE_VAULT_KEY, id);
}

/**
 * Returns active vault config with hierarchical token resolution:
 * Vault Token -> Global Token -> '' (Unauthenticated Public)
 */
export function getActiveVaultConfig() {
  const activeId = getActiveVaultId();
  if (!activeId) return null;
  const profiles = getVaultProfiles();
  const profile = profiles.find((p) => p.id === activeId);
  if (!profile) return null;

  const resolvedToken = (profile.token && profile.token.trim()) || getGlobalToken();

  return {
    ...profile,
    token: resolvedToken,
    isInheritedToken: !profile.token && Boolean(getGlobalToken()),
    isPublic: !resolvedToken,
  };
}

/**
 * Unicode-safe Base64 encoder/decoder for GitHub API Contents payload
 */
function utf8ToBase64(str) {
  return window.btoa(unescape(encodeURIComponent(str)));
}

/**
 * Authenticated fetch helper against GitHub API
 */
async function ghFetch(url, token, options = {}) {
  const headers = {
    Accept: 'application/vnd.github.v3+json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    if (res.status === 409) {
      throw new Error('Conflict: Remote note has changed since last loaded.');
    }
    throw new Error(`GitHub API Error: ${res.status} ${res.statusText}`);
  }
  return res;
}

/**
 * Lightweight check to see if remote repo has newer commits.
 * Returns true if remote commit SHA differs from locally saved commit SHA.
 */
export async function checkRemoteUpdates() {
  const cfg = getActiveVaultConfig();
  if (!cfg || !cfg.owner || !cfg.repo) return false;

  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/commits?per_page=1&sha=${cfg.branch || 'main'}`;
  try {
    const res = await ghFetch(url, cfg.token);
    const commits = await res.json();
    if (!commits || commits.length === 0) return false;

    const latestSha = commits[0].sha;
    const localKey = `${LAST_COMMIT_PREFIX}${cfg.id}`;
    const storedSha = localStorage.getItem(localKey);

    if (storedSha && storedSha !== latestSha) {
      localStorage.setItem(localKey, latestSha);
      return true;
    }

    localStorage.setItem(localKey, latestSha);
    return false;
  } catch (err) {
    console.warn('Could not check remote updates:', err);
    return false;
  }
}

/**
 * Syncs the repository manifest using Git Trees API.
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

    // Purge deleted records
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
 * Fetches raw Markdown content using GitHub Contents API.
 */
export async function fetchNoteContent(path) {
  const cached = await getCachedContent(path);
  if (cached && cached.rawMarkdown) {
    return cached.rawMarkdown;
  }

  const cfg = getActiveVaultConfig();
  if (!cfg) throw new Error('No active vault configuration found.');

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
 * Creates or updates a note file on GitHub in a single commit.
 * 
 * @param {string} path - Note path (e.g. "zettelkasten/Physical training.md")
 * @param {string} rawMarkdown - Updated or initial Markdown text
 * @param {string|null} sha - File blob SHA (required for edit; null for create)
 * @param {string} commitMessage - Optional commit message
 * @returns {Promise<Object>} { sha: newBlobSha, commit: commitData }
 */
export async function saveNoteFile(path, rawMarkdown, sha = null, commitMessage = null) {
  const cfg = getActiveVaultConfig();
  if (!cfg) throw new Error('No active vault configuration found.');
  if (!cfg.token) throw new Error('A Personal Access Token is required to edit or create notes.');

  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const apiUrl = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${encodedPath}`;

  const defaultMsg = sha
    ? `Update ${path} via Notes Deck`
    : `Create ${path} via Notes Deck`;

  const payload = {
    message: commitMessage || defaultMsg,
    content: utf8ToBase64(rawMarkdown),
    branch: cfg.branch || 'main',
  };

  if (sha) {
    payload.sha = sha;
  }

  const res = await ghFetch(apiUrl, cfg.token, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  const newSha = data.content.sha;

  // Immediately update local cache and manifest
  const db = getActiveDB();
  await setCachedContent(path, rawMarkdown);

  const segments = path.split('/');
  const filename = segments.pop();
  const folder = segments.join('/') || 'Root';

  await db.manifest.put({
    path,
    sha: newSha,
    folder,
    filename,
  });
  await ensureNoteState(path);

  return { sha: newSha, content: data.content };
}

/**
 * Preloads batch contents with concurrency control.
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
