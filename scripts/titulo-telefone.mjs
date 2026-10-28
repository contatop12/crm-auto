#!/usr/bin/env node
/**
 * Poe o telefone no titulo dos cards que ja' estao no funil: "Conversa #1240 -
 * Vital" vira "Conversa #1240 - 5511932346062".
 *
 * Mesma regra do Worker (src/domain/tituloCard.ts), rodando da maquina com as
 * credenciais do .env — para os cards de antes da regra. Depois disso o Worker
 * troca o titulo sozinho a cada mensagem da conversa.
 *
 * So' "Novo Lead" (todos) e "Qualificando" (etapa mudada nas ultimas --horas).
 * Renomear dispara `kanban_task_updated`, e com ele as regras do funil (aviso
 * no grupo, conversao): card antigo nunca avisado seria avisado agora.
 *
 * Uso:
 *   node scripts/titulo-telefone.mjs --conta 5 --board 9
 *   node scripts/titulo-telefone.mjs --conta 5 --board 9 --horas 72 --saida antes.json
 *   node scripts/titulo-telefone.mjs ... --gravar        (sem isto so' mostra)
 *
 * .env: CHATWOOT_DOMAIN, CHATWOOT_TOKEN_ACCESS
 */
import { readFileSync, writeFileSync } from 'node:fs';

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
const horas = Number(arg('horas', 72));
const saida = arg('saida');
const gravar = process.argv.includes('--gravar');
if (!conta || !board) {
  console.error('faltou --conta ou --board');
  process.exit(1);
}

const cwBase = /^https?:/.test(env.CHATWOOT_DOMAIN) ? env.CHATWOOT_DOMAIN : `https://${env.CHATWOOT_DOMAIN}`;
const cw = async (caminho, metodo = 'GET', corpo) => {
  const r = await fetch(`${cwBase}/api/v1/accounts/${conta}${caminho}`, {
    method: metodo,
    headers: {
      api_access_token: env.CHATWOOT_TOKEN_ACCESS,
      accept: 'application/json',
      ...(corpo ? { 'content-type': 'application/json' } : {}),
    },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  });
  if (!r.ok) throw new Error(`Chatwoot ${metodo} ${caminho} -> ${r.status}`);
  return r.json();
};

// --- mesma regra de src/domain/tituloCard.ts ---
const tituloComTelefone = (titulo, telefone) => {
  const atual = String(titulo ?? '');
  const m = /^(Conversa\s*#\d+)\s*-\s*/i.exec(atual);
  if (!m) return null;
  const digitos = String(telefone ?? '').replace(/\D/g, '');
  if (digitos.length < 10) return null;
  const novo = `${m[1]} - ${digitos}`;
  return novo === atual ? null : novo;
};

const normalizar = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const { steps } = await cw(`/kanban/boards/${board}/steps`);
const novoLead = steps.find((s) => normalizar(s.name) === 'novo lead');
const qualificando = steps.find((s) => normalizar(s.name) === 'qualificando');
if (!novoLead && !qualificando) {
  console.log(`board ${board}: sem "Novo Lead" nem "Qualificando" (${steps.map((s) => s.name).join(', ')})`);
  process.exit(0);
}

const tasks = [];
for (let page = 1; ; page++) {
  const r = await cw(`/kanban/tasks?board_id=${board}&page=${page}&per_page=100`);
  tasks.push(...(r.tasks ?? []));
  if (!r.meta?.has_more) break;
}

const limite = Date.now() - horas * 3600 * 1000;
const alvos = tasks.filter((t) => {
  if (novoLead && t.board_step_id === novoLead.id) return true;
  // a hora que o card mostra no Kanban e' a da etapa atual
  const desde = Date.parse(t.step_changed_at ?? t.created_at ?? '');
  return qualificando && t.board_step_id === qualificando.id && desde >= limite;
});

const linhas = [];
for (const t of alvos) {
  const contato = t.contact_ids?.[0];
  const fone = contato ? (await cw(`/contacts/${contato}`)).payload?.phone_number : null;
  const novo = tituloComTelefone(t.title, fone);
  linhas.push({
    task: t.id,
    etapa: t.board_step_id === novoLead?.id ? 'Novo Lead' : 'Qualificando',
    desde: t.step_changed_at ?? t.created_at,
    antes: t.title,
    depois: novo,
  });
}

for (const l of linhas) {
  console.log(`${l.task}\t${l.etapa}\t${String(l.desde).slice(0, 16)}\t${l.antes}  ->  ${l.depois ?? '(fica)'}`);
}
const trocar = linhas.filter((l) => l.depois);
console.log(`board ${board}: ${alvos.length} cards na janela, ${trocar.length} a renomear`);
if (saida) writeFileSync(saida, JSON.stringify(linhas, null, 2));

if (gravar) {
  for (const l of trocar) {
    await cw(`/kanban/tasks/${l.task}`, 'PUT', { task: { title: l.depois } });
  }
  console.log(`gravado: ${trocar.length}`);
}
