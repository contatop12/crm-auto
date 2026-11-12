import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { fakeD1 } from '../helpers/fakeD1';
import { rodarSequencia, gravarModo, expurgarAvisosDaSequencia, type Modo } from '../../src/pipelines/sequencia';
import type { Env } from '../../src/env';

const CAB = ['SEQUENCIA', 'DATA', 'HORA', 'NOME', 'TELEFONE'];
/** 12/11/2026 10:02 em Sao Paulo. Minuto 2: as abas que so' ordenam ficam de fora. */
const AGORA = new Date('2026-11-12T13:02:00Z');
const MINUTO_5 = new Date('2026-11-12T13:05:00Z');

type Aviso = { cliente: string; planilhaId: string; aba: string; clienteChave: string; linha: number; sequencia: string; dados: Record<string, string> };

let abas: Record<string, string[][]>;
let pulseboard: Aviso[];
let reserva: Aviso[];
let pulseboardNoAr: boolean;
let reservaNoAr: boolean;
let foraDoAr: Set<string>;
let estrutura: Array<Record<string, unknown>>;
let leituras: string[];
let chamadas: number;

function cenario(modo: Modo, planilhas = `(1, 'Cliente A', 'DOC-A', 'geral', NULL, 1, 1, 1)`) {
  const { d1, exec, consultar } = fakeD1();
  exec('DELETE FROM sequencia_planilhas');
  exec(`INSERT INTO sequencia_planilhas (id, cliente, doc, aba, nome_no_aviso, numerar, notificar, ordenar) VALUES ${planilhas}`);
  exec(`UPDATE sequencia_estado SET valor = '${modo}' WHERE chave = 'modo'`);
  exec(`INSERT INTO credenciais (chave, valor) VALUES ('datamanager_refresh_token', 'rt')`);
  exec(`INSERT INTO credenciais (chave, valor) VALUES ('gtm_refresh_token', 'rt')`);
  const env = {
    DB: d1,
    CACHE: { get: async () => null, put: async () => undefined },
    GOOGLE_ADS_CLIENT_ID: 'x',
    GOOGLE_ADS_CLIENT_SECRET: 'x',
    GOOGLE_ADS_REFRESH_TOKEN: 'x',
    EVOLUTION_SERVER_URL: 'https://evo.teste',
    EVOLUTION_API_KEY: 'k',
    EVOLUTION_ALERT_INSTANCE: 'alerta',
    EVOLUTION_ALERT_GROUP_ID: 'grupo',
  } as unknown as Env;
  const avisos = () => consultar<{ sequencia: string; estado: string; tentativas: number }>(
    'SELECT sequencia, estado, tentativas FROM sequencia_avisos ORDER BY id',
  );
  return { env, exec, consultar, avisos };
}

/** Um Sheets de mentira que guarda as abas e aplica o que o CRM grava. */
beforeEach(() => {
  abas = {};
  pulseboard = [];
  reserva = [];
  pulseboardNoAr = true;
  reservaNoAr = true;
  foraDoAr = new Set();
  estrutura = [];
  leituras = [];
  chamadas = 0;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    chamadas++;
    const u = decodeURIComponent(String(url));
    let corpo: unknown = null;
    try { corpo = init.body ? JSON.parse(String(init.body)) : null; } catch { /* corpo de formulario (OAuth) */ }
    if (/oauth2\.googleapis\.com/.test(u)) return Response.json({ access_token: 'tok' });
    if (/pulseboard\./.test(u)) {
      if (!pulseboardNoAr) return new Response('fora', { status: 502 });
      pulseboard.push(corpo as Aviso);
      return Response.json({ ok: true });
    }
    if (/n8n\./.test(u)) {
      if (!reservaNoAr) return new Response('fora', { status: 502 });
      reserva.push(corpo as Aviso);
      return Response.json({ ok: true });
    }
    if (/evo\.teste/.test(u)) return Response.json({ ok: true });

    const doc = /\/spreadsheets\/([^/?:]+)/.exec(u)?.[1] ?? '';
    if (foraDoAr.has(doc)) return Response.json({ error: { message: 'The service is currently unavailable.' } }, { status: 503 });
    const aba = abas[doc];
    if (!aba) return Response.json({ error: { message: 'not found' } }, { status: 404 });

    if (/values:batchUpdate/.test(u)) {
      for (const d of (corpo as { data: Array<{ range: string; values: string[][] }> }).data) {
        const m = /!([A-Z]+)(\d+)$/.exec(d.range)!;
        const coluna = m[1]!.charCodeAt(0) - 65;
        const linha = aba[Number(m[2]) - 1]!;
        while (linha.length <= coluna) linha.push('');
        linha[coluna] = d.values[0]![0]!;
      }
      return Response.json({});
    }
    if (/:batchUpdate/.test(u)) {
      for (const r of (corpo as { requests: Array<Record<string, any>> }).requests) {
        estrutura.push(r);
        if (r.moveDimension) {
          const { startIndex: de } = r.moveDimension.source;
          const para = r.moveDimension.destinationIndex as number;
          const [x] = aba.splice(de, 1);
          aba.splice(para > de ? para - 1 : para, 0, x!);
        }
      }
      return Response.json({});
    }
    if (/\/values\//.test(u)) {
      leituras.push(doc);
      return Response.json({ values: aba.map((l) => [...l]) });
    }
    return Response.json({ properties: { title: `Planilha ${doc}` }, sheets: [{ properties: { sheetId: 77, title: 'Geral' } }] });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('desligado', () => {
  test('nao le planilha nenhuma', async () => {
    const { env } = cenario('desligado');
    abas['DOC-A'] = [CAB, ['', '12/11/2026', '09:00:00', 'Ana', '5511988880001']];
    const r = await rodarSequencia(env, AGORA);
    expect(r.rodou).toBe(false);
    expect(chamadas).toBe(0);
  });
});

describe('ligado', () => {
  test('numera a linha nova, avisa a Pulseboard e leva a linha para o topo', async () => {
    const { env, avisos } = cenario('ligado');
    abas['DOC-A'] = [
      CAB,
      ['04NOV', '11/11/2026', '18:00:00', 'Caio', '5511988880003'],
      ['03NOV', '10/11/2026', '10:00:00', 'Davi', '5511988880004'],
      ['', '12/11/2026', '09:00:00', 'Ana', '5511988880001'],
    ];
    const r = await rodarSequencia(env, AGORA);

    expect(r.planilhas).toEqual([{ cliente: 'Cliente A', numeradas: 1, consertadas: 0, movidas: 1, avisos: 1, formato: false }]);
    expect(abas['DOC-A']!.map((l) => `${l[0]} ${l[3]}`)).toEqual(['SEQUENCIA NOME', '05NOV Ana', '04NOV Caio', '03NOV Davi']);
    expect(pulseboard).toEqual([{
      cliente: 'Planilha DOC-A',
      planilhaId: 'DOC-A',
      aba: 'Geral',
      clienteChave: 'DOC-A|Geral',
      linha: 4,
      sequencia: '05NOV',
      dados: { SEQUENCIA: '05NOV', DATA: '12/11/2026', HORA: '09:00:00', NOME: 'Ana', TELEFONE: '5511988880001' },
    }]);
    expect(reserva).toEqual([]);
    expect(avisos()).toEqual([{ sequencia: '05NOV', estado: 'enviado', tentativas: 1 }]);
  });

  test('a rodada seguinte nao numera nem avisa de novo', async () => {
    const { env, avisos } = cenario('ligado');
    abas['DOC-A'] = [CAB, ['', '12/11/2026', '09:00:00', 'Ana', '5511988880001']];
    await rodarSequencia(env, AGORA);
    const r = await rodarSequencia(env, new Date(AGORA.getTime() + 60_000));
    expect(r.planilhas[0]).toMatchObject({ numeradas: 0, movidas: 0, avisos: 0 });
    expect(pulseboard).toHaveLength(1);
    expect(avisos()).toHaveLength(1);
  });

  test('nome_no_aviso vai como cliente; notificar desligado numera sem avisar', async () => {
    const { env, avisos } = cenario('ligado', `
      (1, 'Libertad', 'DOC-A', 'Geral', 'Libertad', 1, 1, 1),
      (2, 'Rafaela',  'DOC-B', 'Geral', 'Assessora Rafaela', 1, 0, 1)`);
    abas['DOC-A'] = [CAB, ['', '12/11/2026', '09:00:00', 'Ana', '1']];
    abas['DOC-B'] = [CAB, ['', '12/11/2026', '09:00:00', 'Bia', '2']];
    await rodarSequencia(env, AGORA);
    expect(pulseboard.map((a) => a.cliente)).toEqual(['Libertad']);
    expect(abas['DOC-B']![1]![0]).toBe('01NOV');
    expect(avisos()).toHaveLength(1);
  });

  test('lead antigo e numerado mas nao vira aviso', async () => {
    const { env } = cenario('ligado');
    abas['DOC-A'] = [CAB, ['', '01/10/2026', '09:00:00', 'Velho', '1']];
    await rodarSequencia(env, AGORA);
    expect(abas['DOC-A']![1]![0]).toBe('01OUT');
    expect(pulseboard).toEqual([]);
  });

  test('Pulseboard fora: o aviso vai pela reserva', async () => {
    const { env, avisos } = cenario('ligado');
    pulseboardNoAr = false;
    abas['DOC-A'] = [CAB, ['', '12/11/2026', '09:00:00', 'Ana', '1']];
    await rodarSequencia(env, AGORA);
    expect(reserva.map((a) => a.sequencia)).toEqual(['01NOV']);
    expect(avisos()).toEqual([{ sequencia: '01NOV', estado: 'reserva', tentativas: 1 }]);
  });

  test('as duas fora: a linha fica numerada e o aviso sai na rodada em que uma voltar', async () => {
    const { env, avisos } = cenario('ligado');
    pulseboardNoAr = false;
    reservaNoAr = false;
    abas['DOC-A'] = [CAB, ['', '12/11/2026', '09:00:00', 'Ana', '1']];
    await rodarSequencia(env, AGORA);
    expect(abas['DOC-A']![1]![0]).toBe('01NOV');
    expect(avisos()).toEqual([{ sequencia: '01NOV', estado: 'gravado', tentativas: 1 }]);

    pulseboardNoAr = true;
    await rodarSequencia(env, new Date(AGORA.getTime() + 60_000));
    expect(pulseboard.map((a) => a.sequencia)).toEqual(['01NOV']);
    expect(avisos()).toEqual([{ sequencia: '01NOV', estado: 'enviado', tentativas: 2 }]);
  });

  test('depois de 15 tentativas o aviso para de ser tentado', async () => {
    const { env, exec, avisos } = cenario('ligado');
    pulseboardNoAr = false;
    reservaNoAr = false;
    abas['DOC-A'] = [CAB, ['01NOV', '12/11/2026', '09:00:00', 'Ana', '1']];
    exec(`INSERT INTO sequencia_avisos (planilha_id, sequencia, estado, payload, tentativas) VALUES (1, '01NOV', 'gravado', '{}', 14)`);
    await rodarSequencia(env, AGORA);
    expect(avisos()).toEqual([{ sequencia: '01NOV', estado: 'desistiu', tentativas: 15 }]);
  });

  test('rodada que morreu depois de gravar a planilha: a seguinte manda o aviso que faltou', async () => {
    const { env, exec, avisos } = cenario('ligado');
    abas['DOC-A'] = [CAB, ['01NOV', '12/11/2026', '09:00:00', 'Ana', '1']];
    exec(`INSERT INTO sequencia_avisos (planilha_id, sequencia, estado, payload) VALUES (1, '01NOV', 'a_gravar', '{"sequencia":"01NOV"}')`);
    await rodarSequencia(env, AGORA);
    // conferido nesta rodada, enviado na proxima (o reenvio abre a rodada)
    expect(avisos()).toEqual([{ sequencia: '01NOV', estado: 'gravado', tentativas: 0 }]);
    await rodarSequencia(env, new Date(AGORA.getTime() + 60_000));
    expect(pulseboard).toEqual([{ sequencia: '01NOV' }]);
    expect(avisos()).toEqual([{ sequencia: '01NOV', estado: 'enviado', tentativas: 1 }]);
  });

  test('rodada que morreu antes de gravar: a linha e numerada de novo e avisa uma vez so', async () => {
    const { env, exec, avisos } = cenario('ligado');
    abas['DOC-A'] = [CAB, ['', '12/11/2026', '09:00:00', 'Ana', '1']];
    exec(`INSERT INTO sequencia_avisos (planilha_id, sequencia, estado, payload) VALUES (1, '01NOV', 'a_gravar', '{}')`);
    await rodarSequencia(env, AGORA);
    expect(abas['DOC-A']![1]![0]).toBe('01NOV');
    expect(pulseboard).toHaveLength(1);
    expect(avisos()).toEqual([{ sequencia: '01NOV', estado: 'enviado', tentativas: 1 }]);
  });

  test('planilha fora do ar nao segura as outras, e volta sozinha', async () => {
    const { env, consultar } = cenario('ligado', `
      (1, 'Cliente A', 'DOC-A', 'Geral', NULL, 1, 1, 1),
      (2, 'Cliente B', 'DOC-B', 'Geral', NULL, 1, 1, 1)`);
    abas['DOC-A'] = [CAB, ['', '12/11/2026', '09:00:00', 'Ana', '1']];
    abas['DOC-B'] = [CAB, ['', '12/11/2026', '09:00:00', 'Bia', '2']];
    foraDoAr.add('DOC-A');
    const r = await rodarSequencia(env, AGORA);
    expect(r.planilhas[0]!.erro).toMatch(/503/);
    expect(abas['DOC-B']![1]![0]).toBe('01NOV');
    const estado = () => consultar<{ erros_seguidos: number; erro: string | null }>('SELECT erros_seguidos, erro FROM sequencia_planilhas WHERE id = 1')[0]!;
    expect(estado().erros_seguidos).toBe(1);

    foraDoAr.clear();
    await rodarSequencia(env, new Date(AGORA.getTime() + 60_000));
    expect(abas['DOC-A']![1]![0]).toBe('01NOV');
    expect(estado()).toEqual({ erros_seguidos: 0, erro: null });
  });

  test('30 rodadas seguidas com erro avisam o grupo de alertas uma vez', async () => {
    const { env, exec, consultar } = cenario('ligado');
    exec(`UPDATE sequencia_planilhas SET erros_seguidos = 29, erro_desde = '2026-11-12T12:30:00.000Z' WHERE id = 1`);
    foraDoAr.add('DOC-A');
    abas['DOC-A'] = [CAB];
    await rodarSequencia(env, AGORA);
    await rodarSequencia(env, new Date(AGORA.getTime() + 60_000));
    expect(consultar<{ chave: string }>('SELECT chave FROM avisos_chatwoot')).toEqual([
      { chave: 'sequencia:1:2026-11-12T12:30:00.000Z' },
    ]);
  });

  test('ordenar desligado: numera e deixa a linha onde esta', async () => {
    const { env } = cenario('ligado', `(1, 'Locadora', 'DOC-A', 'Geral', NULL, 1, 1, 0)`);
    abas['DOC-A'] = [
      CAB,
      ['04NOV', '11/11/2026', '18:00:00', 'Caio', '3'],
      ['', '12/11/2026', '09:00:00', 'Ana', '1'],
    ];
    await rodarSequencia(env, AGORA);
    expect(abas['DOC-A']!.map((l) => l[0])).toEqual(['SEQUENCIA', '04NOV', '05NOV']);
    expect(estrutura).toEqual([]);
  });

  test('aba que so ordena roda de 5 em 5 minutos e nao numera', async () => {
    const { env } = cenario('ligado', `(1, 'PL', 'DOC-A', 'GERAL', NULL, 0, 0, 1)`);
    abas['DOC-A'] = [
      CAB,
      ['N8N-1', '11/11/2026', '18:00:00', 'Caio', '3'],
      ['', '12/11/2026', '09:00:00', 'Ana', '1'],
    ];
    await rodarSequencia(env, AGORA);
    expect(leituras).toEqual([]);

    await rodarSequencia(env, MINUTO_5);
    expect(abas['DOC-A']!.map((l) => l[3])).toEqual(['NOME', 'Ana', 'Caio']);
    expect(abas['DOC-A']![1]![0]).toBe('');
    expect(pulseboard).toEqual([]);
  });

  test('hora que virou 30/12/1899: reaplica o formato e ordena so na rodada seguinte', async () => {
    const { env } = cenario('ligado');
    abas['DOC-A'] = [
      CAB,
      ['01NOV', '10/11/2026', '10:00:00', 'Davi', '4'],
      ['02NOV', '11/11/2026', '30/12/1899', 'Caio', '3'],
    ];
    const r = await rodarSequencia(env, AGORA);
    expect(r.planilhas[0]).toMatchObject({ formato: true, movidas: 0 });
    expect(estrutura).toEqual([{
      repeatCell: {
        range: { sheetId: 77, startRowIndex: 1, startColumnIndex: 2, endColumnIndex: 3 },
        cell: { userEnteredFormat: { numberFormat: { type: 'TIME', pattern: 'hh:mm:ss' } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    }]);

    abas['DOC-A']![2]![2] = '18:00:00'; // o formato voltou
    await rodarSequencia(env, new Date(AGORA.getTime() + 60_000));
    expect(abas['DOC-A']!.map((l) => l[3])).toEqual(['NOME', 'Caio', 'Davi']);
  });

  test('duas rodadas ao mesmo tempo: a segunda nao entra', async () => {
    const { env, exec } = cenario('ligado');
    abas['DOC-A'] = [CAB, ['', '12/11/2026', '09:00:00', 'Ana', '1']];
    exec(`UPDATE sequencia_estado SET valor = '2026-11-12T13:03:00.000Z' WHERE chave = 'trava'`);
    const r = await rodarSequencia(env, AGORA);
    expect(r).toMatchObject({ rodou: false, motivo: 'rodada anterior em curso' });
    expect(abas['DOC-A']![1]![0]).toBe('');

    // a trava vence sozinha se a rodada que a pegou morreu
    const depois = await rodarSequencia(env, new Date('2026-11-12T13:04:00Z'));
    expect(depois.rodou).toBe(true);
    expect(abas['DOC-A']![1]![0]).toBe('01NOV');
  });
});

describe('sombra', () => {
  test('calcula e registra, sem gravar na planilha nem avisar', async () => {
    const { env, avisos } = cenario('sombra');
    abas['DOC-A'] = [
      CAB,
      ['04NOV', '11/11/2026', '18:00:00', 'Caio', '3'],
      ['', '12/11/2026', '09:00:00', 'Ana', '1'],
    ];
    const r = await rodarSequencia(env, AGORA);
    expect(r.planilhas[0]).toMatchObject({ numeradas: 1, movidas: 1, avisos: 0 });
    expect(abas['DOC-A']![2]).toEqual(['', '12/11/2026', '09:00:00', 'Ana', '1']);
    expect(estrutura).toEqual([]);
    expect(pulseboard).toEqual([]);
    expect(avisos()).toEqual([{ sequencia: '05NOV', estado: 'sombra', tentativas: 0 }]);

    // outra rodada antes de o Apps Script numerar nao repete o registro
    await rodarSequencia(env, new Date(AGORA.getTime() + 60_000));
    expect(avisos()).toHaveLength(1);
  });

  test('o Apps Script deu o mesmo numero a mesma linha: confere', async () => {
    const { env, avisos } = cenario('sombra');
    abas['DOC-A'] = [CAB, ['', '12/11/2026', '09:00:00', 'Ana', '1']];
    await rodarSequencia(env, AGORA);
    abas['DOC-A']![1]![0] = '01NOV';
    await rodarSequencia(env, new Date(AGORA.getTime() + 60_000));
    expect(avisos()).toEqual([{ sequencia: '01NOV', estado: 'sombra_ok', tentativas: 0 }]);
  });

  test('o Apps Script deu o numero a outro lead: diverge', async () => {
    const { env, avisos } = cenario('sombra');
    abas['DOC-A'] = [CAB, ['', '12/11/2026', '09:00:00', 'Ana', '1']];
    await rodarSequencia(env, AGORA);
    abas['DOC-A'] = [CAB, ['02NOV', '12/11/2026', '09:00:00', 'Ana', '1'], ['01NOV', '12/11/2026', '08:59:00', 'Bia', '2']];
    await rodarSequencia(env, new Date(AGORA.getTime() + 60_000));
    expect(avisos()).toEqual([{ sequencia: '01NOV', estado: 'sombra_diverge', tentativas: 0 }]);
  });
});

test('trocar o modo vale na rodada seguinte', async () => {
  const { env } = cenario('desligado');
  abas['DOC-A'] = [CAB, ['', '12/11/2026', '09:00:00', 'Ana', '1']];
  await gravarModo(env.DB, 'ligado');
  await rodarSequencia(env, AGORA);
  expect(abas['DOC-A']![1]![0]).toBe('01NOV');
});

test('o corpo dos avisos some depois de 30 dias', async () => {
  const { env, exec, avisos } = cenario('ligado');
  exec(`INSERT INTO sequencia_avisos (planilha_id, sequencia, estado, payload, criado_em) VALUES
        (1, '01OUT', 'enviado', '{}', datetime('now', '-31 day')), (1, '01NOV', 'enviado', '{}', datetime('now', '-2 day'))`);
  expect(await expurgarAvisosDaSequencia(env.DB, 30)).toBe(1);
  expect(avisos().map((a) => a.sequencia)).toEqual(['01NOV']);
});
