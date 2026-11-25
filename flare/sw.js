// Offline support for the installable Flare app (version 48471b030d).
// Your people, your card and your settings live in the browser's storage,
// which updates never touch.
const CACHE = 'flare-48471b030d';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  // Only tidy Flare's own caches; the other apps on this site keep theirs.
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('flare-') && k !== CACHE).map((k) => caches.delete(k))))
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
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/version.json')) return;   // always from the network
  if (req.mode === 'navigate') {
    // In an emergency the saved copy must open even with no signal, so don't
    // wait long on the network.
    const net = fetch(req.url, { cache: 'no-store', credentials: 'same-origin' }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('index.html', copy)); }
      return res;
    });
    event.waitUntil(net.catch(() => {}));
    event.respondWith(withTimeout(net, 2500).catch(() => caches.match('index.html').then((hit) => hit || net)));
    return;
  }
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  })));
});
