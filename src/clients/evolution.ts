import type { Env } from '../env';
import { exigir } from '../domain/config';

/**
 * Cliente da Evolution API (WhatsApp).
 *
 * Usado para as etiquetas do WhatsApp e para o alerta de erro. As etiquetas sao
 * criadas A MAO pelo cliente no app: se nao existirem, `findLabels` nao devolve
 * o id e a aplicacao falha em silencio — por isso a tela de saude confere.
 */

export interface EvoLabel {
  id?: string | number;
  labelId?: string | number;
  name?: string;
}

/** Configuracao da integracao com o Chatwoot, como o `/chatwoot/find` devolve. */
export interface ConfigChatwootEvo {
  enabled?: boolean;
  accountId?: string | number;
  nameInbox?: string;
  webhook_url?: string;
  [campo: string]: unknown;
}

export interface InstanciaEvo {
  name: string;
  connectionStatus?: string;
  ownerJid?: string | null;
}

export class EvolutionClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  static fromEnv(env: Env): EvolutionClient {
    return new EvolutionClient(
      exigir(env, 'EVOLUTION_SERVER_URL').replace(/\/$/, ''),
      exigir(env, 'EVOLUTION_API_KEY'),
    );
  }

  private async req<T>(caminho: string, corpo?: unknown): Promise<T> {
    const r = await fetch(this.baseUrl + caminho, {
      method: corpo === undefined ? 'GET' : 'POST',
      headers: {
        apikey: this.apiKey,
        accept: 'application/json',
        ...(corpo === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      // servidor pendurado nao pode travar o pipeline nem o vigia
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) {
      throw new Error(`Evolution ${caminho} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
    }
    return (await r.json()) as T;
  }

  /** Nomes das etiquetas existentes na instancia. */
  async labels(instancia: string): Promise<string[]> {
    const r = await this.req<EvoLabel[] | { labels?: EvoLabel[] }>(
      `/label/findLabels/${encodeURIComponent(instancia)}`,
    );
    const lista = Array.isArray(r) ? r : (r.labels ?? []);
    return lista.map((l) => String(l.name ?? '')).filter(Boolean);
  }

  /** Etiquetas com id — o `handleLabel` exige o id, nao o nome. */
  async labelsComId(instancia: string): Promise<Array<{ id: string; name: string }>> {
    const r = await this.req<EvoLabel[] | { labels?: EvoLabel[] }>(
      `/label/findLabels/${encodeURIComponent(instancia)}`,
    );
    const lista = Array.isArray(r) ? r : (r.labels ?? []);
    return lista
      .map((l) => ({ id: String((l as { id?: unknown }).id ?? ''), name: String(l.name ?? '') }))
      .filter((l) => l.id && l.name);
  }

  /**
   * Aplica uma etiqueta na conversa do WhatsApp.
   *
   * O numero vai como JID; a etiqueta, por id. Etiqueta do WhatsApp e' criada a
   * mao pelo cliente, entao id que nao existe simplesmente nao casa — por isso
   * quem chama resolve o nome antes.
   */
  async aplicarEtiqueta(instancia: string, numero: string, labelId: string): Promise<void> {
    const jid = numero.includes('@') ? numero : `${numero.replace(/\D/g, '')}@s.whatsapp.net`;
    await this.req(`/label/handleLabel/${encodeURIComponent(instancia)}`, {
      number: jid,
      labelId,
      action: 'add',
    });
  }

  /**
   * A instancia responde de verdade?
   *
   * `connectionState` nao serve para isto: ele le' um status guardado e
   * continua dizendo `open` depois que o aparelho foi desvinculado. A Persianas
   * ficou assim — `open` nos dois endpoints, e qualquer operacao real voltando
   * 428 "Connection Closed".
   *
   * `fetchProfile` e' o teste mais barato que exige o socket vivo: le' o perfil
   * da propria instancia, nao manda mensagem nenhuma.
   */
  async viva(instancia: string): Promise<{ viva: boolean; detalhe: string }> {
    try {
      const r = await fetch(
        `${this.baseUrl}/chat/fetchProfile/${encodeURIComponent(instancia)}`,
        {
          method: 'POST',
          headers: { apikey: this.apiKey, 'content-type': 'application/json' },
          body: '{}',
          signal: AbortSignal.timeout(15000),
        },
      );
      if (r.ok) return { viva: true, detalhe: 'responde' };
      const txt = await r.text();
      // 428 e' o "Connection Closed" do Baileys por baixo do Evolution
      const desvinculada = r.status === 428 || txt.includes('428') || r.status === 500;
      return {
        viva: false,
        detalhe: desvinculada
          ? 'aparelho desvinculado — precisa ler o QR de novo'
          : `respondeu ${r.status}`,
      };
    } catch {
      return { viva: false, detalhe: 'nao respondeu no tempo' };
    }
  }

  /** Todas as instancias do servidor, com o estado da conexao. */
  async instancias(): Promise<InstanciaEvo[]> {
    const r = await this.req<InstanciaEvo[]>('/instance/fetchInstances');
    return Array.isArray(r) ? r : [];
  }

  /**
   * Integracao com o Chatwoot da instancia. Traz o token do Chatwoot junto:
   * quem chama nunca registra isto em log.
   */
  async chatwoot(instancia: string): Promise<ConfigChatwootEvo | null> {
    const r = await this.req<ConfigChatwootEvo | null>(`/chatwoot/find/${encodeURIComponent(instancia)}`);
    return r && typeof r === 'object' ? r : null;
  }

  /**
   * Regrava a integracao com o Chatwoot. O `/chatwoot/set` substitui a
   * configuracao inteira, entao quem chama parte do que o `chatwoot()` leu e
   * muda so' o campo que precisa. `autoCreate: false` para nao criar caixa.
   */
  async definirChatwoot(instancia: string, cfg: ConfigChatwootEvo): Promise<void> {
    const { webhook_url: _calculado, ...resto } = cfg;
    await this.req(`/chatwoot/set/${encodeURIComponent(instancia)}`, { ...resto, autoCreate: false });
  }

  /** Mensagens mais recentes da instancia, da mais nova para a mais velha. */
  async mensagensRecentes(instancia: string, quantas = 250): Promise<Array<Record<string, unknown>>> {
    const r = await this.req<{ messages?: { records?: Array<Record<string, unknown>> } }>(
      `/chat/findMessages/${encodeURIComponent(instancia)}`,
      { where: {}, page: 1, offset: quantas },
    );
    return r.messages?.records ?? [];
  }

  /** Texto para um numero ou grupo (JID `...@g.us`). */
  async enviarTexto(instancia: string, numero: string, texto: string): Promise<void> {
    await this.req(`/message/sendText/${encodeURIComponent(instancia)}`, { number: numero, text: texto });
  }

  /** `open` quando a instancia esta conectada ao WhatsApp. */
  async estado(instancia: string): Promise<string> {
    const r = await this.req<{ instance?: { state?: string }; state?: string }>(
      `/instance/connectionState/${encodeURIComponent(instancia)}`,
    );
    return r.instance?.state ?? r.state ?? 'desconhecido';
  }
}
