import type { Env } from '../env';
import { postarNaPlanilha } from '../clients/n8n';
import { SheetsClient } from '../clients/sheets';
import {
  montarRegistro, montarLinhaPorCabecalho, linhaDeLeads, indiceParaColuna, campoDaColunaLeads, jaTemTelefone,
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
  leads_aba: string | null;
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
            c.sheets_leads_aba, t.nome AS cliente
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
      leads_aba: cfg.sheets_leads_aba,
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

  if (destino.leads_doc && destino.leads_aba && registro.conversao === 'conversa') {
    const doc = destino.leads_doc;
    const aba = destino.leads_aba;
    await tentar(aba, async () => {
      const cab = await sheets.cabecalho(doc, aba);
      if (!cab.length) throw new Error(`a aba "${aba}" esta sem cabecalho na primeira linha`);

      // uma linha por lead: quem ja' esta' na planilha (reenvio, ou gravado
      // pelo n8n antes) nao ganha outra
      const telefone = String(registro.telefone ?? '');
      const iFone = cab.findIndex((h) => campoDaColunaLeads(h) === 'telefone');
      const iLink = cab.findIndex((h) => campoDaColunaLeads(h) === 'link_whatsapp');
      const iCol = iFone >= 0 ? iFone : iLink;
      if (telefone && iCol >= 0 && jaTemTelefone(await sheets.coluna(doc, aba, indiceParaColuna(iCol)), telefone)) {
        return;
      }
      await sheets.acrescentar(doc, aba, linhaDeLeads(cab, registro));
    });
  }

  if (falhas.length) {
    throw new Error(`${falhas.join(' | ')}${feitas.length ? ` (gravou: ${feitas.join(', ')})` : ''}`);
  }
  return feitas;
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
