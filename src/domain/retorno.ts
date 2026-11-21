/**
 * Lead que volta: quem escreve de novo depois do prazo do cliente
 * (`tenant_config.retorno_dias`, 15 ao ligar; NULL = desligado), depois que o card
 * chegou numa etapa final (ganho/perdido), abre um card novo em vez de reabrir
 * o antigo. O historico do atendimento fecha com o ciclo e o funil nao conta
 * duas vendas no mesmo card.
 *
 * O card novo leva " #1", " #2"... no fim do titulo (e do nome do lead), e o
 * protocolo ganha "-R<n>": e' assim que o relatorio separa um ciclo do outro.
 */

const DIA_MS = 24 * 3600 * 1000;

/**
 * A mensagem que chegou agora e' uma volta?
 *
 * Vale a ultima mensagem do lead antes desta; sem ela (card antigo, historico
 * perdido), vale o dia em que o card entrou na etapa final.
 */
export function ehRetorno(c: {
  etapaFinal: boolean;
  /** ultima mensagem do lead antes da de agora (ms); null = nao se sabe */
  anteriorDoLead: number | null;
  /** quando o card entrou na etapa (ms) */
  naEtapaDesde: number | null;
  agora: number;
  dias: number;
}): boolean {
  if (!c.etapaFinal) return false;
  const desde = c.anteriorDoLead ?? c.naEtapaDesde;
  if (desde === null || !Number.isFinite(desde)) return false;
  return c.agora - desde >= c.dias * DIA_MS;
}

const SUFIXO = /\s+#\d+\s*$/;

/**
 * A volta que o titulo do card ja' carrega, 0 = nenhuma.
 *
 * So' conta o "#n" depois do "#<conversa> - ": em "Conversa #1240" o numero e'
 * o da conversa, nao uma volta.
 */
export function voltaDoTitulo(titulo: string | null | undefined): number {
  const m = /^(?:Conversa\s*)?#\d+\s*-\s*([\s\S]*)$/i.exec(String(titulo ?? ''));
  return m ? voltaDoNome(` ${m[1]}`) : 0;
}

/** A volta no nome do lead ("Vital #2" -> 2), 0 = nenhuma. */
export function voltaDoNome(nome: string | null | undefined): number {
  const m = /\s#(\d+)\s*$/.exec(String(nome ?? ''));
  return m ? Number(m[1]) : 0;
}

/** O texto sem o " #n" do fim. */
export function semVolta(texto: string): string {
  return texto.replace(SUFIXO, '');
}

export function comVolta(texto: string, n: number): string {
  return `${semVolta(texto)} #${n}`;
}

/** Protocolo do ciclo n: a raiz ja' com "-R<k>" perde o sufixo antes. */
export function protocoloDoCiclo(raiz: string, n: number): string {
  return `${raiz.replace(/-R\d+$/, '')}-R${n}`;
}
