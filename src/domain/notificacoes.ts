/**
 * Central de notificacoes do painel.
 *
 * Junta num lugar so' o que hoje esta espalhado: erro de processamento (tabela
 * `events`), queda do WhatsApp (vigia, no KV) e configuracao que falta (o que a
 * aba Fluxo chama de pendencia). Antes, erro so' aparecia como "ultimo erro" no
 * cartao do cliente — e continuava la' depois de resolvido, porque nada dizia
 * que tinha sido.
 */

import { CONFIRMAR_EM, type EstadoVigia } from './vigiaWhatsapp';

export type TipoNotificacao = 'erro' | 'aviso';

export interface Notificacao {
  /** Identifica a notificacao para resolver/dispensar. */
  chave: string;
  tipo: TipoNotificacao;
  origem: 'evento' | 'whatsapp' | 'configuracao';
  tenant_id: number | null;
  cliente: string | null;
  titulo: string;
  detalhe: string;
  /** Ultima ocorrencia (formato do D1, UTC). */
  quando: string;
  /** Quantas vezes aconteceu (erros iguais viram uma notificacao so'). */
  quantidade: number;
  /** Aba do cliente onde se conserta. */
  aba: string | null;
  /** Eventos que "resolver" marca — so' nas notificacoes de erro de evento. */
  ids?: number[];
}

export interface ErroEvento {
  id: number;
  tenant_id: number | null;
  cliente: string | null;
  source: string;
  event_type: string | null;
  motivo: string | null;
  received_at: string;
}

/**
 * Protocolo e chave de conversao no texto do erro: `TAINA-MTLH789J6AVC` e
 * `TAINA-MTLH789J6AVC-proposta_enviada`. Trocados por um marcador, cem erros
 * iguais de protocolos diferentes viram uma linha so'.
 */
const PROTOCOLO = /\b[A-Z][A-Z0-9]{1,11}-[A-Z0-9]{6,}(?:-[a-z_0-9]+)?\b/g;

export function normalizarMotivo(m: string | null): string {
  return String(m ?? '').replace(PROTOCOLO, '…').replace(/\d{3,}/g, '#').trim();
}

/** A chave de conversao no comeco do erro ("PROTO-evento: ..."), se houver. */
export function chaveDoErro(m: string | null): string | null {
  const x = String(m ?? '').match(/^([A-Z][A-Z0-9]{1,11}-[A-Z0-9]{6,}-[a-z_0-9]+):/);
  return x ? x[1]! : null;
}

function tituloDoErro(e: ErroEvento): { titulo: string; aba: string } {
  const m = String(e.motivo ?? '');
  if (/pulseboard|grupo/i.test(m)) return { titulo: 'Aviso do lead no grupo não saiu', aba: 'atividade' };
  if (/planilha|sheets/i.test(m)) return { titulo: 'Planilha não foi preenchida', aba: 'atividade' };
  switch (e.event_type) {
    case 'kanban_conversao': return { titulo: 'Conversão não subiu para o Google Ads', aba: 'google' };
    case 'assinatura_invalida': return { titulo: 'Webhook recusado (assinatura inválida)', aba: 'atividade' };
    case 'message_incoming': return { titulo: 'Mensagem do lead não foi processada', aba: 'atividade' };
    case 'message_outgoing': return { titulo: 'Resposta do vendedor não foi processada', aba: 'atividade' };
    case 'conversation_created': return { titulo: 'Conversa nova não foi processada', aba: 'atividade' };
    case 'click': return { titulo: 'Clique do site não foi registrado', aba: 'atividade' };
    default:
      if (e.source === 'meta') return { titulo: 'Lead do Meta não foi processado', aba: 'atividade' };
      return { titulo: 'Erro no processamento', aba: 'atividade' };
  }
}

/** Hash curto e estavel, para a chave nao carregar o texto do erro inteiro. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * Erros de evento agrupados por cliente + tipo + texto normalizado.
 *
 * `conversoesEnviadas` tira da lista o erro de conversao que ja' subiu num
 * reenvio: o sistema tambem marca esses como resolvidos ao subir, mas o erro
 * gravado antes desta regra existir so' sai por aqui.
 */
export function agruparErros(erros: ErroEvento[], conversoesEnviadas: Set<string>): Notificacao[] {
  const grupos = new Map<string, Notificacao>();
  for (const e of erros) {
    const chaveConv = chaveDoErro(e.motivo);
    if (chaveConv && conversoesEnviadas.has(`${e.tenant_id}:${chaveConv}`)) continue;
    const k = `${e.tenant_id ?? 0}|${e.event_type ?? e.source}|${normalizarMotivo(e.motivo)}`;
    const g = grupos.get(k);
    if (g) {
      g.quantidade++;
      g.ids!.push(e.id);
      if (e.received_at > g.quando) { g.quando = e.received_at; g.detalhe = String(e.motivo ?? ''); }
      continue;
    }
    const { titulo, aba } = tituloDoErro(e);
    grupos.set(k, {
      chave: `ev:${e.tenant_id ?? 0}:${hash(k)}`,
      tipo: 'erro',
      origem: 'evento',
      tenant_id: e.tenant_id,
      cliente: e.cliente,
      titulo,
      detalhe: String(e.motivo ?? 'sem detalhe'),
      quando: e.received_at,
      quantidade: 1,
      aba,
      ids: [e.id],
    });
  }
  return [...grupos.values()];
}

export interface ConfigCliente {
  tenant_id: number;
  cliente: string;
  validate_only: number;
  pulseboard_ativo: number;
  pulseboard_url: string | null;
  tem_segredo: number;
  cw_account_id: number | null;
  ga_customer_id: string | null;
  etapas: number;
  etapas_com_meta: number;
  gatilhos: number;
}

/**
 * O que falta configurar, por cliente. Mesmas regras da aba Fluxo. Sao avisos,
 * nao erros: alguns sao decisao (a Tile ficou sem gatilhos por escolha), e por
 * isso cada um pode ser dispensado.
 */
export function avisosDeConfiguracao(cfgs: ConfigCliente[], agora: string): Notificacao[] {
  const out: Notificacao[] = [];
  const aviso = (c: ConfigCliente, codigo: string, titulo: string, detalhe: string, aba: string, tipo: TipoNotificacao = 'aviso') =>
    out.push({ chave: `cfg:${c.tenant_id}:${codigo}`, tipo, origem: 'configuracao', tenant_id: c.tenant_id, cliente: c.cliente, titulo, detalhe, quando: agora, quantidade: 1, aba });
  for (const c of cfgs) {
    if (c.cw_account_id && !c.tem_segredo) {
      aviso(c, 'webhook', 'Webhook do Chatwoot não registrado', 'sem ele, nenhuma conversa deste cliente chega ao CRM', 'webhooks', 'erro');
    }
    if (c.validate_only) {
      aviso(c, 'sombra', 'Modo sombra ligado', 'as conversões só são validadas pelo Google, nada é contado', 'google');
    }
    if (!c.pulseboard_ativo) {
      aviso(c, 'pulseboard-off', 'Aviso do lead no grupo desligado', 'lead novo não é avisado no grupo do cliente', 'integracoes');
    } else if (!c.pulseboard_url) {
      aviso(c, 'pulseboard-url', 'Aviso no grupo sem endereço', 'ligado, mas falta a rota do Pulseboard no cadastro', 'integracoes', 'erro');
    }
    if (!c.etapas) {
      aviso(c, 'etapas', 'Etapas do funil não sincronizadas', 'sem etapas, card não anda e conversão não sobe', 'config', 'erro');
    } else if (c.ga_customer_id && !c.etapas_com_meta) {
      aviso(c, 'metas', 'Nenhuma etapa ligada a meta do Google Ads', 'o funil anda, mas nenhuma conversão sobe', 'google');
    }
    if (c.etapas && !c.gatilhos) {
      aviso(c, 'gatilhos', 'Sem frases-gatilho', 'o card só avança na mão (ou na primeira resposta)', 'config');
    }
  }
  return out;
}

/**
 * Quedas do WhatsApp que o vigia confirmou e ainda nao resolveram. A chave leva
 * o inicio da queda: dispensar uma nao esconde a proxima.
 */
export function avisosDoVigia(estado: EstadoVigia): Notificacao[] {
  const out: Notificacao[] = [];
  for (const [instancia, r] of Object.entries(estado)) {
    if (r.vezes < CONFIRMAR_EM || r.resolvidoEm) continue;
    out.push({
      chave: `wa:${instancia}:${r.tipo}:${r.desde}`,
      tipo: 'erro',
      origem: 'whatsapp',
      tenant_id: null,
      cliente: r.rotulo ?? instancia,
      titulo: r.tipo === 'servidor' ? 'Servidor do Evolution fora do ar' : `WhatsApp › Chatwoot: ${instancia}`,
      detalhe: r.texto ?? r.tipo,
      quando: new Date(r.desde).toISOString().slice(0, 19).replace('T', ' '),
      quantidade: r.vezes,
      aba: null,
    });
  }
  return out;
}

/** Erro antes de aviso; dentro de cada um, o mais recente primeiro. */
export function ordenar(n: Notificacao[]): Notificacao[] {
  return [...n].sort((a, b) => (a.tipo === b.tipo ? (a.quando < b.quando ? 1 : -1) : a.tipo === 'erro' ? -1 : 1));
}
