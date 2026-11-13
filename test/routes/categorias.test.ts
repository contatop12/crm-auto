import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from '../../src/index';
import { fakeD1 } from '../helpers/fakeD1';
import type { Env } from '../../src/env';

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const ORIGEM = 'https://chatwoot.teste';
const SESSAO = 'Bearer ' + btoa(JSON.stringify({ 'access-token': 'tok', client: 'cli', uid: 'a@b.c', expiry: '1', 'token-type': 'Bearer', 'x-lixo': 'nao vai' }));

let papel: string | null;
let perfilPedidos: Array<Record<string, string>>;
let envios: Array<{ url: string; corpo: { number: string; text: string } }>;

function ambiente() {
  const f = fakeD1();
  const env = {
    DB: f.d1,
    CHATWOOT_BASE_URL: `${ORIGEM}/`,
    CHATWOOT_API_TOKEN: 'global',
    EVOLUTION_SERVER_URL: 'https://evo.teste',
    EVOLUTION_API_KEY: 'k',
    EVOLUTION_ALERT_INSTANCE: 'alerta',
    EVOLUTION_ALERT_GROUP_ID: 'grupo@g.us',
    ASSETS: {
      fetch: async (r: Request) => {
        const caminho = new URL(r.url).pathname;
        if (caminho === '/chatwoot-marca.js') return new Response('/* marca */');
        if (caminho === '/chatwoot-categorias.js') return new Response('/* script */');
        if (caminho === '/chatwoot-funil.js') return new Response('/* funil */');
        if (caminho === '/marca/logo.svg') return new Response('<svg/>');
        return new Response('', { status: 404 });
      },
    },
  } as unknown as Env;
  return { ...f, env };
}

const pedir = (env: Env, metodo: string, caminho: string, corpo?: unknown, headers: Record<string, string> = { Authorization: SESSAO }) =>
  worker.fetch(
    new Request(`https://crm.teste/ingest/categorias${caminho}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', Origin: ORIGEM, ...headers },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    }),
    env,
    ctx,
  );

beforeEach(() => {
  papel = 'administrator';
  perfilPedidos = [];
  envios = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const u = String(url);
    if (u === `${ORIGEM}/api/v1/profile`) {
      perfilPedidos.push(init.headers as Record<string, string>);
      if (papel === null) return new Response('{}', { status: 401 });
      return Response.json({ id: 7, accounts: [{ id: 5, role: papel }] });
    }
    if (u === `${ORIGEM}/api`) return Response.json({ version: '4.19.0-fazer-ai-pro.157' });
    if (u.includes('/message/sendText/')) {
      envios.push({ url: u, corpo: JSON.parse(String(init.body)) });
      return Response.json({});
    }
    return new Response('nao esperado: ' + u, { status: 500 });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('sessao', () => {
  test('sem sessao: 401, e nem chama o Chatwoot', async () => {
    const { env } = ambiente();
    const r = await pedir(env, 'GET', '/5', undefined, {});
    expect(r.status).toBe(401);
    expect(perfilPedidos).toEqual([]);
  });

  test('sessao recusada pelo Chatwoot: 401', async () => {
    const { env } = ambiente();
    papel = null;
    expect((await pedir(env, 'GET', '/5')).status).toBe(401);
  });

  test('so repassa os cabecalhos da sessao ao Chatwoot', async () => {
    const { env } = ambiente();
    await pedir(env, 'GET', '/5');
    expect(perfilPedidos).toEqual([{ 'access-token': 'tok', client: 'cli', uid: 'a@b.c', expiry: '1', 'token-type': 'Bearer' }]);
  });

  test('membro de outra conta nao entra nesta', async () => {
    const { env } = ambiente();
    expect((await pedir(env, 'GET', '/6')).status).toBe(401);
  });

  test('atendente le, mas nao grava, nem chamando a rota direto', async () => {
    const { env, consultar } = ambiente();
    papel = 'agent';
    const lido = await pedir(env, 'GET', '/5');
    expect(lido.status).toBe(200);
    expect(await lido.json()).toEqual({ admin: false, categorias: [] });

    expect((await pedir(env, 'POST', '/5', { nome: 'X' })).status).toBe(403);
    expect((await pedir(env, 'PUT', '/5/etiquetas/113', { categoria: 1 })).status).toBe(403);
    expect((await pedir(env, 'PUT', '/5/ordem', { ids: [1] })).status).toBe(403);
    expect((await pedir(env, 'PATCH', '/5/1', { nome: 'Y' })).status).toBe(403);
    expect((await pedir(env, 'DELETE', '/5/1')).status).toBe(403);
    expect(consultar('SELECT * FROM etiqueta_categorias')).toEqual([]);
  });
});

describe('CORS', () => {
  test('so a origem do Chatwoot passa, e o preflight responde', async () => {
    const { env } = ambiente();
    const pre = await worker.fetch(
      new Request('https://crm.teste/ingest/categorias/5/ordem', {
        method: 'OPTIONS',
        headers: { Origin: ORIGEM, 'Access-Control-Request-Method': 'PUT' },
      }),
      env,
      ctx,
    );
    expect(pre.status).toBeLessThan(300);
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe(ORIGEM);

    // a leitura e a criacao batem em `/5`, sem nada depois da conta
    const preLeitura = await worker.fetch(
      new Request('https://crm.teste/ingest/categorias/5', {
        method: 'OPTIONS',
        headers: { Origin: ORIGEM, 'Access-Control-Request-Method': 'GET' },
      }),
      env,
      ctx,
    );
    expect(preLeitura.status).toBeLessThan(300);
    expect((await pedir(env, 'GET', '/5')).headers.get('Access-Control-Allow-Origin')).toBe(ORIGEM);

    const fora = await pedir(env, 'GET', '/5', undefined, { Authorization: SESSAO, Origin: 'https://mal.teste' });
    expect(fora.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('categorias', () => {
  async function criar(env: Env, nome: string) {
    const r = await pedir(env, 'POST', '/5', { nome });
    expect(r.status).toBe(201);
    return (await r.json()) as { id: number; posicao: number };
  }

  test('cria em ordem e recusa nome repetido, sem diferenciar maiuscula', async () => {
    const { env } = ambiente();
    const a = await criar(env, 'Motivo de perda');
    const b = await criar(env, 'Equipamento');
    expect([a.posicao, b.posicao]).toEqual([1, 2]);
    expect((await pedir(env, 'POST', '/5', { nome: 'motivo de PERDA' })).status).toBe(409);
    expect((await pedir(env, 'POST', '/5', { nome: '   ' })).status).toBe(400);
  });

  test('etiqueta fica em uma categoria so, e volta para sem categoria com null', async () => {
    const { env, consultar } = ambiente();
    const a = await criar(env, 'A');
    const b = await criar(env, 'B');
    await pedir(env, 'PUT', '/5/etiquetas/113', { categoria: a.id });
    await pedir(env, 'PUT', '/5/etiquetas/113', { categoria: b.id });
    expect(consultar('SELECT label_id, categoria_id FROM etiqueta_categoria_itens')).toEqual([{ label_id: 113, categoria_id: b.id }]);

    const lido = (await (await pedir(env, 'GET', '/5')).json()) as { categorias: Array<{ etiquetas: number[] }> };
    expect(lido.categorias.map((c) => c.etiquetas)).toEqual([[], [113]]);

    await pedir(env, 'PUT', '/5/etiquetas/113', { categoria: null });
    expect(consultar('SELECT * FROM etiqueta_categoria_itens')).toEqual([]);
  });

  test('nao aceita categoria de outra conta', async () => {
    const { env, exec } = ambiente();
    exec(`INSERT INTO etiqueta_categorias (id, cw_account_id, nome) VALUES (99, 8, 'De outro')`);
    expect((await pedir(env, 'PUT', '/5/etiquetas/113', { categoria: 99 })).status).toBe(404);
    expect((await pedir(env, 'PATCH', '/5/99', { nome: 'Roubada' })).status).toBe(404);
    expect((await pedir(env, 'DELETE', '/5/99')).status).toBe(404);
  });

  test('ordem muda a leitura e nao toca outra conta', async () => {
    const { env, exec, consultar } = ambiente();
    exec(`INSERT INTO etiqueta_categorias (id, cw_account_id, nome, posicao) VALUES (99, 8, 'De outro', 7)`);
    const a = await criar(env, 'A');
    const b = await criar(env, 'B');
    await pedir(env, 'PUT', '/5/ordem', { ids: [b.id, a.id, 99] });
    const lido = (await (await pedir(env, 'GET', '/5')).json()) as { categorias: Array<{ nome: string }> };
    expect(lido.categorias.map((c) => c.nome)).toEqual(['B', 'A']);
    expect(consultar('SELECT posicao FROM etiqueta_categorias WHERE id = 99')).toEqual([{ posicao: 7 }]);
  });

  test('renomear mantem as etiquetas; nome repetido e recusado', async () => {
    const { env } = ambiente();
    const a = await criar(env, 'A');
    await criar(env, 'B');
    await pedir(env, 'PUT', '/5/etiquetas/113', { categoria: a.id });
    expect((await pedir(env, 'PATCH', `/5/${a.id}`, { nome: 'b' })).status).toBe(409);
    expect((await pedir(env, 'PATCH', `/5/${a.id}`, { nome: 'Novo' })).status).toBe(200);
    const lido = (await (await pedir(env, 'GET', '/5')).json()) as { categorias: Array<{ nome: string; etiquetas: number[] }> };
    expect(lido.categorias[0]).toMatchObject({ nome: 'Novo', etiquetas: [113] });
  });

  test('excluir devolve as etiquetas para sem categoria', async () => {
    const { env, consultar } = ambiente();
    const a = await criar(env, 'A');
    await pedir(env, 'PUT', '/5/etiquetas/113', { categoria: a.id });
    expect((await pedir(env, 'DELETE', `/5/${a.id}`)).status).toBe(200);
    expect(consultar('SELECT * FROM etiqueta_categorias')).toEqual([]);
    expect(consultar('SELECT * FROM etiqueta_categoria_itens')).toEqual([]);
  });
});

describe('script e sinal', () => {
  test('o script e publico e servido como JavaScript', async () => {
    const { env } = ambiente();
    const r = await pedir(env, 'GET', '/script.js', undefined, {});
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toContain('javascript');
    // a marca vai na frente, separada por ';' para um arquivo nao emendar no outro;
    // o arquivo que falta (aqui, o da ordem do kanban) fica de fora sem derrubar os demais
    expect(await r.text()).toBe(['/* marca */', ';', '/* script */', ';', '/* funil */'].join('\n'));
  });

  test('a logo e publica, e so os arquivos da lista saem', async () => {
    const { env } = ambiente();
    const pegar = (nome: string) => worker.fetch(new Request(`https://crm.teste/ingest/marca/${nome}`), env, ctx);
    const logo = await pegar('logo.svg');
    expect(logo.status).toBe(200);
    expect(logo.headers.get('Content-Type')).toContain('image/svg+xml');
    expect(await logo.text()).toBe('<svg/>');
    expect((await pegar('index.html')).status).toBe(404);
    expect((await pegar('logo_dark.svg')).status).toBe(404); // esta' na lista, mas o asset nao existe aqui
  });

  test('sinal avisa o grupo uma vez por versao e problema', async () => {
    const { env } = ambiente();
    await pedir(env, 'POST', '/5/sinal', { problema: 'card' });
    await pedir(env, 'POST', '/5/sinal', { problema: 'card' });
    await pedir(env, 'POST', '/5/sinal', { problema: 'etiquetas' });
    expect(envios.map((e) => e.corpo.number)).toEqual(['grupo@g.us', 'grupo@g.us']);
    expect(envios[0]!.corpo.text).toContain('os cards do kanban');
    expect(envios[0]!.corpo.text).toContain('4.19.0-fazer-ai-pro.157');
    expect(envios[1]!.corpo.text).toContain('a tela de Etiquetas');
  });

  test('problema fora da lista e recusado, e sem sessao nao avisa', async () => {
    const { env } = ambiente();
    expect((await pedir(env, 'POST', '/5/sinal', { problema: 'qualquer' })).status).toBe(400);
    expect((await pedir(env, 'POST', '/5/sinal', { problema: 'card' }, {})).status).toBe(401);
    expect(envios).toEqual([]);
  });
});
