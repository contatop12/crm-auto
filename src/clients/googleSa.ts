import type { Env } from '../env';

/**
 * Service account do Google: token sem consentimento, sem refresh token.
 *
 * O caminho por OAuth dependia de uma pessoa autorizar numa tela do Google — e
 * a tela vencia, pedia caixas marcadas, e o token ficava preso ao login de
 * quem autorizou. A service account (`crm-api@crm-p12.iam.gserviceaccount.com`)
 * assina o proprio pedido com a chave privada e recebe o token direto.
 *
 * Em troca, cada recurso precisa ser liberado para o e-mail dela: planilha
 * compartilhada como Editor, usuario no GTM, usuario na MCC do Google Ads.
 * Enquanto um recurso nao foi liberado, `comConta` cai no acesso antigo — a
 * migracao acontece API por API, sem derrubar nada no meio.
 */

export interface ChaveSa {
  client_email: string;
  private_key: string;
  token_uri: string;
}

/** O JSON que o Google entrega, ou null se nao houver ou nao servir. */
export function lerChave(bruto: string | undefined): ChaveSa | null {
  if (!bruto) return null;
  try {
    const j = JSON.parse(bruto) as Partial<ChaveSa> & { type?: string };
    if (j.type !== 'service_account' || !j.client_email || !j.private_key) return null;
    return {
      client_email: j.client_email,
      private_key: j.private_key,
      token_uri: j.token_uri ?? 'https://oauth2.googleapis.com/token',
    };
  } catch {
    return null;
  }
}

function base64url(dados: Uint8Array | string): string {
  const bytes = typeof dados === 'string' ? new TextEncoder().encode(dados) : dados;
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemParaDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** JWT assinado (RS256) que o Google troca por access token. `agora` em segundos. */
export async function assinarAssercao(chave: ChaveSa, escopos: string[], agora: number): Promise<string> {
  const cab = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const corpo = base64url(JSON.stringify({
    iss: chave.client_email,
    scope: escopos.join(' '),
    aud: chave.token_uri,
    iat: agora,
    exp: agora + 3600,
  }));
  const k = await crypto.subtle.importKey(
    'pkcs8',
    pemParaDer(chave.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', k, new TextEncoder().encode(`${cab}.${corpo}`));
  return `${cab}.${corpo}.${base64url(new Uint8Array(sig))}`;
}

/** Tokens na memoria do isolate, um por conjunto de escopos. */
const tokens = new Map<string, { valor: string; expiraEm: number }>();

/**
 * Access token da service account, ou null se ela nao estiver configurada.
 *
 * Erro ao obter o token (chave revogada, API desligada no projeto) sobe: quem
 * chama via `comConta` registra e segue pelo acesso antigo.
 */
export async function tokenDaConta(env: Env, escopos: string[]): Promise<string | null> {
  const chave = lerChave(env.GOOGLE_SA_KEY);
  if (!chave) return null;

  const id = escopos.join(' ');
  const agora = Date.now();
  const guardado = tokens.get(id);
  if (guardado && guardado.expiraEm > agora) return guardado.valor;

  const r = await fetch(chave.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: await assinarAssercao(chave, escopos, Math.floor(agora / 1000)),
    }),
  });
  const j = (await r.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!j.access_token) {
    throw new Error(`service account recusada: ${j.error ?? r.status} ${j.error_description ?? ''}`.trim());
  }
  // 55 min de 60: folga para o relogio do isolate
  tokens.set(id, { valor: j.access_token, expiraEm: agora + 3_300_000 });
  return j.access_token;
}

/**
 * Faz a chamada com a service account e, se o Google recusar por permissao,
 * refaz com o acesso antigo.
 *
 * So' 401 e 403 trocam de credencial: nesses casos o Google nao executou nada,
 * entao repetir e' seguro. Qualquer outro erro (400 de formato, 500) seria o
 * mesmo com a outra credencial e volta como veio.
 *
 * `legado` null = nao ha acesso antigo para esta API (planilhas): a recusa da
 * service account volta para quem chamou dizer o que falta liberar.
 */
export async function comConta(
  daConta: () => Promise<string | null>,
  legado: (() => Promise<string>) | null,
  chamar: (token: string) => Promise<Response>,
  statusDeRecusa: number[] = [401, 403],
): Promise<Response> {
  let token: string | null = null;
  try {
    token = await daConta();
  } catch (e) {
    console.log(JSON.stringify({ acao: 'sa_token_falhou', erro: (e as Error).message }));
    if (!legado) throw e;
  }

  if (token) {
    const r = await chamar(token);
    if (!statusDeRecusa.includes(r.status) || !legado) return r;
    console.log(JSON.stringify({ acao: 'sa_sem_permissao', status: r.status }));
  }
  if (!legado) throw new Error('service account nao configurada (GOOGLE_SA_KEY)');
  return chamar(await legado());
}
