import { describe, test, expect } from 'vitest';
import {
  chaveCab, montarSeq, numeroDe, normSeq, lerData, lerHora, chaveDeOrdem,
  planejarNumeracao, planejarMovimentos, formatosPerdidos, corteDosAvisos,
} from '../../src/domain/sequencia';

const CFG = { prefixo: '', notificar: true };
const CAB = ['SEQUÊNCIA', 'DATA', 'HORA', 'NOME', 'TELEFONE'];

describe('formato da sequencia', () => {
  test('cabecalho compara sem acento e sem caixa', () => {
    expect(chaveCab(' Sequência ')).toBe('SEQUENCIA');
  });

  test('NN + MES, e PREFIXO + MES + NN quando ha prefixo', () => {
    expect(montarSeq('', 7, 11)).toBe('07NOV');
    expect(montarSeq('', 123, 1)).toBe('123JAN');
    expect(montarSeq('PL', 7, 11)).toBe('PLNOV07');
  });

  test('le o numero de uma sequencia escrita e recusa o que nao e sequencia', () => {
    expect(numeroDe('', '07NOV')).toBe(7);
    expect(numeroDe('', ' 103out ')).toBe(103);
    expect(numeroDe('', 'NOV07')).toBeNull();
    expect(numeroDe('', '')).toBeNull();
    expect(numeroDe('PL', 'PLNOV07')).toBe(7);
    expect(numeroDe('PL', '07NOV')).toBeNull();
  });

  test('conserta a sequencia que o Sheets transformou em data', () => {
    expect(normSeq('', '22 de ago.')).toBe('22AGO');
    expect(normSeq('', '22ago.')).toBe('22AGO');
    expect(normSeq('', '7set')).toBe('07SET');
    expect(normSeq('', '07NOV')).toBe('07NOV');
    expect(normSeq('', '  ')).toBe('');
  });
});

describe('data e hora como a aba mostra', () => {
  test('data com um ou dois digitos e ano curto', () => {
    expect(lerData('1/8/2026')).toMatchObject({ ano: '2026', mes: '08', dia: '01', mesNum: 8 });
    expect(lerData('11/11/26')).toMatchObject({ ano: '2026', mes: '11', dia: '11' });
    expect(lerData('11/11/2026 14:33:00')).toMatchObject({ ano: '2026', mes: '11', dia: '11' });
  });

  test('o que nao e data nao vira data', () => {
    expect(lerData('')).toBeNull();
    expect(lerData('46337')).toBeNull();
    expect(lerData('2026-11-11')).toBeNull();
    expect(lerData('11/13/2026')).toBeNull();
  });

  test('hora de um digito nao passa na frente da tarde', () => {
    expect(lerHora('9:05:00')).toBe('090500');
    expect(lerHora('14:33')).toBe('143300');
    expect(lerHora('30/12/1899')).toBe('000000');
    expect(chaveDeOrdem(['', '11/11/2026', '9:05:00'], 1, 2) < chaveDeOrdem(['', '11/11/2026', '14:33:05'], 1, 2)).toBe(true);
  });
});

describe('planejarNumeracao', () => {
  test('continua do maior numero do mes e numera da mais antiga para a mais nova', () => {
    const plano = planejarNumeracao(CFG, [
      CAB,
      ['', '11/11/2026', '15:00:00', 'Bia', '5511988880002'],
      ['', '11/11/2026', '09:00:00', 'Ana', '5511988880001'],
      ['05NOV', '10/11/2026', '10:00:00', 'Caio', '5511988880003'],
      ['02NOV', '03/11/2026', '10:00:00', 'Davi', '5511988880004'],
    ], '20261104');
    if ('motivo' in plano) throw new Error(plano.motivo);
    expect(plano.novas.map((n) => [n.linha, n.sequencia, n.dados.NOME])).toEqual([
      [3, '06NOV', 'Ana'],
      [2, '07NOV', 'Bia'],
    ]);
    expect(plano.celulas).toEqual([{ linha: 3, valor: '06NOV' }, { linha: 2, valor: '07NOV' }]);
  });

  test('cada mes tem a sua contagem, e o mes sem numero comeca em 01', () => {
    const plano = planejarNumeracao(CFG, [
      CAB,
      ['', '01/12/2026', '08:00:00', 'Eva', ''],
      ['', '30/11/2026', '23:00:00', 'Fabio', ''],
      ['41NOV', '29/11/2026', '10:00:00', 'Gil', ''],
    ], '20261101');
    if ('motivo' in plano) throw new Error(plano.motivo);
    expect(plano.novas.map((n) => n.sequencia)).toEqual(['42NOV', '01DEZ']);
  });

  test('buraco na numeracao nao e fechado', () => {
    const plano = planejarNumeracao(CFG, [
      CAB,
      ['', '11/11/2026', '15:00:00', 'Bia', ''],
      ['09NOV', '10/11/2026', '10:00:00', 'Caio', ''],
      ['03NOV', '03/11/2026', '10:00:00', 'Davi', ''],
    ], '20261104');
    if ('motivo' in plano) throw new Error(plano.motivo);
    expect(plano.novas[0]!.sequencia).toBe('10NOV');
  });

  test('o aviso leva a linha como a aba mostra, mais a sequencia nova', () => {
    const plano = planejarNumeracao(CFG, [
      CAB,
      ['', '11/11/2026', '15:00:00', 'Bia', '5511988880002'],
    ], '20261104');
    if ('motivo' in plano) throw new Error(plano.motivo);
    expect(plano.novas[0]).toEqual({
      linha: 2,
      sequencia: '01NOV',
      avisar: true,
      dados: {
        'SEQUÊNCIA': '', DATA: '11/11/2026', HORA: '15:00:00', NOME: 'Bia', TELEFONE: '5511988880002',
        SEQUENCIA: '01NOV',
      },
    });
  });

  test('linha antiga e numerada mas nao avisa; notificar desligado tambem nao', () => {
    const linhas = [CAB, ['', '01/10/2026', '15:00:00', 'Velho', ''], ['', '11/11/2026', '15:00:00', 'Novo', '']];
    const plano = planejarNumeracao(CFG, linhas, '20261104');
    if ('motivo' in plano) throw new Error(plano.motivo);
    expect(plano.novas.map((n) => [n.sequencia, n.avisar])).toEqual([['01OUT', false], ['01NOV', true]]);

    const mudo = planejarNumeracao({ prefixo: '', notificar: false }, linhas, '20261104');
    if ('motivo' in mudo) throw new Error(mudo.motivo);
    expect(mudo.novas.every((n) => !n.avisar)).toBe(true);
  });

  test('sequencia que virou data e reescrita e conta para o maior do mes', () => {
    const plano = planejarNumeracao(CFG, [
      CAB,
      ['', '23/08/2026', '10:00:00', 'Novo', ''],
      ['22 de ago.', '22/08/2026', '10:00:00', 'Antigo', ''],
    ], '20261104');
    if ('motivo' in plano) throw new Error(plano.motivo);
    expect(plano.celulas).toEqual([{ linha: 3, valor: '22AGO' }, { linha: 2, valor: '23AGO' }]);
  });

  test('linha sem data fica como esta; aba ja numerada nao gera escrita', () => {
    const plano = planejarNumeracao(CFG, [
      CAB,
      ['', '', '', 'Rascunho', ''],
      ['01NOV', '02/11/2026', '10:00:00', 'Ana', ''],
      ['', 'amanha', '', 'Texto', ''],
    ], '20261104');
    if ('motivo' in plano) throw new Error(plano.motivo);
    expect(plano.celulas).toEqual([]);
    expect(plano.novas).toEqual([]);
  });

  test('linha curta (celulas vazias no fim cortadas pelo Sheets) e numerada', () => {
    const plano = planejarNumeracao(CFG, [['DATA', 'NOME', 'SEQUENCIA'], ['11/11/2026', 'Ana']], '20261104');
    if ('motivo' in plano) throw new Error(plano.motivo);
    expect(plano.celulas).toEqual([{ linha: 2, valor: '01NOV' }]);
    expect(plano.novas[0]!.dados).toEqual({ DATA: '11/11/2026', NOME: 'Ana', SEQUENCIA: '01NOV' });
  });

  test('sem DATA ou sem SEQUENCIA diz o motivo', () => {
    expect(planejarNumeracao(CFG, [['NOME', 'SEQUENCIA']], '20261104')).toEqual({ motivo: 'sem a coluna DATA' });
    expect(planejarNumeracao(CFG, [['NOME', 'DATA']], '20261104')).toEqual({ motivo: 'sem a coluna SEQUENCIA' });
  });

  test('com prefixo, so conta as sequencias do proprio prefixo', () => {
    const plano = planejarNumeracao({ prefixo: 'PL', notificar: true }, [
      CAB,
      ['', '11/11/2026', '15:00:00', 'Novo', ''],
      ['PLNOV04', '10/11/2026', '10:00:00', 'A', ''],
      ['09NOV', '09/11/2026', '10:00:00', 'B', ''],
    ], '20261104');
    if ('motivo' in plano) throw new Error(plano.motivo);
    expect(plano.novas[0]!.sequencia).toBe('PLNOV05');
  });
});

/** O que o Sheets faz num moveDimension de uma linha: sai de `de`, entra antes de `para`. */
function aplicar<T>(lista: T[], movimentos: Array<{ de: number; para: number }>): T[] {
  const l = [...lista];
  for (const { de, para } of movimentos) {
    const x = l.splice(de, 1)[0] as T;
    l.splice(para > de ? para - 1 : para, 0, x);
  }
  return l;
}

const emOrdem = (chaves: string[]) => chaves.every((k, i) => i === 0 || chaves[i - 1]! >= k);

describe('planejarMovimentos', () => {
  test('aba em ordem nao move nada', () => {
    expect(planejarMovimentos(['3', '2', '2', '1', ''])).toEqual([]);
    expect(planejarMovimentos([])).toEqual([]);
  });

  test('lead novo no fim da aba sobe com um movimento so', () => {
    const chaves = ['5', '4', '3', '2', '9'];
    const m = planejarMovimentos(chaves);
    expect(m).toEqual([{ de: 4, para: 0 }]);
    expect(aplicar(chaves, m)).toEqual(['9', '5', '4', '3', '2']);
  });

  test('linha antiga no topo desce com um movimento so', () => {
    const chaves = ['1', '5', '4', '3', '2'];
    const m = planejarMovimentos(chaves);
    expect(m).toHaveLength(1);
    expect(aplicar(chaves, m)).toEqual(['5', '4', '3', '2', '1']);
  });

  test('linha sem data vai para o fim e empate mantem a ordem da aba', () => {
    const linhas = [{ k: '', n: 'vazia' }, { k: '2', n: 'a' }, { k: '2', n: 'b' }, { k: '3', n: 'c' }];
    const m = planejarMovimentos(linhas.map((l) => l.k));
    expect(aplicar(linhas, m).map((l) => l.n)).toEqual(['c', 'a', 'b', 'vazia']);
  });

  test('qualquer embaralhamento termina em ordem, com o minimo de movimentos', () => {
    let semente = 42;
    const sorteio = () => (semente = (semente * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let caso = 0; caso < 300; caso++) {
      const n = 1 + Math.floor(sorteio() * 40);
      const chaves = Array.from({ length: n }, () => (sorteio() < 0.1 ? '' : String(10 + Math.floor(sorteio() * 15))));
      const m = planejarMovimentos(chaves, 1000);
      const depois = aplicar(chaves.map((k, i) => ({ k, i })), m);
      expect(emOrdem(depois.map((l) => l.k))).toBe(true);
      // empate mantem a ordem original
      depois.forEach((l, p) => {
        if (p && depois[p - 1]!.k === l.k) expect(depois[p - 1]!.i).toBeLessThan(l.i);
      });
      expect(m.length).toBeLessThan(n);
    }
  });

  test('o teto corta a rodada e as rodadas seguintes terminam o servico', () => {
    let chaves = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'];
    let rodadas = 0;
    for (; rodadas < 10 && !emOrdem(chaves); rodadas++) {
      const m = planejarMovimentos(chaves, 3);
      expect(m.length).toBeLessThanOrEqual(3);
      chaves = aplicar(chaves, m);
    }
    expect(emOrdem(chaves)).toBe(true);
    expect(rodadas).toBe(3);
  });
});

describe('formatosPerdidos', () => {
  test('acha a hora que virou 30/12/1899 e a data que virou numero', () => {
    expect(formatosPerdidos([CAB, ['01NOV', '11/11/2026', '30/12/1899', 'Ana', '']])).toEqual({ data: false, hora: true });
    expect(formatosPerdidos([CAB, ['01NOV', '46337', '10:00:00', 'Ana', '']])).toEqual({ data: true, hora: false });
    expect(formatosPerdidos([CAB, ['01NOV', '11/11/2026', '10:00:00', 'Ana', '']])).toEqual({ data: false, hora: false });
  });
});

test('o corte dos avisos e no dia de Sao Paulo, nao no UTC', () => {
  // 02:00 UTC de 12/11 ainda e' 23:00 de 11/11 em Sao Paulo
  expect(corteDosAvisos(new Date('2026-11-12T02:00:00Z'), 7)).toBe('20261104');
  expect(corteDosAvisos(new Date('2026-11-12T12:00:00Z'), 0)).toBe('20261112');
});
