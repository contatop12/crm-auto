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

  /** POST generico na Google Ads API, para os endpoints de escrita. */
  async mutate<T>(caminho: string, corpo: unknown): Promise<T> {
    const token = await this.accessToken();
    const r = await fetch(`https://googleads.googleapis.com/${V}/${caminho}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'developer-token': exigir(this.env, 'GOOGLE_ADS_DEVELOPER_TOKEN'),
        'login-customer-id': exigir(this.env, 'GOOGLE_ADS_MCC_ID'),
        'content-type': 'application/json',
      },
      body: JSON.stringify(corpo),
    });

    const txt = await r.text();
    if (!r.ok) {
      const corpoErro = txt.trimStart().startsWith('<') ? `(HTML ${r.status})` : txt.slice(0, 500);
      throw new Error(`Google Ads ${r.status}: ${corpoErro}`);
    }
    return JSON.parse(txt) as T;
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

  /**
   * Nome das campanhas a partir dos IDs, com cache em KV.
   *
   * A UTM que chega do Google traz `{campaignname}` quando o modelo de URL do
   * anuncio nao foi preenchido — o unico dado util e' o `utm_id`, que carrega o
   * ID numerico. O nome sai daqui.
   *
   * Nome de campanha quase nao muda e a consulta e' cara, entao fica 24h em KV.
   * Campanha removida continua respondendo: o clique dela e' historico e o card
   * precisa do nome mesmo assim.
   */
  async nomesDeCampanha(customerId: string, ids: string[]): Promise<Map<string, string>> {
    const saida = new Map<string, string>();
    const faltando: string[] = [];

    for (const id of [...new Set(ids.filter((i) => /^\d+$/.test(i)))]) {
      const cache = await this.env.CACHE.get(`campanha:${customerId}:${id}`);
      if (cache) saida.set(id, cache);
      else faltando.push(id);
    }
    if (!faltando.length) return saida;

    const rows = await this.search<{ campaign: { id: string; name: string } }>(
      customerId,
      `SELECT campaign.id, campaign.name FROM campaign
       WHERE campaign.id IN (${faltando.join(',')})`,
    );
    for (const r of rows) {
      saida.set(String(r.campaign.id), r.campaign.name);
      await this.env.CACHE.put(`campanha:${customerId}:${r.campaign.id}`, r.campaign.name, {
        expirationTtl: 86_400,
      });
    }
    return saida;
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

export interface CriarMeta {
  nome: string;
  categoria: string;
  /** null = a conversao carrega o valor real; o Google nao usa valor padrao. */
  valor: number | null;
  primary: boolean;
  contagem: string;
  janelaClique: number;
  janelaView: number;
}

/**
 * Cria acoes de conversao offline (`UPLOAD_CLICKS`) na conta do cliente.
 *
 * `validateOnly` deixa o Google conferir tudo sem gravar nada — e' o que a tela
 * de pre-visualizacao usa antes de publicar.
 */
export async function criarConversionActions(
  cli: GoogleAdsClient,
  customerId: string,
  metas: CriarMeta[],
  validateOnly = false,
): Promise<Array<{ nome: string; id: string | null; erro: string | null }>> {
  const operations = metas.map((m) => ({
    create: {
      name: m.nome,
      category: m.categoria,
      type: 'UPLOAD_CLICKS',
      status: 'ENABLED',
      primaryForGoal: m.primary,
      countingType: m.contagem,
      clickThroughLookbackWindowDays: m.janelaClique,
      viewThroughLookbackWindowDays: m.janelaView,
      valueSettings:
        m.valor === null
          ? { alwaysUseDefaultValue: false }
          : { defaultValue: m.valor, alwaysUseDefaultValue: true },
    },
  }));

  const resp = await cli.mutate<{ results?: Array<{ resourceName: string }> }>(
    `customers/${customerId}/conversionActions:mutate`,
    { operations, validateOnly, partialFailure: false },
  );

  const ids = (resp.results ?? []).map((r) => r.resourceName.split('/').pop() ?? null);
  return metas.map((m, i) => ({ nome: m.nome, id: ids[i] ?? null, erro: null }));
}
