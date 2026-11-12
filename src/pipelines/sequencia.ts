import type { Env } from '../env';
import { SheetsClient } from '../clients/sheets';
import { indiceParaColuna } from '../domain/planilha';
import {
  acharColunas, chaveCab, chaveDeOrdem, corteDosAvisos, formatosPerdidos, normSeq,
  planejarMovimentos, planejarNumeracao, type LinhaNumerada,
} from '../domain/sequencia';
import { avisarUmaVez } from './avisosChatwoot';

/**
 * Numera a coluna SEQUENCIA e ordena a aba de leads de cada cliente. Substitui o
 * Apps Script "Sequencia Leads - Todos os Clientes" (lista em `sequencia_planilhas`).
 *
 * Roda a cada minuto e nao guarda nada de uma rodada para a outra alem dos avisos
 * por enviar: o estado e' a propria aba. Planilha que falhou numa rodada e' lida de
 * novo na seguinte, linha que ficou sem numero ganha numero, aviso que nao saiu sai.
 *
 * Modos (`sequencia_estado.modo`):
 *  - desligado: nao le' nada;
 *  - sombra: le' e calcula, nao grava na planilha nem avisa. Serve para comparar com
 *    o Apps Script antes da troca;
 *  - ligado: grava e avisa. So' com os acionadores do Apps Script apagados, senao os
 *    dois numeram a mesma linha.
 */

export type Modo = 'desligado' | 'sombra' | 'ligado';
export const MODOS: readonly Modo[] = ['desligado', 'sombra', 'ligado'];

// A Pulseboard junta a sequencia ao aviso que chegou pelo caminho direto e manda
// uma mensagem so'. Se ela nao responder 2xx, o lead vai pelo fluxo Central do n8n.
const PULSEBOARD = 'https://pulseboard.sitespdoze.com.br/leads-sequencia';
const RESERVA = 'https://n8n.sitespdoze.com.br/webhook/leads-sequencia';

/** Um aviso e' tentado uma vez por rodada; depois disso para e fica registrado. */
const MAX_TENTATIVAS = 15;
/** A rodada segura a vez por este tempo; a proxima so' entra depois de ela soltar ou vencer. */
const TRAVA_MS = 150_000;
/** As abas que so' ordenam sao lidas de 5 em 5 minutos, como no Apps Script. */
const MINUTOS_SO_ORDENA = 5;
/** Rodadas seguidas com erro na mesma planilha ate' avisar o grupo de alertas. */
const ERROS_PARA_ALERTA = 30;
const META_TTL = 6 * 3600;
const FORMATO_INTERVALO_MS = 3600_000;

interface Planilha {
  id: number;
  doc: string;
  aba: string;
  cliente: string;
  nome_no_aviso: string | null;
  prefixo: string;
  numerar: number;
  notificar: number;
  ordenar: number;
  erros_seguidos: number;
  erro_desde: string | null;
  formato_em: string | null;
}

interface Aba { id: number; titulo: string; planilha: string }

export interface ResumoPlanilha {
  cliente: string;
  numeradas: number;
  consertadas: number;
  movidas: number;
  avisos: number;
  formato: boolean;
  erro?: string;
}

export interface ResumoRodada {
  modo: Modo;
  rodou: boolean;
  motivo?: string;
  planilhas: ResumoPlanilha[];
}

export async function lerModo(db: D1Database): Promise<Modo> {
  const r = await db.prepare(`SELECT valor FROM sequencia_estado WHERE chave = 'modo'`).first<{ valor: string }>();
  return MODOS.includes(r?.valor as Modo) ? (r!.valor as Modo) : 'desligado';
}

export async function gravarModo(db: D1Database, modo: Modo): Promise<void> {
  await db.prepare(`UPDATE sequencia_estado SET valor = ? WHERE chave = 'modo'`).bind(modo).run();
}

/** So' uma rodada por vez. O UPDATE condicional e' atomico no D1. */
async function pegarTrava(db: D1Database, agora: Date): Promise<string | null> {
  const ate = new Date(agora.getTime() + TRAVA_MS).toISOString();
  const r = await db
    .prepare(`UPDATE sequencia_estado SET valor = ? WHERE chave = 'trava' AND valor < ?`)
    .bind(ate, agora.toISOString())
    .run();
  return r.meta.changes ? ate : null;
}

async function soltarTrava(db: D1Database, ate: string): Promise<void> {
  await db.prepare(`UPDATE sequencia_estado SET valor = '' WHERE chave = 'trava' AND valor = ?`).bind(ate).run();
}

const mesmoNome = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

/** A aba pelo nome, ignorando maiusculas. O id e o titulo ficam 6 h no KV. */
async function acharAba(env: Env, sheets: SheetsClient, doc: string, aba: string): Promise<Aba> {
  const chave = `seq:meta:${doc}`;
  type Meta = Awaited<ReturnType<SheetsClient['meta']>>;
  let meta: Meta | null = null;
  try {
    meta = JSON.parse((await env.CACHE.get(chave)) ?? 'null') as Meta | null;
  } catch { /* sem cache: le' do Sheets */ }

  let achada = meta?.abas?.find((a) => mesmoNome(a.titulo, aba));
  if (!meta || !achada) {
    meta = await sheets.meta(doc);
    achada = meta.abas.find((a) => mesmoNome(a.titulo, aba));
    try {
      await env.CACHE.put(chave, JSON.stringify(meta), { expirationTtl: META_TTL });
    } catch { /* o cache e' so' economia de leitura */ }
  }
  if (!achada) throw new Error(`sem a aba "${aba}" (abas: ${meta.abas.map((a) => a.titulo).join(', ')})`);
  return { id: achada.id, titulo: achada.titulo, planilha: meta.titulo };
}

function corpoDoAviso(p: Planilha, aba: Aba, n: LinhaNumerada) {
  return {
    cliente: p.nome_no_aviso || aba.planilha,
    planilhaId: p.doc,
    aba: aba.titulo,
    clienteChave: `${p.doc}|${aba.titulo}`,
    linha: n.linha,
    sequencia: n.sequencia,
    dados: n.dados,
  };
}

async function postar(url: string, corpo: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: corpo });
    return r.ok;
  } catch {
    return false;
  }
}

/** Pulseboard; se ela recusar, a reserva. Nenhuma das duas: fica para a proxima rodada. */
async function enviarAviso(db: D1Database, id: number, payload: string): Promise<boolean> {
  const estado = (await postar(PULSEBOARD, payload)) ? 'enviado' : (await postar(RESERVA, payload)) ? 'reserva' : null;
  if (estado) {
    await db
      .prepare(`UPDATE sequencia_avisos SET estado = ?, tentativas = tentativas + 1, atualizado_em = datetime('now') WHERE id = ?`)
      .bind(estado, id)
      .run();
    return true;
  }
  await db
    .prepare(
      `UPDATE sequencia_avisos
       SET tentativas = tentativas + 1, atualizado_em = datetime('now'),
           estado = CASE WHEN tentativas + 1 >= ? THEN 'desistiu' ELSE estado END
       WHERE id = ?`,
    )
    .bind(MAX_TENTATIVAS, id)
    .run();
  console.log(JSON.stringify({ acao: 'sequencia_aviso_falhou', aviso: id }));
  return false;
}

/** Avisos de rodadas anteriores que a Pulseboard e a reserva nao aceitaram. */
async function reenviarAvisos(db: D1Database): Promise<void> {
  const { results } = await db
    .prepare(`SELECT id, payload FROM sequencia_avisos WHERE estado = 'gravado' ORDER BY id LIMIT 20`)
    .all<{ id: number; payload: string }>();
  for (const a of results) await enviarAviso(db, a.id, a.payload);
}

interface Pendente { id: number; planilha_id: number; sequencia: string; payload: string; minutos: number }

/**
 * As pendencias de todas as planilhas numa consulta so': a rodada e' de minuto em
 * minuto e o D1 tem teto de consultas por execucao.
 */
async function lerPendentes(db: D1Database, modo: Modo): Promise<Map<number, Pendente[]>> {
  const { results } = await db
    .prepare(
      `SELECT id, planilha_id, sequencia, payload, (julianday('now') - julianday(criado_em)) * 1440 AS minutos
       FROM sequencia_avisos WHERE estado = ? ORDER BY id`,
    )
    .bind(modo === 'ligado' ? 'a_gravar' : 'sombra')
    .all<Pendente>();
  const porPlanilha = new Map<number, Pendente[]>();
  for (const r of results) porPlanilha.set(r.planilha_id, [...(porPlanilha.get(r.planilha_id) ?? []), r]);
  return porPlanilha;
}

/** Colunas que dizem qual lead e': servem para conferir se a sombra numerou a mesma linha. */
const IDENTIDADE = new Set(['DATA', 'HORA', 'NOME', 'TELEFONE', 'WHATSAPP', 'EMAIL', 'E-MAIL']);

/**
 * Acerta as pendencias da rodada anterior contra o que a aba mostra agora.
 *
 * ligado: `a_gravar` que ja' esta' na aba vira `gravado` (a rodada morreu depois de
 * gravar, falta o aviso); o que nao esta' e' apagado, e a numeracao desta rodada refaz.
 * sombra: confere se o Apps Script deu aquela sequencia `a mesma linha.
 */
async function conferirPendentes(db: D1Database, p: Planilha, linhas: string[][], modo: Modo, results: Pendente[]): Promise<void> {
  if (!results.length) return;

  const cab = linhas[0] ?? [];
  const { cSeq } = acharColunas(cab);
  const naAba = new Map<string, string[]>();
  if (cSeq >= 0) {
    for (let i = 1; i < linhas.length; i++) {
      const s = normSeq(p.prefixo, linhas[i]![cSeq]);
      if (s && !naAba.has(s)) naAba.set(s, linhas[i]!);
    }
  }

  for (const a of results) {
    const linha = naAba.get(a.sequencia);
    let novo: string | null = null;
    if (modo === 'ligado') {
      novo = linha ? 'gravado' : 'apagar';
    } else if (linha) {
      const dados = (JSON.parse(a.payload) as { dados?: Record<string, string> }).dados ?? {};
      const igual = cab.every((h, c) => {
        const nome = String(h ?? '').trim();
        return !IDENTIDADE.has(chaveCab(nome)) || String(linha[c] ?? '') === String(dados[nome] ?? '');
      });
      novo = igual ? 'sombra_ok' : 'sombra_diverge';
    } else if (a.minutos > 10) {
      novo = 'sombra_faltou';
    }
    if (novo === 'apagar') {
      await db.prepare('DELETE FROM sequencia_avisos WHERE id = ?').bind(a.id).run();
    } else if (novo) {
      await db
        .prepare(`UPDATE sequencia_avisos SET estado = ?, atualizado_em = datetime('now') WHERE id = ?`)
        .bind(novo, a.id)
        .run();
      if (novo !== 'gravado' && novo !== 'sombra_ok') {
        console.log(JSON.stringify({ acao: 'sequencia_sombra', cliente: p.cliente, sequencia: a.sequencia, resultado: novo }));
      }
    }
  }
}

async function registrarAviso(db: D1Database, p: Planilha, sequencia: string, estado: string, payload: string): Promise<number> {
  const r = await db
    .prepare('INSERT INTO sequencia_avisos (planilha_id, sequencia, estado, payload) VALUES (?, ?, ?, ?) RETURNING id')
    .bind(p.id, sequencia, estado, payload)
    .first<{ id: number }>();
  return r!.id;
}

async function numerar(
  env: Env, sheets: SheetsClient, p: Planilha, aba: Aba, linhas: string[][], modo: Modo, agora: Date, resumo: ResumoPlanilha,
  pendentes: Pendente[],
): Promise<void> {
  await conferirPendentes(env.DB, p, linhas, modo, pendentes);

  const plano = planejarNumeracao({ prefixo: p.prefixo, notificar: !!p.notificar }, linhas, corteDosAvisos(agora));
  if ('motivo' in plano) throw new Error(`aba "${aba.titulo}" ${plano.motivo}`);
  resumo.numeradas = plano.novas.length;
  resumo.consertadas = plano.celulas.length - plano.novas.length;
  if (!plano.celulas.length) return;

  if (modo === 'sombra') {
    for (const n of plano.novas) {
      const ja = await env.DB
        .prepare(`SELECT 1 AS x FROM sequencia_avisos WHERE planilha_id = ? AND sequencia = ? AND estado = 'sombra'`)
        .bind(p.id, n.sequencia)
        .first();
      if (!ja) await registrarAviso(env.DB, p, n.sequencia, 'sombra', JSON.stringify(corpoDoAviso(p, aba, n)));
    }
    return;
  }

  // o aviso e' registrado antes de a sequencia ir para a aba: ver `conferirPendentes`
  const avisos: Array<{ id: number; payload: string }> = [];
  for (const n of plano.novas.filter((x) => x.avisar)) {
    const payload = JSON.stringify(corpoDoAviso(p, aba, n));
    avisos.push({ id: await registrarAviso(env.DB, p, n.sequencia, 'a_gravar', payload), payload });
  }

  const coluna = indiceParaColuna(plano.cSeq);
  await sheets.gravarCelulas(p.doc, aba.titulo, plano.celulas.map((c) => ({ celula: `${coluna}${c.linha}`, valor: c.valor })));

  for (const a of avisos) {
    await env.DB
      .prepare(`UPDATE sequencia_avisos SET estado = 'gravado', atualizado_em = datetime('now') WHERE id = ?`)
      .bind(a.id)
      .run();
    if (await enviarAviso(env.DB, a.id, a.payload)) resumo.avisos++;
  }
  console.log(JSON.stringify({
    acao: 'sequencia_numerou', cliente: p.cliente, sequencias: plano.novas.map((n) => n.sequencia), consertadas: resumo.consertadas,
  }));
}

const formatoDaColuna = (sheetId: number, coluna: number, type: 'DATE' | 'TIME', pattern: string) => ({
  repeatCell: {
    range: { sheetId, startRowIndex: 1, startColumnIndex: coluna, endColumnIndex: coluna + 1 },
    cell: { userEnteredFormat: { numberFormat: { type, pattern } } },
    fields: 'userEnteredFormat.numberFormat',
  },
});

async function ordenar(
  env: Env, sheets: SheetsClient, p: Planilha, aba: Aba, linhas: string[][], modo: Modo, agora: Date, resumo: ResumoPlanilha,
): Promise<void> {
  const { cData, cHora } = acharColunas(linhas[0] ?? []);
  if (cData < 0) throw new Error(`aba "${aba.titulo}" sem a coluna DATA`);

  // Coluna que perdeu o formato mostra a hora errada e a ordem sairia errada junto:
  // reaplica o formato e deixa a ordenacao para a rodada seguinte, ja' com a hora certa.
  const perdido = formatosPerdidos(linhas);
  if (perdido.data || perdido.hora) {
    resumo.formato = true;
    const recente = p.formato_em && agora.getTime() - Date.parse(p.formato_em) < FORMATO_INTERVALO_MS;
    if (modo === 'ligado' && !recente) {
      await sheets.lote(p.doc, [
        ...(perdido.data ? [formatoDaColuna(aba.id, cData, 'DATE', 'dd/mm/yyyy')] : []),
        ...(perdido.hora ? [formatoDaColuna(aba.id, cHora, 'TIME', 'hh:mm:ss')] : []),
      ]);
      await env.DB.prepare('UPDATE sequencia_planilhas SET formato_em = ? WHERE id = ?').bind(agora.toISOString(), p.id).run();
      console.log(JSON.stringify({ acao: 'sequencia_formato', cliente: p.cliente, ...perdido }));
      return;
    }
  }

  const movimentos = planejarMovimentos(linhas.slice(1).map((r) => chaveDeOrdem(r, cData, cHora)));
  resumo.movidas = movimentos.length;
  if (!movimentos.length || modo !== 'ligado') return;

  // +1: a linha 1 da aba e' o cabecalho
  await sheets.lote(p.doc, movimentos.map((m) => ({
    moveDimension: {
      source: { sheetId: aba.id, dimension: 'ROWS', startIndex: m.de + 1, endIndex: m.de + 2 },
      destinationIndex: m.para + 1,
    },
  })));
  console.log(JSON.stringify({ acao: 'sequencia_ordenou', cliente: p.cliente, movidas: movimentos.length }));
}

async function rodarPlanilha(
  env: Env, sheets: SheetsClient, p: Planilha, modo: Modo, agora: Date, pendentes: Pendente[],
): Promise<ResumoPlanilha> {
  const resumo: ResumoPlanilha = { cliente: p.cliente, numeradas: 0, consertadas: 0, movidas: 0, avisos: 0, formato: false };
  const aba = await acharAba(env, sheets, p.doc, p.aba);
  const linhas = await sheets.tudo(p.doc, aba.titulo);
  if (linhas.length < 2) return resumo;

  if (p.numerar) await numerar(env, sheets, p, aba, linhas, modo, agora, resumo, pendentes);
  // a numeracao so' escreve em celula, nao muda linha de lugar: a mesma leitura serve
  if (p.ordenar && linhas.length > 2) await ordenar(env, sheets, p, aba, linhas, modo, agora, resumo);
  return resumo;
}

async function registrarErro(env: Env, p: Planilha, modo: Modo, agora: Date, erro: string): Promise<void> {
  await env.DB
    .prepare(
      `UPDATE sequencia_planilhas
       SET erro = ?, erro_desde = COALESCE(erro_desde, ?), erros_seguidos = erros_seguidos + 1 WHERE id = ?`,
    )
    .bind(erro, agora.toISOString(), p.id)
    .run();
  console.log(JSON.stringify({ acao: 'sequencia_erro', cliente: p.cliente, seguidos: p.erros_seguidos + 1, erro }));

  if (modo !== 'ligado' || p.erros_seguidos + 1 !== ERROS_PARA_ALERTA) return;
  const texto = [
    '⚠️ *Sequência de leads parada*',
    `Planilha: ${p.cliente} (aba ${p.aba})`,
    `Falhou ${ERROS_PARA_ALERTA} rodadas seguidas. Os leads novos dessa planilha estão sem número.`,
    `Erro: ${erro}`,
    'Volta sozinha quando a planilha responder; as linhas pendentes são numeradas na mesma rodada.',
  ].join('\n');
  try {
    await avisarUmaVez(env, `sequencia:${p.id}:${p.erro_desde ?? agora.toISOString()}`, texto);
  } catch (e) {
    console.log(JSON.stringify({ acao: 'sequencia_alerta_erro', erro: String((e as Error).message).slice(0, 200) }));
  }
}

/**
 * Uma rodada. `forcar` ignora o intervalo de 5 min das abas que so' ordenam
 * (rodada pedida pelo painel).
 */
export async function rodarSequencia(env: Env, agora = new Date(), forcar = false): Promise<ResumoRodada> {
  const modo = await lerModo(env.DB);
  if (modo === 'desligado') return { modo, rodou: false, motivo: 'desligado', planilhas: [] };

  const trava = await pegarTrava(env.DB, agora);
  if (!trava) {
    console.log(JSON.stringify({ acao: 'sequencia_pulou', motivo: 'rodada anterior em curso' }));
    return { modo, rodou: false, motivo: 'rodada anterior em curso', planilhas: [] };
  }

  const planilhas: ResumoPlanilha[] = [];
  try {
    if (modo === 'ligado') await reenviarAvisos(env.DB);

    const { results } = await env.DB
      .prepare('SELECT * FROM sequencia_planilhas WHERE ativo = 1 AND (numerar = 1 OR ordenar = 1) ORDER BY posicao, id')
      .all<Planilha>();
    const vezDasQueSoOrdenam = forcar || agora.getUTCMinutes() % MINUTOS_SO_ORDENA === 0;
    const sheets = new SheetsClient(env);
    const pendentes = await lerPendentes(env.DB, modo);

    for (const p of results) {
      if (!p.numerar && !vezDasQueSoOrdenam) continue;
      try {
        planilhas.push(await rodarPlanilha(env, sheets, p, modo, agora, pendentes.get(p.id) ?? []));
        if (p.erros_seguidos) {
          await env.DB
            .prepare('UPDATE sequencia_planilhas SET erro = NULL, erro_desde = NULL, erros_seguidos = 0 WHERE id = ?')
            .bind(p.id)
            .run();
        }
      } catch (e) {
        const erro = String((e as Error).message).slice(0, 300);
        planilhas.push({ cliente: p.cliente, numeradas: 0, consertadas: 0, movidas: 0, avisos: 0, formato: false, erro });
        await registrarErro(env, p, modo, agora, erro);
      }
    }

    await env.DB
      .prepare(`UPDATE sequencia_estado SET valor = ? WHERE chave = 'ultima_rodada'`)
      .bind(JSON.stringify({
        em: agora.toISOString(),
        modo,
        lidas: planilhas.length,
        com_erro: planilhas.filter((r) => r.erro).length,
        numeradas: planilhas.reduce((s, r) => s + r.numeradas, 0),
        movidas: planilhas.reduce((s, r) => s + r.movidas, 0),
      }))
      .run();
  } finally {
    await soltarTrava(env.DB, trava);
  }
  return { modo, rodou: true, planilhas };
}

/** O corpo do aviso tem nome e telefone do lead: mesma validade do corpo dos webhooks. */
export async function expurgarAvisosDaSequencia(db: D1Database, dias = 30): Promise<number> {
  const r = await db.prepare(`DELETE FROM sequencia_avisos WHERE criado_em < datetime('now', ?)`).bind(`-${dias} day`).run();
  return r.meta.changes ?? 0;
}

/** O que o painel mostra: modo, ultima rodada, planilhas com erro e os avisos recentes. */
export async function situacaoDaSequencia(db: D1Database) {
  const estado = await db.prepare('SELECT chave, valor FROM sequencia_estado').all<{ chave: string; valor: string }>();
  const de = (k: string) => estado.results.find((e) => e.chave === k)?.valor ?? '';
  let ultima: unknown = null;
  try { ultima = JSON.parse(de('ultima_rodada') || 'null'); } catch { /* fica null */ }

  const planilhas = await db
    .prepare(
      `SELECT id, cliente, doc, aba, numerar, notificar, ordenar, ativo, erro, erro_desde, erros_seguidos, formato_em
       FROM sequencia_planilhas ORDER BY posicao, id`,
    )
    .all();
  const porEstado = await db
    .prepare(`SELECT estado, COUNT(*) AS total FROM sequencia_avisos WHERE criado_em > datetime('now', '-7 day') GROUP BY estado`)
    .all<{ estado: string; total: number }>();
  const recentes = await db
    .prepare(
      `SELECT a.id, p.cliente, a.sequencia, a.estado, a.tentativas, a.criado_em
       FROM sequencia_avisos a JOIN sequencia_planilhas p ON p.id = a.planilha_id
       ORDER BY a.id DESC LIMIT 40`,
    )
    .all();
  return {
    modo: MODOS.includes(de('modo') as Modo) ? de('modo') : 'desligado',
    ultima_rodada: ultima,
    planilhas: planilhas.results,
    avisos_7_dias: Object.fromEntries(porEstado.results.map((r) => [r.estado, r.total])),
    recentes: recentes.results,
  };
}

/**
 * Confere, planilha por planilha, se o CRM consegue abrir a aba e se as colunas
 * estao la'. E' o `verificar()` do Apps Script. Duas leituras por planilha.
 */
export async function verificarPlanilhas(env: Env) {
  const { results } = await env.DB
    .prepare('SELECT * FROM sequencia_planilhas WHERE ativo = 1 ORDER BY posicao, id')
    .all<Planilha>();
  const sheets = new SheetsClient(env);
  const saida: Array<Record<string, unknown>> = [];
  for (const p of results) {
    const base = { cliente: p.cliente, aba: p.aba, numerar: !!p.numerar, notificar: !!p.notificar, ordenar: !!p.ordenar };
    try {
      const aba = await acharAba(env, sheets, p.doc, p.aba);
      const { cData, cHora, cSeq } = acharColunas(await sheets.cabecalho(p.doc, aba.titulo));
      const falta = [cData < 0 ? 'DATA' : '', p.numerar && cSeq < 0 ? 'SEQUENCIA' : ''].filter(Boolean);
      saida.push({ ...base, ok: !falta.length, planilha: aba.planilha, colunas: { DATA: cData, HORA: cHora, SEQUENCIA: cSeq }, ...(falta.length ? { erro: `sem a coluna ${falta.join(' e ')}` } : {}) });
    } catch (e) {
      saida.push({ ...base, ok: false, erro: String((e as Error).message).slice(0, 300) });
    }
  }
  return saida;
}
