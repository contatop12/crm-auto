import { phoneKey } from './phone';

/**
 * O nome do lead, do jeito que chega do WhatsApp, e o que fazer com ele.
 *
 * O nome que o Chatwoot conhece e' o nome de PERFIL do WhatsApp (pushName), nao
 * um nome que o lead digitou. Na Vita isso virou "😊", ".", o telefone no lugar
 * do nome (quando a clinica fala primeiro, o contato nasce sem pushName) e ate'
 * o perfil da propria clinica ("Vita Audio Aparelhos Auditivos") contado como
 * lead. Aqui fica a regra unica para planilha, banco e aviso no grupo.
 *
 * Nada aqui corta o nome. "Maria Irene Justino De Ol" ja' chega assim do
 * WhatsApp (o pushName vem truncado em 25 caracteres na origem, antes do
 * Evolution); nenhum sistema nosso encurta.
 */

/** O que vai no lugar de um nome que nao identifica ninguem. */
export const SEM_NOME = 'Sem nome no WhatsApp';

/** Emoji, modificador de tom de pele, ZWJ e seletor de variacao. */
const EMOJI = /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}‍︎️⃣]/gu;

/** Tira emoji e espaco sobrando. Nao corta letra nenhuma. */
export function limparNome(bruto: string | null | undefined): string {
  return String(bruto ?? '')
    .replace(EMOJI, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export interface ContextoNome {
  /** Telefone do lead: um nome que e' so' esse numero nao e' nome. */
  telefone?: string | null;
  /** Nomes da propria empresa (o `tenants.nome`): o perfil dela nao e' lead. */
  nomesProprios?: Array<string | null | undefined>;
}

/**
 * O nome, limpo, quando ele identifica alguem; `null` quando nao.
 *
 * Nao serve: sem nenhuma letra (so' emoji, pontuacao ou digitos), igual ao
 * telefone, ou o nome da propria empresa.
 */
export function nomeUtil(bruto: string | null | undefined, ctx: ContextoNome = {}): string | null {
  const nome = limparNome(bruto);
  if (!nome || !/\p{L}/u.test(nome)) return null;

  const digitos = nome.replace(/\D/g, '');
  if (digitos.length >= 8 && ctx.telefone && phoneKey(digitos) && phoneKey(digitos) === phoneKey(ctx.telefone)) {
    return null;
  }

  const alvo = semAcento(nome);
  for (const proprio of ctx.nomesProprios ?? []) {
    const p = semAcento(String(proprio ?? ''));
    if (p.length >= 4 && alvo.includes(p)) return null;
  }
  return nome;
}

/** O nome para mostrar: o util, ou o aviso claro de que nao ha nome. */
export function nomeParaExibir(bruto: string | null | undefined, ctx: ContextoNome = {}): string {
  return nomeUtil(bruto, ctx) ?? SEM_NOME;
}

/**
 * `tenant_config.numeros_proprios`: JSON com os numeros da propria empresa.
 * Entrada ruim vira lista vazia — config quebrada nao pode derrubar a fila.
 */
export function lerNumerosProprios(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v.map((x) => String(x ?? '')).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** O telefone e' de um dos numeros da propria empresa? */
export function ehNumeroProprio(telefone: string | null | undefined, proprios: string[]): boolean {
  const alvo = phoneKey(telefone);
  if (!alvo) return false;
  return proprios.some((p) => phoneKey(p) === alvo);
}
