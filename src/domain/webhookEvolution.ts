/**
 * O webhook de uma instancia da Evolution, visto pelo CRM.
 *
 * A Evolution aceita UM webhook por instancia. Apontar para o CRM desliga quem
 * estava la' antes (hoje, o whatsapp-track da Taina) — por isso o painel
 * pergunta antes e guarda o anterior para a volta atras.
 *
 * O endereco de outro sistema pode carregar o segredo dele na URL. Para a tela
 * sai so' o host.
 */

/** Como o `/webhook/find` devolve (Evolution v2). */
export interface WebhookEvo {
  url?: string;
  enabled?: boolean;
  events?: string[];
  webhookByEvents?: boolean;
  webhookBase64?: boolean;
  headers?: Record<string, string> | null;
  [campo: string]: unknown;
}

/** Corpo do `/webhook/set`, dentro de `{ webhook: ... }`. */
export interface DefinicaoWebhook {
  enabled: boolean;
  url: string;
  events: string[];
  byEvents: boolean;
  base64: boolean;
  headers?: Record<string, string>;
}

export type EstadoWebhook = 'crm' | 'outro' | 'nenhum' | 'desconhecido';

/** So' a mensagem nova interessa: e' nela que vem o cartao do anuncio. */
export const EVENTOS_DO_CRM = ['MESSAGES_UPSERT'];

export function urlDoCrm(origem: string, slug: string, chave: string): string {
  return `${origem.replace(/\/$/, '')}/ingest/${encodeURIComponent(slug)}/evolution?k=${encodeURIComponent(chave)}`;
}

export function hostDe(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

/**
 * O webhook aponta para o CRM deste cliente? Compara host e caminho, sem a
 * chave: depois de girar a chave ele ainda e' do CRM, so' desatualizado.
 * `undefined` = nao foi possivel ler.
 */
export function estadoDoWebhook(w: WebhookEvo | null | undefined, origem: string, slug: string): EstadoWebhook {
  if (w === undefined) return 'desconhecido';
  if (!w?.url) return 'nenhum';
  try {
    const u = new URL(w.url);
    const crm = new URL(origem);
    return u.host === crm.host && decodeURIComponent(u.pathname) === `/ingest/${slug}/evolution` ? 'crm' : 'outro';
  } catch {
    return 'outro';
  }
}

/** O webhook guardado, de volta no formato do `/webhook/set`. */
export function definicaoDeVolta(w: WebhookEvo): DefinicaoWebhook {
  const d: DefinicaoWebhook = {
    enabled: w.enabled !== false,
    url: String(w.url ?? ''),
    events: Array.isArray(w.events) ? w.events.map(String) : [],
    byEvents: w.webhookByEvents === true,
    base64: w.webhookBase64 === true,
  };
  if (w.headers && typeof w.headers === 'object' && Object.keys(w.headers).length) d.headers = w.headers;
  return d;
}
