import { limpa } from './text';

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
 */
export function ehRespostaAutomatica(
  texto: string | null | undefined,
  frases: Array<{ frase: string }>,
): boolean {
  const t = limpa(texto);
  if (!t) return false;
  return frases.some((f) => {
    const alvo = limpa(f.frase);
    return !!alvo && t.includes(alvo);
  });
}
