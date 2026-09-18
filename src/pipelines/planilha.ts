import type { Env } from '../env';
import { postarNaPlanilha } from '../clients/n8n';
import { montarRegistro, type ContextoPlanilha, type LeadDaPlanilha } from '../domain/planilha';

/**
 * Entrega o lead ao n8n, que escreve nas planilhas do cliente.
 *
 * Dois momentos chamam: o clique (o lead chegou — vira a linha da aba Cliques
 * do Banco de Dados) e a conversao enviada ao Google (atualiza essa linha,
 * acrescenta na aba Conversoes e, na de entrada, na planilha geral de leads).
 *
 * Quem chama nunca deve falhar por causa disto: a planilha e' onde o time do
 * cliente trabalha, nao a fonte da verdade. Por isso o erro sobe e quem chama
 * so' registra.
 */
export async function espelharNaPlanilha(
  env: Env,
  tenantId: number,
  ctx: Omit<ContextoPlanilha, 'cliente'>,
): Promise<void> {
  const cfg = await env.DB.prepare(
    `SELECT c.sheets_ativo, c.planilha_webhook_url, t.nome AS cliente
     FROM tenant_config c JOIN tenants t ON t.id = c.tenant_id WHERE c.tenant_id = ?`,
  )
    .bind(tenantId)
    .first<{ sheets_ativo: number; planilha_webhook_url: string | null; cliente: string }>();

  if (!cfg || cfg.sheets_ativo !== 1 || !cfg.planilha_webhook_url) return;

  const lead = await env.DB.prepare(
    `SELECT nome, email, phone_e164, gclid, gbraid, wbraid, utm_source, utm_medium,
            utm_campaign, utm_id, utm_term, utm_content, fbp, fbc, client_id, origem,
            evento, page_url, whatsapp_url, referrer, user_agent, quiz_version,
            quiz_valor, quiz_form_id, valor_proposta, created_at
     FROM leads WHERE tenant_id = ? AND protocol = ?`,
  )
    .bind(tenantId, ctx.protocolo)
    .first<LeadDaPlanilha>();

  const r = await postarNaPlanilha(
    cfg.planilha_webhook_url,
    montarRegistro({ ...ctx, cliente: cfg.cliente }, lead),
  );
  console.log(JSON.stringify({ acao: 'planilha_ok', tipo: ctx.tipo, protocolo: ctx.protocolo, gravado: r.gravado }));
}
