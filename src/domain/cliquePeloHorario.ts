import { casarRespostaAutomatica } from './respostasAutomaticas';

/**
 * Rede de seguranca: lead de anuncio cuja PRIMEIRA mensagem nao chegou.
 *
 * O protocolo vem na primeira mensagem do lead. Quando a integracao do
 * WhatsApp nao a entrega, a conversa nasce so' com a resposta automatica do
 * cliente, o CRM nunca ve o protocolo e o lead pago fica no Organico (conversa
 * 1724 da Locadora, 21/11/2026; 1 em 275 conversas novas em 17 dias).
 *
 * A resposta automatica do WhatsApp Business so' sai porque o lead escreveu:
 * ela abrir a conversa prova que houve uma mensagem que se perdeu. Medido na
 * Locadora: em 26 conversas normais com saudacao, ela NUNCA chegou antes da
 * mensagem do lead.
 *
 * O que liga a conversa ao anuncio, ai', e' o horario: um clique do site, sem
 * telefone e sem conversa, logo antes de a conversa nascer. E' inferencia, por
 * isso so' vale com um unico candidato.
 */

/**
 * Quanto antes da conversa o clique pode ter sido. Entre os leads que escrevem
 * logo depois de clicar, 50 de 52 mandaram em ate' 60 s (Locadora, nov/2026).
 */
export const ANTES_S = 120;

/**
 * O clique pode ser gravado DEPOIS da conversa: o aviso do site concorre com o
 * WhatsApp (ate' 32 s de atraso medidos).
 */
export const DEPOIS_S = 40;

/** Espera entre a resposta automatica e a conferencia: da' tempo de a mensagem do lead (e o clique) chegarem. */
export const ESPERA_S = 75;

/** So' conversa recem-criada agenda a conferencia. */
export const CONVERSA_NOVA_S = 600;

/** Mensagem como a rota de mensagens do Chatwoot devolve. */
export interface MensagemDaConversa {
  id: number;
  /** 0 = do lead, 1 = enviada, 2 = atividade, 3 = modelo */
  message_type: number;
  content?: string | null;
  private?: boolean;
}

/**
 * A conversa abriu com a resposta automatica do cliente, sem nada do lead antes?
 *
 * Mensagem do lead que chega depois nao muda a resposta: a primeira dele
 * continua perdida. Atividade do sistema e nota interna nao sao conversa.
 */
export function abriuSoComAutomatica(
  mensagens: MensagemDaConversa[],
  frases: Array<{ frase: string }>,
): boolean {
  const primeira = mensagens
    .filter((m) => (m.message_type === 0 || m.message_type === 1) && m.private !== true)
    .sort((a, b) => a.id - b.id)[0];
  if (!primeira || primeira.message_type !== 1) return false;
  return casarRespostaAutomatica(primeira.content, frases) !== null;
}

/** Faixa de `leads.created_at` (texto do D1, em UTC) em que o clique da conversa pode estar. */
export function janelaDoClique(conversaCriadaEmS: number): { de: string; ate: string } {
  const d1 = (s: number) => new Date(s * 1000).toISOString().slice(0, 19).replace('T', ' ');
  return { de: d1(conversaCriadaEmS - ANTES_S), ate: d1(conversaCriadaEmS + DEPOIS_S) };
}

/** Um candidato so', ou o motivo de nao ligar. */
export function escolherClique(
  candidatos: Array<{ protocol: string; created_at: string }>,
): { protocolo: string } | { motivo: string } {
  if (candidatos.length === 1) return { protocolo: candidatos[0]!.protocol };
  if (!candidatos.length) return { motivo: 'nenhum clique sem telefone no horario' };
  return {
    motivo: `${candidatos.length} cliques sem telefone no horario (${candidatos.map((c) => c.protocol).join(', ')}): nao da para saber qual`,
  };
}
