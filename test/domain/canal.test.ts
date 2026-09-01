import { describe, test, expect } from 'vitest';
import { montarCanal } from '../../src/domain/canal';

describe('montarCanal', () => {
  test('clique no anuncio do Google', () => {
    expect(montarCanal({ origem: 'mensagem', plataforma: 'google' })).toBe(
      'Campanha de Mensagem - Google',
    );
  });

  test('formulario na Meta', () => {
    expect(montarCanal({ origem: 'formulario', plataforma: 'meta' })).toBe(
      'Campanha de Formulário - Meta',
    );
  });

  test('quiz vence formulario no rotulo', () => {
    // o quiz E um formulario, mas o cliente reconhece pelo nome "Quiz"
    expect(montarCanal({ origem: 'formulario', plataforma: 'google', quizVersion: 'v2' })).toBe(
      'Campanha de Quiz - Google',
    );
  });

  test('plataforma desconhecida vira Direto', () => {
    expect(montarCanal({ origem: 'mensagem', plataforma: 'outro' })).toBe(
      'Campanha de Mensagem - Direto',
    );
  });

  test('quiz na Meta', () => {
    expect(montarCanal({ origem: 'formulario', plataforma: 'meta', quizVersion: 'v1' })).toBe(
      'Campanha de Quiz - Meta',
    );
  });

  test('sem nada identificado ainda produz um rotulo legivel', () => {
    expect(montarCanal({})).toBe('Campanha de Mensagem - Direto');
  });
});
