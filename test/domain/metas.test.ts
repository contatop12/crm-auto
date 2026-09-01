import { describe, test, expect } from 'vitest';
import { proporMetas, CATALOGO } from '../../src/domain/metas';
import type { Stage } from '../../src/domain/types';

// funil da Persianas (board 13)
const persianas: Stage[] = [
  { id: 1, posicao: 1, nome: 'Novo Lead', isFinal: false, autoOnReply: false },
  { id: 2, posicao: 2, nome: 'Qualificando', isFinal: false, autoOnReply: true },
  { id: 3, posicao: 3, nome: 'Proposta Enviada', isFinal: false, autoOnReply: false },
  { id: 4, posicao: 4, nome: 'Agendamento de Visita', isFinal: false, autoOnReply: false },
  { id: 5, posicao: 5, nome: 'Negociação', isFinal: false, autoOnReply: false },
  { id: 6, posicao: 6, nome: 'Produção', isFinal: false, autoOnReply: false },
  { id: 7, posicao: 7, nome: 'Oportunidade Ganha', isFinal: true, autoOnReply: false },
  { id: 8, posicao: 8, nome: 'Oportunidade Perdida', isFinal: true, autoOnReply: false },
];

// funil da Locadora (board 9), mais curto
const locadora: Stage[] = [
  { id: 11, posicao: 1, nome: 'Novo Lead', isFinal: false, autoOnReply: false },
  { id: 12, posicao: 2, nome: 'Qualificando', isFinal: false, autoOnReply: true },
  { id: 13, posicao: 3, nome: 'Proposta Enviada', isFinal: false, autoOnReply: false },
  { id: 14, posicao: 4, nome: 'Negociação', isFinal: false, autoOnReply: false },
  { id: 15, posicao: 5, nome: 'Oportunidade Perdida', isFinal: true, autoOnReply: false },
  { id: 16, posicao: 6, nome: 'Oportunidade Ganha', isFinal: true, autoOnReply: false },
];

describe('CATALOGO', () => {
  test('sao as quatro metas padrao, com o mesmo nome em todo cliente', () => {
    expect(CATALOGO.map((m) => m.nome)).toEqual([
      'CRM - Conversa Iniciada',
      'CRM - Lead Qualificado 1',
      'CRM - Lead Qualificado 2',
      'CRM - Compra (valor real)',
    ]);
  });
});

describe('proporMetas', () => {
  test('propoe sempre as quatro do catalogo, seja qual for o funil', () => {
    expect(proporMetas(persianas, []).map((m) => m.evento)).toEqual([
      'conversa', 'qualificado_1', 'qualificado_2', 'compra',
    ]);
    expect(proporMetas(locadora, []).map((m) => m.evento)).toEqual([
      'conversa', 'qualificado_1', 'qualificado_2', 'compra',
    ]);
  });

  test('o nome nao muda com o nome da etapa', () => {
    const p = proporMetas(persianas, []).map((m) => m.nome);
    const l = proporMetas(locadora, []).map((m) => m.nome);
    expect(p).toEqual(l);
  });

  test('Conversa Iniciada nao vem de etapa nenhuma', () => {
    const c = proporMetas(persianas, []).find((m) => m.evento === 'conversa')!;
    expect(c.stageId).toBeNull();
    expect(c.categoria).toBe('CONTACT');
  });

  test('qualificado_1 sugere a primeira etapa util do funil', () => {
    // pula entrada e a etapa de resposta automatica
    expect(proporMetas(persianas, []).find((m) => m.evento === 'qualificado_1')!.stageId).toBe(3);
    expect(proporMetas(locadora, []).find((m) => m.evento === 'qualificado_1')!.stageId).toBe(13);
  });

  test('qualificado_2 sugere a segunda', () => {
    expect(proporMetas(persianas, []).find((m) => m.evento === 'qualificado_2')!.stageId).toBe(4);
    expect(proporMetas(locadora, []).find((m) => m.evento === 'qualificado_2')!.stageId).toBe(14);
  });

  test('compra sugere a etapa de ganho, com valor real', () => {
    const c = proporMetas(persianas, []).find((m) => m.evento === 'compra')!;
    expect(c.stageId).toBe(7);
    expect(c.categoria).toBe('PURCHASE');
    expect(c.valor).toBeNull();
  });

  test('a sugestao de etapa e apenas sugestao: as opcoes vem junto', () => {
    const m = proporMetas(persianas, []).find((x) => x.evento === 'qualificado_2')!;
    // todas as etapas elegiveis, para trocar na tela
    expect(m.etapasPossiveis.map((e) => e.id)).toEqual([3, 4, 5, 6, 7]);
  });

  test('funil sem etapa util deixa a sugestao vazia em vez de inventar', () => {
    const curto: Stage[] = [
      { id: 90, posicao: 1, nome: 'Novo Lead', isFinal: false, autoOnReply: false },
      { id: 91, posicao: 2, nome: 'Qualificando', isFinal: false, autoOnReply: true },
    ];
    const m = proporMetas(curto, []);
    expect(m.find((x) => x.evento === 'qualificado_1')!.stageId).toBeNull();
    expect(m.find((x) => x.evento === 'compra')!.stageId).toBeNull();
  });

  test('reconhece a meta que ja existe na conta e reaproveita o id', () => {
    const existentes = [
      { id: '7712794954', name: 'CRM - Conversa Iniciada', category: 'CONTACT', type: 'UPLOAD_CLICKS', status: 'ENABLED', primaryForGoal: true },
    ];
    const c = proporMetas(persianas, existentes).find((m) => m.evento === 'conversa')!;
    expect(c.jaExiste).toBe(true);
    expect(c.idExistente).toBe('7712794954');
  });

  test('reconhece as variacoes de nome que ja existem nas contas', () => {
    // Vita e Locadora chamam a primeira meta de "CRM - Conversão WhatsApp";
    // a Persianas, de "CRM - Conversa Iniciada - WhatsApp"
    for (const nome of ['CRM - Conversão WhatsApp', 'CRM - Conversa Iniciada - WhatsApp']) {
      const c = proporMetas(persianas, [
        { id: '99', name: nome, category: 'CONTACT', type: 'UPLOAD_CLICKS', status: 'ENABLED', primaryForGoal: true },
      ]).find((m) => m.evento === 'conversa')!;
      expect(c.jaExiste, nome).toBe(true);
      expect(c.idExistente).toBe('99');
    }
  });

  test('compara ignorando caixa e espaco', () => {
    const c = proporMetas(persianas, [
      { id: '77', name: '  crm - lead qualificado 1 ', category: 'QUALIFIED_LEAD', type: 'UPLOAD_CLICKS', status: 'ENABLED', primaryForGoal: false },
    ]).find((m) => m.evento === 'qualificado_1')!;
    expect(c.jaExiste).toBe(true);
  });

  test('meta que nao existe vem marcada como nova', () => {
    expect(proporMetas(persianas, []).every((m) => m.jaExiste === false)).toBe(true);
  });
});
