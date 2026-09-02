import { exigir } from '../domain/config';

/**
 * Pulseboard — avisa o grupo de WhatsApp do cliente que chegou lead novo.
 *
 * Cada cliente tem seu `codi_id`, que e' o que amarra a mensagem ao grupo certo.
 * O texto quem monta e' o Pulseboard; daqui vao os campos.
 */

export interface NovoLead {
  codiId: string;
  /** 'Campanha de Quiz - Google' */
  canal: string;
  nome: string;
  /** So digitos, com DDI e sem '+', que e' o formato que o Pulseboard espera. */
  telefone: string;
  url: string;
}

const ENDPOINT = 'https://pulseboard.sitespdoze.com.br/site-new-lead';

export class PulseboardClient {
  constructor(private readonly endpoint: string = ENDPOINT) {}

  async avisarLeadNovo(l: NovoLead): Promise<void> {
    exigir(l, 'codiId');

    const r = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        codi_id: l.codiId,
        Canal: l.canal,
        nome: l.nome,
        telefone: l.telefone,
        URL: l.url,
      }),
    });

    const texto = await r.text();
    if (!r.ok) {
      throw new Error(`Pulseboard respondeu ${r.status}: ${texto.slice(0, 200)}`);
    }
    conferirEnvio(texto);
  }
}

/**
 * O 200 do Pulseboard nao quer dizer que a mensagem saiu.
 *
 * Sondado contra o endpoint de producao: `codi_id` que nao casa com nenhuma
 * rota devolve **HTTP 200** com o corpo
 *
 *   {"ok":true,"sent":0,"skipped":["lead_index_0: rota_nao_mapeada (...)"]}
 *
 * e corpo vazio devolve `{"ignored":true,"ok":true,"reason":"empty_payload"}`.
 *
 * Confiar no status deixaria o painel gravar "enviado" para um lead que o grupo
 * do cliente nunca viu. E' a mesma falha silenciosa do n8n que esta ferramenta
 * existe para acabar, entao quem manda e' o `sent`.
 */
export function conferirEnvio(corpo: string): void {
  let j: { ok?: boolean; sent?: number; skipped?: unknown; ignored?: boolean; reason?: string };
  try {
    j = JSON.parse(corpo) as typeof j;
  } catch {
    // resposta que nao e' json e' inesperada, mas nao prova falha de envio
    return;
  }

  if (j.ignored === true) {
    throw new Error(`Pulseboard ignorou o aviso: ${j.reason ?? 'sem motivo'}`);
  }
  if (j.ok === false) {
    throw new Error(`Pulseboard recusou: ${corpo.slice(0, 200)}`);
  }
  if (typeof j.sent === 'number' && j.sent < 1) {
    const motivo = Array.isArray(j.skipped) && j.skipped.length
      ? j.skipped.map(String).join(' · ')
      : 'sem motivo declarado';
    throw new Error(`Pulseboard nao enviou (sent=${j.sent}): ${motivo.slice(0, 200)}`);
  }
}
