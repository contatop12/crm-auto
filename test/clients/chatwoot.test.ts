import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { ChatwootClient, CardSemId } from '../../src/clients/chatwoot';

type Chamada = { metodo: string; url: string; corpo: unknown };
let chamadas: Chamada[];
let respostas: Array<unknown>;

beforeEach(() => {
  chamadas = [];
  respostas = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    chamadas.push({
      metodo: init?.method ?? 'GET',
      url: String(url),
      corpo: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return Response.json(respostas.length ? respostas.shift() : {});
  });
});
afterEach(() => vi.unstubAllGlobals());

const cliente = () => new ChatwootClient('https://cw.exemplo.test', 'tok');
const CONVERSA = '/api/v1/accounts/7/conversations/55/messages';

describe('criarCard', () => {
  const dados = {
    titulo: '#12 - 5511999990000 - Vital',
    boardId: 3,
    stepId: 31,
    conversas: [55],
    contatos: [9],
    atributos: { ciclo: '2' },
  };

  test('manda o POST com o corpo que a API do Kanban espera e devolve o id', async () => {
    respostas = [{ id: 88 }];
    const id = await cliente().criarCard(7, dados);
    expect(id).toBe(88);
    expect(chamadas).toEqual([
      {
        metodo: 'POST',
        url: 'https://cw.exemplo.test/api/v1/accounts/7/kanban/tasks',
        corpo: {
          task: {
            title: '#12 - 5511999990000 - Vital',
            board_id: 3,
            board_step_id: 31,
            conversation_ids: [55],
            contact_ids: [9],
            custom_attributes: { ciclo: '2' },
          },
        },
      },
    ]);
  });

  test('aceita a resposta embrulhada em payload ou task', async () => {
    respostas = [{ payload: { id: 91 } }, { task: { id: 92 } }];
    expect(await cliente().criarCard(7, dados)).toBe(91);
    expect(await cliente().criarCard(7, dados)).toBe(92);
  });

  test('sem id numerico na resposta, falha com erro claro', async () => {
    respostas = [{ ok: true }];
    await expect(cliente().criarCard(7, dados)).rejects.toThrow(/sem id/);
  });

  test('id que vem como texto numerico serve', async () => {
    respostas = [{ id: '88' }, { payload: { id: '91' } }];
    expect(await cliente().criarCard(7, dados)).toBe(88);
    expect(await cliente().criarCard(7, dados)).toBe(91);
  });

  test('2xx sem id que preste: erro proprio (CardSemId), que quem chama distingue', async () => {
    // o card pode ter nascido: tentar de novo criaria o segundo
    respostas = [{ ok: true }, { id: 'abc' }, { id: 0 }];
    for (let i = 0; i < 3; i++) await expect(cliente().criarCard(7, dados)).rejects.toBeInstanceOf(CardSemId);
  });
});

describe('mesclarAtributosDaConversa', () => {
  const ATRIBUTOS = 'https://cw.exemplo.test/api/v1/accounts/7/conversations/55/custom_attributes';

  test('remover tira as chaves do objeto mesclado e mantem as outras', async () => {
    // o POST substitui o objeto inteiro: tirar a chave e' nao manda-la
    respostas = [{ custom_attributes: { protocolo: 'X', gclid: 'Cj0velho', funil: 'Lead', conversa_enviada: 'true' } }];
    await cliente().mesclarAtributosDaConversa(7, 55, { protocolo: 'X-R1' }, ['gclid']);
    expect(chamadas[1]).toEqual({
      metodo: 'POST',
      url: ATRIBUTOS,
      corpo: { custom_attributes: { protocolo: 'X-R1', funil: 'Lead', conversa_enviada: 'true' } },
    });
  });

  test('so remover, sem nada novo, ainda grava', async () => {
    respostas = [{ custom_attributes: { gclid: 'Cj0velho', funil: 'Lead' } }];
    await cliente().mesclarAtributosDaConversa(7, 55, {}, ['gclid']);
    expect(chamadas.map((c) => c.metodo)).toEqual(['GET', 'POST']);
    expect(chamadas[1]?.corpo).toEqual({ custom_attributes: { funil: 'Lead' } });
  });

  test('nada novo e nada a remover: nem chama a API', async () => {
    await cliente().mesclarAtributosDaConversa(7, 55, {});
    expect(chamadas).toEqual([]);
  });
});

describe('ligarConversasDoCard', () => {
  test('manda PUT so com as conversas', async () => {
    await cliente().ligarConversasDoCard(7, 88, [55, 56]);
    expect(chamadas).toEqual([
      {
        metodo: 'PUT',
        url: 'https://cw.exemplo.test/api/v1/accounts/7/kanban/tasks/88',
        corpo: { task: { conversation_ids: [55, 56] } },
      },
    ]);
  });

  test('lista vazia desliga o card da conversa', async () => {
    await cliente().ligarConversasDoCard(7, 88, []);
    expect(chamadas[0]?.corpo).toEqual({ task: { conversation_ids: [] } });
  });
});

describe('mensagemAnteriorDoLead', () => {
  test('ignora a mensagem antesDe e as do vendedor; devolve a do lead mais nova em ms', async () => {
    respostas = [
      {
        payload: [
          { id: 40, message_type: 1, created_at: 3000 }, // vendedor
          { id: 38, message_type: 0, private: true, created_at: 2900 }, // nota interna
          { id: 35, message_type: 0, created_at: 2000 },
          { id: 30, message_type: 0, created_at: 1000 },
        ],
      },
    ];
    const t = await cliente().mensagemAnteriorDoLead(7, 55, 41);
    expect(t).toBe(2_000_000);
    expect(chamadas[0]?.url).toBe(`https://cw.exemplo.test${CONVERSA}?before=41`);
  });

  test('pagina para tras com o menor id da pagina ate achar', async () => {
    respostas = [
      { payload: [{ id: 40, message_type: 1, created_at: 3000 }, { id: 21, message_type: 1, created_at: 2000 }] },
      { payload: [{ id: 15, message_type: 0, created_at: 500 }] },
    ];
    expect(await cliente().mensagemAnteriorDoLead(7, 55, 41)).toBe(500_000);
    expect(chamadas.map((c) => c.url)).toEqual([
      `https://cw.exemplo.test${CONVERSA}?before=41`,
      `https://cw.exemplo.test${CONVERSA}?before=21`,
    ]);
  });

  test('pagina vazia ou teto de paginas sem achar devolve null', async () => {
    respostas = [{ payload: [] }];
    expect(await cliente().mensagemAnteriorDoLead(7, 55, 41)).toBeNull();

    chamadas = [];
    respostas = [
      { payload: [{ id: 30, message_type: 1, created_at: 1 }] },
      { payload: [{ id: 20, message_type: 1, created_at: 1 }] },
      { payload: [{ id: 10, message_type: 0, created_at: 1 }] },
    ];
    expect(await cliente().mensagemAnteriorDoLead(7, 55, 41, 2)).toBeNull();
    expect(chamadas).toHaveLength(2);
  });
});

describe('textosDoVendedor', () => {
  const msgs = [
    { id: 30, message_type: 1, content: ' antiga ', created_at: 1000 },
    { id: 31, message_type: 0, content: 'do lead', created_at: 1500 },
    { id: 32, message_type: 1, content: 'nova', created_at: 2000 },
    { id: 33, message_type: 1, private: true, content: 'nota', created_at: 2100 },
  ];

  test('sem desde devolve todos os textos do vendedor, do mais antigo ao mais novo', async () => {
    respostas = [{ payload: msgs }, { payload: [] }];
    expect(await cliente().textosDoVendedor(7, 55)).toEqual(['antiga', 'nova']);
  });

  test('com desde (ms) corta as mais antigas', async () => {
    respostas = [{ payload: msgs }, { payload: [] }];
    expect(await cliente().textosDoVendedor(7, 55, 10, 1_500_000)).toEqual(['nova']);
  });

  test('com desde, para de paginar quando a pagina inteira e anterior', async () => {
    respostas = [
      { payload: [{ id: 30, message_type: 1, content: 'a', created_at: 1000 }] },
      { payload: [{ id: 20, message_type: 1, content: 'b', created_at: 500 }] },
    ];
    expect(await cliente().textosDoVendedor(7, 55, 10, 5_000_000)).toEqual([]);
    expect(chamadas).toHaveLength(1);
  });
});
