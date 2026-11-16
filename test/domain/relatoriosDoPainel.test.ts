import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/* eslint-disable @typescript-eslint/no-explicit-any */
function carregar(): any {
  const janela: Record<string, any> = {};
  const codigo = readFileSync('panel/chatwoot-funil.js', 'utf8') + '\n;\n' + readFileSync('panel/chatwoot-relatorios.js', 'utf8');
  vm.runInNewContext(codigo, { window: janela, setTimeout });
  return janela;
}
const j = (x: unknown) => JSON.parse(JSON.stringify(x));
const w = carregar();
const R = w.__p12Relatorios;
const F = w.__p12Funil;

describe('periodo', () => {
  const agora = new Date(2026, 10, 16, 15, 30); // 16/11/2026

  test('30 dias vai de 30 dias atras ate o fim de hoje, e o anterior tem o mesmo tamanho', () => {
    const p = R.periodoDe('30d', agora);
    expect(p.dias).toBe(30);
    expect(p.de).toBe('2026-10-18');
    expect(p.ate).toBe('2026-11-16');
    const a = R.periodoAnterior(p);
    expect(a.until).toBe(p.since - 1);
    expect(a.until - a.since + 1).toBe(p.until - p.since + 1);
  });

  test('hoje, 7 dias, este mes e mes passado', () => {
    expect(R.periodoDe('hoje', agora).dias).toBe(1);
    expect(R.periodoDe('7d', agora).de).toBe('2026-11-10');
    expect(R.periodoDe('mes', agora).de).toBe('2026-11-01');
    const mp = R.periodoDe('mespassado', agora);
    expect([mp.de, mp.ate, mp.dias]).toEqual(['2026-10-01', '2026-10-31', 31]);
  });

  test('personalizado vale; datas ruins voltam para 30 dias', () => {
    expect(R.periodoDe('custom', agora, '2026-11-01', '2026-11-03').dias).toBe(3);
    expect(R.periodoDe('custom', agora, '2026-11-05', '2026-11-03').chave).toBe('30d');
    expect(R.periodoDe('custom', agora, 'x', 'y').chave).toBe('30d');
    expect(R.periodoDe('qualquer', agora).chave).toBe('30d');
  });
});

describe('filtros na URL', () => {
  test('vai e volta, e so escreve o que foge do padrao', () => {
    expect(R.filtrosParaUrl(R.filtrosDaUrl(''))).toBe('');
    const f = R.filtrosDaUrl('?periodo=7d&funil=14&etiqueta=87&comparar=0&visao=funil');
    expect(j(f)).toMatchObject({ periodo: '7d', funil: '14', etiqueta: '87', comparar: false, visao: 'funil' });
    expect(R.filtrosParaUrl(f)).toBe('?periodo=7d&funil=14&etiqueta=87&comparar=0&visao=funil');
  });

  test('o endereco vence o que o navegador lembrou', () => {
    const f = R.filtrosDaUrl('?periodo=hoje', { periodo: '7d', funil: '13', comparar: false });
    expect(f.periodo).toBe('hoje');
    expect(f.funil).toBe('13');
    expect(f.comparar).toBe(false);
  });

  test('lixo na URL cai no padrao; so uma dimensao do Chatwoot vale', () => {
    const f = R.filtrosDaUrl('?periodo=ontem&visao=hack&funil=abc&caixa=18&atendente=4&etiqueta=9');
    expect(j(f)).toMatchObject({ periodo: '30d', visao: 'geral', funil: '', atendente: '4', caixa: '', etiqueta: '' });
    expect(j(R.dimensaoDe(f))).toEqual({ type: 'agent', id: '4' });
    expect(j(R.dimensaoDe(R.filtrosDaUrl('')))).toEqual({ type: 'account', id: null });
    expect(R.filtrosDaUrl('?periodo=custom&de=2026-11-01').periodo).toBe('30d');
  });
});

describe('series', () => {
  test('o dia e o do fuso do cliente (meia-noite local = 03:00 UTC em -3)', () => {
    const meiaNoite = Date.UTC(2026, 10, 16, 3) / 1000;
    const s = j(R.serieDiaria([{ timestamp: meiaNoite, value: 5 }, { timestamp: meiaNoite - 86400, value: 2 }], -3));
    expect(s).toEqual([{ dia: '2026-11-15', v: 2 }, { dia: '2026-11-16', v: 5 }]);
  });

  test('alinha aos dias do periodo e preenche com zero', () => {
    expect(j(R.alinhar([{ dia: '2026-11-02', v: 4 }], ['2026-11-01', '2026-11-02', '2026-11-03']))).toEqual([0, 4, 0]);
    expect(R.diasDoPeriodo({ de: '2026-11-01', ate: '2026-11-03' })).toHaveLength(3);
  });

  test('mapa de calor: dia da semana por hora, segunda primeiro', () => {
    // 2026-11-16 foi segunda: 14:00 local = 17:00 UTC
    const ts = Date.UTC(2026, 10, 16, 17) / 1000;
    const m = j(R.mapaDeCalor([{ timestamp: ts, value: 7 }, { timestamp: ts + 3600, value: 3 }], -3));
    expect(m.linhas[0].dia).toBe('seg');
    expect(m.linhas[0].horas[14]).toBe(7);
    expect(m.linhas[0].horas[15]).toBe(3);
    expect(m.melhor).toEqual({ dia: 'seg', hora: 14, v: 7 });
    expect(m.total).toBe(10);
    expect(R.mapaDeCalor([], -3).horaForte).toBeNull();
  });

  test('escala redonda para o eixo', () => {
    expect(j(R.escalaDe(0))).toEqual({ max: 4, passo: 1 });
    expect(R.escalaDe(37).max).toBeGreaterThanOrEqual(37);
    expect(R.escalaDe(37).max % R.escalaDe(37).passo).toBe(0);
    expect(R.escalaDe(1000).max).toBe(1000);
  });
});

describe('variacao e numeros-chave', () => {
  test('tempo de resposta menor e bom; mais conversa e bom', () => {
    expect(j(R.variacao(10, 20, true))).toMatchObject({ sinal: -1, bom: true });
    expect(j(R.variacao(30, 20, true))).toMatchObject({ sinal: 1, bom: false });
    expect(j(R.variacao(30, 20))).toMatchObject({ texto: '+50%', bom: true });
    expect(R.variacao(5, null)).toBeNull();
  });

  const resumo = {
    atual: { conversations_count: 333, incoming_messages_count: 4235, outgoing_messages_count: 4703, avg_first_response_time: 10561, resolutions_count: 0 },
    anterior: { conversations_count: 422, incoming_messages_count: 5215, outgoing_messages_count: 5607, avg_first_response_time: 24831 },
  };

  test('sem CRM: nada de "Leads novos", e as conversas dizem que fazem esse papel', () => {
    const k = j(R.kpis({ resumo, temCrm: false, comparar: true }));
    expect(k.map((x: any) => x.id)).not.toContain('leads');
    expect(k.find((x: any) => x.id === 'conversas').apoio).toMatch(/sem CRM/);
    expect(k.find((x: any) => x.id === 'conversas').var.texto).toBe('−21%');
    expect(k.find((x: any) => x.id === 'resposta').var.bom).toBe(true);
    expect(k.find((x: any) => x.id === 'resposta').apoio).toMatch(/noite e fim de semana/);
  });

  test('nunca mostra "resolvidas"; com CRM, leads vem primeiro; sem comparar, sem variacao', () => {
    const k = j(R.kpis({ resumo, temCrm: true, leads: { total: 120 }, leadsAnt: { total: 100 }, comparar: false }));
    expect(k[0].id).toBe('leads');
    expect(k.every((x: any) => !/resolvid/i.test(x.rotulo))).toBe(true);
    expect(k.every((x: any) => x.var == null)).toBe(true);
  });

  test('conversao do topo ao fim vem do funil reaproveitado', () => {
    const passo = (id: number, name: string, e: number, a: number) => ({ step_id: id, name, color: '#60a5fa', status: 'open', entered_count: e, current_count: a });
    const m = F.montar({ funil: { steps: [passo(1, 'Novo', 100, 10), passo(2, 'Qualificando', 50, 20), { ...passo(3, 'Fechado', 10, 5), status: 'completed' }] }, novos: 100 });
    const k = j(R.kpis({ resumo, temCrm: false, funil: m, comparar: false }));
    expect(k.find((x: any) => x.id === 'conversao').valor).toBe('10%');
    expect(k.find((x: any) => x.id === 'andamento').valor).toBe('30');
  });
});

describe('alertas', () => {
  const base = { conta: 7, quadro: 13, agora: { unattended: 321, open: 1004, unassigned: 1004 }, esperaMaisAntiga: 3 * 86400 };

  test('sem resposta vem primeiro, com a espera mais antiga e o link da lista certa', () => {
    const a = j(R.alertas({ ...base, caixas: [{ nome: 'Site', conversas: 0 }], atendentes: { todosSemAtividade: true, abertas: 1004 } }));
    expect(a[0]).toMatchObject({ id: 'semresposta', nivel: 'alto', href: '/app/accounts/7/unattended/conversations' });
    expect(a[0].detalhe).toMatch(/3 d/);
    expect(a.map((x: any) => x.id)).toEqual(['semresposta', 'caixaSite', 'sematendente']);
  });

  test('funil: lead parado na primeira etapa, card velho e maior perda', () => {
    const passo = (id: number, name: string, e: number, a: number) => ({ step_id: id, name, color: '#60a5fa', status: 'open', entered_count: e, current_count: a });
    const m = F.montar({
      funil: { steps: [passo(1, 'Novo Lead', 100, 3), passo(2, 'Proposta', 20, 40)] },
      envelhecimento: { steps_summary: [{ step_id: 2, avg_age_seconds: 40 * 86400, max_age_seconds: 90 * 86400 }] },
      novos: 100,
    });
    const a = j(R.alertas({ conta: 7, quadro: 13, agora: { unattended: 0, open: 0, unassigned: 0 }, funil: m, caixas: [] }));
    expect(a.map((x: any) => x.id).sort()).toEqual(['gargalo', 'novos', 'parados']);
    const parados = a.find((x: any) => x.id === 'parados');
    expect(parados.nivel).toBe('alto');
    expect(parados.href).toBe('/app/accounts/7/kanban/13');
    expect(a.find((x: any) => x.id === 'gargalo').visao).toBe('funil');
  });

  test('tudo em ordem: lista vazia', () => {
    expect(R.alertas({ conta: 7, agora: { unattended: 0, open: 5, unassigned: 0 }, caixas: [{ nome: 'x', conversas: 3 }] })).toHaveLength(0);
  });
});

describe('tabelas', () => {
  const linhas = [{ nome: 'b', conversas: 2, primeira: null }, { nome: 'a', conversas: 9, primeira: 60 }, { nome: 'c', conversas: 5, primeira: 30 }];

  test('ordena e deixa o vazio no fim, nos dois sentidos', () => {
    expect(j(R.ordenar(linhas, 'conversas', 'desc')).map((l: any) => l.nome)).toEqual(['a', 'c', 'b']);
    expect(j(R.ordenar(linhas, 'primeira', 'asc')).map((l: any) => l.nome)).toEqual(['c', 'a', 'b']);
    expect(j(R.ordenar(linhas, 'primeira', 'desc')).map((l: any) => l.nome)).toEqual(['a', 'c', 'b']);
    expect(j(R.ordenar(linhas, 'nome', 'asc')).map((l: any) => l.nome)).toEqual(['a', 'b', 'c']);
  });

  test('coluna zerada em todas as linhas some (nada de "resolvidas: 0")', () => {
    const cols = [{ k: 'nome', r: 'Nome', t: 't' }, { k: 'conversas', r: 'Conversas', t: 'n' }, { k: 'resolvidas', r: 'Resolvidas', t: 'n' }];
    const rows = [{ nome: 'a', conversas: 4, resolvidas: 0 }, { nome: 'b', conversas: 1, resolvidas: 0 }];
    expect(j(R.colunasUteis(cols, rows)).map((c: any) => c.k)).toEqual(['nome', 'conversas']);
  });

  test('CSV com ponto e virgula, aspas e tempos legiveis', () => {
    const cols = [{ k: 'nome', r: 'Etiqueta', t: 't' }, { k: 'conversas', r: 'Conversas', t: 'n' }, { k: 'primeira', r: '1ª resposta', t: 'dur' }];
    const csv = R.csvDe(cols, [{ nome: 'a;"b"', conversas: 1234, primeira: 3700 }, { nome: 'c', conversas: 0, primeira: null }]);
    expect(csv.split('\r\n')).toEqual(['Etiqueta;Conversas;1ª resposta', '"a;""b""";1.234;1 h 2 min', 'c;0;']);
  });

  test('atendentes: junta a lista com o resumo, e quem nao aparece fica com zero', () => {
    const l = j(
      R.linhasDeAgentes(
        [{ id: 1, name: 'Ana', availability_status: 'online', role: 'administrator' }, { id: 2, name: 'Bia', availability_status: 'offline', role: 'agent' }],
        [{ id: 1, conversations_count: 3, avg_first_response_time: 120 }],
      ),
    );
    expect(l[0]).toMatchObject({ nome: 'Ana', status: 'Online', papel: 'Administrador', conversas: 3, primeira: 120 });
    expect(l[1]).toMatchObject({ nome: 'Bia', status: 'Offline', conversas: 0, primeira: null });
  });
});

describe('desenho', () => {
  const H = R.html;

  test('texto de fora entra escapado em alerta, ranking e tabela', () => {
    const ruim = '<img src=x onerror=alert(1)>';
    expect(H.alertas([{ id: 'a', nivel: 'alto', titulo: ruim, detalhe: ruim, href: '/x' }], false)).not.toContain('<img');
    expect(H.ranking([{ nome: ruim, valor: 3 }])).not.toContain('<img');
    expect(H.tabela('t', [{ k: 'nome', r: ruim, t: 't' }], [{ nome: ruim }], null)).not.toContain('<img');
  });

  test('alertas vazios explicam; grafico de linhas tem um ponto de toque por dia', () => {
    expect(H.alertas([], false)).toMatch(/Nada pedindo ação/);
    const g = H.linhas(['2026-11-01', '2026-11-02', '2026-11-03'], [{ nome: 'Leads', cor: 'red', valores: [1, 5, 2], area: true }]);
    expect((g.match(/data-t=/g) || []).length).toBe(3);
    expect(g).toContain('<svg');
    expect(H.linhas([], [])).toBe('');
  });

  test('mapa de calor traz 7 linhas de 24 horas', () => {
    const m = R.mapaDeCalor([{ timestamp: 1794787200, value: 4 }], -3);
    expect((H.calor(m, 'mensagens').match(/data-t=/g) || []).length).toBe(7 * 24);
  });
});
