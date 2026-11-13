import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

type Etapa = {
  id: number; nome: string; tipo: string; noFunil: boolean; entradas: number; agora: number; alcance: number;
  convProxima: number | null; convTopo: number | null; perda: number; tempoMediano: number | null;
};
type Modelo = {
  etapas: Etapa[]; saidas: Etapa[]; todas: Etapa[]; topo: number; fundo: number; convGeral: number | null;
  emAndamento: number; foraDoFunil: number; novos: number | null;
  gargalo: { de: string; para: string; perda: number; taxa: number } | null;
  maisLenta: { nome: string; segundos: number } | null;
};
type Funil = {
  classificar(p: { name?: string; status?: string }): string;
  montar(dados: unknown, escolha?: Record<string, boolean> | null): Modelo;
  novosDoCfd(cfd: unknown): number | null;
  consultaAnterior(q: string): string | null;
  consultaDoCfd(q: string): string | null;
  duracao(s: number | null): string;
  pct(v: number | null): string;
  variacao(a: number | null, b: number | null): { texto: string; sinal: number } | null;
  csv(m: Modelo, antes: Modelo | null): string;
  html(m: Modelo | null, antes: Modelo | null, pref: { vista: string; metrica: string; comparar: boolean }, tela?: Record<string, unknown>): string;
};

/** As funcoes de calculo do script do painel, rodadas sem tela. */
function carregar(arquivo: string, nome: string): unknown {
  const janela: Record<string, unknown> = {};
  vm.runInNewContext(readFileSync(arquivo, 'utf8'), { window: janela });
  return janela[nome];
}
const funil = carregar('panel/chatwoot-funil.js', '__p12Funil') as Funil;

const passo = (step_id: number, name: string, entered_count: number, current_count: number, extra: Record<string, unknown> = {}) => ({
  step_id, name, color: '#60a5fa', status: 'open', entered_count, current_count, conversion_to_next: null,
  avg_time_in_step_seconds: null, pipeline_value: 0, weighted_value: 0, ...extra,
});

/** O funil Lead Ads da Persianas em 13/11/2026, como a API devolveu. */
const PERSIANAS = {
  currency: 'BRL',
  steps: [
    passo(50, 'Novo Lead', 0, -2, { avg_time_in_step_seconds: 2763 }),
    passo(51, 'Qualificando', 191, 115, { conversion_to_next: 0.712, avg_time_in_step_seconds: 25737 }),
    passo(52, 'Proposta Enviada', 141, 256, { conversion_to_next: 0.0142, avg_time_in_step_seconds: 655116 }),
    passo(57, 'Agendamento de Visita', 6, 8, { conversion_to_next: 1 }),
    passo(53, 'Negociação', 13, 10, { conversion_to_next: 0.3846 }),
    passo(58, 'Produção', 7, 12, { conversion_to_next: 0 }),
    passo(54, 'Oportunidade Perdida', 0, 0, { status: 'cancelled' }),
    passo(59, 'Desqualificado', 0, 1),
    passo(55, 'Oportunidade Ganha', 0, 0, { status: 'completed' }),
  ],
};

describe('etapas do funil', () => {
  test('perda, pendente e desqualificado ficam fora; ganho fecha o funil', () => {
    expect(funil.classificar({ name: 'Oportunidade Perdida', status: 'cancelled' })).toBe('saida');
    expect(funil.classificar({ name: 'Pendente', status: 'open' })).toBe('saida');
    expect(funil.classificar({ name: 'Desqualificado', status: 'open' })).toBe('saida');
    expect(funil.classificar({ name: 'Oportunidade Ganha', status: 'completed' })).toBe('ganho');
    expect(funil.classificar({ name: 'Proposta Enviada', status: 'open' })).toBe('funil');

    const m = funil.montar({ funil: PERSIANAS });
    expect(m.etapas.map((e) => e.nome)).toEqual([
      'Novo Lead', 'Qualificando', 'Proposta Enviada', 'Agendamento de Visita', 'Negociação', 'Produção', 'Oportunidade Ganha',
    ]);
    expect(m.saidas.map((e) => e.nome)).toEqual(['Oportunidade Perdida', 'Desqualificado']);
    expect(m.foraDoFunil).toBe(1);
  });

  test('a escolha do usuario vence o palpite pelo nome', () => {
    const m = funil.montar({ funil: PERSIANAS }, { 59: true, 57: false });
    expect(m.etapas.map((e) => e.id)).toContain(59);
    expect(m.etapas.map((e) => e.id)).not.toContain(57);
    expect(m.saidas.map((e) => e.id)).toContain(57);
  });
});

describe('quantos chegaram em cada etapa', () => {
  test('a primeira etapa, onde o lead nasce, usa os leads novos em vez do zero do Chatwoot', () => {
    const m = funil.montar({ funil: PERSIANAS, novos: 195 });
    expect(m.etapas[0]!.entradas).toBe(0);
    expect(m.etapas[0]!.alcance).toBe(195);
    expect(m.topo).toBe(195);
  });

  test('sem o numero de leads novos, o topo e pelo menos quem chegou na etapa seguinte', () => {
    expect(funil.montar({ funil: PERSIANAS }).topo).toBe(191);
  });

  test('lead que pulou etapa conta nas anteriores: o funil nunca alarga para baixo', () => {
    const m = funil.montar({ funil: PERSIANAS, novos: 195 });
    // Agendamento teve 6 entradas e Negociacao, depois dele, 13: pelo menos 13 passaram por ali.
    expect(m.etapas.map((e) => e.alcance)).toEqual([195, 191, 141, 13, 13, 7, 0]);
    for (let i = 1; i < m.etapas.length; i++) expect(m.etapas[i]!.alcance).toBeLessThanOrEqual(m.etapas[i - 1]!.alcance);
  });

  test('taxas, maior perda e conversao do topo ao fim', () => {
    const m = funil.montar({ funil: PERSIANAS, novos: 195 });
    expect(m.etapas[1]!.convProxima).toBeCloseTo(141 / 191, 5);
    expect(m.etapas[2]!.convTopo).toBeCloseTo(141 / 195, 5);
    expect(m.gargalo).toMatchObject({ de: 'Proposta Enviada', para: 'Agendamento de Visita', perda: 128 });
    expect(m.fundo).toBe(0);
    expect(m.convGeral).toBe(0);
    expect(m.etapas[m.etapas.length - 1]!.convProxima).toBeNull();
  });

  test('contador negativo do Chatwoot nao vira card negativo', () => {
    const m = funil.montar({ funil: PERSIANAS });
    expect(m.etapas[0]!.agora).toBe(0);
    expect(m.emAndamento).toBe(115 + 256 + 8 + 10 + 12);
  });

  test('etapa mais lenta sai da mediana quando ela existe', () => {
    const m = funil.montar({
      funil: PERSIANAS,
      duracoes: [
        { step_id: 51, median_seconds: 1044, p90_seconds: 21061, avg_seconds: 25737, sample_size: 144 },
        { step_id: 57, median_seconds: 267322, p90_seconds: 1362496, avg_seconds: 541259, sample_size: 9 },
        { step_id: 58, median_seconds: null, p90_seconds: null, avg_seconds: null, sample_size: 0 },
      ],
    });
    expect(m.maisLenta).toMatchObject({ nome: 'Agendamento de Visita', segundos: 267322 });
  });

  test('funil vazio nao quebra', () => {
    const m = funil.montar({ funil: { steps: [] } });
    expect(m.etapas).toEqual([]);
    expect(m.topo).toBe(0);
    expect(m.convGeral).toBeNull();
    expect(funil.html(m, null, { vista: 'funil', metrica: 'alcance', comparar: false })).toContain('ainda não tem etapas');
  });
});

describe('leads novos e periodo anterior', () => {
  test('leads novos = quanto o total de cards cresceu entre a vespera e o fim', () => {
    const cfd = {
      series: [
        { step_id: 1, points: [{ date: 'a', count: -2 }, { date: 'b', count: 3 }, { date: 'c', count: 2 }] },
        { step_id: 2, points: [{ date: 'a', count: 213 }, { date: 'b', count: 300 }, { date: 'c', count: 404 }] },
      ],
    };
    expect(funil.novosDoCfd(cfd)).toBe(195);
    expect(funil.novosDoCfd({ series: [] })).toBeNull();
    expect(funil.novosDoCfd({ series: [{ points: [{ count: 5 }] }] })).toBeNull();
    expect(funil.novosDoCfd(null)).toBeNull();
  });

  test('o periodo anterior tem o mesmo tamanho e termina um segundo antes', () => {
    const q = 'since=1792033200&until=1794625199&board_id=13&timezone_offset=-3';
    expect(funil.consultaAnterior(q)).toBe('since=1789441200&until=1792033199&board_id=13&timezone_offset=-3');
    expect(funil.consultaAnterior('board_id=13')).toBeNull();
  });

  test('o fluxo e pedido com a vespera, agrupado por dia', () => {
    expect(funil.consultaDoCfd('since=1792033200&until=1794625199&board_id=13')).toBe('since=1791946800&until=1794625199&board_id=13&group_by=day');
  });

  test('variacao contra o periodo anterior', () => {
    expect(funil.variacao(120, 100)).toEqual({ texto: '+20%', sinal: 1 });
    expect(funil.variacao(95, 100)).toEqual({ texto: '−5%', sinal: -1 });
    expect(funil.variacao(100, 100)).toEqual({ texto: 'igual', sinal: 0 });
    expect(funil.variacao(5, 0)).toEqual({ texto: 'novo', sinal: 1 });
    expect(funil.variacao(5, null)).toBeNull();
  });
});

describe('texto do relatorio', () => {
  test('tempo em palavras', () => {
    expect(funil.duracao(16)).toBe('16 s');
    expect(funil.duracao(2763)).toBe('46 min');
    expect(funil.duracao(25737)).toBe('7 h 9 min');
    expect(funil.duracao(7200)).toBe('2 h');
    expect(funil.duracao(655116)).toBe('7 d 14 h');
    expect(funil.duracao(null)).toBe('–');
  });

  test('porcentagem pequena ganha uma casa', () => {
    expect(funil.pct(0.712)).toBe('71%');
    expect(funil.pct(0.0142)).toBe('1,4%');
    expect(funil.pct(0)).toBe('0%');
    expect(funil.pct(1)).toBe('100%');
    expect(funil.pct(null)).toBe('–');
  });

  test('as quatro visualizacoes desenham sem erro e escapam o nome da etapa', () => {
    const dados = { funil: { currency: 'BRL', steps: [passo(1, 'Novo <b>Lead</b>', 0, 3), passo(2, 'Proposta', 10, 4, { conversion_to_next: 0.5 }), passo(3, 'Pendente', 2, 5)] }, novos: 20 };
    const m = funil.montar(dados);
    for (const vista of ['funil', 'barras', 'tempo', 'tabela']) {
      for (const metrica of ['alcance', 'entradas', 'agora']) {
        const h = funil.html(m, null, { vista, metrica, comparar: false }, { conta: '7', quadro: '13', parados: [{ task_id: 9, title: 'Card "x"', step_name: 'Proposta', age_seconds: 90000 }] });
        expect(h).toContain('Novo &lt;b&gt;Lead&lt;/b&gt;');
        expect(h).not.toContain('<b>Lead</b>');
        expect(h).not.toContain('undefined');
        expect(h).not.toContain('NaN');
      }
    }
    expect(funil.html(m, null, { vista: 'funil', metrica: 'alcance', comparar: false })).toContain('Fora do funil');
    // Card parado abre a conversa pelo numero que vem no titulo; sem numero, fica sem link.
    const parados = [
      { task_id: 9, title: 'Conversa #386 - Ana', step_name: 'B', age_seconds: 90000 },
      { task_id: 10, title: '#1340 - 5584986302758 - Larissa', step_name: 'B', age_seconds: 80000 },
      { task_id: 11, title: 'Ryan Teste', step_name: 'B', age_seconds: 70000 },
    ];
    const tempo = funil.html(m, null, { vista: 'tempo', metrica: 'alcance', comparar: false }, { conta: '7', parados });
    expect(tempo).toContain('href="/app/accounts/7/conversations/386"');
    expect(tempo).toContain('href="/app/accounts/7/conversations/1340"');
    expect(tempo.match(/href=/g)).toHaveLength(2);
    expect(tempo).toContain('há 1 d 1 h');
    expect(funil.html(null, null, { vista: 'funil', metrica: 'alcance', comparar: false })).toContain('Carregando');
    expect(funil.html(null, null, { vista: 'funil', metrica: 'alcance', comparar: false }, { erro: true })).toContain('original segue abaixo');
  });

  test('a comparacao mostra o periodo anterior nos quadros e na tabela', () => {
    const atual = funil.montar({ funil: PERSIANAS, novos: 195 });
    const antes = funil.montar({ funil: { ...PERSIANAS, steps: PERSIANAS.steps.map((s) => ({ ...s, entered_count: Math.round(s.entered_count / 2) })) }, novos: 100 });
    const quadros = funil.html(atual, antes, { vista: 'funil', metrica: 'alcance', comparar: true });
    expect(quadros).toContain('+95%');
    expect(quadros).toContain('antes: 100');
    expect(funil.html(atual, antes, { vista: 'tabela', metrica: 'alcance', comparar: true })).toContain('Chegaram antes');
  });

  test('a exportacao abre no Excel em portugues: ponto e virgula, aspas dobradas, saidas no fim', () => {
    const m = funil.montar({ funil: { currency: 'BRL', steps: [passo(1, 'Novo; "Lead"', 0, 3), passo(2, 'Proposta', 10, 4), passo(3, 'Pendente', 2, 5)] }, novos: 20 });
    const linhas = funil.csv(m, null).split('\r\n');
    expect(linhas[0]).toBe('Etapa;Chegaram;Entradas;Agora;Avançam;Do topo;Metade sai em;Tempo médio;9 em 10 saem em;Parado em média há');
    expect(linhas[1]!.startsWith('"Novo; ""Lead""";20;0;3;50%;100%')).toBe(true);
    expect(linhas[3]!.startsWith('Pendente;;2;5;')).toBe(true);
    expect(linhas).toHaveLength(4);
  });
});

describe('ordem padrao do kanban', () => {
  const ordem = carregar('panel/chatwoot-ordem.js', '__p12Ordem') as {
    ordensAGravar(r: unknown): { mapa: Record<string, { sort: string; order: string }>; faltou: string[] } | null;
  };

  test('funil sem escolha ganha ultima atividade decrescente; a escolha do atendente fica', () => {
    const r = ordem.ordensAGravar({
      boards: [{ id: 13 }, { id: 14 }],
      preferences: { task_sorting: { 13: { sort: 'created_at', order: 'asc' } } },
    });
    expect(r).toEqual({
      mapa: { 13: { sort: 'created_at', order: 'asc' }, 14: { sort: 'updated_at', order: 'desc' } },
      faltou: ['14'],
    });
  });

  test('nada a gravar quando todo funil ja tem ordem, ou quando a resposta veio vazia', () => {
    expect(ordem.ordensAGravar({ boards: [{ id: 1 }], preferences: { task_sorting: { 1: { sort: 'position', order: 'desc' } } } })).toBeNull();
    expect(ordem.ordensAGravar({ boards: [], preferences: {} })).toBeNull();
    expect(ordem.ordensAGravar(null)).toBeNull();
  });
});

describe('arquivos do painel', () => {
  test('cada arquivo compila sozinho e todos juntos, na ordem em que a rota entrega', () => {
    const arquivos = ['panel/chatwoot-marca.js', 'panel/chatwoot-categorias.js', 'panel/chatwoot-ordem.js', 'panel/chatwoot-funil.js'].map((a) => readFileSync(a, 'utf8'));
    for (const a of arquivos) expect(() => new vm.Script(a)).not.toThrow();
    expect(() => new vm.Script(arquivos.join('\n;\n'))).not.toThrow();
  });
});
