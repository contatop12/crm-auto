import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from '../env';
import { avisarScriptQuebrado } from '../pipelines/avisosChatwoot';
import type { ProblemaDoScript } from '../domain/versaoChatwoot';

/**
 * Categorias de etiquetas do Chatwoot, consumidas pelo script injetado no painel
 * (`panel/chatwoot-categorias.js`). Fica sob /ingest porque o Access libera esse
 * prefixo, e o navegador do atendente nao tem sessao do Access.
 *
 * Quem entra prova a sessao do Chatwoot. O script manda os cabecalhos da sessao
 * dentro do `Authorization`, em base64, e aqui eles sao repassados ao Chatwoot.
 * `Authorization` porque os logs do Cloudflare ocultam esse cabecalho; `access-token`
 * cru apareceria neles. Nada disso e' gravado nem logado.
 */
export const categorias = new Hono<{ Bindings: Env }>();

type Ctx = Context<{ Bindings: Env }>;
type Agente = { id: number; admin: boolean };

const origemDoChatwoot = (env: Env) => new URL(env.CHATWOOT_BASE_URL).origin;

// O script nao precisa de CORS: <script src> nao passa por ele.
categorias.get('/script.js', async (c) => {
  const r = await c.env.ASSETS.fetch(new Request(new URL('/chatwoot-categorias.js', c.req.url)));
  if (!r.ok) return c.text('', 404);
  return new Response(r.body, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      // Corrigir o script vale em minutos, sem mexer no Chatwoot.
      'Cache-Control': 'public, max-age=300',
    },
  });
});

categorias.use(
  '/:conta{[0-9]+}/*',
  cors({
    origin: (o, c) => (o === origemDoChatwoot((c as Ctx).env) ? o : null),
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 600,
  }),
);

const CABECALHOS_DA_SESSAO = ['access-token', 'client', 'uid', 'expiry', 'token-type'];

/** Quem e' este atendente nesta conta, segundo o proprio Chatwoot. */
async function agenteDaConta(c: Ctx, conta: number): Promise<Agente | null> {
  const bruto = /^Bearer (.+)$/.exec(c.req.header('Authorization') ?? '')?.[1];
  if (!bruto) return null;
  let sessao: Record<string, unknown>;
  try {
    sessao = JSON.parse(atob(bruto)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const headers: Record<string, string> = {};
  for (const nome of CABECALHOS_DA_SESSAO) {
    if (typeof sessao[nome] === 'string') headers[nome] = sessao[nome] as string;
  }
  if (!headers['access-token'] || !headers.client || !headers.uid) return null;

  const r = await fetch(`${c.env.CHATWOOT_BASE_URL.replace(/\/+$/, '')}/api/v1/profile`, { headers });
  if (!r.ok) return null;
  const perfil = (await r.json()) as { id?: number; accounts?: Array<{ id?: number; role?: string }> };
  const membro = perfil.accounts?.find((a) => a.id === conta);
  if (!perfil.id || !membro) return null;
  return { id: perfil.id, admin: membro.role === 'administrator' };
}

/** Exige sessao valida na conta; com `admin`, exige tambem ser administrador. */
async function exigir(c: Ctx, conta: number, admin = false): Promise<{ agente: Agente } | { erro: Response }> {
  const agente = await agenteDaConta(c, conta);
  if (!agente) return { erro: c.json({ erro: 'sem_sessao' }, 401) };
  if (admin && !agente.admin) return { erro: c.json({ erro: 'so_administrador' }, 403) };
  return { agente };
}

const contaDe = (c: Ctx) => Number(c.req.param('conta'));

async function corpo(c: Ctx): Promise<Record<string, unknown>> {
  const j = (await c.req.json().catch(() => null)) as unknown;
  return j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : {};
}

function nomeValido(v: unknown): string | null {
  const nome = typeof v === 'string' ? v.trim() : '';
  return nome && nome.length <= 60 ? nome : null;
}

categorias.get('/:conta{[0-9]+}', async (c) => {
  const conta = contaDe(c);
  const r = await exigir(c, conta);
  if ('erro' in r) return r.erro;

  const cats = await c.env.DB.prepare(
    'SELECT id, nome, posicao FROM etiqueta_categorias WHERE cw_account_id = ? ORDER BY posicao, id',
  )
    .bind(conta)
    .all<{ id: number; nome: string; posicao: number }>();
  const itens = await c.env.DB.prepare(
    'SELECT label_id, categoria_id FROM etiqueta_categoria_itens WHERE cw_account_id = ?',
  )
    .bind(conta)
    .all<{ label_id: number; categoria_id: number }>();

  return c.json({
    admin: r.agente.admin,
    categorias: cats.results.map((cat) => ({
      ...cat,
      etiquetas: itens.results.filter((i) => i.categoria_id === cat.id).map((i) => i.label_id),
    })),
  });
});

categorias.post('/:conta{[0-9]+}', async (c) => {
  const conta = contaDe(c);
  const r = await exigir(c, conta, true);
  if ('erro' in r) return r.erro;
  const nome = nomeValido((await corpo(c)).nome);
  if (!nome) return c.json({ erro: 'nome_invalido' }, 400);

  const ins = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO etiqueta_categorias (cw_account_id, nome, posicao)
     VALUES (?1, ?2, (SELECT COALESCE(MAX(posicao), 0) + 1 FROM etiqueta_categorias WHERE cw_account_id = ?1))`,
  )
    .bind(conta, nome)
    .run();
  if (!ins.meta.changes) return c.json({ erro: 'ja_existe' }, 409);
  const nova = await c.env.DB.prepare('SELECT id, nome, posicao FROM etiqueta_categorias WHERE cw_account_id = ? AND nome = ?')
    .bind(conta, nome)
    .first();
  return c.json(nova, 201);
});

// Vem antes de `/:id`: mesmo com o id so' de digitos, a ordem fica explicita.
categorias.put('/:conta{[0-9]+}/ordem', async (c) => {
  const conta = contaDe(c);
  const r = await exigir(c, conta, true);
  if ('erro' in r) return r.erro;
  const ids = (await corpo(c)).ids;
  if (!Array.isArray(ids) || !ids.every((i) => Number.isInteger(i))) return c.json({ erro: 'ids_invalidos' }, 400);

  for (const [i, id] of (ids as number[]).entries()) {
    await c.env.DB.prepare('UPDATE etiqueta_categorias SET posicao = ? WHERE id = ? AND cw_account_id = ?')
      .bind(i + 1, id, conta)
      .run();
  }
  return c.json({ ok: true });
});

categorias.put('/:conta{[0-9]+}/etiquetas/:label{[0-9]+}', async (c) => {
  const conta = contaDe(c);
  const r = await exigir(c, conta, true);
  if ('erro' in r) return r.erro;
  const label = Number(c.req.param('label'));
  const categoria = (await corpo(c)).categoria;

  if (categoria === null) {
    await c.env.DB.prepare('DELETE FROM etiqueta_categoria_itens WHERE cw_account_id = ? AND label_id = ?')
      .bind(conta, label)
      .run();
    return c.json({ ok: true });
  }
  if (!Number.isInteger(categoria)) return c.json({ erro: 'categoria_invalida' }, 400);
  const existe = await c.env.DB.prepare('SELECT 1 AS ok FROM etiqueta_categorias WHERE id = ? AND cw_account_id = ?')
    .bind(categoria, conta)
    .first();
  if (!existe) return c.json({ erro: 'categoria_nao_existe' }, 404);

  await c.env.DB.prepare(
    `INSERT INTO etiqueta_categoria_itens (cw_account_id, label_id, categoria_id) VALUES (?, ?, ?)
     ON CONFLICT (cw_account_id, label_id) DO UPDATE SET categoria_id = excluded.categoria_id`,
  )
    .bind(conta, label, categoria)
    .run();
  return c.json({ ok: true });
});

categorias.patch('/:conta{[0-9]+}/:id{[0-9]+}', async (c) => {
  const conta = contaDe(c);
  const r = await exigir(c, conta, true);
  if ('erro' in r) return r.erro;
  const nome = nomeValido((await corpo(c)).nome);
  if (!nome) return c.json({ erro: 'nome_invalido' }, 400);

  const repetida = await c.env.DB.prepare('SELECT id FROM etiqueta_categorias WHERE cw_account_id = ? AND nome = ? AND id <> ?')
    .bind(conta, nome, Number(c.req.param('id')))
    .first();
  if (repetida) return c.json({ erro: 'ja_existe' }, 409);

  const u = await c.env.DB.prepare('UPDATE etiqueta_categorias SET nome = ? WHERE id = ? AND cw_account_id = ?')
    .bind(nome, Number(c.req.param('id')), conta)
    .run();
  if (!u.meta.changes) return c.json({ erro: 'categoria_nao_existe' }, 404);
  return c.json({ ok: true });
});

// Excluir a categoria devolve as etiquetas para "Sem categoria". Nada muda no Chatwoot.
categorias.delete('/:conta{[0-9]+}/:id{[0-9]+}', async (c) => {
  const conta = contaDe(c);
  const r = await exigir(c, conta, true);
  if ('erro' in r) return r.erro;
  const id = Number(c.req.param('id'));

  const existe = await c.env.DB.prepare('SELECT 1 AS ok FROM etiqueta_categorias WHERE id = ? AND cw_account_id = ?')
    .bind(id, conta)
    .first();
  if (!existe) return c.json({ erro: 'categoria_nao_existe' }, 404);

  await c.env.DB.prepare('DELETE FROM etiqueta_categoria_itens WHERE cw_account_id = ? AND categoria_id = ?').bind(conta, id).run();
  await c.env.DB.prepare('DELETE FROM etiqueta_categorias WHERE id = ? AND cw_account_id = ?').bind(id, conta).run();
  return c.json({ ok: true });
});

const PROBLEMAS: readonly ProblemaDoScript[] = ['card', 'etiquetas'];

categorias.post('/:conta{[0-9]+}/sinal', async (c) => {
  const conta = contaDe(c);
  const r = await exigir(c, conta);
  if ('erro' in r) return r.erro;
  const problema = (await corpo(c)).problema as ProblemaDoScript;
  if (!PROBLEMAS.includes(problema)) return c.json({ erro: 'problema_invalido' }, 400);

  await avisarScriptQuebrado(c.env, problema, conta).catch((e) =>
    console.log(JSON.stringify({ acao: 'categorias_sinal_erro', erro: String((e as Error).message).slice(0, 200) })),
  );
  return c.json({ ok: true });
});
