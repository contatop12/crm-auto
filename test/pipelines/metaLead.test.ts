import { describe, test, expect } from 'vitest';
import { fakeD1 } from '../helpers/fakeD1';
import { registrarLeadMeta } from '../../src/pipelines/metaLead';
import type { Env } from '../../src/env';

function cenario() {
  const { d1, exec, consultar } = fakeD1();
  exec(`INSERT INTO tenants (id, slug, nome, ativo) VALUES (1, 'persianas', 'Persianas', 1)`);
  exec(`INSERT INTO tenant_config (tenant_id, cw_account_id, cw_board_funil_id, ingest_key, gtm_prefixo)
        VALUES (1, 7, 13, 'k', 'PERSI')`);
  return { env: { DB: d1 } as unknown as Env, consultar };
}

/** Formato do "Watch Leads" do Make, com dados ficticios. */
const make = (over: Record<string, unknown> = {}) => JSON.stringify({
  platform: 'ig',
  leadgenId: '1234567890123427',
  campaignName: '[P12] [LEAD] FORM',
  data: { phone: '+5511912345678', full_name: 'Maria Exemplo' },
  ...over,
});

const fonte = (consultar: ReturnType<typeof cenario>['consultar']) =>
  consultar<{ utm_source: string }>(`SELECT utm_source FROM leads WHERE protocol = 'PERSI-META-1234567890123427'`)[0]!.utm_source;

describe('registrarLeadMeta — rede do anuncio', () => {
  // a rede em `utm_source` e' o que vira a etiqueta (instagram/facebook) e a ORIGEM
  test('lead do Instagram fica com utm_source instagram', async () => {
    const { env, consultar } = cenario();
    await registrarLeadMeta(env, 1, make());
    expect(fonte(consultar)).toBe('instagram');
  });

  test('lead do Facebook fica com utm_source facebook', async () => {
    const { env, consultar } = cenario();
    await registrarLeadMeta(env, 1, make({ platform: 'fb' }));
    expect(fonte(consultar)).toBe('facebook');
  });

  test('sem rede conhecida continua meta', async () => {
    const { env, consultar } = cenario();
    await registrarLeadMeta(env, 1, make({ platform: undefined }));
    expect(fonte(consultar)).toBe('meta');
  });

  test('reenvio do mesmo lead com a rede corrige o que tinha ficado meta', async () => {
    const { env, consultar } = cenario();
    await registrarLeadMeta(env, 1, make({ platform: undefined }));
    await registrarLeadMeta(env, 1, make());
    expect(fonte(consultar)).toBe('instagram');
  });

  test('reenvio sem a rede nao apaga a que ja estava', async () => {
    const { env, consultar } = cenario();
    await registrarLeadMeta(env, 1, make());
    await registrarLeadMeta(env, 1, make({ platform: undefined }));
    expect(fonte(consultar)).toBe('instagram');
  });
});
