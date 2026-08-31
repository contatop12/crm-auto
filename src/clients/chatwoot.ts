import type { Env } from '../env';

/**
 * Cliente do Chatwoot (fork fazer.ai).
 *
 * Envelopes confirmados contra a instancia real — ver docs/api-reference.md.
 * Nada de parser defensivo: cada rota tem UM formato.
 *
 * O token e' global e atende todas as contas; o que varia por tenant e' so o
 * `accountId`.
 */

export interface CwBoard {
  id: number;
  name: string;
  steps_order?: number[];
  total_tasks_count?: number;
}

export interface CwStep {
  id: number;
  board_id: number;
  name: string;
  cancelled: boolean;
  completed: boolean;
  tasks_count: number;
  probability: string;
}

export interface CwWebhook {
  id: number;
  name: string;
  url: string;
  subscriptions: string[];
  secret?: string;
}

export interface CwTask {
  id: number;
  board_id: number;
  board_step_id: number;
  title: string;
  step_changed_at: string | null;
  custom_attributes: Record<string, unknown>;
  labels: string[];
  /** ATENCAO: guarda display_id, nao o id interno da conversa. */
  conversation_ids: number[];
  conversations: Array<{ id: number; display_id: number }>;
  /** Vem como string ("2028.0"). */
  value: string | null;
}

export class ChatwootClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  static fromEnv(env: Env): ChatwootClient {
    return new ChatwootClient(env.CHATWOOT_BASE_URL.replace(/\/$/, ''), env.CHATWOOT_API_TOKEN);
  }

  private async req<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
    const r = await fetch(this.baseUrl + caminho, {
      method: metodo,
      headers: {
        api_access_token: this.token,
        accept: 'application/json',
        ...(corpo ? { 'content-type': 'application/json' } : {}),
      },
      ...(corpo ? { body: JSON.stringify(corpo) } : {}),
    });

    if (!r.ok) {
      throw new Error(`Chatwoot ${metodo} ${caminho} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
    }
    return (await r.json()) as T;
  }

  async perfil(): Promise<{ email: string; accounts: Array<{ id: number; name: string }> }> {
    return this.req('GET', '/api/v1/profile');
  }

  async boards(acc: number): Promise<CwBoard[]> {
    const r = await this.req<{ boards: CwBoard[] }>('GET', `/api/v1/accounts/${acc}/kanban/boards`);
    return r.boards ?? [];
  }

  async steps(acc: number, board: number): Promise<CwStep[]> {
    const r = await this.req<{ steps: CwStep[] }>(
      'GET',
      `/api/v1/accounts/${acc}/kanban/boards/${board}/steps`,
    );
    return r.steps ?? [];
  }

  async webhooks(acc: number): Promise<CwWebhook[]> {
    const r = await this.req<{ payload: { webhooks: CwWebhook[] } }>(
      'GET',
      `/api/v1/accounts/${acc}/webhooks`,
    );
    return r.payload?.webhooks ?? [];
  }

  async labels(acc: number): Promise<string[]> {
    const r = await this.req<{ payload: Array<{ title: string }> }>(
      'GET',
      `/api/v1/accounts/${acc}/labels`,
    );
    return (r.payload ?? []).map((l) => l.title);
  }

  /** Uma pagina de tasks. `meta.has_more` diz se falta mais. */
  async tasks(
    acc: number,
    board: number,
    page = 1,
    perPage = 100,
  ): Promise<{ tasks: CwTask[]; hasMore: boolean }> {
    const r = await this.req<{ tasks: CwTask[]; meta: { has_more: boolean } }>(
      'GET',
      `/api/v1/accounts/${acc}/kanban/tasks?board_id=${board}&page=${page}&per_page=${perPage}`,
    );
    return { tasks: r.tasks ?? [], hasMore: !!r.meta?.has_more };
  }
}
