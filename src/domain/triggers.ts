import { limpa } from './text';
import type { Stage, StageMatch, Trigger } from './types';

/**
 * Decide para qual etapa a mensagem do vendedor aponta.
 *
 * Portado do `Parse Mensagem Vendedor` (array GATILHOS) dos workflows "Mover card".
 *
 * Ordem de decisao:
 *   1. frases-gatilho, da etapa MAIS AVANCADA para a mais inicial — a primeira
 *      que casar vence, para que "visita agendada + dados para o contrato" na
 *      mesma mensagem caia em Producao, nao em Agendamento
 *   2. sem gatilho, qualquer resposta do vendedor cai na etapa `autoOnReply`
 *
 * Devolve null quando a mensagem nao tem texto aproveitavel (so anexo, so emoji)
 * ou quando nao ha etapa de fallback configurada.
 *
 * Nao decide SE o card pode mover — isso e' `canMove`, em ./movement.
 */
export function matchStage(
  conteudoCru: string | null | undefined,
  stages: Stage[],
  triggers: Trigger[],
): StageMatch | null {
  const cru = String(conteudoCru ?? '');
  const conteudo = limpa(cru);
  if (!conteudo) return null;

  const porId = new Map(stages.map((s) => [s.id, s]));

  // etapa mais avancada primeiro
  const ordenados = [...triggers].sort(
    (a, b) => (porId.get(b.stageId)?.posicao ?? 0) - (porId.get(a.stageId)?.posicao ?? 0),
  );

  for (const t of ordenados) {
    const stage = porId.get(t.stageId);
    if (!stage) continue;
    // emoji e' conferido no texto CRU: `limpa()` justamente remove emoji
    if (t.emojiObrigatorio && !cru.includes(t.emojiObrigatorio)) continue;
    if (!conteudo.includes(limpa(t.frase))) continue;

    return { stageId: stage.id, stageNome: stage.nome, byKeyword: true, matchedPhrase: t.frase };
  }

  const fallback = stages.find((s) => s.autoOnReply);
  if (!fallback) return null;

  return {
    stageId: fallback.id,
    stageNome: fallback.nome,
    byKeyword: false,
    matchedPhrase: '',
  };
}
