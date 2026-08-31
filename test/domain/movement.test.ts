import { describe, test, expect } from 'vitest';
import { canMove } from '../../src/domain/movement';
import type { Stage } from '../../src/domain/types';

const stages: Stage[] = [
  { id: 1, posicao: 1, nome: 'Novo Lead', isFinal: false, autoOnReply: false },
  { id: 2, posicao: 2, nome: 'Qualificando', isFinal: false, autoOnReply: true },
  { id: 3, posicao: 3, nome: 'Proposta Enviada', isFinal: false, autoOnReply: false },
  { id: 4, posicao: 4, nome: 'Agendamento de Visita', isFinal: false, autoOnReply: false },
  { id: 5, posicao: 5, nome: 'Negociação', isFinal: false, autoOnReply: false },
  { id: 7, posicao: 7, nome: 'Oportunidade Ganha', isFinal: true, autoOnReply: false },
];

describe('canMove — regra A: resposta comum do vendedor', () => {
  test('move quando o card esta antes da etapa alvo', () => {
    const r = canMove({ atual: 'Novo Lead', alvoId: 2, byKeyword: false, stages });
    expect(r.move).toBe(true);
  });

  test('nao move quando o card ja passou da etapa alvo', () => {
    const r = canMove({ atual: 'Negociação', alvoId: 2, byKeyword: false, stages });
    expect(r.move).toBe(false);
    expect(r.motivo).toContain('Negociação');
  });

  test('nao move quando o card ja esta na etapa alvo', () => {
    const r = canMove({ atual: 'Qualificando', alvoId: 2, byKeyword: false, stages });
    expect(r.move).toBe(false);
  });
});

describe('canMove — regra B: gatilho por frase', () => {
  test('avanca para etapa posterior', () => {
    const r = canMove({ atual: 'Qualificando', alvoId: 5, byKeyword: true, stages });
    expect(r.move).toBe(true);
  });

  test('gatilho de etapa anterior nao puxa o card para tras', () => {
    const r = canMove({ atual: 'Negociação', alvoId: 3, byKeyword: true, stages });
    expect(r.move).toBe(false);
    expect(r.motivo).toContain('Proposta Enviada');
  });

  test('etapa final e alcancavel de qualquer ponto', () => {
    expect(canMove({ atual: 'Novo Lead', alvoId: 7, byKeyword: true, stages }).move).toBe(true);
    expect(canMove({ atual: 'Negociação', alvoId: 7, byKeyword: true, stages }).move).toBe(true);
  });
});

describe('canMove — diagnostico', () => {
  test('nao move e denuncia quando a etapa atual do card e desconhecida', () => {
    // este era o bug do "Qualificando": a etapa atual vinha vazia e o card
    // nunca era movido, sem que nada dissesse por que
    const r = canMove({ atual: '', alvoId: 2, byKeyword: false, stages });
    expect(r.move).toBe(false);
    expect(r.motivo).toContain('etapa atual');
  });

  test('nao move quando a etapa alvo nao existe no funil', () => {
    const r = canMove({ atual: 'Novo Lead', alvoId: 999, byKeyword: true, stages });
    expect(r.move).toBe(false);
    expect(r.motivo).toContain('999');
  });

  test('card em etapa fora do funil pode ir para etapa final', () => {
    // card recem-promovido de outro board pode estar num nome que nao mapeamos
    const r = canMove({ atual: 'Orgânico', alvoId: 7, byKeyword: true, stages });
    expect(r.move).toBe(true);
  });

  test('compara nome de etapa ignorando acento e caixa', () => {
    const r = canMove({ atual: 'NEGOCIACAO', alvoId: 3, byKeyword: true, stages });
    expect(r.move).toBe(false);
  });
});
