/*
 * Easvarafy offline shell Service Worker (web browser).
 *
 *  - Pages (navigations): network-first, cached copy when offline,
 *    /offline.html as last resort.
 *  - /_next/static/* (content-hashed): cache-first.
 *  - Other same-origin static files: stale-while-revalidate.
 *  - /api/* and cross-origin requests are never touched (audio downloads and
 *    music data always go to the network; downloaded songs live in IndexedDB).
 *
 * The Android APK does not use this worker: it ships its own offline copy of
 * the app (see native/android/java/.../OfflineWebViewClient.java).
 */
const VERSION = 'easvarafy-sw-v1';
const PAGE_CACHE = `${VERSION}-pages`;
const ASSET_CACHE = `${VERSION}-assets`;
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_URL = '/offline.html';
const PRECACHE = ['/', OFFLINE_URL, '/manifest.webmanifest', '/favicon.svg'];
const MAX_ASSET_ENTRIES = 400;
const NAV_TIMEOUT_MS = 6000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PAGE_CACHE);
      await Promise.all(
        PRECACHE.map((url) =>
          fetch(url, { cache: 'reload' })
            .then((res) => (res.ok ? cache.put(url, res) : undefined))
            .catch(() => undefined)
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i += 1) {
    await cache.delete(keys[i]);
  }
}

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

async function handleNavigation(request) {
  const url = new URL(request.url);
  const cacheKey = url.pathname === '' ? '/' : url.pathname;
  const cache = await caches.open(PAGE_CACHE);
  try {
    const res = await Promise.race([fetch(request), timeout(NAV_TIMEOUT_MS)]);
    if (res && res.ok && res.type === 'basic') {
      cache.put(cacheKey, res.clone()).catch(() => {});
    }
    return res;
  } catch {
    return (
      (await cache.match(cacheKey)) ||
      (await cache.match('/')) ||
      (await cache.match(OFFLINE_URL)) ||
      new Response('<h1>Offline</h1>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    );
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === 'basic') {
    cache.put(request, res.clone()).then(() => trimCache(ASSET_CACHE, MAX_ASSET_ENTRIES)).catch(() => {});
  }
  return res;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res.ok && res.type === 'basic') cache.put(request, res.clone()).catch(() => {});
      return res;
    })
    .catch(() => undefined);
  return hit || (await network) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;
  if (request.headers.get('range')) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request));
    return;
  }
  // RSC payloads / data requests: let Next.js handle failures itself.
  if (url.searchParams.has('_rsc') || request.headers.get('rsc')) return;
  if (/\.(?:png|jpe?g|gif|svg|ico|webp|woff2?|webmanifest|css|js)$/i.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
