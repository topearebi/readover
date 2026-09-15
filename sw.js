// sw.js
// 1. Increment this version whenever you push code changes
const APP_VERSION = 'v2.1.0';
const CACHE_NAME = `notes-deck-${APP_VERSION}`;

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

// Install: Cache new assets and immediately activate without waiting for old tabs to close
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// Activate: Delete old cache versions and claim clients immediately
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log(`[SW] Removing outdated cache: ${key}`);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Serve from cache, fallback to network. Bypass GitHub API and raw content.
self.addEventListener('fetch', (e) => {
  if (
    e.request.url.includes('api.github.com') ||
    e.request.url.includes('raw.githubusercontent.com')
  ) {
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(e.request);
    })
  );
});
