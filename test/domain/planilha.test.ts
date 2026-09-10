import { describe, test, expect } from 'vitest';
import { CAMPOS_PLANILHA, montarLinha, colunaParaIndice, indiceParaColuna, idDaPlanilha, type Mapa } from '../../src/domain/planilha';

const dados = {
  timestamp: '2026-09-09 14:32:05',
  data: '09/09/2026',
  hora: '14:32:05',
  canal: 'Google Ads · Search',
  plataforma: 'google',
  protocolo: 'PERSI-MTN0F6ANNIUP',
  nome: 'Amanda Constantino',
  telefone: '+5511971036500',
  email: 'amanda@teste.com',
  campanha: 'cortinas_blackout',
  etapa: 'Novo Lead',
  conversao: 'conversa',
  valor: '10',
};

describe('colunaParaIndice', () => {
  test('A e a primeira', () => expect(colunaParaIndice('A')).toBe(0));
  test('Z e a vigesima sexta', () => expect(colunaParaIndice('Z')).toBe(25));
  test('AA vem depois de Z', () => expect(colunaParaIndice('AA')).toBe(26));
  test('AB vem depois de AA', () => expect(colunaParaIndice('AB')).toBe(27));
  test('minuscula vale igual', () => expect(colunaParaIndice('c')).toBe(2));
  test('o que nao e coluna devolve -1', () => {
    expect(colunaParaIndice('')).toBe(-1);
    expect(colunaParaIndice('A1')).toBe(-1);
    expect(colunaParaIndice('3')).toBe(-1);
  });
});

describe('montarLinha', () => {
  test('cada campo vai para a coluna escolhida', () => {
    const mapa: Mapa = [
      { coluna: 'A', campo: 'timestamp' },
      { coluna: 'B', campo: 'nome' },
      { coluna: 'C', campo: 'telefone' },
    ];
    expect(montarLinha(mapa, dados)).toEqual([
      '2026-09-09 14:32:05', 'Amanda Constantino', '+5511971036500',
    ]);
  });

  test('coluna pulada vira vazio, nao desloca as outras', () => {
    // sem isto o dado da coluna D apareceria na B, silenciosamente
    const mapa: Mapa = [
      { coluna: 'A', campo: 'nome' },
      { coluna: 'D', campo: 'canal' },
    ];
    expect(montarLinha(mapa, dados)).toEqual(['Amanda Constantino', '', '', 'Google Ads · Search']);
  });

  test('a ordem do cadastro nao importa: a letra manda', () => {
    const mapa: Mapa = [
      { coluna: 'C', campo: 'telefone' },
      { coluna: 'A', campo: 'nome' },
    ];
    expect(montarLinha(mapa, dados)).toEqual(['Amanda Constantino', '', '+5511971036500']);
  });

  test('campo sem valor vira vazio, nunca "null" escrito', () => {
    const mapa: Mapa = [{ coluna: 'A', campo: 'email' }];
    expect(montarLinha(mapa, { ...dados, email: null })).toEqual(['']);
    expect(montarLinha(mapa, {})).toEqual(['']);
  });

  test('campo que nao existe nao derruba a linha', () => {
    const mapa: Mapa = [{ coluna: 'A', campo: 'inventado' }, { coluna: 'B', campo: 'nome' }];
    expect(montarLinha(mapa, dados)).toEqual(['', 'Amanda Constantino']);
  });

  test('coluna invalida e ignorada em vez de virar coluna 0', () => {
    // cair no indice 0 sobrescreveria o primeiro campo do mapa
    const mapa: Mapa = [{ coluna: 'A', campo: 'nome' }, { coluna: '??', campo: 'telefone' }];
    expect(montarLinha(mapa, dados)).toEqual(['Amanda Constantino']);
  });

  test('mapa vazio nao escreve linha nenhuma', () => {
    expect(montarLinha([], dados)).toEqual([]);
  });

  test('o mesmo campo pode ir para duas colunas', () => {
    const mapa: Mapa = [{ coluna: 'A', campo: 'nome' }, { coluna: 'B', campo: 'nome' }];
    expect(montarLinha(mapa, dados)).toEqual(['Amanda Constantino', 'Amanda Constantino']);
  });
});

describe('CAMPOS_PLANILHA', () => {
  test('oferece data e hora separadas, alem do timestamp', () => {
    const nomes = CAMPOS_PLANILHA.map((c) => c.campo);
    expect(nomes).toContain('timestamp');
    expect(nomes).toContain('data');
    expect(nomes).toContain('hora');
  });

  test('oferece o canal do anuncio', () => {
    expect(CAMPOS_PLANILHA.map((c) => c.campo)).toContain('canal');
  });

  test('todo campo tem rotulo legivel para a tela', () => {
    for (const c of CAMPOS_PLANILHA) expect(c.rotulo.length).toBeGreaterThan(2);
  });
});

describe('idDaPlanilha', () => {
  const ID = '1_FUKAUvlr1O8O2jMJCVbcdsWXUdjRMvDJo8fSHmQPBw';

  test('extrai da URL inteira, que e o que se cola', () => {
    expect(idDaPlanilha(`https://docs.google.com/spreadsheets/d/${ID}/edit?gid=149#gid=149`)).toBe(ID);
  });

  test('URL sem o /edit tambem serve', () => {
    expect(idDaPlanilha(`https://docs.google.com/spreadsheets/d/${ID}`)).toBe(ID);
  });

  test('o id sozinho passa direto', () => {
    expect(idDaPlanilha(ID)).toBe(ID);
  });

  test('espaco em volta nao atrapalha', () => {
    expect(idDaPlanilha(`  ${ID}  `)).toBe(ID);
  });

  test('o que nao e planilha devolve null em vez de virar id invalido', () => {
    expect(idDaPlanilha('https://docs.google.com/document/d/abc/edit')).toBeNull();
    expect(idDaPlanilha('planilha do cliente')).toBeNull();
    expect(idDaPlanilha('')).toBeNull();
    expect(idDaPlanilha(null)).toBeNull();
  });
});

describe('indiceParaColuna', () => {
  test('e o caminho de volta de colunaParaIndice', () => {
    for (const letra of ['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA']) {
      expect(indiceParaColuna(colunaParaIndice(letra))).toBe(letra);
    }
  });

  test('a primeira coluna e A, nao vazio', () => expect(indiceParaColuna(0)).toBe('A'));
  test('a 27a e AA', () => expect(indiceParaColuna(26)).toBe('AA'));
  test('indice invalido devolve vazio em vez de letra errada', () => {
    expect(indiceParaColuna(-1)).toBe('');
    expect(indiceParaColuna(1.5)).toBe('');
  });
});
