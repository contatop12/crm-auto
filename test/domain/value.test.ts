import { describe, test, expect } from 'vitest';
import { parseBR, extractValue } from '../../src/domain/value';
import type { ValuePattern } from '../../src/domain/types';

// Os padroes ficam como literais de regex e viram string via `.source`.
// Cadastrar como string escapada aqui e' pedir para perder uma barra invertida.
const padroes: ValuePattern[] = [
  {
    posicao: 1,
    regex:
      /(?:compra|venda)\s*(?:fechad[oa]|confirmad[oa]|aprovad[oa])?[^\d]{0,40}R?\$?\s*([\d][\d.,]*)/
        .source,
    valorMinimo: 50,
  },
  {
    posicao: 2,
    regex: /(?:fechad[oa]|fechamos|aprovad[oa])[^\d]{0,40}R?\$?\s*([\d][\d.,]*)/.source,
    valorMinimo: 50,
  },
  {
    posicao: 3,
    regex: /valor\s*(?:total|final)?[^\d]{0,20}R?\$?\s*([\d][\d.,]*)/.source,
    valorMinimo: 50,
  },
];

describe('parseBR', () => {
  test('entende milhar com ponto e centavo com virgula', () => {
    expect(parseBR('3.500,00')).toBe(3500);
    expect(parseBR('1.234.567,89')).toBe(1234567.89);
  });

  test('entende ponto como separador de milhar sem centavos', () => {
    expect(parseBR('1.200')).toBe(1200);
  });

  test('entende numero simples', () => {
    expect(parseBR('1200')).toBe(1200);
  });

  test('entende virgula como decimal', () => {
    expect(parseBR('1,50')).toBe(1.5);
  });

  test('devolve 0 para entrada invalida', () => {
    expect(parseBR('')).toBe(0);
    expect(parseBR('abc')).toBe(0);
    expect(parseBR(null)).toBe(0);
  });
});

describe('extractValue', () => {
  test('acha o valor da compra fechada', () => {
    expect(extractValue('Compra fechada no valor de R$ 3.500,00', padroes)).toBe(3500);
  });

  test('acha o valor na variacao informal', () => {
    expect(extractValue('Fechamos! Valor total R$ 1.200', padroes)).toBe(1200);
  });

  test('ignora numero abaixo do minimo', () => {
    // "entrego em 10 dias" nao pode virar uma compra de R$ 10
    expect(extractValue('valor combinado: 10', padroes)).toBe(0);
  });

  test('devolve 0 quando nenhum padrao casa', () => {
    expect(extractValue('Bom dia, tudo certo?', padroes)).toBe(0);
    expect(extractValue('', padroes)).toBe(0);
  });

  test('respeita a ordem dos padroes', () => {
    const texto = 'Compra fechada R$ 3.500,00 — valor da entrada R$ 500';
    expect(extractValue(texto, padroes)).toBe(3500);
  });

  test('regex invalida cadastrada no painel nao derruba o pipeline', () => {
    const ruim: ValuePattern[] = [{ posicao: 1, regex: '([', valorMinimo: 50 }, ...padroes];
    expect(extractValue('Compra fechada R$ 900', ruim)).toBe(900);
  });
});
