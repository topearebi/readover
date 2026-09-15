// src/github.js
import {
  getActiveDB,
  getCachedContent,
  setCachedContent,
  upsertLocalNote,
} from './db.js';

const GITHUB_API_BASE = 'https://api.github.com';
const PROFILES_STORAGE_KEY = 'readover_vault_profiles';
const ACTIVE_VAULT_KEY = 'readover_active_vault_id';
const GLOBAL_TOKEN_KEY = 'readover_github_global_token';

/* --- Account & Vault Profile Persistence --- */

export function getGlobalToken() {
  return localStorage.getItem(GLOBAL_TOKEN_KEY) || '';
}

export function setGlobalToken(token) {
  if (!token || !token.trim()) {
    localStorage.removeItem(GLOBAL_TOKEN_KEY);
  } else {
    localStorage.setItem(GLOBAL_TOKEN_KEY, token.trim());
  }
}

export function getVaultProfiles() {
  const data = localStorage.getItem(PROFILES_STORAGE_KEY);
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
  localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(profiles));
}

export function deleteVaultProfile(id) {
  let profiles = getVaultProfiles();
  profiles = profiles.filter((p) => p.id !== id);
  localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(profiles));

  if (getActiveVaultId() === id) {
    const next = profiles.length > 0 ? profiles[0].id : null;
    setActiveVaultId(next);
  }
}

export function getActiveVaultId() {
  return localStorage.getItem(ACTIVE_VAULT_KEY);
}

export function setActiveVaultId(id) {
  if (id) {
    localStorage.setItem(ACTIVE_VAULT_KEY, id);
  } else {
    localStorage.removeItem(ACTIVE_VAULT_KEY);
  }
}

export function getActiveVaultConfig() {
  const activeId = getActiveVaultId();
  if (!activeId) return null;
  const profiles = getVaultProfiles();
  return profiles.find((p) => p.id === activeId) || null;
}

/**
 * Resolves authentication token using hierarchical override:
 * 1. Per-vault custom token override
 * 2. Global Account Token
 * 3. Null (unauthenticated for public repositories)
 */
function resolveAuthHeaders(customToken, baseHeaders = {}) {
  const token = (customToken && customToken.trim()) || getGlobalToken();
  const headers = { ...baseHeaders };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Checks if the remote repository has newer commits on the target branch.
 */
export async function checkRemoteUpdates() {
  const cfg = getActiveVaultConfig();
  if (!cfg) return false;

  try {
    const branch = cfg.branch || 'main';
    const url = `${GITHUB_API_BASE}/repos/${cfg.owner}/${cfg.repo}/commits/${branch}`;
    const headers = resolveAuthHeaders(cfg.token, {
      Accept: 'application/vnd.github.v3+json',
    });

    const res = await fetch(url, { headers });
    if (!res.ok) return false;

    const commitData = await res.json();
    const latestSha = commitData.sha;
    const cachedSha = localStorage.getItem(`last_commit_${cfg.id}`);

    if (latestSha && latestSha !== cachedSha) {
      localStorage.setItem(`last_commit_${cfg.id}`, latestSha);
      return Boolean(cachedSha);
    }
    return false;
  } catch (err) {
    console.warn('Auto-sync check failed:', err);
    return false;
  }
}

/**
 * Fetches the remote Git tree and synchronizes the local manifest in IndexedDB.
 */
export async function syncRepoManifest(onProgress = () => {}) {
  const cfg = getActiveVaultConfig();
  if (!cfg) throw new Error('No active vault configured.');

  onProgress('Connecting to GitHub repository...');
  const branch = cfg.branch || 'main';
  const treeUrl = `${GITHUB_API_BASE}/repos/${cfg.owner}/${cfg.repo}/git/trees/${branch}?recursive=1`;

  const headers = resolveAuthHeaders(cfg.token, {
    Accept: 'application/vnd.github.v3+json',
  });

  const res = await fetch(treeUrl, { headers });

  if (res.status === 401 || res.status === 403) {
    throw new Error('Access denied. Check your GitHub PAT permissions.');
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch repo tree: HTTP ${res.status}`);
  }

  const data = await res.json();
  if (data.truncated) {
    console.warn('Repository contains over 100,000 files; tree truncated.');
  }

  const supportedExtensions = {
    md: 'text',
    txt: 'text',
    epub: 'epub',
    pdf: 'pdf',
  };

  const candidateNodes = data.tree.filter((node) => {
    if (node.type !== 'blob') return false;
    const ext = node.path.split('.').pop().toLowerCase();
    return Boolean(supportedExtensions[ext]);
  });

  onProgress(`Indexing ${candidateNodes.length} documents...`);

  const db = getActiveDB();
  const remotePaths = new Set(candidateNodes.map((n) => n.path));

  await db.transaction('rw', [db.manifest, db.content, db.state], async () => {
    for (const node of candidateNodes) {
      const segments = node.path.split('/');
      const filename = segments.pop();
      const folder = segments.join('/') || 'Root';
      const ext = filename.split('.').pop().toLowerCase();
      const mediaType = supportedExtensions[ext] || 'text';

      const existing = await db.manifest.get(node.path);

      // Invalidate cached content if remote SHA changed
      if (existing && existing.sha !== node.sha) {
        await db.content.delete(node.path);
      }

      await db.manifest.put({
        path: node.path,
        sha: node.sha,
        folder,
        filename,
        mediaType,
        sourceType: 'github',
      });

      const state = await db.state.get(node.path);
      if (!state) {
        await db.state.put({
          path: node.path,
          lastSeen: 0,
          starred: 0,
        });
      }
    }

    // Evict removed files
    const allLocal = await db.manifest.toArray();
    for (const local of allLocal) {
      if (local.sourceType === 'github' && !remotePaths.has(local.path)) {
        await db.manifest.delete(local.path);
        await db.content.delete(local.path);
        await db.state.delete(local.path);
      }
    }
  });

  onProgress(`Synced ${candidateNodes.length} items.`);
}

/**
 * Fetches text/markdown note content with 304 fallback to local IndexedDB cache.
 */
export async function fetchNoteContent(path) {
  const db = getActiveDB();
  const cached = await getCachedContent(path);

  const cfg = getActiveVaultConfig();
  if (!cfg) {
    if (cached) return cached.rawMarkdown;
    throw new Error('No vault configured and file is not cached.');
  }

  const branch = cfg.branch || 'main';
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const url = `${GITHUB_API_BASE}/repos/${cfg.owner}/${cfg.repo}/contents/${encodedPath}?ref=${branch}`;

  const headers = resolveAuthHeaders(cfg.token, {
    Accept: 'application/vnd.github.v3+json',
  });

  if (cached && cached.etag) {
    headers['If-None-Match'] = cached.etag;
  }

  try {
    const res = await fetch(url, { headers });

    // 304 Not Modified: server returned no content because cache is current
    if (res.status === 304) {
      if (cached && cached.rawMarkdown) {
        return cached.rawMarkdown;
      }
      // If header returned 304 but local record is empty, force a fresh fetch without etag
      const freshHeaders = resolveAuthHeaders(cfg.token, {
        Accept: 'application/vnd.github.v3+json',
      });
      const freshRes = await fetch(url, { headers: freshHeaders });
      if (!freshRes.ok) throw new Error(`HTTP ${freshRes.status}`);
      const freshData = await freshRes.json();
      const decoded = decodeBase64Utf8(freshData.content);
      await db.content.put({
        path,
        rawMarkdown: decoded,
        etag: freshRes.headers.get('etag'),
        fetchedAt: Date.now(),
      });
      return decoded;
    }

    if (!res.ok) {
      if (cached && cached.rawMarkdown) return cached.rawMarkdown;
      throw new Error(`Failed to load note: HTTP ${res.status}`);
    }

    const data = await res.json();
    const rawMarkdown = decodeBase64Utf8(data.content);
    const etag = res.headers.get('etag');

    await db.content.put({
      path,
      rawMarkdown,
      etag,
      fetchedAt: Date.now(),
    });

    return rawMarkdown;
  } catch (err) {
    if (cached && cached.rawMarkdown) {
      return cached.rawMarkdown;
    }
    throw err;
  }
}

/**
 * Fetches raw binary files (EPUB, PDF) from GitHub without text corruption.
 * 
 * @param {string} path - Repository relative file path
 * @returns {Promise<Blob>} Raw binary Blob
 */
export async function fetchBinaryBlob(path) {
  const cfg = getActiveVaultConfig();
  if (!cfg) throw new Error('No vault configured.');

  const branch = cfg.branch || 'main';
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const url = `${GITHUB_API_BASE}/repos/${cfg.owner}/${cfg.repo}/contents/${encodedPath}?ref=${branch}`;

  // Request raw binary stream directly from GitHub API
  const headers = resolveAuthHeaders(cfg.token, {
    Accept: 'application/vnd.github.v3.raw',
  });

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Failed to fetch binary asset: HTTP ${res.status}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const ext = path.split('.').pop().toLowerCase();
  const mimeType = ext === 'pdf' ? 'application/pdf' : 'application/epub+zip';

  return new Blob([arrayBuffer], { type: mimeType });
}

/**
 * Commits updated text content back to GitHub.
 */
export async function saveNoteFile(path, content, currentSha = null) {
  const cfg = getActiveVaultConfig();
  if (!cfg) throw new Error('No active vault configured.');

  const branch = cfg.branch || 'main';
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const url = `${GITHUB_API_BASE}/repos/${cfg.owner}/${cfg.repo}/contents/${encodedPath}`;

  const headers = resolveAuthHeaders(cfg.token, {
    'Content-Type': 'application/json',
    Accept: 'application/vnd.github.v3+json',
  });

  const payload = {
    message: `Update ${path.split('/').pop()} via ReadOver`,
    content: encodeBase64Utf8(content),
    branch,
  };

  if (currentSha) {
    payload.sha = currentSha;
  }

  const res = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.message || `GitHub commit failed with HTTP ${res.status}`);
  }

  const result = await res.json();
  const newSha = result.content ? result.content.sha : `local_${Date.now()}`;

  await upsertLocalNote(path, content, newSha, 'text', 'github');
  return newSha;
}

/**
 * Pre-warms cache in the background for upcoming text cards.
 */
export async function preloadBatchContent(paths = []) {
  const uncached = [];
  for (const p of paths) {
    const cached = await getCachedContent(p);
    if (!cached) uncached.push(p);
  }

  const queue = uncached.slice(0, 4);
  for (const path of queue) {
    fetchNoteContent(path).catch(() => {});
  }
}

/* --- Base64 UTF-8 Helpers --- */

function decodeBase64Utf8(base64Str) {
  const clean = base64Str.replace(/\s/g, '');
  const binStr = atob(clean);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) {
    bytes[i] = binStr.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

function encodeBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binStr = '';
  for (let i = 0; i < bytes.length; i++) {
    binStr += String.fromCharCode(bytes[i]);
  }
  return btoa(binStr);
}
