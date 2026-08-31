/** Bindings e segredos do Worker. Espelha `wrangler.jsonc` + `wrangler secret put`. */
export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  QUEUE: Queue<QueueMessage>;
  ASSETS: Fetcher;

  ENVIRONMENT: string;

  // Chatwoot — credencial GLOBAL, atende todas as contas
  CHATWOOT_BASE_URL: string;
  CHATWOOT_API_TOKEN: string;

  // Google Ads
  GOOGLE_ADS_CLIENT_ID: string;
  GOOGLE_ADS_CLIENT_SECRET: string;
  GOOGLE_ADS_REFRESH_TOKEN: string;
  GOOGLE_ADS_DEVELOPER_TOKEN: string;
  GOOGLE_ADS_MCC_ID: string;

  // Evolution (WhatsApp)
  EVOLUTION_SERVER_URL: string;
  EVOLUTION_API_KEY: string;
  EVOLUTION_ALERT_INSTANCE: string;
  EVOLUTION_ALERT_GROUP_ID: string;

  // Cloudflare Access — auth do painel.
  // CF_ACCESS_AUD aceita lista separada por virgula: um app do Access por
  // hostname, cada um com seu proprio aud.
  CF_ACCESS_TEAM_DOMAIN: string;
  CF_ACCESS_AUD: string;

  /** "true" desliga a verificacao do Access e deixa o painel ABERTO. */
  PANEL_PUBLIC?: string;
}

/** Mensagem enfileirada pelas rotas de ingestao e consumida pelos pipelines. */
export interface QueueMessage {
  /** Id da linha em `events`. O payload cru fica no banco, nao na fila. */
  eventId: number;
  tenantId: number;
  source: 'click' | 'chatwoot' | 'kanban';
  eventType: string;
}
