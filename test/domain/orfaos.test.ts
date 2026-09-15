import { describe, test, expect } from 'vitest';
import { classificarCards, conversaCitada } from '../../src/domain/orfaos';

const card = (id: number, titulo: string, conversas: number[] = []) => ({
  id,
  board_id: 14,
  board_step_id: 56,
  title: titulo,
  created_at: '2026-08-13T11:27:01.704Z',
  conversations: conversas.map((d) => ({ id: d + 1000, display_id: d })),
});

describe('conversaCitada', () => {
  test('le o display id do titulo que o Chatwoot gera', () => {
    expect(conversaCitada('Conversa #28 - Carol Nunes')).toBe(28);
    expect(conversaCitada('Conversa #3 - P12 / Persianas Paulista (')).toBe(3);
  });

  test('titulo sem numero nao cita conversa', () => {
    expect(conversaCitada('Ismael machado')).toBeNull();
    expect(conversaCitada('')).toBeNull();
  });
});

describe('classificarCards', () => {
  const vivas = new Set([372, 516]);

  test('card com conversa ligada nao e orfao', () => {
    expect(classificarCards([card(1, 'Conversa #516 - Pericles', [516])], vivas)).toEqual([]);
  });

  // A ligacao confiavel e' conversations[], nao conversation_ids (docs/api-reference.md)
  test('orfao cuja conversa foi apagada', () => {
    const [r] = classificarCards([card(2, 'Conversa #28 - Carol Nunes')], vivas);
    expect(r).toMatchObject({ taskId: 2, conversa: 28, situacao: 'conversa_apagada' });
  });

  test('orfao cuja conversa ainda existe: da para religar', () => {
    const [r] = classificarCards([card(3, 'Conversa #372 - Fulano')], vivas);
    expect(r).toMatchObject({ taskId: 3, conversa: 372, situacao: 'conversa_viva' });
  });

  test('orfao sem numero no titulo', () => {
    const [r] = classificarCards([card(4, 'Ismael machado')], vivas);
    expect(r).toMatchObject({ taskId: 4, conversa: null, situacao: 'sem_referencia' });
  });

  test('leva board, etapa, titulo e data para a tela', () => {
    const [r] = classificarCards([card(5, 'Conversa #8 - Maria')], vivas);
    expect(r).toEqual({
      taskId: 5, boardId: 14, stepId: 56, titulo: 'Conversa #8 - Maria',
      conversa: 8, situacao: 'conversa_apagada', criadoEm: '2026-08-13T11:27:01.704Z',
    });
  });
});
