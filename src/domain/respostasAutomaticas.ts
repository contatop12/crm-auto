import { limpa } from './text';

/**
 * Motivo gravado em `card_moves` quando a mensagem é da automação. O painel
 * conta por ele quantas vezes cada trecho segurou o card, e a checagem dos
 * gatilhos o deixa de fora: não é o atendente movendo o funil.
 */
export const MOTIVO_AUTOMATICA = 'mensagem automatica';

/**
 * Trecho curto demais segura o atendente junto.
 *
 * "Olá, tudo bem?" aparece na boas-vindas e em metade das respostas de gente:
 * cadastrado, o card nunca sairia de "Novo Lead". Com 20 letras o trecho já
 * precisa ser um pedaço que só a automação escreve.
 */
export const TRECHO_MINIMO = 20;

/**
 * A mensagem que o sistema manda sozinho não é resposta do atendente.
 *
 * "Qualificando" avança na primeira resposta do comercial. A boas-vindas do
 * Chatwoot e a mensagem de continuidade do fluxo do formulário também saem como
 * `outgoing`, e em segundos: o card saía de "Novo Lead" antes de qualquer
 * pessoa olhar o lead.
 *
 * Compara normalizado e por "contém", como `casarFraseDeEntrada`: o nome do
 * lead entra no meio do texto ("Olá, Everton! ...") e o WhatsApp mexe no
 * espaçamento.
 *
 * Devolve o trecho cadastrado que casou, como está no cadastro, para o
 * histórico apontar qual deles segurou o card.
 */
export function casarRespostaAutomatica(
  texto: string | null | undefined,
  frases: Array<{ frase: string }>,
): string | null {
  const t = semFormatacao(texto);
  if (!t) return null;
  const achou = frases.find((f) => {
    const alvo = semFormatacao(f.frase);
    return !!alvo && t.includes(alvo);
  });
  return achou ? achou.frase : null;
}

/**
 * `limpa` sem os marcadores do WhatsApp (*negrito*, _itálico_, ~riscado~).
 *
 * A mensagem chega crua, com os asteriscos; o trecho é copiado do Chatwoot ou
 * do WhatsApp, que mostram o negrito e copiam sem eles. Num trecho longo quase
 * sempre há um pedaço em negrito, e ele nunca casaria.
 */
function semFormatacao(s: string | null | undefined): string {
  return limpa(String(s ?? '').replace(/[*_~`]/g, ''));
}

/** O erro a mostrar no cadastro, ou `null` quando o trecho serve. */
export function validarRespostaAutomatica(frase: string | null | undefined): string | null {
  const t = limpa(frase);
  if (!t) return 'cole um trecho da mensagem automática';
  if (t.length < TRECHO_MINIMO) {
    return `trecho curto demais (mínimo ${TRECHO_MINIMO} letras): um trecho genérico também seguraria a resposta do atendente`;
  }
  return null;
}

/**
 * Até quantos segundos depois do lead a mensagem enviada é da máquina.
 *
 * Medido em 30 dias de funil (28/10/2026): boas-vindas, "fora do horário" e o
 * fluxo do formulário saem de 0 a 3 s depois do lead ou já abrindo a conversa;
 * a atendente mais rápida levou 11 s. 15 s cobre a automação atrasada pela
 * fila sem pegar quase ninguém de verdade — e quem for pego move o card na
 * mensagem seguinte.
 */
export const JANELA_AUTOMATICA_S = 15;

/**
 * `card_moves.gatilho` da mensagem segurada pelo tempo. Nenhum trecho cadastrado
 * colide: o cadastro exige 20 letras.
 */
export const GATILHO_TEMPO = 'pelo tempo';

/** Mensagem como a rota de mensagens do Chatwoot devolve (`created_at` em segundos). */
export interface MensagemCw {
  id: number;
  /** 0 = do lead, 1 = enviada, 2 = atividade, 3 = modelo */
  message_type: number;
  created_at: number;
  private?: boolean;
}

/**
 * Segundos entre a mensagem enviada e o que a disparou, quando caiu na janela
 * da automação; null quando é resposta de gente.
 *
 * Não dá para saber pelo remetente nem pelo id: toda mensagem chega ao Chatwoot
 * pela mesma integração, e a boas-vindas do WhatsApp Business sai do próprio
 * celular, com o id de uma mensagem digitada. O que separa é o tempo.
 *
 * O gatilho é a última mensagem do lead até ali. Sem nenhuma, é o início da
 * conversa — o fluxo do formulário escreve antes de o lead dizer qualquer coisa.
 */
export function segundosDaAutomatica(
  msg: { id: number; created_at: number },
  conversa: MensagemCw[],
): number | null {
  const ate = conversa.filter((m) => m.id !== msg.id && m.created_at <= msg.created_at);
  const doLead = ate.filter((m) => m.message_type === 0 && !m.private).map((m) => m.created_at);
  const gatilho = doLead.length
    ? Math.max(...doLead)
    : Math.min(msg.created_at, ...ate.map((m) => m.created_at));
  const s = msg.created_at - gatilho;
  return s <= JANELA_AUTOMATICA_S ? s : null;
}
