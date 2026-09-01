import { describe, test, expect } from 'vitest';
import { avaliarEtapa } from '../../src/domain/fluxo';

const base = {
  total24h: 0,
  total7d: 0,
  ultimoEm: null,
  ultimoErroEm: null,
  ultimoErroMotivo: null,
  pendencia: null,
  implementado: true,
};

describe('avaliarEtapa', () => {
  test('etapa sem configuração aparece como pendente, não como erro', () => {
    const r = avaliarEtapa({ ...base, pendencia: 'falta o codi_id do Pulseboard' });
    expect(r.estado).toBe('pendente');
    expect(r.detalhe).toContain('codi_id');
  });

  test('a pendência de configuração vem antes de qualquer outra coisa', () => {
    // sem configurar, o erro é consequência: mostrar o erro esconderia a causa
    const r = avaliarEtapa({
      ...base,
      pendencia: 'falta o codi_id',
      ultimoErroEm: '2026-09-01 00:00:00',
      ultimoErroMotivo: 'estourou',
    });
    expect(r.estado).toBe('pendente');
  });

  test('erro recente marca a etapa como erro', () => {
    const r = avaliarEtapa({
      ...base,
      total7d: 5,
      ultimoEm: '2026-09-01 00:59:00',
      ultimoErroEm: '2026-09-01 01:00:00',
      ultimoErroMotivo: 'Pulseboard respondeu 500',
    });
    expect(r.estado).toBe('erro');
    expect(r.detalhe).toContain('Pulseboard respondeu 500');
  });

  test('atividade sem erro fica ok', () => {
    const r = avaliarEtapa({ ...base, total24h: 12, total7d: 40, ultimoEm: '2026-09-01 01:00:00' });
    expect(r.estado).toBe('ok');
    expect(r.detalhe).toContain('12');
  });

  test('configurado mas nunca aconteceu fica aguardando', () => {
    const r = avaliarEtapa(base);
    expect(r.estado).toBe('aguardando');
    expect(r.detalhe).toContain('nada chegou');
  });

  test('etapa ainda não implementada diz isso, sem fingir que está ok', () => {
    const r = avaliarEtapa({ ...base, implementado: false, total7d: 9 });
    expect(r.estado).toBe('pendente');
    expect(r.detalhe).toContain('ainda não');
  });

  test('erro antigo com atividade nova recente não mantém a etapa em erro', () => {
    const r = avaliarEtapa({
      ...base,
      total24h: 3,
      total7d: 20,
      ultimoEm: '2026-09-01 01:00:00',
      ultimoErroEm: '2026-08-20 00:00:00',
      ultimoErroMotivo: 'erro antigo',
    });
    expect(r.estado).toBe('ok');
  });

  test('teve movimento na semana mas nada em 24h ainda é ok', () => {
    const r = avaliarEtapa({ ...base, total24h: 0, total7d: 8, ultimoEm: '2026-08-30 10:00:00' });
    expect(r.estado).toBe('ok');
  });
});
