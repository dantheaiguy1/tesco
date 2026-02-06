// ShopShot Service Worker - Lightweight caching for PWA
const CACHE_NAME = 'shopshot-v1';
const STATIC_ASSETS = [
  '/static/marketplace-export.js',
  '/static/comparison-slider.js',
  '/static/batch-upload.js',
  '/static/referral.js',
  '/static/variation-selector.js',
  '/favicon.svg',
  '/favicon-192.png',
  '/favicon-512.png'
];

// Install - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate - clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch - network first for API, cache first for static
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache API calls or auth routes
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
    return;
  }

  // Cache-first for static assets
  if (url.pathname.startsWith('/static/') || url.pathname.match(/\.(png|jpg|svg|ico|js|css)$/)) {
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
    return;
  }

  // Network-first for HTML pages
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
