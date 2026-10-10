// Readover service worker: makes the app shell work offline.
// VERSION is replaced with the commit SHA by .github/workflows/pages.yml, so every
// deploy installs a fresh cache without anyone having to bump a number by hand.
const VERSION = 'dev';
const CACHE = `readover-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon.svg',
  './src/style.css',
  './src/app.js',
  './src/version.js',
  './src/store.js',
  './src/library.js',
  './src/feed.js',
  './src/markdown.js',
  './src/covers.js',
  './src/lib/idb.js',
  './src/lib/vendor.js',
  './src/sources/github.js',
  './src/sources/local.js',
  './src/ui/overlay.js',
  './src/ui/card.js',
  './src/ui/reader.js',
  './src/ui/settings.js',
  './src/ui/compose.js',
  './src/viewers/pdf.js',
  './src/viewers/epub.js',
  './vendor/marked.esm.js',
  './vendor/purify.es.mjs',
  './vendor/fonts/literata-latin-wght-normal.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('readover-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // GitHub API & raw files: straight to network

  // Big vendored libraries never change within a version: cache-first.
  if (url.pathname.includes('/vendor/')) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  // App shell: serve from cache instantly, refresh in the background.
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const key = req.mode === 'navigate' ? './index.html' : req;
      const hit = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });
      const network = fetch(req)
        .then((res) => {
          if (res.ok && res.type === 'basic') cache.put(key, res.clone());
          return res;
        })
        .catch(() => hit);
      return hit || network;
    })
  );
});
