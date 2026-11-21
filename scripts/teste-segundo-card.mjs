// Teste do Kanban: uma conversa aceita dois cards? Para qual a conversa aponta?
// Cria UM card de teste numa conversa de numero da propria empresa e desfaz.
// Uso: PROPRIOS='<json ou lista>' node scripts/teste-segundo-card.mjs <caminho do .env> <conta>
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(process.argv[2], 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
);
let base = env.CHATWOOT_DOMAIN.replace(/\/$/, '');
if (!/^https?:/.test(base)) base = 'https://' + base;
const acc = Number(process.argv[3]);
const proprios = String(process.env.PROPRIOS ?? '').match(/\d{10,}/g) ?? [];

async function chamar(metodo, caminho, corpo) {
  const r = await fetch(`${base}/api/v1/accounts/${acc}${caminho}`, {
    method: metodo,
    headers: {
      api_access_token: env.CHATWOOT_TOKEN_ACCESS,
      accept: 'application/json',
      ...(corpo ? { 'content-type': 'application/json' } : {}),
    },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* corpo vazio ou html */ }
  return { status: r.status, json, texto: texto.slice(0, 300) };
}
const ligadas = (t) => (t?.conversations ?? []).map((c) => c.display_id);

// 1. conversa de numero proprio que tenha card
let alvo = null;
for (const n of proprios) {
  const busca = await chamar('GET', `/contacts/search?q=${n.slice(-8)}`);
  for (const contato of busca.json?.payload ?? []) {
    const cvs = await chamar('GET', `/contacts/${contato.id}/conversations`);
    for (const cv of cvs.json?.payload ?? []) {
      const det = await chamar('GET', `/conversations/${cv.id}`);
      const taskId = det.json?.kanban_task?.id;
      if (taskId) { alvo = { contato: contato.id, conversa: cv.id, taskId }; break; }
    }
    if (alvo) break;
  }
  if (alvo) break;
}
if (!alvo) { console.log('nenhuma conversa de numero proprio com card: nada foi alterado'); process.exit(0); }

const antigo = (await chamar('GET', `/kanban/tasks/${alvo.taskId}`)).json;
console.log('ANTES', JSON.stringify({
  conversa: alvo.conversa, card: antigo.id, board: antigo.board_id, etapa: antigo.board_step_id,
  conversas_do_card: ligadas(antigo), contact_ids: antigo.contact_ids,
  responsaveis: (antigo.assigned_agents ?? []).map((a) => a.id),
}));

// 2. segundo card na mesma conversa, no MESMO board e etapa do antigo
const criado = await chamar('POST', '/kanban/tasks', {
  task: {
    title: 'TESTE P12 - apagar',
    board_id: antigo.board_id,
    board_step_id: antigo.board_step_id,
    conversation_ids: ligadas(antigo),
    contact_ids: antigo.contact_ids ?? [],
  },
});
console.log('POST', criado.status, criado.json ? JSON.stringify({
  id: criado.json.id, conversas: ligadas(criado.json), conversation_ids: criado.json.conversation_ids,
  contact_ids: criado.json.contact_ids, erro: criado.json.errors ?? criado.json.error ?? null,
}) : criado.texto);

const novoId = criado.json?.id;
if (novoId) {
  // 3. para onde a conversa aponta, e o que sobrou no card antigo
  const cv = (await chamar('GET', `/conversations/${alvo.conversa}`)).json;
  const antigoDepois = (await chamar('GET', `/kanban/tasks/${alvo.taskId}`)).json;
  const novo = (await chamar('GET', `/kanban/tasks/${novoId}`)).json;
  console.log('DEPOIS', JSON.stringify({
    conversa_aponta_para: cv?.kanban_task?.id === novoId ? 'novo' : cv?.kanban_task?.id === alvo.taskId ? 'antigo' : cv?.kanban_task?.id ?? null,
    chaves_kanban_na_conversa: Object.keys(cv ?? {}).filter((k) => /kanban|task/i.test(k)),
    antigo_ainda_ligado: ligadas(antigoDepois).includes(alvo.conversa),
    novo_ligado: ligadas(novo).includes(alvo.conversa),
  }));

  // 4. limpeza
  const apagou = await chamar('DELETE', `/kanban/tasks/${novoId}`);
  console.log('DELETE', apagou.status, apagou.texto.slice(0, 120));
  const aindaExiste = (await chamar('GET', `/kanban/tasks/${novoId}`)).status === 200;
  if (aindaExiste) {
    const solto = await chamar('PUT', `/kanban/tasks/${novoId}`, {
      task: { title: 'TESTE P12 - apagar (sem conversa)', conversation_ids: [] },
    });
    console.log('card de teste NAO apagou; desligado da conversa:', solto.status, 'id', novoId);
  }
}

// 5. estado final tem de ser o inicial
let fim = (await chamar('GET', `/kanban/tasks/${alvo.taskId}`)).json;
if (!ligadas(fim).includes(alvo.conversa)) {
  const religa = await chamar('PUT', `/kanban/tasks/${alvo.taskId}`, { task: { conversation_ids: [alvo.conversa] } });
  console.log('card antigo tinha perdido a conversa; religado:', religa.status);
  fim = (await chamar('GET', `/kanban/tasks/${alvo.taskId}`)).json;
}
const cvFim = (await chamar('GET', `/conversations/${alvo.conversa}`)).json;
console.log('FIM', JSON.stringify({
  antigo_ligado: ligadas(fim).includes(alvo.conversa),
  conversa_aponta_para_antigo: cvFim?.kanban_task?.id === alvo.taskId,
  etapa_do_antigo_igual: fim.board_step_id === antigo.board_step_id,
  titulo_do_antigo_igual: fim.title === antigo.title,
}));
