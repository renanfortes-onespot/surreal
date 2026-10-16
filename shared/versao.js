/* Surreal · atualização automática.
   Cada publicação grava um carimbo em version.json (tools/publicar.py). A página compara
   com o carimbo com que foi carregada e, se houver versão nova, recarrega sozinha —
   ao abrir, ao voltar para a aba e a cada 5 minutos. Assim ninguém fica preso numa
   versão velha guardada pelo navegador (GitHub manda cache de 10 min) ou pelo app. */
(function () {
  var BUILD = window.SG_BUILD || '';
  var raiz = location.pathname.indexOf('/gestao') >= 0 ? '../' : './';
  function confere() {
    if (!BUILD || /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
    fetch(raiz + 'version.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || !j.v || j.v === BUILD) return;
      var k = 'sg_reload_' + j.v; try { if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, '1'); } catch (e) {}
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (x) { return x.update(); })); })
          .catch(function () {}).then(function () { location.reload(); });
      } else location.reload();
    }).catch(function () {});
  }
  window.addEventListener('load', confere);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') confere(); });
  setInterval(confere, 5 * 60 * 1000);
})();
