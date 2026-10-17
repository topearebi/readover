// WebDAV source adapter for Readover (Nextcloud, Koofr, Infomaniak, Box, self-hosted).
// Works directly in browser fetch() with Basic Auth over HTTPS.

export const canWrite = (src) => Boolean(src.url && src.username && src.password);

function authHeaders(src) {
  const creds = btoa(`${src.username || ''}:${src.password || ''}`);
  return {
    Authorization: `Basic ${creds}`,
  };
}

function cleanUrl(url) {
  return (url || '').replace(/\/+$/, '');
}

/** Parses XML multistatus response from WebDAV PROPFIND. */
function parseMultistatus(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const responses = Array.from(doc.querySelectorAll('response, d\\:response, D\\:response'));

  return responses.map((r) => {
    const hrefEl = r.querySelector('href, d\\:href, D\\:href');
    const href = hrefEl ? hrefEl.textContent.trim() : '';

    const isCol = Boolean(r.querySelector('resourcetype > collection, resourcetype > d\\:collection, resourcetype > D\\:collection'));
    const lenEl = r.querySelector('getcontentlength, d\\:getcontentlength, D\\:getcontentlength');
    const size = lenEl ? Number(lenEl.textContent) || 0 : 0;

    const modEl = r.querySelector('getlastmodified, d\\:getlastmodified, D\\:getlastmodified');
    const lastModified = modEl ? modEl.textContent.trim() : '';

    const etagEl = r.querySelector('getetag, d\\:getetag, D\\:getetag');
    const etag = etagEl ? etagEl.textContent.replace(/"/g, '').trim() : '';

    return {
      href,
      isCollection: isCol,
      size,
      lastModified,
      sha: etag || `${lastModified}_${size}`,
    };
  });
}

/**
 * Lists files recursively from the WebDAV server.
 * Uses Depth: 1 crawling to guarantee compatibility across all servers (many disable Depth: infinity).
 */
export async function listFiles(src, accept = () => true, onProgress = () => {}) {
  const baseUrl = cleanUrl(src.url);
  if (!baseUrl) throw new Error('WebDAV Server URL is required.');

  const rootParsed = new URL(baseUrl);
  const rootPath = decodeURIComponent(rootParsed.pathname).replace(/\/+$/, '');

  const queue = [baseUrl];
  const visited = new Set();
  const files = [];

  while (queue.length > 0) {
    const currentUrl = queue.shift();
    if (visited.has(currentUrl)) continue;
    visited.add(currentUrl);

    let res;
    try {
      res = await fetch(currentUrl, {
        method: 'PROPFIND',
        headers: {
          ...authHeaders(src),
          Depth: '1',
          'Content-Type': 'application/xml',
        },
      });
    } catch (err) {
      if (err.name === 'TypeError' || err.message.includes('Failed to fetch')) {
        throw new Error(
          'Could not reach WebDAV server. This is usually due to CORS restrictions on your WebDAV host. ' +
          'For Nextcloud, install the "CORS" app or use a CORS-friendly provider like Koofr.'
        );
      }
      throw err;
    }

    if (res.status === 401) throw new Error('WebDAV authentication failed. Check your username and password/app password.');
    if (!res.ok) throw new Error(`WebDAV server returned error ${res.status}`);

    const xmlText = await res.text();
    const entries = parseMultistatus(xmlText);

    for (const entry of entries) {
      if (!entry.href) continue;

      let entryPath = entry.href;
      try {
        entryPath = decodeURIComponent(new URL(entry.href, baseUrl).pathname).replace(/\/+$/, '');
      } catch {
        entryPath = decodeURIComponent(entry.href).replace(/\/+$/, '');
      }

      // Skip the directory itself
      if (entryPath === rootPath || entryPath === decodeURIComponent(new URL(currentUrl).pathname).replace(/\/+$/, '')) {
        continue;
      }

      // Calculate relative path from mount root
      let relPath = entryPath;
      if (entryPath.startsWith(rootPath)) {
        relPath = entryPath.slice(rootPath.length).replace(/^\/+/, '');
      }

      // Skip hidden files/directories (starting with .)
      const segments = relPath.split('/');
      if (segments.some((s) => s.startsWith('.'))) continue;

      if (entry.isCollection) {
        const subDirUrl = `${baseUrl}/${encodeURI(relPath)}`;
        if (!visited.has(subDirUrl) && queue.length < 200) {
          queue.push(subDirUrl);
        }
      } else {
        if (accept(relPath)) {
          files.push({
            path: relPath,
            sha: entry.sha || `${Date.now()}`,
            size: entry.size,
          });
        }
      }
    }
  }

  return files;
}

export async function readText(src, item) {
  const baseUrl = cleanUrl(src.url);
  const fileUrl = `${baseUrl}/${encodeURI(item.path.replace(/^\/+/, ''))}`;

  let res;
  try {
    res = await fetch(fileUrl, {
      method: 'GET',
      headers: authHeaders(src),
    });
  } catch (err) {
    throw new Error('Offline, or WebDAV server could not be reached.');
  }

  if (res.status === 404) {
    const err = new Error('File not found on WebDAV server.');
    err.status = 404;
    throw err;
  }
  if (!res.ok) throw new Error(`WebDAV read failed (${res.status})`);

  return res.text();
}

export async function readBlob(src, item, type = '') {
  const baseUrl = cleanUrl(src.url);
  const fileUrl = `${baseUrl}/${encodeURI(item.path.replace(/^\/+/, ''))}`;

  const res = await fetch(fileUrl, {
    method: 'GET',
    headers: authHeaders(src),
  });

  if (!res.ok) throw new Error(`WebDAV read failed (${res.status})`);
  const buf = await res.arrayBuffer();
  return new Blob([buf], { type });
}

/** Recursively ensures a folder collection exists via MKCOL. */
async function ensureDir(src, dirPath) {
  if (!dirPath) return;
  const baseUrl = cleanUrl(src.url);
  const segments = dirPath.split('/').filter(Boolean);
  let cur = '';

  for (const seg of segments) {
    cur = cur ? `${cur}/${seg}` : seg;
    const url = `${baseUrl}/${encodeURI(cur)}`;
    try {
      await fetch(url, {
        method: 'MKCOL',
        headers: authHeaders(src),
      });
    } catch {}
  }
}

export async function putFile(src, path, textOrBlob) {
  const baseUrl = cleanUrl(src.url);
  const cleanPath = path.replace(/^\/+/, '');
  const parts = cleanPath.split('/');
  if (parts.length > 1) {
    parts.pop();
    await ensureDir(src, parts.join('/'));
  }

  const isBinary = !(typeof textOrBlob === 'string');
  const fileUrl = `${baseUrl}/${encodeURI(cleanPath)}`;
  const res = await fetch(fileUrl, {
    method: 'PUT',
    headers: {
      ...authHeaders(src),
      'Content-Type': isBinary ? 'application/octet-stream' : 'text/markdown; charset=utf-8',
    },
    body: textOrBlob,
  });

  if (!res.ok) {
    throw new Error(`WebDAV save failed (${res.status})`);
  }

  const etag = res.headers.get('ETag') || '';
  return etag.replace(/"/g, '') || `rev:${Date.now()}`;
}

export async function deleteFile(src, path) {
  const baseUrl = cleanUrl(src.url);
  const cleanPath = path.replace(/^\/+/, '');
  const fileUrl = `${baseUrl}/${encodeURI(cleanPath)}`;
  const res = await fetch(fileUrl, {
    method: 'DELETE',
    headers: authHeaders(src),
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`WebDAV delete failed (${res.status})`);
  }
  return true;
}

/** Test connection helper for the Settings UI. */
export async function testConnection(src) {
  const baseUrl = cleanUrl(src.url);
  const res = await fetch(baseUrl, {
    method: 'PROPFIND',
    headers: {
      ...authHeaders(src),
      Depth: '0',
    },
  });

  if (res.status === 401) throw new Error('Authentication rejected. Check username and password/app token.');
  if (!res.ok) throw new Error(`WebDAV responded with status ${res.status}`);
  return true;
}
