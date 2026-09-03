import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { fakeD1 } from '../helpers/fakeD1';
import { enviarConversao } from '../../src/pipelines/stageChanged';
import type { Env } from '../../src/env';

const FUNIL = 7;

/** Vita: as etapas que viram conversao e uma que nao vira. */
function cenario(over: { validateOnly?: number } = {}) {
  const { d1, exec, consultar } = fakeD1();
  exec(`INSERT INTO tenants (id, slug, nome, ativo) VALUES (1, 'vita', 'Vita', 1)`);
  exec(`INSERT INTO tenant_config (tenant_id, cw_account_id, cw_board_funil_id, ingest_key,
          ga_customer_id, ga_currency, validate_only)
        VALUES (1, 2, ${FUNIL}, 'k', '6973821129', 'BRL', ${over.validateOnly ?? 0})`);
  exec(`INSERT INTO credenciais (chave, valor) VALUES ('datamanager_refresh_token', 'rt')`);

  // [id, posicao, nome, cw_step_id, conversion_event, conversion_action_id, conversion_value]
  for (const [id, pos, nome, step, ev, ca, val] of [
    [1, 1, 'Novo Lead', 27, 'conversa', '7698886680', '10'],
    [2, 2, 'Qualificando', 28, null, null, 'NULL'],
    [3, 3, 'Agendamento Realizado', 29, 'qualificado_1', '7698566576', '100'],
    [4, 6, 'Oportunidade Ganha', 33, 'compra', '7698567533', 'NULL'],
  ] as const) {
    exec(`INSERT INTO funnel_stages (id, tenant_id, posicao, nome, cw_step_id, conversion_event,
            conversion_action_id, conversion_value)
          VALUES (${id}, 1, ${pos}, '${nome}', ${step},
            ${ev ? `'${ev}'` : 'NULL'}, ${ca ? `'${ca}'` : 'NULL'}, ${val})`);
  }

  exec(`INSERT INTO leads (tenant_id, protocol, nome, email, phone_e164, gclid, created_at)
        VALUES (1, 'VITA-123', 'Maria Santos', 'maria@teste.com.br', '+5519983511561',
                'CjwKCAjwGCLID', '2026-09-01T10:00:00Z')`);

  const env = {
    DB: d1,
    CACHE: { get: async () => null, put: async () => undefined } as unknown as KVNamespace,
    GOOGLE_ADS_CLIENT_ID: 'ci', GOOGLE_ADS_CLIENT_SECRET: 'cs',
    GOOGLE_ADS_REFRESH_TOKEN: 'rt', GOOGLE_ADS_DEVELOPER_TOKEN: 'dt',
    GOOGLE_ADS_MCC_ID: '3780611396',
  } as unknown as Env;
  return { env, consultar, exec };
}

/** Payload real do webhook de kanban, recortado no que o pipeline le. */
const card = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: 1526,
    board_id: FUNIL,
    board_step_id: 29,
    board_step: { id: 29, name: 'Agendamento Realizado' },
    board: { id: FUNIL, name: 'Pipeline de Vendas' },
    custom_attributes: { protocolo: 'VITA-123' },
    value: null,
    step_changed_at: '2026-09-03T22:08:49.303Z',
    conversation_ids: [78],
    conversations: [{ id: 1571, display_id: 78 }],
    ...over,
  });

let chamadas: Array<{ url: string; corpo: any }>;
let resposta: () => Response;

beforeEach(() => {
  chamadas = [];
  resposta = () => Response.json({ requestId: 'req-1' });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com')) return Response.json({ access_token: 'at' });
    chamadas.push({ url: u, corpo: init.body ? JSON.parse(String(init.body)) : null });
    return resposta();
  });
});
afterEach(() => vi.unstubAllGlobals());

const corpoEnviado = () => chamadas[0]?.corpo;
const linha = (c: (q: string) => any[]) => c(`SELECT * FROM conversions`)[0];

describe('enviarConversao', () => {
  test('sobe a conversao da etapa, com gclid, valor e moeda', async () => {
    const { env, consultar } = cenario();
    const r = await enviarConversao(env, 1, card());

    expect(r.status).toBe('ok');
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]!.url).toContain('datamanager.googleapis.com');

    const b = corpoEnviado();
    expect(b.destinations[0].loginAccount.accountId).toBe('3780611396');
    expect(b.destinations[0].operatingAccount.accountId).toBe('6973821129');
    expect(b.destinations[0].productDestinationId).toBe('7698566576');
    expect(b.events[0].adIdentifiers).toEqual({ gclid: 'CjwKCAjwGCLID' });
    expect(b.events[0].conversionValue).toBe(100);
    expect(b.events[0].currency).toBe('BRL');
    expect(b.events[0].transactionId).toBe('VITA-123-qualificado_1');
    // e-mail e telefone do lead sobem com hash, para recuperar o gclid vencido
    expect(b.events[0].userData.userIdentifiers).toHaveLength(2);

    const l = linha(consultar);
    expect(l.status).toBe('enviado');
    expect(l.request_id).toBe('req-1');
    expect(l.match_type).toBe('click_id+user_data');
    // o evento aconteceu quando o card mudou de etapa, nao quando subiu
    expect(l.event_at).toBe('2026-09-03T22:08:49.303Z');
  });

  test('etapa sem meta de conversao nao sobe nada', async () => {
    const { env } = cenario();
    const r = await enviarConversao(env, 1, card({
      board_step_id: 28, board_step: { id: 28, name: 'Qualificando' },
    }));
    expect(r.status).toBe('ignorado');
    expect(r.motivo).toContain('Qualificando');
    expect(chamadas).toHaveLength(0);
  });

  test('etapa que o funil nao conhece nao sobe nada', async () => {
    const { env } = cenario();
    const r = await enviarConversao(env, 1, card({ board_step_id: 99, board_step: { id: 99, name: 'Sei la' } }));
    expect(r.status).toBe('ignorado');
    expect(chamadas).toHaveLength(0);
  });

  test('card sem protocolo nao sobe: o organico nao tem clique para atribuir', async () => {
    const { env } = cenario();
    const r = await enviarConversao(env, 1, card({ custom_attributes: {} }));
    expect(r.status).toBe('ignorado');
    expect(r.motivo).toContain('protocolo');
    expect(chamadas).toHaveLength(0);
  });

  test('acha o protocolo pela conversa quando o card nao carrega', async () => {
    const { env, exec } = cenario();
    exec(`INSERT INTO conversations (tenant_id, cw_conversation_id, task_id, protocol)
          VALUES (1, 1571, 1526, 'VITA-123')`);
    const r = await enviarConversao(env, 1, card({ custom_attributes: {} }));
    expect(r.status).toBe('ok');
    expect(corpoEnviado().events[0].transactionId).toBe('VITA-123-qualificado_1');
  });

  test('protocolo sem clique registrado nao sobe', async () => {
    const { env } = cenario();
    const r = await enviarConversao(env, 1, card({ custom_attributes: { protocolo: 'VITA-999' } }));
    expect(r.status).toBe('ignorado');
    expect(r.motivo).toContain('VITA-999');
    expect(chamadas).toHaveLength(0);
  });

  test('o mesmo card na mesma etapa nao sobe duas vezes', async () => {
    const { env, consultar } = cenario();
    await enviarConversao(env, 1, card());
    const r = await enviarConversao(env, 1, card());

    expect(r.status).toBe('ignorado');
    expect(r.motivo).toContain('ja enviada');
    expect(chamadas).toHaveLength(1);
    expect(consultar(`SELECT * FROM conversions`)).toHaveLength(1);
  });

  test('duas etapas do mesmo lead sao duas conversoes', async () => {
    const { env, consultar } = cenario();
    await enviarConversao(env, 1, card());
    await enviarConversao(env, 1, card({ board_step_id: 27, board_step: { id: 27, name: 'Novo Lead' } }));
    expect(chamadas).toHaveLength(2);
    expect(consultar(`SELECT * FROM conversions`)).toHaveLength(2);
  });

  test('depois de um erro a retentativa reenvia, nao trata como ja enviada', async () => {
    const { env, consultar } = cenario();
    resposta = () => new Response('{"error":{"message":"backend indisponivel"}}', { status: 503 });
    const r1 = await enviarConversao(env, 1, card());
    expect(r1.status).toBe('erro');
    expect(linha(consultar).status).toBe('erro');
    expect(linha(consultar).erro).toContain('backend indisponivel');

    resposta = () => Response.json({ requestId: 'req-2' });
    const r2 = await enviarConversao(env, 1, card());
    expect(r2.status).toBe('ok');
    expect(chamadas).toHaveLength(2);
    expect(linha(consultar).status).toBe('enviado');
    expect(linha(consultar).erro).toBeNull();
  });

  test('sem gclid e sem dados do lead nao ha o que atribuir', async () => {
    const { env, exec, consultar } = cenario();
    exec(`UPDATE leads SET gclid = NULL, email = NULL, phone_e164 = NULL WHERE protocol = 'VITA-123'`);
    const r = await enviarConversao(env, 1, card());
    expect(r.status).toBe('ignorado');
    expect(chamadas).toHaveLength(0);
    expect(linha(consultar).status).toBe('ignorado');
  });

  test('so os dados do lead ainda sobem, marcados como user_data_only', async () => {
    const { env, exec, consultar } = cenario();
    exec(`UPDATE leads SET gclid = NULL WHERE protocol = 'VITA-123'`);
    const r = await enviarConversao(env, 1, card());
    expect(r.status).toBe('ok');
    expect(corpoEnviado().events[0].adIdentifiers).toBeUndefined();
    expect(linha(consultar).match_type).toBe('user_data_only');
  });

  test('etapa sem valor fixo usa o valor real da negociacao', async () => {
    const { env, consultar } = cenario();
    const r = await enviarConversao(env, 1, card({
      board_step_id: 33, board_step: { id: 33, name: 'Oportunidade Ganha' }, value: 2450.9,
    }));
    expect(r.status).toBe('ok');
    expect(corpoEnviado().events[0].conversionValue).toBe(2450.9);
    expect(linha(consultar).conversion_value).toBe(2450.9);
  });

  test('sem valor fixo e sem valor no card, cai no valor da proposta', async () => {
    const { env, exec } = cenario();
    exec(`UPDATE leads SET valor_proposta = 1800 WHERE protocol = 'VITA-123'`);
    await enviarConversao(env, 1, card({
      board_step_id: 33, board_step: { id: 33, name: 'Oportunidade Ganha' },
    }));
    expect(corpoEnviado().events[0].conversionValue).toBe(1800);
  });

  test('modo sombra manda validateOnly e registra que foi ensaio', async () => {
    const { env, consultar } = cenario({ validateOnly: 1 });
    const r = await enviarConversao(env, 1, card());
    expect(r.status).toBe('ok');
    expect(r.motivo).toContain('sombra');
    expect(corpoEnviado().validateOnly).toBe(true);
    expect(linha(consultar).validate_only).toBe(1);
  });

  test('cliente sem conta do Google Ads nao sobe', async () => {
    const { env, exec } = cenario();
    exec(`UPDATE tenant_config SET ga_customer_id = NULL WHERE tenant_id = 1`);
    const r = await enviarConversao(env, 1, card());
    expect(r.status).toBe('ignorado');
    expect(chamadas).toHaveLength(0);
  });

  test('etapa sem id de acao de conversao e erro de configuracao, nao silencio', async () => {
    const { env, exec } = cenario();
    exec(`UPDATE funnel_stages SET conversion_action_id = NULL WHERE id = 3`);
    const r = await enviarConversao(env, 1, card());
    expect(r.status).toBe('ignorado');
    expect(r.motivo).toContain('sem id da acao');
  });

  test('payload que nao e json nao derruba a fila', async () => {
    const { env } = cenario();
    const r = await enviarConversao(env, 1, 'nao sou json');
    expect(r.status).toBe('ignorado');
  });
});
