import type { ValuePattern } from './types';

/**
 * Extracao do valor da negociacao a partir da mensagem do vendedor.
 *
 * Portado de `parseBR` + `PADROES_VALOR` do bloco "Valor da proposta".
 * O valor encontrado alimenta a conversao de COMPRA no Google Ads, entao um
 * falso positivo vira receita inventada no relatorio.
 */

/**
 * Converte numero escrito no padrao brasileiro para float.
 *
 * "3.500,00" -> 3500 · "1.200" -> 1200 · "1200" -> 1200 · "1,50" -> 1.5
 * O ponto so e' tratado como milhar quando o ultimo grupo tem exatamente 3
 * digitos — senao "1.5" (um e meio) viraria 15.
 */
export function parseBR(raw: string | null | undefined): number {
  let s = String(raw ?? '').trim();
  if (!s) return 0;

  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    const p = s.split('.');
    if (p.length > 1 && p[p.length - 1]!.length === 3) s = s.replace(/\./g, '');
  }

  const n = parseFloat(s);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Primeiro padrao que casar e passar do minimo vence.
 * Regex invalida cadastrada no painel e' pulada em silencio: derrubar o
 * pipeline por causa de configuracao ruim custa mais que ignorar um padrao.
 */
export function extractValue(
  conteudo: string | null | undefined,
  padroes: ValuePattern[],
): number {
  const texto = String(conteudo ?? '');
  if (!texto) return 0;

  const ordenados = [...padroes].sort((a, b) => a.posicao - b.posicao);

  for (const p of ordenados) {
    let re: RegExp;
    try {
      re = new RegExp(p.regex, 'i');
    } catch {
      continue;
    }
    const m = texto.match(re);
    if (!m?.[1]) continue;

    const v = parseBR(m[1]);
    if (v >= p.valorMinimo) return v;
  }

  return 0;
}
