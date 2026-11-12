import type { Env } from '../env';
import { EvolutionClient } from '../clients/evolution';
import {
  textoScriptQuebrado,
  textoVersaoNova,
  versaoMaisNova,
  type ProblemaDoScript,
} from '../domain/versaoChatwoot';

const baseDoChatwoot = (env: Env) => env.CHATWOOT_BASE_URL.replace(/\/+$/, '');

async function versaoRodando(env: Env): Promise<string | null> {
  const r = await fetch(`${baseDoChatwoot(env)}/api`);
  if (!r.ok) return null;
  return ((await r.json()) as { version?: string }).version ?? null;
}

/**
 * Reserva a chave antes de enviar: dois disparos juntos nao avisam em dobro. Se o
 * envio falhar, a chave sai e a proxima tentativa avisa.
 */
export async function avisarUmaVez(env: Env, chave: string, texto: string): Promise<boolean> {
  const r = await env.DB.prepare('INSERT OR IGNORE INTO avisos_chatwoot (chave) VALUES (?)').bind(chave).run();
  if (!r.meta.changes) return false;
  try {
    await EvolutionClient.fromEnv(env).enviarTexto(env.EVOLUTION_ALERT_INSTANCE, env.EVOLUTION_ALERT_GROUP_ID, texto);
    return true;
  } catch (e) {
    await env.DB.prepare('DELETE FROM avisos_chatwoot WHERE chave = ?').bind(chave).run();
    throw e;
  }
}

/**
 * Compara a versao rodando com a mais nova que o proprio Chatwoot anuncia e avisa
 * uma vez por versao. So' avisa: atualizar e' decisao do usuario, e o token do
 * Coolify nao fica em producao.
 */
export async function vigiarVersaoChatwoot(env: Env): Promise<void> {
  const rodando = await versaoRodando(env);
  if (!rodando) return;

  const conta = await env.DB.prepare(
    'SELECT cw_account_id AS id FROM tenant_config WHERE cw_account_id IS NOT NULL ORDER BY tenant_id LIMIT 1',
  ).first<{ id: number }>();
  if (!conta) return;

  const r = await fetch(`${baseDoChatwoot(env)}/api/v1/accounts/${conta.id}`, {
    headers: { api_access_token: env.CHATWOOT_API_TOKEN },
  });
  if (!r.ok) return;
  const nova = ((await r.json()) as { latest_chatwoot_version?: string }).latest_chatwoot_version;
  if (!nova || !versaoMaisNova(nova, rodando)) return;

  if (await avisarUmaVez(env, `versao:${nova}`, textoVersaoNova(rodando, nova))) {
    console.log(JSON.stringify({ acao: 'chatwoot_versao_nova', rodando, nova }));
  }
}

/** O script do painel nao achou o que procura. Uma vez por versao e problema. */
export async function avisarScriptQuebrado(env: Env, problema: ProblemaDoScript, conta: number): Promise<void> {
  const versao = (await versaoRodando(env)) ?? 'desconhecida';
  if (await avisarUmaVez(env, `quebra:${versao}:${problema}`, textoScriptQuebrado(problema, versao, conta))) {
    console.log(JSON.stringify({ acao: 'categorias_script_quebrado', problema, versao, conta }));
  }
}
