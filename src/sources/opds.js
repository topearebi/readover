// OPDS 1.2 (Atom XML) & OPDS 2.0 (JSON) Catalog Client.
// "Browse Remote, Stash Local": on-demand catalog browsing and book acquisition.

export const OPDS_ACQUISITION_REL = 'http://opds-spec.org/acquisition';
export const OPDS_IMAGE_REL = 'http://opds-spec.org/image';
export const OPDS_THUMB_REL = 'http://opds-spec.org/thumbnail';
export const OPDS_SEARCH_REL = 'search';

export const MIME_EPUB = 'application/epub+zip';
export const MIME_PDF = 'application/pdf';
export const MIME_CBZ = 'application/vnd.comicbook+zip';

/**
 * Strictly normalizes all relative URLs against the feed base URL.
 * Handles relative paths from Calibre-Web, Kavita, Komga, etc.
 */
export function resolveUrl(href, baseUrl) {
  if (!href) return null;
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
}

/**
 * Builds HTTP headers including Basic Auth, Bearer tokens, or API keys.
 */
export function buildHeaders(catalog = {}) {
  const headers = {
    Accept: 'application/atom+xml,application/xml,application/opds+json,application/json,*/*;q=0.8',
  };
  if (catalog.authType === 'basic' && catalog.username) {
    const creds = btoa(`${catalog.username}:${catalog.password || ''}`);
    headers.Authorization = `Basic ${creds}`;
  } else if (catalog.authType === 'bearer' && catalog.token) {
    headers.Authorization = `Bearer ${catalog.token}`;
  } else if (catalog.authHeader && catalog.authHeaderValue) {
    headers[catalog.authHeader] = catalog.authHeaderValue;
  }
  return headers;
}

/**
 * Wraps target URL with user's configured CORS proxy if provided or if direct fails.
 */
export function proxiedUrl(targetUrl, corsProxy) {
  if (!corsProxy) return targetUrl;
  const proxy = corsProxy.trim();
  if (!proxy) return targetUrl;
  if (proxy.includes('%s')) return proxy.replace('%s', encodeURIComponent(targetUrl));
  const separator = proxy.includes('?') ? '&' : '?';
  return `${proxy}${proxy.endsWith('/') || proxy.endsWith('=') ? '' : separator + 'url='}${encodeURIComponent(targetUrl)}`;
}

/**
 * Direct-first fetch with CORS proxy fallback.
 */
export async function fetchWithFallback(url, options = {}, corsProxy = '') {
  const directHeaders = options.headers || {};
  try {
    const res = await fetch(url, { ...options, headers: directHeaders, mode: 'cors' });
    if (res.ok) return res;
    // If 401/403, credentials issue rather than CORS, return response directly
    if (res.status === 401 || res.status === 403) return res;
  } catch (err) {
    // If direct failed (e.g. TypeError: Failed to fetch due to CORS) and proxy available, fallback
    if (!corsProxy) throw err;
  }

  if (corsProxy) {
    const pUrl = proxiedUrl(url, corsProxy);
    return fetch(pUrl, options);
  }
  throw new Error(`Unable to fetch ${url}. If this is a self-hosted server without CORS headers, configure a CORS Proxy URL in Settings.`);
}

/**
 * Fetches and parses an OPDS feed (Atom XML or JSON).
 */
export async function loadFeed(feedUrl, catalog = {}) {
  const headers = buildHeaders(catalog);
  const corsProxy = catalog.corsProxy || '';

  const res = await fetchWithFallback(feedUrl, { headers }, corsProxy);
  if (!res.ok) {
    throw new Error(`Catalog responded with HTTP ${res.status}: ${res.statusText}`);
  }

  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();

  if (contentType.includes('json') || text.trim().startsWith('{')) {
    return parseOpds2(text, feedUrl);
  }
  return parseOpds1(text, feedUrl);
}

/**
 * Parses OPDS 1.2 Atom XML feed.
 */
export function parseOpds1(xmlText, feedUrl) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error(`XML parsing error: ${parseError.textContent.slice(0, 120)}`);
  }

  const feedEl = doc.querySelector('feed') || doc.documentElement;
  const feedTitle = feedEl.querySelector('title')?.textContent?.trim() || 'Catalog';
  const feedSubtitle = feedEl.querySelector('subtitle')?.textContent?.trim() || '';
  const feedIcon = resolveUrl(feedEl.querySelector('icon, logo')?.textContent?.trim(), feedUrl);

  const navigation = [];
  const books = [];
  let searchTemplate = null;
  let nextPageUrl = null;

  // Top-level feed links
  const topLinks = feedEl.querySelectorAll(':scope > link');
  for (const l of topLinks) {
    const rel = l.getAttribute('rel') || '';
    const href = resolveUrl(l.getAttribute('href'), feedUrl);
    const title = l.getAttribute('title') || 'More';
    const type = l.getAttribute('type') || '';

    if (rel === 'next') {
      nextPageUrl = href;
    } else if (rel.includes('search') || type.includes('opensearchdescription')) {
      searchTemplate = { href, type, title };
    } else if (rel.includes('subsection') || rel === 'start' || rel.includes('collection')) {
      navigation.push({
        title,
        href,
        type,
        rel,
      });
    }
  }

  // Parse entries
  const entries = feedEl.querySelectorAll('entry');
  for (const entry of entries) {
    const id = entry.querySelector('id')?.textContent?.trim() || '';
    const title = entry.querySelector('title')?.textContent?.trim() || 'Untitled';
    const summary = entry.querySelector('summary, content')?.textContent?.trim() || '';
    const published = entry.querySelector('published, updated')?.textContent?.trim() || '';
    
    // Authors
    const authors = [...entry.querySelectorAll('author name')]
      .map((a) => a.textContent?.trim())
      .filter(Boolean);

    // Categories
    const categories = [...entry.querySelectorAll('category')]
      .map((c) => c.getAttribute('label') || c.getAttribute('term'))
      .filter(Boolean);

    // Links: covers, acquisitions, sub-feeds
    let coverUrl = null;
    let thumbUrl = null;
    const acquisitions = [];
    let isNav = false;
    let navHref = null;

    const links = entry.querySelectorAll('link');
    for (const link of links) {
      const rel = link.getAttribute('rel') || '';
      const href = resolveUrl(link.getAttribute('href'), feedUrl);
      const type = link.getAttribute('type') || '';
      const linkTitle = link.getAttribute('title') || '';

      if (rel.includes(OPDS_IMAGE_REL) || rel === 'x-cover' || rel === 'cover') {
        coverUrl = href;
      } else if (rel.includes(OPDS_THUMB_REL) || rel === 'x-thumbnail' || rel === 'thumbnail') {
        thumbUrl = href;
      } else if (rel.includes(OPDS_ACQUISITION_REL) || rel === 'acquisition' || type.includes('epub') || type.includes('pdf')) {
        acquisitions.push({
          href,
          type: type.toLowerCase(),
          title: linkTitle || typeLabel(type),
        });
      } else if (rel.includes('subsection') || type.includes('atom+xml')) {
        isNav = true;
        navHref = href;
      }
    }

    if (!coverUrl && thumbUrl) coverUrl = thumbUrl;

    if (acquisitions.length > 0 || !isNav) {
      books.push({
        id,
        title,
        authors: authors.length ? authors : ['Unknown Author'],
        summary: cleanHtmlSummary(summary),
        published,
        categories,
        coverUrl,
        thumbUrl,
        acquisitions,
      });
    } else if (isNav && navHref) {
      navigation.push({
        title,
        href: navHref,
        summary: cleanHtmlSummary(summary),
      });
    }
  }

  return {
    title: feedTitle,
    subtitle: feedSubtitle,
    icon: feedIcon,
    url: feedUrl,
    navigation,
    books,
    nextPageUrl,
    searchTemplate,
  };
}

/**
 * Parses OPDS 2.0 JSON feed.
 */
export function parseOpds2(jsonText, feedUrl) {
  const data = JSON.parse(jsonText);
  const metadata = data.metadata || {};
  const feedTitle = metadata.title || 'Catalog';
  const feedSubtitle = metadata.description || '';

  const navigation = [];
  const books = [];
  let nextPageUrl = null;
  let searchTemplate = null;

  for (const l of data.links || []) {
    const rel = l.rel || '';
    const href = resolveUrl(l.href, feedUrl);
    if (rel === 'next') nextPageUrl = href;
    if (rel === 'search') searchTemplate = { href, type: l.type, title: l.title || 'Search' };
  }

  for (const nav of data.navigation || []) {
    navigation.push({
      title: nav.title || 'Section',
      href: resolveUrl(nav.href, feedUrl),
      count: nav.numberOfItems,
    });
  }

  for (const pub of data.publications || []) {
    const meta = pub.metadata || {};
    const title = meta.title || 'Untitled';
    const authors = Array.isArray(meta.author) ? meta.author.map((a) => (typeof a === 'string' ? a : a.name)) : meta.author ? [meta.author] : ['Unknown'];
    const summary = meta.description || '';
    const published = meta.published || meta.modified || '';
    const categories = Array.isArray(meta.subject) ? meta.subject.map((s) => (typeof s === 'string' ? s : s.name)) : [];

    let coverUrl = null;
    for (const img of pub.images || []) {
      if (img.rel === 'cover' || img.type?.startsWith('image/')) {
        coverUrl = resolveUrl(img.href, feedUrl);
        break;
      }
    }

    const acquisitions = [];
    for (const l of pub.links || []) {
      if (l.rel === OPDS_ACQUISITION_REL || l.rel === 'acquisition' || l.type?.includes('epub') || l.type?.includes('pdf')) {
        acquisitions.push({
          href: resolveUrl(l.href, feedUrl),
          type: (l.type || '').toLowerCase(),
          title: l.title || typeLabel(l.type),
        });
      }
    }

    books.push({
      id: meta.identifier || pub.key || title,
      title,
      authors,
      summary: cleanHtmlSummary(summary),
      published,
      categories,
      coverUrl,
      acquisitions,
    });
  }

  return {
    title: feedTitle,
    subtitle: feedSubtitle,
    url: feedUrl,
    navigation,
    books,
    nextPageUrl,
    searchTemplate,
  };
}

/**
 * Downloads a book file with progress reporting.
 */
export async function downloadBook(acquisitionUrl, catalog = {}, onProgress = () => {}) {
  const headers = buildHeaders(catalog);
  const corsProxy = catalog.corsProxy || '';

  onProgress('Connecting…', 0);
  const res = await fetchWithFallback(acquisitionUrl, { headers }, corsProxy);
  if (!res.ok) {
    throw new Error(`Download failed with HTTP ${res.status}: ${res.statusText}`);
  }

  const contentLength = Number(res.headers.get('content-length')) || 0;
  if (!res.body || typeof res.body.getReader !== 'function') {
    const blob = await res.blob();
    onProgress('Done', 100);
    return blob;
  }

  const reader = res.body.getReader();
  const chunks = [];
  let receivedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    receivedBytes += value.length;
    if (contentLength > 0) {
      const pct = Math.min(100, Math.round((receivedBytes / contentLength) * 100));
      onProgress(`${Math.round(receivedBytes / 1024)} KB (${pct}%)`, pct);
    } else {
      onProgress(`${Math.round(receivedBytes / 1024)} KB`, 50);
    }
  }

  const mime = res.headers.get('content-type') || (acquisitionUrl.endsWith('.pdf') ? MIME_PDF : MIME_EPUB);
  return new Blob(chunks, { type: mime });
}

function typeLabel(mime = '') {
  if (mime.includes('epub')) return 'EPUB';
  if (mime.includes('pdf')) return 'PDF';
  if (mime.includes('comic') || mime.includes('cbz')) return 'CBZ';
  if (mime.includes('audio')) return 'Audio';
  return 'Download';
}

function cleanHtmlSummary(html = '') {
  return String(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
