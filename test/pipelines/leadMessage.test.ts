import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { fakeD1 } from '../helpers/fakeD1';
import { atribuirLead } from '../../src/pipelines/leadMessage';
import type { Env } from '../../src/env';

function cenario() {
  const { d1, exec, consultar } = fakeD1();
  exec(`INSERT INTO tenants (id, slug, nome, ativo) VALUES (1, 'vita', 'Vita', 1)`);
  exec(`INSERT INTO tenant_config (tenant_id, cw_account_id, cw_board_funil_id, ga_customer_id, evo_instancia, ingest_key, janela_match_dias)
        VALUES (1, 2, 7, '6973821129', NULL, 'k', 90)`);
  for (const [slug, zap] of [['mensagem', 'Mensagem'], ['google-ads', 'Lead do Google Ads'], ['search', 'Search'], ['formulario', null]] as const) {
    exec(`INSERT INTO label_vocabulary (tenant_id, slug, label_chatwoot, label_whatsapp)
          VALUES (1, '${slug}', '${slug}', ${zap ? `'${zap}'` : 'NULL'})`);
  }
  exec(`INSERT INTO leads (tenant_id, protocol, nome, phone_key, gclid, utm_source, utm_medium, utm_campaign, utm_id, utm_term, origem, evento, created_at)
        VALUES (1, 'VITA-MRIAP9IN8WNQ', 'Ryan', '7191065853', 'Cj0abc', 'google', 'cpc', '{campaignname}', '23920679510', 'aparelho auditivo', 'clique', 'whatsapp_click', datetime('now','-2 day'))`);
  const env = {
    DB: d1,
    CACHE: kvFalso(),
    CHATWOOT_BASE_URL: 'https://cw.teste',
    CHATWOOT_API_TOKEN: 'tok',
    GOOGLE_ADS_CLIENT_ID: 'x',
    GOOGLE_ADS_CLIENT_SECRET: 'x',
    GOOGLE_ADS_REFRESH_TOKEN: 'x',
    GOOGLE_ADS_DEVELOPER_TOKEN: 'x',
    GOOGLE_ADS_MCC_ID: '123',
    EVOLUTION_SERVER_URL: 'https://evo.teste',
    EVOLUTION_API_KEY: 'x',
  } as unknown as Env;
  return { env, consultar, exec };
}

/** KV que nunca guarda: forca o caminho sem cache, que e' o mais dificil. */
function kvFalso() {
  return { get: async () => null, put: async () => undefined };
}

function webhook(over: Record<string, unknown> = {}, conv: Record<string, unknown> = {}) {
  return JSON.stringify({
    event: 'message_created',
    message_type: 'incoming',
    content: 'Olá, vim pelo google e gostaria de mais TESTE [Protocolo: VITA-MRIAP9IN8WNQ]',
    inbox: { id: 11, name: 'Vita Audio' },
    conversation: {
      id: 76,
      custom_attributes: {},
      labels: ['mensagem'],
      meta: { sender: { name: 'Ryan Santiago', phone_number: '+557191065853' } },
      kanban_task: { id: 1421, board_id: 8 },
      ...conv,
    },
    ...over,
  });
}

/** Registra o que foi para o Chatwoot, para conferir merge e etiquetas. */
let chamadas: Array<{ metodo: string; url: string; corpo: unknown }>;
/** Etiquetas que o Chatwoot devolve no GET — e' delas que o merge parte. */
let etiquetasAtuais: string[];
/** Atributos que o Chatwoot devolve no GET — e' deles que o merge parte. */
let atributosAtuais: Record<string, string>;

beforeEach(() => {
  chamadas = [];
  etiquetasAtuais = ['mensagem'];
  atributosAtuais = { conversa_enviada: 'true' };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const metodo = init.method ?? 'GET';
    // o corpo do OAuth e urlencoded: parsear tudo como json quebrava o stub
    let corpo: unknown = null;
    try { corpo = init.body ? JSON.parse(String(init.body)) : null; } catch { corpo = String(init.body); }
    chamadas.push({ metodo, url: String(url), corpo });

    if (metodo === 'GET' && /\/conversations\/76$/.test(String(url))) {
      return Response.json({ custom_attributes: atributosAtuais, labels: etiquetasAtuais });
    }
    if (metodo === 'GET' && /\/kanban\/tasks\/1421$/.test(String(url))) {
      return Response.json({ custom_attributes: { protocolo: 'antigo' } });
    }
    if (/googleads\.googleapis\.com/.test(String(url))) {
      return Response.json({ results: [{ campaign: { id: '23920679510', name: 'Vita - Search - Aparelhos' } }] });
    }
    if (/oauth2\.googleapis\.com/.test(String(url))) return Response.json({ access_token: 'tok' });
    return Response.json({ ok: true });
  });
});
afterEach(() => vi.unstubAllGlobals());

/** Corpo da primeira escrita que casa com a rota. Falha o teste se nao houve. */
function corpoDe<T = Record<string, unknown>>(re: RegExp): T {
  const c = chamadas.find((x) => x.metodo !== 'GET' && re.test(x.url));
  if (!c) throw new Error('nenhuma escrita casou com ' + String(re));
  return c.corpo as T;
}

describe('atribuirLead', () => {
  test('le o protocolo da mensagem e grava a atribuicao na conversa', async () => {
    const { env } = cenario();
    const r = await atribuirLead(env, 1, webhook());

    expect(r.status).toBe('ok');
    const attrs = corpoDe<{ custom_attributes: Record<string, string> }>(/custom_attributes/).custom_attributes;
    expect(attrs.protocolo).toBe('VITA-MRIAP9IN8WNQ');
    expect(attrs.gclid).toBe('Cj0abc');
    expect(attrs.utm_source).toBe('google');
    expect(attrs.utm_term).toBe('aparelho auditivo');
  });

  test('preserva os atributos que ja estavam na conversa', async () => {
    // o POST substitui o objeto inteiro: sem merge, o que ja estava sumia
    const { env } = cenario();
    await atribuirLead(env, 1, webhook());
    const attrs = corpoDe<{ custom_attributes: Record<string, string> }>(/custom_attributes/).custom_attributes;
    expect(attrs.conversa_enviada).toBe('true');
  });

  test('lead de anuncio e marcado para promover ao funil de Ads', async () => {
    // a API nao move card entre boards: quem executa e' a regra nativa, que
    // reage a este valor
    const { env } = cenario();
    const r = await atribuirLead(env, 1, webhook());
    const attrs = corpoDe<{ custom_attributes: Record<string, string> }>(/custom_attributes/).custom_attributes;
    expect(attrs.funil).toBe('PROMOVER');
    expect(r.motivo).toMatch(/marcada para promover/);
  });

  test('clique sem plataforma de anuncio nao promove', async () => {
    // era o erro da regra "Lead do Google": promovia qualquer coisa com
    // protocolo, e o fluxo carimbava ORG-<id> no organico tambem
    const { env, exec } = cenario();
    exec(`UPDATE leads SET gclid = NULL, utm_source = NULL, utm_medium = NULL WHERE tenant_id = 1`);
    const r = await atribuirLead(env, 1, webhook());
    const attrs = corpoDe<{ custom_attributes: Record<string, string> }>(/custom_attributes/).custom_attributes;
    expect(attrs.funil).toBeUndefined();
    expect(r.motivo).toMatch(/fica no Organico/);
  });

  test('conversa ja no funil nao e remarcada', async () => {
    // remarcar faria a regra atuadora resetar o card para "Novo Lead",
    // desfazendo o avanco do vendedor
    const { env } = cenario();
    atributosAtuais = { funil: 'Lead' };
    const r = await atribuirLead(env, 1, webhook({}, { custom_attributes: { funil: 'Lead' } }));
    const attrs = corpoDe<{ custom_attributes: Record<string, string> }>(/custom_attributes/).custom_attributes;
    expect(attrs.funil).toBe('Lead');
    expect(r.motivo).toMatch(/ja estava no funil/);
  });

  test('resolve o nome da campanha pelo utm_id', async () => {
    // a UTM chegou como `{campaignname}`: o nome vem da API pelo ID
    const { env } = cenario();
    await atribuirLead(env, 1, webhook());
    const attrs = corpoDe<{ custom_attributes: Record<string, string> }>(/custom_attributes/).custom_attributes;
    expect(attrs.utm_campaign).toBe('Vita - Search - Aparelhos');
  });

  test('aplica as etiquetas de atribuicao sem apagar as que ja existem', async () => {
    const { env } = cenario();
    etiquetasAtuais = ['mensagem', 'Ligar mais tarde'];
    await atribuirLead(env, 1, webhook());
    const labels = corpoDe<{ labels: string[] }>(/\/labels$/).labels;
    expect(labels).toContain('google-ads');
    expect(labels).toContain('search');
    // trabalho do vendedor nao pode sumir
    expect(labels).toContain('Ligar mais tarde');
  });

  test('grava as UTMs no card do Kanban', async () => {
    const { env } = cenario();
    await atribuirLead(env, 1, webhook());
    const card = corpoDe<{ task: { custom_attributes: Record<string, string> } }>(/kanban\/tasks\/1421$/).task;
    expect(card.custom_attributes.utm_source).toBe('google');
    expect(card.custom_attributes.protocolo).toBe('VITA-MRIAP9IN8WNQ');
  });

  test('conversa que ja tem protocolo nao e reprocessada', async () => {
    // cada mensagem do lead dispara o webhook; reescrever sempre gastaria
    // chamada e desfaria correcao manual do vendedor
    const { env } = cenario();
    const r = await atribuirLead(env, 1, webhook({}, { custom_attributes: { protocolo: 'VITA-X' } }));
    expect(r.status).toBe('ignorado');
    expect(r.motivo).toMatch(/ja tem protocolo/);
    expect(chamadas.filter((c) => c.metodo !== 'GET')).toEqual([]);
  });

  test('sem protocolo na mensagem, casa pelo telefone', async () => {
    const { env } = cenario();
    const r = await atribuirLead(env, 1, webhook({ content: 'bom dia, quero informacoes' }));
    expect(r.status).toBe('ok');
    expect(r.motivo).toContain('VITA-MRIAP9IN8WNQ');
  });

  test('protocolo que nao esta na base nao inventa atribuicao', async () => {
    const { env } = cenario();
    const r = await atribuirLead(env, 1, webhook({ content: 'oi [Protocolo: VITA-NAOEXISTE]' }));
    expect(r.status).toBe('ignorado');
    expect(r.motivo).toMatch(/nao esta na base de cliques/);
    expect(chamadas.filter((c) => c.metodo !== 'GET')).toEqual([]);
  });

  test('telefone desconhecido e sem protocolo nao atribui nada', async () => {
    const { env } = cenario();
    const r = await atribuirLead(env, 1, webhook(
      { content: 'oi' },
      { meta: { sender: { name: 'X', phone_number: '+5511900000000' } } },
    ));
    expect(r.status).toBe('ignorado');
    expect(chamadas.filter((c) => c.metodo !== 'GET')).toEqual([]);
  });

  test('payload sem conversa nao quebra a fila', async () => {
    const { env } = cenario();
    expect((await atribuirLead(env, 1, '{}')).status).toBe('ignorado');
    expect((await atribuirLead(env, 1, 'nao e json')).status).toBe('ignorado');
  });

  test('registra a conversa no banco, ligada ao protocolo e ao card', async () => {
    const { env, consultar } = cenario();
    await atribuirLead(env, 1, webhook());
    const [linha] = consultar<{ protocol: string; task_id: number }>(
      'SELECT protocol, task_id FROM conversations WHERE cw_conversation_id = 76',
    );
    expect(linha!.protocol).toBe('VITA-MRIAP9IN8WNQ');
    expect(linha!.task_id).toBe(1421);
  });
});
