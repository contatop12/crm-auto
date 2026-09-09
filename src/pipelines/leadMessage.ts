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
import { casarFraseDeEntrada, protocoloDaFrase, type FraseEntrada } from '../domain/frasesEntrada';
import { enviarConversao } from './stageChanged';
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
 * A promocao Organico -> Ads acontece aqui, mas por procuracao: a API do
 * Chatwoot nao move card entre boards (ver docs/api-reference.md), entao quem
 * executa a transferencia e' uma regra nativa sem logica nenhuma, disparada
 * pelo atributo `funil = PROMOVER` que gravamos.
 *
 * A decisao — quem merece ir para o funil de Ads — passa a ser nossa. Era isso
 * que a regra "Lead do Google" fazia errado: ela promovia qualquer conversa com
 * protocolo, e o fluxo carimbava `ORG-<id>` tambem no lead organico.
 */

/** Valor sentinela que a regra atuadora do Chatwoot espera. */
export const SENTINELA_PROMOVER = 'PROMOVER';

interface Resultado {
  status: 'ok' | 'ignorado' | 'erro';
  motivo: string;
}

interface Config {
  cw_account_id: number | null;
  evo_instancia: string | null;
  ga_customer_id: string | null;
  janela_match_dias: number | null;
  gtm_prefixo: string | null;
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
    `SELECT cw_account_id, evo_instancia, ga_customer_id, janela_match_dias, gtm_prefixo
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
  const leadDoClique = protocoloDito
    ? await porProtocolo(env, tenantId, protocoloDito)
    : await porTelefone(env, tenantId, chave, cfg.janela_match_dias ?? 90);

  /**
   * Ultimo recurso: a frase do anuncio.
   *
   * Nao houve protocolo na mensagem nem clique casado pelo telefone — mas o
   * texto pode ser o que o botao do anuncio ja' manda pronto, e esse texto so'
   * existe porque alguem apertou aquele botao. Sem isto o lead e' descartado:
   * pago, atendido, e invisivel para o Google.
   */
  const lead = leadDoClique ?? (await leadDaFrase(env, tenantId, {
    texto, telefone, chave, conversaId, prefixo: cfg.gtm_prefixo,
  }));

  if (!lead) {
    return {
      status: 'ignorado',
      motivo: protocoloDito
        ? `protocolo ${protocoloDito} nao esta na base de cliques`
        : `sem protocolo na mensagem, sem clique para o telefone e sem frase de entrada`,
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
  /**
   * A frase tambem RESGATA o clique que nao provou nada.
   *
   * Caso real da Vita: o clique chegou com protocolo mas sem gclid e sem UTM
   * nenhuma — "registrado (sem plataforma)". O lead foi achado, entao a busca
   * por frase nem era consultada, a plataforma saiu 'outro', o card ficou no
   * Organico e nenhuma conversao subiu. Lead de anuncio, pago, invisivel.
   *
   * A frase e' prova de origem independente de existir linha de clique. Ela so'
   * PREENCHE o que faltava: quando o clique ja' trouxe plataforma, ela nao
   * sobrepoe — o dado do clique e' mais especifico (diz a campanha, o termo).
   */
  const doClique = detectPlatform(sinais);
  const porFrase = doClique === 'outro'
    ? casarFraseDeEntrada(texto, await frasesDoTenant(env, tenantId))
    : null;

  const plataforma = porFrase ? (porFrase.plataforma as typeof doClique) : doClique;
  const origem = porFrase ? (porFrase.origem as ReturnType<typeof detectOrigin>) : detectOrigin(sinais);

  if (porFrase) {
    console.log(JSON.stringify({
      acao: 'origem_pela_frase', protocolo: lead.protocol, plataforma: porFrase.plataforma,
    }));
  }

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

  // Promove so' o que veio de anuncio de verdade. `outro` cobre o clique sem
  // gclid e sem utm de plataforma — nao ha o que atribuir a uma campanha.
  const daAds = plataforma === 'google' || plataforma === 'meta';
  const jaNoFunil = str(attrs.funil) === 'Lead';
  const promover = daAds && !jaNoFunil;

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

  await cw.mesclarAtributosDaConversa(acc, conversaId, {
    ...utmsDoCard(atribuicao),
    // gravado por ultimo, junto com o resto: a regra atuadora reage ao update
    // da conversa, entao quando ela rodar os atributos ja estao todos la'
    ...(promover ? { funil: SENTINELA_PROMOVER } : {}),
  });

  // A promocao e' feita por uma regra do Chatwoot, e o Chatwoot NAO dispara
  // automacao a partir de automacao: o `transfer_to_board` dela nao emite
  // `kanban_task_updated`. Resultado — a conversao de entrada nunca subia. Foi
  // medido: `kanban_conversao` tinha ZERO eventos nos quatro clientes desde
  // sempre, e um card movido pela API disparou na hora.
  //
  // Entao quem dispara a conversao de entrada somos nos, aqui, em vez de
  // esperar por um webhook que nao vem. O dedup de `conversions` continua
  // sendo a unica guarda contra duplicata: se o webhook um dia vier, ele
  // encontra a linha e para.
  if (promover) {
    await dispararConversaoDeEntrada(env, tenantId, lead.protocol, conversaId);
  }

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
    `INSERT INTO conversations
       (tenant_id, cw_conversation_id, protocol, task_id, phone_key, origem, promovido_em, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (tenant_id, cw_conversation_id) DO UPDATE SET
       protocol = excluded.protocol, task_id = excluded.task_id,
       phone_key = excluded.phone_key, origem = excluded.origem,
       promovido_em = COALESCE(conversations.promovido_em, excluded.promovido_em),
       updated_at = datetime('now')`,
  )
    .bind(
      tenantId, conversaId, lead.protocol, taskId ?? null, chave || null,
      daAds ? 'anuncio' : 'organico',
      promover ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null,
    )
    .run()
    .catch(() => undefined);

  return {
    status: 'ok',
    motivo:
      `conversa ${conversaId} atribuida a ${lead.protocol} (${plataforma}/${campanha.slug || 'sem campanha'})` +
      (aplicadas.length ? ` · etiquetas: ${aplicadas.join(', ')}` : ' · etiquetas ja estavam') +
      (promover ? ' · marcada para promover ao funil de Ads'
        : jaNoFunil ? ' · ja estava no funil'
        : ' · sem plataforma de anuncio, fica no Organico'),
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

/**
 * Sobe a conversao da etapa de entrada assim que o lead e' promovido.
 *
 * Monta o mesmo corpo que o webhook do Kanban mandaria. Reaproveitar
 * `enviarConversao` mantem UMA regra de dedup, de valor e de montagem do
 * evento — duplicar isso aqui seria repetir o erro do n8n, que tinha a mesma
 * decisao escrita em tres lugares que precisavam concordar.
 */
async function dispararConversaoDeEntrada(
  env: Env,
  tenantId: number,
  protocolo: string,
  conversaId: number,
): Promise<void> {
  const etapa = await env.DB.prepare(
    `SELECT cw_step_id FROM funnel_stages
     WHERE tenant_id = ? AND conversion_event IS NOT NULL AND conversion_action_id IS NOT NULL
     ORDER BY posicao LIMIT 1`,
  )
    .bind(tenantId)
    .first<{ cw_step_id: number }>()
    .catch(() => null);

  if (!etapa) return; // cliente sem meta na etapa de entrada: nada a subir

  const corpo = JSON.stringify({
    board_step_id: etapa.cw_step_id,
    custom_attributes: { protocolo },
    conversation_ids: [conversaId],
    step_changed_at: new Date().toISOString(),
  });

  try {
    const r = await enviarConversao(env, tenantId, corpo);
    console.log(JSON.stringify({ acao: 'conversao_de_entrada', protocolo, status: r.status, motivo: r.motivo }));
  } catch (e) {
    // a conversao nao pode derrubar a atribuicao: o lead ja' esta' no funil
    console.log(JSON.stringify({ acao: 'conversao_de_entrada_falhou', protocolo, erro: (e as Error).message }));
  }
}

/**
 * Cria o lead do anuncio que chegou so' pela frase.
 *
 * Grava em `leads` porque tudo depois disto — atribuicao, promocao, conversao —
 * le' de la'. O protocolo e' derivado da conversa, entao a segunda mensagem do
 * mesmo lead cai na MESMA linha em vez de criar outra.
 *
 * Sem gclid, de proposito: nao houve clique registrado. A conversao sobe pelos
 * dados do lead, o que o `montarEvento` ja' sabe fazer.
 */
async function leadDaFrase(
  env: Env,
  tenantId: number,
  ctx: {
    texto: string;
    telefone: string | null;
    chave: string | null;
    conversaId: number;
    prefixo: string | null;
  },
): Promise<LinhaLead | null> {
  const casou = casarFraseDeEntrada(ctx.texto, await frasesDoTenant(env, tenantId));
  if (!casou) return null;

  const protocolo = protocoloDaFrase(ctx.prefixo ?? '', ctx.conversaId);
  const fone = normFone(ctx.telefone);

  // `COALESCE` para a segunda mensagem nao apagar o que a primeira gravou
  await env.DB.prepare(
    `INSERT INTO leads (tenant_id, protocol, phone_raw, phone_e164, phone_key,
                        utm_source, origem, evento)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'frase_entrada')
     ON CONFLICT (tenant_id, protocol) DO UPDATE SET
       phone_e164 = COALESCE(excluded.phone_e164, leads.phone_e164),
       phone_key  = COALESCE(excluded.phone_key, leads.phone_key),
       updated_at = datetime('now')`,
  )
    .bind(tenantId, protocolo, ctx.telefone, fone, ctx.chave, casou.plataforma, casou.origem)
    .run();

  console.log(JSON.stringify({ acao: 'lead_pela_frase', protocolo, plataforma: casou.plataforma }));

  return {
    protocol: protocolo,
    nome: null,
    gclid: null, gbraid: null, wbraid: null,
    utm_source: casou.plataforma, utm_medium: null, utm_campaign: null,
    utm_id: null, utm_term: null, utm_content: null,
    fbc: null,
    origem: casou.origem, evento: 'frase_entrada',
    email: null, quiz_version: null, quiz_valor: null,
  } as LinhaLead;
}

/** Frases de entrada do cliente. Lista curta; ler duas vezes nao doi. */
async function frasesDoTenant(env: Env, tenantId: number): Promise<FraseEntrada[]> {
  const { results } = await env.DB.prepare(
    'SELECT frase, origem, plataforma FROM lead_entry_phrases WHERE tenant_id = ?',
  )
    .bind(tenantId)
    .all<FraseEntrada>()
    .catch(() => ({ results: [] as FraseEntrada[] }));
  return results;
}
