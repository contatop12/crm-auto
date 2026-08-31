/**
 * Normalizacao de telefone brasileiro.
 *
 * Portado de `normFone` / `chaveTelefone` dos nos Code do n8n.
 *
 * O problema real: a mesma pessoa chega em dois formatos incompativeis.
 * O quiz grava o que ela digitou ("11915714026", com o nono digito) e o JID do
 * WhatsApp traz o que a operadora usa ("4788903080", sem). Somando o DDI 55 que
 * as vezes vem e as vezes nao, comparar a string crua erra o casamento.
 */

const CELULAR_PRIMEIRO_DIGITO = '6789';

function apenasDigitos(raw: string | null | undefined): string {
  return String(raw ?? '').replace(/\D/g, '');
}

/** Tira o DDI 55 quando presente, deixando o numero nacional (10 ou 11 digitos). */
function semDdi(digitos: string): string {
  return digitos.startsWith('55') && digitos.length >= 12 ? digitos.slice(2) : digitos;
}

/**
 * Telefone em E.164 (`+55DDDNUMERO`), com o nono digito reposto em celular.
 * Devolve string vazia quando a entrada nao forma um numero brasileiro valido.
 */
export function normFone(raw: string | null | undefined): string {
  let x = semDdi(apenasDigitos(raw));
  if (!x) return '';

  // celular antigo de 10 digitos (DDD + 8) ganha o 9 na frente do assinante
  if (x.length === 10 && CELULAR_PRIMEIRO_DIGITO.includes(x.charAt(2))) {
    x = x.slice(0, 2) + '9' + x.slice(2);
  }

  if (x.length < 10 || x.length > 11) return '';
  return '+55' + x;
}

/**
 * Chave de casamento: DDD + os ultimos 8 digitos.
 *
 * Descarta de uma vez o DDI e o nono digito, que sao justamente os dois campos
 * que divergem entre a planilha e o WhatsApp.
 */
export function phoneKey(raw: string | null | undefined): string {
  const x = semDdi(apenasDigitos(raw));
  if (x.length < 10) return '';
  return x.slice(0, 2) + x.slice(-8);
}
