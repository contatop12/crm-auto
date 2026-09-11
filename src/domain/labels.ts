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
  /** `utm_source` cru. E' o que separa instagram de facebook dentro do Meta. */
  utmSource?: string | null;
  /** Caminho da pagina do clique, quando vira etiqueta. */
  pagina?: string | null;
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

  // A etiqueta passa a ser a REDE, nao "o anuncio veio de tal lugar":
  // `google-ads` virou `google`, e `meta-ads` se desdobra em `instagram` ou
  // `facebook` — dentro do Meta as duas redes se comportam diferente, e juntar
  // as duas numa etiqueta so' apagava a unica diferenca que interessa.
  if (i.plataforma === 'google') brutas.push('google');
  if (i.plataforma === 'meta') brutas.push(redeDoMeta(i.utmSource));

  // A pagina de entrada tambem e' etiqueta, quando o vocabulario a conhece.
  if (i.pagina) brutas.push(etiquetaSlug(i.pagina));
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

/**
 * O nome de uma etiqueta, normalizado.
 *
 * Minúsculo, sem acento, espaço e underline viram hífen. Caminho de página
 * perde as barras das pontas — `/aparelho-auditivo/` e `aparelho-auditivo` são
 * a mesma etiqueta, e tratá-los como dois criaria duas no Chatwoot.
 *
 * Barra no MEIO vira hífen em vez de sumir: `/blog/perda-auditiva` juntado sem
 * separador viraria `blogperda-auditiva`.
 */
export function etiquetaSlug(valor: string | null | undefined): string {
  let v = String(valor ?? '').trim();
  if (!v) return '';

  // URL inteira: só o caminho interessa. O host não é nome de etiqueta.
  const url = v.match(/^https?:\/\/[^/]+\/?(.*)$/i);
  if (url) v = url[1] ?? '';

  return v
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // tira o acento, mantém a letra
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')       // tudo que não é letra ou número separa
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Instagram ou Facebook, lido da `utm_source`.
 *
 * Sem pista, fica `facebook`: e' o nome da rede que da' nome a plataforma, e
 * errar para o mais generico e' menos ruim que inventar `instagram` para quem
 * veio do feed do Facebook.
 */
function redeDoMeta(utmSource: string | null | undefined): string {
  const s = String(utmSource ?? '').toLowerCase();
  if (/insta|ig/.test(s)) return 'instagram';
  return 'facebook';
}
