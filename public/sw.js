/* ── IRL Race — Service Worker (Cache-First) ── */

const CACHE_NAME = 'irl-race-__BUILD_HASH__';

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

// Fetch: strategy depends on asset type
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests and cross-origin (CDN fonts, analytics, etc.)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // Hashed build assets (JS/CSS with content hash in filename, e.g. index-DcWYd9Tb.js)
  // Use NETWORK-FIRST: new deploys produce new hashes, so always try network.
  // This eliminates stale cache issues after Vercel deploys.
  const isHashedAsset = /\/assets\/[^/]+-[a-zA-Z0-9]{8,}\.(js|css)$/i.test(url.pathname);

  if (isHashedAsset) {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(event.request).then((cached) => cached || new Response('Offline', { status: 503 })))
    );
    return;
  }

  // Unhashed static assets (images, models, audio, fonts) — CACHE-FIRST
  // These don't change between deploys (same filename = same content).
  const isStatic = /\.(jpg|jpeg|png|webp|svg|glb|gltf|mp3|wav|ogg|woff2?)$/i.test(url.pathname)
    || url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/manifest.json';

  if (isStatic) {
    // index.html and manifest.json: network-first (they reference hashed bundles)
    if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/manifest.json') {
      event.respondWith(
        fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => caches.match(event.request).then((cached) => cached || new Response('Offline', { status: 503 })))
      );
      return;
    }
    // Images, models, audio: cache-first (immutable content)
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

// ── Predictive Pre-caching ──
// Main thread can send a list of URLs to pre-cache (e.g. environment-specific trees)
self.addEventListener('message', (event) => {
  if (event.data?.type === 'prefetch' && Array.isArray(event.data.urls)) {
    caches.open(CACHE_NAME).then((cache) => {
      event.data.urls.forEach((url) => {
        cache.match(url).then((hit) => {
          if (!hit) cache.add(url).catch(() => {});
        });
      });
    });
  }
});
