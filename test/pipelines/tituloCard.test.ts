import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { fakeD1 } from '../helpers/fakeD1';
import { telefoneNoTituloDoCard } from '../../src/pipelines/tituloCard';
import type { Env } from '../../src/env';

function cenario() {
  const { d1, exec } = fakeD1();
  exec(`INSERT INTO tenants (id, slug, nome, ativo) VALUES (1, 'locadora', 'Locadora', 1)`);
  exec(`INSERT INTO tenant_config (tenant_id, cw_account_id, cw_board_funil_id, ingest_key) VALUES (1, 5, 9, 'k')`);
  return { DB: d1, CHATWOOT_BASE_URL: 'https://cw.teste', CHATWOOT_API_TOKEN: 'tok' } as unknown as Env;
}

/** Webhook de mensagem, na forma que o Chatwoot manda (conta 5, conversa 1240). */
const msg = (task: Record<string, unknown> | null, telefone: string | null = '+5511932346062') =>
  JSON.stringify({
    message_type: 'incoming',
    content: 'oi',
    conversation: {
      id: 1240,
      meta: { sender: { name: 'Vital', phone_number: telefone } },
      ...(task ? { kanban_task: { id: 3744, board_id: 9, title: 'Conversa #1240 - Vital', ...task } } : {}),
    },
  });

let chamadas: Array<{ metodo: string; url: string; corpo: unknown }>;

beforeEach(() => {
  chamadas = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    chamadas.push({ metodo: init.method ?? 'GET', url: String(url), corpo: init.body ? JSON.parse(String(init.body)) : null });
    return Response.json({ ok: true });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('telefoneNoTituloDoCard', () => {
  test('o card vira #conversa - telefone - nome', async () => {
    await telefoneNoTituloDoCard(cenario(), 1, msg({}));
    expect(chamadas).toEqual([{
      metodo: 'PUT',
      url: 'https://cw.teste/api/v1/accounts/5/kanban/tasks/3744',
      corpo: { task: { title: '#1240 - 5511932346062 - Vital' } },
    }]);
  });

  test('titulo ja no formato nao custa chamada', async () => {
    await telefoneNoTituloDoCard(cenario(), 1, msg({ title: '#1240 - 5511932346062 - Vital' }));
    expect(chamadas).toEqual([]);
  });

  test('primeira mensagem, antes do card no webhook: pergunta ao Chatwoot e ja troca', async () => {
    // lead #1293 da Locadora: o 1o webhook veio sem card e o titulo ficou com
    // o nome ate' a mensagem seguinte
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      chamadas.push({ metodo: init.method ?? 'GET', url: String(url), corpo: init.body ? JSON.parse(String(init.body)) : null });
      if (/\/conversations\/1240$/.test(String(url))) {
        return Response.json({ id: 1240, kanban_task: { id: 3744, title: 'Conversa #1240 - Vital' } });
      }
      return Response.json({ ok: true });
    });
    const agora = JSON.parse(msg(null));
    agora.conversation.created_at = Math.floor(Date.now() / 1000) - 2;

    await telefoneNoTituloDoCard(cenario(), 1, JSON.stringify(agora));
    expect(chamadas.map((c) => `${c.metodo} ${c.url}`)).toEqual([
      'GET https://cw.teste/api/v1/accounts/5/conversations/1240',
      'PUT https://cw.teste/api/v1/accounts/5/kanban/tasks/3744',
    ]);
    expect(chamadas[1]!.corpo).toEqual({ task: { title: '#1240 - 5511932346062 - Vital' } });
  });

  test('conversa recem-criada cujo card ainda nao nasceu: so a pergunta, sem troca', async () => {
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      chamadas.push({ metodo: init.method ?? 'GET', url: String(url), corpo: null });
      return Response.json({ id: 1240 });
    });
    const agora = JSON.parse(msg(null));
    agora.conversation.created_at = Math.floor(Date.now() / 1000);

    await telefoneNoTituloDoCard(cenario(), 1, JSON.stringify(agora));
    expect(chamadas.map((c) => c.metodo)).toEqual(['GET']);
  });

  test('conversa antiga sem card: nao pergunta nada', async () => {
    // card ausente em conversa velha e' card que nao existe; perguntar a cada
    // mensagem so' gastaria chamada
    const velha = JSON.parse(msg(null));
    velha.conversation.created_at = Math.floor(Date.now() / 1000) - 3600;

    await telefoneNoTituloDoCard(cenario(), 1, JSON.stringify(velha));
    expect(chamadas).toEqual([]);
  });

  test('grupo, sem telefone: o titulo fica', async () => {
    await telefoneNoTituloDoCard(cenario(), 1, msg({ title: 'Conversa #12 - GALERA 3D (GROUP)' }, null));
    expect(chamadas).toEqual([]);
  });

  test('Chatwoot fora do ar nao derruba quem chamou', async () => {
    vi.stubGlobal('fetch', async () => new Response('erro', { status: 502 }));
    await expect(telefoneNoTituloDoCard(cenario(), 1, msg({}))).resolves.toBeUndefined();
  });

  test('payload que nao e json nao derruba quem chamou', async () => {
    await expect(telefoneNoTituloDoCard(cenario(), 1, 'nao e json')).resolves.toBeUndefined();
    expect(chamadas).toEqual([]);
  });
});
