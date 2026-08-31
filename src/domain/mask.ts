/**
 * Mascaramento de dado pessoal para exibicao no painel.
 *
 * O payload cru do webhook e' guardado inteiro — sem ele nao da' para
 * diagnosticar um campo inesperado. Mas a tela mostra mascarado: o painel
 * agrega os leads de todos os clientes, e ler telefone e e-mail de gente que
 * nao e' nossa nao faz parte de operar a ferramenta.
 *
 * O valor real continua no banco e sai pelo endpoint de "revelar", que e'
 * uma acao deliberada e registrada.
 */

const MAX_TEXTO = 120;

/** Campos que carregam telefone. */
const CAMPOS_FONE = new Set(['phone_number', 'phone', 'phone_lead', 'telefone', 'lead_telefone']);
/** Campos que carregam e-mail. */
const CAMPOS_EMAIL = new Set(['email', 'email_lead', 'lead_email']);
/** Campos de texto livre — podem conter qualquer coisa que o lead digitou. */
const CAMPOS_TEXTO = new Set(['content', 'processed_message_content', 'description']);
/** JID do WhatsApp: `5511996316799@s.whatsapp.net` carrega o numero inteiro. */
const CAMPOS_IDENTIFIER = new Set(['identifier', 'source_id']);

export function maskPhone(v: string | null | undefined): string {
  const s = String(v ?? '');
  if (!s) return '';

  const mais = s.startsWith('+');
  const d = s.replace(/\D/g, '');
  // curto demais para mostrar prefixo e sufixo sem revelar quase tudo
  if (d.length < 8) return '*'.repeat(Math.max(d.length, 4));

  const prefixo = mais ? d.slice(0, 4) : d.slice(0, 2);
  const sufixo = d.slice(-2);
  const escondidos = d.length - prefixo.length - sufixo.length;
  return (mais ? '+' : '') + prefixo + '*'.repeat(escondidos) + sufixo;
}

export function maskEmail(v: string | null | undefined): string {
  const s = String(v ?? '').trim().toLowerCase();
  const at = s.indexOf('@');
  if (at < 1 || !s.slice(at + 1).includes('.')) return '';

  const user = s.slice(0, at);
  const dominio = s.slice(at);
  if (user.length <= 1) return '*' + dominio;
  return user[0] + '*'.repeat(user.length - 1) + dominio;
}

function maskIdentifier(v: string): string {
  // preserva o sufixo (@s.whatsapp.net) porque ele diz o canal, nao a pessoa
  const at = v.indexOf('@');
  if (at < 0) return maskPhone(v);
  return maskPhone(v.slice(0, at)) + v.slice(at);
}

function truncar(v: string): string {
  return v.length <= MAX_TEXTO ? v : v.slice(0, MAX_TEXTO) + '…';
}

function mascarar(no: unknown, chave?: string): unknown {
  if (Array.isArray(no)) return no.map((v) => mascarar(v, chave));

  if (no && typeof no === 'object') {
    const saida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(no as Record<string, unknown>)) {
      saida[k] = mascarar(v, k);
    }
    return saida;
  }

  if (typeof no === 'string' && chave) {
    if (CAMPOS_FONE.has(chave)) return maskPhone(no);
    if (CAMPOS_EMAIL.has(chave)) return maskEmail(no) || no;
    if (CAMPOS_IDENTIFIER.has(chave)) return maskIdentifier(no);
    if (CAMPOS_TEXTO.has(chave)) return truncar(no);
  }

  return no;
}

/**
 * Recebe o payload cru e devolve json mascarado, pronto para a tela.
 * Payload ilegivel volta truncado em vez de sumir — ver o lixo que chegou faz
 * parte do diagnostico.
 */
export function maskPayload(raw: string | null | undefined): string {
  const s = String(raw ?? '');
  if (!s) return '';

  try {
    return JSON.stringify(mascarar(JSON.parse(s)), null, 2);
  } catch {
    return truncar(s);
  }
}
