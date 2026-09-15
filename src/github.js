// src/github.js
import { db, ensureNoteState, setCachedContent, getCachedContent } from './db.js';

const CONFIG_KEY = 'md_deck_gh_config';

/**
 * Persists GitHub connection credentials locally.
 */
export function saveGitHubConfig({ token, owner, repo, branch = 'main' }) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ token, owner, repo, branch }));
}

/**
 * Loads stored GitHub connection credentials.
 */
export function getGitHubConfig() {
  const data = localStorage.getItem(CONFIG_KEY);
  return data ? JSON.parse(data) : null;
}

/**
 * Performs an authenticated fetch against GitHub API or raw content.
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
 * Syncs the entire repository tree to IndexedDB.
 * Returns an array of available folder paths for the UI filter.
 */
export async function syncRepoManifest(onProgress = () => {}) {
  const cfg = getGitHubConfig();
  if (!cfg || !cfg.owner || !cfg.repo) {
    throw new Error('Missing GitHub credentials. Configure them in Settings.');
  }

  onProgress('Fetching repository file tree...');
  const treeUrl = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/git/trees/${cfg.branch}?recursive=1`;
  const res = await ghFetch(treeUrl, cfg.token);
  const data = await res.json();

  if (data.truncated) {
    console.warn('Repo tree is truncated (>100,000 files). Consider scoping to a subfolder.');
  }

  // Filter only markdown files and ignore hidden files/directories (starting with .)
  const mdFiles = data.tree.filter(
    (item) => item.type === 'blob' && item.path.endsWith('.md') && !item.path.startsWith('.')
  );

  onProgress(`Found ${mdFiles.length} Markdown files. Updating local index...`);

  const remotePaths = new Set();
  const folders = new Set();

  await db.transaction('rw', [db.manifest, db.state], async () => {
    for (const file of mdFiles) {
      remotePaths.add(file.path);
      const segments = file.path.split('/');
      const filename = segments.pop();
      const folder = segments.join('/') || 'Root';

      folders.add(folder);

      // Add or update manifest record
      await db.manifest.put({
        path: file.path,
        sha: file.sha,
        folder,
        filename
      });

      // Ensure user review state exists without overriding lastSeen/hidden
      await ensureNoteState(file.path);
    }

    // Clean up local files deleted remotely
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
 * Fetches raw Markdown content for a single path.
 */
export async function fetchNoteContent(path) {
  // Check local cache first
  const cached = await getCachedContent(path);
  if (cached && cached.rawMarkdown) {
    return cached.rawMarkdown;
  }

  const cfg = getGitHubConfig();
  if (!cfg) throw new Error('Missing GitHub credentials.');

  // Fetch directly from raw endpoint
  const rawUrl = `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${cfg.branch}/${encodeURI(path)}`;
  const res = await ghFetch(rawUrl, cfg.token);
  const rawMarkdown = await res.text();

  await setCachedContent(path, rawMarkdown);
  return rawMarkdown;
}

/**
 * Preloads content for a batch of paths with a concurrency limit of 5.
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
