// Bump VERSION whenever any app file changes, so phones download the new version.
const VERSION = 'v4';
const CACHE = 'tela-' + VERSION;
const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'brand.js',
  'lang.js',
  'zip.js',
  'app.js',
  'manifest.webmanifest',
  'icons/wordmark.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('tela-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache first: the app works fully offline once installed.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request)));
});
