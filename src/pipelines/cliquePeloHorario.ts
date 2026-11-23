import type { Env } from '../env';
import { ChatwootClient } from '../clients/chatwoot';
import { registrarEvento } from '../db/queries';
import { phoneKey } from '../domain/phone';
import { casarRespostaAutomatica } from '../domain/respostasAutomaticas';
import {
  abriuSoComAutomatica,
  escolherClique,
  janelaDoClique,
  CONVERSA_NOVA_S,
  ESPERA_S,
} from '../domain/cliquePeloHorario';
import { atribuirLead } from './leadMessage';

/**
 * Rede de seguranca do lead de anuncio cuja primeira mensagem nao chegou.
 *
 * O porque' e a regra estao em `domain/cliquePeloHorario`. Aqui sao os dois
 * tempos:
 *
 * 1. `agendarCliquePeloHorario`, em toda mensagem enviada: a resposta
 *    automatica do cliente numa conversa nova e sem protocolo agenda uma
 *    conferencia para dali a pouco.
 * 2. `ligarCliquePeloHorario`, a conferencia: se a conversa abriu so' com a
 *    resposta automatica e existe UM clique do site sem telefone e sem conversa
 *    no horario, a conversa e' atribuida a ele pelo caminho de sempre
 *    (`atribuirLead`), e ganha uma nota interna dizendo que foi pelo horario.
 *
 * Vale para o cliente que tem resposta automatica cadastrada
 * (`respostas_automaticas`): sem trecho cadastrado nao ha' como reconhecer a
 * saudacao, e nada e' agendado.
 */

/** Tipo do evento (em `events`) e da mensagem na fila. */
export const EVENTO_CLIQUE_PELO_HORARIO = 'clique_pelo_horario';

/** As respostas automaticas saem em rajada: a mesma conversa agenda uma vez so'. */
const TTL_AGENDADO_S = 900;

export interface Resultado {
  status: 'ok' | 'ignorado' | 'erro';
  motivo: string;
  retentar?: boolean;
  adiar?: boolean;
}

/**
 * Agenda a conferencia. Engole o proprio erro: roda junto do tratamento da
 * mensagem enviada, que nao pode cair por causa dela.
 */
export async function agendarCliquePeloHorario(env: Env, tenantId: number, payload: string): Promise<boolean> {
  try {
    const p = obj(JSON.parse(payload));
    if (!p || p.message_type !== 'outgoing' || p.private === true) return false;

    const conv = obj(p.conversation);
    const conversa = num(conv?.id);
    if (!conversa || !recemCriada(conv?.created_at)) return false;
    if (str(obj(conv?.custom_attributes)?.protocolo)) return false;

    if (!casarRespostaAutomatica(str(p.content), await frasesAutomaticas(env, tenantId))) return false;

    const chave = `${EVENTO_CLIQUE_PELO_HORARIO}:${tenantId}:${conversa}`;
    if (await env.CACHE.get(chave).catch(() => null)) return false;
    await env.CACHE.put(chave, '1', { expirationTtl: TTL_AGENDADO_S }).catch(() => undefined);

    // Evento proprio: a tela de Eventos mostra o que a conferencia decidiu, e o
    // reprocessamento do painel serve para ela tambem.
    const eventId = await registrarEvento(env.DB, {
      tenantId,
      source: 'chatwoot',
      eventType: EVENTO_CLIQUE_PELO_HORARIO,
      payload: JSON.stringify({ conversa }),
      signatureOk: null,
    });
    await env.QUEUE.send(
      { eventId, tenantId, source: 'chatwoot', eventType: EVENTO_CLIQUE_PELO_HORARIO },
      { delaySeconds: ESPERA_S },
    );
    return true;
  } catch (e) {
    console.log(JSON.stringify({ acao: 'agendar_clique_pelo_horario_falhou', erro: (e as Error).message }));
    return false;
  }
}

/** A conferencia agendada. */
export async function ligarCliquePeloHorario(env: Env, tenantId: number, payload: string): Promise<Resultado> {
  let conversa: number | null = null;
  try {
    conversa = num(obj(JSON.parse(payload))?.conversa);
  } catch {
    /* cai no retorno abaixo */
  }
  if (!conversa) return { status: 'ignorado', motivo: 'conferencia sem conversa' };

  const cfg = await env.DB.prepare('SELECT cw_account_id, janela_match_dias FROM tenant_config WHERE tenant_id = ?')
    .bind(tenantId)
    .first<{ cw_account_id: number | null; janela_match_dias: number | null }>();
  if (!cfg?.cw_account_id) return { status: 'ignorado', motivo: 'cliente sem conta do Chatwoot' };

  const cw = ChatwootClient.fromEnv(env);
  const conv = await cw.conversa(cfg.cw_account_id, conversa);
  if (!conv) return { status: 'ignorado', motivo: `conversa ${conversa} nao existe mais` };
  const attrs = obj(conv.custom_attributes) ?? {};

  // Atribuicao que comecou e nao terminou (a fila devolveu depois de uma
  // falha): `conversations` ja' tem o protocolo, mas sem a origem, que e' a
  // ultima coisa gravada. O lead ja' ganhou o telefone, entao a procura de
  // baixo nao o acharia mais: retoma com o mesmo clique.
  const emAndamento = await env.DB.prepare(
    'SELECT protocol FROM conversations WHERE tenant_id = ? AND cw_conversation_id = ? AND origem IS NULL',
  )
    .bind(tenantId, conversa)
    .first<{ protocol: string | null }>();

  let protocolo = str(emAndamento?.protocol);
  if (!protocolo && str(attrs.protocolo)) {
    return { status: 'ignorado', motivo: `conversa ${conversa} ja tem protocolo` };
  }

  // Vale tambem para a retomada: atribuicao comum que parou no meio (o lead
  // escreveu, com protocolo) nao e' assunto desta conferencia.
  const { mensagens, completo } = await cw.mensagensDesdeOInicio(cfg.cw_account_id, conversa);
  if (!completo || !abriuSoComAutomatica(mensagens, await frasesAutomaticas(env, tenantId))) {
    return { status: 'ignorado', motivo: `conversa ${conversa} nao abriu so com a resposta automatica` };
  }

  if (!protocolo) {
    // Telefone que ja' tem lead (formulario, clique de outro dia): a mensagem
    // automatica pode ser a do fluxo do formulario, e a atribuicao normal casa
    // pelo telefone quando o lead responder.
    const chave = phoneKey(str(obj(obj(conv.meta)?.sender)?.phone_number));
    if (chave) {
      const dele = await env.DB.prepare(
        `SELECT protocol FROM leads
         WHERE tenant_id = ? AND phone_key = ? AND created_at >= datetime('now', ?)
         ORDER BY created_at DESC LIMIT 1`,
      )
        .bind(tenantId, chave, `-${cfg.janela_match_dias ?? 90} days`)
        .first<{ protocol: string }>();
      if (dele) {
        return { status: 'ignorado', motivo: `conversa ${conversa}: telefone ja tem lead (${dele.protocol}), a atribuicao normal cuida` };
      }
    }

    const criada = num(conv.created_at);
    if (!criada) return { status: 'ignorado', motivo: `conversa ${conversa} sem data de criacao` };
    const { de, ate } = janelaDoClique(criada);
    const { results } = await env.DB.prepare(
      `SELECT l.protocol, l.created_at FROM leads l
       WHERE l.tenant_id = ? AND l.evento = 'whatsapp_click' AND l.phone_key IS NULL
         AND l.created_at >= ? AND l.created_at <= ?
         AND NOT EXISTS (SELECT 1 FROM conversations c WHERE c.tenant_id = l.tenant_id AND c.protocol = l.protocol)
       ORDER BY l.created_at DESC LIMIT 5`,
    )
      .bind(tenantId, de, ate)
      .all<{ protocol: string; created_at: string }>();

    const escolha = escolherClique(results);
    if ('motivo' in escolha) {
      return { status: 'ignorado', motivo: `conversa ${conversa} abriu so com a resposta automatica, mas ${escolha.motivo}` };
    }
    protocolo = escolha.protocolo;
  }

  // O retrato de agora, nao o do webhook da saudacao: o card nasce depois da
  // conversa. Na retomada o protocolo sai dos atributos, senao `atribuirLead`
  // pararia em "ja tem protocolo".
  const { protocolo: _jaGravado, ...semProtocolo } = attrs;
  const r = await atribuirLead(
    env,
    tenantId,
    JSON.stringify({
      event: 'message_outgoing',
      message_type: 'outgoing',
      private: false,
      content: null,
      conversation: { ...conv, custom_attributes: semProtocolo },
    }),
    { protocolo },
  );
  if (r.status !== 'ok') return r;

  // Quem abrir a conversa precisa saber que a ligacao e' inferida e que a
  // mensagem do lead so' existe no celular. Falhar aqui nao desfaz a atribuicao.
  await cw
    .notaInterna(
      cfg.cw_account_id,
      conversa,
      'Registro do sistema: a primeira mensagem deste lead não chegou ao CRM. Pelo horário, a conversa foi ligada ao ' +
        `clique do anúncio (protocolo ${protocolo}). Confira no celular o que ele escreveu.`,
    )
    .catch((e: Error) => console.log(JSON.stringify({ acao: 'nota_clique_pelo_horario_falhou', conversa, erro: e.message.slice(0, 200) })));

  return {
    ...r,
    motivo: `conversa ${conversa} ligada ao clique ${protocolo} pelo horario (a primeira mensagem do lead nao chegou) · ${r.motivo}`,
  };
}

async function frasesAutomaticas(env: Env, tenantId: number): Promise<Array<{ frase: string }>> {
  const { results } = await env.DB.prepare('SELECT frase FROM respostas_automaticas WHERE tenant_id = ?')
    .bind(tenantId)
    .all<{ frase: string }>();
  return results;
}

/** Conversa criada nos ultimos minutos. O Chatwoot manda `created_at` em segundos. */
function recemCriada(v: unknown): boolean {
  const quando = typeof v === 'number' ? v * 1000 : Date.parse(String(v ?? ''));
  return Number.isFinite(quando) && Date.now() - quando < CONVERSA_NOVA_S * 1000;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
