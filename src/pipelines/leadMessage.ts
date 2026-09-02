import type { Env } from '../env';
import { ChatwootClient } from '../clients/chatwoot';
import { EvolutionClient } from '../clients/evolution';
import { GoogleAdsClient } from '../clients/googleAds';
import { findProtocol } from '../domain/protocol';
import { phoneKey, normFone } from '../domain/phone';
import { matchLead } from '../domain/matching';
import { detectPlatform, detectOrigin, classifyCampaign } from '../domain/platform';
import { buildLabels } from '../domain/labels';
import { utmsDoCard, precisaResolverNome } from '../domain/padroes';
import type { LabelVocabulary, LeadCandidate } from '../domain/types';

/**
 * Mensagem do lead: e' aqui que a atribuicao acontece.
 *
 * O lead manda "[Protocolo: VITA-...]" na primeira mensagem. Este pipeline le'
 * o protocolo, acha o clique correspondente e escreve o que a conversa e o card
 * precisam saber: de que anuncio veio, com que termo, em que campanha.
 *
 * Sem ele a conversa fica com "Protocolo: ---" e so' a etiqueta `mensagem`,
 * que foi exatamente o que o cliente viu na tela.
 *
 * NAO move card entre boards: a API do Chatwoot nao permite (ver
 * docs/api-reference.md). A promocao depende de uma regra nativa atuando sobre
 * o atributo `funil`, e ela e' passo separado.
 */

interface Resultado {
  status: 'ok' | 'ignorado' | 'erro';
  motivo: string;
}

interface Config {
  cw_account_id: number | null;
  evo_instancia: string | null;
  ga_customer_id: string | null;
  janela_match_dias: number | null;
}

interface LinhaLead {
  protocol: string;
  nome: string | null;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_id: string | null;
  utm_term: string | null;
  utm_content: string | null;
  fbc: string | null;
  origem: string | null;
  evento: string | null;
  quiz_version: string | null;
  quiz_valor: number | null;
}

export async function atribuirLead(env: Env, tenantId: number, payload: string): Promise<Resultado> {
  let p: Record<string, unknown>;
  try {
    p = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return { status: 'ignorado', motivo: 'payload nao e json' };
  }

  const conv = obj(p.conversation);
  const conversaId = num(conv?.id);
  if (!conversaId) return { status: 'ignorado', motivo: 'payload sem conversa' };

  const cfg = await env.DB.prepare(
    `SELECT cw_account_id, evo_instancia, ga_customer_id, janela_match_dias
     FROM tenant_config WHERE tenant_id = ?`,
  )
    .bind(tenantId)
    .first<Config>();
  if (!cfg?.cw_account_id) {
    return { status: 'ignorado', motivo: 'cliente sem conta do Chatwoot' };
  }

  const attrs = obj(conv?.custom_attributes) ?? {};
  // Ja atribuida: reprocessar toda mensagem gastaria chamada e reescreveria o
  // mesmo dado. O vendedor pode corrigir a mao sem a ferramenta desfazer.
  if (str(attrs.protocolo)) {
    return { status: 'ignorado', motivo: `conversa ${conversaId} ja tem protocolo` };
  }

  const texto = str(p.content) ?? str(obj(p.conversation)?.content) ?? '';
  const sender = obj(obj(conv?.meta)?.sender) ?? {};
  const telefone = str(sender.phone_number) ?? str(attrs.phone_lead);
  const chave = phoneKey(telefone);

  // 1) protocolo na mensagem  2) telefone dentro da janela
  const protocoloDito = findProtocol(texto);
  const lead = protocoloDito
    ? await porProtocolo(env, tenantId, protocoloDito)
    : await porTelefone(env, tenantId, chave, cfg.janela_match_dias ?? 90);

  if (!lead) {
    return {
      status: 'ignorado',
      motivo: protocoloDito
        ? `protocolo ${protocoloDito} nao esta na base de cliques`
        : `sem protocolo na mensagem e sem clique para o telefone`,
    };
  }

  const sinais = {
    utmSource: lead.utm_source,
    utmMedium: lead.utm_medium,
    utmCampaign: lead.utm_campaign,
    gclid: lead.gclid,
    gbraid: lead.gbraid,
    wbraid: lead.wbraid,
    fbc: lead.fbc,
    origemClick: lead.origem,
    eventClick: lead.evento,
  };
  const plataforma = detectPlatform(sinais);
  const origem = detectOrigin(sinais);

  const cw = ChatwootClient.fromEnv(env);
  const acc = cfg.cw_account_id;

  // O nome da campanha some quando o modelo de URL do anuncio nao foi
  // preenchido: chega `{campaignname}` e so' o utm_id presta.
  //
  // Resolver ANTES de classificar: o tipo da campanha e' lido do nome, e
  // `{campaignname}` nao contem "search" nem "pmax". Classificar primeiro
  // deixaria o lead sem a etiqueta de tipo mesmo com o nome disponivel.
  let nomeCampanha = lead.utm_campaign;
  if (cfg.ga_customer_id && precisaResolverNome(lead.utm_campaign, lead.utm_id)) {
    try {
      const nomes = await GoogleAdsClient.fromEnv(env).nomesDeCampanha(cfg.ga_customer_id, [lead.utm_id!]);
      nomeCampanha = nomes.get(lead.utm_id!) ?? lead.utm_campaign;
    } catch (e) {
      console.log(JSON.stringify({ acao: 'nome_campanha_falhou', erro: (e as Error).message }));
    }
  }

  const campanha = classifyCampaign({
    enumTipo: null,
    nome: nomeCampanha,
    utmCampaign: nomeCampanha,
    utmMedium: lead.utm_medium,
    plataforma,
  });

  const atribuicao = {
    protocolo: lead.protocol,
    gclid: lead.gclid,
    utmSource: lead.utm_source,
    utmMedium: lead.utm_medium,
    utmCampaign: nomeCampanha,
    utmId: lead.utm_id,
    utmTerm: lead.utm_term,
    utmContent: lead.utm_content,
  };

  await cw.mesclarAtributosDaConversa(acc, conversaId, utmsDoCard(atribuicao));

  const vocab = await vocabulario(env, tenantId);
  const etiquetas = buildLabels(
    {
      origem,
      plataforma,
      campanhaSlug: campanha.slug,
      quizVersion: lead.quiz_version,
      quizValor: lead.quiz_valor,
    },
    vocab,
  );
  const aplicadas = await cw.acrescentarEtiquetas(acc, conversaId, etiquetas.chatwoot);

  // O card carrega a origem da negociacao. Falhar aqui nao desfaz a conversa.
  const taskId = num(obj(conv?.kanban_task)?.id);
  if (taskId) {
    try {
      await cw.mesclarAtributosDoCard(acc, taskId, utmsDoCard(atribuicao));
    } catch (e) {
      console.log(JSON.stringify({ acao: 'utm_no_card_falhou', task: taskId, erro: (e as Error).message }));
    }
  }

  // WhatsApp e' espelho: etiqueta la' e' conveniencia do vendedor, nao o dado.
  if (cfg.evo_instancia && etiquetas.whatsapp.length && telefone) {
    try {
      const evo = EvolutionClient.fromEnv(env);
      const porNome = new Map((await evo.labelsComId(cfg.evo_instancia)).map((l) => [l.name, l.id]));
      for (const nome of etiquetas.whatsapp) {
        const id = porNome.get(nome);
        if (id) await evo.aplicarEtiqueta(cfg.evo_instancia, normFone(telefone), id);
      }
    } catch (e) {
      console.log(JSON.stringify({ acao: 'etiqueta_whatsapp_falhou', erro: (e as Error).message }));
    }
  }

  await env.DB.prepare(
    `INSERT INTO conversations (tenant_id, cw_conversation_id, protocol, task_id, phone_key, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (tenant_id, cw_conversation_id) DO UPDATE SET
       protocol = excluded.protocol, task_id = excluded.task_id,
       phone_key = excluded.phone_key, updated_at = datetime('now')`,
  )
    .bind(tenantId, conversaId, lead.protocol, taskId ?? null, chave || null)
    .run()
    .catch(() => undefined);

  return {
    status: 'ok',
    motivo:
      `conversa ${conversaId} atribuida a ${lead.protocol} (${plataforma}/${campanha.slug ?? 'sem campanha'})` +
      (aplicadas.length ? ` · etiquetas: ${aplicadas.join(', ')}` : ' · etiquetas ja estavam'),
  };
}

const COLUNAS = `protocol, nome, gclid, gbraid, wbraid, utm_source, utm_medium, utm_campaign,
                 utm_id, utm_term, utm_content, fbc, origem, evento, quiz_version, quiz_valor`;

function porProtocolo(env: Env, tenantId: number, protocolo: string) {
  return env.DB.prepare(`SELECT ${COLUNAS} FROM leads WHERE tenant_id = ? AND protocol = ?`)
    .bind(tenantId, protocolo)
    .first<LinhaLead>();
}

/**
 * Sem protocolo na mensagem, o telefone e' a unica ponte.
 *
 * A escolha entre varios cliques do mesmo numero e' do dominio (`matchLead`):
 * formulario antes de clique, depois o mais recente.
 */
async function porTelefone(env: Env, tenantId: number, chave: string, janelaDias: number) {
  if (!chave) return null;
  const { results } = await env.DB.prepare(
    `SELECT ${COLUNAS}, phone_key, created_at FROM leads
     WHERE tenant_id = ? AND phone_key = ? ORDER BY created_at DESC LIMIT 20`,
  )
    .bind(tenantId, chave)
    .all<LinhaLead & { phone_key: string; created_at: string }>();
  if (!results.length) return null;

  const escolhido = matchLead(
    chave,
    results.map(
      (r): LeadCandidate => ({
        protocol: r.protocol,
        phoneKey: r.phone_key,
        createdAt: r.created_at,
        origem: r.origem ?? '',
      }),
    ),
    Date.now(),
    janelaDias,
  );
  return escolhido ? (results.find((r) => r.protocol === escolhido.protocol) ?? null) : null;
}

async function vocabulario(env: Env, tenantId: number): Promise<LabelVocabulary[]> {
  const { results } = await env.DB.prepare(
    'SELECT slug, label_chatwoot, label_whatsapp FROM label_vocabulary WHERE tenant_id = ?',
  )
    .bind(tenantId)
    .all<{ slug: string; label_chatwoot: string; label_whatsapp: string | null }>();
  return results.map((v) => ({
    slug: v.slug,
    labelChatwoot: v.label_chatwoot,
    labelWhatsapp: v.label_whatsapp,
  }));
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
