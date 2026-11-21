import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from '../../src/index';
import { fakeD1 } from '../helpers/fakeD1';
import type { Env } from '../../src/env';

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const FUNIL = 7;

function ambiente() {
  const f = fakeD1();
  f.exec(`INSERT INTO tenants (id, slug, nome, ativo) VALUES (1, 'vita', 'Vita', 1)`);
  f.exec(`INSERT INTO tenant_config (tenant_id, cw_account_id, cw_board_funil_id, ingest_key)
          VALUES (1, 2, ${FUNIL}, 'k')`);
  const env = {
    DB: f.d1, PANEL_PUBLIC: 'true', CHATWOOT_BASE_URL: 'https://cw.teste', CHATWOOT_API_TOKEN: 'tok',
  } as unknown as Env;
  return { ...f, env };
}

// dois cards sem conversa: o 100 foi desligado por uma volta, o 200 e' orfao de verdade
beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    const u = String(url);
    if (u.includes('/kanban/boards/') && u.endsWith('/steps')) return Response.json({ steps: [{ id: 27, name: 'Novo Lead' }] });
    if (u.endsWith('/kanban/boards')) return Response.json({ boards: [{ id: FUNIL, name: 'Funil' }] });
    if (u.includes('/kanban/tasks?')) {
      return Response.json({
        tasks: [
          { id: 100, board_id: FUNIL, board_step_id: 27, title: '#1 - 5511999990000 - Vital', conversations: [] },
          { id: 200, board_id: FUNIL, board_step_id: 27, title: '#2 - 5511999990001 - Outro', conversations: [] },
        ],
        meta: { has_more: false },
      });
    }
    if (u.includes('/conversations?')) return Response.json({ data: { meta: { all_count: 0 }, payload: [] } });
    return Response.json({});
  });
});
afterEach(() => vi.unstubAllGlobals());

const orfaos = async (env: Env) => {
  const r = await worker.fetch(new Request('https://crm.teste/api/tenants/1/cards-orfaos'), env, ctx);
  expect(r.status).toBe(200);
  return (await r.json()) as { resumo: Array<{ orfaos: number }>; cards: Array<{ taskId: number }> };
};

describe('cards-orfaos', () => {
  test('sem volta, todo card sem conversa aparece', async () => {
    const { env } = ambiente();
    expect((await orfaos(env)).cards.map((c) => c.taskId)).toEqual([100, 200]);
  });

  test('o card que uma volta desligou da conversa nao e orfao: foi de proposito', async () => {
    const { env, exec } = ambiente();
    exec(`INSERT INTO retornos (tenant_id, cw_conversation_id, n, task_anterior, task_novo, desligou_antigo, status)
          VALUES (1, 76, 1, '100', '300', 1, 'concluido')`);
    const r = await orfaos(env);
    expect(r.cards.map((c) => c.taskId)).toEqual([200]);
    expect(r.resumo[0]!.orfaos).toBe(1);
  });

  test('volta que ainda nao desligou o card antigo nao esconde nada', async () => {
    const { env, exec } = ambiente();
    exec(`INSERT INTO retornos (tenant_id, cw_conversation_id, n, task_anterior, desligou_antigo)
          VALUES (1, 76, 1, '100', 0)`);
    expect((await orfaos(env)).cards.map((c) => c.taskId)).toEqual([100, 200]);
  });
});
