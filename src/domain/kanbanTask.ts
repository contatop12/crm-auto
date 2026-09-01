/**
 * Leitura do payload de task do Kanban que chega no webhook.
 *
 * A automacao do Chatwoot manda a task ora solta, ora dentro de um envelope
 * (`kanban_task`, `task`) e o webhook generico ainda embrulha em `body`.
 *
 * Os nomes dos campos vieram da sondagem da instancia real, nao de chute:
 * ver docs/api-reference.md.
 */

interface TaskCrua {
  id?: number | string;
  board_id?: number | string;
  board_step_id?: number | string;
  title?: string;
  step_changed_at?: string;
  updated_at?: string;
  custom_attributes?: Record<string, unknown>;
  labels?: string[];
  conversations?: Array<{ id?: number; display_id?: number }>;
  conversation_ids?: number[];
  contacts?: Array<{ id?: number; name?: string; phone_number?: string }>;
  /** Vem como string ("2028.0"). */
  value?: string | number | null;
}

export interface TaskDoKanban {
  taskId: number;
  boardId: number;
  boardStepId: number;
  titulo: string;
  protocolo: string;
  quizVersion: string;
  nome: string;
  telefone: string;
  /** Id INTERNO da conversa. `conversation_ids` guarda display_id, nao serve. */
  conversationId: number;
  valor: number;
  labels: string[];
  ocorridoEm: string;
  /** Protocolo quando existe; senao `task:<id>`. */
  chaveDedupe: string;
}

function desembrulhar(raw: unknown): TaskCrua {
  const o = (raw ?? {}) as Record<string, unknown>;
  const corpo = (o.body && typeof o.body === 'object' ? o.body : o) as Record<string, unknown>;
  return ((corpo.kanban_task ?? corpo.task ?? corpo) ?? {}) as TaskCrua;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function parseKanbanTask(raw: unknown): TaskDoKanban {
  const t = desembrulhar(raw);
  const ca = t.custom_attributes ?? {};
  const contato = t.contacts?.[0] ?? {};

  const taskId = num(t.id);
  const protocolo = String(ca.protocolo ?? ca.Protocolo ?? '').toUpperCase();

  return {
    taskId,
    boardId: num(t.board_id),
    boardStepId: num(t.board_step_id),
    titulo: String(t.title ?? ''),
    protocolo,
    quizVersion: String(ca.quiz_version ?? '').toLowerCase(),
    nome: String(contato.name ?? '') || String(t.title ?? ''),
    telefone: String(contato.phone_number ?? ''),
    conversationId: num(t.conversations?.[0]?.id),
    valor: num(t.value),
    labels: Array.isArray(t.labels) ? t.labels : [],
    ocorridoEm: String(t.step_changed_at ?? t.updated_at ?? new Date().toISOString()),
    chaveDedupe: protocolo || `task:${taskId}`,
  };
}
