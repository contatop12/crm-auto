import { Hono } from 'hono';
import type { Env } from '../env';
import { requireAccess, type AccessIdentity } from '../middleware/access';
import { ChatwootClient } from '../clients/chatwoot';
import { GoogleAdsClient, criarConversionActions } from '../clients/googleAds';
import { validarCliente, gerarIngestKey } from '../domain/tenantInput';
import { proporMetas, metasForaDoCatalogo, type MetaProposta } from '../domain/metas';
import { avaliarEtapa } from '../domain/fluxo';

/**
 * Cadastro de clientes, sincronizacao das etapas e geracao das metas de
 * conversao. Tudo atras do Cloudflare Access, como o resto do painel.
 */
export const admin = new Hono<{ Bindings: Env; Variables: { identity: AccessIdentity } }>();

admin.use('*', requireAccess);

// ---------------------------------------------------------------------------
// Listas auxiliares: o cadastro vira escolha em vez de digitacao de ID
// ---------------------------------------------------------------------------

admin.get('/chatwoot/accounts', async (c) => {
  const perfil = await ChatwootClient.fromEnv(c.env).perfil();
  return c.json((perfil.accounts ?? []).map((a) => ({ id: a.id, nome: a.name })));
});

admin.get('/chatwoot/accounts/:acc/boards', async (c) => {
  const boards = await ChatwootClient.fromEnv(c.env).boards(Number(c.req.param('acc')));
  return c.json(
    boards.map((b) => ({ id: b.id, nome: b.name.trim(), tarefas: b.total_tasks_count ?? 0 })),
  );
});

admin.get('/google-ads/accounts', async (c) =>
  c.json(await GoogleAdsClient.fromEnv(c.env).contasDoMcc()),
);

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

const CAMPOS_CONFIG = [
  'cw_account_id',
  'cw_board_funil_id',
  'cw_board_organico_id',
  'ga_customer_id',
  'evo_instancia',
  'pulseboard_codi_id',
  'validate_only',
  'janela_match_dias',
] as const;

admin.get('/tenants/:id/config', async (c) => {
  const t = await c.env.DB.prepare(
    `SELECT t.id, t.slug, t.nome, t.ativo, c.cw_account_id, c.cw_board_funil_id,
            c.cw_board_organico_id, c.ga_customer_id, c.evo_instancia,
            c.pulseboard_codi_id, c.validate_only, c.janela_match_dias, c.ingest_key,
            CASE WHEN c.cw_webhook_secret IS NULL THEN 0 ELSE 1 END AS tem_segredo_webhook
     FROM tenants t LEFT JOIN tenant_config c ON c.tenant_id = t.id WHERE t.id = ?`,
  )
    .bind(Number(c.req.param('id')))
    .first();
  return t ? c.json(t) : c.json({ error: 'cliente nao encontrado' }, 404);
});

admin.post('/tenants', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const entrada = {
    nome: String(body.nome ?? ''),
    slug: String(body.slug ?? ''),
    cw_account_id: Number(body.cw_account_id) || null,
    cw_board_funil_id: Number(body.cw_board_funil_id) || null,
    cw_board_organico_id: Number(body.cw_board_organico_id) || null,
  };

  const { erros, slug } = validarCliente(entrada);
  if (erros.length) return c.json({ error: erros.join(' · '), erros }, 400);

  const repetido = await c.env.DB.prepare('SELECT id FROM tenants WHERE slug = ?')
    .bind(slug)
    .first();
  if (repetido) return c.json({ error: `ja existe um cliente com o endereco "${slug}"` }, 409);

  const t = await c.env.DB.prepare(
    'INSERT INTO tenants (slug, nome, ativo) VALUES (?, ?, 1) RETURNING id',
  )
    .bind(slug, entrada.nome.trim())
    .first<{ id: number }>();

  await c.env.DB.prepare(
    `INSERT INTO tenant_config
       (tenant_id, cw_account_id, cw_board_funil_id, cw_board_organico_id,
        ga_customer_id, ga_login_customer_id, evo_instancia, pulseboard_codi_id,
        ingest_key, validate_only)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  )
    .bind(
      t!.id,
      entrada.cw_account_id,
      entrada.cw_board_funil_id,
      entrada.cw_board_organico_id,
      String(body.ga_customer_id ?? '') || null,
      c.env.GOOGLE_ADS_MCC_ID,
      String(body.evo_instancia ?? '') || null,
      String(body.pulseboard_codi_id ?? '') || null,
      gerarIngestKey(),
    )
    .run();

  console.log(JSON.stringify({ acao: 'criar_cliente', por: c.get('identity').email, slug }));
  return c.json({ ok: true, id: t!.id, slug }, 201);
});

admin.patch('/tenants/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<Record<string, unknown>>();

  if (typeof body.nome === 'string' && body.nome.trim()) {
    await c.env.DB.prepare("UPDATE tenants SET nome = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(body.nome.trim(), id)
      .run();
  }
  if (body.ativo !== undefined) {
    await c.env.DB.prepare('UPDATE tenants SET ativo = ? WHERE id = ?')
      .bind(body.ativo ? 1 : 0, id)
      .run();
  }

  for (const campo of CAMPOS_CONFIG) {
    if (!(campo in body)) continue;
    const v = body[campo];
    await c.env.DB.prepare(`UPDATE tenant_config SET ${campo} = ? WHERE tenant_id = ?`)
      .bind(v === '' || v === null || v === undefined ? null : (v as string | number), id)
      .run();
  }

  console.log(
    JSON.stringify({ acao: 'editar_cliente', por: c.get('identity').email, tenant_id: id }),
  );
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Etapas — sincronizadas do board, nunca digitadas
// ---------------------------------------------------------------------------

interface TenantMin {
  id: number;
  cwAccountId: number | null;
  cwBoardFunilId: number | null;
  gaCustomerId: string | null;
}

function carregarTenant(db: D1Database, id: number) {
  return db
    .prepare(
      `SELECT t.id, c.cw_account_id AS cwAccountId, c.cw_board_funil_id AS cwBoardFunilId,
              c.ga_customer_id AS gaCustomerId
       FROM tenants t LEFT JOIN tenant_config c ON c.tenant_id = t.id WHERE t.id = ?`,
    )
    .bind(id)
    .first<TenantMin>();
}

admin.post('/tenants/:id/stages/sync', async (c) => {
  const t = await carregarTenant(c.env.DB, Number(c.req.param('id')));
  if (!t) return c.json({ error: 'cliente nao encontrado' }, 404);
  if (!t.cwAccountId || !t.cwBoardFunilId) {
    return c.json({ error: 'cliente sem conta ou board do funil configurado' }, 400);
  }

  const steps = await ChatwootClient.fromEnv(c.env).steps(t.cwAccountId, t.cwBoardFunilId);

  let posicao = 0;
  for (const s of steps) {
    posicao += 1;
    await c.env.DB.prepare(
      `INSERT INTO funnel_stages
         (tenant_id, posicao, nome, cw_step_id, is_final, cw_cancelled, cw_completed, auto_on_reply, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT (tenant_id, cw_step_id) DO UPDATE SET
         posicao = excluded.posicao, nome = excluded.nome, is_final = excluded.is_final,
         cw_cancelled = excluded.cw_cancelled, cw_completed = excluded.cw_completed,
         synced_at = datetime('now')`,
    )
      .bind(
        t.id,
        posicao,
        s.name.trim(),
        s.id,
        s.cancelled || s.completed ? 1 : 0,
        s.cancelled ? 1 : 0,
        s.completed ? 1 : 0,
        // heuristica para a etapa que qualquer resposta do vendedor alcanca;
        // fica editavel depois
        /qualificando/i.test(s.name) ? 1 : 0,
      )
      .run();
  }

  return c.json({ ok: true, etapas: steps.length });
});

admin.get('/tenants/:id/stages', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, posicao, nome, cw_step_id, is_final, auto_on_reply,
            conversion_event, conversion_action_id, conversion_value
     FROM funnel_stages WHERE tenant_id = ? ORDER BY posicao`,
  )
    .bind(Number(c.req.param('id')))
    .all();
  return c.json(results);
});

// ---------------------------------------------------------------------------
// Metas de conversao no Google Ads
// ---------------------------------------------------------------------------

/** Previa do que seria criado. Nao grava nada, nem aqui nem no Google. */
admin.get('/tenants/:id/metas/preview', async (c) => {
  const id = Number(c.req.param('id'));
  const t = await carregarTenant(c.env.DB, id);
  if (!t) return c.json({ error: 'cliente nao encontrado' }, 404);
  if (!t.gaCustomerId) return c.json({ error: 'cliente sem conta do Google Ads' }, 400);

  const { results: stages } = await c.env.DB.prepare(
    `SELECT id, posicao, nome, is_final AS isFinal, auto_on_reply AS autoOnReply
     FROM funnel_stages WHERE tenant_id = ? ORDER BY posicao`,
  )
    .bind(id)
    .all<{ id: number; posicao: number; nome: string; isFinal: number; autoOnReply: number }>();

  // O que ja esta ligado: e' dai que saem as metas fora do catalogo, criadas a
  // mao para este cliente.
  const { results: ligadas } = await c.env.DB.prepare(
    `SELECT id AS stageId, conversion_event AS evento, ca_nome AS nome,
            ca_categoria AS categoria, conversion_value AS valor, ca_primary AS primary_,
            ca_contagem AS contagem, ca_janela_clique AS janelaClique,
            ca_janela_view AS janelaView, conversion_action_id AS actionId
     FROM funnel_stages
     WHERE tenant_id = ? AND conversion_event IS NOT NULL AND ca_nome IS NOT NULL`,
  )
    .bind(id)
    .all<Record<string, string | number | null>>();

  if (!stages.length) {
    return c.json({ error: 'sincronize as etapas do funil antes de gerar as metas' }, 400);
  }

  const existentes = await GoogleAdsClient.fromEnv(c.env).conversionActions(t.gaCustomerId);
  const funil = stages.map((s) => ({
    id: s.id,
    posicao: s.posicao,
    nome: s.nome,
    isFinal: !!s.isFinal,
    autoOnReply: !!s.autoOnReply,
  }));

  return c.json({
    conta: t.gaCustomerId,
    metas: [
      ...proporMetas(funil, existentes),
      ...metasForaDoCatalogo(
        funil,
        ligadas.map((l) => ({
          stageId: Number(l.stageId),
          evento: String(l.evento ?? ''),
          nome: String(l.nome ?? ''),
          categoria: (l.categoria ?? 'QUALIFIED_LEAD') as 'CONTACT' | 'QUALIFIED_LEAD' | 'PURCHASE',
          valor: l.valor === null ? null : Number(l.valor),
          primary: !!l.primary_,
          contagem: (l.contagem ?? 'ONE_PER_CLICK') as 'ONE_PER_CLICK' | 'MANY_PER_CLICK',
          janelaClique: Number(l.janelaClique ?? 30),
          janelaView: Number(l.janelaView ?? 1),
          actionId: l.actionId === null ? null : String(l.actionId),
        })),
        existentes,
      ),
    ],
  });
});

/**
 * Publica as metas na conta do cliente e liga cada uma a sua etapa.
 * Com `validar: true`, o Google confere tudo sem gravar nada.
 */
admin.post('/tenants/:id/metas', async (c) => {
  const id = Number(c.req.param('id'));
  const t = await carregarTenant(c.env.DB, id);
  if (!t) return c.json({ error: 'cliente nao encontrado' }, 404);
  if (!t.gaCustomerId) return c.json({ error: 'cliente sem conta do Google Ads' }, 400);

  const body = await c.req.json<{ metas: MetaProposta[]; validar?: boolean }>();
  const metas = (body.metas ?? []).filter((m) => m && m.nome);
  if (!metas.length) return c.json({ error: 'nenhuma meta selecionada' }, 400);

  // O evento e' a chave de deduplicacao da conversao: sem ele, ou repetido, a
  // mesma venda seria mandada duas vezes ao Google.
  const semEvento = metas.find((m) => !m.evento);
  if (semEvento) return c.json({ error: `meta "${semEvento.nome}" sem evento` }, 400);
  const eventos = metas.map((m) => m.evento);
  const repetido = eventos.find((e, i) => eventos.indexOf(e) !== i);
  if (repetido) return c.json({ error: `duas metas com o evento "${repetido}"` }, 400);

  const cli = GoogleAdsClient.fromEnv(c.env);
  const novas = metas.filter((m) => !m.jaExiste);

  const criadas = novas.length
    ? await criarConversionActions(
        cli,
        t.gaCustomerId,
        novas.map((m) => ({
          nome: m.nome,
          categoria: m.categoria,
          valor: m.valor,
          primary: m.primary,
          contagem: m.contagem,
          janelaClique: m.janelaClique,
          janelaView: m.janelaView,
        })),
        body.validar === true,
      )
    : [];

  if (body.validar === true) {
    return c.json({ ok: true, validado: true, seriam_criadas: novas.length });
  }

  // Ligar meta a etapa e o que faz o funil saber qual conversao mandar.
  const porNome = new Map(criadas.map((r) => [r.nome, r.id]));
  let ligadas = 0;

  for (const m of metas) {
    const actionId = m.jaExiste ? m.idExistente : (porNome.get(m.nome) ?? null);
    if (!actionId || m.stageId === null) continue;

    await c.env.DB.prepare(
      `UPDATE funnel_stages
       SET conversion_event = ?, conversion_action_id = ?, conversion_value = ?,
           ca_nome = ?, ca_categoria = ?, ca_contagem = ?,
           ca_janela_clique = ?, ca_janela_view = ?, ca_primary = ?
       WHERE tenant_id = ? AND id = ?`,
    )
      .bind(
        m.evento, actionId, m.valor, m.nome, m.categoria, m.contagem,
        m.janelaClique, m.janelaView, m.primary ? 1 : 0, id, m.stageId,
      )
      .run();
    ligadas += 1;
  }

  console.log(
    JSON.stringify({
      acao: 'criar_metas',
      por: c.get('identity').email,
      tenant_id: id,
      criadas: criadas.length,
    }),
  );

  return c.json({ ok: true, criadas: criadas.length, ligadas, metas: criadas });
});

/**
 * As cinco etapas que interessam monitorar, na ordem em que o lead passa.
 *
 * Sao etapas de NEGOCIO, nao de codigo: "o lead chegou", "o grupo foi avisado".
 * A tela de Integracoes ja responde se as credenciais funcionam; aqui a
 * pergunta e' outra — onde o lead para.
 */
admin.get('/tenants/:id/fluxo', async (c) => {
  const id = Number(c.req.param('id'));

  const cfg = await c.env.DB.prepare(
    `SELECT c.cw_account_id, c.cw_board_funil_id, c.ga_customer_id,
            c.pulseboard_codi_id, c.sheets_doc_id, c.validate_only,
            CASE WHEN c.cw_webhook_secret IS NULL THEN 0 ELSE 1 END AS tem_segredo,
            (SELECT COUNT(*) FROM funnel_stages f WHERE f.tenant_id = c.tenant_id) AS etapas,
            (SELECT COUNT(*) FROM funnel_stages f WHERE f.tenant_id = c.tenant_id
               AND f.conversion_action_id IS NOT NULL) AS etapas_com_meta,
            (SELECT COUNT(*) FROM stage_triggers g WHERE g.tenant_id = c.tenant_id) AS gatilhos
     FROM tenant_config c WHERE c.tenant_id = ?`,
  )
    .bind(id)
    .first<Record<string, number | string | null>>();

  if (!cfg) return c.json({ error: 'cliente nao encontrado' }, 404);

  interface Medida {
    t24: number;
    t7: number;
    ultimo: string | null;
    ultimoErro: string | null;
    motivo: string | null;
  }

  const medidas = (r: Medida | null) => ({
    total24h: Number(r?.t24 ?? 0),
    total7d: Number(r?.t7 ?? 0),
    ultimoEm: r?.ultimo ?? null,
    ultimoErroEm: r?.ultimoErro ?? null,
    ultimoErroMotivo: r?.motivo ?? null,
  });

  /** Atividade e erro de um recorte da tabela de eventos. */
  async function porEvento(where: string) {
    const r = await c.env.DB.prepare(
      `SELECT
         SUM(CASE WHEN received_at >= datetime('now','-1 day') THEN 1 ELSE 0 END) AS t24,
         SUM(CASE WHEN received_at >= datetime('now','-7 day') THEN 1 ELSE 0 END) AS t7,
         MAX(CASE WHEN status != 'erro' THEN received_at END) AS ultimo,
         MAX(CASE WHEN status = 'erro' THEN received_at END) AS ultimoErro,
         (SELECT motivo FROM events e2 WHERE e2.tenant_id = ? AND ${where}
            AND e2.status = 'erro' ORDER BY e2.received_at DESC LIMIT 1) AS motivo
       FROM events WHERE tenant_id = ? AND ${where}`,
    )
      .bind(id, id)
      .first<Medida>();
    return medidas(r);
  }

  /** Atividade e erro de uma tabela com colunas status/erro/created_at. */
  async function porTabela(tabela: 'group_notifications' | 'conversions') {
    const r = await c.env.DB.prepare(
      `SELECT
         SUM(CASE WHEN created_at >= datetime('now','-1 day') THEN 1 ELSE 0 END) AS t24,
         SUM(CASE WHEN created_at >= datetime('now','-7 day') THEN 1 ELSE 0 END) AS t7,
         MAX(CASE WHEN status = 'enviado' THEN created_at END) AS ultimo,
         MAX(CASE WHEN status = 'erro' THEN created_at END) AS ultimoErro,
         (SELECT erro FROM ${tabela} x WHERE x.tenant_id = ? AND x.status = 'erro'
            ORDER BY x.created_at DESC LIMIT 1) AS motivo
       FROM ${tabela} WHERE tenant_id = ?`,
    )
      .bind(id, id)
      .first<Medida>();
    return medidas(r);
  }

  // leads e movimentacoes nao tem coluna status
  const leads = await c.env.DB.prepare(
    `SELECT
       SUM(CASE WHEN created_at >= datetime('now','-1 day') THEN 1 ELSE 0 END) AS t24,
       SUM(CASE WHEN created_at >= datetime('now','-7 day') THEN 1 ELSE 0 END) AS t7,
       MAX(created_at) AS ultimo
     FROM leads WHERE tenant_id = ?`,
  )
    .bind(id)
    .first<{ t24: number; t7: number; ultimo: string | null }>();

  const moves = await c.env.DB.prepare(
    `SELECT
       SUM(CASE WHEN created_at >= datetime('now','-1 day') THEN 1 ELSE 0 END) AS t24,
       SUM(CASE WHEN created_at >= datetime('now','-7 day') THEN 1 ELSE 0 END) AS t7,
       MAX(CASE WHEN moveu = 1 THEN created_at END) AS ultimo,
       SUM(CASE WHEN moveu = 0 THEN 1 ELSE 0 END) AS nao_moveu
     FROM card_moves WHERE tenant_id = ?`,
  )
    .bind(id)
    .first<{ t24: number; t7: number; ultimo: string | null; nao_moveu: number }>();

  const semWebhook = !cfg.cw_account_id
    ? 'cliente sem conta do Chatwoot'
    : Number(cfg.tem_segredo) === 0
      ? 'webhook do painel ainda não registrado no Chatwoot'
      : null;

  const etapas = [
    {
      id: 'chegada',
      titulo: 'Chegada do lead no CRM',
      comoFunciona: 'conversa criada e primeira mensagem do lead no Chatwoot',
      sinais: {
        ...(await porEvento(
          "source = 'chatwoot' AND event_type IN ('conversation_created','message_incoming')",
        )),
        implementado: false,
        pendencia: semWebhook,
      },
    },
    {
      id: 'dados',
      titulo: 'Dados do lead registrados',
      comoFunciona: 'protocolo, telefone, e-mail e campanha gravados e espelhados na planilha',
      sinais: {
        total24h: Number(leads?.t24 ?? 0),
        total7d: Number(leads?.t7 ?? 0),
        ultimoEm: leads?.ultimo ?? null,
        ultimoErroEm: null,
        ultimoErroMotivo: null,
        implementado: false,
        pendencia: null,
      },
    },
    {
      id: 'grupo',
      titulo: 'Aviso do lead no grupo',
      comoFunciona: 'nome, telefone e canal enviados ao grupo pelo Pulseboard',
      sinais: {
        ...(await porTabela('group_notifications')),
        implementado: true,
        pendencia: cfg.pulseboard_codi_id ? null : 'falta o codi_id do Pulseboard no cadastro',
      },
    },
    {
      id: 'gatilhos',
      titulo: 'Gatilhos movendo os cards',
      comoFunciona: 'a frase do vendedor move o card para a etapa seguinte',
      sinais: {
        total24h: Number(moves?.t24 ?? 0),
        total7d: Number(moves?.t7 ?? 0),
        ultimoEm: moves?.ultimo ?? null,
        ultimoErroEm: null,
        ultimoErroMotivo: null,
        implementado: false,
        pendencia:
          Number(cfg.etapas) === 0
            ? 'etapas do funil ainda não sincronizadas'
            : Number(cfg.gatilhos) === 0
              ? 'nenhuma frase-gatilho cadastrada'
              : null,
      },
    },
    {
      id: 'conversao',
      titulo: 'Conversão enviada ao Google Ads',
      comoFunciona: 'qualquer etapa marcada como conversão sobe pela Data Manager API',
      sinais: {
        ...(await porTabela('conversions')),
        implementado: false,
        pendencia: !cfg.ga_customer_id
          ? 'cliente sem conta do Google Ads'
          : Number(cfg.etapas) === 0
            ? 'etapas do funil ainda não sincronizadas'
            : Number(cfg.etapas_com_meta) === 0
              ? 'nenhuma etapa ligada a uma meta de conversão'
              : null,
      },
    },
  ];

  return c.json({
    modo_sombra: Number(cfg.validate_only) === 1,
    etapas: etapas.map((e) => ({
      id: e.id,
      titulo: e.titulo,
      comoFunciona: e.comoFunciona,
      ...avaliarEtapa(e.sinais),
      total24h: e.sinais.total24h,
      total7d: e.sinais.total7d,
      ultimoEm: e.sinais.ultimoEm,
    })),
  });
});

// ---------------------------------------------------------------------------
// Frases-gatilho por cliente
// ---------------------------------------------------------------------------

admin.get('/tenants/:id/gatilhos', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT g.id, g.frase, g.emoji_obrigatorio, g.stage_id,
            f.nome AS stage_nome, f.posicao
     FROM stage_triggers g
     JOIN funnel_stages f ON f.id = g.stage_id
     WHERE g.tenant_id = ?
     ORDER BY f.posicao DESC, g.frase`,
  )
    .bind(Number(c.req.param('id')))
    .all();
  return c.json(results);
});

admin.post('/tenants/:id/gatilhos', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json<{ frase?: string; stage_id?: number; emoji?: string }>();

  const frase = String(b.frase ?? '').trim();
  const stageId = Number(b.stage_id);
  if (!frase) return c.json({ error: 'a frase é obrigatória' }, 400);
  if (!stageId) return c.json({ error: 'escolha a etapa de destino' }, 400);

  // A etapa precisa ser deste cliente: sem conferir, daria para apontar o
  // gatilho de um cliente para a etapa de outro.
  const etapa = await c.env.DB.prepare(
    'SELECT id FROM funnel_stages WHERE id = ? AND tenant_id = ?',
  )
    .bind(stageId, id)
    .first();
  if (!etapa) return c.json({ error: 'etapa não pertence a este cliente' }, 400);

  await c.env.DB.prepare(
    'INSERT INTO stage_triggers (tenant_id, stage_id, frase, emoji_obrigatorio) VALUES (?, ?, ?, ?)',
  )
    .bind(id, stageId, frase, String(b.emoji ?? '').trim() || null)
    .run();

  return c.json({ ok: true }, 201);
});

admin.delete('/tenants/:id/gatilhos/:gid', async (c) => {
  const r = await c.env.DB.prepare('DELETE FROM stage_triggers WHERE id = ? AND tenant_id = ?')
    .bind(Number(c.req.param('gid')), Number(c.req.param('id')))
    .run();
  return r.meta.changes ? c.json({ ok: true }) : c.json({ error: 'gatilho nao encontrado' }, 404);
});

/** Ultimas movimentacoes de card, para ver o gatilho funcionando — ou nao. */
admin.get('/tenants/:id/movimentacoes', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT gatilho, trecho, etapa_de, etapa_para, moveu, motivo, created_at
     FROM card_moves WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 40`,
  )
    .bind(Number(c.req.param('id')))
    .all();
  return c.json(results);
});

/** Numeros de WhatsApp do cliente: uma inbox do Chatwoot por instancia do Evolution. */
admin.get('/tenants/:id/instancias', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT cw_inbox_id, cw_inbox_nome, evo_instancia, ativa
     FROM inbox_instances WHERE tenant_id = ? ORDER BY cw_inbox_id`,
  )
    .bind(Number(c.req.param('id')))
    .all();
  return c.json(results);
});
