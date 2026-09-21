/**
 * Quem conta como lead DIRETO: chamou no WhatsApp sem protocolo, sem clique
 * casado pelo telefone e sem a frase do anuncio.
 *
 * O cliente pediu todo lead na planilha, cada um no seu lugar, mas ja' tinha
 * reclamado (27/08) de paciente antigo virando "lead". Entao a regra olha para
 * o CONTATO, nao para a mensagem:
 *
 * - contato novo na caixa: o Chatwoot criou o `contact_inbox` ha' pouco. Quem
 *   ja' conversava antes (paciente, retorno, fornecedor) tem o vinculo antigo;
 * - quem falou primeiro foi o contato. Quando a clinica abre a conversa (ex.:
 *   confirmar consulta, ou a mensagem automatica da Natasha para quem preencheu
 *   o formulario), `first_reply_created_at` ja' existe antes da primeira
 *   mensagem dele — e esse lead, se for lead, ja' tem outro dono (formulario,
 *   ligacao).
 */

/** Ate' quanto depois de o contato aparecer a mensagem ainda e' "a primeira". */
export const JANELA_CONTATO_NOVO_MIN = 30;

export interface SinaisLeadDireto {
  /** `conversation.contact_inbox.created_at` (ISO). */
  contatoDesde: string | number | null | undefined;
  /** `created_at` da mensagem (ISO ou epoch em segundos). */
  mensagemEm: string | number | null | undefined;
  /** `conversation.first_reply_created_at` (ISO ou null). */
  primeiraRespostaEm: string | number | null | undefined;
}

/** ISO, epoch em segundos ou em ms -> ms. */
export function paraMs(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  const s = String(v).trim();
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return n < 1e12 ? n * 1000 : n;
  }
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

export function decidirLeadDireto(s: SinaisLeadDireto): { lead: boolean; motivo: string } {
  const contato = paraMs(s.contatoDesde);
  const msg = paraMs(s.mensagemEm);
  if (contato === null || msg === null) {
    return { lead: false, motivo: 'sem data do contato ou da mensagem para saber se e novo' };
  }
  if (msg - contato > JANELA_CONTATO_NOVO_MIN * 60_000) {
    return { lead: false, motivo: 'contato antigo na caixa (paciente ou conversa anterior)' };
  }
  const resposta = paraMs(s.primeiraRespostaEm);
  if (resposta !== null && resposta <= msg) {
    return { lead: false, motivo: 'a clinica falou primeiro (formulario, ligacao ou retorno)' };
  }
  return { lead: true, motivo: 'contato novo que chamou primeiro' };
}
