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
  const t = limpa(texto);
  if (!t) return null;
  const achou = frases.find((f) => {
    const alvo = limpa(f.frase);
    return !!alvo && t.includes(alvo);
  });
  return achou ? achou.frase : null;
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
