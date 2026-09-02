/**
 * O que falta criar na conta do Chatwoot de um cliente.
 *
 * O workflow que isto substitui mandava criar tudo sempre e classificava o erro
 * de "ja existe" pela mensagem devolvida (`/taken|exist|duplicat|unique/`).
 * Funciona, mas depende do texto do erro e gasta uma chamada por item existente.
 *
 * Aqui a conta e' lida primeiro e so' o que falta e' criado. A diferenca aparece
 * na tela: da' para mostrar o que sera' criado ANTES de criar.
 */

export type ModeloAtributo = 'contact_attribute' | 'conversation_attribute' | 'task_attribute';

export interface PadraoEtiqueta {
  slug: string;
  cor: string;
  descricao: string | null;
}

export interface PadraoAtributo {
  modelo: ModeloAtributo;
  chave: string;
  nome: string;
  tipo: string;
  descricao: string | null;
}

export interface PlanoProvisionamento {
  etiquetasACriar: PadraoEtiqueta[];
  etiquetasExistentes: string[];
  atributosACriar: PadraoAtributo[];
  atributosExistentes: string[];
  /** Existe na conta e nao esta no padrao. Nao e' apagado — so' relatado. */
  etiquetasForaDoPadrao: string[];
  atributosForaDoPadrao: string[];
}

const norm = (s: string) => s.trim().toLowerCase();

export function planejarProvisionamento(
  padraoEtiquetas: PadraoEtiqueta[],
  padraoAtributos: PadraoAtributo[],
  naContaEtiquetas: string[],
  naContaAtributos: Array<{ modelo: string; chave: string }>,
): PlanoProvisionamento {
  const temEtiqueta = new Set(naContaEtiquetas.map(norm));
  const temAtributo = new Set(naContaAtributos.map((a) => `${a.modelo}/${norm(a.chave)}`));
  const noPadraoEtiqueta = new Set(padraoEtiquetas.map((e) => norm(e.slug)));
  const noPadraoAtributo = new Set(padraoAtributos.map((a) => `${a.modelo}/${norm(a.chave)}`));

  const chave = (a: { modelo: string; chave: string }) => `${a.modelo}/${norm(a.chave)}`;

  return {
    etiquetasACriar: padraoEtiquetas.filter((e) => !temEtiqueta.has(norm(e.slug))),
    etiquetasExistentes: padraoEtiquetas.filter((e) => temEtiqueta.has(norm(e.slug))).map((e) => e.slug),
    atributosACriar: padraoAtributos.filter((a) => !temAtributo.has(chave(a))),
    atributosExistentes: padraoAtributos.filter((a) => temAtributo.has(chave(a))).map((a) => `${a.modelo}/${a.chave}`),
    // O cliente cria etiqueta a mao no dia a dia ("Ligar mais tarde"). Apagar o
    // que nao esta no padrao destruiria o trabalho dele.
    etiquetasForaDoPadrao: naContaEtiquetas.filter((e) => !noPadraoEtiqueta.has(norm(e))),
    atributosForaDoPadrao: naContaAtributos
      .filter((a) => !noPadraoAtributo.has(chave(a)))
      .map((a) => `${a.modelo}/${a.chave}`),
  };
}

/**
 * Nome de campanha a partir do ID.
 *
 * O modelo de URL do anuncio usa as macros `{campaignname}` e `{adgroupname}`.
 * Quando elas nao sao preenchidas no Google Ads, a UTM chega com o literal
 * `{campaignname}` — inutil — e o unico dado aproveitavel e' o `utm_id`, que
 * carrega o ID numerico da campanha.
 *
 * Entao o nome e' resolvido pelo ID, contra a API, e a UTM do card e' preenchida
 * com o nome de verdade.
 */
export function precisaResolverNome(utmCampaign: string | null, utmId: string | null): boolean {
  if (!utmId || !/^\d+$/.test(utmId.trim())) return false;
  const c = (utmCampaign ?? '').trim();
  // vazio, macro nao resolvida, ou o proprio ID repetido no lugar do nome
  return c === '' || /^\{[^}]*\}$/.test(c) || c === utmId.trim();
}

/** Os atributos de UTM que o card recebe, so' com o que tem valor. */
export function utmsDoCard(v: {
  protocolo?: string | null;
  gclid?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmId?: string | null;
  utmTerm?: string | null;
  utmContent?: string | null;
}): Record<string, string> {
  const saida: Record<string, string> = {};
  const por: Array<[string, string | null | undefined]> = [
    ['protocolo', v.protocolo],
    ['gclid', v.gclid],
    ['utm_source', v.utmSource],
    ['utm_medium', v.utmMedium],
    ['utm_campaign', v.utmCampaign],
    ['utm_id', v.utmId],
    ['utm_term', v.utmTerm],
    ['utm_content', v.utmContent],
  ];
  for (const [k, valor] of por) {
    const s = (valor ?? '').trim();
    // macro nao resolvida nunca entra no card: poluiria o relatorio por campanha
    if (!s || /^\{[^}]*\}$/.test(s)) continue;
    saida[k] = s;
  }
  return saida;
}
