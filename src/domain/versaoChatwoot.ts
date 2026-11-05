/**
 * `a` e' mais nova que `b`? Compara os numeros na ordem em que aparecem:
 * `4.19.0-fazer-ai-pro.164` > `4.19.0-fazer-ai-pro.157`. Vazio nunca e' mais novo.
 */
export function versaoMaisNova(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a) return false;
  if (!b) return true;
  const na = numeros(a);
  const nb = numeros(b);
  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    const d = (na[i] ?? 0) - (nb[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

function numeros(v: string): number[] {
  return (v.match(/\d+/g) ?? []).map(Number);
}

export function textoVersaoNova(rodando: string, nova: string): string {
  return [
    '🔔 Chatwoot: versão nova da fazer.ai',
    '',
    `*Rodando:* ${rodando}`,
    `*Nova:* ${nova}`,
    'Notas: https://fazer.ai/chatwoot-release-notes',
    '',
    'A atualização só roda com o ok do Ryan.',
  ].join('\n');
}

export type ProblemaDoScript = 'card' | 'etiquetas';

const ONDE: Record<ProblemaDoScript, string> = {
  card: 'os cards do kanban',
  etiquetas: 'a tela de Etiquetas',
};

export function textoScriptQuebrado(problema: ProblemaDoScript, versao: string, conta: number): string {
  return [
    `⚠️ Categorias de etiquetas: o script não achou ${ONDE[problema]}.`,
    '',
    `*Versão do Chatwoot:* ${versao}`,
    `*Conta:* ${conta}`,
    '',
    'O painel segue funcionando, só sem as categorias. O script precisa de ajuste.',
  ].join('\n');
}
