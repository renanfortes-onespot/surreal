/* ============================================================
   SURREAL · gelato artesanal — núcleo compartilhado (app + painel)
   OneSpot · 16/10/2026
   Dados: localStorage ('sg_dados'), semeado por shared/seed.js (planilha).
   Tudo que é cálculo de custo, preço, estoque e caixa mora aqui, para o
   celular e o painel do PC mostrarem SEMPRE o mesmo número.
   ============================================================ */
(function () {
  'use strict';
  var CHAVE = 'sg_dados';
  var D = null;                       // dados em memória
  var ouvintes = [];

  /* ───────────── persistência ───────────── */
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function carregar() {
    var bruto = null;
    try { bruto = localStorage.getItem(CHAVE); } catch (e) {}
    if (bruto) { try { D = JSON.parse(bruto); } catch (e) { D = null; } }
    if (!D || !D.versao) { D = clone(window.SG_SEED); salvar(true); }
    return D;
  }
  var aoSalvarRemoto = null;   // shared/remote.js pluga aqui a sincronia com o Supabase
  function salvar(silencioso) {
    if (aoSalvarRemoto) aoSalvarRemoto();
    else try { localStorage.setItem(CHAVE, JSON.stringify(D)); } catch (e) { console.warn('Não salvou', e); }
    if (!silencioso) notificar();
  }
  function notificar() { ouvintes.forEach(function (f) { try { f(); } catch (e) { console.error(e); } }); }
  function usar(d) { D = d; }
  function aoSalvarLocal(f) { aoSalvarRemoto = f; }
  function resetar() { try { localStorage.removeItem(CHAVE); } catch (e) {} D = null; carregar(); salvar(); }
  // outra aba (app ↔ painel) salvou: recarrega e avisa
  window.addEventListener('storage', function (e) {
    if (aoSalvarRemoto || e.key !== CHAVE || !e.newValue) return;
    try { D = JSON.parse(e.newValue); } catch (x) { return; }
    ouvintes.forEach(function (f) { try { f(); } catch (er) { console.error(er); } });
  });
  function aoMudar(f) { ouvintes.push(f); }
  function novoId(p) { return (p || 'x') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  /* ───────────── formatação ───────────── */
  var fBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  function brl(v) { return v == null || isNaN(v) ? '—' : fBRL.format(v); }
  function brl0(v) { return v == null || isNaN(v) ? '—' : 'R$ ' + Math.round(v).toLocaleString('pt-BR'); }
  function pct(v, c) { return v == null || isNaN(v) || !isFinite(v) ? '—' : (v * 100).toFixed(c == null ? 1 : c).replace('.', ',') + '%'; }
  function num(v, c) { return v == null || isNaN(v) ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: c || 0, maximumFractionDigits: c || 0 }); }
  function hoje() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function dataBR(s) { if (!s) return '—'; var p = s.split('-'); return p[2] + '/' + p[1] + '/' + p[0].slice(2); }
  function dataCurta(s) { if (!s) return '—'; var p = s.split('-'); return p[2] + '/' + p[1]; }
  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  var MES3 = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  function nomeMes(ym, curto) { var m = +ym.slice(5, 7) - 1; return curto ? MES3[m] + '/' + ym.slice(2, 4) : MESES[m]; }
  function mesAtual() { return hoje().slice(0, 7); }
  function addMes(ym, n) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return y + '-' + String(m + 1).padStart(2, '0'); }

  /* ───────────── buscas ───────────── */
  function por(lista, id) { for (var i = 0; i < lista.length; i++) if (lista[i].id === id) return lista[i]; return null; }
  function insumo(id) { return por(D.insumos, id); }
  function receita(id) { return por(D.receitas, id); }
  function produto(id) { return por(D.produtos, id); }
  function tamanho(id) { return por(D.tamanhos, id); }
  function canal(id) { return por(D.canais, id); }
  function cliente(id) { return por(D.clientes, id); }

  /* ───────────── custo de insumo ─────────────
     Regra: vale o preço da ÚLTIMA compra registrada (R$ ÷ quantidade).
     Sem compra, vale o custo manual do cadastro. Cenários de simulação podem
     sobrepor (ctx.preco[id] = R$ ou ctx.var[id] = +10%). */
  function ultimaCompra(id) {
    var u = null;
    D.compras.forEach(function (c) { if (c.insumo === id && c.qtd > 0 && (!u || c.data >= u.data)) u = c; });
    return u;
  }
  function custoInsumo(id, ctx) {
    var i = insumo(id); if (!i) return { valor: 0, origem: 'inexistente' };
    var r;
    if (ctx && ctx.preco && ctx.preco[id] != null) r = { valor: +ctx.preco[id], origem: 'simulado' };
    else {
      var u = ultimaCompra(id);
      r = u ? { valor: u.valor / u.qtd, origem: 'compra', data: u.data } : { valor: +i.custoManual || 0, origem: i.estimado ? 'estimado' : 'manual' };
    }
    if (ctx && ctx.var) { var v = ctx.var[id] != null ? ctx.var[id] : ctx.var['*']; if (v) r = { valor: r.valor * (1 + v), origem: 'simulado' }; }
    return r;
  }

  /* ───────────── custo de receita (R$/kg) ───────────── */
  function custoReceitaKg(id, ctx, pilha) {
    var r = receita(id); if (!r) return 0;
    pilha = pilha || {}; if (pilha[id]) return 0; pilha[id] = 1;
    var t = 0;
    r.itens.forEach(function (it) {
      var ck = it.insumo ? custoInsumo(it.insumo, ctx).valor : custoReceitaKg(it.receita, ctx, pilha);
      t += (it.g / 1000) * ck;
    });
    delete pilha[id];
    return t / (r.rendKg || 1);
  }
  function pesoReceita(id) { var r = receita(id); return r ? r.itens.reduce(function (s, it) { return s + (+it.g || 0); }, 0) : 0; }
  function composicao(id, ctx) {
    var r = receita(id); if (!r) return [];
    return r.itens.map(function (it) {
      var nome, ck, orig;
      if (it.insumo) { var c = custoInsumo(it.insumo, ctx), ins = insumo(it.insumo); nome = ins ? ins.nome : it.insumo; ck = c.valor; orig = c.origem; }
      else { var sr = receita(it.receita); nome = sr ? sr.nome : it.receita; ck = custoReceitaKg(it.receita, ctx); orig = 'receita'; }
      return { item: it, nome: nome, g: it.g, custoKg: ck, custo: (it.g / 1000) * ck / (r.rendKg || 1), origem: orig };
    }).sort(function (a, b) { return b.custo - a.custo; });
  }

  /* ───────────── indiretos ───────────── */
  function indiretosMes() { return D.config.indiretos.reduce(function (s, i) { return s + (+i.valor || 0); }, 0); }
  function indiretoKg() { var k = +D.config.kgMesRateio || 0; return k > 0 ? indiretosMes() / k : 0; }

  /* ───────────── custo do pote (produto × tamanho × canal) ─────────────
     ingredientes = gramas × custo/kg da mistura (base + cobertura)
     + pote do tamanho + lacre/adesivo + kit de entrega (se o canal entrega)
     + rateio dos indiretos pelo peso. Mão de obra fica fora (decisão 16/10/2026). */
  function custoPote(pid, tid, cid, ctx) {
    var p = produto(pid), t = tamanho(tid), c = canal(cid) || {};
    var avisos = [];
    if (!p || !t) return null;
    var g = +t.g || 0;
    var kgBase = p.receita ? custoReceitaKg(p.receita, ctx) : null;
    if (!p.receita) avisos.push('Produto sem ficha técnica: custo dos ingredientes desconhecido.');
    var pc = p.cobertura ? (+p.pctCob || 0) : 0;
    var kgCob = p.cobertura ? custoReceitaKg(p.cobertura, ctx) : 0;
    if (p.cobertura) { var rc = receita(p.cobertura); if (rc && !rc.itens.length) avisos.push((rc.nome || 'Cobertura') + ' sem ficha técnica: entra com custo zero.'); }
    var base = kgBase == null ? 0 : (g * (1 - pc) / 1000) * kgBase;
    var cob = (g * pc / 1000) * kgCob;
    var pote = t.pote ? custoInsumo(t.pote, ctx).valor : 0;
    var it = t.pote && insumo(t.pote); if (it && it.estimado && !ultimaCompra(t.pote)) avisos.push(it.nome + ': preço estimado — registre uma compra para ficar exato.');
    var acab = (D.config.embalagemPote || []).reduce(function (s, id) { return s + custoInsumo(id, ctx).valor; }, 0);
    var kit = c.kitEntrega ? (D.config.kitEntrega || []).reduce(function (s, id) { return s + custoInsumo(id, ctx).valor; }, 0) : 0;
    var ind = indiretoKg() * g / 1000;
    var linhas = [
      { id: 'base', nome: 'Gelato', valor: base },
      { id: 'cob', nome: 'Cobertura', valor: cob },
      { id: 'pote', nome: 'Pote ' + t.ml + ' ml', valor: pote },
      { id: 'acab', nome: 'Lacre + adesivo', valor: acab },
      { id: 'kit', nome: 'Kit entrega', valor: kit },
      { id: 'ind', nome: 'Custos indiretos', valor: ind },
    ].filter(function (l) { return l.valor > 0.0001 || l.id === 'base'; });
    var total = linhas.reduce(function (s, l) { return s + l.valor; }, 0);
    return { total: total, linhas: linhas, g: g, avisos: avisos, semFicha: !p.receita };
  }

  /* ───────────── preço ─────────────
     preço sugerido = custo ÷ (1 − margem − taxa do canal − imposto)
     (margem sobre o PREÇO, igual à planilha). */
  function taxaCanal(cid) { var c = canal(cid); return (c ? +c.taxa || 0 : 0) + (+D.config.imposto || 0); }
  function precoTabela(pid, cid, tid) { var t = D.precos[pid]; t = t && t[cid]; var v = t && t[tid]; return v == null || v === '' ? null : +v; }
  function definirPreco(pid, cid, tid, v) {
    D.precos[pid] = D.precos[pid] || {}; D.precos[pid][cid] = D.precos[pid][cid] || {};
    if (v == null || v === '' || isNaN(v)) delete D.precos[pid][cid][tid]; else D.precos[pid][cid][tid] = +v;
  }
  function precificar(pid, tid, cid, opt, ctx) {
    opt = opt || {};
    var cp = custoPote(pid, tid, cid, ctx); if (!cp) return null;
    var tx = taxaCanal(cid);
    var margem = opt.margem != null ? +opt.margem : +D.config.margemAlvo;
    var den = 1 - margem - tx;
    var sugerido = den > 0 ? cp.total / den : null;
    var minimo = 1 - tx > 0 ? cp.total / (1 - tx) : null;
    var tabela = precoTabela(pid, cid, tid);
    var preco = opt.preco != null ? +opt.preco : (tabela != null ? tabela : sugerido);
    var taxaR = preco != null ? preco * tx : null;
    var lucro = preco != null ? preco - taxaR - cp.total : null;
    return { custo: cp, taxa: tx, margemAlvo: margem, sugerido: sugerido, minimo: minimo, tabela: tabela, preco: preco,
             taxaR: taxaR, lucro: lucro, margem: preco ? lucro / preco : null, markup: cp.total ? preco / cp.total : null };
  }
  // quantos potes por mês/dia para bater a meta de lucro líquido
  function metaPotes(lucroUnit, meta) {
    meta = meta != null ? meta : +D.config.metaLucroMes;
    if (!lucroUnit || lucroUnit <= 0) return null;
    var mes = meta / lucroUnit;
    return { mes: mes, dia: mes / (+D.config.diasVendaMes || 22) };
  }

  /* ───────────── vendas ───────────── */
  function totalVenda(v) { return v.itens.reduce(function (s, i) { return s + i.qtd * i.preco; }, 0) - (+v.desconto || 0); }
  function potesVenda(v) { return v.itens.reduce(function (s, i) { return s + (i.tam ? i.qtd : 0); }, 0); }
  function custoItem(it, cid) {
    if (!it.produto || !it.tam) return null;
    var c = custoPote(it.produto, it.tam, cid); return c && !c.semFicha ? c.total * it.qtd : null;
  }
  function resultadoVenda(v) {
    var receitaV = totalVenda(v), custo = 0, conhecido = true, tx = taxaCanal(v.canal);
    v.itens.forEach(function (it) { var c = custoItem(it, v.canal); if (c == null) conhecido = false; else custo += c; });
    // repasse do iFood já vem líquido da taxa
    var taxa = v.itens.every(function (i) { return !i.produto && !i.tam; }) ? 0 : receitaV * tx;
    return { receita: receitaV, custo: custo, taxa: taxa, lucro: receitaV - custo - taxa, completo: conhecido };
  }
  function vendasMes(ym) { return D.vendas.filter(function (v) { return v.data && v.data.slice(0, 7) === ym; }); }
  function nomeItem(it) { var p = it.produto && produto(it.produto); return p ? p.nome : (it.desc || 'Item'); }
  function nomeCliente(v) { if (v.canal === 'ifood' && !v.cliente) return 'iFood'; var c = cliente(v.cliente); return c ? c.nome : 'Cliente avulso'; }

  /* resumo de um período (ym = 'AAAA-MM' ou null = tudo) */
  function resumo(ym) {
    var vs = ym ? vendasMes(ym) : D.vendas;
    var r = { faturamento: 0, recebido: 0, aReceber: 0, aEntregar: 0, potes: 0, pedidos: vs.length, custo: 0, taxa: 0, lucro: 0,
              porProduto: {}, porCliente: {}, porCanal: {}, porDia: {}, porTam: {} };
    vs.forEach(function (v) {
      var rv = resultadoVenda(v);
      r.faturamento += rv.receita; r.custo += rv.custo; r.taxa += rv.taxa; r.lucro += rv.lucro;
      if (v.pago) r.recebido += rv.receita; else r.aReceber += rv.receita;
      if (!v.entregue) r.aEntregar += potesVenda(v);
      r.potes += potesVenda(v);
      r.porCanal[v.canal] = (r.porCanal[v.canal] || 0) + rv.receita;
      var cn = nomeCliente(v); r.porCliente[cn] = (r.porCliente[cn] || 0) + rv.receita;
      r.porDia[v.data] = (r.porDia[v.data] || 0) + rv.receita;
      v.itens.forEach(function (it) {
        var k = it.produto || ('?' + (it.desc || ''));
        var o = r.porProduto[k] = r.porProduto[k] || { id: it.produto, nome: nomeItem(it), qtd: 0, receita: 0 };
        if (it.tam) o.qtd += it.qtd; o.receita += it.qtd * it.preco;
        if (it.tam) r.porTam[it.tam] = (r.porTam[it.tam] || 0) + it.qtd;
      });
    });
    r.ticket = r.pedidos ? r.faturamento / r.pedidos : 0;
    r.margem = r.faturamento ? r.lucro / r.faturamento : 0;
    return r;
  }
  function mesesComDados() {
    var s = {};
    D.vendas.forEach(function (v) { if (v.data) s[v.data.slice(0, 7)] = 1; });
    D.compras.forEach(function (c) { if (c.data) s[c.data.slice(0, 7)] = 1; });
    s[mesAtual()] = 1;
    return Object.keys(s).sort();
  }

  /* ───────────── financeiro (caixa) ─────────────
     entradas = vendas pagas; saídas = compras + despesas. Pela data do lançamento. */
  function caixa(ym) {
    var ent = 0, comp = 0, desp = 0, cats = {};
    D.vendas.forEach(function (v) { if (v.pago && (!ym || v.data.slice(0, 7) === ym)) ent += totalVenda(v); });
    D.compras.forEach(function (c) { if (!ym || c.data.slice(0, 7) === ym) { comp += +c.valor || 0; var i = insumo(c.insumo); var k = i ? (i.tipo === 'embalagem' ? 'Embalagens' : 'Ingredientes') : 'Compras'; cats[k] = (cats[k] || 0) + (+c.valor || 0); } });
    D.despesas.forEach(function (d) { if (!ym || d.data.slice(0, 7) === ym) { desp += +d.valor || 0; cats[d.categoria] = (cats[d.categoria] || 0) + (+d.valor || 0); } });
    return { entradas: ent, compras: comp, despesas: desp, saidas: comp + desp, saldo: ent - comp - desp, categorias: cats };
  }
  function extrato(ym) {
    var l = [];
    D.vendas.forEach(function (v) { if (!ym || v.data.slice(0, 7) === ym) l.push({ data: v.data, tipo: 'entrada', desc: nomeCliente(v), det: v.itens.length + (v.itens.length > 1 ? ' itens' : ' item') + (v.pago ? '' : ' · a receber'), valor: totalVenda(v), pendente: !v.pago, ref: v.id, orig: 'venda' }); });
    D.compras.forEach(function (c) { if (!ym || c.data.slice(0, 7) === ym) { var i = insumo(c.insumo); l.push({ data: c.data, tipo: 'saida', desc: i ? i.nome : c.desc, det: 'Compra', valor: +c.valor, ref: c.id, orig: 'compra' }); } });
    D.despesas.forEach(function (d) { if (!ym || d.data.slice(0, 7) === ym) l.push({ data: d.data, tipo: 'saida', desc: d.desc, det: d.categoria, valor: +d.valor, ref: d.id, orig: 'despesa' }); });
    return l.sort(function (a, b) { return a.data < b.data ? 1 : a.data > b.data ? -1 : 0; });
  }

  /* ───────────── estoque ─────────────
     INSUMOS: anda sozinho desde o começo — toda compra (+) menos todo uso em produção (−),
     inclusive o histórico da planilha. A contagem é só para ACERTAR (substitui o saldo naquela data).
     POTES PRONTOS: produção (+) menos pedido entregue (−) a partir do app; o histórico de potes
     da planilha fica fora porque as vendas de agosto não têm produção lançada (daria negativo). */
  function consumoReceita(rid, kg, acc, pilha) {
    var r = receita(rid); if (!r) return acc;
    pilha = pilha || {}; if (pilha[rid]) return acc; pilha[rid] = 1;
    var f = kg / (r.rendKg || 1);
    r.itens.forEach(function (it) {
      var q = (it.g / 1000) * f;
      if (it.insumo) acc[it.insumo] = (acc[it.insumo] || 0) + q; else consumoReceita(it.receita, q, acc, pilha);
    });
    delete pilha[rid];
    return acc;
  }
  function consumoProducao(p) {
    var acc = consumoReceita(p.receita, +p.kg || 0, {});
    Object.keys(p.potes || {}).forEach(function (tid) {
      var n = +p.potes[tid] || 0, t = tamanho(tid); if (!n || !t) return;
      if (t.pote) acc[t.pote] = (acc[t.pote] || 0) + n;
      (D.config.embalagemPote || []).forEach(function (id) { acc[id] = (acc[id] || 0) + n; });
    });
    return acc;
  }
  function movimentos() {
    var mv = [];
    D.contagens.forEach(function (c) { mv.push({ data: c.data, ts: c.ts || 0, tipo: 'contagem', c: c }); });
    D.compras.forEach(function (c) { mv.push({ data: c.data, ts: c.ts || 1, tipo: 'compra', c: c }); });
    D.producoes.forEach(function (p) { mv.push({ data: p.data, ts: p.ts || 1, tipo: 'producao', c: p }); });
    D.vendas.forEach(function (v) { if (!v.historico && v.entregue) mv.push({ data: v.dataEntrega || v.data, ts: v.ts || 1, tipo: 'venda', c: v }); });
    D.ajustes.forEach(function (a) { mv.push({ data: a.data, ts: a.ts || 1, tipo: 'ajuste', c: a }); });
    return mv.sort(function (a, b) { return a.data < b.data ? -1 : a.data > b.data ? 1 : a.ts - b.ts; });
  }
  function estoque() {
    var ins = {}, potes = {}, contado = { ins: {}, pote: {} };
    function add(o, k, q) { o[k] = (o[k] || 0) + q; }
    movimentos().forEach(function (m) {
      var c = m.c;
      if (m.tipo === 'contagem') {
        Object.keys(c.insumos || {}).forEach(function (k) { ins[k] = +c.insumos[k]; contado.ins[k] = c.data; });
        Object.keys(c.potes || {}).forEach(function (k) { potes[k] = +c.potes[k]; contado.pote[k] = c.data; });
      } else if (m.tipo === 'compra') add(ins, c.insumo, +c.qtd || 0);
      else if (m.tipo === 'producao') {
        var cons = consumoProducao(c); Object.keys(cons).forEach(function (k) { add(ins, k, -cons[k]); });
        if (c.produto && !c.historico) Object.keys(c.potes || {}).forEach(function (t) { add(potes, c.produto + '|' + t, +c.potes[t] || 0); });
      } else if (m.tipo === 'venda') {
        var kit = (canal(c.canal) || {}).kitEntrega;
        c.itens.forEach(function (it) { if (it.produto && it.tam) add(potes, it.produto + '|' + it.tam, -it.qtd); });
        if (kit) (D.config.kitEntrega || []).forEach(function (id) { add(ins, id, -1); });
      } else if (m.tipo === 'ajuste') {
        if (c.insumo) add(ins, c.insumo, +c.qtd || 0);
        if (c.pote) add(potes, c.pote, +c.qtd || 0);
      }
    });
    return { insumos: ins, potes: potes, contado: contado, iniciado: true, potesIniciado: Object.keys(contado.pote).length > 0 || D.producoes.some(function (p) { return !p.historico; }) };
  }
  function estoqueBaixo() {
    var e = estoque(), l = [];
    D.insumos.forEach(function (i) { var s = e.insumos[i.id]; if (i.min > 0 && s != null && s < i.min) l.push({ insumo: i, saldo: s }); });
    return l;
  }

  /* ───────────── catálogo para listas ───────────── */
  function produtosAtivos() { return D.produtos.filter(function (p) { return p.ativo !== false; }); }
  function tamanhosAtivos() { return D.tamanhos.filter(function (t) { return t.ativo !== false; }); }
  function unidade(i) { return i.un === 'un' ? 'un' : 'kg'; }
  function qtdFmt(q, un) { if (q == null) return '—'; return un === 'un' ? num(q, 0) + ' un' : (Math.abs(q) < 1 ? num(q * 1000, 0) + ' g' : num(q, 2) + ' kg'); }

  window.SG = {
    carregar: carregar, salvar: salvar, resetar: resetar, aoMudar: aoMudar, novoId: novoId, usar: usar, notificar: notificar, aoSalvarLocal: aoSalvarLocal,
    get D() { return D; },
    brl: brl, brl0: brl0, pct: pct, num: num, hoje: hoje, dataBR: dataBR, dataCurta: dataCurta, nomeMes: nomeMes, mesAtual: mesAtual, addMes: addMes, MES3: MES3,
    insumo: insumo, receita: receita, produto: produto, tamanho: tamanho, canal: canal, cliente: cliente,
    ultimaCompra: ultimaCompra, custoInsumo: custoInsumo, custoReceitaKg: custoReceitaKg, pesoReceita: pesoReceita, composicao: composicao,
    indiretosMes: indiretosMes, indiretoKg: indiretoKg, custoPote: custoPote, taxaCanal: taxaCanal,
    precoTabela: precoTabela, definirPreco: definirPreco, precificar: precificar, metaPotes: metaPotes,
    totalVenda: totalVenda, potesVenda: potesVenda, resultadoVenda: resultadoVenda, vendasMes: vendasMes, nomeItem: nomeItem, nomeCliente: nomeCliente,
    resumo: resumo, mesesComDados: mesesComDados, caixa: caixa, extrato: extrato,
    consumoProducao: consumoProducao, estoque: estoque, estoqueBaixo: estoqueBaixo,
    produtosAtivos: produtosAtivos, tamanhosAtivos: tamanhosAtivos, unidade: unidade, qtdFmt: qtdFmt,
  };
})();
