import type { Env } from '../env';
import { GoogleAdsClient } from '../clients/googleAds';
import { montarEvento, montarCorpo } from '../domain/conversao';
import { exigir } from '../domain/config';

/**
 * Mudança de etapa no Kanban vira conversão no Google Ads.
 *
 * É o último elo: o clique entra em `leads`, a mensagem do lead casa protocolo
 * com clique, a frase do vendedor move o card — e aqui o movimento do card volta
 * para o Google como sinal de qualidade. Sem este passo o Google otimiza pelo
 * volume de cliques, não pelo lead que fechou.
 *
 * O que substitui: o bloco 05 do n8n, que mantinha o dedup em TRÊS lugares que
 * precisavam concordar — a aba `Conversoes`, o `transactionId` no Google e a
 * flag `conversa_enviada` no custom attribute da conversa. Aqui é um lugar só:
 * `UNIQUE (tenant_id, dedupe_key)` no D1, conferido dentro da transação.
 *
 * A linha em `conversions` é gravada ANTES da chamada. Se a Data Manager cair
 * no meio, fica o registro do que foi tentado e por que falhou — e a retentativa
 * da fila encontra a linha em `erro` e reenvia, em vez de achar que já subiu.
 */

interface Resultado {
  status: 'ok' | 'ignorado' | 'erro';
  motivo: string;
}

interface Config {
  ga_customer_id: string | null;
  ga_currency: string;
  validate_only: number;
}

interface Etapa {
  nome: string;
  conversion_event: string | null;
  conversion_action_id: string | null;
  conversion_value: number | null;
}

interface Lead {
  email: string | null;
  phone_e164: string | null;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  valor_proposta: number | null;
}

export async function enviarConversao(
  env: Env,
  tenantId: number,
  payload: string,
): Promise<Resultado> {
  let p: Rec;
  try {
    const j = JSON.parse(payload) as unknown;
    if (!j || typeof j !== 'object' || Array.isArray(j)) {
      return { status: 'ignorado', motivo: 'payload nao e json' };
    }
    p = j as Rec;
  } catch {
    return { status: 'ignorado', motivo: 'payload nao e json' };
  }

  const taskId = num(p.id);
  const stepId = num(p.board_step_id) ?? num(obj(p.board_step)?.id);
  if (stepId === null) return { status: 'ignorado', motivo: `card ${taskId}: payload sem etapa` };

  const etapa = await env.DB.prepare(
    `SELECT nome, conversion_event, conversion_action_id, conversion_value
     FROM funnel_stages WHERE tenant_id = ? AND cw_step_id = ?`,
  )
    .bind(tenantId, stepId)
    .first<Etapa>();

  // Etapa que o funil não conhece: o board mudou e ninguém sincronizou. É o
  // caso que no n8n virava referência a uma etapa inexistente e sumia.
  if (!etapa) {
    return { status: 'ignorado', motivo: `etapa ${stepId} nao esta no funil — sincronize as etapas` };
  }

  // A maioria das etapas não vira conversão, e isso é o normal: "Qualificando"
  // é passagem, não resultado.
  if (!etapa.conversion_event) {
    return { status: 'ignorado', motivo: `etapa "${etapa.nome}" nao tem meta de conversao` };
  }
  if (!etapa.conversion_action_id) {
    return {
      status: 'ignorado',
      motivo: `etapa "${etapa.nome}" sem id da acao de conversao — gere as metas no perfil do cliente`,
    };
  }

  const cfg = await env.DB.prepare(
    'SELECT ga_customer_id, ga_currency, validate_only FROM tenant_config WHERE tenant_id = ?',
  )
    .bind(tenantId)
    .first<Config>();
  if (!cfg?.ga_customer_id) {
    return { status: 'ignorado', motivo: 'cliente sem conta do Google Ads no perfil' };
  }

  const protocolo = await acharProtocolo(env, tenantId, p, taskId);
  if (!protocolo) {
    // Lead orgânico não tem clique; sem clique não há o que atribuir. Não é
    // erro — é a metade dos cards.
    return { status: 'ignorado', motivo: `card ${taskId}: sem protocolo, nao ha clique para atribuir` };
  }

  const lead = await env.DB.prepare(
    `SELECT email, phone_e164, gclid, gbraid, wbraid, valor_proposta
     FROM leads WHERE tenant_id = ? AND protocol = ?`,
  )
    .bind(tenantId, protocolo)
    .first<Lead>();
  if (!lead) {
    return { status: 'ignorado', motivo: `protocolo ${protocolo} sem clique registrado em leads` };
  }

  const valor = etapa.conversion_value ?? num(p.value) ?? lead.valor_proposta;
  const quando = data(str(p.step_changed_at) ?? str(p.updated_at)) ?? Date.now();
  const sombra = cfg.validate_only === 1;
  const chave = `${protocolo}-${etapa.conversion_event}`;

  // A linha nasce aqui, antes da rede. `INSERT OR IGNORE` contra o UNIQUE é o
  // dedup inteiro — atômico, sem ler-e-depois-escrever.
  const posto = await env.DB.prepare(
    `INSERT OR IGNORE INTO conversions
       (tenant_id, dedupe_key, protocol, conversion_event, conversion_action,
        conversion_value, currency, status, validate_only, event_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pendente', ?, ?)`,
  )
    .bind(
      tenantId, chave, protocolo, etapa.conversion_event, etapa.conversion_action_id,
      valor, cfg.ga_currency, sombra ? 1 : 0, new Date(quando).toISOString(),
    )
    .run();

  if (!posto.meta.changes) {
    // Já existe. Só reenvia o que não chegou ao Google: 'enviado' é definitivo,
    // 'ignorado' foi decidido por falta de dado e não melhora com retentativa.
    const atual = await env.DB.prepare(
      'SELECT status FROM conversions WHERE tenant_id = ? AND dedupe_key = ?',
    )
      .bind(tenantId, chave)
      .first<{ status: string }>();
    if (atual?.status !== 'erro' && atual?.status !== 'pendente') {
      return { status: 'ignorado', motivo: `conversao ${chave} ja enviada (${atual?.status})` };
    }
  }

  const evento = await montarEvento({
    accountId: cfg.ga_customer_id,
    conversionActionId: etapa.conversion_action_id,
    gclid: lead.gclid, gbraid: lead.gbraid, wbraid: lead.wbraid,
    quando, valor, moeda: cfg.ga_currency, transactionId: chave,
    email: lead.email, telefone: lead.phone_e164,
  });

  if (!evento) {
    await fechar(env, tenantId, chave, 'ignorado', {
      erro: 'sem gclid e sem e-mail/telefone — o Google nao teria como atribuir',
    });
    return {
      status: 'ignorado',
      motivo: `${chave}: sem identificador de clique e sem dados do lead`,
    };
  }

  const tipo = classificar(evento);

  try {
    const r = await GoogleAdsClient.fromEnv(env).ingestEvents(
      montarCorpo(
        cfg.ga_customer_id, etapa.conversion_action_id, [evento], sombra,
        exigir(env, 'GOOGLE_ADS_MCC_ID'),
      ),
    );

    // A Data Manager responde 200 e reporta a recusa DENTRO do corpo. Tratar
    // isso como sucesso é o mesmo engano do Pulseboard, que devolve 200 com
    // `sent: 0`.
    if (r.erros.length) {
      await fechar(env, tenantId, chave, 'erro', { erro: r.erros.join('; '), tipo });
      return { status: 'erro', motivo: `${chave} recusada: ${r.erros.join('; ')}` };
    }

    await fechar(env, tenantId, chave, 'enviado', { requestId: r.requestId ?? null, tipo });
    return {
      status: 'ok',
      motivo:
        `${chave} → "${etapa.nome}"` +
        (valor !== null ? ` · ${cfg.ga_currency} ${valor}` : '') +
        ` · ${tipo}` +
        (sombra ? ' · modo sombra (nao contabilizada)' : ''),
    };
  } catch (e) {
    const erro = (e as Error).message.slice(0, 300);
    await fechar(env, tenantId, chave, 'erro', { erro, tipo });
    // possivelmente transitorio: a fila retenta e encontra a linha em 'erro'
    return { status: 'erro', motivo: `${chave}: ${erro}` };
  }
}

/**
 * O protocolo, na ordem em que dá para confiar nele.
 *
 * O card é a fonte melhor — foi lá que `leadMessage` carimbou. A conversa é o
 * resgate para o card cujo atributo se perdeu num `PUT` que substituiu o objeto
 * inteiro, que é como o Chatwoot trata custom attributes.
 */
async function acharProtocolo(
  env: Env,
  tenantId: number,
  p: Rec,
  taskId: number | null,
): Promise<string | null> {
  const doCard = str(obj(p.custom_attributes)?.protocolo);
  if (doCard) return doCard;

  const ids = [
    ...(Array.isArray(p.conversations) ? p.conversations.map((c) => num(obj(c)?.id)) : []),
  ].filter((n): n is number => n !== null);

  if (ids.length) {
    const l = await env.DB.prepare(
      `SELECT protocol FROM conversations
       WHERE tenant_id = ? AND cw_conversation_id IN (${ids.map(() => '?').join(',')})
         AND protocol IS NOT NULL LIMIT 1`,
    )
      .bind(tenantId, ...ids)
      .first<{ protocol: string }>();
    if (l?.protocol) return l.protocol;
  }

  if (taskId !== null) {
    const l = await env.DB.prepare(
      'SELECT protocol FROM conversations WHERE tenant_id = ? AND task_id = ? AND protocol IS NOT NULL LIMIT 1',
    )
      .bind(tenantId, taskId)
      .first<{ protocol: string }>();
    if (l?.protocol) return l.protocol;
  }

  return null;
}

/** Como o Google vai conseguir casar esta conversão — vai para a tela. */
function classificar(ev: { adIdentifiers?: unknown; userData?: unknown }): string {
  if (ev.adIdentifiers && ev.userData) return 'click_id+user_data';
  if (ev.adIdentifiers) return 'click_id';
  return 'user_data_only';
}

async function fechar(
  env: Env,
  tenantId: number,
  chave: string,
  status: 'enviado' | 'erro' | 'ignorado',
  d: { requestId?: string | null; erro?: string; tipo?: string },
): Promise<void> {
  await env.DB.prepare(
    `UPDATE conversions
     SET status = ?, request_id = ?, erro = ?, match_type = COALESCE(?, match_type),
         sent_at = CASE WHEN ? = 'enviado' THEN datetime('now') ELSE sent_at END
     WHERE tenant_id = ? AND dedupe_key = ?`,
  )
    .bind(status, d.requestId ?? null, d.erro ?? null, d.tipo ?? null, status, tenantId, chave)
    .run()
    .catch(() => undefined);
}

type Rec = Record<string, unknown>;

function obj(v: unknown): Rec | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}
function data(v: string | null): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}
