import type { DenyRule } from './types';

/**
 * Extracao e canonizacao de e-mail.
 *
 * Portado de `normEmail` / `acharEmail` / `bloqueado` dos nos Code do n8n.
 *
 * A canonizacao importa porque o e-mail vira hash SHA-256 no Data Manager:
 * "Jo.ao+promo@Gmail.com" e "joaosilva@gmail.com" precisam gerar o MESMO hash,
 * senao o Google nao casa o evento com o usuario.
 */

const FORMATO = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/;
const NO_TEXTO = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

/** Canoniza o endereco. Devolve vazio se nao for um e-mail valido. */
export function normEmail(raw: string | null | undefined): string {
  const e = String(raw ?? '').trim().toLowerCase();
  if (!FORMATO.test(e)) return '';

  const [userRaw = '', domRaw = ''] = e.split('@');
  let user = userRaw;
  let dom = domRaw;

  if (dom === 'googlemail.com') dom = 'gmail.com';
  // no gmail o ponto e' ignorado e o sufixo +tag e' descartado
  if (dom === 'gmail.com') user = (user.split('+')[0] ?? '').replace(/\./g, '');

  return user && dom ? `${user}@${dom}` : '';
}

/** true quando o endereco cai numa regra da denylist do tenant. */
export function isBlocked(email: string, regras: DenyRule[]): boolean {
  const e = String(email ?? '').trim().toLowerCase();
  if (!e) return false;
  const dom = e.split('@')[1] ?? '';

  return regras.some((r) => {
    const v = r.valor.toLowerCase();
    if (r.tipo === 'exato') return e === v;
    if (r.tipo === 'dominio') return dom === v || dom.endsWith('.' + v);
    try {
      return new RegExp(r.valor, 'i').test(e);
    } catch {
      return false; // regex invalida cadastrada no painel nao derruba o pipeline
    }
  });
}

/**
 * Acha o primeiro e-mail aproveitavel dentro de um texto livre.
 *
 * Tolera as duas formas que o lead usa para driblar o teclado do celular:
 * "joao (arroba) gmail.com" e "joao @ gmail.com".
 */
export function findEmail(texto: string | null | undefined, regras: DenyRule[]): string {
  const s = String(texto ?? '');
  if (!s) return '';

  const limpo = s.replace(/\(arroba\)/gi, '@').replace(/\s*@\s*/g, '@');
  const achados = limpo.match(NO_TEXTO) ?? [];

  for (const bruto of achados) {
    const e = normEmail(bruto);
    if (e && !isBlocked(e, regras)) return e;
  }
  return '';
}
