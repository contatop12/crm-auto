import { describe, test, expect } from 'vitest';
import {
  DIAS_PADRAO, ehRetorno, voltaDoTitulo, voltaDoNome, semVolta, comVolta, protocoloDoCiclo,
} from '../../src/domain/retorno';

const DIA = 24 * 3600 * 1000;
const AGORA = Date.UTC(2026, 10, 21, 12);

describe('ehRetorno', () => {
  const base = { etapaFinal: true, anteriorDoLead: AGORA - 20 * DIA, naEtapaDesde: null, agora: AGORA, dias: DIAS_PADRAO };

  test('o padrao e 15 dias', () => {
    expect(DIAS_PADRAO).toBe(15);
  });

  test('14 dias e 23 horas ainda e a mesma conversa', () => {
    expect(ehRetorno({ ...base, anteriorDoLead: AGORA - (14 * DIA + 23 * 3600 * 1000) })).toBe(false);
  });

  test('15 dias cravados ja e retorno', () => {
    expect(ehRetorno({ ...base, anteriorDoLead: AGORA - 15 * DIA })).toBe(true);
  });

  test('card fora de etapa final nunca e retorno', () => {
    expect(ehRetorno({ ...base, etapaFinal: false })).toBe(false);
  });

  test('sem mensagem anterior do lead vale a entrada na etapa', () => {
    expect(ehRetorno({ ...base, anteriorDoLead: null, naEtapaDesde: AGORA - 16 * DIA })).toBe(true);
    expect(ehRetorno({ ...base, anteriorDoLead: null, naEtapaDesde: AGORA - 3 * DIA })).toBe(false);
  });

  test('sem nenhuma das duas datas nao ha retorno', () => {
    expect(ehRetorno({ ...base, anteriorDoLead: null, naEtapaDesde: null })).toBe(false);
  });
});

describe('voltaDoTitulo', () => {
  test('"Conversa #1240" sozinho e o numero da conversa, nao uma volta', () => {
    expect(voltaDoTitulo('Conversa #1240')).toBe(0);
    expect(voltaDoTitulo('#1240')).toBe(0);
  });

  test('le o sufixo depois do "#<conversa> - "', () => {
    expect(voltaDoTitulo('#1240 - 5511999990000 - Vital #2')).toBe(2);
    expect(voltaDoTitulo('#1240 - 5511999990000 #1')).toBe(1);
  });

  test('sem sufixo ou sem titulo e 0', () => {
    expect(voltaDoTitulo('#1240 - 5511999990000 - Vital')).toBe(0);
    expect(voltaDoTitulo(null)).toBe(0);
    expect(voltaDoTitulo(undefined)).toBe(0);
  });
});

describe('voltaDoNome', () => {
  test('le o sufixo do nome do lead', () => {
    expect(voltaDoNome('Vital #2')).toBe(2);
    expect(voltaDoNome('Vital')).toBe(0);
    expect(voltaDoNome(null)).toBe(0);
  });
});

describe('semVolta e comVolta', () => {
  test('semVolta tira so o sufixo do fim', () => {
    expect(semVolta('Vital #2')).toBe('Vital');
    expect(semVolta('Vital')).toBe('Vital');
  });

  test('comVolta troca o sufixo', () => {
    expect(comVolta('#1240 - 5511999990000 - Vital #1', 2)).toBe('#1240 - 5511999990000 - Vital #2');
    expect(comVolta('Vital', 1)).toBe('Vital #1');
  });
});

describe('protocoloDoCiclo', () => {
  test('raiz ja com -R<k> perde o sufixo antes', () => {
    expect(protocoloDoCiclo('VITA-1720000000000-A1B2C3-R1', 2)).toBe('VITA-1720000000000-A1B2C3-R2');
  });

  test('raiz sem sufixo ganha o -R<n>', () => {
    expect(protocoloDoCiclo('VITA-1720000000000-A1B2C3', 1)).toBe('VITA-1720000000000-A1B2C3-R1');
  });
});
