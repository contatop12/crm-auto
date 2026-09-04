/**
 * Pulseboard — avisa o grupo de WhatsApp do cliente que chegou lead novo.
 *
 * Quem amarra a mensagem ao grupo certo e' a URL do webhook: cada cliente tem a
 * dele. O `codi_id` fazia esse papel antes e saiu de cena — o roteamento por
 * codi_id era justamente o que respondia `rota_nao_mapeada` quando o numero nao
 * tinha rota cadastrada do outro lado.
 *
 * O texto quem monta e' o Pulseboard; daqui vao os campos.
 */

export interface NovoLead {
  /** Etapa do funil onde o card esta'. */
  etapa?: string | null;
  /** Link da conversa no Chatwoot, para o vendedor abrir direto do grupo. */
  conversa?: string | null;
  /** 'Campanha de Quiz - Google' */
  canal: string;
  nome: string;
  /** So digitos, com DDI e sem '+', que e' o formato que o Pulseboard espera. */
  telefone: string;
  url: string;
}

/**
  * Endpoint padrao. Cada cliente pode ter o seu em `tenant_config.pulseboard_url`
  * — a intencao e' um por cliente, e ate' la' todos usam este.
  */
const ENDPOINT = 'https://pulseboard.sitespdoze.com.br/meta-new-lead';

/**
 * Falha do Pulseboard, separada em duas naturezas.
 *
 * `permanente` distingue "o Pulseboard esta fora do ar" de "esse codi_id nao
 * tem rota cadastrada". A primeira melhora sozinha e merece retentativa; a
 * segunda so' melhora quando alguem mexe no cadastro, e retentar so' gasta a
 * fila e mantem o painel vermelho sem caminho de saida.
 */
export class ErroPulseboard extends Error {
  constructor(mensagem: string, readonly permanente: boolean) {
    super(mensagem);
    this.name = 'ErroPulseboard';
  }
}

export class PulseboardClient {
  constructor(private readonly endpoint: string = ENDPOINT) {}

  async avisarLeadNovo(l: NovoLead): Promise<void> {
    const r = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Campo vazio vira uma linha vazia na mensagem do grupo, como aconteceu
      // com o `*URL:*` do primeiro aviso da Amanda. So' vai o que tem valor.
      body: JSON.stringify({
        Canal: l.canal,
        nome: l.nome,
        telefone: l.telefone,
        URL: l.url,
        ...(l.etapa ? { Etapa: l.etapa } : {}),
        ...(l.conversa ? { Conversa: l.conversa } : {}),
      }),
    });

    const texto = await r.text();
    if (!r.ok) {
      // 4xx e' corpo ou credencial errada da nossa parte: retentar repete o
      // mesmo erro. 5xx e' do lado deles e pode passar.
      throw new ErroPulseboard(
        `Pulseboard respondeu ${r.status}: ${texto.slice(0, 200)}`,
        r.status >= 400 && r.status < 500,
      );
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
    throw new ErroPulseboard(`Pulseboard ignorou o aviso: ${j.reason ?? 'sem motivo'}`, true);
  }
  if (j.ok === false) {
    throw new ErroPulseboard(`Pulseboard recusou: ${corpo.slice(0, 200)}`, true);
  }
  if (typeof j.sent === 'number' && j.sent < 1) {
    const motivo = Array.isArray(j.skipped) && j.skipped.length
      ? j.skipped.map(String).join(' · ')
      : 'sem motivo declarado';

    // Sondado contra producao: um `codi_id` inventado devolve exatamente este
    // erro. Ou seja, `rota_nao_mapeada` significa que aquele codi_id nao tem
    // rota do lado do Pulseboard — cadastro, nao intermitencia.
    const semRota = /rota_nao_mapeada/.test(motivo);
    throw new ErroPulseboard(
      semRota
        ? `o Pulseboard nao tem rota para este webhook — confira a URL do cliente (${motivo.slice(0, 150)})`
        : `Pulseboard nao enviou (sent=${j.sent}): ${motivo.slice(0, 200)}`,
      semRota,
    );
  }
}
