import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { fakeD1 } from '../helpers/fakeD1';
import { espelharEtapaNaGeral } from '../../src/pipelines/etapaPlanilha';
import type { Env } from '../../src/env';

/**
 * Vita, 22/09: a etapa do card no Kanban aparece na coluna Status da aba
 * Geral, na linha do telefone do lead. So' a Geral; so' o board do funil.
 */

const CAB = ['URL WHATSAPP', 'Canal', 'SEQUENCIA', 'DATA', 'HORA', 'NOME', 'TELEFONE', 'Pagina', 'Status'];
const MARCIA = ['https://wa.me/5542999003333', 'Campanha de Mensagem - Google', '13SET', '17/09/2026', '09:29:57', 'Marcia', '5542999003333', '/x', ''];
const FABIANA = ['https://wa.me/11947001173', 'Campanha de Mensagem - Google', '01SET', '01/09/2026', '13:22:54', 'Fabiana', '11947001173', '', 'Novo Lead'];

function cenario() {
  const { d1, exec } = fakeD1();
  exec(`INSERT INTO tenants (id, slug, nome, ativo) VALUES (3, 'vita', 'Vita Audio', 1)`);
  exec(`INSERT INTO tenant_config (tenant_id, cw_account_id, cw_board_funil_id, cw_board_organico_id, ingest_key,
          sheets_ativo, planilha_modo, sheets_leads_doc_id, sheets_aba_geral, sheets_status_etapa)
        VALUES (3, 2, 7, 8, 'k', 1, 'sistema', 'DOC-LEADS', 'Geral', 1)`);
  exec(`INSERT INTO credenciais (chave, valor) VALUES ('datamanager_refresh_token', 'rt')`);
  exec(`INSERT INTO credenciais (chave, valor) VALUES ('gtm_refresh_token', 'rt')`);
  exec(`INSERT INTO funnel_stages (tenant_id, posicao, nome, cw_step_id) VALUES (3, 1, 'Novo Lead', 27)`);
  exec(`INSERT INTO funnel_stages (tenant_id, posicao, nome, cw_step_id) VALUES (3, 2, 'Qualificando', 28)`);
  exec(`INSERT INTO funnel_stages (tenant_id, posicao, nome, cw_step_id) VALUES (3, 3, 'Agendamento Realizado', 29)`);
  exec(`INSERT INTO leads (tenant_id, protocol, nome, phone_e164) VALUES (3, 'VITA-MARCIA', 'Marcia', '+5542999003333')`);
  const env = {
    DB: d1,
    CACHE: { get: async () => null, put: async () => undefined },
    CHATWOOT_BASE_URL: 'https://cw.teste',
    CHATWOOT_API_TOKEN: 't',
    GOOGLE_ADS_CLIENT_ID: 'x',
    GOOGLE_ADS_CLIENT_SECRET: 'x',
    GOOGLE_ADS_REFRESH_TOKEN: 'x',
  } as unknown as Env;
  return { env, exec };
}

function card(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: 2103,
    board_id: 7,
    board_step_id: 29,
    board_step: { id: 29, name: 'Agendamento Realizado' },
    title: 'Conversa #94 - Marcia',
    custom_attributes: { protocolo: 'VITA-MARCIA' },
    conversations: [{ id: 2204, display_id: 94 }],
    contacts: [{ name: 'Marcia', phone_number: '+5542999003333' }],
    ...over,
  });
}

let geral: string[][];
let gravadas: Array<{ range: string; valor: string }>;

beforeEach(() => {
  geral = [CAB, MARCIA, FABIANA];
  gravadas = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const u = decodeURIComponent(String(url));
    if (/oauth2\.googleapis\.com/.test(u)) return Response.json({ access_token: 'tok' });
    if (/cw\.teste/.test(u)) return Response.json({});
    if (/values:batchUpdate/.test(u)) {
      const b = JSON.parse(String(init.body)) as { data: Array<{ range: string; values: string[][] }> };
      for (const d of b.data) gravadas.push({ range: d.range, valor: d.values[0]![0]! });
      return Response.json({ totalUpdatedCells: b.data.length });
    }
    const aba = u.match(/\/values\/'([^']+)'!/)?.[1];
    if (aba === 'Geral') return Response.json({ values: geral });
    return Response.json({ error: { message: 'aba nao existe' } }, { status: 400 });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('espelharEtapaNaGeral', () => {
  test('grava o nome da etapa na coluna Status da linha do telefone', async () => {
    const { env } = cenario();
    const r = await espelharEtapaNaGeral(env, 3, card());
    expect(r.status).toBe('ok');
    // Marcia e' a primeira linha de dados: linha 2 da aba; Status e' a coluna I
    expect(gravadas).toEqual([{ range: "'Geral'!I2", valor: 'Agendamento Realizado' }]);
  });

  test('o nome vem das etapas sincronizadas, nao do payload', async () => {
    const { env, exec } = cenario();
    exec(`UPDATE funnel_stages SET nome = 'Agendou' WHERE cw_step_id = 29`);
    await espelharEtapaNaGeral(env, 3, card());
    expect(gravadas[0]!.valor).toBe('Agendou');
  });

  test('etapa que o funil nao conhece usa o nome que veio no card', async () => {
    const { env } = cenario();
    await espelharEtapaNaGeral(env, 3, card({ board_step_id: 99, board_step: { id: 99, name: 'Etapa Nova' } }));
    expect(gravadas[0]!.valor).toBe('Etapa Nova');
  });

  test('casa o telefone antigo sem o 55 e sem o nono digito', async () => {
    const { env } = cenario();
    await espelharEtapaNaGeral(env, 3, card({
      custom_attributes: {}, contacts: [{ name: 'Fabiana', phone_number: '+5511947001173' }], board_step_id: 28,
    }));
    expect(gravadas).toEqual([{ range: "'Geral'!I3", valor: 'Qualificando' }]);
  });

  test('sem telefone no card, usa o do lead pelo protocolo', async () => {
    const { env } = cenario();
    await espelharEtapaNaGeral(env, 3, card({ contacts: [] }));
    expect(gravadas[0]!.range).toBe("'Geral'!I2");
  });

  test('nao regrava quando o Status ja e a etapa', async () => {
    const { env } = cenario();
    const r = await espelharEtapaNaGeral(env, 3, card({
      custom_attributes: {}, contacts: [{ name: 'Fabiana', phone_number: '+5511947001173' }], board_step_id: 27,
    }));
    expect(r.status).toBe('ignorado');
    expect(gravadas).toHaveLength(0);
  });

  test('card do board Organico escreve a etapa dele: o lead nunca promovido tambem tem status', async () => {
    const { env } = cenario();
    const r = await espelharEtapaNaGeral(env, 3, card({ board_id: 8, board_step_id: 33, board_step: { id: 33, name: 'Orgânico' } }));
    expect(r.status).toBe('ok');
    expect(gravadas).toEqual([{ range: "'Geral'!I2", valor: 'Orgânico' }]);
  });

  test('card do Organico nao sobrescreve o Status que o time preencheu', async () => {
    const { env } = cenario();
    const r = await espelharEtapaNaGeral(env, 3, card({
      board_id: 8, board_step_id: 33, board_step: { id: 33, name: 'Orgânico' },
      custom_attributes: {}, contacts: [{ name: 'Fabiana', phone_number: '+5511947001173' }],
    }));
    expect(r.status).toBe('ignorado');
    expect(r.motivo).toContain('nao sobrescreve');
    expect(gravadas).toHaveLength(0);
  });

  test('card de um board que nao e o funil nem o Organico nao mexe na planilha', async () => {
    const { env } = cenario();
    const r = await espelharEtapaNaGeral(env, 3, card({ board_id: 99 }));
    expect(r.status).toBe('ignorado');
    expect(r.motivo).toContain('board');
    expect(gravadas).toHaveLength(0);
  });

  test('cliente com o espelho desligado nao escreve', async () => {
    const { env, exec } = cenario();
    exec(`UPDATE tenant_config SET sheets_status_etapa = 0 WHERE tenant_id = 3`);
    const r = await espelharEtapaNaGeral(env, 3, card());
    expect(r.status).toBe('ignorado');
    expect(gravadas).toHaveLength(0);
  });

  test('telefone que nao esta na Geral: ignorado, com o motivo', async () => {
    const { env } = cenario();
    const r = await espelharEtapaNaGeral(env, 3, card({
      custom_attributes: {}, contacts: [{ name: 'X', phone_number: '+5511900000000' }],
    }));
    expect(r.status).toBe('ignorado');
    expect(r.motivo).toContain('nao esta na aba');
    expect(gravadas).toHaveLength(0);
  });

  test('Geral sem coluna Status e erro de cadastro, sem retentativa', async () => {
    const { env } = cenario();
    geral = [CAB.slice(0, 8), MARCIA.slice(0, 8)];
    const r = await espelharEtapaNaGeral(env, 3, card());
    expect(r.status).toBe('erro');
    expect(r.retentar).toBe(false);
    expect(gravadas).toHaveLength(0);
  });
});
