import type { LeadCandidate } from './types';

/**
 * Casamento entre uma conversa recem-criada e o lead que gerou o clique.
 *
 * Portado do `Casar Lead da Planilha` do bloco "Conversa Criada".
 *
 * Substitui o lookup literal do Google Sheets, que comparava a string inteira
 * de `phone_number` e por isso errava sempre que o nono digito ou o DDI 55
 * divergiam entre o que o lead digitou no quiz e o que veio do JID do WhatsApp.
 */

const BR = /^(\d{2})\/(\d{2})\/(\d{4})[ ,]+(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Converte para epoch em ms. Aceita ISO e o formato brasileiro do GTM.
 * Devolve 0 quando a data e' ilegivel — o chamador trata isso como "sem data",
 * nao como "antiga demais".
 */
export function parseDataBR(v: string | null | undefined): number {
  const s = String(v ?? '').trim();
  if (!s) return 0;

  const br = s.match(BR);
  if (br) {
    const [, d, mes, ano, h, min, seg] = br;
    return new Date(+ano!, +mes! - 1, +d!, +h!, +min!, +(seg ?? 0)).getTime();
  }

  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Escolhe o lead que originou a conversa.
 *
 * Prioridade: lead de formulario (quiz) antes de clique solto; depois o mais
 * recente. Lead sem data legivel entra na disputa em vez de ser descartado —
 * perder o lead por causa de uma celula mal formatada e' pior que casar errado.
 */
export function matchLead(
  phoneKey: string,
  candidatos: LeadCandidate[],
  agora: number,
  janelaDias: number,
): LeadCandidate | null {
  if (!phoneKey) return null;

  const limite = agora - janelaDias * 86400000;

  const elegiveis = candidatos.filter((c) => {
    if (c.phoneKey !== phoneKey) return false;
    const t = parseDataBR(c.createdAt);
    return t === 0 || t >= limite;
  });

  if (!elegiveis.length) return null;

  const ehForm = (c: LeadCandidate) => (String(c.origem).toLowerCase() === 'formulario' ? 1 : 0);

  return [...elegiveis].sort((a, b) => {
    const d = ehForm(b) - ehForm(a);
    return d !== 0 ? d : parseDataBR(b.createdAt) - parseDataBR(a.createdAt);
  })[0]!;
}
