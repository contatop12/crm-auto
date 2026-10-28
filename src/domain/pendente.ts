/**
 * Coluna "Pendente": o lead parou de responder.
 *
 * O card que esta' em "Proposta Enviada" ha' 3 dias, sem nenhuma mensagem do
 * lead nesses 3 dias, vai para "Pendente". Quando o lead volta a falar, o card
 * volta para "Proposta Enviada" e o relogio recomeca.
 *
 * Vale para todo cliente cujo funil tenha as duas colunas. A Locadora criou a
 * "Pendente" em 28/10/2026: eram 30 dos 31 cards de Proposta Enviada parados,
 * alguns ha' mais de um mes.
 *
 * "Qualificando" entra so' para quem liga `pendente_qualificando_dias` (hoje a
 * Locadora, 7 dias). Esse card vai com a etiqueta "qualificando", que diz de
 * onde ele veio e para onde volta quando o lead responde.
 */

export const HORAS_SEM_RESPOSTA = 72;

/** Etiqueta do card que foi de "Qualificando" para "Pendente". */
export const ETIQUETA_QUALIFICANDO = 'qualificando';

export interface EtapasDoPendente {
  /** step do Chatwoot de "Proposta Enviada" */
  proposta: number;
  /** step do Chatwoot de "Pendente" */
  pendente: number;
  /** step do Chatwoot de "Qualificando"; null = o funil nao tem */
  qualificando: number | null;
}

const nome = (s: string | null | undefined) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export function ehPendente(etapa: string | null | undefined): boolean {
  return nome(etapa) === 'pendente';
}

/** As colunas do funil, ou null quando falta Proposta ou Pendente (o cliente nao usa a regra). */
export function etapasDoPendente(steps: Array<{ id: number; name: string }>): EtapasDoPendente | null {
  const proposta = steps.find((s) => nome(s.name) === 'proposta enviada');
  const pendente = steps.find((s) => ehPendente(s.name));
  const qualificando = steps.find((s) => nome(s.name) === 'qualificando');
  return proposta && pendente
    ? { proposta: proposta.id, pendente: pendente.id, qualificando: qualificando?.id ?? null }
    : null;
}

/**
 * O card vai para "Pendente"?
 *
 * As duas condicoes valem juntas: o lead que falou ha' 5 dias e recebeu a
 * proposta ontem ainda nao teve os 3 dias para responder.
 */
export function vaiParaPendente(c: {
  /** quando o card entrou na etapa (ms) */
  naEtapaDesde: number;
  /** ultima mensagem do lead na conversa (ms); null = nenhuma */
  ultimaDoLead: number | null;
  agora: number;
  /** prazo da etapa; Proposta Enviada usa o padrao */
  horas?: number;
}): boolean {
  const prazo = (c.horas ?? HORAS_SEM_RESPOSTA) * 3600 * 1000;
  if (!Number.isFinite(c.naEtapaDesde) || c.agora - c.naEtapaDesde < prazo) return false;
  return c.ultimaDoLead === null || c.agora - c.ultimaDoLead >= prazo;
}

/** O lead respondeu: a etapa para onde o card volta. */
export function voltaPara(etapas: EtapasDoPendente, etiquetas: string[]): number {
  return etapas.qualificando && etiquetas.includes(ETIQUETA_QUALIFICANDO) ? etapas.qualificando : etapas.proposta;
}
