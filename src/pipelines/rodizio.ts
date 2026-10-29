import type { Env } from '../env';
import { ChatwootClient } from '../clients/chatwoot';
import { agenteDaVez, lerRodizio } from '../domain/rodizio';

/**
 * Rodizio DEPOIS que o lead chega (tenant_config.cw_rodizio).
 *
 * O Chatwoot so' distribui para agente online, e o lead da Locadora ficava sem
 * responsavel ate' alguem pegar. Aqui, na mensagem do lead, a conversa sem
 * responsavel vai para o proximo da lista da caixa — mesmo com o agente
 * offline. Conversa que ja tem dono nunca muda (nem gasta a vez).
 *
 * Nunca derruba a atribuicao do lead: toda falha vira log.
 */
export async function atribuirEmRodizio(env: Env, tenantId: number, payload: string): Promise<void> {
  let conversa: number | null = null;
  try {
    const p = obj(JSON.parse(payload));
    if (!p || p.message_type !== 'incoming' || p.private === true) return;

    const conv = obj(p.conversation);
    conversa = num(conv?.id);
    const inbox = num(obj(p.inbox)?.id) ?? num(conv?.inbox_id);
    if (!conversa || !inbox) return;
    // o webhook ja' diz se tem dono; poupa a consulta ao Chatwoot
    if (obj(obj(conv?.meta)?.assignee) || num(conv?.assignee_id)) return;

    const cfg = await env.DB.prepare('SELECT cw_account_id, cw_rodizio FROM tenant_config WHERE tenant_id = ?')
      .bind(tenantId)
      .first<{ cw_account_id: number | null; cw_rodizio: string | null }>();
    const agentes = lerRodizio(cfg?.cw_rodizio)?.[inbox];
    if (!cfg?.cw_account_id || !agentes) return;

    const cw = ChatwootClient.fromEnv(env);
    // O retrato do webhook pode ser anterior a uma atribuicao do proprio
    // Chatwoot (ou de um humano); so' nessa hora vale uma consulta.
    const atual = obj(await cw.conversa(cfg.cw_account_id, conversa));
    if (obj(obj(atual?.meta)?.assignee)) return;

    // Uma lista de um so' agente nao precisa de contador
    let agente = agentes[0]!;
    if (agentes.length > 1) {
      // UPDATE atomico: duas mensagens simultaneas recebem vezes diferentes
      const r = await env.DB.prepare(
        `INSERT INTO rodizio_estado (tenant_id, inbox_id, proximo) VALUES (?, ?, 1)
         ON CONFLICT (tenant_id, inbox_id) DO UPDATE SET proximo = proximo + 1
         RETURNING proximo`,
      )
        .bind(tenantId, inbox)
        .first<{ proximo: number }>();
      agente = agenteDaVez(agentes, r?.proximo ?? 1);
    }

    await cw.atribuirConversa(cfg.cw_account_id, conversa, agente);
    console.log(JSON.stringify({ acao: 'rodizio_atribuiu', conversa, inbox, agente }));
  } catch (e) {
    console.log(JSON.stringify({ acao: 'rodizio_falhou', conversa, erro: (e as Error).message.slice(0, 200) }));
  }
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
