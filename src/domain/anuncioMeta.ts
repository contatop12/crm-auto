/**
 * O anuncio do Meta que trouxe a conversa, lido da primeira mensagem.
 *
 * Quem chama pelo WhatsApp a partir de um anuncio (click-to-WhatsApp) manda a
 * mensagem pronta e, junto, o WhatsApp anexa o cartao do anuncio. No Chatwoot
 * ele chega como texto, depois da mensagem:
 *
 *   **<titulo do anuncio>**
 *   <comeco do texto do anuncio>...
 *   https://www.instagram.com/p/<post>/     (ou https://fb.me/<id>)
 *
 * E' a prova de origem que a campanha de mensagem do Meta nao tem de outro
 * jeito: nao ha gclid, nao ha protocolo, nao ha UTM. E diz a rede — o link e'
 * do Instagram ou do Facebook — que vira a etiqueta.
 *
 * Exige o titulo em negrito ANTES do link: um lead que so' cola o link de um
 * post no meio da conversa nao e' lead de anuncio.
 */

export interface AnuncioMeta {
  rede: 'instagram' | 'facebook';
  link: string;
  titulo: string | null;
}

const LINK = /(https?:\/\/(?:www\.)?(?:instagram\.com\/(?:p|reel|tv)\/[\w-]+\/?|fb\.me\/[\w-]+|(?:m\.|www\.)?facebook\.com\/[^\s]+))\s*$/i;

export function anuncioDoMeta(texto: string | null | undefined): AnuncioMeta | null {
  const t = (texto ?? '').trim();
  if (!t) return null;

  const m = t.match(LINK);
  if (!m) return null;

  const antes = t.slice(0, m.index);
  const titulos = [...antes.matchAll(/^\*\*(.+?)\*\*\s*$/gm)];
  if (!titulos.length) return null;

  const link = m[1]!;
  return {
    rede: /instagram\.com/i.test(link) ? 'instagram' : 'facebook',
    link,
    titulo: titulos[titulos.length - 1]![1]!.trim() || null,
  };
}

/** Derivado da conversa, como o da frase: a segunda mensagem cai no mesmo lead. */
export function protocoloDoAnuncio(prefixo: string, conversaId: number): string {
  const p = (prefixo ?? '').trim().toUpperCase();
  return p ? `${p}-CTWA-${conversaId}` : `CTWA-${conversaId}`;
}
