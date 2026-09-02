import type { Env } from '../env';
import { exigir } from '../domain/config';

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
    return new ChatwootClient(
      exigir(env, 'CHATWOOT_BASE_URL').replace(/\/$/, ''),
      exigir(env, 'CHATWOOT_API_TOKEN'),
    );
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

  /** Definicoes de atributo personalizado de um modelo. */
  async atributos(acc: number, modelo: string): Promise<Array<{ chave: string; modelo: string }>> {
    const r = await this.req<Array<{ attribute_key: string; attribute_model: string }> | { payload?: Array<{ attribute_key: string; attribute_model: string }> }>(
      'GET',
      `/api/v1/accounts/${acc}/custom_attribute_definitions?attribute_model=${encodeURIComponent(modelo)}`,
    );
    const lista = Array.isArray(r) ? r : (r.payload ?? []);
    return lista.map((a) => ({ chave: a.attribute_key, modelo: a.attribute_model ?? modelo }));
  }

  async criarEtiqueta(acc: number, titulo: string, cor: string, descricao: string | null): Promise<void> {
    await this.req('POST', `/api/v1/accounts/${acc}/labels`, {
      title: titulo,
      color: cor,
      description: descricao ?? '',
      show_on_sidebar: true,
    });
  }

  async criarAtributo(
    acc: number,
    a: { modelo: string; chave: string; nome: string; tipo: string; descricao: string | null },
  ): Promise<void> {
    await this.req('POST', `/api/v1/accounts/${acc}/custom_attribute_definitions`, {
      attribute_model: a.modelo,
      attribute_key: a.chave,
      attribute_display_name: a.nome,
      attribute_display_type: a.tipo,
      attribute_description: a.descricao ?? '',
      attribute_values: [],
    });
  }

  /**
   * Grava atributos no card do Kanban.
   *
   * O PUT substitui o objeto inteiro, entao o merge e' aqui: sem ele, gravar a
   * UTM apagaria o `protocolo` que ja estava no card.
   */
  async mesclarAtributosDoCard(acc: number, taskId: number, novos: Record<string, string>): Promise<void> {
    if (!Object.keys(novos).length) return;
    const atual = await this.req<{ custom_attributes?: Record<string, unknown> }>(
      'GET',
      `/api/v1/accounts/${acc}/kanban/tasks/${taskId}`,
    );
    await this.req('PUT', `/api/v1/accounts/${acc}/kanban/tasks/${taskId}`, {
      task: { custom_attributes: { ...(atual.custom_attributes ?? {}), ...novos } },
    });
  }

  /**
   * Grava atributos na conversa.
   *
   * O POST substitui o objeto inteiro, entao o merge e' aqui: sem ele, gravar
   * a UTM apagaria o `funil` e o `conversa_enviada` que ja estavam la'.
   */
  async mesclarAtributosDaConversa(
    acc: number,
    conversaId: number,
    novos: Record<string, string>,
  ): Promise<void> {
    if (!Object.keys(novos).length) return;
    const atual = await this.req<{ custom_attributes?: Record<string, unknown> }>(
      'GET',
      `/api/v1/accounts/${acc}/conversations/${conversaId}`,
    );
    await this.req('POST', `/api/v1/accounts/${acc}/conversations/${conversaId}/custom_attributes`, {
      custom_attributes: { ...(atual.custom_attributes ?? {}), ...novos },
    });
  }

  /**
   * Acrescenta etiquetas a conversa, sem tirar as que ja estao.
   *
   * O POST de labels tambem substitui o conjunto inteiro. Mandar so' as nossas
   * apagaria "Ligar mais tarde" e tudo que o vendedor aplicou a mao.
   */
  async acrescentarEtiquetas(acc: number, conversaId: number, novas: string[]): Promise<string[]> {
    if (!novas.length) return [];
    const atual = await this.req<{ labels?: string[] }>(
      'GET',
      `/api/v1/accounts/${acc}/conversations/${conversaId}`,
    );
    const antes = atual.labels ?? [];
    const juntas = [...new Set([...antes, ...novas])];
    if (juntas.length === antes.length) return [];

    await this.req('POST', `/api/v1/accounts/${acc}/conversations/${conversaId}/labels`, {
      labels: juntas,
    });
    return novas.filter((l) => !antes.includes(l));
  }

  /**
   * Registra um webhook novo. NAO mexe nos que ja existem — os do n8n
   * continuam recebendo, o que e' o que permite rodar os dois em paralelo.
   * O `secret` e' gerado pelo Chatwoot e volta na resposta.
   */
  async criarWebhook(
    acc: number,
    url: string,
    subscriptions: string[],
    nome: string,
  ): Promise<CwWebhook> {
    // O corpo precisa vir embrulhado em `webhook` para o `name` ser aceito.
    // A forma achatada ({url, subscriptions}) tambem e' aceita, mas descarta o
    // nome e o webhook aparece sem rotulo na tela do Chatwoot.
    const r = await this.req<{ payload?: { webhook?: CwWebhook } } & Partial<CwWebhook>>(
      'POST',
      `/api/v1/accounts/${acc}/webhooks`,
      { webhook: { name: nome, url, subscriptions } },
    );
    // a resposta ora vem embrulhada em payload.webhook, ora solta
    const w = r.payload?.webhook ?? (r as CwWebhook);
    if (!w?.id) throw new Error('Chatwoot aceitou o POST mas nao devolveu o webhook');
    return w;
  }

  async apagarWebhook(acc: number, id: number): Promise<void> {
    await this.req('DELETE', `/api/v1/accounts/${acc}/webhooks/${id}`);
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
