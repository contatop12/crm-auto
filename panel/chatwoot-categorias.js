/**
 * Categorias de etiquetas no painel do Chatwoot.
 *
 * Carregado pelo DASHBOARD_SCRIPTS do Chatwoot, em todas as contas. Nao altera o
 * codigo do Chatwoot: so' acrescenta elementos a tela, e e' servido pelo CRM em
 * /ingest/categorias/script.js, entao corrigir aqui e' um deploy do CRM.
 *
 * Tambem mostra os funis favoritos no menu, com o Kanban fechado, o numero real de
 * cards no cabecalho de cada etapa, e deixa o menu so' com Kanban, Conversas, Chat
 * Interno, Contatos e Relatorios.
 *
 * Regra de ouro: qualquer falha deixa a tela como ela e' sem o script. Nada de
 * erro na tela, nada de excecao solta. Texto vindo da API entra por textContent.
 *
 * Design: docs/superpowers/specs/2026-11-04-categorias-de-etiquetas-design.md
 */
(function () {
  'use strict';
  if (window.__p12Categorias) return;

  var CRM = '';
  try {
    CRM = new URL(document.currentScript.src).origin;
  } catch (e) {
    /* fora de um <script src>, como no teste */
  }

  var RECARREGAR_MS = 60000;
  var CONFERIR_MS = 20000;
  var RECARREGAR_MENU_MS = 300000;
  var CABECALHOS_DA_SESSAO = ['access-token', 'client', 'uid', 'expiry', 'token-type'];

  var estado = {
    conta: null,
    carregado: false,
    carregando: false,
    carregadoEm: 0,
    admin: false,
    categorias: [],
    etiquetas: [],
    porTitulo: {},
    sinais: {},
    conferindo: null,
  };

  // ---- dados --------------------------------------------------------------

  /** Grupos do card, na ordem das categorias. Categoria sem etiqueta no card nao entra. */
  function agrupar(titulos, categorias, porTitulo) {
    return categorias
      .map(function (cat) {
        var etiquetas = [];
        titulos.forEach(function (t) {
          var e = porTitulo[t];
          if (e && cat.etiquetas.indexOf(e.id) !== -1) etiquetas.push({ titulo: e.title, cor: e.color });
        });
        return { nome: cat.nome, etiquetas: etiquetas };
      })
      .filter(function (g) {
        return g.etiquetas.length > 0;
      });
  }

  /** Cabecalhos da sessao do atendente, do cookie que o proprio painel usa. */
  function sessaoDoCookie(cookie) {
    var m = /(?:^|; )cw_d_session_info=([^;]+)/.exec(cookie || '');
    if (!m) return null;
    var tudo = JSON.parse(decodeURIComponent(m[1]));
    var sessao = {};
    CABECALHOS_DA_SESSAO.forEach(function (nome) {
      if (typeof tudo[nome] === 'string') sessao[nome] = tudo[nome];
    });
    return sessao['access-token'] ? sessao : null;
  }

  function sessao() {
    var s = sessaoDoCookie(document.cookie);
    if (!s) throw new Error('sem sessao');
    return s;
  }

  function json(r) {
    if (!r.ok) {
      var e = new Error('HTTP ' + r.status);
      e.status = r.status;
      throw e;
    }
    return r.json();
  }

  /** No CRM a sessao vai dentro do Authorization: os logs do Cloudflare ocultam esse cabecalho. */
  function crm(metodo, caminho, corpo) {
    return fetch(CRM + '/ingest/categorias/' + estado.conta + caminho, {
      method: metodo,
      headers: { Authorization: 'Bearer ' + btoa(JSON.stringify(sessao())), 'Content-Type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    }).then(json);
  }

  function chatwoot(caminho) {
    return fetch('/api/v1/accounts/' + estado.conta + caminho, { headers: sessao() }).then(json);
  }

  function aplicarEtiquetasDaApi(lista) {
    estado.etiquetas = lista;
    estado.porTitulo = {};
    lista.forEach(function (e) {
      estado.porTitulo[e.title] = e;
    });
  }

  function carregar() {
    if (estado.carregando) return;
    estado.carregando = true;
    estado.carregadoEm = Date.now();
    var conta = estado.conta;
    Promise.all([crm('GET', ''), chatwoot('/labels')])
      .then(function (r) {
        if (conta !== estado.conta) return;
        estado.admin = !!r[0].admin;
        estado.categorias = r[0].categorias || [];
        aplicarEtiquetasDaApi((r[1] && r[1].payload) || []);
        estado.carregado = true;
      })
      .catch(function (e) {
        console.debug('[p12-categorias]', e && e.message);
      })
      .then(function () {
        estado.carregando = false;
        agendar();
      });
  }

  // ---- estilo ---------------------------------------------------------------

  // Cores neutras, sem depender das classes do Chatwoot: acompanham claro e escuro.
  var CSS = [
    '.p12-cat-bloco{display:flex;flex-direction:column;gap:4px;pointer-events:none}',
    '.p12-cat-nome{font-size:10px;line-height:1.2;letter-spacing:.05em;text-transform:uppercase;opacity:.6;margin:2px 0}',
    '.p12-cat-chips{display:flex;flex-wrap:wrap;gap:4px}',
    '.p12-cat-chip{display:inline-flex;align-items:center;gap:6px;background:rgba(128,128,128,.16);border-radius:6px;padding:2px 8px;font-size:12px;line-height:18px}',
    '.p12-cat-ponto{width:7px;height:7px;border-radius:50%;flex:none}',
    '.p12-cat-faixa{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 16px}',
    '.p12-cat-faixa-t{font-size:11px;letter-spacing:.06em;text-transform:uppercase;opacity:.6;margin-right:4px}',
    '.p12-cat-item{display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(128,128,128,.3);border-radius:8px;padding:4px 10px;font-size:13px;cursor:grab;background:transparent;color:inherit}',
    '.p12-cat-item.alvo{border-color:#2563eb}',
    '.p12-cat-qtd{opacity:.6;font-size:12px}',
    '.p12-cat-lapis{background:none;border:0;padding:0 2px;margin:0;cursor:pointer;opacity:.6;color:inherit;font-size:13px;line-height:1}',
    '.p12-cat-lapis:hover{opacity:1}',
    '.p12-cat-sel{margin:0;width:auto;min-width:150px;height:30px;padding:2px 8px;font-size:13px;border:1px solid rgba(128,128,128,.35);border-radius:7px;background-color:transparent;color:inherit}',
    '.p12-cat-sel option{color:#111;background:#fff}',
    '.p12-cat-fundo{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px}',
    '.p12-cat-modal{background:#fff;color:#111;border-radius:12px;padding:18px;width:100%;max-width:340px;box-shadow:0 12px 40px rgba(0,0,0,.35)}',
    '.dark .p12-cat-modal{background:#1c1d21;color:#e8e8ea}',
    '.p12-cat-modal h5{margin:0 0 12px;font-size:15px;font-weight:600;color:inherit}',
    '.p12-cat-modal label{display:block;font-size:12px;opacity:.75;margin:0 0 5px;color:inherit}',
    '.p12-cat-modal input{width:100%;margin:0 0 6px;height:36px;padding:6px 10px;font-size:14px;border:1px solid rgba(128,128,128,.4);border-radius:7px;background:transparent;color:inherit}',
    '.p12-cat-erro{min-height:18px;font-size:12px;color:#dc2626;margin:0 0 8px}',
    '.p12-cat-acoes{display:flex;gap:8px;align-items:center;justify-content:flex-end}',
    '.p12-cat-bt{border-radius:8px;padding:7px 12px;font-size:13px;font-weight:500;cursor:pointer;border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit}',
    '.p12-cat-bt.pri{background:#2563eb;border-color:#2563eb;color:#fff}',
    '.p12-cat-bt.exc{color:#dc2626;border-color:transparent;padding-left:0;margin-right:auto}',
    '.p12-cat-bt:disabled{opacity:.5;cursor:default}',
  ].join('');

  function garantirEstilo() {
    if (document.getElementById('p12-cat-estilo')) return;
    var s = document.createElement('style');
    s.id = 'p12-cat-estilo';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function el(tag, classe, texto) {
    var n = document.createElement(tag);
    if (classe) n.className = classe;
    if (texto !== undefined) n.textContent = texto;
    return n;
  }

  // ---- card do kanban --------------------------------------------------------

  /**
   * As etiquetas de cada card, da lista que o proprio quadro ja' carregou. Evita uma
   * chamada por card e pega tambem as que o card esconde quando sao muitas.
   */
  function tarefasDaTela() {
    var tarefas = {};
    document.querySelectorAll('.kanban-column-body > div').forEach(function (d) {
      var comp = d.__draggable_component__;
      var lista = comp && comp.realList;
      if (Array.isArray(lista)) {
        lista.forEach(function (t) {
          if (t && t.id) tarefas[t.id] = t;
        });
      }
    });
    return tarefas;
  }

  /** Folhas do card cujo texto e' exatamente o titulo de uma etiqueta conhecida. */
  function folhasDeEtiqueta(conteudo) {
    var folhas = [];
    conteudo.querySelectorAll('*').forEach(function (n) {
      if (n.children.length || n.closest('[data-p12-cat]')) return;
      var t = (n.textContent || '').trim();
      if (t && estado.porTitulo[t]) folhas.push({ no: n, titulo: t });
    });
    return folhas;
  }

  function montarBloco(grupos, assinatura) {
    var bloco = el('div', 'p12-cat-bloco');
    bloco.setAttribute('data-p12-cat', '');
    bloco.setAttribute('data-assinatura', assinatura);
    grupos.forEach(function (g) {
      var grupo = el('div');
      grupo.appendChild(el('div', 'p12-cat-nome', g.nome));
      var chips = el('div', 'p12-cat-chips');
      g.etiquetas.forEach(function (e) {
        var chip = el('span', 'p12-cat-chip');
        var ponto = el('span', 'p12-cat-ponto');
        ponto.style.backgroundColor = e.cor || '#888';
        chip.appendChild(ponto);
        chip.appendChild(document.createTextNode(e.titulo));
        chips.appendChild(chip);
      });
      grupo.appendChild(chips);
      bloco.appendChild(grupo);
    });
    return bloco;
  }

  function aplicarNoCard(card, tarefas) {
    var m = /\/task\/(\d+)/.exec(card.getAttribute('href') || '');
    var conteudo = card.lastElementChild;
    if (!m || !conteudo || conteudo.tagName === 'HEADER') return;

    var folhas = folhasDeEtiqueta(conteudo);
    var tarefa = tarefas[m[1]];
    var titulos =
      tarefa && Array.isArray(tarefa.labels)
        ? tarefa.labels
        : folhas.map(function (f) {
            return f.titulo;
          });

    var grupos = agrupar(titulos, estado.categorias, estado.porTitulo);
    var atual = conteudo.querySelector(':scope > [data-p12-cat]');
    if (!grupos.length) {
      if (atual) atual.remove();
      return;
    }
    // A assinatura segura o observador: sem mudanca, nao mexe na tela.
    var assinatura = JSON.stringify(grupos);
    if (atual && atual.getAttribute('data-assinatura') === assinatura) return;
    if (atual) atual.remove();

    var bloco = montarBloco(grupos, assinatura);
    // Logo abaixo da linha de etiquetas; sem achar a linha, no fim do card.
    var linha = folhas.length ? folhas[0].no : null;
    while (linha && linha.parentElement !== conteudo) linha = linha.parentElement;
    if (linha) conteudo.insertBefore(bloco, linha.nextSibling);
    else conteudo.appendChild(bloco);
  }

  function aplicarKanban() {
    var cards = document.querySelectorAll('a[data-draggable="true"][href*="/task/"]');
    if (!estado.categorias.length) {
      document.querySelectorAll('[data-p12-cat]').forEach(function (b) {
        b.remove();
      });
      return;
    }
    garantirEstilo();
    var tarefas = tarefasDaTela();
    cards.forEach(function (card) {
      aplicarNoCard(card, tarefas);
    });
  }

  // ---- tela de Etiquetas -----------------------------------------------------

  function acharBotaoAdicionar() {
    var botoes = document.querySelectorAll('button');
    for (var i = 0; i < botoes.length; i++) {
      if (/^\s*(adicionar etiqueta|add label)\s*$/i.test(botoes[i].textContent || '')) return botoes[i];
    }
    return null;
  }

  function categoriaDaEtiqueta(id) {
    for (var i = 0; i < estado.categorias.length; i++) {
      if (estado.categorias[i].etiquetas.indexOf(id) !== -1) return estado.categorias[i];
    }
    return null;
  }

  function existe(id) {
    return estado.etiquetas.some(function (e) {
      return e.id === id;
    });
  }

  function falhou(e) {
    console.debug('[p12-categorias]', e && e.message);
    estado.carregadoEm = 0;
    agendar();
  }

  function abrirModal(categoria) {
    var fundo = el('div', 'p12-cat-fundo');
    var modal = el('div', 'p12-cat-modal');
    modal.appendChild(el('h5', '', categoria ? 'Editar categoria' : 'Criar categoria'));
    modal.appendChild(el('label', '', 'Nome'));
    var campo = el('input');
    campo.type = 'text';
    campo.maxLength = 60;
    campo.value = categoria ? categoria.nome : '';
    modal.appendChild(campo);
    var erro = el('div', 'p12-cat-erro');
    modal.appendChild(erro);
    var acoes = el('div', 'p12-cat-acoes');

    function fechar() {
      fundo.remove();
    }
    function ocupado(sim) {
      acoes.querySelectorAll('button').forEach(function (b) {
        b.disabled = sim;
      });
    }
    function concluir() {
      fechar();
      estado.carregadoEm = 0;
      agendar();
    }

    if (categoria) {
      var excluir = el('button', 'p12-cat-bt exc', 'Excluir');
      excluir.type = 'button';
      var confirmando = false;
      excluir.addEventListener('click', function () {
        if (!confirmando) {
          confirmando = true;
          excluir.textContent = 'Confirmar exclusão';
          erro.textContent = 'As etiquetas voltam para "Sem categoria". Nenhuma etiqueta é apagada.';
          return;
        }
        ocupado(true);
        crm('DELETE', '/' + categoria.id)
          .then(concluir)
          .catch(function () {
            ocupado(false);
            erro.textContent = 'Não foi possível excluir. Tente de novo.';
          });
      });
      acoes.appendChild(excluir);
    }

    var cancelar = el('button', 'p12-cat-bt', 'Cancelar');
    cancelar.type = 'button';
    cancelar.addEventListener('click', fechar);
    acoes.appendChild(cancelar);

    var salvar = el('button', 'p12-cat-bt pri', categoria ? 'Salvar' : 'Criar');
    salvar.type = 'button';
    function enviar() {
      var nome = campo.value.trim();
      if (!nome) {
        erro.textContent = 'Escreva um nome.';
        return;
      }
      ocupado(true);
      (categoria ? crm('PATCH', '/' + categoria.id, { nome: nome }) : crm('POST', '', { nome: nome }))
        .then(concluir)
        .catch(function (e) {
          ocupado(false);
          erro.textContent =
            e && e.status === 409 ? 'Já existe uma categoria com esse nome.' : 'Não foi possível salvar. Tente de novo.';
        });
    }
    salvar.addEventListener('click', enviar);
    campo.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') enviar();
      if (ev.key === 'Escape') fechar();
    });
    acoes.appendChild(salvar);

    modal.appendChild(acoes);
    fundo.appendChild(modal);
    fundo.addEventListener('mousedown', function (ev) {
      if (ev.target === fundo) fechar();
    });
    document.body.appendChild(fundo);
    campo.focus();
  }

  function moverCategoria(idOrigem, idDestino) {
    var cats = estado.categorias.slice();
    var de = cats.findIndex(function (c) {
      return c.id === idOrigem;
    });
    var para = cats.findIndex(function (c) {
      return c.id === idDestino;
    });
    if (de < 0 || para < 0 || de === para) return;
    cats.splice(para, 0, cats.splice(de, 1)[0]);
    estado.categorias = cats;
    agendar();
    crm('PUT', '/ordem', {
      ids: cats.map(function (c) {
        return c.id;
      }),
    }).catch(falhou);
  }

  function montarFaixa(assinatura) {
    var faixa = el('div', 'p12-cat-faixa');
    faixa.setAttribute('data-p12-cat-faixa', '');
    faixa.setAttribute('data-assinatura', assinatura);
    faixa.appendChild(el('span', 'p12-cat-faixa-t', 'Categorias'));
    estado.categorias.forEach(function (cat) {
      var item = el('span', 'p12-cat-item');
      item.draggable = estado.admin;
      item.appendChild(document.createTextNode(cat.nome));
      item.appendChild(el('span', 'p12-cat-qtd', String(cat.etiquetas.filter(existe).length)));
      if (estado.admin) {
        var lapis = el('button', 'p12-cat-lapis', '✎');
        lapis.type = 'button';
        lapis.title = 'Editar categoria';
        lapis.addEventListener('click', function () {
          abrirModal(cat);
        });
        item.appendChild(lapis);
      }
      item.addEventListener('dragstart', function (ev) {
        ev.dataTransfer.setData('text/plain', String(cat.id));
        ev.dataTransfer.effectAllowed = 'move';
      });
      item.addEventListener('dragover', function (ev) {
        ev.preventDefault();
        item.classList.add('alvo');
      });
      item.addEventListener('dragleave', function () {
        item.classList.remove('alvo');
      });
      item.addEventListener('drop', function (ev) {
        ev.preventDefault();
        item.classList.remove('alvo');
        moverCategoria(Number(ev.dataTransfer.getData('text/plain')), cat.id);
      });
      faixa.appendChild(item);
    });
    return faixa;
  }

  function preencherSeletor(sel, etiqueta) {
    var opcoes = [{ id: '', nome: 'Sem categoria' }].concat(estado.categorias);
    var assinatura = JSON.stringify(
      opcoes.map(function (o) {
        return [o.id, o.nome];
      }),
    );
    if (sel.getAttribute('data-assinatura') !== assinatura) {
      sel.setAttribute('data-assinatura', assinatura);
      sel.textContent = '';
      opcoes.forEach(function (o) {
        var op = el('option', '', o.nome);
        op.value = String(o.id);
        sel.appendChild(op);
      });
    }
    var cat = categoriaDaEtiqueta(etiqueta.id);
    var valor = cat ? String(cat.id) : '';
    if (sel.value !== valor) sel.value = valor;
    sel.disabled = !estado.admin;
  }

  function trocarCategoria(etiqueta, valor) {
    var categoria = valor ? Number(valor) : null;
    estado.categorias.forEach(function (c) {
      c.etiquetas = c.etiquetas.filter(function (id) {
        return id !== etiqueta.id;
      });
      if (c.id === categoria) c.etiquetas.push(etiqueta.id);
    });
    agendar();
    crm('PUT', '/etiquetas/' + etiqueta.id, { categoria: categoria }).catch(falhou);
  }

  function aplicarNasLinhas() {
    var principal = document.querySelector('main') || document.body;
    var feitos = 0;
    principal.querySelectorAll('span').forEach(function (span) {
      if (span.children.length || span.closest('[data-p12-cat-faixa]')) return;
      var etiqueta = estado.porTitulo[(span.textContent || '').trim()];
      if (!etiqueta) return;

      // A linha e' o menor bloco com os botoes de editar e excluir.
      var linha = span.closest('tr') || span.parentElement;
      while (linha && linha !== principal && !linha.querySelector('button')) linha = linha.parentElement;
      if (!linha || linha === principal) return;
      // O titulo e' o primeiro texto da linha: a descricao de outra etiqueta pode ter o mesmo texto.
      if (linha.querySelector('span') !== span) return;

      var botoes = linha.querySelectorAll('button');
      var ultimo = botoes[botoes.length - 1];
      var sel = linha.querySelector('select[data-p12-cat-sel]');
      if (!sel) {
        sel = el('select', 'p12-cat-sel');
        sel.setAttribute('data-p12-cat-sel', '');
        sel.title = 'Categoria da etiqueta';
        sel.addEventListener('change', function () {
          trocarCategoria(etiqueta, sel.value);
        });
        ultimo.parentElement.insertBefore(sel, ultimo.parentElement.firstChild);
      }
      preencherSeletor(sel, etiqueta);
      feitos++;
    });
    return feitos;
  }

  function aplicarEtiquetas() {
    var botao = acharBotaoAdicionar();
    if (!botao) return;
    garantirEstilo();

    if (estado.admin && !document.querySelector('[data-p12-cat-criar]')) {
      var criar = el('button', botao.className, '+ Criar categoria');
      criar.type = 'button';
      criar.setAttribute('data-p12-cat-criar', '');
      criar.style.background = 'transparent';
      criar.style.color = 'inherit';
      criar.style.border = '1px solid rgba(128,128,128,.35)';
      criar.style.marginRight = '8px';
      criar.addEventListener('click', function () {
        abrirModal(null);
      });
      botao.parentElement.insertBefore(criar, botao);
    }

    var principal = document.querySelector('main') || document.body;
    var tabela = principal.querySelector('table');
    var atual = document.querySelector('[data-p12-cat-faixa]');
    if (!estado.categorias.length) {
      if (atual) atual.remove();
    } else if (tabela) {
      var assinatura = JSON.stringify([
        estado.admin,
        estado.categorias.map(function (c) {
          return [c.id, c.nome, c.etiquetas.filter(existe).length];
        }),
      ]);
      if (!atual || atual.getAttribute('data-assinatura') !== assinatura) {
        var nova = montarFaixa(assinatura);
        if (atual) atual.replaceWith(nova);
        else tabela.parentElement.insertBefore(nova, tabela);
      }
    }
    aplicarNasLinhas();
  }

  // ---- funis favoritos no menu ------------------------------------------------

  // O favorito e' do proprio Chatwoot, por usuario. O menu so' mostra os favoritos com o
  // Kanban aberto; aqui eles ficam visiveis tambem com o Kanban fechado.
  var menu = { favoritos: [], carregando: false, carregadoEm: 0, emKanban: null };

  /** Funis favoritos do atendente, na ordem em que o Chatwoot os guarda. */
  function funisFavoritos(resposta) {
    var ids = (resposta && resposta.preferences && resposta.preferences.favorite_board_ids) || [];
    var quadros = (resposta && resposta.boards) || [];
    return ids
      .map(function (id) {
        return quadros.filter(function (q) {
          return q.id === id;
        })[0];
      })
      .filter(Boolean)
      .map(function (q) {
        return { id: q.id, nome: q.name };
      });
  }

  function carregarMenu() {
    if (menu.carregando) return;
    menu.carregando = true;
    menu.carregadoEm = Date.now();
    var conta = estado.conta;
    chatwoot('/kanban/boards')
      .then(function (r) {
        if (conta === estado.conta) menu.favoritos = funisFavoritos(r);
      })
      .catch(function (e) {
        console.debug('[p12-categorias]', e && e.message);
      })
      .then(function () {
        menu.carregando = false;
        agendar();
      });
  }

  /** Pelo roteador do painel, sem recarregar a pagina; sem ele, navegacao normal. */
  function navegar(url) {
    try {
      document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(url);
    } catch (e) {
      location.assign(url);
    }
  }

  function montarFavoritos(assinatura) {
    var lista = el('ul', 'grid m-0 list-none min-w-0');
    lista.setAttribute('data-p12-fav', '');
    lista.setAttribute('data-assinatura', assinatura);
    menu.favoritos.forEach(function (f) {
      var url = '/app/accounts/' + estado.conta + '/kanban/' + f.id;
      var item = el('li', 'py-0.5 ps-2 ms-3 relative text-n-slate-11 min-w-0');
      var link = el('a', 'flex items-center gap-2 px-1.5 py-1 rounded-lg h-8 min-w-0 hover:bg-n-alpha-2');
      link.href = url;
      link.title = f.nome;
      var estrela = el('span', '', '★');
      estrela.style.color = '#f5b400';
      estrela.style.flex = 'none';
      link.appendChild(estrela);
      link.appendChild(el('span', 'truncate text-body-main', f.nome));
      link.addEventListener('click', function (ev) {
        if (ev.button || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
        ev.preventDefault();
        ev.stopPropagation();
        navegar(url);
      });
      item.appendChild(link);
      lista.appendChild(item);
    });
    return lista;
  }

  function aplicarMenu() {
    // Favoritar so' acontece no Kanban: basta reler ao entrar ou sair dele, nao a cada conversa.
    var emKanban = /\/kanban(?:\/|$)/.test(location.pathname);
    if (emKanban !== menu.emKanban || Date.now() - menu.carregadoEm > RECARREGAR_MENU_MS) {
      menu.emKanban = emKanban;
      carregarMenu();
    }

    var kanban = document.querySelector('a[href$="/kanban/overview"]');
    var item = kanban && kanban.closest('li');
    if (!item) return;
    var atual = item.querySelector(':scope > ul[data-p12-fav]');
    if (!menu.favoritos.length) {
      if (atual) atual.remove();
      return;
    }
    var assinatura = JSON.stringify([estado.conta, menu.favoritos]);
    if (!atual || atual.getAttribute('data-assinatura') !== assinatura) {
      var nova = montarFavoritos(assinatura);
      if (atual) atual.replaceWith(nova);
      else item.insertBefore(nova, kanban.nextSibling);
      atual = nova;
    }
    // Com o Kanban aberto o proprio menu ja' lista os funis: nao repetir. A lista dele fica no
    // DOM mesmo fechada, por isso olha a altura, nao a existencia.
    var nativo = item.querySelector(':scope > ul:not([data-p12-fav])');
    var exibicao = nativo && nativo.getBoundingClientRect().height > 0 ? 'none' : '';
    if (atual.style.display !== exibicao) atual.style.display = exibicao;
  }

  // ---- menu enxuto -------------------------------------------------------------

  // Em todas as contas e para todos, ate' administrador, o menu mostra so' estes, nesta
  // ordem. O resto some, mas o da tela aberta continua (no fim), para quem abriu
  // Configuracoes pelo endereco conseguir navegar la' dentro. So' marca os itens: a ordem e'
  // CSS `order` na lista, que ja' e' flex; nada sai do lugar no DOM do Vue.
  var MENU = ['kanban', 'dashboard', 'internal-chat', 'contacts', 'reports'];
  var ESTILO_MENU =
    'li[data-p12-menu="x"]{display:none!important}' +
    [1, 2, 3, 4, 5, 6]
      .map(function (n) {
        return 'li[data-p12-menu="' + n + '"]{order:' + n + '}';
      })
      .join('');

  function secaoDoPainel(caminho) {
    var m = /^\/app\/accounts\/\d+\/([^/?#]+)/.exec(caminho || '');
    return m ? m[1] : null;
  }

  /** Posicao do item no menu (1 a 6), ou null para esconder. */
  function posicaoNoMenu(href, caminho) {
    var secao = secaoDoPainel(href);
    if (!secao) return null;
    var i = MENU.indexOf(secao);
    if (i >= 0) return i + 1;
    return secao === secaoDoPainel(caminho) ? MENU.length + 1 : null;
  }

  function aplicarMenuEnxuto() {
    if (!document.getElementById('p12-menu-estilo')) {
      var s = document.createElement('style');
      s.id = 'p12-menu-estilo';
      s.textContent = ESTILO_MENU;
      document.head.appendChild(s);
    }
    var conversas = document.querySelector('nav li > a[href*="/dashboard"]');
    var lista = conversas && conversas.closest('li').parentElement;
    if (!lista) return;
    var itens = Array.prototype.filter.call(lista.children, function (li) {
      return li.tagName === 'LI';
    });
    var marcas = itens.map(function (li) {
      var link = li.firstElementChild;
      var href = link && link.tagName === 'A' ? link.getAttribute('href') : null;
      return posicaoNoMenu(href, location.pathname);
    });
    // Menu mudou de formato e quase nada bate: deixa como o Chatwoot montou.
    var conhecidos = marcas.filter(function (p) {
      return p && p <= MENU.length;
    }).length;
    itens.forEach(function (li, i) {
      var marca = conhecidos >= 3 ? String(marcas[i] || 'x') : null;
      if (li.getAttribute('data-p12-menu') === marca) return;
      if (marca) li.setAttribute('data-p12-menu', marca);
      else li.removeAttribute('data-p12-menu');
    });
  }

  // ---- numero real de cada etapa ----------------------------------------------

  // O numero do cabecalho vem de um contador do Chatwoot que sai de sincronia com a lista
  // (etapa vazia marcando 4, ou ate' -2). A lista e' a verdade: aqui o cabecalho mostra o
  // total dela. Sem resposta da API, fica o numero do Chatwoot.
  var contagem = { quadro: null, reais: {}, carregando: false, carregadoEm: 0, assinatura: null, timer: null };

  function totalDaEtapa(resposta) {
    var n = resposta && resposta.meta && resposta.meta.total_count;
    return typeof n === 'number' && n >= 0 ? n : null;
  }

  /** Total real de cada etapa do funil, pelo nome. soma so' existe se todas as etapas responderam. */
  function resumirTotais(totais) {
    var porNome = {};
    var soma = 0;
    var completo = totais.length > 0;
    totais.forEach(function (x) {
      if (x && x.total !== null && x.total !== undefined) {
        porNome[(x.nome || '').trim()] = x.total;
        soma += x.total;
      } else {
        completo = false;
      }
    });
    return { porNome: porNome, soma: completo ? soma : null };
  }

  function buscarTotais(quadro) {
    return chatwoot('/kanban/boards/' + quadro + '/steps')
      .then(function (r) {
        var etapas = r.steps || [];
        return Promise.all(
          etapas.map(function (e) {
            return chatwoot('/kanban/tasks?board_step_id=' + e.id + '&page=1&per_page=1').then(function (lista) {
              return { nome: e.name, total: totalDaEtapa(lista) };
            });
          }),
        );
      })
      .then(resumirTotais);
  }

  function carregarContagens(quadro) {
    if (contagem.carregando) return;
    contagem.carregando = true;
    contagem.carregadoEm = Date.now();
    buscarTotais(quadro)
      .then(function (resumo) {
        if (contagem.quadro !== quadro) return;
        contagem.reais = resumo.porNome;
      })
      .catch(function (e) {
        console.debug('[p12-categorias]', e && e.message);
      })
      .then(function () {
        contagem.carregando = false;
        agendar();
      });
  }

  /** Muda quando um card entra ou sai de uma coluna: hora de recontar. */
  function assinaturaDasColunas() {
    var partes = [];
    document.querySelectorAll('.kanban-column-body > div').forEach(function (d) {
      var comp = d.__draggable_component__;
      partes.push(comp && Array.isArray(comp.realList) ? comp.realList.length : '-');
    });
    return partes.join(',');
  }

  function acharNumero(cabecalho) {
    var spans = cabecalho.querySelectorAll('span');
    for (var i = 0; i < spans.length; i++) {
      if (!spans[i].children.length && /^-?\d+$/.test((spans[i].textContent || '').trim())) return spans[i];
    }
    return null;
  }

  function aplicarContagens(rota) {
    var assinatura = assinaturaDasColunas();
    if (contagem.quadro !== rota.quadro) {
      contagem.quadro = rota.quadro;
      contagem.reais = {};
      contagem.assinatura = assinatura;
      carregarContagens(rota.quadro);
    } else if (assinatura !== contagem.assinatura) {
      contagem.assinatura = assinatura;
      clearTimeout(contagem.timer);
      contagem.timer = setTimeout(
        seguro(function () {
          carregarContagens(rota.quadro);
        }),
        1500,
      );
    } else if (Date.now() - contagem.carregadoEm > RECARREGAR_MS) {
      carregarContagens(rota.quadro);
    }

    document.querySelectorAll('header h3').forEach(function (h3) {
      var real = contagem.reais[(h3.textContent || '').trim()];
      var cabecalho = h3.closest('header');
      if (real === undefined || !cabecalho) return;
      var numero = acharNumero(cabecalho);
      if (!numero || numero.textContent.trim() === String(real)) return;
      trocarNumero(numero, real);
    });
  }

  /** So' o valor do texto: o no continua sendo o do painel, que segue podendo atualiza-lo. */
  function trocarNumero(numero, real) {
    if (numero.textContent.trim() === String(real)) return;
    for (var i = 0; i < numero.childNodes.length; i++) {
      var no = numero.childNodes[i];
      if (no.nodeType === 3 && /\d/.test(no.nodeValue)) {
        no.nodeValue = String(real);
        return;
      }
    }
  }

  // ---- numero real na visao geral dos funis -------------------------------------
  // Cada cartao e' um <a href=".../kanban/<id>"> com <h2> (titulo) e, ao lado, o total do funil;
  // cada etapa e' um chip <div><div/><span>nome</span><span>numero</span></div>.

  var visao = { conta: null, quadros: {}, carregando: false, carregadoEm: 0, ids: '' };

  function ehVisaoGeral(caminho) {
    return /^\/app\/accounts\/\d+\/kanban\/overview\/?$/.test(caminho);
  }

  function cartoesDaVisao() {
    var lista = [];
    document.querySelectorAll('main a[href*="/kanban/"]').forEach(function (a) {
      var m = /\/kanban\/(\d+)(?:[/?#]|$)/.exec(a.getAttribute('href') || '');
      var h2 = a.querySelector('h2');
      if (m && h2) lista.push({ id: Number(m[1]), a: a, h2: h2 });
    });
    return lista;
  }

  function folhaNumerica(el) {
    return el && el.tagName === 'SPAN' && !el.children.length && /^-?\d+$/.test((el.textContent || '').trim());
  }

  function carregarVisao(ids) {
    if (visao.carregando) return;
    visao.carregando = true;
    visao.carregadoEm = Date.now();
    visao.ids = ids.join(',');
    var conta = estado.conta;
    Promise.all(
      ids.map(function (id) {
        return buscarTotais(id)
          .then(function (resumo) {
            return { id: id, resumo: resumo };
          })
          .catch(function () {
            return null;
          });
      }),
    )
      .then(function (todos) {
        if (conta !== estado.conta) return;
        todos.forEach(function (x) {
          if (x) visao.quadros[x.id] = x.resumo;
        });
      })
      .catch(function (e) {
        console.debug('[p12-categorias]', e && e.message);
      })
      .then(function () {
        visao.carregando = false;
        agendar();
      });
  }

  function aplicarVisao() {
    if (visao.conta !== estado.conta) {
      visao.conta = estado.conta;
      visao.quadros = {};
      visao.carregadoEm = 0;
      visao.ids = '';
    }
    var cartoes = cartoesDaVisao();
    if (!cartoes.length) return;
    var ids = [];
    cartoes.forEach(function (c) {
      if (ids.indexOf(c.id) < 0) ids.push(c.id);
    });
    ids.sort(function (x, y) {
      return x - y;
    });
    if (ids.join(',') !== visao.ids || Date.now() - visao.carregadoEm > RECARREGAR_MS) carregarVisao(ids);

    cartoes.forEach(function (c) {
      var resumo = visao.quadros[c.id];
      if (!resumo) return;
      var total = null;
      var irmaos = c.h2.parentElement ? c.h2.parentElement.children : [];
      for (var i = 0; i < irmaos.length && !total; i++) {
        if (folhaNumerica(irmaos[i])) total = irmaos[i];
      }
      c.a.querySelectorAll('span').forEach(function (n) {
        if (!folhaNumerica(n) || n === total) return;
        var nome = n.previousElementSibling;
        if (!nome || nome.tagName !== 'SPAN' || nome.children.length) return;
        var real = resumo.porNome[(nome.textContent || '').trim()];
        if (real !== undefined) trocarNumero(n, real);
      });
      if (total && resumo.soma !== null) trocarNumero(total, resumo.soma);
    });
  }

  // ---- aviso de quebra -------------------------------------------------------

  function sinalizar(problema) {
    if (estado.sinais[problema]) return;
    estado.sinais[problema] = true;
    crm('POST', '/sinal', { problema: problema }).catch(function () {});
  }

  /** O quadro diz que tem cards, mas o script nao acha nenhum na tela. */
  function conferirKanban(rota) {
    if (!estado.categorias.length) return;
    if (document.querySelector('a[data-draggable="true"][href*="/task/"]')) return;
    chatwoot('/kanban/boards/' + rota.quadro + '/steps')
      .then(function (r) {
        var etapas = (r.steps || r.payload || []).slice(0, 8);
        return etapas.reduce(function (anterior, etapa) {
          return anterior.then(function (achou) {
            if (achou) return true;
            return chatwoot('/kanban/tasks?board_step_id=' + etapa.id + '&page=1&per_page=1').then(function (t) {
              return (t.tasks || []).length > 0;
            });
          });
        }, Promise.resolve(false));
      })
      .then(function (temCards) {
        if (temCards && !document.querySelector('a[data-draggable="true"][href*="/task/"]')) sinalizar('card');
      })
      .catch(function () {});
  }

  function conferirEtiquetas() {
    if (!acharBotaoAdicionar()) {
      sinalizar('etiquetas');
      return;
    }
    if (!estado.etiquetas.length || document.querySelector('select[data-p12-cat-sel]')) return;
    // Busca preenchida pode esconder todas as linhas sem nada estar quebrado.
    var principal = document.querySelector('main') || document.body;
    var buscando = Array.prototype.some.call(principal.querySelectorAll('input'), function (i) {
      return !!i.value;
    });
    if (!buscando) sinalizar('etiquetas');
  }

  function agendarConferencia(rota) {
    var caminho = location.pathname;
    if (estado.conferindo === caminho) return;
    estado.conferindo = caminho;
    setTimeout(
      seguro(function () {
        if (location.pathname !== caminho || !estado.carregado) return;
        if (rota.tipo === 'kanban') conferirKanban(rota);
        else conferirEtiquetas();
      }),
      CONFERIR_MS,
    );
  }

  // ---- ciclo -----------------------------------------------------------------

  function contaDaUrl(caminho) {
    var m = /^\/app\/accounts\/(\d+)(?:\/|$)/.exec(caminho);
    return m ? Number(m[1]) : null;
  }

  function rotaAtual(caminho) {
    var m = /^\/app\/accounts\/(\d+)\/kanban\/(\d+)(?:\/|$)/.exec(caminho);
    if (m) return { tipo: 'kanban', conta: Number(m[1]), quadro: Number(m[2]) };
    m = /^\/app\/accounts\/(\d+)\/settings\/labels(?:\/|$)/.exec(caminho);
    if (m) return { tipo: 'etiquetas', conta: Number(m[1]) };
    return null;
  }

  function seguro(fn) {
    return function () {
      try {
        return fn.apply(this, arguments);
      } catch (e) {
        console.debug('[p12-categorias]', e && e.message);
      }
    };
  }

  var tick = seguro(function () {
    var conta = contaDaUrl(location.pathname);
    if (!conta) return;
    if (estado.conta !== conta) {
      estado.conta = conta;
      estado.carregado = false;
      estado.categorias = [];
      estado.etiquetas = [];
      estado.porTitulo = {};
      estado.carregadoEm = 0;
      menu.favoritos = [];
      menu.carregadoEm = 0;
    }
    seguro(aplicarMenu)();
    seguro(aplicarMenuEnxuto)();

    if (ehVisaoGeral(location.pathname)) {
      seguro(aplicarVisao)();
      return;
    }
    var rota = rotaAtual(location.pathname);
    if (!rota) return;
    // Nao depende do CRM nem de haver categorias.
    if (rota.tipo === 'kanban') seguro(aplicarContagens)(rota);
    if (Date.now() - estado.carregadoEm > RECARREGAR_MS) carregar();
    if (!estado.carregado) return;
    if (rota.tipo === 'kanban') aplicarKanban();
    else aplicarEtiquetas();
    agendarConferencia(rota);
  });

  var timer = null;
  function agendar() {
    if (timer) return;
    timer = setTimeout(function () {
      timer = null;
      tick();
    }, 120);
  }

  function iniciar() {
    new MutationObserver(function () {
      if (contaDaUrl(location.pathname)) agendar();
    }).observe(document.body, { childList: true, characterData: true, subtree: true });
    agendar();
  }

  window.__p12Categorias = {
    agrupar: agrupar,
    sessaoDoCookie: sessaoDoCookie,
    rotaAtual: rotaAtual,
    contaDaUrl: contaDaUrl,
    funisFavoritos: funisFavoritos,
    totalDaEtapa: totalDaEtapa,
    ehVisaoGeral: ehVisaoGeral,
    resumirTotais: resumirTotais,
    posicaoNoMenu: posicaoNoMenu,
  };

  seguro(function () {
    if (document.body) iniciar();
    else document.addEventListener('DOMContentLoaded', seguro(iniciar));
  })();
})();
