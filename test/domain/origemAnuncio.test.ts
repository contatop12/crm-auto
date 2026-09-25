import { describe, test, expect } from 'vitest';
import { origemDoAnuncio, codigoDePlataforma } from '../../src/domain/origemAnuncio';

describe('origemDoAnuncio', () => {
  test('click id do Google vale mais que qualquer referrer', () => {
    expect(origemDoAnuncio({ gclid: 'Cj0', referrer: 'https://m.facebook.com/' })).toBe('google');
    expect(origemDoAnuncio({ gbraid: '0AAA' })).toBe('google');
    expect(origemDoAnuncio({ utm_source: 'google_ads' })).toBe('google');
  });

  test('rede da Meta pela utm_source ou pelo cookie', () => {
    expect(origemDoAnuncio({ utm_source: 'instagram' })).toBe('instagram');
    expect(origemDoAnuncio({ utm_source: 'facebook' })).toBe('facebook');
    expect(origemDoAnuncio({ fbc: 'fb.1.123' })).toBe('facebook');
    // campanha de mensagem sem o link do anuncio: sabe-se que e' Meta, nao a rede
    expect(origemDoAnuncio({ utm_source: 'meta' })).toBe('meta');
  });

  test('ChatGPT e uma origem propria', () => {
    expect(origemDoAnuncio({ utm_source: 'chatgpt.com' })).toBe('gpt');
    expect(origemDoAnuncio({ referrer: 'https://chatgpt.com/' })).toBe('gpt');
  });

  test('utm de outra plataforma e outro; referrer externo tambem', () => {
    expect(origemDoAnuncio({ utm_source: 'bing' })).toBe('outro');
    expect(origemDoAnuncio({ referrer: 'https://www.bing.com/' })).toBe('outro');
  });

  test('so o referrer do Google: veio do Google, mesmo sem anuncio', () => {
    expect(origemDoAnuncio({ referrer: 'https://www.google.com/' })).toBe('google');
  });

  test('sem sinal, ou so navegacao no proprio site, fica vazio', () => {
    expect(origemDoAnuncio({})).toBe('');
    expect(origemDoAnuncio({ referrer: 'https://audicao.vitaaudio.com.br/aparelho-auditivo' })).toBe('');
  });
});

describe('codigoDePlataforma', () => {
  test('codigos que os fluxos de formulario escrevem', () => {
    expect(codigoDePlataforma('ig')).toBe('instagram');
    expect(codigoDePlataforma('fb')).toBe('facebook');
    expect(codigoDePlataforma('Google')).toBe('google');
    expect(codigoDePlataforma('chatgpt.com')).toBe('gpt');
  });

  test('rotulo composto do fluxo antigo nao conta', () => {
    expect(codigoDePlataforma('Campanha de Mensagem - Google')).toBe('');
    expect(codigoDePlataforma('Formulário do site')).toBe('');
    expect(codigoDePlataforma('')).toBe('');
  });
});
