import { Hono } from 'hono';
import type { Env } from '../env';
import { exigir } from '../domain/config';

/**
 * Consentimento do Google feito pelo proprio painel.
 *
 * O caminho manual — consentir no Playground, copiar o codigo, trocar por um
 * refresh token e cadastrar como secret — funciona, mas faz uma credencial de
 * vida longa passar pela mao. Aqui o Worker recebe o callback, troca o codigo
 * pelo token e grava, e o token nunca aparece numa tela.
 *
 * O callback vive sob `/ingest` porque esse prefixo ja e' publico por desenho:
 * o Google redireciona o navegador para ca' sem sessao do Access. O que protege
 * a rota nao e' a rede, e' o `state`.
 */

export const oauth = new Hono<{ Bindings: Env }>();

const ESCOPOS = [
  'https://www.googleapis.com/auth/tagmanager.readonly',
  'https://www.googleapis.com/auth/tagmanager.edit.containers',
  'https://www.googleapis.com/auth/tagmanager.publish',
  // junto porque o refresh token novo substitui o antigo no mesmo cliente:
  // sem isto, autorizar o GTM poderia derrubar o acesso ao Google Ads
  'https://www.googleapis.com/auth/adwords',
].join(' ');

const TTL_STATE = 600; // 10 min: o consentimento e' um ato continuo

export function urlDeConsentimento(env: Env, redirectUri: string, state: string): string {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', exigir(env, 'GOOGLE_ADS_CLIENT_ID'));
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', ESCOPOS);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('state', state);
  return u.toString();
}

export const CAMINHO_CALLBACK = '/ingest/oauth/google/callback';

/**
 * Volta do Google.
 *
 * O `state` e' o que impede um estranho de completar o consentimento DELE
 * contra o nosso client_id e nos entregar o refresh token da conta dele — a
 * ferramenta passaria a operar no Tag Manager de outra pessoa achando que era
 * o nosso. So' vale um state que o painel gerou, atras do Access, e cada um
 * serve uma vez.
 */
oauth.get('/oauth/google/callback', async (c) => {
  const erro = c.req.query('error');
  if (erro) return c.html(pagina('Consentimento recusado', `O Google devolveu: ${escapar(erro)}`), 400);

  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) return c.html(pagina('Faltou informação', 'A volta do Google veio sem código ou sem state.'), 400);

  // uso unico e com prazo: a validade e' conferida aqui porque o D1 nao expira
  // linha sozinho
  const linha = await c.env.DB.prepare(
    `SELECT valor FROM credenciais
     WHERE chave = ? AND atualizado_em >= datetime('now', '-10 minutes')`,
  )
    .bind(`oauth_state:${state}`)
    .first<{ valor: string }>();

  await c.env.DB.prepare('DELETE FROM credenciais WHERE chave = ?')
    .bind(`oauth_state:${state}`)
    .run();

  if (!linha) {
    return c.html(
      pagina('State inválido ou vencido', 'Comece de novo pelo painel. O link do consentimento vale 10 minutos e serve uma vez só.'),
      400,
    );
  }
  const guardado = linha.valor;

  const redirectUri = new URL(c.req.url).origin + CAMINHO_CALLBACK;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: exigir(c.env, 'GOOGLE_ADS_CLIENT_ID'),
      client_secret: exigir(c.env, 'GOOGLE_ADS_CLIENT_SECRET'),
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const j = (await r.json()) as { refresh_token?: string; scope?: string; error_description?: string; error?: string };

  if (!j.refresh_token) {
    // sem `prompt=consent` o Google devolve so' access_token quando ja houve
    // consentimento antes — e' o engano mais comum aqui
    return c.html(
      pagina('O Google não devolveu refresh token', escapar(j.error_description ?? j.error ?? 'sem detalhe')),
      400,
    );
  }

  await c.env.DB.prepare(
    `INSERT INTO credenciais (chave, valor, obtido_por, escopos, atualizado_em)
     VALUES ('gtm_refresh_token', ?, ?, ?, datetime('now'))
     ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor, obtido_por = excluded.obtido_por,
       escopos = excluded.escopos, atualizado_em = datetime('now')`,
  )
    .bind(j.refresh_token, guardado, j.scope ?? null)
    .run();

  console.log(JSON.stringify({ acao: 'oauth_gtm_concluido', por: guardado }));
  return c.html(
    pagina(
      'Pronto',
      'O acesso ao Tag Manager foi gravado. Pode fechar esta aba e voltar ao painel.',
    ),
  );
});

function escapar(s: string): string {
  return s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
}

function pagina(titulo: string, corpo: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${titulo}</title>
<style>body{font:15px/1.6 ui-sans-serif,system-ui,sans-serif;max-width:520px;margin:80px auto;padding:0 24px;color:#14181d}
h1{font-size:20px;margin:0 0 8px}p{color:#5a646e}</style>
<h1>${titulo}</h1><p>${corpo}</p>`;
}
