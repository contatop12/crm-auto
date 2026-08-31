/**
 * Classificacao de origem do lead: plataforma, tipo de anuncio e campanha.
 *
 * Portado de `Montar GAQL Campanha` + `Classificar Campanha` do bloco
 * "Mensagem do Lead". Alimenta as etiquetas e os custom attributes da conversa.
 */

export type Plataforma = 'google' | 'meta' | 'outro';
export type Origem = 'mensagem' | 'formulario';

export interface SinaisAtribuicao {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmId?: string | null;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  fbc?: string | null;
  fbclid?: string | null;
  eventClick?: string | null;
  origemClick?: string | null;
  quizVersion?: string | null;
}

/**
 * Match por TOKEN INTEIRO, nunca por substring.
 *
 * A regra antiga (`/face|insta|meta|fb|ig/i`) casava com qualquer palavra que
 * contivesse "ig" — `utm_source=digital` marcava lead do Google como Meta.
 */
const RE_GOOGLE = /-(google|googleads|google-ads|adwords|gads|g-ads|youtube|yt|dsa|pmax)-/;
const RE_META = /-(meta|facebook|fb|instagram|ig|fb-ig|an|audience-network)-/;
const RE_FORM = /-(form|formulario|lead-form|lead-ad|leadgen)-/;

function tok(v: string | null | undefined): string {
  return String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/** true se algum dos valores contem o token procurado. */
function tem(re: RegExp, ...vals: Array<string | null | undefined>): boolean {
  return vals.some((v) => re.test('-' + tok(v) + '-'));
}

export function detectPlatform(s: SinaisAtribuicao): Plataforma {
  if (tem(RE_GOOGLE, s.utmSource)) return 'google';
  if (tem(RE_META, s.utmSource)) return 'meta';

  // P-Max e Demand Gen as vezes chegam sem utm_source
  if (s.gclid || s.gbraid || s.wbraid) return 'google';
  if (s.fbc || s.fbclid) return 'meta';

  if (tem(RE_GOOGLE, s.utmMedium, s.utmCampaign)) return 'google';
  if (tem(RE_META, s.utmMedium, s.utmCampaign)) return 'meta';

  return 'outro';
}

export function detectOrigin(s: SinaisAtribuicao): Origem {
  // quiz preenchido => veio do formulario, mesmo que o utm tenha se perdido
  if (s.quizVersion) return 'formulario';
  if (String(s.eventClick ?? '').toLowerCase() === 'form_submit') return 'formulario';
  if (String(s.origemClick ?? '').toLowerCase() === 'formulario') return 'formulario';
  if (tem(RE_FORM, s.utmMedium, s.utmContent)) return 'formulario';
  return 'mensagem';
}

/**
 * Id numerico da campanha, para consultar a Google Ads API.
 * So aceita `utm_id={campaignid}` de verdade — nome de campanha nao serve, e
 * um `{campaignid}` nao substituido tambem nao.
 */
export function campaignId(s: SinaisAtribuicao): string {
  const soId = (v: string | null | undefined) => {
    const x = String(v ?? '').trim();
    return /^\d{6,}$/.test(x) ? x : '';
  };
  return soId(s.utmId) || soId(s.utmCampaign);
}

const NOME_TIPO: Record<string, string> = {
  SEARCH: 'Search',
  DISPLAY: 'Display',
  SHOPPING: 'Shopping',
  VIDEO: 'Video',
  PERFORMANCE_MAX: 'Performance Max',
  DEMAND_GEN: 'Demand Gen',
  DISCOVERY: 'Demand Gen',
};

/** Slug ja no vocabulario de etiquetas. Tipo sem etiqueta sai vazio. */
const SLUG_TIPO: Record<string, string> = {
  SEARCH: 'search',
  DISPLAY: 'display',
  PERFORMANCE_MAX: 'p-max',
};

export interface ClassifyInput {
  /** `advertisingChannelType` devolvido pela Google Ads API. */
  enumTipo?: string | null;
  /** Nome da campanha devolvido pela API. */
  nome?: string | null;
  utmCampaign?: string | null;
  utmMedium?: string | null;
  plataforma: Plataforma;
}

export interface CampanhaClassificada {
  tipo: string;
  /** '' quando o tipo nao tem etiqueta no vocabulario. */
  slug: string;
}

export function classifyCampaign(i: ClassifyInput): CampanhaClassificada {
  const e = String(i.enumTipo ?? '');
  let tipo = NOME_TIPO[e] ?? '';
  let slug = SLUG_TIPO[e] ?? '';

  // Fallback pelo nome quando a API nao respondeu. So vale para lead do Google:
  // campanha da Meta chamada "Remarketing" virava "display".
  if (!tipo && i.plataforma === 'google') {
    const n = `${i.nome ?? ''} ${i.utmCampaign ?? ''} ${i.utmMedium ?? ''}`.toLowerCase();
    if (/p\W*max|performance\W*max/.test(n)) [tipo, slug] = ['Performance Max', 'p-max'];
    else if (/search|pesquisa|busca|\brsa\b/.test(n)) [tipo, slug] = ['Search', 'search'];
    else if (/display|gdn|remarketing|\brmkt\b/.test(n)) [tipo, slug] = ['Display', 'display'];
    else if (/video|youtube|\byt\b/.test(n)) [tipo, slug] = ['Video', ''];
    else if (/demand\W*gen/.test(n)) [tipo, slug] = ['Demand Gen', ''];
    else if (/shopping/.test(n)) [tipo, slug] = ['Shopping', ''];
  }

  return { tipo: tipo || 'Desconhecido', slug };
}
