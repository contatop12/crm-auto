import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { fakeD1 } from '../helpers/fakeD1';
import { abrirRetorno } from '../../src/pipelines/retorno';
import type { Env } from '../../src/env';

const FONE = '+5511999990000';
const ANTIGO = 'VITA-MVOLTA0001';
const FUNIL = 7;
const ORGANICO = 8;
/** "Oportunidade Ganha" do funil: etapa final */
const GANHA = 32;
/** primeira etapa do funil */
const NOVO_LEAD = 27;
const TITULO = '#76 - 5511999990000 - Vital';
const PLANILHA = 'https://planilha.teste/n8n';
const DIA = 24 * 3600 * 1000;

/** O Organico nao esta' em `funnel_stages`: a etapa final sai do Chatwoot. */
const ETAPAS_DO_ORGANICO = [
  { id: 43, board_id: ORGANICO, name: 'Entrada', completed: false, cancelled: false, tasks_count: 3, probability: '0.0' },
  { id: 44, board_id: ORGANICO, name: 'Ganho', completed: true, cancelled: false, tasks_count: 1, probability: '1.0' },
];

/**
 * Cliente com a volta ligada (15 dias). O ciclo anterior: lead do Google de 40
 * dias atras, card 1421 em "Oportunidade Ganha", conversa 76 com o protocolo dele.
 */
function cenario(o: { retornoDias?: number | null } = {}) {
  const { d1, exec, consultar } = fakeD1();
  // "Vita" esta' dentro de "Vital": o nome do lead passaria por perfil da empresa
  exec(`INSERT INTO tenants (id, slug, nome, ativo) VALUES (1, 'clinica', 'Clinica Teste', 1)`);
  const dias = o.retornoDias === undefined ? 15 : o.retornoDias;
  // sem Pulseboard: o aviso para em `group_notifications`, que e' o que se confere
  exec(`INSERT INTO tenant_config (tenant_id, cw_account_id, cw_board_funil_id, cw_board_organico_id, ingest_key,
          janela_match_dias, gtm_prefixo, pulseboard_ativo, retorno_dias)
        VALUES (1, 2, ${FUNIL}, ${ORGANICO}, 'k', 90, 'VITA', 0, ${dias ?? 'NULL'})`);
  for (const [pos, nome, step, final] of [
    [1, 'Novo Lead', NOVO_LEAD, 0], [2, 'Qualificando', 28, 0], [3, 'Oportunidade Perdida', 31, 1], [4, 'Oportunidade Ganha', GANHA, 1],
  ] as const) {
    exec(`INSERT INTO funnel_stages (tenant_id, posicao, nome, cw_step_id, is_final) VALUES (1, ${pos}, '${nome}', ${step}, ${final})`);
  }
  exec(`INSERT INTO leads (tenant_id, protocol, nome, phone_raw, phone_e164, phone_key, gclid, utm_source, utm_medium,
          utm_campaign, origem, evento, created_at)
        VALUES (1, '${ANTIGO}', 'Vital', '${FONE}', '${FONE}', '1199990000', 'Cj0volta', 'google', 'cpc',
          'Vita - Search - Aparelhos', 'clique', 'whatsapp_click', datetime('now', '-40 day'))`);
  exec(`INSERT INTO conversations (tenant_id, cw_conversation_id, protocol, task_id) VALUES (1, 76, '${ANTIGO}', 1421)`);

  const consultas: string[] = [];
  const kv = new Map<string, string>();
  const env = {
    DB: { prepare: (sql: string) => { consultas.push(sql); return d1.prepare(sql); } },
    CACHE: {
      get: async (k: string, tipo?: string) => {
        const v = kv.get(k);
        return v === undefined ? null : tipo === 'json' ? JSON.parse(v) : v;
      },
      put: async (k: string, v: string) => { kv.set(k, v); },
    },
    CHATWOOT_BASE_URL: 'https://cw.teste',
    CHATWOOT_API_TOKEN: 'tok',
  } as unknown as Env;
  return { env, exec, consultar, consultas, kv };
}

/** Mensagem do lead. O retrato da conversa ainda traz o card antigo, em Ganha. */
function mensagem(o: { id?: number; content?: string; task?: Record<string, unknown>; conv?: Record<string, unknown> } = {}) {
  return JSON.stringify({
    event: 'message_created',
    id: o.id ?? 9001,
    message_type: 'incoming',
    private: false,
    content: o.content ?? 'Oi, quero fazer outro orcamento',
    conversation: {
      id: 76,
      custom_attributes: { protocolo: ANTIGO, funil: 'Lead' },
      labels: ['google'],
      meta: { sender: { name: 'Vital', phone_number: FONE } },
      kanban_task: { id: 1421, board_id: FUNIL, board_step: { id: GANHA, name: 'Oportunidade Ganha' }, title: TITULO, ...o.task },
      ...o.conv,
    },
  });
}

/** O Kanban de mentira: o que cada GET devolve e como o POST do card responde. */
let kb: {
  /** ultima mensagem do lead antes da de agora (ms); null = nenhuma */
  anteriorDoLead: number | null;
  /** o card antigo, como `GET /kanban/tasks/:id` devolve */
  antigo: Record<string, unknown>;
  /** id que o POST do card devolve */
  idNovo: number;
  /** status de cada POST do card, em ordem; acabou a lista = 200 */
  postsDoCard: number[];
  /** para qual card a conversa aponta depois que o novo existe */
  conversaAponta: 'novo' | 'antigo';
  /** quantos POST de atributos da conversa falham com 500 */
  falhasNosAtributos: number;
};
let criado: Record<string, unknown> | null;
let chamadas: Array<{ metodo: string; url: string; corpo: unknown }>;

beforeEach(() => {
  chamadas = [];
  criado = null;
  kb = {
    anteriorDoLead: Date.now() - 20 * DIA,
    antigo: {
      id: 1421, board_id: FUNIL, board_step_id: GANHA, title: TITULO, contact_ids: [555],
      conversation_ids: [76], conversations: [{ id: 900, display_id: 76 }],
      step_changed_at: new Date(Date.now() - 18 * DIA).toISOString(), custom_attributes: { protocolo: ANTIGO },
    },
    idNovo: 1500,
    postsDoCard: [],
    conversaAponta: 'novo',
    falhasNosAtributos: 0,
  };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const metodo = init.method ?? 'GET';
    let corpo: unknown = null;
    try { corpo = init.body ? JSON.parse(String(init.body)) : null; } catch { corpo = String(init.body); }
    chamadas.push({ metodo, url: String(url), corpo });
    const caminho = String(url).replace('https://cw.teste/api/v1/accounts/2', '');

    if (metodo === 'GET' && caminho.startsWith('/conversations/76/messages?before=')) {
      const doLead = kb.anteriorDoLead === null ? [] : [{ id: 8000, message_type: 0, private: false, created_at: Math.floor(kb.anteriorDoLead / 1000) }];
      return Response.json({ payload: doLead });
    }
    if (metodo === 'GET' && caminho.startsWith('/conversations/76/messages')) return Response.json({ payload: [] });
    if (metodo === 'GET' && caminho === '/conversations/76') {
      const aponta = criado && kb.conversaAponta === 'novo' ? criado.id : kb.antigo.id;
      return Response.json({ id: 76, custom_attributes: { protocolo: ANTIGO, funil: 'Lead' }, labels: [], kanban_task: { id: aponta } });
    }
    if (metodo === 'POST' && caminho === '/conversations/76/custom_attributes' && kb.falhasNosAtributos > 0) {
      kb.falhasNosAtributos--;
      return new Response('fora do ar', { status: 500 });
    }
    if (metodo === 'POST' && caminho === '/kanban/tasks') {
      const status = kb.postsDoCard.shift() ?? 200;
      if (status >= 400) return new Response('{"errors":["recusado"]}', { status });
      const task = (corpo as { task: Record<string, unknown> }).task;
      criado = {
        ...task, id: kb.idNovo, conversations: [{ id: 900, display_id: 76 }],
        contacts: [{ id: 555, name: 'Vital', phone_number: FONE }],
      };
      return Response.json(criado);
    }
    if (metodo === 'GET' && caminho === `/kanban/tasks/${String(kb.antigo.id)}`) return Response.json(kb.antigo);
    if (metodo === 'GET' && criado && caminho === `/kanban/tasks/${String(criado.id)}`) return Response.json(criado);
    if (metodo === 'GET' && caminho === `/kanban/boards/${ORGANICO}/steps`) return Response.json({ steps: ETAPAS_DO_ORGANICO });
    return Response.json({ ok: true });
  });
});
afterEach(() => vi.unstubAllGlobals());

const postsDoCard = () => chamadas.filter((c) => c.metodo === 'POST' && /\/kanban\/tasks$/.test(c.url));
const corpoDoCard = () => (postsDoCard().at(-1)!.corpo as { task: Record<string, unknown> }).task;
const ligacoesDoAntigo = () =>
  chamadas.filter((c) => c.metodo === 'PUT' && /\/kanban\/tasks\/1421$/.test(c.url)).map((c) => c.corpo);

interface LinhaRetorno {
  n: number; mensagem_id: string; task_anterior: string; task_novo: string | null;
  protocolo_anterior: string | null; protocolo_novo: string | null; origem: string | null;
  desligou_antigo: number; status: string; erro: string | null;
}
const retornos = (consultar: ReturnType<typeof cenario>['consultar']) =>
  consultar<LinhaRetorno>('SELECT * FROM retornos ORDER BY n');

describe('abrirRetorno', () => {
  test('volta herdada: um card " #1" na primeira etapa do funil, aviso pelo card novo e a volta registrada', async () => {
    const { env, consultar } = cenario();

    const r = await abrirRetorno(env, 1, mensagem(), { tentativa: 1 });

    expect(r?.status).toBe('ok');
    expect(r?.motivo).toContain('volta #1');
    expect(postsDoCard()).toHaveLength(1);
    expect(corpoDoCard()).toMatchObject({
      title: `${TITULO} #1`,
      board_id: FUNIL,
      board_step_id: NOVO_LEAD,
      conversation_ids: [76],
      contact_ids: [555],
      custom_attributes: expect.objectContaining({ protocolo: `${ANTIGO}-R1`, gclid: 'Cj0volta' }),
    });
    // o card antigo fica como estava: a conversa ja' aponta para o novo
    expect(ligacoesDoAntigo()).toEqual([]);
    expect(retornos(consultar)).toEqual([expect.objectContaining({
      n: 1, mensagem_id: '9001', task_anterior: '1421', task_novo: '1500',
      protocolo_anterior: ANTIGO, protocolo_novo: `${ANTIGO}-R1`, origem: 'herdada',
      desligou_antigo: 0, status: 'feito', erro: null,
    })]);
    // o grupo soube pelo card novo, com o protocolo do ciclo
    expect(consultar('SELECT chave, task_id FROM group_notifications')).toEqual([{ chave: `${ANTIGO}-R1`, task_id: 1500 }]);
    // a etapa final saiu de `funnel_stages`, sem perguntar ao Chatwoot
    expect(chamadas.filter((c) => /\/steps$/.test(c.url))).toEqual([]);
  });

  test('a mesma mensagem processada de novo nao cria outro card', async () => {
    const { env } = cenario();
    await abrirRetorno(env, 1, mensagem(), { tentativa: 1 });
    const antes = chamadas.length;

    expect(await abrirRetorno(env, 1, mensagem(), { tentativa: 2 })).toBeNull();
    expect(postsDoCard()).toHaveLength(1);
    // volta feita responde pelo banco, sem chamar o Chatwoot
    expect(chamadas).toHaveLength(antes);
  });

  test('falha depois do card: a volta fica com o erro e a retentativa termina sem criar outro', async () => {
    const { env, consultar } = cenario();
    kb.falhasNosAtributos = 1;

    await expect(abrirRetorno(env, 1, mensagem(), { tentativa: 1 })).rejects.toThrow(/500/);
    expect(retornos(consultar)[0]).toMatchObject({ status: 'pendente', task_novo: '1500', erro: expect.stringContaining('500') });

    const r = await abrirRetorno(env, 1, mensagem(), { tentativa: 2 });

    expect(r?.status).toBe('ok');
    expect(postsDoCard()).toHaveLength(1);
    expect(retornos(consultar)[0]).toMatchObject({ status: 'feito', task_novo: '1500', erro: null, protocolo_novo: `${ANTIGO}-R1` });
  });

  test('conversa sem protocolo no atributo: o anterior vem do banco, e a retentativa nao o troca pelo novo', async () => {
    // a atribuicao grava o protocolo novo em `conversations` antes do card: na
    // retentativa o banco ja' diz -R1, e o anterior tem de continuar o antigo
    const { env, consultar } = cenario();
    kb.falhasNosAtributos = 1;
    const semAtributo = mensagem({ conv: { custom_attributes: {} } });

    await expect(abrirRetorno(env, 1, semAtributo, { tentativa: 1 })).rejects.toThrow(/500/);
    expect(consultar('SELECT protocol FROM conversations')).toEqual([{ protocol: `${ANTIGO}-R1` }]);
    const r = await abrirRetorno(env, 1, semAtributo, { tentativa: 2 });

    expect(r?.status).toBe('ok');
    expect(retornos(consultar)[0]).toMatchObject({
      protocolo_anterior: ANTIGO, protocolo_novo: `${ANTIGO}-R1`, origem: 'herdada', status: 'feito',
    });
  });

  test('segunda mensagem da volta, com o retrato ainda no card antigo: null e nenhum card', async () => {
    const { env } = cenario();
    await abrirRetorno(env, 1, mensagem({ id: 9001 }), { tentativa: 1 });

    expect(await abrirRetorno(env, 1, mensagem({ id: 9002, content: 'alo?' }), { tentativa: 1 })).toBeNull();
    expect(postsDoCard()).toHaveLength(1);
  });

  test('a volta pendente de outra mensagem ha menos de 10 minutos e dela: null e nenhum card', async () => {
    const { env, exec, consultar } = cenario();
    exec(`INSERT INTO retornos (tenant_id, cw_conversation_id, n, mensagem_id, task_anterior, protocolo_anterior)
          VALUES (1, 76, 1, '9001', '1421', '${ANTIGO}')`);

    expect(await abrirRetorno(env, 1, mensagem({ id: 9002 }), { tentativa: 1 })).toBeNull();
    expect(postsDoCard()).toEqual([]);
    expect(retornos(consultar)[0]).toMatchObject({ mensagem_id: '9001', status: 'pendente' });
  });

  test('a volta pendente de outra mensagem ha 10 minutos ou mais: a primeira morreu, esta assume', async () => {
    const { env, exec, consultar } = cenario();
    exec(`INSERT INTO retornos (tenant_id, cw_conversation_id, n, mensagem_id, task_anterior, protocolo_anterior, created_at)
          VALUES (1, 76, 1, '9001', '1421', '${ANTIGO}', datetime('now', '-11 minutes'))`);

    const r = await abrirRetorno(env, 1, mensagem({ id: 9002 }), { tentativa: 1 });

    expect(r?.status).toBe('ok');
    expect(postsDoCard()).toHaveLength(1);
    expect(retornos(consultar)).toEqual([expect.objectContaining({ n: 1, mensagem_id: '9002', status: 'feito' })]);
  });

  test('POST do card recusado (422): solta o card antigo, cria o novo e marca desligou_antigo', async () => {
    const { env, consultar } = cenario();
    kb.postsDoCard = [422];

    const r = await abrirRetorno(env, 1, mensagem(), { tentativa: 1 });

    expect(r?.status).toBe('ok');
    expect(postsDoCard()).toHaveLength(2);
    expect(ligacoesDoAntigo()).toEqual([{ task: { conversation_ids: [] } }]);
    expect(retornos(consultar)[0]).toMatchObject({ task_novo: '1500', desligou_antigo: 1, status: 'feito' });
  });

  test('422 duas vezes: o card antigo volta a ser ligado a conversa e o erro sobe', async () => {
    const { env, consultar } = cenario();
    kb.postsDoCard = [422, 422];

    await expect(abrirRetorno(env, 1, mensagem(), { tentativa: 1 })).rejects.toThrow(/422/);

    expect(ligacoesDoAntigo()).toEqual([{ task: { conversation_ids: [] } }, { task: { conversation_ids: [76] } }]);
    expect(retornos(consultar)[0]).toMatchObject({
      status: 'pendente', task_novo: null, desligou_antigo: 0, erro: expect.stringContaining('422'),
    });
  });

  test('POST do card com 5xx: erro sobe sem mexer no card antigo', async () => {
    const { env, consultar } = cenario();
    kb.postsDoCard = [503];

    await expect(abrirRetorno(env, 1, mensagem(), { tentativa: 1 })).rejects.toThrow(/503/);

    expect(postsDoCard()).toHaveLength(1);
    expect(ligacoesDoAntigo()).toEqual([]);
    expect(retornos(consultar)[0]).toMatchObject({ status: 'pendente', task_novo: null });
  });

  test('a conversa ainda aponta para o card antigo depois de criar: o antigo solta a conversa', async () => {
    const { env, consultar } = cenario();
    kb.conversaAponta = 'antigo';

    const r = await abrirRetorno(env, 1, mensagem(), { tentativa: 1 });

    expect(r?.status).toBe('ok');
    expect(postsDoCard()).toHaveLength(1);
    expect(ligacoesDoAntigo()).toEqual([{ task: { conversation_ids: [] } }]);
    expect(retornos(consultar)[0]).toMatchObject({ desligou_antigo: 1, status: 'feito' });
  });

  test('retorno_dias NULL: null com uma leitura so do banco e nenhuma chamada ao Chatwoot', async () => {
    const { env, consultas, consultar } = cenario({ retornoDias: null });

    expect(await abrirRetorno(env, 1, mensagem(), { tentativa: 1 })).toBeNull();

    expect(consultas).toHaveLength(1);
    expect(chamadas).toEqual([]);
    expect(retornos(consultar)).toEqual([]);
  });

  test('o lead falou ha 14 dias: nao e volta', async () => {
    const { env, consultar } = cenario();
    kb.anteriorDoLead = Date.now() - 14 * DIA;

    expect(await abrirRetorno(env, 1, mensagem(), { tentativa: 1 })).toBeNull();
    expect(postsDoCard()).toEqual([]);
    expect(retornos(consultar)).toEqual([]);
  });

  test('sem mensagem anterior do lead vale a data em que o card entrou na etapa final', async () => {
    const { env } = cenario();
    kb.anteriorDoLead = null;
    kb.antigo.step_changed_at = new Date(Date.now() - 16 * DIA).toISOString();

    const r = await abrirRetorno(env, 1, mensagem(), { tentativa: 1 });

    expect(r?.status).toBe('ok');
    expect(postsDoCard()).toHaveLength(1);
  });

  test('card fora de etapa final: null sem chamar o Chatwoot', async () => {
    const { env } = cenario();
    const r = await abrirRetorno(env, 1, mensagem({ task: { board_step: { id: 28, name: 'Qualificando' } } }), { tentativa: 1 });
    expect(r).toBeNull();
    expect(chamadas).toEqual([]);
  });

  test('numero da propria empresa: null sem chamar o Chatwoot', async () => {
    const { env, exec } = cenario();
    exec(`UPDATE tenant_config SET numeros_proprios = '["${FONE}"]' WHERE tenant_id = 1`);
    expect(await abrirRetorno(env, 1, mensagem(), { tentativa: 1 })).toBeNull();
    expect(chamadas).toEqual([]);
  });

  test('nota interna e mensagem do vendedor nao abrem volta', async () => {
    const { env, consultas } = cenario();
    const base = JSON.parse(mensagem()) as Record<string, unknown>;
    expect(await abrirRetorno(env, 1, JSON.stringify({ ...base, private: true }), { tentativa: 1 })).toBeNull();
    expect(await abrirRetorno(env, 1, JSON.stringify({ ...base, message_type: 'outgoing' }), { tentativa: 1 })).toBeNull();
    expect(consultas).toEqual([]);
  });

  test('conversa sem telefone e sem lead anterior, no Organico: card " #1" no Organico, sem planilha', async () => {
    const { env, exec, consultar } = cenario();
    exec(`DELETE FROM conversations`);
    exec(`UPDATE tenant_config SET sheets_ativo = 1, planilha_modo = 'n8n', planilha_webhook_url = '${PLANILHA}' WHERE tenant_id = 1`);
    kb.antigo = { ...kb.antigo, board_id: ORGANICO, board_step_id: 44, title: 'Conversa #76 - Vital', custom_attributes: {} };

    const r = await abrirRetorno(env, 1, mensagem({
      task: { board_id: ORGANICO, board_step: { id: 44, name: 'Ganho' }, title: 'Conversa #76 - Vital' },
      conv: { custom_attributes: {}, meta: { sender: { name: 'Vital' } } },
    }), { tentativa: 1 });

    expect(r?.status).toBe('ok');
    expect(r?.motivo).toContain('card 1500');
    expect(corpoDoCard()).toMatchObject({
      title: 'Conversa #76 - Vital #1', board_id: ORGANICO, board_step_id: 43, custom_attributes: {},
    });
    expect(chamadas.filter((c) => c.url === PLANILHA)).toEqual([]);
    expect(retornos(consultar)[0]).toMatchObject({
      origem: 'sem_lead', protocolo_anterior: null, protocolo_novo: null, status: 'feito', task_novo: '1500',
    });
  });

  test('card antigo no Organico, volta de anuncio: card novo no funil; as etapas do Organico ficam no cache', async () => {
    const { env, kv } = cenario();
    kb.antigo = { ...kb.antigo, board_id: ORGANICO, board_step_id: 44 };
    const noOrganico = { task: { board_id: ORGANICO, board_step: { id: 44, name: 'Ganho' } } };

    await abrirRetorno(env, 1, mensagem({ id: 9001, ...noOrganico }), { tentativa: 1 });
    // a segunda mensagem confere a etapa de novo: vem do KV
    await abrirRetorno(env, 1, mensagem({ id: 9002, ...noOrganico }), { tentativa: 1 });

    expect(corpoDoCard()).toMatchObject({ board_id: FUNIL, board_step_id: NOVO_LEAD });
    expect(chamadas.filter((c) => /\/kanban\/boards\/8\/steps$/.test(c.url))).toHaveLength(1);
    expect(kv.has(`steps:2:${ORGANICO}`)).toBe(true);
  });

  test('segunda volta meses depois: " #2", protocolo -R2 da raiz', async () => {
    const { env, exec, consultar } = cenario();
    exec(`INSERT INTO leads (tenant_id, protocol, nome, phone_key, gclid, utm_source, origem, evento, retorno_de, clique_em, created_at)
          VALUES (1, '${ANTIGO}-R1', 'Vital #1', '1199990000', 'Cj0volta', 'google', 'mensagem', 'retorno',
                  '${ANTIGO}', datetime('now', '-200 day'), datetime('now', '-120 day'))`);
    exec(`INSERT INTO retornos (tenant_id, cw_conversation_id, n, mensagem_id, task_anterior, task_novo, protocolo_anterior,
            protocolo_novo, origem, status, created_at)
          VALUES (1, 76, 1, '5000', '1421', '1500', '${ANTIGO}', '${ANTIGO}-R1', 'herdada', 'feito', datetime('now', '-120 day'))`);
    exec(`UPDATE conversations SET protocol = '${ANTIGO}-R1', task_id = 1500`);
    kb.antigo = { ...kb.antigo, id: 1500, title: `${TITULO} #1`, custom_attributes: { protocolo: `${ANTIGO}-R1` } };
    kb.idNovo = 1600;
    kb.anteriorDoLead = Date.now() - 90 * DIA;

    const r = await abrirRetorno(env, 1, mensagem({
      task: { id: 1500, title: `${TITULO} #1` },
      conv: { custom_attributes: { protocolo: `${ANTIGO}-R1`, funil: 'Lead' } },
    }), { tentativa: 1 });

    expect(r?.status).toBe('ok');
    expect(corpoDoCard()).toMatchObject({ title: `${TITULO} #2`, board_step_id: NOVO_LEAD });
    expect(retornos(consultar)[1]).toMatchObject({
      n: 2, task_anterior: '1500', task_novo: '1600', protocolo_anterior: `${ANTIGO}-R1`,
      protocolo_novo: `${ANTIGO}-R2`, origem: 'herdada', status: 'feito',
    });
  });

  test('anuncio da Meta esperando o clique: adia sem card, e a mesma mensagem na volta da fila abre o ciclo', async () => {
    const { env, exec, consultar } = cenario();
    exec(`UPDATE tenant_config SET rastrear_meta_mensagem = 1 WHERE tenant_id = 1`);
    exec(`INSERT INTO ingest_keys (tenant_id, canal, chave) VALUES (1, 'evolution', 'k-evo')`);
    const doAnuncio = mensagem({ content: 'Quero saber mais\n**Aparelho novo**\nhttps://www.instagram.com/p/abc123/' });

    const adiada = await abrirRetorno(env, 1, doAnuncio, { tentativa: 1 });

    expect(adiada?.adiar).toBe(true);
    expect(postsDoCard()).toEqual([]);
    expect(retornos(consultar)).toEqual([expect.objectContaining({ mensagem_id: '9001', status: 'pendente', erro: null })]);

    const r = await abrirRetorno(env, 1, doAnuncio, { tentativa: 2 });

    expect(r?.status).toBe('ok');
    expect(postsDoCard()).toHaveLength(1);
    expect(retornos(consultar)).toEqual([expect.objectContaining({
      protocolo_novo: 'VITA-CTWA-76-R1', origem: 'anuncio_novo', status: 'feito',
    })]);
  });
});
