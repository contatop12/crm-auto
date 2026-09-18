import { montarCanal } from './canal';
import { detectOrigin, detectPlatform } from './platform';

/**
 * O registro que vai para as planilhas do cliente.
 *
 * Quem escreve e' o proprio sistema, pela service account, ou o n8n, por
 * webhook — escolha por cliente. O registro e' o mesmo nos dois casos:
 *
 * - campos soltos (`data`, `nome`, `canal`...) para a planilha geral de leads;
 * - `cliques` e `conversoes`, ja' com os nomes de coluna do Banco de Dados, para
 *   as abas de mesmo nome. Os clientes nao tem exatamente as mesmas colunas, por
 *   isso vai o conjunto inteiro e so' as colunas que a planilha tem recebem dado.
 */

/** O que vai no corpo, e como isso se chama na tela. */
export const CAMPOS_PLANILHA: Array<{ campo: string; rotulo: string }> = [
  { campo: 'tipo', rotulo: 'clique (lead chegou) ou conversao (subiu para o Google)' },
  { campo: 'timestamp', rotulo: 'Data e hora do clique (junto)' },
  { campo: 'data', rotulo: 'Data do clique' },
  { campo: 'hora', rotulo: 'Hora do clique' },
  { campo: 'canal', rotulo: 'Canal do anúncio' },
  { campo: 'plataforma', rotulo: 'Plataforma (google / meta)' },
  { campo: 'campanha', rotulo: 'Campanha' },
  { campo: 'pagina', rotulo: 'Página de entrada, sem domínio' },
  { campo: 'protocolo', rotulo: 'Protocolo' },
  { campo: 'nome', rotulo: 'Nome do lead' },
  { campo: 'telefone', rotulo: 'Telefone (55 + DDD + número)' },
  { campo: 'link_whatsapp', rotulo: 'Link do WhatsApp' },
  { campo: 'email', rotulo: 'E-mail' },
  { campo: 'etapa', rotulo: 'Etapa do funil (vazio no clique)' },
  { campo: 'conversao', rotulo: 'Conversão enviada (vazio no clique)' },
  { campo: 'valor', rotulo: 'Valor' },
  { campo: 'gclid', rotulo: 'GCLID' },
  { campo: 'utm_source', rotulo: 'utm_source' },
  { campo: 'utm_medium', rotulo: 'utm_medium' },
  { campo: 'utm_term', rotulo: 'utm_term' },
  { campo: 'cliente', rotulo: 'Cliente' },
  { campo: 'ensaio', rotulo: 'Modo sombra (true/false)' },
  { campo: 'teste', rotulo: 'Linha de teste (true/false)' },
  { campo: 'cliques', rotulo: 'Linha da aba Cliques do Banco de Dados, com os nomes de coluna dela' },
  { campo: 'conversoes', rotulo: 'Linha da aba Conversoes do Banco de Dados (só na conversão)' },
];

/** A linha de `leads`, com o que as planilhas usam. */
export interface LeadDaPlanilha {
  nome?: string | null;
  email?: string | null;
  phone_e164?: string | null;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_id?: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  client_id?: string | null;
  origem?: string | null;
  evento?: string | null;
  page_url?: string | null;
  whatsapp_url?: string | null;
  referrer?: string | null;
  user_agent?: string | null;
  ip_address?: string | null;
  quiz_version?: string | null;
  quiz_valor?: number | null;
  quiz_form_id?: string | null;
  valor_proposta?: number | null;
  /** `datetime('now')` do D1: UTC, `YYYY-MM-DD HH:MM:SS` */
  created_at?: string | null;
}

export interface ContextoPlanilha {
  tipo: 'clique' | 'conversao';
  cliente: string;
  protocolo: string;
  ensaio: boolean;
  teste?: boolean;
  /** so' quando `tipo` e' conversao */
  conversao?: {
    evento: string;
    etapa: string;
    valor: number | null;
    moeda: string;
    quando: number;
    acao: string;
    requestId: string | null;
    /** `classificar()` do stageChanged: click_id | click_id+user_data | user_data_only */
    match: string;
    enviadoEm: number;
  };
}

/**
 * Data e hora de Brasilia, no formato que quem abre a planilha le.
 *
 * Deslocamento fixo de -3h: o Brasil nao tem horario de verao desde 2019, e
 * carregar uma base de fusos no Worker para isso seria peso sem ganho.
 */
export function dataHoraBrasilia(ms: number): { data: string; hora: string; timestamp: string } {
  const iso = new Date(ms - 3 * 3600 * 1000).toISOString();
  const data = `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  const hora = iso.slice(11, 19);
  return { data, hora, timestamp: `${data} ${hora}` };
}

/** `2026-09-09 17:00:00` (UTC do D1) em milissegundos, ou null. */
function doD1(v: string | null | undefined): number | null {
  if (!v) return null;
  const ms = Date.parse(v.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? '' : 'Z'));
  return Number.isFinite(ms) ? ms : null;
}

/** Caminho da pagina, sem dominio e sem parametros: `/cortinas`. */
function caminho(url: string | null | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).pathname;
  } catch {
    return url.split('?')[0]!.replace(/^https?:\/\/[^/]+/, '');
  }
}

export function montarRegistro(
  ctx: ContextoPlanilha,
  lead: LeadDaPlanilha | null,
): Record<string, unknown> & {
  cliques: Record<string, string>;
  conversoes: Record<string, string> | null;
} {
  const t = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(v));
  const digitos = t(lead?.phone_e164).replace(/\D/g, '');
  // a aba Cliques sempre guardou o numero nacional: 11971036500
  const nacional = digitos.startsWith('55') && digitos.length >= 12 ? digitos.slice(2) : digitos;
  const cv = ctx.conversao;

  const cliqueEm = doD1(lead?.created_at);
  const quandoChegou = dataHoraBrasilia(cliqueEm ?? cv?.quando ?? Date.now());
  const cliqueFormatado = cliqueEm === null ? '' : dataHoraBrasilia(cliqueEm).timestamp;

  const plataforma = detectPlatform({
    utmSource: lead?.utm_source, utmMedium: lead?.utm_medium,
    utmCampaign: lead?.utm_campaign, gclid: lead?.gclid,
  });

  const atribuicao = {
    gclid: t(lead?.gclid),
    gbraid: t(lead?.gbraid),
    wbraid: t(lead?.wbraid),
    utm_source: t(lead?.utm_source),
    utm_medium: t(lead?.utm_medium),
    utm_campaign: t(lead?.utm_campaign),
    utm_id: t(lead?.utm_id),
    utm_term: t(lead?.utm_term),
    utm_content: t(lead?.utm_content),
    // o fluxo antigo tirava o nome real da campanha da API do Google Ads; aqui
    // nao ha essa consulta, entao as colunas existem mas ficam vazias
    campanha_nome: '',
    campanha_tipo: '',
  };

  const cliques = {
    protocol: ctx.protocolo,
    phone_number: nacional,
    lead_name: t(lead?.nome),
    email: t(lead?.email),
    status: cv ? cv.etapa : 'pendente',
    ...atribuicao,
    page_url: t(lead?.page_url),
    whatsapp_url: t(lead?.whatsapp_url),
    fbp: t(lead?.fbp),
    fbc: t(lead?.fbc),
    user_agent: t(lead?.user_agent),
    client_id: t(lead?.client_id),
    created_at: cliqueFormatado,
    referrer: t(lead?.referrer),
    ip_address: t(lead?.ip_address),
    valido: 'TRUE',
    origem: t(lead?.origem),
    event: t(lead?.evento),
    valor_proposta: t(lead?.valor_proposta),
    quiz_version: t(lead?.quiz_version),
    quiz_valor: t(lead?.quiz_valor),
    form_id: t(lead?.quiz_form_id),
  };

  const conversoes = cv
    ? {
        protocol: `${ctx.protocolo}-${cv.evento}`,
        event_type: cv.evento,
        origem: t(lead?.origem),
        qualified_at: new Date(cv.quando).toISOString(),
        click_created_at: cliqueFormatado,
        lead_name: t(lead?.nome),
        email: t(lead?.email),
        phone_number: nacional,
        ...atribuicao,
        conversion_action: cv.acao,
        conversion_time: new Date(cv.quando).toISOString(),
        conversion_value: t(cv.valor),
        currency: cv.moeda,
        // vocabulario da aba: gclid quando houve clique, enhanced_only quando
        // o Google so' recebeu e-mail e telefone
        match_type: cv.match.startsWith('click_id') ? 'gclid' : 'enhanced_only',
        google_ads_uploaded_at: new Date(cv.enviadoEm).toISOString(),
        request_id: t(cv.requestId),
        status: 'enviado',
        google_ads_error: '',
      }
    : null;

  return {
    tipo: ctx.tipo,
    ...quandoChegou,
    canal: montarCanal({
      origem: detectOrigin({ origemClick: lead?.origem, eventClick: lead?.evento }),
      plataforma,
      quizVersion: null,
    }),
    plataforma,
    campanha: t(lead?.utm_campaign),
    pagina: caminho(lead?.page_url),
    protocolo: ctx.protocolo,
    nome: t(lead?.nome),
    // a planilha de leads ja' guardava o numero assim (5511...), sem o `+`
    telefone: digitos,
    link_whatsapp: digitos ? `https://wa.me/${digitos}` : '',
    email: t(lead?.email),
    etapa: cv?.etapa ?? '',
    conversao: cv?.evento ?? '',
    valor: cv && cv.valor !== null ? `${cv.moeda} ${cv.valor}` : '',
    gclid: t(lead?.gclid),
    utm_source: t(lead?.utm_source),
    utm_medium: t(lead?.utm_medium),
    utm_term: t(lead?.utm_term),
    cliente: ctx.cliente,
    ensaio: ctx.ensaio,
    teste: ctx.teste === true,
    cliques,
    conversoes,
  };
}

/**
 * O endereco do webhook do n8n, ou null se nao servir.
 *
 * So' https: o corpo leva nome, telefone e e-mail do lead.
 */
export function urlDoWebhook(entrada: string | null | undefined): string | null {
  const v = (entrada ?? '').trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Escrita direta, pela service account
// ---------------------------------------------------------------------------

/** Cabecalho comparavel: sem acento, sem caixa, sem espaco sobrando. */
function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * A linha na ordem das colunas da planilha, casando pelo nome do cabecalho.
 *
 * Coluna sem dado nosso — ou com dado vazio — fica com o que ja' estava la'
 * (`atual`). Na aba Cliques o time anota coisas; atualizar o lead nao pode
 * apagar a anotacao. E nome antigo vindo do n8n nao some porque o nosso ficou
 * em branco.
 */
export function montarLinhaPorCabecalho(
  cabecalho: string[],
  dados: Record<string, unknown>,
  atual: string[] = [],
): string[] {
  const porNome = new Map(Object.entries(dados).map(([k, v]) => [normalizar(k), v]));
  return cabecalho.map((h, i) => {
    const v = porNome.get(normalizar(h));
    const texto = v === null || v === undefined ? '' : String(v);
    return texto !== '' ? texto : (atual[i] ?? '');
  });
}

/** Nome de coluna da planilha de leads -> campo solto do registro. */
const COLUNAS_LEADS: Record<string, string> = {
  'link do whatsapp': 'link_whatsapp',
  'url whatsapp': 'link_whatsapp',
  'whatsapp': 'link_whatsapp',
  'data': 'data',
  'hora': 'hora',
  'nome': 'nome',
  'telefone': 'telefone',
  'email': 'email',
  'e-mail': 'email',
  'canal': 'canal',
  'canal de anuncio': 'canal',
  'pagina': 'pagina',
  'campanha': 'campanha',
  'protocolo': 'protocolo',
};

/** Qual campo vai numa coluna da planilha de leads, ou null se e' do time. */
export function campoDaColunaLeads(nome: string): string | null {
  return COLUNAS_LEADS[normalizar(nome)] ?? null;
}

/** A linha da planilha de leads, na ordem do cabecalho dela. */
export function linhaDeLeads(cabecalho: string[], registro: Record<string, unknown>): string[] {
  return cabecalho.map((h) => {
    const campo = campoDaColunaLeads(h);
    const v = campo ? registro[campo] : '';
    return v === null || v === undefined ? '' : String(v);
  });
}

/**
 * O id do documento, dado o que a pessoa colou.
 *
 * Aceitar a URL inteira evita o erro mais provavel deste campo: pedir "o
 * trecho entre /d/ e /edit" e' pedir para editar URL a mao.
 */
export function idDaPlanilha(entrada: string | null | undefined): string | null {
  const v = (entrada ?? '').trim();
  if (!v) return null;
  const naUrl = v.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (naUrl) return naUrl[1]!;
  return /^[a-zA-Z0-9_-]{20,}$/.test(v) ? v : null;
}

/** 0 -> `A`, 26 -> `AA`. */
export function indiceParaColuna(i: number): string {
  if (!Number.isInteger(i) || i < 0) return '';
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
