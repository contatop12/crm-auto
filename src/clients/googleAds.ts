import type { Env } from '../env';
import { exigir } from '../domain/config';

/**
 * Cliente da Google Ads API.
 *
 * VERSAO v22. As anteriores (v16..v21) devolvem 404 HTML — os workflows n8n
 * ainda chamam v21 e por isso falham em silencio. Ver docs/api-reference.md.
 *
 * O access token dura 3600s e e' cacheado em KV com folga, para nao gastar uma
 * ida ao OAuth a cada checagem de saude.
 */

const V = 'v22';
const CACHE_TOKEN = 'gads:access_token';
const TTL_TOKEN = 3300; // 55min, com folga sobre os 60 reais

export interface ConversionAction {
  id: string;
  name: string;
  category: string;
  type: string;
  status: string;
  primaryForGoal: boolean;
}

export class GoogleAdsClient {
  constructor(
    private readonly env: Env,
    private readonly cache: KVNamespace,
  ) {}

  static fromEnv(env: Env): GoogleAdsClient {
    return new GoogleAdsClient(env, env.CACHE);
  }

  private async accessToken(): Promise<string> {
    const cacheado = await this.cache.get(CACHE_TOKEN);
    if (cacheado) return cacheado;

    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: exigir(this.env, 'GOOGLE_ADS_CLIENT_ID'),
        client_secret: exigir(this.env, 'GOOGLE_ADS_CLIENT_SECRET'),
        refresh_token: exigir(this.env, 'GOOGLE_ADS_REFRESH_TOKEN'),
        grant_type: 'refresh_token',
      }),
    });

    const j = (await r.json()) as { access_token?: string; error_description?: string };
    if (!j.access_token) {
      throw new Error(`OAuth do Google Ads falhou: ${j.error_description ?? 'sem access_token'}`);
    }

    await this.cache.put(CACHE_TOKEN, j.access_token, { expirationTtl: TTL_TOKEN });
    return j.access_token;
  }

  /** Executa GAQL. `customerId` sem tracos. */
  async search<T = Record<string, unknown>>(customerId: string, query: string): Promise<T[]> {
    const token = await this.accessToken();
    const r = await fetch(`https://googleads.googleapis.com/${V}/customers/${customerId}/googleAds:search`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'developer-token': exigir(this.env, 'GOOGLE_ADS_DEVELOPER_TOKEN'),
        'login-customer-id': exigir(this.env, 'GOOGLE_ADS_MCC_ID'),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });

    const txt = await r.text();
    if (!r.ok) {
      // 404 devolve pagina HTML; cortar evita despejar o documento inteiro no log
      const corpo = txt.trimStart().startsWith('<') ? `(HTML ${r.status})` : txt.slice(0, 300);
      throw new Error(`Google Ads ${r.status}: ${corpo}`);
    }

    return ((JSON.parse(txt) as { results?: T[] }).results ?? []);
  }

  async conversionActions(customerId: string): Promise<ConversionAction[]> {
    const rows = await this.search<{ conversionAction: ConversionAction }>(
      customerId,
      `SELECT conversion_action.id, conversion_action.name, conversion_action.category,
              conversion_action.type, conversion_action.status, conversion_action.primary_for_goal
       FROM conversion_action WHERE conversion_action.status != 'REMOVED'`,
    );
    return rows.map((r) => r.conversionAction);
  }

  /** Contas nao-gerenciadoras sob o MCC. Alimenta o seletor do painel. */
  async contasDoMcc(): Promise<Array<{ id: string; nome: string }>> {
    const rows = await this.search<{
      customerClient: { id: string; descriptiveName?: string; manager?: boolean };
    }>(
      this.env.GOOGLE_ADS_MCC_ID,
      `SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager
       FROM customer_client WHERE customer_client.status = 'ENABLED'`,
    );
    return rows
      .filter((r) => !r.customerClient.manager)
      .map((r) => ({ id: r.customerClient.id, nome: r.customerClient.descriptiveName ?? '' }));
  }
}
