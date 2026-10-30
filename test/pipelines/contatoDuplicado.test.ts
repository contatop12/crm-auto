import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { fakeD1 } from '../helpers/fakeD1';
import { alertarContatoDuplicado } from '../../src/pipelines/contatoDuplicado';
import type { Env } from '../../src/env';

function cenario(grupo: string | null = '120363@g.us', instancia: string | null = null) {
  const { d1, exec, consultar } = fakeD1();
  exec(`INSERT INTO tenants (id, slug, nome, ativo) VALUES (4, 'locadora', 'Locadora Exatidao', 1)`);
  exec(`INSERT INTO tenant_config (tenant_id, cw_account_id, cw_board_funil_id, ingest_key, alerta_duplicado_grupo, alerta_duplicado_instancia)
        VALUES (4, 5, 9, 'k', ${grupo ? `'${grupo}'` : 'NULL'}, ${instancia ? `'${instancia}'` : 'NULL'})`);
  const env = {
    DB: d1, CHATWOOT_BASE_URL: 'https://cw.teste', CHATWOOT_API_TOKEN: 'tok',
    EVOLUTION_SERVER_URL: 'https://evo.teste', EVOLUTION_API_KEY: 'k', EVOLUTION_ALERT_INSTANCE: 'alerta',
  } as unknown as Env;
  return { env, consultar };
}

const agora = Math.floor(Date.now() / 1000);
const msg = (o: { tipo?: string; criada?: number } = {}) =>
  JSON.stringify({
    message_type: o.tipo ?? 'incoming',
    private: false,
    inbox: { id: 17, name: 'Locadora - 2244' },
    conversation: {
      id: 1500, inbox_id: 17, created_at: o.criada ?? agora - 5,
      meta: { sender: { id: 1363, name: 'Vital', phone_number: '+5511932346062' }, assignee: null },
    },
  });

let envios: Array<{ url: string; corpo: { number: string; text: string } }>;
let doContato: unknown[];
let evoFalha: boolean;

beforeEach(() => {
  envios = [];
  evoFalha = false;
  doContato = [
    { id: 1500, inbox_id: 17, status: 'open', last_activity_at: agora, meta: { assignee: { id: 14, name: 'Vânia' } } },
    { id: 1200, inbox_id: 15, status: 'open', last_activity_at: agora - 9 * 86400, meta: { assignee: { id: 15, name: 'Tânia' } } },
  ];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const u = String(url);
    if (u.includes('/message/sendText/')) {
      if (evoFalha) return new Response('x', { status: 500 });
      envios.push({ url: u, corpo: JSON.parse(String(init.body)) });
      return Response.json({});
    }
    if (u.endsWith('/contacts/1363/conversations')) return Response.json({ payload: doContato });
    if (u.endsWith('/inboxes')) return Response.json({ payload: [{ id: 15, name: 'Locadora - 8910' }, { id: 17, name: 'Locadora - 2244' }] });
    return Response.json({});
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('alertarContatoDuplicado', () => {
  test('contato em outra caixa: manda o alerta ao grupo, uma vez so', async () => {
    const { env, consultar } = cenario();
    await alertarContatoDuplicado(env, 4, msg());
    await alertarContatoDuplicado(env, 4, msg());
    expect(envios).toHaveLength(1);
    expect(envios[0]!.url).toBe('https://evo.teste/message/sendText/alerta');
    expect(envios[0]!.corpo.number).toBe('120363@g.us');
    expect(envios[0]!.corpo.text).toContain('Falou com o 8910 (responsável: Tânia)');
    expect(envios[0]!.corpo.text).toContain('agora com o 2244 (responsável: Vânia)');
    expect(envios[0]!.corpo.text).toContain('https://wa.me/5511932346062');
    expect(consultar('SELECT contato_id, inbox_a, inbox_b, alertado_em IS NOT NULL AS ok FROM alertas_duplicado'))
      .toEqual([{ contato_id: 1363, inbox_a: 15, inbox_b: 17, ok: 1 }]);
  });

  test('instancia do cliente configurada: envia por ela, nao pela de alerta do sistema', async () => {
    const { env } = cenario('120363@g.us', 'Ryan');
    await alertarContatoDuplicado(env, 4, msg());
    expect(envios.map((e) => e.url)).toEqual(['https://evo.teste/message/sendText/Ryan']);
  });

  test('so existe conversa na mesma caixa: nada', async () => {
    doContato = [{ id: 1500, inbox_id: 17, status: 'open', last_activity_at: agora }];
    const { env } = cenario();
    await alertarContatoDuplicado(env, 4, msg());
    expect(envios).toEqual([]);
  });

  test('conversa velha em outra caixa (resolvida ha 40 dias): nada', async () => {
    doContato[1] = { id: 1200, inbox_id: 15, status: 'resolved', last_activity_at: agora - 40 * 86400 };
    const { env } = cenario();
    await alertarContatoDuplicado(env, 4, msg());
    expect(envios).toEqual([]);
  });

  test('sem grupo configurado: nao envia e nao grava (nao queima o alerta)', async () => {
    const { env, consultar } = cenario(null);
    await alertarContatoDuplicado(env, 4, msg());
    expect(envios).toEqual([]);
    expect(consultar('SELECT * FROM alertas_duplicado')).toEqual([]);
  });

  test('conversa antiga (nao e a primeira mensagem): nem consulta o Chatwoot', async () => {
    const { env } = cenario();
    const fetchSpy = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchSpy);
    await alertarContatoDuplicado(env, 4, msg({ criada: agora - 3600 }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('so mensagem do lead', async () => {
    const { env } = cenario();
    await alertarContatoDuplicado(env, 4, msg({ tipo: 'outgoing' }));
    expect(envios).toEqual([]);
  });

  test('envio falhou: libera o registro para a proxima mensagem tentar de novo', async () => {
    const { env, consultar } = cenario();
    evoFalha = true;
    await expect(alertarContatoDuplicado(env, 4, msg())).resolves.toBeUndefined();
    expect(consultar('SELECT * FROM alertas_duplicado')).toEqual([]);
    evoFalha = false;
    await alertarContatoDuplicado(env, 4, msg());
    expect(envios).toHaveLength(1);
  });
});
