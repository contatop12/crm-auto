import type { Env } from '../env';
import { exigir } from '../domain/config';

/**
 * Google Tag Manager API v2.
 *
 * O refresh token vem do D1, nao de secret: ele e' obtido pelo consentimento
 * dentro do painel, com o Worker ja no ar.
 */

const BASE = 'https://tagmanager.googleapis.com/tagmanager/v2';

/** Access token na memoria do isolate, como no cliente do Google Ads. */
let tokenNaMemoria: { valor: string; expiraEm: number } | null = null;

export interface ContainerGtm {
  accountId: string;
  containerId: string;
  publicId: string;
  name: string;
}

export class TagManagerClient {
  private constructor(
    private readonly env: Env,
    private readonly refreshToken: string,
  ) {}

  /** Devolve null quando ninguem autorizou ainda — quem chama decide o que dizer. */
  static async deD1(env: Env): Promise<TagManagerClient | null> {
    const l = await env.DB.prepare(
      "SELECT valor FROM credenciais WHERE chave = 'gtm_refresh_token'",
    ).first<{ valor: string }>();
    return l?.valor ? new TagManagerClient(env, l.valor) : null;
  }

  private async token(): Promise<string> {
    const agora = Date.now();
    if (tokenNaMemoria && tokenNaMemoria.expiraEm > agora) return tokenNaMemoria.valor;

    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: exigir(this.env, 'GOOGLE_ADS_CLIENT_ID'),
        client_secret: exigir(this.env, 'GOOGLE_ADS_CLIENT_SECRET'),
        refresh_token: this.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const j = (await r.json()) as { access_token?: string; error_description?: string };
    if (!j.access_token) {
      throw new Error(`OAuth do Tag Manager falhou: ${j.error_description ?? 'sem access_token'}`);
    }
    tokenNaMemoria = { valor: j.access_token, expiraEm: agora + 3_300_000 };
    return j.access_token;
  }

  private async req<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
    const r = await fetch(BASE + caminho, {
      method: metodo,
      headers: {
        authorization: `Bearer ${await this.token()}`,
        ...(corpo === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const txt = await r.text();
    if (!r.ok) {
      // a mensagem do Google e' util; o HTML de 404 nao
      const corpoErro = txt.trimStart().startsWith('<') ? `(HTML ${r.status})` : txt.slice(0, 400);
      throw new Error(`Tag Manager ${r.status}: ${corpoErro}`);
    }
    return (txt ? JSON.parse(txt) : {}) as T;
  }

  async containers(): Promise<ContainerGtm[]> {
    const contas = await this.req<{ account?: Array<{ accountId: string; name: string }> }>(
      'GET',
      '/accounts',
    );
    const saida: ContainerGtm[] = [];
    for (const a of contas.account ?? []) {
      const r = await this.req<{ container?: ContainerGtm[] }>(
        'GET',
        `/accounts/${a.accountId}/containers`,
      );
      for (const c of r.container ?? []) {
        saida.push({ ...c, accountId: a.accountId, name: `${a.name} · ${c.name}` });
      }
    }
    return saida;
  }

  /**
   * O workspace onde o trabalho acontece.
   *
   * O cliente pediu para usar o que ja existe, nao criar um novo: workspace
   * novo vira uma segunda fila de alteracoes pendentes na tela dele, e quem
   * publicar sem ver perde o que estava no outro.
   */
  async workspacePadrao(acc: string, cont: string): Promise<{ workspaceId: string; name: string }> {
    const r = await this.req<{ workspace?: Array<{ workspaceId: string; name: string }> }>(
      'GET',
      `/accounts/${acc}/containers/${cont}/workspaces`,
    );
    const lista = r.workspace ?? [];
    if (!lista.length) throw new Error('container sem workspace');
    return lista.find((w) => w.name === 'Default Workspace') ?? lista[0]!;
  }

  private caminho(acc: string, cont: string, ws: string): string {
    return `/accounts/${acc}/containers/${cont}/workspaces/${ws}`;
  }

  /** O que ja esta no workspace, so' os nomes — e' por nome que comparamos. */
  async inventario(acc: string, cont: string, ws: string) {
    const p = this.caminho(acc, cont, ws);
    const [v, t, g, tpl, bi] = await Promise.all([
      this.req<{ variable?: Array<{ name: string }> }>('GET', `${p}/variables`),
      this.req<{ tag?: Array<{ name: string }> }>('GET', `${p}/tags`),
      this.req<{ trigger?: Array<{ name: string; triggerId: string }> }>('GET', `${p}/triggers`),
      this.req<{ template?: Array<{ name: string }> }>('GET', `${p}/templates`),
      this.req<{ builtInVariable?: Array<{ type: string }> }>('GET', `${p}/built_in_variables`),
    ]);
    return {
      variaveis: (v.variable ?? []).map((x) => x.name),
      tags: (t.tag ?? []).map((x) => x.name),
      gatilhos: (g.trigger ?? []).map((x) => x.name),
      /** nome -> id, para religar as tags aos gatilhos certos */
      gatilhosPorNome: new Map((g.trigger ?? []).map((x) => [x.name.trim().toLowerCase(), x.triggerId])),
      templates: (tpl.template ?? []).map((x) => x.name),
      builtIn: (bi.builtInVariable ?? []).map((x) => x.type),
    };
  }

  criarVariavel = (acc: string, c: string, ws: string, corpo: unknown) =>
    this.req<{ variableId: string }>('POST', `${this.caminho(acc, c, ws)}/variables`, corpo);

  criarGatilho = (acc: string, c: string, ws: string, corpo: unknown) =>
    this.req<{ triggerId: string; name: string }>('POST', `${this.caminho(acc, c, ws)}/triggers`, corpo);

  criarTag = (acc: string, c: string, ws: string, corpo: unknown) =>
    this.req<{ tagId: string }>('POST', `${this.caminho(acc, c, ws)}/tags`, corpo);

  criarTemplate = (acc: string, c: string, ws: string, corpo: unknown) =>
    this.req<{ templateId: string }>('POST', `${this.caminho(acc, c, ws)}/templates`, corpo);

  criarBuiltIn = (acc: string, c: string, ws: string, tipo: string) =>
    this.req('POST', `${this.caminho(acc, c, ws)}/built_in_variables?type=${encodeURIComponent(tipo)}`);

  /** Congela o workspace numa versao. NAO publica. */
  criarVersao = (acc: string, c: string, ws: string, nome: string, notas: string) =>
    this.req<{ containerVersion?: { containerVersionId: string } }>(
      'POST',
      `${this.caminho(acc, c, ws)}:create_version`,
      { name: nome, notes: notas },
    );

  publicar = (acc: string, c: string, versao: string) =>
    this.req<{ containerVersion?: { containerVersionId: string } }>(
      'POST',
      `/accounts/${acc}/containers/${c}/versions/${versao}:publish`,
    );

  /** A versao no ar agora, para a tela dizer o que o site esta usando. */
  async versaoPublicada(acc: string, c: string) {
    return this.req<{ containerVersion?: { containerVersionId: string; name?: string } }>(
      'GET',
      `/accounts/${acc}/containers/${c}/versions:live`,
    ).catch(() => ({ containerVersion: undefined }));
  }
}
