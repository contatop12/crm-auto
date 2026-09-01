import { describe, test, expect } from 'vitest';
import { exigir } from '../../src/domain/config';

describe('exigir', () => {
  test('devolve o valor quando o segredo esta cadastrado', () => {
    expect(exigir({ A: 'x' }, 'A')).toBe('x');
  });

  test('diz qual segredo falta em vez de estourar em undefined', () => {
    expect(() => exigir({}, 'CHATWOOT_BASE_URL')).toThrow(/CHATWOOT_BASE_URL/);
  });

  test('trata string vazia como ausente', () => {
    expect(() => exigir({ A: '   ' }, 'A')).toThrow(/A/);
  });

  test('a mensagem diz como resolver', () => {
    expect(() => exigir({}, 'EVOLUTION_API_KEY')).toThrow(/wrangler secret/);
  });
});
