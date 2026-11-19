import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { fakeD1 } from '../helpers/fakeD1';
import {
  agendarLinkDaConversa,
  entregarLinkDaConversa,
  EVENTO_CONVERSA_DO_FORMULARIO,
  ESPERA_INICIAL_S,
  TENTATIVAS_PROCURANDO_CONVERSA,
} from '../../src/pipelines/conversaDoFormulario';
import type { Env } from '../../src/env';

/**
 * O aviso de formulario/quiz saia sem o link da conversa: o CRM so' o mandava
 * quando o lead RESPONDIA e o card entrava no funil de Ads. A conversa ja'
 * existia segundos depois do formulario (a mensagem de boas-vindas do fluxo a
 * cria) — lead 44NOV da Taina, 19/11/2026: conversa aberta 5 s depois do
 * formulario, aviso sem link porque ela nao respondeu.
 */

const PROTOCOLO = 'TAINA-TESTE0000001';

function cenario() {
  const { d1, exec, consultar } = fakeD1();
  exec(`INSERT INTO tenants (id, slug, nome, ativo) VALUES (1, 'taina', 'Taina Aci', 1)`);
  exec(`INSERT INTO tenant_config (tenant_id, cw_account_id, cw_board_funil_id, cw_board_organico_id,
          pulseboard_url, ingest_key)
        VALUES (1, 4, 5, 6, 'https://pulseboard.teste/leads/taina-aci-mensagem', 'k')`);
  const fila: Array<{ corpo: Record<string, unknown>; opcoes: unknown }> = [];
  const kv = new Map<string, string>();
  const env = {
    DB: d1,
    CHATWOOT_BASE_URL: 'https://cw.teste',
    CHATWOOT_API_TOKEN: 't',
    QUEUE: { send: async (corpo: Record<string, unknown>, opcoes?: unknown) => { fila.push({ corpo, opcoes }); } },
    CACHE: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => { kv.set(k, v); },
    },
  } as unknown as Env;
  return { env, exec, consultar, fila };
}

function lead(exec: (sql: string) => void, over: Partial<Record<string, string | null>> = {}) {
  const l = {
    protocol: PROTOCOLO,
    nome: 'ana teste',
    phone_e164: '+5511999990001',
    phone_key: '1199990001',
    origem: 'formulario',
    evento: 'form_submit',
    quiz_version: null,
    ...over,
  };
  const v = (x: string | null) => (x === null ? 'NULL' : `'${x}'`);
  exec(`INSERT INTO leads (tenant_id, protocol, nome, phone_e164, phone_key, origem, evento, quiz_version)
        VALUES (1, ${v(l.protocol)}, ${v(l.nome)}, ${v(l.phone_e164)}, ${v(l.phone_key)}, ${v(l.origem)},
                ${v(l.evento)}, ${v(l.quiz_version)})`);
}

const clique = (protocolo = PROTOCOLO) => JSON.stringify({ protocol: protocolo, event: 'form_submit' });
const job = (protocolo = PROTOCOLO) => JSON.stringify({ protocolo });

interface Chamada { metodo: string; url: string; corpo: Record<string, unknown> | null }

/** Chatwoot e Pulseboard de mentira. `contatos`: o que a busca devolve; `conversas`: por contato. */
function rede(o: {
  contatos?: Array<{ id: number; phone_number: string | null; name?: string }>;
  conversas?: Record<number, Array<Record<string, unknown>>>;
  pulseboard?: () => Response;
}) {
  const chamadas: Chamada[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const u = String(url);
    const metodo = String(init.method ?? 'GET');
    chamadas.push({ metodo, url: u, corpo: init.body ? JSON.parse(String(init.body)) : null });
    if (u.includes('/contacts/search')) return Response.json({ payload: o.contatos ?? [] });
    const m = /\/contacts\/(\d+)\/conversations$/.exec(u);
    if (m) return Response.json({ payload: o.conversas?.[Number(m[1])] ?? [] });
    if (u.startsWith('https://pulseboard.teste/')) {
      return o.pulseboard ? o.pulseboard() : Response.json({ ok: true, acao: 'guardada' });
    }
    return new Response('nao esperado', { status: 500 });
  });
  return chamadas;
}

afterEach(() => vi.unstubAllGlobals());

describe('agendarLinkDaConversa', () => {
  beforeEach(() => { rede({}); });

  test('formulario com telefone: agenda a procura da conversa para dali a pouco', async () => {
    const { env, exec, consultar, fila } = cenario();
    lead(exec);

    expect(await agendarLinkDaConversa(env, 1, clique())).toBe(true);

    const eventos = consultar<{ id: number; source: string; event_type: string; payload: string }>(
      'SELECT id, source, event_type, payload FROM events',
    );
    expect(eventos).toHaveLength(1);
    expect(eventos[0]!.event_type).toBe(EVENTO_CONVERSA_DO_FORMULARIO);
    expect(JSON.parse(eventos[0]!.payload).protocolo).toBe(PROTOCOLO);
    expect(fila).toHaveLength(1);
    expect(fila[0]!.corpo).toMatchObject({
      eventId: eventos[0]!.id, tenantId: 1, source: eventos[0]!.source, eventType: EVENTO_CONVERSA_DO_FORMULARIO,
    });
    expect(fila[0]!.opcoes).toEqual({ delaySeconds: ESPERA_INICIAL_S });
  });

  test('quiz tambem agenda', async () => {
    const { env, exec, fila } = cenario();
    lead(exec, { quiz_version: 'v2' });
    expect(await agendarLinkDaConversa(env, 1, clique())).toBe(true);
    expect(fila).toHaveLength(1);
  });

  test('clique de WhatsApp nao agenda: o aviso de mensagem ja leva o link', async () => {
    const { env, exec, fila } = cenario();
    lead(exec, { origem: 'clique', evento: 'whatsapp_click' });
    expect(await agendarLinkDaConversa(env, 1, clique())).toBe(false);
    expect(fila).toHaveLength(0);
  });

  test('formulario sem telefone nao agenda: nao ha como achar a conversa', async () => {
    const { env, exec, fila } = cenario();
    lead(exec, { phone_e164: null, phone_key: null });
    expect(await agendarLinkDaConversa(env, 1, clique())).toBe(false);
    expect(fila).toHaveLength(0);
  });

  test('cliente sem aviso no grupo nao agenda', async () => {
    const { env, exec, fila } = cenario();
    lead(exec);
    exec('UPDATE tenant_config SET pulseboard_ativo = 0 WHERE tenant_id = 1');
    expect(await agendarLinkDaConversa(env, 1, clique())).toBe(false);
    expect(fila).toHaveLength(0);
  });

  test('o beacon repetido do mesmo clique agenda uma vez so', async () => {
    const { env, exec, fila } = cenario();
    lead(exec);
    expect(await agendarLinkDaConversa(env, 1, clique())).toBe(true);
    expect(await agendarLinkDaConversa(env, 1, clique())).toBe(false);
    expect(fila).toHaveLength(1);
  });

  test('corpo que nao e json ou sem protocolo nao quebra', async () => {
    const { env, fila } = cenario();
    expect(await agendarLinkDaConversa(env, 1, 'nao e json')).toBe(false);
    expect(await agendarLinkDaConversa(env, 1, '{}')).toBe(false);
    expect(fila).toHaveLength(0);
  });
});

describe('entregarLinkDaConversa', () => {
  test('acha a conversa do lead e entrega o link a Pulseboard', async () => {
    const { env, exec } = cenario();
    lead(exec);
    const chamadas = rede({
      contatos: [{ id: 501, phone_number: '+5511999990001', name: '5511999990001' }],
      conversas: { 501: [{ id: 1500, inbox_id: 10, status: 'open', last_activity_at: 1000 }] },
    });

    const r = await entregarLinkDaConversa(env, 1, job());

    expect(r.status).toBe('ok');
    expect(r.motivo).toContain('1500');
    expect(r.motivo).toContain('guardada');
    const pb = chamadas.filter((c) => c.url.startsWith('https://pulseboard.teste/'));
    expect(pb).toHaveLength(1);
    expect(pb[0]!.url).toBe('https://pulseboard.teste/leads/taina-aci-mensagem/conversa');
    expect(pb[0]!.corpo).toEqual({
      telefone: '5511999990001',
      nome: 'ana teste',
      conversa: 'https://cw.teste/app/accounts/4/conversations/1500',
    });
    // a busca vai pelos 8 ultimos digitos: casa com e sem o nono digito
    expect(chamadas[0]!.url).toContain('/api/v1/accounts/4/contacts/search?q=99990001');
  });

  test('casa pelo telefone sem o nono digito e ignora contato de outro DDD', async () => {
    const { env, exec } = cenario();
    lead(exec);
    const chamadas = rede({
      contatos: [
        { id: 1, phone_number: '+5521999990001' },
        { id: 2, phone_number: null },
        { id: 3, phone_number: '+551199990001' },
      ],
      conversas: { 1: [{ id: 900, inbox_id: 10 }], 3: [{ id: 77, inbox_id: 10 }] },
    });

    const r = await entregarLinkDaConversa(env, 1, job());

    expect(r.status).toBe('ok');
    const pb = chamadas.find((c) => c.url.startsWith('https://pulseboard.teste/'))!;
    expect(pb.corpo!.conversa).toBe('https://cw.teste/app/accounts/4/conversations/77');
  });

  test('com mais de uma conversa, vale a de atividade mais recente', async () => {
    const { env, exec } = cenario();
    lead(exec);
    const chamadas = rede({
      contatos: [{ id: 5, phone_number: '+5511999990001' }],
      conversas: { 5: [
        { id: 10, inbox_id: 10, last_activity_at: 100 },
        { id: 30, inbox_id: 11, last_activity_at: 300 },
        { id: 20, inbox_id: 10, last_activity_at: 200 },
      ] },
    });

    await entregarLinkDaConversa(env, 1, job());

    const pb = chamadas.find((c) => c.url.startsWith('https://pulseboard.teste/'))!;
    expect(pb.corpo!.conversa).toBe('https://cw.teste/app/accounts/4/conversations/30');
  });

  test('conversa ainda nao existe: volta para a fila, sem virar erro', async () => {
    const { env, exec } = cenario();
    lead(exec);
    const chamadas = rede({ contatos: [] });

    const r = await entregarLinkDaConversa(env, 1, job(), { tentativa: 1 });

    expect(r.adiar).toBe(true);
    expect(chamadas.some((c) => c.url.startsWith('https://pulseboard.teste/'))).toBe(false);
  });

  test('contato sem conversa nenhuma tambem espera', async () => {
    const { env, exec } = cenario();
    lead(exec);
    rede({ contatos: [{ id: 5, phone_number: '+5511999990001' }], conversas: { 5: [] } });
    const r = await entregarLinkDaConversa(env, 1, job(), { tentativa: 2 });
    expect(r.adiar).toBe(true);
  });

  test('na ultima tentativa desiste em silencio: o link vai quando o lead chamar', async () => {
    const { env, exec } = cenario();
    lead(exec);
    rede({ contatos: [] });

    const r = await entregarLinkDaConversa(env, 1, job(), { tentativa: TENTATIVAS_PROCURANDO_CONVERSA });

    expect(r.status).toBe('ignorado');
    expect(r.adiar).toBeFalsy();
    expect(r.motivo).toContain('sem conversa');
  });

  test('Pulseboard fora do ar: erro que a fila retenta', async () => {
    const { env, exec } = cenario();
    lead(exec);
    rede({
      contatos: [{ id: 5, phone_number: '+5511999990001' }],
      conversas: { 5: [{ id: 10, inbox_id: 10 }] },
      pulseboard: () => new Response('bad gateway', { status: 502 }),
    });

    const r = await entregarLinkDaConversa(env, 1, job());

    expect(r.status).toBe('erro');
    expect(r.retentar).not.toBe(false);
    expect(r.motivo).toContain('Pulseboard');
  });

  test('numero da propria empresa nao e lead', async () => {
    const { env, exec } = cenario();
    lead(exec);
    exec(`UPDATE tenant_config SET numeros_proprios = '["5511999990001"]' WHERE tenant_id = 1`);
    const chamadas = rede({});
    const r = await entregarLinkDaConversa(env, 1, job());
    expect(r.status).toBe('ignorado');
    expect(chamadas).toHaveLength(0);
  });

  test('lead que sumiu ou payload ruim e ignorado', async () => {
    const { env } = cenario();
    rede({});
    expect((await entregarLinkDaConversa(env, 1, job('NAO-EXISTE'))).status).toBe('ignorado');
    expect((await entregarLinkDaConversa(env, 1, 'x')).status).toBe('ignorado');
  });

  test('nome que e so o telefone nao vai como nome', async () => {
    const { env, exec } = cenario();
    lead(exec, { nome: '5511999990001' });
    const chamadas = rede({
      contatos: [{ id: 5, phone_number: '+5511999990001' }],
      conversas: { 5: [{ id: 10, inbox_id: 10 }] },
    });
    await entregarLinkDaConversa(env, 1, job());
    const pb = chamadas.find((c) => c.url.startsWith('https://pulseboard.teste/'))!;
    expect(String(pb.corpo!.nome ?? '')).not.toContain('5511999990001');
  });
});
