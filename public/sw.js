/* ── IRL Race — Service Worker (Cache-First) ── */

const CACHE_NAME = 'irl-race-v5-20260319';

// Assets to pre-cache on install
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/loading-bg.jpg',
];

// Install: pre-cache critical shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

// Fetch: cache-first for same-origin static assets, network-first for everything else
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests and cross-origin (CDN fonts, analytics, etc.)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // Cache-first for static assets (JS, CSS, images, models, audio)
  const isStatic = /\.(js|css|jpg|jpeg|png|webp|svg|glb|gltf|mp3|wav|ogg|woff2?)$/i.test(url.pathname)
    || url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/manifest.json';

  if (isStatic) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
  }
  // Everything else: network only (API calls, etc.)
});
