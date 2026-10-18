/* Service worker da Surreal: faz a página virar app (ícone na tela de início, tela cheia).
   Rede primeiro, cache como rede de segurança. Ao publicar, trocar CACHE.
   Redirecionamento (ex.: /gestao → /gestao/) volta como redirect de verdade: devolver
   a resposta já redirecionada numa navegação dá ERR_FAILED no Chrome. */
const CACHE = 'surreal-20261018170536';
const ESSENCIAIS = ['./assets/excel-export.js', './assets/pdf-export.js', './', './index.html', './manifest.json', './shared/config.js', './shared/versao.js', './shared/core.js', './shared/remote.js', './img/logo-branco.png', './img/logo-navy.png', './img/icone-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ESSENCIAIS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  if (e.request.url.indexOf('version.json') >= 0) return;   // carimbo de versão: sempre direto na rede   // Supabase e CDN: direto na rede, nunca no cache
  const u = new URL(e.request.url);
  const nav = e.request.mode === 'navigate';
  const doc = nav || u.pathname.endsWith('/') || /\.(html|js|json)$/.test(u.pathname);
  const pedido = doc ? fetch(e.request.url, { cache: 'no-store', credentials: 'same-origin' }) : fetch(e.request);
  e.respondWith(pedido.then(r => {
    if (r.redirected) return Response.redirect(r.url, 301);
    if (r.ok) { const c2 = r.clone(); caches.open(CACHE).then(c => c.put(e.request, c2)); }
    return r;
  }).catch(() => caches.match(e.request).then(r => r || (nav ? caches.match('./index.html') : Response.error()))));
});
