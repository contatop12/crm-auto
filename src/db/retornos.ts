/**
 * O que `retornos` (lead que volta, ver pipelines/retorno.ts) diz de um card.
 *
 * A volta de um card e' dado, nao texto: um perfil do WhatsApp chamado
 * "Ana #2" deixa o titulo do card terminado em " #2" sem ser volta nenhuma.
 * Quem diz que o card e' o da volta n e' a linha de `retornos` que o criou.
 * `task_novo` e `task_anterior` sao TEXT: o id do card vai como texto.
 */

/** A volta do card (o card novo da volta n), 0 = card comum. */
export async function voltaDoCard(db: D1Database, tenantId: number, taskId: number): Promise<number> {
  const r = await db
    .prepare('SELECT n FROM retornos WHERE tenant_id = ? AND task_novo = ?')
    .bind(tenantId, String(taskId))
    .first<{ n: number }>();
  return r?.n ?? 0;
}

/** A volta de cada card novo do cliente, de uma vez: o lote de cards nao paga uma consulta por card. */
export async function voltasDosCards(db: D1Database, tenantId: number): Promise<Map<number, number>> {
  const { results } = await db
    .prepare('SELECT task_novo, n FROM retornos WHERE tenant_id = ? AND task_novo IS NOT NULL')
    .bind(tenantId)
    .all<{ task_novo: string; n: number }>();
  return new Map(results.map((r) => [Number(r.task_novo), r.n]));
}
