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
