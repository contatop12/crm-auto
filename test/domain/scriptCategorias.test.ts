import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/** Roda o script num contexto sem tela: so' as funcoes puras interessam aqui. */
function carregar() {
  const window: Record<string, any> = {};
  let observados = 0;
  vm.runInNewContext(readFileSync('panel/chatwoot-categorias.js', 'utf8'), {
    window,
    document: { currentScript: null, body: {}, addEventListener() {} },
    location: { pathname: '/app/accounts/5/dashboard' },
    console,
    URL,
    setTimeout: () => 0,
    MutationObserver: class {
      observe() {
        observados++;
      }
    },
  });
  return { api: window.__p12Categorias, observados: () => observados };
}

const porTitulo = {
  'google-ads': { id: 1, title: 'google-ads', color: '#00f' },
  'preco-da-locacao': { id: 113, title: 'preco-da-locacao', color: '#f00' },
  'valor-do-frete': { id: 114, title: 'valor-do-frete', color: '#f00' },
  betoneira: { id: 200, title: 'betoneira', color: '#fa0' },
};
const categorias = [
  { id: 1, nome: 'Motivo de perda', etiquetas: [113, 114] },
  { id: 2, nome: 'Equipamento', etiquetas: [200] },
  { id: 3, nome: 'Vazia', etiquetas: [] },
];

describe('script do painel', () => {
  test('liga o observador sem quebrar, mesmo fora de um <script src>', () => {
    const { api, observados } = carregar();
    expect(typeof api.agrupar).toBe('function');
    expect(observados()).toBe(1);
  });

  test('agrupa na ordem das categorias, e so as que tem etiqueta no card', () => {
    const { api } = carregar();
    const grupos = api.agrupar(['betoneira', 'google-ads', 'valor-do-frete', 'preco-da-locacao'], categorias, porTitulo);
    expect(JSON.parse(JSON.stringify(grupos))).toEqual([
      {
        nome: 'Motivo de perda',
        etiquetas: [
          { titulo: 'valor-do-frete', cor: '#f00' },
          { titulo: 'preco-da-locacao', cor: '#f00' },
        ],
      },
      { nome: 'Equipamento', etiquetas: [{ titulo: 'betoneira', cor: '#fa0' }] },
    ]);
  });

  test('card sem etiqueta de categoria, ou com etiqueta desconhecida: nada', () => {
    const { api } = carregar();
    expect(api.agrupar(['google-ads'], categorias, porTitulo).length).toBe(0);
    expect(api.agrupar(['nao-existe'], categorias, porTitulo).length).toBe(0);
    expect(api.agrupar([], categorias, porTitulo).length).toBe(0);
  });

  test('sessao: pega so os cabecalhos que importam do cookie', () => {
    const { api } = carregar();
    const cookie = encodeURIComponent(
      JSON.stringify({ 'access-token': 't', client: 'c', uid: 'u', expiry: '1', 'token-type': 'Bearer', server: 'cloudflare' }),
    );
    expect(JSON.parse(JSON.stringify(api.sessaoDoCookie(`x=1; cw_d_session_info=${cookie}; y=2`)))).toEqual({
      'access-token': 't',
      client: 'c',
      uid: 'u',
      expiry: '1',
      'token-type': 'Bearer',
    });
    expect(api.sessaoDoCookie('x=1')).toBeNull();
  });

  test('so age no quadro e na tela de Etiquetas', () => {
    const { api } = carregar();
    const rota = (c: string) => JSON.parse(JSON.stringify(api.rotaAtual(c)));
    expect(rota('/app/accounts/5/kanban/9')).toEqual({ tipo: 'kanban', conta: 5, quadro: 9 });
    expect(rota('/app/accounts/5/kanban/9/task/1159')).toEqual({ tipo: 'kanban', conta: 5, quadro: 9 });
    expect(rota('/app/accounts/5/settings/labels/list')).toEqual({ tipo: 'etiquetas', conta: 5 });
    expect(api.rotaAtual('/app/accounts/5/kanban/overview')).toBeNull();
    expect(api.rotaAtual('/app/accounts/5/dashboard')).toBeNull();
  });

  test('total da etapa: so aceita numero valido, senao fica o do Chatwoot', () => {
    const { api } = carregar();
    expect(api.totalDaEtapa({ meta: { total_count: 0 } })).toBe(0);
    expect(api.totalDaEtapa({ meta: { total_count: 370 } })).toBe(370);
    expect(api.totalDaEtapa({ meta: {} })).toBeNull();
    expect(api.totalDaEtapa({ meta: { total_count: -2 } })).toBeNull();
    expect(api.totalDaEtapa(null)).toBeNull();
  });

  test('visao geral: reconhece a tela e resume os totais do funil', () => {
    const { api } = carregar();
    expect(api.ehVisaoGeral('/app/accounts/8/kanban/overview')).toBe(true);
    expect(api.ehVisaoGeral('/app/accounts/8/kanban/overview/')).toBe(true);
    expect(api.ehVisaoGeral('/app/accounts/8/kanban/12')).toBe(false);
    const r = api.resumirTotais([
      { nome: ' Novo Lead ', total: 3 },
      { nome: 'Qualificando', total: 40 },
      { nome: 'Fechado', total: 0 },
    ]);
    expect(r.porNome).toEqual({ 'Novo Lead': 3, Qualificando: 40, Fechado: 0 });
    expect(r.soma).toBe(43);
    // Etapa sem resposta: o total do funil nao e' confiavel, fica o do Chatwoot.
    const parcial = api.resumirTotais([
      { nome: 'A', total: 5 },
      { nome: 'B', total: null },
    ]);
    expect(parcial.porNome).toEqual({ A: 5 });
    expect(parcial.soma).toBeNull();
    expect(api.resumirTotais([]).soma).toBeNull();
  });

  test('conta vem de qualquer tela do painel', () => {
    const { api } = carregar();
    expect(api.contaDaUrl('/app/accounts/8/dashboard')).toBe(8);
    expect(api.contaDaUrl('/app/accounts/8')).toBe(8);
    expect(api.contaDaUrl('/app/login')).toBeNull();
  });

  test('favoritos: na ordem do Chatwoot, ignorando funil que nao existe mais', () => {
    const { api } = carregar();
    const resposta = {
      boards: [
        { id: 15, name: 'Leads Google Ads' },
        { id: 16, name: 'Orgânico' },
      ],
      preferences: { favorite_board_ids: [16, 99, 15] },
    };
    expect(JSON.parse(JSON.stringify(api.funisFavoritos(resposta)))).toEqual([
      { id: 16, nome: 'Orgânico' },
      { id: 15, nome: 'Leads Google Ads' },
    ]);
    expect(api.funisFavoritos({ boards: resposta.boards, preferences: { favorite_board_ids: [] } }).length).toBe(0);
    expect(api.funisFavoritos({}).length).toBe(0);
    expect(api.funisFavoritos(null).length).toBe(0);
  });

  test('menu: Kanban, Conversas, Chat Interno, Contatos e Relatorios, nessa ordem', () => {
    const { api } = carregar();
    const aqui = '/app/accounts/7/dashboard';
    expect(api.posicaoNoMenu('/app/accounts/7/kanban/overview', aqui)).toBe(1);
    expect(api.posicaoNoMenu('/app/accounts/7/dashboard', aqui)).toBe(2);
    expect(api.posicaoNoMenu('/app/accounts/7/internal-chat', aqui)).toBe(3);
    expect(api.posicaoNoMenu('/app/accounts/7/contacts?page=1', aqui)).toBe(4);
    expect(api.posicaoNoMenu('/app/accounts/7/reports/overview', aqui)).toBe(5);
  });

  test('menu: o resto some, menos o da tela aberta', () => {
    const { api } = carregar();
    const aqui = '/app/accounts/7/conversations/120';
    expect(api.posicaoNoMenu('/app/accounts/7/inbox-view', aqui)).toBeNull();
    expect(api.posicaoNoMenu('/app/accounts/7/campaigns/live_chat', aqui)).toBeNull();
    expect(api.posicaoNoMenu('/app/accounts/7/portals/portals_articles_index', aqui)).toBeNull();
    expect(api.posicaoNoMenu('/app/accounts/7/settings/general', aqui)).toBeNull();
    expect(api.posicaoNoMenu(null, aqui)).toBeNull();
    // Configuracoes aberta pelo endereco: o menu dela continua, no fim.
    expect(api.posicaoNoMenu('/app/accounts/7/settings/general', '/app/accounts/7/settings/labels/list')).toBe(6);
  });
});
