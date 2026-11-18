// Simpan file aplikasi di HP supaya bisa dibuka tanpa internet.
// File milik sendiri: coba internet dulu (supaya update langsung terpakai), cadangannya salinan di HP.
const CACHE = 'metronome-v46';
const FILES = ['./', './index.html', './manifest.webmanifest', './firebase-config.js', './icon-192.png', './icon-512.png','./welcome.mp4','./icon-maskable-512.png','./apple-touch-icon.png','./favicon-48.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  if (new URL(r.url).pathname.indexOf('/.netlify/') === 0) return;   // fungsi server: jangan di-cache
  const own = new URL(r.url).origin === self.location.origin;
  const store = (res) => { if (!res || !res.ok) return res; const copy = res.clone(); caches.open(CACHE).then((c) => c.put(r, copy)).catch(() => {}); return res; };
  if (own) {
    e.respondWith(Promise.race([fetch(r), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 4000))]).then(store).catch(() => caches.match(r).then((hit) => hit || caches.match('./index.html'))));
  } else {
    e.respondWith(caches.match(r).then((hit) => hit || fetch(r).then(store)));
  }
});
