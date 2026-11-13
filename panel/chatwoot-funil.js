/*
 * Relatorio de funil do painel (Relatorios > Funis > aba Funil).
 *
 * O cartao original do Chatwoot conta so' quem ENTROU na etapa por movimento: a etapa onde o
 * lead nasce aparece com zero, etapa pulada vira "100% avancam" e etapa de saida (Perdida,
 * Pendente, Desqualificado) entra na conta como se fosse degrau do funil. Este script poe outro
 * cartao no lugar, com os mesmos numeros da API do Chatwoot (/kanban/reports/*), e deixa o
 * original a um clique.
 *
 * Carregado junto do script das categorias (DASHBOARD_SCRIPTS).
 */
(function () {
  'use strict';
  if (window.__p12Funil) return;

  // ---- calculo (sem tela; testado em test/domain/funilDoPainel.test.ts) -------------

  /** Etapa que nao e' degrau do funil: lead parado ou descartado. */
  var SAIDA = /pendente|desqualific|perdid|descart|sem resposta|arquivad|cancelad/i;

  function num(v) {
    var x = Number(v);
    return isFinite(x) ? x : 0;
  }

  function classificar(passo) {
    if (passo.status === 'cancelled') return 'saida';
    if (passo.status === 'completed') return 'ganho';
    return SAIDA.test(String(passo.name || '')) ? 'saida' : 'funil';
  }

  /**
   * Leads que entraram no funil no periodo: quanto o total de cards cresceu.
   * O pedido do fluxo vai com um dia a mais no comeco, para o primeiro ponto ser a vespera.
   */
  function novosDoCfd(cfd) {
    var series = (cfd && cfd.series) || [];
    if (!series.length) return null;
    var antes = 0;
    var depois = 0;
    var pontos = 0;
    series.forEach(function (s) {
      var p = s.points || [];
      if (!p.length) return;
      pontos = Math.max(pontos, p.length);
      antes += num(p[0].count);
      depois += num(p[p.length - 1].count);
    });
    return pontos < 2 ? null : Math.max(0, depois - antes);
  }

  /** Troca um parametro da consulta, ou acrescenta. */
  function comParametro(consulta, nome, valor) {
    var achou = false;
    var partes = String(consulta || '')
      .split('&')
      .filter(Boolean)
      .map(function (p) {
        if (p.split('=')[0] !== nome) return p;
        achou = true;
        return nome + '=' + valor;
      });
    if (!achou) partes.push(nome + '=' + valor);
    return partes.join('&');
  }

  function parametro(consulta, nome) {
    var partes = String(consulta || '').replace(/^\?/, '').split('&');
    for (var i = 0; i < partes.length; i++) {
      var kv = partes[i].split('=');
      if (kv[0] === nome) return decodeURIComponent(kv[1] || '');
    }
    return null;
  }

  /** A mesma consulta, no periodo de igual tamanho logo antes. */
  function consultaAnterior(consulta) {
    var de = Number(parametro(consulta, 'since'));
    var ate = Number(parametro(consulta, 'until'));
    if (!de || !ate || ate <= de) return null;
    var tamanho = ate - de + 1;
    return comParametro(comParametro(consulta, 'since', de - tamanho), 'until', de - 1);
  }

  /** O pedido do fluxo cumulativo com a vespera incluida. */
  function consultaDoCfd(consulta) {
    var de = Number(parametro(consulta, 'since'));
    if (!de) return null;
    return comParametro(comParametro(consulta, 'since', de - 86400), 'group_by', 'day');
  }

  /**
   * Junta o que a API devolve no modelo que a tela desenha.
   * `escolha` = { idDaEtapa: true|false } quando o usuario decidiu o que e' degrau do funil.
   */
  function montar(dados, escolha) {
    var passos = (dados && dados.funil && dados.funil.steps) || [];
    var dur = {};
    ((dados && dados.duracoes) || []).forEach(function (d) {
      dur[d.step_id] = d;
    });
    var parado = {};
    ((dados && dados.envelhecimento && dados.envelhecimento.steps_summary) || []).forEach(function (d) {
      parado[d.step_id] = d;
    });

    var todas = passos.map(function (p) {
      var tipo = classificar(p);
      var d = dur[p.step_id] || {};
      var a = parado[p.step_id] || {};
      var decidido = escolha && escolha[p.step_id] != null;
      return {
        id: p.step_id,
        nome: String(p.name || ''),
        cor: /^#[0-9a-f]{3,8}$/i.test(String(p.color || '')) ? p.color : '#94a3b8',
        tipo: tipo,
        noFunil: decidido ? !!escolha[p.step_id] : tipo !== 'saida',
        entradas: Math.max(0, num(p.entered_count)),
        // O contador do Chatwoot as vezes fica negativo; card negativo nao existe.
        agora: Math.max(0, num(p.current_count)),
        taxaNativa: p.conversion_to_next == null ? null : num(p.conversion_to_next),
        tempoMedio: p.avg_time_in_step_seconds != null ? num(p.avg_time_in_step_seconds) : d.avg_seconds != null ? num(d.avg_seconds) : null,
        tempoMediano: d.median_seconds != null ? num(d.median_seconds) : null,
        tempoP90: d.p90_seconds != null ? num(d.p90_seconds) : null,
        amostra: num(d.sample_size),
        idadeMedia: a.avg_age_seconds != null ? num(a.avg_age_seconds) : null,
        idadeMaxima: a.max_age_seconds != null ? num(a.max_age_seconds) : null,
        valor: num(p.pipeline_value),
        ponderado: num(p.weighted_value),
      };
    });

    // Etapa de ganho fecha o funil, mesmo que no quadro venha depois das de perda.
    var etapas = todas
      .filter(function (e) {
        return e.noFunil && e.tipo !== 'ganho';
      })
      .concat(
        todas.filter(function (e) {
          return e.noFunil && e.tipo === 'ganho';
        }),
      );
    var saidas = todas.filter(function (e) {
      return !e.noFunil;
    });

    // "Chegaram": quem entrou na etapa ou em qualquer etapa depois dela. Lead que pula etapa
    // conta nas anteriores, e o funil nunca alarga para baixo.
    for (var i = etapas.length - 1; i >= 0; i--) {
      etapas[i].alcance = Math.max(etapas[i].entradas, i + 1 < etapas.length ? etapas[i + 1].alcance : 0);
    }
    var novos = dados && dados.novos != null ? num(dados.novos) : null;
    if (etapas.length && novos != null) etapas[0].alcance = Math.max(etapas[0].alcance, novos);

    var topo = etapas.length ? etapas[0].alcance : 0;
    var gargalo = null;
    var maisLenta = null;
    etapas.forEach(function (e, k) {
      var prox = etapas[k + 1];
      e.convTopo = topo ? e.alcance / topo : null;
      e.convProxima = prox && e.alcance ? prox.alcance / e.alcance : null;
      e.perda = prox ? e.alcance - prox.alcance : 0;
      if (prox && e.alcance && (!gargalo || e.perda > gargalo.perda)) {
        gargalo = { de: e.nome, para: prox.nome, perda: e.perda, taxa: e.convProxima };
      }
    });
    if (gargalo && gargalo.perda <= 0) gargalo = null;
    // Mediana so' se compara com mediana: a media e' puxada por um lead esquecido e ganharia sempre.
    var comMediana = etapas.some(function (e) {
      return e.tempoMediano != null && e.tipo !== 'ganho';
    });
    etapas.forEach(function (e) {
      var t = comMediana ? e.tempoMediano : e.tempoMedio;
      if (t != null && e.tipo !== 'ganho' && (!maisLenta || t > maisLenta.segundos)) {
        maisLenta = { nome: e.nome, segundos: t, mediana: comMediana };
      }
    });

    var ultima = etapas.length ? etapas[etapas.length - 1] : null;
    return {
      etapas: etapas,
      saidas: saidas,
      todas: todas,
      moeda: (dados && dados.funil && dados.funil.currency) || 'BRL',
      novos: novos,
      topo: topo,
      fundo: ultima ? ultima.alcance : 0,
      ultima: ultima,
      convGeral: topo && etapas.length > 1 ? ultima.alcance / topo : null,
      emAndamento: etapas.reduce(function (s, e) {
        return s + (e.tipo === 'ganho' ? 0 : e.agora);
      }, 0),
      foraDoFunil: saidas.reduce(function (s, e) {
        return s + e.agora;
      }, 0),
      gargalo: gargalo,
      maisLenta: maisLenta,
      valor: etapas.reduce(function (s, e) {
        return s + e.valor;
      }, 0),
      ponderado: etapas.reduce(function (s, e) {
        return s + e.ponderado;
      }, 0),
    };
  }

  // ---- texto -------------------------------------------------------------------------

  function n(v) {
    return v == null ? '–' : Math.round(v).toLocaleString('pt-BR');
  }

  function pct(v) {
    if (v == null || !isFinite(v)) return '–';
    var p = v * 100;
    if (p > 0 && p < 10) return p.toFixed(1).replace('.', ',').replace(/,0$/, '') + '%';
    return Math.round(p) + '%';
  }

  function duracao(s) {
    if (s == null || !isFinite(s)) return '–';
    s = Math.round(s);
    if (s < 60) return s + ' s';
    if (s < 3600) return Math.round(s / 60) + ' min';
    if (s < 86400) {
      var h = Math.floor(s / 3600);
      var m = Math.round((s - h * 3600) / 60);
      if (m === 60) {
        h++;
        m = 0;
      }
      return h + ' h' + (m ? ' ' + m + ' min' : '');
    }
    var d = Math.floor(s / 86400);
    var hh = Math.round((s - d * 86400) / 3600);
    if (hh === 24) {
      d++;
      hh = 0;
    }
    return d + ' d' + (hh ? ' ' + hh + ' h' : '');
  }

  function dinheiro(v, moeda) {
    try {
      return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: moeda || 'BRL', maximumFractionDigits: 0 });
    } catch (e) {
      return 'R$ ' + n(v);
    }
  }

  /** Quanto mudou contra o periodo anterior: { texto, sinal } ou null. */
  function variacao(atual, antes) {
    if (antes == null || atual == null) return null;
    if (!antes) return atual > 0 ? { texto: 'novo', sinal: 1 } : null;
    var d = (atual - antes) / antes;
    if (Math.abs(d) < 0.005) return { texto: 'igual', sinal: 0 };
    return { texto: (d > 0 ? '+' : '−') + pct(Math.abs(d)), sinal: d > 0 ? 1 : -1 };
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** Letra clara ou escura em cima da cor da etapa. */
  function letraSobre(cor) {
    var h = String(cor).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    return r * 0.299 + g * 0.587 + b * 0.114 > 160 ? '#17171a' : '#ffffff';
  }

  var METRICAS = {
    alcance: { rotulo: 'Chegaram', longo: 'chegaram na etapa ou passaram dela no período' },
    entradas: { rotulo: 'Entradas', longo: 'foram movidos para a etapa no período (número do Chatwoot)' },
    agora: { rotulo: 'Agora', longo: 'estão na etapa neste momento' },
  };
  var VISTAS = { funil: 'Funil', barras: 'Barras', tempo: 'Tempo', tabela: 'Tabela' };

  function valorDe(e, metrica) {
    return metrica === 'agora' ? e.agora : metrica === 'entradas' ? e.entradas : e.alcance;
  }

  /** Taxa de passagem para a etapa seguinte, na metrica escolhida. */
  function taxaDe(e, metrica) {
    if (metrica === 'agora') return null;
    return metrica === 'entradas' ? e.taxaNativa : e.convProxima;
  }

  // ---- desenho (devolve HTML) --------------------------------------------------------

  function chip(v) {
    if (!v) return '';
    return '<span class="p12f-var p12f-var' + (v.sinal > 0 ? 'mais' : v.sinal < 0 ? 'menos' : 'igual') + '">' + esc(v.texto) + '</span>';
  }

  function quadro(rotulo, valor, apoio, dica, extra) {
    return (
      '<div class="p12f-kpi"' + (dica ? ' title="' + esc(dica) + '"' : '') + '>' +
      '<span class="p12f-kpi-r">' + esc(rotulo) + '</span>' +
      '<span class="p12f-kpi-v' + (String(valor).length > 9 ? ' p12f-kpi-texto' : '') + '">' + esc(valor) + (extra || '') + '</span>' +
      '<span class="p12f-kpi-a">' + esc(apoio || '') + '</span></div>'
    );
  }

  function htmlKpis(m, antes) {
    var entrada = m.novos != null ? m.novos : m.topo;
    var entradaAntes = antes ? (antes.novos != null ? antes.novos : antes.topo) : null;
    var q = [];
    q.push(quadro('Leads novos no funil', n(entrada), antes ? 'antes: ' + n(entradaAntes) : 'no período escolhido',
      'Quanto o total de cards deste funil cresceu no período', chip(variacao(entrada, entradaAntes))));
    var pontos = antes && antes.convGeral != null && m.convGeral != null ? (m.convGeral - antes.convGeral) * 100 : null;
    q.push(quadro('Do topo ao fim', pct(m.convGeral), m.ultima ? n(m.fundo) + ' em ' + m.ultima.nome : '',
      'De cada 100 leads que entraram, quantos chegaram na última etapa',
      pontos == null || Math.abs(pontos) < 0.05 ? '' : chip({ texto: (pontos > 0 ? '+' : '−') + Math.abs(pontos).toFixed(1).replace('.', ',') + ' p.p.', sinal: pontos > 0 ? 1 : -1 })));
    q.push(quadro('Em andamento agora', n(m.emAndamento), m.foraDoFunil ? n(m.foraDoFunil) + ' fora do funil' : 'nas etapas do funil',
      'Cards que estão hoje nas etapas do funil, sem contar ganho nem saída'));
    if (m.gargalo) {
      q.push(quadro('Maior perda', m.gargalo.de + ' → ' + m.gargalo.para, n(m.gargalo.perda) + ' não avançaram (' + pct(1 - m.gargalo.taxa) + ')',
        'A passagem entre etapas em que mais leads ficaram pelo caminho'));
    }
    if (m.maisLenta) {
      q.push(quadro('Etapa mais lenta', m.maisLenta.nome, (m.maisLenta.mediana ? 'metade sai em até ' : 'média de ') + duracao(m.maisLenta.segundos),
        'A etapa em que o lead fica mais tempo antes de ser movido'));
    }
    if (m.valor > 0) {
      q.push(quadro('Valor em aberto', dinheiro(m.valor, m.moeda), m.ponderado > 0 ? 'ponderado: ' + dinheiro(m.ponderado, m.moeda) : 'soma dos cards do funil'));
    }
    return '<div class="p12f-kpis">' + q.join('') + '</div>';
  }

  function nomeDaEtapa(e, apoio) {
    return (
      '<div class="p12f-nome"><i style="background:' + e.cor + '"></i><span><b title="' + esc(e.nome) + '">' + esc(e.nome) + '</b>' +
      (apoio ? '<small>' + esc(apoio) + '</small>' : '') + '</span></div>'
    );
  }

  function passagem(e, metrica) {
    var taxa = taxaDe(e, metrica);
    if (taxa == null) return '<div class="p12f-passa"></div>';
    var perda = metrica === 'alcance' && e.perda > 0 ? '<span class="p12f-some">' + n(e.perda) + ' não avançaram</span>' : '';
    return '<div class="p12f-passa"><span class="p12f-pilula">↓ ' + pct(taxa) + ' avançam</span>' + perda + '</div>';
  }

  function htmlFunil(m, metrica) {
    var maior = Math.max.apply(null, m.etapas.map(function (e) { return valorDe(e, metrica); }).concat([1]));
    var larguras = m.etapas.map(function (e) {
      return Math.max(7, (valorDe(e, metrica) / maior) * 100);
    });
    var linhas = m.etapas.map(function (e, k) {
      var w = larguras[k];
      var prox = larguras[k + 1];
      // A fatia afina ate' a largura da etapa seguinte; a ultima fecha reta.
      var dx = prox != null && prox < w ? ((1 - prox / w) / 2) * 100 : 0;
      var corte = 'polygon(0 0,100% 0,' + (100 - dx).toFixed(2) + '% 100%,' + dx.toFixed(2) + '% 100%)';
      var lado = [];
      if (metrica !== 'agora') lado.push('<span><b>' + n(e.agora) + '</b> agora</span>');
      var t = e.tempoMediano != null ? e.tempoMediano : e.tempoMedio;
      if (t != null) lado.push('<span title="Tempo que o lead costuma ficar na etapa">' + duracao(t) + ' na etapa</span>');
      return (
        '<div class="p12f-linha">' +
        nomeDaEtapa(e, metrica === 'alcance' && k > 0 && e.convTopo != null ? pct(e.convTopo) + ' do topo' : e.tipo === 'ganho' ? 'ganho' : '') +
        '<div class="p12f-centro"><div class="p12f-fatia" style="width:' + w.toFixed(2) + '%;background:' + e.cor + ';color:' + letraSobre(e.cor) +
        ';clip-path:' + corte + '"><span>' + n(valorDe(e, metrica)) + '</span></div></div>' +
        '<div class="p12f-lado">' + lado.join('') + '</div></div>' +
        (k < m.etapas.length - 1 ? '<div class="p12f-linha p12f-entre"><div></div>' + passagem(e, metrica) + '<div></div></div>' : '')
      );
    });
    return '<div class="p12f-funil">' + linhas.join('') + '</div>';
  }

  function htmlBarras(m, metrica) {
    var principal = metrica === 'agora' ? 'alcance' : metrica;
    var maior = Math.max.apply(null, m.etapas.map(function (e) { return Math.max(valorDe(e, principal), e.agora); }).concat([1]));
    var linhas = m.etapas.map(function (e) {
      var taxa = taxaDe(e, principal);
      return (
        '<div class="p12f-linha p12f-barra">' + nomeDaEtapa(e, e.tipo === 'ganho' ? 'ganho' : '') +
        '<div class="p12f-trilhos">' +
        '<div class="p12f-trilho"><i style="width:' + ((valorDe(e, principal) / maior) * 100).toFixed(2) + '%;background:' + e.cor + '"></i><b>' + n(valorDe(e, principal)) + '</b></div>' +
        '<div class="p12f-trilho p12f-fraco"><i style="width:' + ((e.agora / maior) * 100).toFixed(2) + '%"></i><b>' + n(e.agora) + '</b></div>' +
        '</div><div class="p12f-lado">' + (taxa != null ? '<span><b>' + pct(taxa) + '</b> avançam</span>' : '') + '</div></div>'
      );
    });
    return (
      '<div class="p12f-legenda"><span><i class="p12f-cheio"></i>' + esc(METRICAS[principal].rotulo) + ' no período</span><span><i></i>Estão agora na etapa</span></div>' +
      '<div class="p12f-funil">' + linhas.join('') + '</div>'
    );
  }

  function htmlTempo(m, parados, conta) {
    var comTempo = m.etapas.filter(function (e) { return e.tempoMedio != null || e.tempoMediano != null; });
    var maior = Math.max.apply(null, comTempo.map(function (e) { return Math.max(num(e.tempoP90), num(e.tempoMedio), num(e.tempoMediano)); }).concat([1]));
    // Raiz quadrada: uma etapa de dias nao esmaga a de minutos.
    var escala = function (s) { return s == null ? 0 : Math.max(1.5, Math.sqrt(s / maior) * 100); };
    var linhas = m.etapas.map(function (e) {
      if (e.tempoMedio == null && e.tempoMediano == null) {
        return '<div class="p12f-linha p12f-tempo">' + nomeDaEtapa(e, '') + '<div class="p12f-vazio">sem saída da etapa no período</div><div class="p12f-lado"></div></div>';
      }
      var base = e.tempoMediano != null ? e.tempoMediano : e.tempoMedio;
      return (
        '<div class="p12f-linha p12f-tempo">' + nomeDaEtapa(e, e.amostra ? n(e.amostra) + (e.amostra === 1 ? ' lead medido' : ' leads medidos') : '') +
        '<div class="p12f-regua">' +
        (e.tempoP90 != null ? '<i class="p12f-p90" style="width:' + escala(e.tempoP90).toFixed(2) + '%;background:' + e.cor + '"></i>' : '') +
        '<i class="p12f-med" style="width:' + escala(base).toFixed(2) + '%;background:' + e.cor + '"></i>' +
        (e.tempoMedio != null ? '<i class="p12f-media" style="left:' + Math.min(99.5, escala(e.tempoMedio)).toFixed(2) + '%" title="Média: ' + esc(duracao(e.tempoMedio)) + '"></i>' : '') +
        '</div><div class="p12f-lado p12f-tempos">' +
        (e.tempoMediano != null ? '<span>metade sai em <b>' + duracao(e.tempoMediano) + '</b></span>' : '') +
        (e.tempoMedio != null ? '<span>média <b>' + duracao(e.tempoMedio) + '</b></span>' : '') +
        (e.tempoP90 != null ? '<span>9 em 10 saem em <b>' + duracao(e.tempoP90) + '</b></span>' : '') +
        '</div></div>'
      );
    });
    var lista = '';
    if (parados && parados.length) {
      lista =
        '<div class="p12f-sub">Parados há mais tempo</div><div class="p12f-parados">' +
        parados.slice(0, 8).map(function (t) {
          // O endereco do card so' abre card ja' carregado na coluna, e card velho nunca esta' la'.
          // O titulo traz o numero da conversa ("Conversa #386 - Ana", "#386 - 5511... - Ana").
          var conversa = /^(?:Conversa\s+)?#(\d+)\b/i.exec(String(t.title || ''));
          var dentro = '<b>' + esc(t.title || 'Card ' + t.task_id) + '</b><span>' + esc(t.step_name || '') + '</span><em>há ' + duracao(t.age_seconds) + '</em>';
          return conversa && conta
            ? '<a class="p12f-parado" href="/app/accounts/' + esc(conta) + '/conversations/' + conversa[1] + '" data-acao="abrir" title="Abrir a conversa">' + dentro + '</a>'
            : '<div class="p12f-parado">' + dentro + '</div>';
        }).join('') + '</div>';
    }
    return (
      '<div class="p12f-legenda"><span><i class="p12f-cheio"></i>Metade dos leads sai até aqui</span><span><i></i>9 em cada 10</span><span><i class="p12f-risco"></i>Média</span></div>' +
      '<div class="p12f-funil">' + linhas.join('') + '</div>' + lista
    );
  }

  /** As linhas da tabela, tambem usadas na exportacao. */
  function tabela(m, antes) {
    var porId = {};
    ((antes && antes.todas) || []).forEach(function (e) { porId[e.id] = e; });
    var cab = ['Etapa', 'Chegaram', 'Entradas', 'Agora', 'Avançam', 'Do topo', 'Metade sai em', 'Tempo médio', '9 em 10 saem em', 'Parado em média há'];
    if (antes) cab.splice(2, 0, 'Chegaram antes');
    if (m.valor > 0) cab.push('Valor');
    var linha = function (e, fora) {
      var a = porId[e.id];
      var l = [e.nome, fora ? '' : n(e.alcance), n(e.entradas), n(e.agora), fora ? '' : pct(e.convProxima), fora ? '' : pct(e.convTopo),
        duracao(e.tempoMediano), duracao(e.tempoMedio), duracao(e.tempoP90), duracao(e.idadeMedia)];
      if (antes) l.splice(2, 0, fora || !a || a.alcance == null ? '' : n(a.alcance));
      if (m.valor > 0) l.push(e.valor ? dinheiro(e.valor, m.moeda) : '');
      return l;
    };
    return {
      cabecalho: cab,
      funil: m.etapas.map(function (e) { return linha(e, false); }),
      fora: m.saidas.map(function (e) { return linha(e, true); }),
    };
  }

  function htmlTabela(m, antes) {
    var t = tabela(m, antes);
    var tr = function (l, classe, e) {
      return '<tr' + (classe ? ' class="' + classe + '"' : '') + '>' + l.map(function (c, i) {
        return i === 0 ? '<th><i style="background:' + e.cor + '"></i>' + esc(c) + '</th>' : '<td>' + esc(c === '–' ? '' : c) + '</td>';
      }).join('') + '</tr>';
    };
    return (
      '<div class="p12f-rolagem"><table class="p12f-tabela"><thead><tr>' + t.cabecalho.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      t.funil.map(function (l, i) { return tr(l, '', m.etapas[i]); }).join('') +
      (t.fora.length ? '<tr class="p12f-divisa"><th colspan="' + t.cabecalho.length + '">Fora do funil</th></tr>' : '') +
      t.fora.map(function (l, i) { return tr(l, 'p12f-fora', m.saidas[i]); }).join('') +
      '</tbody></table></div>'
    );
  }

  function csv(m, antes) {
    var t = tabela(m, antes);
    var celula = function (c) {
      c = String(c == null ? '' : c).replace(/ /g, ' ');
      return /[";\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
    };
    return [t.cabecalho].concat(t.funil, t.fora).map(function (l) { return l.map(celula).join(';'); }).join('\r\n');
  }

  function htmlSaidas(m) {
    if (!m.saidas.length) return '';
    return (
      '<div class="p12f-saidas"><span class="p12f-sub">Fora do funil</span>' +
      m.saidas.map(function (e) {
        return '<span class="p12f-saida" title="Entraram no período: ' + n(e.entradas) + '"><i style="background:' + e.cor + '"></i>' + esc(e.nome) +
          ' <b>' + n(e.agora) + '</b> agora' + (e.entradas ? ' · <b>' + n(e.entradas) + '</b> no período' : '') + '</span>';
      }).join('') + '</div>'
    );
  }

  function htmlControles(m, pref, aberto) {
    var seg = function (acao, opcoes, atual) {
      return '<div class="p12f-seg">' + Object.keys(opcoes).map(function (k) {
        var o = opcoes[k];
        return '<button type="button" data-acao="' + acao + '" data-v="' + k + '"' + (k === atual ? ' class="p12f-on"' : '') +
          (o.longo ? ' title="' + esc(o.longo) + '"' : '') + '>' + esc(o.rotulo || o) + '</button>';
      }).join('') + '</div>';
    };
    var etapas = '';
    if (aberto) {
      etapas =
        '<div class="p12f-menu"><div class="p12f-menu-t">Etapas que contam como degrau do funil</div>' +
        m.todas.map(function (e) {
          return '<label><input type="checkbox" data-acao="etapa" data-id="' + e.id + '"' + (e.noFunil ? ' checked' : '') + '><i style="background:' + e.cor + '"></i>' + esc(e.nome) + '</label>';
        }).join('') + '<button type="button" data-acao="etapas-padrao">Voltar ao padrão</button></div>';
    }
    return (
      '<div class="p12f-controles">' + seg('vista', VISTAS, pref.vista) +
      (pref.vista === 'funil' || pref.vista === 'barras' ? seg('metrica', METRICAS, pref.metrica) : '') +
      '<span class="p12f-folga"></span>' +
      '<button type="button" class="p12f-bot' + (pref.comparar ? ' p12f-on' : '') + '" data-acao="comparar" title="Compara com o período de mesmo tamanho logo antes">Comparar com período anterior</button>' +
      '<span class="p12f-ancora"><button type="button" class="p12f-bot' + (aberto ? ' p12f-on' : '') + '" data-acao="etapas">Etapas</button>' + etapas + '</span>' +
      '<button type="button" class="p12f-bot" data-acao="csv" title="Baixa a tabela deste relatório">Baixar CSV</button></div>'
    );
  }

  /** O cartao inteiro. `tela` = { erro, aberto, comparando, parados, conta }. */
  function html(m, antes, pref, tela) {
    tela = tela || {};
    var topo = '<div class="p12f-topo"><div><span class="p12f-titulo">Funil de conversão</span>' +
      '<span class="p12f-desc">' + esc(pref.vista === 'tempo' ? 'Quanto tempo o lead fica em cada etapa' : pref.vista === 'tabela' ? 'Todos os números do período, por etapa'
        : 'Leads que ' + METRICAS[pref.vista === 'barras' && pref.metrica === 'agora' ? 'alcance' : pref.metrica].longo) + '</span></div>' +
      '<button type="button" class="p12f-link" data-acao="original">Ver o cartão original</button></div>';
    if (tela.erro) return topo + '<div class="p12f-aviso">Não consegui carregar os dados deste funil. O cartão original segue abaixo.</div>';
    if (!m) return topo + '<div class="p12f-aviso">Carregando o funil…</div>';
    if (!m.todas.length) return topo + '<div class="p12f-aviso">Este funil ainda não tem etapas.</div>';
    var corpo;
    if (!m.etapas.length) corpo = '<div class="p12f-aviso">Nenhuma etapa marcada como degrau do funil. Use o botão Etapas para escolher.</div>';
    else if (pref.vista === 'barras') corpo = htmlBarras(m, pref.metrica);
    else if (pref.vista === 'tempo') corpo = htmlTempo(m, tela.parados, tela.conta);
    else if (pref.vista === 'tabela') corpo = htmlTabela(m, antes);
    else corpo = htmlFunil(m, pref.metrica);
    return (
      topo + htmlControles(m, pref, tela.aberto) + htmlKpis(m, antes) +
      (tela.comparando ? '<div class="p12f-nota">Buscando o período anterior…</div>' : '') +
      corpo + (pref.vista === 'tabela' ? '' : htmlSaidas(m)) +
      (pref.vista === 'funil' && pref.metrica === 'alcance'
        ? '<div class="p12f-nota">“Chegaram” conta quem entrou na etapa ou em qualquer etapa depois dela, então lead que pula etapa não some do funil. A primeira etapa usa os leads novos do período.</div>'
        : '')
    );
  }

  window.__p12Funil = {
    classificar: classificar,
    montar: montar,
    novosDoCfd: novosDoCfd,
    consultaAnterior: consultaAnterior,
    consultaDoCfd: consultaDoCfd,
    duracao: duracao,
    pct: pct,
    variacao: variacao,
    tabela: tabela,
    csv: csv,
    html: html,
  };
  if (typeof document === 'undefined' || !document.documentElement) return;

  // ---- tela --------------------------------------------------------------------------

  var CSS = [
    '[data-p12-funil-nativo="oculto"]{display:none!important}',
    '.p12f{display:flex;flex-direction:column;gap:16px;padding:20px;border:1px solid rgb(var(--slate-3,33 34 37));border-radius:12px;background:rgba(var(--alpha-1,35,36,42,.8));color:rgb(var(--slate-12,237 238 240));font-size:13px;line-height:1.35;font-variant-numeric:tabular-nums}',
    '.p12f *{box-sizing:border-box}',
    '.p12f-topo{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}',
    '.p12f-titulo{display:block;font-size:14px;font-weight:500}',
    '.p12f-desc{display:block;margin-top:2px;color:rgb(var(--slate-11,176 180 186));font-size:12px}',
    '.p12f-link{flex:none;border:0;background:none;padding:0;color:rgb(var(--slate-10,119 123 132));font-size:12px;cursor:pointer;text-decoration:underline;text-underline-offset:2px}',
    '.p12f-link:hover{color:rgb(var(--slate-12,237 238 240))}',
    '.p12f-controles{display:flex;flex-wrap:wrap;align-items:center;gap:8px}',
    '.p12f-folga{flex:1 1 0}',
    '.p12f-seg{display:inline-flex;height:32px;padding:2px;border-radius:8px;background:rgb(var(--solid-1,23 23 26));border:1px solid rgb(var(--slate-3,33 34 37))}',
    '.p12f-seg button{border:0;background:none;padding:0 12px;border-radius:6px;color:rgb(var(--slate-11,176 180 186));font-size:13px;cursor:pointer;white-space:nowrap}',
    '.p12f-seg button:hover{color:rgb(var(--slate-12,237 238 240))}',
    '.p12f-seg button.p12f-on{background:rgb(var(--solid-active,53 57 66));color:rgb(var(--slate-12,237 238 240));box-shadow:0 1px 2px rgba(0,0,0,.2)}',
    '.p12f-bot{height:32px;padding:0 12px;border-radius:8px;border:1px solid rgb(var(--slate-3,33 34 37));background:rgb(var(--solid-1,23 23 26));color:rgb(var(--slate-11,176 180 186));font-size:13px;cursor:pointer;white-space:nowrap}',
    '.p12f-bot:hover{color:rgb(var(--slate-12,237 238 240))}',
    '.p12f-bot.p12f-on{border-color:rgb(var(--blue-9,110 86 207));color:rgb(var(--slate-12,237 238 240));background:rgb(var(--blue-9,110 86 207) / .18)}',
    '.p12f-ancora{position:relative}',
    '.p12f-menu{position:absolute;right:0;top:38px;z-index:30;min-width:260px;display:flex;flex-direction:column;gap:2px;padding:10px;border-radius:10px;border:1px solid rgb(var(--slate-6,54 58 63));background:rgb(var(--solid-2,29 30 36));box-shadow:0 12px 32px rgba(0,0,0,.35)}',
    '.p12f-menu-t{padding:2px 4px 8px;color:rgb(var(--slate-11,176 180 186));font-size:12px}',
    '.p12f-menu label{display:flex;align-items:center;gap:8px;padding:5px 4px;border-radius:6px;cursor:pointer}',
    '.p12f-menu label:hover{background:rgb(var(--solid-3,44 45 54))}',
    '.p12f-menu label i,.p12f-nome i,.p12f-saida i,.p12f-tabela th i{flex:none;display:inline-block;width:8px;height:8px;border-radius:50%}',
    '.p12f-menu button{margin-top:6px;align-self:flex-start;border:0;background:none;padding:4px;color:rgb(var(--slate-10,119 123 132));font-size:12px;cursor:pointer;text-decoration:underline}',
    '.p12f-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}',
    '.p12f-kpi{display:flex;flex-direction:column;gap:4px;min-width:0;padding:12px 14px;border-radius:10px;background:rgb(var(--solid-1,23 23 26));border:1px solid rgb(var(--slate-3,33 34 37))}',
    '.p12f-kpi-r{color:rgb(var(--slate-11,176 180 186));font-size:12px}',
    '.p12f-kpi-v{display:flex;align-items:baseline;gap:8px;font-size:24px;font-weight:600;line-height:1.15;letter-spacing:-.01em}',
    '.p12f-kpi-texto{font-size:14px;line-height:1.3;min-height:28px;align-items:center;font-weight:500;letter-spacing:0}',
    '.p12f-kpi-a{color:rgb(var(--slate-10,119 123 132));font-size:12px;min-height:16px}',
    '.p12f-var{font-size:12px;font-weight:500;padding:1px 6px;border-radius:999px;letter-spacing:0;white-space:nowrap}',
    '.p12f-varmais{color:rgb(var(--teal-9,18 165 148));background:rgb(var(--teal-9,18 165 148) / .16)}',
    '.p12f-varmenos{color:rgb(var(--ruby-9,229 70 102));background:rgb(var(--ruby-9,229 70 102) / .16)}',
    '.p12f-varigual{color:rgb(var(--slate-11,176 180 186));background:rgb(var(--slate-9,105 110 119) / .16)}',
    '.p12f-funil{display:flex;flex-direction:column;gap:2px}',
    '.p12f-linha{display:grid;grid-template-columns:minmax(120px,190px) minmax(0,1fr) minmax(110px,170px);align-items:center;gap:14px}',
    '.p12f-nome{display:flex;align-items:center;gap:8px;min-width:0}',
    '.p12f-nome span{display:flex;flex-direction:column;min-width:0}',
    '.p12f-nome b{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.p12f-nome small{color:rgb(var(--slate-10,119 123 132));font-size:11.5px}',
    '.p12f-centro{display:flex;justify-content:center}',
    '.p12f-fatia{height:40px;min-width:48px;display:flex;align-items:center;justify-content:center;border-radius:3px;font-weight:600;font-size:14px;transition:width .35s ease}',
    '.p12f-lado{display:flex;flex-direction:column;gap:1px;color:rgb(var(--slate-11,176 180 186));font-size:12px;text-align:right}',
    '.p12f-lado b{color:rgb(var(--slate-12,237 238 240));font-weight:600}',
    '.p12f-entre{min-height:24px}',
    '.p12f-passa{display:flex;justify-content:center;align-items:center;gap:8px;flex-wrap:wrap}',
    '.p12f-pilula{padding:1px 8px;border-radius:999px;background:rgb(var(--solid-3,44 45 54));color:rgb(var(--slate-12,237 238 240));font-size:11.5px;font-weight:500}',
    '.p12f-some{color:rgb(var(--slate-10,119 123 132));font-size:11.5px}',
    '.p12f-barra,.p12f-tempo{padding:7px 0;border-top:1px solid rgb(var(--slate-3,33 34 37))}',
    '.p12f-funil>.p12f-barra:first-child,.p12f-funil>.p12f-tempo:first-child{border-top:0}',
    '.p12f-trilhos{display:flex;flex-direction:column;gap:4px}',
    '.p12f-trilho{display:flex;align-items:center;gap:8px;height:16px}',
    '.p12f-trilho i{display:block;height:100%;min-width:2px;border-radius:3px;transition:width .35s ease}',
    '.p12f-trilho b{font-weight:600;font-size:12px}',
    '.p12f-fraco{height:8px}',
    '.p12f-fraco i{background:rgb(var(--slate-9,105 110 119))}',
    '.p12f-fraco b{font-weight:400;color:rgb(var(--slate-11,176 180 186))}',
    '.p12f-legenda{display:flex;flex-wrap:wrap;gap:16px;color:rgb(var(--slate-11,176 180 186));font-size:12px}',
    '.p12f-legenda span{display:inline-flex;align-items:center;gap:6px}',
    '.p12f-legenda i{display:inline-block;width:14px;height:8px;border-radius:2px;background:rgb(var(--slate-9,105 110 119) / .55)}',
    '.p12f-legenda i.p12f-cheio{height:12px;background:rgb(var(--slate-11,176 180 186))}',
    '.p12f-tempo{grid-template-columns:minmax(120px,190px) minmax(0,1fr) 200px}',
    '.p12f-legenda i.p12f-risco{width:2px;height:12px;border-radius:0;background:rgb(var(--slate-12,237 238 240))}',
    '.p12f-regua{position:relative;height:18px;border-radius:4px;background:rgb(var(--solid-1,23 23 26))}',
    '.p12f-regua i{position:absolute;left:0;top:0;height:100%;border-radius:4px}',
    '.p12f-p90{opacity:.28}',
    '.p12f-regua .p12f-media{width:2px;border-radius:0;top:-3px;height:24px;background:rgb(var(--slate-12,237 238 240))}',
    '.p12f-tempos span{white-space:nowrap}',
    '.p12f-vazio{color:rgb(var(--slate-10,119 123 132));font-size:12px}',
    '.p12f-sub{color:rgb(var(--slate-11,176 180 186));font-size:12px;font-weight:500}',
    '.p12f-parados{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:6px}',
    '.p12f-parado{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:0 10px;padding:8px 10px;border-radius:8px;background:rgb(var(--solid-1,23 23 26));border:1px solid rgb(var(--slate-3,33 34 37));color:inherit;text-decoration:none}',
    '.p12f-parado:hover{border-color:rgb(var(--slate-6,54 58 63))}',
    '.p12f-parado b{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.p12f-parado span{grid-row:2;color:rgb(var(--slate-10,119 123 132));font-size:12px}',
    '.p12f-parado em{grid-row:1 / span 2;grid-column:2;align-self:center;font-style:normal;font-weight:500;color:rgb(var(--slate-11,176 180 186));font-size:12px;white-space:nowrap}',
    '.p12f-saidas{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding-top:12px;border-top:1px solid rgb(var(--slate-3,33 34 37))}',
    '.p12f-saida{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;background:rgb(var(--solid-1,23 23 26));border:1px solid rgb(var(--slate-3,33 34 37));color:rgb(var(--slate-11,176 180 186));font-size:12px}',
    '.p12f-saida b{color:rgb(var(--slate-12,237 238 240));font-weight:600}',
    '.p12f-rolagem{overflow-x:auto}',
    '.p12f-tabela{width:100%;border-collapse:collapse;font-size:12.5px}',
    '.p12f-tabela th,.p12f-tabela td{padding:8px 8px;text-align:right;white-space:nowrap;border-top:1px solid rgb(var(--slate-3,33 34 37))}',
    '.p12f-tabela thead th{border-top:0;color:rgb(var(--slate-11,176 180 186));font-weight:500;font-size:12px;white-space:normal;vertical-align:bottom;line-height:1.25;min-width:56px}',
    '.p12f-tabela th:first-child,.p12f-tabela td:first-child{padding-left:0}',
    '.p12f-tabela th:last-child,.p12f-tabela td:last-child{padding-right:0}',
    '.p12f-tabela th:first-child{text-align:left;font-weight:500}',
    '.p12f-tabela tbody th i{margin-right:8px}',
    '.p12f-tabela .p12f-divisa th{padding-top:14px;color:rgb(var(--slate-10,119 123 132));font-size:12px;font-weight:500}',
    '.p12f-tabela .p12f-fora{color:rgb(var(--slate-11,176 180 186))}',
    '.p12f-aviso{padding:24px 0;text-align:center;color:rgb(var(--slate-11,176 180 186))}',
    '.p12f-nota{color:rgb(var(--slate-10,119 123 132));font-size:12px}',
    '.p12f-fino{padding:8px 14px;flex-direction:row;justify-content:space-between;align-items:center}',
    '@media (max-width:760px){.p12f-linha{grid-template-columns:minmax(0,1fr);gap:4px}.p12f-lado{flex-direction:row;gap:10px;text-align:left}.p12f-entre>div:first-child,.p12f-entre>div:last-child{display:none}}',
  ].join('\n');

  var CHAVE_PREF = 'p12-funil-v1';

  function lerPref() {
    var p = { vista: 'funil', metrica: 'alcance', comparar: false, etapas: {} };
    try {
      var g = JSON.parse(localStorage.getItem(CHAVE_PREF) || '{}');
      if (VISTAS[g.vista]) p.vista = g.vista;
      if (METRICAS[g.metrica]) p.metrica = g.metrica;
      p.comparar = !!g.comparar;
      if (g.etapas && typeof g.etapas === 'object') p.etapas = g.etapas;
    } catch (e) {
      /* sem armazenamento: vale o padrao */
    }
    return p;
  }

  function gravarPref() {
    try {
      localStorage.setItem(CHAVE_PREF, JSON.stringify(estado.pref));
    } catch (e) {
      /* idem */
    }
  }

  var estado = {
    chave: null,
    conta: null,
    consulta: null,
    dados: {},
    anterior: null,
    comparando: false,
    erro: false,
    pref: lerPref(),
    aberto: false,
    original: false,
    ultimoHtml: null,
  };
  var raiz = null;

  function sessao() {
    try {
      var bruto = document.cookie.split('; ').filter(function (c) {
        return c.indexOf('cw_d_session_info=') === 0;
      })[0];
      var s = JSON.parse(decodeURIComponent(bruto.slice(bruto.indexOf('=') + 1)));
      return { 'access-token': s['access-token'], client: s.client, uid: s.uid, expiry: s.expiry, 'token-type': s['token-type'] };
    } catch (e) {
      return {};
    }
  }

  function pedir(conta, relatorio, consulta) {
    return fetch('/api/v1/accounts/' + conta + '/kanban/reports/' + relatorio + '?' + consulta, { headers: sessao() }).then(function (r) {
      if (!r.ok) throw new Error(relatorio + ' ' + r.status);
      return r.json();
    });
  }

  function quadroDaConsulta() {
    return parametro(estado.consulta, 'board_id');
  }

  function escolhaDoQuadro() {
    return estado.pref.etapas[estado.conta + ':' + quadroDaConsulta()] || null;
  }

  function carregarAnterior() {
    var chave = estado.chave;
    var conta = estado.conta;
    var antes = consultaAnterior(estado.consulta);
    if (!antes || estado.anterior || estado.comparando) return;
    estado.comparando = true;
    var cfd = consultaDoCfd(antes);
    Promise.all([
      pedir(conta, 'funnel', antes),
      cfd ? pedir(conta, 'cfd', cfd).catch(function () { return null; }) : null,
    ])
      .then(function (r) {
        if (estado.chave !== chave) return;
        estado.anterior = { funil: r[0], novos: novosDoCfd(r[1]) };
      })
      .catch(function () {
        /* sem periodo anterior: o relatorio segue sem a comparacao */
      })
      .then(function () {
        if (estado.chave !== chave) return;
        estado.comparando = false;
        desenhar();
      });
  }

  /** Passa a mostrar esta consulta. `funil` vem pronto quando foi o proprio Chatwoot que pediu. */
  function definirConsulta(conta, consulta, funil) {
    var chave = conta + '|' + consulta;
    if (estado.chave === chave) {
      if (funil) {
        estado.dados.funil = funil;
        estado.erro = false;
        desenhar();
      }
      return;
    }
    estado.chave = chave;
    estado.conta = conta;
    estado.consulta = consulta;
    estado.dados = { funil: funil || null };
    estado.anterior = null;
    estado.comparando = false;
    estado.erro = false;
    estado.aberto = false;
    var parte = function (nome, relatorio, q, tratar) {
      if (!q) return;
      pedir(conta, relatorio, q)
        .then(function (r) {
          if (estado.chave !== chave) return;
          estado.dados[nome] = tratar ? tratar(r) : r;
          desenhar();
        })
        .catch(function () {
          if (estado.chave !== chave || nome !== 'funil') return;
          estado.erro = true;
          desenhar();
        });
    };
    if (!funil) parte('funil', 'funnel', consulta);
    parte('duracoes', 'stage_durations', consulta);
    parte('envelhecimento', 'aging', comParametro(consulta, 'page', 1));
    parte('novos', 'cfd', consultaDoCfd(consulta), novosDoCfd);
    if (estado.pref.comparar) carregarAnterior();
    desenhar();
  }

  // O Chatwoot pede o funil por XMLHttpRequest: aproveitar a resposta dele garante os mesmos
  // filtros (periodo, funil, agente, caixa) sem adivinhar nome de parametro.
  var abrir = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (metodo, url) {
    try {
      var m = /\/api\/v1\/accounts\/(\d+)\/kanban\/reports\/funnel\?([^#]+)/.exec(String(url));
      if (m && String(metodo).toUpperCase() === 'GET') {
        var x = this;
        x.addEventListener('load', function () {
          try {
            if (x.status === 200) definirConsulta(m[1], m[2], JSON.parse(x.responseText));
          } catch (e) {
            /* resposta que nao deu para ler: a conferencia pela URL busca de novo */
          }
        });
      }
    } catch (e) {
      /* nunca atrapalhar o pedido do Chatwoot */
    }
    return abrir.apply(this, arguments);
  };

  function modelos() {
    if (!estado.dados.funil) return { atual: null, antes: null };
    var escolha = escolhaDoQuadro();
    return {
      atual: montar(estado.dados, escolha),
      antes: estado.pref.comparar && estado.anterior ? montar(estado.anterior, escolha) : null,
    };
  }

  function desenhar() {
    if (!raiz) return;
    var texto;
    if (estado.original) {
      raiz.className = 'p12f p12f-fino';
      texto = '<span class="p12f-desc">Mostrando o cartão original do Chatwoot.</span><button type="button" class="p12f-link" data-acao="original">Voltar ao relatório novo</button>';
    } else {
      raiz.className = 'p12f';
      var m = modelos();
      texto = html(m.atual, m.antes, estado.pref, {
        erro: estado.erro,
        aberto: estado.aberto,
        comparando: estado.pref.comparar && estado.comparando,
        parados: (estado.dados.envelhecimento && estado.dados.envelhecimento.items) || [],
        conta: estado.conta,
      });
    }
    if (texto === estado.ultimoHtml) return;
    estado.ultimoHtml = texto;
    raiz.innerHTML = texto;
    marcarNativo();
  }

  function baixarCsv() {
    var m = modelos();
    if (!m.atual) return;
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv(m.atual, m.antes)], { type: 'text/csv;charset=utf-8' }));
    a.download = 'funil-' + (quadroDaConsulta() || 'geral') + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }

  function aoClicar(ev) {
    // O redesenho troca o botao clicado por outro: sem esta marca, o ouvinte do documento
    // veria um alvo fora da tela e fecharia o menu que acabou de abrir.
    ev.p12Dentro = true;
    var alvo = ev.target.closest ? ev.target.closest('[data-acao]') : null;
    if (!alvo || !raiz.contains(alvo)) {
      if (estado.aberto && !(ev.target.closest && ev.target.closest('.p12f-menu'))) {
        estado.aberto = false;
        desenhar();
      }
      return;
    }
    var acao = alvo.getAttribute('data-acao');
    if (acao === 'etapa' || acao === 'abrir') return;
    ev.preventDefault();
    if (acao === 'vista') estado.pref.vista = alvo.getAttribute('data-v');
    else if (acao === 'metrica') estado.pref.metrica = alvo.getAttribute('data-v');
    else if (acao === 'comparar') {
      estado.pref.comparar = !estado.pref.comparar;
      if (estado.pref.comparar) carregarAnterior();
    } else if (acao === 'etapas') estado.aberto = !estado.aberto;
    else if (acao === 'etapas-padrao') delete estado.pref.etapas[estado.conta + ':' + quadroDaConsulta()];
    else if (acao === 'original') estado.original = !estado.original;
    else if (acao === 'csv') return baixarCsv();
    gravarPref();
    desenhar();
  }

  function aoMarcar(ev) {
    var caixa = ev.target;
    if (!caixa || caixa.getAttribute('data-acao') !== 'etapa') return;
    var m = modelos().atual;
    if (!m) return;
    var mapa = {};
    m.todas.forEach(function (e) {
      mapa[e.id] = e.noFunil;
    });
    mapa[caixa.getAttribute('data-id')] = caixa.checked;
    estado.pref.etapas[estado.conta + ':' + quadroDaConsulta()] = mapa;
    gravarPref();
    desenhar();
  }

  /** O cartao original da aba Funil, reconhecido pelo titulo ou, em outro idioma, pelas etapas. */
  function acharNativo() {
    var cartoes = document.querySelectorAll('main div.rounded-xl.border');
    var passos = (estado.dados.funil && estado.dados.funil.steps) || [];
    for (var i = 0; i < cartoes.length; i++) {
      var c = cartoes[i];
      if (c.closest('.p12f')) continue;
      var texto = c.textContent || '';
      if (/Funil de convers|Conversion funnel|Embudo de conver/i.test(texto.slice(0, 60))) return c;
      var bate = 0;
      for (var k = 0; k < passos.length; k++) {
        if (passos[k].name && texto.indexOf(passos[k].name) >= 0) bate++;
      }
      if (passos.length >= 2 && bate === passos.length && /%/.test(texto)) return c;
    }
    return null;
  }

  function marcarNativo() {
    var marcados = document.querySelectorAll('[data-p12-funil-nativo]');
    for (var i = 0; i < marcados.length; i++) {
      if (!raiz || marcados[i] !== raiz.nextElementSibling) marcados[i].removeAttribute('data-p12-funil-nativo');
    }
    var nativo = raiz && raiz.nextElementSibling;
    if (nativo) nativo.setAttribute('data-p12-funil-nativo', estado.original || estado.erro ? 'visivel' : 'oculto');
  }

  function desmontar() {
    if (raiz && raiz.parentNode) raiz.parentNode.removeChild(raiz);
    var marcados = document.querySelectorAll('[data-p12-funil-nativo]');
    for (var i = 0; i < marcados.length; i++) marcados[i].removeAttribute('data-p12-funil-nativo');
  }

  function verificar() {
    var rota = /\/app\/accounts\/(\d+)\/reports\/funnels/.exec(location.pathname);
    var aba = parametro(location.search, 'tab');
    if (!rota || aba !== 'funnel') return desmontar();

    // Rede de seguranca do gancho: script que chegou depois do pedido do Chatwoot monta a consulta pela URL.
    var de = parametro(location.search, 'since');
    var ate = parametro(location.search, 'until');
    var quadroId = parametro(location.search, 'board_id');
    if (de && ate && quadroId) {
      var igual =
        estado.conta === rota[1] &&
        parametro(estado.consulta, 'since') === de &&
        parametro(estado.consulta, 'until') === ate &&
        parametro(estado.consulta, 'board_id') === quadroId;
      if (!igual) {
        definirConsulta(rota[1], 'since=' + de + '&until=' + ate + '&board_id=' + quadroId + '&timezone_offset=' + -new Date().getTimezoneOffset() / 60);
      }
    }

    var nativo = acharNativo();
    if (!nativo) return desmontar();
    if (!document.getElementById('p12-funil-estilo')) {
      var estilo = document.createElement('style');
      estilo.id = 'p12-funil-estilo';
      estilo.textContent = CSS;
      document.head.appendChild(estilo);
    }
    if (!raiz) {
      raiz = document.createElement('section');
      raiz.id = 'p12-funil';
      raiz.className = 'p12f';
      raiz.addEventListener('click', aoClicar);
      raiz.addEventListener('change', aoMarcar);
      document.addEventListener('click', function (ev) {
        if (raiz && estado.aberto && !ev.p12Dentro && !raiz.contains(ev.target)) {
          estado.aberto = false;
          desenhar();
        }
      });
    }
    if (raiz.nextElementSibling !== nativo) {
      nativo.parentNode.insertBefore(raiz, nativo);
      estado.ultimoHtml = null;
    }
    desenhar();
    marcarNativo();
  }

  function logo() {
    try {
      verificar();
    } catch (e) {
      // Qualquer tropeco devolve a tela original.
      try {
        desmontar();
      } catch (e2) {
        /* nada a fazer */
      }
    }
  }

  ['pushState', 'replaceState'].forEach(function (nome) {
    var original = history[nome];
    history[nome] = function () {
      var r = original.apply(this, arguments);
      setTimeout(logo, 0);
      return r;
    };
  });
  window.addEventListener('popstate', function () {
    setTimeout(logo, 0);
  });
  setInterval(logo, 400);
  logo();
})();
