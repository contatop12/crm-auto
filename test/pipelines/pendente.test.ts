import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { fakeD1 } from '../helpers/fakeD1';
import { moverParaPendente, voltarDoPendente } from '../../src/pipelines/pendente';
import type { Env } from '../../src/env';

const H = 3600 * 1000;
const STEPS = [
  { id: 37, name: 'Qualificando' }, { id: 38, name: 'Proposta Enviada' },
  { id: 75, name: 'Pendente' }, { id: 40, name: 'Oportunidade Perdida' },
];

function cenario() {
  const { d1, exec } = fakeD1();
  exec(`INSERT INTO tenants (id, slug, nome, ativo) VALUES (4, 'locadora', 'Locadora', 1)`);
  exec(`INSERT INTO tenant_config (tenant_id, cw_account_id, cw_board_funil_id, ingest_key) VALUES (4, 5, 9, 'k')`);
  return { DB: d1, CHATWOOT_BASE_URL: 'https://cw.teste', CHATWOOT_API_TOKEN: 'tok' } as unknown as Env;
}

const iso = (msAtras: number) => new Date(Date.now() - msAtras).toISOString();
const seg = (msAtras: number) => Math.floor((Date.now() - msAtras) / 1000);

let chamadas: Array<{ metodo: string; url: string; corpo: unknown }>;

/** Chatwoot de mentira: steps, tasks e mensagens por conversa. */
function chatwoot(tasks: unknown[], mensagens: Record<number, unknown[]> = {}) {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const u = String(url);
    chamadas.push({ metodo: init.method ?? 'GET', url: u, corpo: init.body ? JSON.parse(String(init.body)) : null });
    if (/\/kanban\/boards\/9\/steps$/.test(u)) return Response.json({ steps: STEPS });
    if (/\/kanban\/tasks\?board_id=9/.test(u)) return Response.json({ tasks, meta: { has_more: false } });
    const m = /\/conversations\/(\d+)\/messages/.exec(u);
    if (m) return Response.json({ payload: /before=/.test(u) ? [] : (mensagens[Number(m[1])] ?? []) });
    return Response.json({ ok: true });
  });
}

const moveuPara = () =>
  chamadas.filter((c) => /\/move$/.test(c.url)).map((c) => ({
    task: Number(/tasks\/(\d+)\/move/.exec(c.url)![1]),
    step: (c.corpo as { board_step_id: number }).board_step_id,
  }));

beforeEach(() => { chamadas = []; });
afterEach(() => vi.unstubAllGlobals());

describe('moverParaPendente', () => {
  test('proposta parada e lead calado ha 3 dias vai para Pendente; quem falou fica', async () => {
    chatwoot(
      [
        // Tiao: proposta ha 4,7 dias, ninguem falou desde entao
        { id: 3724, board_step_id: 38, step_changed_at: iso(113 * H), conversations: [{ id: 1, display_id: 1238 }] },
        // Araujo: proposta ha 33 dias, mas o lead falou ontem
        { id: 2406, board_step_id: 38, step_changed_at: iso(33 * 24 * H), conversations: [{ id: 2, display_id: 664 }] },
        // proposta enviada ontem: nem pergunta pelas mensagens
        { id: 3950, board_step_id: 38, step_changed_at: iso(20 * H), conversations: [{ id: 3, display_id: 1300 }] },
        // fora da etapa
        { id: 3905, board_step_id: 37, step_changed_at: iso(200 * H), conversations: [{ id: 4, display_id: 1293 }] },
      ],
      {
        1238: [{ id: 10, message_type: 0, created_at: seg(113 * H) }, { id: 11, message_type: 1, created_at: seg(112 * H) }],
        664: [{ id: 20, message_type: 1, created_at: seg(46 * H) }, { id: 21, message_type: 0, created_at: seg(43 * H) }],
      },
    );

    await moverParaPendente(cenario());

    expect(moveuPara()).toEqual([{ task: 3724, step: 75 }]);
    expect(chamadas.some((c) => /conversations\/1300\//.test(c.url))).toBe(false);
  });

  test('card sem conversa (orfao) nao e movido', async () => {
    chatwoot([{ id: 1277, board_step_id: 38, step_changed_at: iso(48 * 24 * H), conversations: [] }]);
    await moverParaPendente(cenario());
    expect(moveuPara()).toEqual([]);
  });

  test('funil sem a coluna Pendente: nao le os cards', async () => {
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      chamadas.push({ metodo: init.method ?? 'GET', url: String(url), corpo: null });
      return Response.json({ steps: STEPS.filter((s) => s.name !== 'Pendente') });
    });
    await moverParaPendente(cenario());
    expect(chamadas.map((c) => c.url)).toEqual(['https://cw.teste/api/v1/accounts/5/kanban/boards/9/steps']);
  });
});

describe('voltarDoPendente', () => {
  const msg = (over: Record<string, unknown> = {}, etapa = 'Pendente') =>
    JSON.stringify({
      message_type: 'incoming',
      private: false,
      content: 'oi, ainda tenho interesse',
      conversation: { id: 1238, kanban_task: { id: 3724, board_id: 9, board_step: { id: 75, name: etapa } } },
      ...over,
    });

  test('lead respondeu: o card volta para Proposta Enviada', async () => {
    chatwoot([]);
    await voltarDoPendente(cenario(), 4, msg());
    expect(moveuPara()).toEqual([{ task: 3724, step: 38 }]);
  });

  test('resposta do vendedor nao tira o card do Pendente', async () => {
    chatwoot([]);
    await voltarDoPendente(cenario(), 4, msg({ message_type: 'outgoing' }));
    expect(chamadas).toEqual([]);
  });

  test('card fora do Pendente: nao custa chamada', async () => {
    chatwoot([]);
    await voltarDoPendente(cenario(), 4, msg({}, 'Proposta Enviada'));
    expect(chamadas).toEqual([]);
  });

  test('Chatwoot fora do ar nao derruba quem chamou', async () => {
    vi.stubGlobal('fetch', async () => new Response('erro', { status: 502 }));
    await expect(voltarDoPendente(cenario(), 4, msg())).resolves.toBeUndefined();
  });
});
