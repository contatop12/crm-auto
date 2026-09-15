/**
 * Cards do Kanban que perderam a conversa.
 *
 * Aconteceu na Persianas: em 2026-09-04 as conversas #2..#371 sumiram do
 * Chatwoot e 370 cards ficaram no funil sem conversa nenhuma. Os contatos
 * sobreviveram (sao da conta, nao da inbox), entao o card continua parecendo
 * normal na tela — so' nao abre conversa.
 *
 * O titulo que o Chatwoot gera guarda o display id ("Conversa #28 - Carol"),
 * e e' ele que separa o card religavel do perdido de vez.
 */

export type SituacaoOrfao =
  /** o titulo cita uma conversa que ainda existe: da para religar */
  | 'conversa_viva'
  /** o titulo cita uma conversa que nao existe mais */
  | 'conversa_apagada'
  /** card criado a mao, sem numero de conversa no titulo */
  | 'sem_referencia';

export interface CardDoKanban {
  id: number;
  board_id: number;
  board_step_id: number;
  title: string;
  created_at?: string | null;
  conversations?: Array<{ id: number; display_id: number }> | null;
}

export interface CardOrfao {
  taskId: number;
  boardId: number;
  stepId: number;
  titulo: string;
  conversa: number | null;
  situacao: SituacaoOrfao;
  criadoEm: string | null;
}

/** Display id citado no titulo do card, ou null. */
export function conversaCitada(titulo: string | null | undefined): number | null {
  const m = /Conversa\s*#(\d+)/i.exec(String(titulo ?? ''));
  return m ? Number(m[1]) : null;
}

/**
 * So' os orfaos, classificados.
 *
 * Orfao e' `conversations[]` vazio. `conversation_ids` nao serve: guarda display
 * id e ja' enganou a ligacao uma vez (ver docs/api-reference.md).
 *
 * `vivas` sao os display ids das conversas que existem hoje na conta.
 */
export function classificarCards(cards: CardDoKanban[], vivas: Set<number>): CardOrfao[] {
  return cards
    .filter((c) => !(c.conversations ?? []).length)
    .map((c) => {
      const conversa = conversaCitada(c.title);
      return {
        taskId: c.id,
        boardId: c.board_id,
        stepId: c.board_step_id,
        titulo: c.title,
        conversa,
        situacao:
          conversa === null ? 'sem_referencia' : vivas.has(conversa) ? 'conversa_viva' : 'conversa_apagada',
        criadoEm: c.created_at ?? null,
      };
    });
}
