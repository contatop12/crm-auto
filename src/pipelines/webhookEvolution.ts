import type { Env } from '../env';
import { EvolutionClient } from '../clients/evolution';
import { gerarIngestKey } from '../domain/tenantInput';
import {
  EVENTOS_DO_CRM, definicaoDeVolta, estadoDoWebhook, hostDe, urlDoCrm,
  type EstadoWebhook, type WebhookEvo,
} from '../domain/webhookEvolution';

/**
 * "Conectar na Evolution" em um clique.
 *
 * Sem o webhook da instancia apontando para o CRM nao chega `ctwa_clid`, e sem
 * ele a Meta nao aceita o evento de campanha de mensagem. Tudo acontece aqui,
 * do lado do servidor: a chave do canal e' criada se faltar, e quem clica nao
 * precisa ver nem copiar nada.
 */

export interface InstanciaMeta {
  instancia: string;
  /** `connectionState` da Evolution: 'open' = WhatsApp conectado. */
  conexao: string;
  webhook: EstadoWebhook;
  /** So' quando o webhook aponta para outro lugar. Nunca a URL inteira. */
  host: string | null;
  /** Ultimo cartao de anuncio recebido desta instancia: a prova de que chega. */
  ultimo_cartao: string | null;
  tem_anterior: boolean;
}

export type Falha = { ok: false; status: 404 | 409 | 502; error: string; host?: string | null };
type Conectado = { ok: true; instancia: string; host: string | null };

/** Instancias do cliente: as das caixas mapeadas e a do cadastro. */
export async function instanciasDoCliente(env: Env, tenantId: number): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT evo_instancia AS nome FROM inbox_instances WHERE tenant_id = ? AND ativa = 1
     UNION
     SELECT evo_instancia FROM tenant_config WHERE tenant_id = ? AND evo_instancia IS NOT NULL`,
  )
    .bind(tenantId, tenantId)
    .all<{ nome: string }>();
  return [...new Set(results.map((r) => r.nome).filter(Boolean))].sort();
}

async function slugDo(env: Env, tenantId: number): Promise<string | null> {
  const t = await env.DB.prepare('SELECT slug FROM tenants WHERE id = ?').bind(tenantId).first<{ slug: string }>();
  return t?.slug ?? null;
}

export async function estadoDosWebhooks(env: Env, tenantId: number, origem: string): Promise<InstanciaMeta[]> {
  const slug = await slugDo(env, tenantId);
  const nomes = slug ? await instanciasDoCliente(env, tenantId) : [];
  if (!slug || !nomes.length) return [];

  const evo = EvolutionClient.fromEnv(env);
  return Promise.all(
    nomes.map(async (instancia): Promise<InstanciaMeta> => {
      const [conexao, w, ultimo, anterior] = await Promise.all([
        evo.estado(instancia).catch(() => 'desconhecido'),
        evo.webhook(instancia).catch(() => undefined),
        env.DB.prepare('SELECT MAX(recebido_em) AS em FROM meta_atribuicoes WHERE tenant_id = ? AND evo_instancia = ?')
          .bind(tenantId, instancia)
          .first<{ em: string | null }>(),
        env.DB.prepare('SELECT 1 AS tem FROM evo_webhooks_anteriores WHERE tenant_id = ? AND evo_instancia = ?')
          .bind(tenantId, instancia)
          .first<{ tem: number }>(),
      ]);
      const webhook = estadoDoWebhook(w, origem, slug);
      return {
        instancia,
        conexao,
        webhook,
        host: webhook === 'outro' ? hostDe(w?.url) : null,
        ultimo_cartao: ultimo?.em ?? null,
        tem_anterior: !!anterior,
      };
    }),
  );
}

/** A chave do canal `evolution`; nasce aqui na primeira conexao. */
async function chaveDaEvolution(env: Env, tenantId: number): Promise<string> {
  // revelada = 0: fica a opcao de ver uma vez, para quem quiser configurar a mao
  await env.DB.prepare(
    `INSERT INTO ingest_keys (tenant_id, canal, chave, revelada) VALUES (?, 'evolution', ?, 0)
     ON CONFLICT (tenant_id, canal) DO NOTHING`,
  )
    .bind(tenantId, gerarIngestKey())
    .run();
  const l = await env.DB.prepare(`SELECT chave FROM ingest_keys WHERE tenant_id = ? AND canal = 'evolution'`)
    .bind(tenantId)
    .first<{ chave: string }>();
  return l!.chave;
}

export async function conectarWebhook(
  env: Env,
  tenantId: number,
  origem: string,
  pedido: { instancia: string; confirmar?: boolean },
): Promise<Conectado | Falha> {
  const slug = await slugDo(env, tenantId);
  if (!slug) return { ok: false, status: 404, error: 'cliente nao encontrado' };

  const instancia = String(pedido.instancia ?? '').trim();
  if (!(await instanciasDoCliente(env, tenantId)).includes(instancia)) {
    return { ok: false, status: 404, error: `a instancia "${instancia}" nao e' deste cliente` };
  }

  const url = urlDoCrm(origem, slug, await chaveDaEvolution(env, tenantId));
  const evo = EvolutionClient.fromEnv(env);

  let atual: WebhookEvo | null;
  try {
    atual = await evo.webhook(instancia);
  } catch (e) {
    return { ok: false, status: 502, error: `a Evolution nao respondeu: ${(e as Error).message.slice(0, 200)}` };
  }

  const estado = estadoDoWebhook(atual, origem, slug);
  if (estado === 'outro' && !pedido.confirmar) {
    return {
      ok: false,
      status: 409,
      error: 'o webhook desta instancia aponta para outro lugar',
      host: hostDe(atual?.url),
    };
  }

  // Guarda o de antes para o "Restaurar anterior". Reconectar o que ja' e' do
  // CRM (depois de girar a chave) nao pode apagar o anterior de verdade.
  if (atual && estado === 'outro') {
    await env.DB.prepare(
      `INSERT INTO evo_webhooks_anteriores (tenant_id, evo_instancia, config) VALUES (?, ?, ?)
       ON CONFLICT (tenant_id, evo_instancia) DO UPDATE SET config = excluded.config, salvo_em = datetime('now')`,
    )
      .bind(tenantId, instancia, JSON.stringify(atual))
      .run();
  }

  try {
    // base64 false: sem isto a midia vem embutida no corpo
    await evo.definirWebhook(instancia, { enabled: true, url, events: EVENTOS_DO_CRM, byEvents: false, base64: false });
    const depois = await evo.webhook(instancia);
    if (depois?.url !== url) {
      return {
        ok: false,
        status: 502,
        error: `a Evolution nao gravou o endereco do CRM (hoje: ${hostDe(depois?.url) ?? 'sem webhook'})`,
      };
    }
  } catch (e) {
    return { ok: false, status: 502, error: `a Evolution recusou: ${(e as Error).message.slice(0, 200)}` };
  }

  console.log(JSON.stringify({ acao: 'evolution_conectada', tenant_id: tenantId, instancia }));
  return { ok: true, instancia, host: hostDe(url) };
}

/** A volta atras da virada: devolve o webhook que a instancia tinha antes. */
export async function restaurarWebhook(env: Env, tenantId: number, instancia: string): Promise<Conectado | Falha> {
  const l = await env.DB.prepare('SELECT config FROM evo_webhooks_anteriores WHERE tenant_id = ? AND evo_instancia = ?')
    .bind(tenantId, instancia)
    .first<{ config: string }>();
  if (!l) return { ok: false, status: 404, error: 'nao ha webhook anterior guardado para esta instancia' };

  const volta = definicaoDeVolta(JSON.parse(l.config) as WebhookEvo);
  const evo = EvolutionClient.fromEnv(env);
  try {
    await evo.definirWebhook(instancia, volta);
    const depois = await evo.webhook(instancia);
    if (depois?.url !== volta.url) {
      return { ok: false, status: 502, error: 'a Evolution nao gravou o webhook anterior' };
    }
  } catch (e) {
    return { ok: false, status: 502, error: `a Evolution recusou: ${(e as Error).message.slice(0, 200)}` };
  }

  await env.DB.prepare('DELETE FROM evo_webhooks_anteriores WHERE tenant_id = ? AND evo_instancia = ?')
    .bind(tenantId, instancia)
    .run();
  console.log(JSON.stringify({ acao: 'evolution_restaurada', tenant_id: tenantId, instancia }));
  return { ok: true, instancia, host: hostDe(volta.url) };
}
