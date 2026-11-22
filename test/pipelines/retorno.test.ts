import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { fakeD1 } from '../helpers/fakeD1';
import { abrirRetorno } from '../../src/pipelines/retorno';
import { consumir } from '../../src/queue/consumer';
import type { Env, QueueMessage } from '../../src/env';

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
/** Um terceiro board do cliente, que nao e' nem o funil nem o Organico. */
const OUTRO = 12;
const ETAPAS_DO_OUTRO = [
  { id: 61, board_id: OUTRO, name: 'Inicio', completed: false, cancelled: false, tasks_count: 2, probability: '0.0' },
  { id: 62, board_id: OUTRO, name: 'Fechado', completed: true, cancelled: false, tasks_count: 1, probability: '1.0' },
];
const ETAPAS: Record<string, unknown[]> = { [ORGANICO]: ETAPAS_DO_ORGANICO, [OUTRO]: ETAPAS_DO_OUTRO };

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
  /** roda antes de cada consulta: e' por onde o teste age no meio de uma execucao */
  const ganchos: Array<(sql: string) => void> = [];
  const kv = new Map<string, string>();
  const env = {
    DB: { prepare: (sql: string) => { consultas.push(sql); ganchos.forEach((g) => g(sql)); return d1.prepare(sql); } },
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
  return { env, exec, consultar, consultas, ganchos, kv };
}

/** A volta #1 do card 1421 ja' aberta: card 1500, protocolo -R1, conversa apontando para ele. */
function voltaFeita(exec: (sql: string) => void) {
  exec(`INSERT INTO leads (tenant_id, protocol, nome, phone_key, gclid, utm_source, origem, evento, retorno_de, clique_em, created_at)
        VALUES (1, '${ANTIGO}-R1', 'Vital #1', '1199990000', 'Cj0volta', 'google', 'mensagem', 'retorno',
                '${ANTIGO}', datetime('now', '-40 day'), datetime('now', '-1 day'))`);
  exec(`INSERT INTO retornos (tenant_id, cw_conversation_id, n, mensagem_id, task_anterior, task_novo, protocolo_anterior,
          protocolo_novo, origem, status, created_at)
        VALUES (1, 76, 1, '9001', '1421', '1500', '${ANTIGO}', '${ANTIGO}-R1', 'herdada', 'feito', datetime('now', '-1 day'))`);
  exec(`UPDATE conversations SET protocol = '${ANTIGO}-R1', task_id = 1500`);
}

/** Mensagem do lead. O retrato da conversa ainda traz o card antigo, em Ganha. */
function mensagem(o: {
  id?: number; content?: string; task?: Record<string, unknown>; conv?: Record<string, unknown>;
  /** hora da mensagem como o webhook manda (ISO, ou segundos); ausente = nao veio */
  created_at?: string | number;
} = {}) {
  return JSON.stringify({
    event: 'message_created',
    id: o.id ?? 9001,
    message_type: 'incoming',
    private: false,
    content: o.content ?? 'Oi, quero fazer outro orcamento',
    ...(o.created_at === undefined ? {} : { created_at: o.created_at }),
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
  /** o PUT que devolve a conversa ao card antigo falha com 500 */
  religarFalha: boolean;
  /** o POST do card responde 200 sem id (o card pode ter nascido) */
  postSemId: boolean;
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
    religarFalha: false,
    postSemId: false,
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
      if (kb.postSemId) return Response.json({ ok: true });
      const task = (corpo as { task: Record<string, unknown> }).task;
      criado = {
        ...task, id: kb.idNovo, conversations: [{ id: 900, display_id: 76 }],
        contacts: [{ id: 555, name: 'Vital', phone_number: FONE }],
      };
      return Response.json(criado);
    }
    if (metodo === 'PUT' && caminho === `/kanban/tasks/${String(kb.antigo.id)}` && kb.religarFalha) {
      const ligadas = (corpo as { task: { conversation_ids?: number[] } }).task.conversation_ids ?? [];
      if (ligadas.includes(76)) return new Response('fora do ar', { status: 500 });
    }
    if (metodo === 'GET' && caminho === `/kanban/tasks/${String(kb.antigo.id)}`) return Response.json(kb.antigo);
    if (metodo === 'GET' && criado && caminho === `/kanban/tasks/${String(criado.id)}`) return Response.json(criado);
    const etapas = /^\/kanban\/boards\/(\d+)\/steps$/.exec(caminho);
    if (metodo === 'GET' && etapas) return Response.json({ steps: ETAPAS[etapas[1]!] ?? [] });
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
  desligou_antigo: number; status: string; erro: string | null; trabalhando_ate: string | null;
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
      desligou_antigo: 0, status: 'feito', erro: null, trabalhando_ate: null,
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

    const r = await abrirRetorno(env, 1, mensagem(), { tentativa: 2 });

    // final, nao null: null mandaria o retrato velho para a atribuicao comum
    expect(r).toEqual({ status: 'ignorado', motivo: expect.stringContaining('card 1500') });
    expect(postsDoCard()).toHaveLength(1);
    // volta feita responde pelo banco, sem chamar o Chatwoot
    expect(chamadas).toHaveLength(antes);
  });

  test('volta feita: mensagem com o retrato do card antigo e sem protocolo no atributo nao mexe em nada', async () => {
    // Organico ou contato direto: sem `protocolo` na conversa, a atribuicao
    // comum nao para cedo, e gravaria o ciclo novo no card antigo
    const { env, exec, consultar } = cenario();
    voltaFeita(exec);

    const r = await abrirRetorno(env, 1, mensagem({ id: 9050, conv: { custom_attributes: {} } }), { tentativa: 1 });

    expect(r).toEqual({ status: 'ignorado', motivo: expect.stringMatching(/volta #1.*card 1500/) });
    expect(chamadas).toEqual([]);
    expect(consultar('SELECT protocol, task_id FROM conversations')).toEqual([{ protocol: `${ANTIGO}-R1`, task_id: 1500 }]);
  });

  test('pela fila: a mensagem com o retrato do card antigo nao cai na atribuicao comum', async () => {
    const { env, exec, consultar } = cenario();
    voltaFeita(exec);
    exec(`INSERT INTO events (id, tenant_id, source, event_type, payload)
          VALUES (1, 1, 'chatwoot', 'message_incoming', '${mensagem({ id: 9050, conv: { custom_attributes: {} } })}')`);
    const ack = vi.fn();
    const retry = vi.fn();
    const body: QueueMessage = { eventId: 1, tenantId: 1, source: 'chatwoot', eventType: 'message_incoming' };

    // segunda entrega: o titulo, o Pendente e o rodizio ja' rodaram na primeira
    await consumir({ messages: [{ body, attempts: 2, ack, retry }] } as unknown as MessageBatch<QueueMessage>, env);

    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
    expect(consultar('SELECT status FROM events WHERE id = 1')).toEqual([{ status: 'ignorado' }]);
    expect(chamadas).toEqual([]);
    expect(consultar('SELECT protocol, task_id FROM conversations')).toEqual([{ protocol: `${ANTIGO}-R1`, task_id: 1500 }]);
  });

  test('falha depois do card: a volta fica com o erro, solta a reserva, e a retentativa termina sem criar outro', async () => {
    const { env, consultar } = cenario();
    kb.falhasNosAtributos = 1;

    await expect(abrirRetorno(env, 1, mensagem(), { tentativa: 1 })).rejects.toThrow(/500/);
    expect(retornos(consultar)[0]).toMatchObject({
      status: 'pendente', task_novo: '1500', erro: expect.stringContaining('500'), trabalhando_ate: null,
    });

    const r = await abrirRetorno(env, 1, mensagem(), { tentativa: 2 });

    expect(r?.status).toBe('ok');
    expect(postsDoCard()).toHaveLength(1);
    expect(retornos(consultar)[0]).toMatchObject({ status: 'feito', task_novo: '1500', erro: null, protocolo_novo: `${ANTIGO}-R1` });
  });

  test('duas entregas da mesma mensagem ao mesmo tempo: um card so, e a outra devolve erro para a fila tentar depois', async () => {
    // o Chatwoot reentrega o webhook e a ingestao nao deduplica: dois eventos da
    // mesma mensagem podem rodar juntos
    const { env, consultar } = cenario();

    const [a, b] = await Promise.all([
      abrirRetorno(env, 1, mensagem(), { tentativa: 1 }),
      abrirRetorno(env, 1, mensagem(), { tentativa: 1 }),
    ]);

    expect(postsDoCard()).toHaveLength(1);
    expect([a?.status, b?.status].sort()).toEqual(['erro', 'ok']);
    expect([a, b].find((r) => r?.status === 'erro')?.motivo).toBe('outra execucao esta abrindo esta volta');
    expect(retornos(consultar)).toEqual([expect.objectContaining({ status: 'feito', trabalhando_ate: null })]);
  });

  test('reserva com o prazo de trabalho vencido: a execucao que a tinha morreu, a retentativa retoma', async () => {
    const { env, exec, consultar } = cenario();
    exec(`INSERT INTO retornos (tenant_id, cw_conversation_id, n, mensagem_id, task_anterior, protocolo_anterior, trabalhando_ate)
          VALUES (1, 76, 1, '9001', '1421', '${ANTIGO}', datetime('now', '-1 minute'))`);

    const r = await abrirRetorno(env, 1, mensagem(), { tentativa: 2 });

    expect(r?.status).toBe('ok');
    expect(postsDoCard()).toHaveLength(1);
    expect(retornos(consultar)[0]).toMatchObject({ status: 'feito', trabalhando_ate: null });
  });

  test('a reserva segura a linha por 45 s: menos que as 5 tentativas da fila (~100 s)', async () => {
    // trava mais longa que as retentativas deixaria a volta presa se quem a segura morrer
    const { env, consultar, ganchos } = cenario();
    let segundos: number | null = null;
    ganchos.push((sql) => {
      if (segundos === null && /SET task_novo = \?/.test(sql)) {
        segundos = consultar<{ s: number }>(
          `SELECT CAST(ROUND((julianday(trabalhando_ate) - julianday('now')) * 86400) AS INTEGER) AS s FROM retornos`,
        )[0]!.s;
      }
    });

    await abrirRetorno(env, 1, mensagem(), { tentativa: 1 });

    expect(segundos).toBeGreaterThanOrEqual(40);
    expect(segundos).toBeLessThanOrEqual(45);
  });

  test('reserva com o prazo de trabalho valendo: erro para a fila, sem escrever no Chatwoot', async () => {
    const { env, exec, consultar } = cenario();
    exec(`INSERT INTO retornos (tenant_id, cw_conversation_id, n, mensagem_id, task_anterior, protocolo_anterior, trabalhando_ate)
          VALUES (1, 76, 1, '9001', '1421', '${ANTIGO}', datetime('now', '+30 seconds'))`);

    const r = await abrirRetorno(env, 1, mensagem(), { tentativa: 2 });

    expect(r).toEqual({ status: 'erro', motivo: 'outra execucao esta abrindo esta volta' });
    expect(chamadas).toEqual([]);
    expect(retornos(consultar)[0]).toMatchObject({ status: 'pendente', erro: null });
  });

  test('a linha e relida depois de segurada: o card que a execucao anterior gravou no meio nao nasce de novo', async () => {
    const { env, exec, consultar, ganchos } = cenario();
    exec(`INSERT INTO retornos (tenant_id, cw_conversation_id, n, mensagem_id, task_anterior, protocolo_anterior)
          VALUES (1, 76, 1, '9001', '1421', '${ANTIGO}')`);
    // entre a leitura e o UPDATE que segura a linha, a outra execucao cria o card e solta
    criado = {
      id: 1500, board_id: FUNIL, board_step_id: NOVO_LEAD, title: `${TITULO} #1`, custom_attributes: { protocolo: `${ANTIGO}-R1` },
      conversation_ids: [76], conversations: [{ id: 900, display_id: 76 }], contacts: [{ id: 555, name: 'Vital', phone_number: FONE }],
    };
    ganchos.push((sql) => {
      if (/SET mensagem_id = \?, trabalhando_ate/.test(sql)) exec(`UPDATE retornos SET task_novo = '1500'`);
    });

    const r = await abrirRetorno(env, 1, mensagem(), { tentativa: 2 });

    expect(r?.status).toBe('ok');
    expect(postsDoCard()).toEqual([]);
    expect(retornos(consultar)[0]).toMatchObject({ status: 'feito', task_novo: '1500' });
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

  test('segunda mensagem da volta, com o retrato ainda no card antigo: final, sem card e sem chamar o Chatwoot', async () => {
    const { env } = cenario();
    await abrirRetorno(env, 1, mensagem({ id: 9001 }), { tentativa: 1 });
    const antes = chamadas.length;

    const r = await abrirRetorno(env, 1, mensagem({ id: 9002, content: 'alo?' }), { tentativa: 1 });

    expect(r?.status).toBe('ignorado');
    expect(postsDoCard()).toHaveLength(1);
    expect(chamadas).toHaveLength(antes);
  });

  test('a volta pendente de outra mensagem ha menos de 10 minutos e dela: final, nada escrito', async () => {
    // e' a segunda mensagem durante a espera do anuncio da Meta, por exemplo
    const { env, exec, consultar } = cenario();
    exec(`INSERT INTO retornos (tenant_id, cw_conversation_id, n, mensagem_id, task_anterior, protocolo_anterior)
          VALUES (1, 76, 1, '9001', '1421', '${ANTIGO}')`);

    const r = await abrirRetorno(env, 1, mensagem({ id: 9002, conv: { custom_attributes: {} } }), { tentativa: 1 });

    expect(r).toEqual({ status: 'ignorado', motivo: expect.stringContaining('volta #1') });
    expect(chamadas).toEqual([]);
    expect(consultar('SELECT protocol, task_id FROM conversations')).toEqual([{ protocol: ANTIGO, task_id: 1421 }]);
    expect(retornos(consultar)[0]).toMatchObject({ mensagem_id: '9001', status: 'pendente' });
  });

  test('a volta pendente de outra mensagem ha 10 minutos ou mais: esta assume, mesmo com o lead falando ha segundos', async () => {
    // a mensagem 2 mede o silencio a partir da 1: pela regra da volta ela nao e'
    // volta, e era por isso que assumir nunca acontecia
    const { env, exec, consultar } = cenario();
    exec(`INSERT INTO retornos (tenant_id, cw_conversation_id, n, mensagem_id, task_anterior, protocolo_anterior, created_at)
          VALUES (1, 76, 1, '9001', '1421', '${ANTIGO}', datetime('now', '-11 minutes'))`);
    kb.anteriorDoLead = Date.now() - 5000;

    const r = await abrirRetorno(env, 1, mensagem({ id: 9002 }), { tentativa: 1 });

    expect(r?.status).toBe('ok');
    expect(postsDoCard()).toHaveLength(1);
    expect(retornos(consultar)).toEqual([expect.objectContaining({ n: 1, mensagem_id: '9002', status: 'feito' })]);
  });

  test('assumir a volta que outra execucao ainda segura: erro para a fila, sem chamar o Chatwoot', async () => {
    const { env, exec, consultar } = cenario();
    exec(`INSERT INTO retornos (tenant_id, cw_conversation_id, n, mensagem_id, task_anterior, protocolo_anterior, created_at, trabalhando_ate)
          VALUES (1, 76, 1, '9001', '1421', '${ANTIGO}', datetime('now', '-11 minutes'), datetime('now', '+30 seconds'))`);

    const r = await abrirRetorno(env, 1, mensagem({ id: 9002 }), { tentativa: 1 });

    expect(r).toEqual({ status: 'erro', motivo: 'outra execucao esta abrindo esta volta' });
    expect(chamadas).toEqual([]);
    expect(retornos(consultar)[0]).toMatchObject({ mensagem_id: '9001', status: 'pendente' });
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
      status: 'pendente', task_novo: null, desligou_antigo: 0, erro: expect.stringContaining('422'), trabalhando_ate: null,
    });
  });

  test('422 duas vezes e a conversa nao volta ao card antigo: desligou_antigo fica 1', async () => {
    // o card antigo ficou sem a conversa: o registro tem de dizer isso
    const { env, consultar } = cenario();
    kb.postsDoCard = [422, 422];
    kb.religarFalha = true;

    await expect(abrirRetorno(env, 1, mensagem(), { tentativa: 1 })).rejects.toThrow(/422/);

    expect(retornos(consultar)[0]).toMatchObject({ status: 'pendente', task_novo: null, desligou_antigo: 1 });
  });

  test('card antigo com outra conversa: so esta sai dele, e a ligacao volta inteira', async () => {
    const { env } = cenario();
    kb.antigo.conversation_ids = [76, 80];
    kb.postsDoCard = [422, 422];

    await expect(abrirRetorno(env, 1, mensagem(), { tentativa: 1 })).rejects.toThrow(/422/);

    expect(ligacoesDoAntigo()).toEqual([{ task: { conversation_ids: [80] } }, { task: { conversation_ids: [76, 80] } }]);
  });

  test('retentativa depois de cair entre soltar o antigo e o segundo POST: a ligacao devolvida inclui esta conversa', async () => {
    // o card antigo ja' foi lido sem a conversa 76: religar so' o que ele tem a deixaria solta
    const { env, exec } = cenario();
    exec(`INSERT INTO retornos (tenant_id, cw_conversation_id, n, mensagem_id, task_anterior, protocolo_anterior, desligou_antigo)
          VALUES (1, 76, 1, '9001', '1421', '${ANTIGO}', 1)`);
    kb.antigo.conversation_ids = [];
    kb.postsDoCard = [422, 422];

    await expect(abrirRetorno(env, 1, mensagem(), { tentativa: 2 })).rejects.toThrow(/422/);

    expect(ligacoesDoAntigo()).toEqual([{ task: { conversation_ids: [] } }, { task: { conversation_ids: [76] } }]);
  });

  test('POST do card com 429: nao e recusa, o erro sobe sem mexer no card antigo', async () => {
    const { env, consultar } = cenario();
    kb.postsDoCard = [429];

    await expect(abrirRetorno(env, 1, mensagem(), { tentativa: 1 })).rejects.toThrow(/429/);

    expect(postsDoCard()).toHaveLength(1);
    expect(ligacoesDoAntigo()).toEqual([]);
    expect(retornos(consultar)[0]).toMatchObject({ status: 'pendente', task_novo: null, desligou_antigo: 0 });
  });

  test('POST do card com 5xx: erro sobe sem mexer no card antigo', async () => {
    const { env, consultar } = cenario();
    kb.postsDoCard = [503];

    await expect(abrirRetorno(env, 1, mensagem(), { tentativa: 1 })).rejects.toThrow(/503/);

    expect(postsDoCard()).toHaveLength(1);
    expect(ligacoesDoAntigo()).toEqual([]);
    expect(retornos(consultar)[0]).toMatchObject({ status: 'pendente', task_novo: null });
  });

  describe('o card da volta nasce uma vez so', () => {
    const cardDaVolta = (over: Record<string, unknown> = {}) => ({
      id: 1500, board_id: FUNIL, board_step_id: NOVO_LEAD, title: `${TITULO} #1`, custom_attributes: { protocolo: `${ANTIGO}-R1` },
      conversation_ids: [76], conversations: [{ id: 900, display_id: 76 }], contacts: [{ id: 555, name: 'Vital', phone_number: FONE }],
      ...over,
    });

    test('POST do card com 200 e sem id: erro final, fora da fila, e a linha fica em erro', async () => {
      // o card pode ter nascido: tentar de novo criaria o segundo " #1"
      const { env, consultar } = cenario();
      kb.postSemId = true;

      const r = await abrirRetorno(env, 1, mensagem(), { tentativa: 1 });

      expect(r).toEqual({ status: 'erro', retentar: false, motivo: expect.stringContaining('sem id') });
      expect(postsDoCard()).toHaveLength(1);
      expect(retornos(consultar)[0]).toMatchObject({
        status: 'erro', task_novo: null, erro: expect.stringContaining('sem id'), trabalhando_ate: null,
      });
    });

    test('volta em erro: a mesma mensagem e as seguintes com o card antigo terminam ignoradas, sem chamar o Chatwoot', async () => {
      const { env } = cenario();
      kb.postSemId = true;
      await abrirRetorno(env, 1, mensagem(), { tentativa: 1 });
      const antes = chamadas.length;

      const mesma = await abrirRetorno(env, 1, mensagem(), { tentativa: 2 });
      const outra = await abrirRetorno(env, 1, mensagem({ id: 9002, content: 'alo?' }), { tentativa: 1 });

      for (const r of [mesma, outra]) expect(r).toEqual({ status: 'ignorado', motivo: expect.stringContaining('volta #1') });
      expect(chamadas).toHaveLength(antes);
    });

    test('pela fila: o 200 sem id sai da fila sem retry', async () => {
      const { env, exec, consultar } = cenario();
      kb.postSemId = true;
      exec(`INSERT INTO events (id, tenant_id, source, event_type, payload)
            VALUES (1, 1, 'chatwoot', 'message_incoming', '${mensagem()}')`);
      const ack = vi.fn();
      const retry = vi.fn();
      const body: QueueMessage = { eventId: 1, tenantId: 1, source: 'chatwoot', eventType: 'message_incoming' };

      await consumir({ messages: [{ body, attempts: 2, ack, retry }] } as unknown as MessageBatch<QueueMessage>, env);

      expect(retry).not.toHaveBeenCalled();
      expect(ack).toHaveBeenCalledTimes(1);
      expect(consultar('SELECT status FROM events WHERE id = 1')).toEqual([{ status: 'erro' }]);
      expect(postsDoCard()).toHaveLength(1);
    });

    test('card ja criado por uma execucao que morreu antes de gravar o task_novo: adota, sem POST', async () => {
      const { env, exec, consultar } = cenario();
      exec(`INSERT INTO retornos (tenant_id, cw_conversation_id, n, mensagem_id, task_anterior, protocolo_anterior)
            VALUES (1, 76, 1, '9001', '1421', '${ANTIGO}')`);
      // a conversa ja' aponta para ele, e o titulo e' o da volta #1
      criado = cardDaVolta();

      const r = await abrirRetorno(env, 1, mensagem(), { tentativa: 2 });

      expect(r?.status).toBe('ok');
      expect(postsDoCard()).toEqual([]);
      expect(retornos(consultar)[0]).toMatchObject({ status: 'feito', task_novo: '1500' });
    });

    test('a conversa aponta para outro card, de titulo diferente: nao adota, cria o da volta', async () => {
      const { env, consultar } = cenario();
      criado = cardDaVolta({ id: 1450, title: '#76 - 5511999990000 - Vital - outro assunto' });

      const r = await abrirRetorno(env, 1, mensagem(), { tentativa: 1 });

      expect(r?.status).toBe('ok');
      expect(postsDoCard()).toHaveLength(1);
      expect(retornos(consultar)[0]).toMatchObject({ status: 'feito', task_novo: '1500' });
    });

    test('falha ao gravar o task_novo depois do POST: a retentativa adota o card, sem segundo POST', async () => {
      const { env, consultar, ganchos } = cenario();
      let falhou = false;
      ganchos.push((sql) => {
        if (!falhou && /SET task_novo = \?/.test(sql)) {
          falhou = true;
          throw new Error('D1_ERROR: D1 DB is overloaded');
        }
      });

      await expect(abrirRetorno(env, 1, mensagem(), { tentativa: 1 })).rejects.toThrow(/overloaded/);
      expect(retornos(consultar)[0]).toMatchObject({ status: 'pendente', task_novo: null, trabalhando_ate: null });

      const r = await abrirRetorno(env, 1, mensagem(), { tentativa: 2 });

      expect(r?.status).toBe('ok');
      expect(postsDoCard()).toHaveLength(1);
      expect(retornos(consultar)[0]).toMatchObject({ status: 'feito', task_novo: '1500' });
    });
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

  test.each([0, -5])('retorno_dias %i: desligado como NULL, sem chamar o Chatwoot', async (dias) => {
    // com 0, qualquer mensagem em card fechado seria volta
    const { env, consultas, consultar } = cenario({ retornoDias: dias });

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

  test('os 15 dias contam ate a hora da mensagem, nao ate agora', async () => {
    // reprocessada 2 dias depois: ate' agora seriam 16 dias, ate' a mensagem sao 14
    const { env, consultar } = cenario();
    const quando = Date.now() - 2 * DIA;
    kb.anteriorDoLead = quando - 14 * DIA;

    expect(await abrirRetorno(env, 1, mensagem({ created_at: new Date(quando).toISOString() }), { tentativa: 1 })).toBeNull();
    expect(postsDoCard()).toEqual([]);
    expect(retornos(consultar)).toEqual([]);
  });

  test('mensagem com mais de 72 horas nunca abre volta: null sem chamar o Chatwoot', async () => {
    // o reprocesso de eventos antigos abriria voltas em lote para mensagens de meses atras
    const { env, consultar } = cenario();
    const quando = Date.now() - 73 * 3600 * 1000;
    kb.anteriorDoLead = quando - 20 * DIA;

    expect(await abrirRetorno(env, 1, mensagem({ created_at: new Date(quando).toISOString() }), { tentativa: 1 })).toBeNull();
    expect(chamadas).toEqual([]);
    expect(retornos(consultar)).toEqual([]);
  });

  test('a hora da mensagem tambem vale quando vem em segundos', async () => {
    const { env } = cenario();
    const quando = Date.now() - 73 * 3600 * 1000;
    kb.anteriorDoLead = quando - 20 * DIA;

    expect(await abrirRetorno(env, 1, mensagem({ created_at: Math.floor(quando / 1000) }), { tentativa: 1 })).toBeNull();
    expect(chamadas).toEqual([]);
  });

  test('mensagem de 47 horas ainda abre a volta', async () => {
    const { env } = cenario();
    const quando = Date.now() - 47 * 3600 * 1000;
    kb.anteriorDoLead = quando - 20 * DIA;

    const r = await abrirRetorno(env, 1, mensagem({ created_at: new Date(quando).toISOString() }), { tentativa: 1 });

    expect(r?.status).toBe('ok');
    expect(postsDoCard()).toHaveLength(1);
  });

  test('volta feita: mensagem antiga com o retrato do card antigo continua final, de qualquer idade', async () => {
    // a idade so' barra abrir volta nova; a mensagem da volta ja' aberta nao cai na atribuicao comum
    const { env, exec } = cenario();
    voltaFeita(exec);
    const quando = new Date(Date.now() - 30 * DIA).toISOString();

    const r = await abrirRetorno(env, 1, mensagem({ id: 9050, created_at: quando, conv: { custom_attributes: {} } }), { tentativa: 1 });

    expect(r).toEqual({ status: 'ignorado', motivo: expect.stringMatching(/volta #1.*card 1500/) });
    expect(chamadas).toEqual([]);
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
    // outro card do Organico, fora da etapa final: a etapa sai do KV
    const outroCard = { task: { id: 1422, board_id: ORGANICO, board_step: { id: 43, name: 'Entrada' } } };
    expect(await abrirRetorno(env, 1, mensagem({ id: 9002, ...outroCard }), { tentativa: 1 })).toBeNull();

    expect(corpoDoCard()).toMatchObject({ board_id: FUNIL, board_step_id: NOVO_LEAD });
    expect(chamadas.filter((c) => /\/kanban\/boards\/8\/steps$/.test(c.url))).toHaveLength(1);
    expect(kv.has(`steps:2:${ORGANICO}`)).toBe(true);
  });

  test('card antigo num board que nao e o Organico, volta de anuncio: o card novo fica no board dele', async () => {
    const { env } = cenario();
    kb.antigo = { ...kb.antigo, board_id: OUTRO, board_step_id: 62 };

    const r = await abrirRetorno(env, 1, mensagem({ task: { board_id: OUTRO, board_step: { id: 62, name: 'Fechado' } } }), { tentativa: 1 });

    expect(r?.status).toBe('ok');
    // o lead e' do Google, mas so' o Organico vai para o funil
    expect(corpoDoCard()).toMatchObject({ board_id: OUTRO, board_step_id: 61 });
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

  test('anuncio da Meta esperando o clique: adia sem card e solta a reserva; a mesma mensagem na volta da fila abre o ciclo', async () => {
    const { env, exec, consultar } = cenario();
    exec(`UPDATE tenant_config SET rastrear_meta_mensagem = 1 WHERE tenant_id = 1`);
    exec(`INSERT INTO ingest_keys (tenant_id, canal, chave) VALUES (1, 'evolution', 'k-evo')`);
    const doAnuncio = mensagem({ content: 'Quero saber mais\n**Aparelho novo**\nhttps://www.instagram.com/p/abc123/' });

    const adiada = await abrirRetorno(env, 1, doAnuncio, { tentativa: 1 });

    expect(adiada?.adiar).toBe(true);
    expect(postsDoCard()).toEqual([]);
    // solta ja': a volta da fila em ~20 s retoma sem esperar o prazo de trabalho vencer
    expect(retornos(consultar)).toEqual([expect.objectContaining({
      mensagem_id: '9001', status: 'pendente', erro: null, trabalhando_ate: null,
    })]);

    const r = await abrirRetorno(env, 1, doAnuncio, { tentativa: 2 });

    expect(r?.status).toBe('ok');
    expect(postsDoCard()).toHaveLength(1);
    expect(retornos(consultar)).toEqual([expect.objectContaining({
      protocolo_novo: 'VITA-CTWA-76-R1', origem: 'anuncio_novo', status: 'feito',
    })]);
  });
});
