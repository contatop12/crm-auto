/**
 * Conversions API da Meta: envio de eventos e verificacao do token.
 *
 * A versao da Graph API fica aqui, num lugar so'. Conferida no changelog em
 * 22/09/2026: v26.0 (29/07/2026) e' a mais recente. A Meta promove sozinha a
 * versao vencida, mas subir de versao e' decisao de quem leu o changelog.
 */
export const GRAPH_VERSAO = 'v26.0';

const GRAPH = `https://graph.facebook.com/${GRAPH_VERSAO}`;
const TEMPO_MS = 20_000;

export interface RespostaMeta {
  http: number;
  /** Corpo cru da resposta, cortado: vai para o log do evento. */
  corpo: string;
  eventosRecebidos: number;
  erro: { code?: number; error_subcode?: number; message?: string } | null;
}

/**
 * Posta os eventos. Erro de rede e timeout LANCAM: a fila retenta. Resposta
 * HTTP de qualquer codigo volta para quem chamou decidir.
 */
export async function postarEventos(dataset: string, token: string, corpo: unknown): Promise<RespostaMeta> {
  const r = await fetch(`${GRAPH}/${encodeURIComponent(dataset)}/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(TEMPO_MS),
  });
  const texto = await r.text();
  let j: { events_received?: number; error?: RespostaMeta['erro'] } = {};
  try {
    j = JSON.parse(texto) as typeof j;
  } catch {
    /* corpo nao-json: fica o texto */
  }
  return {
    http: r.status,
    corpo: texto.slice(0, 4000),
    eventosRecebidos: Number(j.events_received ?? 0),
    erro: j.error ?? null,
  };
}

export interface Verificacao {
  ok: boolean;
  /** Frase pronta para a tela: nunca a mensagem crua da Meta. */
  mensagem: string;
  datasetNome?: string;
  /** Nao deu para falar com a Meta: o resultado nao diz nada sobre o token. */
  rede?: boolean;
}

export interface OpcoesVerificacao {
  testEventCode?: string | null;
  pageId?: string | null;
  wabaId?: string | null;
}

const SEM_REDE: Verificacao = { ok: false, rede: true, mensagem: 'Não foi possível falar com a Meta agora. Tente de novo.' };
const TOKEN_INVALIDO: Verificacao = { ok: false, mensagem: 'Token inválido ou expirado. Gere outro no Gerenciador de Eventos.' };

/** Hash de um telefone qualquer, so' para a Meta aceitar o evento de teste. */
const TELEFONE_DE_TESTE = '035c58ae9ea0e452d658fcef6e0ca4dae521f6dcd8f8260a083301ac4811bc25';

/**
 * O token alcanca o dataset? Port de `verificarTokenDoCliente` do tracker.
 *
 * Token da CAPI costuma poder ENVIAR sem poder LER o dataset (a Meta responde
 * code 100/200/10 no GET). Nesse caso prova enviando um evento com codigo de
 * teste, que so' aparece em "Testar eventos" e nao conta como conversao.
 */
export async function verificarToken(
  token: string,
  dataset: string | null,
  o: OpcoesVerificacao = {},
): Promise<Verificacao> {
  if (!dataset) return { ok: false, mensagem: 'Preencha o dataset antes de verificar.' };

  let r: Response;
  try {
    r = await fetch(`${GRAPH}/${encodeURIComponent(dataset)}?fields=id,name,is_unavailable`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TEMPO_MS),
    });
  } catch {
    return SEM_REDE;
  }
  const j = (await r.json().catch(() => ({}))) as { name?: string; is_unavailable?: boolean; error?: { code?: number } };

  if (r.ok && !j.error) {
    if (j.is_unavailable) return { ok: false, mensagem: 'A Meta marcou este dataset como indisponível.', datasetNome: j.name };
    return { ok: true, mensagem: `Token válido e com acesso a "${j.name ?? dataset}".`, datasetNome: j.name };
  }

  const code = j.error?.code;
  if (code === 190) return TOKEN_INVALIDO;
  if (code === 100 || code === 200 || code === 10) return verificarPorEnvio(token, dataset, o);
  return { ok: false, mensagem: 'A Meta recusou a verificação. Confira o token e o dataset.' };
}

async function verificarPorEnvio(token: string, dataset: string, o: OpcoesVerificacao): Promise<Verificacao> {
  if (!o.pageId && !o.wabaId) {
    return {
      ok: false,
      mensagem: 'O token não lê o dataset (normal em token da CAPI). Preencha a Página ou o WABA e verifique ' +
        'de novo: a verificação envia um evento de teste.',
    };
  }

  const codigo = (o.testEventCode ?? '').trim() || 'P12VERIFY';
  const user: Record<string, unknown> = { ph: [TELEFONE_DE_TESTE] };
  if (o.pageId) user.page_id = o.pageId;
  if (o.wabaId) user.whatsapp_business_account_id = o.wabaId;

  let r: RespostaMeta;
  try {
    r = await postarEventos(dataset, token, {
      data: [{
        event_name: 'LeadSubmitted',
        event_time: Math.floor(Date.now() / 1000) - 30,
        event_id: `p12-verify-${crypto.randomUUID()}`,
        action_source: 'business_messaging',
        messaging_channel: 'whatsapp',
        user_data: user,
      }],
      test_event_code: codigo,
    });
  } catch {
    return SEM_REDE;
  }

  if (r.http === 200 && r.eventosRecebidos >= 1) {
    return { ok: true, mensagem: `Token válido para enviar neste dataset (conferido com o evento de teste ${codigo}).` };
  }
  if (r.erro?.code === 190) return TOKEN_INVALIDO;
  if (r.erro?.error_subcode === 2804116) {
    return { ok: false, mensagem: 'Falta Página ou WABA válido para a Meta aceitar o evento de teste.' };
  }
  return {
    ok: false,
    mensagem: 'O token não conseguiu enviar neste dataset. Confira se ele foi gerado neste dataset, no Gerenciador de Eventos.',
  };
}
