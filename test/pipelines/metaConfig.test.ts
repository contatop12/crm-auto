import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { fakeD1 } from '../helpers/fakeD1';
import {
  lerConfigMeta, salvarConfigMeta, verificarConfigMeta, etapasMeta, salvarEventosDasEtapas, listarEventosMeta,
} from '../../src/pipelines/metaConfig';
import type { Env } from '../../src/env';

const MK = 'chave-mestra-de-teste';
const TOKEN = 'EAABsbCS1iHgBO-token-de-teste-9876';

function cenario() {
  const { d1, exec, consultar } = fakeD1();
  exec(`INSERT INTO tenants (id, slug, nome) VALUES (5, 'taina', 'Taina')`);
  exec(`INSERT INTO tenant_config (tenant_id, cw_account_id, cw_board_funil_id, ingest_key) VALUES (5, 3, 9, 'k')`);
  for (const [pos, nome, step] of [[1, 'Novo Lead', 22], [2, 'Qualificando', 23], [6, 'Oportunidade Ganha', 33]] as const) {
    exec(`INSERT INTO funnel_stages (tenant_id, posicao, nome, cw_step_id) VALUES (5, ${pos}, '${nome}', ${step})`);
  }
  const env = { DB: d1, MASTER_KEY: MK } as unknown as Env;
  return { env, exec, consultar };
}

let respostas: Array<() => Response>;
beforeEach(() => {
  respostas = [];
  vi.stubGlobal('fetch', async () => {
    const r = respostas.shift();
    if (!r) throw new Error('resposta nao programada');
    return r();
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('cadastro da Meta', () => {
  test('o token entra cifrado e nunca sai: a tela ve so os 4 ultimos', async () => {
    const { env, consultar } = cenario();
    expect(await salvarConfigMeta(env, 5, { meta_dataset_id: '1234567890', meta_page_id: '102345678901234', token: TOKEN }))
      .toEqual({ ok: true });

    const cfg = await lerConfigMeta(env.DB, 5);
    expect(cfg).toEqual({
      meta_dataset_id: '1234567890', meta_page_id: '102345678901234', meta_waba_id: null, meta_test_event_code: null,
      token_last4: '9876', tem_token: true, token_valido: false, token_conferido_em: null, envio_ligado: false,
    });
    const [linha] = consultar<{ meta_token_cipher: string }>('SELECT meta_token_cipher FROM tenant_config');
    expect(linha!.meta_token_cipher).not.toContain('token-de-teste');
    expect(JSON.stringify(cfg)).not.toContain('token-de-teste');
  });

  test('id com letra e codigo de teste fora do formato sao recusados', async () => {
    const { env } = cenario();
    expect(await salvarConfigMeta(env, 5, { meta_dataset_id: 'abc123' })).toMatchObject({ ok: false });
    expect(await salvarConfigMeta(env, 5, { meta_test_event_code: 'teste' })).toMatchObject({ ok: false });
    expect(await salvarConfigMeta(env, 5, { token: 'curto' })).toMatchObject({ ok: false });
  });

  test('ligar o envio exige dataset e token', async () => {
    const { env } = cenario();
    expect(await salvarConfigMeta(env, 5, { envio_ligado: true })).toMatchObject({ ok: false });
    await salvarConfigMeta(env, 5, { meta_dataset_id: '1234567890', token: TOKEN });
    expect(await salvarConfigMeta(env, 5, { envio_ligado: true })).toEqual({ ok: true });
    expect((await lerConfigMeta(env.DB, 5))!.envio_ligado).toBe(true);
    await salvarConfigMeta(env, 5, { envio_ligado: false });
    expect((await lerConfigMeta(env.DB, 5))!.envio_ligado).toBe(false);
  });

  test('token novo zera a verificacao', async () => {
    const { env, exec } = cenario();
    await salvarConfigMeta(env, 5, { meta_dataset_id: '1234567890', token: TOKEN });
    exec(`UPDATE tenant_config SET meta_token_valido = 1`);
    await salvarConfigMeta(env, 5, { token: TOKEN.replace('9876', '1111') });
    expect((await lerConfigMeta(env.DB, 5))).toMatchObject({ token_valido: false, token_last4: '1111' });
  });

  test('verificar: token que le o dataset fica valido', async () => {
    const { env } = cenario();
    await salvarConfigMeta(env, 5, { meta_dataset_id: '1234567890', token: TOKEN });
    respostas.push(() => Response.json({ id: '1234567890', name: 'Pixel Tainã' }));
    expect(await verificarConfigMeta(env, 5)).toMatchObject({ ok: true, datasetNome: 'Pixel Tainã' });
    expect((await lerConfigMeta(env.DB, 5))!.token_valido).toBe(true);
  });

  test('verificar sem token nem chama a Meta', async () => {
    const { env } = cenario();
    expect(await verificarConfigMeta(env, 5)).toMatchObject({ ok: false });
  });
});

describe('eventos por etapa', () => {
  test('salva e limpa o evento de cada etapa', async () => {
    const { env } = cenario();
    expect(await salvarEventosDasEtapas(env.DB, 5, { 22: 'LeadSubmitted', 33: 'Purchase' }))
      .toEqual({ ok: true, alteradas: 2 });
    expect((await etapasMeta(env.DB, 5)).map((e) => [e.nome, e.meta_evento])).toEqual([
      ['Novo Lead', 'LeadSubmitted'], ['Qualificando', null], ['Oportunidade Ganha', 'Purchase'],
    ]);
    await salvarEventosDasEtapas(env.DB, 5, { 33: null });
    expect((await etapasMeta(env.DB, 5))[2]!.meta_evento).toBeNull();
  });

  test('evento que a campanha de mensagem nao aceita e recusado', async () => {
    const { env } = cenario();
    expect(await salvarEventosDasEtapas(env.DB, 5, { 22: 'Lead' })).toMatchObject({ ok: false });
  });

  test('o mesmo evento em duas etapas e recusado: a Meta recebe um por lead', async () => {
    const { env } = cenario();
    expect(await salvarEventosDasEtapas(env.DB, 5, { 22: 'Purchase', 33: 'Purchase' })).toMatchObject({ ok: false });
  });

  test('etapa fora do funil e recusada', async () => {
    const { env } = cenario();
    expect(await salvarEventosDasEtapas(env.DB, 5, { 99: 'Purchase' })).toMatchObject({ ok: false });
  });
});

describe('eventos enviados', () => {
  test('lista com telefone mascarado e o resumo por status', async () => {
    const { env, exec } = cenario();
    exec(`INSERT INTO meta_eventos (tenant_id, dedupe_key, event_id, protocol, phone_key, canal, event_name, status, value, event_at)
          VALUES (5, 'A-LeadSubmitted', 'A-LeadSubmitted', 'A', '7191065853', 'whatsapp', 'LeadSubmitted', 'enviado', 10, '2026-09-22T10:00:00Z'),
                 (5, 'B-LeadSubmitted', 'B-LeadSubmitted', 'B', '7191065854', 'whatsapp', 'LeadSubmitted', 'falhou', NULL, '2026-09-22T10:00:00Z')`);
    const r = await listarEventosMeta(env.DB, 5, 25, 0);
    expect(r.total).toBe(2);
    expect(r.resumo).toEqual({ enviados: 1, ensaios: 0, falhas: 1, pendentes: 0 });
    expect(JSON.stringify(r.linhas)).not.toContain('7191065853');
    expect(r.linhas[0]!.telefone).toMatch(/^71\*+5[34]$/);
  });
});
