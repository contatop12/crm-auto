/**
 * Mostra o bastante para reconhecer, nunca o bastante para usar.
 *
 * A chave de ingestão grava dados no cliente. Quem opera precisa saber QUAL
 * chave está no ar — para conferir contra o que está colado no GTM ou no Make —
 * e não precisa lê-la inteira para isso.
 */

/** Prefixo visível. Oito caracteres identificam sem permitir adivinhar o resto. */
const VISIVEL = 8;

export function mascararSegredo(valor: string | null | undefined): string {
  const v = (valor ?? '').trim();
  if (!v) return '';

  // Chave curta esconderia proporcionalmente menos: com 9 caracteres, 8 à
  // mostra é a chave inteira. O prefixo encolhe junto.
  const mostrar = v.length <= VISIVEL * 2 ? Math.floor(v.length / 2) : VISIVEL;
  return mostrar < 2 ? '…' : `${v.slice(0, mostrar)}…`;
}
