import { hash } from './conversao';
import { normEmail } from './email';
import { normFone } from './phone';
import type { CanalMeta } from './plataformaLead';

/**
 * O evento que sobe para a Conversions API da Meta.
 *
 * Portado de `sendCapíEvent` do whatsapp-track (canal de mensagem, provado em
 * producao: 30 LeadSubmitted aceitos) e estendido ao canal do site.
 *
 * O dado do lead sai daqui so' com hash, como no Google: telefone e e-mail em
 * SHA-256. Fica em claro so' o que a Meta exige assim: ctwa_clid, fbc, fbp, IP
 * e user agent.
 */

export type EventoMeta = 'LeadSubmitted' | 'Purchase';

export interface EntradaEventoMeta {
  canal: CanalMeta;
  evento: EventoMeta;
  /** Protocolo + evento. A Meta deduplica por ele. */
  eventId: string;
  /** Quando aconteceu, em ms. */
  quando: number;
  valor: number | null;
  moeda: string;
  telefone: string | null;
  email: string | null;
  ctwaClid: string | null;
  pageId: string | null;
  wabaId: string | null;
  fbc: string | null;
  fbp: string | null;
  ip: string | null;
  userAgent: string | null;
  pagina: string | null;
}

export type EventoCapi = Record<string, unknown>;
export type Montagem = { ok: true; evento: EventoCapi } | { ok: false; erro: string };

/**
 * `LeadSubmitted` e' o nome em mensagem: la' o pixel "Lead" e' recusado
 * (subcode 2804066). No site vale o nome padrao do pixel, `Lead`.
 */
export function nomeNoCanal(evento: EventoMeta, canal: CanalMeta): string {
  return canal === 'site' && evento === 'LeadSubmitted' ? 'Lead' : evento;
}

/** Telefone para a Meta: so' digitos, com DDI, sem '+'. */
export function telefoneMeta(t: string | null | undefined): string | null {
  const e164 = normFone(t);
  const digitos = e164 ? e164.slice(1) : String(t ?? '').replace(/\D/g, '');
  return digitos.length >= 10 ? digitos : null;
}

export async function montarEventoMeta(e: EntradaEventoMeta): Promise<Montagem> {
  const user: Record<string, unknown> = {};
  const fone = telefoneMeta(e.telefone);
  if (fone) user.ph = [await hash(fone)];

  const ev: EventoCapi = {
    event_name: nomeNoCanal(e.evento, e.canal),
    event_time: Math.floor(e.quando / 1000),
    event_id: e.eventId,
  };

  if (e.canal === 'whatsapp') {
    if (!e.ctwaClid) return { ok: false, erro: 'sem ctwa_clid: a Meta nao atribui evento de mensagem sem ele' };
    if (!e.pageId && !e.wabaId) {
      return { ok: false, erro: 'sem Pagina nem WABA no cadastro da Meta: a Meta recusaria (subcode 2804116)' };
    }
    user.ctwa_clid = e.ctwaClid;
    if (e.pageId) user.page_id = e.pageId;
    if (e.wabaId) user.whatsapp_business_account_id = e.wabaId;
    ev.action_source = 'business_messaging';
    ev.messaging_channel = 'whatsapp';
  } else {
    if (!e.fbc && !e.fbp) return { ok: false, erro: 'sem fbc nem fbp: o evento do site nao teria como ser atribuido' };
    if (!e.userAgent) return { ok: false, erro: 'sem user agent: a Meta exige no evento do site' };
    const email = normEmail(e.email);
    if (email) user.em = [await hash(email)];
    if (e.fbc) user.fbc = e.fbc;
    if (e.fbp) user.fbp = e.fbp;
    if (e.ip) user.client_ip_address = e.ip;
    user.client_user_agent = e.userAgent;
    ev.action_source = 'website';
    if (e.pagina) ev.event_source_url = e.pagina;
  }

  ev.user_data = user;
  if (e.valor !== null && e.valor > 0) ev.custom_data = { value: e.valor, currency: e.moeda };
  return { ok: true, evento: ev };
}

/** O lote pronto para `/{dataset}/events`. Com codigo de teste, nada conta como conversao. */
export function corpoMeta(
  eventos: EventoCapi[],
  codigoDeTeste: string | null,
): { data: EventoCapi[]; test_event_code?: string } {
  const codigo = (codigoDeTeste ?? '').trim();
  return codigo ? { data: eventos, test_event_code: codigo } : { data: eventos };
}
