// GitHub source adapter. Every function takes the source config explicitly;
// there is no global "active vault".
import { getToken } from '../store.js';

const API = 'https://api.github.com';

export const tokenFor = (src) => (src.token && src.token.trim()) || getToken();
export const canWrite = (src) => Boolean(tokenFor(src));

const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');
const repoUrl = (src) => `${API}/repos/${encodeURIComponent(src.owner)}/${encodeURIComponent(src.repo)}`;

async function gh(src, url, { accept = 'application/vnd.github+json', ...init } = {}) {
  const headers = { Accept: accept, ...(init.headers || {}) };
  const token = tokenFor(src);
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(url, { ...init, headers, cache: 'no-store' });
  } catch {
    throw new Error('Offline, or GitHub could not be reached.');
  }
  if (res.ok) return res;

  if (res.status === 403 || res.status === 429) {
    if (res.headers.get('x-ratelimit-remaining') === '0') {
      const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
      const mins = Math.max(1, Math.round((reset - Date.now()) / 60000));
      throw new Error(
        token
          ? `GitHub rate limit reached. Try again in ~${mins} min.`
          : `GitHub's anonymous limit (60 requests/hour) is used up. Add a token in Settings, or wait ~${mins} min.`
      );
    }
  }
  if (res.status === 401) throw new Error('GitHub rejected the token. Check it in Settings.');
  if (res.status === 404 && init.method !== 'PUT') {
    const err = new Error(
      token
        ? `Not found: ${src.owner}/${src.repo}. Check the name, branch, and that the token can read this repo.`
        : `Not found: ${src.owner}/${src.repo}. If the repo is private, add a token in Settings.`
    );
    err.status = 404;
    throw err;
  }
  let message = `GitHub error ${res.status}`;
  try {
    const body = await res.json();
    if (body.message) message = `GitHub: ${body.message}`;
  } catch {}
  const err = new Error(message);
  err.status = res.status;
  throw err;
}

/** One request lists the whole repo. Returns [{ path, sha, size }] for blobs. */
export async function listFiles(src) {
  const branch = src.branch || 'main';
  let res;
  try {
    res = await gh(src, `${repoUrl(src)}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  } catch (err) {
    if (err.status === 409) return []; // empty repository: nothing to list yet
    throw err;
  }
  const data = await res.json();
  if (data.truncated) console.warn('Repository tree truncated by GitHub (very large repo).');
  return data.tree.filter((n) => n.type === 'blob').map((n) => ({ path: n.path, sha: n.sha, size: n.size }));
}

/**
 * Public repos without a token read from raw.githubusercontent.com, which has CORS
 * and is not subject to the 60/hour API limit. Everything else uses the blobs API.
 */
async function fetchRaw(src, item) {
  if (!tokenFor(src)) {
    const branch = src.branch || 'main';
    const url = `https://raw.githubusercontent.com/${src.owner}/${src.repo}/${encodeURIComponent(branch)}/${encodePath(item.path)}`;
    const res = await fetch(url).catch(() => null);
    if (res && res.ok) return res;
  }
  if (item.sha) {
    return gh(src, `${repoUrl(src)}/git/blobs/${item.sha}`, { accept: 'application/vnd.github.raw' });
  }
  return gh(src, `${repoUrl(src)}/contents/${encodePath(item.path)}?ref=${encodeURIComponent(src.branch || 'main')}`, {
    accept: 'application/vnd.github.raw',
  });
}

export async function readText(src, item) {
  const res = await fetchRaw(src, item);
  return res.text();
}

export async function readBlob(src, item, type = '') {
  const res = await fetchRaw(src, item);
  const buf = await res.arrayBuffer();
  return new Blob([buf], { type });
}

/** Returns { sha, text } or null when the file does not exist. */
export async function getFile(src, path) {
  try {
    const res = await gh(
      src,
      `${repoUrl(src)}/contents/${encodePath(path)}?ref=${encodeURIComponent(src.branch || 'main')}`
    );
    const data = await res.json();
    return { sha: data.sha, text: decodeBase64Utf8(data.content || '') };
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

/** Create or update a file. Returns the new blob sha. */
export async function putFile(src, path, text, sha, message) {
  const body = {
    message: message || `Readover: update ${path}`,
    content: encodeBase64Utf8(text),
    branch: src.branch || 'main',
  };
  if (sha) body.sha = sha;
  const res = await gh(src, `${repoUrl(src)}/contents/${encodePath(path)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return data.content?.sha || null;
}

/** Read-modify-write with one retry on a stale sha (409/422). */
export async function updateFile(src, path, transform, message) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const current = await getFile(src, path);
    const next = transform(current ? current.text : null);
    if (next === null || (current && next === current.text)) return current?.sha || null;
    try {
      return await putFile(src, path, next, current?.sha, message);
    } catch (err) {
      if (attempt === 0 && (err.status === 409 || err.status === 422)) continue;
      throw err;
    }
  }
  return null;
}

function encodeBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function decodeBase64Utf8(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Repo metadata (default branch, privacy). */
export async function repoInfo(src) {
  const res = await gh(src, repoUrl(src));
  const data = await res.json();
  return { defaultBranch: data.default_branch, private: data.private, fullName: data.full_name };
}

/** Accepts "owner/repo", a github.com URL, or a URL to a folder (…/tree/branch/path). */
export function parseRepoInput(input) {
  const s = input.trim().replace(/\.git$/, '').replace(/\/+$/, '');
  const url = /github\.com[/:]([^/\s]+)\/([^/\s#?]+)(?:\/tree\/([^/\s]+)(?:\/(.+))?)?/i.exec(s);
  if (url) return { owner: url[1], repo: url[2], branch: url[3] || '', root: url[4] ? decodeURIComponent(url[4]) : '' };
  const short = /^([\w.-]+)\/([\w.-]+)$/.exec(s);
  if (short) return { owner: short[1], repo: short[2], branch: '', root: '' };
  return null;
}

/* ---------- Git Data API: several files in one commit ---------- */

const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** Current commit sha of the branch, or null if the repo has no commits yet. */
export async function headSha(src) {
  try {
    const res = await gh(src, `${repoUrl(src)}/git/ref/heads/${encodeURIComponent(src.branch || 'main')}`);
    return (await res.json()).object.sha;
  } catch (err) {
    if (err.status === 404 || err.status === 409) return null; // empty repository
    throw err;
  }
}

/** Lists a folder at a given commit: [{ name, path, sha }]. Missing folder → []. */
export async function listDir(src, dir, ref) {
  try {
    const res = await gh(src, `${repoUrl(src)}/contents/${encodePath(dir)}?ref=${encodeURIComponent(ref || src.branch || 'main')}`);
    const data = await res.json();
    return Array.isArray(data) ? data.filter((e) => e.type === 'file').map((e) => ({ name: e.name, path: e.path, sha: e.sha })) : [];
  } catch (err) {
    if (err.status === 404) return [];
    throw err;
  }
}

export async function readBlobText(src, sha) {
  const res = await gh(src, `${repoUrl(src)}/git/blobs/${sha}`, { accept: 'application/vnd.github.raw' });
  return res.text();
}

/**
 * Write several files as ONE commit on top of `parent`. Fails with status 422
 * if the branch moved since `parent` (someone else pushed): the caller re-reads,
 * re-merges and tries again, so nothing is ever overwritten.
 * files: { path: text } (text === null deletes the file)
 */
export async function commitFiles(src, parent, files, message) {
  const branch = src.branch || 'main';
  if (!parent) {
    // Empty repository: the Git Data API needs an existing commit, so create files one by one.
    for (const [path, text] of Object.entries(files)) if (text !== null) await putFile(src, path, text, null, message);
    return headSha(src);
  }
  const base = await (await gh(src, `${repoUrl(src)}/git/commits/${parent}`)).json();
  const tree = Object.entries(files).map(([path, text]) =>
    text === null ? { path, mode: '100644', type: 'blob', sha: null } : { path, mode: '100644', type: 'blob', content: text }
  );
  const newTree = await (await gh(src, `${repoUrl(src)}/git/trees`, json({ base_tree: base.tree.sha, tree }))).json();
  const commit = await (await gh(src, `${repoUrl(src)}/git/commits`, json({ message, tree: newTree.sha, parents: [parent] }))).json();
  await gh(src, `${repoUrl(src)}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha: commit.sha, force: false }),
  });
  return commit.sha;
}

/** Delete a file; `sha` must be the version you expect to be deleting. */
export async function deleteFile(src, path, sha, message) {
  await gh(src, `${repoUrl(src)}/contents/${encodePath(path)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: message || `Readover: delete ${path}`, sha, branch: src.branch || 'main' }),
  });
}

/** When a file last changed, from its latest commit (one request). ms or null. */
export async function lastCommitDate(src, path) {
  const res = await gh(
    src,
    `${repoUrl(src)}/commits?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(src.branch || 'main')}&per_page=1`
  );
  const list = await res.json();
  const iso = list?.[0]?.commit?.author?.date || list?.[0]?.commit?.committer?.date;
  return iso ? Date.parse(iso) : null;
}
