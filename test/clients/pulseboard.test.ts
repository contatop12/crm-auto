import { describe, test, expect } from 'vitest';
import { conferirEnvio, PulseboardClient } from '../../src/clients/pulseboard';

/**
 * Corpos capturados do endpoint de producao, nao inventados.
 * Todos vieram com HTTP 200.
 */
describe('conferirEnvio', () => {
  test('rota nao mapeada vem com 200 e sent=0', () => {
    // e' o que o codi_id errado devolve: status de sucesso, mensagem nao enviada
    const corpo = '{"ok":true,"sent":0,"skipped":["lead_index_0: rota_nao_mapeada (page_id=vazio; codi_id=000)"]}';
    expect(() => conferirEnvio(corpo)).toThrow(/nao enviou \(sent=0\)/);
    expect(() => conferirEnvio(corpo)).toThrow(/rota_nao_mapeada/);
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

  test('sent=0 sem skipped ainda e falha', () => {
    expect(() => conferirEnvio('{"ok":true,"sent":0}')).toThrow(/sem motivo declarado/);
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
        codiId: 'X', canal: 'c', nome: 'n', telefone: '5511999999999', url: '',
      });
      await new PulseboardClient('https://pulseboard.sitespdoze.com.br/cliente-x').avisarLeadNovo({
        codiId: 'X', canal: 'c', nome: 'n', telefone: '5511999999999', url: '',
      });
    } finally {
      globalThis.fetch = original;
    }
    expect(urls[0]).toBe('https://pulseboard.sitespdoze.com.br/meta-new-lead');
    // cada cliente pode ter o seu
    expect(urls[1]).toBe('https://pulseboard.sitespdoze.com.br/cliente-x');
  });
});
