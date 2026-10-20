// Offline support for the JARVIS home-screen app.
// Settings and chat live in the browser's storage, which updates never touch.
const CACHE = 'jarvis-v1';
const FONT_CACHE = 'jarvis-fonts';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('jarvis') && k !== CACHE && k !== FONT_CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate') {
    // Newest page when online (so updates arrive by themselves); the saved one offline.
    event.respondWith(fetch(req, { cache: 'no-store' }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('index.html', copy)); }
      return res;
    }).catch(() => caches.match('index.html')));
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(caches.open(FONT_CACHE).then((cache) => cache.match(req).then((hit) => {
      const refresh = fetch(req).then((res) => { cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || refresh;
    })));
  }
});
