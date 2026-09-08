const CACHE_NAME = 'mr-scrap-v3';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const requestUrl = new URL(request.url);

  // API responses are never cached. Offline API access must fail honestly instead of returning
  // stale social-monitoring data that could look current.
  if (requestUrl.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  // Navigation/static requests use network-first with a small app-shell fallback.
  event.respondWith(
    fetch(request).catch(async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') return caches.match('/index.html');
      return Response.error();
    })
  );
});

// Web Push is intentionally not registered in this alpha. The backend does not yet persist
// PushSubscription records or dispatch VAPID messages, so keeping dormant push handlers here
// would imply a delivery path that does not exist. Android background matches use native local
// notifications instead; Web Push will be added end-to-end under the dedicated notification work.
