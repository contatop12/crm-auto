import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { fakeD1 } from '../helpers/fakeD1';
import { enviarEventoMeta, reenviarFalhasMeta } from '../../src/pipelines/metaCapi';
import { cifrarToken } from '../../src/domain/segredoMeta';
import { hash } from '../../src/domain/conversao';
import type { Env } from '../../src/env';

const MK = 'chave-mestra-de-teste';
const sql = (v: string | null) => (v === null ? 'NULL' : `'${v}'`);

async function cenario(over: { dryRun?: number; pageId?: string | null; testCode?: string | null; eventAt?: string } = {}) {
  const { d1, exec, consultar } = fakeD1();
  exec(`INSERT INTO tenants (id, slug, nome) VALUES (5, 'taina', 'Taina')`);
  const { cipher, iv } = await cifrarToken('EAAB-token-da-taina', MK);
  exec(`INSERT INTO tenant_config (tenant_id, cw_account_id, cw_board_funil_id, ingest_key,
          meta_dataset_id, meta_page_id, meta_test_event_code, meta_token_cipher, meta_token_iv, meta_dry_run)
        VALUES (5, 3, 9, 'k', '1234567890', ${sql(over.pageId === undefined ? '555' : over.pageId)},
                ${sql(over.testCode ?? null)}, '${cipher}', '${iv}', ${over.dryRun ?? 0})`);
  exec(`INSERT INTO leads (tenant_id, protocol, phone_e164, phone_key, utm_source, ctwa_clid, evento)
        VALUES (5, 'TAINA-CTWA-9', '+5571991065853', '7191065853', 'facebook', 'ARAk-clid', 'anuncio_meta')`);
  const quando = over.eventAt ?? new Date(Date.now() - 3_600_000).toISOString();
  exec(`INSERT INTO meta_eventos (id, tenant_id, dedupe_key, event_id, protocol, phone_key, canal, event_name,
          etapa, value, currency, event_at)
        VALUES (1, 5, 'TAINA-CTWA-9-LeadSubmitted', 'TAINA-CTWA-9-LeadSubmitted', 'TAINA-CTWA-9', '7191065853',
                'whatsapp', 'LeadSubmitted', 'Novo Lead', 10, 'BRL', '${quando}')`);
  const fila: Array<Record<string, unknown>> = [];
  const env = {
    DB: d1, MASTER_KEY: MK,
    QUEUE: { send: async (m: Record<string, unknown>) => { fila.push(m); } },
  } as unknown as Env;
  return { env, exec, consultar, fila };
}

const PAYLOAD = JSON.stringify({ meta_evento_id: 1, dedupe_key: 'TAINA-CTWA-9-LeadSubmitted' });
const linha = (consultar: <T>(q: string) => T[]) =>
  consultar<Record<string, any>>('SELECT * FROM meta_eventos WHERE id = 1')[0]!;

let chamadas: Array<{ url: string; auth: string | null; corpo: any }>;
let resposta: () => Response;

beforeEach(() => {
  chamadas = [];
  resposta = () => Response.json({ events_received: 1, fbtrace_id: 'abc' });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    chamadas.push({
      url: String(url),
      auth: new Headers(init.headers).get('authorization'),
      corpo: init.body ? JSON.parse(String(init.body)) : null,
    });
    return resposta();
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('enviarEventoMeta', () => {
  test('envia o LeadSubmitted de mensagem com o clique, a Pagina e o telefone com hash', async () => {
    const { env, consultar } = await cenario();
    const r = await enviarEventoMeta(env, 5, PAYLOAD);

    expect(r.status).toBe('ok');
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]!.url).toBe('https://graph.facebook.com/v26.0/1234567890/events');
    expect(chamadas[0]!.auth).toBe('Bearer EAAB-token-da-taina');
    expect(chamadas[0]!.corpo.data[0]).toMatchObject({
      event_name: 'LeadSubmitted',
      event_id: 'TAINA-CTWA-9-LeadSubmitted',
      action_source: 'business_messaging',
      messaging_channel: 'whatsapp',
      user_data: { ph: [await hash('5571991065853')], ctwa_clid: 'ARAk-clid', page_id: '555' },
      custom_data: { value: 10, currency: 'BRL' },
    });
    expect(chamadas[0]!.corpo.test_event_code).toBeUndefined();

    const l = linha(consultar);
    expect(l).toMatchObject({ status: 'enviado', http_code: 200, tentativas: 1 });
    expect(l.sent_at).not.toBeNull();
    expect(consultar('SELECT meta_token_valido FROM tenant_config')).toEqual([{ meta_token_valido: 1 }]);
  });

  test('envio desligado: monta, guarda e nao chama a Meta', async () => {
    const { env, consultar } = await cenario({ dryRun: 1 });
    const r = await enviarEventoMeta(env, 5, PAYLOAD);
    expect(r.status).toBe('ok');
    expect(chamadas).toHaveLength(0);
    const l = linha(consultar);
    expect(l.status).toBe('nao_enviado');
    expect(l.request_payload).toContain('ARAk-clid');
    expect(l.request_payload).not.toContain('5571991065853');
  });

  test('4xx: falhou e nao volta para a fila', async () => {
    const { env, consultar } = await cenario();
    resposta = () => Response.json(
      { error: { message: 'Invalid parameter', code: 100, error_subcode: 2804019 } }, { status: 400 },
    );
    const r = await enviarEventoMeta(env, 5, PAYLOAD);
    expect(r).toMatchObject({ status: 'erro', retentar: false });
    expect(r.motivo).toMatch(/^TAINA-CTWA-9-LeadSubmitted: Meta recusou/);
    expect(linha(consultar)).toMatchObject({ status: 'falhou', http_code: 400 });
    expect(linha(consultar).erro).toContain('Invalid parameter');
  });

  test('5xx: falhou e a fila retenta', async () => {
    const { env, consultar } = await cenario();
    resposta = () => new Response('indisponivel', { status: 503 });
    const r = await enviarEventoMeta(env, 5, PAYLOAD);
    expect(r.status).toBe('erro');
    expect(r.retentar).toBeUndefined();
    expect(linha(consultar).status).toBe('falhou');
  });

  test('rede caiu: a fila retenta', async () => {
    const { env, consultar } = await cenario();
    resposta = () => { throw new TypeError('fetch failed'); };
    const r = await enviarEventoMeta(env, 5, PAYLOAD);
    expect(r.status).toBe('erro');
    expect(r.retentar).toBeUndefined();
    expect(linha(consultar).erro).toContain('fetch failed');
  });

  test('sem Pagina e sem WABA: falha antes da rede', async () => {
    const { env, consultar } = await cenario({ pageId: null });
    const r = await enviarEventoMeta(env, 5, PAYLOAD);
    expect(r).toMatchObject({ status: 'erro', retentar: false });
    expect(chamadas).toHaveLength(0);
    expect(linha(consultar).erro).toContain('2804116');
  });

  test('evento com mais de 7 dias: falha sem chamar a Meta', async () => {
    const { env } = await cenario({ eventAt: new Date(Date.now() - 8 * 86_400_000).toISOString() });
    const r = await enviarEventoMeta(env, 5, PAYLOAD);
    expect(r).toMatchObject({ status: 'erro', retentar: false });
    expect(r.motivo).toContain('7 dias');
    expect(chamadas).toHaveLength(0);
  });

  test('codigo de teste vai no corpo', async () => {
    const { env } = await cenario({ testCode: 'TEST123' });
    await enviarEventoMeta(env, 5, PAYLOAD);
    expect(chamadas[0]!.corpo.test_event_code).toBe('TEST123');
  });

  test('ja enviado nao sai de novo', async () => {
    const { env, exec } = await cenario();
    exec(`UPDATE meta_eventos SET status = 'enviado' WHERE id = 1`);
    const r = await enviarEventoMeta(env, 5, PAYLOAD);
    expect(r.status).toBe('ignorado');
    expect(chamadas).toHaveLength(0);
  });

  test('subiu: os erros anteriores deste evento saem das notificacoes', async () => {
    const { env, exec, consultar } = await cenario();
    exec(`INSERT INTO events (tenant_id, source, event_type, payload, status, motivo)
          VALUES (5, 'kanban', 'meta_capi', '{}', 'erro', 'TAINA-CTWA-9-LeadSubmitted: Meta nao respondeu: timeout')`);
    await enviarEventoMeta(env, 5, PAYLOAD);
    const [e] = consultar<{ resolvido_em: string | null }>(`SELECT resolvido_em FROM events WHERE event_type = 'meta_capi'`);
    expect(e!.resolvido_em).not.toBeNull();
  });
});

describe('reenviarFalhasMeta', () => {
  test('volta para a fila so o que falhou e e do CRM', async () => {
    const { env, exec, consultar, fila } = await cenario();
    exec(`UPDATE meta_eventos SET status = 'falhou' WHERE id = 1`);
    exec(`INSERT INTO meta_eventos (id, tenant_id, dedupe_key, event_id, canal, event_name, status, origem, event_at)
          VALUES (2, 5, 'trk-1', 'trk-1', 'whatsapp', 'LeadSubmitted', 'falhou', 'tracker', '2026-09-01T10:00:00Z'),
                 (3, 5, 'X-Purchase', 'X-Purchase', 'whatsapp', 'Purchase', 'enviado', 'crm', '2026-09-01T10:00:00Z')`);

    expect(await reenviarFalhasMeta(env, 5)).toEqual({ na_fila: 1 });
    expect(fila).toEqual([expect.objectContaining({ tenantId: 5, source: 'kanban', eventType: 'meta_capi' })]);
    expect(consultar('SELECT id, status FROM meta_eventos ORDER BY id')).toEqual([
      { id: 1, status: 'pendente' },
      { id: 2, status: 'falhou' },
      { id: 3, status: 'enviado' },
    ]);
    const [ev] = consultar<{ payload: string }>(`SELECT payload FROM events WHERE event_type = 'meta_capi'`);
    expect(JSON.parse(ev!.payload)).toEqual({ meta_evento_id: 1, dedupe_key: 'TAINA-CTWA-9-LeadSubmitted' });
  });
});
