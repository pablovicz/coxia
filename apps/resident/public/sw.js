// Service worker do workspace do residente (PWA). Não guarda o app em cache — cada abertura busca a versão
// mais nova (deploys valem na hora). Só mostra a página "sem conexão" quando a rede cai.
const CACHE = 'kaju-residente-offline-v1';
const OFFLINE = ['/offline.html', '/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(OFFLINE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
    return;
  }
  if (new URL(req.url).pathname === '/icon-192.png') {
    event.respondWith(fetch(req).catch(() => caches.match('/icon-192.png')));
  }
});
