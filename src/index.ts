import { Hono } from 'hono';
import type { Env, QueueMessage } from './env';
import { ingest } from './routes/ingest';
import { api } from './routes/api';
import { consumir } from './queue/consumer';

const app = new Hono<{ Bindings: Env }>();

/**
 * Health check publico. NAO expoe configuracao de cliente — so diz se o Worker
 * subiu e se o banco responde.
 */
app.get('/health', async (c) => {
  let db = 'erro';
  try {
    await c.env.DB.prepare('SELECT 1').first();
    db = 'ok';
  } catch {
    /* deixa 'erro' */
  }
  return c.json({ ok: db === 'ok', db, env: c.env.ENVIRONMENT ?? 'desconhecido' });
});

app.route('/ingest', ingest);
app.route('/api', api);

// Qualquer outra rota e' o painel (SPA).
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  queue: (batch: MessageBatch<QueueMessage>, env: Env) => consumir(batch, env),
};
