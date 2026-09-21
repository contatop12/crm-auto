import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { fakeD1 } from '../helpers/fakeD1';
import { atribuirLead } from '../../src/pipelines/leadMessage';
import type { Env } from '../../src/env';

/**
 * Vita, setembro de 2026: os leads casados pelo protocolo ficavam sem nome e
 * sem telefone em `leads`, o aviso do card saia "Direto" porque a conversa so'
 * ganhava protocolo no fim da atribuicao, e quem chamava direto no WhatsApp
 * nao chegava a planilha nenhuma.
 */

const GERAL_CAB = ['URL WHATSAPP', 'Canal', 'SEQUENCIA', 'DATA', 'HORA', 'NOME', 'TELEFONE', 'Pagina', 'Status'];

function cenario(opcoes: { planilha?: boolean } = {}) {
  const { d1, exec, consultar } = fakeD1();
  exec(`INSERT INTO tenants (id, slug, nome, ativo) VALUES (1, 'vita', 'Vita Audio', 1)`);
  exec(`INSERT INTO tenant_config (tenant_id, cw_account_id, cw_board_funil_id, ga_customer_id, ingest_key,
          janela_match_dias, gtm_prefixo, numeros_proprios, validate_only)
        VALUES (1, 2, 7, '6973821129', 'k', 90, 'VITA', '["5519991460270","5519990177608"]', 1)`);
  exec(`INSERT INTO funnel_stages (tenant_id, posicao, nome, cw_step_id, conversion_event, conversion_action_id, conversion_value)
        VALUES (1, 1, 'Novo Lead', 27, 'conversa', '7698886680', 10)`);
  exec(`INSERT INTO credenciais (chave, valor) VALUES ('datamanager_refresh_token', 'rt')`);
  exec(`INSERT INTO credenciais (chave, valor) VALUES ('gtm_refresh_token', 'rt')`);
  // clique do Google sem nome nem telefone: e' assim que ele nasce
  exec(`INSERT INTO leads (tenant_id, protocol, gclid, utm_source, page_url, origem, evento, created_at)
        VALUES (1, 'VITA-MTM2TV1950J2', 'Cj0abc', 'google', 'https://audicao.vitaaudio.com.br/aparelho-auditivo',
                'clique', 'whatsapp_click', datetime('now','-1 hour'))`);
  if (opcoes.planilha) {
    exec(`UPDATE tenant_config SET sheets_ativo = 1, planilha_modo = 'sistema',
            sheets_leads_doc_id = 'DOC-LEADS', sheets_aba_geral = 'Geral', sheets_aba_direto = 'WhatsApp Direto'
          WHERE tenant_id = 1`);
  }
  const env = {
    DB: d1,
    CACHE: { get: async () => null, put: async () => undefined },
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
  return { env, exec, consultar };
}

const AGORA = Date.parse('2026-09-21T20:04:38.497Z');

function mensagem(o: {
  conversa?: number; texto?: string; nome?: string; fone?: string;
  contatoDesde?: string; primeiraResposta?: string | null; em?: string;
} = {}) {
  return JSON.stringify({
    event: 'message_created',
    message_type: 'incoming',
    content: o.texto ?? 'Oieee',
    created_at: o.em ?? '2026-09-21T20:04:38.497Z',
    conversation: {
      id: o.conversa ?? 96,
      custom_attributes: {},
      labels: [],
      contact_inbox: { created_at: o.contatoDesde ?? '2026-09-21T20:04:38.410Z' },
      first_reply_created_at: o.primeiraResposta ?? null,
      meta: { sender: { name: o.nome ?? 'Benicio Groblackner', phone_number: o.fone ?? '+5511984738894' } },
    },
  });
}

/** Planilha de mentira: cada aba e' uma lista de linhas. */
let abas: Record<string, string[][]>;
let chamadas: Array<{ metodo: string; url: string; corpo: unknown }>;
let momentoDoAtributo: Array<Record<string, unknown>> | null;
let consultarNoAtributo: (() => Array<Record<string, unknown>>) | null;

beforeEach(() => {
  abas = { Geral: [GERAL_CAB], 'WhatsApp Direto': [GERAL_CAB] };
  chamadas = [];
  momentoDoAtributo = null;
  consultarNoAtributo = null;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const u = decodeURIComponent(String(url));
    const metodo = init.method ?? 'GET';
    let corpo: unknown = null;
    try { corpo = init.body ? JSON.parse(String(init.body)) : null; } catch { corpo = String(init.body); }
    chamadas.push({ metodo, url: u, corpo });

    if (/oauth2\.googleapis\.com/.test(u)) return Response.json({ access_token: 'tok' });
    const planilha = u.match(/sheets\.googleapis\.com\/v4\/spreadsheets\/[^/]+\/values\/'([^']+)'!/);
    if (planilha) {
      const aba = planilha[1]!;
      if (!abas[aba]) return Response.json({ error: { message: 'aba nao existe' } }, { status: 400 });
      if (metodo === 'POST') {
        abas[aba]!.push(...((corpo as { values: string[][] }).values));
        return Response.json({});
      }
      return Response.json({ values: abas[aba] });
    }
    if (metodo === 'GET' && /\/conversations\/\d+$/.test(u)) {
      return Response.json({ custom_attributes: {}, labels: [] });
    }
    if (metodo === 'POST' && /custom_attributes/.test(u) && consultarNoAtributo && !momentoDoAtributo) {
      momentoDoAtributo = consultarNoAtributo();
    }
    return Response.json({ ok: true });
  });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('lead casado pelo protocolo', () => {
  const comProtocolo = () => mensagem({
    conversa: 78,
    texto: 'Olá, vim pelo google e gostaria de mais informações [Protocolo: VITA-MTM2TV1950J2]',
    nome: 'Maria Santos',
    fone: '+5519983511561',
    contatoDesde: '2026-09-21T20:04:30.000Z',
  });

  test('nome e telefone do remetente ficam gravados no lead', async () => {
    const { env, consultar } = cenario();
    const r = await atribuirLead(env, 1, comProtocolo());

    expect(r.status).toBe('ok');
    const [lead] = consultar<{ nome: string; phone_e164: string; phone_key: string }>(
      `SELECT nome, phone_e164, phone_key FROM leads WHERE protocol = 'VITA-MTM2TV1950J2'`,
    );
    expect(lead).toEqual({ nome: 'Maria Santos', phone_e164: '+5519983511561', phone_key: '1983511561' });
  });

  test('nome bom que ja estava no lead nao e trocado', async () => {
    const { env, exec, consultar } = cenario();
    exec(`UPDATE leads SET nome = 'Maria do Formulario' WHERE protocol = 'VITA-MTM2TV1950J2'`);
    await atribuirLead(env, 1, comProtocolo());
    expect(consultar<{ nome: string }>(`SELECT nome FROM leads`)[0]!.nome).toBe('Maria do Formulario');
  });

  test('nome de perfil sem letra nao e gravado como nome', async () => {
    const { env, consultar } = cenario();
    await atribuirLead(env, 1, mensagem({
      conversa: 78, texto: '[Protocolo: VITA-MTM2TV1950J2]', nome: '😊', fone: '+5511954687762',
    }));
    const [lead] = consultar<{ nome: string | null; phone_e164: string }>(`SELECT nome, phone_e164 FROM leads`);
    expect(lead!.nome).toBeNull();
    expect(lead!.phone_e164).toBe('+5511954687762');
  });

  test('a conversa ja tem o protocolo quando o atributo que cria o card e gravado', async () => {
    // o webhook do card chega logo depois do atributo: se a linha de
    // `conversations` ainda nao existe, o aviso sai "Direto" e sem URL
    const { env, consultar } = cenario();
    consultarNoAtributo = () => consultar(`SELECT cw_conversation_id, protocol FROM conversations`);
    await atribuirLead(env, 1, comProtocolo());
    expect(momentoDoAtributo).toEqual([{ cw_conversation_id: 78, protocol: 'VITA-MTM2TV1950J2' }]);
  });
});

describe('numero da propria empresa', () => {
  test('nao vira lead nem atribuicao', async () => {
    const { env, consultar } = cenario({ planilha: true });
    const r = await atribuirLead(env, 1, mensagem({
      conversa: 31, nome: 'Vita Audio Aparelhos Auditivos', fone: '+5519990177608',
      texto: 'Prezados, informamos que o retorno do Sr Edemir foi cancelado',
    }));
    expect(r.status).toBe('ignorado');
    expect(r.motivo).toMatch(/propria empresa/);
    expect(consultar('SELECT * FROM leads_diretos')).toHaveLength(0);
    expect(abas.Geral).toHaveLength(1);
  });
});

describe('lead direto (sem protocolo, sem clique, sem frase)', () => {
  test('contato novo que chamou primeiro entra na Geral e na aba de lead direto', async () => {
    const { env, consultar } = cenario({ planilha: true });
    const r = await atribuirLead(env, 1, mensagem());

    expect(r.status).toBe('ok');
    expect(r.motivo).toMatch(/sem aviso no grupo/);
    for (const aba of ['Geral', 'WhatsApp Direto']) {
      expect(abas[aba]).toHaveLength(2);
      const linha = Object.fromEntries(GERAL_CAB.map((h, i) => [h, abas[aba]![1]![i]]));
      expect(linha).toMatchObject({
        'URL WHATSAPP': 'https://wa.me/5511984738894',
        Canal: 'Mensagem Direta (WhatsApp)',
        SEQUENCIA: '',
        DATA: '21/09/2026',
        HORA: '17:04:38',
        NOME: 'Benicio Groblackner',
        TELEFONE: '5511984738894',
      });
    }
    expect(consultar<{ planilha_status: string }>('SELECT planilha_status FROM leads_diretos')[0]!.planilha_status).toBe('ok');
  });

  test('o canal leva "Mensagem": no fluxo Central ele cai na saida sem aviso', async () => {
    const { env } = cenario({ planilha: true });
    await atribuirLead(env, 1, mensagem());
    expect(abas.Geral![1]![1]).toMatch(/Mensagem/);
  });

  test('nao vai para o Banco de Dados nem avisa o grupo', async () => {
    const { env } = cenario({ planilha: true });
    await atribuirLead(env, 1, mensagem());
    expect(chamadas.some((c) => /Cliques|Conversoes/.test(c.url))).toBe(false);
    expect(chamadas.some((c) => /pulseboard/.test(c.url))).toBe(false);
  });

  test('a segunda mensagem do mesmo contato nao duplica a linha', async () => {
    const { env } = cenario({ planilha: true });
    await atribuirLead(env, 1, mensagem());
    const r = await atribuirLead(env, 1, mensagem({ em: '2026-09-21T20:05:10.000Z', texto: 'tem horario amanha?' }));
    expect(r.status).toBe('ignorado');
    expect(abas.Geral).toHaveLength(2);
  });

  test('o mesmo telefone em outra conversa nao entra de novo', async () => {
    const { env } = cenario({ planilha: true });
    await atribuirLead(env, 1, mensagem());
    await atribuirLead(env, 1, mensagem({ conversa: 97, contatoDesde: '2026-09-21T20:04:38.000Z' }));
    expect(abas.Geral).toHaveLength(2);
  });

  test('paciente antigo (contato de antes na caixa) nao e lead', async () => {
    const { env } = cenario({ planilha: true });
    const r = await atribuirLead(env, 1, mensagem({
      nome: 'Ivan', fone: '+5519978163737', contatoDesde: '2026-08-28T17:38:00.000Z',
      texto: 'A oliva que comprei ha 3 semanas ja rasgou',
    }));
    expect(r.status).toBe('ignorado');
    expect(r.motivo).toMatch(/contato antigo/);
    expect(abas.Geral).toHaveLength(1);
  });

  test('quando a clinica falou primeiro nao e lead direto', async () => {
    // formulario (mensagem da Natasha), confirmacao de consulta, retorno
    const { env } = cenario({ planilha: true });
    const r = await atribuirLead(env, 1, mensagem({
      nome: '5519999360206', fone: '+5519999360206',
      contatoDesde: '2026-09-21T20:03:44.941Z', primeiraResposta: '2026-09-21T20:03:45.301Z',
    }));
    expect(r.status).toBe('ignorado');
    expect(r.motivo).toMatch(/clinica falou primeiro/);
    expect(abas.Geral).toHaveLength(1);
  });

  test('nome de perfil ruim vai como "Sem nome no WhatsApp"', async () => {
    const { env } = cenario({ planilha: true });
    await atribuirLead(env, 1, mensagem({ nome: '.' }));
    expect(abas.Geral![1]![5]).toBe('Sem nome no WhatsApp');
  });

  test('telefone que ja esta na aba (lead de agosto) nao duplica', async () => {
    const { env } = cenario({ planilha: true });
    abas.Geral!.push(['https://wa.me/11984738894', 'Campanha de Mensagem - Google', '22AGO', '27/08/2026', '16:20:36', 'Benicio', '11984738894']);
    await atribuirLead(env, 1, mensagem());
    expect(abas.Geral).toHaveLength(2);
    expect(abas['WhatsApp Direto']).toHaveLength(2);
  });

  test('aba que falhou volta para a fila e a retentativa grava', async () => {
    const { env, consultar } = cenario({ planilha: true });
    const guardada = abas['WhatsApp Direto']!;
    delete abas['WhatsApp Direto'];
    const r1 = await atribuirLead(env, 1, mensagem());
    expect(r1.status).toBe('erro');
    expect(consultar<{ planilha_status: string }>('SELECT planilha_status FROM leads_diretos')[0]!.planilha_status).toBe('erro');

    abas['WhatsApp Direto'] = guardada;
    const r2 = await atribuirLead(env, 1, mensagem());
    expect(r2.status).toBe('ok');
    // a Geral ja tinha a linha: a trava por telefone segura a segunda
    expect(abas.Geral).toHaveLength(2);
    expect(abas['WhatsApp Direto']).toHaveLength(2);
  });

  test('cliente sem aba de lead direto segue como antes: ignorado', async () => {
    const { env, exec } = cenario({ planilha: true });
    exec(`UPDATE tenant_config SET sheets_aba_direto = NULL WHERE tenant_id = 1`);
    const r = await atribuirLead(env, 1, mensagem());
    expect(r.status).toBe('ignorado');
    expect(abas.Geral).toHaveLength(1);
  });
});
