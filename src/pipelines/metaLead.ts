import type { Env } from '../env';
import { parseMetaLead, protocoloMeta } from '../domain/metaLead';

/**
 * Lead do formulário nativo do Meta.
 *
 * Só grava. Não avisa grupo, não promove card, não sobe conversão — nada disso
 * acontece aqui porque nada disso aconteceu ainda: a pessoa preencheu um
 * formulário dentro do Meta, e o vendedor é quem vai procurar.
 *
 * O trabalho real acontece depois, sozinho: quando essa pessoa aparecer no
 * WhatsApp, `leadMessage` casa a conversa pelo telefone dentro da janela e a
 * partir dali o lead segue o mesmo caminho de qualquer outro. O cruzamento que
 * o cliente pediu já existia — faltava a metade de cá.
 */

interface Resultado {
  status: 'ok' | 'ignorado' | 'erro';
  motivo: string;
}

export async function registrarLeadMeta(
  env: Env,
  tenantId: number,
  payload: string,
): Promise<Resultado> {
  let cru: unknown;
  try {
    cru = JSON.parse(payload);
  } catch {
    return { status: 'ignorado', motivo: 'payload nao e json' };
  }

  const lead = parseMetaLead(cru);
  if (!lead) {
    // Sem telefone o lead não encontra a conversa depois, e ficaria no banco
    // sem servir para nada. Melhor recusar do que guardar lixo.
    return { status: 'ignorado', motivo: 'formulario sem telefone utilizavel' };
  }

  const cfg = await env.DB.prepare(
    'SELECT gtm_prefixo FROM tenant_config WHERE tenant_id = ?',
  )
    .bind(tenantId)
    .first<{ gtm_prefixo: string | null }>();

  const protocolo = protocoloMeta(cfg?.gtm_prefixo ?? '', lead.leadgenId, lead.telefone);

  // `COALESCE` porque a automação pode reenviar o mesmo lead: o reenvio
  // atualiza o que veio preenchido e não apaga o que já estava.
  await env.DB.prepare(
    `INSERT INTO leads (tenant_id, protocol, nome, email, phone_raw, phone_e164, phone_key,
                        utm_source, utm_medium, utm_campaign, utm_content, utm_term,
                        origem, evento)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'meta', 'lead_form', ?, ?, ?, 'formulario', 'meta_lead_form')
     ON CONFLICT (tenant_id, protocol) DO UPDATE SET
       nome         = COALESCE(excluded.nome, leads.nome),
       email        = COALESCE(excluded.email, leads.email),
       phone_e164   = COALESCE(excluded.phone_e164, leads.phone_e164),
       phone_key    = COALESCE(excluded.phone_key, leads.phone_key),
       utm_campaign = COALESCE(excluded.utm_campaign, leads.utm_campaign),
       utm_content  = COALESCE(excluded.utm_content, leads.utm_content),
       utm_term     = COALESCE(excluded.utm_term, leads.utm_term),
       updated_at   = datetime('now')`,
  )
    .bind(
      tenantId, protocolo, lead.nome, lead.email, lead.telefone, lead.telefone, lead.phoneKey,
      lead.campanha, lead.anuncio, lead.conjunto,
    )
    .run();

  return {
    status: 'ok',
    motivo:
      `lead de formulario do Meta gravado: ${protocolo}` +
      (lead.nome ? ` · ${lead.nome}` : '') +
      (lead.campanha ? ` · ${lead.campanha}` : '') +
      ' · aguarda a conversa no WhatsApp para casar pelo telefone',
  };
}
