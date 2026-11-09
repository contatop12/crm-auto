import { describe, test, expect } from 'vitest';
import worker from '../../src/index';
import { fakeD1 } from '../helpers/fakeD1';
import type { Env } from '../../src/env';

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const pedir = (env: Env, metodo: string, caminho: string, corpo?: unknown) =>
  worker.fetch(
    new Request(`https://crm.teste${caminho}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    }),
    env,
    ctx,
  );

const ambiente = () => {
  const f = fakeD1();
  const env = { DB: f.d1, PANEL_PUBLIC: 'true', GOOGLE_ADS_MCC_ID: '3780611396' } as unknown as Env;
  f.exec(`INSERT INTO tenants (id, slug, nome, ativo) VALUES (1, 'locadora', 'Locadora', 1)`);
  return { ...f, env };
};

type Lista = { frases: Array<{ id: number; frase: string; plataforma: string }>; leads_30d: number };

describe('mensagem pronta do anuncio no painel', () => {
  test('cliente novo ja nasce com a mensagem da extensao do Google', async () => {
    const { env } = ambiente();
    const r = await pedir(env, 'POST', '/api/tenants', {
      nome: 'Cliente Novo', slug: '', cw_account_id: '9', cw_board_funil_id: '20', cw_board_organico_id: '21',
      ga_customer_id: '1234567890', evo_instancia: 'novo', pulseboard_url: '',
    });
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as { id: number };
    const l = (await (await pedir(env, 'GET', `/api/tenants/${id}/frases-entrada`)).json()) as Lista;
    expect(l.frases.map((f) => [f.frase, f.plataforma])).toEqual([['Olá, vim pelo anúncio do Google!', 'google']]);
  });

  test('cadastra, lista com os leads de 30 dias e remove', async () => {
    const { env, exec } = ambiente();
    exec(`INSERT INTO leads (tenant_id, protocol, origem, evento) VALUES (1, 'LOC-MSG-1', 'mensagem', 'frase_entrada')`);

    const r = await pedir(env, 'POST', '/api/tenants/1/frases-entrada', { frase: 'Olá! Vi o anúncio no Instagram', plataforma: 'meta' });
    expect(r.status).toBe(201);
    const l = (await (await pedir(env, 'GET', '/api/tenants/1/frases-entrada')).json()) as Lista;
    expect(l.frases).toHaveLength(1);
    expect(l.frases[0]).toMatchObject({ frase: 'Olá! Vi o anúncio no Instagram', plataforma: 'meta' });
    expect(l.leads_30d).toBe(1);

    expect((await pedir(env, 'DELETE', `/api/tenants/1/frases-entrada/${l.frases[0]!.id}`)).status).toBe(200);
    expect((await pedir(env, 'DELETE', `/api/tenants/1/frases-entrada/${l.frases[0]!.id}`)).status).toBe(404);
  });

  test('recusa repetida, curta e de outro cliente', async () => {
    const { env, exec } = ambiente();
    exec(`INSERT INTO tenants (id, slug, nome, ativo) VALUES (2, 'tile', 'Tile', 1)`);
    exec(`INSERT INTO lead_entry_phrases (id, tenant_id, frase, origem, plataforma) VALUES (7, 2, 'Olá, vim pelo anúncio do Google!', 'mensagem', 'google')`);
    exec(`INSERT INTO lead_entry_phrases (tenant_id, frase, origem, plataforma) VALUES (1, 'Olá, vim pelo anúncio do Google!', 'mensagem', 'google')`);

    expect((await pedir(env, 'POST', '/api/tenants/1/frases-entrada', { frase: 'ola vim pelo anuncio do google!', plataforma: 'google' })).status).toBe(409);
    expect((await pedir(env, 'POST', '/api/tenants/1/frases-entrada', { frase: 'oi', plataforma: 'google' })).status).toBe(400);
    // a frase do outro cliente nao some pela rota deste
    expect((await pedir(env, 'DELETE', '/api/tenants/1/frases-entrada/7')).status).toBe(404);
  });
});
