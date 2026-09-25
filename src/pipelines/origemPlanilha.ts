import type { Env } from '../env';
import { SheetsClient } from '../clients/sheets';
import { phoneKey } from '../domain/phone';
import { campoDaColunaLeads, indiceParaColuna } from '../domain/planilha';
import { origemDoAnuncio, codigoDePlataforma } from '../domain/origemAnuncio';

/**
 * Preenche a coluna ORIGEM vazia da aba Geral de cada cliente.
 *
 * O lead que o CRM grava ja' chega com a ORIGEM. Este passo cuida dos outros:
 * a linha que o n8n/Make escreve (quiz, formularios) nasce sem ela. A cada 15
 * min le' a Geral, e para cada linha sem ORIGEM tenta o clique do CRM pelo
 * telefone e, se nao houver, o codigo de plataforma que a propria linha traz
 * ("ig", "fb", "google"). Sem evidencia fica vazio — nunca chuta.
 *
 * Uma leitura por cliente por passada: a cota do Sheets e' por minuto e o
 * vigia do WhatsApp roda no mesmo disparo.
 */

interface Cliente {
  tenant_id: number;
  doc: string;
  aba: string;
}

interface Lead {
  phone_key: string;
  utm_source: string | null;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  fbc: string | null;
  referrer: string | null;
}

export async function preencherOrigemNasGerais(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT c.tenant_id, c.sheets_leads_doc_id AS doc, c.sheets_aba_geral AS aba
     FROM tenant_config c JOIN tenants t ON t.id = c.tenant_id
     WHERE t.ativo = 1 AND c.sheets_ativo = 1 AND c.planilha_modo = 'sistema'
       AND c.sheets_leads_doc_id IS NOT NULL AND c.sheets_aba_geral IS NOT NULL`,
  ).all<Cliente>();

  for (const c of results) {
    try {
      const r = await preencherOrigemNaGeral(env, c.tenant_id, c.doc, c.aba);
      if (r.gravadas) console.log(JSON.stringify({ acao: 'origem_planilha', tenant_id: c.tenant_id, gravadas: r.gravadas }));
    } catch (e) {
      console.log(JSON.stringify({ acao: 'origem_planilha_erro', tenant_id: c.tenant_id, erro: (e as Error).message.slice(0, 200) }));
    }
  }
}

export async function preencherOrigemNaGeral(
  env: Env,
  tenantId: number,
  doc: string,
  aba: string,
): Promise<{ gravadas: number; motivo?: string }> {
  const sheets = new SheetsClient(env);
  const linhas = await sheets.tudo(doc, aba);
  const cab = linhas[0] ?? [];
  const iOrigem = cab.findIndex((h) => campoDaColunaLeads(h) === 'origem_anuncio');
  if (iOrigem < 0) return { gravadas: 0, motivo: `a aba "${aba}" nao tem a coluna ORIGEM` };

  const iFone = cab.findIndex((h) => campoDaColunaLeads(h) === 'telefone');
  const iLink = cab.findIndex((h) => campoDaColunaLeads(h) === 'link_whatsapp');
  const iCanal = cab.findIndex((h) => campoDaColunaLeads(h) === 'canal');
  const corpo = linhas.slice(1);

  // so' as linhas sem ORIGEM e com telefone entram na consulta
  const pendentes = corpo
    .map((l, i) => ({ i, chave: phoneKey(l[iFone] ?? '') || phoneKey(l[iLink] ?? ''), canal: iCanal >= 0 ? l[iCanal] ?? '' : '' }))
    .filter((p) => !String(corpo[p.i]![iOrigem] ?? '').trim() && (p.chave || p.canal));
  if (!pendentes.length) return { gravadas: 0 };

  const porTelefone = await leadsPorTelefone(env, tenantId, [...new Set(pendentes.map((p) => p.chave).filter(Boolean))]);

  const celulas: Array<{ celula: string; valor: string }> = [];
  for (const p of pendentes) {
    const lead = p.chave ? porTelefone.get(p.chave) : undefined;
    const doClique = lead ? origemDoAnuncio(lead) : '';
    const daLinha = codigoDePlataforma(p.canal);
    // "meta" do clique e' a plataforma sem a rede; a linha do quiz sabe se foi ig ou fb
    const origem = doClique && doClique !== 'meta' ? doClique : (daLinha || doClique);
    if (origem) celulas.push({ celula: `${indiceParaColuna(iOrigem)}${p.i + 2}`, valor: origem });
  }
  if (celulas.length) await sheets.gravarCelulas(doc, aba, celulas);
  return { gravadas: celulas.length };
}

/** O clique mais recente de cada telefone, em lotes que cabem no bind do D1. */
async function leadsPorTelefone(env: Env, tenantId: number, chaves: string[]): Promise<Map<string, Lead>> {
  const mapa = new Map<string, Lead>();
  for (let i = 0; i < chaves.length; i += 50) {
    const lote = chaves.slice(i, i + 50);
    const { results } = await env.DB.prepare(
      `SELECT phone_key, utm_source, gclid, gbraid, wbraid, fbc, referrer FROM leads
       WHERE tenant_id = ? AND phone_key IN (${lote.map(() => '?').join(',')})
       ORDER BY created_at DESC`,
    )
      .bind(tenantId, ...lote)
      .all<Lead>();
    for (const l of results) {
      // o mais recente com evidencia vence; o sem evidencia nao apaga o que ja se sabe
      if (!mapa.has(l.phone_key) || (!origemDoAnuncio(mapa.get(l.phone_key)!) && origemDoAnuncio(l))) mapa.set(l.phone_key, l);
    }
  }
  return mapa;
}
