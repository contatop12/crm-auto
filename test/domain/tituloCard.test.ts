import { describe, test, expect } from 'vitest';
import { tituloDoCard } from '../../src/domain/tituloCard';
import { conversaCitada } from '../../src/domain/orfaos';

const FONE = '+5511932346062';

describe('tituloDoCard', () => {
  test('numero da conversa, telefone e nome, sem "Conversa"', () => {
    expect(tituloDoCard('Conversa #1240 - Vital', FONE, 'Vital')).toBe('#1240 - 5511932346062 - Vital');
  });

  test('o card ja com telefone (regra anterior) ganha o nome e perde o "Conversa"', () => {
    expect(tituloDoCard('Conversa #1293 - 5511932346062', FONE, 'Noilson')).toBe('#1293 - 5511932346062 - Noilson');
  });

  test('vale o nome de hoje do contato, nao o do dia em que o card nasceu', () => {
    // card da Locadora: nasceu com o telefone, o contato hoje chama "Meire"
    expect(tituloDoCard('Conversa #4 - 5511932347701', '+5511932347701', 'Meire'))
      .toBe('#4 - 5511932347701 - Meire');
  });

  test('ja no formato: nada a trocar', () => {
    expect(tituloDoCard('#1240 - 5511932346062 - Vital', FONE, 'Vital')).toBeNull();
  });

  test('nome que nao identifica (*~, emoji, o telefone) fica de fora', () => {
    expect(tituloDoCard('Conversa #215 - *~', FONE, '*~')).toBe('#215 - 5511932346062');
    expect(tituloDoCard('Conversa #215 - 😊', FONE, '😊')).toBe('#215 - 5511932346062');
    expect(tituloDoCard('Conversa #828 - 5511932346062', FONE, '5511932346062')).toBe('#828 - 5511932346062');
  });

  test('webhook sem nome: aproveita o que o titulo ja tinha', () => {
    expect(tituloDoCard('Conversa #1240 - Vital', FONE, null)).toBe('#1240 - 5511932346062 - Vital');
    expect(tituloDoCard('#1240 - 5511932346062 - Vital', FONE, null)).toBeNull();
  });

  test('nome com hifen fica inteiro', () => {
    expect(tituloDoCard('Conversa #12 - Ana - Moema', FONE, 'Ana - Moema')).toBe('#12 - 5511932346062 - Ana - Moema');
  });

  test('sem telefone (grupo, Instagram): o titulo fica', () => {
    expect(tituloDoCard('Conversa #12 - GALERA 3D (GROUP)', null, 'GALERA 3D')).toBeNull();
    expect(tituloDoCard('Conversa #12 - Fulano', '123', 'Fulano')).toBeNull();
  });

  test('card criado a mao nao e mexido', () => {
    expect(tituloDoCard('Orcamento andaime obra Moema', FONE, 'Fulano')).toBeNull();
    expect(tituloDoCard('', FONE, 'Fulano')).toBeNull();
    expect(tituloDoCard(null, FONE, 'Fulano')).toBeNull();
  });

  test('o card orfao continua achando a conversa pelo titulo novo', () => {
    expect(conversaCitada(tituloDoCard('Conversa #28 - Carol Nunes', FONE, 'Carol Nunes'))).toBe(28);
  });
});
