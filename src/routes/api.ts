import { Hono } from 'hono';
import type { Env } from '../env';
import { requireAccess, type AccessIdentity } from '../middleware/access';
import { listarEventos, listarTenants } from '../db/queries';

/**
 * API do painel. Tudo aqui exige um JWT valido do Cloudflare Access —
 * o Access na frente do Worker nao basta: quem souber a URL fala direto.
 */
export const api = new Hono<{ Bindings: Env; Variables: { identity: AccessIdentity } }>();

api.use('*', requireAccess);

api.get('/me', (c) => c.json(c.get('identity')));

api.get('/tenants', async (c) => c.json(await listarTenants(c.env.DB)));

api.get('/events', async (c) => {
  const tenantId = c.req.query('tenant_id');
  const limite = Math.min(Number(c.req.query('limit') ?? 100), 500);
  return c.json(await listarEventos(c.env.DB, tenantId ? Number(tenantId) : null, limite));
});
