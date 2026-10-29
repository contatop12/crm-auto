import { describe, test, expect } from 'vitest';
import {
  casarRespostaAutomatica,
  validarRespostaAutomatica,
} from '../../src/domain/respostasAutomaticas';

const LOCADORA = [
  { frase: 'Seja muito bem-vindo(a) à Locadora Exatidão' },
  { frase: 'Vi que você se cadastrou em nosso site em busca de' },
];

describe('casarRespostaAutomatica', () => {
  test('devolve o trecho cadastrado que casou', () => {
    // o historico aponta qual trecho segurou o card, escrito como no cadastro
    expect(casarRespostaAutomatica(
      'Olá! SEJA MUITO BEM-VINDO(A) A LOCADORA EXATIDAO 🤝',
      LOCADORA,
    )).toBe('Seja muito bem-vindo(a) à Locadora Exatidão');
  });

  test('o nome do lead no meio do texto nao atrapalha', () => {
    expect(casarRespostaAutomatica(
      'Olá, Everton! Vi que você se cadastrou em nosso  site em busca de *Andaimes*',
      LOCADORA,
    )).toBe('Vi que você se cadastrou em nosso site em busca de');
  });

  test('resposta de gente nao casa', () => {
    expect(casarRespostaAutomatica('Bom dia! O andaime sai por R$ 120 a semana.', LOCADORA)).toBeNull();
    expect(casarRespostaAutomatica('', LOCADORA)).toBeNull();
  });

  test('cliente sem trecho cadastrado: nada e automatico', () => {
    expect(casarRespostaAutomatica('Seja muito bem-vindo(a) à Locadora Exatidão', [])).toBeNull();
  });

  test('trecho longo colado sem o negrito do WhatsApp ainda casa', () => {
    // a mensagem chega com *...*; copiada do Chatwoot ou do WhatsApp, vem sem
    const chegou = 'Olá, Everton! Tudo bem?\n\nAqui é a Vania da Locadora Exatidão. Vi que você se '
      + 'cadastrou em nosso site em busca de *Locação de Andaimes* e já quero agilizar o seu _orçamento_!';
    const colado = 'Aqui é a Vania da Locadora Exatidão. Vi que você se cadastrou em nosso site '
      + 'em busca de Locação de Andaimes e já quero agilizar o seu orçamento!';
    expect(casarRespostaAutomatica(chegou, [{ frase: colado }])).toBe(colado);
  });

  test('trecho colado com o negrito tambem casa a mensagem sem ele', () => {
    expect(casarRespostaAutomatica(
      'Nosso atendimento acontece de segunda a sexta, das 7h30 às 17h30.',
      [{ frase: 'Nosso atendimento acontece de *segunda a sexta*' }],
    )).toBe('Nosso atendimento acontece de *segunda a sexta*');
  });
});

describe('validarRespostaAutomatica', () => {
  test('trecho vazio e recusado', () => {
    expect(validarRespostaAutomatica('')).toMatch(/cole um trecho/);
    expect(validarRespostaAutomatica('   🤝  ')).toMatch(/cole um trecho/);
  });

  test('trecho generico e recusado: seguraria o atendente junto', () => {
    expect(validarRespostaAutomatica('Olá, tudo bem?')).toMatch(/curto demais/);
  });

  test('trecho proprio da automacao passa', () => {
    expect(validarRespostaAutomatica('Seja muito bem-vindo(a) à Locadora Exatidão')).toBeNull();
  });
});
