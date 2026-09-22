import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { fakeD1 } from '../helpers/fakeD1';
import { enviarConversao } from '../../src/pipelines/stageChanged';
import type { Env } from '../../src/env';

/**
 * Taina: funil com evento da Meta na entrada (Novo Lead) e na venda
 * (Oportunidade Ganha). Os testes do Google continuam em stageChanged.test.ts.
 */
function cenario(over: { dataset?: string | null; dryRun?: number } = {}) {
  const { d1, exec, consultar } = fakeD1();
  exec(`INSERT INTO tenants (id, slug, nome, ativo) VALUES (5, 'taina', 'Taina', 1)`);
  exec(`INSERT INTO tenant_config (tenant_id, cw_account_id, cw_board_funil_id, ingest_key,
          ga_customer_id, ga_currency, validate_only, meta_dataset_id, meta_page_id, meta_dry_run)
        VALUES (5, 3, 9, 'k', '6973821129', 'BRL', 0,
                ${over.dataset === undefined ? `'1234567890'` : over.dataset === null ? 'NULL' : `'${over.dataset}'`},
                '555', ${over.dryRun ?? 0})`);
  exec(`INSERT INTO credenciais (chave, valor) VALUES ('datamanager_refresh_token', 'rt')`);

  // [posicao, nome, cw_step_id, conversion_event, conversion_action_id, conversion_value, meta_evento]
  for (const [pos, nome, step, ev, ca, val, meta] of [
    [1, 'Novo Lead', 22, 'conversa', '7698886680', '10', 'LeadSubmitted'],
    [2, 'Qualificando', 23, null, null, 'NULL', null],
    [3, 'Agendamento', 24, 'qualificado_1', '7698566576', '100', null],
    [6, 'Oportunidade Ganha', 33, 'compra', '7698567533', 'NULL', 'Purchase'],
  ] as const) {
    exec(`INSERT INTO funnel_stages (tenant_id, posicao, nome, cw_step_id, conversion_event,
            conversion_action_id, conversion_value, meta_evento)
          VALUES (5, ${pos}, '${nome}', ${step}, ${ev ? `'${ev}'` : 'NULL'}, ${ca ? `'${ca}'` : 'NULL'},
                  ${val}, ${meta ? `'${meta}'` : 'NULL'})`);
  }

  exec(`INSERT INTO leads (tenant_id, protocol, phone_e164, phone_key, utm_source, utm_medium,
          ctwa_clid, origem, evento, created_at)
        VALUES (5, 'TAINA-CTWA-9', '+5571991065853', '7191065853', 'facebook', 'mensagem',
                'ARAk-clid', 'mensagem', 'anuncio_meta', datetime('now','-1 hour'))`);

  const fila: Array<Record<string, unknown>> = [];
  const env = {
    DB: d1,
    CACHE: { get: async () => null, put: async () => undefined } as unknown as KVNamespace,
    QUEUE: { send: async (m: Record<string, unknown>) => { fila.push(m); } },
    GOOGLE_ADS_CLIENT_ID: 'ci', GOOGLE_ADS_CLIENT_SECRET: 'cs',
    GOOGLE_ADS_REFRESH_TOKEN: 'rt', GOOGLE_ADS_DEVELOPER_TOKEN: 'dt',
    GOOGLE_ADS_MCC_ID: '3780611396',
  } as unknown as Env;
  return { env, exec, consultar, fila };
}

const card = (step: number, over: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: 1526,
    board_step_id: step,
    custom_attributes: { protocolo: 'TAINA-CTWA-9' },
    value: null,
    step_changed_at: new Date(Date.now() - 60_000).toISOString(),
    ...over,
  });

let chamadas: string[];
beforeEach(() => {
  chamadas = [];
  vi.stubGlobal('fetch', async (url: string) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com')) return Response.json({ access_token: 'at' });
    chamadas.push(u);
    return Response.json({ requestId: 'req-1' });
  });
});
afterEach(() => vi.unstubAllGlobals());

const eventos = (c: (q: string) => any[]) =>
  c('SELECT dedupe_key, event_id, canal, event_name, etapa, value, currency, status FROM meta_eventos');

describe('enviarConversao: lead da Meta', () => {
  test('etapa com evento: grava o evento da Meta e enfileira o envio, sem tocar no Google', async () => {
    const { env, consultar, fila } = cenario();
    const r = await enviarConversao(env, 5, card(22));

    expect(r.status).toBe('ok');
    expect(eventos(consultar)).toEqual([{
      dedupe_key: 'TAINA-CTWA-9-LeadSubmitted', event_id: 'TAINA-CTWA-9-LeadSubmitted', canal: 'whatsapp',
      event_name: 'LeadSubmitted', etapa: 'Novo Lead', value: 10, currency: 'BRL', status: 'pendente',
    }]);
    expect(fila).toEqual([expect.objectContaining({ tenantId: 5, source: 'kanban', eventType: 'meta_capi' })]);
    expect(chamadas).toEqual([]);
    expect(consultar('SELECT * FROM conversions')).toHaveLength(0);
  });

  test('lead do Google na mesma etapa: sobe para o Google, como hoje', async () => {
    const { env, exec, consultar, fila } = cenario();
    exec(`UPDATE leads SET ctwa_clid = NULL, utm_source = 'google', gclid = 'Cj0abc'`);
    const r = await enviarConversao(env, 5, card(22));
    expect(r.status).toBe('ok');
    expect(chamadas.some((u) => u.includes('datamanager.googleapis.com'))).toBe(true);
    expect(eventos(consultar)).toEqual([]);
    expect(fila).toEqual([]);
  });

  test('etapa sem evento da Meta: ignorado com motivo', async () => {
    const { env, consultar } = cenario();
    const r = await enviarConversao(env, 5, card(24));
    expect(r.status).toBe('ignorado');
    expect(r.motivo).toContain('sem evento da Meta');
    expect(eventos(consultar)).toEqual([]);
  });

  test('formulario nativo da Meta fica de fora', async () => {
    const { env, exec, consultar } = cenario();
    exec(`UPDATE leads SET ctwa_clid = NULL, utm_source = 'meta', evento = 'meta_lead_form'`);
    const r = await enviarConversao(env, 5, card(22));
    expect(r.status).toBe('ignorado');
    expect(r.motivo).toContain('formulario');
    expect(eventos(consultar)).toEqual([]);
  });

  test('cliente sem dataset da Meta: nada e criado', async () => {
    const { env, consultar } = cenario({ dataset: null });
    const r = await enviarConversao(env, 5, card(22));
    expect(r.status).toBe('ignorado');
    expect(r.motivo).toContain('dataset');
    expect(eventos(consultar)).toEqual([]);
  });

  test('Purchase sem valor e segurado, sem criar a linha', async () => {
    const { env, consultar } = cenario();
    const r = await enviarConversao(env, 5, card(33));
    expect(r).toMatchObject({ status: 'erro', retentar: false });
    expect(r.motivo).toContain('evento da Meta');
    expect(eventos(consultar)).toEqual([]);
  });

  test('Purchase com o valor do card', async () => {
    const { env, consultar } = cenario();
    await enviarConversao(env, 5, card(33, { value: 350 }));
    expect(eventos(consultar)).toEqual([expect.objectContaining({
      dedupe_key: 'TAINA-CTWA-9-Purchase', event_name: 'Purchase', value: 350,
    })]);
  });

  test('o mesmo evento ja enviado nao volta para a fila', async () => {
    const { env, exec, fila } = cenario();
    await enviarConversao(env, 5, card(22));
    exec(`UPDATE meta_eventos SET status = 'enviado'`);
    const r = await enviarConversao(env, 5, card(22));
    expect(r.status).toBe('ignorado');
    expect(fila).toHaveLength(1);
  });

  test('o que falhou volta para a fila na retentativa', async () => {
    const { env, exec, consultar, fila } = cenario();
    await enviarConversao(env, 5, card(22));
    exec(`UPDATE meta_eventos SET status = 'falhou'`);
    const r = await enviarConversao(env, 5, card(22));
    expect(r.status).toBe('ok');
    expect(fila).toHaveLength(2);
    expect(eventos(consultar)[0].status).toBe('pendente');
  });

  test('guardado com o envio desligado passa a valer quando o envio liga', async () => {
    const { env, exec, fila } = cenario();
    await enviarConversao(env, 5, card(22));
    exec(`UPDATE meta_eventos SET status = 'nao_enviado'`);
    const r = await enviarConversao(env, 5, card(22));
    expect(r.status).toBe('ok');
    expect(fila).toHaveLength(2);
  });

  test('ja enviado pelo whatsapp-track para este telefone: nao manda de novo', async () => {
    const { env, exec, consultar } = cenario();
    exec(`INSERT INTO meta_eventos (tenant_id, dedupe_key, event_id, phone_key, canal, event_name, status, origem, event_at)
          VALUES (5, 'trk-77', 'trk-77', '7191065853', 'whatsapp', 'LeadSubmitted', 'enviado', 'tracker', '2026-09-10T10:00:00Z')`);
    const r = await enviarConversao(env, 5, card(22));
    expect(r.status).toBe('ignorado');
    expect(r.motivo).toContain('whatsapp-track');
    expect(eventos(consultar)).toHaveLength(1);
  });

  test('o clique chegou depois da atribuicao: e achado no envio e gravado no lead', async () => {
    const { env, exec, consultar } = cenario();
    exec(`UPDATE leads SET protocol = 'TAINA-MSG-9', ctwa_clid = NULL, utm_source = 'meta', evento = 'frase_entrada'`);
    exec(`INSERT INTO meta_atribuicoes (tenant_id, phone_key, ctwa_clid, recebido_em)
          VALUES (5, '7191065853', 'clid-tardio', datetime('now','-30 minute'))`);
    const r = await enviarConversao(env, 5, card(22, { custom_attributes: { protocolo: 'TAINA-MSG-9' } }));
    expect(r.status).toBe('ok');
    expect(consultar('SELECT ctwa_clid FROM leads')).toEqual([{ ctwa_clid: 'clid-tardio' }]);
    expect(eventos(consultar)[0]).toMatchObject({ canal: 'whatsapp', event_name: 'LeadSubmitted' });
  });

  test('lead da Meta sem clique e sem fbc: nada a enviar', async () => {
    const { env, exec, consultar } = cenario();
    exec(`UPDATE leads SET ctwa_clid = NULL, utm_source = 'meta', evento = 'frase_entrada'`);
    const r = await enviarConversao(env, 5, card(22));
    expect(r.status).toBe('ignorado');
    expect(r.motivo).toContain('ctwa_clid');
    expect(eventos(consultar)).toEqual([]);
  });

  test('lead do site com fbc vai pelo canal do site', async () => {
    const { env, exec, consultar } = cenario();
    exec(`UPDATE leads SET ctwa_clid = NULL, utm_source = 'meta', fbc = 'fb.1.170.abc', evento = 'whatsapp_click'`);
    await enviarConversao(env, 5, card(22));
    expect(eventos(consultar)[0]).toMatchObject({ canal: 'site' });
  });
});
