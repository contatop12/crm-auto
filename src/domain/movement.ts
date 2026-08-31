import { limpa } from './text';
import type { Stage } from './types';

export interface CanMoveInput {
  /** Nome da etapa em que o card esta agora. Vazio = nao foi possivel ler. */
  atual: string | null | undefined;
  /** Etapa para onde o gatilho aponta. */
  alvoId: number;
  /** true = casou frase-gatilho; false = resposta comum do vendedor. */
  byKeyword: boolean;
  stages: Stage[];
}

export interface CanMoveResult {
  move: boolean;
  /** Explicacao legivel, exibida na tela de Eventos do painel. */
  motivo: string;
}

/**
 * Decide se o card pode ser movido para a etapa alvo.
 *
 * Portado das regras A e B do `Achar Task da Conversa` dos workflows "Mover card".
 *
 *   Regra A (resposta comum) — so move se o card estiver ANTES da etapa alvo.
 *     Um lead em Negociacao nao volta para Qualificando a cada resposta.
 *   Regra B (frase-gatilho) — nao puxa o card para tras, exceto quando a etapa
 *     alvo e' final (Ganha / Perdida / Desqualificado), alcancavel de qualquer ponto.
 *
 * Quando a etapa atual nao e' legivel, o motivo diz isso em vez de falhar calado:
 * era exatamente esse silencio que escondia o bug do "Qualificando".
 */
export function canMove({ atual, alvoId, byKeyword, stages }: CanMoveInput): CanMoveResult {
  const alvo = stages.find((s) => s.id === alvoId);
  if (!alvo) {
    return { move: false, motivo: `etapa alvo ${alvoId} nao existe no funil configurado` };
  }

  const nomeAtual = limpa(atual);
  if (!nomeAtual) {
    return { move: false, motivo: 'nao foi possivel ler a etapa atual do card' };
  }

  if (nomeAtual === limpa(alvo.nome)) {
    return { move: false, motivo: `card ja esta em ${alvo.nome}` };
  }

  // etapa final e' alcancavel de qualquer ponto, inclusive de um nome fora do funil
  if (alvo.isFinal) {
    return { move: true, motivo: 'ok' };
  }

  const stageAtual = stages.find((s) => limpa(s.nome) === nomeAtual);
  if (!stageAtual) {
    return {
      move: false,
      motivo: `etapa atual "${atual}" nao pertence ao funil configurado`,
    };
  }

  if (stageAtual.posicao >= alvo.posicao) {
    return {
      move: false,
      motivo: byKeyword
        ? `gatilho apontava para ${alvo.nome} mas o card ja esta em ${stageAtual.nome}`
        : `resposta do vendedor mas o card ja esta em ${stageAtual.nome}`,
    };
  }

  return { move: true, motivo: 'ok' };
}
