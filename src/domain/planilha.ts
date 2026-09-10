/**
 * Para onde cada dado vai, na planilha geral de leads.
 *
 * A coluna é escolhida por quem opera. Cada cliente já tem a planilha dele, com
 * as colunas na ordem que o time acostumou — impor uma ordem nossa obrigaria a
 * refazer a planilha ou a conviver com colunas trocadas.
 */

export interface Coluna {
  coluna: string;
  campo: string;
}

export type Mapa = Coluna[];

/** O que dá para mandar, e como isso se chama na tela. */
export const CAMPOS_PLANILHA: Array<{ campo: string; rotulo: string }> = [
  { campo: 'timestamp', rotulo: 'Data e hora (junto)' },
  { campo: 'data', rotulo: 'Data' },
  { campo: 'hora', rotulo: 'Hora' },
  { campo: 'canal', rotulo: 'Canal do anúncio' },
  { campo: 'plataforma', rotulo: 'Plataforma (google / meta)' },
  { campo: 'campanha', rotulo: 'Campanha' },
  { campo: 'protocolo', rotulo: 'Protocolo' },
  { campo: 'nome', rotulo: 'Nome do lead' },
  { campo: 'telefone', rotulo: 'Telefone' },
  { campo: 'email', rotulo: 'E-mail' },
  { campo: 'etapa', rotulo: 'Etapa do funil' },
  { campo: 'conversao', rotulo: 'Conversão enviada' },
  { campo: 'valor', rotulo: 'Valor' },
  { campo: 'gclid', rotulo: 'GCLID' },
  { campo: 'utm_source', rotulo: 'utm_source' },
  { campo: 'utm_medium', rotulo: 'utm_medium' },
  { campo: 'utm_term', rotulo: 'utm_term' },
  { campo: 'cliente', rotulo: 'Cliente' },
];

/**
 * `'A'` → 0, `'Z'` → 25, `'AA'` → 26.
 *
 * Devolve -1 para o que não é coluna. Cair em 0 seria pior que recusar: a linha
 * seria escrita com o dado errado no primeiro campo, sem erro nenhum aparecer.
 */
export function colunaParaIndice(letra: string): number {
  const s = (letra ?? '').trim().toUpperCase();
  if (!s || !/^[A-Z]+$/.test(s)) return -1;

  let n = 0;
  for (const c of s) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * A linha pronta para o Sheets, na ordem das colunas.
 *
 * Coluna pulada vira célula vazia em vez de encolher a linha: sem isso o dado
 * da coluna D apareceria na B, e ninguém perceberia — a planilha continuaria
 * parecendo certa.
 */
export function montarLinha(mapa: Mapa, dados: Record<string, unknown>): string[] {
  const posicoes = mapa
    .map((c) => ({ i: colunaParaIndice(c.coluna), campo: c.campo }))
    .filter((c) => c.i >= 0);

  if (!posicoes.length) return [];

  const largura = Math.max(...posicoes.map((c) => c.i)) + 1;
  const linha = new Array<string>(largura).fill('');

  for (const { i, campo } of posicoes) {
    const v = dados[campo];
    // `null` e `undefined` viram vazio: a palavra "null" escrita na planilha
    // seria lida como dado por quem abre
    linha[i] = v === null || v === undefined ? '' : String(v);
  }
  return linha;
}

/**
 * O id do documento, dado o que a pessoa colou.
 *
 * Pedir "o trecho entre /d/ e /edit" e' pedir para alguem editar uma URL a mao
 * antes de colar. Aceitar a URL inteira custa uma linha e evita o erro mais
 * provavel deste campo.
 */
export function idDaPlanilha(entrada: string | null | undefined): string | null {
  const v = (entrada ?? '').trim();
  if (!v) return null;

  const naUrl = v.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (naUrl) return naUrl[1]!;

  // ja' e' o id: os do Sheets sao longos e nao tem barra nem espaco
  if (/^[a-zA-Z0-9_-]{20,}$/.test(v)) return v;
  return null;
}

/** 0 → `'A'`, 26 → `'AA'`. O caminho de volta de `colunaParaIndice`. */
export function indiceParaColuna(i: number): string {
  if (!Number.isInteger(i) || i < 0) return '';
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
