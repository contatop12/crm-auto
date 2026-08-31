import { describe, test, expect } from 'vitest';
import { parseDataBR, matchLead } from '../../src/domain/matching';
import type { LeadCandidate } from '../../src/domain/types';

const AGORA = Date.parse('2026-08-31T12:00:00Z');
const dias = (n: number) => new Date(AGORA - n * 86400000).toISOString();

function lead(over: Partial<LeadCandidate>): LeadCandidate {
  return {
    protocol: 'X',
    phoneKey: '1196316799',
    origem: 'clique',
    createdAt: dias(1),
    ...over,
  };
}

describe('parseDataBR', () => {
  test('entende o formato ISO', () => {
    expect(parseDataBR('2026-08-21T11:46:53Z')).toBe(Date.parse('2026-08-21T11:46:53Z'));
  });

  test('entende o formato brasileiro gravado pelo GTM', () => {
    expect(parseDataBR('21/08/2026 11:46:53')).toBe(
      new Date(2026, 7, 21, 11, 46, 53).getTime(),
    );
  });

  test('entende o formato brasileiro sem segundos', () => {
    expect(parseDataBR('21/08/2026 11:46')).toBe(new Date(2026, 7, 21, 11, 46, 0).getTime());
  });

  test('devolve 0 para data ilegivel', () => {
    expect(parseDataBR('')).toBe(0);
    expect(parseDataBR('ontem')).toBe(0);
    expect(parseDataBR(null)).toBe(0);
  });
});

describe('matchLead', () => {
  test('casa pelo telefone', () => {
    const c = [lead({ protocol: 'A' }), lead({ protocol: 'B', phoneKey: '4788903080' })];
    expect(matchLead('1196316799', c, AGORA, 90)?.protocol).toBe('A');
  });

  test('formulario tem prioridade sobre clique mesmo sendo mais antigo', () => {
    const c = [
      lead({ protocol: 'CLIQUE', origem: 'clique', createdAt: dias(1) }),
      lead({ protocol: 'QUIZ', origem: 'formulario', createdAt: dias(5) }),
    ];
    expect(matchLead('1196316799', c, AGORA, 90)?.protocol).toBe('QUIZ');
  });

  test('entre iguais, vence o mais recente', () => {
    const c = [
      lead({ protocol: 'VELHO', createdAt: dias(10) }),
      lead({ protocol: 'NOVO', createdAt: dias(2) }),
    ];
    expect(matchLead('1196316799', c, AGORA, 90)?.protocol).toBe('NOVO');
  });

  test('descarta lead fora da janela', () => {
    const c = [lead({ protocol: 'ANTIGO', createdAt: dias(120) })];
    expect(matchLead('1196316799', c, AGORA, 90)).toBeNull();
  });

  test('aceita lead com data ilegivel em vez de descartar', () => {
    const c = [lead({ protocol: 'SEMDATA', createdAt: 'lixo' })];
    expect(matchLead('1196316799', c, AGORA, 90)?.protocol).toBe('SEMDATA');
  });

  test('devolve null quando nenhum telefone casa', () => {
    expect(matchLead('4788903080', [lead({})], AGORA, 90)).toBeNull();
  });

  test('devolve null quando a conversa nao tem telefone', () => {
    expect(matchLead('', [lead({})], AGORA, 90)).toBeNull();
  });
});
