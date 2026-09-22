import { Hono } from 'hono';
import type { Env } from '../env';
import type { AccessIdentity } from '../middleware/access';
import { conectarWebhook, estadoDosWebhooks, restaurarWebhook } from '../pipelines/webhookEvolution';
import {
  etapasMeta, lerConfigMeta, listarEventosMeta, salvarConfigMeta, salvarEventosDasEtapas, verificarConfigMeta,
  type EntradaConfigMeta,
} from '../pipelines/metaConfig';
import { reenviarFalhasMeta } from '../pipelines/metaCapi';

/**
 * Meta Ads no perfil do cliente: o webhook da Evolution (de onde vem o clique
 * do anuncio) e a conexao com a Conversions API.
 *
 * Montado dentro de `admin` (`admin.route('/', metaAds)`), atras do mesmo
 * Access. A regra fica nos pipelines; aqui so' se traduz para HTTP.
 */
export const metaAds = new Hono<{ Bindings: Env; Variables: { identity: AccessIdentity } }>();

/** O endereco do proprio CRM, para montar a URL que vai para a Evolution. */
const origemDe = (url: string) => new URL(url).origin;

interface PedidoInstancia {
  instancia?: string;
  confirmar?: boolean;
}

metaAds.get('/tenants/:id/evolution/webhook', async (c) => {
  const instancias = await estadoDosWebhooks(c.env, Number(c.req.param('id')), origemDe(c.req.url));
  return c.json({ instancias });
});

metaAds.post('/tenants/:id/evolution/webhook', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json<PedidoInstancia>().catch((): PedidoInstancia => ({}));
  const r = await conectarWebhook(c.env, id, origemDe(c.req.url), {
    instancia: String(b.instancia ?? ''),
    confirmar: b.confirmar === true,
  });
  console.log(JSON.stringify({
    acao: 'conectar_evolution', por: c.get('identity')?.email, tenant_id: id, instancia: b.instancia, ok: r.ok,
  }));
  if (!r.ok) return c.json({ error: r.error, host: r.host ?? null }, r.status);
  return c.json(r);
});

metaAds.post('/tenants/:id/evolution/webhook/restaurar', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json<PedidoInstancia>().catch((): PedidoInstancia => ({}));
  const r = await restaurarWebhook(c.env, id, String(b.instancia ?? ''));
  console.log(JSON.stringify({
    acao: 'restaurar_evolution', por: c.get('identity')?.email, tenant_id: id, instancia: b.instancia, ok: r.ok,
  }));
  if (!r.ok) return c.json({ error: r.error, host: r.host ?? null }, r.status);
  return c.json(r);
});

// ---------------------------------------------------------------------------
// Conversions API: cadastro, eventos por etapa e log
// ---------------------------------------------------------------------------

metaAds.get('/tenants/:id/meta', async (c) => {
  const cfg = await lerConfigMeta(c.env.DB, Number(c.req.param('id')));
  return cfg ? c.json(cfg) : c.json({ error: 'cliente nao encontrado' }, 404);
});

/** Token so' entra: cifrado aqui mesmo, e nunca devolvido nem registrado em log. */
metaAds.put('/tenants/:id/meta', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json<EntradaConfigMeta>().catch((): EntradaConfigMeta => ({}));
  const r = await salvarConfigMeta(c.env, id, b);
  console.log(JSON.stringify({
    acao: 'config_meta', por: c.get('identity')?.email, tenant_id: id, ok: r.ok,
    campos: Object.keys(b).map((k) => (k === 'token' ? 'token(novo)' : k)),
  }));
  if (!r.ok) return c.json({ error: r.error }, 400);
  return c.json(await lerConfigMeta(c.env.DB, id));
});

metaAds.post('/tenants/:id/meta/verificar', async (c) =>
  c.json(await verificarConfigMeta(c.env, Number(c.req.param('id')))),
);

metaAds.get('/tenants/:id/meta/etapas', async (c) => c.json(await etapasMeta(c.env.DB, Number(c.req.param('id')))));

metaAds.put('/tenants/:id/meta/etapas', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json<{ etapas?: Record<string, unknown> }>().catch(() => ({ etapas: {} }));
  const r = await salvarEventosDasEtapas(c.env.DB, id, b.etapas ?? {});
  console.log(JSON.stringify({ acao: 'etapas_meta', por: c.get('identity')?.email, tenant_id: id, ok: r.ok }));
  if (!r.ok) return c.json({ error: r.error }, 400);
  return c.json(r);
});

metaAds.get('/tenants/:id/meta/eventos', async (c) => {
  const limite = Math.min(Math.max(Number(c.req.query('limit')) || 25, 1), 200);
  const offset = Math.max(Number(c.req.query('offset')) || 0, 0);
  return c.json(await listarEventosMeta(c.env.DB, Number(c.req.param('id')), limite, offset));
});

metaAds.post('/tenants/:id/meta/eventos/reenviar', async (c) => {
  const id = Number(c.req.param('id'));
  const r = await reenviarFalhasMeta(c.env, id);
  console.log(JSON.stringify({ acao: 'reenviar_meta', por: c.get('identity')?.email, tenant_id: id, na_fila: r.na_fila }));
  return c.json(r);
});
