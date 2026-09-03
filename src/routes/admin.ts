import { Hono } from 'hono';
import type { Env } from '../env';
import { requireAccess, type AccessIdentity } from '../middleware/access';
import { ChatwootClient } from '../clients/chatwoot';
import { GoogleAdsClient, criarConversionActions } from '../clients/googleAds';
import { EvolutionClient } from '../clients/evolution';
import { urlDeConsentimento, CAMINHO_CALLBACK } from './oauth';
import { TagManagerClient } from '../clients/tagManager';
import {
  lerModelo, planejarGtm, limparParaCriar, remapearGatilhos, indiceDeGatilhos,
} from '../domain/gtm';
import { validarCliente, gerarIngestKey } from '../domain/tenantInput';
import { proporMetas, metasForaDoCatalogo, type MetaProposta } from '../domain/metas';
import {
  planejarProvisionamento,
  type PadraoEtiqueta,
  type PadraoAtributo,
} from '../domain/padroes';
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
  'pulseboard_url',
  'gtm_account_id',
  'gtm_container_id',
  'gtm_prefixo',
  'validate_only',
  'janela_match_dias',
] as const;

admin.get('/tenants/:id/config', async (c) => {
  const t = await c.env.DB.prepare(
    `SELECT t.id, t.slug, t.nome, t.ativo, c.cw_account_id, c.cw_board_funil_id,
            c.cw_board_organico_id, c.ga_customer_id, c.evo_instancia,
            c.pulseboard_codi_id, c.pulseboard_url, c.gtm_account_id, c.gtm_container_id, c.gtm_prefixo, c.validate_only, c.janela_match_dias, c.ingest_key,
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

// ---------------------------------------------------------------------------
// Padronizacoes — o catalogo de etiquetas e atributos que todo cliente recebe
// ---------------------------------------------------------------------------

/**
 * Substitui o workflow "Chatwoot - Criacao automatica de Atributos e Etiquetas".
 *
 * La' as listas viviam coladas dentro de um no de codigo e o numero da conta
 * estava fixo em dois lugares — cliente novo exigia editar o fluxo. Aqui a lista
 * e' linha de banco editavel, e a conta e' o cliente que voce escolher.
 */
admin.get('/padroes', async (c) => {
  const [etiquetas, atributos] = await Promise.all([
    c.env.DB.prepare('SELECT id, slug, cor, descricao FROM padrao_etiquetas ORDER BY posicao, slug').all(),
    c.env.DB.prepare(
      `SELECT id, modelo, chave, nome, tipo, descricao FROM padrao_atributos
       ORDER BY modelo, posicao, chave`,
    ).all(),
  ]);
  return c.json({ etiquetas: etiquetas.results, atributos: atributos.results });
});

admin.post('/padroes/etiquetas', async (c) => {
  const b = await c.req.json<{ slug?: string; cor?: string; descricao?: string }>();
  const slug = (b.slug ?? '').trim();
  if (!slug) return c.json({ error: 'slug obrigatorio' }, 400);

  await c.env.DB.prepare(
    `INSERT INTO padrao_etiquetas (slug, cor, descricao, posicao)
     VALUES (?, ?, ?, (SELECT COALESCE(MAX(posicao), 0) + 1 FROM padrao_etiquetas))
     ON CONFLICT (slug) DO UPDATE SET cor = excluded.cor, descricao = excluded.descricao`,
  )
    .bind(slug, (b.cor ?? '#999999').trim(), (b.descricao ?? '').trim() || null)
    .run();
  return c.json({ ok: true });
});

admin.delete('/padroes/etiquetas/:pid', async (c) => {
  await c.env.DB.prepare('DELETE FROM padrao_etiquetas WHERE id = ?').bind(Number(c.req.param('pid'))).run();
  return c.json({ ok: true });
});

admin.post('/padroes/atributos', async (c) => {
  const b = await c.req.json<{ modelo?: string; chave?: string; nome?: string; tipo?: string; descricao?: string }>();
  const modelo = (b.modelo ?? '').trim();
  const chave = (b.chave ?? '').trim();
  const nome = (b.nome ?? '').trim();
  if (!MODELOS.includes(modelo)) return c.json({ error: 'modelo invalido' }, 400);
  if (!chave || !nome) return c.json({ error: 'chave e nome obrigatorios' }, 400);
  const tipo = (b.tipo ?? 'text').trim();
  if (!TIPOS.includes(tipo)) return c.json({ error: 'tipo invalido' }, 400);

  await c.env.DB.prepare(
    `INSERT INTO padrao_atributos (modelo, chave, nome, tipo, descricao, posicao)
     VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(posicao), 0) + 1 FROM padrao_atributos WHERE modelo = ?))
     ON CONFLICT (modelo, chave) DO UPDATE SET nome = excluded.nome, tipo = excluded.tipo,
       descricao = excluded.descricao`,
  )
    .bind(modelo, chave, nome, tipo, (b.descricao ?? '').trim() || null, modelo)
    .run();
  return c.json({ ok: true });
});

admin.delete('/padroes/atributos/:pid', async (c) => {
  await c.env.DB.prepare('DELETE FROM padrao_atributos WHERE id = ?').bind(Number(c.req.param('pid'))).run();
  return c.json({ ok: true });
});

const MODELOS: string[] = ['contact_attribute', 'conversation_attribute', 'task_attribute'];
const TIPOS: string[] = ['text', 'number', 'currency', 'percent', 'link', 'date', 'list', 'checkbox'];

/**
 * O que falta na conta deste cliente. Com `?aplicar=1`, cria.
 *
 * Le a conta antes de escrever, entao a previa e' de verdade: o workflow antigo
 * mandava criar tudo sempre e classificava "ja existe" pelo texto do erro.
 */
admin.post('/tenants/:id/provisionar', async (c) => {
  const id = Number(c.req.param('id'));
  const t = await carregarTenant(c.env.DB, id);
  if (!t) return c.json({ error: 'cliente nao encontrado' }, 404);
  if (!t.cwAccountId) return c.json({ error: 'cliente sem conta do Chatwoot' }, 400);

  const [pe, pa] = await Promise.all([
    c.env.DB.prepare('SELECT slug, cor, descricao FROM padrao_etiquetas ORDER BY posicao, slug')
      .all<PadraoEtiqueta>(),
    c.env.DB.prepare('SELECT modelo, chave, nome, tipo, descricao FROM padrao_atributos ORDER BY modelo, posicao')
      .all<PadraoAtributo>(),
  ]);

  const cw = ChatwootClient.fromEnv(c.env);
  const acc = t.cwAccountId;
  const naConta = await cw.labels(acc);
  const atributosNaConta = (
    await Promise.all(MODELOS.map((m) => cw.atributos(acc, m)))
  ).flat();

  const plano = planejarProvisionamento(pe.results, pa.results, naConta, atributosNaConta);
  if (c.req.query('aplicar') !== '1') {
    return c.json({ previa: true, conta: acc, ...resumo(plano) });
  }

  // Atributos primeiro: se a etiqueta falhar, o que importa ja entrou. E' a
  // mesma ordem do workflow, pelo mesmo motivo.
  const falhas: string[] = [];
  let criados = 0;
  for (const a of plano.atributosACriar) {
    try { await cw.criarAtributo(acc, a); criados++; }
    catch (e) { falhas.push(`${a.modelo}/${a.chave}: ${(e as Error).message.slice(0, 120)}`); }
  }
  for (const e of plano.etiquetasACriar) {
    try { await cw.criarEtiqueta(acc, e.slug, e.cor, e.descricao); criados++; }
    catch (err) { falhas.push(`label/${e.slug}: ${(err as Error).message.slice(0, 120)}`); }
  }

  // O vocabulario do motor de etiquetas segue o mesmo catalogo: sem isto, a
  // etiqueta existe no Chatwoot mas a ferramenta nao sabe que pode usa-la.
  for (const e of pe.results) {
    await c.env.DB.prepare(
      `INSERT INTO label_vocabulary (tenant_id, slug, label_chatwoot, label_whatsapp)
       VALUES (?, ?, ?, NULL)
       ON CONFLICT (tenant_id, slug) DO UPDATE SET label_chatwoot = excluded.label_chatwoot`,
    )
      .bind(id, e.slug, e.slug)
      .run();
  }

  console.log(
    JSON.stringify({ acao: 'provisionar', por: c.get('identity').email, tenant_id: id, criados }),
  );
  return c.json({ previa: false, conta: acc, criados, falhas, ...resumo(plano) });
});

function resumo(p: ReturnType<typeof planejarProvisionamento>) {
  return {
    etiquetas_a_criar: p.etiquetasACriar.map((e) => e.slug),
    etiquetas_existentes: p.etiquetasExistentes,
    atributos_a_criar: p.atributosACriar.map((a) => `${a.modelo}/${a.chave}`),
    atributos_existentes: p.atributosExistentes.length,
    fora_do_padrao: [...p.etiquetasForaDoPadrao, ...p.atributosForaDoPadrao],
  };
}

// ---------------------------------------------------------------------------
// Etiquetas deste cliente
// ---------------------------------------------------------------------------

/**
 * As etiquetas da conta do Chatwoot cruzadas com o vocabulario do motor.
 *
 * Sao coisas diferentes e a diferenca importa: a etiqueta existe no Chatwoot,
 * mas o motor so' aplica o que esta no vocabulario. Etiqueta que o vendedor
 * criou a mao ("Ligar mais tarde") aparece aqui como fora do vocabulario, e e'
 * assim que deve ficar — nao e' etiqueta de atribuicao.
 *
 * O nome no WhatsApp vem junto porque foi batizado a mao e diverge do Chatwoot:
 * "Lead do Google Ads" na Vita, "Google-ads" na Persianas.
 */
admin.get('/tenants/:id/etiquetas', async (c) => {
  const id = Number(c.req.param('id'));
  const t = await carregarTenant(c.env.DB, id);
  if (!t) return c.json({ error: 'cliente nao encontrado' }, 404);

  const cfg = await c.env.DB.prepare(
    'SELECT evo_instancia FROM tenant_config WHERE tenant_id = ?',
  )
    .bind(id)
    .first<{ evo_instancia: string | null }>();

  const [noChatwoot, vocab, noWhatsapp] = await Promise.all([
    t.cwAccountId
      ? ChatwootClient.fromEnv(c.env).labels(t.cwAccountId).catch(() => [])
      : Promise.resolve([]),
    c.env.DB.prepare(
      'SELECT slug, label_chatwoot, label_whatsapp FROM label_vocabulary WHERE tenant_id = ? ORDER BY slug',
    )
      .bind(id)
      .all<{ slug: string; label_chatwoot: string; label_whatsapp: string | null }>(),
    cfg?.evo_instancia
      ? EvolutionClient.fromEnv(c.env).labels(cfg.evo_instancia).catch(() => [])
      : Promise.resolve([]),
  ]);

  const noVocab = new Map(vocab.results.map((v) => [v.slug.toLowerCase(), v]));

  return c.json({
    instancia: cfg?.evo_instancia ?? null,
    whatsapp_disponiveis: noWhatsapp,
    etiquetas: noChatwoot.map((titulo) => {
      const v = noVocab.get(titulo.toLowerCase());
      return {
        titulo,
        no_vocabulario: !!v,
        label_whatsapp: v?.label_whatsapp ?? null,
      };
    }),
    // no vocabulario mas nao na conta: o motor tentaria aplicar e falharia
    orfas: vocab.results
      .filter((v) => !noChatwoot.some((l) => l.toLowerCase() === v.slug.toLowerCase()))
      .map((v) => v.slug),
  });
});

/** Cria a etiqueta na conta do cliente e ja liga no vocabulario do motor. */
admin.post('/tenants/:id/etiquetas', async (c) => {
  const id = Number(c.req.param('id'));
  const t = await carregarTenant(c.env.DB, id);
  if (!t) return c.json({ error: 'cliente nao encontrado' }, 404);
  if (!t.cwAccountId) return c.json({ error: 'cliente sem conta do Chatwoot' }, 400);

  const b = await c.req.json<{ slug?: string; cor?: string; descricao?: string; label_whatsapp?: string }>();
  const slug = (b.slug ?? '').trim();
  if (!slug) return c.json({ error: 'nome da etiqueta obrigatorio' }, 400);

  const cw = ChatwootClient.fromEnv(c.env);
  const existentes = await cw.labels(t.cwAccountId);
  const jaExiste = existentes.some((l) => l.toLowerCase() === slug.toLowerCase());

  if (!jaExiste) {
    await cw.criarEtiqueta(t.cwAccountId, slug, (b.cor ?? '#999999').trim(), (b.descricao ?? '').trim() || null);
  }

  await c.env.DB.prepare(
    `INSERT INTO label_vocabulary (tenant_id, slug, label_chatwoot, label_whatsapp)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (tenant_id, slug) DO UPDATE SET label_whatsapp = excluded.label_whatsapp`,
  )
    .bind(id, slug, slug, (b.label_whatsapp ?? '').trim() || null)
    .run();

  console.log(
    JSON.stringify({ acao: 'criar_etiqueta', por: c.get('identity').email, tenant_id: id, slug }),
  );
  return c.json({ ok: true, criada_no_chatwoot: !jaExiste });
});

/** Liga ou desliga a etiqueta do vocabulario, e ajusta o nome no WhatsApp. */
admin.patch('/tenants/:id/etiquetas/:slug', async (c) => {
  const id = Number(c.req.param('id'));
  const slug = decodeURIComponent(c.req.param('slug'));
  const b = await c.req.json<{ no_vocabulario?: boolean; label_whatsapp?: string | null }>();

  if (b.no_vocabulario === false) {
    // sai do vocabulario, fica no Chatwoot: apagar a etiqueta la' tiraria ela
    // das conversas onde o vendedor ja aplicou
    await c.env.DB.prepare('DELETE FROM label_vocabulary WHERE tenant_id = ? AND slug = ?')
      .bind(id, slug)
      .run();
    return c.json({ ok: true, no_vocabulario: false });
  }

  const zap = (b.label_whatsapp ?? '').trim() || null;
  await c.env.DB.prepare(
    `INSERT INTO label_vocabulary (tenant_id, slug, label_chatwoot, label_whatsapp)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (tenant_id, slug) DO UPDATE SET label_whatsapp = excluded.label_whatsapp`,
  )
    .bind(id, slug, slug, zap)
    .run();
  return c.json({ ok: true, no_vocabulario: true, label_whatsapp: zap });
});

/**
 * Reprocessa os webhooks que ficaram para tras.
 *
 * Os eventos foram gravados enquanto o pipeline nao existia e marcados como
 * `ignorado`. Reenfileirar faz o pipeline de verdade rodar sobre o payload
 * original — corrige o passado sem duplicar a logica num script a parte, que
 * inevitavelmente divergiria do que roda em producao.
 *
 * Sem `?aplicar=1` so' conta quantos entrariam na fila.
 */
admin.post('/tenants/:id/reprocessar', async (c) => {
  const id = Number(c.req.param('id'));
  const tipo = c.req.query('evento') ?? 'message_incoming';
  const limite = Math.min(Number(c.req.query('limit') ?? 200), 500);

  // Um evento por conversa, o mais antigo: e' a mensagem que carrega o
  // protocolo. Reprocessar as 40 mensagens de uma conversa daria no mesmo
  // resultado gastando 40 vezes mais chamadas.
  const { results } = await c.env.DB.prepare(
    `SELECT MIN(e.id) AS id
     FROM events e
     WHERE e.tenant_id = ? AND e.event_type = ? AND e.status = 'ignorado'
       AND e.payload IS NOT NULL AND e.payload != ''
     GROUP BY json_extract(e.payload, '$.conversation.id')
     ORDER BY id
     LIMIT ?`,
  )
    .bind(id, tipo, limite)
    .all<{ id: number }>();

  if (c.req.query('aplicar') !== '1') {
    return c.json({ previa: true, evento: tipo, na_fila: results.length });
  }

  for (const r of results) {
    await c.env.QUEUE.send({ eventId: r.id, tenantId: id, source: 'chatwoot', eventType: tipo });
  }

  console.log(
    JSON.stringify({ acao: 'reprocessar', por: c.get('identity').email, tenant_id: id, n: results.length }),
  );
  return c.json({ previa: false, evento: tipo, na_fila: results.length });
});

// ---------------------------------------------------------------------------
// Consentimento do Google (Tag Manager)
// ---------------------------------------------------------------------------

/**
 * Comeca o consentimento. Devolve a URL do Google com um `state` de uso unico.
 *
 * Sai daqui, de dentro do Access, e nao de um link colado: e' isso que amarra o
 * callback a uma pessoa que ja provou quem e'.
 */
admin.get('/oauth/google/start', async (c) => {
  const state = crypto.randomUUID().replace(/-/g, '');
  const email = c.get('identity').email;

  // D1 e nao KV: o KV tem teto diario de escrita e ja recusou uma vez hoje.
  // Perder o state por cota estourada deixaria o consentimento impossivel de
  // comecar, sem dizer por que.
  await c.env.DB.prepare(
    `INSERT INTO credenciais (chave, valor, obtido_por, escopos, atualizado_em)
     VALUES (?, ?, ?, NULL, datetime('now'))`,
  )
    .bind(`oauth_state:${state}`, email, email)
    .run();

  const redirectUri = new URL(c.req.url).origin + CAMINHO_CALLBACK;
  return c.json({ url: urlDeConsentimento(c.env, redirectUri, state), redirect_uri: redirectUri });
});

/** O que ja foi autorizado, sem devolver o token. */
admin.get('/oauth/google/status', async (c) => {
  const l = await c.env.DB.prepare(
    "SELECT obtido_por, escopos, atualizado_em FROM credenciais WHERE chave = 'gtm_refresh_token'",
  ).first<{ obtido_por: string; escopos: string; atualizado_em: string }>();

  if (!l) return c.json({ autorizado: false });
  return c.json({
    autorizado: true,
    por: l.obtido_por,
    em: l.atualizado_em,
    tag_manager: (l.escopos ?? '').includes('tagmanager'),
  });
});

// ---------------------------------------------------------------------------
// Google Tag Manager
// ---------------------------------------------------------------------------

/** Containers visiveis com a credencial autorizada, para o seletor da tela. */
admin.get('/gtm/containers', async (c) => {
  const gtm = await TagManagerClient.deD1(c.env);
  if (!gtm) return c.json({ error: 'nenhuma credencial do Google autorizada' }, 400);
  return c.json(await gtm.containers());
});

/**
 * O que falta no container deste cliente. Com `?aplicar=1`, cria.
 *
 * Cria no workspace que ja existe, nao num novo: workspace novo vira uma
 * segunda fila de alteracoes pendentes na tela do cliente, e quem publicar sem
 * ver perde o que estava no outro.
 */
admin.post('/tenants/:id/gtm/padronizar', async (c) => {
  const id = Number(c.req.param('id'));
  const cfg = await c.env.DB.prepare(
    `SELECT t.slug, c.gtm_account_id, c.gtm_container_id, c.gtm_prefixo, c.ingest_key
     FROM tenants t JOIN tenant_config c ON c.tenant_id = t.id WHERE t.id = ?`,
  )
    .bind(id)
    .first<{ slug: string; gtm_account_id: string | null; gtm_container_id: string | null; gtm_prefixo: string | null; ingest_key: string }>();

  if (!cfg?.gtm_account_id || !cfg.gtm_container_id) {
    return c.json({ error: 'escolha o container do GTM na configuração do cliente' }, 400);
  }
  if (!cfg.gtm_prefixo) {
    return c.json({ error: 'informe o prefixo do protocolo na configuração do cliente' }, 400);
  }

  const gtm = await TagManagerClient.deD1(c.env);
  if (!gtm) return c.json({ error: 'nenhuma credencial do Google autorizada' }, 400);

  const linha = await c.env.DB.prepare('SELECT json FROM padrao_gtm WHERE id = 1').first<{ json: string }>();
  if (!linha) return c.json({ error: 'modelo do GTM nao cadastrado' }, 400);

  const modelo = lerModelo(linha.json);
  const acc = cfg.gtm_account_id;
  const cont = cfg.gtm_container_id;
  const ws = await gtm.workspacePadrao(acc, cont);
  const inv = await gtm.inventario(acc, cont, ws.workspaceId);

  const valores = {
    prefixo: cfg.gtm_prefixo,
    clientId: `p12-${cfg.slug}`,
    collectUrl: `${new URL(c.req.url).origin}/ingest/${cfg.slug}/click?k=${encodeURIComponent(cfg.ingest_key)}`,
  };
  const plano = planejarGtm(modelo, inv, valores);

  const resumo = {
    workspace: ws.name,
    a_criar: {
      templates: plano.templatesACriar.map((x) => x.name),
      variaveis: plano.variaveisACriar.map((x) => x.name),
      gatilhos: plano.gatilhosACriar.map((x) => x.name),
      tags: plano.tagsACriar.map((x) => x.name),
      built_in: plano.builtInACriar,
    },
    ja_existem: plano.jaExistem,
    sem_valor: plano.semValor,
  };

  if (c.req.query('aplicar') !== '1') return c.json({ previa: true, ...resumo });
  if (plano.semValor.length) {
    // subir uma constante com o exemplo do modelo faria o container postar para
    // o n8n antigo, sem erro visivel
    return c.json({ error: `constantes sem valor real: ${plano.semValor.join(', ')}` }, 400);
  }

  const falhas: string[] = [];
  let criados = 0;
  const tentar = async (rotulo: string, f: () => Promise<unknown>) => {
    try { await f(); criados++; }
    catch (e) { falhas.push(`${rotulo}: ${(e as Error).message.slice(0, 160)}`); }
  };

  // Ordem obrigatoria: template antes da tag que o usa, gatilho antes da tag
  // que dispara nele.
  for (const t of plano.templatesACriar) {
    await tentar(`template/${t.name}`, () => gtm.criarTemplate(acc, cont, ws.workspaceId, limparParaCriar(t)));
  }
  for (const b of plano.builtInACriar) {
    await tentar(`builtin/${b}`, () => gtm.criarBuiltIn(acc, cont, ws.workspaceId, b));
  }
  for (const v of plano.variaveisACriar) {
    await tentar(`variável/${v.name}`, () => gtm.criarVariavel(acc, cont, ws.workspaceId, limparParaCriar(v)));
  }

  const gatilhoPorNome = new Map(inv.gatilhosPorNome);
  for (const g of plano.gatilhosACriar) {
    await tentar(`gatilho/${g.name}`, async () => {
      const criado = await gtm.criarGatilho(acc, cont, ws.workspaceId, limparParaCriar(g));
      gatilhoPorNome.set(String(g.name).trim().toLowerCase(), criado.triggerId);
    });
  }

  const idx = indiceDeGatilhos(modelo);
  for (const t of plano.tagsACriar) {
    await tentar(`tag/${t.name}`, () =>
      gtm.criarTag(acc, cont, ws.workspaceId, limparParaCriar(remapearGatilhos(t, gatilhoPorNome, idx))),
    );
  }

  console.log(JSON.stringify({ acao: 'gtm_padronizar', por: c.get('identity').email, tenant_id: id, criados }));
  return c.json({ previa: false, criados, falhas, ...resumo });
});

/**
 * Cria a versao e publica.
 *
 * Separado da padronizacao de proposito: publicar mexe no rastreamento do site
 * em producao. Quem padroniza pode conferir no GTM antes de mandar para o ar.
 */
admin.post('/tenants/:id/gtm/publicar', async (c) => {
  const id = Number(c.req.param('id'));
  const cfg = await c.env.DB.prepare(
    'SELECT gtm_account_id, gtm_container_id FROM tenant_config WHERE tenant_id = ?',
  )
    .bind(id)
    .first<{ gtm_account_id: string | null; gtm_container_id: string | null }>();
  if (!cfg?.gtm_account_id || !cfg.gtm_container_id) {
    return c.json({ error: 'cliente sem container do GTM' }, 400);
  }

  const gtm = await TagManagerClient.deD1(c.env);
  if (!gtm) return c.json({ error: 'nenhuma credencial do Google autorizada' }, 400);

  const ws = await gtm.workspacePadrao(cfg.gtm_account_id, cfg.gtm_container_id);
  const versao = await gtm.criarVersao(
    cfg.gtm_account_id, cfg.gtm_container_id, ws.workspaceId,
    `P12 CRM Auto — ${new Date().toISOString().slice(0, 10)}`,
    'Rastreio de protocolo e persistência de UTM, publicado pelo painel.',
  );
  const vid = versao.containerVersion?.containerVersionId;
  if (!vid) return c.json({ error: 'o GTM criou a versão mas não devolveu o id' }, 502);

  await gtm.publicar(cfg.gtm_account_id, cfg.gtm_container_id, vid);
  console.log(JSON.stringify({ acao: 'gtm_publicar', por: c.get('identity').email, tenant_id: id, versao: vid }));
  return c.json({ ok: true, versao: vid });
});
