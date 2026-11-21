import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { fakeD1 } from '../helpers/fakeD1';
import { atribuirLead, MOTIVO_VOLTA_SEM_LEAD, type ModoRetorno } from '../../src/pipelines/leadMessage';
import type { Env } from '../../src/env';

function cenario() {
  const { d1, exec, consultar } = fakeD1();
  exec(`INSERT INTO tenants (id, slug, nome, ativo) VALUES (1, 'vita', 'Vita', 1)`);
  exec(`INSERT INTO tenant_config (tenant_id, cw_account_id, cw_board_funil_id, ga_customer_id, evo_instancia, ingest_key, janela_match_dias, gtm_prefixo)
        VALUES (1, 2, 7, '6973821129', NULL, 'k', 90, 'VITA')`);
  for (const [slug, zap] of [['mensagem', 'Mensagem'], ['google', 'Google'], ['search', 'Search'], ['formulario', null]] as const) {
    exec(`INSERT INTO label_vocabulary (tenant_id, slug, label_chatwoot, label_whatsapp)
          VALUES (1, '${slug}', '${slug}', ${zap ? `'${zap}'` : 'NULL'})`);
  }
  exec(`INSERT INTO funnel_stages (tenant_id, posicao, nome, cw_step_id, conversion_event, conversion_action_id, conversion_value)
        VALUES (1, 1, 'Novo Lead', 27, 'conversa', '7698886680', 10)`);
  exec(`INSERT INTO credenciais (chave, valor) VALUES ('datamanager_refresh_token', 'rt')`);
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

  test('a frase do anuncio salva o lead que chegou sem clique', async () => {
    // Nao houve protocolo na mensagem nem clique casado pelo telefone. O texto
    // do botao do anuncio e' a unica prova de origem — sem isto o lead era
    // descartado: pago, atendido, e invisivel para o Google.
    const { env, exec, consultar } = cenario();
    exec(`DELETE FROM leads WHERE tenant_id = 1`);
    exec(`INSERT INTO lead_entry_phrases (tenant_id, frase, origem, plataforma)
          VALUES (1, 'Olá! Vim pelo google e gostaria de agendar uma avaliação auditiva.', 'mensagem', 'google')`);

    const r = await atribuirLead(env, 1, webhook({
      content: 'Olá! Vim pelo google e gostaria de agendar uma avaliação auditiva.',
    }));
    expect(r.status).toBe('ok');

    const leads = consultar<{ protocol: string; gclid: string | null; origem: string }>(
      'SELECT * FROM leads WHERE tenant_id = 1',
    );
    expect(leads).toHaveLength(1);
    expect(leads[0]!.protocol).toContain('-MSG-');
    // sem clique registrado, entao sem gclid: a conversao sobe pelos dados do lead
    expect(leads[0]!.gclid).toBeNull();

    const attrs = corpoDe<{ custom_attributes: Record<string, string> }>(/custom_attributes/).custom_attributes;
    expect(attrs.funil).toBe('PROMOVER');
    expect(attrs.protocolo).toContain('-MSG-');
  });

  test('a frase resgata o clique que chegou sem gclid e sem utm', async () => {
    // Caso real da Vita (VITA-MTSMZ0YIEUB9): o clique foi registrado "sem
    // plataforma", o lead FOI encontrado pelo protocolo — entao a busca por
    // frase nem era consultada — e a plataforma saiu 'outro'. Card parou no
    // Organico, nenhuma conversao subiu. Lead de anuncio, pago, invisivel.
    const { env, exec, consultar } = cenario();
    exec(`UPDATE leads SET gclid = NULL, utm_source = NULL, utm_medium = NULL, utm_campaign = NULL
          WHERE tenant_id = 1`);
    exec(`INSERT INTO lead_entry_phrases (tenant_id, frase, origem, plataforma)
          VALUES (1, 'vim pelo google', 'mensagem', 'google')`);

    const r = await atribuirLead(env, 1, webhook({
      content: 'Olá, vim pelo google e gostaria de mais informações [Protocolo: VITA-MRIAP9IN8WNQ]',
    }));

    expect(r.status).toBe('ok');
    const attrs = corpoDe<{ custom_attributes: Record<string, string> }>(/custom_attributes/).custom_attributes;
    expect(attrs.funil).toBe('PROMOVER');
    expect(consultar('SELECT * FROM conversions')).toHaveLength(1);
  });

  test('a frase NAO sobrepoe a plataforma que o clique ja trouxe', async () => {
    // o dado do clique e' mais especifico: diz campanha, termo, tipo. A frase
    // so' preenche o que faltava.
    const { env, exec } = cenario();
    exec(`INSERT INTO label_vocabulary (tenant_id, slug, label_chatwoot) VALUES (1, 'facebook', 'facebook')`);
    exec(`UPDATE leads SET utm_source = 'facebook', fbc = 'fb.1.2.3', gclid = NULL WHERE tenant_id = 1`);
    exec(`INSERT INTO lead_entry_phrases (tenant_id, frase, origem, plataforma)
          VALUES (1, 'vim pelo google', 'mensagem', 'google')`);

    await atribuirLead(env, 1, webhook({ content: 'vim pelo google [Protocolo: VITA-MRIAP9IN8WNQ]' }));
    const corpo = corpoDe<{ labels: string[] }>(/labels/);
    expect(corpo.labels).toContain('facebook');
    expect(corpo.labels).not.toContain('google');
  });

  test('a frase aplica as etiquetas de mensagem e google', async () => {
    const { env, exec } = cenario();
    exec(`DELETE FROM leads WHERE tenant_id = 1`);
    exec(`INSERT INTO lead_entry_phrases (tenant_id, frase, origem, plataforma)
          VALUES (1, 'Olá! Vim pelo google e gostaria de agendar uma avaliação auditiva.', 'mensagem', 'google')`);

    await atribuirLead(env, 1, webhook({
      content: 'Olá! Vim pelo google e gostaria de agendar uma avaliação auditiva.',
    }));
    const corpo = corpoDe<{ labels: string[] }>(/labels/);
    expect(corpo.labels).toContain('mensagem');
    expect(corpo.labels).toContain('google');
  });

  test('a mesma conversa nao vira dois leads pela frase repetida', async () => {
    const { env, exec, consultar } = cenario();
    exec(`DELETE FROM leads WHERE tenant_id = 1`);
    exec(`INSERT INTO lead_entry_phrases (tenant_id, frase, origem, plataforma)
          VALUES (1, 'vim pelo google', 'mensagem', 'google')`);

    await atribuirLead(env, 1, webhook({ content: 'oi, vim pelo google' }));
    // a conversa ja' tem protocolo agora, entao a segunda passa direto — mas o
    // protocolo derivado da conversa garante a mesma linha mesmo se reprocessar
    await atribuirLead(env, 1, webhook({ content: 'vim pelo google de novo' }));
    expect(consultar('SELECT * FROM leads WHERE tenant_id = 1')).toHaveLength(1);
  });

  test('mensagem qualquer sem frase cadastrada segue sendo descartada', async () => {
    const { env, exec } = cenario();
    exec(`DELETE FROM leads WHERE tenant_id = 1`);
    const r = await atribuirLead(env, 1, webhook({ content: 'oi, quanto custa?' }));
    expect(r.status).toBe('ignorado');
    expect(r.motivo).toMatch(/sem frase de entrada/);
  });

  test('promover ja sobe a conversao de entrada, sem esperar webhook', async () => {
    // O Chatwoot nao dispara automacao a partir de automacao: o
    // `transfer_to_board` da regra nao emite `kanban_task_updated`, entao a
    // conversao de entrada nunca chegava por webhook.
    const { env, consultar } = cenario();
    await atribuirLead(env, 1, webhook());

    const cs = consultar<{ dedupe_key: string; status: string; conversion_value: number }>(
      'SELECT * FROM conversions',
    );
    expect(cs).toHaveLength(1);
    expect(cs[0]!.dedupe_key).toBe('VITA-MRIAP9IN8WNQ-conversa');
    expect(cs[0]!.conversion_value).toBe(10);
  });

  test('lead do Google Meu Negocio pelo site: entra no funil, com a etiqueta, sem conversao', async () => {
    const { env, exec, consultar } = cenario();
    exec(`INSERT INTO label_vocabulary (tenant_id, slug, label_chatwoot, label_whatsapp)
          VALUES (1, 'gmn', 'gmn', NULL)`);
    exec(`UPDATE leads SET gclid = NULL, utm_source = 'google', utm_medium = 'organic', utm_campaign = 'meu_negocio',
          utm_id = NULL WHERE tenant_id = 1`);
    etiquetasAtuais = [];

    const r = await atribuirLead(env, 1, webhook());
    expect(r.status).toBe('ok');
    expect(r.motivo).toMatch(/Google Meu Negocio/);
    const attrs = corpoDe<{ custom_attributes: Record<string, string> }>(/custom_attributes/).custom_attributes;
    expect(attrs.funil).toBe('PROMOVER');
    const corpo = corpoDe<{ labels: string[] }>(/labels/);
    expect(corpo.labels).toContain('gmn');
    expect(corpo.labels).not.toContain('google');
    expect(corpo.labels).not.toContain('mensagem');
    expect(consultar('SELECT * FROM conversions')).toHaveLength(0);
    expect(chamadas.some((c) => /googleads|datamanager/.test(c.url) && c.metodo !== 'GET' && !/searchStream|search$/.test(c.url))).toBe(false);
  });

  test('frase pronta do botao WhatsApp do perfil vira lead do Google Meu Negocio', async () => {
    const { env, exec, consultar } = cenario();
    exec(`DELETE FROM leads WHERE tenant_id = 1`);
    exec(`INSERT INTO label_vocabulary (tenant_id, slug, label_chatwoot, label_whatsapp)
          VALUES (1, 'gmn', 'gmn', NULL)`);
    exec(`INSERT INTO lead_entry_phrases (tenant_id, frase, origem, plataforma)
          VALUES (1, 'Olá, vim pelo anúncio do Google!', 'mensagem', 'google'),
                 (1, 'Olá, vim pelo Google Meu Negócio!', 'mensagem', 'gmn')`);

    const r = await atribuirLead(env, 1, webhook({ content: 'Olá, vim pelo Google Meu Negócio! Vocês abrem sábado?' }));
    expect(r.status).toBe('ok');
    const leads = consultar<{ protocol: string; utm_source: string }>('SELECT * FROM leads WHERE tenant_id = 1');
    expect(leads).toHaveLength(1);
    expect(leads[0]!.utm_source).toBe('gmn');
    const attrs = corpoDe<{ custom_attributes: Record<string, string> }>(/custom_attributes/).custom_attributes;
    expect(attrs.funil).toBe('PROMOVER');
    expect(corpoDe<{ labels: string[] }>(/labels/).labels).toEqual(expect.arrayContaining(['gmn']));
    expect(consultar('SELECT * FROM conversions')).toHaveLength(0);
  });

  test('lead que nao promove nao sobe conversao', async () => {
    const { env, exec, consultar } = cenario();
    exec(`UPDATE leads SET gclid = NULL, utm_source = 'organico' WHERE tenant_id = 1`);
    await atribuirLead(env, 1, webhook());
    expect(consultar('SELECT * FROM conversions')).toHaveLength(0);
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

  test('o nome da campanha fica guardado no lead, para a planilha', async () => {
    // antes o nome ia so' para o card e era jogado fora: a planilha e o banco
    // ficavam com o ID da campanha ("23920679510")
    const { env, consultar } = cenario();
    await atribuirLead(env, 1, webhook());
    expect(consultar<{ utm_campaign_nome: string }>(
      `SELECT utm_campaign_nome FROM leads WHERE protocol = 'VITA-MRIAP9IN8WNQ'`,
    )[0]!.utm_campaign_nome).toBe('Vita - Search - Aparelhos');
  });

  test('aplica as etiquetas de atribuicao sem apagar as que ja existem', async () => {
    const { env } = cenario();
    etiquetasAtuais = ['mensagem', 'Ligar mais tarde'];
    await atribuirLead(env, 1, webhook());
    const labels = corpoDe<{ labels: string[] }>(/\/labels$/).labels;
    expect(labels).toContain('google');
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

  test('esquema completo: lead do Google pelo site ganha pago, canal e pagina', async () => {
    const { env, exec } = cenario();
    for (const s of ['pago', 'msg-site', 'aparelho-auditivo']) {
      exec(`INSERT INTO label_vocabulary (tenant_id, slug, label_chatwoot) VALUES (1, '${s}', '${s}')`);
    }
    exec(`UPDATE leads SET page_url = 'https://audicao.vitaaudio.com.br/aparelho-auditivo/whatsapp' WHERE protocol = 'VITA-MRIAP9IN8WNQ'`);
    await atribuirLead(env, 1, webhook());
    const { labels } = corpoDe<{ labels: string[] }>(/\/labels$/);
    expect(labels).toEqual(expect.arrayContaining(['mensagem', 'google', 'pago', 'msg-site', 'aparelho-auditivo']));
  });

  test('contato sem lead ganha "direto" quando o cliente usa essa etiqueta', async () => {
    const { env, exec } = cenario();
    exec(`INSERT INTO label_vocabulary (tenant_id, slug, label_chatwoot) VALUES (1, 'direto', 'direto')`);
    etiquetasAtuais = [];
    const r = await atribuirLead(env, 1, webhook(
      { content: 'Bom dia, preciso remarcar' },
      { labels: [], meta: { sender: { name: 'Paciente', phone_number: '+5511900000000' } } },
    ));
    expect(r.status).toBe('ignorado');
    expect(corpoDe<{ labels: string[] }>(/\/labels$/).labels).toEqual(['direto']);
  });

  test('conversa que ja tem "direto" nao chama o Chatwoot de novo', async () => {
    const { env, exec } = cenario();
    exec(`INSERT INTO label_vocabulary (tenant_id, slug, label_chatwoot) VALUES (1, 'direto', 'direto')`);
    await atribuirLead(env, 1, webhook(
      { content: 'oi de novo' },
      { labels: ['direto'], meta: { sender: { name: 'Paciente', phone_number: '+5511900000000' } } },
    ));
    expect(chamadas.filter((c) => /labels/.test(c.url))).toEqual([]);
  });

  test('protocolo do botao sem clique registrado: site, sem msg-site (que e so do Google)', async () => {
    const { env, exec } = cenario();
    for (const s of ['site', 'msg-site', 'direto']) {
      exec(`INSERT INTO label_vocabulary (tenant_id, slug, label_chatwoot) VALUES (1, '${s}', '${s}')`);
    }
    etiquetasAtuais = [];
    await atribuirLead(env, 1, webhook({ content: 'Olá [Protocolo: VITA-NAOEXISTE]' }, { labels: [] }));
    expect(corpoDe<{ labels: string[] }>(/\/labels$/).labels).toEqual(['site']);
  });

  test('mensagem pronta da extensao do Google, sem protocolo: lead do Google com msg-nat', async () => {
    const { env, exec, consultar } = cenario();
    exec(`INSERT INTO label_vocabulary (tenant_id, slug, label_chatwoot) VALUES (1, 'msg-nat', 'msg-nat'), (1, 'msg-site', 'msg-site')`);
    exec(`INSERT INTO lead_entry_phrases (tenant_id, frase, origem, plataforma) VALUES (1, 'Olá, vim pelo anúncio do Google!', 'mensagem', 'google')`);
    etiquetasAtuais = [];
    const r = await atribuirLead(env, 1, webhook(
      { content: 'Ola, vim pelo anuncio do Google! Quanto custa?' },
      { labels: [], meta: { sender: { name: 'Bia', phone_number: '+5511988887777' } } },
    ));

    expect(r.status).toBe('ok');
    const { labels } = corpoDe<{ labels: string[] }>(/\/labels$/);
    expect(labels).toEqual(expect.arrayContaining(['msg-nat', 'google']));
    expect(labels).not.toContain('mensagem');
    expect(labels).not.toContain('msg-site');
    const [lead] = consultar(`SELECT protocol, evento FROM leads WHERE tenant_id = 1 AND evento = 'frase_entrada'`) as Array<{ protocol: string; evento: string }>;
    expect(lead!.protocol).toBe('VITA-MSG-76');
  });

  test('lead do Google pelo site ganha msg-site no lugar de mensagem', async () => {
    const { env, exec } = cenario();
    exec(`INSERT INTO label_vocabulary (tenant_id, slug, label_chatwoot) VALUES (1, 'msg-nat', 'msg-nat'), (1, 'msg-site', 'msg-site')`);
    etiquetasAtuais = [];
    await atribuirLead(env, 1, webhook({}, { labels: [] }));
    const { labels } = corpoDe<{ labels: string[] }>(/\/labels$/);
    expect(labels).toEqual(expect.arrayContaining(['msg-site', 'google']));
    expect(labels).not.toContain('mensagem');
  });

  test('mensagem da propria empresa nao ganha etiqueta de lead', async () => {
    const { env, exec } = cenario();
    exec(`INSERT INTO label_vocabulary (tenant_id, slug, label_chatwoot) VALUES (1, 'direto', 'direto')`);
    await atribuirLead(env, 1, webhook(
      { content: 'Bom dia', message_type: 'outgoing' },
      { labels: [], meta: { sender: { name: 'Paciente', phone_number: '+5511900000000' } } },
    ));
    expect(chamadas.filter((c) => /labels/.test(c.url))).toEqual([]);
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

  describe('mensagem que chega muito depois do clique', () => {
    const avisos = (consultar: ReturnType<typeof cenario>['consultar']) =>
      consultar<{ chave: string; status: string; erro: string }>(
        'SELECT chave, status, erro FROM group_notifications WHERE tenant_id = 1',
      );

    test('protocolo no texto com clique de 2 dias: nao trava o aviso do grupo', async () => {
      // Martinelli 07 e 08/11/2026: 11 leads reais com a entrega atrasada nunca
      // chegaram ao grupo porque esta trava os marcava como 'ignorado'. O aviso
      // do card sai com a hora do clique (data_evento), entao nao passa por novo.
      const { env, consultar } = cenario();
      const r = await atribuirLead(env, 1, webhook());

      expect(r.status).toBe('ok');
      expect(avisos(consultar)).toEqual([]);
    });

    test('protocolo no texto com clique recente: nada muda', async () => {
      const { env, consultar, exec } = cenario();
      exec(`UPDATE leads SET created_at = datetime('now', '-5 minutes') WHERE protocol = 'VITA-MRIAP9IN8WNQ'`);
      await atribuirLead(env, 1, webhook());
      expect(avisos(consultar)).toEqual([]);
    });

    test('casado pelo telefone: clique antigo nao prova atraso', async () => {
      const { env, consultar } = cenario();
      await atribuirLead(env, 1, webhook({ content: 'bom dia, quero informacoes' }));
      expect(avisos(consultar)).toEqual([]);
    });

    test('aviso ja enviado nao e reescrito', async () => {
      const { env, consultar, exec } = cenario();
      exec(`INSERT INTO group_notifications (tenant_id, chave, protocolo, status) VALUES (1, 'VITA-MRIAP9IN8WNQ', 'VITA-MRIAP9IN8WNQ', 'enviado')`);
      await atribuirLead(env, 1, webhook());
      expect(avisos(consultar)[0]!.status).toBe('enviado');
    });
  });

  describe('modo de volta: o lead que volta abre um ciclo novo', () => {
    const FONE = '+5511999990000';
    const ANTIGO = 'VITA-MVOLTA0001';

    interface LinhaDoCiclo {
      protocol: string; nome: string | null; origem: string; evento: string; gclid: string | null;
      utm_campaign_nome: string | null; page_url: string | null; phone_key: string | null;
      quiz_version: string | null; quiz_valor: number | null; quiz_form_id: string | null;
      valor_proposta: number | null; retorno_de: string | null; clique_em: string | null; created_at: string;
    }

    /**
     * Ciclo anterior: lead do Google que chegou pelo formulario, ja' com valor
     * fechado no card. A conversa ainda carrega o protocolo dele.
     */
    function volta(o: { diasDoClique?: number; retorno?: Partial<ModoRetorno> } = {}) {
      const ctx = cenario();
      // "Vita" esta' dentro de "Vital": o nome do lead passaria por perfil da
      // propria empresa e viraria "Sem nome"
      ctx.exec(`UPDATE tenants SET nome = 'Clinica Teste' WHERE id = 1`);
      ctx.exec(`INSERT INTO leads (tenant_id, protocol, nome, phone_raw, phone_e164, phone_key, gclid, utm_source, utm_medium,
                  utm_campaign, utm_campaign_nome, utm_id, utm_term, page_url, origem, evento, quiz_version, quiz_valor,
                  quiz_form_id, valor_proposta, created_at)
                VALUES (1, '${ANTIGO}', 'Vital', '${FONE}', '${FONE}', '1199990000', 'Cj0volta', 'google', 'cpc',
                  'Vita - Search - Aparelhos', 'Vita - Search - Aparelhos', '23920679510', 'aparelho auditivo',
                  'https://audicao.exemplo/whatsapp', 'formulario', 'form_submit', 'q2', 30, 'form-1', 4500,
                  datetime('now', '-${o.diasDoClique ?? 40} day'))`);
      atributosAtuais = { protocolo: ANTIGO };
      const criarCard = vi.fn(async (_lead: Parameters<ModoRetorno['criarCard']>[0]) => 1500);
      const retorno: ModoRetorno = { n: 1, usados: [ANTIGO], anterior: ANTIGO, criarCard, ...o.retorno };
      return { ...ctx, retorno, criarCard };
    }

    function mensagem(content: string, conv: Record<string, unknown> = {}) {
      return webhook({ content }, {
        custom_attributes: { protocolo: ANTIGO },
        meta: { sender: { name: 'Vital', phone_number: FONE } },
        ...conv,
      });
    }

    const lead = (consultar: ReturnType<typeof cenario>['consultar'], protocolo: string) =>
      consultar<LinhaDoCiclo>(`SELECT * FROM leads WHERE tenant_id = 1 AND protocol = '${protocolo}'`)[0];
    const escritasNoChatwoot = () => chamadas.filter((c) => c.metodo !== 'GET' && /cw\.teste/.test(c.url));

    test('sem anuncio novo: o lead do ciclo e a copia do anterior, com protocolo -R1', async () => {
      const { env, consultar, retorno, criarCard } = volta();
      const original = lead(consultar, ANTIGO)!;
      // o card nasce antes de a conversa ser gravada: a conversa nao pode
      // apontar para o protocolo novo com o card antigo
      let escritasAntesDoCard = -1;
      criarCard.mockImplementation(async () => { escritasAntesDoCard = escritasNoChatwoot().length; return 1500; });

      const r = await atribuirLead(env, 1, mensagem('Oi, quero fazer outro orcamento'), { retorno });

      expect(r.status).toBe('ok');
      const ciclo = lead(consultar, `${ANTIGO}-R1`)!;
      expect(ciclo).toBeDefined();
      expect(ciclo.evento).toBe('retorno');
      expect(ciclo.origem).toBe('mensagem');
      expect(ciclo.retorno_de).toBe(ANTIGO);
      expect(ciclo.clique_em).toBe(original.created_at);
      expect(ciclo.nome).toBe('Vital #1');
      // identidade e atribuicao herdadas: a conversao volta para a mesma campanha
      expect(ciclo.gclid).toBe('Cj0volta');
      expect(ciclo.utm_campaign_nome).toBe('Vita - Search - Aparelhos');
      expect(ciclo.page_url).toBe('https://audicao.exemplo/whatsapp');
      expect(ciclo.phone_key).toBe('1199990000');
      // o que era do ciclo antigo fica nele
      expect(ciclo.quiz_version).toBeNull();
      expect(ciclo.quiz_valor).toBeNull();
      expect(ciclo.quiz_form_id).toBeNull();
      expect(ciclo.valor_proposta).toBeNull();
      expect(ciclo.created_at).not.toBe(original.created_at);
      // o anterior nao muda
      expect(lead(consultar, ANTIGO)!.nome).toBe('Vital');

      expect(criarCard).toHaveBeenCalledTimes(1);
      expect(criarCard).toHaveBeenCalledWith({
        protocolo: `${ANTIGO}-R1`,
        plataforma: 'google',
        atributos: expect.objectContaining({ protocolo: `${ANTIGO}-R1`, gclid: 'Cj0volta', utm_source: 'google' }),
      });
      expect(escritasAntesDoCard).toBe(0);

      const attrs = corpoDe<{ custom_attributes: Record<string, string> }>(/custom_attributes/).custom_attributes;
      expect(attrs.protocolo).toBe(`${ANTIGO}-R1`);
      // o PROMOVER faria a regra do Chatwoot transferir o card ANTIGO
      expect(attrs.funil).toBe('Lead');
      expect(JSON.stringify(chamadas.map((c) => c.corpo))).not.toContain('PROMOVER');
      // o card antigo nao e' tocado: o novo ja' nasce com os atributos
      expect(chamadas.filter((c) => /kanban\/tasks/.test(c.url))).toEqual([]);

      const [conversa] = consultar<{ protocol: string; task_id: number }>(
        'SELECT protocol, task_id FROM conversations WHERE cw_conversation_id = 76',
      );
      expect(conversa).toEqual({ protocol: `${ANTIGO}-R1`, task_id: 1500 });
      expect(r.motivo).toContain(`${ANTIGO}-R1`);
    });

    test('a mensagem antiga repetida, com o protocolo do ciclo anterior, tambem e copia', async () => {
      const { env, consultar, retorno, criarCard } = volta();
      await atribuirLead(env, 1, mensagem(`Ola [Protocolo: ${ANTIGO}]`), { retorno });
      expect(lead(consultar, `${ANTIGO}-R1`)?.evento).toBe('retorno');
      expect(criarCard.mock.calls[0]![0].protocolo).toBe(`${ANTIGO}-R1`);
    });

    test('segunda volta copia da raiz: -R2, sem encadear, com a data do clique original', async () => {
      const { env, consultar, exec, criarCard } = volta();
      exec(`INSERT INTO leads (tenant_id, protocol, nome, phone_key, gclid, utm_source, origem, evento, retorno_de, clique_em, created_at)
            VALUES (1, '${ANTIGO}-R1', 'Vital #1', '1199990000', 'Cj0volta', 'google', 'mensagem', 'retorno',
                    '${ANTIGO}', '2026-09-01 10:00:00', datetime('now', '-20 day'))`);
      const retorno: ModoRetorno = { n: 2, usados: [ANTIGO, `${ANTIGO}-R1`], anterior: `${ANTIGO}-R1`, criarCard };

      await atribuirLead(env, 1, mensagem('Oi de novo'), { retorno });

      const ciclo = lead(consultar, `${ANTIGO}-R2`)!;
      expect(ciclo.retorno_de).toBe(ANTIGO);
      expect(ciclo.clique_em).toBe('2026-09-01 10:00:00');
      expect(ciclo.nome).toBe('Vital #2');
      expect(lead(consultar, `${ANTIGO}-R1-R1`)).toBeUndefined();
    });

    test('protocolo novo na mensagem, de um clique que existe: anuncio novo, sem copia', async () => {
      const { env, consultar, exec, retorno, criarCard } = volta();
      exec(`INSERT INTO leads (tenant_id, protocol, phone_key, gclid, utm_source, utm_medium, utm_campaign, origem, evento, created_at)
            VALUES (1, 'VITA-MNOVO00002', NULL, 'Cj0novo', 'google', 'cpc', 'Vita - Search - Novo', 'clique', 'whatsapp_click',
                    datetime('now', '-5 minutes'))`);

      const r = await atribuirLead(env, 1, mensagem('Oi! [Protocolo: VITA-MNOVO00002]'), { retorno });

      expect(r.status).toBe('ok');
      expect(lead(consultar, `${ANTIGO}-R1`)).toBeUndefined();
      const novo = lead(consultar, 'VITA-MNOVO00002')!;
      expect(novo.nome).toBe('Vital #1');
      // so' a copia leva a ligacao com o ciclo anterior
      expect(novo.retorno_de).toBeNull();
      expect(novo.clique_em).toBeNull();
      expect(criarCard).toHaveBeenCalledWith(expect.objectContaining({ protocolo: 'VITA-MNOVO00002', plataforma: 'google' }));
      const attrs = corpoDe<{ custom_attributes: Record<string, string> }>(/custom_attributes/).custom_attributes;
      expect(attrs.protocolo).toBe('VITA-MNOVO00002');
      expect(attrs.gclid).toBe('Cj0novo');
    });

    test('frase de entrada: o protocolo da conversa ganha o ciclo', async () => {
      // clique anterior fora da janela do telefone (90 dias): a frase e' a fonte
      const { env, consultar, exec, retorno, criarCard } = volta({ diasDoClique: 120 });
      exec(`INSERT INTO lead_entry_phrases (tenant_id, frase, origem, plataforma)
            VALUES (1, 'Olá, vim pelo anúncio do Google!', 'mensagem', 'google')`);

      await atribuirLead(env, 1, mensagem('Olá, vim pelo anúncio do Google! Quero mais um'), { retorno });

      const ciclo = lead(consultar, 'VITA-MSG-76-R1')!;
      expect(ciclo.evento).toBe('frase_entrada');
      expect(ciclo.nome).toBe('Vital #1');
      expect(lead(consultar, 'VITA-MSG-76')).toBeUndefined();
      expect(criarCard).toHaveBeenCalledWith(expect.objectContaining({ protocolo: 'VITA-MSG-76-R1' }));
    });

    test('sem lead anterior e sem fonte nova: volta sem lead, sem card', async () => {
      const { env } = cenario();
      const criarCard = vi.fn(async () => 1500);

      const semAnterior = await atribuirLead(env, 1, mensagem('Oi, tudo bem?'), {
        retorno: { n: 1, usados: [], anterior: null, criarCard },
      });
      // protocolo anterior que nao tem linha em `leads`: nada para copiar
      const semLinha = await atribuirLead(env, 1, mensagem('Oi, tudo bem?'), {
        retorno: { n: 1, usados: ['VITA-MSUMIU00001'], anterior: 'VITA-MSUMIU00001', criarCard },
      });

      for (const r of [semAnterior, semLinha]) {
        expect(r.status).toBe('ignorado');
        expect(r.motivo).toBe(MOTIVO_VOLTA_SEM_LEAD);
      }
      expect(criarCard).not.toHaveBeenCalled();
      expect(escritasNoChatwoot()).toEqual([]);
    });

    test('a volta fica como dado na linha do ciclo (`leads.volta`), na copia e no anuncio novo', async () => {
      // e' por ela, e nao pelo " #n" do nome, que a Geral acha a linha da volta
      const copia = volta();
      await atribuirLead(copia.env, 1, mensagem('Oi, quero fazer outro orcamento'), { retorno: copia.retorno });
      expect(copia.consultar<{ protocol: string; volta: number | null }>(
        `SELECT protocol, volta FROM leads WHERE protocol LIKE '${ANTIGO}%' ORDER BY protocol`,
      ))
        .toEqual([{ protocol: ANTIGO, volta: null }, { protocol: `${ANTIGO}-R1`, volta: 1 }]);

      const anuncio = volta({ retorno: { n: 2 } });
      anuncio.exec(`INSERT INTO leads (tenant_id, protocol, gclid, utm_source, utm_medium, origem, evento, created_at)
                    VALUES (1, 'VITA-MNOVO00002', 'Cj0novo', 'google', 'cpc', 'clique', 'whatsapp_click', datetime('now', '-5 minutes'))`);
      await atribuirLead(anuncio.env, 1, mensagem('Oi! [Protocolo: VITA-MNOVO00002]'), { retorno: anuncio.retorno });
      expect(anuncio.consultar<{ volta: number | null }>(`SELECT volta FROM leads WHERE protocol = 'VITA-MNOVO00002'`))
        .toEqual([{ volta: 2 }]);
    });

    test('sem nome aproveitavel: "Sem nome #1", para a Geral ainda achar a linha da volta', async () => {
      const { env, consultar, exec, retorno } = volta();
      exec(`UPDATE leads SET nome = NULL WHERE protocol = '${ANTIGO}'`);
      await atribuirLead(env, 1, mensagem('Oi', { meta: { sender: { name: '😊', phone_number: FONE } } }), { retorno });
      expect(lead(consultar, `${ANTIGO}-R1`)!.nome).toBe('Sem nome #1');
    });

    test('planilha e conversao de entrada sobem mesmo com a conversa ja no funil', async () => {
      // fora da volta, conversa com `funil = Lead` nao sobe nada: o lead ja'
      // tinha entrado. Na volta o ciclo e' lead novo em tudo.
      // Clique de 20 dias: dentro da janela de 30 dias da meta de entrada (a
      // copia leva o clique original, e o Google recusa o de fora da janela).
      const { env, consultar, exec, retorno } = volta({ diasDoClique: 20 });
      exec(`UPDATE tenant_config SET sheets_ativo = 1, planilha_modo = 'n8n', planilha_webhook_url = 'https://planilha.teste/n8n'
            WHERE tenant_id = 1`);
      atributosAtuais = { protocolo: ANTIGO, funil: 'Lead' };

      await atribuirLead(env, 1, mensagem('Voltei', { custom_attributes: { protocolo: ANTIGO, funil: 'Lead' } }), { retorno });

      // a entrada vai antes da conversao, e nao depende dela subir
      const planilha = chamadas.filter((c) => c.url === 'https://planilha.teste/n8n').map((c) => c.corpo as { tipo: string });
      expect(planilha[0]?.tipo).toBe('entrada');
      expect(JSON.stringify(planilha[0])).toContain(`${ANTIGO}-R1`);
      expect(JSON.stringify(planilha[0])).toContain('Vital #1');
      const cs = consultar<{ dedupe_key: string }>('SELECT dedupe_key FROM conversions');
      expect(cs.map((c) => c.dedupe_key)).toEqual([`${ANTIGO}-R1-conversa`]);
      // ja' estava no funil: o `Lead` fica, e o PROMOVER nao aparece
      const attrs = corpoDe<{ custom_attributes: Record<string, string> }>(/custom_attributes/).custom_attributes;
      expect(attrs.funil).toBe('Lead');
      expect(JSON.stringify(chamadas.map((c) => c.corpo))).not.toContain('PROMOVER');
    });

    test('falha ao criar o card sobe para a fila, sem gravar a conversa', async () => {
      const { env, retorno, criarCard } = volta();
      criarCard.mockRejectedValue(new Error('kanban recusou'));
      await expect(atribuirLead(env, 1, mensagem('Oi'), { retorno })).rejects.toThrow('kanban recusou');
      expect(escritasNoChatwoot()).toEqual([]);
    });

    test('frase de entrada com o clique antigo na janela do telefone: vale a copia', async () => {
      // a mesma ordem do fluxo normal (telefone antes da frase): a copia guarda
      // o gclid, e lead so' da frase nao tem identificador de clique
      const { env, consultar, exec, retorno, criarCard } = volta();
      exec(`INSERT INTO lead_entry_phrases (tenant_id, frase, origem, plataforma)
            VALUES (1, 'Olá, vim pelo anúncio do Google!', 'mensagem', 'google')`);

      await atribuirLead(env, 1, mensagem('Olá, vim pelo anúncio do Google! Quero mais um'), { retorno });

      const ciclo = lead(consultar, `${ANTIGO}-R1`)!;
      expect(ciclo.evento).toBe('retorno');
      expect(ciclo.gclid).toBe('Cj0volta');
      expect(lead(consultar, 'VITA-MSG-76-R1')).toBeUndefined();
      expect(criarCard.mock.calls[0]![0].protocolo).toBe(`${ANTIGO}-R1`);
    });

    describe('planilha de entrada', () => {
      const PLANILHA = 'https://planilha.teste/n8n';
      const entradas = () =>
        chamadas.filter((c) => c.url === PLANILHA).map((c) => c.corpo as { tipo: string }).filter((r) => r.tipo === 'entrada');

      /** Ciclo anterior sem anuncio: clique do site sem gclid nem UTM. */
      function voltaSemAnuncio(abaDireto: string | null) {
        const ctx = volta();
        ctx.exec(`UPDATE leads SET gclid = NULL, utm_source = NULL, utm_medium = NULL, utm_campaign = NULL,
                  utm_campaign_nome = NULL, utm_id = NULL, utm_term = NULL WHERE protocol = '${ANTIGO}'`);
        ctx.exec(`UPDATE tenant_config SET sheets_ativo = 1, planilha_modo = 'n8n', planilha_webhook_url = '${PLANILHA}',
                  sheets_aba_direto = ${abaDireto ? `'${abaDireto}'` : 'NULL'} WHERE tenant_id = 1`);
        return ctx;
      }

      test('volta de lead sem anuncio, cliente sem aba de lead direto: nao entra', async () => {
        // a regra de hoje para esse tipo de lead: sem conversao, sem aba direta, fora da Geral
        const { env, retorno, criarCard } = voltaSemAnuncio(null);
        const r = await atribuirLead(env, 1, mensagem('Voltei'), { retorno });
        expect(r.status).toBe('ok');
        expect(criarCard).toHaveBeenCalledTimes(1);
        expect(entradas()).toEqual([]);
      });

      test('volta de lead sem anuncio, cliente com aba de lead direto: entra', async () => {
        const { env, retorno } = voltaSemAnuncio('Direto');
        await atribuirLead(env, 1, mensagem('Voltei'), { retorno });
        expect(entradas()).toHaveLength(1);
        expect(JSON.stringify(entradas()[0])).toContain(`${ANTIGO}-R1`);
      });

      test('volta de lead de anuncio: entra, mesmo sem aba de lead direto', async () => {
        const { env, exec, retorno } = volta();
        exec(`UPDATE tenant_config SET sheets_ativo = 1, planilha_modo = 'n8n', planilha_webhook_url = '${PLANILHA}'
              WHERE tenant_id = 1`);
        await atribuirLead(env, 1, mensagem('Voltei'), { retorno });
        expect(entradas()).toHaveLength(1);
      });
    });

    test('a atribuicao do ciclo antigo que o novo nao tem sai da conversa', async () => {
      // um ciclo novo do anuncio da Meta nao pode mostrar o gclid do Google antigo
      const { env, exec, retorno } = volta();
      exec(`INSERT INTO leads (tenant_id, protocol, utm_source, utm_medium, fbc, origem, evento, created_at)
            VALUES (1, 'VITA-MNOVO00003', 'facebook', 'paid', 'fb.1.2.3', 'clique', 'whatsapp_click', datetime('now', '-5 minutes'))`);
      atributosAtuais = {
        protocolo: ANTIGO, gclid: 'Cj0volta', utm_source: 'google', utm_medium: 'cpc', utm_term: 'aparelho auditivo',
        funil: 'Lead', conversa_enviada: 'true',
      };

      await atribuirLead(env, 1, mensagem('Oi [Protocolo: VITA-MNOVO00003]', {
        custom_attributes: { protocolo: ANTIGO, funil: 'Lead' },
      }), { retorno });

      const attrs = corpoDe<{ custom_attributes: Record<string, string> }>(/custom_attributes/).custom_attributes;
      expect(attrs).toEqual({
        protocolo: 'VITA-MNOVO00003', utm_source: 'facebook', utm_medium: 'paid',
        funil: 'Lead', conversa_enviada: 'true',
      });
    });

    test('copia nao recebe etiqueta de origem; a conversa ja tem as do primeiro ciclo', async () => {
      // recalcular pela `evento = 'retorno'` acrescentaria um `msg-site` errado
      const { env, exec, retorno } = volta();
      exec(`UPDATE tenant_config SET evo_instancia = 'vita' WHERE tenant_id = 1`);
      etiquetasAtuais = [];

      const r = await atribuirLead(env, 1, mensagem('Voltei'), { retorno });

      expect(r.status).toBe('ok');
      expect(chamadas.filter((c) => /labels/.test(c.url))).toEqual([]);
      expect(chamadas.filter((c) => /evo\.teste/.test(c.url))).toEqual([]);
    });

    test('anuncio novo recebe as etiquetas como hoje', async () => {
      const { env, exec, retorno } = volta();
      exec(`INSERT INTO leads (tenant_id, protocol, gclid, utm_source, utm_medium, utm_campaign, origem, evento, created_at)
            VALUES (1, 'VITA-MNOVO00002', 'Cj0novo', 'google', 'cpc', 'Vita - Search - Novo', 'clique', 'whatsapp_click',
                    datetime('now', '-5 minutes'))`);
      etiquetasAtuais = [];

      await atribuirLead(env, 1, mensagem('Oi! [Protocolo: VITA-MNOVO00002]'), { retorno });

      expect(corpoDe<{ labels: string[] }>(/\/labels$/).labels).toEqual(expect.arrayContaining(['google']));
    });

    describe('o que o telefone acha na volta', () => {
      /** Ciclo anterior de clique (sem formulario): no casamento pelo telefone ganha o mais novo. */
      function voltaDeClique() {
        const ctx = volta();
        ctx.exec(`UPDATE leads SET origem = 'clique', evento = 'whatsapp_click', quiz_version = NULL, quiz_valor = NULL,
                  quiz_form_id = NULL WHERE protocol = '${ANTIGO}'`);
        return ctx;
      }

      test('retentativa da fila: a copia continua copia, sem etiqueta e sem segunda linha', async () => {
        // na segunda execucao o telefone acha a propria copia (a mais nova), que
        // ainda nao esta' em `usados`: nem por isso ela vira anuncio novo
        const { env, consultar, exec, retorno } = voltaDeClique();
        exec(`UPDATE tenant_config SET evo_instancia = 'vita' WHERE tenant_id = 1`);
        etiquetasAtuais = [];

        const primeira = await atribuirLead(env, 1, mensagem('Voltei'), { retorno });
        const segunda = await atribuirLead(env, 1, mensagem('Voltei'), { retorno });

        expect([primeira.status, segunda.status]).toEqual(['ok', 'ok']);
        expect(consultar(`SELECT protocol FROM leads WHERE tenant_id = 1 AND protocol LIKE '%-R%'`))
          .toEqual([{ protocol: `${ANTIGO}-R1` }]);
        expect(chamadas.filter((c) => /labels/.test(c.url))).toEqual([]);
        expect(chamadas.filter((c) => /evo\.teste/.test(c.url))).toEqual([]);
      });

      test('formulario mais velho que o ciclo anterior, nunca usado: nao e anuncio novo, vale a copia', async () => {
        // no casamento pelo telefone o formulario ganha do clique; mas o que e'
        // anterior ao ultimo ciclo nao pode ter trazido o lead agora
        const { env, consultar, exec, retorno, criarCard } = voltaDeClique();
        exec(`INSERT INTO leads (tenant_id, protocol, nome, phone_key, utm_source, origem, evento, created_at)
              VALUES (1, 'VITA-MFORM00001', 'Vital', '1199990000', 'google', 'formulario', 'form_submit',
                      datetime('now', '-60 day'))`);

        await atribuirLead(env, 1, mensagem('Oi, quero outro orcamento'), { retorno });

        const ciclo = lead(consultar, `${ANTIGO}-R1`);
        expect(ciclo?.retorno_de).toBe(ANTIGO);
        expect(criarCard.mock.calls[0]![0].protocolo).toBe(`${ANTIGO}-R1`);
        expect(lead(consultar, 'VITA-MFORM00001')!.nome).toBe('Vital');
      });

      test('clique mais novo que o ciclo anterior, nunca usado: e o anuncio novo', async () => {
        const { env, consultar, exec, retorno, criarCard } = voltaDeClique();
        exec(`INSERT INTO leads (tenant_id, protocol, phone_key, gclid, utm_source, utm_medium, utm_campaign, origem, evento, created_at)
              VALUES (1, 'VITA-MNOVO00004', '1199990000', 'Cj0novo', 'google', 'cpc', 'Vita - Search - Novo', 'clique',
                      'whatsapp_click', datetime('now', '-2 day'))`);

        await atribuirLead(env, 1, mensagem('Oi, quero outro orcamento'), { retorno });

        expect(lead(consultar, `${ANTIGO}-R1`)).toBeUndefined();
        expect(criarCard.mock.calls[0]![0].protocolo).toBe('VITA-MNOVO00004');
        expect(lead(consultar, 'VITA-MNOVO00004')!.retorno_de).toBeNull();
      });
    });
  });
});
