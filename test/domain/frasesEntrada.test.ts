import { describe, test, expect } from 'vitest';
import { casarFraseDeEntrada, protocoloDaFrase, type FraseEntrada } from '../../src/domain/frasesEntrada';

const VITA: FraseEntrada[] = [
  {
    frase: 'Olá! Vim pelo google e gostaria de agendar uma avaliação auditiva.',
    origem: 'mensagem',
    plataforma: 'google',
  },
];

describe('casarFraseDeEntrada', () => {
  test('a frase exata do anuncio casa', () => {
    const r = casarFraseDeEntrada('Olá! Vim pelo google e gostaria de agendar uma avaliação auditiva.', VITA);
    expect(r).toEqual({ origem: 'mensagem', plataforma: 'google' });
  });

  test('acento, caixa e emoji nao atrapalham', () => {
    // o WhatsApp entrega o texto com variacoes; comparar cru perderia o lead
    expect(casarFraseDeEntrada('OLA! VIM PELO GOOGLE E GOSTARIA DE AGENDAR UMA AVALIACAO AUDITIVA.', VITA)).toBeTruthy();
    expect(casarFraseDeEntrada('👋 Olá! Vim pelo google e gostaria de agendar uma avaliação auditiva.', VITA)).toBeTruthy();
  });

  test('a frase dentro de um texto maior tambem casa', () => {
    // o lead costuma completar o texto pronto antes de enviar
    const r = casarFraseDeEntrada(
      'Olá! Vim pelo google e gostaria de agendar uma avaliação auditiva. Pode ser quinta?',
      VITA,
    );
    expect(r).toBeTruthy();
  });

  test('espaco a mais no meio nao quebra', () => {
    expect(casarFraseDeEntrada('Olá!  Vim pelo google  e gostaria de agendar uma avaliação auditiva.', VITA)).toBeTruthy();
  });

  test('mensagem qualquer nao casa', () => {
    expect(casarFraseDeEntrada('oi, quanto custa?', VITA)).toBeNull();
    expect(casarFraseDeEntrada('gostaria de agendar', VITA)).toBeNull();
    expect(casarFraseDeEntrada('', VITA)).toBeNull();
  });

  test('cliente sem frase cadastrada nunca casa', () => {
    expect(casarFraseDeEntrada('Olá! Vim pelo google e gostaria de agendar uma avaliação auditiva.', [])).toBeNull();
  });

  test('a primeira frase que casar vence', () => {
    const duas: FraseEntrada[] = [
      { frase: 'vim pelo google', origem: 'mensagem', plataforma: 'google' },
      { frase: 'vim pelo instagram', origem: 'mensagem', plataforma: 'meta' },
    ];
    expect(casarFraseDeEntrada('Oi, vim pelo instagram', duas)?.plataforma).toBe('meta');
  });
});

describe('protocoloDaFrase', () => {
  test('monta um protocolo estavel para a conversa', () => {
    expect(protocoloDaFrase('VITA', 78)).toBe('VITA-MSG-78');
  });

  test('a mesma conversa da sempre o mesmo protocolo', () => {
    // e' o que impede a segunda mensagem do lead de criar um lead novo
    expect(protocoloDaFrase('VITA', 78)).toBe(protocoloDaFrase('VITA', 78));
  });

  test('nao se confunde com protocolo de clique', () => {
    // clique e' `VITA-<base36>`; este tem o `MSG` no meio de proposito, para
    // ninguem procurar um gclid que nunca existiu
    expect(protocoloDaFrase('VITA', 78)).toContain('-MSG-');
  });

  test('prefixo vazio ainda produz chave utilizavel', () => {
    expect(protocoloDaFrase('', 78)).toBe('MSG-78');
  });
});
