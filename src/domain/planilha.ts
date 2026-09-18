import { montarCanal } from './canal';
import { detectOrigin, detectPlatform } from './platform';

/**
 * O registro que vai para a planilha geral de leads.
 *
 * Quem escreve na planilha e' o n8n, nao nos. Escrever direto exigia autorizar
 * o escopo `spreadsheets` na conta Google, e o n8n ja' tem a credencial do Sheets
 * funcionando em todos os clientes. Aqui so' se monta o registro, com nomes
 * estaveis; no n8n cada coluna da planilha escolhe um desses campos, com a lista
 * de cabecalhos lida da planilha real.
 */

/** O que vai no corpo, e como isso se chama na tela. */
export const CAMPOS_PLANILHA: Array<{ campo: string; rotulo: string }> = [
  { campo: 'timestamp', rotulo: 'Data e hora (junto)' },
  { campo: 'data', rotulo: 'Data' },
  { campo: 'hora', rotulo: 'Hora' },
  { campo: 'canal', rotulo: 'Canal do anúncio' },
  { campo: 'plataforma', rotulo: 'Plataforma (google / meta)' },
  { campo: 'campanha', rotulo: 'Campanha' },
  { campo: 'protocolo', rotulo: 'Protocolo' },
  { campo: 'nome', rotulo: 'Nome do lead' },
  { campo: 'telefone', rotulo: 'Telefone (só dígitos)' },
  { campo: 'link_whatsapp', rotulo: 'Link do WhatsApp' },
  { campo: 'email', rotulo: 'E-mail' },
  { campo: 'etapa', rotulo: 'Etapa do funil' },
  { campo: 'conversao', rotulo: 'Conversão enviada' },
  { campo: 'valor', rotulo: 'Valor' },
  { campo: 'gclid', rotulo: 'GCLID' },
  { campo: 'utm_source', rotulo: 'utm_source' },
  { campo: 'utm_medium', rotulo: 'utm_medium' },
  { campo: 'utm_term', rotulo: 'utm_term' },
  { campo: 'cliente', rotulo: 'Cliente' },
  { campo: 'ensaio', rotulo: 'Modo sombra (true/false)' },
  { campo: 'teste', rotulo: 'Linha de teste (true/false)' },
];

export interface LeadDaPlanilha {
  nome?: string | null;
  email?: string | null;
  phone_e164?: string | null;
  gclid?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
  origem?: string | null;
  evento?: string | null;
}

export interface ContextoPlanilha {
  cliente: string;
  protocolo: string;
  etapa: string;
  conversao: string;
  valor: number | null;
  moeda: string;
  quando: number;
  ensaio: boolean;
  teste?: boolean;
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

export function montarRegistro(
  ctx: ContextoPlanilha,
  lead: LeadDaPlanilha | null,
): Record<string, string | boolean> {
  const t = (v: string | null | undefined) => v ?? '';
  const digitos = t(lead?.phone_e164).replace(/\D/g, '');

  const plataforma = detectPlatform({
    utmSource: lead?.utm_source, utmMedium: lead?.utm_medium,
    utmCampaign: lead?.utm_campaign, gclid: lead?.gclid,
  });

  return {
    ...dataHoraBrasilia(ctx.quando),
    canal: montarCanal({
      origem: detectOrigin({ origemClick: lead?.origem, eventClick: lead?.evento }),
      plataforma,
      quizVersion: null,
    }),
    plataforma,
    campanha: t(lead?.utm_campaign),
    protocolo: ctx.protocolo,
    nome: t(lead?.nome),
    // a planilha ja' guardava o numero assim (5511...), sem o `+`
    telefone: digitos,
    link_whatsapp: digitos ? `https://wa.me/${digitos}` : '',
    email: t(lead?.email),
    etapa: ctx.etapa,
    conversao: ctx.conversao,
    valor: ctx.valor === null ? '' : `${ctx.moeda} ${ctx.valor}`,
    gclid: t(lead?.gclid),
    utm_source: t(lead?.utm_source),
    utm_medium: t(lead?.utm_medium),
    utm_term: t(lead?.utm_term),
    cliente: ctx.cliente,
    ensaio: ctx.ensaio,
    teste: ctx.teste === true,
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
