// sw.js
const CACHE_VERSION = 'readover-v2.1.0';
const STATIC_CACHE = `readover-static-${CACHE_VERSION}`;
const VENDOR_CACHE = `readover-vendor-${CACHE_VERSION}`;

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './src/style.css',
  './src/app.js',
  './src/db.js',
  './src/github.js',
  './src/local-fs.js',
  './src/parser.js',
  './src/components/card.js',
  './src/parsers/pdf-cover.js',
  './src/parsers/epub-cover.js',
  './src/viewers/pdf-viewer.js',
  './src/viewers/epub-viewer.js',
  './icons/icon.svg'
];

const VENDOR_HOSTS = [
  'cdn.jsdelivr.net',
  'esm.sh',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

// Install: Cache core application shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate: Evict legacy cache namespaces
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== STATIC_CACHE && key !== VENDOR_CACHE) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Strategy dispatcher
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Bypass non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // 2. Ignore GitHub API requests (handled via github.js and IndexedDB)
  if (url.hostname === 'api.github.com' || url.hostname === 'raw.githubusercontent.com') {
    return;
  }

  // 3. Stale-while-revalidate for Vendor CDNs (PDF.js, ePub.js, fflate, Fonts)
  if (VENDOR_HOSTS.some((host) => url.hostname.includes(host))) {
    event.respondWith(
      caches.open(VENDOR_CACHE).then(async (cache) => {
        const cachedResponse = await cache.match(event.request);
        const fetchPromise = fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse.ok || networkResponse.type === 'opaque') {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          })
          .catch(() => cachedResponse);

        return cachedResponse || fetchPromise;
      })
    );
    return;
  }

  // 4. Cache-first falling back to network for local app shell assets
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(STATIC_CACHE).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return networkResponse;
      }).catch(() => {
        // Fallback to index.html for navigation requests when offline
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
