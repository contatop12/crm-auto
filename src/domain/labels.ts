import type { Origem, Plataforma } from './platform';
import type { LabelVocabulary } from './types';

/**
 * Motor de etiquetas — fonte unica de verdade para Chatwoot E WhatsApp.
 *
 * Portado do `Motor de Etiquetas` do bloco "Mensagem do Lead".
 *
 * Regra: 1 etiqueta de ORIGEM + 1 de PLATAFORMA + 1 de TIPO DE CAMPANHA,
 * mais VERSAO e FAIXA DE VALOR quando o lead veio do quiz.
 *
 * Nada fora do vocabulario do tenant e' enviado: no Chatwoot a etiqueta seria
 * criada solta, e no WhatsApp o `findLabels` nao acharia o id, porque as
 * etiquetas sao criadas a mao pelo cliente.
 */

export interface LabelInput {
  origem: Origem;
  plataforma: Plataforma;
  /** 'p-max' | 'search' | 'display' — vem de `classifyCampaign`. */
  campanhaSlug?: string | null;
  quizVersion?: string | null;
  quizValor?: number | null;
}

export interface LabelResult {
  /** Slugs internos aprovados pelo vocabulario, sem repeticao. */
  slugs: string[];
  /** Nomes reais a aplicar no Chatwoot. */
  chatwoot: string[];
  /** Nomes reais a aplicar no WhatsApp (subconjunto: nem toda etiqueta existe la). */
  whatsapp: string[];
  /** Slugs recusados por nao existirem no vocabulario. Vai para o log. */
  ignoradas: string[];
}

export function buildLabels(i: LabelInput, vocabulario: LabelVocabulary[]): LabelResult {
  const brutas: string[] = [i.origem];

  if (i.plataforma === 'google') brutas.push('google-ads');
  if (i.plataforma === 'meta') brutas.push('meta-ads');
  if (i.campanhaSlug) brutas.push(i.campanhaSlug);
  if (i.quizVersion) brutas.push('quiz-' + i.quizVersion);
  if (i.quizValor) brutas.push('r' + String(i.quizValor).padStart(2, '0'));

  const porSlug = new Map(vocabulario.map((v) => [v.slug, v]));
  const slugs: string[] = [];
  const ignoradas: string[] = [];

  for (const bruta of brutas) {
    const s = String(bruta ?? '').trim().toLowerCase();
    if (!s) continue;
    if (!porSlug.has(s)) {
      if (!ignoradas.includes(s)) ignoradas.push(s);
      continue;
    }
    if (!slugs.includes(s)) slugs.push(s);
  }

  return {
    slugs,
    chatwoot: slugs.map((s) => porSlug.get(s)!.labelChatwoot),
    whatsapp: slugs
      .map((s) => porSlug.get(s)!.labelWhatsapp)
      .filter((n): n is string => !!n),
    ignoradas,
  };
}
