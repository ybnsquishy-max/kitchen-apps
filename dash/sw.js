// Offline support for the installable Dash app (version 16c6adb14f).
// Your places, favourites and songs live in the browser's storage, which updates never touch.
const CACHE = 'dash-16c6adb14f';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'vendor/leaflet.js', 'vendor/leaflet.css', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  // Only tidy Dash's own caches; the other apps on this site keep theirs.
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('dash-') && k !== CACHE).map((k) => caches.delete(k))))
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
  if (url.origin !== self.location.origin) return;       // maps, search and weather go straight to the internet
  if (url.pathname.endsWith('/version.json')) return;    // always from the network
  if (req.mode === 'navigate') {
    // Newest page from the network; on a weak signal (driving!) show the saved
    // copy but keep downloading, so the next open is up to date.
    const net = fetch(req.url, { cache: 'no-store', credentials: 'same-origin' }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('index.html', copy)); }
      return res;
    });
    event.waitUntil(net.catch(() => {}));
    event.respondWith(withTimeout(net, 6000).catch(() => caches.match('index.html').then((hit) => hit || net)));
    return;
  }
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  })));
});
