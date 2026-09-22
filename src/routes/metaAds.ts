import { Hono } from 'hono';
import type { Env } from '../env';
import type { AccessIdentity } from '../middleware/access';
import { conectarWebhook, estadoDosWebhooks, restaurarWebhook } from '../pipelines/webhookEvolution';

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
