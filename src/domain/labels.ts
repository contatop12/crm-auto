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

/** De onde veio o trafego. */
export type Trafego = 'pago' | 'organico' | 'direto';

/**
 * Por onde a conversa chegou, no esquema de quem separa canal de origem
 * (a Vita tem `msg-site`, `msg-nat`, `formulario-do-site`, `formulario-nativo`).
 */
export type Canal = 'msg-site' | 'msg-nat' | 'formulario-do-site' | 'formulario-nativo';

export interface LabelInput {
  /** `null` no contato sem lead: nao se sabe se a mensagem veio de anuncio. */
  origem: Origem | null;
  plataforma: Plataforma;
  /** 'p-max' | 'search' | 'display' — vem de `classifyCampaign`. */
  campanhaSlug?: string | null;
  quizVersion?: string | null;
  quizValor?: number | null;
  /** `utm_source` cru. E' o que separa instagram de facebook dentro do Meta. */
  utmSource?: string | null;
  /** Caminho (ou URL) da pagina do clique, quando vira etiqueta. */
  pagina?: string | null;
  /** Anuncio pago, site sem anuncio, ou contato direto. */
  trafego?: Trafego | null;
  canal?: Canal | null;
  /** Chegou pelo site sem anuncio: a origem e' o proprio site. */
  viaSite?: boolean;
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
  // Cada pedido e' uma lista de alternativas: vale a primeira que o vocabulario
  // do cliente conhece. E' assim que um motor so' serve esquemas diferentes.
  const pedidos: string[][] = [];
  const quer = (...alternativas: string[]) => pedidos.push(alternativas);

  if (i.origem) quer(i.origem);

  // A etiqueta passa a ser a REDE, nao "o anuncio veio de tal lugar":
  // `google-ads` virou `google`, e `meta-ads` se desdobra em `instagram` ou
  // `facebook` — dentro do Meta as duas redes se comportam diferente, e juntar
  // as duas numa etiqueta so' apagava a unica diferenca que interessa.
  // O nome antigo fica de reserva: Taina, Locadora e Tile ainda tem o
  // vocabulario de antes, e desde 11/09 os leads delas saiam sem a rede.
  if (i.plataforma === 'google') quer('google', 'google-ads');
  if (i.plataforma === 'meta') quer(redeDoMeta(i.utmSource), 'meta-ads');

  if (i.viaSite) quer('site');
  if (i.canal) quer(i.canal);
  if (i.trafego) quer(i.trafego);

  // A pagina de entrada tambem e' etiqueta, quando o vocabulario a conhece.
  // O caminho inteiro primeiro; senao o primeiro trecho — o botao do WhatsApp
  // da Vita leva a "/aparelho-auditivo/whatsapp", e a pagina e' aparelho-auditivo.
  if (i.pagina) quer(etiquetaSlug(i.pagina), etiquetaSlug(primeiroTrecho(i.pagina)));
  if (i.campanhaSlug) quer(i.campanhaSlug);
  if (i.quizVersion) quer('quiz-' + i.quizVersion);
  // Sem zero a esquerda: a etiqueta e' `r5`, nao `r05`. O zero ordenava melhor
  // na lista do Chatwoot, mas o nome que o time usa e' o que vale — e uma
  // etiqueta que ninguem reconhece nao e' aplicada por ninguem.
  if (i.quizValor) quer('r' + String(i.quizValor));

  const porSlug = new Map(vocabulario.map((v) => [v.slug, v]));
  const slugs: string[] = [];
  const ignoradas: string[] = [];

  for (const alternativas of pedidos) {
    const opcoes = [...new Set(alternativas.map((a) => String(a ?? '').trim().toLowerCase()).filter(Boolean))];
    if (!opcoes.length) continue;
    const s = opcoes.find((o) => porSlug.has(o));
    if (!s) {
      if (!ignoradas.includes(opcoes[0]!)) ignoradas.push(opcoes[0]!);
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

/** Primeiro trecho do caminho de uma URL ou caminho ("/a/b" -> "a"). */
function primeiroTrecho(v: string): string {
  const s = String(v ?? '').trim();
  const caminho = s.match(/^https?:\/\/[^/]+(\/[^?#]*)?/i)?.[1] ?? s.split(/[?#]/)[0] ?? '';
  return caminho.split('/').filter(Boolean)[0] ?? '';
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
