import { describe, test, expect } from 'vitest';
import { resumirEvento, nomeDoPipeline } from '../../src/domain/resumoEvento';

const BOARDS = { organico: 6, funil: 7 };

/** Webhook de mensagem do Chatwoot, na forma que a Vita manda hoje. */
function incoming(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    event: 'message_created',
    message_type: 'incoming',
    inbox: { id: 4, name: 'Vita Áudio' },
    conversation: {
      id: 812,
      created_at: 1_700_000_000,
      last_activity_at: 1_700_000_100,
      messages: [{ created_at: 1_700_000_060, content: 'oi' }],
      custom_attributes: { protocolo: 'VITA-2026-0001', conversa_enviada: true },
      labels: ['google-ads', 'p-max'],
      meta: { sender: { name: 'Maria Aparecida da Silva', phone_number: '+5511915714026' } },
      kanban_task: {
        board_id: 7,
        board: { id: 7, name: 'Vendas' },
        board_step: { id: 31, name: 'Qualificando' },
      },
      ...over,
    },
  });
}

describe('resumirEvento', () => {
  test('diz quem e de onde, sem abrir o payload', () => {
    const r = resumirEvento(incoming(), BOARDS);
    expect(r.quem).toBe('Maria A.');
    expect(r.conversaId).toBe(812);
    expect(r.inbox).toBe('Vita Áudio');
    expect(r.board).toBe('Vendas');
    expect(r.etapa).toBe('Qualificando');
    expect(r.protocolo).toBe('VITA-2026-0001');
    expect(r.etiquetas).toEqual(['google-ads', 'p-max']);
    expect(r.autor).toBe('lead');
  });

  test('o telefone sai mascarado', () => {
    // a lista junta os leads de todos os clientes; o numero inteiro so' no revelar
    const r = resumirEvento(incoming(), BOARDS);
    expect(r.telefone).toBe('+5511*******26');
    expect(r.telefone).not.toContain('915714');
  });

  test('o nome sai encurtado', () => {
    expect(resumirEvento(incoming(), BOARDS).quem).toBe('Maria A.');
    const so1 = incoming({ meta: { sender: { name: 'Joana' } } });
    expect(resumirEvento(so1, BOARDS).quem).toBe('Joana');
  });

  test('lead novo e conversa em andamento se separam pela idade da conversa', () => {
    // 60s entre a conversa nascer e a mensagem chegar
    expect(resumirEvento(incoming(), BOARDS).momento).toBe('lead novo');

    const velha = incoming({
      created_at: 1_700_000_000,
      messages: [{ created_at: 1_700_086_400 }],
    });
    const r = resumirEvento(velha, BOARDS);
    expect(r.momento).toBe('conversa em andamento');
    expect(r.idadeConversa).toBe(86_400);
  });

  test('sem data da mensagem cai no ultimo movimento da conversa', () => {
    const r = resumirEvento(incoming({ messages: [] }), BOARDS);
    expect(r.idadeConversa).toBe(100);
    expect(r.momento).toBe('lead novo');
  });

  test('o board manda na origem, nao o protocolo', () => {
    expect(resumirEvento(incoming(), BOARDS).origem).toBe('anuncio');

    // card no board de entrada: e' organico mesmo tendo protocolo herdado
    const org = incoming({
      kanban_task: { board_id: 6, board: { id: 6, name: 'Orgânico' } },
    });
    expect(resumirEvento(org, BOARDS).origem).toBe('organico');
  });

  test('sem board cadastrado, o protocolo decide', () => {
    const semBoards = { organico: null, funil: null };
    expect(resumirEvento(incoming(), semBoards).origem).toBe('anuncio');
  });

  test('sem protocolo e sem board a origem fica em branco, nao "organico"', () => {
    // o protocolo chega depois do primeiro webhook: a ausencia nao prova nada
    const sem = incoming({ custom_attributes: {}, kanban_task: {} });
    expect(resumirEvento(sem, { organico: null, funil: null }).origem).toBeNull();
  });

  test('marca a conversa que ja teve conversao enviada', () => {
    expect(resumirEvento(incoming(), BOARDS).conversaEnviada).toBe(true);
    const nao = incoming({ custom_attributes: { protocolo: 'X' } });
    expect(resumirEvento(nao, BOARDS).conversaEnviada).toBe(false);
  });

  test('mensagem do vendedor traz o nome do agente', () => {
    const saida = JSON.stringify({
      message_type: 'outgoing',
      sender: { available_name: 'Ryan Pereira', name: 'Ryan' },
      conversation: { id: 5, meta: { sender: { name: 'Ana Souza' } } },
    });
    const r = resumirEvento(saida, BOARDS);
    expect(r.autor).toBe('Ryan P.');
    // o lead continua sendo o lead, nao o vendedor
    expect(r.quem).toBe('Ana S.');
  });

  test('a conversa na raiz tambem e lida — e o envelope da regra de automacao', () => {
    const daRegra = JSON.stringify({
      id: 900,
      meta: { sender: { name: 'Carlos Dias' } },
      kanban_task: { board_id: 7, board: { id: 7, name: 'Vendas' }, board_step: { name: 'Negociação' } },
    });
    const r = resumirEvento(daRegra, BOARDS);
    expect(r.conversaId).toBe(900);
    expect(r.etapa).toBe('Negociação');
    expect(r.origem).toBe('anuncio');
  });

  test('payload ilegivel devolve resumo vazio em vez de derrubar a lista', () => {
    for (const lixo of ['', null, undefined, 'nao e json', '[]', '"texto"', '42']) {
      const r = resumirEvento(lixo as string | null);
      expect(r.quem, String(lixo)).toBeNull();
      expect(r.etiquetas).toEqual([]);
      expect(r.conversaEnviada).toBe(false);
    }
  });

  test('campo com tipo inesperado nao vira lixo na tela', () => {
    const torto = JSON.stringify({
      conversation: { id: 'nao-numero', labels: 'nao-array', meta: 7, kanban_task: [] },
    });
    const r = resumirEvento(torto, BOARDS);
    expect(r.conversaId).toBeNull();
    expect(r.etiquetas).toEqual([]);
    expect(r.board).toBeNull();
  });
});

describe('nomeDoPipeline', () => {
  test('traduz o evento para o que aconteceu com o cliente', () => {
    expect(nomeDoPipeline('click', null)).toBe('clique no anúncio');
    expect(nomeDoPipeline('kanban', 'qualquer')).toBe('mudança de etapa');
    expect(nomeDoPipeline('chatwoot', 'conversation_created')).toBe('conversa criada');
    expect(nomeDoPipeline('chatwoot', 'message_incoming')).toBe('mensagem do lead');
    expect(nomeDoPipeline('chatwoot', 'message_created')).toBe('mensagem do lead');
    expect(nomeDoPipeline('chatwoot', 'message_outgoing')).toBe('resposta do vendedor');
    expect(nomeDoPipeline('chatwoot', 'desconhecido')).toBe('sem pipeline');
  });
});

describe('nome que na verdade e telefone', () => {
  // metade dos eventos reais da Vita: contato que o vendedor nunca nomeou vem
  // com o proprio numero no campo `name`. Mascarar so' `phone_number` deixava
  // o telefone inteiro na tela.
  const semNome = (name: string) =>
    JSON.stringify({ conversation: { id: 37, meta: { sender: { name } } } });

  test('numero no lugar do nome sai mascarado', () => {
    const r = resumirEvento(semNome('554497081266'));
    expect(r.quem).toBe('55********66');
    expect(r.quem).not.toContain('449708');
  });

  test('numero formatado tambem', () => {
    expect(resumirEvento(semNome('+55 (44) 99708-1266')).quem).toBe('+5544*******66');
  });

  test('nome de gente com numero nao e confundido', () => {
    expect(resumirEvento(semNome('Ana Paula 2')).quem).toBe('Ana P.');
    expect(resumirEvento(semNome('Loja 24 Horas Ltda')).quem).toBe('Loja 2.');
  });
});
