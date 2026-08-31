import { describe, test, expect } from 'vitest';
import { limpa } from '../../src/domain/text';

describe('limpa — normalizacao para casar frase-gatilho', () => {
  test('remove acentos', () => {
    expect(limpa('Negociação')).toBe('negociacao');
    expect(limpa('Compareceu à Consulta')).toBe('compareceu a consulta');
  });

  test('remove emoji', () => {
    expect(limpa('fechado ✅')).toBe('fechado');
    expect(limpa('🚫 desqualificado')).toBe('desqualificado');
  });

  test('coloca em minuscula', () => {
    expect(limpa('VISITA AGENDADA')).toBe('visita agendada');
  });

  test('colapsa espacos e apara as pontas', () => {
    expect(limpa('  visita    agendada  ')).toBe('visita agendada');
    expect(limpa('visita\n\tagendada')).toBe('visita agendada');
  });

  test('a frase da planilha casa com o que o vendedor digitou', () => {
    const digitado = 'Segue orçamento com as MEDIDAS TÉCNICAS 📐';
    const gatilho = 'segue orcamento com as medidas tecnicas';
    expect(limpa(digitado)).toContain(limpa(gatilho));
  });

  test('devolve vazio para entrada vazia', () => {
    expect(limpa('')).toBe('');
    expect(limpa(null)).toBe('');
    expect(limpa(undefined)).toBe('');
  });

  test('mensagem so com emoji vira vazio', () => {
    // usado para descartar "mensagem sem texto" como resposta do vendedor
    expect(limpa('👍')).toBe('');
  });
});
