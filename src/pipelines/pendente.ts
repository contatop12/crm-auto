import type { Env } from '../env';
import { ChatwootClient, type CwTask } from '../clients/chatwoot';
import {
  ETIQUETA_QUALIFICANDO,
  HORAS_SEM_RESPOSTA,
  ehPendente,
  etapasDoPendente,
  vaiParaPendente,
  voltaPara,
} from '../domain/pendente';

/**
 * As duas pontas da coluna "Pendente" (regra em domain/pendente.ts).
 *
 *   `moverParaPendente`  a cada 15 min: proposta parada e lead calado ha' 3 dias
 *                        (e Qualificando calado ha' N dias, onde ligado)
 *   `voltarDoPendente`   mensagem do lead: o card volta para a etapa de onde veio
 *
 * Mover dispara `kanban_task_updated`, e a regra da planilha leva a etapa nova
 * para a Geral. Nenhuma conversao aponta para "Pendente".
 */

interface Funil {
  tenant_id: number;
  acc: number;
  board: number;
  /** `pendente_qualificando_dias`; null = Qualificando fica fora */
  dias_qualificando: number | null;
}

export async function moverParaPendente(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT c.tenant_id, c.cw_account_id AS acc, c.cw_board_funil_id AS board,
            c.pendente_qualificando_dias AS dias_qualificando
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
      const qualificando = f.dias_qualificando ? etapas.qualificando : null;

      const parados: Array<{ t: CwTask; horas: number; de: 'proposta' | 'qualificando' }> = [];
      for (let page = 1; ; page++) {
        const r = await cw.tasks(f.acc, f.board, page);
        for (const t of r.tasks) {
          if (t.board_step_id === etapas.proposta) parados.push({ t, horas: HORAS_SEM_RESPOSTA, de: 'proposta' });
          else if (qualificando && t.board_step_id === qualificando) {
            parados.push({ t, horas: f.dias_qualificando! * 24, de: 'qualificando' });
          }
        }
        if (!r.hasMore) break;
      }

      for (const { t, horas, de } of parados) {
        const naEtapaDesde = Date.parse(t.step_changed_at ?? '');
        // so' pergunta pelas mensagens de quem ja' passou do prazo na etapa
        if (!vaiParaPendente({ naEtapaDesde, ultimaDoLead: null, agora, horas })) continue;

        const conversa = t.conversations?.[0]?.display_id;
        // card sem conversa (orfao): nao ha' como saber se o lead respondeu
        if (!conversa) continue;

        const ultimaDoLead = await cw.ultimaMensagemDoLead(f.acc, conversa);
        if (!vaiParaPendente({ naEtapaDesde, ultimaDoLead, agora, horas })) continue;

        // A etiqueta antes de mover: e' ela que diz para onde o card volta, e
        // card em Pendente sem ela voltaria para a etapa errada. A proposta
        // perde o "qualificando" que tenha sobrado de uma ida anterior.
        if (de === 'qualificando') {
          await cw.ajustarEtiquetasDoCard(f.acc, t.id, { mais: [ETIQUETA_QUALIFICANDO] });
        } else if (t.labels?.includes(ETIQUETA_QUALIFICANDO)) {
          await cw.ajustarEtiquetasDoCard(f.acc, t.id, { menos: [ETIQUETA_QUALIFICANDO] });
        }
        await cw.moverCard(f.acc, t.id, etapas.pendente);
        console.log(JSON.stringify({ acao: 'card_para_pendente', tenant: f.tenant_id, task: t.id, conversa, de }));
      }
    } catch (e) {
      // um cliente com problema nao segura os outros
      console.log(JSON.stringify({ acao: 'pendente_falhou', tenant: f.tenant_id, erro: (e as Error).message.slice(0, 200) }));
    }
  }
}

/**
 * O lead respondeu: o card sai de "Pendente" e volta para "Proposta Enviada",
 * ou para "Qualificando" quando tem a etiqueta (que sai junto).
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

    const etiquetas = Array.isArray(task?.labels) ? (task.labels as unknown[]).map(String) : [];
    const destino = voltaPara(etapas, etiquetas);
    await cw.moverCard(cfg.cw_account_id, taskId, destino);
    // de volta a Qualificando, a etiqueta ja' nao conta nada
    if (destino === etapas.qualificando) {
      await cw.ajustarEtiquetasDoCard(cfg.cw_account_id, taskId, { menos: [ETIQUETA_QUALIFICANDO] });
    }
    console.log(JSON.stringify({
      acao: 'card_saiu_do_pendente',
      tenant: tenantId,
      task: taskId,
      para: destino === etapas.qualificando ? 'qualificando' : 'proposta',
    }));
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
