import { nomeUtil } from './nomeLead';

/**
 * Titulo do card do Kanban: "#1240 - 5511932346062 - Vital".
 *
 * O Chatwoot cria o card como "Conversa #1240 - Vital": o nome e' o do perfil
 * do WhatsApp no momento em que a conversa nasceu, e nao muda mais (o card
 * "Conversa #4 - 5511932347701" da Locadora continua assim com o contato ja'
 * chamado "Meire"). Nome de perfil sozinho nao identifica ninguem no funil; o
 * telefone identifica, e o nome fica depois dele para quem bate o olho.
 *
 * O "#N" fica: e' por ele que o card orfao acha a conversa de volta (ver
 * orfaos.ts).
 */

const TITULO_DO_CARD = /^(?:Conversa\s*)?#(\d+)\s*(?:-\s*([\s\S]*))?$/i;

/** O titulo novo, ou null quando nao ha o que trocar. */
export function tituloDoCard(
  titulo: string | null | undefined,
  telefone: string | null | undefined,
  nome: string | null | undefined,
): string | null {
  const atual = String(titulo ?? '');
  const m = TITULO_DO_CARD.exec(atual);
  // card criado a mao: o titulo e' de quem criou
  if (!m) return null;

  // so' digitos, sem o '+': e' o formato que o proprio Chatwoot usa quando o
  // contato chega sem nome ("Conversa #828 - 5511963925521")
  const digitos = String(telefone ?? '').replace(/\D/g, '');
  // grupo e Instagram nao tem telefone: o titulo fica
  if (digitos.length < 10) return null;

  // O nome do contato quando presta ("*~", emoji e o proprio telefone nao
  // prestam). Senao, o que o titulo ja' tinha depois do telefone.
  const doTitulo = (m[2] ?? '').replace(/^\+?\d{10,}\s*(?:-\s*)?/, '');
  const quem = nomeUtil(nome, { telefone }) ?? nomeUtil(doTitulo, { telefone });

  const novo = quem ? `#${m[1]} - ${digitos} - ${quem}` : `#${m[1]} - ${digitos}`;
  return novo === atual ? null : novo;
}
