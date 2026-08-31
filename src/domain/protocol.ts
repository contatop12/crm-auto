/**
 * Extracao do protocolo de rastreio a partir do texto de uma mensagem.
 *
 * Portado de `acharProtocolo` dos nos Code do n8n.
 *
 * O protocolo tem 3 partes: PREFIXO-TIMESTAMP-RANDOM (ex: VITA-1720000000000-A1B2C3).
 * A regex original (`[A-Z0-9]{2,8}-[A-Z0-9]{8,}`) parava no segundo hifen e
 * devolvia o valor truncado, que nunca casava com a coluna `protocol`.
 *
 * Tres niveis, do mais confiavel para o menos:
 *   1. ancorado no rotulo que o injetor sempre poe ([Protocolo: X] / Ref: X)
 *   2. formato canonico PREFIXO-timestamp-RANDOM
 *   3. legado PREFIXO-CODIGO, exigindo letra E numero no codigo para nao
 *      confundir com CPF, CEP ou telefone
 */

const COM_ROTULO = /(?:protocolo|protocol|ref)\s*[:\-]?\s*([A-Za-z0-9]{2,8}(?:-[A-Za-z0-9]{4,}){1,3})/i;
const CANONICO = /\b[A-Za-z0-9]{2,8}-\d{6,13}-[A-Za-z0-9]{4,}\b/;
const LEGADO = /\b[A-Za-z0-9]{2,6}-[A-Za-z0-9]{10,}\b/g;

export function findProtocol(texto: string | null | undefined): string {
  const s = String(texto ?? '');
  if (!s) return '';

  const rotulado = s.match(COM_ROTULO);
  if (rotulado?.[1]) return rotulado[1].toUpperCase();

  const canonico = s.match(CANONICO);
  if (canonico?.[0]) return canonico[0].toUpperCase();

  LEGADO.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LEGADO.exec(s)) !== null) {
    const codigo = (m[0].split('-')[1] ?? '').toUpperCase();
    if (/[A-Z]/.test(codigo) && /[0-9]/.test(codigo)) return m[0].toUpperCase();
  }

  return '';
}
