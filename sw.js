/* Drift offline service worker.
 *
 * Caches the app shell (same-origin GETs) so Drift keeps opening with no
 * connection. Offline, the app runs in This-device mode — Cloud (Supabase)
 * data needs the network and the app says so honestly instead of failing
 * silently.
 *
 * Bump CACHE_VERSION when shipping a new build so clients pick up fresh
 * assets. Only same-origin requests are ever cached; API calls, range
 * requests (media streaming), and non-GETs always go to the network.
 */

const CACHE_VERSION = 'drift-202609302056';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => {
        // First install with no network: skip precaching, runtime caching
        // will fill in on later loads. Still activate.
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith('drift-') && k !== CACHE_VERSION).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!isSameOrigin(url)) return;
  // Media streaming uses byte ranges — let those through untouched.
  if (request.headers.has('range')) return;

  // Navigations: try the network first so a fresh index.html wins when
  // online; fall back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put('/index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/index.html', { cacheName: CACHE_VERSION }))
    );
    return;
  }

  // Static assets: cache-first, populate on miss.
  event.respondWith(
    caches.match(request, { cacheName: CACHE_VERSION }).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((res) => {
        if (res && (res.status === 200 || res.status === 0)) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});
