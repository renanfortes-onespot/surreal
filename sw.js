/* Service worker da Surreal: faz a página virar app (ícone na tela de início, tela cheia).
   Rede primeiro, cache como rede de segurança. Ao publicar, trocar CACHE. */
const CACHE = 'surreal-v2';
const ESSENCIAIS = ['./', './index.html', './manifest.json', './shared/config.js', './shared/core.js', './shared/remote.js', './img/logo-branco.png', './img/logo-navy.png', './img/icone-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ESSENCIAIS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;   // Supabase e CDN: direto na rede, nunca no cache
  const u = new URL(e.request.url);
  const doc = e.request.mode === 'navigate' || u.pathname.endsWith('/') || /\.(html|js|json)$/.test(u.pathname);
  const pedido = doc ? new Request(e.request.url, { cache: 'no-store', credentials: 'same-origin' }) : e.request;
  e.respondWith(fetch(pedido).then(r => { if (r.ok) { const c2 = r.clone(); caches.open(CACHE).then(c => c.put(e.request, c2)); } return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
});
