#!/usr/bin/env node
/**
 * Espelha a etapa de cada card do Kanban na coluna Status da aba Geral.
 *
 * Mesma regra do Worker (src/pipelines/etapaPlanilha.ts), rodando da maquina
 * com as credenciais do .env — para os cards que ja' estao no Kanban antes de o
 * Worker ganhar a regra do Chatwoot. Depois disso o Worker cuida sozinho.
 *
 * Uso:
 *   node scripts/espelhar-status-geral.mjs --conta 2 --board 7 --doc 1KMnw... --aba Geral
 *   node scripts/espelhar-status-geral.mjs ... --gravar        (sem isto so' mostra)
 *
 * .env: CHATWOOT_DOMAIN, CHATWOOT_TOKEN_ACCESS, CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN
 */
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]),
);

const arg = (nome, padrao) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : padrao;
};
const conta = arg('conta');
const board = Number(arg('board'));
const doc = arg('doc');
const aba = arg('aba', 'Geral');
const gravar = process.argv.includes('--gravar');
// board Organico: so' preenche Status vazio, o "Agendou" do time vale mais que "Orgânico"
const soVazias = process.argv.includes('--so-vazias');
if (!conta || !board || !doc) {
  console.error('faltou --conta, --board ou --doc');
  process.exit(1);
}

const cwBase = /^https?:/.test(env.CHATWOOT_DOMAIN) ? env.CHATWOOT_DOMAIN : `https://${env.CHATWOOT_DOMAIN}`;
const cw = async (caminho) => {
  const r = await fetch(`${cwBase}/api/v1/accounts/${conta}${caminho}`, {
    headers: { api_access_token: env.CHATWOOT_TOKEN_ACCESS, accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`Chatwoot ${caminho} -> ${r.status}`);
  return r.json();
};

// --- mesma chave do phoneKey do Worker: DDD + 8 ultimos digitos ---
const phoneKey = (raw) => {
  let x = String(raw ?? '').replace(/\D/g, '');
  if (x.startsWith('55') && x.length >= 12) x = x.slice(2);
  return x.length < 10 ? '' : x.slice(0, 2) + x.slice(-8);
};
const normalizar = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const colunaTelefone = (h) => ['telefone', 'link do whatsapp', 'url whatsapp', 'whatsapp'].includes(normalizar(h));
const letra = (i) => {
  let n = i + 1, s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

// --- Google: token pelo consentimento OAuth do .env ---
async function tokenGoogle() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.CLIENT_ID, client_secret: env.CLIENT_SECRET,
      refresh_token: env.REFRESH_TOKEN, grant_type: 'refresh_token',
    }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`token do Google: ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token;
}

async function main() {
  const { steps } = await cw(`/kanban/boards/${board}/steps`);
  const nomeDaEtapa = new Map(steps.map((s) => [s.id, s.name]));

  const cards = [];
  for (let page = 1; page <= 20; page++) {
    const r = await cw(`/kanban/tasks?board_id=${board}&page=${page}&per_page=100`);
    cards.push(...(r.tasks ?? []));
    if (!r.meta?.has_more) break;
  }

  const tok = await tokenGoogle();
  const faixa = encodeURIComponent(`'${aba.replace(/'/g, "''")}'!A:ZZ`);
  const lidas = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${doc}/values/${faixa}`, {
    headers: { authorization: `Bearer ${tok}` },
  })).json();
  const linhas = (lidas.values ?? []).map((l) => l.map(String));
  const cab = linhas[0] ?? [];
  let iStatus = cab.findIndex((h) => normalizar(h) === 'status');
  if (iStatus < 0 && process.argv.includes('--criar-status')) {
    // a coluna nasce no fim do cabecalho, para nao deslocar o que o time ja usa
    iStatus = cab.length;
    const celula = `'${aba.replace(/'/g, "''")}'!${letra(iStatus)}1`;
    if (gravar) {
      // a grade da aba pode acabar antes da coluna nova: amplia antes de escrever
      const meta = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${doc}?fields=sheets.properties(sheetId,title,gridProperties(columnCount))`, {
        headers: { authorization: `Bearer ${tok}` },
      })).json();
      const sh = (meta.sheets ?? []).map((s) => s.properties).find((p) => p.title === aba);
      if (sh && sh.gridProperties.columnCount <= iStatus) {
        const g = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${doc}:batchUpdate`, {
          method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
          body: JSON.stringify({ requests: [{ appendDimension: { sheetId: sh.sheetId, dimension: 'COLUMNS', length: iStatus + 1 - sh.gridProperties.columnCount } }] }),
        });
        if (!g.ok) throw new Error(`Sheets ${g.status} ao ampliar a grade da aba "${aba}"`);
      }
      const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${doc}/values/${encodeURIComponent(celula)}?valueInputOption=RAW`, {
        method: 'PUT', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
        body: JSON.stringify({ values: [['Status']] }),
      });
      if (!r.ok) throw new Error(`Sheets ${r.status} ao criar a coluna Status`);
    }
    console.log(`coluna Status criada em ${celula}${gravar ? '' : ' (simulado)'}`);
    cab.push('Status');
  }
  if (iStatus < 0) throw new Error(`a aba "${aba}" nao tem a coluna Status (use --criar-status)`);
  const colFone = cab.map((h, i) => (colunaTelefone(h) ? i : -1)).filter((i) => i >= 0);
  const corpo = linhas.slice(1);

  const celulas = [];
  for (const t of cards) {
    const etapa = (nomeDaEtapa.get(t.board_step_id) ?? t.board_step?.name ?? '').trim();
    const nome = t.contacts?.[0]?.name || t.title;
    let telefone = t.contacts?.[0]?.phone_number || '';
    if (!telefone && t.conversations?.[0]?.display_id) {
      const c = await cw(`/conversations/${t.conversations[0].display_id}`).catch(() => null);
      telefone = c?.meta?.sender?.phone_number ?? c?.payload?.meta?.sender?.phone_number ?? '';
    }
    const alvo = phoneKey(telefone);
    if (!etapa || !alvo) { console.log(`- card ${t.id} (${nome}): ${etapa ? 'sem telefone' : 'sem etapa'}`); continue; }
    const i = corpo.findIndex((l) => colFone.some((c) => phoneKey(l[c]) === alvo));
    if (i < 0) { console.log(`- card ${t.id} (${nome}): telefone nao esta na aba "${aba}"`); continue; }
    const antes = String(corpo[i][iStatus] ?? '').trim();
    if (antes === etapa) { console.log(`= card ${t.id} (${nome}): linha ${i + 2} ja esta "${etapa}"`); continue; }
    if (soVazias && antes) { console.log(`= card ${t.id} (${nome}): linha ${i + 2} ja tem "${antes}", nao sobrescreve`); continue; }
    celulas.push({ range: `'${aba.replace(/'/g, "''")}'!${letra(iStatus)}${i + 2}`, values: [[etapa]] });
    console.log(`+ card ${t.id} (${nome}): linha ${i + 2} "${antes}" -> "${etapa}"`);
  }

  console.log(`\ncards: ${cards.length} · celulas a gravar: ${celulas.length}${gravar ? '' : ' (sem --gravar: nada foi escrito)'}`);
  if (!gravar || !celulas.length) return;

  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${doc}/values:batchUpdate`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'RAW', data: celulas }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Sheets ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  console.log(`gravadas: ${j.totalUpdatedCells} celulas`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
