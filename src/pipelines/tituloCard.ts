import type { Env } from '../env';
import { ChatwootClient } from '../clients/chatwoot';
import { tituloComTelefone } from '../domain/tituloCard';

/**
 * Poe o telefone do lead no titulo do card, no lugar do nome do perfil.
 *
 * Roda em toda mensagem da conversa, do lead ou do vendedor, porque e' o
 * webhook da mensagem que traz o telefone: o card so' tem o nome do contato.
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
    const telefone = str(obj(obj(conv?.meta)?.sender)?.phone_number);
    if (!telefone) return;

    const cw = ChatwootClient.fromEnv(env);
    let acc: number | null = null;

    /**
     * O card nasce meio segundo depois da conversa, entao a primeira mensagem
     * chega sem ele. Sem perguntar ao Chatwoot, o card ficava com o nome ate' a
     * segunda mensagem (19 s no lead #1293 da Locadora, 27/10/2026). So' na
     * conversa recem-criada: na antiga, card ausente e' card que nao existe.
     */
    let task = obj(conv?.kanban_task);
    const conversaId = num(conv?.id);
    if (!task && conversaId && recemCriada(conv?.created_at)) {
      acc = await contaDoChatwoot(env, tenantId);
      if (acc) task = obj(obj(await cw.conversa(acc, conversaId))?.kanban_task);
    }

    taskId = num(task?.id);
    if (!taskId) return;

    const titulo = tituloComTelefone(str(task?.title), telefone);
    if (!titulo) return;

    acc ??= await contaDoChatwoot(env, tenantId);
    if (!acc) return;

    await cw.renomearCard(acc, taskId, titulo);
    console.log(JSON.stringify({ acao: 'card_com_telefone', task: taskId }));
  } catch (e) {
    console.log(JSON.stringify({ acao: 'card_com_telefone_falhou', task: taskId, erro: (e as Error).message.slice(0, 200) }));
  }
}

async function contaDoChatwoot(env: Env, tenantId: number): Promise<number | null> {
  const r = await env.DB.prepare('SELECT cw_account_id FROM tenant_config WHERE tenant_id = ?')
    .bind(tenantId)
    .first<{ cw_account_id: number | null }>();
  return r?.cw_account_id ?? null;
}

/** Conversa criada nos ultimos minutos. O Chatwoot manda `created_at` em segundos. */
function recemCriada(v: unknown): boolean {
  const quando = typeof v === 'number' ? v * 1000 : Date.parse(String(v ?? ''));
  return Number.isFinite(quando) && Date.now() - quando < 10 * 60 * 1000;
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
