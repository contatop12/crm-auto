import { describe, test, expect } from 'vitest';
import { etapasDoPendente, vaiParaPendente, ehPendente } from '../../src/domain/pendente';

const H = 3600 * 1000;
const AGORA = Date.parse('2026-10-28T15:00:00Z');

describe('etapasDoPendente', () => {
  test('acha as duas colunas da Locadora pelo nome', () => {
    const steps = [
      { id: 37, name: 'Qualificando' }, { id: 38, name: 'Proposta Enviada' },
      { id: 75, name: 'Pendente' }, { id: 40, name: 'Oportunidade Perdida' },
    ];
    expect(etapasDoPendente(steps)).toEqual({ proposta: 38, pendente: 75 });
  });

  test('funil sem "Pendente" nao usa a regra', () => {
    expect(etapasDoPendente([{ id: 52, name: 'Proposta Enviada' }, { id: 53, name: 'Negociação' }])).toBeNull();
  });

  test('nome com acento, caixa e espaco sobrando ainda casa', () => {
    expect(ehPendente(' PENDENTE ')).toBe(true);
    expect(etapasDoPendente([{ id: 1, name: 'proposta  enviada ' }, { id: 2, name: 'Pendente' }]))
      .toEqual({ proposta: 1, pendente: 2 });
  });
});

describe('vaiParaPendente', () => {
  test('3 dias na etapa e 3 dias sem o lead falar: vai', () => {
    expect(vaiParaPendente({ naEtapaDesde: AGORA - 80 * H, ultimaDoLead: AGORA - 80 * H, agora: AGORA })).toBe(true);
  });

  test('lead nunca mandou mensagem: vai', () => {
    expect(vaiParaPendente({ naEtapaDesde: AGORA - 80 * H, ultimaDoLead: null, agora: AGORA })).toBe(true);
  });

  test('lead falou ontem: fica (o Araujo da Locadora)', () => {
    expect(vaiParaPendente({ naEtapaDesde: AGORA - 33 * 24 * H, ultimaDoLead: AGORA - 43 * H, agora: AGORA })).toBe(false);
  });

  test('proposta enviada ontem: fica, mesmo com o lead calado ha mais tempo', () => {
    // ainda nao teve 3 dias para responder a proposta
    expect(vaiParaPendente({ naEtapaDesde: AGORA - 24 * H, ultimaDoLead: AGORA - 5 * 24 * H, agora: AGORA })).toBe(false);
  });

  test('sem data da etapa: fica', () => {
    expect(vaiParaPendente({ naEtapaDesde: Number.NaN, ultimaDoLead: null, agora: AGORA })).toBe(false);
  });
});
