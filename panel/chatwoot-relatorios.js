/*
 * Relatorios do painel: uma pagina so' no lugar das dez sub-abas.
 *
 * Abre em /app/accounts/N/reports/overview, esconde o conteudo nativo da rota e desenha o nosso,
 * na largura toda, com filtros fixos no topo (periodo, funil, caixa, atendente, etiqueta, time),
 * alertas do que pede acao, numeros-chave e oito visoes. As telas originais seguem abrindo pelo
 * endereco delas e por um link no rodape; /reports/overview?original=1 mostra a nativa.
 *
 * Reaproveita o calculo do funil de chatwoot-funil.js (window.__p12Funil). A origem dos leads vem
 * do CRM (/ingest/categorias/:conta/origem), so' numeros agregados.
 *
 * Regra de ouro: qualquer excecao devolve a tela original. Texto da API entra sempre escapado.
 * Carregado junto do script das categorias (DASHBOARD_SCRIPTS).
 */
(function () {
  'use strict';
  if (window.__p12Relatorios) return;

  // ---- calculo (sem tela; testado em test/domain/relatoriosDoPainel.test.ts) ---------

  var PERIODOS = { hoje: 'Hoje', '7d': '7 dias', '30d': '30 dias', mes: 'Este mês', mespassado: 'Mês passado', custom: 'Personalizado' };
  var VISOES = {
    geral: 'Visão geral',
    funil: 'Funil',
    origem: 'Origem dos leads',
    atendimento: 'Atendimento',
    etiquetas: 'Etiquetas',
    caixas: 'Caixas de entrada',
    atendentes: 'Atendentes',
    time: 'Times',
  };
  var MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  var DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  var PADRAO = { periodo: '30d', de: '', ate: '', funil: '', caixa: '', atendente: '', etiqueta: '', time: '', comparar: true, visao: 'geral' };

  function num(v) {
    var x = Number(v);
    return isFinite(x) ? x : 0;
  }

  function dois(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  function isoLocal(d) {
    return d.getFullYear() + '-' + dois(d.getMonth() + 1) + '-' + dois(d.getDate());
  }

  function lerIso(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }

  function rotuloDia(iso) {
    var d = lerIso(iso);
    return d ? d.getDate() + ' ' + MESES[d.getMonth()] : String(iso || '');
  }

  function rotuloDiaLongo(iso) {
    var d = lerIso(iso);
    return d ? DIAS[d.getDay()] + ', ' + d.getDate() + ' ' + MESES[d.getMonth()] : String(iso || '');
  }

  /** Limites do periodo escolhido, em segundos, no fuso do navegador. */
  function periodoDe(chave, agora, de, ate) {
    var hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
    var dia = function (n) {
      return new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + n);
    };
    var ini = hoje;
    var fim = hoje;
    if (chave === '7d') ini = dia(-6);
    else if (chave === '30d') ini = dia(-29);
    else if (chave === 'mes') ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    else if (chave === 'mespassado') {
      ini = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
      fim = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
    } else if (chave === 'custom') {
      var a = lerIso(de);
      var b = lerIso(ate);
      if (a && b && a <= b) {
        ini = a;
        fim = b;
      } else return periodoDe('30d', agora);
    } else if (chave !== 'hoje') return periodoDe('30d', agora);
    var since = Math.floor(ini.getTime() / 1000);
    var until = Math.floor(new Date(fim.getFullYear(), fim.getMonth(), fim.getDate() + 1).getTime() / 1000) - 1;
    var dias = Math.round((until + 1 - since) / 86400);
    var rotulo = chave === 'hoje' ? 'hoje' : rotuloDia(isoLocal(ini)) + ' a ' + rotuloDia(isoLocal(fim));
    return { chave: PERIODOS[chave] ? chave : '30d', since: since, until: until, dias: dias, rotulo: rotulo, de: isoLocal(ini), ate: isoLocal(fim) };
  }

  /** O periodo de mesmo tamanho logo antes. */
  function periodoAnterior(p) {
    var tam = p.until - p.since + 1;
    return { since: p.since - tam, until: p.since - 1, dias: p.dias };
  }

  function filtrosDaUrl(search, salvo) {
    var p = {};
    String(search || '')
      .replace(/^\?/, '')
      .split('&')
      .forEach(function (kv) {
        if (!kv) return;
        var i = kv.indexOf('=');
        var k = i < 0 ? kv : kv.slice(0, i);
        try {
          p[k] = decodeURIComponent((i < 0 ? '' : kv.slice(i + 1)).replace(/\+/g, ' '));
        } catch (e) {
          p[k] = '';
        }
      });
    var f = {};
    Object.keys(PADRAO).forEach(function (k) {
      f[k] = PADRAO[k];
    });
    // O que o navegador lembrou vale so' quando o endereco nao diz nada.
    salvo = salvo || {};
    ['periodo', 'de', 'ate', 'funil', 'visao'].forEach(function (k) {
      if (typeof salvo[k] === 'string' && salvo[k]) f[k] = salvo[k];
    });
    if (typeof salvo.comparar === 'boolean') f.comparar = salvo.comparar;
    ['periodo', 'de', 'ate', 'funil', 'caixa', 'atendente', 'etiqueta', 'time', 'visao'].forEach(function (k) {
      if (p[k] != null) f[k] = p[k];
    });
    if (p.comparar != null) f.comparar = p.comparar !== '0';
    if (!PERIODOS[f.periodo]) f.periodo = PADRAO.periodo;
    if (!VISOES[f.visao]) f.visao = PADRAO.visao;
    if (f.periodo === 'custom' && !(lerIso(f.de) && lerIso(f.ate))) f.periodo = PADRAO.periodo;
    f.funil = /^\d+$/.test(f.funil) ? f.funil : '';
    // O Chatwoot so' filtra uma dimensao por vez.
    var achou = false;
    ['atendente', 'caixa', 'etiqueta', 'time'].forEach(function (k) {
      f[k] = /^\d+$/.test(f[k]) ? f[k] : '';
      if (f[k] && achou) f[k] = '';
      if (f[k]) achou = true;
    });
    return f;
  }

  function filtrosParaUrl(f) {
    var q = [];
    var put = function (k, v) {
      q.push(k + '=' + encodeURIComponent(v));
    };
    if (f.periodo !== PADRAO.periodo) put('periodo', f.periodo);
    if (f.periodo === 'custom') {
      put('de', f.de);
      put('ate', f.ate);
    }
    ['funil', 'caixa', 'atendente', 'etiqueta', 'time'].forEach(function (k) {
      if (f[k]) put(k, f[k]);
    });
    if (!f.comparar) put('comparar', '0');
    if (f.visao !== PADRAO.visao) put('visao', f.visao);
    return q.length ? '?' + q.join('&') : '';
  }

  /** O pedido de relatorio do Chatwoot (type + id) para o filtro de dimensao ativo. */
  function dimensaoDe(f) {
    if (f.atendente) return { type: 'agent', id: f.atendente };
    if (f.caixa) return { type: 'inbox', id: f.caixa };
    if (f.etiqueta) return { type: 'label', id: f.etiqueta };
    if (f.time) return { type: 'team', id: f.time };
    return { type: 'account', id: null };
  }

  /** Serie do Chatwoot em dias locais: [{ dia: 'YYYY-MM-DD', v }]. */
  function serieDiaria(pontos, tz) {
    return (pontos || [])
      .map(function (p) {
        return { dia: new Date((num(p.timestamp) + tz * 3600) * 1000).toISOString().slice(0, 10), v: num(p.value) };
      })
      .sort(function (a, b) {
        return a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0;
      });
  }

  /** Dias do periodo, preenchendo com zero o que a fonte nao trouxe. */
  function diasDoPeriodo(p) {
    var lista = [];
    var d = lerIso(p.de);
    var fim = lerIso(p.ate);
    if (!d || !fim) return lista;
    for (var i = 0; d <= fim && i < 800; i++) {
      lista.push(isoLocal(d));
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    }
    return lista;
  }

  /** Alinha uma serie [{dia,v}] aos dias dados. */
  function alinhar(serie, dias) {
    var mapa = {};
    (serie || []).forEach(function (s) {
      mapa[s.dia] = s.v;
    });
    return dias.map(function (d) {
      return mapa[d] != null ? mapa[d] : 0;
    });
  }

  /** Hora a hora vira uma grade de dia da semana por hora (segunda a domingo). */
  function mapaDeCalor(pontos, tz) {
    var grade = [];
    for (var i = 0; i < 7; i++) grade.push(new Array(24).fill(0));
    var total = 0;
    (pontos || []).forEach(function (p) {
      var d = new Date((num(p.timestamp) + tz * 3600) * 1000);
      grade[d.getUTCDay()][d.getUTCHours()] += num(p.value);
      total += num(p.value);
    });
    var ordem = [1, 2, 3, 4, 5, 6, 0];
    var linhas = ordem.map(function (dow) {
      return { dia: DIAS[dow], horas: grade[dow] };
    });
    var max = 0;
    var melhor = null;
    var porHora = new Array(24).fill(0);
    linhas.forEach(function (l) {
      l.horas.forEach(function (v, h) {
        porHora[h] += v;
        if (v > max) {
          max = v;
          melhor = { dia: l.dia, hora: h, v: v };
        }
      });
    });
    var horaForte = 0;
    porHora.forEach(function (v, h) {
      if (v > porHora[horaForte]) horaForte = h;
    });
    return { linhas: linhas, max: max, total: total, melhor: melhor, horaForte: total ? horaForte : null };
  }

  /** Teto "redondo" para o eixo e o passo das linhas de grade. */
  function escalaDe(max) {
    if (!(max > 0)) return { max: 4, passo: 1 };
    var alvo = max / 4;
    var pot = Math.pow(10, Math.floor(Math.log(alvo) / Math.LN10));
    var passo = pot;
    [1, 2, 2.5, 5, 10].some(function (m) {
      passo = m * pot;
      return passo >= alvo;
    });
    return { max: Math.ceil(max / passo) * passo, passo: passo };
  }

  function n(v) {
    return v == null ? '–' : Math.round(v).toLocaleString('pt-BR');
  }

  function pct(v) {
    if (v == null || !isFinite(v)) return '–';
    var p = v * 100;
    if (p > 0 && p < 10) return p.toFixed(1).replace('.', ',').replace(/,0$/, '') + '%';
    return Math.round(p) + '%';
  }

  function dur(s) {
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

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** Quanto mudou contra antes. `menosEBom`: tempo de resposta, onde cair e' melhorar. */
  function variacao(atual, antes, menosEBom) {
    if (antes == null || atual == null) return null;
    var v;
    if (!antes) v = atual > 0 ? { texto: 'novo', sinal: 1 } : null;
    else {
      var d = (atual - antes) / antes;
      if (Math.abs(d) < 0.005) v = { texto: 'igual', sinal: 0 };
      else v = { texto: (d > 0 ? '+' : '−') + pct(Math.abs(d)), sinal: d > 0 ? 1 : -1 };
    }
    if (v) v.bom = v.sinal === 0 ? null : menosEBom ? v.sinal < 0 : v.sinal > 0;
    return v;
  }

  /** Os numeros-chave. `c` = { resumo, temCrm, leads, leadsAnt, funil, funilAnt, comparar, series }. */
  function kpis(c) {
    var r = (c.resumo && c.resumo.atual) || null;
    var a = c.comparar && c.resumo ? c.resumo.anterior : null;
    var lista = [];
    var chip = function (x, y, inv) {
      return c.comparar ? variacao(x, y, inv) : null;
    };
    if (c.temCrm && c.leads) {
      lista.push({
        id: 'leads', rotulo: 'Leads novos', valor: n(c.leads.total),
        apoio: c.comparar && c.leadsAnt ? 'antes: ' + n(c.leadsAnt.total) : 'chegaram pelo CRM',
        var: chip(c.leads.total, c.leadsAnt ? c.leadsAnt.total : null),
        dica: 'Leads registrados pelo CRM no período, com anúncio ou direto no WhatsApp', serie: c.series && c.series.leads,
      });
    }
    if (r) {
      lista.push({
        id: 'conversas', rotulo: 'Conversas novas', valor: n(r.conversations_count),
        apoio: c.temCrm ? 'no Chatwoot' : 'sem CRM ligado: use como leads',
        var: chip(num(r.conversations_count), a ? num(a.conversations_count) : null),
        dica: 'Conversas abertas no período', serie: c.series && c.series.conversas,
      });
      lista.push({
        id: 'recebidas', rotulo: 'Mensagens recebidas', valor: n(r.incoming_messages_count), apoio: 'dos clientes',
        var: chip(num(r.incoming_messages_count), a ? num(a.incoming_messages_count) : null), serie: c.series && c.series.recebidas,
      });
      lista.push({
        id: 'enviadas', rotulo: 'Mensagens enviadas', valor: n(r.outgoing_messages_count), apoio: 'pela equipe e automações',
        var: chip(num(r.outgoing_messages_count), a ? num(a.outgoing_messages_count) : null), serie: c.series && c.series.enviadas,
      });
      lista.push({
        id: 'resposta', rotulo: 'Primeira resposta', valor: r.avg_first_response_time != null ? dur(r.avg_first_response_time) : '–',
        apoio: 'média; conta noite e fim de semana',
        var: chip(r.avg_first_response_time != null ? num(r.avg_first_response_time) : null, a && a.avg_first_response_time != null ? num(a.avg_first_response_time) : null, true),
        dica: 'Tempo médio até a primeira resposta da equipe. Inclui horas fora do expediente.',
      });
    }
    var m = c.funil;
    if (m && m.etapas && m.etapas.length) {
      var ma = c.comparar ? c.funilAnt : null;
      var pontos = ma && ma.convGeral != null && m.convGeral != null ? (m.convGeral - ma.convGeral) * 100 : null;
      var v = null;
      if (pontos != null && Math.abs(pontos) >= 0.05) {
        v = { texto: (pontos > 0 ? '+' : '−') + Math.abs(pontos).toFixed(1).replace('.', ',') + ' p.p.', sinal: pontos > 0 ? 1 : -1, bom: pontos > 0 };
      }
      lista.push({
        id: 'conversao', rotulo: 'Do topo ao fim do funil', valor: pct(m.convGeral), apoio: m.ultima ? n(m.fundo) + ' em ' + m.ultima.nome : '',
        var: v, dica: 'De cada 100 leads que entraram no funil, quantos chegaram na última etapa',
      });
      lista.push({
        id: 'andamento', rotulo: 'Cards em andamento', valor: n(m.emAndamento),
        apoio: m.foraDoFunil ? n(m.foraDoFunil) + ' fora do funil' : 'nas etapas do funil',
        var: null, dica: 'Cards que estão agora nas etapas do funil, sem ganho nem saída',
      });
    }
    return lista;
  }

  /**
   * O que pede acao agora. `c` = { conta, quadro, agora:{unattended,open,unassigned}, esperaMaisAntiga,
   * funil (modelo), caixas:[{nome,conversas}], atendentes:{todosSemAtividade, abertas} }.
   */
  function alertas(c) {
    var lista = [];
    var conta = '/app/accounts/' + c.conta;
    var ag = c.agora;
    if (ag && ag.unattended > 0) {
      lista.push({
        id: 'semresposta', nivel: c.esperaMaisAntiga != null && c.esperaMaisAntiga > 86400 ? 'alto' : ag.unattended >= 20 ? 'alto' : 'medio',
        titulo: n(ag.unattended) + (ag.unattended === 1 ? ' conversa sem resposta' : ' conversas sem resposta'),
        detalhe: c.esperaMaisAntiga != null ? 'A mais antiga espera há ' + dur(c.esperaMaisAntiga) : 'Ninguém da equipe respondeu ainda',
        href: conta + '/unattended/conversations',
      });
    }
    var m = c.funil;
    if (m && m.etapas && m.etapas.length) {
      var primeira = m.etapas[0];
      if (primeira.agora > 0 && m.etapas.length > 1) {
        lista.push({
          id: 'novos', nivel: 'medio', titulo: n(primeira.agora) + (primeira.agora === 1 ? ' lead ainda em ' : ' leads ainda em ') + primeira.nome,
          detalhe: primeira.tempoMedio != null ? 'Ficam em média ' + dur(primeira.tempoMedio) + ' antes de avançar' : 'Ainda não passaram para a próxima etapa',
          href: conta + '/kanban/' + (c.quadro || ''),
        });
      }
      var parada = null;
      m.etapas.forEach(function (e) {
        if (e.tipo === 'ganho' || e.agora < 1 || e.idadeMedia == null) return;
        if (!parada || e.idadeMedia > parada.idadeMedia) parada = e;
      });
      if (parada && parada.idadeMedia > 7 * 86400) {
        lista.push({
          id: 'parados', nivel: parada.idadeMedia > 30 * 86400 ? 'alto' : 'medio',
          titulo: n(parada.agora) + (parada.agora === 1 ? ' card parado em ' : ' cards parados em ') + parada.nome,
          detalhe: 'Há ' + dur(parada.idadeMedia) + ' em média' + (parada.idadeMaxima ? '; o mais antigo, há ' + dur(parada.idadeMaxima) : ''),
          href: conta + '/kanban/' + (c.quadro || ''),
        });
      }
      if (m.gargalo) {
        lista.push({
          id: 'gargalo', nivel: 'medio', titulo: 'Maior perda: ' + m.gargalo.de + ' → ' + m.gargalo.para,
          detalhe: n(m.gargalo.perda) + ' leads não avançaram (' + pct(1 - m.gargalo.taxa) + ')', visao: 'funil',
        });
      }
    }
    (c.caixas || []).forEach(function (cx) {
      if (cx.conversas === 0) {
        lista.push({ id: 'caixa' + cx.nome, nivel: 'info', titulo: 'Caixa "' + cx.nome + '" sem conversas', detalhe: 'Nenhuma conversa nova no período escolhido', visao: 'caixas' });
      }
    });
    if (c.atendentes && c.atendentes.todosSemAtividade && c.atendentes.abertas > 0) {
      lista.push({
        id: 'sematendente', nivel: 'info', titulo: 'Ninguém atribui conversas nesta conta',
        detalhe: n(c.atendentes.abertas) + ' abertas, nenhuma com atendente', visao: 'atendentes',
      });
    }
    var peso = { alto: 0, medio: 1, info: 2 };
    return lista.sort(function (a, b) {
      return peso[a.nivel] - peso[b.nivel];
    });
  }

  /** Ordena linhas por coluna; vazio vai sempre para o fim. */
  function ordenar(linhas, chave, dir) {
    var f = dir === 'asc' ? 1 : -1;
    return linhas.slice().sort(function (a, b) {
      var x = a[chave];
      var y = b[chave];
      if (x == null || x === '') return y == null || y === '' ? 0 : 1;
      if (y == null || y === '') return -1;
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * f;
      return String(x).localeCompare(String(y), 'pt-BR') * f;
    });
  }

  /** Tira a coluna de numero que esta zerada ou vazia em todas as linhas (nada de bloco morto). */
  function colunasUteis(cols, linhas) {
    return cols.filter(function (c) {
      if (c.t === 't' || c.fixa) return true;
      return linhas.some(function (l) {
        return l[c.k] != null && l[c.k] !== 0;
      });
    });
  }

  function textoDaCelula(col, v) {
    if (v == null || v === '') return '';
    if (col.t === 'n') return n(v);
    if (col.t === 'dur') return dur(v);
    if (col.t === 'pct') return pct(v);
    return String(v);
  }

  function csvDe(cols, linhas) {
    var celula = function (c) {
      c = String(c == null ? '' : c).replace(/ /g, ' ');
      return /[";\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
    };
    var cab = cols.map(function (c) {
      return celula(c.r);
    });
    return [cab.join(';')]
      .concat(
        linhas.map(function (l) {
          return cols
            .map(function (c) {
              return celula(textoDaCelula(c, l[c.k]));
            })
            .join(';');
        }),
      )
      .join('\r\n');
  }

  function nomeDoStatus(s) {
    return s === 'online' ? 'Online' : s === 'busy' ? 'Ocupado' : 'Offline';
  }

  function linhasDeAgentes(agentes, resumo) {
    var por = {};
    (resumo || []).forEach(function (r) {
      por[r.id] = r;
    });
    return (agentes || []).map(function (a) {
      var r = por[a.id] || {};
      return {
        id: a.id, nome: a.name || a.available_name || 'Atendente ' + a.id, status: nomeDoStatus(a.availability_status),
        papel: a.role === 'administrator' ? 'Administrador' : 'Atendente',
        conversas: num(r.conversations_count), atendidas: num(r.handled_conversations_count), resolvidas: num(r.resolved_conversations_count),
        primeira: r.avg_first_response_time != null && r.avg_first_response_time !== 0 ? num(r.avg_first_response_time) : null,
        resposta: r.avg_reply_time != null && r.avg_reply_time !== 0 ? num(r.avg_reply_time) : null,
      };
    });
  }

  function linhasPorNome(lista, resumo) {
    var nomes = {};
    (lista || []).forEach(function (x) {
      nomes[x.id] = x;
    });
    return (resumo || []).map(function (r) {
      var x = nomes[r.id] || {};
      return {
        id: r.id, nome: r.name || x.name || '#' + r.id,
        conversas: num(r.conversations_count), atendidas: num(r.handled_conversations_count), resolvidas: num(r.resolved_conversations_count),
        primeira: r.avg_first_response_time ? num(r.avg_first_response_time) : null,
        resposta: r.avg_reply_time ? num(r.avg_reply_time) : null,
      };
    });
  }

  window.__p12Relatorios = {
    PERIODOS: PERIODOS,
    VISOES: VISOES,
    periodoDe: periodoDe,
    periodoAnterior: periodoAnterior,
    filtrosDaUrl: filtrosDaUrl,
    filtrosParaUrl: filtrosParaUrl,
    dimensaoDe: dimensaoDe,
    serieDiaria: serieDiaria,
    diasDoPeriodo: diasDoPeriodo,
    alinhar: alinhar,
    mapaDeCalor: mapaDeCalor,
    escalaDe: escalaDe,
    variacao: variacao,
    kpis: kpis,
    alertas: alertas,
    ordenar: ordenar,
    colunasUteis: colunasUteis,
    csvDe: csvDe,
    linhasDeAgentes: linhasDeAgentes,
    linhasPorNome: linhasPorNome,
    dur: dur,
    pct: pct,
    n: n,
  };
  // ---- desenho (devolve HTML) --------------------------------------------------------

  var COR = {
    principal: 'rgb(var(--blue-9,110 86 207))',
    anterior: 'rgb(var(--slate-8,82 87 96))',
    google: 'rgb(var(--blue-9,110 86 207))',
    meta: 'rgb(var(--teal-9,18 165 148))',
    direto: 'rgb(var(--slate-9,105 110 119))',
    enviadas: 'rgb(var(--teal-9,18 165 148))',
  };

  function chip(v) {
    if (!v) return '';
    var classe = v.bom == null ? 'p12r-igual' : v.bom ? 'p12r-bom' : 'p12r-ruim';
    return '<span class="p12r-chip ' + classe + '">' + esc(v.texto) + '</span>';
  }

  function htmlSpark(valores, cor) {
    if (!valores || valores.length < 2) return '';
    var max = Math.max.apply(null, valores.concat([1]));
    var pts = valores
      .map(function (v, i) {
        return ((i / (valores.length - 1)) * 100).toFixed(2) + ',' + (92 - (v / max) * 84).toFixed(2);
      })
      .join(' ');
    return (
      '<svg class="p12r-spark" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points="' + pts +
      '" fill="none" stroke="' + cor + '" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>'
    );
  }

  function htmlKpis(lista) {
    return (
      '<div class="p12r-kpis">' +
      lista
        .map(function (k) {
          return (
            '<div class="p12r-kpi"' + (k.dica ? ' title="' + esc(k.dica) + '"' : '') + '>' +
            '<span class="p12r-kpi-r">' + esc(k.rotulo) + '</span>' +
            '<span class="p12r-kpi-v">' + esc(k.valor) + chip(k.var) + '</span>' +
            '<span class="p12r-kpi-a">' + esc(k.apoio || '') + '</span>' +
            htmlSpark(k.serie, COR.principal) + '</div>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function htmlAlertas(lista, carregando) {
    if (!lista.length) {
      return carregando
        ? '<div class="p12r-nada">Conferindo o que pede ação…</div>'
        : '<div class="p12r-nada p12r-ok">Nada pedindo ação agora. Conversas respondidas e funil andando.</div>';
    }
    return (
      '<div class="p12r-alertas">' +
      lista
        .map(function (a) {
          var alvo = a.href ? 'href="' + esc(a.href) + '" data-acao="ir" data-href="' + esc(a.href) + '"' : 'href="#" data-acao="visao" data-v="' + esc(a.visao) + '"';
          return (
            '<a class="p12r-alerta p12r-n-' + a.nivel + '" ' + alvo + '><span class="p12r-alerta-t">' + esc(a.titulo) +
            '</span><span class="p12r-alerta-d">' + esc(a.detalhe) + '</span><span class="p12r-alerta-s" aria-hidden="true">›</span></a>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function htmlVazio(titulo, texto, acao) {
    return (
      '<div class="p12r-vazio"><b>' + esc(titulo) + '</b><span>' + esc(texto) + '</span>' + (acao || '') + '</div>'
    );
  }

  /** Cartao com titulo, descricao e (opcional) controles no canto. */
  function cartao(titulo, desc, corpo, controles, classe) {
    return (
      '<section class="p12r-cartao ' + (classe || '') + '"><header><div><h3>' + esc(titulo) + '</h3>' +
      (desc ? '<p>' + esc(desc) + '</p>' : '') + '</div>' + (controles || '') + '</header>' + corpo + '</section>'
    );
  }

  function seg(acao, opcoes, atual, extra) {
    return (
      '<div class="p12r-seg">' +
      Object.keys(opcoes)
        .map(function (k) {
          return '<button type="button" data-acao="' + acao + '" data-v="' + esc(k) + '"' + (extra || '') + (k === atual ? ' class="p12r-on"' : '') + '>' + esc(opcoes[k]) + '</button>';
        })
        .join('') +
      '</div>'
    );
  }

  /** Eixo, grade e rotulos de um grafico; `dentro` = o que vai por cima da area do desenho. */
  function esqueleto(rotulos, esc2, svg, hits, fmt) {
    var n2 = rotulos.length;
    var yl = [];
    var grade = [];
    for (var v = 0; v <= esc2.max + 1e-9; v += esc2.passo) {
      var b = (v / esc2.max) * 100;
      yl.push('<span style="bottom:' + b.toFixed(2) + '%">' + esc((fmt || n)(v)) + '</span>');
      grade.push('<line x1="0" x2="100" y1="' + (100 - b).toFixed(2) + '" y2="' + (100 - b).toFixed(2) + '" class="p12r-grade" vector-effect="non-scaling-stroke"/>');
    }
    var passo = Math.max(1, Math.ceil(n2 / 8));
    var xl = [];
    for (var i = 0; i < n2; i += passo) {
      var x = n2 === 1 ? 50 : ((i + 0.5) / n2) * 100;
      xl.push('<span style="left:' + x.toFixed(2) + '%">' + esc(rotuloDia(rotulos[i])) + '</span>');
    }
    return (
      '<div class="p12r-g"><div class="p12r-g-y">' + yl.join('') + '</div><div class="p12r-g-area">' +
      '<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' + grade.join('') + svg + '</svg>' +
      '<div class="p12r-g-hit">' + hits + '</div></div><div class="p12r-g-x">' + xl.join('') + '</div></div>'
    );
  }

  /** Linhas por dia. series = [{ nome, cor, valores, tracejado, area }]. */
  function htmlLinhas(rotulos, series, opts) {
    opts = opts || {};
    var n2 = rotulos.length;
    if (!n2) return '';
    var max = 0;
    series.forEach(function (s) {
      s.valores.forEach(function (v) {
        max = Math.max(max, num(v));
      });
    });
    var e = escalaDe(max);
    var X = function (i) {
      return n2 === 1 ? 50 : ((i + 0.5) / n2) * 100;
    };
    var Y = function (v) {
      return 100 - (num(v) / e.max) * 100;
    };
    var svg = '';
    series.forEach(function (s) {
      var d = s.valores
        .map(function (v, i) {
          return (i ? 'L' : 'M') + X(i).toFixed(2) + ' ' + Y(v).toFixed(2);
        })
        .join('');
      if (s.area) svg += '<path d="' + d + 'L' + X(n2 - 1).toFixed(2) + ' 100L' + X(0).toFixed(2) + ' 100Z" fill="' + s.cor + '" opacity=".13"/>';
      svg += '<path d="' + d + '" fill="none" stroke="' + s.cor + '" stroke-width="' + (s.tracejado ? 1.3 : 2) + '"' + (s.tracejado ? ' stroke-dasharray="4 4"' : '') +
        ' vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>';
    });
    var hits = rotulos
      .map(function (r, i) {
        var texto = rotuloDiaLongo(r) + '\n' + series
          .map(function (s) {
            return s.nome + ': ' + (opts.fmt || n)(s.valores[i]);
          })
          .join('\n');
        return (
          '<i data-t="' + esc(texto) + '">' +
          series.map(function (s) {
            return '<b style="bottom:' + (100 - Y(s.valores[i])).toFixed(2) + '%;background:' + s.cor + '"></b>';
          }).join('') + '</i>'
        );
      })
      .join('');
    return esqueleto(rotulos, e, svg, hits, opts.fmt);
  }

  /** Barras empilhadas por dia. camadas = [{ nome, cor, valores }]. */
  function htmlEmpilhadas(rotulos, camadas) {
    var n2 = rotulos.length;
    if (!n2) return '';
    var totais = rotulos.map(function (r, i) {
      return camadas.reduce(function (s, c) {
        return s + num(c.valores[i]);
      }, 0);
    });
    var e = escalaDe(Math.max.apply(null, totais.concat([0])));
    var larg = (100 / n2) * 0.68;
    var svg = '';
    rotulos.forEach(function (r, i) {
      var base = 100;
      var x = ((i + 0.5) / n2) * 100 - larg / 2;
      camadas.forEach(function (c) {
        var h = (num(c.valores[i]) / e.max) * 100;
        if (h <= 0) return;
        base -= h;
        svg += '<rect x="' + x.toFixed(2) + '" y="' + base.toFixed(2) + '" width="' + larg.toFixed(2) + '" height="' + h.toFixed(2) + '" fill="' + c.cor + '"/>';
      });
    });
    var hits = rotulos
      .map(function (r, i) {
        var texto = rotuloDiaLongo(r) + '\n' + camadas
          .filter(function (c) {
            return num(c.valores[i]) > 0;
          })
          .map(function (c) {
            return c.nome + ': ' + n(c.valores[i]);
          })
          .concat(['Total: ' + n(totais[i])])
          .join('\n');
        return '<i data-t="' + esc(texto) + '"></i>';
      })
      .join('');
    return esqueleto(rotulos, e, svg, hits);
  }

  function legenda(itens) {
    return (
      '<div class="p12r-leg">' +
      itens
        .map(function (i) {
          return '<span><i style="background:' + i.cor + '"' + (i.tracejado ? ' class="p12r-trac"' : '') + '></i>' + esc(i.nome) + '</span>';
        })
        .join('') +
      '</div>'
    );
  }

  function htmlCalor(m, rotuloMetrica) {
    var cab = '<span></span>';
    for (var h = 0; h < 24; h++) cab += '<span class="p12r-c-h">' + (h % 3 === 0 ? h : '') + '</span>';
    var corpo = m.linhas
      .map(function (l) {
        return (
          '<span class="p12r-c-d">' + esc(l.dia) + '</span>' +
          l.horas
            .map(function (v, h) {
              var t = m.max ? v / m.max : 0;
              var fundo = v > 0 ? 'rgb(var(--blue-9,110 86 207) / ' + (0.1 + t * 0.9).toFixed(2) + ')' : 'rgb(var(--slate-3,33 34 37))';
              return '<i style="background:' + fundo + '" data-t="' + esc(l.dia + ', ' + h + ' h\n' + n(v) + ' ' + rotuloMetrica) + '"></i>';
            })
            .join('')
        );
      })
      .join('');
    return '<div class="p12r-calor">' + cab + corpo + '</div>';
  }

  function htmlRanking(itens, fmt, cor) {
    var max = Math.max.apply(null, itens.map(function (i) { return i.valor; }).concat([1]));
    return (
      '<div class="p12r-rank">' +
      itens
        .map(function (i) {
          return (
            '<div class="p12r-rk"><span class="p12r-rk-n" title="' + esc(i.nome) + '">' + esc(i.nome) + '</span>' +
            '<span class="p12r-rk-b"><i style="width:' + Math.max(1.5, (i.valor / max) * 100).toFixed(2) + '%;background:' + (i.cor || cor || COR.principal) + '"></i></span>' +
            '<span class="p12r-rk-v">' + esc((fmt || n)(i.valor)) + '</span>' + (i.sub ? '<span class="p12r-rk-s">' + esc(i.sub) + '</span>' : '') + '</div>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function htmlTabelaOrdenavel(id, cols, linhas, ordem) {
    var seta = function (k) {
      return ordem && ordem.k === k ? (ordem.dir === 'asc' ? ' ▲' : ' ▼') : '';
    };
    var lista = ordem ? ordenar(linhas, ordem.k, ordem.dir) : linhas;
    return (
      '<div class="p12r-rolagem"><table class="p12r-tab"><thead><tr>' +
      cols
        .map(function (c) {
          return '<th class="' + (c.t === 't' ? 'p12r-esq' : '') + '"><button type="button" data-acao="ordem" data-id="' + id + '" data-k="' + c.k + '">' + esc(c.r) + seta(c.k) + '</button></th>';
        })
        .join('') +
      '</tr></thead><tbody>' +
      lista
        .map(function (l) {
          return (
            '<tr>' +
            cols
              .map(function (c, i) {
                var t = textoDaCelula(c, l[c.k]);
                var tag = i === 0 && c.t === 't' ? 'th' : 'td';
                return '<' + tag + ' class="' + (c.t === 't' ? 'p12r-esq' : '') + '">' + (t === '' ? '<span class="p12r-mudo">–</span>' : esc(t)) + '</' + tag + '>';
              })
              .join('') +
            '</tr>'
          );
        })
        .join('') +
      '</tbody></table></div>'
    );
  }

  /** Funil enxuto para a visao geral: uma barra por etapa. */
  function htmlFunilCompacto(m) {
    if (!m || !m.etapas.length) return '';
    var max = Math.max.apply(null, m.etapas.map(function (e) { return e.alcance; }).concat([1]));
    return (
      '<div class="p12r-fc">' +
      m.etapas
        .map(function (e, k) {
          var prox = m.etapas[k + 1];
          return (
            '<div class="p12r-fc-l"><span class="p12r-fc-n"><i style="background:' + esc(e.cor) + '"></i>' + esc(e.nome) + '</span>' +
            '<span class="p12r-fc-b"><i style="width:' + Math.max(1.5, (e.alcance / max) * 100).toFixed(2) + '%;background:' + esc(e.cor) + '"></i></span>' +
            '<span class="p12r-fc-v">' + n(e.alcance) + '</span></div>' +
            (prox && e.alcance ? '<div class="p12r-fc-p">↓ ' + pct(e.convProxima) + ' avançam</div>' : '')
          );
        })
        .join('') +
      '</div>'
    );
  }

  window.__p12Relatorios.html = {
    kpis: htmlKpis,
    alertas: htmlAlertas,
    linhas: htmlLinhas,
    empilhadas: htmlEmpilhadas,
    calor: htmlCalor,
    ranking: htmlRanking,
    tabela: htmlTabelaOrdenavel,
    funilCompacto: htmlFunilCompacto,
  };

  if (typeof document === 'undefined' || !document.documentElement) return;

  // ---- tela --------------------------------------------------------------------------

  var CSS = [
    '[data-p12-rel-nativo="oculto"]{display:none!important}',
    // O menu: Relatorios e' um item so'; as dez sub-abas ficam para o rodape da pagina nova.
    'li:has(> a[name="Reports"]) > ul{display:none!important}',
    'li:has(> a[name="Reports"]) > a [class*="i-lucide-chevron"]{display:none!important}',
    '.p12r{--p12r-bg:transparent;width:100%;box-sizing:border-box;padding:8px 8px 56px;color:rgb(var(--slate-12,237 238 240));font-size:13px;line-height:1.4;font-variant-numeric:tabular-nums}',
    '.p12r *{box-sizing:border-box}',
    '.p12r h1,.p12r h2,.p12r h3,.p12r p{margin:0}',
    '.p12r button{font:inherit}',
    '@media (max-width:640px){.p12r{padding-inline:0}}',
    '@media (max-width:760px){.p12r-filtros{position:static}.p12r-sel{max-width:none;flex:1 1 150px}.p12r-topo h1{font-size:22px}.p12r-kpi-v{font-size:24px}}',
    '.p12r-topo{padding-top:24px;display:flex;flex-direction:column;gap:2px}',
    '.p12r-topo h1{font-size:26px;line-height:1.2;font-weight:600;letter-spacing:-.02em}',
    '.p12r-topo p{color:rgb(var(--slate-11,176 180 186));font-size:14px}',
    // filtros fixos
    '.p12r-filtros{position:sticky;top:0;z-index:20;margin:16px 0 0;padding:12px 0;background:var(--p12r-bg);border-bottom:1px solid rgb(var(--slate-4,40 42 48))}',
    '.p12r-fl{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px}',
    '.p12r-seg{display:inline-flex;max-width:100%;overflow-x:auto;height:34px;padding:2px;border-radius:9px;background:rgb(var(--solid-1,23 23 26));border:1px solid rgb(var(--slate-4,40 42 48));scrollbar-width:none}',
    '.p12r-seg button{flex:none;border:0;background:none;padding:0 12px;border-radius:7px;color:rgb(var(--slate-11,176 180 186));cursor:pointer;white-space:nowrap}',
    '.p12r-seg button:hover{color:rgb(var(--slate-12,237 238 240))}',
    '.p12r-seg button.p12r-on{background:rgb(var(--solid-active,53 57 66));color:rgb(var(--slate-12,237 238 240));font-weight:500;box-shadow:0 1px 2px rgba(0,0,0,.18)}',
    '.p12r-sel{height:34px;max-width:200px;padding:0 28px 0 10px;border-radius:9px;border:1px solid rgb(var(--slate-4,40 42 48));background-color:rgb(var(--solid-1,23 23 26));color:rgb(var(--slate-12,237 238 240));cursor:pointer}',
    '.p12r-sel.p12r-ativo{border-color:rgb(var(--blue-9,110 86 207));box-shadow:inset 0 0 0 1px rgb(var(--blue-9,110 86 207) / .5)}',
    '.p12r-data{height:34px;padding:0 8px;border-radius:9px;border:1px solid rgb(var(--slate-4,40 42 48));background:rgb(var(--solid-1,23 23 26));color:rgb(var(--slate-12,237 238 240));color-scheme:light dark}',
    '.p12r-interr{display:inline-flex;align-items:center;gap:8px;height:34px;padding:0 4px;border:0;background:none;color:rgb(var(--slate-11,176 180 186));cursor:pointer}',
    '.p12r-interr i{position:relative;width:30px;height:18px;border-radius:999px;background:rgb(var(--slate-6,54 58 63));transition:background .15s}',
    '.p12r-interr i:after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:transform .15s}',
    '.p12r-interr.p12r-on{color:rgb(var(--slate-12,237 238 240))}',
    '.p12r-interr.p12r-on i{background:rgb(var(--blue-9,110 86 207))}',
    '.p12r-interr.p12r-on i:after{transform:translateX(12px)}',
    '.p12r-folga{flex:1 1 0}',
    '.p12r-link{border:0;background:none;padding:0;color:rgb(var(--slate-10,119 123 132));cursor:pointer;text-decoration:underline;text-underline-offset:2px}',
    '.p12r-link:hover{color:rgb(var(--slate-12,237 238 240))}',
    '.p12r-aviso-filtro{margin-top:8px;color:rgb(var(--slate-10,119 123 132));font-size:12px}',
    // secoes
    '.p12r-bloco{margin-top:32px}',
    '.p12r-bloco>h2{font-size:16px;font-weight:600;letter-spacing:-.01em}',
    '.p12r-bloco>p{margin-top:2px;color:rgb(var(--slate-11,176 180 186));font-size:13px}',
    '.p12r-bloco>h2+*,.p12r-bloco>p+*{margin-top:14px}',
    // alertas
    '.p12r-alertas{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px}',
    '.p12r-alerta{position:relative;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 12px;padding:12px 14px 12px 18px;border-radius:10px;border:1px solid rgb(var(--slate-4,40 42 48));background:rgb(var(--solid-1,23 23 26));color:inherit;text-decoration:none;overflow:hidden}',
    '.p12r-alerta:before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:rgb(var(--slate-8,82 87 96))}',
    '.p12r-alerta.p12r-n-alto:before{background:rgb(var(--ruby-9,229 70 102))}',
    '.p12r-alerta.p12r-n-medio:before{background:rgb(var(--amber-9,255 197 61))}',
    '.p12r-alerta:hover{border-color:rgb(var(--slate-7,67 72 78))}',
    '.p12r-alerta-t{font-weight:600;font-size:14px}',
    '.p12r-alerta-d{grid-column:1;color:rgb(var(--slate-11,176 180 186));font-size:12.5px}',
    '.p12r-alerta-s{grid-row:1 / span 2;grid-column:2;align-self:center;color:rgb(var(--slate-10,119 123 132));font-size:20px}',
    '.p12r-nada{padding:14px 16px;border-radius:10px;border:1px dashed rgb(var(--slate-5,46 49 56));color:rgb(var(--slate-11,176 180 186))}',
    '.p12r-nada.p12r-ok{border-style:solid;border-color:rgb(var(--teal-9,18 165 148) / .4);background:rgb(var(--teal-9,18 165 148) / .08)}',
    // numeros-chave
    '.p12r-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}',
    '.p12r-kpi{position:relative;display:flex;flex-direction:column;gap:3px;min-width:0;padding:14px 16px;border-radius:12px;border:1px solid rgb(var(--slate-4,40 42 48));background:rgb(var(--solid-1,23 23 26));overflow:hidden}',
    '.p12r-kpi-r{color:rgb(var(--slate-11,176 180 186));font-size:12.5px}',
    '.p12r-kpi-v{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;font-size:28px;font-weight:600;line-height:1.15;letter-spacing:-.02em}',
    '.p12r-kpi-a{color:rgb(var(--slate-10,119 123 132));font-size:12px;position:relative;z-index:1}',
    '.p12r-spark{position:absolute;right:0;bottom:0;width:38%;height:34px;opacity:.4;pointer-events:none}',
    '.p12r-chip{font-size:12px;font-weight:500;padding:1px 7px;border-radius:999px;letter-spacing:0;white-space:nowrap}',
    '.p12r-bom{color:rgb(var(--teal-9,18 165 148));background:rgb(var(--teal-9,18 165 148) / .15)}',
    '.p12r-ruim{color:rgb(var(--ruby-9,229 70 102));background:rgb(var(--ruby-9,229 70 102) / .15)}',
    '.p12r-igual{color:rgb(var(--slate-11,176 180 186));background:rgb(var(--slate-9,105 110 119) / .16)}',
    // abas de visao
    '.p12r-abas{display:flex;gap:4px;margin-top:36px;border-bottom:1px solid rgb(var(--slate-4,40 42 48));overflow-x:auto;scrollbar-width:none}',
    '.p12r-abas button{flex:none;border:0;background:none;padding:10px 14px;margin-bottom:-1px;border-bottom:2px solid transparent;color:rgb(var(--slate-11,176 180 186));cursor:pointer;white-space:nowrap;font-size:14px}',
    '.p12r-abas button:hover{color:rgb(var(--slate-12,237 238 240))}',
    '.p12r-abas button.p12r-on{border-bottom-color:rgb(var(--blue-9,110 86 207));color:rgb(var(--slate-12,237 238 240));font-weight:600}',
    '.p12r-vista{display:flex;flex-direction:column;gap:20px;margin-top:20px}',
    '.p12r-grid2{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:20px}',
    '.p12r-grid2b{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:20px}',
    '.p12r-grid3{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}',
    '@media (max-width:1000px){.p12r-grid2,.p12r-grid2b{grid-template-columns:minmax(0,1fr)}}',
    '.p12r-cartao{min-width:0;padding:18px 20px;border-radius:12px;border:1px solid rgb(var(--slate-4,40 42 48));background:rgb(var(--solid-1,23 23 26))}',
    '.p12r-cartao>header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:16px;flex-wrap:wrap}',
    '.p12r-cartao h3{font-size:14.5px;font-weight:600}',
    '.p12r-cartao header p{margin-top:2px;color:rgb(var(--slate-11,176 180 186));font-size:12.5px}',
    '.p12r-cartao .p12f{border:0;padding:0;background:none}',
    '.p12r-cartao .p12f-topo{display:none}',
    '.p12r-cartao .p12f-kpi{background:rgb(var(--solid-2,29 30 36))}',
    '.p12r-cartao .p12f-seg,.p12r-cartao .p12f-bot{background:rgb(var(--solid-2,29 30 36))}',
    // graficos
    '.p12r-g{display:grid;grid-template-columns:auto minmax(0,1fr);grid-template-rows:230px 24px;gap:0 10px}',
    '.p12r-g-y{position:relative;min-width:24px;color:rgb(var(--slate-10,119 123 132));font-size:11px}',
    '.p12r-g-y span{position:absolute;right:0;transform:translateY(50%);line-height:1}',
    '.p12r-g-area{position:relative}',
    '.p12r-g-area>svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}',
    '.p12r-grade{stroke:rgb(var(--slate-4,40 42 48));stroke-width:1}',
    '.p12r-g-hit{position:absolute;inset:0;display:flex}',
    '.p12r-g-hit i{position:relative;flex:1;cursor:crosshair}',
    '.p12r-g-hit i:hover{background:rgb(var(--slate-12,237 238 240) / .05)}',
    '.p12r-g-hit i b{display:none;position:absolute;left:50%;width:9px;height:9px;margin:0 0 -4.5px -4.5px;border-radius:50%;border:2px solid rgb(var(--solid-1,23 23 26))}',
    '.p12r-g-hit i:hover b{display:block}',
    '.p12r-g-x{grid-column:2;position:relative;color:rgb(var(--slate-10,119 123 132));font-size:11px}',
    '.p12r-g-x span{position:absolute;top:8px;transform:translateX(-50%);white-space:nowrap}',
    '.p12r-leg{display:flex;flex-wrap:wrap;gap:6px 16px;color:rgb(var(--slate-11,176 180 186));font-size:12px;margin-bottom:10px}',
    '.p12r-leg span{display:inline-flex;align-items:center;gap:6px}',
    '.p12r-leg i{width:12px;height:4px;border-radius:2px}',
    '.p12r-leg i.p12r-trac{background:repeating-linear-gradient(90deg,rgb(var(--slate-8,82 87 96)) 0 4px,transparent 4px 7px)!important}',
    '.p12r-calor{display:grid;grid-template-columns:30px repeat(24,minmax(0,1fr));gap:3px;align-items:center}',
    '.p12r-calor i{aspect-ratio:1;border-radius:3px;min-height:10px}',
    '.p12r-c-h{color:rgb(var(--slate-10,119 123 132));font-size:10.5px;text-align:left}',
    '.p12r-c-d{color:rgb(var(--slate-11,176 180 186));font-size:11.5px}',
    '.p12r-destaque{margin-top:12px;color:rgb(var(--slate-11,176 180 186));font-size:12.5px}',
    '.p12r-destaque b{color:rgb(var(--slate-12,237 238 240));font-weight:600}',
    '.p12r-rank{display:flex;flex-direction:column;gap:9px}',
    '.p12r-rk{display:grid;grid-template-columns:minmax(80px,38%) minmax(0,1fr) auto;align-items:center;gap:4px 12px}',
    '.p12r-rk-n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.p12r-rk-b{height:10px;border-radius:5px;background:rgb(var(--slate-3,33 34 37));overflow:hidden}',
    '.p12r-rk-b i{display:block;height:100%;border-radius:5px;transition:width .3s}',
    '.p12r-rk-v{font-weight:600;min-width:28px;text-align:right}',
    '.p12r-rk-s{grid-column:1 / -1;margin-top:-2px;color:rgb(var(--slate-10,119 123 132));font-size:11.5px}',
    '.p12r-fc{display:flex;flex-direction:column;gap:4px}',
    '.p12r-fc-l{display:grid;grid-template-columns:minmax(80px,38%) minmax(0,1fr) auto;align-items:center;gap:12px}',
    '.p12r-fc-n{display:flex;align-items:center;gap:8px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.p12r-fc-n i{flex:none;width:8px;height:8px;border-radius:50%}',
    '.p12r-fc-b{height:18px;border-radius:4px;background:rgb(var(--slate-3,33 34 37));overflow:hidden}',
    '.p12r-fc-b i{display:block;height:100%;border-radius:4px}',
    '.p12r-fc-v{font-weight:600;min-width:28px;text-align:right}',
    '.p12r-fc-p{margin-left:calc(38% + 12px);color:rgb(var(--slate-10,119 123 132));font-size:11.5px;margin-bottom:2px}',
    '.p12r-rolagem{overflow-x:auto}',
    '.p12r-tab{width:100%;border-collapse:collapse;font-size:13px}',
    '.p12r-tab th,.p12r-tab td{padding:9px 10px;text-align:right;white-space:nowrap;border-top:1px solid rgb(var(--slate-4,40 42 48))}',
    '.p12r-tab thead th{border-top:0;padding:0 10px 8px}',
    '.p12r-tab thead button{border:0;background:none;padding:0;color:rgb(var(--slate-11,176 180 186));font-weight:500;font-size:12px;cursor:pointer;white-space:nowrap}',
    '.p12r-tab thead button:hover{color:rgb(var(--slate-12,237 238 240))}',
    '.p12r-tab .p12r-esq{text-align:left}',
    '.p12r-tab tbody th{font-weight:500}',
    '.p12r-tab th:first-child,.p12r-tab td:first-child{padding-left:0}',
    '.p12r-mudo{color:rgb(var(--slate-9,105 110 119))}',
    '.p12r-vazio{display:flex;flex-direction:column;gap:4px;padding:28px 20px;border-radius:10px;border:1px dashed rgb(var(--slate-5,46 49 56));text-align:center;color:rgb(var(--slate-11,176 180 186))}',
    '.p12r-vazio b{color:rgb(var(--slate-12,237 238 240));font-size:14px;font-weight:600}',
    '.p12r-vazio .p12r-bot{align-self:center;margin-top:10px}',
    '.p12r-bot{height:32px;padding:0 12px;border-radius:8px;border:1px solid rgb(var(--slate-5,46 49 56));background:rgb(var(--solid-2,29 30 36));color:rgb(var(--slate-12,237 238 240));cursor:pointer;white-space:nowrap}',
    '.p12r-bot:hover{border-color:rgb(var(--slate-7,67 72 78))}',
    '.p12r-ferr{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
    '.p12r-nota{color:rgb(var(--slate-10,119 123 132));font-size:12px}',
    '.p12r-esq-carga{color:rgb(var(--slate-10,119 123 132));padding:24px 0;text-align:center}',
    '.p12r-rodape{margin-top:44px;padding-top:16px;border-top:1px solid rgb(var(--slate-4,40 42 48));display:flex;flex-wrap:wrap;gap:6px 14px;color:rgb(var(--slate-10,119 123 132));font-size:12.5px}',
    '.p12r-rodape a{color:rgb(var(--slate-11,176 180 186));text-decoration:underline;text-underline-offset:2px}',
    '.p12r-rodape a:hover{color:rgb(var(--slate-12,237 238 240))}',
    '.p12r-dica{position:fixed;z-index:60;max-width:260px;padding:8px 10px;border-radius:8px;background:rgb(var(--slate-12,237 238 240));color:rgb(var(--slate-1,17 17 19));font-size:12px;line-height:1.45;white-space:pre-line;pointer-events:none;box-shadow:0 8px 24px rgba(0,0,0,.3)}',
    '.p12r-dica[hidden]{display:none}',
    '.p12r-a11y{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}',
    '.p12r button:focus-visible,.p12r a:focus-visible,.p12r select:focus-visible,.p12r input:focus-visible{outline:2px solid rgb(var(--blue-9,110 86 207));outline-offset:2px}',
    '@media (prefers-reduced-motion:reduce){.p12r *{transition:none!important}}',
  ].join('\n');

  var CHAVE_PREF = 'p12-relatorios-v1';
  var CHAVE_FUNIL = 'p12-funil-v1';
  var FUNIL_VISTAS = { funil: 'Funil', barras: 'Barras', tempo: 'Tempo', tabela: 'Tabela' };

  var estado = {
    conta: null,
    f: null,
    cache: {},
    modo: {},
    ordem: {},
    serie: null,
    aberto: false,
    falhou: false,
    ultimoFiltros: null,
    ultimoCorpo: null,
  };
  var raiz = null;
  var tz = -new Date().getTimezoneOffset() / 60;

  function lerPref() {
    try {
      return JSON.parse(localStorage.getItem(CHAVE_PREF) || '{}') || {};
    } catch (e) {
      return {};
    }
  }

  function gravarPref() {
    try {
      var f = estado.f;
      localStorage.setItem(CHAVE_PREF, JSON.stringify({ periodo: f.periodo, de: f.de, ate: f.ate, funil: f.funil, comparar: f.comparar, visao: f.visao }));
    } catch (e) {
      /* sem armazenamento: vale o padrao */
    }
  }

  function lerFunilPref() {
    var p = { vista: 'funil', metrica: 'alcance', etapas: {} };
    try {
      var g = JSON.parse(localStorage.getItem(CHAVE_FUNIL) || '{}');
      if (FUNIL_VISTAS[g.vista]) p.vista = g.vista;
      if (g.metrica === 'entradas' || g.metrica === 'agora' || g.metrica === 'alcance') p.metrica = g.metrica;
      if (g.etapas && typeof g.etapas === 'object') p.etapas = g.etapas;
      p.comparar = !!g.comparar;
    } catch (e) {
      /* idem */
    }
    return p;
  }

  function gravarFunilPref(p) {
    try {
      localStorage.setItem(CHAVE_FUNIL, JSON.stringify(p));
    } catch (e) {
      /* idem */
    }
  }

  var funilPref = lerFunilPref();

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

  function crmBase() {
    if (window.__p12CrmBase) return window.__p12CrmBase;
    try {
      var s = document.querySelector('script[src*="/ingest/categorias/script.js"]');
      if (s) return new URL(s.src).origin;
    } catch (e) {
      /* sem o endereco do CRM, a visao de origem avisa */
    }
    return '';
  }

  function json(r) {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  }

  function cw(caminho) {
    return fetch(caminho, { headers: sessao() }).then(json);
  }

  function consulta(obj) {
    return Object.keys(obj)
      .filter(function (k) {
        return obj[k] != null && obj[k] !== '';
      })
      .map(function (k) {
        return k + '=' + encodeURIComponent(obj[k]);
      })
      .join('&');
  }

  // ---- dados em cache ----------------------------------------------------------------

  var desenharAgendado = null;
  function pedirDesenho() {
    if (desenharAgendado) return;
    desenharAgendado = setTimeout(function () {
      desenharAgendado = null;
      desenhar();
    }, 30);
  }

  /** Um bloco de dados: pedido uma vez por chave; a tela redesenha quando ele chega. */
  function obter(chave, carregar, vidaMs) {
    var e = estado.cache[chave];
    if (e && (!vidaMs || Date.now() - e.t < vidaMs)) return e;
    if (e && e.s === 'c') return e;
    e = estado.cache[chave] = { s: 'c', d: e ? e.d : null, t: Date.now() };
    Promise.resolve()
      .then(carregar)
      .then(function (d) {
        e.s = 'ok';
        e.d = d;
        e.t = Date.now();
        pedirDesenho();
      })
      .catch(function (err) {
        e.s = 'erro';
        e.erro = err;
        e.t = Date.now();
        pedirDesenho();
      });
    return e;
  }

  function pronto(e) {
    return e && e.s === 'ok' ? e.d : e && e.d ? e.d : null;
  }

  var AGORA_MS = 120000;

  function contexto() {
    var f = estado.f;
    var conta = estado.conta;
    var p = periodoDe(f.periodo, new Date(), f.de, f.ate);
    var ant = periodoAnterior(p);
    var dim = dimensaoDe(f);
    var A = '/api/v2/accounts/' + conta;
    var K = '/api/v1/accounts/' + conta + '/kanban';
    var sufixo = function (x) {
      return x.since + '-' + x.until;
    };
    var chaveDim = dim.type + dim.id;
    var rep = function (per, metrica, grupo) {
      return A + '/reports?' + consulta({ metric: metrica, type: dim.type, id: dim.id, group_by: grupo, since: per.since, until: per.until, timezone_offset: tz });
    };
    var qf = function (per) {
      return consulta({ since: per.since, until: per.until, board_id: quadro(), timezone_offset: tz, agent_id: f.atendente, inbox_id: f.caixa });
    };
    return { f: f, conta: conta, p: p, ant: ant, dim: dim, A: A, K: K, sufixo: sufixo, chaveDim: chaveDim, rep: rep, qf: qf };
  }

  function quadro() {
    var boards = pronto(estado.cache['boards:' + estado.conta]);
    var lista = (boards && boards.boards) || [];
    var f = estado.f;
    if (f.funil && lista.some(function (b) { return String(b.id) === f.funil; })) return f.funil;
    return lista.length ? String(lista[0].id) : '';
  }

  /** Dispara o que a tela de agora precisa; devolve os blocos. */
  function dados() {
    var c = contexto();
    var conta = c.conta;
    var f = c.f;
    var v = f.visao;
    var d = {};
    d.boards = obter('boards:' + conta, function () { return cw('/api/v1/accounts/' + conta + '/kanban/boards'); });
    d.agentes = obter('agentes:' + conta, function () { return cw('/api/v1/accounts/' + conta + '/agents'); });
    d.caixas = obter('caixas:' + conta, function () { return cw('/api/v1/accounts/' + conta + '/inboxes'); });
    d.etiquetas = obter('etiquetas:' + conta, function () { return cw('/api/v1/accounts/' + conta + '/labels'); });
    d.times = obter('times:' + conta, function () { return cw('/api/v1/accounts/' + conta + '/teams'); });

    var rs = function (per) {
      return c.A + '/reports/summary?' + consulta({ type: c.dim.type, id: c.dim.id, since: per.since, until: per.until, timezone_offset: tz });
    };
    d.resumo = obter('resumo:' + conta + ':' + c.chaveDim + ':' + c.sufixo(c.p), function () {
      return cw(rs(c.p));
    });
    d.agora = obter('agora:' + conta + ':' + c.chaveDim, function () {
      return cw(c.A + '/reports/conversations?' + consulta({ type: c.dim.type, id: c.dim.id }));
    }, AGORA_MS);
    d.espera = obter('espera:' + conta, function () {
      return cw('/api/v1/accounts/' + conta + '/conversations?status=open&conversation_type=unattended&sort_by=last_activity_at_asc&page=1').then(function (r) {
        var primeira = r && r.data && r.data.payload && r.data.payload[0];
        var desde = primeira && (primeira.waiting_since || primeira.timestamp);
        return desde ? Math.max(0, Math.floor(Date.now() / 1000) - desde) : null;
      });
    }, AGORA_MS);
    d.serieConversas = obter('s:conv:' + conta + c.chaveDim + c.sufixo(c.p), function () { return cw(c.rep(c.p, 'conversations_count', 'day')); });
    d.serieRecebidas = obter('s:rec:' + conta + c.chaveDim + c.sufixo(c.p), function () { return cw(c.rep(c.p, 'incoming_messages_count', 'day')); });
    d.serieEnviadas = obter('s:env:' + conta + c.chaveDim + c.sufixo(c.p), function () { return cw(c.rep(c.p, 'outgoing_messages_count', 'day')); });
    if (f.comparar) {
      d.serieConversasAnt = obter('s:conv:' + conta + c.chaveDim + c.sufixo(c.ant), function () { return cw(c.rep(c.ant, 'conversations_count', 'day')); });
    }
    if (v === 'geral' || v === 'atendimento') {
      d.calor = obter('s:hora:' + conta + c.chaveDim + c.sufixo(c.p), function () { return cw(c.rep(c.p, 'incoming_messages_count', 'hour')); });
    }
    d.tabCaixas = obter('t:inbox:' + conta + c.sufixo(c.p), function () {
      return cw(c.A + '/summary_reports/inbox?' + consulta({ since: c.p.since, until: c.p.until, timezone_offset: tz }));
    });
    if (v === 'atendentes' || v === 'atendimento') {
      d.tabAgentes = obter('t:agent:' + conta + c.sufixo(c.p), function () {
        return cw(c.A + '/summary_reports/agent?' + consulta({ since: c.p.since, until: c.p.until, timezone_offset: tz }));
      });
    }
    if (v === 'etiquetas' || v === 'origem') {
      d.tabEtiquetas = obter('t:label:' + conta + c.sufixo(c.p), function () {
        return cw(c.A + '/summary_reports/label?' + consulta({ since: c.p.since, until: c.p.until, timezone_offset: tz }));
      });
    }
    if (v === 'time') {
      d.tabTimes = obter('t:team:' + conta + c.sufixo(c.p), function () {
        return cw(c.A + '/summary_reports/team?' + consulta({ since: c.p.since, until: c.p.until, timezone_offset: tz }));
      });
    }

    var b = quadro();
    if (b) {
      var funil = function (per) {
        var q = c.qf(per);
        var F = window.__p12Funil;
        var cfdQ = F && F.consultaDoCfd ? F.consultaDoCfd(q) : null;
        return Promise.all([
          cw(c.K + '/reports/funnel?' + q),
          cw(c.K + '/reports/stage_durations?' + q).catch(function () { return []; }),
          cw(c.K + '/reports/aging?' + q + '&page=1').catch(function () { return null; }),
          cfdQ ? cw(c.K + '/reports/cfd?' + cfdQ).catch(function () { return null; }) : null,
        ]).then(function (r) {
          return { funil: r[0], duracoes: r[1], envelhecimento: r[2], novos: F && F.novosDoCfd && r[3] ? F.novosDoCfd(r[3]) : null };
        });
      };
      var chaveF = function (per) {
        return 'funil:' + conta + ':' + b + ':' + f.atendente + ':' + f.caixa + ':' + c.sufixo(per);
      };
      d.funil = obter(chaveF(c.p), function () { return funil(c.p); });
      if (f.comparar) d.funilAnt = obter(chaveF(c.ant), function () { return funil(c.ant); });
    }

    var crm = function (per) {
      var base = crmBase();
      if (!base) return Promise.reject(new Error('sem endereco do CRM'));
      return fetch(base + '/ingest/categorias/' + conta + '/origem?' + consulta({ since: per.since, until: per.until, tz: Math.round(tz) }), {
        headers: { Authorization: 'Bearer ' + btoa(JSON.stringify(sessao())) },
      }).then(json);
    };
    d.origem = obter('origem:' + conta + ':' + c.sufixo(c.p), function () { return crm(c.p); });
    if (f.comparar) d.origemAnt = obter('origem:' + conta + ':' + c.sufixo(c.ant), function () { return crm(c.ant); });
    d.ctx = c;
    return d;
  }

  // ---- modelos para a tela -----------------------------------------------------------

  function modeloDoFunil(bloco) {
    var F = window.__p12Funil;
    var dado = pronto(bloco);
    if (!F || !dado || !dado.funil) return null;
    return F.montar(dado, funilPref.etapas[estado.conta + ':' + quadro()] || null);
  }

  function resumoDe(bloco) {
    var r = pronto(bloco);
    if (!r) return null;
    var atual = {};
    var anterior = r.previous || null;
    Object.keys(r).forEach(function (k) {
      if (k !== 'previous') atual[k] = r[k];
    });
    return { atual: atual, anterior: anterior };
  }

  function leadsDe(bloco) {
    var o = pronto(bloco);
    return o && o.cliente ? o : null;
  }

  function modelo(d) {
    var c = d.ctx;
    var dias = diasDoPeriodo(c.p);
    var m = {
      ctx: c, dias: dias,
      resumo: resumoDe(d.resumo),
      agora: pronto(d.agora),
      espera: pronto(d.espera),
      funil: modeloDoFunil(d.funil),
      funilAnt: c.f.comparar ? modeloDoFunil(d.funilAnt) : null,
      leads: leadsDe(d.origem),
      leadsAnt: c.f.comparar ? leadsDe(d.origemAnt) : null,
      origemEstado: d.origem.s,
      origemBruta: pronto(d.origem),
    };
    m.temCrm = !!m.leads;
    var serie = function (bloco) {
      var p = pronto(bloco);
      return p ? alinhar(serieDiaria(p, tz), dias) : null;
    };
    m.s = {
      conversas: serie(d.serieConversas),
      conversasAnt: d.serieConversasAnt ? serie2(d.serieConversasAnt, c.ant) : null,
      recebidas: serie(d.serieRecebidas),
      enviadas: serie(d.serieEnviadas),
    };
    m.s.leads = m.leads ? alinhar(m.leads.porDia.map(function (x) { return { dia: x.dia, v: x.google + x.meta + x.direto }; }), dias) : null;
    m.calor = d.calor && pronto(d.calor) ? mapaDeCalor(pronto(d.calor), tz) : null;
    return m;
  }

  function serie2(bloco, per) {
    var p = pronto(bloco);
    if (!p) return null;
    var dias = diasDoPeriodo({ de: isoLocal(new Date(per.since * 1000)), ate: isoLocal(new Date(per.until * 1000)) });
    var s = serieDiaria(p, tz).map(function (x) { return x.v; });
    // O periodo anterior tem o mesmo tamanho: alinha pela posicao do dia.
    return dias.map(function (x, i) { return s[i] != null ? s[i] : 0; });
  }

  function listaDe(bloco, chave) {
    var d = pronto(bloco);
    if (!d) return null;
    if (chave && d[chave]) return d[chave];
    return Array.isArray(d) ? d : d.payload || [];
  }

  // ---- visoes ------------------------------------------------------------------------

  function carregando(texto) {
    return '<div class="p12r-esq-carga">' + esc(texto || 'Carregando…') + '</div>';
  }

  function erroDe(bloco, o_que) {
    return htmlVazio('Não consegui carregar ' + o_que, 'O Chatwoot não respondeu. Atualize a página ou tente de novo em instantes.');
  }

  function alternar(id, atual) {
    return seg('modo', { grafico: 'Gráfico', tabela: 'Tabela' }, atual, ' data-id="' + id + '"');
  }

  function barraDeFerramentas(id) {
    return '<button type="button" class="p12r-bot" data-acao="csv" data-id="' + id + '">Baixar CSV</button>';
  }

  /** Visao de tabela generica: grafico de ranking ou tabela ordenavel, mais CSV. */
  function visaoTabela(o) {
    // o = { id, titulo, desc, cols, linhas, metrica, vazio, nota, fmt }
    estado.tabelas = estado.tabelas || {};
    var colunas = colunasUteis(o.cols, o.linhas);
    estado.tabelas[o.id] = { cols: colunas, linhas: o.linhas };
    if (!o.linhas.length) return cartao(o.titulo, o.desc, o.vazio);
    var modo = estado.modo[o.id] || 'grafico';
    var corpo;
    if (modo === 'tabela') corpo = htmlTabelaOrdenavel(o.id, colunas, o.linhas, estado.ordem[o.id] || { k: o.metrica, dir: 'desc' });
    else {
      var top = ordenar(o.linhas, o.metrica, 'desc').filter(function (l) { return l[o.metrica]; }).slice(0, 15);
      corpo = top.length
        ? htmlRanking(top.map(function (l) { return { nome: l.nome, valor: l[o.metrica], sub: o.sub ? o.sub(l) : '' }; }))
        : htmlVazio('Nada para mostrar no gráfico', 'Todos os valores deste período estão zerados. A tabela mostra a lista completa.');
    }
    return cartao(o.titulo, o.desc, (o.nota ? '<p class="p12r-nota" style="margin-bottom:12px">' + esc(o.nota) + '</p>' : '') + corpo,
      '<div class="p12r-ferr">' + alternar(o.id, modo) + barraDeFerramentas(o.id) + '</div>');
  }

  var COLS_ATENDIMENTO = [
    { k: 'conversas', r: 'Conversas', t: 'n' },
    { k: 'atendidas', r: 'Atendidas', t: 'n' },
    { k: 'resolvidas', r: 'Resolvidas', t: 'n' },
    { k: 'primeira', r: '1ª resposta', t: 'dur' },
    { k: 'resposta', r: 'Tempo de resposta', t: 'dur' },
  ];

  function vistaEtiquetas(d, m) {
    var e = d.tabEtiquetas;
    if (e.s === 'erro' && !pronto(e)) return erroDe(e, 'as etiquetas');
    var res = pronto(e);
    if (!res) return carregando();
    var linhas = linhasPorNome(listaDe(d.etiquetas), res).filter(function (l) { return l.conversas > 0; });
    var semConversa = res.length - linhas.length;
    var f = m.ctx.f;
    return visaoTabela({
      id: 'etiquetas', titulo: 'Conversas por etiqueta', desc: 'As etiquetas de origem e de assunto marcadas nas conversas do período',
      cols: [{ k: 'nome', r: 'Etiqueta', t: 't' }].concat(COLS_ATENDIMENTO), linhas: linhas, metrica: 'conversas',
      vazio: htmlVazio('Nenhuma etiqueta usada no período', 'Nenhuma conversa nova recebeu etiqueta neste período.'),
      nota: (f.etiqueta ? 'O filtro de etiqueta vale para os números de cima; esta lista mostra todas. ' : '') +
        (semConversa > 0 ? n(semConversa) + ' etiquetas sem conversas no período ficaram de fora.' : ''),
    });
  }

  function vistaCaixas(d, m) {
    var e = d.tabCaixas;
    if (e.s === 'erro' && !pronto(e)) return erroDe(e, 'as caixas de entrada');
    var res = pronto(e);
    if (!res) return carregando();
    var linhas = linhasPorNome(listaDe(d.caixas), res);
    return visaoTabela({
      id: 'caixas', titulo: 'Caixas de entrada', desc: 'Conversas e tempos por caixa no período',
      cols: [{ k: 'nome', r: 'Caixa', t: 't' }].concat(COLS_ATENDIMENTO), linhas: linhas, metrica: 'conversas',
      vazio: htmlVazio('Nenhuma caixa de entrada', 'Esta conta ainda não tem caixas de entrada.'),
    });
  }

  function atendentesSemAtividade(res) {
    return !!res && res.length > 0 && res.every(function (r) { return !num(r.conversations_count); });
  }

  function vistaAtendentes(d, m) {
    var e = d.tabAgentes;
    if (!e) return carregando();
    if (e.s === 'erro' && !pronto(e)) return erroDe(e, 'os atendentes');
    var res = pronto(e);
    var ags = listaDe(d.agentes);
    if (!res || !ags) return carregando();
    var linhas = linhasDeAgentes(ags, res);
    var abertas = m.agora ? num(m.agora.open) : 0;
    var aviso = '';
    if (atendentesSemAtividade(res)) {
      aviso = htmlVazio('Ninguém atribui conversas nesta conta',
        (abertas ? n(abertas) + ' conversas abertas estão sem atendente. ' : '') +
        'Sem atribuição, o Chatwoot não soma conversas por atendente. A tabela mostra em quantas conversas cada um respondeu; o andamento do trabalho aparece no funil e nas etiquetas.');
    }
    var temAtribuidas = linhas.some(function (l) { return l.conversas > 0; });
    var cols = [{ k: 'nome', r: 'Atendente', t: 't', fixa: true }, { k: 'status', r: 'Agora', t: 't' }, { k: 'papel', r: 'Papel', t: 't' }].concat(COLS_ATENDIMENTO);
    var tabela = visaoTabela({
      id: 'atendentes', titulo: 'Atendentes', desc: 'Quem respondeu, quanto e em quanto tempo',
      cols: cols, linhas: linhas, metrica: temAtribuidas ? 'conversas' : 'atendidas',
      vazio: htmlVazio('Nenhum atendente','Esta conta não tem atendentes cadastrados.'),
      sub: function (l) { return l.status; },
    });
    return (aviso ? '<div>' + aviso + '</div>' : '') + tabela;
  }

  function vistaTime(d) {
    var times = listaDe(d.times);
    if (!times) return carregando();
    if (!times.length) {
      return cartao('Times', '', htmlVazio('Esta conta não tem times', 'Times agrupam atendentes. Crie um em Configurações para acompanhar os números por equipe aqui.'));
    }
    var e = d.tabTimes;
    if (!e) return carregando();
    var res = pronto(e);
    if (!res) return e.s === 'erro' ? erroDe(e, 'os times') : carregando();
    var linhas = linhasPorNome(times, res);
    return visaoTabela({
      id: 'time', titulo: 'Times', desc: 'Conversas e tempos por equipe', cols: [{ k: 'nome', r: 'Time', t: 't' }].concat(COLS_ATENDIMENTO),
      linhas: linhas, metrica: 'conversas',
      vazio: htmlVazio('Nada nos times', 'Nenhuma conversa foi atribuída a times neste período.'),
      nota: linhas.every(function (l) { return !l.conversas; }) ? 'Nenhuma conversa foi atribuída a um time no período; os números ficam em zero.' : '',
    });
  }

  function tilesAgora(ag) {
    if (!ag) return carregando();
    var t = [
      ['Abertas agora', ag.open, 'conversas em aberto'],
      ['Sem resposta', ag.unattended, 'a equipe ainda não respondeu'],
      ['Sem atendente', ag.unassigned, 'ninguém atribuído'],
      ['Pendentes', ag.pending, 'aguardando retorno'],
    ];
    return '<div class="p12r-grid3">' + t.map(function (x) {
      return '<div class="p12r-kpi"><span class="p12r-kpi-r">' + x[0] + '</span><span class="p12r-kpi-v">' + n(num(x[1])) + '</span><span class="p12r-kpi-a">' + x[2] + '</span></div>';
    }).join('') + '</div>';
  }

  function cartaoCalor(m, ate) {
    if (!m.calor) return cartao('Quando os clientes escrevem', 'Mensagens recebidas por dia da semana e hora', carregando());
    if (!m.calor.total) return cartao('Quando os clientes escrevem', 'Mensagens recebidas por dia da semana e hora', htmlVazio('Nenhuma mensagem no período', 'Não chegou mensagem de cliente neste período.'));
    var destaque = m.calor.melhor
      ? '<p class="p12r-destaque">Pico: <b>' + esc(m.calor.melhor.dia) + ', ' + m.calor.melhor.hora + ' h</b> (' + n(m.calor.melhor.v) + ' mensagens). Hora mais forte do período: <b>' + m.calor.horaForte + ' h</b>.</p>'
      : '';
    return cartao('Quando os clientes escrevem', 'Mensagens recebidas por dia da semana e hora, no seu fuso', htmlCalor(m.calor, 'mensagens') + destaque);
  }

  function cartaoSerieAtendimento(m) {
    var s = m.s;
    if (!s.recebidas || !s.enviadas) return cartao('Mensagens por dia', '', carregando());
    var series = [
      { nome: 'Recebidas', cor: COR.principal, valores: s.recebidas, area: true },
      { nome: 'Enviadas', cor: COR.enviadas, valores: s.enviadas },
    ];
    return cartao('Mensagens por dia', 'O que os clientes mandaram e o que a equipe respondeu',
      legenda(series.map(function (x) { return { nome: x.nome, cor: x.cor }; })) + htmlLinhas(m.dias, series));
  }

  function vistaAtendimento(d, m) {
    var r = m.resumo && m.resumo.atual;
    var tempos;
    if (!r) tempos = carregando();
    else {
      var resolvidas = num(r.resolutions_count);
      tempos = '<div class="p12r-grid3">' +
        '<div class="p12r-kpi" title="Inclui noite e fim de semana"><span class="p12r-kpi-r">Primeira resposta</span><span class="p12r-kpi-v">' + (r.avg_first_response_time != null ? dur(r.avg_first_response_time) : '–') + '</span><span class="p12r-kpi-a">média; conta noite e fim de semana</span></div>' +
        '<div class="p12r-kpi"><span class="p12r-kpi-r">Tempo entre respostas</span><span class="p12r-kpi-v">' + (r.reply_time != null ? dur(r.reply_time) : '–') + '</span><span class="p12r-kpi-a">média por mensagem respondida</span></div>' +
        (resolvidas ? '<div class="p12r-kpi"><span class="p12r-kpi-r">Resolvidas</span><span class="p12r-kpi-v">' + n(resolvidas) + '</span><span class="p12r-kpi-a">' + (r.avg_resolution_time != null ? 'em ' + dur(r.avg_resolution_time) : '') + '</span></div>' : '') +
        '</div>' + (resolvidas ? '' : '<p class="p12r-nota" style="margin-top:10px">Nenhuma conversa foi marcada como resolvida no período: esta conta acompanha o andamento pelo funil, não pelo status da conversa.</p>');
    }
    return '<div>' + '<div class="p12r-bloco" style="margin-top:0"><h2>Conversas agora</h2>' + tilesAgora(m.agora) + '</div>' +
      '<div class="p12r-bloco"><h2>Tempos de resposta</h2>' + tempos + '</div></div>' +
      '<div class="p12r-grid2">' + cartaoSerieAtendimento(m) + cartaoCalor(m) + '</div>';
  }

  function origemRotulo(o) {
    var p = o.plataforma === 'google' ? 'Google' : o.plataforma === 'meta' ? 'Meta' : 'Sem anúncio';
    return p + ' · ' + o.canal;
  }

  function semCrm(m) {
    if (m.origemEstado === 'c') return null;
    if (m.origemBruta && m.origemBruta.cliente === false) {
      return htmlVazio('Esta conta não está ligada ao CRM', 'A origem e a campanha de cada lead vêm do CRM. Sem ele, o painel mostra as conversas novas do Chatwoot no lugar dos leads.');
    }
    if (!m.origemBruta) {
      return htmlVazio('A origem dos leads ainda não respondeu', 'Esta visão depende do CRM. Veja as etiquetas de origem (google, facebook, formulário, mensagem) enquanto isso.',
        '<button type="button" class="p12r-bot" data-acao="visao" data-v="etiquetas">Ver etiquetas</button>');
    }
    return null;
  }

  function camadasPorDia(l, dias) {
    var por = {};
    l.porDia.forEach(function (x) { por[x.dia] = x; });
    return [
      { nome: 'Google', cor: COR.google, valores: dias.map(function (x) { return por[x] ? por[x].google : 0; }) },
      { nome: 'Meta', cor: COR.meta, valores: dias.map(function (x) { return por[x] ? por[x].meta : 0; }) },
      { nome: 'Sem anúncio', cor: COR.direto, valores: dias.map(function (x) { return por[x] ? por[x].direto : 0; }) },
    ];
  }

  function cartaoOrigemResumo(m) {
    var falta = semCrm(m);
    if (falta) return cartao('De onde vêm os leads', '', falta);
    if (!m.leads) return cartao('De onde vêm os leads', '', carregando());
    if (!m.leads.total) return cartao('De onde vêm os leads', '', htmlVazio('Nenhum lead no período', 'O CRM não registrou lead novo neste período.'));
    var cor = function (p) { return COR[p]; };
    return cartao('De onde vêm os leads', n(m.leads.total) + ' leads no período, por plataforma e canal',
      htmlRanking(m.leads.porOrigem.map(function (o) { return { nome: origemRotulo(o), valor: o.total, cor: cor(o.plataforma) }; }).slice(0, 8)));
  }

  function cartaoLeadsPorDia(m) {
    var f = m.ctx.f;
    var tem = m.temCrm;
    var alvo = estado.serie === 'conversas' || !tem ? 'conversas' : 'leads';
    var controles = tem ? seg('serie', { leads: 'Leads', conversas: 'Conversas' }, alvo) : '';
    var s = m.s;
    var titulo = alvo === 'leads' ? 'Leads por dia' : 'Conversas novas por dia';
    var desc = alvo === 'leads' ? 'Registrados pelo CRM' : tem ? 'Abertas no Chatwoot' : 'Sem CRM ligado: as conversas novas fazem o papel de leads';
    if (alvo === 'leads') {
      if (!m.leads) return cartao(titulo, desc, carregando(), controles);
      return cartao(titulo, desc, legenda([{ nome: 'Google', cor: COR.google }, { nome: 'Meta', cor: COR.meta }, { nome: 'Sem anúncio', cor: COR.direto }]) +
        htmlEmpilhadas(m.dias, camadasPorDia(m.leads, m.dias)), controles);
    }
    if (!s.conversas) return cartao(titulo, desc, carregando(), controles);
    var series = [{ nome: 'Neste período', cor: COR.principal, valores: s.conversas, area: true }];
    if (f.comparar && s.conversasAnt) series.unshift({ nome: 'Período anterior', cor: COR.anterior, valores: s.conversasAnt, tracejado: true });
    return cartao(titulo, desc, legenda(series.map(function (x) { return { nome: x.nome, cor: x.cor, tracejado: x.tracejado }; })) + htmlLinhas(m.dias, series), controles);
  }

  function vistaGeral(d, m) {
    var funil = m.funil
      ? cartao('Funil', 'Quantos leads chegaram em cada etapa', htmlFunilCompacto(m.funil) +
        '<p style="margin-top:14px"><button type="button" class="p12r-link" data-acao="visao" data-v="funil">Ver o funil completo</button></p>')
      : cartao('Funil', '', d.funil && d.funil.s === 'erro' ? htmlVazio('Funil indisponível', 'Não consegui carregar o funil deste quadro.') : carregando());
    return '<div class="p12r-grid2">' + cartaoLeadsPorDia(m) + cartaoOrigemResumo(m) + '</div>' +
      '<div class="p12r-grid2b">' + cartaoCalor(m) + funil + '</div>';
  }

  function vistaOrigem(d, m) {
    var falta = semCrm(m);
    if (falta) return falta;
    var l = m.leads;
    if (!l) return carregando();
    if (!l.total) return htmlVazio('Nenhum lead no período', 'O CRM não registrou lead novo entre ' + m.ctx.p.rotulo + '.');
    var porPlat = { google: 0, meta: 0, direto: 0 };
    l.porOrigem.forEach(function (o) { porPlat[o.plataforma] += o.total; });
    var tiles = '<div class="p12r-grid3">' + [['Google', 'google'], ['Meta', 'meta'], ['Sem anúncio', 'direto']].map(function (x) {
      var ant = m.leadsAnt ? m.leadsAnt.porOrigem.reduce(function (s, o) { return s + (o.plataforma === x[1] ? o.total : 0); }, 0) : null;
      return '<div class="p12r-kpi"><span class="p12r-kpi-r">' + x[0] + '</span><span class="p12r-kpi-v">' + n(porPlat[x[1]]) + chip(m.ctx.f.comparar ? variacao(porPlat[x[1]], ant) : null) + '</span><span class="p12r-kpi-a">' + pct(porPlat[x[1]] / l.total) + ' dos leads</span></div>';
    }).join('') + '</div>';
    var linhasOrigem = l.porOrigem.map(function (o) { return { nome: origemRotulo(o), total: o.total, parte: o.total / l.total }; });
    var linhasCamp = l.porCampanha.map(function (c) { return { nome: c.campanha, plataforma: c.plataforma === 'google' ? 'Google' : c.plataforma === 'meta' ? 'Meta' : 'Outras', total: c.total, parte: c.total / l.total }; });
    var colsOrigem = [{ k: 'nome', r: 'Origem', t: 't' }, { k: 'total', r: 'Leads', t: 'n' }, { k: 'parte', r: '% do total', t: 'pct' }];
    var colsCamp = [{ k: 'nome', r: 'Campanha', t: 't' }, { k: 'plataforma', r: 'Plataforma', t: 't' }, { k: 'total', r: 'Leads', t: 'n' }, { k: 'parte', r: '% do total', t: 'pct' }];
    return tiles + cartaoLeadsPorDia(m) + '<div class="p12r-grid2b">' +
      visaoTabela({ id: 'origem', titulo: 'Por origem', desc: 'Plataforma e canal de entrada', cols: colsOrigem, linhas: linhasOrigem, metrica: 'total', vazio: '' }) +
      visaoTabela({ id: 'campanhas', titulo: 'Por campanha', desc: 'Nome da campanha como o anúncio informou', cols: colsCamp, linhas: linhasCamp, metrica: 'total', vazio: '' }) + '</div>';
  }

  /** O cartao do funil, com os mesmos graficos de chatwoot-funil.js. */
  function vistaFunil(d, m) {
    var F = window.__p12Funil;
    if (!F || !F.html) return htmlVazio('Funil indisponível', 'O módulo do funil não carregou. Os relatórios originais do Chatwoot seguem no rodapé.');
    var f = m.ctx.f;
    var boards = listaDe(d.boards, 'boards') || [];
    if (!boards.length) return htmlVazio('Nenhum funil nesta conta', 'Crie um quadro no Kanban para acompanhar as etapas aqui.');
    if (d.funil && d.funil.s === 'erro' && !pronto(d.funil)) return erroDe(d.funil, 'o funil');
    if (!m.funil) return carregando();
    var pref = { vista: funilPref.vista, metrica: funilPref.metrica, comparar: f.comparar };
    var cartaoHtml = F.html(m.funil, f.comparar ? m.funilAnt : null, pref, {
      aberto: estado.aberto, comparando: f.comparar && !m.funilAnt,
      parados: (pronto(d.funil).envelhecimento && pronto(d.funil).envelhecimento.items) || [], conta: estado.conta,
    });
    return (
      '<section class="p12r-cartao"><header><div><h3>Funil de conversão</h3><p>Etapas do quadro, de quem chegou até quem está agora</p></div>' +
      '<button type="button" class="p12r-link" data-acao="original">Ver no relatório original</button></header><div class="p12f p12r-funil-i">' + cartaoHtml + '</div></section>'
    );
  }

  var RENDER = {
    geral: vistaGeral, funil: vistaFunil, origem: vistaOrigem, atendimento: vistaAtendimento,
    etiquetas: vistaEtiquetas, caixas: vistaCaixas, atendentes: vistaAtendentes, time: vistaTime,
  };

  // ---- pagina ------------------------------------------------------------------------

  function opcoes(lista, atual, rotuloTodos, nome) {
    return '<option value="">' + esc(rotuloTodos) + '</option>' + lista.map(function (x) {
      return '<option value="' + esc(x.id) + '"' + (String(x.id) === String(atual) ? ' selected' : '') + '>' + esc(nome(x)) + '</option>';
    }).join('');
  }

  function htmlFiltros(d) {
    var f = estado.f;
    var boards = listaDe(d.boards, 'boards') || [];
    var caixas = listaDe(d.caixas) || [];
    var ags = listaDe(d.agentes) || [];
    var etqs = listaDe(d.etiquetas) || [];
    var times = listaDe(d.times) || [];
    var sel = function (acao, ativo, conteudo, titulo) {
      return '<select class="p12r-sel' + (ativo ? ' p12r-ativo' : '') + '" data-acao="' + acao + '" aria-label="' + esc(titulo) + '" title="' + esc(titulo) + '">' + conteudo + '</select>';
    };
    var qualquer = f.atendente || f.caixa || f.etiqueta || f.time;
    return (
      '<div class="p12r-fl">' + seg('periodo', PERIODOS, f.periodo) +
      (f.periodo === 'custom'
        ? '<input type="date" class="p12r-data" data-acao="de" value="' + esc(f.de) + '" aria-label="De"><input type="date" class="p12r-data" data-acao="ate" value="' + esc(f.ate) + '" aria-label="Até">'
        : '') +
      (boards.length > 1
        ? sel('funil', f.funil, boards.map(function (b) {
            return '<option value="' + esc(b.id) + '"' + (String(b.id) === quadro() ? ' selected' : '') + '>Funil: ' + esc(String(b.name).trim()) + '</option>';
          }).join(''), 'Funil')
        : '') +
      (caixas.length ? sel('caixa', f.caixa, opcoes(caixas, f.caixa, 'Todas as caixas', function (x) { return x.name; }), 'Caixa de entrada') : '') +
      (ags.length ? sel('atendente', f.atendente, opcoes(ags, f.atendente, 'Todos os atendentes', function (x) { return x.name; }), 'Atendente') : '') +
      (etqs.length ? sel('etiqueta', f.etiqueta, opcoes(etqs.slice().sort(function (a, b) { return String(a.title).localeCompare(String(b.title), 'pt-BR'); }), f.etiqueta, 'Todas as etiquetas', function (x) { return x.title; }), 'Etiqueta') : '') +
      (times.length ? sel('time', f.time, opcoes(times, f.time, 'Todos os times', function (x) { return x.name; }), 'Time') : '') +
      '<span class="p12r-folga"></span>' +
      '<button type="button" class="p12r-interr' + (f.comparar ? ' p12r-on' : '') + '" data-acao="comparar" role="switch" aria-checked="' + f.comparar + '" title="Compara com o período de mesmo tamanho logo antes"><i></i>Comparar com período anterior</button>' +
      (qualquer ? '<button type="button" class="p12r-link" data-acao="limpar">Limpar filtros</button>' : '') + '</div>' +
      (f.atendente || f.caixa || f.etiqueta || f.time
        ? '<p class="p12r-aviso-filtro">O Chatwoot filtra uma dimensão por vez: ' + (f.atendente ? 'atendente' : f.caixa ? 'caixa de entrada' : f.etiqueta ? 'etiqueta' : 'time') +
          ' vale para conversas, mensagens e tempos. As tabelas mostram todos os itens.</p>'
        : '')
    );
  }

  function htmlTopo(m) {
    var p = m.ctx.p;
    return '<div class="p12r-topo"><h1>Relatórios</h1><p>Leads, atendimento e funil · ' + esc(p.chave === 'hoje' ? 'hoje' : p.rotulo) +
      (p.dias > 1 ? ' (' + p.dias + ' dias)' : '') + '</p></div>';
  }

  function htmlRodape(conta) {
    var base = '/app/accounts/' + conta + '/reports/';
    var links = [
      ['Visão geral', 'overview?original=1'], ['Conversas', 'conversation'], ['Agentes', 'agents_overview'], ['Etiquetas', 'labels_overview'],
      ['Caixa de entrada', 'inboxes_overview'], ['Time', 'teams_overview'], ['Funis', 'funnels'], ['CSAT', 'csat'], ['SLA', 'sla'], ['Robôs', 'bot'],
    ];
    return '<footer class="p12r-rodape"><span>Relatórios originais do Chatwoot:</span>' + links.map(function (l) {
      return '<a href="' + base + l[1] + '" data-acao="ir" data-href="' + base + l[1] + '">' + l[0] + '</a>';
    }).join('') + '</footer>';
  }

  function htmlCorpo(d, m) {
    var f = m.ctx.f;
    var lista = alertas({
      conta: estado.conta, quadro: quadro(), agora: m.agora && { unattended: num(m.agora.unattended), open: num(m.agora.open), unassigned: num(m.agora.unassigned) },
      esperaMaisAntiga: m.espera, funil: m.funil,
      caixas: (pronto(d.tabCaixas) ? linhasPorNome(listaDe(d.caixas), pronto(d.tabCaixas)) : []).map(function (l) { return { nome: l.nome, conversas: l.conversas }; }),
      atendentes: { todosSemAtividade: false, abertas: m.agora ? num(m.agora.open) : 0 },
    });
    // O alerta de "ninguem atribui" usa a tabela de atendentes, buscada so' quando a visao pede;
    // aqui basta o que ja' sabemos de "agora": todas as abertas sem atendente.
    if (m.agora && num(m.agora.open) > 0 && num(m.agora.unassigned) >= num(m.agora.open) && !lista.some(function (a) { return a.id === 'sematendente'; })) {
      lista.push({ id: 'sematendente', nivel: 'info', titulo: 'Ninguém atribui conversas nesta conta', detalhe: n(num(m.agora.open)) + ' abertas, nenhuma com atendente', visao: 'atendentes' });
    }
    var criticos = !m.agora || !m.funil;
    var kp = kpis({ resumo: m.resumo, temCrm: m.temCrm, leads: m.leads, leadsAnt: m.leadsAnt, funil: m.funil, funilAnt: m.funilAnt, comparar: f.comparar, series: m.s });
    var kpisHtml = kp.length ? htmlKpis(kp) : carregando();
    var erros = ['resumo', 'agora'].filter(function (k) { return d[k].s === 'erro' && !pronto(d[k]); });
    var avisoErro = erros.length ? '<div style="margin-bottom:12px">' + htmlVazio('Parte dos números não carregou', 'O Chatwoot não respondeu a tudo. Atualize a página para tentar de novo.') + '</div>' : '';
    var vista = RENDER[f.visao](d, m);
    return (
      '<div class="p12r-bloco" style="margin-top:28px"><h2>Para agir agora</h2><p>O que está esperando a equipe, com um clique para chegar lá</p>' + htmlAlertas(lista, criticos) + '</div>' +
      '<div class="p12r-bloco"><h2>Números do período</h2><p>' + esc(f.comparar ? 'Comparados com o período anterior de mesmo tamanho' : 'Somatória do período escolhido') + '</p>' + avisoErro + kpisHtml + '</div>' +
      '<nav class="p12r-abas" role="tablist">' + Object.keys(VISOES).map(function (k) {
        return '<button type="button" role="tab" aria-selected="' + (k === f.visao) + '" data-acao="visao" data-v="' + k + '"' + (k === f.visao ? ' class="p12r-on"' : '') + '>' + esc(VISOES[k]) + '</button>';
      }).join('') + '</nav>' +
      '<div class="p12r-vista">' + vista + '</div>' + htmlRodape(estado.conta)
    );
  }

  function desenhar() {
    if (!raiz || estado.falhou) return;
    try {
      var d = dados();
      var m = modelo(d);
      var filtros = htmlFiltros(d);
      var topo = htmlTopo(m);
      var corpo = htmlCorpo(d, m);
      var secFiltros = document.getElementById('p12r-filtros');
      var secCorpo = document.getElementById('p12r-corpo');
      if (!secFiltros || !secCorpo) return;
      if (topo + filtros !== estado.ultimoFiltros) {
        estado.ultimoFiltros = topo + filtros;
        document.getElementById('p12r-topo').innerHTML = topo;
        secFiltros.innerHTML = filtros;
      }
      if (corpo !== estado.ultimoCorpo) {
        estado.ultimoCorpo = corpo;
        secCorpo.innerHTML = corpo;
      }
    } catch (e) {
      console.debug('[p12-relatorios]', e && e.message);
      estado.falhou = true;
      desmontar();
    }
  }

  // ---- acoes -------------------------------------------------------------------------

  function navegar(url) {
    try {
      document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(url);
    } catch (e) {
      location.assign(url);
    }
  }

  function aplicarFiltros() {
    gravarPref();
    try {
      var url = location.pathname + filtrosParaUrl(estado.f);
      if (url !== location.pathname + location.search) history.replaceState(history.state, '', url);
    } catch (e) {
      /* o filtro vale mesmo sem o endereco */
    }
    estado.ultimoFiltros = null;
    desenhar();
  }

  function baixarCsv(id) {
    var t = estado.tabelas && estado.tabelas[id];
    if (!t) return;
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csvDe(t.cols, t.linhas)], { type: 'text/csv;charset=utf-8' }));
    a.download = 'relatorio-' + id + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }

  function baixarCsvFunil() {
    var F = window.__p12Funil;
    var d = dados();
    var m = modeloDoFunil(d.funil);
    if (!F || !m) return;
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + F.csv(m, estado.f.comparar ? modeloDoFunil(d.funilAnt) : null)], { type: 'text/csv;charset=utf-8' }));
    a.download = 'funil-' + quadro() + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }

  function urlDoFunilOriginal() {
    var p = contexto().p;
    return '/app/accounts/' + estado.conta + '/reports/funnels?' + consulta({ tab: 'funnel', since: p.since, until: p.until, board_id: quadro() });
  }

  function aoClicar(ev) {
    var alvo = ev.target.closest ? ev.target.closest('[data-acao]') : null;
    if (!alvo || !raiz.contains(alvo)) {
      if (estado.aberto && !(ev.target.closest && ev.target.closest('.p12f-menu'))) {
        estado.aberto = false;
        desenhar();
      }
      return;
    }
    var acao = alvo.getAttribute('data-acao');
    var v = alvo.getAttribute('data-v');
    var f = estado.f;
    if (acao === 'ir') {
      if (ev.button || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
      ev.preventDefault();
      return navegar(alvo.getAttribute('data-href'));
    }
    if (acao === 'etapa') return;
    ev.preventDefault();
    if (acao === 'periodo') {
      f.periodo = v;
      if (v === 'custom' && !(f.de && f.ate)) {
        var hoje = periodoDe('hoje', new Date());
        var ini = periodoDe('30d', new Date());
        f.de = ini.de;
        f.ate = hoje.ate;
      }
    } else if (acao === 'comparar') f.comparar = !f.comparar;
    else if (acao === 'limpar') {
      f.funil = f.caixa = f.atendente = f.etiqueta = f.time = '';
    } else if (acao === 'visao') {
      f.visao = v;
      estado.aberto = false;
    } else if (acao === 'serie') {
      estado.serie = v;
      estado.ultimoCorpo = null;
      return desenhar();
    } else if (acao === 'modo') {
      estado.modo[alvo.getAttribute('data-id')] = v;
    } else if (acao === 'ordem') {
      var id = alvo.getAttribute('data-id');
      var k = alvo.getAttribute('data-k');
      var atual = estado.ordem[id];
      estado.ordem[id] = { k: k, dir: atual && atual.k === k && atual.dir === 'desc' ? 'asc' : 'desc' };
    } else if (acao === 'csv') {
      var idc = alvo.getAttribute('data-id');
      return idc ? baixarCsv(idc) : baixarCsvFunil();
    }
    // Controles do cartao do funil (mesmos data-acao de chatwoot-funil.js).
    else if (acao === 'vista') {
      funilPref.vista = v;
      gravarFunilPref(funilPref);
    } else if (acao === 'metrica') {
      funilPref.metrica = v;
      gravarFunilPref(funilPref);
    } else if (acao === 'etapas') estado.aberto = !estado.aberto;
    else if (acao === 'etapas-padrao') {
      delete funilPref.etapas[estado.conta + ':' + quadro()];
      gravarFunilPref(funilPref);
    } else if (acao === 'original') return navegar(urlDoFunilOriginal());
    estado.ultimoCorpo = null;
    aplicarFiltros();
  }

  function aoMudar(ev) {
    var alvo = ev.target;
    var acao = alvo.getAttribute && alvo.getAttribute('data-acao');
    var f = estado.f;
    if (!acao) return;
    if (acao === 'etapa') {
      var m = modeloDoFunil(dados().funil);
      if (!m) return;
      var mapa = {};
      m.todas.forEach(function (e) {
        mapa[e.id] = e.noFunil;
      });
      mapa[alvo.getAttribute('data-id')] = alvo.checked;
      funilPref.etapas[estado.conta + ':' + quadro()] = mapa;
      gravarFunilPref(funilPref);
      estado.ultimoCorpo = null;
      return desenhar();
    }
    if (acao === 'de' || acao === 'ate') {
      if (!lerIso(alvo.value)) return;
      f[acao] = alvo.value;
      if (lerIso(f.de) > lerIso(f.ate)) {
        if (acao === 'de') f.ate = f.de;
        else f.de = f.ate;
      }
      return aplicarFiltros();
    }
    if (['funil', 'caixa', 'atendente', 'etiqueta', 'time'].indexOf(acao) < 0) return;
    if (acao !== 'funil') {
      f.caixa = f.atendente = f.etiqueta = f.time = '';
    }
    f[acao] = alvo.value;
    estado.ultimoCorpo = null;
    aplicarFiltros();
  }

  // ---- dica dos graficos -------------------------------------------------------------

  var dica = null;
  function aoMover(ev) {
    var t = ev.target.closest ? ev.target.closest('[data-t]') : null;
    if (!t || !raiz.contains(t)) {
      if (dica) dica.hidden = true;
      return;
    }
    if (!dica) {
      dica = document.createElement('div');
      dica.className = 'p12r-dica';
      raiz.appendChild(dica);
    }
    dica.textContent = t.getAttribute('data-t');
    dica.hidden = false;
    var x = ev.clientX + 14;
    var y = ev.clientY + 14;
    var w = dica.offsetWidth;
    var h = dica.offsetHeight;
    if (x + w > window.innerWidth - 8) x = ev.clientX - w - 14;
    if (y + h > window.innerHeight - 8) y = ev.clientY - h - 14;
    dica.style.left = Math.max(8, x) + 'px';
    dica.style.top = Math.max(8, y) + 'px';
  }

  // ---- montagem ----------------------------------------------------------------------

  function desmontar() {
    if (raiz && raiz.parentNode) raiz.parentNode.removeChild(raiz);
    raiz = null;
    dica = null;
    estado.ultimoFiltros = null;
    estado.ultimoCorpo = null;
    var marcados = document.querySelectorAll('[data-p12-rel-nativo]');
    for (var i = 0; i < marcados.length; i++) marcados[i].removeAttribute('data-p12-rel-nativo');
  }

  function fundoDaArea(area) {
    try {
      var el = area;
      while (el) {
        var c = getComputedStyle(el).backgroundColor;
        if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c;
        el = el.parentElement;
      }
    } catch (e) {
      /* sem fundo conhecido: o filtro fica transparente */
    }
    return 'transparent';
  }

  function verificar() {
    var rota = /^\/app\/accounts\/(\d+)\/reports\/overview\/?$/.exec(location.pathname);
    var original = /(^|[?&])original=1(&|$)/.test(location.search);
    if (!rota || original) {
      estado.falhou = false;
      return raiz ? desmontar() : null;
    }
    if (estado.falhou) return;
    var nativo = document.querySelector('main .max-w-5xl');
    if (!nativo || !nativo.parentNode) return raiz ? desmontar() : null;
    if (!document.getElementById('p12r-estilo')) {
      var estilo = document.createElement('style');
      estilo.id = 'p12r-estilo';
      // O cartao do funil traz o estilo dele; vem antes, o nosso ajusta por cima.
      estilo.textContent = ((window.__p12Funil && window.__p12Funil.css) || '') + '\n' + CSS;
      document.head.appendChild(estilo);
    }
    if (estado.conta !== rota[1]) {
      estado.conta = rota[1];
      estado.cache = {};
      estado.f = null;
    }
    if (!estado.f) estado.f = filtrosDaUrl(location.search, lerPref());
    if (raiz && (!raiz.isConnected || raiz.nextElementSibling !== nativo)) desmontar();
    if (!raiz) {
      raiz = document.createElement('div');
      raiz.id = 'p12-relatorios';
      raiz.className = 'p12r';
      raiz.innerHTML = '<div id="p12r-topo"></div><div class="p12r-filtros" id="p12r-filtros"></div><div id="p12r-corpo"></div>';
      raiz.addEventListener('click', aoClicar);
      raiz.addEventListener('change', aoMudar);
      raiz.addEventListener('mousemove', aoMover);
      raiz.addEventListener('mouseleave', function () {
        if (dica) dica.hidden = true;
      });
      nativo.parentNode.insertBefore(raiz, nativo);
      estado.ultimoFiltros = null;
      estado.ultimoCorpo = null;
    }
    nativo.setAttribute('data-p12-rel-nativo', 'oculto');
    raiz.style.setProperty('--p12r-bg', fundoDaArea(raiz.parentNode));
    if (!estado.ultimoCorpo) desenhar();
  }

  function logo() {
    try {
      verificar();
    } catch (e) {
      console.debug('[p12-relatorios]', e && e.message);
      estado.falhou = true;
      try {
        desmontar();
      } catch (e2) {
        /* nada a fazer */
      }
    }
  }

  // Clicar em Relatorios no menu abre a pagina nova, sem abrir sub-itens.
  document.addEventListener(
    'click',
    function (ev) {
      var a = ev.target.closest ? ev.target.closest('a[name="Reports"]') : null;
      if (!a || ev.button || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
      var m = /^\/app\/accounts\/(\d+)\//.exec(location.pathname);
      if (!m) return;
      ev.preventDefault();
      ev.stopPropagation();
      navegar('/app/accounts/' + m[1] + '/reports/overview');
    },
    true,
  );

  // Os numeros "de agora" envelhecem: refaz o que e' de agora a cada poucos minutos.
  setInterval(function () {
    if (!raiz) return;
    Object.keys(estado.cache).forEach(function (k) {
      if (k.indexOf('agora:') === 0 || k.indexOf('espera:') === 0) delete estado.cache[k];
    });
    pedirDesenho();
  }, 240000);

  ['pushState', 'replaceState'].forEach(function (nome) {
    var original = history[nome];
    history[nome] = function () {
      var r = original.apply(this, arguments);
      setTimeout(logo, 0);
      return r;
    };
  });
  window.addEventListener('popstate', function () {
    setTimeout(function () {
      estado.f = null;
      logo();
    }, 0);
  });
  setInterval(logo, 400);
  logo();
})();
