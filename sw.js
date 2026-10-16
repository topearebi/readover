// Readover service worker. Works with plain branch publishing: there is no
// version to bump and no build step.
//
// - App files (HTML, CSS, JS, icons): network first, so a push to main is live
//   on the next open. If the network is slow or gone, the cached copy is used.
// - Vendored libraries (/vendor/<name>-<version>/…): cached permanently. Their
//   URLs include the version, so the file at a given URL never changes.
// - GitHub API and raw files: never touched here; the app caches those itself.

const SHELL_CACHE = 'readover-shell-v6';
const VENDOR_CACHE = 'readover-vendor-v2';
const NETWORK_TIMEOUT = 1500; // ms before falling back to the cached copy
const SLOW_BACKOFF = 30000; // after a timeout, use the cache first for this long

// Precached so the app opens offline after the first visit.
const SHELL = [
  './',
  './manifest.json',
  './icons/icon.svg',
  './src/style.css',
  './src/app.js',
  './src/version.js',
  './src/store.js',
  './src/library.js',
  './src/feed.js',
  './src/sync.js',
  './src/outbox.js',
  './src/ui/status.js',
  './src/ui/setup.js',
  './src/lib/gitsha.js',
  './src/markdown.js',
  './src/covers.js',
  './src/lib/idb.js',
  './src/lib/vendor.js',
  './src/sources/github.js',
  './src/sources/local.js',
  './src/sources/opds.js',
  './src/ui/overlay.js',
  './src/ui/card.js',
  './src/ui/reader.js',
  './src/ui/settings.js',
  './src/ui/compose.js',
  './src/ui/opds.js',
  './src/attachments.js',
  './src/viewers/pdf.js',
  './src/viewers/book.js',
  './src/imports.js',
  './src/ui/shelf.js',
  './src/ui/notes.js',
  './src/ui/sheet.js',
  './src/notes-index.js',
  './src/learn.js',
  './src/dates.js',
  './src/ui/highlight-note.js',
  './src/lib/zip.js',
  './src/notefile.js',
  './src/insights.js',
  './src/clip.js',
  './src/clock.js',
  './src/garden.js',
  './src/ui/growth.js',
  './src/ui/types.js',
  './src/relink.js',
  './src/filters.js',
  './src/ui/capture.js',
];
const VENDOR = [
  './vendor/marked-15.0.12/marked.esm.js',
  './vendor/dompurify-3.2.6/purify.es.mjs',
  './vendor/literata-5.2.5/literata-latin-wght-normal.woff2',
];

let slowUntil = 0;

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'no-cache' })))),
      caches.open(VENDOR_CACHE).then((c) => c.addAll(VENDOR)),
    ]).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  const keep = new Set([SHELL_CACHE, VENDOR_CACHE]);
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('readover-') && !keep.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes('/vendor/')) {
    event.respondWith(cacheFirst(req));
    return;
  }
  event.respondWith(networkFirst(req));
});

async function cacheFirst(req) {
  const cache = await caches.open(VENDOR_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  // All app pages are the same single page.
  const key = req.mode === 'navigate' ? './' : req;
  const cached = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });

  // 'no-cache' revalidates with GitHub Pages (a cheap 304 when nothing changed)
  // instead of trusting its 10-minute HTTP cache.
  const network = fetch(req, { cache: 'no-cache' }).then((res) => {
    if (res.ok && res.type === 'basic') cache.put(key, res.clone());
    return res;
  });

  if (!cached) return network;
  if (Date.now() < slowUntil) {
    network.catch(() => {}); // still refresh the cache in the background
    return cached;
  }

  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      slowUntil = Date.now() + SLOW_BACKOFF;
      resolve(cached);
    }, NETWORK_TIMEOUT);
  });
  try {
    return await Promise.race([network, timeout]);
  } catch {
    return cached; // offline
  } finally {
    clearTimeout(timer);
  }
}
