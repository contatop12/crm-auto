/**
 * O cartao do anuncio que a Evolution entrega junto da mensagem.
 *
 * Quem chama pelo WhatsApp a partir de um anuncio da Meta (click-to-WhatsApp)
 * manda a mensagem pronta, e o WhatsApp anexa o cartao do anuncio com o
 * `ctwa_clid` — o identificador do clique. A Meta so' aceita o evento de
 * campanha de mensagem com ele, e ele so' existe aqui: o Chatwoot recebe a
 * mensagem sem o cartao (a Taina tinha 57 cliques no tracker e 0 no CRM).
 *
 * Portado de `parseEvolutionBody` do whatsapp-track, so' a parte do anuncio.
 * A miniatura (`jpegThumbnail`) nunca sai daqui: e' imagem em base64 e nao
 * serve para atribuir nada.
 */

export interface CartaoDoAnuncio {
  /** Digitos do numero do lead, como o WhatsApp entregou (com DDI). */
  telefone: string;
  ctwaClid: string;
  adId: string | null;
  sourceUrl: string | null;
  titulo: string | null;
  /** Nome da instancia na Evolution. */
  instancia: string | null;
}

type Rec = Record<string, unknown>;

/** JID de pessoa. Grupo (`@g.us`), status e lista (`@broadcast`) nao sao lead. */
const PESSOA = /@(s\.whatsapp\.net|c\.us)$/i;
const COLETIVO = /@(g\.us|broadcast)$/i;

export function lerCartaoDaEvolution(raw: string): CartaoDoAnuncio | null {
  let raiz: unknown;
  try {
    raiz = JSON.parse(raw);
  } catch {
    return null;
  }
  const envelope = obj(raiz);
  if (!envelope) return null;

  // So' mensagem nova. Com `byEvents: false` a Evolution manda tudo no mesmo
  // endereco — presenca, leitura, contato — e nada disso traz cartao.
  const evento = str(envelope.event)?.toLowerCase().replace(/_/g, '.');
  if (evento && evento !== 'messages.upsert') return null;

  const bruto = envelope.data;
  const data = obj(Array.isArray(bruto) ? bruto[0] : bruto);
  if (!data) return null;

  const key = obj(data.key);
  if (key?.fromMe === true || data.fromMe === true) return null;

  const remoto = str(key?.remoteJid) ?? str(data.remoteJid) ?? '';
  if (COLETIVO.test(remoto)) return null;

  // Com o endereco novo do WhatsApp (LID) o `remoteJid` vem como `...@lid` e o
  // numero vai num campo ao lado.
  const jid = [remoto, key?.remoteJidAlt, key?.senderPn, data.senderPn]
    .map((v) => str(v))
    .find((j): j is string => !!j && PESSOA.test(j));
  if (!jid) return null;
  const telefone = jid.slice(0, jid.indexOf('@')).split(':')[0]!.replace(/\D/g, '');
  if (telefone.length < 10) return null;

  const message = obj(data.message);
  const contextos = [
    obj(message?.contextInfo),
    obj(obj(message?.extendedTextMessage)?.contextInfo),
    obj(data.contextInfo),
    ...Object.values(message ?? {}).map((v) => obj(obj(v)?.contextInfo)),
  ];
  const anuncio = contextos.map((c) => obj(c?.externalAdReply)).find((a) => a !== null) ?? null;

  const ctwaClid = str(anuncio?.ctwaClid) ?? str(anuncio?.ctwa_clid) ?? str(data.ctwaClid);
  if (!ctwaClid) return null;

  return {
    telefone,
    ctwaClid,
    adId: str(anuncio?.sourceId) ?? str(anuncio?.adId),
    sourceUrl: corta(str(anuncio?.sourceUrl) ?? str(anuncio?.source_url), 500),
    titulo: corta(str(anuncio?.title), 200),
    instancia: str(envelope.instance),
  };
}

function obj(v: unknown): Rec | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function corta(v: string | null, max: number): string | null {
  return v === null ? null : v.slice(0, max);
}
