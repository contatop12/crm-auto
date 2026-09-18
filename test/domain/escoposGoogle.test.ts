import { describe, test, expect } from 'vitest';
import { ESCOPOS_GOOGLE, escoposFaltando, escoposPerdidos } from '../../src/domain/escoposGoogle';

const G = 'https://www.googleapis.com/auth/';
const todos = ESCOPOS_GOOGLE.map((e) => e.escopo).join(' ');

describe('ESCOPOS_GOOGLE', () => {
  test('pede planilhas e as duas etapas de publicar no GTM', () => {
    const lista = ESCOPOS_GOOGLE.map((e) => e.escopo);
    expect(lista).toContain(G + 'spreadsheets');
    expect(lista).toContain(G + 'tagmanager.edit.containerversions');
    expect(lista).toContain(G + 'tagmanager.publish');
  });

  test('cada escopo tem um nome que se le', () => {
    for (const e of ESCOPOS_GOOGLE) expect(e.nome.length).toBeGreaterThan(3);
  });
});

describe('escoposFaltando', () => {
  test('nada falta quando tudo foi concedido', () => {
    expect(escoposFaltando(todos)).toEqual([]);
  });

  test('diz pelo nome o que ficou desmarcado', () => {
    const semPlanilha = todos.replace(G + 'spreadsheets', '');
    expect(escoposFaltando(semPlanilha).map((e) => e.escopo)).toEqual([G + 'spreadsheets']);
  });

  test('sem nada concedido, falta tudo', () => {
    expect(escoposFaltando(null)).toHaveLength(ESCOPOS_GOOGLE.length);
  });
});

describe('escoposPerdidos', () => {
  test('token novo com menos permissao que o atual perde alguma coisa', () => {
    const atual = `${G}tagmanager.publish ${G}adwords`;
    const novo = `${G}tagmanager.publish ${G}spreadsheets`;
    expect(escoposPerdidos(atual, novo)).toEqual([G + 'adwords']);
  });

  test('token novo que so acrescenta nao perde nada', () => {
    expect(escoposPerdidos(`${G}adwords`, `${G}adwords ${G}spreadsheets`)).toEqual([]);
  });

  test('sem token atual, nao ha o que perder', () => {
    expect(escoposPerdidos(null, `${G}adwords`)).toEqual([]);
  });
});
