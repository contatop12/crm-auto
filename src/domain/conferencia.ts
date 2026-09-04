/**
 * O outro lado está mesmo apontando para cá?
 *
 * A tela já sabia responder duas coisas: a chave abre a porta (`/ping`), e
 * alguém já usou o endereço (contagem de eventos). Faltava a do meio — o
 * sistema de origem foi configurado? — e é justamente ela que explica o caso
 * mais comum: "nunca recebeu".
 *
 * "Nunca recebeu" tem três causas que exigem ações opostas, e a tela mostrava
 * as três com a mesma frase:
 *
 *   ninguém colou o endereço  → colar
 *   colaram com a chave antiga → o Chatwoot dispara, o Worker devolve 401,
 *                                e o evento se perde sem deixar rastro aqui
 *   a regra existe mas está desligada → ligar
 *
 * O terceiro caso é o pior no GTM: uma constante apontando para o n8n antigo
 * coleta normalmente e entrega tudo para um fluxo desligado. Nada quebra, nada
 * aparece, e os cliques somem.
 */

export type Estado = 'ok' | 'erro' | 'falta';

export interface Veredito {
  estado: Estado;
  detalhe: string;
}

/** Uma regra de automação do Chatwoot, reduzida ao que interessa aqui. */
export interface RegraWebhook {
  nome: string;
  ativa: boolean;
  /** URLs de todas as ações `send_webhook_event` da regra. */
  urls: string[];
}

/**
 * Compara duas URLs pelo que importa: destino e parâmetros, não pela escrita.
 *
 * A ordem dos parâmetros não é significativa — `?k=X&evento=Y` e `?evento=Y&k=X`
 * chegam iguais no Worker — mas comparar as strings cruas diria que são
 * diferentes e acusaria um problema que não existe.
 */
function chave(u: string): string | null {
  let url: URL;
  try {
    url = new URL(u.trim());
  } catch {
    return null;
  }
  const params = [...url.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `${url.origin}${url.pathname}?${params.map(([k, v]) => `${k}=${v}`).join('&')}`;
}

/** Mesmo endereço, ignorando só a chave — é o que separa "chave velha" de "outro lugar". */
function semChave(u: string): string | null {
  let url: URL;
  try {
    url = new URL(u.trim());
  } catch {
    return null;
  }
  const params = [...url.searchParams.entries()]
    .filter(([k]) => k !== 'k')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `${url.origin}${url.pathname}?${params.map(([k, v]) => `${k}=${v}`).join('&')}`;
}

const lista = (ns: string[]) => ns.map((n) => `"${n}"`).join(', ');

/**
 * Alguma regra ativa do Chatwoot manda para este endereço exato?
 *
 * `evento=conversao` faz parte da identidade do endereço, não é detalhe: as
 * duas URLs do Kanban só diferem por ele, e casar por prefixo daria a entrada
 * como configurada quando só a de conversão existe.
 */
export function conferirNoChatwoot(esperada: string, regras: RegraWebhook[]): Veredito {
  const alvo = chave(esperada);
  const alvoSemChave = semChave(esperada);

  const casam = (r: RegraWebhook) => r.urls.some((u) => chave(u) === alvo);
  const quaseCasam = (r: RegraWebhook) =>
    r.urls.some((u) => semChave(u) === alvoSemChave && chave(u) !== alvo);

  const ativas = regras.filter((r) => r.ativa && casam(r));
  if (ativas.length) {
    return {
      estado: 'ok',
      detalhe:
        ativas.length === 1
          ? `regra ${lista(ativas.map((r) => r.nome))} dispara para cá`
          : `${ativas.length} regras disparam para cá: ${lista(ativas.map((r) => r.nome))}`,
    };
  }

  const desligadas = regras.filter((r) => !r.ativa && casam(r));
  if (desligadas.length) {
    return {
      estado: 'erro',
      detalhe: `a regra ${lista(desligadas.map((r) => r.nome))} aponta para cá, mas está desligada no Chatwoot`,
    };
  }

  const chaveVelha = regras.filter((r) => r.ativa && quaseCasam(r));
  if (chaveVelha.length) {
    return {
      estado: 'erro',
      detalhe:
        `a regra ${lista(chaveVelha.map((r) => r.nome))} usa uma chave diferente da atual — ` +
        'o Chatwoot dispara, o Worker devolve 401 e o evento se perde. Cole o endereço novo.',
    };
  }

  return { estado: 'falta', detalhe: 'nenhuma regra do Chatwoot aponta para este endereço' };
}

/** O valor de exemplo que vem no modelo e não serve para nenhum cliente. */
const DO_MODELO = /SEU-N8N|COLE-AQUI/i;

/**
 * A constante `COLLECT URL` do container aponta para cá?
 *
 * `valor` é `null` quando a variável não existe no container.
 */
export function conferirNoGtm(esperada: string, valor: string | null): Veredito {
  const v = (valor ?? '').trim();
  if (!v) {
    return {
      estado: 'falta',
      detalhe: 'a constante COLLECT URL não existe no container — rode Padronizar',
    };
  }
  if (DO_MODELO.test(v)) {
    return {
      estado: 'erro',
      detalhe: 'a constante ainda tem o endereço de exemplo do modelo; o container coleta e não entrega a ninguém',
    };
  }
  if (chave(v) === chave(esperada)) {
    return { estado: 'ok', detalhe: 'a constante COLLECT URL aponta para cá' };
  }
  if (semChave(v) === semChave(esperada)) {
    return {
      estado: 'erro',
      detalhe: 'a constante usa uma chave diferente da atual — o GTM posta e recebe 401. Cole o endereço novo.',
    };
  }
  return {
    estado: 'erro',
    detalhe: `a constante aponta para outro endereço (${v.slice(0, 80)}) — os cliques estão indo para lá, não para cá`,
  };
}
