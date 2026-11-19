import type { Env } from '../env';
import { ChatwootClient } from '../clients/chatwoot';
import { PulseboardClient } from '../clients/pulseboard';
import { registrarEvento } from '../db/queries';
import { tipoDoCanal } from '../domain/canal';
import { normFone, phoneKey } from '../domain/phone';
import { nomeUtil, lerNumerosProprios, ehNumeroProprio } from '../domain/nomeLead';
import { detectOrigin } from '../domain/platform';

/**
 * Link da conversa no aviso do lead de formulario/quiz, sem esperar o lead
 * responder.
 *
 * Quem avisa o grupo desses leads e' o fluxo do proprio formulario, que nao
 * conhece a conversa do Chatwoot. Ate' 19/11/2026 o CRM so' entregava o link a
 * Pulseboard quando o card entrava no funil de Ads (`kanbanTask`), ou seja,
 * depois de o lead RESPONDER no WhatsApp e de a regra do Chatwoot promover o
 * card. O aviso espera o link 90 s; medido na Taina, 4 de 18 leads responderam
 * depois disso e alguns nunca, e o aviso saia sem link ou com o link numa
 * mensagem 'a parte (leads 44NOV e 45NOV da Taina, 19/11/2026).
 *
 * So' que a conversa ja' existe segundos depois do formulario: a mensagem de
 * boas-vindas do fluxo a cria (ou cai na conversa que o contato ja' tinha, que a
 * Evolution reabre). Entao, registrado o clique de formulario com telefone, o
 * CRM procura a conversa desse telefone no Chatwoot e entrega o link. A
 * Pulseboard poe no aviso que espera, guarda para o aviso que ainda vai chegar
 * ou manda um complemento, e ignora a repeticao: o caminho antigo (card no
 * funil) continua valendo como reserva.
 */

/** Tipo do evento (em `events`) e da mensagem na fila. */
export const EVENTO_CONVERSA_DO_FORMULARIO = 'conversa_formulario';

/**
 * Espera antes da primeira procura: o tempo de o fluxo do formulario mandar a
 * mensagem de boas-vindas e o Chatwoot criar a conversa (~5 s na Taina).
 */
export const ESPERA_INICIAL_S = 8;

/**
 * Quantas vezes procura antes de desistir. A fila devolve em ~20 s: cinco
 * tentativas cobrem ~90 s, o prazo que o aviso espera pelo link. Menor que o
 * `max_retries` da fila, para a desistencia nao cair na DLQ.
 */
export const TENTATIVAS_PROCURANDO_CONVERSA = 5;

/** O beacon do GTM repete o clique: o mesmo protocolo agenda uma vez so'. */
const TTL_AGENDADO_S = 600;

export interface Resultado {
  status: 'ok' | 'ignorado' | 'erro';
  motivo: string;
  retentar?: boolean;
  adiar?: boolean;
}

interface Config {
  cw_account_id: number | null;
  pulseboard_url: string | null;
  pulseboard_ativo: number;
  numeros_proprios: string | null;
  cliente: string | null;
}

interface LinhaLead {
  nome: string | null;
  phone_e164: string | null;
  phone_key: string | null;
  origem: string | null;
  evento: string | null;
  quiz_version: string | null;
  utm_medium: string | null;
}

async function configDoTenant(env: Env, tenantId: number): Promise<Config | null> {
  return env.DB.prepare(
    `SELECT c.cw_account_id, c.pulseboard_url, c.pulseboard_ativo, c.numeros_proprios, t.nome AS cliente
     FROM tenant_config c JOIN tenants t ON t.id = c.tenant_id WHERE c.tenant_id = ?`,
  )
    .bind(tenantId)
    .first<Config>();
}

async function leadPorProtocolo(env: Env, tenantId: number, protocolo: string): Promise<LinhaLead | null> {
  return env.DB.prepare(
    `SELECT nome, phone_e164, phone_key, origem, evento, quiz_version, utm_medium
     FROM leads WHERE tenant_id = ? AND protocol = ?`,
  )
    .bind(tenantId, protocolo)
    .first<LinhaLead>();
}

/**
 * Formulario ou quiz: o aviso deles nao e' do CRM, e por isso vem sem o link.
 * A mesma leitura do `kanbanTask`, que e' quem decide se o CRM avisa.
 */
function avisadoPorOutroFluxo(l: LinhaLead): boolean {
  const origem = detectOrigin({
    utmMedium: l.utm_medium,
    origemClick: l.origem,
    eventClick: l.evento,
    quizVersion: l.quiz_version,
  });
  return tipoDoCanal({ origem, quizVersion: l.quiz_version }) !== 'Mensagem';
}

function protocoloDoCorpo(payload: string, ...nomes: string[]): string {
  try {
    const p = JSON.parse(payload) as Record<string, unknown> | null;
    if (!p || typeof p !== 'object') return '';
    for (const n of nomes) {
      const v = p[n];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  } catch {
    // corpo que nao e' json: sem protocolo
  }
  return '';
}

/**
 * Chamado logo depois de o clique ser gravado. Agenda a procura da conversa
 * quando o clique e' de formulario/quiz com telefone e o cliente usa o aviso no
 * grupo. Devolve se agendou. Nunca lanca: o clique ja' esta' registrado.
 */
export async function agendarLinkDaConversa(env: Env, tenantId: number, payloadDoClique: string): Promise<boolean> {
  try {
    const protocolo = protocoloDoCorpo(payloadDoClique, 'protocol', 'protocolo');
    if (!protocolo) return false;

    const lead = await leadPorProtocolo(env, tenantId, protocolo);
    if (!lead?.phone_key || !avisadoPorOutroFluxo(lead)) return false;

    const cfg = await configDoTenant(env, tenantId);
    if (!cfg?.cw_account_id || cfg.pulseboard_ativo !== 1 || !cfg.pulseboard_url) return false;

    const chave = `${EVENTO_CONVERSA_DO_FORMULARIO}:${tenantId}:${protocolo}`;
    if (await env.CACHE.get(chave).catch(() => null)) return false;
    await env.CACHE.put(chave, '1', { expirationTtl: TTL_AGENDADO_S }).catch(() => undefined);

    // Evento proprio: a tela de Eventos mostra o que aconteceu com o link de
    // cada lead, e o reprocessamento do painel serve para ele tambem.
    const eventId = await registrarEvento(env.DB, {
      tenantId,
      source: 'chatwoot',
      eventType: EVENTO_CONVERSA_DO_FORMULARIO,
      payload: JSON.stringify({ protocolo }),
      signatureOk: null,
    });
    await env.QUEUE.send(
      { eventId, tenantId, source: 'chatwoot', eventType: EVENTO_CONVERSA_DO_FORMULARIO },
      { delaySeconds: ESPERA_INICIAL_S },
    );
    return true;
  } catch (e) {
    console.log(JSON.stringify({ acao: 'agendar_link_da_conversa_falhou', erro: (e as Error).message }));
    return false;
  }
}

/**
 * O trabalho agendado: acha a conversa do lead no Chatwoot e entrega o link a
 * Pulseboard. Sem conversa ainda, volta para a fila (`adiar`) ate'
 * `TENTATIVAS_PROCURANDO_CONVERSA`; depois desiste sem erro.
 */
export async function entregarLinkDaConversa(
  env: Env,
  tenantId: number,
  payload: string,
  opcoes: { tentativa?: number } = {},
): Promise<Resultado> {
  const protocolo = protocoloDoCorpo(payload, 'protocolo', 'protocol');
  if (!protocolo) return { status: 'ignorado', motivo: 'pedido de link da conversa sem protocolo' };

  const lead = await leadPorProtocolo(env, tenantId, protocolo);
  if (!lead) return { status: 'ignorado', motivo: `lead ${protocolo} nao esta na base de cliques` };

  const chave = lead.phone_key || phoneKey(lead.phone_e164);
  if (!chave) return { status: 'ignorado', motivo: `lead ${protocolo} sem telefone: nao ha como achar a conversa` };

  const cfg = await configDoTenant(env, tenantId);
  if (!cfg?.cw_account_id) return { status: 'ignorado', motivo: 'cliente sem conta do Chatwoot' };
  if (cfg.pulseboard_ativo !== 1 || !cfg.pulseboard_url) {
    return { status: 'ignorado', motivo: 'aviso no grupo desligado para este cliente' };
  }
  if (ehNumeroProprio(lead.phone_e164, lerNumerosProprios(cfg.numeros_proprios))) {
    return { status: 'ignorado', motivo: `lead ${protocolo} e' de um numero da propria empresa` };
  }

  const conversa = await conversaDoTelefone(env, cfg.cw_account_id, chave);
  if (!conversa) {
    const tentativa = opcoes.tentativa ?? 1;
    if (tentativa < TENTATIVAS_PROCURANDO_CONVERSA) {
      return {
        status: 'erro',
        motivo: `lead de formulario ${protocolo} ainda sem conversa no Chatwoot: procurando de novo`,
        adiar: true,
      };
    }
    return {
      status: 'ignorado',
      motivo: `lead de formulario ${protocolo} sem conversa no Chatwoot: o link vai quando ele chamar no WhatsApp`,
    };
  }

  // o Pulseboard espera so digitos, com DDI e sem '+'
  const telefone = (normFone(lead.phone_e164) || '').replace('+', '');
  if (!telefone) return { status: 'ignorado', motivo: `lead ${protocolo} com telefone invalido` };
  const nome = nomeUtil(lead.nome, { telefone, nomesProprios: [cfg.cliente] });
  const url = `${env.CHATWOOT_BASE_URL.replace(/\/$/, '')}/app/accounts/${cfg.cw_account_id}/conversations/${conversa}`;

  let acao: string;
  try {
    acao = await new PulseboardClient(cfg.pulseboard_url).avisarConversa({
      telefone,
      conversa: url,
      ...(nome ? { nome } : {}),
    });
  } catch (e) {
    // transitorio (Pulseboard fora do ar): a fila retenta, e a repeticao e' inofensiva
    return { status: 'erro', motivo: `Pulseboard falhou ao receber o link da conversa: ${(e as Error).message}` };
  }

  return {
    status: 'ok',
    motivo: `conversa ${conversa} do lead de formulario ${protocolo} entregue a Pulseboard (${acao || 'sem resposta'})`,
  };
}

/**
 * Display id da conversa mais recente do contato com este telefone; null sem
 * nenhuma. A busca vai pelos 8 ultimos digitos e o casamento pela chave
 * (DDD + 8): o contato do WhatsApp pode vir sem o nono digito.
 */
async function conversaDoTelefone(env: Env, acc: number, chave: string): Promise<number | null> {
  const cw = ChatwootClient.fromEnv(env);
  const contatos = (await cw.contatosPorBusca(acc, chave.slice(-8)))
    .filter((c) => phoneKey(c.phone_number) === chave);

  let melhor: { id: number; atividade: number } | null = null;
  for (const contato of contatos) {
    for (const c of await cw.conversasDoContato(acc, contato.id)) {
      const atividade = Number(c.last_activity_at ?? 0) || 0;
      if (!melhor || atividade > melhor.atividade || (atividade === melhor.atividade && c.id > melhor.id)) {
        melhor = { id: c.id, atividade };
      }
    }
  }
  return melhor?.id ?? null;
}
