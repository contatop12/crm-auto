import { describe, test, expect } from 'vitest';
import { simularRespostas } from '../../src/domain/historico';
import type { Stage, Trigger } from '../../src/domain/types';

// funil da Persianas Paulista, board 13, na ordem do board
const stages: Stage[] = [
  { id: 1, posicao: 1, nome: 'Novo Lead', isFinal: false, autoOnReply: false },
  { id: 2, posicao: 2, nome: 'Qualificando', isFinal: false, autoOnReply: true },
  { id: 3, posicao: 3, nome: 'Proposta Enviada', isFinal: false, autoOnReply: false },
  { id: 4, posicao: 4, nome: 'Agendamento de Visita', isFinal: false, autoOnReply: false },
  { id: 5, posicao: 5, nome: 'Negociação', isFinal: false, autoOnReply: false },
  { id: 7, posicao: 7, nome: 'Oportunidade Perdida', isFinal: true, autoOnReply: false },
];

const triggers: Trigger[] = [
  { stageId: 3, frase: 'este orcamento previo', emojiObrigatorio: null },
  { stageId: 4, frase: 'visita agendada', emojiObrigatorio: null },
  { stageId: 5, frase: 'segue orcamento com as medidas tecnicas', emojiObrigatorio: null },
  { stageId: 7, frase: 'perdido', emojiObrigatorio: '❌' },
];

describe('simularRespostas', () => {
  // Ana Baumann, conversa 534: tudo isso foi escrito com o card no Organico,
  // e o card so' entrou no funil uma semana depois.
  test('refaz o caminho que as respostas teriam feito', () => {
    const r = simularRespostas('Novo Lead', [
      'ok',
      'qual modelo a sra. quer ?',
      'Este orçamento prévio é para que você tenha uma ideia do valor',
      'para avaliar um desconto ou parcelarmos em mais vezes',
      'Visita Agendada! ✅',
      'Boa tarde, Ana! Segue o orçamento conforme as medidas do técnico',
    ], stages, triggers);

    expect(r.etapa?.nome).toBe('Agendamento de Visita');
    expect(r.passos.map((p) => p.para)).toEqual(['Qualificando', 'Proposta Enviada', 'Agendamento de Visita']);
  });

  // Tainã, conversa 757: a vendedora abordou antes do card ser promovido
  test('uma resposta comum leva para a etapa automatica', () => {
    const r = simularRespostas('Novo Lead', ['Olá, Bia Andrade, tudo bem? Obrigada pelo contato!'], stages, triggers);
    expect(r.etapa?.nome).toBe('Qualificando');
    expect(r.passos).toHaveLength(1);
  });

  test('sem resposta do vendedor, nao move', () => {
    const r = simularRespostas('Novo Lead', [], stages, triggers);
    expect(r.etapa).toBeNull();
    expect(r.passos).toEqual([]);
  });

  test('nao puxa para tras um card que ja esta adiante', () => {
    const r = simularRespostas('Negociação', ['Este orçamento prévio é para você', 'ok'], stages, triggers);
    expect(r.etapa).toBeNull();
  });

  test('etapa final vale de qualquer ponto, como ao vivo', () => {
    const r = simularRespostas('Agendamento de Visita', ['cliente perdido ❌'], stages, triggers);
    expect(r.etapa?.nome).toBe('Oportunidade Perdida');
  });

  test('guarda frase e trecho de cada passo para o registro', () => {
    const r = simularRespostas('Qualificando', ['Visita Agendada! ✅'], stages, triggers);
    expect(r.passos).toEqual([
      { de: 'Qualificando', para: 'Agendamento de Visita', frase: 'visita agendada', trecho: 'Visita Agendada! ✅' },
    ]);
  });
});
