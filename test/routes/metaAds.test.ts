import { describe, test, expect } from 'vitest';
import worker from '../../src/index';
import { fakeD1 } from '../helpers/fakeD1';
import type { Env } from '../../src/env';

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const pedir = (env: Env, caminho: string) => worker.fetch(new Request(`https://crm.teste${caminho}`), env, ctx);

describe('rotas da Meta Ads no painel', () => {
  test('ficam atras do Access', async () => {
    const { d1 } = fakeD1();
    const env = { DB: d1, CF_ACCESS_TEAM_DOMAIN: 'p12.cloudflareaccess.com', CF_ACCESS_AUD: 'aud' } as unknown as Env;
    expect((await pedir(env, '/api/tenants/5/evolution/webhook')).status).toBe(401);
  });

  test('estao montadas: cliente sem instancia responde lista vazia', async () => {
    const { d1, exec } = fakeD1();
    exec(`INSERT INTO tenants (id, slug, nome) VALUES (5, 'taina', 'Taina')`);
    const env = { DB: d1, PANEL_PUBLIC: 'true' } as unknown as Env;
    const r = await pedir(env, '/api/tenants/5/evolution/webhook');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ instancias: [] });
  });
});
