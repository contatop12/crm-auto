import type { Env } from '../env';
import { ChatwootClient, CardSemId, type CwStep } from '../clients/chatwoot';
import { comVolta, ehRetorno } from '../domain/retorno';
import { ehNumeroProprio, lerNumerosProprios } from '../domain/nomeLead';
import { atribuirLead, MOTIVO_VOLTA_SEM_LEAD } from './leadMessage';
import { avisarLeadNoGrupo, TENTATIVAS_ESPERANDO_PROTOCOLO } from './kanbanTask';

/**
 * O lead que volta (regra em domain/retorno.ts): card novo e ciclo novo.
 *
 * Roda antes da atribuicao em toda mensagem do lead. `null` = a mensagem nao
 * tem nada com volta, e a fila segue o caminho de sempre. Sendo volta, quem
 * atribui e' a atribuicao de sempre, em modo de volta: ela acha o lead do ciclo
 * e pede o card por `criarCard`. Daqui saem o card, o aviso no grupo e o
 * registro em `retornos`.
 *
 * Uma volta, um card: a linha de `retornos` e' reservada antes do card (UNIQUE
 * pelo card antigo), e a retentativa da fila retoma do ponto em que parou, sem
 * criar o card de novo.
 */

/** `retentar: false` = erro que a fila nao deve repetir (o card pode ter nascido). */
type Resultado = Awaited<ReturnType<typeof atribuirLead>> & { retentar?: boolean };

/** Etapas de um board guardadas no KV: o Organico nao esta' em `funnel_stages`. */
const TTL_ETAPAS_S = 3600;

/**
 * Volta pendente de OUTRA mensagem: ate' aqui, a primeira ainda esta' abrindo
 * (o anuncio da Meta espera ~20 s pela Evolution). Passou disso, ela morreu e
 * esta mensagem assume.
 */
const PRAZO_DA_OUTRA_S = 10 * 60;

/**
 * Quem abre a volta segura a linha por isto (`trabalhando_ate`): duas entregas
 * da mesma mensagem ao mesmo tempo nao criam dois cards. Cobre a atribuicao ate'
 * o POST do card e tem de ser MENOR que as retentativas da fila (5 x ~20 s =
 * ~100 s): se quem segura morrer, a ultima retentativa ainda acha a trava
 * vencida e termina a volta, em vez de esgotar as tentativas esbarrando nela.
 */
const TRAVA_S = 45;
const SEGURAR = `datetime('now', '+${TRAVA_S} seconds')`;

const MOTIVO_OCUPADA = 'outra execucao esta abrindo esta volta';

/**
 * Mensagem mais velha que isto nunca abre volta nova. O reprocesso
 * (`POST /tenants/:id/reprocessar`) devolve a fila `message_incoming` de meses
 * atras: com a volta ligada, cada um abriria um card para uma conversa que ja'
 * andou. 72 h cobrem com folga a fila e a Evolution atrasada (47 h em 11/2026).
 */
const IDADE_MAXIMA_MS = 72 * 3600 * 1000;

/** Ciclo de anuncio ou do perfil do Google vai para o funil, mesmo saindo do Organico. */
const PLATAFORMAS_DO_FUNIL = new Set(['google', 'meta', 'gmn']);

/**
 * O Kanban recusou o card (pedido invalido, conflito): pode ser a segunda
 * ligacao na mesma conversa. 401, 408, 429 e os outros nao dizem isso.
 */
const RECUSA = /-> (400|409|422)\b/;

interface Config {
  retorno_dias: number | null;
  cw_account_id: number | null;
  cw_board_funil_id: number | null;
  cw_board_organico_id: number | null;
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
  /** hora da mensagem (ms); null = o webhook nao trouxe ou nao deu para ler */
  quando: number | null;
}

interface Linha {
  id: number;
  n: number;
  mensagem_id: string | null;
  task_novo: string | null;
  protocolo_anterior: string | null;
  desligou_antigo: number;
  /** pendente | feito | erro (final: o card pode ter nascido sem o id chegar) */
  status: string;
  erro: string | null;
  idade_s: number;
}

const COLUNAS_DA_LINHA = `id, n, mensagem_id, task_novo, protocolo_anterior, desligou_antigo, status, erro,
  CAST((julianday('now') - julianday(created_at)) * 86400 AS INTEGER) AS idade_s`;

/** O que os passos do card dividem. `linha` muda: e' o estado da volta. */
interface Ciclo {
  env: Env;
  cw: ChatwootClient;
  acc: number;
  tenantId: number;
  funil: number | null;
  organico: number | null;
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
    `SELECT retorno_dias, cw_account_id, cw_board_funil_id, cw_board_organico_id, numeros_proprios
     FROM tenant_config WHERE tenant_id = ?`,
  )
    .bind(tenantId)
    .first<Config>();
  // 0 ou negativo e' desligado como NULL: com 0, toda mensagem em card fechado seria volta
  if (cfg?.retorno_dias == null || cfg.retorno_dias <= 0 || !cfg.cw_account_id) return null;
  if (ehNumeroProprio(m.telefone, lerNumerosProprios(cfg.numeros_proprios))) return null;

  const acc = cfg.cw_account_id;
  const cw = ChatwootClient.fromEnv(env);

  // lido uma vez so': a data da etapa (quando falta a mensagem anterior) e o molde do card novo
  let antigo: Promise<Record<string, unknown> | null> | null = null;
  const cardAntigo = () => (antigo ??= cw.tarefa(acc, m.card));

  // A volta deste card ja' existe? Decide antes da etapa e do silencio, e sem
  // chamar o Chatwoot: a mensagem com o retrato do card antigo e' da volta
  // mesmo que o lead tenha falado ha' segundos, e nao pode cair na atribuicao
  // comum, que gravaria o ciclo novo no card antigo.
  const existente = await linhaDoCard(env, tenantId, m.card);
  let reserva: Linha | Resultado;
  if (existente) {
    reserva = await retomar(env, m, existente);
  } else {
    // O silencio se mede ate' a hora da MENSAGEM: reprocessada dias depois, ela
    // daria outra resposta contando ate' agora. E mensagem velha nao abre volta
    // nova (ver IDADE_MAXIMA_MS); a volta ja' aberta, acima, responde por qualquer idade.
    const agora = Date.now();
    const quando = m.quando ?? agora;
    if (agora - quando > IDADE_MAXIMA_MS) return null;
    if (!(await naEtapaFinal(env, cw, tenantId, acc, m))) return null;
    const anteriorDoLead = await cw.mensagemAnteriorDoLead(acc, m.conversa, m.id);
    const naEtapaDesde = anteriorDoLead === null ? Date.parse(String((await cardAntigo())?.step_changed_at ?? '')) : null;
    // a etapa final ja' foi conferida acima, antes de qualquer chamada ao Chatwoot
    if (!ehRetorno({ etapaFinal: true, anteriorDoLead, naEtapaDesde, agora: quando, dias: cfg.retorno_dias })) {
      return null;
    }
    reserva = await reservar(env, tenantId, m, m.protocolo ?? (await protocoloDaConversa(env, tenantId, m.conversa)));
  }
  // resultado final da mensagem: volta feita, de outra mensagem, ou segura por outra execucao
  if ('motivo' in reserva) return reserva;
  const linha = reserva;

  const ciclo: Ciclo = {
    env, cw, acc, tenantId, funil: cfg.cw_board_funil_id, organico: cfg.cw_board_organico_id, m, linha, cardAntigo,
  };
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
    // mensagem em ~20 s, e ela retoma esta reserva. Ainda nao ha' card. Solta
    // ja', senao a volta da fila esbarraria no proprio prazo.
    if (r.adiar) {
      await env.DB.prepare('UPDATE retornos SET trabalhando_ate = NULL WHERE id = ?').bind(linha.id).run();
      return r;
    }

    // sem lead, nasce so' o card: planilha, aviso e conversao seguem a regra do card sem protocolo
    const semLead = r.motivo === MOTIVO_VOLTA_SEM_LEAD;
    const novo = semLead ? await cardDoCiclo(ciclo, null, {}) : num(linha.task_novo);
    if (!novo) throw new Error(`volta #${linha.n}: a atribuicao terminou sem card (${r.motivo})`);

    await avisar(ciclo, novo);

    const protocoloNovo = semLead ? null : await protocoloDaConversa(env, tenantId, m.conversa);
    const origem = semLead ? 'sem_lead' : (await copiaDoAnterior(env, tenantId, protocoloNovo)) ? 'herdada' : 'anuncio_novo';
    await env.DB.prepare(
      `UPDATE retornos SET protocolo_novo = ?, origem = ?, status = 'feito', erro = NULL, trabalhando_ate = NULL WHERE id = ?`,
    )
      .bind(protocoloNovo, origem, linha.id)
      .run();
    console.log(JSON.stringify({
      acao: 'volta_aberta', tenant: tenantId, conversa: m.conversa, n: linha.n, anterior: m.card, card: novo,
      origem, protocolo: protocoloNovo,
    }));
    return semLead ? { status: 'ok', motivo: `volta #${linha.n} sem lead: card ${novo} criado, sem protocolo` } : r;
  } catch (e) {
    const motivo = (e as Error).message.slice(0, 500);
    // 2xx sem id: o card pode ter nascido, e a retentativa criaria o segundo.
    // Final: a linha fica em erro (a mensagem seguinte com o card antigo para
    // nela, como na feita) e a fila nao repete. Alguem confere o Kanban.
    if (e instanceof CardSemId) {
      await env.DB.prepare(`UPDATE retornos SET erro = ?, status = 'erro', trabalhando_ate = NULL WHERE id = ?`)
        .bind(motivo, linha.id)
        .run()
        .catch(() => undefined);
      console.log(JSON.stringify({ acao: 'volta_card_sem_id', tenant: tenantId, conversa: m.conversa, n: linha.n, erro: motivo }));
      return { status: 'erro', retentar: false, motivo: `volta #${linha.n}: ${motivo}` };
    }
    // a linha fica pendente com o motivo, e solta: a fila retenta e retoma pelo `task_novo`
    await env.DB.prepare('UPDATE retornos SET erro = ?, trabalhando_ate = NULL WHERE id = ?')
      .bind(motivo, linha.id)
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
    quando: horaDaMensagem(p?.created_at),
  };
}

/** O webhook manda a hora em ISO; segundos (numero) tambem servem. Ilegivel = null. */
function horaDaMensagem(v: unknown): number | null {
  const ms = typeof v === 'number' ? v * 1000 : typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(ms) ? ms : null;
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

function linhaDoCard(env: Env, tenantId: number, card: number): Promise<Linha | null> {
  return env.DB.prepare(`SELECT ${COLUNAS_DA_LINHA} FROM retornos WHERE tenant_id = ? AND task_anterior = ?`)
    .bind(tenantId, String(card))
    .first<Linha>();
}

/**
 * Volta nova do card antigo. `INSERT OR IGNORE` pela UNIQUE do card antigo: um
 * card fechado gera uma volta so'. A reserva ja' nasce segura por esta
 * execucao; se outra reservou no mesmo instante, decide como a retomada.
 * `protocolo_anterior` fica gravado aqui porque a atribuicao troca o da
 * conversa antes de terminar: a retentativa le' o daqui, nao o novo.
 */
async function reservar(env: Env, tenantId: number, m: Mensagem, anterior: string | null): Promise<Linha | Resultado> {
  const nova = await env.DB.prepare(
    `INSERT OR IGNORE INTO retornos
       (tenant_id, cw_conversation_id, n, mensagem_id, task_anterior, protocolo_anterior, trabalhando_ate)
     SELECT ?, ?, COALESCE(MAX(n), 0) + 1, ?, ?, ?, ${SEGURAR} FROM retornos WHERE tenant_id = ? AND cw_conversation_id = ?`,
  )
    .bind(tenantId, m.conversa, String(m.id), String(m.card), anterior, tenantId, m.conversa)
    .run();
  const l = await linhaDoCard(env, tenantId, m.card);
  // a outra UNIQUE (conversa, n): outra volta da conversa tomou o numero agora; a fila retenta
  if (!l) throw new Error(`volta da conversa ${m.conversa}: o numero da volta foi tomado por outra execucao`);
  return nova.meta.changes ? l : retomar(env, m, l);
}

/**
 * A volta deste card ja' existe: decide pela linha, sem perguntar ao Chatwoot e
 * sem medir o silencio de novo (a volta foi provada quando a linha nasceu).
 * Devolve a linha, segura por esta execucao e relida, ou o resultado final da
 * mensagem.
 */
async function retomar(env: Env, m: Mensagem, l: Linha): Promise<Linha | Resultado> {
  if (l.status === 'feito') {
    return { status: 'ignorado', motivo: `mensagem da volta #${l.n} deste card, ja aberta no card ${l.task_novo}` };
  }
  // Em erro e' final como a feita: tentar de novo poderia criar o segundo card
  if (l.status === 'erro') {
    return { status: 'ignorado', motivo: `mensagem da volta #${l.n} deste card, que parou em erro: ${l.erro ?? 'sem motivo'}` };
  }
  const desta = l.mensagem_id === String(m.id);
  if (!desta && l.idade_s < PRAZO_DA_OUTRA_S) {
    return { status: 'ignorado', motivo: `outra mensagem esta abrindo a volta #${l.n} deste card` };
  }

  // Retentativa desta mensagem, ou a primeira morreu e esta assume: segura a
  // linha num UPDATE so', e so' se ninguem a segura agora.
  const segurou = await env.DB.prepare(
    `UPDATE retornos SET mensagem_id = ?, trabalhando_ate = ${SEGURAR}
     WHERE id = ? AND status = 'pendente' AND mensagem_id IS ?
       AND (trabalhando_ate IS NULL OR trabalhando_ate < datetime('now'))`,
  )
    .bind(String(m.id), l.id, l.mensagem_id)
    .run();
  // a fila retenta com backoff; quando a outra terminar, a volta ja' estara' feita
  if (!segurou.meta.changes) return { status: 'erro', motivo: MOTIVO_OCUPADA };
  if (!desta) {
    console.log(JSON.stringify({ acao: 'volta_assumida', conversa: m.conversa, n: l.n, de: l.mensagem_id, por: m.id }));
  }
  // relida: quem segurava antes pode ter gravado o card entre a leitura e o UPDATE
  const atual = await env.DB.prepare(`SELECT ${COLUNAS_DA_LINHA} FROM retornos WHERE id = ?`).bind(l.id).first<Linha>();
  if (!atual) throw new Error(`volta #${l.n} da conversa ${m.conversa}: a linha sumiu depois de segurada`);
  return atual;
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
    // Sem `task_novo` nao quer dizer sem card: a execucao anterior pode te-lo
    // criado e caido antes de gravar. Confere antes de qualquer POST.
    novo = (await cardJaCriado(c)) ?? (await postarCard(c, plataforma, atributos));
    c.linha.task_novo = String(novo);
    // gravado logo: se algo cair daqui em diante, a retentativa nao cria outro
    await c.env.DB.prepare('UPDATE retornos SET task_novo = ? WHERE id = ?').bind(c.linha.task_novo, c.linha.id).run();
  }
  if (!c.linha.desligou_antigo) await conferirLigacao(c, novo);
  return novo;
}

/** O titulo do card do ciclo: o do card antigo, sem sufixo de volta anterior, mais " #n". */
async function tituloDoCiclo(c: Ciclo): Promise<string> {
  return comVolta(str((await c.cardAntigo())?.title) ?? `Conversa #${c.m.conversa}`, c.linha.n);
}

/**
 * O card desta volta que uma execucao anterior criou sem chegar a gravar em
 * `retornos` (o banco falhou depois do POST, a execucao morreu). A conversa
 * aponta para um card que nao e' o antigo, com o titulo deste ciclo: e' ele, e
 * outro POST faria o segundo " #n". Titulo diferente e' outro card: cria.
 */
async function cardJaCriado(c: Ciclo): Promise<number | null> {
  const aponta = num(obj((await c.cw.conversa(c.acc, c.m.conversa))?.kanban_task)?.id);
  if (!aponta || aponta === c.m.card) return null;
  if (str((await c.cw.tarefa(c.acc, aponta))?.title) !== (await tituloDoCiclo(c))) return null;
  console.log(JSON.stringify({ acao: 'volta_card_adotado', conversa: c.m.conversa, n: c.linha.n, card: aponta }));
  return aponta;
}

async function postarCard(c: Ciclo, plataforma: string | null, atributos: Record<string, string>): Promise<number> {
  const { cw, acc, m } = c;
  const antigo = await c.cardAntigo();
  const doAntigo = num(antigo?.board_id) ?? m.board;
  if (!doAntigo) throw new Error(`card ${m.card} sem board: nao ha' onde criar o card da volta`);
  // do Organico para o funil, como a promocao faria com o lead de anuncio; qualquer outro board fica
  const board = c.funil && doAntigo === c.organico && plataforma && PLATAFORMAS_DO_FUNIL.has(plataforma) ? c.funil : doAntigo;
  const card = {
    titulo: await tituloDoCiclo(c),
    boardId: board,
    stepId: await primeiraEtapa(c, board),
    conversas: [m.conversa],
    contatos: ids(antigo?.contact_ids) ?? [],
    atributos,
  };

  try {
    return await cw.criarCard(acc, card);
  } catch (e) {
    // limite, credencial, 5xx, rede: nao e' recusa do card, e o antigo fica como esta'
    if (!RECUSA.test((e as Error).message)) throw e;
  }
  // Recusado: talvez o Kanban nao aceite dois cards na conversa. Solta o antigo
  // e tenta uma vez mais; falhou de novo, a ligacao volta como estava.
  const ligadas = await soltarAntigo(c);
  try {
    return await cw.criarCard(acc, card);
  } catch (e) {
    try {
      await cw.ligarConversasDoCard(acc, m.card, ligadas);
      // so' com a ligacao de volta o registro deixa de dizer que o antigo esta' solto
      c.linha.desligou_antigo = 0;
      await c.env.DB.prepare('UPDATE retornos SET desligou_antigo = 0 WHERE id = ?').bind(c.linha.id).run();
    } catch (e2) {
      console.log(JSON.stringify({ acao: 'volta_religar_antigo_falhou', card: m.card, erro: (e2 as Error).message.slice(0, 200) }));
    }
    throw e;
  }
}

/**
 * Tira esta conversa do card antigo; as outras ligadas a ele ficam. Marca na
 * hora: card antigo sem a conversa nunca fica sem registro. Devolve a ligacao
 * de antes, para religar, sempre com esta conversa: na retentativa depois de
 * cair entre soltar e o segundo POST, o card antigo ja' e' lido sem ela, e
 * religar so' o que ele tem a deixaria solta.
 */
async function soltarAntigo(c: Ciclo): Promise<number[]> {
  const doCard = ids((await c.cardAntigo())?.conversation_ids) ?? [];
  const ligadas = doCard.includes(c.m.conversa) ? doCard : [...doCard, c.m.conversa];
  await c.cw.ligarConversasDoCard(c.acc, c.m.card, ligadas.filter((x) => x !== c.m.conversa));
  c.linha.desligou_antigo = 1;
  await c.env.DB.prepare('UPDATE retornos SET desligou_antigo = 1 WHERE id = ?').bind(c.linha.id).run();
  return ligadas;
}

/** A primeira etapa: a do funil vem de `funnel_stages`; a dos outros boards, do Chatwoot (KV). */
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
  await soltarAntigo(c);
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
/** Lista de ids do card (`contact_ids`, `conversation_ids`); null quando o campo nao veio. */
function ids(v: unknown): number[] | null {
  return Array.isArray(v) ? v.map(num).filter((x): x is number => x !== null) : null;
}
