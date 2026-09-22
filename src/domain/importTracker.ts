/**
 * Importacao unica da Taina, do whatsapp-track para o CRM.
 *
 * Puro e sem import nenhum: roda no Vitest e tambem direto no Node, pelo
 * `scripts/importar-tracker.mjs` (que passa o `phoneKey`). Nao le nem grava
 * nada — devolve os comandos, e quem chama decide se aplica.
 *
 * O que vem:
 *  - a credencial da Meta, ainda cifrada (a MASTER_KEY e' a mesma), com o
 *    envio DESLIGADO: ligar e' passo separado da virada;
 *  - os cliques de anuncio (`ctwa_clid`), para o lead que ja' clicou achar o
 *    clique quando voltar a conversar;
 *  - os envios que a Meta aceitou, com o `event_id` original: e' a trava que
 *    impede o CRM de mandar de novo o que o tracker ja' mandou.
 */

export interface ClienteTracker {
  meta_dataset_id: string | null;
  meta_token_cipher: string | null;
  meta_token_iv: string | null;
  meta_token_last4: string | null;
  meta_token_valid: number | null;
  meta_token_checked_at: string | null;
  meta_page_id: string | null;
  meta_waba_id: string | null;
}

export interface AtribuicaoTracker {
  phone_e164: string;
  ctwa_clid: string;
  ad_id: string | null;
  source_url: string | null;
  first_message_at: string;
}

export interface EventoTracker {
  event_id: string;
  event_name: string;
  phone_e164: string;
  value: number | null;
  currency: string | null;
  status: string;
  http_code: number | null;
  created_at: string;
  sent_at: string | null;
}

export interface Comando {
  sql: string;
  params: unknown[];
}

/** '2026-09-18T10:00:00.000Z' → '2026-09-18 10:00:00', o formato que o painel le'. */
export function dataDoD1(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 19).replace('T', ' ') : null;
}

export function planoDeImportacao(
  tenantId: number,
  dados: { cliente: ClienteTracker; atribuicoes: AtribuicaoTracker[]; eventos: EventoTracker[] },
  phoneKey: (telefone: string) => string,
): Comando[] {
  const c = dados.cliente;
  const comandos: Comando[] = [{
    sql: `UPDATE tenant_config SET
            meta_dataset_id = ?, meta_token_cipher = ?, meta_token_iv = ?, meta_token_last4 = ?,
            meta_token_valido = ?, meta_token_conferido_em = ?, meta_page_id = ?, meta_waba_id = ?,
            meta_dry_run = 1, updated_at = datetime('now')
          WHERE tenant_id = ?`,
    params: [
      c.meta_dataset_id, c.meta_token_cipher, c.meta_token_iv, c.meta_token_last4,
      c.meta_token_valid === 1 ? 1 : 0, dataDoD1(c.meta_token_checked_at), c.meta_page_id, c.meta_waba_id,
      tenantId,
    ],
  }];

  for (const a of dados.atribuicoes) {
    const chave = phoneKey(a.phone_e164);
    if (!chave || !a.ctwa_clid) continue;
    comandos.push({
      sql: `INSERT OR IGNORE INTO meta_atribuicoes
              (tenant_id, phone_key, phone_e164, ctwa_clid, ad_id, source_url, origem, recebido_em)
            VALUES (?, ?, ?, ?, ?, ?, 'tracker', ?)`,
      params: [tenantId, chave, a.phone_e164, a.ctwa_clid, a.ad_id, a.source_url, dataDoD1(a.first_message_at)],
    });
  }

  // So' o que a Meta aceitou: o que falhou no tracker o CRM pode mandar
  for (const e of dados.eventos) {
    if (e.status !== 'enviado' || (e.event_name !== 'LeadSubmitted' && e.event_name !== 'Purchase')) continue;
    comandos.push({
      sql: `INSERT OR IGNORE INTO meta_eventos
              (tenant_id, dedupe_key, event_id, phone_key, canal, event_name, value, currency,
               status, http_code, origem, event_at, sent_at)
            VALUES (?, ?, ?, ?, 'whatsapp', ?, ?, ?, 'enviado', ?, 'tracker', ?, ?)`,
      params: [
        tenantId, e.event_id, e.event_id, phoneKey(e.phone_e164) || null, e.event_name, e.value, e.currency,
        e.http_code, e.created_at, dataDoD1(e.sent_at),
      ],
    });
  }
  return comandos;
}
