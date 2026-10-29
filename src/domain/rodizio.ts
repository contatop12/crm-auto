/**
 * Rodizio de atendentes por caixa de entrada (tenant_config.cw_rodizio).
 *
 * JSON {"<inbox>":[<agente>,...]}. Locadora: 8910 alterna Tania/Isabella
 * ([15,13]); 8844 e' sempre a Bianca ([12]); 2244 sempre a Vania ([14]).
 */

export type ConfigRodizio = Record<number, number[]>;

/** Config invalida ou vazia = desligado (null), nunca excecao. */
export function lerRodizio(json: string | null | undefined): ConfigRodizio | null {
  if (!json) return null;
  let j: unknown;
  try {
    j = JSON.parse(json);
  } catch {
    return null;
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;

  const cfg: ConfigRodizio = {};
  for (const [inbox, lista] of Object.entries(j as Record<string, unknown>)) {
    const id = Number(inbox);
    if (!Number.isInteger(id) || id <= 0 || !Array.isArray(lista)) continue;
    const agentes = lista.map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (agentes.length) cfg[id] = agentes;
  }
  return Object.keys(cfg).length ? cfg : null;
}

/**
 * `vez` e' o contador depois do incremento (1, 2, 3...): a primeira conversa
 * da caixa vai para o primeiro da lista.
 */
export function agenteDaVez(agentes: number[], vez: number): number {
  return agentes[(((vez - 1) % agentes.length) + agentes.length) % agentes.length]!;
}
