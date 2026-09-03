/**
 * Padronizacao do container do GTM.
 *
 * O modelo `P12 - MODELO (UTM Persist + Rastreio Protocolo)` traz o que o
 * rastreamento precisa: a persistencia de UTM, a injecao do protocolo no link
 * do WhatsApp e o coletor que chama a nossa rota de ingestao.
 *
 * A regra que manda aqui: ACRESCENTAR, nunca apagar. O container do cliente
 * tem o rastreamento dele — Analytics, pixel, remarketing — e nada disso pode
 * sumir. Entidade que ja existe com o mesmo nome fica como esta'.
 */

export interface EntidadeGtm {
  name?: string;
  type?: string;
  parameter?: Array<{ key?: string; value?: string; type?: string }>;
  [k: string]: unknown;
}

export interface ModeloGtm {
  customTemplate: EntidadeGtm[];
  variable: EntidadeGtm[];
  trigger: EntidadeGtm[];
  tag: EntidadeGtm[];
  builtInVariable: EntidadeGtm[];
}

/** O que muda de cliente para cliente. */
export interface ValoresDoCliente {
  /** `VITA`, `PERS` — vira o comeco do protocolo. */
  prefixo: string;
  /** `p12-vita` — identifica o cliente no rastreio. */
  clientId: string;
  /** A rota de ingestao deste cliente, com a chave. */
  collectUrl: string;
}

/** Nome das constantes no modelo. Trocar aqui se o modelo for renomeado. */
const CONSTANTES = {
  '00 - [P12] PREFIXO PROTOCOLO': (v: ValoresDoCliente) => v.prefixo,
  '00 - [P12] CLIENT ID': (v: ValoresDoCliente) => v.clientId,
  '00 - [P12] COLLECT URL': (v: ValoresDoCliente) => v.collectUrl,
} as const;

export function lerModelo(json: string): ModeloGtm {
  const j = JSON.parse(json) as Record<string, unknown>;
  const c = (j.containerVersion ?? j) as Record<string, unknown>;
  const lista = (k: string) => (Array.isArray(c[k]) ? (c[k] as EntidadeGtm[]) : []);
  return {
    customTemplate: lista('customTemplate'),
    variable: lista('variable'),
    trigger: lista('trigger'),
    tag: lista('tag'),
    builtInVariable: lista('builtInVariable'),
  };
}

/**
 * Preenche as constantes do modelo com os valores do cliente.
 *
 * O modelo vem com `COLLECT URL = https://SEU-N8N/webhook/COLE-AQUI`. Subir
 * isso sem trocar faria o container mandar os cliques para lugar nenhum — e em
 * silencio, porque o GTM nao reclama de URL que nao responde.
 */
export function preencherConstantes(v: EntidadeGtm, valores: ValoresDoCliente): EntidadeGtm {
  const preencher = CONSTANTES[v.name as keyof typeof CONSTANTES];
  if (!preencher) return v;
  return {
    ...v,
    parameter: (v.parameter ?? []).map((p) =>
      p.key === 'value' ? { ...p, value: preencher(valores) } : p,
    ),
  };
}

export interface PlanoGtm {
  templatesACriar: EntidadeGtm[];
  variaveisACriar: EntidadeGtm[];
  gatilhosACriar: EntidadeGtm[];
  tagsACriar: EntidadeGtm[];
  builtInACriar: string[];
  /** Ja estao no container e nao sao tocadas. */
  jaExistem: string[];
  /** Constantes que ficariam com o valor de exemplo do modelo. */
  semValor: string[];
}

const nome = (e: EntidadeGtm) => String(e.name ?? '').trim();
const norm = (s: string) => s.trim().toLowerCase();

/**
 * O que falta no container do cliente.
 *
 * Compara por NOME, nao por id: os ids do modelo sao locais ao arquivo e nao
 * significam nada no container de destino.
 */
export function planejarGtm(
  modelo: ModeloGtm,
  noContainer: {
    templates: string[];
    variaveis: string[];
    gatilhos: string[];
    tags: string[];
    builtIn: string[];
  },
  valores: ValoresDoCliente,
): PlanoGtm {
  const jaExistem: string[] = [];

  const faltando = (itens: EntidadeGtm[], existentes: string[], rotulo: string) => {
    const tem = new Set(existentes.map(norm));
    return itens.filter((e) => {
      if (tem.has(norm(nome(e)))) {
        jaExistem.push(`${rotulo}: ${nome(e)}`);
        return false;
      }
      return true;
    });
  };

  const variaveis = faltando(modelo.variable, noContainer.variaveis, 'variável')
    .map((v) => preencherConstantes(v, valores));

  // Constante que continuaria com o exemplo do modelo faria o container
  // apontar para o n8n antigo; vazia faria o coletor postar para lugar nenhum.
  // Os dois falham em silencio — o GTM nao reclama de URL que nao responde.
  const semValor = variaveis
    .filter((v) => CONSTANTES[v.name as keyof typeof CONSTANTES])
    .filter((v) => {
      const val = ((v.parameter ?? []).find((p) => p.key === 'value')?.value ?? '').trim();
      return !val || /SEU-N8N|COLE-AQUI|^CLIENTE$|^p12-cliente$/.test(val);
    })
    .map(nome);

  return {
    templatesACriar: faltando(modelo.customTemplate, noContainer.templates, 'template'),
    variaveisACriar: variaveis,
    gatilhosACriar: faltando(modelo.trigger, noContainer.gatilhos, 'gatilho'),
    tagsACriar: faltando(modelo.tag, noContainer.tags, 'tag'),
    builtInACriar: modelo.builtInVariable
      .map((b) => String(b.type ?? ''))
      .filter((t) => t && !noContainer.builtIn.includes(t)),
    jaExistem,
    semValor,
  };
}

/**
 * Troca os ids de gatilho do modelo pelos ids reais do container.
 *
 * A tag guarda `firingTriggerId: ["210"]`, que e' o id DENTRO do arquivo. Subir
 * assim ligaria a tag a um gatilho que nao existe no destino, ou pior, a um
 * gatilho alheio que por acaso tem esse id.
 *
 * Id que nao esta no mapa passa intacto: os embutidos do GTM (`2147479573` =
 * todas as paginas) sao iguais em qualquer container.
 */
export function remapearGatilhos(
  tag: EntidadeGtm,
  deNomeParaId: Map<string, string>,
  nomePorIdDoModelo: Map<string, string>,
): EntidadeGtm {
  const troca = (ids: unknown) =>
    Array.isArray(ids)
      ? ids.map((id) => {
          const nomeDoGatilho = nomePorIdDoModelo.get(String(id));
          return nomeDoGatilho ? (deNomeParaId.get(norm(nomeDoGatilho)) ?? String(id)) : String(id);
        })
      : ids;

  return {
    ...tag,
    firingTriggerId: troca(tag.firingTriggerId),
    blockingTriggerId: troca(tag.blockingTriggerId),
  };
}

/** Ids de gatilho do modelo -> nome, para o remapeamento. */
export function indiceDeGatilhos(modelo: ModeloGtm): Map<string, string> {
  return new Map(
    modelo.trigger
      .filter((t) => t.triggerId)
      .map((t) => [String(t.triggerId), nome(t)]),
  );
}

/** Campos que o GTM recusa em POST: sao atribuidos por ele. */
const SO_LEITURA = [
  'accountId', 'containerId', 'workspaceId', 'fingerprint', 'path',
  'tagManagerUrl', 'parentFolderId', 'templateId', 'variableId', 'triggerId', 'tagId',
];

export function limparParaCriar(e: EntidadeGtm): EntidadeGtm {
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) {
    if (!SO_LEITURA.includes(k)) saida[k] = v;
  }
  return saida as EntidadeGtm;
}
