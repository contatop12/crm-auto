import { describe, test, expect } from 'vitest';
import { lerRodizio, agenteDaVez } from '../../src/domain/rodizio';
import { conversaEmOutraCaixa, rotuloDaCaixa, parDeCaixas, textoDoAlerta } from '../../src/domain/contatoDuplicado';

describe('lerRodizio', () => {
  test('config da Locadora', () => {
    expect(lerRodizio('{"15":[15,13],"16":[12],"17":[14]}')).toEqual({ 15: [15, 13], 16: [12], 17: [14] });
  });
  test('nulo, lixo e lista vazia = desligado', () => {
    expect(lerRodizio(null)).toBeNull();
    expect(lerRodizio('nao e json')).toBeNull();
    expect(lerRodizio('{"15":[]}')).toBeNull();
    expect(lerRodizio('[1]')).toBeNull();
  });
  test('descarta agente invalido sem derrubar a caixa', () => {
    expect(lerRodizio('{"15":[15,"x",13]}')).toEqual({ 15: [15, 13] });
  });
});

describe('agenteDaVez', () => {
  test('alterna e volta ao primeiro', () => {
    expect([1, 2, 3, 4].map((v) => agenteDaVez([15, 13], v))).toEqual([15, 13, 15, 13]);
  });
  test('lista de um so e sempre o mesmo', () => {
    expect([1, 2, 7].map((v) => agenteDaVez([12], v))).toEqual([12, 12, 12]);
  });
});

const AGORA = Date.parse('2026-10-29T15:00:00Z');
const seg = (diasAtras: number) => (AGORA - diasAtras * 86400_000) / 1000;

describe('conversaEmOutraCaixa', () => {
  const atual = { conversa: 50, inbox: 17 };
  test('ignora a propria conversa e a mesma caixa', () => {
    expect(conversaEmOutraCaixa([
      { id: 50, inbox_id: 17, status: 'open', last_activity_at: seg(0) },
      { id: 40, inbox_id: 17, status: 'open', last_activity_at: seg(1) },
    ], atual, AGORA)).toBeNull();
  });
  test('aberta em outra caixa conta mesmo velha', () => {
    expect(conversaEmOutraCaixa([{ id: 9, inbox_id: 15, status: 'open', last_activity_at: seg(90) }], atual, AGORA)?.id).toBe(9);
  });
  test('resolvida: so dentro de 30 dias', () => {
    expect(conversaEmOutraCaixa([{ id: 9, inbox_id: 15, status: 'resolved', last_activity_at: seg(10) }], atual, AGORA)?.id).toBe(9);
    expect(conversaEmOutraCaixa([{ id: 9, inbox_id: 15, status: 'resolved', last_activity_at: seg(31) }], atual, AGORA)).toBeNull();
  });
  test('varias: a mais recente', () => {
    expect(conversaEmOutraCaixa([
      { id: 9, inbox_id: 15, status: 'open', last_activity_at: seg(5) },
      { id: 12, inbox_id: 16, status: 'open', last_activity_at: seg(1) },
    ], atual, AGORA)?.id).toBe(12);
  });
});

test('rotulo da caixa', () => {
  expect(rotuloDaCaixa('Locadora - 8910', 15)).toBe('8910');
  expect(rotuloDaCaixa('Atendimento', 3)).toBe('Atendimento');
  expect(rotuloDaCaixa(null, 3)).toBe('caixa 3');
});

test('par de caixas e ordenado', () => {
  expect(parDeCaixas(17, 15)).toEqual([15, 17]);
  expect(parDeCaixas(15, 17)).toEqual([15, 17]);
});

test('texto do alerta', () => {
  const t = textoDoAlerta({
    cliente: 'Locadora Exatidao', nome: 'Vital', telefone: '5511932346062',
    antiga: { rotulo: '8910', conversa: 1200, responsavel: 'Tânia', ultimaAtividadeMs: Date.parse('2026-10-20T15:00:00Z') },
    nova: { rotulo: '2244', conversa: 1300, responsavel: null },
  });
  expect(t).toContain('Contato em dois números — Locadora Exatidao');
  expect(t).toContain('https://wa.me/5511932346062');
  expect(t).toContain('Falou com o 8910 (responsável: Tânia) em 20/10 e agora com o 2244 (sem responsável).');
  expect(t).toContain('#1200 e #1300');
});
