import { matchStage } from './triggers';
import { canMove } from './movement';
import type { Stage, Trigger } from './types';

/**
 * Onde o card estaria se as respostas do vendedor tivessem contado.
 *
 * Resposta dada com o card no Organico e' ignorada — o Organico nao tem para
 * onde avancar. O problema e' quando o card e' promovido DEPOIS: ninguem volta
 * para reler o que ja' foi dito, e o card entra no funil parado em Novo Lead.
 *
 * Aconteceu dos dois jeitos:
 *   - Tainã, conversa 757: a vendedora abordou segundos antes da promocao.
 *   - Persianas, conversa 534 (Ana Baumann): uma semana de conversa no
 *     Organico, com orcamento e "Visita Agendada! ✅", ate' o formulario da
 *     Meta casar pelo telefone e promover o card.
 *
 * Reaplica, na ordem, as mesmas duas regras da resposta ao vivo — `matchStage`
 * decide para onde a frase aponta, `canMove` decide se pode ir — partindo da
 * etapa atual. Assim a simulacao nunca faz o que a resposta ao vivo nao faria.
 */

export interface PassoHistorico {
  de: string;
  para: string;
  /** Frase-gatilho que casou; vazio quando foi a resposta automatica. */
  frase: string;
  trecho: string;
}

export function simularRespostas(
  atual: string,
  textos: string[],
  stages: Stage[],
  triggers: Trigger[],
): { etapa: Stage | null; passos: PassoHistorico[] } {
  let agora = atual;
  const passos: PassoHistorico[] = [];

  for (const texto of textos) {
    const casou = matchStage(texto, stages, triggers);
    if (!casou) continue;
    const decisao = canMove({ atual: agora, alvoId: casou.stageId, byKeyword: casou.byKeyword, stages });
    if (!decisao.move) continue;
    passos.push({ de: agora, para: casou.stageNome, frase: casou.matchedPhrase, trecho: texto.slice(0, 160) });
    agora = casou.stageNome;
  }

  const etapa = passos.length ? (stages.find((s) => s.nome === agora) ?? null) : null;
  return { etapa, passos };
}
