import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { fakeD1 } from '../helpers/fakeD1';
import { moverPelaResposta } from '../../src/pipelines/sellerMessage';
import type { Env } from '../../src/env';

const FUNIL = 7;

function cenario() {
  const { d1, exec, consultar } = fakeD1();
  exec(`INSERT INTO tenants (id, slug, nome, ativo) VALUES (1, 'vita', 'Vita', 1)`);
  exec(`INSERT INTO tenant_config (tenant_id, cw_account_id, cw_board_funil_id, ingest_key)
        VALUES (1, 2, ${FUNIL}, 'k')`);
  // funil da Vita, com os ids reais de etapa no Chatwoot
  for (const [id, pos, nome, final, auto, step] of [
    [1, 1, 'Novo Lead', 0, 0, 27],
    [2, 2, 'Qualificando', 0, 1, 28],
    [3, 3, 'Agendamento Realizado', 0, 0, 29],
    [4, 4, 'Testando o Produto', 0, 0, 34],
    [5, 5, 'Oportunidade Perdida', 1, 0, 31],
  ] as const) {
    exec(`INSERT INTO funnel_stages (id, tenant_id, posicao, nome, cw_step_id, is_final, auto_on_reply)
          VALUES (${id}, 1, ${pos}, '${nome}', ${step}, ${final}, ${auto})`);
  }
  exec(`INSERT INTO stage_triggers (tenant_id, stage_id, frase) VALUES (1, 3, 'sua consulta ficou confirmada para')`);
  exec(`INSERT INTO stage_triggers (tenant_id, stage_id, frase) VALUES (1, 4, 'estou passando para saber como esta a adaptacao')`);
  return { env: { DB: d1, CHATWOOT_BASE_URL: 'https://cw.teste', CHATWOOT_API_TOKEN: 'tok' } as unknown as Env, consultar, exec };
}

const msg = (over: Record<string, unknown> = {}, task: Record<string, unknown> = {}) =>
  JSON.stringify({
    message_type: 'outgoing',
    private: false,
    content: 'Olá! Sua consulta ficou confirmada para terça às 14h.',
    conversation: {
      id: 76,
      kanban_task: { id: 1421, board_id: FUNIL, board_step: { name: 'Qualificando' }, ...task },
      ...over.conversation as object,
    },
    ...over,
  });

let chamadas: Array<{ metodo: string; url: string; corpo: unknown }>;

beforeEach(() => {
  chamadas = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const metodo = init.method ?? 'GET';
    chamadas.push({ metodo, url: String(url), corpo: init.body ? JSON.parse(String(init.body)) : null });
    if (metodo === 'GET') return Response.json({ custom_attributes: {} });
    return Response.json({ ok: true });
  });
});
afterEach(() => vi.unstubAllGlobals());

const moveu = () => chamadas.find((c) => /\/move$/.test(c.url));

describe('moverPelaResposta', () => {
  test('o card criado DEPOIS do webhook ainda e encontrado', async () => {
    // O payload e' o retrato de quando a mensagem chegou. Se o vendedor
    // responde nos segundos entre a conversa nascer e o card ser criado, o
    // retrato vem sem card e a resposta se perdia. Aconteceu com a conversa 389
    // da Persianas: tres respostas ignoradas, card parado em "Novo Lead".
    const { env } = cenario();
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      const metodo = init.method ?? 'GET';
      chamadas.push({ metodo, url: String(url), corpo: init.body ? JSON.parse(String(init.body)) : null });
      if (/\/conversations\/76$/.test(String(url))) {
        return Response.json({ id: 76, kanban_task: { id: 1421, board_id: FUNIL, board_step: { name: 'Qualificando' } } });
      }
      if (metodo === 'GET') return Response.json({ custom_attributes: {} });
      return Response.json({ ok: true });
    });

    const r = await moverPelaResposta(env, 1, msg({ conversation: { id: 76 } }));
    expect(r.status).toBe('ok');
    expect(moveu()).toBeTruthy();
  });

  test('sem card nem depois de perguntar, segue ignorado', async () => {
    const { env } = cenario();
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      chamadas.push({ metodo: init.method ?? 'GET', url: String(url), corpo: null });
      if (/\/conversations\/76$/.test(String(url))) return Response.json({ id: 76 });
      return Response.json({ ok: true });
    });
    const r = await moverPelaResposta(env, 1, msg({ conversation: { id: 76 } }));
    expect(r.status).toBe('ignorado');
    expect(r.motivo).toMatch(/sem card/);
  });

  test('a frase move o card para a etapa dela', async () => {
    const { env } = cenario();
    const r = await moverPelaResposta(env, 1, msg());
    expect(r.status).toBe('ok');
    expect(r.motivo).toMatch(/Agendamento Realizado/);
    // manda o id do Chatwoot, não o nosso id interno
    expect(moveu()!.corpo).toEqual({ board_step_id: 29 });
  });

  test('resposta comum leva à etapa de atendimento', async () => {
    const { env } = cenario();
    const r = await moverPelaResposta(env, 1, msg(
      { content: 'bom dia, tudo bem?' },
      { board_step: { name: 'Novo Lead' } },
    ));
    expect(r.status).toBe('ok');
    expect(moveu()!.corpo).toEqual({ board_step_id: 28 });
  });

  test('resposta comum NÃO puxa o card para trás', async () => {
    // um lead em Agendamento não volta para Qualificando a cada mensagem
    const { env } = cenario();
    const r = await moverPelaResposta(env, 1, msg(
      { content: 'bom dia' },
      { board_step: { name: 'Agendamento Realizado' } },
    ));
    expect(r.status).toBe('ignorado');
    expect(moveu()).toBeUndefined();
  });

  test('frase de etapa anterior não regride o card', async () => {
    const { env } = cenario();
    const r = await moverPelaResposta(env, 1, msg(
      {},
      { board_step: { name: 'Testando o Produto' } },
    ));
    expect(r.status).toBe('ignorado');
    expect(moveu()).toBeUndefined();
  });

  test('mensagem privada não move nada', async () => {
    // nota interna do vendedor para o time; mover por isso seria mover por bilhete
    const { env } = cenario();
    const r = await moverPelaResposta(env, 1, msg({ private: true }));
    expect(r.status).toBe('ignorado');
    expect(r.motivo).toMatch(/privada/);
    expect(chamadas).toEqual([]);
  });

  test('card fora do funil de Ads não é movido', async () => {
    // o Orgânico tem uma coluna só: não há para onde avançar
    const { env } = cenario();
    const r = await moverPelaResposta(env, 1, msg({}, { board_id: 8 }));
    expect(r.status).toBe('ignorado');
    expect(r.motivo).toMatch(/nao no funil de Ads/);
  });

  test('resposta sem texto não casa frase nenhuma', async () => {
    const { env } = cenario();
    expect((await moverPelaResposta(env, 1, msg({ content: '' }))).status).toBe('ignorado');
  });

  test('registra a decisão mesmo quando NÃO move', async () => {
    // era esse silêncio que escondia o bug do "Qualificando" no n8n
    const { env, consultar } = cenario();
    await moverPelaResposta(env, 1, msg({ content: 'bom dia' }, { board_step: { name: 'Agendamento Realizado' } }));

    const [m] = consultar<{ moveu: number; etapa_de: string; etapa_para: string; motivo: string }>(
      'SELECT moveu, etapa_de, etapa_para, motivo FROM card_moves',
    );
    expect(m!.moveu).toBe(0);
    expect(m!.etapa_de).toBe('Agendamento Realizado');
    expect(m!.motivo).toBeTruthy();
  });

  test('captura o valor da proposta e grava no card', async () => {
    const { env, exec } = cenario();
    // `.source` porque a barra invertida não sobrevive a ser digitada duas vezes
    const padrao = /R?\$?\s*([\d][\d.,]*)/.source;
    exec(`INSERT INTO value_patterns (tenant_id, posicao, regex, valor_minimo)
          VALUES (1, 1, '${padrao}', 100)`);
    const r = await moverPelaResposta(env, 1, msg({
      content: 'Sua consulta ficou confirmada para terça. O valor é R$ 2.500,00',
    }));
    const attrs = chamadas.find((c) => c.metodo === 'PUT')?.corpo as { task: { custom_attributes: Record<string, string> } };
    expect(attrs.task.custom_attributes.valor_proposta).toBe('2500');
    expect(r.motivo).toMatch(/valor R\$ 2500/);
  });

  test('conversa sem card não quebra', async () => {
    const { env } = cenario();
    const r = await moverPelaResposta(env, 1, msg({}, { id: undefined }));
    expect(r.status).toBe('ignorado');
    expect(r.motivo).toMatch(/sem card/);
  });

  test('payload ilegível não derruba a fila', async () => {
    const { env } = cenario();
    expect((await moverPelaResposta(env, 1, 'nao e json')).status).toBe('ignorado');
    expect((await moverPelaResposta(env, 1, '{}')).status).toBe('ignorado');
  });
});

describe('resposta automatica nao conta como resposta do atendente', () => {
  // Locadora, 22/09/2026: a mensagem de boas-vindas saiu 4 s depois do lead
  // chegar e levou o card de "Novo Lead" para "Qualificando". O card deve
  // esperar o atendente de verdade.
  const cenarioLocadora = () => {
    const c = cenario();
    c.exec(`INSERT INTO respostas_automaticas (tenant_id, frase)
            VALUES (1, 'Seja muito bem-vindo(a) à Locadora Exatidão')`);
    c.exec(`INSERT INTO respostas_automaticas (tenant_id, frase)
            VALUES (1, 'Vi que você se cadastrou em nosso site em busca de')`);
    return c;
  };

  test('a mensagem de boas-vindas nao move o card', async () => {
    const { env } = cenarioLocadora();
    const r = await moverPelaResposta(env, 1, msg({
      content: 'Olá! Seja muito bem-vindo(a) à Locadora Exatidão 🤝\nConta pra gente como podemos ajudar!',
    }, { board_step: { name: 'Novo Lead' } }));

    expect(r.status).toBe('ignorado');
    expect(r.motivo).toContain('resposta automatica');
    expect(moveu()).toBeUndefined();
  });

  test('o historico guarda qual trecho segurou o card', async () => {
    // e' por esta linha que o painel mostra que o trecho ainda casa
    const { env, consultar } = cenarioLocadora();
    await moverPelaResposta(env, 1, msg({
      content: 'Olá! Seja muito bem-vindo(a) à Locadora Exatidão 🤝',
    }, { board_step: { name: 'Novo Lead' } }));

    expect(consultar('SELECT gatilho, etapa_de, etapa_para, moveu, motivo FROM card_moves')).toEqual([{
      gatilho: 'Seja muito bem-vindo(a) à Locadora Exatidão',
      etapa_de: 'Novo Lead',
      etapa_para: null,
      moveu: 0,
      motivo: 'mensagem automatica',
    }]);
  });

  test('a mensagem do fluxo do formulario tambem nao move', async () => {
    const { env } = cenarioLocadora();
    const r = await moverPelaResposta(env, 1, msg({
      content: 'Olá, Everton! Tudo bem?\n\nAqui é a Vania da Locadora Exatidão. Vi que você se cadastrou '
        + 'em nosso site em busca de *Locação de Andaimes* e já quero agilizar o seu orçamento!',
    }, { board_step: { name: 'Novo Lead' } }));

    expect(r.status).toBe('ignorado');
    expect(moveu()).toBeUndefined();
  });

  test('a resposta do atendente continua movendo', async () => {
    const { env } = cenarioLocadora();
    const r = await moverPelaResposta(env, 1, msg({
      content: 'Bom dia! O andaime de 1,5 m sai por R$ 120 a semana.',
    }, { board_step: { name: 'Novo Lead' } }));

    expect(r.status).toBe('ok');
    expect(moveu()).toBeDefined();
  });
});

describe('cliente com mensagem automatica: a que sai colada no lead nao move', () => {
  // Locadora, Martinelli e Taina, out/2026: a boas-vindas do WhatsApp Business
  // e o fluxo do formulario tiravam o card de "Novo Lead" em 0-3 s, antes de
  // qualquer pessoa olhar o lead. Ligado, o tempo decide — sem cadastrar frase.
  const LEAD_EM = 1_790_000_000;

  const cenarioAuto = (ligado: boolean, mensagens: unknown[] | 'falha') => {
    const c = cenario();
    c.exec(`UPDATE tenant_config SET tem_mensagem_automatica = ${ligado ? 1 : 0} WHERE tenant_id = 1`);
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      const metodo = init.method ?? 'GET';
      chamadas.push({ metodo, url: String(url), corpo: init.body ? JSON.parse(String(init.body)) : null });
      if (/\/conversations\/76\/messages/.test(String(url))) {
        if (mensagens === 'falha') return new Response('fora do ar', { status: 502 });
        return Response.json({ payload: mensagens });
      }
      if (metodo === 'GET') return Response.json({ custom_attributes: {} });
      return Response.json({ ok: true });
    });
    return c;
  };

  // a mensagem enviada `s` segundos depois da do lead
  const enviadaApos = (s: number, content = 'Olá! Seja muito bem-vindo(a) à Locadora Exatidão 🤝') => ({
    payload: msg(
      { id: 502, content, created_at: new Date((LEAD_EM + s) * 1000).toISOString() },
      { board_step: { name: 'Novo Lead' } },
    ),
    mensagens: [
      { id: 501, message_type: 0, created_at: LEAD_EM },
      { id: 502, message_type: 1, created_at: LEAD_EM + s },
    ],
  });

  test('a boas-vindas 1 s depois do lead nao move o card', async () => {
    const { payload, mensagens } = enviadaApos(1);
    const { env, consultar } = cenarioAuto(true, mensagens);

    const r = await moverPelaResposta(env, 1, payload);

    expect(r.status).toBe('ignorado');
    expect(r.motivo).toMatch(/mensagem automatica, 1 s depois do lead/);
    expect(moveu()).toBeUndefined();
    // no historico como automatica: o painel conta, e a checagem dos gatilhos deixa de fora
    const [m] = consultar<{ moveu: number; motivo: string; gatilho: string }>(
      'SELECT moveu, motivo, gatilho FROM card_moves',
    );
    expect(m).toMatchObject({ moveu: 0, motivo: 'mensagem automatica', gatilho: 'pelo tempo' });
  });

  test('a resposta da atendente 40 s depois move', async () => {
    const { payload, mensagens } = enviadaApos(40, 'Bom dia, Talita! Qual o tamanho da obra?');
    const { env } = cenarioAuto(true, mensagens);

    const r = await moverPelaResposta(env, 1, payload);

    expect(r.status).toBe('ok');
    expect(moveu()!.corpo).toEqual({ board_step_id: 28 });
  });

  test('frase-gatilho move mesmo dentro da janela', async () => {
    // a frase e' escolha deliberada da equipe; o tempo so' vale para a resposta comum
    const { payload, mensagens } = enviadaApos(2, 'Sua consulta ficou confirmada para terça às 14h.');
    const { env } = cenarioAuto(true, mensagens);

    const r = await moverPelaResposta(env, 1, payload);

    expect(r.status).toBe('ok');
    expect(moveu()!.corpo).toEqual({ board_step_id: 29 });
  });

  test('desligado, segue como sempre e nem pergunta ao Chatwoot', async () => {
    const { payload, mensagens } = enviadaApos(1);
    const { env } = cenarioAuto(false, mensagens);

    const r = await moverPelaResposta(env, 1, payload);

    expect(r.status).toBe('ok');
    expect(chamadas.some((c) => /\/messages/.test(c.url))).toBe(false);
  });

  test('Chatwoot fora do ar vira erro para a fila retentar, sem mover', async () => {
    // mover no escuro seria repetir o erro que a regra existe para evitar
    const { payload } = enviadaApos(1);
    const { env } = cenarioAuto(true, 'falha');

    const r = await moverPelaResposta(env, 1, payload);

    expect(r.status).toBe('erro');
    expect(moveu()).toBeUndefined();
  });
});
