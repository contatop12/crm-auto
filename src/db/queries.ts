/** Queries tipadas do D1. Nenhuma outra camada monta SQL. */

export interface Tenant {
  id: number;
  slug: string;
  nome: string;
  ativo: number;
  cwAccountId: number | null;
  cwBoardFunilId: number | null;
  cwBoardOrganicoId: number | null;
  gaCustomerId: string | null;
  ingestKey: string;
  cwWebhookSecret: string | null;
  validateOnly: number;
}

const CAMPOS_TENANT = `
  t.id, t.slug, t.nome, t.ativo,
  c.cw_account_id       AS cwAccountId,
  c.cw_board_funil_id   AS cwBoardFunilId,
  c.cw_board_organico_id AS cwBoardOrganicoId,
  c.ga_customer_id      AS gaCustomerId,
  c.ingest_key          AS ingestKey,
  c.cw_webhook_secret   AS cwWebhookSecret,
  c.validate_only       AS validateOnly
`;

export async function tenantPorSlug(db: D1Database, slug: string): Promise<Tenant | null> {
  const row = await db
    .prepare(
      `SELECT ${CAMPOS_TENANT} FROM tenants t
       LEFT JOIN tenant_config c ON c.tenant_id = t.id
       WHERE t.slug = ? AND t.ativo = 1`,
    )
    .bind(slug)
    .first<Tenant>();
  return row ?? null;
}

export async function listarTenants(db: D1Database): Promise<Tenant[]> {
  const { results } = await db
    .prepare(
      `SELECT ${CAMPOS_TENANT} FROM tenants t
       LEFT JOIN tenant_config c ON c.tenant_id = t.id
       ORDER BY t.nome`,
    )
    .all<Tenant>();
  return results;
}

export interface NovoEvento {
  tenantId: number | null;
  source: 'click' | 'chatwoot' | 'kanban';
  eventType: string;
  payload: string;
  signatureOk: boolean | null;
  motivo?: string | undefined;
  status?: string | undefined;
}

/** Grava o evento cru e devolve o id, que e' o que viaja na fila. */
export async function registrarEvento(db: D1Database, e: NovoEvento): Promise<number> {
  const r = await db
    .prepare(
      `INSERT INTO events (tenant_id, source, event_type, payload, signature_ok, motivo, status)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(
      e.tenantId,
      e.source,
      e.eventType,
      e.payload,
      e.signatureOk === null ? null : e.signatureOk ? 1 : 0,
      e.motivo ?? null,
      e.status ?? 'recebido',
    )
    .first<{ id: number }>();
  return r!.id;
}

export async function eventoPorId(db: D1Database, id: number) {
  return db
    .prepare(`SELECT * FROM events WHERE id = ?`)
    .bind(id)
    .first<{ id: number; tenant_id: number; source: string; event_type: string; payload: string }>();
}

export async function marcarEvento(
  db: D1Database,
  id: number,
  status: 'ok' | 'ignorado' | 'erro' | 'processando',
  motivo?: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE events
       SET status = ?, motivo = COALESCE(?, motivo),
           tentativas = tentativas + 1, processed_at = datetime('now')
       WHERE id = ?`,
    )
    .bind(status, motivo ?? null, id)
    .run();
}

export async function listarEventos(db: D1Database, tenantId: number | null, limite = 100) {
  const sql = tenantId
    ? `SELECT id, tenant_id, source, event_type, signature_ok, status, motivo, tentativas, received_at
       FROM events WHERE tenant_id = ? ORDER BY received_at DESC LIMIT ?`
    : `SELECT id, tenant_id, source, event_type, signature_ok, status, motivo, tentativas, received_at
       FROM events ORDER BY received_at DESC LIMIT ?`;
  const stmt = tenantId
    ? db.prepare(sql).bind(tenantId, limite)
    : db.prepare(sql).bind(limite);
  const { results } = await stmt.all();
  return results;
}
