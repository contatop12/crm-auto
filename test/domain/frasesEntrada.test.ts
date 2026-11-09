import { describe, test, expect } from 'vitest';
import {
  FRASE_PADRAO_GOOGLE,
  casarFraseDeEntrada,
  fraseRepetida,
  protocoloDaFrase,
  validarFraseDeEntrada,
  type FraseEntrada,
} from '../../src/domain/frasesEntrada';

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

describe('frase padrao do Google', () => {
  test('a mensagem inicial da extensao casa, completada ou sem acento', () => {
    const padrao: FraseEntrada[] = [{ frase: FRASE_PADRAO_GOOGLE, origem: 'mensagem', plataforma: 'google' }];
    expect(casarFraseDeEntrada('Olá, vim pelo anúncio do Google!', padrao)).toEqual({ origem: 'mensagem', plataforma: 'google' });
    expect(casarFraseDeEntrada('ola vim pelo anuncio do google, tem disponivel?', padrao)).toBeTruthy();
    expect(casarFraseDeEntrada('vim pelo google', padrao)).toBeNull();
  });
});

describe('validarFraseDeEntrada', () => {
  test('aceita frase do Google e da Meta', () => {
    expect(validarFraseDeEntrada(FRASE_PADRAO_GOOGLE, 'google')).toBeNull();
    expect(validarFraseDeEntrada('MA21RMKT', 'meta')).toBeNull();
  });

  test('recusa vazia, curta demais e plataforma desconhecida', () => {
    expect(validarFraseDeEntrada('  ', 'google')).toMatch(/cole/);
    expect(validarFraseDeEntrada('oi!', 'google')).toMatch(/curta/);
    expect(validarFraseDeEntrada(FRASE_PADRAO_GOOGLE, 'tiktok')).toMatch(/Google Ads ou Meta Ads/);
  });

  test('repetida ignora acento, caixa e espaco', () => {
    const atuais = [{ frase: FRASE_PADRAO_GOOGLE }];
    expect(fraseRepetida('ola,  vim pelo ANUNCIO do google!', atuais)).toBe(true);
    expect(fraseRepetida('Olá, vim pelo anúncio do Google! Quero orçamento', atuais)).toBe(false);
  });
});

describe('pontuacao nao separa a frase', () => {
  test('lead que apaga o ponto de exclamacao ou a virgula ainda casa', () => {
    const padrao: FraseEntrada[] = [{ frase: 'Olá, vim pelo anúncio do Google!', origem: 'mensagem', plataforma: 'google' }];
    expect(casarFraseDeEntrada('Olá vim pelo anúncio do Google e queria saber o preço', padrao)).toBeTruthy();
    expect(casarFraseDeEntrada('Olá, vim pelo anúncio do Google. Atendem sábado?', padrao)).toBeTruthy();
    expect(casarFraseDeEntrada('Olá, vim pelo anúncio', padrao)).toBeNull();
  });
});
