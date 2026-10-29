import { describe, test, expect } from 'vitest';
import worker from '../../src/index';
import { fakeD1 } from '../helpers/fakeD1';
import type { Env } from '../../src/env';

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const enviar = (env: Env, metodo: string, caminho: string, corpo: unknown) =>
  worker.fetch(
    new Request(`https://crm.teste${caminho}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    }),
    env,
    ctx,
  );

const ambiente = () => {
  const f = fakeD1();
  const env = { DB: f.d1, PANEL_PUBLIC: 'true', GOOGLE_ADS_MCC_ID: '3780611396' } as unknown as Env;
  return { ...f, env };
};

const NOVO = {
  nome: 'Martinelli Chaves',
  cw_account_id: '8',
  cw_board_funil_id: '15',
  cw_board_organico_id: '16',
  ga_customer_id: '5886565200',
  evo_instancia: 'martinellichaves',
  pulseboard_url: '',
  pulseboard_ativo: 1,
};

describe('cadastro de cliente pelo painel', () => {
  test('"Novo cliente" grava o cliente, a configuracao e uma chave por canal', async () => {
    const { env, consultar } = ambiente();
    const r = await enviar(env, 'POST', '/api/tenants', { ...NOVO, slug: '' });
    expect(r.status).toBe(201);
    const { id, slug } = (await r.json()) as { id: number; slug: string };
    expect(slug).toBe('martinelli-chaves');

    const [cfg] = consultar(`SELECT cw_account_id, cw_board_funil_id, cw_board_organico_id, ga_customer_id,
              ga_login_customer_id, evo_instancia, validate_only, ingest_key, pulseboard_ativo
       FROM tenant_config WHERE tenant_id = ${id}`) as Array<Record<string, unknown>>;
    expect(cfg).toMatchObject({
      cw_account_id: 8, cw_board_funil_id: 15, cw_board_organico_id: 16,
      ga_customer_id: '5886565200', ga_login_customer_id: '3780611396',
      evo_instancia: 'martinellichaves', validate_only: 1,
      // sem a URL do grupo o aviso nasce desligado
      pulseboard_ativo: 0,
    });

    const chaves = consultar(`SELECT canal, chave, revelada FROM ingest_keys WHERE tenant_id = ${id} ORDER BY canal`) as
      Array<{ canal: string; chave: string; revelada: number }>;
    expect(chaves.map((k) => k.canal)).toEqual(['click', 'kanban', 'meta']);
    // a chave antiga do cliente e' a do clique, que a rota usa de reserva
    expect(chaves.find((k) => k.canal === 'click')!.chave).toBe(cfg!.ingest_key);
    expect(new Set(chaves.map((k) => k.chave)).size).toBe(3);
    // cada uma pode ser vista uma vez, para colar no GTM e no Chatwoot
    expect(chaves.every((k) => k.revelada === 0)).toBe(true);
  });

  test('recusa sem board do funil e com endereco repetido', async () => {
    const { env } = ambiente();
    const semBoard = await enviar(env, 'POST', '/api/tenants', { ...NOVO, cw_board_funil_id: '' });
    expect(semBoard.status).toBe(400);

    expect((await enviar(env, 'POST', '/api/tenants', NOVO)).status).toBe(201);
    expect((await enviar(env, 'POST', '/api/tenants', NOVO)).status).toBe(409);
  });

  test('"Salvar" edita o nome e a configuracao do cliente', async () => {
    const { env, consultar } = ambiente();
    const { id } = (await (await enviar(env, 'POST', '/api/tenants', NOVO)).json()) as { id: number };

    const r = await enviar(env, 'PATCH', `/api/tenants/${id}`, {
      nome: 'Martinelli Chaves 24h', validate_only: 0, gtm_prefixo: 'MARTIN', pulseboard_url: '',
    });
    expect(r.status).toBe(200);

    const [t] = consultar(`SELECT nome FROM tenants WHERE id = ${id}`) as Array<{ nome: string }>;
    expect(t!.nome).toBe('Martinelli Chaves 24h');
    const [cfg] = consultar(`SELECT validate_only, gtm_prefixo, pulseboard_url FROM tenant_config WHERE tenant_id = ${id}`) as
      Array<Record<string, unknown>>;
    expect(cfg).toEqual({ validate_only: 0, gtm_prefixo: 'MARTIN', pulseboard_url: null });
  });
});

describe('botao de mensagem automatica do cliente', () => {
  const criar = async (env: Env) =>
    ((await (await enviar(env, 'POST', '/api/tenants', NOVO)).json()) as { id: number }).id;
  const estado = async (env: Env, id: number) =>
    (await (await worker.fetch(new Request(`https://crm.teste/api/tenants/${id}/automatica-pelo-tempo`), env, ctx)).json()) as
      { ligado: boolean; seguradas_7d: number; ultima_em: string | null };

  test('nasce desligado e liga pelo botao', async () => {
    const { env, consultar } = ambiente();
    const id = await criar(env);
    expect((await estado(env, id)).ligado).toBe(false);

    expect((await enviar(env, 'PATCH', `/api/tenants/${id}`, { tem_mensagem_automatica: 1 })).status).toBe(200);

    expect((await estado(env, id)).ligado).toBe(true);
    const [cfg] = consultar(`SELECT tem_mensagem_automatica FROM tenant_config WHERE tenant_id = ${id}`) as
      Array<{ tem_mensagem_automatica: number }>;
    expect(cfg!.tem_mensagem_automatica).toBe(1);
  });

  test('conta so as mensagens seguradas pelo tempo, nos ultimos 7 dias', async () => {
    // o trecho cadastrado tem a contagem dele na tabela de baixo
    const { env, exec } = ambiente();
    const id = await criar(env);
    for (const [gatilho, quando] of [
      ['pelo tempo', '-1 day'], ['pelo tempo', '-2 day'], ['pelo tempo', '-9 day'],
      ['Seja muito bem-vindo(a) à Locadora Exatidão', '-1 day'],
    ]) {
      exec(`INSERT INTO card_moves (tenant_id, gatilho, moveu, motivo, created_at)
            VALUES (${id}, '${gatilho}', 0, 'mensagem automatica', datetime('now', '${quando}'))`);
    }
    const r = await estado(env, id);
    expect(r.seguradas_7d).toBe(2);
    expect(r.ultima_em).toBeTruthy();
  });
});
