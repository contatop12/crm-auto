import type { Env } from '../env';
import { SheetsClient } from '../clients/sheets';

/**
 * Backup diario das planilhas de leads que o motor de sequencia altera
 * (`sequencia_planilhas` ativas). Fica FORA do sistema alterado: R2, bucket
 * `crm-auto-backups`, com regra de ciclo de vida de 30 dias (tem nome e telefone).
 *
 * Cada aba e' lida duas vezes: o texto como aparece (`formatado`) e a formula /
 * numero de serie por baixo (`bruto`). Um objeto gzip por planilha:
 * `planilhas/AAAA-MM-DD/<id>-<cliente>.json.gz`.
 *
 * Roda no cron de minuto, em paralelo com a sequencia. Para nao estourar o teto de
 * chamadas externas de uma execucao nem a cota de leitura do Google (dividida com o
 * proprio CRM), cada execucao faz um LOTE de planilhas, com pausa entre leituras; as
 * seguintes continuam de onde parou. Estado em `sequencia_estado.backup_planilhas`.
 */

const CHAVE_ESTADO = 'backup_planilhas';
const CHAVE_TRAVA = 'backup_trava';
/** Nao comeca antes de 01:00 em Sao Paulo: longe do pico de leads da madrugada de virada. */
const HORA_MINIMA_SP = 1;
/** Pausa entre leituras do Sheets. */
export const ESPERA_ENTRE_LEITURAS_MS = 4000;
/** Planilhas por execucao (o teto de chamadas e' dividido com a sequencia; 2 leituras + 1 gravacao cada, bem abaixo do teto de chamadas). */
const LOTE = 3;
/** Depois de uma falha, a mesma planilha so' e' tentada de novo apos este tempo. */
export const ESPERA_APOS_FALHA_MS = 30 * 60_000;
/** Tentativas por planilha no dia; depois disso o dia fecha com o erro registrado. */
const MAX_TENTATIVAS = 4;
const TRAVA_MS = 5 * 60_000;
const SP_OFFSET_MS = 3 * 3600_000; // sem horario de verao desde 2019

export interface EstadoBackup {
  dia: string;
  /** ISO do fim do dia de backup (ou da ultima rodada, enquanto incompleto). */
  em: string;
  ultima_tentativa: string;
  concluido: boolean;
  /** ids de `sequencia_planilhas` ja' gravados hoje */
  feitas: number[];
  arquivos: number;
  bytes: number;
  erros: Record<string, { msg: string; tentativas: number }>;
}

interface Planilha { id: number; doc: string; aba: string; cliente: string }

/** O relogio de Sao Paulo (UTC-3) lido como se fosse UTC. */
const relogioSP = (agora: Date) => new Date(agora.getTime() - SP_OFFSET_MS);

/** `AAAA-MM-DD` em Sao Paulo. */
export function diaSP(agora: Date): string {
  return relogioSP(agora).toISOString().slice(0, 10);
}

export function slug(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'planilha';
}

export function chaveDoObjeto(dia: string, id: number, cliente: string): string {
  return `planilhas/${dia}/${id}-${slug(cliente)}.json.gz`;
}

export async function gzip(texto: string): Promise<Uint8Array> {
  const fluxo = new Blob([texto]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(fluxo).arrayBuffer());
}

export async function gunzip(dados: Uint8Array): Promise<string> {
  const fluxo = new Blob([dados]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(fluxo).text();
}

export async function lerEstado(db: D1Database): Promise<EstadoBackup | null> {
  const r = await db.prepare('SELECT valor FROM sequencia_estado WHERE chave = ?').bind(CHAVE_ESTADO).first<{ valor: string }>();
  if (!r?.valor) return null;
  try {
    return JSON.parse(r.valor) as EstadoBackup;
  } catch {
    return null;
  }
}

async function gravarEstado(db: D1Database, e: EstadoBackup): Promise<void> {
  await db
    .prepare('INSERT OR REPLACE INTO sequencia_estado (chave, valor) VALUES (?, ?)')
    .bind(CHAVE_ESTADO, JSON.stringify(e))
    .run();
}

async function pegarTrava(db: D1Database, agora: Date): Promise<string | null> {
  await db.prepare(`INSERT OR IGNORE INTO sequencia_estado (chave, valor) VALUES (?, '')`).bind(CHAVE_TRAVA).run();
  const ate = new Date(agora.getTime() + TRAVA_MS).toISOString();
  const r = await db
    .prepare('UPDATE sequencia_estado SET valor = ? WHERE chave = ? AND valor < ?')
    .bind(ate, CHAVE_TRAVA, agora.toISOString())
    .run();
  return r.meta.changes ? ate : null;
}

async function soltarTrava(db: D1Database, ate: string): Promise<void> {
  await db.prepare(`UPDATE sequencia_estado SET valor = '' WHERE chave = ? AND valor = ?`).bind(CHAVE_TRAVA, ate).run();
}

/** Estado do dia, do zero se o dia virou. */
function estadoDoDia(atual: EstadoBackup | null, dia: string, agora: Date): EstadoBackup {
  if (atual && atual.dia === dia) return atual;
  return { dia, em: agora.toISOString(), ultima_tentativa: '', concluido: false, feitas: [], arquivos: 0, bytes: 0, erros: {} };
}

/** As planilhas que ainda faltam hoje e podem ser tentadas agora. */
function pendentes(todas: Planilha[], e: EstadoBackup, agora: Date): Planilha[] {
  return todas
    .filter((p) => !e.feitas.includes(p.id))
    .filter((p) => {
      const f = e.erros[String(p.id)];
      if (!f) return true;
      if (f.tentativas >= MAX_TENTATIVAS) return false;
      return !e.ultima_tentativa || agora.getTime() - new Date(e.ultima_tentativa).getTime() >= ESPERA_APOS_FALHA_MS;
    })
    // as nunca tentadas primeiro
    .sort((a, b) => Number(!!e.erros[String(a.id)]) - Number(!!e.erros[String(b.id)]));
}

export interface OpcoesBackup {
  /** Pausa entre leituras; os testes passam uma funcao que nao espera. */
  esperar?: (ms: number) => Promise<void>;
}

export interface ResultadoBackup {
  rodou: boolean;
  motivo?: string;
  estado?: EstadoBackup;
}

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Chamado todo minuto. Sai sem fazer nada quando o backup do dia ja' saiu, quando
 * ainda nao deu 01:00 em Sao Paulo, quando so' restam falhas ainda dentro da espera de
 * 30 min, ou quando outra execucao esta' no meio.
 */
export async function rodarBackupPlanilhas(env: Env, agora: Date, op: OpcoesBackup = {}): Promise<ResultadoBackup> {
  const esperar = op.esperar ?? dormir;
  const dia = diaSP(agora);
  if (relogioSP(agora).getUTCHours() < HORA_MINIMA_SP) return { rodou: false, motivo: 'antes de 01:00' };

  const atual = await lerEstado(env.DB);
  if (atual?.dia === dia && atual.concluido) return { rodou: false, motivo: 'ja saiu hoje' };

  const trava = await pegarTrava(env.DB, agora);
  if (!trava) return { rodou: false, motivo: 'outra execucao em curso' };
  try {
    // relido depois da trava: a execucao anterior pode ter acabado de gravar
    const estado = estadoDoDia(await lerEstado(env.DB), dia, agora);
    if (estado.concluido) return { rodou: false, motivo: 'ja saiu hoje' };

    const { results } = await env.DB
      .prepare('SELECT id, doc, aba, cliente FROM sequencia_planilhas WHERE ativo = 1 ORDER BY posicao, id')
      .all<Planilha>();
    const fila = pendentes(results, estado, agora);
    if (!fila.length) {
      // nada a tentar agora: ou acabou, ou so' restam falhas esperando
      const faltam = results.some((p) => !estado.feitas.includes(p.id) && (estado.erros[String(p.id)]?.tentativas ?? 0) < MAX_TENTATIVAS);
      if (faltam) return { rodou: false, motivo: 'esperando para tentar de novo', estado };
      estado.concluido = true;
      estado.em = agora.toISOString();
      await gravarEstado(env.DB, estado);
      return { rodou: false, motivo: 'fechado com erros', estado };
    }

    const sheets = new SheetsClient(env);
    let leituras = 0;
    estado.ultima_tentativa = agora.toISOString();
    for (const p of fila.slice(0, LOTE)) {
      try {
        if (leituras++) await esperar(ESPERA_ENTRE_LEITURAS_MS);
        const formatado = await sheets.abaBruta(p.doc, p.aba, 'formatado');
        await esperar(ESPERA_ENTRE_LEITURAS_MS);
        leituras++;
        const bruto = await sheets.abaBruta(p.doc, p.aba, 'formula');
        const corpo = await gzip(
          JSON.stringify({ doc: p.doc, aba: p.aba, cliente: p.cliente, em: agora.toISOString(), formatado, bruto }),
        );
        await env.BACKUPS.put(chaveDoObjeto(dia, p.id, p.cliente), corpo, {
          httpMetadata: { contentType: 'application/gzip' },
        });
        estado.feitas.push(p.id);
        estado.arquivos += 1;
        estado.bytes += corpo.byteLength;
        delete estado.erros[String(p.id)];
      } catch (e) {
        const anterior = estado.erros[String(p.id)];
        estado.erros[String(p.id)] = {
          msg: String((e as Error).message).slice(0, 200),
          tentativas: (anterior?.tentativas ?? 0) + 1,
        };
        console.log(JSON.stringify({ acao: 'backup_planilha_erro', planilha: p.cliente, erro: estado.erros[String(p.id)]!.msg }));
      }
    }
    estado.em = agora.toISOString();
    estado.concluido = results.every((p) => estado.feitas.includes(p.id));
    await gravarEstado(env.DB, estado);
    if (estado.concluido) {
      console.log(JSON.stringify({ acao: 'backup_planilhas_ok', dia, arquivos: estado.arquivos, bytes: estado.bytes }));
    }
    return { rodou: true, estado };
  } finally {
    await soltarTrava(env.DB, trava).catch(() => undefined);
  }
}
