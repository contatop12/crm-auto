import { describe, test, expect } from 'vitest';
import { normalizarSlug, validarCliente, gerarIngestKey } from '../../src/domain/tenantInput';

describe('normalizarSlug', () => {
  test('tira acento, espaco e caixa', () => {
    expect(normalizarSlug('Locadora Exatidão')).toBe('locadora-exatidao');
  });

  test('colapsa separadores repetidos', () => {
    expect(normalizarSlug('a   b__c')).toBe('a-b-c');
  });

  test('apara hifen das pontas', () => {
    expect(normalizarSlug('  -Persianas-  ')).toBe('persianas');
  });

  test('descarta o que nao serve em URL', () => {
    expect(normalizarSlug('Vita Áudio & Cia!')).toBe('vita-audio-cia');
  });

  test('devolve vazio quando nao sobra nada', () => {
    expect(normalizarSlug('!!!')).toBe('');
  });
});

describe('validarCliente', () => {
  const valido = { nome: 'Persianas Paulista', slug: 'persianas', cw_account_id: 7, cw_board_funil_id: 13 };

  test('aceita o minimo necessario', () => {
    expect(validarCliente(valido).erros).toEqual([]);
  });

  test('exige nome', () => {
    expect(validarCliente({ ...valido, nome: '  ' }).erros).toContain('nome é obrigatório');
  });

  test('exige slug utilizavel', () => {
    expect(validarCliente({ ...valido, slug: '!!!' }).erros[0]).toContain('endereço');
  });

  test('exige a conta do Chatwoot', () => {
    expect(validarCliente({ ...valido, cw_account_id: null }).erros).toContain(
      'conta do Chatwoot é obrigatória',
    );
  });

  test('exige o board do funil, que e o gatilho do aviso no grupo', () => {
    expect(validarCliente({ ...valido, cw_board_funil_id: null }).erros).toContain(
      'board do funil de Ads é obrigatório',
    );
  });

  test('recusa board do funil igual ao de entrada', () => {
    const r = validarCliente({ ...valido, cw_board_organico_id: 13 });
    expect(r.erros[0]).toContain('mesmo board');
  });

  test('devolve o slug normalizado junto', () => {
    expect(validarCliente({ ...valido, slug: 'Persianas Paulista' }).slug).toBe('persianas-paulista');
  });

  test('junta varios erros de uma vez', () => {
    expect(validarCliente({}).erros.length).toBeGreaterThan(2);
  });
});

describe('gerarIngestKey', () => {
  test('gera chave longa o bastante para nao ser adivinhada', () => {
    expect(gerarIngestKey().length).toBeGreaterThanOrEqual(24);
  });

  test('cada chamada gera uma chave diferente', () => {
    expect(gerarIngestKey()).not.toBe(gerarIngestKey());
  });

  test('usa so caracteres seguros em URL', () => {
    expect(gerarIngestKey()).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
