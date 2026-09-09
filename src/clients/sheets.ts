import type { Env } from '../env';
import { exigir } from '../domain/config';

/**
 * Google Sheets — só o `append`.
 *
 * Espelho, não fonte da verdade. O banco já tem tudo; a planilha existe porque
 * o time do cliente trabalha nela. Por isso falha aqui NUNCA derruba o
 * pipeline: uma planilha fora do ar não pode impedir uma conversão de subir.
 *
 * Usa o mesmo refresh token do Tag Manager. O escopo `spreadsheets` foi
 * acrescentado ao consentimento; sem reautorizar, a chamada volta 403 e a
 * mensagem diz exatamente isso.
 */

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

export class SheetsClient {
  constructor(private readonly token: string) {}

  static async deD1(env: Env): Promise<SheetsClient | null> {
    const l = await env.DB.prepare(
      "SELECT valor FROM credenciais WHERE chave = 'gtm_refresh_token'",
    ).first<{ valor: string }>();
    if (!l?.valor) return null;

    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: exigir(env, 'GOOGLE_ADS_CLIENT_ID'),
        client_secret: exigir(env, 'GOOGLE_ADS_CLIENT_SECRET'),
        refresh_token: l.valor,
        grant_type: 'refresh_token',
      }),
    });
    const j = (await r.json()) as { access_token?: string };
    return j.access_token ? new SheetsClient(j.access_token) : null;
  }

  /**
   * Acrescenta uma linha no fim da aba.
   *
   * `RAW` de propósito: `USER_ENTERED` faria o Sheets interpretar o que
   * escrevemos — um telefone `+5511...` viraria fórmula, e um protocolo que
   * comece com `=` seria pior ainda.
   */
  async acrescentar(docId: string, aba: string, linha: string[]): Promise<void> {
    const alcance = encodeURIComponent(`${aba}!A1`);
    const r = await fetch(
      `${BASE}/${docId}/values/${alcance}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ values: [linha] }),
      },
    );

    if (!r.ok) {
      const txt = (await r.text()).slice(0, 300);
      if (r.status === 403 && /insufficient|scope/i.test(txt)) {
        throw new Error('falta o escopo de planilhas — reautorize em Acesso Google');
      }
      throw new Error(`Sheets ${r.status}: ${txt}`);
    }
  }

  /** Nomes das abas do documento, para o painel oferecer em vez de exigir digitar. */
  async abas(docId: string): Promise<string[]> {
    const r = await fetch(`${BASE}/${docId}?fields=sheets.properties.title`, {
      headers: { authorization: `Bearer ${this.token}` },
    });
    if (!r.ok) throw new Error(`Sheets ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = (await r.json()) as { sheets?: Array<{ properties?: { title?: string } }> };
    return (j.sheets ?? []).map((s) => s.properties?.title ?? '').filter(Boolean);
  }
}
