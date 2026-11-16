#!/usr/bin/env node
/**
 * Restaura o backup diario de uma planilha de leads numa ABA NOVA da planilha original.
 * A aba original nunca e' tocada: quem decide copiar de volta e' a pessoa.
 *
 *   npx wrangler r2 object get crm-auto-backups/planilhas/2026-11-16/1-taina-aci.json.gz --file taina.json.gz --remote
 *   node scripts/restaurar-planilha.mjs taina.json.gz              # so' mostra o que faria
 *   node scripts/restaurar-planilha.mjs taina.json.gz --confirmar  # cria a aba "Backup 2026-11-16"
 *
 * Grava o texto como aparecia na planilha (RAW): telefone, "+55" e zero a' esquerda ficam
 * iguais e nenhuma formula e' executada; data e hora entram como texto ("05/11/2026").
 * Usa CLIENT_ID, CLIENT_SECRET e REFRESH_TOKEN do .env. Apague o arquivo baixado depois:
 * tem nome e telefone de lead.
 *
 * Fica fora de scripts/backup/ de proposito: o .gitignore ignora pastas backup*.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const confirmar = args.includes('--confirmar');
const arquivo = args.find((a) => !a.startsWith('--'));
if (!arquivo) {
  console.error('uso: node scripts/restaurar-planilha.mjs <backup.json.gz> [--confirmar]');
  process.exit(2);
}

const dados = JSON.parse(zlib.gunzipSync(fs.readFileSync(arquivo)).toString('utf8'));
const { doc, aba, cliente, em, formatado } = dados;
if (!doc || !Array.isArray(formatado) || !formatado.length) {
  console.error('arquivo sem planilha ou sem linhas: confira se veio do backup do crm-auto');
  process.exit(1);
}
const linhas = formatado.length;
const colunas = Math.max(1, ...formatado.map((l) => (Array.isArray(l) ? l.length : 0)));
const dia = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(em));

const env = Object.fromEntries(
  fs.readFileSync(path.join(raiz, '.env'), 'utf8').split(/\r?\n/)
    .filter((l) => /^[A-Z_0-9]+=/.test(l))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);
for (const k of ['CLIENT_ID', 'CLIENT_SECRET', 'REFRESH_TOKEN']) {
  if (!env[k]) {
    console.error(`falta ${k} no .env`);
    process.exit(1);
  }
}

const token = await (async () => {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: env.CLIENT_ID, client_secret: env.CLIENT_SECRET, refresh_token: env.REFRESH_TOKEN, grant_type: 'refresh_token',
    }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`Google recusou o token: ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token;
})();

const S = `https://sheets.googleapis.com/v4/spreadsheets/${doc}`;
async function google(url, init = {}) {
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}

const meta = await google(`${S}?fields=properties.title,sheets.properties(title)`);
const existentes = new Set(meta.sheets.map((s) => s.properties.title));
let titulo = `Backup ${dia}`;
for (let n = 2; existentes.has(titulo); n++) titulo = `Backup ${dia} (${n})`;

console.log(`Planilha: ${meta.properties.title} (${cliente ?? 'cliente sem nome'})`);
console.log(`Backup de ${em}, aba "${aba}": ${linhas} linhas x ${colunas} colunas.`);
console.log(`Iria criar a aba "${titulo}" com o texto como aparecia (RAW).`);
console.log(`A aba "${aba}" nao seria alterada.`);
if (!confirmar) {
  console.log('Nada foi alterado. Para criar a aba, rode de novo com --confirmar.');
  process.exit(0);
}

await google(`${S}:batchUpdate`, {
  method: 'POST',
  body: JSON.stringify({
    requests: [{
      addSheet: { properties: { title: titulo, gridProperties: { rowCount: linhas + 10, columnCount: colunas, frozenRowCount: 1 } } },
    }],
  }),
});
const BLOCO = 2000;
for (let i = 0; i < linhas; i += BLOCO) {
  const faixa = encodeURIComponent(`'${titulo.replace(/'/g, "''")}'!A${i + 1}`);
  await google(`${S}/values/${faixa}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values: formatado.slice(i, i + BLOCO).map((l) => (Array.isArray(l) ? l : [])) }),
  });
}
console.log(`Feito: aba "${titulo}" criada com ${linhas} linhas.`);
