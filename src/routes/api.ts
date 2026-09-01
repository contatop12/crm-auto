import { Hono } from 'hono';
import type { Env } from '../env';
import { requireAccess, type AccessIdentity } from '../middleware/access';
import { listarTenants } from '../db/queries';
import {
  resumoPorTenant,
  eventosDoTenant,
  payloadDoEvento,
  type ResumoTenant,
} from '../db/observability';
import { maskPayload } from '../domain/mask';
import { checarTenant, type TenantParaChecagem } from '../health/checks';
import { ChatwootClient } from '../clients/chatwoot';

/**
 * API do painel. Tudo aqui passa pelo `requireAccess` — o Access na frente do
 * Worker nao basta, porque quem souber a URL fala com o Worker direto.
 */
export const api = new Hono<{ Bindings: Env; Variables: { identity: AccessIdentity } }>();

api.use('*', requireAccess);

api.get('/me', (c) => {
  const id = c.get('identity');
  return c.json({
    ...id,
    // `modo` deixa visivel COMO a sessao foi validada. 'claims' significa que a
    // assinatura nao pode ser conferida (chave rotacionada ou KV sem as chaves)
    // e a autenticidade esta vindo so da barreira do Access na borda.
    aviso:
      id.modo === 'aberto'
        ? 'painel aberto: PANEL_PUBLIC esta ligado, nao ha autenticacao'
        : id.modo === 'claims'
          ? 'assinatura nao conferida: resemeie jwks:access no KV'
          : null,
  });
});

/** Cadastro cru dos clientes. */
api.get('/tenants', async (c) => c.json(await listarTenants(c.env.DB)));

/**
 * Tela inicial: uma linha por cliente com volume, erros e ultima atividade.
 * `saude` fica de fora de proposito — bater em 4 integracoes vezes N clientes
 * tornaria a abertura do painel lenta e ruidosa. A saude e' sob demanda.
 */
api.get('/overview', async (c) => {
  const linhas = await resumoPorTenant(c.env.DB);
  return c.json(
    linhas.map((l: ResumoTenant) => ({
      ...l,
      // um cliente ativo sem nenhum evento em 24h e' suspeito, mas nao e' erro:
      // pode ser fim de semana. A tela mostra, quem julga e' voce.
      sinal:
        l.erros_24h > 0 ? 'erro'
        : l.recebidos_24h === 0 ? 'silencio'
        : 'ok',
    })),
  );
});

async function tenantParaChecagem(
  db: D1Database,
  id: number,
): Promise<TenantParaChecagem | null> {
  return db
    .prepare(
      `SELECT t.id, t.slug, t.nome,
              c.cw_account_id       AS cwAccountId,
              c.cw_board_funil_id   AS cwBoardFunilId,
              c.cw_board_organico_id AS cwBoardOrganicoId,
              c.ga_customer_id      AS gaCustomerId,
              c.evo_instancia       AS evoInstancia
       FROM tenants t LEFT JOIN tenant_config c ON c.tenant_id = t.id
       WHERE t.id = ?`,
    )
    .bind(id)
    .first<TenantParaChecagem>();
}

/** Checagens ao vivo das integracoes de um cliente. Sob demanda: bate na rede. */
api.get('/tenants/:id/health', async (c) => {
  const t = await tenantParaChecagem(c.env.DB, Number(c.req.param('id')));
  if (!t) return c.json({ error: 'cliente nao encontrado' }, 404);

  const checagens = await checarTenant(c.env, t, new URL(c.req.url).origin);
  return c.json({
    tenant: { id: t.id, slug: t.slug, nome: t.nome },
    checado_em: new Date().toISOString(),
    resumo: {
      erro: checagens.filter((x) => x.estado === 'erro').length,
      aviso: checagens.filter((x) => x.estado === 'aviso').length,
      ok: checagens.filter((x) => x.estado === 'ok').length,
    },
    checagens,
  });
});

/** Ultimos webhooks recebidos deste cliente. Sem payload — so a lista. */
api.get('/tenants/:id/events', async (c) => {
  const tenantId = Number(c.req.param('id'));
  return c.json(
    await eventosDoTenant(c.env.DB, tenantId, {
      status: c.req.query('status'),
      source: c.req.query('source'),
      limite: Number(c.req.query('limit') ?? 50),
    }),
  );
});

/**
 * Corpo de um webhook recebido.
 *
 * Mascarado por padrao: telefone, e-mail e o texto das mensagens sao dados dos
 * leads dos clientes, e ler isso nao faz parte de operar a ferramenta.
 * `?revelar=1` devolve o original — acao deliberada, registrada no log.
 */
api.get('/tenants/:id/events/:eventId/payload', async (c) => {
  const tenantId = Number(c.req.param('id'));
  const eventId = Number(c.req.param('eventId'));

  const linha = await payloadDoEvento(c.env.DB, tenantId, eventId);
  if (!linha) return c.json({ error: 'evento nao encontrado' }, 404);
  if (!linha.payload) {
    return c.json({
      mascarado: true,
      expirado: true,
      payload: '',
      motivo: 'corpo expirado pela limpeza de 30 dias; a linha do evento permanece',
    });
  }

  const revelar = c.req.query('revelar') === '1';
  if (revelar) {
    console.log(
      JSON.stringify({
        acao: 'revelar_payload',
        por: c.get('identity').email,
        tenant_id: tenantId,
        event_id: eventId,
        em: new Date().toISOString(),
      }),
    );
  }

  return c.json({
    mascarado: !revelar,
    expirado: false,
    received_at: linha.received_at,
    payload: revelar ? linha.payload : maskPayload(linha.payload),
  });
});

/**
 * Webhooks do Chatwoot desta conta.
 *
 * Mostra TODOS — os do n8n e o do painel. Os do n8n nao sao tocados: rodar os
 * dois em paralelo e' justamente o que permite o painel coletar sem tirar os
 * leads do fluxo que hoje funciona.
 */
api.get('/tenants/:id/webhooks', async (c) => {
  const t = await tenantParaChecagem(c.env.DB, Number(c.req.param('id')));
  if (!t) return c.json({ error: 'cliente nao encontrado' }, 404);
  if (!t.cwAccountId) return c.json({ error: 'cliente sem conta do Chatwoot' }, 400);

  const nosso = `/ingest/${t.slug}/chatwoot`;
  const whs = await ChatwootClient.fromEnv(c.env).webhooks(t.cwAccountId);

  return c.json({
    url_do_painel: new URL(c.req.url).origin + nosso,
    webhooks: whs.map((w) => ({
      id: w.id,
      nome: w.name || '',
      url: w.url,
      destino: (() => { try { return new URL(w.url).host; } catch { return w.url; } })(),
      subscriptions: w.subscriptions,
      do_painel: w.url.includes(nosso),
    })),
  });
});

/** As tres inscricoes que o motor consome. */
const INSCRICOES = ['conversation_created', 'message_incoming', 'message_outgoing'];

/** Nome do webhook na tela do Chatwoot. Segue o padrao dos do n8n. */
const NOME_WEBHOOK = '[CRM PAINEL] Chatwoot Trigger - GERAL';

/**
 * Registra o webhook do painel, ADICIONANDO aos que ja existem.
 * Guarda o `secret` devolvido pelo Chatwoot — e' com ele que a rota de
 * ingestao confere a assinatura HMAC de cada evento.
 */
api.post('/tenants/:id/webhook', async (c) => {
  const t = await tenantParaChecagem(c.env.DB, Number(c.req.param('id')));
  if (!t) return c.json({ error: 'cliente nao encontrado' }, 404);
  if (!t.cwAccountId) return c.json({ error: 'cliente sem conta do Chatwoot' }, 400);

  const cw = ChatwootClient.fromEnv(c.env);
  const caminho = `/ingest/${t.slug}/chatwoot`;
  const url = new URL(c.req.url).origin + caminho;

  // Se ja existe um apontando para ca — criado a mao, por exemplo — adota em vez
  // de recusar: sem o secret guardado a ingestao aceitaria os eventos SEM
  // conferir a assinatura, que e' pior do que nao ter webhook.
  const jaExiste = (await cw.webhooks(t.cwAccountId)).find((w) => w.url === url);
  if (jaExiste) {
    if (jaExiste.secret) {
      await c.env.DB.prepare('UPDATE tenant_config SET cw_webhook_secret = ? WHERE tenant_id = ?')
        .bind(jaExiste.secret, t.id)
        .run();
    }
    const faltam = INSCRICOES.filter((i) => !jaExiste.subscriptions.includes(i));
    return c.json({
      ok: true,
      adotado: true,
      webhook_id: jaExiste.id,
      url,
      subscriptions: jaExiste.subscriptions,
      assinatura: jaExiste.secret ? 'guardada' : 'este webhook nao tem secret; a ingestao aceitara sem assinatura',
      aviso: faltam.length ? `faltam inscricoes: ${faltam.join(', ')}` : null,
    });
  }

  const w = await cw.criarWebhook(t.cwAccountId, url, INSCRICOES, NOME_WEBHOOK);

  // Sem o secret guardado, a rota de ingestao nao consegue validar a assinatura
  // e recusaria todo evento com 401.
  if (w.secret) {
    await c.env.DB.prepare('UPDATE tenant_config SET cw_webhook_secret = ? WHERE tenant_id = ?')
      .bind(w.secret, t.id)
      .run();
  }

  console.log(
    JSON.stringify({ acao: 'registrar_webhook', por: c.get('identity').email, tenant: t.slug, webhook_id: w.id }),
  );

  return c.json({
    ok: true,
    webhook_id: w.id,
    url,
    subscriptions: w.subscriptions,
    assinatura: w.secret ? 'guardada' : 'o Chatwoot nao devolveu secret; a ingestao aceitara sem assinatura',
  });
});

/** Remove o webhook do painel. Os do n8n ficam. */
api.delete('/tenants/:id/webhook', async (c) => {
  const t = await tenantParaChecagem(c.env.DB, Number(c.req.param('id')));
  if (!t) return c.json({ error: 'cliente nao encontrado' }, 404);
  if (!t.cwAccountId) return c.json({ error: 'cliente sem conta do Chatwoot' }, 400);

  const cw = ChatwootClient.fromEnv(c.env);
  const caminho = `/ingest/${t.slug}/chatwoot`;
  const nosso = (await cw.webhooks(t.cwAccountId)).find((w) => w.url.includes(caminho));
  if (!nosso) return c.json({ error: 'o webhook do painel nao esta registrado' }, 404);

  await cw.apagarWebhook(t.cwAccountId, nosso.id);
  await c.env.DB.prepare('UPDATE tenant_config SET cw_webhook_secret = NULL WHERE tenant_id = ?')
    .bind(t.id)
    .run();

  console.log(
    JSON.stringify({ acao: 'remover_webhook', por: c.get('identity').email, tenant: t.slug, webhook_id: nosso.id }),
  );

  return c.json({ ok: true, removido: nosso.id });
});
