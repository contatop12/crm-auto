import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { fakeD1 } from '../helpers/fakeD1';
import { vigiarVersaoChatwoot } from '../../src/pipelines/avisosChatwoot';
import { versaoMaisNova } from '../../src/domain/versaoChatwoot';
import type { Env } from '../../src/env';

function cenario() {
  const f = fakeD1();
  f.exec(`INSERT INTO tenants (id, slug, nome, ativo) VALUES (4, 'locadora', 'Locadora', 1)`);
  f.exec(`INSERT INTO tenant_config (tenant_id, cw_account_id, cw_board_funil_id, ingest_key) VALUES (4, 5, 9, 'k')`);
  const env = {
    DB: f.d1,
    CHATWOOT_BASE_URL: 'https://cw.teste',
    CHATWOOT_API_TOKEN: 'tok',
    EVOLUTION_SERVER_URL: 'https://evo.teste',
    EVOLUTION_API_KEY: 'k',
    EVOLUTION_ALERT_INSTANCE: 'alerta',
    EVOLUTION_ALERT_GROUP_ID: 'grupo@g.us',
  } as unknown as Env;
  return { ...f, env };
}

let rodando: string;
let nova: string | undefined;
let evoFalha: boolean;
let envios: Array<{ number: string; text: string }>;

beforeEach(() => {
  rodando = '4.19.0-fazer-ai-pro.157';
  nova = '4.19.0-fazer-ai-pro.164';
  evoFalha = false;
  envios = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const u = String(url);
    if (u === 'https://cw.teste/api') return Response.json({ version: rodando });
    if (u === 'https://cw.teste/api/v1/accounts/5') return Response.json({ latest_chatwoot_version: nova });
    if (u.includes('/message/sendText/')) {
      if (evoFalha) return new Response('x', { status: 500 });
      envios.push(JSON.parse(String(init.body)));
      return Response.json({});
    }
    return new Response('nao esperado', { status: 500 });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('versaoMaisNova', () => {
  test.each([
    ['4.19.0-fazer-ai-pro.164', '4.19.0-fazer-ai-pro.157', true],
    ['4.19.0-fazer-ai-pro.157', '4.19.0-fazer-ai-pro.157', false],
    ['4.19.0-fazer-ai-pro.99', '4.19.0-fazer-ai-pro.157', false],
    ['4.20.0-fazer-ai-pro.1', '4.19.0-fazer-ai-pro.157', true],
    ['', '4.19.0', false],
  ])('%s > %s = %s', (a, b, esperado) => {
    expect(versaoMaisNova(a, b)).toBe(esperado);
  });
});

describe('vigiarVersaoChatwoot', () => {
  test('versao nova: avisa o grupo uma vez, e nao repete no dia seguinte', async () => {
    const { env } = cenario();
    await vigiarVersaoChatwoot(env);
    await vigiarVersaoChatwoot(env);
    expect(envios).toHaveLength(1);
    expect(envios[0]!.number).toBe('grupo@g.us');
    expect(envios[0]!.text).toContain('*Rodando:* 4.19.0-fazer-ai-pro.157');
    expect(envios[0]!.text).toContain('*Nova:* 4.19.0-fazer-ai-pro.164');
  });

  test('saiu outra versao depois: avisa de novo', async () => {
    const { env } = cenario();
    await vigiarVersaoChatwoot(env);
    nova = '4.19.0-fazer-ai-pro.170';
    await vigiarVersaoChatwoot(env);
    expect(envios).toHaveLength(2);
  });

  test('ja na ultima, ou sem a informacao: nao avisa', async () => {
    const { env } = cenario();
    rodando = '4.19.0-fazer-ai-pro.164';
    await vigiarVersaoChatwoot(env);
    nova = undefined;
    await vigiarVersaoChatwoot(env);
    expect(envios).toEqual([]);
  });

  test('envio falhou: libera para a proxima tentativa avisar', async () => {
    const { env, consultar } = cenario();
    evoFalha = true;
    await expect(vigiarVersaoChatwoot(env)).rejects.toThrow();
    expect(consultar('SELECT * FROM avisos_chatwoot')).toEqual([]);
    evoFalha = false;
    await vigiarVersaoChatwoot(env);
    expect(envios).toHaveLength(1);
  });
});
