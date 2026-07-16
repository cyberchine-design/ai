const CACHE_NAME = 'thaimachine-ai-cache-v5';
const ASSETS = [
  './',
  './index.html',
  './favicon.svg',
  './manifest.json'
];

// Force immediate activation
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// Claim all clients immediately
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('Service Worker: Clearing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Network-first falling back to cache
self.addEventListener('fetch', (e) => {
  // Skip non-http(s) requests (chrome-extension://, data:, blob:, etc.) - we can't cache those
  const url = new URL(e.request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return; // Let the browser handle it directly
  }

  // Skip version.json - always go to network for freshness check
  if (e.request.url.includes('version.json')) {
    e.respondWith(fetch(e.request));
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // Only cache http(s) responses with OK status
        if (res && res.status === 200 && res.type === 'basic') {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, resClone);
          }).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
