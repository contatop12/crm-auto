/**
 * Marca do painel: cor e icone da aba.
 *
 * Vai junto com o chatwoot-categorias.js, no mesmo /ingest/categorias/script.js. O
 * nome e a logo NAO sao daqui: vem do InstallationConfig do Chatwoot (INSTALLATION_NAME,
 * LOGO, LOGO_DARK, LOGO_THUMBNAIL), que e' o lugar deles. O Chatwoot nao tem
 * configuracao de cor, entao a cor e' trocada por CSS:
 *
 *  1. a escala azul do tema (--blue-1..12) passa a apontar para a violeta que o
 *     proprio Chatwoot ja' traz, no claro e no escuro;
 *  2. as regras que trazem o azul da marca escrito (#2781f6) sao lidas do CSS do
 *     Chatwoot e repetidas com a cor nova. Nada e' listado a mao: versao nova do
 *     Chatwoot com classe nova e' coberta sozinha. O resultado fica no localStorage,
 *     pelo nome do arquivo (que muda a cada versao), e a tela ja' abre na cor certa.
 *
 * Mesma regra do outro script: qualquer falha deixa a tela como ela e'.
 */
(function () {
  'use strict';
  if (window.__p12Marca) return;
  window.__p12Marca = true;

  var COR = '#6e56cf';
  var RGB = [110, 86, 207];
  // a escala violeta do tema claro, so' como reserva se o Chatwoot deixar de trazer a dele
  var VIOLETA = [
    '253 252 254', '250 248 255', '244 240 254', '235 228 255', '225 217 255', '212 202 254',
    '194 178 248', '169 153 236', '110 86 207', '100 84 196', '101 85 183', '47 38 95',
  ];
  var AZUL = /#2781f6|(^|[^\d.])39(\s*,\s*|\s+)129(\s*,\s*|\s+)246(?![\d.])/i;
  var GUARDA = 'p12-marca-css-v1';

  var CRM = 'https://crm.sitespdoze.com.br';
  try {
    CRM = new URL(document.currentScript.src).origin;
  } catch (e) {
    /* fora de um <script src> */
  }
  var ICONE = CRM + '/ingest/marca/logo_thumbnail.svg';
  var ICONE_AVISO = CRM + '/ingest/marca/logo_thumbnail_aviso.svg';

  function trocarCor(texto) {
    return texto
      .replace(/#2781f6/gi, COR)
      .replace(/(^|[^\d.])39(\s*,\s*|\s+)129(\s*,\s*|\s+)246(?![\d.])/g, function (_, antes, a, b) {
        return antes + RGB[0] + a + RGB[1] + b + RGB[2];
      });
  }

  /**
   * As regras do CSS que trazem o azul da marca, so' com as declaracoes que o trazem
   * e ja' na cor nova, dentro dos mesmos @media/@supports/@layer.
   */
  function extrair(css) {
    var saida = '';
    var pilha = [];
    var inicio = 0;
    for (var i = 0; i < css.length; i++) {
      var ch = css.charCodeAt(i);
      if (ch === 92) {
        i++; // caractere escapado: `.content-\[\'\'\]` nao abre texto
      } else if (ch === 34 || ch === 39) {
        // texto entre aspas: uma chave ali dentro nao abre bloco
        for (i++; i < css.length && css.charCodeAt(i) !== ch; i++) if (css.charCodeAt(i) === 92) i++;
      } else if (ch === 47 && css.charCodeAt(i + 1) === 42) {
        // comentario (o aviso de licenca sobrevive `a minificacao)
        var fim = css.indexOf('*/', i + 2);
        i = fim < 0 ? css.length : fim + 1;
        inicio = i + 1;
      } else if (ch === 123) {
        if (pilha.length) pilha[pilha.length - 1].folha = false;
        pilha.push({ cabeca: css.slice(inicio, i).trim(), corpo: i + 1, folha: true });
        inicio = i + 1;
      } else if (ch === 125) {
        var bloco = pilha.pop();
        inicio = i + 1;
        if (!bloco || !bloco.folha || bloco.cabeca.charAt(0) === '@') continue;
        var corpo = css.slice(bloco.corpo, i);
        if (!AZUL.test(corpo)) continue;
        var quadros = pilha.some(function (p) { return /^@(-\w+-)?keyframes/.test(p.cabeca); });
        if (quadros) continue; // repetir um quadro so' trocaria a animacao inteira por ele
        var declaracoes = corpo.split(';').filter(function (d) { return AZUL.test(d); }).map(trocarCor).join(';');
        var regra = bloco.cabeca + '{' + declaracoes + '}';
        for (var p = pilha.length - 1; p >= 0; p--) regra = pilha[p].cabeca + '{' + regra + '}';
        saida += regra;
      } else if (ch === 59) {
        inicio = i + 1;
      }
    }
    return saida;
  }

  // exposto para o teste; no painel ninguem usa
  window.__p12MarcaExtrair = extrair;

  var cabeca = document.head || document.documentElement;
  if (!cabeca || !cabeca.appendChild) return;

  function folha(id) {
    var e = document.getElementById(id);
    if (!e) {
      e = document.createElement('style');
      e.id = id;
      cabeca.appendChild(e);
    }
    return e;
  }

  var escala = folha('p12-marca-escala');
  escala.textContent =
    ':root,.dark{' +
    VIOLETA.map(function (v, i) {
      return '--blue-' + (i + 1) + ':var(--violet-' + (i + 1) + ',' + v + ')';
    }).join(';') +
    ';--text-blue:var(--violet-12,47 38 95);--solid-blue:var(--violet-4,235 228 255)' +
    ';--border-blue:' + RGB.join(', ') + ', .5}' +
    // estas duas sao a escala do tema oposto: fortes no claro, claras no escuro
    ':root{--border-blue-strong:60 46 105}.dark{--border-blue-strong:225 217 255}';

  var troca = folha('p12-marca-troca');
  var guardado = {};
  try {
    guardado = JSON.parse(localStorage.getItem(GUARDA) || '{}') || {};
  } catch (e) {
    guardado = {};
  }
  var vistos = {};

  /** As folhas da marca valem por virem depois das do Chatwoot: precisam ser as ultimas. */
  function ficarPorUltimo() {
    if (cabeca.lastElementChild === troca) return;
    cabeca.appendChild(escala);
    cabeca.appendChild(troca);
  }

  function pintar() {
    var css = '';
    for (var h in guardado) css += guardado[h] || '';
    if (troca.textContent !== css) troca.textContent = css;
    ficarPorUltimo();
  }

  function guardar() {
    var chaves = Object.keys(guardado);
    // versao antiga do Chatwoot deixa arquivos que nao existem mais
    if (chaves.length > 40) chaves.forEach(function (h) { if (!vistos[h]) delete guardado[h]; });
    try {
      localStorage.setItem(GUARDA, JSON.stringify(guardado));
    } catch (e) {
      /* sem localStorage: extrai de novo na proxima visita */
    }
  }

  function processar(link) {
    var href = link && link.href;
    if (!href || vistos[href]) return;
    try {
      if (new URL(href).origin !== location.origin) return;
    } catch (e) {
      return;
    }
    vistos[href] = true;
    if (Object.prototype.hasOwnProperty.call(guardado, href)) return;
    fetch(href, { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.text() : Promise.reject(new Error(String(r.status))); })
      .then(function (css) {
        guardado[href] = extrair(css);
        guardar();
        pintar();
      })
      .catch(function () {
        delete vistos[href]; // tenta de novo se a folha reaparecer
      });
  }

  /**
   * O Chatwoot troca o icone da aba pelo de "conversa nao lida" e de volta, sempre
   * pelos arquivos dele. O da marca acompanha: com ponto vermelho quando o dele tem.
   */
  function icones() {
    var links = document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]');
    for (var i = 0; i < links.length; i++) {
      var atual = links[i].getAttribute('href') || '';
      if (atual === ICONE || atual === ICONE_AVISO) continue;
      links[i].setAttribute('href', /badge/i.test(atual) ? ICONE_AVISO : ICONE);
      // `sizes` fica: e' por ele que o Chatwoot monta o nome do icone de nao lida
      links[i].setAttribute('type', 'image/svg+xml');
    }
    var tema = document.querySelector('meta[name="theme-color"]');
    if (tema && tema.getAttribute('content') !== COR) tema.setAttribute('content', COR);
  }

  function seguro(f) {
    return function () {
      try {
        return f.apply(this, arguments);
      } catch (e) {
        /* a tela fica como e' */
      }
    };
  }

  seguro(function () {
    pintar();
    var folhas = document.querySelectorAll('link[rel="stylesheet"]');
    for (var i = 0; i < folhas.length; i++) processar(folhas[i]);
    icones();

    if (typeof MutationObserver !== 'function') return;
    new MutationObserver(seguro(function (mudancas) {
      for (var m = 0; m < mudancas.length; m++) {
        var novos = mudancas[m].addedNodes || [];
        for (var n = 0; n < novos.length; n++) {
          if (novos[n].tagName === 'LINK' && /stylesheet/i.test(novos[n].rel || '')) processar(novos[n]);
        }
      }
      ficarPorUltimo();
      icones();
    })).observe(cabeca, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
  })();
})();
