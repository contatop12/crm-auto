/** O clique de anuncio da Meta (`ctwa_clid`) que a Evolution guardou para um telefone. */
export interface AtribuicaoMeta {
  ctwa_clid: string;
  source_url: string | null;
  titulo: string | null;
  ad_id: string | null;
}

/**
 * O clique mais recente deste telefone, dentro dos 7 dias em que a Meta
 * atribui a conversa ao anuncio.
 *
 * `referencia` e' o fim da janela: 'now' na mensagem que acabou de chegar, a
 * criacao do lead no envio de uma etapa posterior. Aceita um dia depois da
 * referencia para cobrir o clique que chegou atrasado.
 */
export async function clidRecente(
  db: D1Database,
  tenantId: number,
  phoneKey: string | null,
  referencia = 'now',
): Promise<AtribuicaoMeta | null> {
  if (!phoneKey) return null;
  return db
    .prepare(
      `SELECT ctwa_clid, source_url, titulo, ad_id FROM meta_atribuicoes
       WHERE tenant_id = ? AND phone_key = ?
         AND recebido_em >= datetime(?, '-7 day') AND recebido_em <= datetime(?, '+1 day')
       ORDER BY recebido_em DESC LIMIT 1`,
    )
    .bind(tenantId, phoneKey, referencia, referencia)
    .first<AtribuicaoMeta>();
}
