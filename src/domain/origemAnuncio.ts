/**
 * A plataforma de onde o lead veio, para a coluna ORIGEM da planilha de leads:
 * google, facebook, instagram, meta, gpt, outro — ou vazio, sem evidencia.
 *
 * "Canal" continua dizendo o TIPO de entrada ("Campanha de Mensagem - Google",
 * "Campanha de Formulario - Direto") e e' lido pelos fluxos de aviso; ORIGEM
 * diz so' a plataforma, normalizada, para o time filtrar e contar.
 *
 * `meta` fica quando se sabe que veio da Meta mas nao de qual rede (o lead da
 * campanha de mensagem sem o link do anuncio).
 */

export type OrigemAnuncio = 'google' | 'facebook' | 'instagram' | 'meta' | 'gpt' | 'outro' | '';

export interface SinaisDeOrigem {
  utm_source?: string | null;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  fbc?: string | null;
  referrer?: string | null;
}

function normalizar(s: string | null | undefined): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function hostDo(url: string | null | undefined): string {
  try {
    return new URL(String(url ?? '')).host.toLowerCase();
  } catch {
    return '';
  }
}

/** Dominios proprios dos clientes: referrer de la' e' navegacao interna, nao origem. */
const PROPRIOS = /(persianaspaulista|locadoraexatidao|vitaaudio|tileservicos|tainaaci)\./;

/**
 * Pelos sinais do clique. A UTM e o click id vencem o referrer: dizem de qual
 * anuncio; o referrer sozinho so' diz de que site a pessoa veio (busca
 * organica do Google, por exemplo).
 */
export function origemDoAnuncio(s: SinaisDeOrigem): OrigemAnuncio {
  const fonte = normalizar(s.utm_source);
  const ref = hostDo(s.referrer);
  if (/chatgpt|openai|\bgpt\b/.test(fonte) || /chatgpt\.com|openai\.com/.test(ref)) return 'gpt';
  if (s.gclid || s.gbraid || s.wbraid || /google|adwords|gads/.test(fonte)) return 'google';
  if (/instagram|^ig$/.test(fonte) || /instagram\.com/.test(ref)) return 'instagram';
  if (/facebook|^fb$/.test(fonte) || s.fbc || /facebook\.com|fb\.me/.test(ref)) return 'facebook';
  if (fonte === 'meta') return 'meta';
  if (fonte) return 'outro';
  if (/google\./.test(ref)) return 'google';
  if (ref && !PROPRIOS.test(ref)) return 'outro';
  return '';
}

/**
 * O codigo de plataforma que os fluxos de formulario ja' escrevem na linha
 * ("google", "fb", "ig", "chatgpt.com"). Rotulo composto ("Campanha de
 * Mensagem - Google") nao conta: o fluxo antigo punha isso em todo lead.
 */
export function codigoDePlataforma(texto: string | null | undefined): OrigemAnuncio {
  const x = normalizar(texto);
  if (!x) return '';
  if (/^(google|google_ads|adwords)$/.test(x)) return 'google';
  if (/^(fb|facebook)$/.test(x)) return 'facebook';
  if (/^(ig|instagram)$/.test(x)) return 'instagram';
  if (x === 'meta') return 'meta';
  if (/chatgpt|gpt|openai/.test(x)) return 'gpt';
  if (/^(bing|tiktok|youtube|linkedin|outro)$/.test(x)) return 'outro';
  return '';
}
