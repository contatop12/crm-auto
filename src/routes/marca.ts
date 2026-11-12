import { Hono } from 'hono';
import type { Env } from '../env';

/**
 * Logo do painel de atendimento (panel/marca/). O Chatwoot guarda so' o endereco
 * (InstallationConfig LOGO, LOGO_DARK, LOGO_THUMBNAIL) e o navegador do atendente
 * busca aqui, sem sessao do Access: por isso sob /ingest, como o script do painel.
 *
 * Lista fechada: e' uma porta publica, e a pasta de assets tem o painel inteiro.
 */
export const marca = new Hono<{ Bindings: Env }>();

const ARQUIVOS = new Set(['logo.svg', 'logo_dark.svg', 'logo_thumbnail.svg', 'logo_thumbnail_aviso.svg']);

marca.get('/:arquivo', async (c) => {
  const nome = c.req.param('arquivo');
  if (!ARQUIVOS.has(nome)) return c.text('', 404);
  const r = await c.env.ASSETS.fetch(new Request(new URL(`/marca/${nome}`, c.req.url)));
  if (!r.ok) return c.text('', 404);
  return new Response(r.body, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      // Trocar a logo vale em ate' uma hora, sem mexer no Chatwoot.
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
