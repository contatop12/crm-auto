import { normFone, phoneKey } from './phone';
import { normEmail } from './email';

/**
 * Leitura das abas `Cliques` que hoje servem de banco de dados no Google Sheets.
 *
 * Cada cliente tem a sua planilha e nenhuma tem o mesmo cabecalho: a Persianas
 * carrega colunas de quiz, a Vita carrega `ip_address`, a Locadora repete
 * `descartar,motivo,origem,form_id` duas vezes e `valido,event` outras duas, a
 * Taina repete `valido`. Colunas foram sendo empilhadas a direita conforme o
 * fluxo mudava, e as antigas ficaram.
 *
 * Por isso a leitura e' por NOME de coluna, tolerante a repeticao: entre duas
 * colunas de mesmo nome vale a primeira preenchida. Coluna que nao existe some
 * sem reclamar — nenhuma planilha tem todas.
 */

export interface Clique {
  protocol: string;
  nome: string | null;
  email: string | null;
  phoneRaw: string | null;
  phoneE164: string | null;
  phoneKey: string | null;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmId: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  fbp: string | null;
  fbc: string | null;
  clientId: string | null;
  origem: string | null;
  evento: string | null;
  pageUrl: string | null;
  whatsappUrl: string | null;
  referrer: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  quizVersion: string | null;
  quizValor: number | null;
  quizFormId: string | null;
  valorProposta: number | null;
  createdAt: string | null;
}

export interface ResultadoImport {
  linhas: Clique[];
  /** O que foi descartado e por que — a planilha nunca vem limpa. */
  semProtocolo: number;
  duplicados: number;
  macrosNulados: number;
  /** Linhas `ORG-` : lead organico registrado na aba, sem clique nenhum. */
  organicos: number;
  /** Data que nao casou com nenhum dos dois formatos da coluna. */
  semData: number;
  colunasIgnoradas: string[];
}

/** Colunas que o schema conhece. O resto e' relatado, nao gravado em silencio. */
const CONHECIDAS = new Set([
  'protocol', 'phone_number', 'lead_name', 'email', 'status', 'gclid', 'gbraid', 'wbraid',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_id', 'utm_term', 'utm_content',
  'page_url', 'whatsapp_url', 'fbp', 'fbc', 'user_agent', 'client_id', 'created_at',
  'referrer', 'valido', 'origem', 'event', 'valor_proposta', 'quiz_version', 'quiz_valor',
  'form_id', 'ip_address', 'campanha_nome', 'campanha_tipo', 'descartar', 'motivo',
]);

/**
 * Macro do GTM que nunca foi resolvida: `{campaignname}`, `{adgroupname}`.
 *
 * Chegou assim porque o modelo de URL do anuncio nao foi preenchido. Guardar o
 * literal poluiria qualquer relatorio por campanha com um nome que nao existe.
 */
const MACRO = /^\{[^}]*\}$/;

export function lerCliques(csv: string): ResultadoImport {
  const tabela = parseCsv(csv);
  if (!tabela.length) {
    return { linhas: [], semProtocolo: 0, duplicados: 0, macrosNulados: 0, organicos: 0, semData: 0, colunasIgnoradas: [] };
  }

  const cabecalho = tabela[0]!.map((c) => c.trim().toLowerCase());
  const colunasIgnoradas = [...new Set(cabecalho.filter((c) => c && !CONHECIDAS.has(c)))];

  const linhas: Clique[] = [];
  const vistos = new Set<string>();
  let semProtocolo = 0;
  let duplicados = 0;
  let macrosNulados = 0;
  let organicos = 0;
  let semData = 0;

  /** Entre colunas de mesmo nome, vale a primeira preenchida. */
  const ler = (linha: string[], nome: string): string | null => {
    for (let i = 0; i < cabecalho.length; i++) {
      if (cabecalho[i] !== nome) continue;
      const v = (linha[i] ?? '').trim();
      if (v) return v;
    }
    return null;
  };

  for (let n = 1; n < tabela.length; n++) {
    const linha = tabela[n]!;
    const protocol = ler(linha, 'protocol');
    if (!protocol) { semProtocolo++; continue; }
    // `ORG-<id>` nao e' clique: e' o lead organico que o fluxo registrava na
    // mesma aba. Vem sem gclid, sem utm, sem page_url e sem data. Importar como
    // clique criaria atribuicao de anuncio onde nao houve anuncio.
    if (/^ORG-/i.test(protocol)) { organicos++; continue; }
    if (vistos.has(protocol)) { duplicados++; continue; }
    vistos.add(protocol);

    const createdAt = parseData(ler(linha, 'created_at'));
    if (!createdAt) semData++;

    const semMacro = (nome: string): string | null => {
      const v = ler(linha, nome);
      if (v && MACRO.test(v)) { macrosNulados++; return null; }
      return v;
    };

    const fone = ler(linha, 'phone_number');
    const e164 = normFone(fone) || null;
    const email = normEmail(ler(linha, 'email')) || null;

    linhas.push({
      protocol,
      nome: ler(linha, 'lead_name'),
      email,
      phoneRaw: fone,
      phoneE164: e164,
      phoneKey: phoneKey(fone) || null,
      gclid: ler(linha, 'gclid'),
      gbraid: ler(linha, 'gbraid'),
      wbraid: ler(linha, 'wbraid'),
      utmSource: semMacro('utm_source'),
      utmMedium: semMacro('utm_medium'),
      utmCampaign: semMacro('utm_campaign'),
      utmId: ler(linha, 'utm_id'),
      utmTerm: semMacro('utm_term'),
      utmContent: semMacro('utm_content'),
      fbp: ler(linha, 'fbp'),
      fbc: ler(linha, 'fbc'),
      clientId: ler(linha, 'client_id'),
      origem: ler(linha, 'origem'),
      evento: ler(linha, 'event'),
      pageUrl: ler(linha, 'page_url'),
      whatsappUrl: ler(linha, 'whatsapp_url'),
      referrer: ler(linha, 'referrer'),
      userAgent: ler(linha, 'user_agent'),
      ipAddress: ler(linha, 'ip_address'),
      quizVersion: ler(linha, 'quiz_version'),
      quizValor: inteiro(ler(linha, 'quiz_valor')),
      quizFormId: ler(linha, 'form_id'),
      valorProposta: decimal(ler(linha, 'valor_proposta')),
      createdAt,
    });
  }

  return { linhas, semProtocolo, duplicados, macrosNulados, organicos, semData, colunasIgnoradas };
}

/**
 * A coluna `created_at` traz DOIS formatos misturados.
 *
 * O coletor grava ISO (`2026-08-05T12:09:30.970Z`); o que passou pela mao no
 * Sheets virou `13/08/2026 11:47:03`. Sao 227 das 365 linhas no formato
 * brasileiro — `new Date()` devolve Invalid Date para todas elas.
 *
 * Dia primeiro, sempre: `13/08` so' existe como 13 de agosto. Ler como mes/dia
 * jogaria o clique meses para frente e a janela de 90 dias casaria o lead com a
 * pessoa errada.
 *
 * Devolve o formato do `datetime('now')` do SQLite, que e' como as janelas
 * comparam.
 */
export function parseData(v: string | null): string | null {
  if (!v) return null;
  const t = v.trim();
  if (!t) return null;

  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
  if (br) {
    const [, d, m, a, h = '0', min = '0', seg = '0'] = br;
    const dia = Number(d), mes = Number(m);
    if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;
    const dt = new Date(Date.UTC(Number(a), mes - 1, dia, Number(h), Number(min), Number(seg)));
    // 31/02 rola para marco: data que nao existe nao vira data
    if (dt.getUTCDate() !== dia || dt.getUTCMonth() !== mes - 1) return null;
    return dt.toISOString().slice(0, 19).replace('T', ' ');
  }

  const iso = new Date(t);
  return Number.isNaN(iso.getTime()) ? null : iso.toISOString().slice(0, 19).replace('T', ' ');
}

/** `1.234,56` e `1234.56` chegam na mesma coluna dependendo da planilha. */
function decimal(v: string | null): number | null {
  if (!v) return null;
  const limpo = v.replace(/[^\d,.-]/g, '');
  if (!limpo) return null;
  // virgula depois do ultimo ponto = separador decimal brasileiro
  const br = limpo.lastIndexOf(',') > limpo.lastIndexOf('.');
  const n = Number(br ? limpo.replace(/\./g, '').replace(',', '.') : limpo.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function inteiro(v: string | null): number | null {
  const n = decimal(v);
  return n === null ? null : Math.trunc(n);
}

/**
 * CSV com aspas e quebra de linha dentro do campo.
 *
 * `split(',')` nao serve: o `user_agent` tem virgula e a `page_url` tem aspas
 * escapadas. Sao 500 linhas no total, entao um leitor proprio de 30 linhas sai
 * mais barato que uma dependencia.
 */
export function parseCsv(texto: string): string[][] {
  const t = texto.replace(/^﻿/, '');
  const linhas: string[][] = [];
  let campo = '';
  let linha: string[] = [];
  let aspas = false;

  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (aspas) {
      if (c === '"') {
        if (t[i + 1] === '"') { campo += '"'; i++; } else aspas = false;
      } else campo += c;
      continue;
    }
    if (c === '"') { aspas = true; continue; }
    if (c === ',') { linha.push(campo); campo = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; continue; }
    campo += c;
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }

  // linha totalmente vazia no fim da planilha nao e' registro
  return linhas.filter((l) => l.some((c) => c.trim() !== ''));
}
