import type { Env } from '../env';
import { exigir } from '../domain/config';
import { decifrarToken } from '../domain/segredoMeta';
import { corpoMeta, montarEventoMeta, type EventoMeta } from '../domain/eventoMeta';
import type { CanalMeta } from '../domain/plataformaLead';
import { postarEventos, type RespostaMeta } from '../clients/metaCapi';
import { registrarEvento } from '../db/queries';

/**
 * Conversoes da Meta: do evento criado pela etapa do funil ate' a Conversions API.
 *
 * Cada envio e' uma execucao propria da fila (`kanban` / `meta_capi`). A
 * conversao do Google ja' gasta ~15 subrequests por execucao (ver o
 * `max_batch_size` no wrangler.jsonc); a Meta nao pode disputar esse teto.
 *
 * A linha em `meta_eventos` nasce antes da rede, como a de `conversions`: se a
 * Meta cair no meio fica o registro do que foi tentado, e a retentativa acha a
 * linha em `falhou` e reenvia em vez de achar que ja' subiu.
 */

export interface ResultadoMeta {
  status: 'ok' | 'ignorado' | 'erro';
  motivo: string;
  /** false = erro do dado ou do cadastro: retentar nao muda nada. */
  retentar?: boolean;
}

/** A Meta recusa evento com mais de 7 dias. */
const IDADE_MAXIMA_MS = 7 * 24 * 3600 * 1000;

interface LinhaEvento {
  id: number;
  dedupe_key: string;
  event_id: string;
  protocol: string | null;
  canal: CanalMeta;
  event_name: EventoMeta;
  value: number | null;
  currency: string | null;
  status: string;
  event_at: string;
}

interface ConfigMeta {
  meta_dataset_id: string | null;
  meta_page_id: string | null;
  meta_waba_id: string | null;
  meta_test_event_code: string | null;
  meta_token_cipher: string | null;
  meta_token_iv: string | null;
  meta_dry_run: number;
}

interface LeadMeta {
  phone_e164: string | null;
  email: string | null;
  ctwa_clid: string | null;
  fbc: string | null;
  fbp: string | null;
  ip_address: string | null;
  user_agent: string | null;
  page_url: string | null;
}

/**
 * Enfileira o envio de um evento ja' gravado em `meta_eventos`.
 *
 * A linha em `events` e' o que viaja na fila (o consumidor le' o payload de
 * la') e e' o que faz uma falha aparecer em Atividade e nas notificacoes.
 */
export async function enfileirarEventoMeta(
  env: Env,
  tenantId: number,
  metaEventoId: number,
  dedupeKey: string,
): Promise<void> {
  const eventId = await registrarEvento(env.DB, {
    tenantId,
    source: 'kanban',
    eventType: 'meta_capi',
    payload: JSON.stringify({ meta_evento_id: metaEventoId, dedupe_key: dedupeKey }),
    signatureOk: null,
  });
  await env.QUEUE.send({ eventId, tenantId, source: 'kanban', eventType: 'meta_capi' });
}

export async function enviarEventoMeta(env: Env, tenantId: number, payload: string): Promise<ResultadoMeta> {
  let id = NaN;
  try {
    id = Number((JSON.parse(payload) as { meta_evento_id?: unknown }).meta_evento_id);
  } catch {
    /* fica NaN */
  }
  if (!Number.isInteger(id)) return { status: 'ignorado', motivo: 'payload sem meta_evento_id' };

  const ev = await env.DB.prepare(
    `SELECT id, dedupe_key, event_id, protocol, canal, event_name, value, currency, status, event_at
     FROM meta_eventos WHERE id = ? AND tenant_id = ?`,
  )
    .bind(id, tenantId)
    .first<LinhaEvento>();
  if (!ev) return { status: 'ignorado', motivo: `evento da Meta ${id} nao existe mais` };
  if (ev.status === 'enviado') return { status: 'ignorado', motivo: `${ev.dedupe_key} ja enviado a Meta` };

  const cfg = await env.DB.prepare(
    `SELECT meta_dataset_id, meta_page_id, meta_waba_id, meta_test_event_code,
            meta_token_cipher, meta_token_iv, meta_dry_run
     FROM tenant_config WHERE tenant_id = ?`,
  )
    .bind(tenantId)
    .first<ConfigMeta>();
  if (!cfg?.meta_dataset_id) return falhar(env, ev, 'cliente sem dataset da Meta no cadastro');

  const lead = ev.protocol
    ? await env.DB.prepare(
        `SELECT phone_e164, email, ctwa_clid, fbc, fbp, ip_address, user_agent, page_url
         FROM leads WHERE tenant_id = ? AND protocol = ?`,
      )
        .bind(tenantId, ev.protocol)
        .first<LeadMeta>()
    : null;
  if (!lead) return falhar(env, ev, `lead ${ev.protocol ?? '(sem protocolo)'} nao esta em leads`);

  const quando = Date.parse(ev.event_at);
  const montado = await montarEventoMeta({
    canal: ev.canal,
    evento: ev.event_name,
    eventId: ev.event_id,
    quando,
    valor: ev.value,
    moeda: ev.currency ?? 'BRL',
    telefone: lead.phone_e164,
    email: lead.email,
    ctwaClid: lead.ctwa_clid,
    pageId: cfg.meta_page_id,
    wabaId: cfg.meta_waba_id,
    fbc: lead.fbc,
    fbp: lead.fbp,
    ip: lead.ip_address,
    userAgent: lead.user_agent,
    pagina: lead.page_url,
  });
  if (!montado.ok) return falhar(env, ev, montado.erro);

  const corpo = corpoMeta([montado.evento], cfg.meta_test_event_code);
  const pedido = JSON.stringify(corpo);

  // Envio desligado: monta e guarda, nao chama a Meta. O `nao_enviado` volta a
  // valer quando o envio for ligado e a etapa disparar de novo.
  if (cfg.meta_dry_run === 1) {
    await env.DB.prepare(`UPDATE meta_eventos SET status = 'nao_enviado', request_payload = ?, erro = NULL WHERE id = ?`)
      .bind(pedido, ev.id)
      .run();
    return { status: 'ok', motivo: `${ev.dedupe_key}: envio a Meta desligado, montado e guardado sem enviar` };
  }

  if (!Number.isFinite(quando) || Date.now() - quando > IDADE_MAXIMA_MS) {
    return falhar(env, ev, 'evento com mais de 7 dias: a Meta recusa', pedido);
  }
  if (!cfg.meta_token_cipher || !cfg.meta_token_iv) return falhar(env, ev, 'sem token da Meta no cadastro', pedido);

  let token: string;
  try {
    token = await decifrarToken(cfg.meta_token_cipher, cfg.meta_token_iv, exigir(env, 'MASTER_KEY'));
  } catch (e) {
    return falhar(env, ev, `token da Meta nao abriu (a MASTER_KEY confere?): ${(e as Error).message.slice(0, 120)}`, pedido);
  }

  let r: RespostaMeta;
  try {
    r = await postarEventos(cfg.meta_dataset_id, token, corpo);
  } catch (e) {
    // rede ou timeout: a fila retenta e acha a linha em 'falhou'
    const erro = `Meta nao respondeu: ${(e as Error).message.slice(0, 200)}`;
    await gravar(env, ev.id, 'falhou', { erro, pedido });
    return { status: 'erro', motivo: `${ev.dedupe_key}: ${erro}` };
  }

  if (r.http === 200 && r.eventosRecebidos >= 1) {
    await gravar(env, ev.id, 'enviado', { http: r.http, resposta: r.corpo, pedido });
    // envio aceito prova o token: o selo nao fica preso em "nao verificado"
    await env.DB.prepare(
      `UPDATE tenant_config SET meta_token_valido = 1,
         meta_token_conferido_em = COALESCE(meta_token_conferido_em, datetime('now'))
       WHERE tenant_id = ?`,
    )
      .bind(tenantId)
      .run();
    await resolverErrosAnteriores(env, tenantId, ev);
    return {
      status: 'ok',
      motivo:
        `${ev.dedupe_key} → Meta ${String(montado.evento.event_name)} (${ev.canal})` +
        (ev.value ? ` · ${ev.currency ?? 'BRL'} ${ev.value}` : '') +
        (cfg.meta_test_event_code ? ' · codigo de teste (nao conta como conversao)' : ''),
    };
  }

  const detalhe = r.erro?.message ?? (r.http === 200 ? 'nenhum evento aceito' : r.corpo.slice(0, 120));
  const erro = `Meta recusou (${r.http}${r.erro?.error_subcode ? '/' + r.erro.error_subcode : ''}): ${detalhe}`.slice(0, 300);
  await gravar(env, ev.id, 'falhou', { http: r.http, resposta: r.corpo, erro, pedido });
  // 5xx e' da Meta e passa; 4xx (e 200 sem evento aceito) e' do dado e nao passa sozinho
  if (r.http >= 500) return { status: 'erro', motivo: `${ev.dedupe_key}: ${erro}` };
  return { status: 'erro', motivo: `${ev.dedupe_key}: ${erro}`, retentar: false };
}

/** Reenfileira os eventos que falharam. `enviado` nunca volta: contaria duas vezes. */
export async function reenviarFalhasMeta(env: Env, tenantId: number): Promise<{ na_fila: number }> {
  const { results } = await env.DB.prepare(
    `SELECT id, dedupe_key FROM meta_eventos
     WHERE tenant_id = ? AND status = 'falhou' AND origem = 'crm' ORDER BY id LIMIT 50`,
  )
    .bind(tenantId)
    .all<{ id: number; dedupe_key: string }>();
  for (const e of results) {
    await env.DB.prepare(`UPDATE meta_eventos SET status = 'pendente' WHERE id = ?`).bind(e.id).run();
    await enfileirarEventoMeta(env, tenantId, e.id, e.dedupe_key);
  }
  return { na_fila: results.length };
}

async function falhar(env: Env, ev: LinhaEvento, erro: string, pedido?: string): Promise<ResultadoMeta> {
  await gravar(env, ev.id, 'falhou', { erro, pedido });
  return { status: 'erro', motivo: `${ev.dedupe_key}: ${erro}`, retentar: false };
}

async function gravar(
  env: Env,
  id: number,
  status: 'enviado' | 'falhou',
  d: { http?: number; resposta?: string; erro?: string; pedido?: string },
): Promise<void> {
  await env.DB.prepare(
    `UPDATE meta_eventos
     SET status = ?, http_code = ?, response_body = ?, erro = ?,
         request_payload = COALESCE(?, request_payload), tentativas = tentativas + 1,
         sent_at = CASE WHEN ? = 'enviado' THEN datetime('now') ELSE sent_at END
     WHERE id = ?`,
  )
    .bind(status, d.http ?? null, d.resposta ?? null, d.erro ?? null, d.pedido ?? null, status, id)
    .run();
}

/**
 * Subiu: os erros que este evento deixou no log ja' nao sao noticia. A venda
 * que subiu tambem resolve o "sem valor da venda" do mesmo protocolo.
 */
async function resolverErrosAnteriores(env: Env, tenantId: number, ev: LinhaEvento): Promise<void> {
  const semValor = ev.event_name === 'Purchase' && ev.protocol ? `${ev.protocol}: %evento da Meta%` : null;
  await env.DB.prepare(
    `UPDATE events SET resolvido_em = datetime('now'), resolvido_por = 'sistema: o evento subiu para a Meta'
     WHERE tenant_id = ? AND status = 'erro' AND resolvido_em IS NULL
       AND ((event_type = 'meta_capi' AND motivo LIKE ?)
         OR (? IS NOT NULL AND event_type = 'kanban_conversao' AND motivo LIKE ?))`,
  )
    .bind(tenantId, ev.dedupe_key + ':%', semValor, semValor)
    .run()
    .catch(() => undefined);
}
