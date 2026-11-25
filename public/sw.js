/* Drops Chat service worker: offline app shell + Web Push (FCM).
 * Plain JS on purpose — no build step, no Firebase SDK, no config needed here. */
const VERSION = 'hi-v6';
// Photos and voice notes: cache-first, kept across app updates, capped (oldest out first).
const MEDIA = 'hi-media-v1';
const MEDIA_MAX = 250;
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== MEDIA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Pages: network first, fall back to the cached shell when offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put('./index.html', copy)); return res; })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  // Update checks must always reach the server.
  if (url.pathname.endsWith('/version.json')) return;

  // Own static files and Google Fonts: stale-while-revalidate.
  const sameOrigin = url.origin === self.location.origin;
  const fonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if ((sameOrigin && !url.pathname.startsWith('/__/')) || fonts) {
    e.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const hit = await cache.match(req);
        const net = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; }).catch(() => hit);
        return hit || net;
      }),
    );
  }
  // Storage downloads (photos, thumbnails, voice notes): cache-first. View-once photos
  // (…/once/…) are never cached. The app evicts entries when a photo is deleted.
  if (isMedia(url)) {
    e.respondWith(
      caches.open(MEDIA).then(async (cache) => {
        const hit = await cache.match(req.url);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') {
          await cache.put(req.url, res.clone());
          trimMedia(cache);
        }
        return res;
      }).catch(() => fetch(req)),
    );
  }
  // Everything else (Firestore, Auth) goes straight to the network.
});

function isMedia(url) {
  const storageHost = url.hostname === 'firebasestorage.googleapis.com' || (/\/v0\/b\//.test(url.pathname) && url.port === '9199');
  if (!storageHost || url.searchParams.get('alt') !== 'media') return false;
  return !/%2Fonce%2F|\/once\//i.test(url.pathname);
}

async function trimMedia(cache) {
  try {
    const keys = await cache.keys();
    const extra = keys.length - MEDIA_MAX;
    for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
  } catch { /* ignore */ }
}

// FCM delivers {data:{title, body, url, tag}} (sent by functions/src/notify.ts).
self.addEventListener('push', (e) => {
  let payload = {};
  try { payload = e.data ? e.data.json() : {}; } catch { payload = { data: { body: e.data && e.data.text() } }; }
  const d = payload.data || payload.notification || {};
  const title = d.title || 'Drops Chat';
  e.waitUntil(
    self.registration.showNotification(title, {
      body: d.body || 'New message',
      tag: d.tag || 'drops',
      renotify: true,
      icon: './icons/icon-192.png',
      badge: './icons/badge-96.png',
      data: { url: d.url || './', room: d.room || '', tab: d.tab || '', invite: d.invite || '', device: d.device || '' },
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const data = e.notification.data || {};
  const target = new URL(data.url || './', self.location.href).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // App already open: bring it forward and ask it to open that chat and tab.
      for (const c of list) {
        if ('focus' in c) {
          if (data.device) c.postMessage({ type: 'open-device', device: data.device });
          else if (data.invite) c.postMessage({ type: 'open-invite', room: data.invite });
          else if (data.room) c.postMessage({ type: 'open-chat', room: data.room, tab: data.tab || undefined });
          return c.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
