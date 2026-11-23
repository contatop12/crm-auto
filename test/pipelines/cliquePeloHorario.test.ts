import { describe, test, expect, afterEach, vi } from 'vitest';
import { fakeD1 } from '../helpers/fakeD1';
import {
  agendarCliquePeloHorario,
  ligarCliquePeloHorario,
  EVENTO_CLIQUE_PELO_HORARIO,
} from '../../src/pipelines/cliquePeloHorario';
import { ESPERA_S } from '../../src/domain/cliquePeloHorario';
import { consumir } from '../../src/queue/consumer';
import type { Env, QueueMessage } from '../../src/env';

/**
 * Conversa 1724 da Locadora, 21/11/2026: o lead clicou no anuncio do Google e
 * mandou a mensagem com o protocolo, mas a Evolution so' entregou as respostas
 * automaticas do WhatsApp Business. Sem a mensagem o CRM nunca viu o protocolo,
 * e o lead pago ficou dois dias no Organico, sem aviso, sem linha na planilha e
 * sem conversao. O clique estava gravado 12 s antes de a conversa nascer.
 */

const CONVERSA = 1724;
const PROTOCOLO = 'ANDAIM-TESTE0000001';
const SAUDACAO = 'Olá! Seja muito bem-vindo(a) à Locadora Exatidão 🤝\nNossa equipe está pronta.';
const TELEFONE = '+5511988887777';

/** A conversa nasceu ha' `s` segundos. */
const criadaHa = (s: number) => Math.floor(Date.now() / 1000) - s;
/** Texto de data do D1 (UTC) para `s` segundos depois de `base`. */
const d1 = (base: number, s = 0) => new Date((base + s) * 1000).toISOString().slice(0, 19).replace('T', ' ');

function cenario() {
  const { d1: banco, exec, consultar } = fakeD1();
  exec(`INSERT INTO tenants (id, slug, nome, ativo) VALUES (1, 'locadora', 'Locadora', 1)`);
  exec(`INSERT INTO tenant_config (tenant_id, cw_account_id, cw_board_funil_id, cw_board_organico_id, ingest_key, janela_match_dias)
        VALUES (1, 5, 9, 10, 'k', 90)`);
  exec(`INSERT INTO respostas_automaticas (tenant_id, frase) VALUES (1, 'Seja muito bem-vindo(a) à Locadora')`);
  const fila: Array<{ corpo: Record<string, unknown>; opcoes: { delaySeconds?: number } | undefined }> = [];
  const kv = new Map<string, string>();
  const env = {
    DB: banco,
    CHATWOOT_BASE_URL: 'https://cw.teste',
    CHATWOOT_API_TOKEN: 't',
    QUEUE: { send: async (corpo: Record<string, unknown>, opcoes?: { delaySeconds?: number }) => { fila.push({ corpo, opcoes }); } },
    CACHE: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => { kv.set(k, v); },
    },
  } as unknown as Env;
  return { env, exec, consultar, fila };
}

/** Clique do site, como o GTM grava: sem telefone ate' o lead escrever. */
function clique(exec: (sql: string) => void, protocolo: string, quando: string, over: { evento?: string; phone_key?: string | null } = {}) {
  const tel = over.phone_key ? `'${over.phone_key}'` : 'NULL';
  exec(`INSERT INTO leads (tenant_id, protocol, gclid, utm_source, utm_medium, origem, evento, phone_key, created_at)
        VALUES (1, '${protocolo}', 'Cj0abc', 'google', 'cpc', 'clique', '${over.evento ?? 'whatsapp_click'}', ${tel}, '${quando}')`);
}

/** Webhook da mensagem enviada (a resposta automatica, por padrao). */
function enviada(over: Record<string, unknown> = {}, conv: Record<string, unknown> = {}) {
  return JSON.stringify({
    event: 'message_outgoing',
    message_type: 'outgoing',
    private: false,
    content: SAUDACAO,
    conversation: { id: CONVERSA, created_at: criadaHa(1), custom_attributes: {}, ...conv },
    ...over,
  });
}

interface Chamada { metodo: string; url: string; corpo: Record<string, unknown> | null }

/** Chatwoot de mentira: a conversa e as mensagens dela. */
function chatwoot(o: {
  criada: number;
  mensagens: Array<Record<string, unknown>>;
  atributos?: Record<string, string>;
}) {
  const chamadas: Chamada[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const u = String(url);
    const metodo = String(init.method ?? 'GET');
    chamadas.push({ metodo, url: u, corpo: init.body ? JSON.parse(String(init.body)) : null });
    if (metodo === 'GET' && /\/conversations\/1724\/messages/.test(u)) {
      const antes = Number(/before=(\d+)/.exec(u)?.[1] ?? Infinity);
      const pagina = o.mensagens.filter((m) => Number(m.id) < antes).slice(-20);
      return Response.json({ payload: pagina });
    }
    if (metodo === 'GET' && /\/conversations\/1724$/.test(u)) {
      return Response.json({
        id: CONVERSA,
        created_at: o.criada,
        custom_attributes: o.atributos ?? {},
        labels: [],
        meta: { sender: { name: '5511988887777', phone_number: TELEFONE } },
        kanban_task: { id: 5421 },
      });
    }
    return Response.json({ ok: true });
  });
  const escritas = (re: RegExp) => chamadas.filter((c) => c.metodo !== 'GET' && re.test(c.url));
  return { chamadas, escritas };
}

const msg = (id: number, tipo: number, content: string) => ({ id, message_type: tipo, content, created_at: 1 });
const job = JSON.stringify({ conversa: CONVERSA });

afterEach(() => vi.unstubAllGlobals());

describe('agendarCliquePeloHorario', () => {
  test('resposta automatica numa conversa nova sem protocolo agenda a conferencia', async () => {
    const { env, fila, consultar } = cenario();

    expect(await agendarCliquePeloHorario(env, 1, enviada())).toBe(true);

    expect(fila).toHaveLength(1);
    expect(fila[0]!.corpo).toMatchObject({ tenantId: 1, source: 'chatwoot', eventType: EVENTO_CLIQUE_PELO_HORARIO });
    expect(fila[0]!.opcoes).toEqual({ delaySeconds: ESPERA_S });
    const ev = consultar(`SELECT event_type, payload FROM events`)[0] as { event_type: string; payload: string };
    expect(ev.event_type).toBe(EVENTO_CLIQUE_PELO_HORARIO);
    expect(JSON.parse(ev.payload)).toEqual({ conversa: CONVERSA });
  });

  test('a segunda resposta automatica da mesma conversa nao agenda de novo', async () => {
    const { env, fila } = cenario();
    await agendarCliquePeloHorario(env, 1, enviada());
    expect(await agendarCliquePeloHorario(env, 1, enviada({ content: SAUDACAO + ' de novo' }))).toBe(false);
    expect(fila).toHaveLength(1);
  });

  test.each([
    ['mensagem de atendente', enviada({ content: 'Bom dia, tudo bem? Aqui é a Ana da Locadora' })],
    ['conversa que ja tem protocolo', enviada({}, { custom_attributes: { protocolo: 'EXATID-JAATRIBUIDA01' } })],
    ['conversa antiga', enviada({}, { created_at: criadaHa(3600) })],
    ['nota interna', enviada({ private: true })],
    ['mensagem do lead', enviada({ message_type: 'incoming' })],
  ])('nao agenda: %s', async (_nome, payload) => {
    const { env, fila } = cenario();
    expect(await agendarCliquePeloHorario(env, 1, payload)).toBe(false);
    expect(fila).toHaveLength(0);
  });

  test('falha ao agendar nao queima a vez: a proxima resposta automatica agenda', async () => {
    const c = cenario();
    const fila = c.env.QUEUE;
    let falhas = 1;
    (c.env as unknown as { QUEUE: unknown }).QUEUE = {
      send: async (corpo: QueueMessage, opcoes?: { delaySeconds?: number }) => {
        if (falhas-- > 0) throw new Error('fila fora do ar');
        return fila.send(corpo, opcoes);
      },
    };

    expect(await agendarCliquePeloHorario(c.env, 1, enviada())).toBe(false);
    expect(await agendarCliquePeloHorario(c.env, 1, enviada())).toBe(true);
    expect(c.fila).toHaveLength(1);
  });

  test('cliente sem resposta automatica cadastrada: a rede fica desligada', async () => {
    const { env, exec, fila } = cenario();
    exec(`DELETE FROM respostas_automaticas`);
    expect(await agendarCliquePeloHorario(env, 1, enviada())).toBe(false);
    expect(fila).toHaveLength(0);
  });
});

describe('ligarCliquePeloHorario', () => {
  test('conversa que abriu so com a saudacao e tem um clique sem telefone logo antes: liga ao clique', async () => {
    const { env, exec, consultar } = cenario();
    const criada = criadaHa(80);
    clique(exec, PROTOCOLO, d1(criada, -12));
    const cw = chatwoot({ criada, mensagens: [msg(10, 1, SAUDACAO)] });

    const r = await ligarCliquePeloHorario(env, 1, job);

    expect(r.status).toBe('ok');
    expect(r.motivo).toContain(`conversa ${CONVERSA} ligada ao clique ${PROTOCOLO} pelo horario`);
    const attrs = cw.escritas(/custom_attributes/)[0]!.corpo!.custom_attributes as Record<string, string>;
    expect(attrs.protocolo).toBe(PROTOCOLO);
    expect(attrs.funil).toBe('PROMOVER');
    expect(consultar(`SELECT protocol, origem FROM conversations WHERE cw_conversation_id = ${CONVERSA}`)[0])
      .toEqual({ protocol: PROTOCOLO, origem: 'anuncio' });
    expect((consultar(`SELECT phone_key FROM leads WHERE protocol = '${PROTOCOLO}'`)[0] as { phone_key: string }).phone_key)
      .toBe('1188887777');
  });

  test('deixa uma nota interna dizendo que a ligacao foi pelo horario', async () => {
    const { env, exec } = cenario();
    const criada = criadaHa(80);
    clique(exec, PROTOCOLO, d1(criada, -12));
    const cw = chatwoot({ criada, mensagens: [msg(10, 1, SAUDACAO)] });

    await ligarCliquePeloHorario(env, 1, job);

    const nota = cw.escritas(/\/conversations\/1724\/messages$/)[0]!.corpo!;
    expect(nota.private).toBe(true);
    expect(nota.message_type).toBe('outgoing');
    expect(String(nota.content)).toContain(PROTOCOLO);
    expect(String(nota.content)).toContain('primeira mensagem deste lead não chegou');
  });

  test('o lead escreveu antes da saudacao: nada se perdeu, nao liga', async () => {
    const { env, exec } = cenario();
    const criada = criadaHa(80);
    clique(exec, PROTOCOLO, d1(criada, -12));
    const cw = chatwoot({ criada, mensagens: [msg(9, 0, 'Olá, quero alugar um andaime'), msg(10, 1, SAUDACAO)] });

    const r = await ligarCliquePeloHorario(env, 1, job);

    expect(r.status).toBe('ignorado');
    expect(r.motivo).toContain('nao abriu so com a resposta automatica');
    expect(cw.escritas(/./)).toHaveLength(0);
  });

  test('conversa que ja ganhou protocolo (a mensagem chegou): nao mexe', async () => {
    const { env, exec } = cenario();
    const criada = criadaHa(80);
    clique(exec, PROTOCOLO, d1(criada, -12));
    const cw = chatwoot({ criada, mensagens: [msg(10, 1, SAUDACAO)], atributos: { protocolo: 'EXATID-JAATRIBUIDA01' } });

    const r = await ligarCliquePeloHorario(env, 1, job);

    expect(r).toEqual({ status: 'ignorado', motivo: `conversa ${CONVERSA} ja tem protocolo` });
    expect(cw.escritas(/./)).toHaveLength(0);
  });

  test('dois cliques sem telefone no horario: nao da para saber qual, nao liga', async () => {
    const { env, exec } = cenario();
    const criada = criadaHa(80);
    clique(exec, PROTOCOLO, d1(criada, -12));
    clique(exec, 'EXATID-TESTE0000002', d1(criada, -50));
    const cw = chatwoot({ criada, mensagens: [msg(10, 1, SAUDACAO)] });

    const r = await ligarCliquePeloHorario(env, 1, job);

    expect(r.status).toBe('ignorado');
    expect(r.motivo).toContain('2 cliques sem telefone no horario');
    expect(cw.escritas(/./)).toHaveLength(0);
  });

  test.each([
    ['clique de mais de 2 min antes', (c: number) => ({ quando: d1(c, -300) })],
    ['clique que ja tem telefone (outro lead)', (c: number) => ({ quando: d1(c, -12), over: { phone_key: '1177776666' } })],
    ['envio de formulario', (c: number) => ({ quando: d1(c, -12), over: { evento: 'form_submit' } })],
  ])('nao e candidato: %s', async (_nome, monta) => {
    const { env, exec } = cenario();
    const criada = criadaHa(80);
    const { quando, over } = monta(criada) as { quando: string; over?: { evento?: string; phone_key?: string } };
    clique(exec, PROTOCOLO, quando, over);
    const cw = chatwoot({ criada, mensagens: [msg(10, 1, SAUDACAO)] });

    const r = await ligarCliquePeloHorario(env, 1, job);

    expect(r.status).toBe('ignorado');
    expect(r.motivo).toContain('nenhum clique sem telefone no horario');
    expect(cw.escritas(/./)).toHaveLength(0);
  });

  test('clique que outra conversa ja usou nao e candidato', async () => {
    const { env, exec } = cenario();
    const criada = criadaHa(80);
    clique(exec, PROTOCOLO, d1(criada, -12));
    exec(`INSERT INTO conversations (tenant_id, cw_conversation_id, protocol, origem) VALUES (1, 999, '${PROTOCOLO}', 'anuncio')`);
    chatwoot({ criada, mensagens: [msg(10, 1, SAUDACAO)] });

    const r = await ligarCliquePeloHorario(env, 1, job);

    expect(r.status).toBe('ignorado');
    expect(r.motivo).toContain('nenhum clique sem telefone no horario');
  });

  test('telefone que ja tem lead (formulario, clique antigo): a atribuicao normal cuida', async () => {
    const { env, exec } = cenario();
    const criada = criadaHa(80);
    clique(exec, PROTOCOLO, d1(criada, -12));
    clique(exec, 'EXATID-DOTELEFONE01', d1(criada, -3600), { phone_key: '1188887777', evento: 'form_submit' });
    const cw = chatwoot({ criada, mensagens: [msg(10, 1, SAUDACAO)] });

    const r = await ligarCliquePeloHorario(env, 1, job);

    expect(r.status).toBe('ignorado');
    expect(r.motivo).toContain('telefone ja tem lead (EXATID-DOTELEFONE01)');
    expect(cw.escritas(/./)).toHaveLength(0);
  });

  test('conversa longa: busca as paginas anteriores ate achar a primeira mensagem', async () => {
    const { env, exec } = cenario();
    const criada = criadaHa(80);
    clique(exec, PROTOCOLO, d1(criada, -12));
    // 25 mensagens: a do lead e' a mais antiga, fora da ultima pagina de 20
    const mensagens = [msg(1, 0, 'Olá, quero alugar'), msg(2, 1, SAUDACAO), ...Array.from({ length: 23 }, (_, i) => msg(3 + i, 1, 'resposta'))];
    chatwoot({ criada, mensagens });

    const r = await ligarCliquePeloHorario(env, 1, job);

    expect(r.status).toBe('ignorado');
    expect(r.motivo).toContain('nao abriu so com a resposta automatica');
  });

  test('retentativa depois de falha no meio: retoma com o mesmo clique', async () => {
    // A atribuicao grava o telefone no lead e o protocolo em `conversations`
    // antes de escrever no Chatwoot. Se o Chatwoot falha ai', na volta da fila
    // o clique ja' nao e' "sem telefone" — sem retomar, o lead se perdia de novo.
    const { env, exec, consultar } = cenario();
    const criada = criadaHa(120);
    clique(exec, PROTOCOLO, d1(criada, -12), { phone_key: '1188887777' });
    exec(`INSERT INTO conversations (tenant_id, cw_conversation_id, protocol, phone_key) VALUES (1, ${CONVERSA}, '${PROTOCOLO}', '1188887777')`);
    const cw = chatwoot({ criada, mensagens: [msg(10, 1, SAUDACAO)], atributos: { protocolo: PROTOCOLO } });

    const r = await ligarCliquePeloHorario(env, 1, job, { tentativa: 2 });

    expect(r.status).toBe('ok');
    expect((cw.escritas(/custom_attributes/)[0]!.corpo!.custom_attributes as Record<string, string>).protocolo).toBe(PROTOCOLO);
    expect((consultar(`SELECT origem FROM conversations WHERE cw_conversation_id = ${CONVERSA}`)[0] as { origem: string }).origem).toBe('anuncio');
  });

  test('duas conferencias da mesma conversa ao mesmo tempo: so uma atribui', async () => {
    // A saudacao sai em duas mensagens seguidas e as duas podem agendar (a
    // trava do agendamento nao e' atomica). Sem uma trava no banco, as duas
    // conferencias atribuiam o mesmo clique e deixavam duas notas.
    const { env, exec } = cenario();
    const criada = criadaHa(80);
    clique(exec, PROTOCOLO, d1(criada, -12));
    const cw = chatwoot({ criada, mensagens: [msg(10, 1, SAUDACAO)] });

    const [a, b] = await Promise.all([ligarCliquePeloHorario(env, 1, job), ligarCliquePeloHorario(env, 1, job)]);

    expect([a.status, b.status].sort()).toEqual(['ignorado', 'ok']);
    expect(cw.escritas(/\/conversations\/1724\/messages$/)).toHaveLength(1);
  });

  test('atribuicao em andamento vista na primeira entrega e de outra execucao: nao mexe', async () => {
    const { env, exec } = cenario();
    const criada = criadaHa(80);
    clique(exec, PROTOCOLO, d1(criada, -12), { phone_key: '1188887777' });
    exec(`INSERT INTO conversations (tenant_id, cw_conversation_id, protocol, phone_key) VALUES (1, ${CONVERSA}, '${PROTOCOLO}', '1188887777')`);
    const cw = chatwoot({ criada, mensagens: [msg(10, 1, SAUDACAO)] });

    const r = await ligarCliquePeloHorario(env, 1, job);

    expect(r.status).toBe('ignorado');
    expect(cw.escritas(/./)).toHaveLength(0);
  });

  test('numero da propria empresa: nao liga e nao deixa a conversa presa ao clique', async () => {
    const { env, exec, consultar } = cenario();
    exec(`UPDATE tenant_config SET numeros_proprios = '["5511988887777"]' WHERE tenant_id = 1`);
    const criada = criadaHa(80);
    clique(exec, PROTOCOLO, d1(criada, -12));
    const cw = chatwoot({ criada, mensagens: [msg(10, 1, SAUDACAO)] });

    const r = await ligarCliquePeloHorario(env, 1, job);

    expect(r.status).toBe('ignorado');
    expect(consultar(`SELECT 1 FROM conversations WHERE cw_conversation_id = ${CONVERSA}`)).toHaveLength(0);
    expect(cw.escritas(/./)).toHaveLength(0);
  });

  test('atribuicao normal que ficou pela metade nao e retomada como se fosse pelo horario', async () => {
    // O lead escreveu (com protocolo) e a atribuicao comum parou antes de gravar
    // a origem. A conferencia nao pode refazer isso nem dizer, na nota, que a
    // mensagem dele nao chegou.
    const { env, exec } = cenario();
    const criada = criadaHa(80);
    clique(exec, PROTOCOLO, d1(criada, -12), { phone_key: '1188887777' });
    exec(`INSERT INTO conversations (tenant_id, cw_conversation_id, protocol, phone_key) VALUES (1, ${CONVERSA}, '${PROTOCOLO}', '1188887777')`);
    const cw = chatwoot({
      criada,
      mensagens: [msg(9, 0, `Olá! [Protocolo: ${PROTOCOLO}]`), msg(10, 1, SAUDACAO)],
      atributos: { protocolo: PROTOCOLO },
    });

    const r = await ligarCliquePeloHorario(env, 1, job);

    expect(r.status).toBe('ignorado');
    expect(cw.escritas(/./)).toHaveLength(0);
  });
});

describe('na fila do CRM', () => {
  /** Grava o evento e entrega a mensagem ao consumidor, como a fila faz. */
  async function entregar(c: ReturnType<typeof cenario>, eventType: string, payload: string) {
    c.exec(`INSERT INTO events (id, tenant_id, source, event_type, payload, status) VALUES (500, 1, 'chatwoot', '${eventType}', '${payload.replace(/'/g, "''")}', 'recebido')`);
    const body: QueueMessage = { eventId: 500, tenantId: 1, source: 'chatwoot', eventType };
    await consumir({ messages: [{ body, attempts: 1, ack: () => undefined, retry: () => undefined }] } as unknown as MessageBatch<QueueMessage>, c.env);
    return c.consultar(`SELECT status, motivo FROM events WHERE id = 500`)[0] as { status: string; motivo: string };
  }

  test('a resposta automatica que chega pelo webhook agenda a conferencia', async () => {
    const c = cenario();
    chatwoot({ criada: criadaHa(1), mensagens: [msg(10, 1, SAUDACAO)] });

    await entregar(c, 'message_outgoing', enviada());

    expect(c.fila.map((f) => f.corpo.eventType)).toEqual([EVENTO_CLIQUE_PELO_HORARIO]);
  });

  test('a conferencia agendada liga a conversa ao clique e o evento fica ok', async () => {
    const c = cenario();
    const criada = criadaHa(80);
    clique(c.exec, PROTOCOLO, d1(criada, -12));
    chatwoot({ criada, mensagens: [msg(10, 1, SAUDACAO)] });

    const ev = await entregar(c, EVENTO_CLIQUE_PELO_HORARIO, job);

    expect(ev.status).toBe('ok');
    expect(ev.motivo).toContain(`ligada ao clique ${PROTOCOLO} pelo horario`);
  });
});
