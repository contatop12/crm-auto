import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { fakeD1 } from '../helpers/fakeD1';
import { conectarWebhook, estadoDosWebhooks, restaurarWebhook } from '../../src/pipelines/webhookEvolution';
import type { WebhookEvo } from '../../src/domain/webhookEvolution';
import type { Env } from '../../src/env';

const ORIGEM = 'https://crm.p12.teste';
const TRACKER = 'https://whatsapptrack.sitespdoze.com.br/hooks/evolution/1?secret=segredo-do-tracker';

function cenario() {
  const { d1, exec, consultar } = fakeD1();
  exec(`INSERT INTO tenants (id, slug, nome) VALUES (5, 'taina', 'Taina'), (1, 'vita', 'Vita')`);
  exec(`INSERT INTO tenant_config (tenant_id, cw_account_id, cw_board_funil_id, ingest_key, evo_instancia)
        VALUES (5, 3, 9, 'k', 'Tainã Clínica'), (1, 2, 7, 'k', 'Vita Audio')`);
  exec(`INSERT INTO inbox_instances (tenant_id, cw_inbox_id, cw_inbox_nome, evo_instancia, ativa)
        VALUES (5, 11, 'Tainã', 'Tainã Aci', 1)`);
  const env = { DB: d1, EVOLUTION_SERVER_URL: 'https://evo.teste', EVOLUTION_API_KEY: 'x' } as unknown as Env;
  return { env, exec, consultar };
}

/** Evolution de mentira: um webhook por instancia, como a de verdade. */
let webhooks: Record<string, WebhookEvo | null>;
let gravados: Array<{ instancia: string; webhook: Record<string, unknown> }>;
let gravaOutraUrl: boolean;

beforeEach(() => {
  webhooks = {
    'Tainã Aci': {
      url: TRACKER, enabled: true, events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE'],
      webhookByEvents: false, webhookBase64: true,
    },
  };
  gravados = [];
  gravaOutraUrl = false;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const u = new URL(String(url));
    const instancia = decodeURIComponent(u.pathname.split('/').pop()!);
    if (u.pathname.startsWith('/webhook/find/')) return Response.json(webhooks[instancia] ?? null);
    if (u.pathname.startsWith('/webhook/set/')) {
      const w = (JSON.parse(String(init.body)) as { webhook: Record<string, unknown> }).webhook;
      gravados.push({ instancia, webhook: w });
      webhooks[instancia] = gravaOutraUrl
        ? { url: 'https://outro.exemplo/x' }
        : {
            url: String(w.url), enabled: w.enabled as boolean, events: w.events as string[],
            webhookByEvents: w.byEvents as boolean, webhookBase64: w.base64 as boolean,
          };
      return Response.json({ webhook: w });
    }
    if (u.pathname.startsWith('/instance/connectionState/')) return Response.json({ instance: { state: 'open' } });
    return new Response('nao encontrado', { status: 404 });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('conectarWebhook', () => {
  test('instancia sem webhook: cria a chave do canal e grava o endereco do CRM', async () => {
    const { env, consultar } = cenario();
    const r = await conectarWebhook(env, 5, ORIGEM, { instancia: 'Tainã Clínica' });
    expect(r).toEqual({ ok: true, instancia: 'Tainã Clínica', host: 'crm.p12.teste' });

    const [k] = consultar<{ chave: string; revelada: number }>(
      `SELECT chave, revelada FROM ingest_keys WHERE canal = 'evolution'`,
    );
    expect(k!.revelada).toBe(0);
    expect(gravados).toEqual([{
      instancia: 'Tainã Clínica',
      webhook: {
        enabled: true,
        url: `${ORIGEM}/ingest/taina/evolution?k=${encodeURIComponent(k!.chave)}`,
        events: ['MESSAGES_UPSERT'],
        byEvents: false,
        base64: false,
      },
    }]);
    expect(consultar('SELECT * FROM evo_webhooks_anteriores')).toHaveLength(0);
  });

  test('aponta para outro sistema e sem confirmar: 409 com o host, nada gravado', async () => {
    const { env, consultar } = cenario();
    const r = await conectarWebhook(env, 5, ORIGEM, { instancia: 'Tainã Aci' });
    expect(r).toEqual({ ok: false, status: 409, error: expect.any(String), host: 'whatsapptrack.sitespdoze.com.br' });
    expect(JSON.stringify(r)).not.toContain('segredo-do-tracker');
    expect(gravados).toEqual([]);
    expect(consultar('SELECT * FROM evo_webhooks_anteriores')).toHaveLength(0);
  });

  test('com confirmar: guarda o anterior inteiro e grava o do CRM', async () => {
    const { env, consultar } = cenario();
    const r = await conectarWebhook(env, 5, ORIGEM, { instancia: 'Tainã Aci', confirmar: true });
    expect(r.ok).toBe(true);
    const [a] = consultar<{ config: string }>(`SELECT config FROM evo_webhooks_anteriores WHERE evo_instancia = 'Tainã Aci'`);
    expect(JSON.parse(a!.config).url).toBe(TRACKER);
    expect(String(gravados[0]!.webhook.url)).toContain(`${ORIGEM}/ingest/taina/evolution?k=`);
  });

  test('a Evolution ficou com outra URL depois de gravar: erro, nao "conectado"', async () => {
    const { env } = cenario();
    gravaOutraUrl = true;
    const r = await conectarWebhook(env, 5, ORIGEM, { instancia: 'Tainã Clínica' });
    expect(r).toMatchObject({ ok: false, status: 502 });
  });

  test('reconectar o que ja e do CRM nao apaga o anterior guardado', async () => {
    const { env, consultar } = cenario();
    await conectarWebhook(env, 5, ORIGEM, { instancia: 'Tainã Aci', confirmar: true });
    const r = await conectarWebhook(env, 5, ORIGEM, { instancia: 'Tainã Aci' });
    expect(r.ok).toBe(true);
    const [a] = consultar<{ config: string }>(`SELECT config FROM evo_webhooks_anteriores`);
    expect(JSON.parse(a!.config).url).toBe(TRACKER);
  });

  test('instancia de outro cliente: 404 e nada gravado', async () => {
    const { env } = cenario();
    const r = await conectarWebhook(env, 5, ORIGEM, { instancia: 'Vita Audio' });
    expect(r).toMatchObject({ ok: false, status: 404 });
    expect(gravados).toEqual([]);
  });
});

describe('restaurarWebhook', () => {
  test('devolve o webhook de antes, com os eventos de antes', async () => {
    const { env, consultar } = cenario();
    await conectarWebhook(env, 5, ORIGEM, { instancia: 'Tainã Aci', confirmar: true });
    const r = await restaurarWebhook(env, 5, 'Tainã Aci');
    expect(r).toEqual({ ok: true, instancia: 'Tainã Aci', host: 'whatsapptrack.sitespdoze.com.br' });
    expect(gravados[1]).toEqual({
      instancia: 'Tainã Aci',
      webhook: { enabled: true, url: TRACKER, events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE'], byEvents: false, base64: true },
    });
    expect(consultar('SELECT * FROM evo_webhooks_anteriores')).toHaveLength(0);
  });

  test('sem anterior guardado: 404', async () => {
    const { env } = cenario();
    expect(await restaurarWebhook(env, 5, 'Tainã Aci')).toMatchObject({ ok: false, status: 404 });
  });
});

describe('estadoDosWebhooks', () => {
  test('mostra conexao, o webhook so pelo host e o ultimo cartao recebido', async () => {
    const { env, exec } = cenario();
    exec(`INSERT INTO meta_atribuicoes (tenant_id, phone_key, ctwa_clid, evo_instancia, recebido_em)
          VALUES (5, '7191065853', 'c1', 'Tainã Aci', '2026-09-21 10:00:00')`);
    const r = await estadoDosWebhooks(env, 5, ORIGEM);
    expect(r).toEqual([
      {
        instancia: 'Tainã Aci', conexao: 'open', webhook: 'outro', host: 'whatsapptrack.sitespdoze.com.br',
        ultimo_cartao: '2026-09-21 10:00:00', tem_anterior: false,
      },
      { instancia: 'Tainã Clínica', conexao: 'open', webhook: 'nenhum', host: null, ultimo_cartao: null, tem_anterior: false },
    ]);
    expect(JSON.stringify(r)).not.toContain('segredo-do-tracker');
  });

  test('cliente sem instancia nenhuma nao chama a Evolution', async () => {
    const { d1, exec } = fakeD1();
    exec(`INSERT INTO tenants (id, slug, nome) VALUES (7, 'tile', 'Tile')`);
    const env = { DB: d1 } as unknown as Env; // sem EVOLUTION_*: se chamasse, lancaria
    expect(await estadoDosWebhooks(env, 7, ORIGEM)).toEqual([]);
  });
});
