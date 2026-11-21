import { nomeUtil } from './nomeLead';
import { normFone } from './phone';
import { semVolta, voltaDoTitulo } from './retorno';

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

/**
 * O titulo novo, ou null quando nao ha o que trocar.
 *
 * `volta`: a volta do card segundo `retornos` (ver retorno.ts), 0 = card comum.
 * E' dado, nao texto: o card comum de um contato chamado "Ana #2" se comporta
 * exatamente como antes da volta existir, com o " #2" como parte do nome.
 */
export function tituloDoCard(
  titulo: string | null | undefined,
  telefone: string | null | undefined,
  nome: string | null | undefined,
  volta = 0,
): string | null {
  const atual = String(titulo ?? '');
  // Card da volta: o " #n" do fim sai antes do regex e volta no fim, senao o
  // "#n" viraria parte do nome e o nome novo o apagaria
  const m = TITULO_DO_CARD.exec(volta > 0 && voltaDoTitulo(atual) > 0 ? semVolta(atual) : atual);
  // card criado a mao: o titulo e' de quem criou
  if (!m) return null;

  // so' digitos, sem o '+': e' o formato que o proprio Chatwoot usa quando o
  // contato chega sem nome ("Conversa #828 - 5511963925521")
  const crus = String(telefone ?? '').replace(/\D/g, '');
  // Celular brasileiro sempre com o nono digito. A resposta do vendedor
  // regrava o contato com o JID do WhatsApp, que as vezes vem sem o 9
  // (+551186571182), e a mensagem seguinte do lead traz o 9 de volta: sem
  // isso o card trocava de numero a cada mensagem. Numero de fora fica como veio.
  const digitos = /^55\d{10,11}$/.test(crus) ? normFone(crus).slice(1) || crus : crus;
  // grupo e Instagram nao tem telefone: o titulo fica
  if (digitos.length < 10) return null;

  // O nome do contato quando presta ("*~", emoji e o proprio telefone nao
  // prestam). Senao, o que o titulo ja' tinha depois do telefone.
  const doTitulo = (m[2] ?? '').replace(/^\+?\d{10,}\s*(?:-\s*)?/, '');
  const quem = nomeUtil(nome, { telefone }) ?? nomeUtil(doTitulo, { telefone });

  if (volta > 0) {
    // O nome do lead do ciclo tambem leva " #n" (retorno.ts); o sufixo do
    // titulo e' um so', entao o do nome sai, e nome que sobra vazio vira "sem nome"
    const doCiclo = semVolta(quem ?? '').trim() || null;
    const base = doCiclo ? `#${m[1]} - ${digitos} - ${doCiclo}` : `#${m[1]} - ${digitos}`;
    const novo = `${base} #${volta}`;
    return novo === atual ? null : novo;
  }

  const novo = quem ? `#${m[1]} - ${digitos} - ${quem}` : `#${m[1]} - ${digitos}`;
  return novo === atual ? null : novo;
}
