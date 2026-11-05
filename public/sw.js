// Service Worker for HỆ THỐNG KIỂM TRA TRỰC TUYẾN
// v3: luôn ưu tiên phiên bản mới cho navigation/version.json, không đụng dữ liệu người dùng.
const CACHE_NAME = 'online-exam-system-v3';

const STATIC_PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.png',
  '/pwa-192x192.png',
  '/pwa-512x512.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(
        STATIC_PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: 'reload' }))
        )
      )
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  const isApiRequest =
    url.pathname.startsWith('/api/') ||
    url.pathname.includes('/api/') ||
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('cloudflare.com') ||
    url.protocol.startsWith('ws') ||
    request.headers.get('Upgrade') === 'websocket';

  if (isApiRequest) return;

  // version.json là nguồn sự thật để phát hiện bản mới: tuyệt đối không lấy từ Cache Storage.
  if (url.origin === self.location.origin && url.pathname === '/version.json') {
    event.respondWith(
      fetch(new Request(request, { cache: 'no-store' }))
        .catch(() => new Response(
          JSON.stringify({ offline: true }),
          {
            status: 503,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'no-store'
            }
          }
        ))
    );
    return;
  }

  // Navigation luôn network-first + no-store để reload thực sự lấy index mới.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(new Request(request, { cache: 'no-store' }))
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', clone));
          }
          return networkResponse;
        })
        .catch(async () => {
          const fallbackIndex = await caches.match('/index.html');
          if (fallbackIndex) return fallbackIndex;
          return new Response(
            'Mất kết nối mạng. Vui lòng kiểm tra lại đường truyền internet.',
            {
              status: 503,
              statusText: 'Service Unavailable',
              headers: new Headers({ 'Content-Type': 'text/plain; charset=utf-8' })
            }
          );
        })
    );
    return;
  }

  // Tài nguyên tĩnh: network-first, cache chỉ làm phương án offline.
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        if (
          networkResponse &&
          (networkResponse.status === 200 || networkResponse.type === 'opaque')
        ) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            if (url.protocol.startsWith('http')) {
              cache.put(request, responseClone);
            }
          });
        }
        return networkResponse;
      })
      .catch(async () => {
        const cachedResponse = await caches.match(request);
        if (cachedResponse) return cachedResponse;

        return new Response(
          'Mất kết nối mạng. Vui lòng kiểm tra lại đường truyền internet.',
          {
            status: 503,
            statusText: 'Service Unavailable',
            headers: new Headers({ 'Content-Type': 'text/plain; charset=utf-8' })
          }
        );
      })
  );
});
