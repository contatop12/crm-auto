#!/usr/bin/env node
/**
 * Preenche a coluna ORIGEM da aba Geral: de que plataforma o lead veio
 * (google, facebook, instagram, meta, gpt, outro). Cria a coluna se nao houver.
 *
 * Mesma regra do Worker (src/domain/origemAnuncio.ts). Evidencia, nesta ordem:
 *   1. o clique no CRM (utm_source, gclid/gbraid/wbraid, fbc, referrer), pelo telefone;
 *   2. a aba Cliques do Banco de Dados do cliente (utm_source, gclid, referrer), pelo telefone;
 *   3. a propria linha: ORIGEM ja preenchida, ou um codigo de plataforma na coluna
 *      "Canal de Anuncio" / "Canal" (google, fb, ig, chatgpt.com...). O rotulo
 *      "Campanha de Mensagem - Google" NAO conta: o fluxo antigo escrevia isso em
 *      todo lead de WhatsApp, com ou sem anuncio.
 * Sem evidencia a celula fica vazia — como a ORIGEM da Locadora sempre foi.
 *
 * Uso:
 *   node scripts/classificar-origem.mjs --tenant 3 --doc <planilha de leads> --aba Geral [--banco <Banco de Dados>] [--gravar]
 * Le' o export do CRM em <scratch>/leads-crm.json quando --leads <arquivo> e' passado.
 */
import { readFileSync, existsSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]),
);
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const tenant = Number(arg('tenant'));
const doc = arg('doc');
const aba = arg('aba', 'Geral');
const banco = arg('banco', '');
const arquivoLeads = arg('leads', '');
const gravar = process.argv.includes('--gravar');
if (!tenant || !doc) { console.error('faltou --tenant ou --doc'); process.exit(1); }

const phoneKey = (raw) => {
  let x = String(raw ?? '').replace(/\D/g, '');
  if (x.startsWith('55') && x.length >= 12) x = x.slice(2);
  return x.length < 10 ? '' : x.slice(0, 2) + x.slice(-8);
};
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const letra = (i) => { let n = i + 1, s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

/** A plataforma pelos sinais do clique. '' = sem evidencia. */
function origemDoAnuncio(s) {
  const fonte = norm(s.utm_source);
  const ref = (() => { try { return new URL(String(s.referrer ?? '')).host.toLowerCase(); } catch { return ''; } })();
  if (/chatgpt|openai|\bgpt\b/.test(fonte) || /chatgpt\.com|openai\.com/.test(ref)) return 'gpt';
  if (s.gclid || s.gbraid || s.wbraid || /google|adwords|gads/.test(fonte)) return 'google';
  if (/instagram|^ig$/.test(fonte) || /instagram\.com/.test(ref)) return 'instagram';
  if (/facebook|^fb$/.test(fonte) || s.fbc || /facebook\.com|fb\.me/.test(ref)) return 'facebook';
  if (/^meta$/.test(fonte)) return 'meta';
  if (fonte) return 'outro';
  if (/google\./.test(ref)) return 'google';
  if (ref && !/^(www\.)?(persianaspaulista|locadoraexatidao|audicao\.vitaaudio|tileservicos|tainaaci)/.test(ref)) return 'outro';
  return '';
}

/** Codigo de plataforma escrito na propria linha (google, fb, ig, chatgpt.com). */
function codigoDaLinha(v) {
  const x = norm(v);
  if (!x) return '';
  if (/^(google|google_ads|adwords)$/.test(x)) return 'google';
  if (/^(fb|facebook)$/.test(x)) return 'facebook';
  if (/^(ig|instagram)$/.test(x)) return 'instagram';
  if (/^meta$/.test(x)) return 'meta';
  if (/chatgpt|gpt|openai/.test(x)) return 'gpt';
  if (/^(bing|tiktok|youtube|linkedin|outro)$/.test(x)) return 'outro';
  return '';
}

async function tokenGoogle() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.CLIENT_ID, client_secret: env.CLIENT_SECRET, refresh_token: env.REFRESH_TOKEN, grant_type: 'refresh_token' }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`token do Google: ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token;
}
const faixa = (a, f) => encodeURIComponent(`'${a.replace(/'/g, "''")}'!${f}`);

async function main() {
  const tok = await tokenGoogle();
  const ler = async (d, a) => {
    const j = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${d}/values/${faixa(a, 'A:AZ')}`, { headers: { authorization: `Bearer ${tok}` } })).json();
    if (j.error) throw new Error(`Sheets ${a}: ${j.error.message}`);
    return (j.values ?? []).map((l) => l.map(String));
  };

  // 1. cliques do CRM (export do D1), pelo telefone
  const doCrm = new Map();
  if (arquivoLeads && existsSync(arquivoLeads)) {
    for (const l of JSON.parse(readFileSync(arquivoLeads, 'utf8'))) {
      if (Number(l.tenant_id) !== tenant) continue;
      const o = origemDoAnuncio(l);
      if (o && !doCrm.has(l.phone_key)) doCrm.set(l.phone_key, o);
    }
  }
  // 2. aba Cliques do Banco de Dados, pelo telefone
  const doBanco = new Map();
  if (banco) {
    const c = await ler(banco, 'Cliques').catch(() => []);
    const cab = (c[0] ?? []).map(norm);
    const i = (n) => cab.indexOf(n);
    for (const r of c.slice(1)) {
      const k = phoneKey(r[i('phone_number')]);
      if (!k) continue;
      const o = origemDoAnuncio({ utm_source: r[i('utm_source')], gclid: r[i('gclid')], gbraid: r[i('gbraid')], wbraid: r[i('wbraid')], fbc: r[i('fbc')], referrer: r[i('referrer')] });
      if (o && !doBanco.has(k)) doBanco.set(k, o);
    }
  }

  const linhas = await ler(doc, aba);
  const cab = linhas[0] ?? [];
  const cols = cab.map(norm);
  let iOrigem = cols.indexOf('origem');
  if (iOrigem < 0) {
    iOrigem = cab.length;
    console.log(`coluna ORIGEM sera criada em ${letra(iOrigem)}1${gravar ? '' : ' (simulado)'}`);
  }
  const iFone = cols.findIndex((c) => c === 'telefone');
  const iLink = cols.findIndex((c) => /whatsapp/.test(c));
  const iCanal = cols.findIndex((c) => c === 'canal de anuncio' || c === 'canal');
  const corpo = linhas.slice(1);

  const celulas = [];
  const resumo = {};
  for (let n = 0; n < corpo.length; n++) {
    const r = corpo[n];
    const antes = String(r[iOrigem] ?? '').trim();
    const k = phoneKey(r[iFone] ?? '') || phoneKey(r[iLink] ?? '');
    const doClique = (k && doCrm.get(k)) || (k && doBanco.get(k)) || '';
    const daLinha = codigoDaLinha(antes) || (iCanal >= 0 ? codigoDaLinha(r[iCanal]) : '');
    // "meta" do clique e' a plataforma sem a rede; a linha do quiz sabe se foi ig ou fb
    const origem = doClique && doClique !== 'meta' ? doClique : (daLinha || doClique);
    resumo[origem || '(sem evidencia)'] = (resumo[origem || '(sem evidencia)'] || 0) + 1;
    if (!origem || origem === antes.toLowerCase()) continue;
    celulas.push({ range: `'${aba.replace(/'/g, "''")}'!${letra(iOrigem)}${n + 2}`, values: [[origem]] });
  }
  console.log('linhas:', corpo.length, '| resultado:', JSON.stringify(resumo), '| celulas a gravar:', celulas.length, gravar ? '' : '(sem --gravar: nada foi escrito)');
  if (!gravar) return;

  const H = { authorization: `Bearer ${tok}`, 'content-type': 'application/json' };
  if (cols.indexOf('origem') < 0) {
    const meta = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${doc}?fields=sheets.properties(sheetId,title,gridProperties(columnCount))`, { headers: H })).json();
    const sh = (meta.sheets ?? []).map((s) => s.properties).find((p) => p.title === aba);
    if (sh && sh.gridProperties.columnCount <= iOrigem) {
      const g = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${doc}:batchUpdate`, { method: 'POST', headers: H, body: JSON.stringify({ requests: [{ appendDimension: { sheetId: sh.sheetId, dimension: 'COLUMNS', length: iOrigem + 1 - sh.gridProperties.columnCount } }] }) });
      if (!g.ok) throw new Error(`Sheets ${g.status} ao ampliar a grade`);
    }
    celulas.unshift({ range: `'${aba.replace(/'/g, "''")}'!${letra(iOrigem)}1`, values: [['ORIGEM']] });
  }
  if (!celulas.length) return;
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${doc}/values:batchUpdate`, { method: 'POST', headers: H, body: JSON.stringify({ valueInputOption: 'RAW', data: celulas }) });
  const j = await r.json();
  if (!r.ok) throw new Error(`Sheets ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  console.log('gravadas:', j.totalUpdatedCells, 'celulas');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
