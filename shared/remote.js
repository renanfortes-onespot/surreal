/* ============================================================
   SURREAL — sincronia com o Supabase (carrega depois de core.js)
   Ativo quando há shared/config.js preenchido E (fora do localhost OU
   localStorage.sg_modo = 'remoto'). No localhost sem a flag, segue a demo local.

   Como funciona: o app continua trabalhando no documento SG.D. A cada
   SG.salvar(), comparamos cada item com a última versão sincronizada e só os
   itens que mudaram sobem (upsert por coleção+id). A cada 20 s (e quando o app
   volta para a frente) puxamos o que os outros mudaram desde a última vez.
   Se o mesmo item mudou aqui e ainda não subiu, o daqui vale.
   ============================================================ */
(function () {
  'use strict';
  var CFG = window.SG_REMOTO || {};
  var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var flag = null; try { flag = localStorage.getItem('sg_modo'); } catch (e) {}
  var ATIVO = !!(CFG.url && CFG.key && window.supabase && (!local || flag === 'remoto'));
  var CACHE = 'sg_cache_r';
  var COLS = ['insumos', 'receitas', 'produtos', 'tamanhos', 'canais', 'compras', 'producoes', 'vendas', 'despesas', 'clientes', 'contagens', 'ajustes'];
  var ORDENADAS = { insumos: 1, receitas: 1, produtos: 1, tamanhos: 1, canais: 1 };

  var nomes = {}, sb = null, perfil = null, snap = {}, ultimo = null, enviando = false, pendente = false, tmPush = null, tmPull = null;
  var cbStatus = function () {}, estado = 'ok';

  function status(s, msg) { estado = s; try { cbStatus(s, msg); } catch (e) {} }

  /* documento → linhas */
  function explode(D) {
    var m = {};
    COLS.forEach(function (c) {
      (D[c] || []).forEach(function (it, i) {
        var d = it; if (ORDENADAS[c]) { d = Object.assign({}, it); d._o = i; }
        m[c + '\u0001' + it.id] = { colecao: c, id: String(it.id), dados: d };
      });
    });
    m['config\u0001main'] = { colecao: 'config', id: 'main', dados: D.config };
    Object.keys(D.precos || {}).forEach(function (p) { m['precos\u0001' + p] = { colecao: 'precos', id: p, dados: D.precos[p] }; });
    m['meta\u0001main'] = { colecao: 'meta', id: 'main', dados: { versao: D.versao, geradoEm: D.geradoEm, alertasImport: D.alertasImport || [] } };
    return m;
  }
  /* linhas → documento */
  function monta(linhas) {
    var D = { versao: 1, config: null, precos: {}, alertasImport: [] };
    COLS.forEach(function (c) { D[c] = []; });
    linhas.forEach(function (r) {
      if (r.apagado) return;
      if (COLS.indexOf(r.colecao) >= 0) D[r.colecao].push(limpa(r.colecao, r.dados));
      else if (r.colecao === 'config') D.config = r.dados;
      else if (r.colecao === 'precos') D.precos[r.id] = r.dados;
      else if (r.colecao === 'meta') { D.versao = r.dados.versao || 1; D.geradoEm = r.dados.geradoEm; D.alertasImport = r.dados.alertasImport || []; }
    });
    Object.keys(ORDENADAS).forEach(function (c) { ordena(D[c]); });
    return D;
  }
  function limpa(c, d) { return d; }   // _o fica no objeto; é inofensivo e mantém a ordem
  function ordena(a) { a.sort(function (x, y) { return (x._o == null ? 1e9 : x._o) - (y._o == null ? 1e9 : y._o); }); }
  function json(x) { return JSON.stringify(x); }

  function guardaCache() {
    try { localStorage.setItem(CACHE, JSON.stringify({ uid: perfil && perfil.id, D: SG.D, snap: snap, ultimo: ultimo })); } catch (e) {}
  }

  /* ── subir alterações ── */
  function empurrar() { clearTimeout(tmPush); tmPush = setTimeout(push, 350); }
  function diff() {
    var atual = explode(SG.D), sobe = [];
    Object.keys(atual).forEach(function (k) { var j = json(atual[k].dados); if (snap[k] !== j) sobe.push({ k: k, row: { colecao: atual[k].colecao, id: atual[k].id, dados: atual[k].dados, apagado: false }, j: j }); });
    Object.keys(snap).forEach(function (k) {
      if (atual[k]) return; var p = k.split('\u0001');
      sobe.push({ k: k, row: { colecao: p[0], id: p[1], dados: JSON.parse(snap[k]), apagado: true }, j: null });
    });
    return sobe;
  }
  function push() {
    if (!sb || !perfil) return;
    if (enviando) { pendente = true; return; }
    var sobe = diff();
    if (!sobe.length) { status(navigator.onLine === false ? 'off' : 'ok'); guardaCache(); return; }
    enviando = true; status('sync');
    var lotes = []; for (var i = 0; i < sobe.length; i += 400) lotes.push(sobe.slice(i, i + 400));
    (function prox(n) {
      if (n >= lotes.length) { enviando = false; guardaCache(); if (pendente) { pendente = false; push(); } else status('ok'); return; }
      var l = lotes[n];
      sb.from('sg_registros').upsert(l.map(function (x) { return x.row; }), { onConflict: 'colecao,id' }).then(function (r) {
        if (r.error) throw r.error;
        l.forEach(function (x) { if (x.j == null) delete snap[x.k]; else snap[x.k] = x.j; });
        prox(n + 1);
      }).catch(function (e) {
        enviando = false; guardaCache(); console.warn('sync push', e);
        status('off', 'Sem conexão: as alterações ficam guardadas e sobem sozinhas.');
        clearTimeout(tmPush); tmPush = setTimeout(push, 15000);
      });
    })(0);
  }

  /* ── baixar o que os outros mudaram ── */
  function buscaTudo(desde) {
    var todas = [], pg = 0, T = 1000;
    function pag() {
      var q = sb.from('sg_registros').select('colecao,id,dados,apagado,atualizado_em').order('atualizado_em', { ascending: true }).order('colecao').order('id').range(pg * T, pg * T + T - 1);
      if (desde) q = q.gte('atualizado_em', desde); else q = q.eq('apagado', false);
      return q.then(function (r) {
        if (r.error) throw r.error;
        todas = todas.concat(r.data); pg++;
        return r.data.length === T ? pag() : todas;
      });
    }
    return pag();
  }
  function marcaUltimo(linhas) {
    linhas.forEach(function (r) { if (!ultimo || r.atualizado_em > ultimo) ultimo = r.atualizado_em; });
  }
  function aplica(linhas) {
    if (!linhas.length) return false;
    var D = SG.D, atual = explode(D), mudou = false;
    linhas.forEach(function (r) {
      var k = r.colecao + '\u0001' + r.id, j = r.apagado ? null : json(r.dados);
      var loc = atual[k] ? json(atual[k].dados) : null;
      if ((snap[k] || null) !== loc) return;   // mudança local ainda não enviada: a daqui vale
      if (j === loc) { if (j == null) delete snap[k]; else snap[k] = j; return; }
      mudou = true;
      if (COLS.indexOf(r.colecao) >= 0) {
        var a = D[r.colecao], i = -1;
        for (var x = 0; x < a.length; x++) if (String(a[x].id) === r.id) { i = x; break; }
        if (r.apagado) { if (i >= 0) a.splice(i, 1); }
        else if (i >= 0) a[i] = r.dados; else a.push(r.dados);
        if (ORDENADAS[r.colecao]) ordena(a);
      } else if (r.colecao === 'config') { if (!r.apagado) D.config = r.dados; }
      else if (r.colecao === 'precos') { if (r.apagado) delete D.precos[r.id]; else D.precos[r.id] = r.dados; }
      else if (r.colecao === 'meta' && !r.apagado) { D.versao = r.dados.versao; D.geradoEm = r.dados.geradoEm; D.alertasImport = r.dados.alertasImport; }
      if (j == null) delete snap[k]; else snap[k] = j;
    });
    return mudou;
  }
  function pull() {
    if (!sb || !perfil || enviando) return Promise.resolve();
    // janela de 15 s para trás: pega gravações que terminaram fora de ordem (é idempotente)
    var desde = ultimo ? new Date(new Date(ultimo).getTime() - 15000).toISOString() : null;
    return buscaTudo(desde).then(function (ls) {
      marcaUltimo(ls);
      if (aplica(ls)) { SG.notificar(); }
      guardaCache();
      if (estado === 'off') status('ok');
    }).catch(function (e) { console.warn('sync pull', e); status('off', 'Sem conexão com o servidor.'); });
  }
  function agenda() { clearInterval(tmPull); tmPull = setInterval(function () { if (document.visibilityState === 'visible') pull(); }, 20000); }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') pull(); });
  window.addEventListener('online', function () { push(); pull(); });

  /* ── sessão ── */
  function carregaPerfil(user) {
    return sb.from('sg_usuarios').select('id,email,nome,ativo').eq('id', user.id).maybeSingle().then(function (r) {
      if (r.error) throw r.error;
      if (!r.data || !r.data.ativo) { var e = new Error('SEM_ACESSO'); e.code = 'SEM_ACESSO'; throw e; }
      perfil = r.data;
      /* nomes de quem usa (para mostrar "quem lançou/contou") */
      return sb.from('sg_usuarios').select('id,nome').then(function (u) { (u.data || []).forEach(function (x) { nomes[x.id] = x.nome; }); return perfil; });
    });
  }
  function abrir(user, cb) {
    return carregaPerfil(user).then(function () {
      var c = null; try { c = JSON.parse(localStorage.getItem(CACHE) || 'null'); } catch (e) {}
      if (c && c.uid === perfil.id && c.D && c.D.config) {
        // abre na hora com o que já estava no aparelho; atualiza em seguida
        snap = c.snap || {}; ultimo = c.ultimo || null; SG.usar(c.D);
        cb.pronto(perfil);
        return pull().then(function () { push(); agenda(); });
      }
      status('sync');
      return buscaTudo(null).then(function (ls) {
        marcaUltimo(ls);
        var D = monta(ls);
        if (!D.config) { var e = new Error('BANCO_VAZIO'); e.code = 'BANCO_VAZIO'; throw e; }
        SG.usar(D); snap = {};
        var ex = explode(D); Object.keys(ex).forEach(function (k) { snap[k] = json(ex[k].dados); });
        guardaCache(); status('ok'); cb.pronto(perfil); agenda();
      });
    });
  }
  function iniciar(cb) {
    cbStatus = cb.status || cbStatus;
    sb.auth.getSession().then(function (r) {
      var s = r.data && r.data.session;
      if (!s) { cb.login(); return; }
      abrir(s.user, cb).catch(function (e) { erroAbrir(e, cb); });
    });
  }
  function erroAbrir(e, cb) {
    console.warn(e);
    if (e.code === 'SEM_ACESSO') { sb.auth.signOut(); cb.login('Este login não tem acesso ao app da Surreal.'); }
    else if (e.code === 'BANCO_VAZIO') cb.login('O banco ainda não recebeu os dados. Fale com a OneSpot.');
    else cb.login('Sem conexão com o servidor. Confira a internet e tente de novo.');
  }
  function entrar(email, senha, cb) {
    return sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: senha }).then(function (r) {
      if (r.error) { var m = /invalid/i.test(r.error.message) ? 'E-mail ou senha incorretos.' : /fetch|network/i.test(r.error.message) ? 'Sem conexão. Confira a internet.' : r.error.message; throw new Error(m); }
      return abrir(r.data.user, cb).catch(function (e) { erroAbrir(e, cb); throw new Error(''); });
    });
  }
  function sair() {
    try { localStorage.removeItem(CACHE); } catch (e) {}
    return sb.auth.signOut().then(function () { location.reload(); });
  }
  function trocarSenha(nova) {
    return sb.auth.updateUser({ password: nova }).then(function (r) { if (r.error) throw new Error(r.error.message); });
  }

  if (ATIVO) {
    sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'sg_auth' } });
    SG.aoSalvarLocal(empurrar);
  }
  window.SGR = {
    ativo: ATIVO, iniciar: iniciar, entrar: entrar, sair: sair, trocarSenha: trocarSenha,
    sincronizar: function () { push(); return pull(); },
    get perfil() { return perfil; }, nome: function (id) { return nomes[id] || null; }, get estado() { return estado; },
  };
})();
