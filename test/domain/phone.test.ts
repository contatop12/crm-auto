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
});
