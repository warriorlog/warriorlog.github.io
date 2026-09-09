/* Service worker: instant offline launch, and at most one stale launch after a
   deploy. No build stamp and no CI — the shell list is revalidated by ETag. */
const CACHE = 'warriorlog-shell-v1';

const SHELL = [
  './', './index.html', './style.css', './config.js', './manifest.webmanifest',
  './src/app.js', './src/util.js', './src/events.js', './src/store.js',
  './src/reduce.js', './src/engine.js', './src/placement.js', './src/gamify.js', './src/sync.js', './src/duo.js', './src/boss.js',
  './src/views/chrome.js', './src/views/setup.js', './src/views/home.js', './src/views/session.js',
  './src/views/complete.js', './src/views/journal.js', './src/views/body.js',
  './src/views/silhouette.js',
  './src/views/duo.js', './src/views/boss.js', './src/views/settings.js',
  './data/program.json', './data/gamification.json', './data/copy.json',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png',
].map(p => new URL(p, self.location).href);

const SHELL_SET = new Set(SHELL);

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;      // api.github.com is never intercepted
  if (url.pathname.includes('/log/')) return;

  if (SHELL_SET.has(url.href)) {
    // Cache-first, so the app opens instantly and works with no network at all.
    e.respondWith(caches.match(request).then(hit => hit || fetch(request)));
    return;
  }
  if (request.mode === 'navigate') {
    e.respondWith(caches.match(new URL('./index.html', self.location).href).then(hit => hit || fetch(request)));
    return;
  }
  // Anything NOT in the shell list is network-first. Cache-first here would serve
  // a file added in a later deploy stale forever.
  e.respondWith(fetch(request).catch(() => caches.match(request)));
});

self.addEventListener('message', (e) => {
  if (e.data?.type === 'check-update') e.waitUntil(revalidate());
  if (e.data?.type === 'skip-waiting') self.skipWaiting();
});

let lastCheck = 0;

async function revalidate() {
  if (Date.now() - lastCheck < 5 * 60_000) return;
  lastCheck = Date.now();
  const cache = await caches.open(CACHE);
  const fresh = [];
  let changed = false;
  try {
    for (const url of SHELL) {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) return;                                  // a partial refresh is worse than none
      const old = await cache.match(url);
      const tag = (r) => r?.headers.get('etag') ?? r?.headers.get('last-modified') ?? r?.headers.get('content-length');
      if (!old || tag(old) !== tag(res)) changed = true;
      fresh.push([url, res]);
    }
  } catch { return; }                                       // offline: keep what we have

  for (const [url, res] of fresh) await cache.put(url, res);
  if (!changed) return;
  for (const client of await self.clients.matchAll()) client.postMessage({ type: 'update-ready' });
}
