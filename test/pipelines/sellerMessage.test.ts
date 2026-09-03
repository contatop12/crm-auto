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
