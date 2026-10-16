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
    url: 'https://standardebooks.org/opds',
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


/** Build request headers including optional Basic Auth */
export function buildHeaders(catalog, extra = {}) {
  const headers = { ...extra };
  if (catalog.username && catalog.password) {
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

/** Get a proxy URL for an asset or request */
export function proxyUrl(targetUrl, catalog = null) {
  if (!targetUrl) return '';
  const origin = typeof location !== 'undefined' ? location.origin : 'http://localhost:3000';
  return `${origin}/api/opds-proxy?url=${encodeURIComponent(targetUrl)}`;
}

/**
 * Fetch with automatic fallback to /api/opds-proxy if direct fetch fails due to CORS.
 */
export async function opdsFetch(url, catalog, options = {}) {
  const headers = buildHeaders(catalog, options.headers || {});
  const fetchOpts = { ...options, headers };

  // If catalog is explicitly configured to use proxy, use proxy immediately
  if (catalog?.useProxy) {
    const pUrl = proxyUrl(url);
    return fetch(pUrl, fetchOpts);
  }

  try {
    const res = await fetch(url, fetchOpts);
    if (!res.ok && res.status === 0) {
      throw new Error('CORS blocked');
    }
    return res;
  } catch (err) {
    // Fallback to proxy
    const pUrl = proxyUrl(url);
    return fetch(pUrl, fetchOpts);
  }
}


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
