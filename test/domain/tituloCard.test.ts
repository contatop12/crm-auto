import { describe, test, expect } from 'vitest';
import { tituloComTelefone } from '../../src/domain/tituloCard';
import { conversaCitada } from '../../src/domain/orfaos';

describe('tituloComTelefone', () => {
  test('troca o nome do perfil pelo telefone', () => {
    expect(tituloComTelefone('Conversa #1240 - Vital', '+5511932346062')).toBe('Conversa #1240 - 5511932346062');
  });

  test('nome com hifen e espaco some inteiro', () => {
    expect(tituloComTelefone('Conversa #1242 - José Rubens Vital de oliv', '+5511987654321'))
      .toBe('Conversa #1242 - 5511987654321');
    expect(tituloComTelefone('Conversa #12 - GALERA 3D Mk6- Renda Extra (GROUP)', '+5511987654321'))
      .toBe('Conversa #12 - 5511987654321');
  });

  test('ja com o telefone: nada a trocar', () => {
    expect(tituloComTelefone('Conversa #828 - 5511963925521', '+5511963925521')).toBeNull();
  });

  test('telefone antigo no titulo e outro no contato: vale o do contato', () => {
    expect(tituloComTelefone('Conversa #4 - 5511932347701', '+5511932340000')).toBe('Conversa #4 - 5511932340000');
  });

  test('sem telefone (grupo, Instagram): o nome fica', () => {
    expect(tituloComTelefone('Conversa #12 - GALERA 3D (GROUP)', null)).toBeNull();
    expect(tituloComTelefone('Conversa #12 - Fulano', '')).toBeNull();
    expect(tituloComTelefone('Conversa #12 - Fulano', '123')).toBeNull();
  });

  test('card criado a mao nao e mexido', () => {
    expect(tituloComTelefone('Orcamento andaime obra Moema', '+5511987654321')).toBeNull();
    expect(tituloComTelefone('', '+5511987654321')).toBeNull();
    expect(tituloComTelefone(null, '+5511987654321')).toBeNull();
  });

  test('o card orfao continua achando a conversa pelo titulo novo', () => {
    const novo = tituloComTelefone('Conversa #28 - Carol Nunes', '+5511915714026');
    expect(conversaCitada(novo)).toBe(28);
  });
});
