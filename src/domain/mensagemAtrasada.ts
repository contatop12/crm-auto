/**
 * Mensagem que chega ao CRM muito depois do clique: a entrega atrasou.
 *
 * O protocolo vai no texto que o botao do site preenche, entao quem manda a
 * mensagem com o protocolo manda na hora do clique. Se ela so' chega ao CRM
 * horas depois, quem atrasou foi a entrega (Evolution -> Chatwoot), nao o lead.
 * Na Martinelli (03 a 08/11/2026) a instancia ficou ate' 47 h atras.
 *
 * Hoje so' alimenta o log (`mensagem_atrasada`). O aviso do grupo sai mesmo
 * assim, com a hora do clique: descartar fez a Martinelli perder 11 leads
 * reais no grupo em 07 e 08/11/2026.
 *
 * So' vale para o protocolo DITO na mensagem. O casamento pelo telefone acha
 * clique antigo para conversa nova de verdade, e ai' a idade do clique nao diz
 * nada sobre a entrega.
 */
export const HORAS_MENSAGEM_ATRASADA = 6;

/** Data do D1 (`2026-11-04 22:05:00`, UTC) ou ISO. */
function instante(v: string | null | undefined): number | null {
  if (!v) return null;
  const ms = Date.parse(v.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? '' : 'Z'));
  return Number.isFinite(ms) ? ms : null;
}

export function atrasoDaMensagem(
  cliqueEm: string | null | undefined,
  agoraMs: number,
): { atrasada: boolean; horas: number } {
  const clique = instante(cliqueEm);
  // Sem hora do clique, ou clique "no futuro": avisa. Perder lead novo e' pior.
  if (clique === null || clique > agoraMs) return { atrasada: false, horas: 0 };
  const horas = Math.floor((agoraMs - clique) / 3600_000);
  return { atrasada: agoraMs - clique >= HORAS_MENSAGEM_ATRASADA * 3600_000, horas };
}
