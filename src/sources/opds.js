// OPDS Catalog Client & Parser ("Browse Remote, Stash Local")
// Supports OPDS 1.2 (Atom XML) and OPDS 2.0 (JSON-LD), handles Basic Auth,
// and routes through /api/opds-proxy when CORS is blocked by self-hosted servers.

export const PRESET_CATALOGS = [
  {
    id: 'opds-gutenberg',
    name: 'Project Gutenberg',
    url: 'https://m.gutenberg.org/ebooks.opds/',
    description: 'Over 70,000 free open access ebooks from the world’s great literature.',
    useProxy: false,
  },
  {
    id: 'opds-standard-ebooks',
    name: 'Standard Ebooks (Donor Login)',
    url: 'https://standardebooks.org/opds/',
    description: 'Carefully formatted public domain ebooks in EPUB format (requires donor credentials).',
    useProxy: false,
  },
  {
    id: 'opds-feedbooks',
    name: 'Feedbooks Public Domain',
    url: 'https://www.feedbooks.com/publicdomain/catalog.atom',
    description: 'Classics and public domain masterpieces with covers and typography.',
    useProxy: false,
  },
];

/** Normalize OPDS URLs (e.g. Standard Ebooks trailing slash to prevent 301 CORS drops) */
export function normalizeOpdsUrl(url) {
  if (!url) return '';
  let normalized = String(url).trim();
  if (/^https?:\/\/standardebooks\.org\/opds\/?$/i.test(normalized)) {
    return 'https://standardebooks.org/opds/';
  }
  return normalized;
}

/** Helper to retrieve user CORS proxy setting without triggering indexedDB initialization in tests */
function getUserCorsProxy(catalog = null) {
  if (catalog?.corsProxy) return catalog.corsProxy;
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem('readover.prefs');
      if (raw) {
        const parsed = JSON.parse(raw);
        return parsed.corsProxy || parsed.corsProxyUrl || '';
      }
    }
  } catch {}
  return '';
}

/** Build request headers including optional Basic Auth */
export function buildHeaders(catalog = {}, extra = {}) {
  const headers = { ...extra };
  if (catalog?.username && catalog?.password) {
    const creds = btoa(`${catalog.username}:${catalog.password}`);
    headers['Authorization'] = `Basic ${creds}`;
  }
  return headers;
}

/** Resolve relative URLs against the catalog / feed base URL */
export function resolveUrl(href, baseUrl) {
  if (!href) return '';
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
}

function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

let localProxyAvailable = null;

/** Get a proxy URL for an asset, cover image, or request */
export function proxyUrl(targetUrl, catalog = null) {
  if (!targetUrl) return '';
  const cleanUrl = normalizeOpdsUrl(targetUrl);
  const isLocal = typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');

  // Tier 2: User-configured CORS proxy from Settings or Catalog
  const customProxy = getUserCorsProxy(catalog);
  if (customProxy) {
    if (customProxy.includes('%s')) {
      return customProxy.replace('%s', encodeURIComponent(cleanUrl));
    }
    return `${customProxy}${encodeURIComponent(cleanUrl)}`;
  }

  // Tier 3: Local Dev Proxy (/api/opds-proxy) ONLY when actively confirmed available
  if (isLocal && localProxyAvailable === true) {
    const origin = typeof location !== 'undefined' ? location.origin : 'http://localhost:3000';
    return `${origin}/api/opds-proxy?url=${encodeURIComponent(cleanUrl)}`;
  }

  // By default, return direct cleanUrl for <img> tags. Browsers display cross-origin
  // images natively without CORS errors. Avoid dead/paid third-party proxies.
  return cleanUrl;
}

export const proxiedUrl = proxyUrl;

/**
 * Multi-tiered OPDS fetcher:
 * Tier 1: Direct fetch (Fastest, zero-latency. Works for CORS-enabled self-hosted Calibre/Kavita/Caddy).
 * Tier 2: User-configured CORS proxy from Settings (store.getPrefs().corsProxyUrl).
 * Tier 3: Local Dev Proxy (/api/opds-proxy) when running on localhost and active.
 * Tier 4: Reliable public CORS gateway fallback for unauthenticated public domain catalogs (CodeTabs / AllOrigins).
 *         Credentials are NEVER sent to public gateways.
 */
export async function opdsFetch(url, catalog = null, options = {}) {
  const targetUrl = normalizeOpdsUrl(url);
  const headers = buildHeaders(catalog || {}, options.headers || {});
  const fetchOpts = { ...options, headers };
  const hasCredentials = Boolean((catalog?.username && catalog?.password) || headers['Authorization']);
  const isLocal = typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
  const tierErrors = [];

  // Tier 1: Direct fetch first (unless catalog explicitly forces proxy)
  if (!catalog?.useProxy) {
    try {
      const res = await fetch(targetUrl, fetchOpts);
      if (res.ok) return res;
      // If server returned 401 Unauthorized, upstream requires credentials - do not mask
      if (res.status === 401) return res;
      tierErrors.push(`Direct fetch returned HTTP ${res.status}`);
    } catch (err) {
      tierErrors.push(`Direct fetch failed: ${err.message}`);
    }
  }

  // Tier 2: User-configured CORS proxy from catalog or Settings
  const customProxy = getUserCorsProxy(catalog);
  if (customProxy) {
    try {
      const pUrl = customProxy.includes('%s')
        ? customProxy.replace('%s', encodeURIComponent(targetUrl))
        : `${customProxy}${encodeURIComponent(targetUrl)}`;
      const res = await fetch(pUrl, fetchOpts);
      if (res.ok) return res;
      if (res.status === 401) return res;
      tierErrors.push(`Custom proxy (${customProxy}) returned HTTP ${res.status}`);
    } catch (err) {
      tierErrors.push(`Custom proxy failed: ${err.message}`);
    }
  }

  // Tier 3: Local Dev Proxy (/api/opds-proxy) if on localhost and actively running
  if (isLocal && localProxyAvailable !== false) {
    try {
      const origin = typeof location !== 'undefined' ? location.origin : 'http://localhost:3000';
      const localUrl = `${origin}/api/opds-proxy?url=${encodeURIComponent(targetUrl)}`;
      const res = await fetch(localUrl, { ...fetchOpts, signal: timeoutSignal(3000) });
      if (res.ok) {
        localProxyAvailable = true;
        return res;
      }
      localProxyAvailable = false;
      tierErrors.push(`Local proxy (/api/opds-proxy) returned HTTP ${res.status}`);
    } catch (err) {
      localProxyAvailable = false;
      tierErrors.push(`Local proxy unreachable: ${err.message}`);
    }
  }

  // Tier 4: Public CORS gateway fallback for unauthenticated public catalogs only
  if (hasCredentials) {
    tierErrors.push('Credentials present: Public third-party gateways omitted to protect credentials');
  } else {
    // Primary Public Gateway: CodeTabs
    try {
      const gatewayUrl = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`;
      const res = await fetch(gatewayUrl, { ...fetchOpts, signal: timeoutSignal(8000) });
      if (res.ok) return res;
      tierErrors.push(`Public gateway (codetabs) returned HTTP ${res.status}`);
    } catch (err) {
      tierErrors.push(`Public gateway (codetabs) failed: ${err.message}`);
    }

    // Secondary Public Gateway: AllOrigins (with timeout protection against 522 hang)
    try {
      const altGatewayUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
      const res = await fetch(altGatewayUrl, { ...fetchOpts, signal: timeoutSignal(6000) });
      if (res.ok) return res;
      tierErrors.push(`Secondary gateway (allorigins.win) returned HTTP ${res.status}`);
    } catch (err) {
      tierErrors.push(`Secondary gateway (allorigins.win) failed: ${err.message}`);
    }
  }

  const detail = tierErrors.length ? ` (${tierErrors.join('; ')})` : '';
  throw new Error(`Unable to fetch OPDS feed from "${targetUrl}". Direct connection and CORS proxies failed.${detail}`);
}

export const fetchWithFallback = opdsFetch;


/** Fetch and parse an OPDS feed (Atom XML or JSON-LD) */
export async function loadCatalogFeed(catalog, feedUrl = null) {
  const url = feedUrl || catalog.url;
  const res = await opdsFetch(url, catalog);
  if (!res.ok) {
    throw new Error(`Catalog responded with HTTP ${res.status}: ${res.statusText}`);
  }

  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const text = await res.text();

  if (contentType.includes('json') || text.trim().startsWith('{')) {
    try {
      const json = JSON.parse(text);
      return parseOpds2Json(json, url);
    } catch {}
  }

  // Detect HTML error pages returned instead of OPDS XML feed
  if (!text.includes('<feed') && !text.includes('application/atom+xml') && (text.includes('<!DOCTYPE html') || text.includes('<html'))) {
    throw new Error('Received an HTML webpage instead of an OPDS XML/JSON feed. Please verify the catalog feed URL.');
  }

  return parseOpds1Atom(text, url);
}

/** Parse OPDS 1.2 Atom XML feed */
export function parseOpds1Atom(xmlString, baseUrl) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');
  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    throw new Error(`Failed to parse OPDS XML feed: ${parserError.textContent.slice(0, 150)}`);
  }

  const feedEl = doc.querySelector('feed') || doc.documentElement;
  const feedTitle = feedEl.querySelector('title')?.textContent?.trim() || 'Catalog';
  const feedSubtitle = feedEl.querySelector('subtitle')?.textContent?.trim() || '';

  // Extract navigation / pagination links
  let nextUrl = null;
  let prevUrl = null;
  let searchTemplate = null;
  let parentUrl = null;

  for (const link of feedEl.querySelectorAll(':scope > link')) {
    const rel = link.getAttribute('rel') || '';
    const href = link.getAttribute('href');
    if (!href) continue;
    const resolved = resolveUrl(href, baseUrl);

    if (rel === 'next') nextUrl = resolved;
    else if (rel === 'prev' || rel === 'previous') prevUrl = resolved;
    else if (rel === 'up' || rel === 'start') parentUrl = resolved;
    else if (rel === 'search' || rel === 'http://opds-spec.org/search') {
      const type = link.getAttribute('type') || '';
      if (type.includes('xml') || type.includes('opensearch')) {
        searchTemplate = resolved;
      } else {
        searchTemplate = resolved;
      }
    }
  }

  const entries = [];
  const subsections = [];

  for (const entry of feedEl.querySelectorAll('entry')) {
    const entryTitle = entry.querySelector('title')?.textContent?.trim() || 'Untitled';
    const entryId = entry.querySelector('id')?.textContent?.trim() || '';
    const updated = entry.querySelector('updated')?.textContent?.trim() || '';
    const published = entry.querySelector('published')?.textContent?.trim() || '';
    const summary = entry.querySelector('summary, content')?.textContent?.trim() || '';
    
    // Authors
    const authorEls = entry.querySelectorAll('author name');
    const authors = Array.from(authorEls).map((a) => a.textContent?.trim()).filter(Boolean);
    const author = authors.join(', ');

    // Links: covers, acquisitions, subcatalogs
    let coverUrl = null;
    let thumbUrl = null;
    const acquisitions = [];
    let isNavigationEntry = false;
    let navUrl = null;

    for (const link of entry.querySelectorAll('link')) {
      const rel = link.getAttribute('rel') || '';
      const href = link.getAttribute('href');
      const type = (link.getAttribute('type') || '').toLowerCase();
      if (!href) continue;
      const resolved = resolveUrl(href, baseUrl);

      if (rel.includes('image/thumbnail') || rel.includes('thumbnail')) {
        thumbUrl = resolved;
      } else if (rel.includes('image') || rel.includes('cover')) {
        coverUrl = resolved;
      } else if (
        rel.includes('acquisition') ||
        type === 'application/epub+zip' ||
        type === 'application/pdf' ||
        type.includes('mobipocket') ||
        type.includes('comicbook')
      ) {
        let format = 'epub';
        if (type.includes('pdf')) format = 'pdf';
        else if (type.includes('epub')) format = 'epub';
        else if (type.includes('mobi')) format = 'mobi';
        else if (type.includes('comic') || type.includes('cbz')) format = 'cbz';
        else if (href.endsWith('.pdf')) format = 'pdf';
        else if (href.endsWith('.epub')) format = 'epub';

        acquisitions.push({
          url: resolved,
          type,
          format,
          title: link.getAttribute('title') || format.toUpperCase(),
        });
      } else if (
        rel === 'subsection' ||
        type.includes('atom+xml;profile=opds-catalog') ||
        type.includes('opds+json')
      ) {
        isNavigationEntry = true;
        navUrl = resolved;
      }
    }

    if (!thumbUrl && coverUrl) thumbUrl = coverUrl;
    if (!coverUrl && thumbUrl) coverUrl = thumbUrl;

    if (isNavigationEntry && acquisitions.length === 0) {
      subsections.push({
        id: entryId,
        title: entryTitle,
        author,
        summary,
        url: navUrl,
        icon: thumbUrl,
      });
    } else {
      entries.push({
        id: entryId,
        title: entryTitle,
        author,
        summary,
        published,
        updated,
        coverUrl,
        thumbUrl,
        acquisitions,
        acquisition: acquisitions[0] || null,
        isNavigation: false,
      });
    }
  }

  return {
    title: feedTitle,
    subtitle: feedSubtitle,
    url: baseUrl,
    parentUrl,
    nextUrl,
    prevUrl,
    searchTemplate,
    subsections,
    books: entries,
  };
}

/** Parse OPDS 2.0 JSON-LD format */
export function parseOpds2Json(json, baseUrl) {
  const metadata = json.metadata || {};
  const feedTitle = metadata.title || 'Catalog';
  const feedSubtitle = metadata.description || '';

  const links = json.links || [];
  let nextUrl = null;
  let prevUrl = null;
  let searchTemplate = null;

  for (const l of links) {
    const rel = l.rel || '';
    const href = resolveUrl(l.href, baseUrl);
    if (rel === 'next') nextUrl = href;
    else if (rel === 'prev' || rel === 'previous') prevUrl = href;
    else if (rel === 'search') searchTemplate = href;
  }

  const subsections = [];
  const navigation = json.navigation || [];
  for (const nav of navigation) {
    subsections.push({
      id: nav.href,
      title: nav.title || 'Category',
      url: resolveUrl(nav.href, baseUrl),
    });
  }

  const books = [];
  const pubs = json.publications || [];
  for (const pub of pubs) {
    const meta = pub.metadata || {};
    const title = meta.title || 'Untitled';
    const author = Array.isArray(meta.author) ? meta.author.map((a) => (typeof a === 'string' ? a : a.name)).join(', ') : (meta.author?.name || meta.author || '');
    const summary = meta.description || '';

    // Images
    let coverUrl = null;
    let thumbUrl = null;
    for (const img of pub.images || []) {
      const resolved = resolveUrl(img.href, baseUrl);
      if (img.rel === 'thumbnail' || !thumbUrl) thumbUrl = resolved;
      if (!coverUrl) coverUrl = resolved;
    }

    // Acquisitions
    const acquisitions = [];
    for (const l of pub.links || []) {
      const type = (l.type || '').toLowerCase();
      const href = resolveUrl(l.href, baseUrl);
      let format = 'epub';
      if (type.includes('pdf') || href.endsWith('.pdf')) format = 'pdf';
      else if (type.includes('epub') || href.endsWith('.epub')) format = 'epub';
      else if (type.includes('mobi')) format = 'mobi';

      if (type.includes('epub') || type.includes('pdf') || l.rel === 'http://opds-spec.org/acquisition') {
        acquisitions.push({
          url: href,
          type,
          format,
          title: l.title || format.toUpperCase(),
        });
      }
    }

    books.push({
      id: pub.metadata?.identifier || pub.links?.[0]?.href || title,
      title,
      author,
      summary,
      published: meta.published || '',
      coverUrl,
      thumbUrl,
      acquisitions,
      acquisition: acquisitions[0] || null,
      isNavigation: false,
    });
  }

  return {
    title: feedTitle,
    subtitle: feedSubtitle,
    url: baseUrl,
    parentUrl: null,
    nextUrl,
    prevUrl,
    searchTemplate,
    subsections,
    books,
  };
}

/** Sanitize a title / author to a safe, clean filename */
export function makeSafeFilename(author, title, ext = 'epub') {
  const cleanStr = (s) => String(s || '').replace(/[/\\?%*:|"<>]/g, '').replace(/\s+/g, ' ').trim();
  const cTitle = cleanStr(title) || 'Book';
  const cAuthor = cleanStr(author);
  const base = cAuthor ? `${cAuthor} - ${cTitle}` : cTitle;
  return `${base.slice(0, 100)}.${ext.toLowerCase()}`;
}

// Backward and test compatibility aliases
export const parseAtomXml = parseOpds1Atom;
export const parseOpdsXml = parseOpds1Atom;

// Catalog addition linkage
export async function showAddCatalogSheet(onAdded) {
  const { openAddCatalogModal } = await import('../ui/opds.js');
  return openAddCatalogModal(onAdded);
}
export const openAddCatalogModal = showAddCatalogSheet;
