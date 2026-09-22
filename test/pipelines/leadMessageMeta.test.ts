import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { fakeD1 } from '../helpers/fakeD1';
import { atribuirLead } from '../../src/pipelines/leadMessage';
import type { Env } from '../../src/env';

/**
 * Taina: campanha de mensagem da Meta. Todo lead chega com
 * "Olá! Gostaria de mais informações [Protocolo: MA21RMKT]" e o clique do
 * anuncio (ctwa_clid) chega pela Evolution, em `meta_atribuicoes`.
 */
function cenario(over: { evolution?: boolean } = {}) {
  const { d1, exec, consultar } = fakeD1();
  exec(`INSERT INTO tenants (id, slug, nome, ativo) VALUES (5, 'taina', 'Dra. Tainã', 1)`);
  exec(`INSERT INTO tenant_config (tenant_id, cw_account_id, cw_board_funil_id, ingest_key, gtm_prefixo,
          rastrear_meta_mensagem, meta_dataset_id, meta_page_id, meta_dry_run)
        VALUES (5, 3, 9, 'k', 'TAINA', 1, '1234567890', '555', 0)`);
  exec(`INSERT INTO lead_entry_phrases (tenant_id, frase, origem, plataforma) VALUES (5, 'MA21RMKT', 'mensagem', 'meta')`);
  exec(`INSERT INTO funnel_stages (tenant_id, posicao, nome, cw_step_id, meta_evento)
        VALUES (5, 1, 'Novo Lead', 22, 'LeadSubmitted')`);
  if (over.evolution !== false) {
    exec(`INSERT INTO ingest_keys (tenant_id, canal, chave) VALUES (5, 'evolution', 'k-evo')`);
  }
  const fila: Array<Record<string, unknown>> = [];
  const env = {
    DB: d1,
    CACHE: { get: async () => null, put: async () => undefined },
    QUEUE: { send: async (m: Record<string, unknown>) => { fila.push(m); } },
    CHATWOOT_BASE_URL: 'https://cw.teste',
    CHATWOOT_API_TOKEN: 'tok',
    EVOLUTION_SERVER_URL: 'https://evo.teste',
    EVOLUTION_API_KEY: 'x',
  } as unknown as Env;
  return { env, exec, consultar, fila };
}

/** O clique que a Evolution guardou para o telefone do lead. */
function clique(exec: (s: string) => void, quando = "datetime('now','-1 minute')") {
  exec(`INSERT INTO meta_atribuicoes (tenant_id, phone_key, phone_e164, ctwa_clid, source_url, titulo, evo_instancia, recebido_em)
        VALUES (5, '7191065853', '+5571991065853', 'ARAk-clid', 'https://fb.me/abc', 'Harmonização', 'Tainã Aci', ${quando})`);
}

const MSG = 'Olá! Gostaria de mais informações [Protocolo: MA21RMKT]';

function webhook(content = MSG) {
  return JSON.stringify({
    event: 'message_created',
    message_type: 'incoming',
    content,
    conversation: {
      id: 76,
      custom_attributes: {},
      labels: [],
      meta: { sender: { name: 'Maria', phone_number: '+557191065853' } },
      kanban_task: { id: 1421, board_id: 9 },
    },
  });
}

let chamadas: Array<{ metodo: string; url: string; corpo: unknown }>;

beforeEach(() => {
  chamadas = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const metodo = init.method ?? 'GET';
    let corpo: unknown = null;
    try { corpo = init.body ? JSON.parse(String(init.body)) : null; } catch { corpo = String(init.body); }
    chamadas.push({ metodo, url: String(url), corpo });
    if (metodo === 'GET' && /\/conversations\/76$/.test(String(url))) {
      return Response.json({ custom_attributes: {}, labels: [] });
    }
    if (metodo === 'GET' && /\/kanban\/tasks\/1421$/.test(String(url))) return Response.json({ custom_attributes: {} });
    return Response.json({ ok: true });
  });
});
afterEach(() => vi.unstubAllGlobals());

function atributos(): Record<string, string> {
  const c = chamadas.find((x) => x.metodo !== 'GET' && /custom_attributes/.test(x.url));
  if (!c) throw new Error('nenhum custom_attributes gravado');
  return (c.corpo as { custom_attributes: Record<string, string> }).custom_attributes;
}

describe('atribuirLead: campanha de mensagem da Meta', () => {
  test('MA21RMKT com o clique da Evolution: lead do anuncio com ctwa_clid, promovido e LeadSubmitted na fila', async () => {
    const { env, exec, consultar, fila } = cenario();
    clique(exec);
    const r = await atribuirLead(env, 5, webhook(), { tentativa: 1 });

    expect(r.status).toBe('ok');
    expect(consultar('SELECT protocol, ctwa_clid, utm_source, utm_content FROM leads')).toEqual([
      { protocol: 'TAINA-CTWA-76', ctwa_clid: 'ARAk-clid', utm_source: 'facebook', utm_content: 'Harmonização' },
    ]);
    expect(atributos().protocolo).toBe('TAINA-CTWA-76');
    expect(atributos().funil).toBe('PROMOVER');
    expect(consultar('SELECT dedupe_key, canal, event_name, status FROM meta_eventos')).toEqual([
      { dedupe_key: 'TAINA-CTWA-76-LeadSubmitted', canal: 'whatsapp', event_name: 'LeadSubmitted', status: 'pendente' },
    ]);
    expect(fila).toEqual([expect.objectContaining({ tenantId: 5, source: 'kanban', eventType: 'meta_capi' })]);
  });

  test('sem o clique na 1a tentativa: espera, sem criar lead nem mexer no Chatwoot', async () => {
    const { env, consultar } = cenario();
    const r = await atribuirLead(env, 5, webhook(), { tentativa: 1 });
    expect(r.adiar).toBe(true);
    expect(consultar('SELECT * FROM leads')).toHaveLength(0);
    expect(chamadas.filter((c) => c.metodo !== 'GET')).toEqual([]);
  });

  test('o clique chegou durante a espera: vira lead do anuncio, sem lead duplicado', async () => {
    const { env, exec, consultar } = cenario();
    await atribuirLead(env, 5, webhook(), { tentativa: 1 });
    clique(exec);
    const r = await atribuirLead(env, 5, webhook(), { tentativa: 2 });
    expect(r.status).toBe('ok');
    expect(consultar('SELECT protocol, ctwa_clid FROM leads')).toEqual([
      { protocol: 'TAINA-CTWA-76', ctwa_clid: 'ARAk-clid' },
    ]);
  });

  test('na 2a tentativa segue sem o clique: lead da frase, e nenhum evento da Meta', async () => {
    const { env, consultar } = cenario();
    const r = await atribuirLead(env, 5, webhook(), { tentativa: 2 });
    expect(r.status).toBe('ok');
    expect(consultar('SELECT protocol, ctwa_clid FROM leads')).toEqual([{ protocol: 'TAINA-MSG-76', ctwa_clid: null }]);
    expect(atributos().funil).toBe('PROMOVER');
    expect(consultar('SELECT * FROM meta_eventos')).toHaveLength(0);
  });

  test('clique da Evolution sem a frase tambem vira lead do anuncio', async () => {
    const { env, exec, consultar } = cenario();
    clique(exec);
    const r = await atribuirLead(env, 5, webhook('Oi, quanto custa?'), { tentativa: 1 });
    expect(r.status).toBe('ok');
    expect(consultar('SELECT protocol, ctwa_clid FROM leads')).toEqual([{ protocol: 'TAINA-CTWA-76', ctwa_clid: 'ARAk-clid' }]);
  });

  test('mensagem organica nunca espera', async () => {
    const { env, consultar } = cenario();
    const r = await atribuirLead(env, 5, webhook('Bom dia'), { tentativa: 1 });
    expect(r.adiar).toBeUndefined();
    expect(r.status).toBe('ignorado');
    expect(consultar('SELECT * FROM leads')).toHaveLength(0);
  });

  test('clique com mais de 7 dias nao conta', async () => {
    const { env, exec, consultar } = cenario();
    clique(exec, "datetime('now','-8 day')");
    const r = await atribuirLead(env, 5, webhook('Bom dia'), { tentativa: 1 });
    expect(r.status).toBe('ignorado');
    expect(consultar('SELECT * FROM leads')).toHaveLength(0);
  });

  test('cliente sem a Evolution ligada ao CRM nao espera: o clique nunca viria', async () => {
    const { env, consultar } = cenario({ evolution: false });
    const r = await atribuirLead(env, 5, webhook(), { tentativa: 1 });
    expect(r.adiar).toBeUndefined();
    expect(consultar('SELECT protocol FROM leads')).toEqual([{ protocol: 'TAINA-MSG-76' }]);
  });
});
