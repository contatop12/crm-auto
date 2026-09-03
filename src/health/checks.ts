import type { Env } from '../env';
import { ChatwootClient } from '../clients/chatwoot';
import { GoogleAdsClient } from '../clients/googleAds';
import { EvolutionClient } from '../clients/evolution';

/**
 * Checagens ao vivo das integracoes de um cliente.
 *
 * Substituem o modo atual de descobrir que algo quebrou: esperar o lead sumir.
 * Cada checagem roda isolada — uma integracao fora do ar nao derruba a tela,
 * ela aparece como `erro` e as outras continuam.
 */

export type Estado = 'ok' | 'aviso' | 'erro' | 'na';

export interface Checagem {
  id: string;
  grupo: 'chatwoot' | 'google_ads' | 'etiquetas' | 'evolution';
  titulo: string;
  estado: Estado;
  detalhe: string;
}

export interface TenantParaChecagem {
  id: number;
  slug: string;
  nome: string;
  cwAccountId: number | null;
  cwBoardFunilId: number | null;
  cwBoardOrganicoId: number | null;
  gaCustomerId: string | null;
  evoInstancia: string | null;
}

const ok = (id: string, grupo: Checagem['grupo'], titulo: string, detalhe: string): Checagem => ({
  id, grupo, titulo, estado: 'ok', detalhe,
});
const erro = (id: string, grupo: Checagem['grupo'], titulo: string, detalhe: string): Checagem => ({
  id, grupo, titulo, estado: 'erro', detalhe,
});
const aviso = (id: string, grupo: Checagem['grupo'], titulo: string, detalhe: string): Checagem => ({
  id, grupo, titulo, estado: 'aviso', detalhe,
});
const na = (id: string, grupo: Checagem['grupo'], titulo: string, detalhe: string): Checagem => ({
  id, grupo, titulo, estado: 'na', detalhe,
});

/** Roda um grupo e converte excecao em checagem de erro, para nada explodir a tela. */
async function grupo(
  fn: () => Promise<Checagem[]>,
  id: string,
  g: Checagem['grupo'],
  titulo: string,
): Promise<Checagem[]> {
  try {
    return await fn();
  } catch (e) {
    return [erro(id, g, titulo, (e as Error).message)];
  }
}

async function checarChatwoot(env: Env, t: TenantParaChecagem, urlWorker: string): Promise<Checagem[]> {
  if (!t.cwAccountId) return [na('cw_conta', 'chatwoot', 'Conta do Chatwoot', 'nao configurada')];

  const cw = ChatwootClient.fromEnv(env);
  const out: Checagem[] = [];

  const boards = await cw.boards(t.cwAccountId);
  out.push(ok('cw_conta', 'chatwoot', 'Conta do Chatwoot', `conta ${t.cwAccountId}, ${boards.length} boards`));

  for (const [campo, boardId, rotulo] of [
    ['funil', t.cwBoardFunilId, 'Board do funil'],
    ['organico', t.cwBoardOrganicoId, 'Board de entrada'],
  ] as const) {
    if (!boardId) {
      out.push(na(`cw_board_${campo}`, 'chatwoot', rotulo, 'nao configurado'));
      continue;
    }
    const b = boards.find((x) => x.id === boardId);
    out.push(
      b
        ? ok(`cw_board_${campo}`, 'chatwoot', rotulo, `${boardId} "${b.name.trim()}"`)
        : erro(`cw_board_${campo}`, 'chatwoot', rotulo, `board ${boardId} nao existe nesta conta`),
    );
  }

  // etapas do funil: e' o que o motor usa para decidir avanco e conversao
  if (t.cwBoardFunilId && boards.some((b) => b.id === t.cwBoardFunilId)) {
    const steps = await cw.steps(t.cwAccountId, t.cwBoardFunilId);
    const cadastradas = await env.DB.prepare(
      'SELECT nome, cw_step_id FROM funnel_stages WHERE tenant_id = ? ORDER BY posicao',
    ).bind(t.id).all<{ nome: string; cw_step_id: number }>();

    const idsReais = new Set(steps.map((s) => s.id));
    const sumidas = cadastradas.results.filter((c) => !idsReais.has(c.cw_step_id));

    out.push(
      cadastradas.results.length === 0
        ? aviso('cw_etapas', 'chatwoot', 'Etapas do funil', `${steps.length} no board, nenhuma sincronizada ainda`)
        : sumidas.length
          ? erro('cw_etapas', 'chatwoot', 'Etapas do funil', `nao existem mais no board: ${sumidas.map((s) => s.nome).join(', ')}`)
          : ok('cw_etapas', 'chatwoot', 'Etapas do funil', `${cadastradas.results.length} sincronizadas`),
    );
  }

  // webhook: precisa apontar para ESTE Worker, senao os eventos vao para o n8n
  const whs = await cw.webhooks(t.cwAccountId);
  const nosso = whs.find((w) => w.url.includes(`/ingest/${t.slug}/chatwoot`));
  const outros = whs.filter((w) => w !== nosso);

  if (!nosso) {
    out.push(
      aviso('cw_webhook', 'chatwoot', 'Webhook',
        `nao registrado. ${outros.length} outro(s) apontando para: ${outros.map((w) => new URL(w.url).host).join(', ') || '(nenhum)'}`),
    );
  } else {
    const faltando = ['conversation_created', 'message_incoming', 'message_outgoing']
      .filter((s) => !nosso.subscriptions.includes(s));
    out.push(
      faltando.length
        ? aviso('cw_webhook', 'chatwoot', 'Webhook', `registrado, faltam inscricoes: ${faltando.join(', ')}`)
        : ok('cw_webhook', 'chatwoot', 'Webhook', `registrado com ${nosso.subscriptions.length} inscricoes`),
    );
  }
  void urlWorker;

  return out;
}

async function checarGoogleAds(env: Env, t: TenantParaChecagem): Promise<Checagem[]> {
  if (!t.gaCustomerId) return [na('ga_conta', 'google_ads', 'Conta do Google Ads', 'nao configurada')];

  const ga = GoogleAdsClient.fromEnv(env);
  const acoes = await ga.conversionActions(t.gaCustomerId);
  const out: Checagem[] = [
    ok('ga_conta', 'google_ads', 'Conta do Google Ads', `${t.gaCustomerId}, ${acoes.length} acoes de conversao`),
  ];

  const etapas = await env.DB.prepare(
    `SELECT nome, conversion_event, conversion_action_id FROM funnel_stages
     WHERE tenant_id = ? AND conversion_event IS NOT NULL ORDER BY posicao`,
  ).bind(t.id).all<{ nome: string; conversion_event: string; conversion_action_id: string | null }>();

  if (!etapas.results.length) {
    out.push(aviso('ga_acoes', 'google_ads', 'Acoes por etapa', 'nenhuma etapa marcada como conversao'));
    return out;
  }

  const porId = new Map(acoes.map((a) => [String(a.id), a]));
  for (const e of etapas.results) {
    const id = `ga_acao_${e.conversion_event}`;
    if (!e.conversion_action_id) {
      out.push(aviso(id, 'google_ads', `Acao: ${e.nome}`, 'sem ID — use o gerador de metas'));
      continue;
    }
    const a = porId.get(String(e.conversion_action_id));
    out.push(
      !a
        ? erro(id, 'google_ads', `Acao: ${e.nome}`, `ID ${e.conversion_action_id} nao existe nesta conta`)
        : a.status !== 'ENABLED'
          ? aviso(id, 'google_ads', `Acao: ${e.nome}`, `"${a.name}" esta ${a.status}`)
          : ok(id, 'google_ads', `Acao: ${e.nome}`, `"${a.name}" (${a.category})`),
    );
  }
  return out;
}

async function checarEtiquetas(env: Env, t: TenantParaChecagem): Promise<Checagem[]> {
  const vocab = await env.DB.prepare(
    'SELECT slug, label_chatwoot, label_whatsapp FROM label_vocabulary WHERE tenant_id = ?',
  ).bind(t.id).all<{ slug: string; label_chatwoot: string; label_whatsapp: string | null }>();

  if (!vocab.results.length) {
    return [na('etq', 'etiquetas', 'Vocabulario de etiquetas', 'nenhuma cadastrada')];
  }

  const out: Checagem[] = [];

  if (t.cwAccountId) {
    const existentes = new Set((await ChatwootClient.fromEnv(env).labels(t.cwAccountId)).map((l) => l.toLowerCase()));
    const faltam = vocab.results.filter((v) => !existentes.has(v.label_chatwoot.toLowerCase()));
    out.push(
      faltam.length
        ? erro('etq_cw', 'etiquetas', 'Etiquetas no Chatwoot', `faltam: ${faltam.map((f) => f.label_chatwoot).join(', ')}`)
        : ok('etq_cw', 'etiquetas', 'Etiquetas no Chatwoot', `${vocab.results.length} existem`),
    );
  }

  const noWhats = vocab.results.filter((v) => v.label_whatsapp);
  if (noWhats.length) {
    // uma linha por instancia: a etiqueta pode existir num numero e faltar no outro
    for (const i of await instanciasDoTenant(env, t)) {
      const rotulo = i.inbox ? `Etiquetas no WhatsApp · inbox ${i.inbox}` : 'Etiquetas no WhatsApp';
      try {
        const existentes = new Set(
          (await EvolutionClient.fromEnv(env).labels(i.instancia)).map((l) => l.toLowerCase()),
        );
        const faltam = noWhats.filter((v) => !existentes.has(String(v.label_whatsapp).toLowerCase()));
        out.push(
          faltam.length
            ? erro(`etq_wa_${i.instancia}`, 'etiquetas', rotulo, `faltam: ${faltam.map((f) => f.label_whatsapp).join(', ')}`)
            : ok(`etq_wa_${i.instancia}`, 'etiquetas', rotulo, `${noWhats.length} existem`),
        );
      } catch (e) {
        out.push(erro(`etq_wa_${i.instancia}`, 'etiquetas', rotulo, (e as Error).message));
      }
    }
  }

  return out;
}

/**
 * Instancias do WhatsApp do cliente.
 *
 * A instancia e' por INBOX, nao por cliente: a Locadora roda tres numeros, cada
 * um com sua inbox e sua instancia. Checar um campo unico deixaria duas delas
 * fora do radar.
 */
async function instanciasDoTenant(
  env: Env,
  t: TenantParaChecagem,
): Promise<Array<{ instancia: string; inbox: number | null }>> {
  const { results } = await env.DB.prepare(
    'SELECT cw_inbox_id, evo_instancia FROM inbox_instances WHERE tenant_id = ? AND ativa = 1',
  )
    .bind(t.id)
    .all<{ cw_inbox_id: number; evo_instancia: string }>();

  if (results.length) {
    return results.map((r) => ({ instancia: r.evo_instancia, inbox: r.cw_inbox_id }));
  }
  // cliente de um numero so pode ter apenas o padrao no cadastro
  return t.evoInstancia ? [{ instancia: t.evoInstancia, inbox: null }] : [];
}

async function checarEvolution(env: Env, t: TenantParaChecagem): Promise<Checagem[]> {
  const instancias = await instanciasDoTenant(env, t);
  if (!instancias.length) {
    return [na('evo', 'evolution', 'Instância do WhatsApp', 'nenhuma instância mapeada')];
  }

  const cli = EvolutionClient.fromEnv(env);

  return Promise.all(
    instancias.map(async (i) => {
      const rotulo = i.inbox ? `WhatsApp · inbox ${i.inbox}` : 'Instância do WhatsApp';
      try {
        const estado = await cli.estado(i.instancia);
        if (estado !== 'open') {
          return erro(`evo_${i.instancia}`, 'evolution', rotulo, `"${i.instancia}" está ${estado}`);
        }

        // `open` nao basta: o Evolution guarda esse status e continua dizendo
        // `open` depois que o aparelho foi desvinculado. A Persianas ficou
        // assim, e o painel dava tudo certo enquanto nada saia.
        const vida = await cli.viva(i.instancia);
        return vida.viva
          ? ok(`evo_${i.instancia}`, 'evolution', rotulo, `"${i.instancia}" conectada e respondendo`)
          : erro(`evo_${i.instancia}`, 'evolution', rotulo, `"${i.instancia}" diz \`open\`, mas ${vida.detalhe}`);
      } catch (e) {
        return erro(`evo_${i.instancia}`, 'evolution', rotulo, (e as Error).message);
      }
    }),
  );
}

/** Roda todos os grupos em paralelo. */
export async function checarTenant(
  env: Env,
  t: TenantParaChecagem,
  urlWorker: string,
): Promise<Checagem[]> {
  const grupos = await Promise.all([
    grupo(() => checarChatwoot(env, t, urlWorker), 'cw', 'chatwoot', 'Chatwoot'),
    grupo(() => checarGoogleAds(env, t), 'ga', 'google_ads', 'Google Ads'),
    grupo(() => checarEtiquetas(env, t), 'etq', 'etiquetas', 'Etiquetas'),
    grupo(() => checarEvolution(env, t), 'evo', 'evolution', 'Evolution'),
  ]);
  return grupos.flat();
}
