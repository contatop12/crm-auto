#!/usr/bin/env node
/**
 * Importacao unica da Taina: whatsapp-track (D1 p12-whatsapp-track) → CRM (D1 crm_auto).
 *
 *   node scripts/importar-tracker.mjs            confere: le tudo e mostra as contagens
 *   node scripts/importar-tracker.mjs --aplicar  grava no CRM
 *
 * Le `CLOUDFLARE_ACCOUNT_ID` e `CLOUDFLARE_API_TOKEN` do `.env` deste projeto.
 * Nao grava arquivo nenhum e nao imprime telefone nem token: so' contagens.
 * A regra do que entra esta' em src/domain/importTracker.ts (testada).
 *
 * Pode rodar de novo sem duplicar: tudo e' INSERT OR IGNORE, e a config e'
 * sobrescrita com o mesmo valor (sempre com o envio DESLIGADO).
 */
import { readFileSync } from 'node:fs';
import { planoDeImportacao } from '../src/domain/importTracker.ts';
import { phoneKey } from '../src/domain/phone.ts';

const TRACKER_DB = 'c48f82aa-69f2-49b4-b687-38c8f6b3ec25'; // p12-whatsapp-track
const CRM_DB = '5fcf4193-f931-4b1a-9b67-bb5d758a1c5c'; // crm_auto
const TRACKER_CLIENTE = 1; // Dra. Taina no tracker
const CRM_SLUG = 'taina';

const aplicar = process.argv.includes('--aplicar');

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]),
);
const conta = env.CLOUDFLARE_ACCOUNT_ID;
const token = env.CLOUDFLARE_API_TOKEN;
if (!conta || !token) {
  console.error('faltam CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_API_TOKEN no .env');
  process.exit(1);
}

async function consultar(db, sql, params = []) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${conta}/d1/database/${db}/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const j = await r.json();
  if (!j.success) throw new Error(`D1 ${r.status}: ${JSON.stringify(j.errors ?? j).slice(0, 300)}`);
  return j.result?.[0]?.results ?? [];
}

const [tenant] = await consultar(CRM_DB, 'SELECT id FROM tenants WHERE slug = ?', [CRM_SLUG]);
if (!tenant) throw new Error(`tenant "${CRM_SLUG}" nao existe no CRM`);

const [cliente] = await consultar(TRACKER_DB,
  `SELECT meta_dataset_id, meta_token_cipher, meta_token_iv, meta_token_last4, meta_token_valid,
          meta_token_checked_at, meta_page_id, meta_waba_id
   FROM clients WHERE id = ?`, [TRACKER_CLIENTE]);
if (!cliente) throw new Error(`cliente ${TRACKER_CLIENTE} nao existe no tracker`);

const atribuicoes = await consultar(TRACKER_DB,
  `SELECT l.phone_e164, a.ctwa_clid, a.ad_id, a.source_url, a.first_message_at
   FROM attributions a JOIN leads l ON l.id = a.lead_id
   WHERE a.client_id = ? AND a.ctwa_clid IS NOT NULL`, [TRACKER_CLIENTE]);

const eventos = await consultar(TRACKER_DB,
  `SELECT e.event_id, e.event_name, l.phone_e164, e.value, e.currency, e.status, e.http_code, e.created_at, e.sent_at
   FROM events e JOIN leads l ON l.id = e.lead_id
   WHERE e.client_id = ?`, [TRACKER_CLIENTE]);

const comandos = planoDeImportacao(tenant.id, { cliente, atribuicoes, eventos }, phoneKey);
const enviados = eventos.filter((e) => e.status === 'enviado').length;

console.log(JSON.stringify({
  tenant_crm: tenant.id,
  dataset: cliente.meta_dataset_id ? 'presente' : 'AUSENTE',
  token: cliente.meta_token_cipher ? `cifrado, termina em ${cliente.meta_token_last4}` : 'AUSENTE',
  pagina: cliente.meta_page_id ? 'presente' : 'ausente',
  cliques_no_tracker: atribuicoes.length,
  eventos_no_tracker: eventos.length,
  eventos_aceitos_pela_meta: enviados,
  comandos: comandos.length,
  modo: aplicar ? 'APLICANDO' : 'conferencia (use --aplicar para gravar)',
}, null, 2));

if (aplicar) {
  let feitos = 0;
  for (const c of comandos) {
    await consultar(CRM_DB, c.sql, c.params);
    feitos++;
  }
  const [a] = await consultar(CRM_DB, `SELECT COUNT(*) AS n FROM meta_atribuicoes WHERE tenant_id = ? AND origem = 'tracker'`, [tenant.id]);
  const [e] = await consultar(CRM_DB, `SELECT COUNT(*) AS n FROM meta_eventos WHERE tenant_id = ? AND origem = 'tracker'`, [tenant.id]);
  console.log(JSON.stringify({ aplicados: feitos, cliques_no_crm: a.n, envios_do_tracker_no_crm: e.n, envio_meta: 'DESLIGADO' }));
}
