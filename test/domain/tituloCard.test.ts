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

  test('celular sem o nono digito ganha o 9: o card nao fica trocando de numero', () => {
    // card 3849 da Taina: a resposta do vendedor regrava o contato com o JID
    // sem o 9 (+551186571182) e a mensagem seguinte do lead traz o 9 de volta
    expect(tituloDoCard('Conversa #946 - Quezia', '+551186571182', 'Quezia')).toBe('#946 - 5511986571182 - Quezia');
    expect(tituloDoCard('#946 - 5511986571182 - Quezia', '+551186571182', 'Quezia')).toBeNull();
    expect(tituloDoCard('#946 - 551186571182 - Quezia', '+5511986571182', 'Quezia')).toBe('#946 - 5511986571182 - Quezia');
  });

  test('fixo e numero de fora ficam como vieram', () => {
    expect(tituloDoCard('Conversa #20 - Loja', '+551149480466', 'Loja')).toBe('#20 - 551149480466 - Loja');
    expect(tituloDoCard('Conversa #7 - John', '+14155552671', 'John')).toBe('#7 - 14155552671 - John');
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

  // Card de uma volta: a volta vem de `retornos` (quarto argumento), nao do texto.
  test('o sufixo da volta (#n) fica no fim quando o nome muda', () => {
    expect(tituloDoCard('#1240 - 5511999990000 - Vital #1', '+5511999990000', 'Vital Novo', 1))
      .toBe('#1240 - 5511999990000 - Vital Novo #1');
  });

  test('titulo da volta ja certo nao troca', () => {
    expect(tituloDoCard('#1240 - 5511999990000 - Vital #1', '+5511999990000', 'Vital', 1)).toBeNull();
  });

  test('volta sem nome no titulo', () => {
    expect(tituloDoCard('#1240 - 5511999990000 #1', '+5511999990000', null, 1)).toBeNull();
  });

  test('Instagram (sem telefone) com sufixo continua null', () => {
    expect(tituloDoCard('#1240 - Vital #1', null, 'Vital', 1)).toBeNull();
  });

  test('nome do contato que ja traz o " #n" nao dobra o sufixo', () => {
    expect(tituloDoCard('#1240 - 5511999990000 - Vital #1', '+5511999990000', 'Vital #1', 1)).toBeNull();
    expect(tituloDoCard('#1240 - 5511999990000 - Antigo #1', '+5511999990000', 'Vital #1', 1))
      .toBe('#1240 - 5511999990000 - Vital #1');
  });

  test('vale a volta dada, nao a que o titulo traz', () => {
    expect(tituloDoCard('#1240 - 5511999990000 - Vital #1', '+5511999990000', 'Vital', 2))
      .toBe('#1240 - 5511999990000 - Vital #2');
  });

  describe(`card comum (volta 0): " #n" no nome e' so' texto, como antes da volta existir`, () => {
    // esperados = o que a funcao de antes da volta (1830c17) devolve
    test('contato "Ana #2" num card ja convertido: o nome entra inteiro', () => {
      expect(tituloDoCard('#28 - 5511999990000 - Ana', '+5511999990000', 'Ana #2'))
        .toBe('#28 - 5511999990000 - Ana #2');
    });

    test('titulo terminado em " #2" e contato com outro nome: o " #2" nao fica', () => {
      expect(tituloDoCard('#28 - 5511999990000 - Ana #2', '+5511999990000', 'Beatriz'))
        .toBe('#28 - 5511999990000 - Beatriz');
    });

    test('card novo do Chatwoot com o contato "Ana #2"', () => {
      expect(tituloDoCard('Conversa #28 - Ana #2', '+5511999990000', 'Ana #2')).toBe('#28 - 5511999990000 - Ana #2');
      expect(tituloDoCard('#28 - 5511999990000 - Ana #2', '+5511999990000', 'Ana #2')).toBeNull();
    });
  });
});
