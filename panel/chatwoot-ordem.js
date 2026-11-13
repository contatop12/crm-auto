/*
 * Ordem padrao do kanban: "Ultima atividade", decrescente.
 *
 * O Chatwoot guarda a ordem por atendente e por funil (preferences.task_sorting). Quem nunca
 * escolheu fica na ordem manual. Este script grava a ordem padrao so' nos funis em que o
 * atendente ainda nao tem escolha; depois disso vale o que ele escolher na tela.
 *
 * Carregado junto do script das categorias (DASHBOARD_SCRIPTS).
 */
(function () {
  'use strict';
  if (window.__p12Ordem) return;

  var PADRAO = { sort: 'updated_at', order: 'desc' };

  /**
   * O mapa inteiro de ordens a gravar, ou null se nao falta nenhum funil.
   * Vai o mapa inteiro, e nao so' os que faltam, porque nao sabemos se o Chatwoot junta ou troca.
   */
  function ordensAGravar(resposta) {
    var quadros = (resposta && resposta.boards) || [];
    var ja = (resposta && resposta.preferences && resposta.preferences.task_sorting) || {};
    var mapa = {};
    var faltou = [];
    Object.keys(ja).forEach(function (id) {
      mapa[id] = ja[id];
    });
    quadros.forEach(function (q) {
      if (!q || q.id == null || mapa[q.id]) return;
      mapa[q.id] = { sort: PADRAO.sort, order: PADRAO.order };
      faltou.push(String(q.id));
    });
    return faltou.length ? { mapa: mapa, faltou: faltou } : null;
  }

  window.__p12Ordem = { ordensAGravar: ordensAGravar };
  if (typeof document === 'undefined' || !document.documentElement) return;

  function conta() {
    var m = /\/app\/accounts\/(\d+)/.exec(location.pathname);
    return m ? m[1] : null;
  }

  function sessao() {
    try {
      var bruto = document.cookie.split('; ').filter(function (c) {
        return c.indexOf('cw_d_session_info=') === 0;
      })[0];
      if (!bruto) return null;
      var s = JSON.parse(decodeURIComponent(bruto.slice(bruto.indexOf('=') + 1)));
      if (!s['access-token']) return null;
      return {
        'access-token': s['access-token'],
        client: s.client,
        uid: s.uid,
        expiry: s.expiry,
        'token-type': s['token-type'],
        'Content-Type': 'application/json',
      };
    } catch (e) {
      return null;
    }
  }

  var conferidas = {};

  function conferir() {
    var c = conta();
    if (!c || conferidas[c]) return;
    var cab = sessao();
    if (!cab) return;
    conferidas[c] = true;
    var base = '/api/v1/accounts/' + c + '/kanban/';
    fetch(base + 'boards', { headers: cab })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (resposta) {
        var falta = ordensAGravar(resposta);
        if (!falta) return;
        return fetch(base + 'account_user_preferences', {
          method: 'PUT',
          headers: cab,
          body: JSON.stringify({ preferences: { task_sorting: falta.mapa } }),
        }).then(function (r) {
          if (!r.ok) return;
          // O funil aberto ja' foi desenhado na ordem antiga: recarrega uma vez so'.
          var m = /\/kanban\/(\d+)/.exec(location.pathname);
          var chave = 'p12-ordem-recarregou-' + c;
          try {
            if (m && falta.faltou.indexOf(m[1]) >= 0 && conta() === c && !sessionStorage.getItem(chave)) {
              sessionStorage.setItem(chave, '1');
              location.reload();
            }
          } catch (e) {
            /* sem sessionStorage: vale na proxima abertura */
          }
        });
      })
      .catch(function () {
        delete conferidas[c];
      });
  }

  conferir();
  // A conta muda sem recarregar a pagina.
  setInterval(conferir, 3000);
})();
