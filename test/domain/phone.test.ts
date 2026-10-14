import { describe, test, expect } from 'vitest';
import { normFone, phoneKey } from '../../src/domain/phone';

describe('normFone — telefone em E.164', () => {
  test('mantem numero que ja veio completo do WhatsApp', () => {
    expect(normFone('+5511996316799')).toBe('+5511996316799');
  });

  test('repoe o nono digito em celular que veio com 10 digitos', () => {
    // 4788903080 -> DDD 47, celular comecando em 8 -> ganha o 9
    expect(normFone('4788903080')).toBe('+5547988903080');
  });

  test('nao inventa nono digito em telefone fixo', () => {
    // 3o digito 3 nao e' de celular; fixo continua com 10 digitos
    expect(normFone('1132234455')).toBe('+551132234455');
  });

  test('extrai o numero do JID do WhatsApp', () => {
    expect(normFone('5511996316799@s.whatsapp.net')).toBe('+5511996316799');
  });

  test('devolve vazio para entrada curta demais', () => {
    expect(normFone('123')).toBe('');
  });

  test('devolve vazio para entrada vazia', () => {
    expect(normFone('')).toBe('');
    expect(normFone(null)).toBe('');
    expect(normFone(undefined)).toBe('');
  });
});

describe('phoneKey — DDD + ultimos 8 digitos', () => {
  test('o mesmo assinante casa com e sem o nono digito', () => {
    // este e' o bug real: o quiz gravou "11915714026" e o JID trouxe "1115714026"
    expect(phoneKey('11915714026')).toBe(phoneKey('1115714026'));
  });

  test('ignora o DDI 55', () => {
    expect(phoneKey('+5511996316799')).toBe(phoneKey('11996316799'));
  });

  test('devolve DDD seguido dos ultimos 8 digitos', () => {
    expect(phoneKey('4788903080')).toBe('4788903080');
    expect(phoneKey('+5511996316799')).toBe('1196316799');
  });

  test('numeros de assinantes diferentes nao colidem', () => {
    expect(phoneKey('11915714026')).not.toBe(phoneKey('11996316799'));
  });

  test('devolve vazio quando nao da para formar a chave', () => {
    expect(phoneKey('123')).toBe('');
    expect(phoneKey('')).toBe('');
  });

  test('link wa.me com texto: o numero e o do link, nao os digitos da mensagem', () => {
    // TELEFONE do quiz da Persianas: as medidas do texto (290, 200, 3%) entravam na chave
    const link =
      'https://wa.me/5511915022887?text=Ol%C3%A1%2C%20somos%20da%20Persianas%20Paulista!%0A' +
      'Tecido%3A%20Tela%20Solar%203%25%0ALarg%3A%20290%0AAltura%3A%20200';
    expect(phoneKey(link)).toBe(phoneKey('+5511915022887'));
  });

  test('link wa.me com + e link api.whatsapp.com com phone=', () => {
    expect(phoneKey('https://wa.me/+5511983693558')).toBe(phoneKey('11983693558'));
    expect(phoneKey('https://api.whatsapp.com/send?phone=5511963755843&text=Larg%20527')).toBe(
      phoneKey('11963755843'),
    );
  });
});

describe('normFone — link do WhatsApp', () => {
  test('tira o numero do link, ignorando o texto da mensagem', () => {
    expect(normFone('https://wa.me/5511915022887?text=Larg%3A%20290%0AAltura%3A%20200')).toBe('+5511915022887');
  });
});
