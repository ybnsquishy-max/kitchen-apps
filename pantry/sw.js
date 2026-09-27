// Offline support for the installable Pantry app. The build script replaces
// 1c1ccd02d5 with a hash of the app files, so each release gets a fresh cache.
// Your pantry list lives in localStorage, which updates never touch.
const CACHE = 'pantry-__VERSION__';
const FONT_CACHE = 'pantry-fonts';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'vendor/Sortable.min.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== FONT_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // The page itself: try the network first so updates arrive, fall back offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      withTimeout(fetch(req), 4000)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put('index.html', res.clone()));
          return res;
        })
        .catch(() => caches.match('index.html'))
    );
    return;
  }

  // App files: from the cache, fetched once if missing.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
        return res;
      }))
    );
    return;
  }

  // Google Fonts: serve the saved copy, refresh it in the background.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(FONT_CACHE).then((cache) => cache.match(req).then((hit) => {
        const refresh = fetch(req).then((res) => { cache.put(req, res.clone()); return res; }).catch(() => hit);
        return hit || refresh;
      }))
    );
  }
});
