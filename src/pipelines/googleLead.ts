import type { Env } from '../env';
import { ehTesteDoGoogle, parseGoogleLead, protocoloGoogle } from '../domain/googleLead';

/**
 * Lead do formulario nativo do Google Ads.
 *
 * Como o do Meta (`metaLead`): so' grava. Quem avisa o grupo e' o fluxo do
 * formulario (a Pulseboard), e nao ha' conversa nem card ainda — a pessoa
 * preencheu o formulario dentro do Google.
 *
 * O que muda em relacao ao Meta e' o `gcl_id`: o lead ja' chega com o clique.
 * Quando a pessoa aparece no WhatsApp, `leadMessage` casa a conversa pelo
 * telefone, e dali em diante o lead entra no funil de Ads e as conversoes
 * voltam para a campanha, como as de um clique do site.
 *
 * O teste do proprio Google (`is_test`) nao vira lead: serve para conferir, na
 * tela de Eventos, que o formulario esta' chegando aqui.
 */

/** Tipo do evento em `events` e na fila. A origem e' `meta`: ver a rota `/google-lead`. */
export const EVENTO_GOOGLE_LEAD_FORM = 'google_lead_form';

interface Resultado {
  status: 'ok' | 'ignorado' | 'erro';
  motivo: string;
}

export async function registrarLeadGoogle(env: Env, tenantId: number, payload: string): Promise<Resultado> {
  let cru: unknown;
  try {
    cru = JSON.parse(payload);
  } catch {
    return { status: 'ignorado', motivo: 'payload nao e json' };
  }

  if (ehTesteDoGoogle(cru)) {
    return { status: 'ignorado', motivo: 'teste do formulario do Google (is_test): nada gravado' };
  }

  const lead = parseGoogleLead(cru);
  if (!lead) {
    // Sem telefone o lead nao encontra a conversa depois.
    return { status: 'ignorado', motivo: 'formulario sem telefone utilizavel' };
  }

  const cfg = await env.DB.prepare('SELECT gtm_prefixo FROM tenant_config WHERE tenant_id = ?')
    .bind(tenantId)
    .first<{ gtm_prefixo: string | null }>();
  const protocolo = protocoloGoogle(cfg?.gtm_prefixo ?? '', lead.leadId, lead.telefone);

  // O id da campanha vai em `utm_campaign` e `utm_id`, como no clique do site:
  // a atribuicao troca pelo nome quando a conversa aparecer. `COALESCE` porque
  // a automacao pode reenviar o lead: o reenvio nao apaga o que ja' estava.
  await env.DB.prepare(
    `INSERT INTO leads (tenant_id, protocol, nome, email, phone_raw, phone_e164, phone_key,
                        gclid, utm_source, utm_medium, utm_campaign, utm_id, utm_content,
                        origem, evento)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'google', 'lead_form', ?, ?, ?, 'formulario', 'google_lead_form')
     ON CONFLICT (tenant_id, protocol) DO UPDATE SET
       nome         = COALESCE(excluded.nome, leads.nome),
       email        = COALESCE(excluded.email, leads.email),
       phone_e164   = COALESCE(excluded.phone_e164, leads.phone_e164),
       phone_key    = COALESCE(excluded.phone_key, leads.phone_key),
       gclid        = COALESCE(leads.gclid, excluded.gclid),
       utm_campaign = COALESCE(leads.utm_campaign, excluded.utm_campaign),
       utm_id       = COALESCE(leads.utm_id, excluded.utm_id),
       utm_content  = COALESCE(leads.utm_content, excluded.utm_content),
       updated_at   = datetime('now')`,
  )
    .bind(
      tenantId, protocolo, lead.nome, lead.email, lead.telefone, lead.telefone, lead.phoneKey,
      lead.gclid, lead.campanhaId, lead.campanhaId, lead.anuncioId,
    )
    .run();

  return {
    status: 'ok',
    motivo:
      `lead do formulario do Google gravado: ${protocolo}` +
      (lead.nome ? ` · ${lead.nome}` : '') +
      (lead.gclid ? ' · com gclid' : ' · SEM gclid') +
      ' · aguarda a conversa no WhatsApp para casar pelo telefone',
  };
}
