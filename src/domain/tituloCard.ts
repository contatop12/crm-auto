/**
 * Titulo do card do Kanban com o telefone no lugar do nome.
 *
 * O Chatwoot cria o card como "Conversa #1240 - Vital": o nome e' o do perfil
 * do WhatsApp no momento em que a conversa nasceu, e nao muda mais (o card
 * "Conversa #4 - 5511932347701" da Locadora continua assim com o contato ja'
 * chamado "Meire"). Nome de perfil e' "Vital", "Caue", "😊" — no funil nao
 * identifica ninguem. O telefone identifica.
 *
 * O "Conversa #N" fica: e' por ele que o card orfao acha a conversa de volta
 * (ver orfaos.ts).
 */

const TITULO_DO_CHATWOOT = /^(Conversa\s*#\d+)\s*-\s*/i;

/** O titulo novo, ou null quando nao ha o que trocar. */
export function tituloComTelefone(
  titulo: string | null | undefined,
  telefone: string | null | undefined,
): string | null {
  const atual = String(titulo ?? '');
  const m = TITULO_DO_CHATWOOT.exec(atual);
  // card criado a mao: o titulo e' de quem criou
  if (!m) return null;

  // so' digitos, sem o '+': e' o formato que o proprio Chatwoot usa quando o
  // contato chega sem nome ("Conversa #828 - 5511963925521")
  const digitos = String(telefone ?? '').replace(/\D/g, '');
  // grupo e Instagram nao tem telefone: o nome fica
  if (digitos.length < 10) return null;

  const novo = `${m[1]} - ${digitos}`;
  return novo === atual ? null : novo;
}
