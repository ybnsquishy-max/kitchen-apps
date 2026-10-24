// Offline support for the installable Dash app (version 8399b174fe).
// Your places, favourites and songs live in the browser's storage, which updates never touch.
const CACHE = 'dash-8399b174fe';
const SHARE = 'dash-share';   // a contact handed to Dash from another app, kept across updates
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'vendor/leaflet.js', 'vendor/leaflet.css', 'icons/icon.svg', 'icons/icon-192-neon.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon-neon.png', 'icons/favicon-32.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  // Only tidy Dash's own caches; the other apps on this site keep theirs.
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('dash-') && k !== CACHE && k !== SHARE).map((k) => caches.delete(k))))
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
  // A contact shared to Dash from another app (Android's Share menu).
  if (req.method === 'POST' && new URL(req.url).pathname.endsWith('/share-contact')) {
    event.respondWith((async () => {
      try {
        const form = await req.formData(), c = await caches.open(SHARE);
        await c.delete('card');
        const files = form.getAll('card').filter((f) => f && typeof f !== 'string');
        let text = files.length ? (await Promise.all(files.map((f) => f.text()))).join('\n') : '';
        if (!text) text = [form.get('text'), form.get('title')].filter(Boolean).join('\n');
        if (text) await c.put('card', new Response(text, { headers: { 'content-type': 'text/vcard' } }));
      } catch (e) {}
      return Response.redirect('./?shared=contact', 303);
    })());
    return;
  }
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
