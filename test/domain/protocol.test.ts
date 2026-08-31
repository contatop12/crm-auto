import { describe, test, expect } from 'vitest';
import { findProtocol } from '../../src/domain/protocol';

describe('findProtocol', () => {
  test('acha protocolo de 3 partes sem truncar no segundo hifen', () => {
    // bug real: a regex antiga parava no 2o hifen e devolvia "QUIZPE-MTABXPVQH7MV"
    // pela metade, que nunca casava com a coluna protocol da planilha
    expect(findProtocol('Ola, [Protocolo: VITA-1720000000000-A1B2C3]')).toBe(
      'VITA-1720000000000-A1B2C3',
    );
  });

  test('aceita o rotulo Ref', () => {
    expect(findProtocol('Ref: QUIZPE-MTABXPVQH7MV')).toBe('QUIZPE-MTABXPVQH7MV');
  });

  test('acha o formato canonico mesmo sem rotulo', () => {
    expect(findProtocol('oi tudo bem VITA-1720000000000-A1B2C3 obrigado')).toBe(
      'VITA-1720000000000-A1B2C3',
    );
  });

  test('devolve em caixa alta', () => {
    expect(findProtocol('protocolo: vita-1720000000000-a1b2c3')).toBe(
      'VITA-1720000000000-A1B2C3',
    );
  });

  test('ignora CPF, CEP e telefone', () => {
    expect(findProtocol('meu cpf e 123.456.789-00 e o cep 01310-100')).toBe('');
    expect(findProtocol('me liga no 11 99631-6799')).toBe('');
  });

  test('devolve vazio quando nao ha protocolo', () => {
    expect(findProtocol('Boa tarde')).toBe('');
    expect(findProtocol('')).toBe('');
    expect(findProtocol(null)).toBe('');
  });

  test('exige letra e numero no codigo legado', () => {
    // formato legado PREFIXO-CODIGO so vale se o codigo misturar letra e numero
    expect(findProtocol('pedido ABC-1234567890AB')).toBe('ABC-1234567890AB');
    expect(findProtocol('pedido ABC-ABCDEFGHIJKL')).toBe('');
  });
});
