/**
 * Validacao do cadastro de cliente.
 *
 * O slug entra na URL de ingestao (`/ingest/<slug>/chatwoot`), entao precisa
 * sobreviver a copiar e colar: sem acento, sem espaco, sem maiuscula.
 */

export interface ClienteEntrada {
  nome?: string | null;
  slug?: string | null;
  cw_account_id?: number | null;
  cw_board_funil_id?: number | null;
  cw_board_organico_id?: number | null;
}

export function normalizarSlug(v: string | null | undefined): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface ResultadoValidacao {
  erros: string[];
  slug: string;
}

export function validarCliente(c: ClienteEntrada): ResultadoValidacao {
  const erros: string[] = [];
  const slug = normalizarSlug(c.slug || c.nome);

  if (!String(c.nome ?? '').trim()) erros.push('nome é obrigatório');
  if (!slug) erros.push('endereço do cliente inválido — use letras ou números no nome');
  if (!c.cw_account_id) erros.push('conta do Chatwoot é obrigatória');

  // Sem o board do funil o aviso de lead novo no grupo nao tem gatilho, porque
  // e' a entrada nele que dispara.
  if (!c.cw_board_funil_id) erros.push('board do funil de Ads é obrigatório');

  if (c.cw_board_funil_id && c.cw_board_funil_id === c.cw_board_organico_id) {
    erros.push('o funil de Ads e a entrada não podem ser o mesmo board');
  }

  return { erros, slug };
}

/** Chave da rota de ingestao do GTM. 24 bytes em base64url. */
export function gerarIngestKey(): string {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
