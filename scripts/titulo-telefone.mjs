#!/usr/bin/env node
/**
 * Reescreve o titulo dos cards que ja' estao no funil: "Conversa #1240 -
 * Vital" vira "#1240 - 5511932346062 - Vital".
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
 *   node scripts/titulo-telefone.mjs ... --tasks 3744,3750   (cards de fora da janela)
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
// cards de fora da janela que tambem entram (ex.: os ja' renomeados antes)
const extras = new Set(String(arg('tasks', '')).split(',').filter(Boolean).map(Number));
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

// --- mesma regra de src/domain/tituloCard.ts e nomeUtil (nomeLead.ts) ---
const EMOJI = /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}‍︎️⃣]/gu;
const nomeUtil = (bruto, telefone) => {
  const nome = String(bruto ?? '').replace(EMOJI, ' ').replace(/\s+/g, ' ').trim();
  if (!nome || !/\p{L}/u.test(nome)) return null;
  const chave = (x) => {
    let d = String(x ?? '').replace(/\D/g, '');
    if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
    return d.length < 10 ? '' : d.slice(0, 2) + d.slice(-8);
  };
  return chave(nome) && chave(nome) === chave(telefone) ? null : nome;
};
const tituloDoCard = (titulo, telefone, nome) => {
  const atual = String(titulo ?? '');
  const m = /^(?:Conversa\s*)?#(\d+)\s*(?:-\s*([\s\S]*))?$/i.exec(atual);
  if (!m) return null;
  let digitos = String(telefone ?? '').replace(/\D/g, '');
  // celular brasileiro sempre com o nono digito (JID do WhatsApp as vezes vem sem)
  if (/^55\d{2}[6-9]\d{7}$/.test(digitos)) digitos = digitos.slice(0, 4) + '9' + digitos.slice(4);
  if (digitos.length < 10) return null;
  const doTitulo = (m[2] ?? '').replace(/^\+?\d{10,}\s*(?:-\s*)?/, '');
  const quem = nomeUtil(nome, telefone) ?? nomeUtil(doTitulo, telefone);
  const novo = quem ? `#${m[1]} - ${digitos} - ${quem}` : `#${m[1]} - ${digitos}`;
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
  if (extras.has(t.id)) return true;
  if (novoLead && t.board_step_id === novoLead.id) return true;
  // a hora que o card mostra no Kanban e' a da etapa atual
  const desde = Date.parse(t.step_changed_at ?? t.created_at ?? '');
  return qualificando && t.board_step_id === qualificando.id && desde >= limite;
});

const linhas = [];
for (const t of alvos) {
  const contato = t.contact_ids?.[0];
  const c = contato ? (await cw(`/contacts/${contato}`)).payload : null;
  const novo = tituloDoCard(t.title, c?.phone_number, c?.name);
  linhas.push({
    task: t.id,
    etapa: steps.find((s) => s.id === t.board_step_id)?.name ?? t.board_step_id,
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
