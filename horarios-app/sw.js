const CACHE_VERSION = 'v2026.08.31.5';
const CACHE_NAME = `crew-app-${CACHE_VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './favicon.png',
  './auth-manager.js'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', event => {
  // 1. FILTRO VITAL: Ignorar POST de Firebase y extensiones de Chrome
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) {
    return; // Deja pasar la petición directo a internet sin guardarla
  }

  if (event.request.url.includes('version.json')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // 2. ESTRATEGIA: RED PRIMERO (Solo para los GET permitidos)
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, responseClone);
        });
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then(cachedResponse => {
          if (cachedResponse) {
            return cachedResponse;
          }
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});