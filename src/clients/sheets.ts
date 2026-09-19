import type { Env } from '../env';
import { comConta, lerChave, tokenDaConta } from './googleSa';
import { tokenDoConsentimento } from './googleOAuth';

/**
 * Google Sheets API v4.
 *
 * Primeiro pela service account; planilha que nao foi compartilhada com ela
 * cai no consentimento OAuth, que enxerga o que a pessoa que autorizou enxerga.
 * Sem nenhum dos dois, o erro diz com qual e-mail compartilhar.
 */

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const ESCOPO = ['https://www.googleapis.com/auth/spreadsheets'];

/** `'Aba com espaço'!A1:B2`, com a aspa simples dobrada como o Sheets pede. */
function intervalo(aba: string, faixa: string): string {
  return encodeURIComponent(`'${aba.replace(/'/g, "''")}'!${faixa}`);
}

export class SheetsClient {
  constructor(private readonly env: Env) {}

  /** O e-mail com que as planilhas precisam ser compartilhadas. */
  static email(env: Env): string | null {
    return lerChave(env.GOOGLE_SA_KEY)?.client_email ?? null;
  }

  private async req<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
    const r = await comConta(
      () => tokenDaConta(this.env, ESCOPO),
      () => tokenDoConsentimento(this.env),
      (token) => fetch(BASE + caminho, {
        method: metodo,
        headers: {
          authorization: `Bearer ${token}`,
          ...(corpo === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      }),
    );
    const txt = await r.text();
    if (!r.ok) {
      let msg = txt.slice(0, 300);
      try {
        msg = (JSON.parse(txt) as { error?: { message?: string } }).error?.message ?? msg;
      } catch { /* resposta nao-json volta cortada */ }
      if (r.status === 403 || r.status === 404) {
        const email = SheetsClient.email(this.env);
        msg += email ? ` — compartilhe a planilha com ${email} como Editor` : '';
      }
      throw new Error(`Planilha ${r.status}: ${msg}`);
    }
    return (txt ? JSON.parse(txt) : {}) as T;
  }

  async abas(doc: string): Promise<{ titulo: string; abas: string[] }> {
    const j = await this.req<{ properties?: { title?: string }; sheets?: Array<{ properties?: { title?: string } }> }>(
      'GET',
      `/${doc}?fields=properties.title,sheets.properties.title`,
    );
    return {
      titulo: j.properties?.title ?? '',
      abas: (j.sheets ?? []).map((s) => s.properties?.title ?? '').filter(Boolean),
    };
  }

  /** A primeira linha da aba. */
  async cabecalho(doc: string, aba: string): Promise<string[]> {
    const j = await this.req<{ values?: string[][] }>('GET', `/${doc}/values/${intervalo(aba, '1:1')}`);
    return (j.values?.[0] ?? []).map((v) => String(v));
  }

  /** Uma coluna inteira a partir da linha 2. Celula vazia vira '' e mantem a posicao. */
  async coluna(doc: string, aba: string, letra: string): Promise<string[]> {
    const j = await this.req<{ values?: string[][] }>('GET', `/${doc}/values/${intervalo(aba, `${letra}2:${letra}`)}`);
    return (j.values ?? []).map((l) => String(l[0] ?? ''));
  }

  async linha(doc: string, aba: string, n: number, ate: string): Promise<string[]> {
    const j = await this.req<{ values?: string[][] }>('GET', `/${doc}/values/${intervalo(aba, `A${n}:${ate}${n}`)}`);
    return (j.values?.[0] ?? []).map((v) => String(v));
  }

  /** RAW: o que vai e' texto; formula ou data interpretada mudaria o dado. */
  async atualizar(doc: string, aba: string, n: number, ate: string, valores: string[]): Promise<void> {
    await this.req('PUT', `/${doc}/values/${intervalo(aba, `A${n}:${ate}${n}`)}?valueInputOption=RAW`, {
      values: [valores],
    });
  }

  /** Acrescenta no fim (Append Row): nunca sobrescreve linha existente. */
  async acrescentar(doc: string, aba: string, valores: string[]): Promise<void> {
    await this.req(
      'POST',
      `/${doc}/values/${intervalo(aba, 'A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { values: [valores] },
    );
  }
}
