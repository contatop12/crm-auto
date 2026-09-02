import { Hono } from 'hono';
import type { Env } from '../env';
import { verifySignature } from '../domain/signature';
import { registrarEvento, tenantPorSlug } from '../db/queries';

/**
 * Rotas de ingestao.
 *
 * Regra do caminho quente: verificar, gravar, enfileirar, responder 200.
 * Nenhuma chamada externa acontece aqui — o Chatwoot tem timeout curto no
 * webhook e o Worker tem teto de CPU por request. O trabalho real roda no
 * consumidor da fila, que ganha retry e backoff de graca.
 */
export const ingest = new Hono<{ Bindings: Env }>();

/** Enfileira e responde. Falha ao enfileirar nao perde o evento: ele ja esta em `events`. */
async function aceitar(
  env: Env,
  tenantId: number,
  source: 'click' | 'chatwoot' | 'kanban',
  eventType: string,
  payload: string,
  signatureOk: boolean | null,
  motivo?: string,
) {
  const eventId = await registrarEvento(env.DB, {
    tenantId,
    source,
    eventType,
    payload,
    signatureOk,
    motivo,
  });
  await env.QUEUE.send({ eventId, tenantId, source, eventType });
  return eventId;
}

/**
 * Clique / submit do formulario, vindo do GTM via `sendBeacon`.
 * O beacon manda `text/plain`, entao o corpo chega como string crua.
 * Autenticado pela `ingest_key` do tenant, nao por assinatura.
 */
ingest.post('/:slug/click', async (c) => {
  const tenant = await tenantPorSlug(c.env.DB, c.req.param('slug'));
  if (!tenant) return c.json({ ok: false, error: 'tenant desconhecido' }, 404);

  const chave = c.req.query('k') ?? c.req.header('X-Ingest-Key');
  if (chave !== tenant.ingestKey) return c.json({ ok: false, error: 'chave invalida' }, 401);

  const body = await c.req.text();
  let protocolo = '';
  try {
    protocolo = String((JSON.parse(body) as { protocol?: string }).protocol ?? '');
  } catch {
    /* corpo nao-json e' registrado do mesmo jeito, para o painel mostrar o lixo recebido */
  }

  await aceitar(c.env, tenant.id, 'click', 'click', body, null);
  return c.json({ ok: true, protocol: protocolo });
});

/**
 * Webhook do Chatwoot. Um endpoint por tenant, com as tres inscricoes
 * (`conversation_created`, `message_incoming`, `message_outgoing`) no mesmo
 * registro — o campo `subscriptions` da API aceita array.
 */
ingest.post('/:slug/chatwoot', async (c) => {
  const tenant = await tenantPorSlug(c.env.DB, c.req.param('slug'));
  if (!tenant) return c.json({ ok: false, error: 'tenant desconhecido' }, 404);

  const raw = await c.req.text();

  if (tenant.cwWebhookSecret) {
    const r = await verifySignature({
      secret: tenant.cwWebhookSecret,
      signatureHeader: c.req.header('X-Chatwoot-Signature'),
      timestampHeader: c.req.header('X-Chatwoot-Timestamp'),
      rawBody: raw,
    });
    if (!r.valid) {
      // Registra a tentativa recusada: ataque e webhook mal configurado tem a
      // mesma cara no log se a gente nao guardar o motivo.
      await registrarEvento(c.env.DB, {
        tenantId: tenant.id,
        source: 'chatwoot',
        eventType: 'assinatura_invalida',
        payload: raw.slice(0, 2000),
        signatureOk: false,
        motivo: r.reason,
        status: 'erro',
      });
      return c.json({ ok: false, error: r.reason }, 401);
    }
  }

  let evento = 'desconhecido';
  try {
    evento = String((JSON.parse(raw) as { event?: string }).event ?? 'desconhecido');
  } catch {
    /* payload ilegivel ainda vai para o log */
  }

  await aceitar(c.env, tenant.id, 'chatwoot', evento, raw, tenant.cwWebhookSecret ? true : null);
  return c.json({ ok: true });
});

/**
 * Sondagem de alcance, para o painel conferir se o Access ainda cobre /ingest
 * antes de registrar o webhook no Chatwoot.
 *
 * Existe porque a sondagem antiga era um POST vazio na rota real: dava 401 por
 * falta de assinatura — correto — e gravava um evento de ERRO, que aparecia no
 * painel como se o cliente estivesse quebrado. Diagnostico que inventa o
 * problema que foi diagnosticar.
 *
 * Nao grava evento e nao devolve nada sobre o cliente: so' prova que a rota
 * chega ao Worker em vez de cair na tela de login.
 */
ingest.get('/:slug/ping', (c) => c.body(null, 204));

/**
 * Mudanca de etapa do Kanban, disparada pelas regras de automacao do Chatwoot
 * ("Evento Qualificado 1", "Evento Compra", ...). O conjunto de regras muda de
 * cliente para cliente, por isso a rota nao assume nada sobre o corpo.
 */
ingest.post('/:slug/kanban', async (c) => {
  const tenant = await tenantPorSlug(c.env.DB, c.req.param('slug'));
  if (!tenant) return c.json({ ok: false, error: 'tenant desconhecido' }, 404);

  const chave = c.req.query('k') ?? c.req.header('X-Ingest-Key');
  if (chave !== tenant.ingestKey) return c.json({ ok: false, error: 'chave invalida' }, 401);

  const raw = await c.req.text();
  await aceitar(c.env, tenant.id, 'kanban', 'kanban_task', raw, null);
  return c.json({ ok: true });
});
