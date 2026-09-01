/** Consultas que alimentam a visão de funcionamento por cliente. */
import { resumirEvento, nomeDoPipeline, type ResumoEvento, type BoardsDoTenant } from '../domain/resumoEvento';

export interface ResumoTenant {
  tenant_id: number;
  slug: string;
  nome: string;
  ativo: number;
  /** Contagens das ultimas 24h. */
  recebidos_24h: number;
  ok_24h: number;
  ignorados_24h: number;
  erros_24h: number;
  /** Ultimo evento de qualquer tipo, e o ultimo que deu erro. */
  ultimo_evento_em: string | null;
  ultimo_erro_em: string | null;
  ultimo_erro_motivo: string | null;
  conversoes_enviadas: number;
  conversoes_erro: number;
  leads: number;
}

/**
 * Uma linha por cliente com tudo que a tela inicial precisa.
 *
 * Feita como uma consulta so, com subselects: o painel abre com N clientes e
 * uma consulta por cliente vira N+1 idas ao D1.
 */
export async function resumoPorTenant(db: D1Database): Promise<ResumoTenant[]> {
  const { results } = await db
    .prepare(
      `SELECT
         t.id AS tenant_id, t.slug, t.nome, t.ativo,
         (SELECT COUNT(*) FROM events e WHERE e.tenant_id = t.id
            AND e.received_at >= datetime('now','-1 day')) AS recebidos_24h,
         (SELECT COUNT(*) FROM events e WHERE e.tenant_id = t.id AND e.status = 'ok'
            AND e.received_at >= datetime('now','-1 day')) AS ok_24h,
         (SELECT COUNT(*) FROM events e WHERE e.tenant_id = t.id AND e.status = 'ignorado'
            AND e.received_at >= datetime('now','-1 day')) AS ignorados_24h,
         (SELECT COUNT(*) FROM events e WHERE e.tenant_id = t.id AND e.status = 'erro'
            AND e.received_at >= datetime('now','-1 day')) AS erros_24h,
         (SELECT MAX(received_at) FROM events e WHERE e.tenant_id = t.id) AS ultimo_evento_em,
         (SELECT MAX(received_at) FROM events e WHERE e.tenant_id = t.id AND e.status = 'erro') AS ultimo_erro_em,
         (SELECT e.motivo FROM events e WHERE e.tenant_id = t.id AND e.status = 'erro'
            ORDER BY e.received_at DESC LIMIT 1) AS ultimo_erro_motivo,
         (SELECT COUNT(*) FROM conversions c WHERE c.tenant_id = t.id AND c.status = 'enviado') AS conversoes_enviadas,
         (SELECT COUNT(*) FROM conversions c WHERE c.tenant_id = t.id AND c.status = 'erro') AS conversoes_erro,
         (SELECT COUNT(*) FROM leads l WHERE l.tenant_id = t.id) AS leads
       FROM tenants t
       ORDER BY t.ativo DESC, t.nome`,
    )
    .all<ResumoTenant>();
  return results;
}

export interface LinhaEvento {
  id: number;
  source: string;
  event_type: string;
  status: string;
  motivo: string | null;
  signature_ok: number | null;
  tentativas: number;
  received_at: string;
  processed_at: string | null;
  tem_payload: number;
  /** O que o pipeline faz, em termos de negocio. */
  pipeline: string;
  /** Quem e' o evento, lido do payload e ja mascarado. */
  resumo: ResumoEvento;
}

/** Ultimos eventos do cliente. O payload NAO vem aqui — so no detalhe. */
export async function eventosDoTenant(
  db: D1Database,
  tenantId: number,
  filtros: { status?: string; source?: string; limite?: number } = {},
  boards: BoardsDoTenant = { organico: null, funil: null },
): Promise<LinhaEvento[]> {
  const cond: string[] = ['tenant_id = ?'];
  const bind: unknown[] = [tenantId];

  if (filtros.status) { cond.push('status = ?'); bind.push(filtros.status); }
  if (filtros.source) { cond.push('source = ?'); bind.push(filtros.source); }

  bind.push(Math.min(filtros.limite ?? 50, 200));

  // O payload sai do banco so' para virar resumo — nunca chega ao navegador.
  const { results } = await db
    .prepare(
      `SELECT id, source, event_type, status, motivo, signature_ok, tentativas,
              received_at, processed_at, payload,
              CASE WHEN payload IS NULL OR payload = '' THEN 0 ELSE 1 END AS tem_payload
       FROM events WHERE ${cond.join(' AND ')}
       ORDER BY received_at DESC LIMIT ?`,
    )
    .bind(...bind)
    .all<LinhaEvento & { payload: string | null }>();

  return results.map(({ payload, ...linha }) => ({
    ...linha,
    pipeline: nomeDoPipeline(linha.source, linha.event_type),
    resumo: resumirEvento(payload, boards),
  }));
}

export async function payloadDoEvento(
  db: D1Database,
  tenantId: number,
  eventId: number,
): Promise<{ payload: string | null; received_at: string } | null> {
  // o tenant_id no WHERE evita que um id de outro cliente seja lido por engano
  return db
    .prepare('SELECT payload, received_at FROM events WHERE id = ? AND tenant_id = ?')
    .bind(eventId, tenantId)
    .first<{ payload: string | null; received_at: string }>();
}

/**
 * Apaga o corpo dos eventos com mais de N dias, preservando a linha.
 * O historico de status continua; o dado pessoal nao fica para sempre.
 */
export async function expurgarPayloadsAntigos(db: D1Database, dias = 30): Promise<number> {
  const r = await db
    .prepare(
      `UPDATE events SET payload = ''
       WHERE payload != '' AND received_at < datetime('now', ?)`,
    )
    .bind(`-${dias} day`)
    .run();
  return r.meta.changes ?? 0;
}
