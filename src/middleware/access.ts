import type { MiddlewareHandler } from 'hono';
import type { Env } from '../env';

/**
 * Autenticacao do painel via Cloudflare Access (Zero Trust).
 *
 * O Access fica na frente do Worker e injeta um JWT assinado no header
 * `Cf-Access-Jwt-Assertion`. Conferir esse JWT aqui e' defesa em profundidade:
 * mesmo com o Access na borda, o Worker nao deve confiar cegamente no header.
 *
 * ## Por que as chaves publicas vem do KV
 *
 * O caminho canonico seria buscar `https://<team>/cdn-cgi/access/certs`. Nao da':
 * a Cloudflare intercepta os caminhos `/cdn-cgi/*` e recusa a sub-requisicao de
 * um Worker com 403. As chaves sao entao semeadas no KV de fora:
 *
 *   curl -s https://<team>/cdn-cgi/access/certs \
 *     | jq '[.keys[] | {kid,kty,n,e,alg}]' > jwks.json
 *   npx wrangler kv key put "jwks:access" --path ./jwks.json --binding CACHE --remote
 *
 * A Cloudflare rotaciona essas chaves de tempos em tempos. Quando isso acontece,
 * o `kid` do token deixa de existir no KV: em vez de trancar todo mundo para
 * fora, a verificacao cai para o modo `claims` (confere aud e expiracao) e
 * ANUNCIA isso em /api/me, para a degradacao nao passar despercebida.
 * Nesse modo a autenticidade vem da barreira do Access na borda, que ja impede
 * a requisicao de chegar ate aqui sem sessao valida.
 */

const CHAVE_JWKS = 'jwks:access';

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}

export type ModoVerificacao = 'assinatura' | 'claims' | 'aberto';

export interface AccessIdentity {
  email: string;
  sub: string;
  modo: ModoVerificacao;
}

function b64urlParaBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function b64urlParaJson<T>(s: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlParaBytes(s))) as T;
}

async function chavesDoKv(env: Env): Promise<Jwk[]> {
  try {
    return ((await env.CACHE.get(CHAVE_JWKS, 'json')) as Jwk[] | null) ?? [];
  } catch {
    return [];
  }
}

async function assinaturaConfere(
  jwk: Jwk,
  cabecalhoB64: string,
  corpoB64: string,
  assinaturaB64: string,
): Promise<boolean> {
  const chave = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    chave,
    b64urlParaBytes(assinaturaB64),
    new TextEncoder().encode(`${cabecalhoB64}.${corpoB64}`),
  );
}

interface CorpoJwt {
  aud: string | string[];
  exp: number;
  email: string;
  sub: string;
}

async function verificarJwt(token: string, env: Env): Promise<AccessIdentity | null> {
  const [cabecalhoB64, corpoB64, assinaturaB64] = token.split('.');
  if (!cabecalhoB64 || !corpoB64 || !assinaturaB64) return null;

  let cabecalho: { kid?: string };
  let corpo: CorpoJwt;
  try {
    cabecalho = b64urlParaJson(cabecalhoB64);
    corpo = b64urlParaJson<CorpoJwt>(corpoB64);
  } catch {
    return null;
  }

  // `aud` amarra o token A ESTE aplicativo. Aceita lista separada por virgula:
  // cada hostname/Worker do painel e' um app do Access com aud proprio.
  const aceitos = env.CF_ACCESS_AUD.split(',').map((a) => a.trim()).filter(Boolean);
  const aud = Array.isArray(corpo.aud) ? corpo.aud : [corpo.aud];
  if (!aud.some((a) => aceitos.includes(a))) return null;

  if (!corpo.exp || corpo.exp * 1000 < Date.now()) return null;

  const jwk = (await chavesDoKv(env)).find((k) => k.kid === cabecalho.kid);
  if (jwk) {
    let ok = false;
    try {
      ok = await assinaturaConfere(jwk, cabecalhoB64, corpoB64, assinaturaB64);
    } catch {
      ok = false;
    }
    if (!ok) return null;
    return { email: corpo.email, sub: corpo.sub, modo: 'assinatura' };
  }

  // Chave rotacionada ou KV ainda nao semeado. Aud e expiracao ja conferidos;
  // a barreira do Access na borda garante a autenticidade.
  console.log(
    JSON.stringify({ aviso: 'jwks_sem_kid', kid: cabecalho.kid, acao: 'resemear jwks:access no KV' }),
  );
  return { email: corpo.email, sub: corpo.sub, modo: 'claims' };
}

export const requireAccess: MiddlewareHandler<{
  Bindings: Env;
  Variables: { identity: AccessIdentity };
}> = async (c, next) => {
  // Escotilha para deixar o painel aberto. Ligar isto expoe, sem autenticacao
  // nenhuma: dados pessoais dos leads de TODOS os clientes, os `ingest_key` e
  // os segredos HMAC dos webhooks — ou seja, permite forjar eventos nas contas
  // dos clientes. So use em rede confiavel e sabendo disso.
  if (c.env.PANEL_PUBLIC === 'true') {
    c.set('identity', { email: 'painel-aberto', sub: 'painel-aberto', modo: 'aberto' });
    await next();
    return;
  }

  const token = c.req.header('Cf-Access-Jwt-Assertion') ?? c.req.header('cf-access-jwt-assertion');
  if (!token) return c.json({ error: 'sem token do Cloudflare Access' }, 401);

  const identidade = await verificarJwt(token, c.env);
  if (!identidade) return c.json({ error: 'token do Access invalido ou de outro aplicativo' }, 401);

  c.set('identity', identidade);
  await next();
};
