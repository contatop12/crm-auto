import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { ADS_VERSAO, GoogleAdsClient, criarConversionActions } from '../../src/clients/googleAds';
import type { Env } from '../../src/env';

let urls: string[];

beforeEach(() => {
  urls = [];
  vi.stubGlobal('fetch', async (url: string) => {
    urls.push(String(url));
    return Response.json({ results: [{ resourceName: 'customers/5886565200/conversionActions/1' }] });
  });
});
afterEach(() => vi.unstubAllGlobals());

// Sem GOOGLE_SA_KEY o cliente usa o token do cache: nenhuma ida ao OAuth no teste.
const cliente = () =>
  GoogleAdsClient.fromEnv({
    CACHE: { get: async () => 'tok', put: async () => undefined },
    GOOGLE_ADS_DEVELOPER_TOKEN: 'dev',
    GOOGLE_ADS_MCC_ID: '3780611396',
  } as unknown as Env);

describe('versao da Google Ads API', () => {
  test('consultas e gravacoes vao para a versao fixada, que nao e mais a v22', async () => {
    // A v22 passou a recusar gravacao com UNSUPPORTED_VERSION em 20/10/2026.
    expect(ADS_VERSAO).toBe('v25');

    await cliente().conversionActions('5886565200');
    await criarConversionActions(cliente(), '5886565200', [{
      nome: 'CRM - Teste', categoria: 'QUALIFIED_LEAD', valor: 50, primary: false,
      contagem: 'ONE_PER_CLICK', janelaClique: 30, janelaView: 1,
    }], true);

    expect(urls).toEqual([
      'https://googleads.googleapis.com/v25/customers/5886565200/googleAds:search',
      'https://googleads.googleapis.com/v25/customers/5886565200/conversionActions:mutate',
    ]);
  });
});
