import type { Env } from '../env';
import { ChatwootClient, type CwStep } from '../clients/chatwoot';
import { comVolta, ehRetorno } from '../domain/retorno';
import { ehNumeroProprio, lerNumerosProprios } from '../domain/nomeLead';
import { atribuirLead, MOTIVO_VOLTA_SEM_LEAD } from './leadMessage';
import { avisarLeadNoGrupo, TENTATIVAS_ESPERANDO_PROTOCOLO } from './kanbanTask';

/**
 * O lead que volta (regra em domain/retorno.ts): card novo e ciclo novo.
 *
 * Roda antes da atribuicao em toda mensagem do lead. `null` = nao e' volta, e a
 * fila segue o caminho de sempre. Sendo volta, quem atribui e' a atribuicao de
 * sempre, em modo de volta: ela acha o lead do ciclo e pede o card por
 * `criarCard`. Daqui saem o card, o aviso no grupo e o registro em `retornos`.
 *
 * Uma volta, um card: a linha de `retornos` e' reservada antes do card (UNIQUE
 * pelo card antigo), e a retentativa da fila retoma do ponto em que parou, sem
 * criar o card de novo.
 */

type Resultado = Awaited<ReturnType<typeof atribuirLead>>;

/** Etapas de um board guardadas no KV: o Organico nao esta' em `funnel_stages`. */
const TTL_ETAPAS_S = 3600;

/**
 * Volta pendente de OUTRA mensagem: ate' aqui, a primeira ainda esta' abrindo
 * (o anuncio da Meta espera ~20 s pela Evolution). Passou disso, ela morreu e
 * esta mensagem assume.
 */
const PRAZO_DA_OUTRA_S = 10 * 60;

/** Ciclo de anuncio ou do perfil do Google vai para o funil, mesmo saindo do Organico. */
const PLATAFORMAS_DO_FUNIL = new Set(['google', 'meta', 'gmn']);

interface Config {
  retorno_dias: number | null;
  cw_account_id: number | null;
  cw_board_funil_id: number | null;
  numeros_proprios: string | null;
}

interface Mensagem {
  id: number;
  /** display id: e' o que o Kanban guarda em `conversation_ids` */
  conversa: number;
  /** o card do retrato da mensagem: o que esta' em Ganho/Perda */
  card: number;
  board: number | null;
  etapa: number;
  telefone: string | null;
  protocolo: string | null;
}

interface Linha {
  id: number;
  n: number;
  mensagem_id: string | null;
  task_novo: string | null;
  protocolo_anterior: string | null;
  desligou_antigo: number;
  status: string;
  idade_s: number;
}

/** O que os passos do card dividem. `linha` muda: e' o estado da volta. */
interface Ciclo {
  env: Env;
  cw: ChatwootClient;
  acc: number;
  tenantId: number;
  funil: number | null;
  m: Mensagem;
  linha: Linha;
  cardAntigo(): Promise<Record<string, unknown> | null>;
}

export async function abrirRetorno(
  env: Env,
  tenantId: number,
  payload: string,
  opts: { tentativa?: number } = {},
): Promise<Resultado | null> {
  const m = lerMensagem(payload);
  if (!m) return null;

  // Roda em toda mensagem de todo cliente: desligado, custa esta leitura e mais nada.
  const cfg = await env.DB.prepare(
    'SELECT retorno_dias, cw_account_id, cw_board_funil_id, numeros_proprios FROM tenant_config WHERE tenant_id = ?',
  )
    .bind(tenantId)
    .first<Config>();
  if (cfg?.retorno_dias == null || !cfg.cw_account_id) return null;
  if (ehNumeroProprio(m.telefone, lerNumerosProprios(cfg.numeros_proprios))) return null;

  const acc = cfg.cw_account_id;
  const cw = ChatwootClient.fromEnv(env);
  if (!(await naEtapaFinal(env, cw, tenantId, acc, m))) return null;
  if (await voltaFeita(env, tenantId, m.card)) return null;

  // lido uma vez so': a data da etapa (quando falta a mensagem anterior) e o molde do card novo
  let antigo: Promise<Record<string, unknown> | null> | null = null;
  const cardAntigo = () => (antigo ??= cw.tarefa(acc, m.card));

  const anteriorDoLead = await cw.mensagemAnteriorDoLead(acc, m.conversa, m.id);
  const naEtapaDesde = anteriorDoLead === null ? Date.parse(String((await cardAntigo())?.step_changed_at ?? '')) : null;
  // a etapa final ja' foi conferida acima, antes de qualquer chamada ao Chatwoot
  if (!ehRetorno({ etapaFinal: true, anteriorDoLead, naEtapaDesde, agora: Date.now(), dias: cfg.retorno_dias })) {
    return null;
  }

  const linha = await reservar(env, tenantId, m, m.protocolo ?? (await protocoloDaConversa(env, tenantId, m.conversa)));
  if (!linha) return null;

  const ciclo: Ciclo = { env, cw, acc, tenantId, funil: cfg.cw_board_funil_id, m, linha, cardAntigo };
  try {
    const r = await atribuirLead(env, tenantId, payload, {
      tentativa: opts.tentativa,
      retorno: {
        n: linha.n,
        usados: await protocolosUsados(env, tenantId, m.conversa, linha.protocolo_anterior),
        anterior: linha.protocolo_anterior,
        criarCard: (lead) => cardDoCiclo(ciclo, lead.plataforma, lead.atributos),
      },
    });
    // Anuncio da Meta esperando o clique da Evolution: a fila devolve a mesma
    // mensagem em ~20 s, e ela retoma esta reserva. Ainda nao ha' card.
    if (r.adiar) return r;

    // sem lead, nasce so' o card: planilha, aviso e conversao seguem a regra do card sem protocolo
    const semLead = r.motivo === MOTIVO_VOLTA_SEM_LEAD;
    const novo = semLead ? await cardDoCiclo(ciclo, null, {}) : num(linha.task_novo);
    if (!novo) throw new Error(`volta #${linha.n}: a atribuicao terminou sem card (${r.motivo})`);

    await avisar(ciclo, novo);

    const protocoloNovo = semLead ? null : await protocoloDaConversa(env, tenantId, m.conversa);
    const origem = semLead ? 'sem_lead' : (await copiaDoAnterior(env, tenantId, protocoloNovo)) ? 'herdada' : 'anuncio_novo';
    await env.DB.prepare(`UPDATE retornos SET protocolo_novo = ?, origem = ?, status = 'feito', erro = NULL WHERE id = ?`)
      .bind(protocoloNovo, origem, linha.id)
      .run();
    console.log(JSON.stringify({
      acao: 'volta_aberta', tenant: tenantId, conversa: m.conversa, n: linha.n, anterior: m.card, card: novo,
      origem, protocolo: protocoloNovo,
    }));
    return semLead ? { status: 'ok', motivo: `volta #${linha.n} sem lead: card ${novo} criado, sem protocolo` } : r;
  } catch (e) {
    // a linha fica pendente com o motivo; a fila retenta e retoma pelo `task_novo`
    await env.DB.prepare('UPDATE retornos SET erro = ? WHERE id = ?')
      .bind((e as Error).message.slice(0, 500), linha.id)
      .run()
      .catch(() => undefined);
    throw e;
  }
}

/** So' a mensagem do lead com card: nota interna e resposta do vendedor nao abrem ciclo. */
function lerMensagem(payload: string): Mensagem | null {
  let p: Record<string, unknown> | null;
  try {
    p = obj(JSON.parse(payload));
  } catch {
    return null;
  }
  if (str(p?.message_type) !== 'incoming' || p?.private === true) return null;
  const conv = obj(p?.conversation);
  const task = obj(conv?.kanban_task);
  const id = num(p?.id);
  const conversa = num(conv?.id);
  const card = num(task?.id);
  const etapa = num(task?.board_step_id) ?? num(obj(task?.board_step)?.id);
  if (!id || !conversa || !card || !etapa) return null;
  const attrs = obj(conv?.custom_attributes) ?? {};
  return {
    id, conversa, card, etapa,
    board: num(task?.board_id) ?? num(obj(task?.board)?.id),
    telefone: str(obj(obj(conv?.meta)?.sender)?.phone_number) ?? str(attrs.phone_lead),
    protocolo: str(attrs.protocolo),
  };
}

/**
 * O card esta' em Ganho/Perda? `funnel_stages` responde pelo funil sem custar
 * chamada; a etapa que nao esta' la' (Organico) sai do Chatwoot, guardada 1 h.
 */
async function naEtapaFinal(env: Env, cw: ChatwootClient, tenantId: number, acc: number, m: Mensagem): Promise<boolean> {
  const doFunil = await env.DB.prepare('SELECT is_final FROM funnel_stages WHERE tenant_id = ? AND cw_step_id = ?')
    .bind(tenantId, m.etapa)
    .first<{ is_final: number }>();
  if (doFunil) return doFunil.is_final === 1;
  if (!m.board) return false;
  const etapa = (await etapasDoBoard(env, cw, acc, m.board)).find((s) => s.id === m.etapa);
  return !!etapa && (etapa.completed || etapa.cancelled);
}

async function etapasDoBoard(env: Env, cw: ChatwootClient, acc: number, board: number): Promise<CwStep[]> {
  const chave = `steps:${acc}:${board}`;
  const guardadas = (await env.CACHE.get(chave, 'json').catch(() => null)) as CwStep[] | null;
  if (guardadas) return guardadas;
  const etapas = await cw.steps(acc, board);
  await env.CACHE.put(chave, JSON.stringify(etapas), { expirationTtl: TTL_ETAPAS_S }).catch(() => undefined);
  return etapas;
}

async function voltaFeita(env: Env, tenantId: number, card: number): Promise<boolean> {
  const r = await env.DB.prepare(`SELECT 1 AS sim FROM retornos WHERE tenant_id = ? AND task_anterior = ? AND status = 'feito'`)
    .bind(tenantId, String(card))
    .first();
  return !!r;
}

/**
 * Reserva a volta do card antigo, ou acha a que ja' existe. Devolve null quando
 * a volta nao e' desta mensagem.
 *
 * `INSERT OR IGNORE` pela UNIQUE do card antigo: um card fechado gera uma volta
 * so', com a fila retentando ou nao. `protocolo_anterior` fica gravado aqui
 * porque a atribuicao troca o da conversa antes de terminar: a retentativa le'
 * o daqui, nao o novo.
 */
async function reservar(env: Env, tenantId: number, m: Mensagem, anterior: string | null): Promise<Linha | null> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO retornos (tenant_id, cw_conversation_id, n, mensagem_id, task_anterior, protocolo_anterior)
     SELECT ?, ?, COALESCE(MAX(n), 0) + 1, ?, ?, ? FROM retornos WHERE tenant_id = ? AND cw_conversation_id = ?`,
  )
    .bind(tenantId, m.conversa, String(m.id), String(m.card), anterior, tenantId, m.conversa)
    .run();

  const l = await env.DB.prepare(
    `SELECT id, n, mensagem_id, task_novo, protocolo_anterior, desligou_antigo, status,
            CAST((julianday('now') - julianday(created_at)) * 86400 AS INTEGER) AS idade_s
     FROM retornos WHERE tenant_id = ? AND task_anterior = ?`,
  )
    .bind(tenantId, String(m.card))
    .first<Linha>();
  // a outra UNIQUE (conversa, n): outra volta da conversa tomou o numero agora; a fila retenta
  if (!l) throw new Error(`volta da conversa ${m.conversa}: o numero da volta foi tomado por outra execucao`);
  if (l.status === 'feito') return null;
  if (l.mensagem_id === String(m.id)) return l; // retentativa desta mensagem: retoma
  if (l.idade_s < PRAZO_DA_OUTRA_S) return null; // outra mensagem da volta: a primeira cuida

  // a primeira morreu: esta assume, se outra mensagem nao assumiu antes
  const assumiu = await env.DB.prepare('UPDATE retornos SET mensagem_id = ? WHERE id = ? AND mensagem_id IS ?')
    .bind(String(m.id), l.id, l.mensagem_id)
    .run();
  if (!assumiu.meta.changes) return null;
  console.log(JSON.stringify({ acao: 'volta_assumida', conversa: m.conversa, n: l.n, de: l.mensagem_id, por: m.id }));
  return { ...l, mensagem_id: String(m.id) };
}

/** Protocolos que algum ciclo desta conversa ja' usou: clique repetido deles nao e' anuncio novo. */
async function protocolosUsados(env: Env, tenantId: number, conversa: number, anterior: string | null): Promise<string[]> {
  const { results } = await env.DB.prepare(
    'SELECT protocolo_anterior, protocolo_novo FROM retornos WHERE tenant_id = ? AND cw_conversation_id = ?',
  )
    .bind(tenantId, conversa)
    .all<{ protocolo_anterior: string | null; protocolo_novo: string | null }>();
  const todos = [anterior, ...results.flatMap((r) => [r.protocolo_anterior, r.protocolo_novo])];
  return [...new Set(todos.filter((p): p is string => !!p))];
}

/**
 * O card do ciclo. Cria uma vez; na retentativa devolve o que ja' foi criado.
 *
 * Nao se sabe ainda se o Kanban aceita dois cards na mesma conversa, nem para
 * qual deles a conversa aponta depois (secao 8 do desenho, teste com o
 * usuario). O codigo confere em vez de supor: POST recusado solta o card
 * antigo e tenta de novo; a conversa ainda no antigo depois de criar, solta
 * tambem.
 */
async function cardDoCiclo(c: Ciclo, plataforma: string | null, atributos: Record<string, string>): Promise<number> {
  let novo = num(c.linha.task_novo);
  if (!novo) {
    const criado = await postarCard(c, plataforma, atributos);
    novo = criado.id;
    c.linha.task_novo = String(novo);
    if (criado.desligou) c.linha.desligou_antigo = 1;
    // gravado logo: se algo cair daqui em diante, a retentativa nao cria outro
    await c.env.DB.prepare('UPDATE retornos SET task_novo = ?, desligou_antigo = ? WHERE id = ?')
      .bind(c.linha.task_novo, c.linha.desligou_antigo, c.linha.id)
      .run();
  }
  if (!c.linha.desligou_antigo) await conferirLigacao(c, novo);
  return novo;
}

async function postarCard(
  c: Ciclo,
  plataforma: string | null,
  atributos: Record<string, string>,
): Promise<{ id: number; desligou: boolean }> {
  const { cw, acc, m } = c;
  const antigo = await c.cardAntigo();
  const doAntigo = num(antigo?.board_id) ?? m.board;
  if (!doAntigo) throw new Error(`card ${m.card} sem board: nao ha' onde criar o card da volta`);
  // do Organico para o funil, como a promocao faria com o lead de anuncio
  const board = c.funil && doAntigo !== c.funil && plataforma && PLATAFORMAS_DO_FUNIL.has(plataforma) ? c.funil : doAntigo;
  const card = {
    titulo: comVolta(str(antigo?.title) ?? `Conversa #${m.conversa}`, c.linha.n),
    boardId: board,
    stepId: await primeiraEtapa(c, board),
    conversas: [m.conversa],
    contatos: Array.isArray(antigo?.contact_ids) ? antigo.contact_ids.map(Number).filter((x) => x > 0) : [],
    atributos,
  };

  try {
    return { id: await cw.criarCard(acc, card), desligou: false };
  } catch (e) {
    // 5xx ou rede e' instabilidade, nao recusa: o card antigo fica como esta'
    if (!/-> 4\d\d\b/.test((e as Error).message)) throw e;
  }
  // Recusado: talvez o Kanban nao aceite dois cards na conversa. Solta o antigo
  // e tenta uma vez mais; falhou de novo, a ligacao volta.
  await cw.ligarConversasDoCard(acc, m.card, []);
  try {
    return { id: await cw.criarCard(acc, card), desligou: true };
  } catch (e) {
    await cw.ligarConversasDoCard(acc, m.card, [m.conversa]).catch((e2: Error) => {
      console.log(JSON.stringify({ acao: 'volta_religar_antigo_falhou', card: m.card, erro: e2.message.slice(0, 200) }));
    });
    throw e;
  }
}

/** A primeira etapa: a do funil vem de `funnel_stages`; a do Organico, do Chatwoot (KV). */
async function primeiraEtapa(c: Ciclo, board: number): Promise<number> {
  if (board === c.funil) {
    const s = await c.env.DB.prepare('SELECT cw_step_id FROM funnel_stages WHERE tenant_id = ? ORDER BY posicao LIMIT 1')
      .bind(c.tenantId)
      .first<{ cw_step_id: number }>();
    if (s) return s.cw_step_id;
  }
  const primeira = (await etapasDoBoard(c.env, c.cw, c.acc, board))[0];
  if (!primeira) throw new Error(`board ${board} sem etapas: nao ha' onde criar o card da volta`);
  return primeira.id;
}

/** A conversa tem de apontar para o card novo; senao o antigo solta a conversa (uma vez, sem laco). */
async function conferirLigacao(c: Ciclo, novo: number): Promise<void> {
  const aponta = num(obj((await c.cw.conversa(c.acc, c.m.conversa))?.kanban_task)?.id);
  if (aponta === novo) return;
  await c.cw.ligarConversasDoCard(c.acc, c.m.card, []);
  c.linha.desligou_antigo = 1;
  await c.env.DB.prepare('UPDATE retornos SET desligou_antigo = 1 WHERE id = ?').bind(c.linha.id).run();
  console.log(JSON.stringify({ acao: 'volta_desligou_antigo', conversa: c.m.conversa, antigo: c.m.card, novo, apontava: aponta }));
}

/**
 * O grupo fica sabendo pelo card novo, sem esperar o webhook dele. As esperas
 * pelo protocolo ja' vao gastas: a atribuicao acabou de grava-lo. Falhar aqui
 * nao desfaz a volta; o webhook do card e' a segunda chance, e
 * `group_notifications` barra o aviso em dobro.
 */
async function avisar(c: Ciclo, novo: number): Promise<void> {
  try {
    const card = JSON.stringify(await c.cw.tarefa(c.acc, novo));
    const r = await avisarLeadNoGrupo(c.env, c.tenantId, card, { tentativa: TENTATIVAS_ESPERANDO_PROTOCOLO });
    console.log(JSON.stringify({ acao: 'volta_aviso', card: novo, status: r.status, motivo: r.motivo }));
  } catch (e) {
    console.log(JSON.stringify({ acao: 'volta_aviso_falhou', card: novo, erro: (e as Error).message.slice(0, 200) }));
  }
}

async function protocoloDaConversa(env: Env, tenantId: number, conversa: number): Promise<string | null> {
  const r = await env.DB.prepare('SELECT protocol FROM conversations WHERE tenant_id = ? AND cw_conversation_id = ?')
    .bind(tenantId, conversa)
    .first<{ protocol: string | null }>();
  return str(r?.protocol);
}

/** O lead do ciclo e' a copia do anterior (`retorno_de` preenchido), nao um anuncio novo? */
async function copiaDoAnterior(env: Env, tenantId: number, protocolo: string | null): Promise<boolean> {
  if (!protocolo) return false;
  const r = await env.DB.prepare('SELECT retorno_de FROM leads WHERE tenant_id = ? AND protocol = ?')
    .bind(tenantId, protocolo)
    .first<{ retorno_de: string | null }>();
  return !!r?.retorno_de;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
/** Numero positivo, tambem de texto: `retornos.task_novo` e' TEXT. */
function num(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}
