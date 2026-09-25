import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { fakeD1 } from '../helpers/fakeD1';
import { preencherOrigemNaGeral } from '../../src/pipelines/origemPlanilha';
import type { Env } from '../../src/env';

/**
 * A linha que o quiz/formulario escreve nasce sem ORIGEM; a passada de 15 min
 * preenche pelo clique do CRM ou pelo codigo que a linha ja' traz.
 */

const CAB = ['Canal de Anuncio', 'DATA', 'NOME', 'TELEFONE', 'ORIGEM'];

function cenario() {
  const { d1, exec } = fakeD1();
  exec(`INSERT INTO tenants (id, slug, nome, ativo) VALUES (2, 'persianas', 'Persianas', 1)`);
  exec(`INSERT INTO tenant_config (tenant_id, cw_account_id, cw_board_funil_id, cw_board_organico_id, ingest_key,
          sheets_ativo, planilha_modo, sheets_leads_doc_id, sheets_aba_geral)
        VALUES (2, 7, 13, 14, 'k', 1, 'sistema', 'DOC', 'Geral')`);
  exec(`INSERT INTO credenciais (chave, valor) VALUES ('datamanager_refresh_token', 'rt')`);
  exec(`INSERT INTO credenciais (chave, valor) VALUES ('gtm_refresh_token', 'rt')`);
  exec(`INSERT INTO leads (tenant_id, protocol, phone_key, phone_e164, gclid) VALUES (2, 'PERSI-1', '1199001122', '+5511999001122', 'Cj0')`);
  exec(`INSERT INTO leads (tenant_id, protocol, phone_key, phone_e164, utm_source) VALUES (2, 'PERSI-2', '1199003344', '+5511999003344', 'chatgpt.com')`);
  const env = {
    DB: d1,
    CACHE: { get: async () => null, put: async () => undefined },
    GOOGLE_ADS_CLIENT_ID: 'x', GOOGLE_ADS_CLIENT_SECRET: 'x', GOOGLE_ADS_REFRESH_TOKEN: 'x',
  } as unknown as Env;
  return { env };
}

let geral: string[][];
let gravadas: Array<{ range: string; valor: string }>;

beforeEach(() => {
  gravadas = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const u = decodeURIComponent(String(url));
    if (/oauth2\.googleapis\.com/.test(u)) return Response.json({ access_token: 'tok' });
    if (/values:batchUpdate/.test(u)) {
      const b = JSON.parse(String(init.body)) as { data: Array<{ range: string; values: string[][] }> };
      for (const d of b.data) gravadas.push({ range: d.range, valor: d.values[0]![0]! });
      return Response.json({ totalUpdatedCells: b.data.length });
    }
    return Response.json({ values: geral });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('preencherOrigemNaGeral', () => {
  test('clique do CRM pelo telefone, codigo da linha como reserva, vazio sem evidencia', async () => {
    const { env } = cenario();
    geral = [
      CAB,
      ['', '01/09/2026', 'Ana', '5511999001122', ''],        // gclid no CRM -> google
      ['ig', '02/09/2026', 'Bia', '5511999005566', ''],      // sem clique; a linha diz ig
      ['', '03/09/2026', 'Cid', '5511999007788', ''],        // nada -> fica vazio
      ['', '04/09/2026', 'Dan', '5511999003344', 'google'],  // ja preenchida: nao mexe
      ['fb', '05/09/2026', 'Eva', '', ''],                   // sem telefone, mas a linha diz fb
    ];
    const r = await preencherOrigemNaGeral(env, 2, 'DOC', 'Geral');
    expect(r.gravadas).toBe(3);
    expect(gravadas).toEqual([
      { range: "'Geral'!E2", valor: 'google' },
      { range: "'Geral'!E3", valor: 'instagram' },
      { range: "'Geral'!E6", valor: 'facebook' },
    ]);
  });

  test('a utm do CRM vence o codigo da linha', async () => {
    const { env } = cenario();
    geral = [CAB, ['ig', '01/09/2026', 'Dan', '5511999003344', '']];
    await preencherOrigemNaGeral(env, 2, 'DOC', 'Geral');
    expect(gravadas).toEqual([{ range: "'Geral'!E2", valor: 'gpt' }]);
  });

  test('"meta" sem rede no clique perde para o ig/fb que a linha do quiz traz', async () => {
    const { env } = cenario();
    geral = [CAB, ['ig', '01/09/2026', 'Fred', '5511999009900', '']];
    await env.DB.prepare(`INSERT INTO leads (tenant_id, protocol, phone_key, phone_e164, utm_source) VALUES (2, 'PERSI-9', '1199009900', '+5511999009900', 'meta')`).run();
    await preencherOrigemNaGeral(env, 2, 'DOC', 'Geral');
    expect(gravadas).toEqual([{ range: "'Geral'!E2", valor: 'instagram' }]);
  });

  test('aba sem a coluna ORIGEM: nada a fazer, com o motivo', async () => {
    const { env } = cenario();
    geral = [['DATA', 'NOME', 'TELEFONE'], ['01/09/2026', 'Ana', '5511999001122']];
    const r = await preencherOrigemNaGeral(env, 2, 'DOC', 'Geral');
    expect(r.gravadas).toBe(0);
    expect(r.motivo).toContain('ORIGEM');
    expect(gravadas).toHaveLength(0);
  });
});
