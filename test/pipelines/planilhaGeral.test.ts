import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { fakeD1 } from '../helpers/fakeD1';
import { espelharNaPlanilha } from '../../src/pipelines/planilha';
import type { Env } from '../../src/env';

/**
 * Tainã, 22/09: a Geral recebe so' o lead da campanha de mensagem do Meta. O
 * de mensagem do Google continua na "Google Mensagem" e no Banco de Dados.
 */

const CAB = ['Link do Whatsapp', 'Status', 'DATA', 'HORA', 'SEQUENCIA', 'Canal', 'NOME', 'TELEFONE'];

function cenario() {
  const { d1, exec } = fakeD1();
  exec(`INSERT INTO tenants (id, slug, nome, ativo) VALUES (5, 'taina', 'Taina Aci', 1)`);
  exec(`INSERT INTO tenant_config (tenant_id, cw_account_id, cw_board_funil_id, ga_customer_id, ingest_key,
          sheets_ativo, planilha_modo, sheets_leads_doc_id, sheets_aba_geral, sheets_aba_google, sheets_aba_meta,
          sheets_geral_canais)
        VALUES (5, 4, 5, '4666625860', 'k', 1, 'sistema', 'DOC-LEADS', 'Geral', 'Google Mensagem', 'Meta Mensagem', 'meta')`);
  exec(`INSERT INTO credenciais (chave, valor) VALUES ('datamanager_refresh_token', 'rt')`);
  exec(`INSERT INTO credenciais (chave, valor) VALUES ('gtm_refresh_token', 'rt')`);
  exec(`INSERT INTO leads (tenant_id, protocol, nome, phone_e164, gclid, utm_source, origem, evento)
        VALUES (5, 'TAINA-GOOGLE', 'Douglas', '+5511996201147', 'Cj0abc', 'google', 'clique', 'whatsapp_click')`);
  exec(`INSERT INTO leads (tenant_id, protocol, nome, phone_e164, utm_source, utm_medium, origem, evento)
        VALUES (5, 'TAINA-CTWA-9', 'Giuliana', '+5521996362119', 'instagram', 'mensagem', 'mensagem', 'ctwa')`);
  const env = {
    DB: d1,
    CACHE: { get: async () => null, put: async () => undefined },
    GOOGLE_ADS_CLIENT_ID: 'x',
    GOOGLE_ADS_CLIENT_SECRET: 'x',
    GOOGLE_ADS_REFRESH_TOKEN: 'x',
  } as unknown as Env;
  return { env, exec };
}

let abas: Record<string, string[][]>;
/** A Geral como fica depois da proxima leitura inteira: o script da planilha reordenando. */
let geralDepoisDaLeitura: string[][] | null;

beforeEach(() => {
  abas = { Geral: [CAB], 'Google Mensagem': [CAB], 'Meta Mensagem': [CAB] };
  geralDepoisDaLeitura = null;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const u = decodeURIComponent(String(url));
    if (/oauth2\.googleapis\.com/.test(u)) return Response.json({ access_token: 'tok' });
    const planilha = u.match(/sheets\.googleapis\.com\/v4\/spreadsheets\/[^/]+\/values\/'([^']+)'!/);
    if (planilha) {
      const aba = planilha[1]!;
      if (!abas[aba]) return Response.json({ error: { message: 'aba nao existe' } }, { status: 400 });
      if ((init.method ?? 'GET') === 'POST') {
        abas[aba]!.push(...(JSON.parse(String(init.body)) as { values: string[][] }).values);
        return Response.json({});
      }
      if (init.method === 'PUT') {
        const n = Number(u.match(/!A(\d+):/)?.[1] ?? 0);
        abas[aba]![n - 1] = (JSON.parse(String(init.body)) as { values: string[][] }).values[0]!;
        return Response.json({});
      }
      const umaLinha = u.match(/!A(\d+):[A-Z]+\d+/);
      if (umaLinha) return Response.json({ values: [abas[aba]![Number(umaLinha[1]) - 1] ?? []] });
      const r = Response.json({ values: abas[aba] });
      if (aba === 'Geral' && /!A:ZZ/.test(u) && geralDepoisDaLeitura) [abas.Geral, geralDepoisDaLeitura] = [geralDepoisDaLeitura, null];
      return r;
    }
    return Response.json({ ok: true });
  });
});
afterEach(() => vi.unstubAllGlobals());

const conversa = {
  evento: 'conversa', etapa: 'Novo Lead', valor: 10, moeda: 'BRL', quando: Date.parse('2026-09-22T12:00:00Z'),
  acao: '7694728266', requestId: 'r', match: 'click_id', enviadoEm: Date.parse('2026-09-22T12:00:05Z'),
};

describe('Tainã: Geral so com lead do Meta', () => {
  test('lead do Google entra na Google Mensagem e nao na Geral', async () => {
    const { env } = cenario();
    await espelharNaPlanilha(env, 5, { tipo: 'conversao', protocolo: 'TAINA-GOOGLE', ensaio: false, conversao: conversa });
    expect(abas['Google Mensagem']!.length).toBe(2);
    expect(abas.Geral!.length).toBe(1);
  });

  test('lead do Meta entra na Geral e na Meta Mensagem', async () => {
    const { env } = cenario();
    await espelharNaPlanilha(env, 5, { tipo: 'entrada', protocolo: 'TAINA-CTWA-9', ensaio: false });
    expect(abas.Geral!.length).toBe(2);
    expect(abas['Meta Mensagem']!.length).toBe(2);
    expect(abas['Google Mensagem']!.length).toBe(1);
  });

  test('cliente sem escolha (NULL) segue gravando o Google na Geral', async () => {
    const { env, exec } = cenario();
    exec(`UPDATE tenant_config SET sheets_geral_canais = NULL WHERE tenant_id = 5`);
    await espelharNaPlanilha(env, 5, { tipo: 'conversao', protocolo: 'TAINA-GOOGLE', ensaio: false, conversao: conversa });
    expect(abas.Geral!.length).toBe(2);
    expect(abas['Google Mensagem']!.length).toBe(2);
  });
});

describe('a linha do lead nao pode se perder numa falha passageira', () => {
  const SOBRECARGA = 'D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window';
  const naoEspera = [0, 0];

  /** O banco recusa as primeiras `vezes` consultas, como em producao. */
  const sobrecarregado = (env: Env, vezes: number) => {
    const real = env.DB.prepare.bind(env.DB);
    let falta = vezes;
    (env.DB as unknown as { prepare: unknown }).prepare = (sql: string) => {
      if (falta-- > 0) throw new Error(SOBRECARGA);
      return real(sql);
    };
  };

  // Locadora e Martinelli, 03-04/11/2026: a conversao subiu, a gravacao caiu com
  // "D1 DB is overloaded" e a reentrega so' dizia "ja enviada". Sem linha, o script
  // nao tem o que numerar e o aviso sai sem sequencia depois dos 3 min.
  test('banco sobrecarregado: tenta de novo e a linha entra', async () => {
    const { env, exec } = cenario();
    exec(`UPDATE tenant_config SET sheets_geral_canais = NULL WHERE tenant_id = 5`);
    sobrecarregado(env, 1);
    await espelharNaPlanilha(env, 5, { tipo: 'conversao', protocolo: 'TAINA-GOOGLE', ensaio: false, conversao: conversa }, naoEspera);
    expect(abas.Geral!.length).toBe(2);
  });

  test('a repeticao nao duplica a linha que ja entrou', async () => {
    const { env, exec } = cenario();
    exec(`UPDATE tenant_config SET sheets_geral_canais = NULL WHERE tenant_id = 5`);
    // a Geral entra, a Google Mensagem falha uma vez: a repeticao passa de novo pelas duas
    let falhou = false;
    const fetchReal = globalThis.fetch;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      if (!falhou && (init.method ?? 'GET') === 'POST' && decodeURIComponent(String(url)).includes("'Google Mensagem'")) {
        falhou = true;
        return Response.json({ error: { message: 'Quota exceeded' } }, { status: 429 });
      }
      return fetchReal(url, init);
    });
    await espelharNaPlanilha(env, 5, { tipo: 'conversao', protocolo: 'TAINA-GOOGLE', ensaio: false, conversao: conversa }, naoEspera);
    expect(falhou).toBe(true);
    expect(abas.Geral!.length).toBe(2);
    expect(abas['Google Mensagem']!.length).toBe(2);
  });

  test('desiste depois das tentativas e o erro sobe para quem chamou', async () => {
    const { env } = cenario();
    sobrecarregado(env, 99);
    await expect(
      espelharNaPlanilha(env, 5, { tipo: 'conversao', protocolo: 'TAINA-GOOGLE', ensaio: false, conversao: conversa }, naoEspera),
    ).rejects.toThrow('overloaded');
  });

  test('erro de cadastro nao melhora tentando: falha na primeira', async () => {
    const { env, exec } = cenario();
    exec(`UPDATE tenant_config SET sheets_geral_canais = NULL WHERE tenant_id = 5`);
    abas.Geral = [];
    let leituras = 0;
    const fetchReal = globalThis.fetch;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      if (decodeURIComponent(String(url)).includes("'Geral'")) leituras++;
      return fetchReal(url, init);
    });
    await expect(
      espelharNaPlanilha(env, 5, { tipo: 'conversao', protocolo: 'TAINA-GOOGLE', ensaio: false, conversao: conversa }, naoEspera),
    ).rejects.toThrow('sem cabecalho');
    expect(leituras).toBe(1);
  });
});

describe('linha que ja esta na Geral', () => {
  const CAB_UTM = ['DATA', 'HORA', 'Canal', 'CAMPANHA', 'TERMO', 'NOME', 'TELEFONE', 'STATUS'];

  // Locadora, 24/09/2026: a linha do lead da LP e' escrita pelo fluxo do
  // formulario, que nao sabe a campanha. Quando o lead chama no WhatsApp o
  // sistema ja' sabe — e completa o que estava vazio, sem repetir a linha nem
  // mexer no que o time escreveu.
  const comLinha = (over: string[] = []) => {
    abas.Geral = [CAB_UTM, ['22/09/2026', '09:00:00', '', '', '', 'Douglas', '5511996201147', 'em atendimento', ...over]];
  };

  test('completa as UTMs que estavam vazias', async () => {
    const { env, exec } = cenario();
    exec(`UPDATE tenant_config SET sheets_geral_canais = NULL WHERE tenant_id = 5`);
    exec(`UPDATE leads SET utm_campaign = '21802734158', utm_campaign_nome = 'WD - Search', utm_term = 'aluguel de andaime'
          WHERE protocol = 'TAINA-GOOGLE'`);
    comLinha();

    await espelharNaPlanilha(env, 5, { tipo: 'conversao', protocolo: 'TAINA-GOOGLE', ensaio: false, conversao: conversa });

    expect(abas.Geral!.length).toBe(2);
    const linha = abas.Geral![1]!;
    expect(linha[3]).toBe('WD - Search');
    expect(linha[4]).toBe('aluguel de andaime');
    expect(linha[7]).toBe('em atendimento');
  });

  test('aba reordenada entre a leitura e a gravacao: completa a linha do lead, nao a de outro', async () => {
    // Vita, 30/09: o script da planilha ordena a Geral a cada 5 min. Gravar na
    // posicao lida um instante antes copiou um lead por cima de outros dois.
    const { env, exec } = cenario();
    exec(`UPDATE tenant_config SET sheets_geral_canais = NULL WHERE tenant_id = 5`);
    exec(`UPDATE leads SET utm_campaign_nome = 'WD - Search' WHERE protocol = 'TAINA-GOOGLE'`);
    const douglas = ['22/09/2026', '09:00:00', '', '', '', 'Douglas', '5511996201147', ''];
    const vilma = ['22/09/2026', '11:42:04', 'Google', '', '', 'Vilma', '5519997479153', 'Novo Lead'];
    abas.Geral = [CAB_UTM, douglas, vilma];
    geralDepoisDaLeitura = [CAB_UTM, vilma, douglas];

    await espelharNaPlanilha(env, 5, { tipo: 'conversao', protocolo: 'TAINA-GOOGLE', ensaio: false, conversao: conversa });

    expect(abas.Geral).toHaveLength(3);
    expect(abas.Geral![1]).toEqual(vilma);
    expect(abas.Geral![2]![5]).toBe('Douglas');
    expect(abas.Geral![2]![3]).toBe('WD - Search');
  });

  test('nao reescreve o que ja estava preenchido', async () => {
    const { env, exec } = cenario();
    exec(`UPDATE tenant_config SET sheets_geral_canais = NULL WHERE tenant_id = 5`);
    exec(`UPDATE leads SET utm_campaign_nome = 'WD - Search' WHERE protocol = 'TAINA-GOOGLE'`);
    abas.Geral = [CAB_UTM, ['22/09/2026', '09:00:00', 'Canal escrito a mao', 'Campanha antiga', '', 'Douglas', '5511996201147', '']];

    await espelharNaPlanilha(env, 5, { tipo: 'conversao', protocolo: 'TAINA-GOOGLE', ensaio: false, conversao: conversa });

    expect(abas.Geral![1]![2]).toBe('Canal escrito a mao');
    expect(abas.Geral![1]![3]).toBe('Campanha antiga');
  });
});
