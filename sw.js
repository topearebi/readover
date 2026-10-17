// Readover service worker. Works with plain branch publishing: there is no
// version to bump and no build step.
//
// - App files (HTML, CSS, JS, icons): network first, so a push to main is live
//   on the next open. If the network is slow or gone, the cached copy is used.
// - Vendored libraries (/vendor/<name>-<version>/…): cached permanently. Their
//   URLs include the version, so the file at a given URL never changes.
// - GitHub API and raw files: never touched here; the app caches those itself.

const SHELL_CACHE = 'readover-shell-v9';
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
  './src/articles.js',
  './src/attachments.js',
  './src/clip.js',
  './src/clock.js',
  './src/covers.js',
  './src/dates.js',
  './src/filters.js',
  './src/garden.js',
  './src/imports.js',
  './src/insights.js',
  './src/learn.js',
  './src/markdown.js',
  './src/notefile.js',
  './src/notes-index.js',
  './src/observatory.js',
  './src/relink.js',
  './src/wakelock.js',
  './src/utils/wakelock.js',
  './src/lib/gitsha.js',
  './src/lib/idb.js',
  './src/lib/vendor.js',
  './src/lib/zip.js',
  './src/sources/dropbox.js',
  './src/sources/github.js',
  './src/sources/local.js',
  './src/sources/s3.js',
  './src/sources/webdav.js',
  './src/ui/status.js',
  './src/ui/setup.js',
  './src/ui/overlay.js',
  './src/ui/card.js',
  './src/ui/clip.js',
  './src/ui/compose.js',
  './src/ui/diagnostics.js',
  './src/ui/growth.js',
  './src/ui/highlight-note.js',
  './src/ui/notes.js',
  './src/ui/reader.js',
  './src/ui/settings.js',
  './src/ui/sheet.js',
  './src/ui/shelf.js',
  './src/ui/capture.js',
  './src/ui/types.js',
  './src/ui/appearance.js',
  './src/ui/observatory.js',
  './src/viewers/book.js',
  './src/viewers/pdf.js',
];
const VENDOR = [
  './vendor/marked-15.0.12/marked.esm.js',
  './vendor/dompurify-3.2.6/purify.es.mjs',
  './vendor/literata-5.2.5/literata-latin-wght-normal.woff2',
];

let slowUntil = 0;

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

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
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Handle Android PWA Web Share Target file and text ingestion (POST multipart/form-data)
  if (req.method === 'POST') {
    event.respondWith(
      (async () => {
        try {
          const formData = await req.formData();
          const files = formData.getAll('files');
          let filename = '';
          let blob = null;

          if (files && files.length > 0 && files[0] && files[0].size > 0) {
            const file = files[0];
            filename = file.name || 'shared-document';
            blob = file;
          } else {
            const title = formData.get('title') || '';
            const text = formData.get('text') || '';
            const url = formData.get('url') || '';
            if (title || text || url) {
              const parts = [];
              if (title) parts.push(`# ${title}`);
              if (text) parts.push(text);
              if (url) parts.push(url);
              const noteContent = parts.join('\n\n');
              const baseName = (title || 'Shared Note')
                .toLowerCase()
                .replace(/[^a-z0-9_-]+/g, '-')
                .replace(/^-+|-+$/g, '')
                .slice(0, 30) || 'shared-note';
              filename = `${baseName}.md`;
              blob = new Blob([noteContent], { type: 'text/markdown' });
            }
          }

          if (filename && blob) {
            await saveSharedFileToIdb(filename, blob);
          }
          const redirectUrl = filename ? `./?share-received=${encodeURIComponent(filename)}` : './';
          return Response.redirect(redirectUrl, 303);
        } catch (err) {
          console.warn('SW share_target POST error:', err);
          return Response.redirect('./', 303);
        }
      })()
    );
    return;
  }

  if (req.method !== 'GET') return;

  if (url.pathname.includes('/vendor/')) {
    event.respondWith(cacheFirst(req));
    return;
  }
  event.respondWith(networkFirst(req));
});

function saveSharedFileToIdb(filename, blob) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('readover');
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('blobs')) {
        db.close();
        return resolve();
      }
      const tx = db.transaction('blobs', 'readwrite');
      const store = tx.objectStore('blobs');
      // Store in temporary IndexedDB staging cache with session:share| prefix and legacy shared: prefix
      const item = {
        key: `session:share|${filename}`,
        sourceId: 'device',
        sha: `shared:${Date.now()}`,
        blob,
      };
      store.put(item);
      store.put({
        ...item,
        key: `shared:${filename}`,
      });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
    req.onerror = () => reject(req.error);
  });
}

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
