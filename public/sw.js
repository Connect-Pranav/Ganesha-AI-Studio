// Ganesha AI Studio service worker — makes the dashboard installable and opens instantly.
// Safety rules: never caches /api/* (live, owner data) or /agent-data/* (live JSON); never stores
// the admin token (that stays in the page's localStorage). Pages are network-first so a new
// deploy shows up on the next open; hashed build assets are cache-first.
const CACHE = 'ganesha-shell-v3';
const SHELL = ['./', './index.html', './manifest.webmanifest', './brand/icon-192.png', './brand/mark-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // fonts etc. go straight to the network
  if (url.pathname.startsWith('/api/') || url.pathname.includes('/agent-data/') || url.pathname.endsWith('/version.json')) return; // always live
  if (url.pathname.startsWith('/agentverse')) return; // separate app: never cache it as the studio's index.html
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }
  if (url.pathname.includes('/assets/') || url.pathname.includes('/brand/')) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
