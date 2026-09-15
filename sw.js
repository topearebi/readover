// sw.js
const CACHE_NAME = 'notes-deck-v1';
const ASSETS = [
  './',
  './index.html',
  './src/style.css',
  './src/app.js',
  './src/db.js',
  './src/github.js',
  './src/parser.js',
  './src/components/card.js',
  './manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', (e) => {
  // Let IndexedDB and GitHub API handle data requests dynamically;
  // Service Worker only caches application shell assets.
  if (e.request.url.includes('api.github.com') || e.request.url.includes('raw.githubusercontent.com')) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then((res) => res || fetch(e.request))
  );
});
