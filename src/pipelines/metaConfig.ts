import type { Env } from '../env';
import { exigir } from '../domain/config';
import { cifrarToken, decifrarToken, ultimos4 } from '../domain/segredoMeta';
import { maskPhone } from '../domain/mask';
import { verificarToken, type Verificacao } from '../clients/metaCapi';
import type { EventoMeta } from '../domain/eventoMeta';

/**
 * O cadastro da Meta de um cliente, como o painel ve' e edita.
 *
 * O token da Conversions API so' ENTRA: e' cifrado na hora e nunca volta pela
 * API. A tela reconhece o token pelos 4 ultimos caracteres.
 */

export interface ConfigMetaPublica {
  meta_dataset_id: string | null;
  meta_page_id: string | null;
  meta_waba_id: string | null;
  meta_test_event_code: string | null;
  token_last4: string | null;
  tem_token: boolean;
  token_valido: boolean;
  token_conferido_em: string | null;
  envio_ligado: boolean;
}

export async function lerConfigMeta(db: D1Database, tenantId: number): Promise<ConfigMetaPublica | null> {
  const c = await db
    .prepare(
      `SELECT meta_dataset_id, meta_page_id, meta_waba_id, meta_test_event_code, meta_token_last4,
              CASE WHEN meta_token_cipher IS NULL THEN 0 ELSE 1 END AS tem_token,
              meta_token_valido, meta_token_conferido_em, meta_dry_run
       FROM tenant_config WHERE tenant_id = ?`,
    )
    .bind(tenantId)
    .first<{
      meta_dataset_id: string | null; meta_page_id: string | null; meta_waba_id: string | null;
      meta_test_event_code: string | null; meta_token_last4: string | null; tem_token: number;
      meta_token_valido: number; meta_token_conferido_em: string | null; meta_dry_run: number;
    }>();
  if (!c) return null;
  return {
    meta_dataset_id: c.meta_dataset_id,
    meta_page_id: c.meta_page_id,
    meta_waba_id: c.meta_waba_id,
    meta_test_event_code: c.meta_test_event_code,
    token_last4: c.meta_token_last4,
    tem_token: c.tem_token === 1,
    token_valido: c.meta_token_valido === 1,
    token_conferido_em: c.meta_token_conferido_em,
    envio_ligado: c.meta_dry_run === 0,
  };
}

export interface EntradaConfigMeta {
  meta_dataset_id?: string | null;
  meta_page_id?: string | null;
  meta_waba_id?: string | null;
  meta_test_event_code?: string | null;
  /** Token novo. Vazio ou ausente = mantem o atual. */
  token?: string | null;
  envio_ligado?: boolean;
}

/** Ids da Meta sao so' numeros. Digitar id a mao e' como a atribuicao vai parar na conta errada. */
const ID_META = /^\d{5,25}$/;
const CODIGO_TESTE = /^TEST\w{1,40}$/;

const CAMPOS_ID = [
  ['meta_dataset_id', 'dataset'],
  ['meta_page_id', 'Página'],
  ['meta_waba_id', 'WABA'],
] as const;

/** Salva o que veio; o que nao veio fica como estava. Token novo zera a verificacao. */
export async function salvarConfigMeta(
  env: Env,
  tenantId: number,
  e: EntradaConfigMeta,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sets: string[] = [];
  const vals: unknown[] = [];

  for (const [campo, rotulo] of CAMPOS_ID) {
    if (e[campo] === undefined) continue;
    const v = String(e[campo] ?? '').trim();
    if (v && !ID_META.test(v)) return { ok: false, error: `${rotulo}: use só os números do id` };
    sets.push(`${campo} = ?`);
    vals.push(v || null);
  }

  if (e.meta_test_event_code !== undefined) {
    const v = String(e.meta_test_event_code ?? '').trim();
    if (v && !CODIGO_TESTE.test(v)) return { ok: false, error: 'código de teste: é o TEST… que aparece em "Testar eventos"' };
    sets.push('meta_test_event_code = ?');
    vals.push(v || null);
  }

  const token = String(e.token ?? '').trim();
  if (token) {
    if (token.length < 20 || /\s/.test(token)) return { ok: false, error: 'token: cole o token inteiro, sem espaços' };
    const { cipher, iv } = await cifrarToken(token, exigir(env, 'MASTER_KEY'));
    sets.push('meta_token_cipher = ?', 'meta_token_iv = ?', 'meta_token_last4 = ?',
      'meta_token_valido = 0', 'meta_token_conferido_em = NULL');
    vals.push(cipher, iv, ultimos4(token));
  }

  if (e.envio_ligado !== undefined) {
    if (e.envio_ligado) {
      const atual = await lerConfigMeta(env.DB, tenantId);
      const dataset = e.meta_dataset_id !== undefined ? String(e.meta_dataset_id ?? '').trim() : atual?.meta_dataset_id;
      if (!dataset || !(token || atual?.tem_token)) {
        return { ok: false, error: 'para ligar o envio, preencha o dataset e o token' };
      }
    }
    sets.push('meta_dry_run = ?');
    vals.push(e.envio_ligado ? 0 : 1);
  }

  if (!sets.length) return { ok: true };
  const r = await env.DB.prepare(
    `UPDATE tenant_config SET ${sets.join(', ')}, updated_at = datetime('now') WHERE tenant_id = ?`,
  )
    .bind(...vals, tenantId)
    .run();
  if (!r.meta.changes) return { ok: false, error: 'cliente nao encontrado' };
  return { ok: true };
}

/** "Verificar token": abre o token e pergunta a Meta. Falha de rede nao muda o selo. */
export async function verificarConfigMeta(env: Env, tenantId: number): Promise<Verificacao> {
  const c = await env.DB.prepare(
    `SELECT meta_dataset_id, meta_page_id, meta_waba_id, meta_test_event_code, meta_token_cipher, meta_token_iv
     FROM tenant_config WHERE tenant_id = ?`,
  )
    .bind(tenantId)
    .first<{
      meta_dataset_id: string | null; meta_page_id: string | null; meta_waba_id: string | null;
      meta_test_event_code: string | null; meta_token_cipher: string | null; meta_token_iv: string | null;
    }>();
  if (!c?.meta_token_cipher || !c.meta_token_iv) return { ok: false, mensagem: 'Cole o token antes de verificar.' };

  let token: string;
  try {
    token = await decifrarToken(c.meta_token_cipher, c.meta_token_iv, exigir(env, 'MASTER_KEY'));
  } catch {
    return { ok: false, mensagem: 'O token guardado não abriu com a MASTER_KEY deste Worker. Cole o token de novo.' };
  }

  const v = await verificarToken(token, c.meta_dataset_id, {
    testEventCode: c.meta_test_event_code, pageId: c.meta_page_id, wabaId: c.meta_waba_id,
  });
  if (!v.rede) {
    await env.DB.prepare(
      `UPDATE tenant_config SET meta_token_valido = ?, meta_token_conferido_em = datetime('now') WHERE tenant_id = ?`,
    )
      .bind(v.ok ? 1 : 0, tenantId)
      .run();
  }
  return v;
}

export interface EtapaMeta {
  cw_step_id: number;
  posicao: number;
  nome: string;
  meta_evento: EventoMeta | null;
  conversion_value: number | null;
}

export async function etapasMeta(db: D1Database, tenantId: number): Promise<EtapaMeta[]> {
  const { results } = await db
    .prepare(
      `SELECT cw_step_id, posicao, nome, meta_evento, conversion_value
       FROM funnel_stages WHERE tenant_id = ? ORDER BY posicao`,
    )
    .bind(tenantId)
    .all<EtapaMeta>();
  return results;
}

const EVENTOS: ReadonlyArray<string | null> = [null, 'LeadSubmitted', 'Purchase'];

/**
 * Grava o evento da Meta de cada etapa (`{ cw_step_id: evento | null }`).
 *
 * Cada evento vai em uma etapa so': o dedup e' por protocolo + evento, entao a
 * segunda etapa com o mesmo evento nunca subiria — e ninguem entenderia por que.
 */
export async function salvarEventosDasEtapas(
  db: D1Database,
  tenantId: number,
  mapa: Record<string, unknown>,
): Promise<{ ok: true; alteradas: number } | { ok: false; error: string }> {
  const pares = Object.entries(mapa ?? {});
  const final = new Map((await etapasMeta(db, tenantId)).map((e) => [String(e.cw_step_id), e.meta_evento as string | null]));

  for (const [step, ev] of pares) {
    if (!final.has(step)) return { ok: false, error: `a etapa ${step} não está no funil — sincronize as etapas` };
    if (!EVENTOS.includes(ev as string | null)) {
      return { ok: false, error: `evento da Meta inválido: ${String(ev)} — use LeadSubmitted, Purchase ou nenhum` };
    }
    final.set(step, ev as string | null);
  }
  const usados = [...final.values()].filter(Boolean);
  if (new Set(usados).size !== usados.length) {
    return { ok: false, error: 'cada evento da Meta vai em uma etapa só: a Meta recebe um por lead' };
  }

  let alteradas = 0;
  for (const [step, ev] of pares) {
    const r = await db
      .prepare('UPDATE funnel_stages SET meta_evento = ? WHERE tenant_id = ? AND cw_step_id = ?')
      .bind(ev, tenantId, Number(step))
      .run();
    alteradas += r.meta.changes;
  }
  return { ok: true, alteradas };
}

/** O log do que foi (e do que nao foi) para a Meta. Telefone sempre mascarado. */
export async function listarEventosMeta(db: D1Database, tenantId: number, limite: number, offset: number) {
  const { results } = await db
    .prepare(
      `SELECT id, created_at, event_at, sent_at, protocol, phone_key, canal, event_name, etapa, value, currency,
              status, http_code, erro, response_body, origem, tentativas
       FROM meta_eventos WHERE tenant_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .bind(tenantId, limite, offset)
    .all<Record<string, unknown> & { phone_key: string | null; response_body: string | null }>();

  const t = await db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(status = 'enviado'), 0) AS enviados,
              COALESCE(SUM(status = 'nao_enviado'), 0) AS ensaios,
              COALESCE(SUM(status = 'falhou'), 0) AS falhas,
              COALESCE(SUM(status = 'pendente'), 0) AS pendentes
       FROM meta_eventos WHERE tenant_id = ?`,
    )
    .bind(tenantId)
    .first<{ total: number; enviados: number; ensaios: number; falhas: number; pendentes: number }>();

  return {
    linhas: results.map(({ phone_key, response_body, ...l }) => ({
      ...l,
      telefone: maskPhone(phone_key),
      resposta: response_body ? response_body.slice(0, 2000) : null,
    })),
    total: t?.total ?? 0,
    limite,
    offset,
    resumo: {
      enviados: t?.enviados ?? 0,
      ensaios: t?.ensaios ?? 0,
      falhas: t?.falhas ?? 0,
      pendentes: t?.pendentes ?? 0,
    },
  };
}
