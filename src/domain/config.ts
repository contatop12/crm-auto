/**
 * Guarda de configuracao.
 *
 * Sem isto, um segredo ausente vira `Cannot read properties of undefined
 * (reading 'replace')` na tela de saude — mensagem que nao diz nem qual
 * integracao falhou, nem o que fazer.
 *
 * Foi exatamente o que aconteceu quando `wrangler secret bulk` apagou o
 * conjunto de segredos: tres integracoes quebraram com o mesmo erro opaco.
 */
export function exigir(env: object, nome: string): string {
  const v = (env as Record<string, unknown>)[nome];
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error(
      `segredo ${nome} nao cadastrado — rode: npx wrangler secret put ${nome} ` +
        `(atencao: "secret bulk" SUBSTITUI o conjunto inteiro, nao faz merge)`,
    );
  }
  return v;
}
