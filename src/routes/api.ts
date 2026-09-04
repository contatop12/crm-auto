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
import { maskPayload, maskPhone } from '../domain/mask';
import { resumirEvento, encurtarNome } from '../domain/resumoEvento';
import { checarTenant, type TenantParaChecagem } from '../health/checks';
import { ChatwootClient } from '../clients/chatwoot';
import { TagManagerClient } from '../clients/tagManager';
import { conferirNoChatwoot, conferirNoGtm, type Veredito } from '../domain/conferencia';

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
      //
      // Erro so' conta enquanto for a ULTIMA palavra. A Vita ficou "com erro"
      // por um Pulseboard que falhou as 22h de ontem, com o roteamento antigo
      // por codi_id — e processou mais de cem eventos sem falha depois disso.
      // Contar erro da janela de 24h sem olhar o que veio DEPOIS deixa o
      // cliente vermelho por um problema que ja' foi resolvido, e treina quem
      // olha a tela a ignorar o vermelho.
      sinal:
        l.erros_24h > 0 && !maisRecente(l.ultimo_ok_em, l.ultimo_erro_em) ? 'erro'
        : l.recebidos_24h === 0 ? 'silencio'
        : 'ok',
      // o erro continua visivel, mas datado: sem a data, um erro de ontem se
      // parece com um de agora
      erro_superado: l.erros_24h > 0 && maisRecente(l.ultimo_ok_em, l.ultimo_erro_em),
    })),
  );
});

/** `a` aconteceu depois de `b`? Sem `a`, nao. Sem `b`, sim. */
function maisRecente(a: string | null, b: string | null): boolean {
  if (!a) return false;
  if (!b) return true;
  return a > b;
}

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

  // Os boards dizem se o lead veio de anuncio ou do organico; sem eles o
  // resumo ainda sai, so' sem essa coluna.
  const boards = await c.env.DB.prepare(
    `SELECT cw_board_organico_id AS organico, cw_board_funil_id AS funil
     FROM tenant_config WHERE tenant_id = ?`,
  )
    .bind(tenantId)
    .first<{ organico: number | null; funil: number | null }>();

  return c.json(
    await eventosDoTenant(
      c.env.DB,
      tenantId,
      {
        status: c.req.query('status'),
        source: c.req.query('source'),
        limite: Number(c.req.query('limit') ?? 25),
        offset: Number(c.req.query('offset') ?? 0),
      },
      boards ?? { organico: null, funil: null },
    ),
  );
});

/**
 * O que subiu para o Google Ads, e o que nao subiu.
 *
 * A tela de webhooks responde o que CHEGOU; esta responde o que SAIU. Sao
 * perguntas diferentes e ate' agora so' a primeira tinha resposta — dava para
 * ver o evento entrar e nao dava para ver a conversao sair, que e' o unico
 * ponto onde o trabalho todo vira resultado na conta do cliente.
 */
api.get('/tenants/:id/conversoes', async (c) => {
  const id = Number(c.req.param('id'));
  const limite = Math.min(Math.max(Number(c.req.query('limit') ?? 25), 1), 200);
  const offset = Math.max(Number(c.req.query('offset') ?? 0), 0);

  const { results } = await c.env.DB.prepare(
    `SELECT v.id, v.dedupe_key, v.protocol, v.conversion_event, v.conversion_action,
            v.conversion_value, v.currency, v.match_type, v.status, v.validate_only,
            v.request_id, v.erro, v.event_at, v.sent_at, v.created_at,
            f.nome AS etapa, f.ca_nome AS meta
     FROM conversions v
     LEFT JOIN funnel_stages f
       ON f.tenant_id = v.tenant_id AND f.conversion_action_id = v.conversion_action
     WHERE v.tenant_id = ?
     ORDER BY v.id DESC LIMIT ? OFFSET ?`,
  )
    .bind(id, limite, offset)
    .all();

  const t = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'enviado' AND validate_only = 0 THEN 1 ELSE 0 END) AS contabilizadas,
            SUM(CASE WHEN status = 'enviado' AND validate_only = 1 THEN 1 ELSE 0 END) AS ensaios,
            SUM(CASE WHEN status = 'erro' THEN 1 ELSE 0 END) AS erros,
            SUM(CASE WHEN status = 'ignorado' THEN 1 ELSE 0 END) AS ignoradas,
            SUM(CASE WHEN status = 'enviado' AND validate_only = 0 THEN conversion_value ELSE 0 END) AS valor
     FROM conversions WHERE tenant_id = ?`,
  )
    .bind(id)
    .first<Record<string, number | null>>();

  return c.json({
    linhas: results,
    total: Number(t?.total ?? 0),
    limite,
    offset,
    resumo: {
      contabilizadas: Number(t?.contabilizadas ?? 0),
      ensaios: Number(t?.ensaios ?? 0),
      erros: Number(t?.erros ?? 0),
      ignoradas: Number(t?.ignoradas ?? 0),
      valor: Number(t?.valor ?? 0),
    },
  });
});

/**
 * Se cada endereco de ingestao ja recebeu alguma coisa.
 *
 * Chave valida prova que o endereco ABRE; isto prova que ele E' USADO. Sao
 * perguntas diferentes: a URL pode estar perfeita e ninguem ter colado ela no
 * GTM ainda, que e' exatamente o caso de dois dos quatro clientes.
 */
api.get('/tenants/:id/ingest-status', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT source, event_type,
            COUNT(*) AS total,
            MAX(received_at) AS ultimo,
            SUM(CASE WHEN received_at >= datetime('now','-1 day') THEN 1 ELSE 0 END) AS em_24h,
            SUM(CASE WHEN status = 'erro' THEN 1 ELSE 0 END) AS erros
     FROM events WHERE tenant_id = ?
     GROUP BY source, event_type`,
  )
    .bind(Number(c.req.param('id')))
    .all<{ source: string; event_type: string; total: number; ultimo: string; em_24h: number; erros: number }>();

  const junta = (f: (l: (typeof results)[0]) => boolean) => {
    const linhas = results.filter(f);
    return {
      total: linhas.reduce((s, l) => s + l.total, 0),
      em_24h: linhas.reduce((s, l) => s + l.em_24h, 0),
      erros: linhas.reduce((s, l) => s + l.erros, 0),
      ultimo: linhas.map((l) => l.ultimo).sort().pop() ?? null,
    };
  };

  return c.json({
    click: junta((l) => l.source === 'click'),
    chatwoot: junta((l) => l.source === 'chatwoot'),
    kanban_entrada: junta((l) => l.event_type === 'kanban_entrada'),
    kanban_conversao: junta((l) => l.event_type === 'kanban_conversao'),
  });
});

/**
 * O outro lado esta' mesmo apontando para ca'?
 *
 * A terceira pergunta, que faltava. `/ping` prova que a chave ABRE a porta;
 * `ingest-status` prova que alguem JA' USOU o endereco. Nenhuma das duas
 * explica um "nunca recebeu" — que pode ser endereco nao colado, colado com a
 * chave antiga, ou regra desligada. Sao tres consertos diferentes, e a tela
 * mostrava os tres com a mesma frase.
 *
 * Le' a conta do cliente ao vivo. Uma checagem que confia no nosso proprio
 * banco nao serviria: o que se quer saber e' justamente o que esta' do outro
 * lado.
 */
api.get('/tenants/:id/webhooks/conferir', async (c) => {
  const id = Number(c.req.param('id'));
  const cfg = await c.env.DB.prepare(
    `SELECT t.slug, c.cw_account_id, c.ingest_key, c.gtm_account_id, c.gtm_container_id
     FROM tenants t LEFT JOIN tenant_config c ON c.tenant_id = t.id WHERE t.id = ?`,
  )
    .bind(id)
    .first<{
      slug: string; cw_account_id: number | null; ingest_key: string | null;
      gtm_account_id: string | null; gtm_container_id: string | null;
    }>();

  if (!cfg?.ingest_key) return c.json({ error: 'cliente sem chave de ingestao' }, 400);

  const base = `${new URL(c.req.url).origin}/ingest/${cfg.slug}`;
  const k = `?k=${encodeURIComponent(cfg.ingest_key)}`;

  // Contas diferentes, uma nao depende da outra: vao juntas.
  const [gtm, chatwoot] = await Promise.all([
    lerGtm(c.env, cfg, `${base}/click${k}`),
    lerRegrasDoChatwoot(c.env, cfg.cw_account_id),
  ]);

  return c.json({
    click: gtm,
    kanban_entrada: chatwoot(`${base}/kanban${k}`),
    kanban_conversao: chatwoot(`${base}/kanban${k}&evento=conversao`),
  });
});

interface CfgConferencia {
  gtm_account_id: string | null;
  gtm_container_id: string | null;
}

async function lerGtm(env: Env, cfg: CfgConferencia, esperada: string): Promise<Veredito> {
  try {
    if (!cfg.gtm_account_id || !cfg.gtm_container_id) {
      return { estado: 'falta', detalhe: 'cliente sem container do GTM no cadastro' };
    }
    const tm = await TagManagerClient.deD1(env);
    if (!tm) return { estado: 'falta', detalhe: 'Tag Manager sem autorizacao — veja Acesso Google' };

    const ws = await tm.workspacePadrao(cfg.gtm_account_id, cfg.gtm_container_id);
    const valor = await tm.valorDaConstante(
      cfg.gtm_account_id, cfg.gtm_container_id, ws.workspaceId, '00 - [P12] COLLECT URL',
    );
    return conferirNoGtm(esperada, valor);
  } catch (e) {
    // nao conseguir LER a conta e' diferente de a conta estar errada
    return { estado: 'erro', detalhe: `nao deu para ler o GTM: ${(e as Error).message.slice(0, 160)}` };
  }
}

/**
 * Devolve uma funcao que julga qualquer endereco contra as regras da conta.
 *
 * As regras sao lidas UMA vez e reaproveitadas para os dois enderecos do
 * Kanban — sao a mesma lista, e pedir duas vezes so' dobraria a chamada.
 */
async function lerRegrasDoChatwoot(
  env: Env,
  accountId: number | null,
): Promise<(alvo: string) => Veredito> {
  if (!accountId) {
    return () => ({ estado: 'falta', detalhe: 'cliente sem conta do Chatwoot no cadastro' });
  }
  try {
    const regras = await ChatwootClient.fromEnv(env).automacoes(accountId);
    return (alvo) => conferirNoChatwoot(alvo, regras);
  } catch (e) {
    const msg = (e as Error).message.slice(0, 160);
    return () => ({ estado: 'erro', detalhe: `nao deu para ler o Chatwoot: ${msg}` });
  }
}

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
    // o mesmo resumo da lista, para nao ter que garimpar o json atras de quem e'
    resumo: resumirEvento(linha.payload),
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

/** Avisos de lead novo mandados ao grupo do cliente. */
api.get('/tenants/:id/avisos', async (c) => {
  const id = Number(c.req.param('id'));
  const limite = Math.min(Math.max(Number(c.req.query('limit') ?? 25), 1), 200);
  const offset = Math.max(Number(c.req.query('offset') ?? 0), 0);

  const total = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM group_notifications WHERE tenant_id = ?',
  )
    .bind(id)
    .first<{ n: number }>();

  const { results } = await c.env.DB.prepare(
    `SELECT chave, protocolo, canal, lead_nome, telefone, status, erro, enviado_em, created_at
     FROM group_notifications WHERE tenant_id = ?
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(id, limite, offset)
    .all<{ lead_nome: string | null; telefone: string | null }>();

  // Mesma regra do payload e da lista de eventos: o nome do lead e o telefone
  // sao dados do cliente, e o painel junta todos eles numa tela so'.
  return c.json({
    total: total?.n ?? 0,
    limite,
    offset,
    linhas: results.map((l) => ({
      ...l,
      lead_nome: encurtarNome(l.lead_nome),
      telefone: maskPhone(l.telefone),
    })),
  });
});
