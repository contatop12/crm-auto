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
  test('o card troca o nome do perfil pelo telefone', async () => {
    await telefoneNoTituloDoCard(cenario(), 1, msg({}));
    expect(chamadas).toEqual([{
      metodo: 'PUT',
      url: 'https://cw.teste/api/v1/accounts/5/kanban/tasks/3744',
      corpo: { task: { title: 'Conversa #1240 - 5511932346062' } },
    }]);
  });

  test('titulo ja com o telefone nao custa chamada', async () => {
    await telefoneNoTituloDoCard(cenario(), 1, msg({ title: 'Conversa #1240 - 5511932346062' }));
    expect(chamadas).toEqual([]);
  });

  test('mensagem que chegou antes do card nascer: nada a fazer', async () => {
    await telefoneNoTituloDoCard(cenario(), 1, msg(null));
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
