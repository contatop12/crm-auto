import type { MiddlewareHandler } from 'hono';
import type { Env } from '../env';

/**
 * Autenticacao do painel via Cloudflare Access (Zero Trust).
 *
 * O Access fica na frente do Worker e injeta um JWT assinado no header
 * `Cf-Access-Jwt-Assertion`. Validar esse JWT e' obrigatorio: sem isso, quem
 * descobrir a URL do Worker fala com a API direto, driblando o Access.
 *
 * As chaves publicas ficam em `https://<team>/cdn-cgi/access/certs` e sao
 * cacheadas em KV por 1h — buscar o JWKS a cada request custa uma ida a rede
 * no caminho quente do painel.
 */

const CACHE_JWKS = 'jwks:access';
const TTL_JWKS = 3600;

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}

function b64urlParaBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function b64urlParaJson<T>(s: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlParaBytes(s))) as T;
}

async function buscarJwks(env: Env): Promise<Jwk[]> {
  const cacheado = await env.CACHE.get(CACHE_JWKS, 'json');
  if (cacheado) return cacheado as Jwk[];

  const url = `https://${env.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`JWKS do Access respondeu ${r.status}`);

  const { keys } = (await r.json()) as { keys: Jwk[] };
  await env.CACHE.put(CACHE_JWKS, JSON.stringify(keys), { expirationTtl: TTL_JWKS });
  return keys;
}

export interface AccessIdentity {
  email: string;
  sub: string;
}

async function verificarJwt(token: string, env: Env): Promise<AccessIdentity | null> {
  const [cabecalhoB64, corpoB64, assinaturaB64] = token.split('.');
  if (!cabecalhoB64 || !corpoB64 || !assinaturaB64) return null;

  const cabecalho = b64urlParaJson<{ kid: string; alg: string }>(cabecalhoB64);
  const jwk = (await buscarJwks(env)).find((k) => k.kid === cabecalho.kid);
  if (!jwk) return null;

  const chave = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    chave,
    b64urlParaBytes(assinaturaB64),
    new TextEncoder().encode(`${cabecalhoB64}.${corpoB64}`),
  );
  if (!ok) return null;

  const corpo = b64urlParaJson<{ aud: string | string[]; exp: number; email: string; sub: string }>(
    corpoB64,
  );

  // `aud` amarra o token A ESTE aplicativo do Access. Sem conferir, um JWT
  // valido de qualquer outro app da mesma equipe abriria o painel.
  // Aceita lista separada por virgula: cada hostname do painel e' um app do
  // Access com seu proprio aud (crm. e dash. tem auds diferentes).
  const aceitos = env.CF_ACCESS_AUD.split(',').map((a) => a.trim()).filter(Boolean);
  const aud = Array.isArray(corpo.aud) ? corpo.aud : [corpo.aud];
  if (!aud.some((a) => aceitos.includes(a))) return null;

  if (corpo.exp * 1000 < Date.now()) return null;

  return { email: corpo.email, sub: corpo.sub };
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
    c.set('identity', { email: 'painel-aberto', sub: 'painel-aberto' });
    await next();
    return;
  }

  const token =
    c.req.header('Cf-Access-Jwt-Assertion') ?? c.req.header('cf-access-jwt-assertion');

  if (!token) return c.json({ error: 'sem token do Cloudflare Access' }, 401);

  let identidade: AccessIdentity | null;
  try {
    identidade = await verificarJwt(token, c.env);
  } catch (e) {
    return c.json({ error: `falha ao validar o Access: ${(e as Error).message}` }, 500);
  }

  if (!identidade) return c.json({ error: 'token do Access invalido' }, 401);

  c.set('identity', identidade);
  await next();
};
