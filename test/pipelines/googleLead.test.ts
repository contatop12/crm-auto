import { describe, test, expect, afterEach, vi } from 'vitest';
import { fakeD1 } from '../helpers/fakeD1';
import { parseGoogleLead, protocoloGoogle } from '../../src/domain/googleLead';
import { registrarLeadGoogle } from '../../src/pipelines/googleLead';
import { atribuirLead } from '../../src/pipelines/leadMessage';
import { ingest } from '../../src/routes/ingest';
import { consumir } from '../../src/queue/consumer';
import type { Env, QueueMessage } from '../../src/env';

/**
 * Formulario nativo do Google Ads (extensao de formulario de lead).
 *
 * Locadora, 23/11/2026: o formulario foi ligado a Pulseboard, que avisa o
 * grupo, mas o CRM nao tinha entrada para ele. Sem o lead gravado aqui, quando
 * a pessoa fosse atendida no WhatsApp a conversa nao casava com nada: ficava no
 * Organico e nenhuma conversao voltava ao Google, mesmo com o `gcl_id` em maos.
 */

/** O corpo que o Google manda no webhook do formulario, com dados ficticios. */
const google = (over: Record<string, unknown> = {}) => JSON.stringify({
  lead_id: 'Cj0KCQiA-LEAD-ficticio_0001',
  api_version: '1.0',
  form_id: 177390423819,
  campaign_id: 21802734158,
  adgroup_id: 20000000000,
  creative_id: 30000000000,
  gcl_id: 'Cj0KCQiA-gclid-ficticio',
  google_key: 'chave-do-formulario',
  is_test: false,
  user_column_data: [
    { column_id: 'FULL_NAME', column_name: 'Full Name', string_value: 'Maria Exemplo' },
    { column_id: 'PHONE_NUMBER', column_name: 'User Phone', string_value: '+5511912345678' },
    { column_id: 'EMAIL', column_name: 'User Email', string_value: 'maria@exemplo.com' },
    { column_id: 'o_que_gostaria_de_alugar?', column_name: 'O que gostaria de alugar?', string_value: 'Andaime' },
  ],
  ...over,
});

function cenario() {
  const { d1, exec, consultar } = fakeD1();
  exec(`INSERT INTO tenants (id, slug, nome, ativo) VALUES (1, 'locadora', 'Locadora', 1)`);
  exec(`INSERT INTO tenant_config (tenant_id, cw_account_id, cw_board_funil_id, ingest_key, gtm_prefixo, janela_match_dias)
        VALUES (1, 5, 9, 'legado', 'EXATID', 90)`);
  exec(`INSERT INTO ingest_keys (tenant_id, canal, chave) VALUES (1, 'meta', 'k-form')`);
  const fila: QueueMessage[] = [];
  const env = {
    DB: d1,
    QUEUE: { send: async (m: QueueMessage) => { fila.push(m); } },
    CACHE: { get: async () => null, put: async () => undefined },
    CHATWOOT_BASE_URL: 'https://cw.teste',
    CHATWOOT_API_TOKEN: 't',
  } as unknown as Env;
  return { env, exec, consultar, fila };
}

type Linha = Record<string, string | null>;
const leads = (c: ReturnType<typeof cenario>) =>
  c.consultar<Linha>(`SELECT protocol, nome, email, phone_e164, phone_key, gclid, utm_source, utm_medium, utm_campaign, utm_id, utm_content, origem, evento FROM leads`);

afterEach(() => vi.unstubAllGlobals());

describe('parseGoogleLead', () => {
  test('le nome, telefone, e-mail e o clique do corpo do Google', () => {
    const l = parseGoogleLead(JSON.parse(google()))!;
    expect(l).toMatchObject({
      leadId: 'Cj0KCQiA-LEAD-ficticio_0001',
      nome: 'Maria Exemplo',
      telefone: '+5511912345678',
      email: 'maria@exemplo.com',
      gclid: 'Cj0KCQiA-gclid-ficticio',
      campanhaId: '21802734158',
      anuncioId: '30000000000',
      formId: '177390423819',
    });
  });

  test('nome em duas colunas (FIRST_NAME + LAST_NAME)', () => {
    const l = parseGoogleLead(JSON.parse(google({
      user_column_data: [
        { column_id: 'FIRST_NAME', string_value: 'Maria' },
        { column_id: 'LAST_NAME', string_value: 'Exemplo' },
        { column_id: 'PHONE_NUMBER', string_value: '+5511912345678' },
      ],
    })))!;
    expect(l.nome).toBe('Maria Exemplo');
  });

  test('corpo ja achatado pela automacao (data.full_name / data.phone_number)', () => {
    const l = parseGoogleLead({ lead_id: 'x1', gcl_id: 'g1', data: { full_name: 'Maria Exemplo', phone_number: '+5511912345678' } })!;
    expect(l).toMatchObject({ nome: 'Maria Exemplo', telefone: '+5511912345678', gclid: 'g1' });
  });

  test('sem telefone o lead nao serve', () => {
    expect(parseGoogleLead(JSON.parse(google({ user_column_data: [{ column_id: 'FULL_NAME', string_value: 'Maria' }] })))).toBeNull();
  });
});

describe('protocoloGoogle', () => {
  test('curto, estavel e marcado como formulario do Google', () => {
    expect(protocoloGoogle('EXATID', 'Cj0KCQiA-LEAD-ficticio_0001', '+5511912345678')).toBe('EXATID-GFORM-ADFICTICIO0001');
    // o mesmo lead reenviado da' o mesmo protocolo
    expect(protocoloGoogle('EXATID', 'Cj0KCQiA-LEAD-ficticio_0001')).toBe('EXATID-GFORM-ADFICTICIO0001');
  });

  test('sem id do lead cai no telefone', () => {
    expect(protocoloGoogle('EXATID', null, '+5511912345678')).toBe('EXATID-GFORM-5511912345678');
  });
});

describe('registrarLeadGoogle', () => {
  test('grava o lead com o clique do Google e os dados do formulario', async () => {
    const c = cenario();
    const r = await registrarLeadGoogle(c.env, 1, google());

    expect(r.status).toBe('ok');
    expect(leads(c)).toEqual([{
      protocol: 'EXATID-GFORM-ADFICTICIO0001',
      nome: 'Maria Exemplo',
      email: 'maria@exemplo.com',
      phone_e164: '+5511912345678',
      phone_key: '1112345678',
      gclid: 'Cj0KCQiA-gclid-ficticio',
      utm_source: 'google',
      utm_medium: 'lead_form',
      utm_campaign: '21802734158',
      utm_id: '21802734158',
      utm_content: '30000000000',
      origem: 'formulario',
      evento: 'google_lead_form',
    }]);
  });

  test('o teste do Google (is_test) nao vira lead', async () => {
    const c = cenario();
    const r = await registrarLeadGoogle(c.env, 1, google({ is_test: true }));
    expect(r).toEqual({ status: 'ignorado', motivo: 'teste do formulario do Google (is_test): nada gravado' });
    expect(leads(c)).toHaveLength(0);
  });

  test('o mesmo lead reenviado nao duplica', async () => {
    const c = cenario();
    await registrarLeadGoogle(c.env, 1, google());
    await registrarLeadGoogle(c.env, 1, google());
    expect(leads(c)).toHaveLength(1);
  });

  test('formulario sem telefone e recusado', async () => {
    const c = cenario();
    const r = await registrarLeadGoogle(c.env, 1, google({ user_column_data: [{ column_id: 'FULL_NAME', string_value: 'Maria' }] }));
    expect(r.status).toBe('ignorado');
    expect(leads(c)).toHaveLength(0);
  });

  test('quando a pessoa aparece no WhatsApp, a conversa casa com o lead do formulario e leva o gclid', async () => {
    const c = cenario();
    await registrarLeadGoogle(c.env, 1, google());
    const escritas: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit = {}) => {
      if (init.method && init.method !== 'GET' && init.body) escritas.push(JSON.parse(String(init.body)));
      return Response.json({ custom_attributes: {}, labels: [] });
    });

    const r = await atribuirLead(c.env, 1, JSON.stringify({
      event: 'message_incoming',
      message_type: 'incoming',
      content: 'Oi, preenchi o formulario',
      conversation: {
        id: 900,
        custom_attributes: {},
        labels: [],
        meta: { sender: { name: 'Maria Exemplo', phone_number: '+5511912345678' } },
        kanban_task: { id: 5000, board_id: 10 },
      },
    }));

    expect(r.status).toBe('ok');
    const attrs = escritas.map((e) => e.custom_attributes as Record<string, string> | undefined).find((a) => a?.protocolo);
    expect(attrs).toMatchObject({ protocolo: 'EXATID-GFORM-ADFICTICIO0001', gclid: 'Cj0KCQiA-gclid-ficticio', funil: 'PROMOVER' });
  });
});

describe('POST /ingest/:slug/google-lead', () => {
  const postar = (env: Env, corpo: string, k = 'k-form') =>
    ingest.request(`/locadora/google-lead?k=${k}`, { method: 'POST', body: corpo }, env);

  test('chave errada: 401 e nada gravado', async () => {
    const c = cenario();
    const r = await postar(c.env, google(), 'errada');
    expect(r.status).toBe(401);
    expect(c.consultar('SELECT 1 FROM events')).toHaveLength(0);
  });

  test('aceita, guarda o evento sem a chave do Google e poe na fila', async () => {
    const c = cenario();
    const r = await postar(c.env, google());

    expect(r.status).toBe(200);
    const ev = c.consultar<{ source: string; event_type: string; payload: string }>('SELECT source, event_type, payload FROM events')[0]!;
    expect(ev.event_type).toBe('google_lead_form');
    expect(ev.payload).not.toContain('chave-do-formulario');
    expect(JSON.parse(ev.payload).lead_id).toBe('Cj0KCQiA-LEAD-ficticio_0001');
    expect(c.fila).toHaveLength(1);
    expect(c.fila[0]).toMatchObject({ tenantId: 1, eventType: 'google_lead_form' });
  });

  test('da fila ao banco: o evento vira lead', async () => {
    const c = cenario();
    await postar(c.env, google());
    await consumir({ messages: [{ body: c.fila[0]!, attempts: 1, ack: () => undefined, retry: () => undefined }] } as unknown as MessageBatch<QueueMessage>, c.env);

    expect(leads(c)).toHaveLength(1);
    const ev = c.consultar<{ status: string; motivo: string }>('SELECT status, motivo FROM events')[0]!;
    expect(ev.status).toBe('ok');
    expect(ev.motivo).toContain('EXATID-GFORM-ADFICTICIO0001');
  });
});
