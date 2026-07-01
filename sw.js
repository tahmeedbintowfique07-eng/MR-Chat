// MR Chat — Service Worker (PWA)
// Caches app shell for offline access + serves stale-while-revalidate for dynamic content.

const CACHE_NAME = 'mr-chat-v3-v1';
const APP_SHELL = [
  '/',
  '/index.html',
  '/inbox.html',
  '/feed.html',
  '/store.html',
  '/admin.html',
  '/manifest.json'
];

// Install — pre-cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Activate — clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — stale-while-revalidate for same-origin, network-only for Firebase
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Skip non-GET requests
  if (req.method !== 'GET') return;

  // Skip cross-origin requests (Firebase, Google APIs, CDNs) — always network
  if (url.origin !== self.location.origin) return;

  // Skip Firebase API + auth (must always be fresh)
  if (url.pathname.startsWith('/api/') || url.hostname.includes('firebaseio') || url.hostname.includes('gstatic.com')) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req).then((networkRes) => {
        // Cache successful same-origin responses
        if (networkRes && networkRes.status === 200 && networkRes.type === 'basic') {
          const resClone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        }
        return networkRes;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

// Push notifications (future — when push messaging is set up)
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}
  const title = data.title || 'MR Chat';
  const options = {
    body: data.body || 'You have a new message',
    icon: 'https://api.dicebear.com/7.x/adventurer/svg?seed=mrchat',
    badge: 'https://api.dicebear.com/7.x/adventurer/svg?seed=badge',
    data: data.url || '/'
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Notification click — focus app window
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      if (clientList.length > 0) {
        const client = clientList[0];
        if (event.notification.data) client.navigate(event.notification.data);
        return client.focus();
      }
      return clients.openWindow(event.notification.data || '/');
    })
  );
});
