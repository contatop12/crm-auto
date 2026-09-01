import { describe, test, expect } from 'vitest';
import { proporMetas, metasForaDoCatalogo, CATALOGO } from '../../src/domain/metas';
import type { EtapaLigada } from '../../src/domain/metas';
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
  test('os nomes sao os mesmos em todo cliente', () => {
    expect(CATALOGO.map((m) => m.nome)).toEqual([
      'CRM - Conversa Iniciada',
      'CRM - Proposta Enviada',
      'CRM - Lead Qualificado 1',
      'CRM - Lead Qualificado 2',
      'CRM - Compra (valor real)',
    ]);
  });

  test('os valores seguem a planilha de conversoes', () => {
    const valor = (e: string) => CATALOGO.find((m) => m.evento === e)!.valor;
    expect(valor('conversa')).toBe(10);
    expect(valor('proposta_enviada')).toBe(50);
    expect(valor('qualificado_1')).toBe(100);
    expect(valor('qualificado_2')).toBe(150);
    expect(valor('compra')).toBeNull();
  });

  test('so a Conversa Iniciada e primaria', () => {
    // as demais ficam como secundarias ate atingir 100 conversoes
    expect(CATALOGO.filter((m) => m.primary).map((m) => m.evento)).toEqual(['conversa']);
  });

  test('Proposta Enviada e opcional: so a Persianas usa', () => {
    expect(CATALOGO.find((m) => m.evento === 'proposta_enviada')!.opcional).toBe(true);
    expect(CATALOGO.filter((m) => !m.opcional).length).toBe(4);
  });
});

describe('proporMetas', () => {
  test('propoe o catalogo inteiro, seja qual for o funil', () => {
    const eventos = ['conversa', 'proposta_enviada', 'qualificado_1', 'qualificado_2', 'compra'];
    expect(proporMetas(persianas, []).map((m) => m.evento)).toEqual(eventos);
    expect(proporMetas(locadora, []).map((m) => m.evento)).toEqual(eventos);
  });

  test('a meta opcional nao vem marcada quando ainda nao existe na conta', () => {
    // marcar por padrao criaria no Google Ads uma meta que o cliente nao usa
    const p = proporMetas(locadora, []).find((m) => m.evento === 'proposta_enviada')!;
    expect(p.marcada).toBe(false);
    expect(proporMetas(locadora, []).find((m) => m.evento === 'qualificado_1')!.marcada).toBe(true);
  });

  test('a meta opcional vem marcada quando ja existe na conta', () => {
    const existentes = [
      { id: '7728830342', name: 'CRM - Proposta Enviada', category: 'QUALIFIED_LEAD', type: 'UPLOAD_CLICKS', status: 'ENABLED', primaryForGoal: false },
    ];
    const p = proporMetas(persianas, existentes).find((m) => m.evento === 'proposta_enviada')!;
    expect(p.marcada).toBe(true);
    expect(p.idExistente).toBe('7728830342');
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

  test('proposta_enviada sugere a primeira etapa util', () => {
    expect(proporMetas(persianas, []).find((m) => m.evento === 'proposta_enviada')!.stageId).toBe(3);
  });

  test('sem a meta opcional, os Qualificados andam uma casa para tras', () => {
    // Locadora nao usa Proposta Enviada como conversao propria:
    // Qualificado 1 = Proposta Enviada, Qualificado 2 = Negociacao
    const l = proporMetas(locadora, []);
    expect(l.find((m) => m.evento === 'qualificado_1')!.stageId).toBe(13);
    expect(l.find((m) => m.evento === 'qualificado_2')!.stageId).toBe(14);
  });

  test('com a meta opcional, os Qualificados andam uma casa para frente', () => {
    // Persianas usa: Proposta Enviada tem meta propria, entao
    // Qualificado 1 = Agendamento de Visita e Qualificado 2 = Negociacao
    const p = proporMetas(persianas, [
      { id: '7728830342', name: 'CRM - Proposta Enviada', category: 'QUALIFIED_LEAD', type: 'UPLOAD_CLICKS', status: 'ENABLED', primaryForGoal: false },
    ]);
    expect(p.find((m) => m.evento === 'qualificado_1')!.stageId).toBe(4);
    expect(p.find((m) => m.evento === 'qualificado_2')!.stageId).toBe(5);
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

describe('metasForaDoCatalogo', () => {
  const ligada = (over: Partial<EtapaLigada> = {}): EtapaLigada => ({
    stageId: 6,
    evento: 'visita_tecnica',
    nome: 'CRM - Visita Técnica',
    categoria: 'QUALIFIED_LEAD',
    valor: 80,
    primary: false,
    contagem: 'ONE_PER_CLICK',
    janelaClique: 30,
    janelaView: 1,
    actionId: '8811223344',
    ...over,
  });

  test('devolve so o que nao esta no catalogo', () => {
    const fora = metasForaDoCatalogo(
      persianas,
      [ligada(), ligada({ stageId: 5, evento: 'qualificado_2', nome: 'CRM - Lead Qualificado 2' })],
      [],
    );
    expect(fora.map((m) => m.evento)).toEqual(['visita_tecnica']);
  });

  test('a meta de fora sobrevive a proxima previa', () => {
    // sem isto ela sumiria da tela, ainda ligada a etapa mas invisivel
    const m = metasForaDoCatalogo(persianas, [ligada()], [])[0]!;
    expect(m.fora).toBe(true);
    expect(m.marcada).toBe(true);
    expect(m.stageId).toBe(6);
    expect(m.stageNome).toBe('Produção');
    expect(m.valor).toBe(80);
  });

  test('as opcoes de etapa sao as mesmas do catalogo', () => {
    const m = metasForaDoCatalogo(persianas, [ligada()], [])[0]!;
    expect(m.etapasPossiveis.map((e) => e.id)).toEqual(
      proporMetas(persianas, []).find((x) => x.evento === 'qualificado_2')!.etapasPossiveis.map((e) => e.id),
    );
  });

  test('so conta como existente se a acao ainda esta na conta', () => {
    const naConta = [
      { id: '8811223344', name: 'CRM - Visita Técnica', category: 'QUALIFIED_LEAD', type: 'UPLOAD_CLICKS', status: 'ENABLED', primaryForGoal: false },
    ];
    expect(metasForaDoCatalogo(persianas, [ligada()], naConta)[0]!.jaExiste).toBe(true);
    // apagada no Google Ads: precisa ser recriada, nao so religada
    expect(metasForaDoCatalogo(persianas, [ligada()], [])[0]!.jaExiste).toBe(false);
    expect(metasForaDoCatalogo(persianas, [ligada({ actionId: null })], naConta)[0]!.jaExiste).toBe(false);
  });

  test('etapa sem evento nao vira meta', () => {
    expect(metasForaDoCatalogo(persianas, [ligada({ evento: '' })], []).length).toBe(0);
  });
});
