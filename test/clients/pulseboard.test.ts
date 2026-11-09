import { describe, test, expect } from 'vitest';
import { conferirEnvio, PulseboardClient, ErroPulseboard } from '../../src/clients/pulseboard';

/**
 * Corpos capturados do endpoint de producao, nao inventados.
 * Todos vieram com HTTP 200.
 */
describe('conferirEnvio', () => {
  test('rota nao mapeada vem com 200 e sent=0', () => {
    // e' o que o codi_id errado devolve: status de sucesso, mensagem nao enviada
    const corpo = '{"ok":true,"sent":0,"skipped":["lead_index_0: rota_nao_mapeada (page_id=vazio; codi_id=000)"]}';
    expect(() => conferirEnvio(corpo)).toThrow(/nao tem rota para este webhook/);
    expect(() => conferirEnvio(corpo)).toThrow(/rota_nao_mapeada/);
  });

  test('rota nao mapeada e permanente: nao adianta retentar', () => {
    // sondado contra producao: um codi_id inventado devolve este mesmo corpo,
    // entao o erro e' de cadastro, nao intermitencia
    const corpo = '{"ok":true,"sent":0,"skipped":["lead_index_0: rota_nao_mapeada (page_id=vazio; codi_id=000)"]}';
    try {
      conferirEnvio(corpo);
      expect.unreachable('deveria ter lancado');
    } catch (e) {
      expect(e).toBeInstanceOf(ErroPulseboard);
      expect((e as ErroPulseboard).permanente).toBe(true);
    }
  });

  test('sent=0 por outro motivo pode ser passageiro: retenta', () => {
    try {
      conferirEnvio('{"ok":true,"sent":0,"skipped":["lead_index_0: fila_cheia"]}');
      expect.unreachable('deveria ter lancado');
    } catch (e) {
      expect((e as ErroPulseboard).permanente).toBe(false);
    }
  });

  test('corpo vazio e ignorado, tambem com 200', () => {
    expect(() => conferirEnvio('{"ignored":true,"ok":true,"reason":"empty_payload"}'))
      .toThrow(/ignorou o aviso: empty_payload/);
  });

  test('ok:false e recusa', () => {
    expect(() => conferirEnvio('{"ok":false,"error":"missing_body"}')).toThrow(/recusou/);
  });

  test('envio de verdade passa', () => {
    expect(() => conferirEnvio('{"ok":true,"sent":1,"skipped":[]}')).not.toThrow();
    expect(() => conferirEnvio('{"ok":true,"sent":3}')).not.toThrow();
  });

  test('resposta sem `sent` passa: nao ha o que provar', () => {
    // o contrato pode mudar; ausencia de campo nao e' prova de falha
    expect(() => conferirEnvio('{"ok":true}')).not.toThrow();
    expect(() => conferirEnvio('')).not.toThrow();
    expect(() => conferirEnvio('OK')).not.toThrow();
  });

  test('aviso segurado ate a sequencia da planilha chegar conta como enviado', () => {
    // capturado em producao (Persianas, 22/09/2026, lead Soraya): a Pulseboard
    // segura o aviso ate' 3 min esperando a SEQUENCIA da planilha e manda depois.
    // O grupo recebeu a mensagem, com "161SET"; o painel dizia erro.
    const corpo = '{"ok":true,"sent":0,"skipped":[],"aguardando_sequencia":1}';
    expect(conferirEnvio(corpo)).toBe('enviado');
  });

  test('lead que outro caminho ja avisou nao e erro: e "ja avisado"', () => {
    // capturado em producao (Persianas, 22/09/2026): o quiz do site ja tinha
    // avisado o grupo; quando o lead chamou no WhatsApp a Pulseboard barrou a
    // repeticao de proposito (janela de 24h). Retentar so' repete a barra.
    const corpo = '{"ok":true,"sent":0,"skipped":["lead_index_0: duplicado (Persianas Paulista - Mensagem)"]}';
    expect(conferirEnvio(corpo)).toBe('ja_avisado');
  });

  test('envio de verdade diz enviado', () => {
    expect(conferirEnvio('{"ok":true,"sent":1,"skipped":[]}')).toBe('enviado');
  });

  test('sent=0 sem skipped ainda e falha', () => {
    expect(() => conferirEnvio('{"ok":true,"sent":0}')).toThrow(/sem motivo declarado/);
  });
});

describe('hora do lead no aviso', () => {
  async function corpoEnviado(extra: Record<string, unknown>) {
    const corpos: Array<Record<string, unknown>> = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (_u: string, init: RequestInit) => {
      corpos.push(JSON.parse(String(init.body)));
      return new Response('{"ok":true,"sent":1}', { status: 200 });
    }) as typeof fetch;
    try {
      await new PulseboardClient('https://pb.teste/x').avisarLeadNovo({
        canal: 'c', nome: 'n', telefone: '5511999999999', url: '', ...extra,
      });
    } finally {
      globalThis.fetch = original;
    }
    return corpos[0]!;
  }

  test('manda a hora do clique como data_evento, em UTC explicito', async () => {
    // Martinelli 06/11/2026: lead de 04/11 22:13 saiu no grupo como 06/11 16:40,
    // a hora em que a Pulseboard recebeu. A Pulseboard le `data_evento`.
    const corpo = await corpoEnviado({ quando: '2026-11-05 01:13:19' });
    expect(corpo.data_evento).toBe('2026-11-05T01:13:19Z');
  });

  test('ISO ja com fuso passa como veio', async () => {
    const corpo = await corpoEnviado({ quando: '2026-11-05T01:13:19.000Z' });
    expect(corpo.data_evento).toBe('2026-11-05T01:13:19.000Z');
  });

  test('sem hora, nao manda o campo: a Pulseboard usa a de chegada', async () => {
    expect(await corpoEnviado({})).not.toHaveProperty('data_evento');
    expect(await corpoEnviado({ quando: null })).not.toHaveProperty('data_evento');
    expect(await corpoEnviado({ quando: 'lixo' })).not.toHaveProperty('data_evento');
  });
});

describe('endpoint', () => {
  test('o padrao e o /meta-new-lead em uso', async () => {
    // era /site-new-lead no codigo; os dois respondem igual, mas o em uso e este
    const urls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (u: string) => {
      urls.push(String(u));
      return new Response('{"ok":true,"sent":1}', { status: 200 });
    }) as typeof fetch;
    try {
      await new PulseboardClient().avisarLeadNovo({
        canal: 'c', nome: 'n', telefone: '5511999999999', url: '',
      });
      await new PulseboardClient('https://pulseboard.sitespdoze.com.br/cliente-x').avisarLeadNovo({
        canal: 'c', nome: 'n', telefone: '5511999999999', url: '',
      });
    } finally {
      globalThis.fetch = original;
    }
    expect(urls[0]).toBe('https://pulseboard.sitespdoze.com.br/meta-new-lead');
    // cada cliente pode ter o seu
    expect(urls[1]).toBe('https://pulseboard.sitespdoze.com.br/cliente-x');
  });
});
