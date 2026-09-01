import { describe, test, expect } from 'vitest';
import { proporMetas } from '../../src/domain/metas';
import type { Stage } from '../../src/domain/types';

// funil real da Persianas (board 13)
const stages: Stage[] = [
  { id: 1, posicao: 1, nome: 'Novo Lead', isFinal: false, autoOnReply: false },
  { id: 2, posicao: 2, nome: 'Qualificando', isFinal: false, autoOnReply: true },
  { id: 3, posicao: 3, nome: 'Proposta Enviada', isFinal: false, autoOnReply: false },
  { id: 4, posicao: 4, nome: 'Agendamento de Visita', isFinal: false, autoOnReply: false },
  { id: 5, posicao: 5, nome: 'Negociação', isFinal: false, autoOnReply: false },
  { id: 6, posicao: 6, nome: 'Produção', isFinal: false, autoOnReply: false },
  { id: 7, posicao: 7, nome: 'Oportunidade Ganha', isFinal: true, autoOnReply: false },
  { id: 8, posicao: 8, nome: 'Oportunidade Perdida', isFinal: true, autoOnReply: false },
];

describe('proporMetas', () => {
  test('sempre propoe a Conversa Iniciada, que nao vem de etapa', () => {
    const m = proporMetas(stages, []);
    const conversa = m.find((x) => x.evento === 'conversa');
    expect(conversa).toBeDefined();
    expect(conversa!.categoria).toBe('CONTACT');
    expect(conversa!.stageId).toBeNull();
  });

  test('nao propoe meta para a etapa de entrada', () => {
    expect(proporMetas(stages, []).some((m) => m.stageId === 1)).toBe(false);
  });

  test('nao propoe meta para a etapa de resposta automatica', () => {
    // "Qualificando" e' alcancada por qualquer resposta do vendedor; viraria
    // quase a mesma coisa que Conversa Iniciada
    expect(proporMetas(stages, []).some((m) => m.stageId === 2)).toBe(false);
  });

  test('nao propoe meta para etapa de perda', () => {
    expect(proporMetas(stages, []).some((m) => m.stageId === 8)).toBe(false);
  });

  test('Oportunidade Ganha vira PURCHASE com valor real', () => {
    const ganha = proporMetas(stages, []).find((m) => m.stageId === 7);
    expect(ganha!.categoria).toBe('PURCHASE');
    expect(ganha!.valor).toBeNull();
    expect(ganha!.primary).toBe(true);
  });

  test('etapas do meio viram QUALIFIED_LEAD com valor crescente', () => {
    const m = proporMetas(stages, []);
    const proposta = m.find((x) => x.stageId === 3)!;
    const negociacao = m.find((x) => x.stageId === 5)!;
    expect(proposta.categoria).toBe('QUALIFIED_LEAD');
    expect(negociacao.valor).toBeGreaterThan(proposta.valor!);
  });

  test('nomeia seguindo o padrao ja usado nas contas', () => {
    const m = proporMetas(stages, []);
    expect(m.every((x) => x.nome.startsWith('CRM - '))).toBe(true);
  });

  test('marca a meta que ja existe na conta e reaproveita o id', () => {
    const existentes = [
      { id: '7712794954', name: 'CRM - Conversa Iniciada', category: 'CONTACT', type: 'UPLOAD_CLICKS', status: 'ENABLED', primaryForGoal: true },
    ];
    const conversa = proporMetas(stages, existentes).find((m) => m.evento === 'conversa')!;
    expect(conversa.jaExiste).toBe(true);
    expect(conversa.idExistente).toBe('7712794954');
  });

  test('compara nome ignorando caixa e espaco', () => {
    const existentes = [
      { id: '99', name: '  crm - proposta enviada ', category: 'QUALIFIED_LEAD', type: 'UPLOAD_CLICKS', status: 'ENABLED', primaryForGoal: false },
    ];
    const proposta = proporMetas(stages, existentes).find((m) => m.stageId === 3)!;
    expect(proposta.jaExiste).toBe(true);
  });

  test('meta que ainda nao existe vem desmarcada como nova', () => {
    const m = proporMetas(stages, []);
    expect(m.every((x) => x.jaExiste === false)).toBe(true);
  });

  test('funil curto gera menos metas', () => {
    const curto = stages.slice(0, 3);
    expect(proporMetas(curto, []).length).toBeLessThan(proporMetas(stages, []).length);
  });
});
