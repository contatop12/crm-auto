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

  /** `open` quando a instancia esta conectada ao WhatsApp. */
  async estado(instancia: string): Promise<string> {
    const r = await this.req<{ instance?: { state?: string }; state?: string }>(
      `/instance/connectionState/${encodeURIComponent(instancia)}`,
    );
    return r.instance?.state ?? r.state ?? 'desconhecido';
  }
}
