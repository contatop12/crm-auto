/**
 * Token da Meta cifrado em repouso no D1.
 *
 * Portado de `whatsapp-track/src/lib/crypto.ts` sem mudar o algoritmo: a
 * MASTER_KEY do CRM e' a mesma do tracker, e o token da Taina vem de la' ainda
 * cifrado. AES-GCM, chave = SHA-256 da MASTER_KEY, IV novo a cada cifra —
 * reusar IV em GCM quebra o sigilo.
 */

const IV_BYTES = 12;

function paraBase64(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

function deBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function chave(masterKey: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(masterKey));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function cifrarToken(token: string, masterKey: string): Promise<{ cipher: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cifrado = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await chave(masterKey), new TextEncoder().encode(token));
  return { cipher: paraBase64(new Uint8Array(cifrado)), iv: paraBase64(iv) };
}

/** Lanca se a cifra foi adulterada ou se a MASTER_KEY nao e' a que cifrou. */
export async function decifrarToken(cipher: string, iv: string, masterKey: string): Promise<string> {
  const aberto = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deBase64(iv) }, await chave(masterKey), deBase64(cipher));
  return new TextDecoder().decode(aberto);
}

/** Os 4 ultimos, para a tela reconhecer o token. Token curto: nada, senao seria o token inteiro. */
export function ultimos4(token: string): string {
  return token.length > 4 ? token.slice(-4) : '';
}
