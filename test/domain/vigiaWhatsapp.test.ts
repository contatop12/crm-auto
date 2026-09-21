import { describe, test, expect } from 'vitest';
import {
  contarRecebidas,
  instanciaDoWebhook,
  diagnosticar,
  caixaParaCorrigir,
  planejarAvisos,
  horarioDeAviso,
  duracao,
  LEMBRAR_A_CADA_MS,
  type LeituraInstancia,
  type MensagemEvo,
  type EstadoVigia,
} from '../../src/domain/vigiaWhatsapp';

const msg = (over: Partial<MensagemEvo> & { jid?: string; ts?: number; eu?: boolean } = {}): MensagemEvo => ({
  key: { fromMe: over.eu ?? false, remoteJid: over.jid ?? '5511999990000@s.whatsapp.net' },
  messageType: over.messageType ?? 'conversation',
  messageTimestamp: over.ts ?? 1000,
});

describe('contarRecebidas', () => {
  test('conta so mensagem de cliente em conversa individual, dentro da janela', () => {
    const msgs = [
      msg({ ts: 1000 }),
      msg({ ts: 1001, jid: '123456789012345@lid' }), // endereco novo do WhatsApp conta
      msg({ ts: 1002, eu: true }), // resposta do time
      msg({ ts: 1003, jid: '120363000000000000@g.us' }), // grupo
      msg({ ts: 1004, jid: 'status@broadcast' }),
      msg({ ts: 1005, messageType: 'reactionMessage' }), // nao vira mensagem no Chatwoot
      msg({ ts: 999 }), // antes da janela
      msg({ ts: 2000 }), // fim da janela e' aberto
    ];
    expect(contarRecebidas(msgs, 1000, 2000)).toBe(2);
  });

  test('timestamp como texto (o Evolution as vezes devolve assim)', () => {
    expect(contarRecebidas([msg({ ts: '1500' as unknown as number })], 1000, 2000)).toBe(1);
  });
});

describe('instanciaDoWebhook', () => {
  test('decodifica o nome da instancia com acento e espaco', () => {
    expect(instanciaDoWebhook('https://evolution.x.com/chatwoot/webhook/Exatid%C3%A3o%2002')).toBe('Exatidão 02');
  });
  test('webhook que nao e do Evolution', () => {
    expect(instanciaDoWebhook('https://outro.com/hook')).toBeNull();
    expect(instanciaDoWebhook(null)).toBeNull();
  });
});

const base = (over: Partial<LeituraInstancia> = {}): LeituraInstancia => ({
  instancia: 'Exatidão 02',
  cliente: 'Locadora Exatidão',
  estado: 'open',
  viva: true,
  chatwoot: { ligado: true, conta: 5, caixa: 'Locadora - 8910' },
  caixas: [
    { id: 15, nome: 'Locadora - 8910', instancia: 'Exatidão 02' },
    { id: 16, nome: 'Locadora - 8844', instancia: 'Exatidão 03' },
  ],
  recebidas: { longa: 40, curta: 12 },
  entregues: { longa: 39, curta: 12 },
  ...over,
});

describe('diagnosticar', () => {
  test('tudo certo', () => {
    expect(diagnosticar(base())).toBeNull();
  });

  test('o caso de 17/09: a caixa foi renomeada no Chatwoot', () => {
    const p = diagnosticar(base({ chatwoot: { ligado: true, conta: 5, caixa: 'Locadora Exatidão 02' }, entregues: { longa: 0, curta: 0 } }));
    expect(p?.tipo).toBe('caixa');
    expect(p?.texto).toContain('Locadora Exatidão 02');
  });

  test('desconectada vem antes de tudo', () => {
    expect(diagnosticar(base({ estado: 'close', entregues: { longa: 0, curta: 0 } }))?.tipo).toBe('desconectada');
    expect(diagnosticar(base({ estado: null }))?.tipo).toBe('desconectada');
  });

  test('"open" mas o aparelho nao responde', () => {
    expect(diagnosticar(base({ viva: false }))?.tipo).toBe('desconectada');
  });

  test('entrega zerada com a caixa certa', () => {
    const p = diagnosticar(base({ entregues: { longa: 5, curta: 0 } }));
    expect(p?.tipo).toBe('entrega');
    expect(p?.texto).toContain('40');
  });

  test('queda recente pega pela janela curta antes da longa esvaziar', () => {
    expect(diagnosticar(base({ recebidas: { longa: 40, curta: 10 }, entregues: { longa: 30, curta: 0 } }))?.tipo).toBe('entrega');
  });

  test('recem-consertada: a janela longa ainda tem a queda, mas a curta ja entrega', () => {
    // Exatidão 02 meia hora depois de corrigir o nome da caixa, em 21/09
    expect(diagnosticar(base({ recebidas: { longa: 47, curta: 12 }, entregues: { longa: 10, curta: 10 } }))).toBeNull();
    expect(diagnosticar(base({ recebidas: { longa: 7, curta: 1 }, entregues: { longa: 1, curta: 1 } }))).toBeNull();
  });

  test('entrega parcial que continua: a curta tambem falha', () => {
    expect(diagnosticar(base({ recebidas: { longa: 40, curta: 12 }, entregues: { longa: 8, curta: 3 } }))?.tipo).toBe('entrega');
  });

  test('fim de semana sem campanha: pouco volume nao e alarme', () => {
    expect(diagnosticar(base({ recebidas: { longa: 3, curta: 1 }, entregues: { longa: 0, curta: 0 } }))).toBeNull();
    expect(diagnosticar(base({ recebidas: { longa: 0, curta: 0 }, entregues: { longa: 0, curta: 0 } }))).toBeNull();
  });

  test('Chatwoot com mais que o Evolution (grupo entra) nao e problema', () => {
    expect(diagnosticar(base({ recebidas: { longa: 10, curta: 4 }, entregues: { longa: 25, curta: 9 } }))).toBeNull();
  });

  test('sem ler as caixas, nao acusa caixa inexistente', () => {
    expect(diagnosticar(base({ caixas: null, chatwoot: { ligado: true, conta: 5, caixa: 'qualquer' } }))).toBeNull();
  });
});

describe('caixaParaCorrigir', () => {
  test('acha a caixa pelo webhook que aponta para a instancia', () => {
    expect(caixaParaCorrigir(base({ chatwoot: { ligado: true, conta: 5, caixa: 'Locadora Exatidão 02' } }))).toBe('Locadora - 8910');
  });

  test('nome certo: nada a corrigir', () => {
    expect(caixaParaCorrigir(base())).toBeNull();
  });

  test('duas caixas apontando para a mesma instancia: nao adivinha', () => {
    const caixas = [
      { id: 15, nome: 'A', instancia: 'Exatidão 02' },
      { id: 19, nome: 'B', instancia: 'Exatidão 02' },
    ];
    expect(caixaParaCorrigir(base({ caixas, chatwoot: { ligado: true, conta: 5, caixa: 'C' } }))).toBeNull();
  });

  test('nenhuma caixa aponta para a instancia', () => {
    const caixas = [{ id: 16, nome: 'Locadora - 8844', instancia: 'Exatidão 03' }];
    expect(caixaParaCorrigir(base({ caixas, chatwoot: { ligado: true, conta: 5, caixa: 'X' } }))).toBeNull();
  });
});

// 21/09/2026 15:00 em Brasilia = 18:00 UTC
const T = Date.parse('2026-09-21T18:00:00Z');
const MIN = 60e3;
const queda = { tipo: 'caixa' as const, texto: 'a caixa sumiu' };
const achado = (problema: typeof queda | null) => [{ chave: 'Exatidão 02', rotulo: 'Locadora · Exatidão 02', problema }];

describe('planejarAvisos', () => {
  test('uma leitura ruim isolada nao avisa; a segunda seguida avisa', () => {
    const r1 = planejarAvisos({}, achado(queda), T);
    expect(r1.avisos).toEqual([]);
    const r2 = planejarAvisos(r1.estado, achado(queda), T + 15 * MIN);
    expect(r2.avisos).toHaveLength(1);
    expect(r2.avisos[0]).toContain('a caixa sumiu');
  });

  test('nao repete o aviso a cada rodada; lembra depois de 4h', () => {
    let e: EstadoVigia = planejarAvisos({}, achado(queda), T).estado;
    e = planejarAvisos(e, achado(queda), T + 15 * MIN).estado;
    const r3 = planejarAvisos(e, achado(queda), T + 30 * MIN);
    expect(r3.avisos).toEqual([]);
    const r4 = planejarAvisos(r3.estado, achado(queda), T + 15 * MIN + LEMBRAR_A_CADA_MS);
    expect(r4.avisos[0]).toContain('Ainda com problema');
  });

  test('resolveu depois de avisar: manda o "normalizado" com a duracao', () => {
    let e = planejarAvisos({}, achado(queda), T).estado;
    e = planejarAvisos(e, achado(queda), T + 15 * MIN).estado;
    const r = planejarAvisos(e, achado(null), T + 75 * MIN);
    expect(r.avisos[0]).toContain('Normalizado');
    expect(r.avisos[0]).toContain('1h15');
    expect(r.estado).toEqual({});
  });

  test('resolveu antes de confirmar: some sem barulho', () => {
    const e = planejarAvisos({}, achado(queda), T).estado;
    const r = planejarAvisos(e, achado(null), T + 15 * MIN);
    expect(r.avisos).toEqual([]);
    expect(r.estado).toEqual({});
  });

  test('de madrugada nao avisa; o aviso sai as 7h se continuar', () => {
    const madrugada = Date.parse('2026-09-22T05:00:00Z'); // 02h em Brasilia
    let e = planejarAvisos({}, achado(queda), madrugada).estado;
    const r2 = planejarAvisos(e, achado(queda), madrugada + 15 * MIN);
    expect(r2.avisos).toEqual([]);
    e = r2.estado;
    const r3 = planejarAvisos(e, achado(queda), Date.parse('2026-09-22T10:00:00Z')); // 07h
    expect(r3.avisos).toHaveLength(1);
  });

  test('resolvido de madrugada: a boa noticia espera o horario', () => {
    let e = planejarAvisos({}, achado(queda), T).estado;
    e = planejarAvisos(e, achado(queda), T + 15 * MIN).estado; // avisado 15h15
    const noite = Date.parse('2026-09-22T04:00:00Z'); // 01h
    const r = planejarAvisos(e, achado(null), noite);
    expect(r.avisos).toEqual([]);
    const manha = planejarAvisos(r.estado, achado(null), Date.parse('2026-09-22T10:00:00Z'));
    expect(manha.avisos[0]).toContain('às 01:00');
  });

  test('instancia nao avaliada (servidor caiu) mantem o que ja sabia', () => {
    let e = planejarAvisos({}, achado(queda), T).estado;
    e = planejarAvisos(e, achado(queda), T + 15 * MIN).estado;
    const servidor = [{ chave: 'evolution', rotulo: 'Servidor', problema: { tipo: 'servidor' as const, texto: 'fora' } }];
    const r = planejarAvisos(e, servidor, T + 30 * MIN);
    expect(r.estado['Exatidão 02']?.avisadoEm).toBe(T + 15 * MIN);
  });
});

describe('horario e duracao', () => {
  test('7h as 21h59 em Brasilia', () => {
    expect(horarioDeAviso(Date.parse('2026-09-21T10:00:00Z'))).toBe(true); // 07h
    expect(horarioDeAviso(Date.parse('2026-09-22T00:59:00Z'))).toBe(true); // 21h59
    expect(horarioDeAviso(Date.parse('2026-09-22T01:00:00Z'))).toBe(false); // 22h
  });
  test('duracao legivel', () => {
    expect(duracao(5 * MIN)).toBe('5 min');
    expect(duracao(60 * MIN)).toBe('1h');
    expect(duracao(130 * MIN)).toBe('2h10');
  });
});
