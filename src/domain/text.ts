/**
 * Normalizacao de texto para casar frases-gatilho.
 *
 * Portado de `limpa` / `norm` dos nos Code do n8n.
 *
 * O vendedor digita "Segue orçamento com as MEDIDAS TÉCNICAS 📐" e a frase
 * cadastrada e' "segue orcamento com as medidas tecnicas". Sem normalizar os
 * dois lados do mesmo jeito, o gatilho nunca casa.
 */

const EMOJI = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\uFE0F]/gu;
const DIACRITICOS = /[\u0300-\u036f]/g;

export function limpa(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(EMOJI, '')
    .normalize('NFD')
    .replace(DIACRITICOS, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
