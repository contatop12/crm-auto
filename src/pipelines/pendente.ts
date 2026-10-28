import type { Env } from '../env';
import { ChatwootClient } from '../clients/chatwoot';
import { ehPendente, etapasDoPendente, vaiParaPendente } from '../domain/pendente';

/**
 * As duas pontas da coluna "Pendente" (regra em domain/pendente.ts).
 *
 *   `moverParaPendente`  a cada 15 min: proposta parada e lead calado ha' 3 dias
 *   `voltarDoPendente`   mensagem do lead: o card volta para "Proposta Enviada"
 *
 * Mover dispara `kanban_task_updated`, e a regra da planilha leva a etapa nova
 * para a Geral. Nenhuma conversao aponta para "Pendente".
 */

interface Funil {
  tenant_id: number;
  acc: number;
  board: number;
}

export async function moverParaPendente(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT c.tenant_id, c.cw_account_id AS acc, c.cw_board_funil_id AS board
     FROM tenant_config c JOIN tenants t ON t.id = c.tenant_id
     WHERE t.ativo = 1 AND c.cw_account_id IS NOT NULL AND c.cw_board_funil_id IS NOT NULL`,
  ).all<Funil>();

  const cw = ChatwootClient.fromEnv(env);
  const agora = Date.now();

  for (const f of results ?? []) {
    try {
      const etapas = etapasDoPendente(await cw.steps(f.acc, f.board));
      // funil sem a coluna "Pendente": o cliente nao usa a regra
      if (!etapas) continue;

      const naProposta = [];
      for (let page = 1; ; page++) {
        const r = await cw.tasks(f.acc, f.board, page);
        naProposta.push(...r.tasks.filter((t) => t.board_step_id === etapas.proposta));
        if (!r.hasMore) break;
      }

      for (const t of naProposta) {
        const naEtapaDesde = Date.parse(t.step_changed_at ?? '');
        // so' pergunta pelas mensagens de quem ja' passou do prazo na etapa
        if (!vaiParaPendente({ naEtapaDesde, ultimaDoLead: null, agora })) continue;

        const conversa = t.conversations?.[0]?.display_id;
        // card sem conversa (orfao): nao ha' como saber se o lead respondeu
        if (!conversa) continue;

        const ultimaDoLead = await cw.ultimaMensagemDoLead(f.acc, conversa);
        if (!vaiParaPendente({ naEtapaDesde, ultimaDoLead, agora })) continue;

        await cw.moverCard(f.acc, t.id, etapas.pendente);
        console.log(JSON.stringify({ acao: 'card_para_pendente', tenant: f.tenant_id, task: t.id, conversa }));
      }
    } catch (e) {
      // um cliente com problema nao segura os outros
      console.log(JSON.stringify({ acao: 'pendente_falhou', tenant: f.tenant_id, erro: (e as Error).message.slice(0, 200) }));
    }
  }
}

/**
 * O lead respondeu: o card sai de "Pendente" e volta para "Proposta Enviada".
 *
 * Roda em toda mensagem; so' custa chamada quando o card esta' em "Pendente".
 * Falhar aqui nao pode atrapalhar a atribuicao, entao nada sobe como erro.
 */
export async function voltarDoPendente(env: Env, tenantId: number, payload: string): Promise<void> {
  let taskId: number | null = null;
  try {
    const p = obj(JSON.parse(payload));
    // so' a mensagem do lead; nota interna e resposta do vendedor nao contam
    if (str(p?.message_type) !== 'incoming' || p?.private === true) return;

    const task = obj(obj(p?.conversation)?.kanban_task);
    taskId = num(task?.id);
    const board = num(task?.board_id);
    if (!taskId || !board || !ehPendente(str(obj(task?.board_step)?.name))) return;

    const cfg = await env.DB.prepare('SELECT cw_account_id FROM tenant_config WHERE tenant_id = ?')
      .bind(tenantId)
      .first<{ cw_account_id: number | null }>();
    if (!cfg?.cw_account_id) return;

    const cw = ChatwootClient.fromEnv(env);
    const etapas = etapasDoPendente(await cw.steps(cfg.cw_account_id, board));
    if (!etapas) return;

    await cw.moverCard(cfg.cw_account_id, taskId, etapas.proposta);
    console.log(JSON.stringify({ acao: 'card_saiu_do_pendente', tenant: tenantId, task: taskId }));
  } catch (e) {
    console.log(JSON.stringify({ acao: 'voltar_do_pendente_falhou', task: taskId, erro: (e as Error).message.slice(0, 200) }));
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
