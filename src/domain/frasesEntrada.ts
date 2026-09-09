import { limpa } from './text';

/**
 * A frase do anúncio como prova de origem.
 *
 * O botão do anúncio abre o WhatsApp com um texto pronto. Quando o clique não
 * chega até nós — GTM que não disparou, navegador que bloqueou, lead que copiou
 * o link e mandou de outro aparelho — a mensagem ainda carrega a origem: aquele
 * texto só existe porque alguém apertou aquele botão.
 *
 * Até aqui esses leads eram descartados com "sem protocolo na mensagem e sem
 * clique para o telefone". São leads de anúncio, pagos, e perdidos.
 *
 * O que a frase NÃO dá é o `gclid`. A conversão sobe pelos dados do lead
 * (telefone com hash), que é atribuição mais fraca — o Google casa por
 * correspondência, não pelo identificador do clique. Mais fraca é melhor que
 * nenhuma.
 */

export interface FraseEntrada {
  frase: string;
  /** Vira a etiqueta de origem: 'mensagem', 'formulario'. */
  origem: string;
  /** Vira `google-ads` ou `meta-ads`. */
  plataforma: string;
}

export interface OrigemDaFrase {
  origem: string;
  plataforma: string;
}

/**
 * Qual frase cadastrada esta mensagem contém.
 *
 * Compara normalizado — sem acento, sem emoji, minúsculo, espaço colapsado —
 * porque o texto chega com variação: o WhatsApp mexe no espaçamento, o lead
 * digita sem acento, e alguns aparelhos prefixam um emoji.
 *
 * Contém, não igual: o lead quase sempre completa o texto pronto antes de
 * enviar ("...auditiva. Pode ser quinta?"). Exigir igualdade perderia
 * justamente quem se deu ao trabalho de escrever.
 */
export function casarFraseDeEntrada(
  texto: string | null | undefined,
  frases: FraseEntrada[],
): OrigemDaFrase | null {
  const t = limpa(texto);
  if (!t) return null;

  for (const f of frases) {
    const alvo = limpa(f.frase);
    if (alvo && t.includes(alvo)) {
      return { origem: f.origem, plataforma: f.plataforma };
    }
  }
  return null;
}

/**
 * Protocolo para o lead que chegou pela frase.
 *
 * Precisa existir por dois motivos: a regra do Chatwoot que promove ao funil
 * exige `protocolo is_present`, e `conversions` precisa de uma chave de dedupe.
 *
 * Derivado da conversa, não sorteado: a segunda mensagem do mesmo lead tem que
 * cair no mesmo protocolo, senão vira um lead novo a cada frase repetida.
 *
 * O `MSG` no meio é deliberado. Protocolo de clique é `VITA-<base36>`; quem ler
 * este saberá de cara que não há gclid para procurar.
 */
export function protocoloDaFrase(prefixo: string, conversaId: number): string {
  const p = (prefixo ?? '').trim().toUpperCase();
  return p ? `${p}-MSG-${conversaId}` : `MSG-${conversaId}`;
}
