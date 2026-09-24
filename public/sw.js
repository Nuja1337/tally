/* Tally service worker: caches the app shell for offline use and receives files shared into the app.
   Bump VERSION whenever a file changes so installed copies fetch the update. /api/ is never cached. */
const VERSION = 'tally-2.6.0';
const ASSETS = ['./', './index.html', './styles.css', './manifest.webmanifest', './js/ui.js', './js/i18n.js', './js/exlib.js', './js/exercises.js', './js/schema.js', './js/store.js', './js/sync.js', './js/app.js',
  './js/i18n/en.js', './js/i18n/es.js', './js/i18n/fr.js', './js/i18n/pt.js', './js/i18n/de.js', './js/i18n/ja.js', './js/i18n/ko.js', './js/i18n/zh.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-512-maskable.png', './icons/apple-touch-icon.png', './examples/starter-profile.json'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== 'inbox').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req = event.request, url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return; /* straight to the network: no cache, no offline fallback */
  if (req.method === 'POST' && url.pathname.endsWith('/share')) {
    /* Web Share Target: park the shared file where the page can pick it up, then open the app */
    event.respondWith((async () => {
      try {
        const form = await req.formData(); const file = form.get('file');
        if (file) { const c = await caches.open('inbox'); await c.put('./shared.json', new Response(await file.text(), { headers: { 'Content-Type': 'application/json' } })); }
      } catch (e) {}
      return Response.redirect('./#start', 303);
    })());
    return;
  }
  if (req.method !== 'GET') return;
  event.respondWith(caches.match(req, { ignoreSearch: true }).then(cached => {
    const network = fetch(req).then(res => { if (res && res.ok) caches.open(VERSION).then(c => c.put(req, res.clone())); return res; })
      .catch(() => cached || (req.mode === 'navigate' ? caches.match('./index.html') : undefined));
    return cached || network;
  }));
});
