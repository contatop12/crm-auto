import type { Env } from '../env';
import { postarNaPlanilha } from '../clients/n8n';
import { SheetsClient } from '../clients/sheets';
import {
  montarRegistro, montarLinhaPorCabecalho, linhaDeLeads, indiceParaColuna, campoDaColunaLeads, jaTemTelefone,
  abasDoLead, telefoneEmLink, dataHoraBrasilia, CANAL_DIRETO_WHATSAPP,
  type ContextoPlanilha, type LeadDaPlanilha,
} from '../domain/planilha';

/**
 * Entrega o lead as planilhas do cliente.
 *
 * Dois momentos chamam: o clique (o lead chegou — vira a linha da aba Cliques
 * do Banco de Dados) e a conversao enviada ao Google (atualiza essa linha,
 * acrescenta na aba Conversoes e, na de entrada, na planilha geral de leads).
 *
 * Dois jeitos de escrever, escolhidos por cliente:
 * - `sistema`: o proprio Worker escreve, pela service account;
 * - `n8n`: o Worker entrega o registro a um webhook e o n8n escreve.
 *
 * Quem chama nunca deve falhar por causa disto: a planilha e' onde o time do
 * cliente trabalha, nao a fonte da verdade. Por isso o erro sobe e quem chama
 * so' registra.
 */

export interface DestinoPlanilha {
  banco_doc: string | null;
  aba_cliques: string;
  aba_conversoes: string;
  leads_doc: string | null;
  /** Geral e a aba de cada canal. O lead entra na Geral e na do canal dele. */
  leads_abas: { geral: string | null; google: string | null; meta: string | null; direto?: string | null };
}

interface ConfigPlanilha {
  sheets_ativo: number;
  planilha_modo: string;
  planilha_webhook_url: string | null;
  sheets_doc_id: string | null;
  sheets_aba_cliques: string;
  sheets_aba_conversoes: string;
  sheets_leads_doc_id: string | null;
  sheets_leads_aba: string | null;
  sheets_aba_geral: string | null;
  sheets_aba_google: string | null;
  sheets_aba_meta: string | null;
  sheets_aba_direto: string | null;
  cliente: string;
}

export async function espelharNaPlanilha(
  env: Env,
  tenantId: number,
  ctx: Omit<ContextoPlanilha, 'cliente'>,
): Promise<void> {
  const cfg = await env.DB.prepare(
    `SELECT c.sheets_ativo, c.planilha_modo, c.planilha_webhook_url, c.sheets_doc_id,
            c.sheets_aba_cliques, c.sheets_aba_conversoes, c.sheets_leads_doc_id,
            c.sheets_leads_aba, c.sheets_aba_geral, c.sheets_aba_google, c.sheets_aba_meta,
            c.sheets_aba_direto, t.nome AS cliente
     FROM tenant_config c JOIN tenants t ON t.id = c.tenant_id WHERE c.tenant_id = ?`,
  )
    .bind(tenantId)
    .first<ConfigPlanilha>();

  if (!cfg || cfg.sheets_ativo !== 1) return;

  const lead = await env.DB.prepare(
    `SELECT nome, email, phone_e164, gclid, gbraid, wbraid, utm_source, utm_medium,
            utm_campaign, utm_id, utm_term, utm_content, fbp, fbc, client_id, origem,
            evento, page_url, whatsapp_url, referrer, user_agent, ip_address, quiz_version,
            quiz_valor, quiz_form_id, valor_proposta, created_at
     FROM leads WHERE tenant_id = ? AND protocol = ?`,
  )
    .bind(tenantId, ctx.protocolo)
    .first<LeadDaPlanilha>();

  const registro = montarRegistro({ ...ctx, cliente: cfg.cliente }, lead);

  if (cfg.planilha_modo === 'sistema') {
    const gravado = await escreverNasPlanilhas(env, {
      banco_doc: cfg.sheets_doc_id,
      aba_cliques: cfg.sheets_aba_cliques,
      aba_conversoes: cfg.sheets_aba_conversoes,
      leads_doc: cfg.sheets_leads_doc_id,
      leads_abas: {
        geral: cfg.sheets_aba_geral,
        google: cfg.sheets_aba_google,
        meta: cfg.sheets_aba_meta,
        direto: cfg.sheets_aba_direto,
      },
    }, registro);
    console.log(JSON.stringify({ acao: 'planilha_ok', modo: 'sistema', tipo: ctx.tipo, protocolo: ctx.protocolo, abas: gravado }));
    return;
  }

  if (!cfg.planilha_webhook_url) return;
  const r = await postarNaPlanilha(cfg.planilha_webhook_url, registro);
  console.log(JSON.stringify({ acao: 'planilha_ok', modo: 'n8n', tipo: ctx.tipo, protocolo: ctx.protocolo, gravado: r.gravado }));
}

/**
 * Escreve o registro nas planilhas do destino. Devolve as abas escritas.
 *
 * - Cliques: atualiza a linha do protocolo, ou acrescenta se nao houver.
 * - Conversoes: idem, pela chave protocolo + evento.
 * - Planilha de leads: acrescenta, so' na conversao de entrada — uma linha
 *   por lead, como sempre foi.
 */
export async function escreverNasPlanilhas(
  env: Env,
  destino: DestinoPlanilha,
  registro: ReturnType<typeof montarRegistro>,
): Promise<string[]> {
  const sheets = new SheetsClient(env);
  const feitas: string[] = [];
  const falhas: string[] = [];

  // Cada planilha por si: o Banco de Dados sem compartilhar nao pode impedir
  // a linha da planilha de leads, que o time le todo dia.
  const tentar = async (nome: string, fazer: () => Promise<void>) => {
    try {
      await fazer();
      feitas.push(nome);
    } catch (e) {
      falhas.push(`${nome}: ${(e as Error).message}`);
    }
  };

  if (destino.banco_doc) {
    const banco = destino.banco_doc;
    if (registro.conversoes) {
      const conversoes = registro.conversoes;
      await tentar(destino.aba_conversoes, () => gravarPorProtocolo(sheets, banco, destino.aba_conversoes, conversoes));
    }
    await tentar(destino.aba_cliques, () => gravarPorProtocolo(sheets, banco, destino.aba_cliques, registro.cliques));
  }

  // Planilha de leads: uma linha por lead, quando ele entra — a conversao de
  // entrada do Google, ou a entrada do lead do Meta, que nao tem conversao.
  const entrou = registro.conversao === 'conversa' || registro.tipo === 'entrada';
  if (destino.leads_doc && entrou) {
    const doc = destino.leads_doc;
    for (const aba of abasDoLead(destino.leads_abas, String(registro.plataforma ?? ''), registro.cliques.origem)) {
      await tentar(aba, () => acrescentarLead(sheets, doc, aba, registro));
    }
  }

  if (falhas.length) {
    throw new Error(`${falhas.join(' | ')}${feitas.length ? ` (gravou: ${feitas.join(', ')})` : ''}`);
  }
  return feitas;
}

/**
 * Acrescenta o lead no fim da aba, se ele ainda nao estiver nela.
 *
 * Le' a aba inteira uma vez so': dela sai o cabecalho, o teste de quem ja'
 * esta' la' (reenvio, ou gravado pelo n8n antes) e o formato que o time usa
 * no TELEFONE.
 *
 * A SEQUENCIA fica em branco de proposito: quem numera e' o script da propria
 * planilha, o mesmo que avisa o grupo pelo fluxo "Notificacoes de Lead -
 * Central". Escrever um numero aqui disputaria com ele.
 */
async function acrescentarLead(
  sheets: SheetsClient,
  doc: string,
  aba: string,
  registro: Record<string, unknown>,
): Promise<void> {
  const linhas = await sheets.tudo(doc, aba);
  const cab = linhas[0] ?? [];
  if (!cab.length) throw new Error(`a aba "${aba}" esta sem cabecalho na primeira linha`);
  const corpo = linhas.slice(1);
  const coluna = (i: number) => (i < 0 ? [] : corpo.map((l) => l[i] ?? ''));

  const iFone = cab.findIndex((h) => campoDaColunaLeads(h) === 'telefone');
  const iLink = cab.findIndex((h) => campoDaColunaLeads(h) === 'link_whatsapp');
  const telefone = String(registro.telefone ?? '');
  if (telefone && jaTemTelefone([...coluna(iFone), ...coluna(iLink)], telefone)) return;

  await sheets.acrescentar(doc, aba, linhaDeLeads(cab, registro, {
    telefoneComoLink: telefoneEmLink(coluna(iFone)),
  }));
}

/**
 * Atualiza a linha cujo `protocol` bate, ou acrescenta uma nova.
 *
 * Sem a coluna `protocol` nao ha como casar — acrescentar as cegas duplicaria o
 * lead a cada evento, entao recusa com o motivo.
 */
async function gravarPorProtocolo(
  sheets: SheetsClient,
  doc: string,
  aba: string,
  dados: Record<string, string>,
): Promise<void> {
  const cab = await sheets.cabecalho(doc, aba);
  const iProt = cab.findIndex((h) => h.trim().toLowerCase() === 'protocol');
  if (iProt < 0) throw new Error(`a aba "${aba}" nao tem a coluna protocol`);
  const ultima = indiceParaColuna(cab.length - 1);

  const protocolos = await sheets.coluna(doc, aba, indiceParaColuna(iProt));
  const i = protocolos.findIndex((p) => p.trim() === dados.protocol);

  if (i < 0) {
    await sheets.acrescentar(doc, aba, montarLinhaPorCabecalho(cab, dados));
    return;
  }
  const n = i + 2; // a coluna comeca na linha 2
  const atual = await sheets.linha(doc, aba, n, ultima);
  await sheets.atualizar(doc, aba, n, ultima, montarLinhaPorCabecalho(cab, dados, atual));
}

/** O que se sabe de quem chamou direto no WhatsApp, sem clique nem protocolo. */
export interface LeadDiretoPlanilha {
  /** Quando a primeira mensagem chegou (ms). */
  chegouEm: number;
  /** Ja' passado por `nomeParaExibir`. */
  nome: string;
  /** So' digitos, com o 55. */
  telefone: string;
}

/**
 * Grava o lead direto na planilha de LEADS: Geral e a aba de lead direto.
 *
 * O Banco de Dados fica de fora de proposito: ele guarda clique e protocolo, e
 * este lead nao tem nenhum dos dois. SEQUENCIA fica em branco, como sempre
 * (quem numera e' o script da planilha). A trava de "uma linha por lead" e' a
 * mesma de sempre: telefone ja' presente na aba nao entra de novo.
 *
 * Devolve as abas escritas; falha em alguma aba sobe como erro para quem chama
 * poder retentar.
 */
export async function gravarLeadDireto(
  env: Env,
  tenantId: number,
  lead: LeadDiretoPlanilha,
): Promise<string[]> {
  const cfg = await env.DB.prepare(
    `SELECT sheets_ativo, planilha_modo, sheets_leads_doc_id, sheets_aba_geral, sheets_aba_direto
     FROM tenant_config WHERE tenant_id = ?`,
  )
    .bind(tenantId)
    .first<{
      sheets_ativo: number; planilha_modo: string; sheets_leads_doc_id: string | null;
      sheets_aba_geral: string | null; sheets_aba_direto: string | null;
    }>();

  if (!cfg || cfg.sheets_ativo !== 1 || cfg.planilha_modo !== 'sistema') return [];
  if (!cfg.sheets_leads_doc_id || !cfg.sheets_aba_direto) return [];

  const quando = dataHoraBrasilia(lead.chegouEm);
  const registro: Record<string, unknown> = {
    data: quando.data,
    hora: quando.hora,
    timestamp: quando.timestamp,
    canal: CANAL_DIRETO_WHATSAPP,
    plataforma: '',
    pagina: '',
    pagina_slug: '',
    nome: lead.nome,
    telefone: lead.telefone,
    link_whatsapp: lead.telefone ? `https://wa.me/${lead.telefone}` : '',
  };

  const sheets = new SheetsClient(env);
  const feitas: string[] = [];
  const falhas: string[] = [];
  const abas = [cfg.sheets_aba_geral, cfg.sheets_aba_direto].filter((a): a is string => !!a);
  for (const aba of abas) {
    try {
      await acrescentarLead(sheets, cfg.sheets_leads_doc_id, aba, registro);
      feitas.push(aba);
    } catch (e) {
      falhas.push(`${aba}: ${(e as Error).message}`);
    }
  }
  if (falhas.length) {
    throw new Error(`${falhas.join(' | ')}${feitas.length ? ` (gravou: ${feitas.join(', ')})` : ''}`);
  }
  return feitas;
}
