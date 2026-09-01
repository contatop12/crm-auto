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

    if (!r.ok) {
      throw new Error(`Pulseboard respondeu ${r.status}: ${(await r.text()).slice(0, 200)}`);
    }
  }
}
