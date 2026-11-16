import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { fakeD1 } from '../helpers/fakeD1';
import {
  rodarBackupPlanilhas, diaSP, chaveDoObjeto, gzip, gunzip, lerEstado, ESPERA_APOS_FALHA_MS,
} from '../../src/pipelines/backupPlanilhas';
import type { Env } from '../../src/env';

/** 16/11/2026 04:30 em Sao Paulo (07:30Z): depois de 01:00. */
const MANHA = new Date('2026-11-16T07:30:00Z');

let objetos: Map<string, Uint8Array>;
let leituras: Array<{ doc: string; query: string }>;
let foraDoAr: Set<string>;
const esperas: number[] = [];
const esperar = async (ms: number) => { esperas.push(ms); };

function cenario(planilhas: string) {
  const { d1, exec } = fakeD1();
  exec('DELETE FROM sequencia_planilhas');
  exec(`INSERT INTO sequencia_planilhas (id, cliente, doc, aba, ativo) VALUES ${planilhas}`);
  exec(`INSERT INTO credenciais (chave, valor) VALUES ('gtm_refresh_token', 'rt')`);
  const env = {
    DB: d1,
    CACHE: { get: async () => null, put: async () => undefined },
    GOOGLE_ADS_CLIENT_ID: 'x',
    GOOGLE_ADS_CLIENT_SECRET: 'x',
    GOOGLE_ADS_REFRESH_TOKEN: 'x',
    BACKUPS: {
      put: async (k: string, v: Uint8Array) => { objetos.set(k, v); },
    },
  } as unknown as Env;
  return { env, exec };
}

beforeEach(() => {
  objetos = new Map();
  leituras = [];
  foraDoAr = new Set();
  esperas.length = 0;
  vi.stubGlobal('fetch', async (url: string) => {
    const u = decodeURIComponent(String(url));
    if (/oauth2\.googleapis\.com/.test(u)) return Response.json({ access_token: 'tok' });
    const doc = /\/spreadsheets\/([^/?:]+)/.exec(u)?.[1] ?? '';
    if (foraDoAr.has(doc)) return Response.json({ error: { message: 'indisponivel' } }, { status: 503 });
    leituras.push({ doc, query: u.split('?')[1] ?? '' });
    const formula = /FORMULA/.test(u);
    return Response.json({ values: [['NOME', 'DATA'], ['Ana', formula ? 46338 : '16/11/2026']] });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('dia e chave', () => {
  test('o dia vira as 03:00Z, nao a meia-noite UTC', () => {
    expect(diaSP(new Date('2026-11-16T02:59:00Z'))).toBe('2026-11-15');
    expect(diaSP(new Date('2026-11-16T03:00:00Z'))).toBe('2026-11-16');
  });

  test('chave por dia, id e cliente sem acento', () => {
    expect(chaveDoObjeto('2026-11-16', 4, 'Tainã Aci / Geral')).toBe('planilhas/2026-11-16/4-taina-aci-geral.json.gz');
  });

  test('gzip volta ao mesmo texto', async () => {
    const t = JSON.stringify({ nome: 'Jose', tel: '5511988880001', 'ç': 'ã' });
    const z = await gzip(t);
    expect(z[0]).toBe(0x1f);
    expect(await gunzip(z)).toBe(t);
  });
});

describe('rodarBackupPlanilhas', () => {
  test('antes de 01:00 em Sao Paulo nao faz nada', async () => {
    const { env } = cenario(`(1, 'A', 'DOC-A', 'Geral', 1)`);
    const r = await rodarBackupPlanilhas(env, new Date('2026-11-16T03:30:00Z'), { esperar });
    expect(r.rodou).toBe(false);
    expect(leituras).toEqual([]);
  });

  test('grava um objeto por planilha ativa, lido duas vezes, e fecha o dia', async () => {
    const { env } = cenario(`(1, 'Cliente A', 'DOC-A', 'Geral', 1), (2, 'Cliente B', 'DOC-B', 'Leads', 1), (3, 'Inativa', 'DOC-C', 'Geral', 0)`);
    const r = await rodarBackupPlanilhas(env, MANHA, { esperar });
    expect(r.rodou).toBe(true);
    expect([...objetos.keys()]).toEqual([
      'planilhas/2026-11-16/1-cliente-a.json.gz',
      'planilhas/2026-11-16/2-cliente-b.json.gz',
    ]);
    expect(leituras.map((l) => l.doc)).toEqual(['DOC-A', 'DOC-A', 'DOC-B', 'DOC-B']);
    expect(leituras[0]!.query).toContain('FORMATTED_VALUE');
    expect(leituras[1]!.query).toContain('valueRenderOption=FORMULA');
    expect(leituras[1]!.query).toContain('dateTimeRenderOption=SERIAL_NUMBER');
    expect(esperas.length).toBe(3);
    expect(esperas.every((ms) => ms >= 4000)).toBe(true);

    const j = JSON.parse(await gunzip(objetos.get('planilhas/2026-11-16/1-cliente-a.json.gz')!));
    expect(j).toMatchObject({ doc: 'DOC-A', aba: 'Geral', cliente: 'Cliente A', em: MANHA.toISOString() });
    expect(j.formatado[1]).toEqual(['Ana', '16/11/2026']);
    expect(j.bruto[1]).toEqual(['Ana', 46338]);

    const e = (await lerEstado(env.DB))!;
    expect(e).toMatchObject({ dia: '2026-11-16', concluido: true, arquivos: 2, erros: {} });
    expect(e.bytes).toBeGreaterThan(0);
  });

  test('o backup do dia ja saiu: pula sem ler nada', async () => {
    const { env } = cenario(`(1, 'A', 'DOC-A', 'Geral', 1)`);
    await rodarBackupPlanilhas(env, MANHA, { esperar });
    leituras.length = 0;
    const r = await rodarBackupPlanilhas(env, new Date(MANHA.getTime() + 60_000), { esperar });
    expect(r).toMatchObject({ rodou: false, motivo: 'ja saiu hoje' });
    expect(leituras).toEqual([]);
  });

  test('no dia seguinte, depois de 01:00, sai de novo', async () => {
    const { env } = cenario(`(1, 'A', 'DOC-A', 'Geral', 1)`);
    await rodarBackupPlanilhas(env, MANHA, { esperar });
    const r = await rodarBackupPlanilhas(env, new Date('2026-11-17T04:00:00Z'), { esperar });
    expect(r.rodou).toBe(true);
    expect([...objetos.keys()]).toContain('planilhas/2026-11-17/1-a.json.gz');
  });

  test('planilha com erro nao derruba as outras; a nova tentativa espera 30 min', async () => {
    const { env } = cenario(`(1, 'A', 'DOC-A', 'Geral', 1), (2, 'B', 'DOC-B', 'Geral', 1)`);
    foraDoAr.add('DOC-A');
    const r = await rodarBackupPlanilhas(env, MANHA, { esperar });
    expect(r.estado).toMatchObject({ concluido: false, arquivos: 1, feitas: [2] });
    expect(r.estado!.erros['1']).toMatchObject({ tentativas: 1 });
    expect([...objetos.keys()]).toEqual(['planilhas/2026-11-16/2-b.json.gz']);

    // um minuto depois: ainda esperando
    leituras.length = 0;
    const cedo = await rodarBackupPlanilhas(env, new Date(MANHA.getTime() + 60_000), { esperar });
    expect(cedo).toMatchObject({ rodou: false, motivo: 'esperando para tentar de novo' });
    expect(leituras).toEqual([]);

    // passados 30 min, com a planilha de volta: fecha o dia
    foraDoAr.clear();
    const tarde = await rodarBackupPlanilhas(env, new Date(MANHA.getTime() + ESPERA_APOS_FALHA_MS), { esperar });
    expect(tarde.estado).toMatchObject({ concluido: true, arquivos: 2, erros: {} });
  });

  test('planilha que nunca volta: o dia fecha com o erro depois de 4 tentativas', async () => {
    const { env } = cenario(`(1, 'A', 'DOC-A', 'Geral', 1)`);
    foraDoAr.add('DOC-A');
    let t = MANHA.getTime();
    for (let i = 0; i < 4; i++) {
      await rodarBackupPlanilhas(env, new Date(t), { esperar });
      t += ESPERA_APOS_FALHA_MS;
    }
    const fim = await rodarBackupPlanilhas(env, new Date(t), { esperar });
    expect(fim.estado).toMatchObject({ concluido: true, arquivos: 0 });
    expect(fim.estado!.erros['1']!.tentativas).toBe(4);
  });

  test('trava: duas execucoes juntas nao leem duas vezes', async () => {
    const { env, exec } = cenario(`(1, 'A', 'DOC-A', 'Geral', 1)`);
    exec(`INSERT INTO sequencia_estado (chave, valor) VALUES ('backup_trava', '2999-01-01T00:00:00.000Z')`);
    const r = await rodarBackupPlanilhas(env, MANHA, { esperar });
    expect(r).toMatchObject({ rodou: false, motivo: 'outra execucao em curso' });
    expect(leituras).toEqual([]);
  });

  test('lote: mais planilhas que o limite por execucao continuam na seguinte', async () => {
    const { env } = cenario([1, 2, 3, 4, 5].map((i) => `(${i}, 'C${i}', 'DOC-${i}', 'Geral', 1)`).join(', '));
    const a = await rodarBackupPlanilhas(env, MANHA, { esperar });
    expect(a.estado).toMatchObject({ concluido: false, arquivos: 3 });
    const b = await rodarBackupPlanilhas(env, new Date(MANHA.getTime() + 60_000), { esperar });
    expect(b.estado).toMatchObject({ concluido: true, arquivos: 5 });
  });
});
