/**
 * Assinatura HMAC dos webhooks do Chatwoot (fork fazer.ai >= v4.12.0).
 *
 * Formato confirmado contra a instancia real:
 *   X-Chatwoot-Signature: sha256=<hex>
 *   X-Chatwoot-Timestamp: <unix em segundos>
 *   payloadAssinado = `${timestamp}.${rawBody}`
 *
 * Usa WebCrypto porque roda em Workers, nao em Node.
 * A comparacao e' em tempo constante: comparar com === vaza o prefixo correto
 * byte a byte e permite forjar a assinatura por tentativa e erro.
 */

const TOLERANCIA_SEGUNDOS = 300;

const enc = new TextEncoder();

async function chaveHmac(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

function paraHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Produz o header `sha256=<hex>` para um corpo e timestamp. */
export async function signPayload(
  secret: string,
  timestamp: number,
  rawBody: string,
): Promise<string> {
  const key = await chaveHmac(secret);
  const assinatura = await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${rawBody}`));
  return `sha256=${paraHex(assinatura)}`;
}

/** Comparacao em tempo constante — nao sai cedo na primeira diferenca. */
function iguaisEmTempoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface VerifyInput {
  secret: string;
  signatureHeader: string | null | undefined;
  timestampHeader: string | null | undefined;
  rawBody: string;
  /** Injetado para o teste poder simular replay sem mexer no relogio. */
  agoraSegundos?: number;
}

export interface VerifyResult {
  valid: boolean;
  /** Motivo legivel; vai para a coluna `motivo` da tabela `events`. */
  reason?: string;
}

export async function verifySignature(i: VerifyInput): Promise<VerifyResult> {
  if (!i.signatureHeader) return { valid: false, reason: 'header de assinatura ausente' };
  if (!i.timestampHeader) return { valid: false, reason: 'header de timestamp ausente' };

  const ts = Number.parseInt(i.timestampHeader, 10);
  if (Number.isNaN(ts)) return { valid: false, reason: 'timestamp invalido' };

  const agora = i.agoraSegundos ?? Math.floor(Date.now() / 1000);
  if (Math.abs(agora - ts) > TOLERANCIA_SEGUNDOS) {
    return { valid: false, reason: 'timestamp fora da janela de tolerancia' };
  }

  const esperada = await signPayload(i.secret, ts, i.rawBody);
  if (!iguaisEmTempoConstante(esperada, i.signatureHeader)) {
    return { valid: false, reason: 'assinatura nao confere' };
  }

  return { valid: true };
}
