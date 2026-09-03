import { normEmail } from './email';
import { normFone } from './phone';

/**
 * O corpo da conversão que sobe para o Google Ads, pela Data Manager API.
 *
 * NÃO é a API do Google Ads. `ConversionUploadService.UploadClickConversions`
 * está fechada para integração nova — a conta responde
 * `CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE` e manda usar a Data Manager.
 * Descoberto validando um envio real em modo de conferência, antes do primeiro
 * envio de verdade.
 *
 * O diagnóstico da conta pedia duas coisas, e as duas mudam a qualidade da
 * atribuição, não só o aviso da tela:
 *
 *   "make sure the event snippet has a transaction ID"
 *   → `orderId`. Sem ele o Google não consegue deduplicar, e um reenvio nosso
 *     vira uma segunda conversão para a mesma venda.
 *
 *   "The Google tag is firing, but is not capturing user provided data"
 *   → `userIdentifiers`. E-mail e telefone com hash sobem junto do clique e
 *     recuperam a conversão quando o gclid expirou, foi bloqueado, ou o lead
 *     trocou de aparelho entre o anúncio e a mensagem.
 *
 * Nada disso é enfeite: o gclid sozinho perde toda conversão em que o
 * navegador do lead não colaborou.
 */

export interface EntradaConversao {
  /** Conta operacional do cliente no Google Ads, só dígitos. */
  accountId: string;
  /** Id da ação de conversão — no Data Manager é o destino do evento. */
  conversionActionId: string;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  /** Quando a conversão aconteceu, em ms. */
  quando: number;
  valor: number | null;
  moeda: string;
  /** Protocolo + evento. É a chave de deduplicação, nossa e do Google. */
  transactionId: string;
  email?: string | null;
  telefone?: string | null;
}

/** Um evento no formato da Data Manager API. */
export interface EventoDataManager {
  transactionId: string;
  /** Obrigatorio. `WEB` porque o clique aconteceu no site do cliente. */
  eventSource: 'WEB';
  eventTimestamp: string;
  lastUpdatedTimestamp: string;
  adIdentifiers?: { gclid?: string; gbraid?: string; wbraid?: string };
  currency?: string;
  conversionValue?: number;
  userData?: { userIdentifiers: Array<{ emailAddress?: string; phoneNumber?: string }> };
}

export interface CorpoIngest {
  destinations: Array<{
    /**
     * A conta pela qual o acesso e' concedido — o MCC.
     *
     * Sem ela a API responde 403 "The caller does not have permission": o
     * consentimento vale no MCC, nao diretamente em cada conta filha.
     */
    loginAccount: { product: 'GOOGLE_ADS'; accountId: string };
    operatingAccount: { product: 'GOOGLE_ADS'; accountId: string };
    productDestinationId: string;
  }>;
  events: EventoDataManager[];
  encoding: 'HEX';
  validateOnly: boolean;
}

/**
 * SHA-256 em hex minúsculo, que é o que o Google espera com `encoding: HEX`.
 *
 * O dado do lead nunca sai daqui em claro: o hash é calculado antes de montar
 * o corpo, e o corpo é a única coisa que vai para a rede.
 */
export async function hash(v: string): Promise<string> {
  const bytes = new TextEncoder().encode(v);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Monta o evento.
 *
 * Um identificador de clique basta para o Google atribuir; os dados do lead
 * entram por cima para recuperar o caso em que ele falhou. Sem nenhum dos dois
 * não há o que mandar — e devolver `null` é melhor do que subir um evento que
 * o Google descarta em silêncio.
 */
export async function montarEvento(e: EntradaConversao): Promise<EventoDataManager | null> {
  const ev: EventoDataManager = {
    transactionId: e.transactionId,
    // Obrigatório — a API recusa com REQUIRED_FIELD_MISSING sem ele. `WEB`
    // porque o clique aconteceu no site, antes de virar conversa no WhatsApp.
    eventSource: 'WEB',
    // ISO 8601 com fuso, que é o que a Data Manager aceita
    eventTimestamp: new Date(e.quando).toISOString(),
    lastUpdatedTimestamp: new Date().toISOString(),
  };

  // Um só: mandar gclid e gbraid juntos faz o Google recusar o evento.
  if (e.gclid) ev.adIdentifiers = { gclid: e.gclid };
  else if (e.gbraid) ev.adIdentifiers = { gbraid: e.gbraid };
  else if (e.wbraid) ev.adIdentifiers = { wbraid: e.wbraid };

  if (e.valor !== null && e.valor > 0) {
    ev.conversionValue = e.valor;
    ev.currency = e.moeda;
  }

  const ids: Array<{ emailAddress?: string; phoneNumber?: string }> = [];
  const email = normEmail(e.email);
  if (email) ids.push({ emailAddress: await hash(email) });
  const fone = normFone(e.telefone);
  if (fone) ids.push({ phoneNumber: await hash(fone) });
  if (ids.length) ev.userData = { userIdentifiers: ids };

  if (!ev.adIdentifiers && !ids.length) return null;
  return ev;
}

/** O lote pronto para `events:ingest`. */
export function montarCorpo(
  accountId: string,
  conversionActionId: string,
  eventos: EventoDataManager[],
  validateOnly: boolean,
  mccId: string,
): CorpoIngest {
  return {
    destinations: [{
      loginAccount: { product: 'GOOGLE_ADS', accountId: mccId },
      operatingAccount: { product: 'GOOGLE_ADS', accountId },
      productDestinationId: conversionActionId,
    }],
    events: eventos,
    encoding: 'HEX',
    validateOnly,
  };
}

/** O que falta para a conversão ser aceita, em português, para a tela. */
export function conferirEvento(ev: EventoDataManager | null): string[] {
  if (!ev) return ['sem gclid e sem dados do lead — o Google não teria como atribuir'];
  const faltas: string[] = [];
  if (!ev.adIdentifiers) {
    faltas.push('sem identificador de clique: a atribuição depende só do e-mail ou telefone');
  }
  if (!ev.userData?.userIdentifiers.length) {
    faltas.push('sem e-mail nem telefone: se o gclid tiver expirado, a conversão se perde');
  }
  if (!ev.transactionId) faltas.push('sem transactionId: o Google não consegue deduplicar reenvios');
  return faltas;
}
