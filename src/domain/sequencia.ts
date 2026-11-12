/**
 * Numeracao (coluna SEQUENCIA) e ordenacao da aba de leads de cada cliente.
 *
 * Era o Apps Script "Sequencia Leads - Todos os Clientes" (Sequencia.gs e
 * Ordenacao.gs). Aqui fica so' a conta: o que numerar e o que mover, a partir do
 * que a aba mostra. Quem le' e grava e' `pipelines/sequencia.ts`.
 *
 * Tres diferencas de proposito em relacao ao script:
 *  - grava so' as celulas que mudam, em vez de regravar a coluna inteira;
 *  - ordena MOVENDO linhas (moveDimension), nao copiando valores. A linha anda
 *    inteira, com formato e validacao, e nada e' escrito por cima de nada: uma
 *    aba que mudou entre a leitura e a gravacao fica, no pior caso, com a ordem
 *    errada ate' a rodada seguinte. Com o `setValues` do script, a mesma corrida
 *    apagava lead (Vera e Nilce, Vita, 07/10/2026);
 *  - le' a hora como hora ("9:05:00" e' 09:05, nao "905000").
 */

export const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

/** Linha numerada com DATA de ate' N dias avisa o grupo; mais antiga e' historico. */
export const DIAS_NOTIFICAR = 7;

/** Teto de linhas movidas por rodada. O que sobrar anda na rodada seguinte. */
export const MAX_MOVIMENTOS = 200;

export interface CfgSequencia {
  /** Se preenchido, o formato vira PREFIXO + MES + NN em vez de NN + MES. */
  prefixo: string;
  /** false = a linha e' numerada mas nao vira aviso. */
  notificar: boolean;
}

/** Compara cabecalho ignorando acento, caixa e espaco: "Sequência" == "SEQUENCIA". */
export function chaveCab(h: unknown): string {
  return String(h ?? '').trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function montarSeq(prefixo: string, n: number, mesNum: number): string {
  const mes = MESES[mesNum - 1];
  const num = String(n).padStart(2, '0');
  return prefixo ? prefixo + mes + num : num + mes;
}

const escaparRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** O numero dentro de uma sequencia ja' escrita; null se o texto nao e' sequencia. */
export function numeroDe(prefixo: string, v: unknown): number | null {
  const t = String(v ?? '').trim().toUpperCase();
  if (!t) return null;
  if (prefixo) {
    const m = new RegExp(`^${escaparRegex(prefixo.toUpperCase())}[A-Z]{3}(\\d+)$`).exec(t);
    return m ? parseInt(m[1]!, 10) : null;
  }
  const m = /^(\d{1,3})[A-Z]{3}$/.exec(t);
  return m ? parseInt(m[1]!, 10) : null;
}

/** Conserta "22 de ago." que o Sheets converteu em data: vira "22AGO". */
export function normSeq(prefixo: string, v: unknown): string {
  const t = String(v ?? '').trim();
  if (!t) return '';
  if (prefixo) return t.toUpperCase().replace(/\.$/, '');
  const m = /^(\d{1,3})\s*(?:de\s*)?([A-Za-zçÇ]{3,})\.?$/.exec(t);
  if (m) return String(parseInt(m[1]!, 10)).padStart(2, '0') + m[2]!.substring(0, 3).toUpperCase();
  return t.toUpperCase().replace(/\.$/, '');
}

/** DATA como a aba mostra (dd/mm/aaaa ou dd/mm/aa). null = nao e' data. */
export function lerData(v: unknown): { ano: string; mes: string; dia: string; mesNum: number } | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?!\d)/.exec(String(v ?? '').trim());
  if (!m) return null;
  const dia = parseInt(m[1]!, 10);
  const mesNum = parseInt(m[2]!, 10);
  const ano = m[3]!;
  if (mesNum < 1 || mesNum > 12 || dia < 1 || dia > 31) return null;
  return {
    ano: ano.length === 2 ? `20${ano}` : ano,
    mes: String(mesNum).padStart(2, '0'),
    dia: String(dia).padStart(2, '0'),
    mesNum,
  };
}

/** HORA como a aba mostra, em HHMMSS. Sem hora legivel, "000000". */
export function lerHora(v: unknown): string {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(v ?? '').trim());
  if (!m) return '000000';
  return m[1]!.padStart(2, '0') + m[2]! + (m[3] ?? '00');
}

/** aaaammddHHMMSS da linha; '' quando a DATA nao e' data (vai para o fim da aba). */
export function chaveDeOrdem(linha: readonly unknown[], cData: number, cHora: number): string {
  const d = lerData(linha[cData]);
  if (!d) return '';
  return d.ano + d.mes + d.dia + (cHora >= 0 ? lerHora(linha[cHora]) : '000000');
}

export interface Colunas {
  cData: number;
  cHora: number;
  cSeq: number;
}

export function acharColunas(cabecalho: readonly unknown[]): Colunas {
  const cab = cabecalho.map(chaveCab);
  return { cData: cab.indexOf('DATA'), cHora: cab.indexOf('HORA'), cSeq: cab.indexOf('SEQUENCIA') };
}

export interface LinhaNumerada {
  /** Linha da planilha, contando o cabecalho como 1. */
  linha: number;
  sequencia: string;
  /** DATA recente e `notificar` ligado. */
  avisar: boolean;
  /** Cabecalho -> o que a celula mostra, com a SEQUENCIA nova. */
  dados: Record<string, string>;
}

export interface PlanoNumeracao {
  cSeq: number;
  /** Tudo que precisa ser escrito na coluna SEQUENCIA: numero novo e texto consertado. */
  celulas: Array<{ linha: number; valor: string }>;
  novas: LinhaNumerada[];
}

/**
 * O que numerar numa aba. `linhas` e' a aba inteira como o Sheets mostra, com o
 * cabecalho na posicao 0. `desde` (aaaammdd) e' o corte dos avisos.
 *
 * A numeracao continua do maior numero ja' usado no mes da DATA da linha, e as
 * linhas vazias sao numeradas da mais antiga para a mais nova. Buraco na
 * numeracao nao e' fechado: renumerar desencontraria do que o grupo ja' recebeu.
 */
export function planejarNumeracao(
  cfg: CfgSequencia,
  linhas: readonly (readonly unknown[])[],
  desde: string,
): PlanoNumeracao | { motivo: string } {
  const cabecalho = linhas[0] ?? [];
  const { cData, cHora, cSeq } = acharColunas(cabecalho);
  if (cData < 0) return { motivo: 'sem a coluna DATA' };
  if (cSeq < 0) return { motivo: 'sem a coluna SEQUENCIA' };

  const celulas: PlanoNumeracao['celulas'] = [];
  const maxMes = new Map<string, number>();
  const vazias: Array<{ i: number; mes: string; mesNum: number; k: string }> = [];

  for (let i = 1; i < linhas.length; i++) {
    const r = linhas[i]!;
    const antes = String(r[cSeq] ?? '');
    const depois = normSeq(cfg.prefixo, antes);
    if (antes.trim() !== depois) celulas.push({ linha: i + 1, valor: depois });

    const d = lerData(r[cData]);
    if (!d) continue;
    const mes = d.ano + d.mes;
    if (depois) {
      const n = numeroDe(cfg.prefixo, depois);
      if (n !== null) maxMes.set(mes, Math.max(maxMes.get(mes) ?? 0, n));
    } else {
      vazias.push({ i, mes, mesNum: d.mesNum, k: chaveDeOrdem(r, cData, cHora) });
    }
  }

  // mais antiga primeiro; empate fica na ordem da aba
  vazias.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.i - b.i));

  const novas: LinhaNumerada[] = [];
  for (const v of vazias) {
    const n = (maxMes.get(v.mes) ?? 0) + 1;
    maxMes.set(v.mes, n);
    const sequencia = montarSeq(cfg.prefixo, n, v.mesNum);
    celulas.push({ linha: v.i + 1, valor: sequencia });

    const dados: Record<string, string> = {};
    cabecalho.forEach((h, c) => {
      const nome = String(h ?? '').trim();
      if (nome) dados[nome] = String(linhas[v.i]![c] ?? '');
    });
    dados.SEQUENCIA = sequencia;
    novas.push({
      linha: v.i + 1,
      sequencia,
      avisar: cfg.notificar && v.k.substring(0, 8) >= desde,
      dados,
    });
  }
  return { cSeq, celulas, novas };
}

/** Indices da maior subsequencia estritamente crescente de `v`. */
function maiorSubsequenciaCrescente(v: readonly number[]): Set<number> {
  const topo: number[] = []; // topo[k] = indice em `v` do menor fim de uma subsequencia de tamanho k+1
  const anterior = new Array<number>(v.length).fill(-1);
  for (let i = 0; i < v.length; i++) {
    let lo = 0;
    let hi = topo.length;
    while (lo < hi) {
      const meio = (lo + hi) >> 1;
      if (v[topo[meio]!]! < v[i]!) lo = meio + 1;
      else hi = meio;
    }
    if (lo > 0) anterior[i] = topo[lo - 1]!;
    topo[lo] = i;
  }
  const fica = new Set<number>();
  for (let i = topo.length ? topo[topo.length - 1]! : -1; i >= 0; i = anterior[i]!) fica.add(i);
  return fica;
}

export interface Movimento {
  /** Posicao da linha na hora do movimento (0 = primeira linha de dados). */
  de: number;
  /** Onde ela entra, nas coordenadas de antes de ela sair (como o moveDimension pede). */
  para: number;
}

/**
 * Os movimentos de linha que deixam a aba da mais nova para a mais antiga.
 *
 * `chaves[i]` e' a chave da i-esima linha de dados; '' vai para o fim. Empate
 * mantem a ordem atual. As linhas que ja' estao em ordem entre si ficam paradas
 * e so' as outras andam: lead novo no fim da aba e' um movimento so'.
 *
 * Os movimentos sao em sequencia: cada um ja' conta com os anteriores feitos.
 */
export function planejarMovimentos(chaves: readonly string[], limite = MAX_MOVIMENTOS): Movimento[] {
  const n = chaves.length;
  const desejada = chaves.map((_, i) => i).sort((a, b) => (chaves[a]! < chaves[b]! ? 1 : chaves[a]! > chaves[b]! ? -1 : a - b));
  const posto = new Array<number>(n);
  desejada.forEach((id, r) => { posto[id] = r; });

  const parada = maiorSubsequenciaCrescente(posto);
  if (parada.size === n) return [];

  const atual = chaves.map((_, i) => i);
  const movimentos: Movimento[] = [];
  for (let r = 0; r < n && movimentos.length < limite; r++) {
    const id = desejada[r]!;
    if (parada.has(id)) continue;
    const de = atual.indexOf(id);
    const para = r === 0 ? 0 : atual.indexOf(desejada[r - 1]!) + 1;
    if (de !== para) {
      movimentos.push({ de, para });
      atual.splice(de, 1);
      atual.splice(para > de ? para - 1 : para, 0, id);
    }
  }
  return movimentos;
}

/**
 * Colunas DATA/HORA que perderam o formato. A hora fica certa na celula (fracao
 * do dia), mas com formato de data a aba mostra "30/12/1899" e a ordem oscila
 * (Tile, Tainã, Martinelli, out-nov/2026). O conserto e' so' reaplicar o formato.
 */
export function formatosPerdidos(linhas: readonly (readonly unknown[])[]): { data: boolean; hora: boolean } {
  const { cData, cHora } = acharColunas(linhas[0] ?? []);
  let data = false;
  let hora = false;
  for (let i = 1; i < linhas.length; i++) {
    const r = linhas[i]!;
    if (cData >= 0 && /^\d{5}([.,]\d+)?$/.test(String(r[cData] ?? '').trim())) data = true;
    if (cHora >= 0) {
      const h = String(r[cHora] ?? '').trim();
      if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(h) || /^0[.,]\d+$/.test(h)) hora = true;
    }
  }
  return { data, hora };
}

/** Hoje menos `dias`, no fuso de Sao Paulo, em aaaammdd. */
export function corteDosAvisos(agora: Date, dias = DIAS_NOTIFICAR): string {
  const d = new Date(agora.getTime() - dias * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d).replace(/-/g, '');
}
