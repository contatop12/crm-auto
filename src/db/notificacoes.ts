import type { Env } from '../env';
import {
  agruparErros,
  avisosDeConfiguracao,
  avisosDoVigia,
  ordenar,
  type ConfigCliente,
  type ErroEvento,
  type Notificacao,
} from '../domain/notificacoes';
import type { EstadoVigia } from '../domain/vigiaWhatsapp';

/** Mesma chave que o vigia usa no KV. */
const CHAVE_VIGIA = 'vigia:whatsapp';

/** Erro mais velho que isto ja' saiu da central (continua no log do cliente). */
const JANELA_ERROS_DIAS = 14;

export async function listarNotificacoes(env: Env): Promise<Notificacao[]> {
  const [erros, enviadas, cfgs, dispensadas, vigia] = await Promise.all([
    env.DB.prepare(
      `SELECT e.id, e.tenant_id, t.nome AS cliente, e.source, e.event_type, e.motivo, e.received_at
       FROM events e LEFT JOIN tenants t ON t.id = e.tenant_id
       WHERE e.status = 'erro' AND e.resolvido_em IS NULL
         AND e.received_at >= datetime('now', ?)
       ORDER BY e.received_at DESC LIMIT 500`,
    )
      .bind(`-${JANELA_ERROS_DIAS} day`)
      .all<ErroEvento>(),
    env.DB.prepare(
      `SELECT tenant_id, dedupe_key FROM conversions
       WHERE status = 'enviado' AND validate_only = 0 AND sent_at >= datetime('now', ?)`,
    )
      .bind(`-${JANELA_ERROS_DIAS + 1} day`)
      .all<{ tenant_id: number; dedupe_key: string }>(),
    env.DB.prepare(
      `SELECT t.id AS tenant_id, t.nome AS cliente, c.validate_only, c.pulseboard_ativo, c.pulseboard_url,
              CASE WHEN c.cw_webhook_secret IS NULL THEN 0 ELSE 1 END AS tem_segredo,
              c.cw_account_id, c.ga_customer_id,
              (SELECT COUNT(*) FROM funnel_stages f WHERE f.tenant_id = t.id) AS etapas,
              (SELECT COUNT(*) FROM funnel_stages f WHERE f.tenant_id = t.id AND f.conversion_action_id IS NOT NULL) AS etapas_com_meta,
              (SELECT COUNT(*) FROM stage_triggers g WHERE g.tenant_id = t.id) AS gatilhos
       FROM tenants t JOIN tenant_config c ON c.tenant_id = t.id
       WHERE t.ativo = 1`,
    ).all<ConfigCliente>(),
    env.DB.prepare('SELECT chave FROM notificacoes_dispensadas').all<{ chave: string }>(),
    env.CACHE.get(CHAVE_VIGIA, 'json').catch(() => null) as Promise<EstadoVigia | null>,
  ]);

  const jaSubiram = new Set((enviadas.results ?? []).map((r) => `${r.tenant_id}:${r.dedupe_key}`));
  const fora = new Set((dispensadas.results ?? []).map((r) => r.chave));
  const todas = [
    ...agruparErros(erros.results ?? [], jaSubiram),
    ...avisosDoVigia(vigia ?? {}),
    ...avisosDeConfiguracao(cfgs.results ?? [], ''),
  ];
  return ordenar(todas.filter((n) => !fora.has(n.chave)));
}

/**
 * Resolve (erro de evento) ou dispensa (os demais).
 *
 * Erro de evento e' marcado no proprio evento — e' isso que tira o "ultimo
 * erro" do cartao do cliente. So' marca linha que ainda e' erro em aberto:
 * id inventado ou de outro status nao muda nada.
 */
export async function resolverNotificacao(
  env: Env,
  chave: string,
  ids: number[] | undefined,
  por: string,
): Promise<{ resolvidos: number }> {
  if (chave.startsWith('ev:')) {
    const lista = (ids ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 500);
    if (!lista.length) return { resolvidos: 0 };
    let resolvidos = 0;
    // o D1 limita os parametros por consulta: em lotes
    for (let i = 0; i < lista.length; i += 90) {
      const lote = lista.slice(i, i + 90);
      const r = await env.DB.prepare(
        `UPDATE events SET resolvido_em = datetime('now'), resolvido_por = ?
         WHERE status = 'erro' AND resolvido_em IS NULL AND id IN (${lote.map(() => '?').join(',')})`,
      )
        .bind(por, ...lote)
        .run();
      resolvidos += Number(r.meta?.changes ?? 0);
    }
    return { resolvidos };
  }
  await env.DB.prepare(
    'INSERT OR REPLACE INTO notificacoes_dispensadas (chave, por) VALUES (?, ?)',
  )
    .bind(chave, por)
    .run();
  return { resolvidos: 1 };
}
