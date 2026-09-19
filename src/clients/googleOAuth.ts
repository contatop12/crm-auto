import type { Env } from '../env';
import { exigir } from '../domain/config';

/**
 * Access token do consentimento OAuth guardado no D1 (`gtm_refresh_token`).
 *
 * E' o acesso de uma pessoa (hoje ryansantiago@p12digital.com.br): enxerga o que
 * ela enxerga. Serve de reserva para a service account nas APIs em que o
 * recurso ainda nao foi liberado para ela — a planilha nao compartilhada, o
 * container do GTM sem o usuario da service account.
 */

let naMemoria: { valor: string; expiraEm: number } | null = null;

export async function tokenDoConsentimento(env: Env): Promise<string> {
  const agora = Date.now();
  if (naMemoria && naMemoria.expiraEm > agora) return naMemoria.valor;

  const l = await env.DB.prepare(
    "SELECT valor FROM credenciais WHERE chave = 'gtm_refresh_token'",
  ).first<{ valor: string }>();
  if (!l?.valor) throw new Error('sem consentimento do Google — autorize em Acesso Google');

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: exigir(env, 'GOOGLE_ADS_CLIENT_ID'),
      client_secret: exigir(env, 'GOOGLE_ADS_CLIENT_SECRET'),
      refresh_token: l.valor,
      grant_type: 'refresh_token',
    }),
  });
  const j = (await r.json()) as { access_token?: string; error_description?: string };
  if (!j.access_token) {
    throw new Error(`OAuth do Google falhou: ${j.error_description ?? 'sem access_token'}`);
  }
  naMemoria = { valor: j.access_token, expiraEm: agora + 3_300_000 };
  return j.access_token;
}
