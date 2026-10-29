/**
 * Contato que fala com dois numeros do mesmo cliente (Locadora: 8910, 8844,
 * 2244). Quem atende um nao sabe que o outro ja' conversou com a pessoa.
 */

export interface ConversaDoContato {
  /** display id (o numero que o atendente ve) */
  id: number;
  inbox_id: number;
  status?: string;
  /** segundos */
  last_activity_at?: number;
  meta?: { assignee?: { id?: number; name?: string } | null };
}

export const JANELA_DUPLICADO_DIAS = 30;

/**
 * A conversa em OUTRA caixa que importa: aberta, ou com atividade na janela.
 * Se houver varias, a de atividade mais recente.
 */
export function conversaEmOutraCaixa(
  conversas: ConversaDoContato[],
  atual: { conversa: number; inbox: number },
  agoraMs: number,
): ConversaDoContato | null {
  const corte = agoraMs - JANELA_DUPLICADO_DIAS * 86400_000;
  const candidatas = conversas.filter((c) => {
    if (c.inbox_id === atual.inbox || c.id === atual.conversa) return false;
    return c.status === 'open' || (c.last_activity_at ?? 0) * 1000 >= corte;
  });
  candidatas.sort((a, b) => (b.last_activity_at ?? 0) - (a.last_activity_at ?? 0));
  return candidatas[0] ?? null;
}

/** "Locadora - 8910" -> "8910"; sem numero no fim, o nome inteiro. */
export function rotuloDaCaixa(nome: string | null | undefined, id: number): string {
  const n = (nome ?? '').trim();
  return /(\d{3,})\s*$/.exec(n)?.[1] ?? (n || `caixa ${id}`);
}

/** Par ordenado: o mesmo par vindo dos dois lados tem uma chave so'. */
export function parDeCaixas(a: number, b: number): [number, number] {
  return a < b ? [a, b] : [b, a];
}

export interface DadosAlerta {
  cliente: string;
  nome: string;
  /** so' digitos, com DDI */
  telefone: string;
  antiga: { rotulo: string; conversa: number; responsavel: string | null; ultimaAtividadeMs: number };
  nova: { rotulo: string; conversa: number; responsavel: string | null };
}

const dia = (ms: number) => {
  const d = new Date(ms - 3 * 3600_000); // horario de Brasilia
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export function textoDoAlerta(d: DadosAlerta): string {
  const resp = (r: string | null) => (r ? `responsável: ${r}` : 'sem responsável');
  return [
    `⚠️ Contato em dois números — ${d.cliente}`,
    '',
    `*Nome:* ${d.nome}`,
    `*WhatsApp:* https://wa.me/${d.telefone}`,
    '',
    `Falou com o ${d.antiga.rotulo} (${resp(d.antiga.responsavel)}) em ${dia(d.antiga.ultimaAtividadeMs)} ` +
      `e agora com o ${d.nova.rotulo} (${resp(d.nova.responsavel)}).`,
    `Conversas #${d.antiga.conversa} e #${d.nova.conversa}.`,
  ].join('\n');
}
