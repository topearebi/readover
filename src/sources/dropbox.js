// Dropbox source adapter for Readover.
// Maps to Dropbox API v2 using App Folder (/Apps/Readover) or custom folder.
// Supports both browser OAuth 2.0 with PKCE and manual token entry.

const API = 'https://api.dropboxapi.com/2';
const CONTENT_API = 'https://content.dropboxapi.com/2';

export const tokenFor = (src) => (src.token && src.token.trim()) || '';
export const canWrite = (src) => Boolean(tokenFor(src));

const dbxPath = (path) => {
  const p = (path || '').replace(/^\/+/, '').trim();
  return p ? `/${p}` : '';
};

async function dbxRpc(src, endpoint, body = {}) {
  const token = tokenFor(src);
  if (!token) throw new Error('Dropbox is not connected. Add an access token in Settings.');

  let res;
  try {
    res = await fetch(`${API}/${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error('Offline, or Dropbox could not be reached.');
  }

  if (res.status === 401) throw new Error('Dropbox rejected the token or session expired. Reconnect in Settings.');
  if (res.status === 429) throw new Error('Dropbox rate limit reached. Please wait a moment.');

  if (!res.ok) {
    let msg = `Dropbox error ${res.status}`;
    try {
      const errData = await res.json();
      if (errData.error_summary) msg = `Dropbox: ${errData.error_summary}`;
    } catch {}
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }

  return res.json();
}

/** Lists all files recursively in the App Folder (or root subfolder). */
export async function listFiles(src) {
  const root = dbxPath(src.root);
  let files = [];
  try {
    let data = await dbxRpc(src, 'files/list_folder', {
      path: root,
      recursive: true,
      include_media_info: false,
      include_deleted: false,
    });

    const collect = (entries) => {
      for (const entry of entries) {
        if (entry['.tag'] === 'file') {
          // Normalize relative path by stripping the root if present
          let p = entry.path_display || entry.path_lower || '';
          p = p.replace(/^\/+/, '');
          if (root && p.toLowerCase().startsWith(root.replace(/^\/+/, '').toLowerCase() + '/')) {
            p = p.slice(root.replace(/^\/+/, '').length + 1);
          }
          files.push({
            path: p,
            sha: entry.rev || entry.id,
            size: entry.size,
          });
        }
      }
    };

    collect(data.entries || []);

    while (data.has_more && data.cursor) {
      data = await dbxRpc(src, 'files/list_folder/continue', { cursor: data.cursor });
      collect(data.entries || []);
    }
  } catch (err) {
    // If folder doesn't exist yet, return empty list
    if (err.message && err.message.includes('path/not_found')) {
      return [];
    }
    throw err;
  }

  return files;
}

export async function readText(src, item) {
  const token = tokenFor(src);
  if (!token) throw new Error('Dropbox is not connected.');

  const root = dbxPath(src.root);
  const fullPath = root ? `${root}/${item.path.replace(/^\/+/, '')}` : dbxPath(item.path);

  const res = await fetch(`${CONTENT_API}/files/download`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Dropbox-API-Arg': JSON.stringify({ path: fullPath }),
    },
  });

  if (!res.ok) {
    if (res.status === 409) {
      const err = new Error('File not found on Dropbox.');
      err.status = 404;
      throw err;
    }
    throw new Error(`Dropbox download failed (${res.status})`);
  }

  return res.text();
}

export async function readBlob(src, item, type = '') {
  const token = tokenFor(src);
  if (!token) throw new Error('Dropbox is not connected.');

  const root = dbxPath(src.root);
  const fullPath = root ? `${root}/${item.path.replace(/^\/+/, '')}` : dbxPath(item.path);

  const res = await fetch(`${CONTENT_API}/files/download`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Dropbox-API-Arg': JSON.stringify({ path: fullPath }),
    },
  });

  if (!res.ok) throw new Error(`Dropbox download failed (${res.status})`);
  const buf = await res.arrayBuffer();
  return new Blob([buf], { type });
}

export async function putFile(src, path, textOrBlob) {
  const token = tokenFor(src);
  if (!token) throw new Error('Dropbox is not connected.');

  const root = dbxPath(src.root);
  const fullPath = root ? `${root}/${path.replace(/^\/+/, '')}` : dbxPath(path);
  const bytes = typeof textOrBlob === 'string' ? new TextEncoder().encode(textOrBlob) : textOrBlob;

  const res = await fetch(`${CONTENT_API}/files/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({
        path: fullPath,
        mode: 'overwrite',
        autorename: false,
        mute: true,
      }),
    },
    body: bytes,
  });

  if (!res.ok) {
    let msg = `Dropbox upload failed (${res.status})`;
    try {
      const err = await res.json();
      if (err.error_summary) msg = `Dropbox: ${err.error_summary}`;
    } catch {}
    throw new Error(msg);
  }

  const data = await res.json();
  return data.rev || `rev:${Date.now()}`;
}

export async function whoami(token) {
  try {
    const res = await fetch(`${API}/users/get_current_account`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.name?.display_name || data.email || 'Dropbox User';
  } catch {
    return null;
  }
}

/* ---------- PKCE OAuth 2.0 Helper ---------- */

function generateRandomString(length = 64) {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const values = new Uint8Array(length);
  crypto.getRandomValues(values);
  return Array.from(values, (v) => charset[v % charset.length]).join('');
}

async function sha256(plain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return crypto.subtle.digest('SHA-256', data);
}

function base64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function createPKCEAuthUrl(clientId, redirectUri) {
  const verifier = generateRandomString(64);
  sessionStorage.setItem('readover_dropbox_verifier', verifier);

  const hashed = await sha256(verifier);
  const challenge = base64url(hashed);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    redirect_uri: redirectUri,
    token_access_type: 'offline',
  });

  return {
    url: `https://www.dropbox.com/oauth2/authorize?${params.toString()}`,
    verifier,
  };
}

export async function exchangePKCECode(code, clientId, redirectUri) {
  const verifier = sessionStorage.getItem('readover_dropbox_verifier') || '';
  const params = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });

  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!res.ok) {
    let msg = `Dropbox OAuth failed (${res.status})`;
    try {
      const err = await res.json();
      if (err.error_description) msg = err.error_description;
    } catch {}
    throw new Error(msg);
  }

  const data = await res.json();
  sessionStorage.removeItem('readover_dropbox_verifier');
  return {
    token: data.access_token,
    refreshToken: data.refresh_token,
    account_id: data.account_id,
  };
}
