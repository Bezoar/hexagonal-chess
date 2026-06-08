// sw.js — offline app shell for the static site.
// Bump CACHE when shipping changes so clients pick up a fresh precache.
const CACHE = 'hexchess-v33';
const ASSETS = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './src/ui.js', './src/game.js', './src/rules.js', './src/hex.js', './src/match.js',
  './src/render.js', './src/pieces.js', './src/storage.js', './src/audio.js', './src/clock.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isFont = url.host.includes('fonts.googleapis.com') || url.host.includes('fonts.gstatic.com');

  // Navigations: network-first so deploys are picked up, with an offline fallback.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((r) => { caches.open(CACHE).then((c) => c.put('./index.html', r.clone())); return r; })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  // Same-origin assets: network-first so a deploy lands on the next reload (no
  // stale-CSS dance); fall back to cache only when offline.
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req)
        .then((r) => { if (r && r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); } return r; })
        .catch(() => caches.match(req)),
    );
    return;
  }

  // Google Fonts: cache-first (they rarely change; enables offline after first load).
  if (isFont) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((r) => {
        if (r && (r.ok || r.type === 'opaque')) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); }
        return r;
      })),
    );
  }
});
