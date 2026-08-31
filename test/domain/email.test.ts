import { describe, test, expect } from 'vitest';
import { normEmail, isBlocked, findEmail } from '../../src/domain/email';
import type { DenyRule } from '../../src/domain/types';

const deny: DenyRule[] = [
  { tipo: 'dominio', valor: 'persianaspaulista.com.br' },
  { tipo: 'dominio', valor: 'p12digital.com.br' },
  { tipo: 'exato', valor: 'chefe@empresa.com' },
  { tipo: 'regex', valor: '^no-?reply@' },
];

describe('normEmail', () => {
  test('poe em minuscula e apara espaco', () => {
    expect(normEmail('  Joao@Empresa.COM  ')).toBe('joao@empresa.com');
  });

  test('remove ponto e sufixo + em gmail', () => {
    expect(normEmail('jo.ao.silva+promo@gmail.com')).toBe('joaosilva@gmail.com');
  });

  test('trata googlemail como gmail', () => {
    expect(normEmail('joao@googlemail.com')).toBe('joao@gmail.com');
  });

  test('nao mexe em ponto fora do gmail', () => {
    expect(normEmail('jo.ao@outlook.com')).toBe('jo.ao@outlook.com');
  });

  test('devolve vazio para endereco invalido', () => {
    expect(normEmail('nao-e-email')).toBe('');
    expect(normEmail('a@b')).toBe('');
    expect(normEmail('')).toBe('');
  });
});

describe('isBlocked', () => {
  test('bloqueia dominio da propria empresa', () => {
    expect(isBlocked('vendas@persianaspaulista.com.br', deny)).toBe(true);
  });

  test('bloqueia subdominio do dominio bloqueado', () => {
    expect(isBlocked('a@mail.p12digital.com.br', deny)).toBe(true);
  });

  test('bloqueia endereco exato', () => {
    expect(isBlocked('chefe@empresa.com', deny)).toBe(true);
  });

  test('bloqueia por padrao', () => {
    expect(isBlocked('noreply@loja.com', deny)).toBe(true);
    expect(isBlocked('no-reply@loja.com', deny)).toBe(true);
  });

  test('deixa passar e-mail de lead', () => {
    expect(isBlocked('cliente@gmail.com', deny)).toBe(false);
  });
});

describe('findEmail', () => {
  test('acha e-mail no meio da frase', () => {
    expect(findEmail('meu email e joao@gmail.com obrigado', deny)).toBe('joao@gmail.com');
  });

  test('entende arroba escrito por extenso', () => {
    expect(findEmail('joao (arroba) gmail.com', deny)).toBe('joao@gmail.com');
  });

  test('tolera espaco em volta do arroba', () => {
    expect(findEmail('joao @ gmail.com', deny)).toBe('joao@gmail.com');
  });

  test('pula o e-mail bloqueado e devolve o proximo', () => {
    const t = 'responda para vendas@persianaspaulista.com.br ou o meu cliente@gmail.com';
    expect(findEmail(t, deny)).toBe('cliente@gmail.com');
  });

  test('devolve vazio quando nao ha e-mail aproveitavel', () => {
    expect(findEmail('Boa tarde', deny)).toBe('');
    expect(findEmail('vendas@p12digital.com.br', deny)).toBe('');
  });
});
