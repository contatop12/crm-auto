import type { Env } from '../env';
import { ChatwootClient } from '../clients/chatwoot';
import { matchStage } from '../domain/triggers';
import { canMove } from '../domain/movement';
import { simularRespostas } from '../domain/historico';
import { extractValue } from '../domain/value';
import { ehRespostaAutomatica } from '../domain/respostasAutomaticas';
import type { Stage, Trigger, ValuePattern } from '../domain/types';

/**
 * Resposta do vendedor: move o card e captura o valor da proposta.
 *
 * Substitui o workflow "Mover card" do n8n, que foi desligado. Enquanto isto
 * não existia, 597 respostas por dia eram recebidas e descartadas — o card
 * ficava parado onde estava, por mais que o vendedor escrevesse a frase.
 *
 * Duas decisões vêm do domínio, não daqui:
 *   `matchStage`  qual etapa a frase aponta — da mais avançada para a mais
 *                 inicial, com o emoji conferido no texto cru.
 *   `canMove`     se o card pode ir — resposta comum só avança; frase-gatilho
 *                 não puxa para trás, exceto para etapa final.
 */

interface Resultado {
  status: 'ok' | 'ignorado' | 'erro';
  motivo: string;
}

interface Config {
  cw_account_id: number | null;
  cw_board_funil_id: number | null;
}

export async function moverPelaResposta(
  env: Env,
  tenantId: number,
  payload: string,
): Promise<Resultado> {
  let p: Record<string, unknown>;
  try {
    const j = JSON.parse(payload) as unknown;
    if (!j || typeof j !== 'object') return { status: 'ignorado', motivo: 'payload nao e json' };
    p = j as Record<string, unknown>;
  } catch {
    return { status: 'ignorado', motivo: 'payload nao e json' };
  }

  const conv = obj(p.conversation);
  const conversaId = num(conv?.id);
  if (!conversaId) return { status: 'ignorado', motivo: 'payload sem conversa' };

  // Mensagem privada é nota interna do vendedor para o time, não fala com o
  // lead. Mover o card por causa dela seria mover por um bilhete.
  if (p.private === true) {
    return { status: 'ignorado', motivo: `conversa ${conversaId}: mensagem privada` };
  }

  const texto = str(p.content);
  if (!texto) {
    // só anexo ou só emoji: não há frase para casar
    return { status: 'ignorado', motivo: `conversa ${conversaId}: resposta sem texto` };
  }

  /**
   * O card pode ter nascido DEPOIS deste webhook.
   *
   * O payload e' o retrato de quando a mensagem chegou. Se o vendedor responde
   * nos segundos entre a conversa nascer e o card ser criado, o retrato vem sem
   * card e a resposta se perde — a etapa nunca avanca, e reprocessar nao ajuda
   * porque o retrato guardado continua sem card.
   *
   * Aconteceu de verdade: a conversa 389 da Persianas recebeu tres respostas
   * enquanto o card nao existia, e ficou parada em "Novo Lead" mesmo com
   * "Qualificando" configurada para receber qualquer resposta.
   *
   * Perguntar ao Chatwoot custa uma chamada, e so' acontece quando o retrato
   * nao trouxe card — que e' raro e e' exatamente quando importa.
   */
  // o card inteiro, nao so' o id: board e etapa saem dele nas linhas abaixo
  const task = obj(conv?.kanban_task) ?? (await cardAgora(env, tenantId, conversaId));
  const taskId = num(task?.id);
  if (!taskId) {
    return { status: 'ignorado', motivo: `conversa ${conversaId} sem card no Kanban` };
  }

  const cfg = await env.DB.prepare(
    'SELECT cw_account_id, cw_board_funil_id FROM tenant_config WHERE tenant_id = ?',
  )
    .bind(tenantId)
    .first<Config>();
  if (!cfg?.cw_account_id) return { status: 'ignorado', motivo: 'cliente sem conta do Chatwoot' };

  // Card fora do funil de Ads não é movido por frase: o Orgânico é registro,
  // tem uma coluna só, e não há para onde avançar.
  const boardId = num(task?.board_id) ?? num(obj(task?.board)?.id);
  if (cfg.cw_board_funil_id && boardId !== cfg.cw_board_funil_id) {
    return {
      status: 'ignorado',
      motivo: `card no board ${boardId}, nao no funil de Ads (${cfg.cw_board_funil_id})`,
    };
  }

  /**
   * Boas-vindas e continuidade do formulário são `outgoing`, mas não são o
   * atendente: chegam em segundos e levavam o card para "Qualificando" antes de
   * alguém olhar o lead. O card fica em "Novo Lead" até uma resposta de gente.
   */
  const automaticas = await respostasAutomaticas(env, tenantId);
  if (ehRespostaAutomatica(texto, automaticas)) {
    return {
      status: 'ignorado',
      motivo: `conversa ${conversaId}: resposta automatica, o card espera o atendente`,
    };
  }

  const [stages, triggers, padroes] = await Promise.all([
    etapas(env, tenantId),
    frases(env, tenantId),
    padroesDeValor(env, tenantId),
  ]);
  if (!stages.length) return { status: 'ignorado', motivo: 'etapas do funil nao sincronizadas' };

  const etapaAtual = str(obj(task?.board_step)?.name);

  // `matchStage` já cobre os dois casos: a frase cadastrada e, quando nenhuma
  // casa, a etapa de resposta automática — a regra "primeira resposta do
  // comercial" da planilha.
  const casou = matchStage(texto, stages, triggers);
  if (!casou) {
    return {
      status: 'ignorado',
      motivo: `conversa ${conversaId}: nenhuma frase casou e nao ha etapa automatica`,
    };
  }

  const decisao = canMove({
    atual: etapaAtual, alvoId: casou.stageId, byKeyword: casou.byKeyword, stages,
  });
  const nomeAlvo = casou.stageNome;

  // O valor da proposta é capturado mesmo quando o card não se move: ele vem
  // na mensagem e some se não for lido agora.
  const valor = extractValue(texto, padroes);
  const cw = ChatwootClient.fromEnv(env);
  if (valor > 0) {
    try {
      await cw.mesclarAtributosDoCard(cfg.cw_account_id, taskId, { valor_proposta: String(valor) });
    } catch (e) {
      console.log(JSON.stringify({ acao: 'valor_no_card_falhou', task: taskId, erro: (e as Error).message }));
    }
  }

  await registrar(env, tenantId, {
    taskId, conversaId, de: etapaAtual, para: nomeAlvo,
    moveu: decisao.move, gatilho: casou.matchedPhrase, trecho: texto.slice(0, 160),
    motivo: decisao.motivo,
  });

  if (!decisao.move) {
    return {
      status: 'ignorado',
      motivo: `conversa ${conversaId}: ${decisao.motivo}` + (valor > 0 ? ` · valor R$ ${valor}` : ''),
    };
  }

  const cwStepId = stages.find((s) => s.id === casou.stageId)?.cwStepId;
  if (!cwStepId) {
    return { status: 'erro', motivo: `etapa "${nomeAlvo}" sem id do Chatwoot — sincronize as etapas` };
  }

  try {
    await cw.moverCard(cfg.cw_account_id, taskId, cwStepId);
  } catch (e) {
    // erro possivelmente transitorio: a fila retenta
    return { status: 'erro', motivo: `mover card ${taskId}: ${(e as Error).message.slice(0, 160)}` };
  }

  return {
    status: 'ok',
    motivo:
      `card ${taskId} movido para "${nomeAlvo}"` +
      (casou.byKeyword ? ` pela frase "${casou.matchedPhrase}"` : ' pela primeira resposta') +
      (valor > 0 ? ` · valor R$ ${valor}` : ''),
  };
}

async function etapas(env: Env, tenantId: number): Promise<Array<Stage & { cwStepId: number }>> {
  const { results } = await env.DB.prepare(
    `SELECT id, posicao, nome, is_final AS isFinal, auto_on_reply AS autoOnReply, cw_step_id AS cwStepId
     FROM funnel_stages WHERE tenant_id = ? ORDER BY posicao`,
  )
    .bind(tenantId)
    .all<{ id: number; posicao: number; nome: string; isFinal: number; autoOnReply: number; cwStepId: number }>();

  return results.map((s) => ({
    id: s.id, posicao: s.posicao, nome: s.nome,
    isFinal: !!s.isFinal, autoOnReply: !!s.autoOnReply, cwStepId: s.cwStepId,
  }));
}

async function frases(env: Env, tenantId: number): Promise<Trigger[]> {
  const { results } = await env.DB.prepare(
    'SELECT stage_id AS stageId, frase, emoji_obrigatorio AS emojiObrigatorio, tipo FROM stage_triggers WHERE tenant_id = ?',
  )
    .bind(tenantId)
    .all<{ stageId: number; frase: string; emojiObrigatorio: string | null; tipo: 'contem' | 'fixo' }>();
  return results;
}

async function respostasAutomaticas(env: Env, tenantId: number): Promise<Array<{ frase: string }>> {
  const { results } = await env.DB.prepare(
    'SELECT frase FROM respostas_automaticas WHERE tenant_id = ?',
  )
    .bind(tenantId)
    .all<{ frase: string }>();
  return results;
}

async function padroesDeValor(env: Env, tenantId: number): Promise<ValuePattern[]> {
  const { results } = await env.DB.prepare(
    'SELECT regex, valor_minimo AS valorMinimo, posicao FROM value_patterns WHERE tenant_id = ? ORDER BY posicao',
  )
    .bind(tenantId)
    .all<ValuePattern>()
    .catch(() => ({ results: [] as ValuePattern[] }));
  return results;
}

/**
 * O que foi decidido fica registrado mesmo quando o card NÃO se move.
 *
 * Era esse silêncio que escondia o bug do "Qualificando" no n8n: o card parava
 * e não havia onde ler por quê.
 */
async function registrar(
  env: Env,
  tenantId: number,
  m: { taskId: number; conversaId: number; de: string | null; para: string; moveu: boolean; gatilho: string; trecho: string; motivo: string },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO card_moves (tenant_id, task_id, conversation_id, gatilho, trecho, etapa_de, etapa_para, moveu, motivo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(tenantId, m.taskId, m.conversaId, m.gatilho || null, m.trecho, m.de, m.para, m.moveu ? 1 : 0, m.motivo)
    .run()
    .catch(() => undefined);
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * O card desta conversa, perguntado ao Chatwoot agora.
 *
 * Nao levanta excecao: sem card a resposta e' ignorada como antes, e uma falha
 * de rede aqui nao pode virar erro de pipeline por uma consulta de socorro.
 */
async function cardAgora(
  env: Env,
  tenantId: number,
  conversaId: number,
): Promise<Record<string, unknown> | null> {
  try {
    const cfg = await env.DB.prepare(
      'SELECT cw_account_id FROM tenant_config WHERE tenant_id = ?',
    )
      .bind(tenantId)
      .first<{ cw_account_id: number | null }>();
    if (!cfg?.cw_account_id) return null;

    const conversa = await ChatwootClient.fromEnv(env).conversa(cfg.cw_account_id, conversaId);
    const t = obj(obj(conversa)?.kanban_task);
    if (t) {
      console.log(JSON.stringify({ acao: 'card_achado_depois', conversa: conversaId, task: num(t.id) }));
    }
    return t;
  } catch (e) {
    console.log(JSON.stringify({ acao: 'card_agora_falhou', conversa: conversaId, erro: (e as Error).message }));
    return null;
  }
}

/**
 * Card que acabou de entrar no funil: as respostas dadas antes contam agora.
 *
 * Enquanto o card estava no Organico, cada resposta do vendedor foi ignorada
 * de proposito (`card no board X, nao no funil de Ads`). Sem esta releitura, o
 * card promovido entra em Novo Lead e fica la' ate' o vendedor escrever de novo
 * — o que pode nunca acontecer, se a conversa ja' andou. Ver `simularRespostas`.
 *
 * Le' o historico do Chatwoot, nao o log de eventos: webhook perdido tambem
 * perde a resposta do log, e a conversa e' a fonte completa.
 *
 * Devolve o que fez, ou null quando nao havia o que mover.
 */
export async function recuperarRespostasAnteriores(
  env: Env,
  tenantId: number,
  acc: number,
  taskId: number,
  conversaId: number,
): Promise<string | null> {
  if (!conversaId) return null;
  const cw = ChatwootClient.fromEnv(env);

  // o card de agora, nao o do webhook: outra regra pode te-lo movido no meio
  const [card, stages, triggers, textos] = await Promise.all([
    cw.tarefa(acc, taskId),
    etapas(env, tenantId),
    frases(env, tenantId),
    cw.textosDoVendedor(acc, conversaId),
  ]);
  if (!card || !stages.length || !textos.length) return null;

  const atual = stages.find((s) => s.cwStepId === num(card.board_step_id));
  if (!atual) return null;

  const { etapa, passos } = simularRespostas(atual.nome, textos, stages, triggers);
  if (!etapa) return null;

  const cwStepId = stages.find((s) => s.id === etapa.id)?.cwStepId;
  if (!cwStepId) return null;
  await cw.moverCard(acc, taskId, cwStepId);

  const ultimo = passos[passos.length - 1];
  await registrar(env, tenantId, {
    taskId, conversaId, de: atual.nome, para: etapa.nome, moveu: true,
    gatilho: ultimo?.frase ?? '', trecho: ultimo?.trecho ?? '',
    motivo: `recuperado do historico: ${passos.length} passo(s) de respostas dadas antes do funil`,
  });

  return `card ${taskId} movido de "${atual.nome}" para "${etapa.nome}" pelas respostas dadas antes do funil`;
}
