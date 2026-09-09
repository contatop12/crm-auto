import { describe, test, expect } from 'vitest';
import { mascararSegredo } from '../../src/domain/segredo';

describe('mascararSegredo', () => {
  test('mostra so o comeco, o bastante para reconhecer', () => {
    expect(mascararSegredo('Ngq0RaMMpLvFi5eqsyj_M5ZF')).toBe('Ngq0RaMM…');
  });

  test('o mascarado nao permite reconstruir a chave', () => {
    const m = mascararSegredo('Ngq0RaMMpLvFi5eqsyj_M5ZF');
    expect(m).not.toContain('pLvFi5eqsyj_M5ZF');
    expect(m.length).toBeLessThan('Ngq0RaMMpLvFi5eqsyj_M5ZF'.length);
  });

  test('chave curta nao vaza mais do que a longa', () => {
    // sem isto, uma chave de 9 caracteres apareceria quase inteira
    expect(mascararSegredo('abcdefghi')).toBe('abcd…');
    expect(mascararSegredo('abc')).toBe('…');
  });

  test('vazio e nulo nao viram reticencia enganosa', () => {
    expect(mascararSegredo('')).toBe('');
    expect(mascararSegredo(null)).toBe('');
    expect(mascararSegredo(undefined)).toBe('');
  });
});
