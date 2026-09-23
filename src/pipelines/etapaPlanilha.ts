import type { Env } from '../env';
import { SheetsClient } from '../clients/sheets';
import { ChatwootClient } from '../clients/chatwoot';
import { parseKanbanTask, type TaskDoKanban } from '../domain/kanbanTask';
import { linhaDoTelefone, colunaStatus, indiceParaColuna } from '../domain/planilha';

/**
 * A etapa do card no Kanban, espelhada na coluna Status da aba Geral.
 *
 * O time da Vita abre a planilha, nao o Chatwoot: sem isto a Geral diz que o
 * lead chegou e mais nada. A linha e' achada pelo telefone (a chave que a
 * planilha e o WhatsApp tem em comum) e so' a coluna Status muda.
 *
 * Quem chama e' a regra "[PAINEL] Etapa do card -> planilha" do Chatwoot, a
 * cada atualizacao de card do board do funil (`?evento=etapa`). As regras de
 * conversao nao servem de gatilho: cobrem so' as etapas com meta, e
 * "Qualificando" e "Oportunidade Perdida" nunca chegariam aqui.
 *
 * So' o board do funil: card do Organico nao e' lead da Geral.
 */

export interface Resultado {
  status: 'ok' | 'ignorado' | 'erro';
  motivo: string;
  /** false = erro de cadastro (aba sem coluna Status): retentar repete o erro. */
  retentar?: boolean;
}

interface Config {
  cw_account_id: number | null;
  cw_board_funil_id: number | null;
  sheets_ativo: number;
  planilha_modo: string;
  sheets_leads_doc_id: string | null;
  sheets_aba_geral: string | null;
  sheets_status_etapa: number;
}

interface Destino {
  doc: string;
  aba: string;
  board: number;
  acc: number | null;
}

export async function espelharEtapaNaGeral(env: Env, tenantId: number, payload: string): Promise<Resultado> {
  let cru: unknown;
  try {
    cru = JSON.parse(payload);
  } catch {
    return { status: 'ignorado', motivo: 'payload do Kanban nao e json' };
  }
  const t = parseKanbanTask(cru);
  if (!t.taskId) return { status: 'ignorado', motivo: 'payload sem task' };

  const cfg = await lerConfig(env, tenantId);
  const destino = destinoPronto(cfg);
  if (typeof destino === 'string') return { status: 'ignorado', motivo: destino };

  if (t.boardId !== destino.board) {
    return { status: 'ignorado', motivo: `card ${t.taskId} no board ${t.boardId}, nao no do funil (${destino.board})` };
  }

  const etapa = await nomeDaEtapa(env, tenantId, t);
  if (!etapa) return { status: 'ignorado', motivo: `card ${t.taskId}: payload sem etapa` };

  const telefone = await telefoneDoCard(env, tenantId, destino.acc, t);
  if (!telefone) return { status: 'ignorado', motivo: `card ${t.taskId}: sem telefone para achar a linha` };

  const sheets = new SheetsClient(env);
  const linhas = await sheets.tudo(destino.doc, destino.aba);
  const alvo = celulaDoStatus(linhas, destino.aba, telefone, etapa);
  if ('resultado' in alvo) return alvo.resultado;

  await sheets.gravarCelulas(destino.doc, destino.aba, [{ celula: alvo.celula, valor: etapa }]);
  return {
    status: 'ok',
    motivo: `card ${t.taskId}: linha ${alvo.linha} da "${destino.aba}" · Status "${alvo.antes}" -> "${etapa}"`,
  };
}

/**
 * Todos os cards do board do funil, de uma vez: o que ja' esta' no Kanban hoje.
 *
 * Le' a Geral uma vez e grava as celulas num lote so' — a cota do Sheets e'
 * por minuto, e 30 cards em 30 leituras estourariam.
 */
export async function sincronizarEtapasNaGeral(
  env: Env,
  tenantId: number,
): Promise<{ cards: number; gravadas: number; detalhes: string[] }> {
  const cfg = await lerConfig(env, tenantId);
  const destino = destinoPronto(cfg);
  if (typeof destino === 'string') throw new Error(destino);
  if (!destino.acc) throw new Error('cliente sem conta do Chatwoot');

  const cw = ChatwootClient.fromEnv(env);
  const cards: TaskDoKanban[] = [];
  for (let page = 1, mais = true; mais && page <= 20; page++) {
    const r = await cw.tasks(destino.acc, destino.board, page, 100);
    cards.push(...r.tasks.map((x) => parseKanbanTask(x)));
    mais = r.hasMore;
  }

  const sheets = new SheetsClient(env);
  const linhas = await sheets.tudo(destino.doc, destino.aba);
  const celulas: Array<{ celula: string; valor: string }> = [];
  const detalhes: string[] = [];

  for (const t of cards) {
    const etapa = await nomeDaEtapa(env, tenantId, t);
    const telefone = etapa ? await telefoneDoCard(env, tenantId, destino.acc, t) : '';
    if (!etapa || !telefone) {
      detalhes.push(`card ${t.taskId} (${t.nome || t.titulo}): ${etapa ? 'sem telefone' : 'sem etapa'}`);
      continue;
    }
    const alvo = celulaDoStatus(linhas, destino.aba, telefone, etapa);
    if ('resultado' in alvo) {
      if (alvo.resultado.status === 'erro') throw new Error(alvo.resultado.motivo);
      detalhes.push(`card ${t.taskId} (${t.nome || t.titulo}): ${alvo.resultado.motivo}`);
      continue;
    }
    celulas.push({ celula: alvo.celula, valor: etapa });
    detalhes.push(`card ${t.taskId} (${t.nome || t.titulo}): linha ${alvo.linha} "${alvo.antes}" -> "${etapa}"`);
  }

  if (celulas.length) await sheets.gravarCelulas(destino.doc, destino.aba, celulas);
  return { cards: cards.length, gravadas: celulas.length, detalhes };
}

async function lerConfig(env: Env, tenantId: number): Promise<Config | null> {
  return env.DB.prepare(
    `SELECT cw_account_id, cw_board_funil_id, sheets_ativo, planilha_modo, sheets_leads_doc_id,
            sheets_aba_geral, sheets_status_etapa
     FROM tenant_config WHERE tenant_id = ?`,
  )
    .bind(tenantId)
    .first<Config>();
}

/** O destino, ou o motivo de nao haver um. */
function destinoPronto(cfg: Config | null): Destino | string {
  if (!cfg) return 'cliente sem configuracao';
  if (cfg.sheets_status_etapa !== 1) return 'espelho da etapa na planilha desligado para este cliente';
  if (cfg.sheets_ativo !== 1) return 'planilhas desligadas para este cliente';
  if (cfg.planilha_modo !== 'sistema') return 'planilha escrita pelo n8n: o espelho da etapa so vale no modo sistema';
  if (!cfg.sheets_leads_doc_id || !cfg.sheets_aba_geral) return 'cliente sem planilha de leads ou sem aba Geral';
  if (!cfg.cw_board_funil_id) return 'board do funil nao configurado para este cliente';
  return { doc: cfg.sheets_leads_doc_id, aba: cfg.sheets_aba_geral, board: cfg.cw_board_funil_id, acc: cfg.cw_account_id };
}

/** O nome sincronizado da etapa; o do payload so' quando o funil nao a conhece. */
async function nomeDaEtapa(env: Env, tenantId: number, t: TaskDoKanban): Promise<string> {
  const r = t.boardStepId
    ? await env.DB.prepare('SELECT nome FROM funnel_stages WHERE tenant_id = ? AND cw_step_id = ?')
        .bind(tenantId, t.boardStepId)
        .first<{ nome: string }>()
        .catch(() => null)
    : null;
  return (r?.nome ?? t.etapa).trim();
}

/**
 * O telefone do lead do card: o contato do payload, o clique pelo protocolo, a
 * conversa que a atribuicao gravou e, por ultimo, a conversa no Chatwoot — a
 * lista de cards da API vem sem o telefone do contato.
 */
async function telefoneDoCard(env: Env, tenantId: number, acc: number | null, t: TaskDoKanban): Promise<string> {
  if (t.telefone) return t.telefone;

  if (t.protocolo) {
    const l = await env.DB.prepare('SELECT phone_e164 FROM leads WHERE tenant_id = ? AND protocol = ?')
      .bind(tenantId, t.protocolo)
      .first<{ phone_e164: string | null }>()
      .catch(() => null);
    if (l?.phone_e164) return l.phone_e164;
  }

  if (t.conversationId) {
    const c = await env.DB.prepare('SELECT phone_key FROM conversations WHERE tenant_id = ? AND cw_conversation_id = ?')
      .bind(tenantId, t.conversationId)
      .first<{ phone_key: string | null }>()
      .catch(() => null);
    if (c?.phone_key) return c.phone_key;
  }

  if (acc && t.conversaDisplay) {
    const conv = await ChatwootClient.fromEnv(env).conversa(acc, t.conversaDisplay).catch(() => null);
    const meta = conv?.meta as { sender?: { phone_number?: string } } | undefined;
    return String(meta?.sender?.phone_number ?? '');
  }
  return '';
}

/** A celula a gravar, ou o resultado que explica por que nenhuma. */
function celulaDoStatus(
  linhas: string[][],
  aba: string,
  telefone: string,
  etapa: string,
): { celula: string; linha: number; antes: string } | { resultado: Resultado } {
  const cab = linhas[0] ?? [];
  const iStatus = colunaStatus(cab);
  if (iStatus < 0) {
    return { resultado: { status: 'erro', motivo: `a aba "${aba}" nao tem a coluna Status`, retentar: false } };
  }
  const corpo = linhas.slice(1);
  const i = linhaDoTelefone(cab, corpo, telefone);
  if (i < 0) {
    return { resultado: { status: 'ignorado', motivo: `telefone ${telefone} nao esta na aba "${aba}"` } };
  }
  const linha = i + 2;
  const antes = String(corpo[i]?.[iStatus] ?? '').trim();
  if (antes === etapa) {
    return { resultado: { status: 'ignorado', motivo: `linha ${linha} da "${aba}" ja esta "${etapa}"` } };
  }
  return { celula: `${indiceParaColuna(iStatus)}${linha}`, linha, antes };
}
