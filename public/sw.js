// Service Worker for HỆ THỐNG KIỂM TRA TRỰC TUYẾN
const CACHE_NAME = 'online-exam-system-v3-security';

const STATIC_PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.png',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/src/style.css'
];

// Install Event
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_PRECACHE).catch((err) => {
        console.warn('[SW] Precache warning:', err);
      });
    })
  );
});

// Activate Event - Clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Network-First fallback Cache for static assets, ALWAYS bypass API & Realtime
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Chỉ can thiệp method GET
  if (request.method !== 'GET' || request.headers.has('Authorization') || url.origin !== self.location.origin) {
    return;
  }

  // Tuyệt đối bỏ qua các request API, WebSocket, Realtime, hoặc Database
  const isApiRequest = 
    url.pathname.startsWith('/api/') || 
    url.pathname.includes('/api/') ||
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('cloudflare.com') ||
    url.protocol.startsWith('ws') ||
    request.headers.get('Upgrade') === 'websocket';

  if (isApiRequest) {
    // Để trình duyệt fetch trực tiếp trên mạng, không can thiệp cache
    return;
  }

  // Network-First cho tài nguyên tĩnh và navigation
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        // Kiểm tra response hợp lệ để cache
        if (
          networkResponse && 
          (networkResponse.status === 200 || networkResponse.type === 'opaque')
        ) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            // Không cache các route extension hoặc chrome-extension
            if (url.protocol.startsWith('http')) {
              cache.put(request, responseClone);
            }
          });
        }
        return networkResponse;
      })
      .catch(async () => {
        // Mạng lỗi hoặc đang offline -> Fallback về Cache
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
          return cachedResponse;
        }

        // Nếu là navigation request mà không có mạng, trả về index.html
        if (request.mode === 'navigate') {
          const fallbackIndex = await caches.match('/index.html');
          if (fallbackIndex) {
            return fallbackIndex;
          }
        }

        return new Response('Mất kết nối mạng. Vui lòng kiểm tra lại đường truyền internet.', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: new Headers({ 'Content-Type': 'text/plain; charset=utf-8' })
        });
      })
  );
});
