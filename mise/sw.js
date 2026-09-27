// Offline support for the installable Mise app (version c4d0bfcbe3).
// Your lists live in the browser's storage, which updates never touch.
const CACHE = 'mise-c4d0bfcbe3';
const FONT_CACHE = 'mise-fonts';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png', 'vendor/Sortable.min.js', 'vendor/party.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== FONT_CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
function withTimeout(p, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate') {
    event.respondWith(withTimeout(fetch(req), 4000)
      .then((res) => { if (res.ok) caches.open(CACHE).then((c) => c.put('index.html', res.clone())); return res; })
      .catch(() => caches.match('index.html')));
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
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
