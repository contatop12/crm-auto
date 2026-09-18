/**
 * O que o consentimento do Google pede, e como isso se chama para quem autoriza.
 *
 * A tela do Google hoje mostra uma caixa por permissao, e desmarcar uma nao da'
 * erro nenhum: o token volta valido, so' que sem ela. O problema aparece dias
 * depois, como 403 "insufficient authentication scopes" na hora de publicar ou
 * de escrever na planilha. Por isso cada escopo tem nome — a volta do Google
 * diz, com palavras, o que ficou faltando.
 */

const G = 'https://www.googleapis.com/auth/';

export const ESCOPOS_GOOGLE: Array<{ escopo: string; nome: string }> = [
  { escopo: G + 'tagmanager.readonly', nome: 'Tag Manager — ler containers' },
  { escopo: G + 'tagmanager.edit.containers', nome: 'Tag Manager — editar containers' },
  // Publicar sao DOIS passos e dois escopos: criar a versao e por no ar. Sem o
  // primeiro, `create_version` volta 403 "insufficient authentication scopes" —
  // que parece falta de permissao na conta e nao e'.
  { escopo: G + 'tagmanager.edit.containerversions', nome: 'Tag Manager — criar versões' },
  { escopo: G + 'tagmanager.publish', nome: 'Tag Manager — publicar' },
  // junto porque o refresh token novo substitui o antigo no mesmo cliente:
  // sem isto, autorizar o GTM poderia derrubar o acesso ao Google Ads
  { escopo: G + 'adwords', nome: 'Google Ads' },
  // A conversao offline sobe pela Data Manager API, nao pela API do Google
  // Ads: `UploadClickConversions` esta fechada para integracao nova
  // ("Usage ... is limited to existing users").
  { escopo: G + 'datamanager', nome: 'Data Manager (conversões)' },
  // escrever direto nas planilhas do cliente, sem depender do n8n
  { escopo: G + 'spreadsheets', nome: 'Planilhas (Google Sheets)' },
];

function conjunto(escopos: string | null | undefined): Set<string> {
  return new Set((escopos ?? '').split(/\s+/).filter(Boolean));
}

/** O que foi pedido e nao voltou concedido. */
export function escoposFaltando(concedidos: string | null | undefined): Array<{ escopo: string; nome: string }> {
  const tem = conjunto(concedidos);
  return ESCOPOS_GOOGLE.filter((e) => !tem.has(e.escopo));
}

/**
 * O que o token atual tem e o novo nao.
 *
 * Gravar um token que perde permissao troca uma coisa que funcionava por uma
 * que nao funciona — e quem autorizou achou que estava so' acrescentando.
 */
export function escoposPerdidos(atual: string | null | undefined, novo: string | null | undefined): string[] {
  const n = conjunto(novo);
  return [...conjunto(atual)].filter((e) => !n.has(e));
}
