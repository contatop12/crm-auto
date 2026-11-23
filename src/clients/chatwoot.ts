import type { Env } from '../env';
import { exigir } from '../domain/config';
import type { ConversaDoContato } from '../domain/contatoDuplicado';
import type { MensagemCw } from '../domain/respostasAutomaticas';

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

/**
 * O Kanban respondeu 2xx ao criar o card, mas sem um id que preste. O card pode
 * ter nascido: quem chama nao pode tentar de novo as cegas (seria o segundo
 * card), entao este erro se distingue dos outros.
 */
export class CardSemId extends Error {
  constructor(resposta: unknown) {
    super(`Chatwoot criou o card sem id na resposta: ${JSON.stringify(resposta).slice(0, 200)}`);
    this.name = 'CardSemId';
  }
}

interface RegraCw {
  name?: unknown;
  active?: unknown;
  actions?: Array<{ action_name?: unknown; action_params?: unknown[] }>;
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

  /**
   * Regras de automacao da conta, reduzidas ao webhook que cada uma dispara.
   *
   * E' o que responde "o Chatwoot esta mesmo apontando para o Worker?". Sem
   * isso, uma regra desligada ou com a chave antiga aparece na tela como
   * "nunca recebeu", igualzinho a uma que nunca foi criada.
   */
  async automacoes(acc: number): Promise<Array<{ nome: string; ativa: boolean; urls: string[] }>> {
    const r = await this.req<{
      payload?: RegraCw[];
    } | RegraCw[]>('GET', `/api/v1/accounts/${acc}/automation_rules`);

    const regras = Array.isArray(r) ? r : (r.payload ?? []);
    return regras.map((g) => ({
      nome: String(g.name ?? ''),
      ativa: g.active !== false,
      urls: (g.actions ?? [])
        .filter((a) => String(a.action_name ?? '').includes('webhook'))
        .flatMap((a) => (a.action_params ?? []).map(String))
        .filter((u) => /^https?:\/\//i.test(u)),
    }));
  }

  /**
   * Cria uma regra de automacao. O corpo vai achatado, no formato que a
   * propria tela do Chatwoot manda (sondado nas regras existentes da Vita).
   */
  async criarAutomacao(
    acc: number,
    regra: {
      name: string;
      description: string;
      event_name: string;
      conditions: Array<Record<string, unknown>>;
      actions: Array<{ action_name: string; action_params: unknown[] }>;
    },
  ): Promise<void> {
    await this.req('POST', `/api/v1/accounts/${acc}/automation_rules`, { ...regra, active: true });
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

  /** Etiquetas da conta com id, para renomear e apagar pelo id. */
  async etiquetasComId(acc: number): Promise<Array<{ id: number; title: string; color: string; description: string }>> {
    const r = await this.req<{ payload?: Array<Record<string, unknown>> }>(
      'GET',
      `/api/v1/accounts/${acc}/labels`,
    );
    const ls = (r.payload ?? (r as unknown as Array<Record<string, unknown>>)) || [];
    return (ls as Array<Record<string, unknown>>).map((l) => ({
      id: Number(l.id),
      title: String(l.title ?? ''),
      color: String(l.color ?? '#1f6feb'),
      description: String(l.description ?? ''),
    }));
  }

  /**
   * Renomeia a etiqueta.
   *
   * O Chatwoot leva as conversas junto: quem tinha a etiqueta antiga passa a
   * mostrar a nova. Verificado contra producao antes de confiar nisso.
   */
  async renomearEtiqueta(acc: number, id: number, novo: string, cor: string, descricao: string): Promise<void> {
    await this.req('PATCH', `/api/v1/accounts/${acc}/labels/${id}`, {
      title: novo,
      color: cor,
      description: descricao,
      show_on_sidebar: true,
    });
  }

  /** Apaga a etiqueta. Some de TODA conversa que a tinha, sem volta. */
  async apagarEtiqueta(acc: number, id: number): Promise<void> {
    await this.req('DELETE', `/api/v1/accounts/${acc}/labels/${id}`);
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
   * Poe e tira etiquetas do card, sem mexer nas outras.
   *
   * O PUT substitui a lista inteira (conferido no card 1106 da Locadora em
   * 28/10/2026: `labels: []` apagou a que estava). O merge e' aqui.
   */
  async ajustarEtiquetasDoCard(
    acc: number,
    taskId: number,
    mudanca: { mais?: string[]; menos?: string[] },
  ): Promise<void> {
    const atual = await this.req<{ labels?: string[] }>('GET', `/api/v1/accounts/${acc}/kanban/tasks/${taskId}`);
    const antes = atual.labels ?? [];
    const depois = [...new Set([...antes, ...(mudanca.mais ?? [])])].filter((l) => !(mudanca.menos ?? []).includes(l));
    if (depois.length === antes.length && depois.every((l) => antes.includes(l))) return;
    await this.req('PUT', `/api/v1/accounts/${acc}/kanban/tasks/${taskId}`, { task: { labels: depois } });
  }

  /** Troca o titulo do card. So' o titulo vai no PUT: o resto fica como esta'. */
  async renomearCard(acc: number, taskId: number, titulo: string): Promise<void> {
    await this.req('PUT', `/api/v1/accounts/${acc}/kanban/tasks/${taskId}`, {
      task: { title: titulo },
    });
  }

  /**
   * Cria um card no Kanban, ja' ligado a conversa e ao contato.
   *
   * E' o que abre o novo ciclo do lead que volta: o card antigo fica no
   * historico (ganho/perdido) e este nasce na etapa inicial. `conversas` sao
   * display ids, que e' o que o Kanban guarda em `conversation_ids`. Os nomes
   * dos campos e o envelope da resposta ainda nao foram sondados na instancia
   * real: `scripts/teste-segundo-card.mjs` confirma. Por isso a resposta e'
   * aceita solta ou embrulhada em `payload`/`task`, com o id em numero ou em
   * texto numerico; sem id que preste falha alto, com `CardSemId`.
   */
  async criarCard(
    acc: number,
    c: {
      titulo: string;
      boardId: number;
      stepId: number;
      conversas: number[];
      contatos: number[];
      atributos: Record<string, string>;
    },
  ): Promise<number> {
    const r = await this.req<Record<string, unknown>>('POST', `/api/v1/accounts/${acc}/kanban/tasks`, {
      task: {
        title: c.titulo,
        board_id: c.boardId,
        board_step_id: c.stepId,
        conversation_ids: c.conversas,
        contact_ids: c.contatos,
        custom_attributes: c.atributos,
      },
    });
    const t = (r.payload ?? r.task ?? r) as Record<string, unknown> | null;
    const bruto = t && typeof t === 'object' ? t.id : undefined;
    const id = typeof bruto === 'string' && /^\d+$/.test(bruto.trim()) ? Number(bruto) : bruto;
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) throw new CardSemId(r);
    return id;
  }

  /**
   * Troca as conversas ligadas ao card. Lista vazia desliga o card da conversa:
   * o card antigo solta a conversa para o card novo ficar com ela.
   */
  async ligarConversasDoCard(acc: number, taskId: number, conversas: number[]): Promise<void> {
    await this.req('PUT', `/api/v1/accounts/${acc}/kanban/tasks/${taskId}`, {
      task: { conversation_ids: conversas },
    });
  }

  /**
   * Move o card para outra etapa DO MESMO board.
   *
   * Entre boards a API recusa (ver docs/api-reference.md); aqui e' sempre
   * dentro do funil, entao `/move` basta.
   */
  async moverCard(acc: number, taskId: number, boardStepId: number): Promise<void> {
    await this.req('POST', `/api/v1/accounts/${acc}/kanban/tasks/${taskId}/move`, {
      board_step_id: boardStepId,
    });
  }

  /**
   * Grava atributos na conversa.
   *
   * O POST substitui o objeto inteiro, entao o merge e' aqui: sem ele, gravar
   * a UTM apagaria o `funil` e o `conversa_enviada` que ja estavam la'.
   *
   * `remover`: chaves que saem do objeto. Pelo mesmo motivo, tirar e' nao
   * mandar; valor vazio nao foi conferido no Chatwoot de verdade.
   */
  async mesclarAtributosDaConversa(
    acc: number,
    conversaId: number,
    novos: Record<string, string>,
    remover: string[] = [],
  ): Promise<void> {
    if (!Object.keys(novos).length && !remover.length) return;
    const atual = await this.req<{ custom_attributes?: Record<string, unknown> }>(
      'GET',
      `/api/v1/accounts/${acc}/conversations/${conversaId}`,
    );
    const juntos: Record<string, unknown> = { ...(atual.custom_attributes ?? {}), ...novos };
    for (const chave of remover) delete juntos[chave];
    await this.req('POST', `/api/v1/accounts/${acc}/conversations/${conversaId}/custom_attributes`, {
      custom_attributes: juntos,
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
  /** Uma conversa pelo display id. Traz o `kanban_task` do momento. */
  async conversa(acc: number, conversaId: number): Promise<Record<string, unknown> | null> {
    const r = await this.req<Record<string, unknown>>(
      'GET',
      `/api/v1/accounts/${acc}/conversations/${conversaId}`,
    );
    const c = (r.payload ?? r) as Record<string, unknown>;
    return c && typeof c === 'object' && c.id ? c : null;
  }

  /** Atribui a conversa (display id) a um agente. O card do kanban sincroniza sozinho. */
  async atribuirConversa(acc: number, conversaId: number, agenteId: number): Promise<void> {
    await this.req('POST', `/api/v1/accounts/${acc}/conversations/${conversaId}/assignments`, {
      assignee_id: agenteId,
    });
  }

  /**
   * Contatos cuja busca casa com `q` (nome, e-mail, telefone ou identificador;
   * o Chatwoot procura por pedaco). So' a primeira pagina: quem busca por
   * telefone passa digitos suficientes para ela bastar.
   */
  async contatosPorBusca(
    acc: number,
    q: string,
  ): Promise<Array<{ id: number; phone_number: string | null; name?: string | null }>> {
    const r = await this.req<{ payload?: Array<{ id: number; phone_number: string | null; name?: string | null }> }>(
      'GET',
      `/api/v1/accounts/${acc}/contacts/search?q=${encodeURIComponent(q)}`,
    );
    return r.payload ?? [];
  }

  /** Conversas do contato em todas as caixas (display ids em `id`). */
  async conversasDoContato(acc: number, contatoId: number): Promise<ConversaDoContato[]> {
    const r = await this.req<{ payload?: ConversaDoContato[] }>(
      'GET',
      `/api/v1/accounts/${acc}/contacts/${contatoId}/conversations`,
    );
    return r.payload ?? [];
  }

  /** Um card pelo id. E' o que o reenvio precisa: o corpo que o webhook mandaria. */
  async tarefa(acc: number, taskId: number): Promise<Record<string, unknown> | null> {
    const r = await this.req<Record<string, unknown>>(
      'GET',
      `/api/v1/accounts/${acc}/kanban/tasks/${taskId}`,
    );
    const t = (r.payload ?? r) as Record<string, unknown>;
    return t && typeof t === 'object' && t.id ? t : null;
  }

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
  /**
   * Display ids de todas as conversas da conta, de qualquer status.
   *
   * `completo: false` quando bateu no teto de paginas: quem classifica orfaos
   * precisa saber, senao conversa viva alem do teto apareceria como apagada.
   */
  async displayIdsDasConversas(acc: number, tetoPaginas = 40): Promise<{ ids: Set<number>; completo: boolean }> {
    const ids = new Set<number>();
    for (let page = 1; page <= tetoPaginas; page++) {
      const r = await this.req<{ data?: { meta?: { all_count?: number }; payload?: Array<{ id: number }> } }>(
        'GET',
        `/api/v1/accounts/${acc}/conversations?status=all&page=${page}`,
      );
      const lote = r.data?.payload ?? [];
      lote.forEach((c) => ids.add(c.id));
      const total = r.data?.meta?.all_count ?? 0;
      if (!lote.length || ids.size >= total) return { ids, completo: true };
    }
    return { ids, completo: false };
  }

  /** Caixas de entrada da conta, com o webhook (o caminho de volta ao WhatsApp). */
  async caixas(acc: number): Promise<Array<{ id: number; name: string; webhook_url?: string | null }>> {
    const r = await this.req<{ payload?: Array<{ id: number; name: string; webhook_url?: string | null }> }>(
      'GET',
      `/api/v1/accounts/${acc}/inboxes`,
    );
    return r.payload ?? [];
  }

  /** Mensagens de cliente que entraram na caixa entre `desde` e `ate` (segundos). */
  async recebidasNaCaixa(acc: number, caixa: number, desde: number, ate: number): Promise<number> {
    const r = await this.req<{ incoming_messages_count?: number }>(
      'GET',
      `/api/v2/accounts/${acc}/reports/summary?type=inbox&id=${caixa}&since=${desde}&until=${ate}`,
    );
    return Number(r.incoming_messages_count ?? 0);
  }
  /**
   * Quando o lead mandou a ultima mensagem (ms), ou null se nao mandou nenhuma.
   *
   * Pagina para tras so' ate' achar uma mensagem do lead: quase sempre esta' na
   * primeira pagina (as 20 ultimas).
   */
  async ultimaMensagemDoLead(acc: number, conversaId: number, tetoPaginas = 5): Promise<number | null> {
    type Msg = { id: number; message_type: number; created_at: number };
    let antes: number | null = null;
    for (let i = 0; i < tetoPaginas; i++) {
      const r: { payload?: Msg[] } = await this.req(
        'GET',
        `/api/v1/accounts/${acc}/conversations/${conversaId}/messages` + (antes ? `?before=${antes}` : ''),
      );
      const lote = r.payload ?? [];
      if (!lote.length) break;
      const doLead = lote.filter((m) => m.message_type === 0).map((m) => m.created_at);
      if (doLead.length) return Math.max(...doLead) * 1000;
      antes = Math.min(...lote.map((m) => m.id));
    }
    return null;
  }

  /**
   * Quando o lead falou antes da mensagem `antesDe` (ms), ou null se nao havia.
   *
   * Serve para medir o silencio que antecedeu a mensagem que reabriu a conversa.
   * `before` devolve ids menores, entao a propria `antesDe` nunca entra. Mensagem
   * do lead e' `message_type` 0 e nao privada; pagina para tras pelo menor id.
   */
  async mensagemAnteriorDoLead(
    acc: number,
    conversaId: number,
    antesDe: number,
    tetoPaginas = 5,
  ): Promise<number | null> {
    type Msg = { id: number; message_type: number; private?: boolean; created_at: number };
    let antes = antesDe;
    for (let i = 0; i < tetoPaginas; i++) {
      const r: { payload?: Msg[] } = await this.req(
        'GET',
        `/api/v1/accounts/${acc}/conversations/${conversaId}/messages?before=${antes}`,
      );
      const lote = r.payload ?? [];
      if (!lote.length) break;
      const doLead = lote.filter((m) => m.message_type === 0 && !m.private).map((m) => m.created_at);
      if (doLead.length) return Math.max(...doLead) * 1000;
      antes = Math.min(...lote.map((m) => m.id));
    }
    return null;
  }

  /**
   * As 20 mensagens da conversa até `msgId`, inclusive.
   *
   * `before` devolve as de id menor; o +1 inclui a própria mensagem, que traz o
   * `created_at` no mesmo relógio das outras. Ancorar no id, e não pegar as 20
   * últimas, mantém a resposta certa quando o evento é reprocessado depois.
   */
  async mensagensAte(acc: number, conversaId: number, msgId: number): Promise<MensagemCw[]> {
    const r: { payload?: MensagemCw[] } = await this.req(
      'GET',
      `/api/v1/accounts/${acc}/conversations/${conversaId}/messages?before=${msgId + 1}`,
    );
    return r.payload ?? [];
  }

  /**
   * A conversa desde a primeira mensagem, em ordem de id.
   *
   * A rota devolve as 20 mais novas; `before` anda para tras. Para quando a
   * pagina vem incompleta (chegou no comeco) ou no teto: conversa maior que
   * isso volta sem o comeco, e quem chama precisa da primeira mensagem — por
   * isso `completo` diz se ela esta' na lista.
   */
  async mensagensDesdeOInicio(
    acc: number,
    conversaId: number,
    tetoPaginas = 5,
  ): Promise<{ mensagens: Array<MensagemCw & { content?: string | null }>; completo: boolean }> {
    type Msg = MensagemCw & { content?: string | null };
    const todas: Msg[] = [];
    let antes: number | null = null;
    for (let i = 0; i < tetoPaginas; i++) {
      const r: { payload?: Msg[] } = await this.req(
        'GET',
        `/api/v1/accounts/${acc}/conversations/${conversaId}/messages` + (antes ? `?before=${antes}` : ''),
      );
      const lote = r.payload ?? [];
      todas.push(...lote);
      if (lote.length < 20) return { mensagens: todas.sort((a, b) => a.id - b.id), completo: true };
      antes = Math.min(...lote.map((m) => m.id));
    }
    return { mensagens: todas.sort((a, b) => a.id - b.id), completo: false };
  }

  /** Nota interna na conversa: so' a equipe ve, nao vai para o WhatsApp. */
  async notaInterna(acc: number, conversaId: number, texto: string): Promise<void> {
    await this.req('POST', `/api/v1/accounts/${acc}/conversations/${conversaId}/messages`, {
      content: texto,
      message_type: 'outgoing',
      private: true,
    });
  }

  /**
   * Textos que o vendedor mandou na conversa, do mais antigo ao mais novo.
   *
   * A rota devolve as 20 ultimas; `before` pagina para tras. Nota interna
   * (`private`) fica de fora, pelo mesmo motivo da resposta ao vivo: e' bilhete
   * para o time, nao fala com o lead.
   *
   * `desde` (ms) deixa so' o que veio a partir dele: o lead que volta nao deve
   * herdar as falas do ciclo anterior. Como as paginas vao do novo para o
   * antigo, para de paginar quando a pagina inteira e' mais velha que `desde`.
   */
  async textosDoVendedor(acc: number, conversaId: number, tetoPaginas = 10, desde?: number): Promise<string[]> {
    type Msg = { id: number; message_type: number; private?: boolean; content?: string | null; created_at: number };
    const todas: Msg[] = [];
    let antes: number | null = null;
    for (let i = 0; i < tetoPaginas; i++) {
      const r: { payload?: Msg[] } = await this.req(
        'GET',
        `/api/v1/accounts/${acc}/conversations/${conversaId}/messages` + (antes ? `?before=${antes}` : ''),
      );
      const lote = r.payload ?? [];
      if (!lote.length) break;
      todas.push(...lote);
      if (desde !== undefined && lote.every((m) => m.created_at * 1000 < desde)) break;
      antes = Math.min(...lote.map((m) => m.id));
    }
    return todas
      .filter((m) => desde === undefined || m.created_at * 1000 >= desde)
      .filter((m) => m.message_type === 1 && !m.private && typeof m.content === 'string' && m.content.trim())
      .sort((a, b) => a.created_at - b.created_at || a.id - b.id)
      .map((m) => (m.content as string).trim());
  }

}
