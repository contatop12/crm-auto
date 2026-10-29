import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { fakeD1 } from '../helpers/fakeD1';
import { atribuirEmRodizio } from '../../src/pipelines/rodizio';
import type { Env } from '../../src/env';

function cenario(rodizio: string | null = '{"15":[15,13],"16":[12],"17":[14]}') {
  const { d1, exec, consultar } = fakeD1();
  exec(`INSERT INTO tenants (id, slug, nome, ativo) VALUES (4, 'locadora', 'Locadora', 1)`);
  exec(`INSERT INTO tenant_config (tenant_id, cw_account_id, cw_board_funil_id, ingest_key, cw_rodizio) VALUES (4, 5, 9, 'k', ${rodizio ? `'${rodizio}'` : 'NULL'})`);
  return { env: { DB: d1, CHATWOOT_BASE_URL: 'https://cw.teste', CHATWOOT_API_TOKEN: 'tok' } as unknown as Env, consultar };
}

const msg = (o: { inbox?: number; tipo?: string; privada?: boolean; assignee?: unknown; conversa?: number } = {}) =>
  JSON.stringify({
    message_type: o.tipo ?? 'incoming',
    private: o.privada ?? false,
    inbox: { id: o.inbox ?? 15, name: 'Locadora - 8910' },
    conversation: { id: o.conversa ?? 1400, inbox_id: o.inbox ?? 15, meta: { sender: { id: 1363 }, assignee: o.assignee ?? null } },
  });

let chamadas: Array<{ metodo: string; url: string; corpo: unknown }>;
let atualNoChatwoot: unknown;

beforeEach(() => {
  chamadas = [];
  atualNoChatwoot = null;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    chamadas.push({ metodo: init.method ?? 'GET', url: String(url), corpo: init.body ? JSON.parse(String(init.body)) : null });
    if (/\/conversations\/\d+$/.test(String(url))) return Response.json({ id: 1400, meta: { assignee: atualNoChatwoot } });
    return Response.json({});
  });
});
afterEach(() => vi.unstubAllGlobals());

const atribuicoes = () => chamadas.filter((c) => c.metodo === 'POST').map((c) => [c.url.replace('https://cw.teste/api/v1/accounts/5', ''), c.corpo]);

describe('atribuirEmRodizio', () => {
  test('caixa com dois agentes alterna a cada conversa', async () => {
    const { env } = cenario();
    for (const n of [1, 2, 3]) await atribuirEmRodizio(env, 4, msg({ conversa: 1400 + n }));
    expect(atribuicoes().map(([, c]) => (c as { assignee_id: number }).assignee_id)).toEqual([15, 13, 15]);
    expect(atribuicoes()[0]![0]).toBe('/conversations/1401/assignments');
  });

  test('8844 e 2244 sempre o mesmo agente, cada caixa com o seu contador', async () => {
    const { env } = cenario();
    await atribuirEmRodizio(env, 4, msg({ inbox: 16 }));
    await atribuirEmRodizio(env, 4, msg({ inbox: 16 }));
    await atribuirEmRodizio(env, 4, msg({ inbox: 17 }));
    expect(atribuicoes().map(([, c]) => (c as { assignee_id: number }).assignee_id)).toEqual([12, 12, 14]);
  });

  test('conversa que ja tem responsavel nao muda e nao gasta a vez', async () => {
    const { env, consultar } = cenario();
    await atribuirEmRodizio(env, 4, msg({ assignee: { id: 99 } }));
    expect(chamadas).toEqual([]);
    expect(consultar('SELECT * FROM rodizio_estado')).toEqual([]);
  });

  test('payload velho sem responsavel, mas o Chatwoot ja atribuiu: respeita', async () => {
    const { env } = cenario();
    atualNoChatwoot = { id: 77 };
    await atribuirEmRodizio(env, 4, msg());
    expect(atribuicoes()).toEqual([]);
  });

  test('so mensagem do lead, publica', async () => {
    const { env } = cenario();
    await atribuirEmRodizio(env, 4, msg({ tipo: 'outgoing' }));
    await atribuirEmRodizio(env, 4, msg({ privada: true }));
    expect(chamadas).toEqual([]);
  });

  test('desligado, ou caixa fora da lista: nada', async () => {
    await atribuirEmRodizio(cenario(null).env, 4, msg());
    await atribuirEmRodizio(cenario().env, 4, msg({ inbox: 99 }));
    expect(atribuicoes()).toEqual([]);
  });

  test('Locadora: 8910 fora da lista fica sem responsavel, para o time atribuir a mao', async () => {
    const { env, consultar } = cenario('{"16":[12],"17":[14]}');
    await atribuirEmRodizio(env, 4, msg({ inbox: 15 }));
    expect(chamadas).toEqual([]);
    expect(consultar('SELECT * FROM rodizio_estado')).toEqual([]);
  });

  test('falha da API nunca sobe como erro', async () => {
    const { env } = cenario();
    vi.stubGlobal('fetch', async () => new Response('x', { status: 500 }));
    await expect(atribuirEmRodizio(env, 4, msg())).resolves.toBeUndefined();
  });
});
