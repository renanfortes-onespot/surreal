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
    if (!D.socios) D.socios = [];
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
  function ultimaCompra(id, ate) {
    var u = null;
    D.compras.forEach(function (c) { if (c.insumo === id && c.qtd > 0 && (!ate || c.data <= ate) && (!u || c.data >= u.data)) u = c; });
    return u;
  }
  function custoInsumo(id, ctx) {
    var i = insumo(id); if (!i) return { valor: 0, origem: 'inexistente' };
    var r;
    if (ctx && ctx.preco && ctx.preco[id] != null) r = { valor: +ctx.preco[id], origem: 'simulado' };
    else {
      var u = ultimaCompra(id, ctx && ctx.ate);
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

  /* ───────────── balanceamento (planilha do curso) ─────────────
     Cada insumo tem composição por fração de 100 g (comp: acu, gor, sngl, os, pod, pac, prot).
     Receita: gramas × fração = gramas de cada componente; % sobre o peso que a receita RENDE
     (coar o iogurte concentra os sólidos). POD e PAC por kg da mistura. Temperatura de serviço
     = −PAC/25 (convenção da planilha). Sub-receita entra com a composição calculada dela. */
  var BAL_COLS = [['acu', 'Açúcares'], ['gor', 'Gorduras'], ['sngl', 'SNGL'], ['os', 'Outros sólidos'], ['st', 'Sólidos totais'], ['agua', 'Água'], ['pod', 'POD'], ['pac', 'PAC']];
  var BAL_TIPOS = { leite: 'Gelato de leite', fruta: 'Gelato de leite com fruta', sorbet: 'Sorbet', choc_agua: 'Chocolate (base de água)', vegana: 'Base vegana', none: 'Sem faixa (cobertura / base)' };
  function faixasBal() { return D.config.balanco || (window.SG_BIB && SG_BIB.faixas) || {}; }
  function compInsumo(id) { var i = insumo(id); return i && i.comp ? i.comp : null; }
  function balTipo(r) { return r.bal || (r.tipo === 'sabor' ? 'leite' : 'none'); }
  function balanco(rid, pilha) {
    var r = receita(rid); if (!r) return null;
    pilha = pilha || {}; if (pilha[rid]) return null; pilha[rid] = 1;
    var itens = [], tot = { acu: 0, gor: 0, sngl: 0, os: 0, pod: 0, pac: 0 }, peso = 0, sem = [];
    r.itens.forEach(function (it) {
      var g = +it.g || 0, c = null, nome;
      if (it.insumo) { var i = insumo(it.insumo); nome = i ? i.nome : it.insumo; c = compInsumo(it.insumo); }
      else { var sb = receita(it.receita), b = balanco(it.receita, pilha); nome = sb ? sb.nome : it.receita; if (b) c = b.porG; if (b && b.sem.length) sem = sem.concat(b.sem); }
      peso += g;
      var l = { item: it, nome: nome, g: g, sem: !c };
      itens.push(l);
      if (c) { ['acu', 'gor', 'sngl', 'os', 'pod', 'pac'].forEach(function (k) { l[k] = g * (+c[k] || 0); tot[k] += l[k]; }); l.st = l.acu + l.gor + l.sngl + l.os; l.agua = g - l.st; }
      else sem.push(nome);
    });
    delete pilha[rid];
    var rendG = (r.rendKg || peso / 1000 || 1) * 1000; if (rendG > peso && peso) rendG = peso;   // render mais do que pesa não existe
    tot.st = tot.acu + tot.gor + tot.sngl + tot.os; tot.agua = Math.max(0, rendG - tot.st);
    var pct = {}; ['acu', 'gor', 'sngl', 'os', 'st', 'agua'].forEach(function (k) { pct[k] = rendG ? tot[k] / rendG : 0; });
    pct.pod = rendG ? 1000 * tot.pod / rendG : 0; pct.pac = rendG ? 1000 * tot.pac / rendG : 0;
    var porG = { acu: pct.acu, gor: pct.gor, sngl: pct.sngl, os: pct.os, pod: pct.pod / 1000, pac: pct.pac / 1000 };
    var tipo = balTipo(r), fx = faixasBal()[tipo], status = {}, ok = true;
    BAL_COLS.forEach(function (c) { var k = c[0]; if (!fx) { status[k] = ''; return; } var v = pct[k]; status[k] = v < fx.min[k] - 1e-9 ? 'baixo' : v > fx.max[k] + 1e-9 ? 'alto' : 'ok'; if (status[k] !== 'ok') ok = false; });
    return { receita: r, tipo: tipo, faixa: fx || null, itens: itens, peso: peso, rendG: rendG, tot: tot, pct: pct, porG: porG, temp: -pct.pac / 25, status: status, ok: ok && !sem.length, sem: sem };
  }

  /* ───────────── indiretos ───────────── */
  /* ───────────── OBZ: custos fixos do mês por pacote (orçamento base zero) ─────────────
     Substitui os "custos indiretos rateados por kg": fixo fica como fixo do mês (não entra no
     custo do pote). As despesas lançadas caem numa conta OBZ, para comparar orçado × realizado. */
  var PACOTES_OBZ = ['Impostos', 'Ocupação', 'Marketing', 'Manutenção', 'Administrativo', 'Pessoal', 'Financeiro'];
  var CONTAS_PADRAO = [
    ['aluguel', 'Ocupação', 'Aluguel'], ['energia', 'Ocupação', 'Energia elétrica'], ['agua', 'Ocupação', 'Água'], ['gas', 'Ocupação', 'Gás'],
    ['anuncios', 'Marketing', 'Impulsionamento / anúncios'], ['marca', 'Marketing', 'Materiais de marca (adesivos, impressos)'], ['degustacao', 'Marketing', 'Degustações e brindes'],
    ['manutencao', 'Manutenção', 'Manutenção de equipamentos'], ['limpeza', 'Manutenção', 'Limpeza / utensílios'],
    ['internet', 'Administrativo', 'Internet / celular'], ['contador', 'Administrativo', 'Contador'], ['bancarias', 'Financeiro', 'Taxas bancárias'], ['juros', 'Financeiro', 'Juros e multas'], ['das', 'Impostos', 'DAS do MEI (INSS + ICMS/ISS)'], ['outros-adm', 'Administrativo', 'Outros administrativos'],
    ['prolabore', 'Pessoal', 'Pró-labore'], ['ajudante', 'Pessoal', 'Ajudante'],
  ];
  var CAT_ANTIGA = { 'Marketing': 'anuncios', 'Embalagens': 'marca', 'Aluguel': 'aluguel', 'Energia': 'energia', 'Água': 'agua', 'Gás': 'gas', 'Equipamentos': 'manutencao', 'Taxas': 'bancarias', 'Outros': 'outros-adm' };
  function contasOBZ() {
    if (!D.config.obz) {
      var antigos = {}; (D.config.indiretos || []).forEach(function (i) { antigos[i.id] = +i.valor || 0; });
      D.config.obz = CONTAS_PADRAO.map(function (c) { return { id: c[0], pacote: c[1], nome: c[2], valor: antigos[c[0]] || 0 }; });
      setTimeout(function () { salvar(true); }, 0);
    }
    var mudou = false;
    /* v2 (18/10/2026): pacotes Impostos e Financeiro; DAS vai para Impostos; regime tributário */
    if (!D.config.obzV2) {
      var das = por(D.config.obz, 'das'), ban = por(D.config.obz, 'bancarias');
      if (das) { das.pacote = 'Impostos'; das.nome = 'DAS do MEI (INSS + ICMS/ISS)'; } else D.config.obz.push({ id: 'das', pacote: 'Impostos', nome: 'DAS do MEI (INSS + ICMS/ISS)', valor: 0 });
      if (ban) ban.pacote = 'Financeiro';
      if (!por(D.config.obz, 'juros')) D.config.obz.push({ id: 'juros', pacote: 'Financeiro', nome: 'Juros e multas', valor: 0 });
      if (!D.config.regime) D.config.regime = { tipo: 'mei', inss: 0, icms: 1, iss: 0, aliq: 0, aliqIR: 0 };
      D.config.obzV2 = 1; mudou = true;
    }
    D.despesas.forEach(function (d) { var c0 = d.conta && por(D.config.obz, d.conta); if (c0 && d.categoria !== c0.nome) { d.categoria = c0.nome; mudou = true; } });
    D.despesas.forEach(function (d) { if (!d.conta) { var id = CAT_ANTIGA[d.categoria] || 'outros-adm', c = por(D.config.obz, id); d.conta = id; d.categoria = c ? c.nome : d.categoria; mudou = true; } });
    if (mudou) setTimeout(function () { salvar(true); }, 0);
    return D.config.obz;
  }
  function contaOBZ(id) { return por(contasOBZ(), id); }
  function pacoteDespesa(d) { var c = d.conta && contaOBZ(d.conta); return c ? c.pacote : 'Outros'; }
  function indiretosMes() { return contasOBZ().reduce(function (s, i) { return s + (+i.valor || 0); }, 0); }
  function obzPorPacote() { var o = {}; contasOBZ().forEach(function (c) { o[c.pacote] = (o[c.pacote] || 0) + (+c.valor || 0); }); return o; }
  function indiretoKg() { return 0; }   // rateio por kg desativado: fixo é fixo do mês (OBZ)

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
    var kit = c.kitEntrega && !(ctx && ctx.semKit) ? (D.config.kitEntrega || []).reduce(function (s, id) { return s + custoInsumo(id, ctx).valor; }, 0) : 0;
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
    var extra = +opt.extra || 0, ct = cp.total + extra;   // extra = fixos + sacos por pote (margem líquida)
    var tx = taxaCanal(cid);
    var margem = opt.margem != null ? +opt.margem : +D.config.margemAlvo;
    var den = 1 - margem - tx;
    var sugerido = den > 0 ? ct / den : null;
    var minimo = 1 - tx > 0 ? ct / (1 - tx) : null;
    var tabela = precoTabela(pid, cid, tid);
    var preco = opt.preco != null ? +opt.preco : (tabela != null ? tabela : sugerido);
    var taxaR = preco != null ? preco * tx : null;
    var lucro = preco != null ? preco - taxaR - ct : null;
    return { custo: cp, taxa: tx, margemAlvo: margem, sugerido: sugerido, minimo: minimo, tabela: tabela, preco: preco,
             taxaR: taxaR, lucro: lucro, margem: preco ? lucro / preco : null, markup: ct ? preco / ct : null, extra: extra, ct: ct };
  }
  /* para a margem LÍQUIDA por pote: custos fixos do mês (despesas, DAS, financeiro) + sacos de entrega,
     divididos pelos potes vendidos — média real dos últimos 3 meses com venda */
  function rateioPote() {
    var at = mesAtual(), ms = mesesComDados().filter(function (m) { return m <= at && vendasMes(m).length; }).slice(-3);
    if (!ms.length) return { fixos: 0, sacos: 0, potes: 0, porPote: 0, meses: [] };
    var o = dre(ms), n = ms.length, fixos = (o.despT + o.dasV + o.impOutros + o.fin) / n, sacos = o.kit / n, potes = o.potes / n;
    return { fixos: fixos, sacos: sacos, potes: potes, porPote: potes ? (fixos + sacos) / potes : 0, meses: ms };
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
     entradas = vendas pagas; saídas = compras + despesas; + movimentos dos sócios. Pela data do lançamento. */
  function socios() { return D.socios || (D.socios = []); }
  /* movimentos dos sócios: retirada (sai), aporte (entra), acerto de saldo (+/−). Ficam FORA do DRE. */
  function sinalSocio(m) { return m.tipo === 'retirada' ? -(+m.valor || 0) : (+m.valor || 0); }
  function noPer(d, ym) { if (!ym) return true; d = (d || '').slice(0, 7); return Array.isArray(ym) ? ym.indexOf(d) >= 0 : d === ym; }
  /* ym: 'AAAA-MM', lista de meses ou vazio (= tudo) */
  function caixa(ym) {
    var ent = 0, receber = 0, comp = 0, compI = 0, compE = 0, desp = 0, cats = {}, despPk = {}, ret = 0, apo = 0, ace = 0;
    D.vendas.forEach(function (v) { if (!noPer(v.data, ym)) return; var t = totalVenda(v); if (v.pago) ent += t; else receber += t; });
    D.compras.forEach(function (c) { if (!noPer(c.data, ym)) return; var val = +c.valor || 0, i = insumo(c.insumo); comp += val; if (i && i.tipo === 'embalagem') compE += val; else compI += val; var k = i ? (i.tipo === 'embalagem' ? 'Embalagens' : 'Ingredientes') : 'Compras'; cats[k] = (cats[k] || 0) + val; });
    D.despesas.forEach(function (d) { if (!noPer(d.data, ym)) return; var val = +d.valor || 0; desp += val; cats[d.categoria] = (cats[d.categoria] || 0) + val; var pk = pacoteDespesa(d); despPk[pk] = (despPk[pk] || 0) + val; });
    socios().forEach(function (m) { if (!noPer(m.data, ym)) return; var v = +m.valor || 0; if (m.tipo === 'retirada') ret += v; else if (m.tipo === 'aporte') apo += v; else ace += v; });
    return { entradas: ent, receber: receber, compras: comp, comprasIng: compI, comprasEmb: compE, despesas: desp, despPacote: despPk, saidas: comp + desp,
             retiradas: ret, aportes: apo, acertos: ace, socios: apo + ace - ret, operacional: ent - comp - desp, saldo: ent - comp - desp - ret + apo + ace, categorias: cats };
  }
  /* dinheiro em conta hoje = tudo o que entrou − tudo o que saiu, desde o começo */
  function saldoConta() { return caixa(null).saldo; }
  var NOME_SOCIO = { retirada: 'Retirada dos sócios', aporte: 'Aporte dos sócios', acerto: 'Acerto de saldo' };
  function extrato(ym) {
    var l = [];
    D.vendas.forEach(function (v) { if (noPer(v.data, ym)) l.push({ data: v.data, ts: v.ts || 0, tipo: 'entrada', desc: nomeCliente(v), det: v.itens.length + (v.itens.length > 1 ? ' itens' : ' item') + (v.pago ? '' : ' · a receber'), valor: totalVenda(v), pendente: !v.pago, ref: v.id, orig: 'venda' }); });
    D.compras.forEach(function (c) { if (noPer(c.data, ym)) { var i = insumo(c.insumo); l.push({ data: c.data, ts: c.ts || 0, tipo: 'saida', desc: i ? i.nome : c.desc, det: 'Compra', valor: +c.valor, ref: c.id, orig: 'compra' }); } });
    D.despesas.forEach(function (d) { if (noPer(d.data, ym)) l.push({ data: d.data, ts: d.ts || 0, tipo: 'saida', desc: d.desc, det: d.categoria, valor: +d.valor, ref: d.id, orig: 'despesa' }); });
    socios().forEach(function (m) { if (!noPer(m.data, ym)) return; var v = sinalSocio(m);
      l.push({ data: m.data, ts: m.ts || 0, tipo: v >= 0 ? 'entrada' : 'saida', desc: m.desc || NOME_SOCIO[m.tipo], det: NOME_SOCIO[m.tipo], valor: Math.abs(v), ref: m.id, orig: 'socio' }); });
    return l.sort(function (a, b) { return a.data < b.data ? 1 : a.data > b.data ? -1 : (b.ts || 0) - (a.ts || 0); });
  }

  /* DRE gerencial (competência), agrupado:
     Receita bruta → (−) Deduções [descontos, impostos sobre a venda, taxas de canal] → Receita líquida
     → (−) CMV [insumos, embalagens] → Lucro bruto → (−) Variáveis de venda [kit] → Margem de contribuição
     → (−) Despesas operacionais [pacotes OBZ; INSS do MEI em Pessoal] → Resultado operacional
     → (−) Financeiro → LAIR → (−) IR/CSLL → Lucro líquido. Retiradas dos sócios só informativas.
     MEI: o DAS é INSS (vai para Pessoal) + ICMS/ISS (imposto sobre a venda). Mês sem DAS lançado
     usa o valor cadastrado no regime (automático); mês com DAS lançado usa o lançado. */
  /* despesas do DRE = despesas lançadas + compras em que se escolheu uma linha do DRE (conta OBZ):
     essas não vão para o estoque, viram despesa da conta na data da compra */
  function despesasDRE() {
    return D.despesas.concat(D.compras.filter(function (c) { return c.conta; }).map(function (c) { var i = insumo(c.insumo), k = contaOBZ(c.conta);
      return { id: c.id, data: c.data, valor: c.valor, conta: c.conta, categoria: k ? k.nome : c.conta, desc: (i ? i.nome : c.desc || 'Compra') + ' · ' + qtdFmt(c.qtd, i && i.un), _compra: true }; }));
  }
/* CMV de um pedido: custo de cada pote vendido pela ficha técnica, com os preços da última compra
     até a data da venda (pacote ÷ quantidade). Gelato + cobertura = insumos; pote + lacre + adesivo = embalagens. */
/* SACOS de entrega: escolhidos em cada pedido, com quantidade (saco térmico e saco kraft) */
  var SACOS = [{ campo: 'sacoTermico', id: 'saco-termico', nome: 'Saco térmico' }, { campo: 'sacoKraft', id: 'sacola-kraft', nome: 'Saco kraft' }];
  function sacosVenda(v, ctx) { return SACOS.reduce(function (t, x) { return t + (+v[x.campo] || 0) * custoInsumo(x.id, ctx).valor; }, 0); }
  /* embalagem de cada pote: pote + adesivo + lacre (pedidos antigos marcados semLacre não levavam lacre) */
  function embPote(v) { return (D.config.embalagemPote || []).filter(function (id) { return !(v.semLacre && id === 'lacre'); }); }
  function cmvVenda(v) {
    var o = { ins: 0, emb: 0, sem: 0 };
    v.itens.forEach(function (it) {
      if (!it.produto || !it.tam) { o.sem += it.qtd; return; }   // repasse do iFood sem sabor ou item avulso: custo desconhecido
      var cp = custoPote(it.produto, it.tam, v.canal, { ate: v.data });
      if (!cp || cp.semFicha) { o.sem += it.qtd; return; }
      var ctx = { ate: v.data };
      cp.linhas.forEach(function (l) { if (l.id === 'base' || l.id === 'cob') o.ins += l.valor * it.qtd; else if (l.id === 'pote') o.emb += l.valor * it.qtd; });
      embPote(v).forEach(function (id) { o.emb += custoInsumo(id, ctx).valor * it.qtd; });
    });
    return o;
  }
/* para onde foi o dinheiro do DRE: cada gasto pelo nome (insumo, embalagem, conta, taxa, imposto) */
  function gastosDRE(ym) {
    var g = {}, rg = regime(), mei = rg.tipo === 'mei';
    function add(nome, tipo, v) { if (!(v > 0.004)) return; var o = g[nome] = g[nome] || { nome: nome, tipo: tipo, valor: 0 }; o.valor += v; }
    function addReceita(rid, kg, ctx) { composicao(rid, ctx).forEach(function (c) { add(c.nome, c.item.receita ? 'Sub-receita' : 'Insumo', c.custo * kg); }); }
    D.vendas.forEach(function (v) { if (!noPer(v.data, ym)) return; var ctx = { ate: v.data }, c = canal(v.canal);
      v.itens.forEach(function (it) { if (!it.produto || !it.tam) return; var p = produto(it.produto), t = tamanho(it.tam); if (!p || !t || !p.receita) return;
        var gr = +t.g || 0, pc = p.cobertura ? (+p.pctCob || 0) : 0;
        addReceita(p.receita, gr * (1 - pc) / 1000 * it.qtd, ctx); if (p.cobertura) addReceita(p.cobertura, gr * pc / 1000 * it.qtd, ctx);
        if (t.pote) { var ip = insumo(t.pote); add(ip ? ip.nome : t.pote, 'Embalagem', custoInsumo(t.pote, ctx).valor * it.qtd); }
        embPote(v).forEach(function (id) { var i = insumo(id); add(i ? i.nome : id, 'Embalagem', custoInsumo(id, ctx).valor * it.qtd); }); });
      var rep = v.itens.every(function (i) { return !i.produto && !i.tam; }), liq = totalVenda(v);
      if (!rep && c && +c.taxa) add('Taxa ' + c.nome, 'Taxa', liq * c.taxa);
      SACOS.forEach(function (x) { var q = +v[x.campo] || 0, i = insumo(x.id); if (q) add(i ? i.nome : x.nome, 'Saco de entrega', q * custoInsumo(x.id, ctx).valor); }); });
    var o = dre(ym);
    if (mei) { add('DAS · INSS do MEI', 'Imposto', o.inss); add('DAS · ICMS/ISS', 'Imposto', o.dasV); }
    if (o.impV) add('Impostos sobre a venda', 'Imposto', o.impV); if (o.ir) add('IR / CSLL', 'Imposto', o.ir);
    despesasDRE().forEach(function (d) { if (!noPer(d.data, ym) || (mei && d.conta === 'das')) return; add(d.categoria, pacoteDespesa(d), +d.valor || 0); });
    var l = Object.keys(g).map(function (k) { return g[k]; }).sort(function (a, b) { return b.valor - a.valor; }), tot = l.reduce(function (s, x) { return s + x.valor; }, 0);
    l.forEach(function (x) { x.pct = tot ? x.valor / tot : 0; });
    return { itens: l, total: tot };
  }
  function regime() { return D.config.regime || { tipo: 'mei', inss: 0, icms: 1, iss: 0, aliq: 0, aliqIR: 0 }; }
  function dasMensal() { var r = regime(); return (+r.inss || 0) + (+r.icms || 0) + (+r.iss || 0); }
  /* meses do período em que a gelateria já existia (do 1º mês com movimento até hoje) — DAS automático só neles */
  function mesesDe(ym) { var at = mesAtual(), ini = mesesComDados()[0] || at; return (!ym ? mesesComDados() : Array.isArray(ym) ? ym : [ym]).filter(function (m) { return m <= at && m >= ini; }); }
  function dre(ym) {
    var rg = regime(), mei = rg.tipo === 'mei', aliqV = mei ? 0 : (+D.config.imposto || 0), aliqIR = rg.tipo === 'presumido' ? (+rg.aliqIR || 0) : 0;
    var o = { bruta: 0, desc: 0, impV: 0, dasV: 0, impOutros: 0, taxa: 0, ins: 0, emb: 0, kit: 0, desp: {}, despT: 0, inss: 0, fin: 0, finD: {}, ir: 0,
              lotes: 0, kg: 0, potes: 0, das: [], despPk: {}, retiradas: 0, regime: rg.tipo, semCusto: 0, repasses: 0 };
    D.vendas.forEach(function (v) { if (!noPer(v.data, ym)) return;
      var bruto = v.itens.reduce(function (s, i) { return s + i.qtd * i.preco; }, 0), liq = totalVenda(v), repasse = v.itens.every(function (i) { return !i.produto && !i.tam; });
      o.bruta += bruto; o.desc += bruto - liq; o.potes += potesVenda(v);
      if (!repasse) { var c = canal(v.canal); o.taxa += liq * (c ? +c.taxa || 0 : 0); o.impV += liq * aliqV; }
      var cv = cmvVenda(v); o.ins += cv.ins; o.emb += cv.emb; o.semCusto += cv.sem;
      if (repasse) o.repasses++;
      o.kit += sacosVenda(v, { ate: v.data }); });
    D.producoes.forEach(function (pr) { if (!noPer(pr.data, ym)) return; o.lotes++; o.kg += +pr.kg || 0; });
    var dasLanc = {}, icmsMes = (+rg.icms || 0) + (+rg.iss || 0);
    despesasDRE().forEach(function (d) { if (!noPer(d.data, ym)) return; var val = +d.valor || 0, pk = pacoteDespesa(d);
      o.despPk[pk] = (o.despPk[pk] || 0) + val;
      if (d.conta === 'das') { var m = d.data.slice(0, 7); dasLanc[m] = (dasLanc[m] || 0) + val; return; }
      if (pk === 'Impostos') { o.impOutros += val; return; }
      if (pk === 'Financeiro') { o.fin += val; o.finD[d.categoria] = (o.finD[d.categoria] || 0) + val; return; }
      o.desp[pk] = (o.desp[pk] || 0) + val; o.despT += val; });
    if (mei) mesesDe(ym).forEach(function (m) {
      var tot = dasLanc[m] != null ? dasLanc[m] : dasMensal(), icms = Math.min(tot, icmsMes), inss = tot - icms;
      o.dasV += icms; o.inss += inss; o.das.push({ ym: m, total: tot, icms: icms, inss: inss, auto: dasLanc[m] == null });
    }); else Object.keys(dasLanc).forEach(function (m) { o.impOutros += dasLanc[m]; });
    if (o.inss) { o.desp['Pessoal'] = (o.desp['Pessoal'] || 0) + o.inss; o.despT += o.inss; }
    socios().forEach(function (s) { if (noPer(s.data, ym) && s.tipo === 'retirada') o.retiradas += +s.valor || 0; });
    o.imp = o.impV + o.dasV + o.impOutros; o.ded = o.desc + o.imp + o.taxa; o.liq = o.bruta - o.ded;
    o.cmv = o.ins + o.emb; o.bruto = o.liq - o.cmv; o.mc = o.bruto - o.kit; o.oper = o.mc - o.despT;
    o.lair = o.oper - o.fin; o.ir = o.bruta * aliqIR; o.res = o.lair - o.ir;
    o.rec = o.bruta; o.cprod = o.cmv + o.kit;   // nomes antigos
    return o;
  }

  /* itens por trás de uma linha do DRE (o PC e o app abrem o mesmo detalhe) */
  var DRE_LINHA = { rec: 'Receita bruta', desc: 'Descontos', imp: 'Impostos sobre a venda', taxa: 'Taxas de canal', ins: 'Insumos dos potes vendidos', emb: 'Embalagens dos potes vendidos', kit: 'Sacos de entrega (térmico e kraft)', desp: 'Despesas', fin: 'Resultado financeiro', ir: 'IR / CSLL' };
  function dreItens(l, pk, ym) {
    var rows = [], rg = regime(), mei = rg.tipo === 'mei', aliqV = mei ? 0 : (+D.config.imposto || 0);
    var resumo = function (v) { return v.itens.map(function (i) { return i.qtd + '× ' + nomeItem(i).replace(/ com .*/, '') + (i.tam ? ' ' + i.tam : ''); }).join(' · '); };
    if (l === 'rec' || l === 'desc' || l === 'taxa' || l === 'kit' || l === 'ins' || l === 'emb' || (l === 'imp' && aliqV)) D.vendas.forEach(function (v) { if (!noPer(v.data, ym)) return;
      var bruto = v.itens.reduce(function (s, i) { return s + i.qtd * i.preco; }, 0), liq = totalVenda(v), rep = v.itens.every(function (i) { return !i.produto && !i.tam; }), c = canal(v.canal), val = 0;
      if (l === 'rec') val = bruto; else if (l === 'desc') val = bruto - liq; else if (l === 'taxa') val = rep ? 0 : liq * (c ? +c.taxa || 0 : 0);
      else if (l === 'imp') val = rep ? 0 : liq * aliqV; else if (l === 'ins' || l === 'emb') val = cmvVenda(v)[l];
      else val = sacosVenda(v, { ate: v.data });
      if (Math.abs(val) > 0.004) rows.push({ d: v.data, desc: nomeCliente(v), det: resumo(v) + ' · ' + (c ? c.nome : v.canal), v: val, tipo: 'venda', id: v.id }); });
    if (l === 'imp' || l === 'desp' || l === 'fin') {
      var o = dre(ym);
      if (mei && (l === 'imp' || (l === 'desp' && pk === 'Pessoal'))) o.das.forEach(function (x) { var val = l === 'imp' ? x.icms : x.inss;
        if (val) rows.push({ d: x.ym + '-01', desc: l === 'imp' ? 'DAS · ICMS/ISS' : 'DAS · INSS do MEI', det: nomeMes(x.ym, true) + (x.auto ? ' · automático (valor do regime)' : ' · DAS lançado'), v: val, tipo: 'das' }); });
      despesasDRE().forEach(function (d) { if (!noPer(d.data, ym) || (mei && d.conta === 'das')) return; var p = pacoteDespesa(d);
        var ok = l === 'imp' ? p === 'Impostos' : l === 'fin' ? p === 'Financeiro' : (p !== 'Impostos' && p !== 'Financeiro' && (!pk || p === pk));
        if (ok) rows.push({ d: d.data, desc: d.desc, det: d.categoria + (d._compra ? ' · compra' : ''), v: +d.valor || 0, tipo: d._compra ? 'compra' : 'despesa', id: d.id }); });
    }
    if (l === 'ir') { var a = rg.tipo === 'presumido' ? +rg.aliqIR || 0 : 0; mesesDe(ym).forEach(function (m) { var b = 0; D.vendas.forEach(function (v) { if (noPer(v.data, m)) b += v.itens.reduce(function (s, i) { return s + i.qtd * i.preco; }, 0); }); if (b * a) rows.push({ d: m + '-01', desc: 'IR / CSLL', det: nomeMes(m, true) + ' · ' + pct(a, 2) + ' da receita', v: b * a, tipo: 'ir' }); }); }
    return rows.sort(function (x, y) { return x.d < y.d ? 1 : x.d > y.d ? -1 : 0; });
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
  /* log: 'ins|<id>' ou 'pote|<produto|tam>' devolve também os movimentos desse item */
  function estoque(log) {
    var ins = {}, potes = {}, contado = { ins: {}, pote: {} }, hist = [], semProd = {}, mov = [];
    var lt = log ? log.slice(0, log.indexOf('|')) : null, lk = log ? log.slice(log.indexOf('|') + 1) : null;
    function add(o, k, q) { o[k] = (o[k] || 0) + q; }
    movimentos().forEach(function (m) {
      var c = m.c, antes = lt === 'ins' ? ins[lk] : lt === 'pote' ? potes[lk] : null, sp = lt === 'pote' ? semProd[lk] || 0 : 0;
      if (m.tipo === 'contagem') {
        /* guarda o que o sistema esperava antes do acerto: a diferença mostra perdas/erros */
        Object.keys(c.insumos || {}).forEach(function (k) { hist.push({ c: c, tipo: 'ins', k: k, antes: ins[k] == null ? null : ins[k], depois: +c.insumos[k] }); ins[k] = +c.insumos[k]; contado.ins[k] = c.data; });
        Object.keys(c.potes || {}).forEach(function (k) { hist.push({ c: c, tipo: 'pote', k: k, antes: potes[k] == null ? null : potes[k], depois: +c.potes[k] }); potes[k] = +c.potes[k]; contado.pote[k] = c.data; });
      } else if (m.tipo === 'compra') { if (!c.conta) add(ins, c.insumo, +c.qtd || 0); }   // compra com linha do DRE escolhida não vai para o estoque
      else if (m.tipo === 'producao') {
        var cons = consumoProducao(c); Object.keys(cons).forEach(function (k) { add(ins, k, -cons[k]); });
        if (c.produto && !c.historico) Object.keys(c.potes || {}).forEach(function (t) { add(potes, c.produto + '|' + t, +c.potes[t] || 0); });
      } else if (m.tipo === 'venda') {

        c.itens.forEach(function (it) { if (it.produto && it.tam) add(potes, it.produto + '|' + it.tam, -it.qtd); });
        SACOS.forEach(function (x) { if (+c[x.campo]) add(ins, x.id, -(+c[x.campo])); });
      } else if (m.tipo === 'ajuste') {
        if (c.insumo) add(ins, c.insumo, +c.qtd || 0);
        if (c.pote) add(potes, c.pote, +c.qtd || 0);
      }
      /* pote não fica negativo: o que saiu sem produção lançada vira aviso (feito antes do app) */
      Object.keys(potes).forEach(function (k) { if (potes[k] < 0) { semProd[k] = (semProd[k] || 0) - potes[k]; potes[k] = 0; } });
      if (lt) { var depois = lt === 'ins' ? ins[lk] : potes[lk];
        if (m.tipo === 'contagem' ? (lt === 'ins' ? c.insumos && lk in c.insumos : c.potes && lk in c.potes) : Math.abs((depois || 0) - (antes || 0)) > 1e-9 || (semProd[lk] || 0) !== sp)
          mov.push({ data: m.data, tipo: m.tipo, c: c, antes: antes, depois: depois, semProd: (semProd[lk] || 0) - sp }); }
    });
    return { insumos: ins, potes: potes, contado: contado, historico: hist, semProducao: semProd, movimentosItem: mov.reverse(), iniciado: true, potesIniciado: Object.keys(contado.pote).length > 0 || D.producoes.some(function (p) { return !p.historico; }) };
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
    ultimaCompra: ultimaCompra, custoInsumo: custoInsumo, custoReceitaKg: custoReceitaKg, pesoReceita: pesoReceita, composicao: composicao, balanco: balanco, compInsumo: compInsumo, faixasBal: faixasBal, balTipo: balTipo, BAL_COLS: BAL_COLS, BAL_TIPOS: BAL_TIPOS,
    indiretosMes: indiretosMes, indiretoKg: indiretoKg, contasOBZ: contasOBZ, contaOBZ: contaOBZ, pacoteDespesa: pacoteDespesa, obzPorPacote: obzPorPacote, PACOTES_OBZ: PACOTES_OBZ, custoPote: custoPote, taxaCanal: taxaCanal,
    precoTabela: precoTabela, definirPreco: definirPreco, precificar: precificar, metaPotes: metaPotes,
    totalVenda: totalVenda, potesVenda: potesVenda, resultadoVenda: resultadoVenda, vendasMes: vendasMes, nomeItem: nomeItem, nomeCliente: nomeCliente,
    resumo: resumo, mesesComDados: mesesComDados, caixa: caixa, extrato: extrato, saldoConta: saldoConta, dre: dre, dreItens: dreItens, rateioPote: rateioPote, SACOS: SACOS, sacosVenda: sacosVenda, gastosDRE: gastosDRE, cmvVenda: cmvVenda, DRE_LINHA: DRE_LINHA, regime: regime, dasMensal: dasMensal, NOME_SOCIO: NOME_SOCIO,
    consumoProducao: consumoProducao, estoque: estoque, estoqueBaixo: estoqueBaixo,
    produtosAtivos: produtosAtivos, tamanhosAtivos: tamanhosAtivos, unidade: unidade, qtdFmt: qtdFmt,
  };
})();
