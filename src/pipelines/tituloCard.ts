import type { Env } from '../env';
import { ChatwootClient } from '../clients/chatwoot';
import { tituloComTelefone } from '../domain/tituloCard';

/**
 * Poe o telefone do lead no titulo do card, no lugar do nome do perfil.
 *
 * Roda em toda mensagem da conversa, do lead ou do vendedor, porque e' o
 * webhook da mensagem que traz o telefone: o card so' tem o nome do contato.
 * O card nasce meio segundo depois da conversa, entao a primeira mensagem
 * costuma vir sem ele — a seguinte (a boas-vindas automatica, segundos
 * depois) ja' traz.
 *
 * So' escreve quando o titulo muda: a maioria das mensagens nao custa chamada
 * nenhuma. Falhar aqui nao pode atrapalhar a atribuicao nem o movimento do
 * card, entao nada daqui sobe como erro.
 */
export async function telefoneNoTituloDoCard(env: Env, tenantId: number, payload: string): Promise<void> {
  let taskId: number | null = null;
  try {
    const p = obj(JSON.parse(payload));
    const conv = obj(p?.conversation);
    const task = obj(conv?.kanban_task);
    taskId = num(task?.id);
    if (!taskId) return;

    const titulo = tituloComTelefone(str(task?.title), str(obj(obj(conv?.meta)?.sender)?.phone_number));
    if (!titulo) return;

    const cfg = await env.DB.prepare('SELECT cw_account_id FROM tenant_config WHERE tenant_id = ?')
      .bind(tenantId)
      .first<{ cw_account_id: number | null }>();
    if (!cfg?.cw_account_id) return;

    await ChatwootClient.fromEnv(env).renomearCard(cfg.cw_account_id, taskId, titulo);
    console.log(JSON.stringify({ acao: 'card_com_telefone', task: taskId }));
  } catch (e) {
    console.log(JSON.stringify({ acao: 'card_com_telefone_falhou', task: taskId, erro: (e as Error).message.slice(0, 200) }));
  }
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
