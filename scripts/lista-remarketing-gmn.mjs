#!/usr/bin/env node
/**
 * Lista de remarketing com os leads do Perfil da Empresa no Google (Google Meu
 * Negocio), um CSV por cliente, no modelo do Customer Match do Google Ads
 * (Email, Phone, First Name, Last Name, Country, Zip), que o Publico
 * Personalizado da Meta tambem aceita.
 *
 * Duas fontes, juntadas pelo telefone:
 *   1. conversas do Chatwoot com a etiqueta do perfil (google-meu-negocio; gmn
 *      na Persianas) — pega tambem quem o time etiquetou a mao;
 *   2. leads do CRM com a UTM do perfil (meu_negocio / google_meu_negocio / gmn)
 *      e sem gclid — com gclid o perfil apareceu num anuncio, e o lead e' do Ads.
 *
 * Os CSVs tem dado pessoal: saem em .tmp/remarketing-gmn/ (fora do git).
 *
 * Uso: node scripts/lista-remarketing-gmn.mjs
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

for (const l of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const CW = process.env.CHATWOOT_DOMAIN.replace(/\/$/, '');
const H = { api_access_token: process.env.CHATWOOT_TOKEN_ACCESS };

function d1(sql) {
  const umaLinha = sql.replace(/\s+/g, ' ').replace(/"/g, '\\"');
  const out = execSync(`npx wrangler d1 execute crm_auto --remote --json --command "${umaLinha}"`, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out)[0].results;
}

/** +55DDDNUMERO, ou '' quando nao parece telefone do Brasil. */
function fone(v) {
  let d = String(v ?? '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return d.startsWith('55') && (d.length === 12 || d.length === 13) ? '+' + d : '';
}

/** Nome de perfil do WhatsApp vira nome so' se tiver letra; telefone, emoji e "." ficam vazios. */
function partesDoNome(v) {
  const limpo = String(v ?? '').normalize('NFC').replace(/[^\p{L}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!/\p{L}{2,}/u.test(limpo)) return ['', ''];
  const [primeiro, ...resto] = limpo.split(' ');
  return [primeiro, resto.join(' ')];
}

const csv = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

const tenants = d1(`SELECT t.id, t.slug, c.cw_account_id AS acc,
  (SELECT v.label_chatwoot FROM label_vocabulary v WHERE v.tenant_id = t.id AND v.slug IN ('google-meu-negocio','gmn')
   ORDER BY v.slug = 'google-meu-negocio' DESC LIMIT 1) AS etiqueta
  FROM tenants t JOIN tenant_config c ON c.tenant_id = t.id ORDER BY t.id`);

const doCrm = d1(`SELECT tenant_id, nome, phone_e164, email FROM leads
  WHERE gclid IS NULL AND gbraid IS NULL AND wbraid IS NULL
    AND (lower(coalesce(utm_source,'') || ' ' || coalesce(utm_campaign,'') || ' ' || coalesce(utm_medium,'')) LIKE '%meu_negocio%'
      OR lower(coalesce(utm_source,'') || ' ' || coalesce(utm_campaign,'')) LIKE '%meu-negocio%'
      OR lower(coalesce(utm_source,'')) IN ('gmn','gmb','gbp'))`);

const pasta = join('.tmp', 'remarketing-gmn');
mkdirSync(pasta, { recursive: true });
const hoje = new Date().toISOString().slice(0, 10);
const resumo = [];

for (const t of tenants) {
  /** telefone -> { email, nome } */
  const pessoas = new Map();
  const juntar = (tel, email, nome) => {
    const f = fone(tel);
    const e = String(email ?? '').trim().toLowerCase();
    const chave = f || e;
    if (!chave) return;
    const atual = pessoas.get(chave) ?? { fone: f, email: '', nome: '' };
    if (!atual.email && e) atual.email = e;
    if (!atual.nome && partesDoNome(nome)[0]) atual.nome = nome;
    pessoas.set(chave, atual);
  };

  if (t.acc && t.etiqueta) {
    for (let page = 1; ; page++) {
      const r = await (await fetch(
        `${CW}/api/v1/accounts/${t.acc}/conversations?status=all&labels[]=${encodeURIComponent(t.etiqueta)}&page=${page}`,
        { headers: H },
      )).json();
      const lista = r.data?.payload ?? [];
      for (const c of lista) {
        const s = c.meta?.sender ?? {};
        juntar(s.phone_number, s.email, s.name);
      }
      if (lista.length < 25) break;
    }
  }
  for (const l of doCrm.filter((x) => x.tenant_id === t.id)) juntar(l.phone_e164, l.email, l.nome);

  resumo.push({ cliente: t.slug, contatos: pessoas.size });
  if (!pessoas.size) continue;

  const linhas = ['Email,Phone,First Name,Last Name,Country,Zip'];
  for (const p of pessoas.values()) {
    const [fn, ln] = partesDoNome(p.nome);
    linhas.push([p.email, p.fone, fn, ln, 'BR', ''].map(csv).join(','));
  }
  writeFileSync(join(pasta, `${t.slug}-gmn-${hoje}.csv`), linhas.join('\n') + '\n', 'utf8');
}

console.log(JSON.stringify({ pasta, resumo }, null, 1));
