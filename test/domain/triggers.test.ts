import { describe, test, expect } from 'vitest';
import { matchStage } from '../../src/domain/triggers';
import type { Stage, Trigger } from '../../src/domain/types';

// funil da Persianas Paulista, board 13
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

const triggers: Trigger[] = [
  { stageId: 7, frase: 'fechado', emojiObrigatorio: '✅' },
  { stageId: 8, frase: 'perdido', emojiObrigatorio: '❌' },
  { stageId: 6, frase: 'preciso de alguns dados para o contrato', emojiObrigatorio: null },
  { stageId: 5, frase: 'segue orcamento com as medidas tecnicas', emojiObrigatorio: null },
  { stageId: 4, frase: 'visita agendada', emojiObrigatorio: null },
  { stageId: 3, frase: 'este orcamento previo', emojiObrigatorio: null },
];

describe('matchStage', () => {
  test('casa frase-gatilho apesar de acento e caixa', () => {
    const r = matchStage('Segue orçamento com as MEDIDAS TÉCNICAS', stages, triggers);
    expect(r?.stageId).toBe(5);
    expect(r?.byKeyword).toBe(true);
  });

  test('resposta comum do vendedor cai na etapa autoOnReply', () => {
    const r = matchStage('Bom dia, como posso ajudar?', stages, triggers);
    expect(r?.stageId).toBe(2);
    expect(r?.byKeyword).toBe(false);
  });

  test('gatilho com emoji obrigatorio nao casa sem o emoji', () => {
    const r = matchStage('negocio fechado', stages, triggers);
    expect(r?.stageId).toBe(2); // caiu no fallback, nao em Oportunidade Ganha
  });

  test('gatilho com emoji obrigatorio casa quando o emoji esta presente', () => {
    const r = matchStage('negocio fechado ✅', stages, triggers);
    expect(r?.stageId).toBe(7);
    expect(r?.byKeyword).toBe(true);
  });

  test('a etapa mais avancada vence quando duas frases casam', () => {
    const texto = 'visita agendada, e preciso de alguns dados para o contrato';
    expect(matchStage(texto, stages, triggers)?.stageId).toBe(6);
  });

  test('mensagem sem texto nao move nada', () => {
    expect(matchStage('', stages, triggers)).toBeNull();
    expect(matchStage('👍', stages, triggers)).toBeNull();
  });

  test('devolve a frase que casou para diagnostico', () => {
    const r = matchStage('ja mandei, visita agendada pra quinta', stages, triggers);
    expect(r?.matchedPhrase).toBe('visita agendada');
  });

  test('sem etapa autoOnReply, resposta comum nao move', () => {
    const semAuto = stages.map((s) => ({ ...s, autoOnReply: false }));
    expect(matchStage('Bom dia', semAuto, triggers)).toBeNull();
  });
});

describe('matchStage — tipo de correspondencia', () => {
  const vita: Stage[] = [
    { id: 1, posicao: 1, nome: 'Novo Lead', isFinal: false, autoOnReply: false },
    { id: 2, posicao: 2, nome: 'Qualificando', isFinal: false, autoOnReply: true },
    { id: 3, posicao: 3, nome: 'Agendamento Realizado', isFinal: false, autoOnReply: false },
    { id: 4, posicao: 4, nome: 'Compareceu à Consulta', isFinal: false, autoOnReply: false },
  ];
  const fixo: Trigger[] = [{ stageId: 4, frase: 'Consulta realizada ✅', emojiObrigatorio: null, tipo: 'fixo' }];

  test('fixo casa com a mensagem inteira, apesar de caixa, acento e emoji', () => {
    expect(matchStage('Consulta realizada ✅', vita, fixo)?.stageId).toBe(4);
    expect(matchStage('CONSULTA REALIZADA', vita, fixo)?.stageId).toBe(4);
  });

  test('fixo ignora pontuacao e espaco nas pontas', () => {
    expect(matchStage('  Consulta realizada. ', vita, fixo)?.stageId).toBe(4);
    expect(matchStage('Consulta realizada!!', vita, fixo)?.stageId).toBe(4);
  });

  test('fixo nao casa com texto antes ou depois', () => {
    expect(matchStage('Consulta realizada, ate breve!', vita, fixo)?.byKeyword).toBe(false);
    expect(matchStage('Sua consulta realizada ontem foi otima', vita, fixo)?.byKeyword).toBe(false);
  });

  test('sem tipo continua sendo contem', () => {
    const semTipo: Trigger[] = [{ stageId: 3, frase: 'ficou confirmada para', emojiObrigatorio: null }];
    const r = matchStage('Perfeito Áurea! 💙\n\nA consulta do seu esposo ficou confirmada para:', vita, semTipo);
    expect(r?.stageId).toBe(3);
  });

  test('fixo e contem disputando: vence a etapa mais avancada', () => {
    const mistos: Trigger[] = [
      { stageId: 3, frase: 'consulta', emojiObrigatorio: null, tipo: 'contem' },
      ...fixo,
    ];
    expect(matchStage('Consulta realizada ✅', vita, mistos)?.stageId).toBe(4);
    expect(matchStage('Sua consulta realizada ontem', vita, mistos)?.stageId).toBe(3);
  });
});
