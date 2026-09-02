import { describe, test, expect } from 'vitest';
import { lerCliques, parseCsv, parseData } from '../../src/domain/importCliques';

describe('parseCsv', () => {
  test('virgula dentro de aspas nao separa campo', () => {
    // o user_agent real tem virgula: "Mozilla/5.0 (Linux; Android 10, SM-A105M)"
    const r = parseCsv('a,b\n"x, y",z\n');
    expect(r[1]).toEqual(['x, y', 'z']);
  });

  test('aspas escapadas viram uma aspa', () => {
    expect(parseCsv('a\n"diz ""oi"""\n')[1]).toEqual(['diz "oi"']);
  });

  test('quebra de linha dentro do campo nao quebra o registro', () => {
    const r = parseCsv('a,b\n"linha1\nlinha2",z\n');
    expect(r.length).toBe(2);
    expect(r[1]![0]).toBe('linha1\nlinha2');
  });

  test('descarta linha vazia do fim da planilha', () => {
    expect(parseCsv('a,b\n1,2\n,\n\n').length).toBe(2);
  });

  test('come o BOM que o Sheets exporta', () => {
    expect(parseCsv('﻿protocol,x\n')[0]![0]).toBe('protocol');
  });
});

describe('lerCliques', () => {
  const cab = 'protocol,phone_number,lead_name,email,gclid,utm_source,utm_campaign,created_at';

  test('le a linha e normaliza telefone e e-mail', () => {
    const r = lerCliques(`${cab}\nVITA-1,(19) 99146-0270,Ana,A.Silva+x@GoogleMail.com,Cj0,google,black-friday,2026-08-05T12:00:00Z\n`);
    const l = r.linhas[0]!;
    expect(l.protocol).toBe('VITA-1');
    expect(l.phoneE164).toBe('+5519991460270');
    expect(l.phoneKey).toBe('1999146027'.slice(0, 2) + '91460270');
    expect(l.email).toBe('asilva@gmail.com');
    expect(l.utmSource).toBe('google');
  });

  test('linha sem protocolo e descartada, nao chutada', () => {
    // sem protocolo nao ha chave: gravar criaria lead orfao
    const r = lerCliques(`${cab}\n,11999999999,Ana,,,,,\nVITA-2,,,,,,,\n`);
    expect(r.linhas.map((l) => l.protocol)).toEqual(['VITA-2']);
    expect(r.semProtocolo).toBe(1);
  });

  test('protocolo repetido fica na primeira ocorrencia', () => {
    const r = lerCliques(`${cab}\nVITA-3,111,Primeiro,,,,,\nVITA-3,222,Segundo,,,,,\n`);
    expect(r.linhas.length).toBe(1);
    expect(r.linhas[0]!.nome).toBe('Primeiro');
    expect(r.duplicados).toBe(1);
  });

  test('macro do GTM nao resolvida vira null', () => {
    // `{campaignname}` chegou assim porque o modelo de URL do anuncio ficou em
    // branco; guardar o literal poluiria o relatorio por campanha
    const r = lerCliques(`${cab}\nVITA-4,,,,,google,{campaignname},\n`);
    expect(r.linhas[0]!.utmCampaign).toBeNull();
    expect(r.linhas[0]!.utmSource).toBe('google');
    expect(r.macrosNulados).toBe(1);
  });

  test('coluna repetida: vale a primeira preenchida', () => {
    // a Locadora repete `origem` e `event`; a Taina repete `valido`
    const r = lerCliques('protocol,origem,origem\nLOC-1,,clique\nLOC-2,formulario,clique\n');
    expect(r.linhas[0]!.origem).toBe('clique');
    expect(r.linhas[1]!.origem).toBe('formulario');
  });

  test('coluna ausente some sem quebrar', () => {
    // nenhuma das cinco planilhas tem todas as colunas
    const r = lerCliques('protocol\nTILE-1\n');
    expect(r.linhas[0]!.ipAddress).toBeNull();
    expect(r.linhas[0]!.quizValor).toBeNull();
    expect(r.linhas[0]!.phoneKey).toBeNull();
  });

  test('relata coluna que o schema nao conhece em vez de engolir', () => {
    const r = lerCliques('protocol,coluna_nova\nX-1,valor\n');
    expect(r.colunasIgnoradas).toEqual(['coluna_nova']);
  });

  test('valor em reais aceita os dois formatos', () => {
    const c = 'protocol,valor_proposta';
    expect(lerCliques(`${c}\nA,"1.234,56"\n`).linhas[0]!.valorProposta).toBe(1234.56);
    expect(lerCliques(`${c}\nA,"R$ 2.500,00"\n`).linhas[0]!.valorProposta).toBe(2500);
    expect(lerCliques(`${c}\nA,3000.50\n`).linhas[0]!.valorProposta).toBe(3000.5);
    expect(lerCliques(`${c}\nA,\n`).linhas[0]!.valorProposta).toBeNull();
    expect(lerCliques(`${c}\nA,texto\n`).linhas[0]!.valorProposta).toBeNull();
  });

  test('planilha so com cabecalho nao quebra', () => {
    const r = lerCliques(`${cab}\n`);
    expect(r.linhas).toEqual([]);
  });

  test('texto vazio nao quebra', () => {
    expect(lerCliques('').linhas).toEqual([]);
  });
});

describe('parseData', () => {
  test('ISO do coletor', () => {
    expect(parseData('2026-08-05T12:09:30.970Z')).toBe('2026-08-05 12:09:30');
  });

  test('formato brasileiro do Sheets: dia primeiro, sempre', () => {
    // 227 das 365 linhas vem assim; `new Date()` devolve Invalid Date em todas
    expect(parseData('13/08/2026 11:47:03')).toBe('2026-08-13 11:47:03');
    // o caso perigoso: 05/08 e' 5 de agosto, nao 8 de maio
    expect(parseData('05/08/2026 09:00:00')).toBe('2026-08-05 09:00:00');
  });

  test('aceita sem hora e sem segundos', () => {
    expect(parseData('01/09/2026')).toBe('2026-09-01 00:00:00');
    expect(parseData('01/09/2026 07:30')).toBe('2026-09-01 07:30:00');
  });

  test('data que nao existe nao vira data', () => {
    // sem a checagem, 31/02 rolaria para 03/03 em silencio
    expect(parseData('31/02/2026')).toBeNull();
    expect(parseData('00/08/2026')).toBeNull();
    expect(parseData('13/13/2026')).toBeNull();
  });

  test('vazio e lixo devolvem null', () => {
    for (const v of ['', '   ', null, 'ontem', '—']) expect(parseData(v), String(v)).toBeNull();
  });
});

describe('linhas ORG-', () => {
  test('nao entram como clique', () => {
    // sao lead organico que o fluxo registrava na mesma aba: sem gclid, sem utm,
    // sem data. Importar como clique criaria atribuicao de anuncio inexistente.
    const r = lerCliques('protocol,gclid\nORG-19,\nVITA-1,Cj0\n');
    expect(r.linhas.map((l) => l.protocol)).toEqual(['VITA-1']);
    expect(r.organicos).toBe(1);
  });
});
