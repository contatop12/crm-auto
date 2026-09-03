import { describe, test, expect } from 'vitest';
import { montarEvento, montarCorpo, hash, conferirEvento } from '../../src/domain/conversao';

const BASE = {
  accountId: '6973821129',
  conversionActionId: '7698886680',
  quando: Date.parse('2026-09-02T17:53:38Z'),
  valor: 10,
  moeda: 'BRL',
  transactionId: 'VITA-ABC-conversa',
};

describe('hash', () => {
  test('SHA-256 em hex minúsculo, que é o `encoding: HEX` do Google', async () => {
    expect(await hash('teste@gmail.com')).toMatch(/^[0-9a-f]{64}$/);
    expect(await hash('a')).toBe(await hash('a'));
    expect(await hash('a')).not.toBe(await hash('b'));
  });
});

describe('montarEvento', () => {
  test('o essencial vai completo', async () => {
    const ev = (await montarEvento({ ...BASE, gclid: 'Cj0abc' }))!;
    expect(ev.adIdentifiers).toEqual({ gclid: 'Cj0abc' });
    expect(ev.transactionId).toBe('VITA-ABC-conversa');
    expect(ev.conversionValue).toBe(10);
    expect(ev.currency).toBe('BRL');
    expect(ev.eventTimestamp).toBe('2026-09-02T17:53:38.000Z');
    // obrigatorio: sem ele a API responde REQUIRED_FIELD_MISSING
    expect(ev.eventSource).toBe('WEB');
  });

  test('e-mail e telefone sobem com hash, nunca em claro', async () => {
    // é o que o diagnóstico da conta pede: recupera a conversão quando o
    // gclid expirou ou o lead trocou de aparelho
    const ev = (await montarEvento({
      ...BASE, gclid: 'Cj0', email: 'A.Silva+x@GoogleMail.com', telefone: '(19) 99146-0270',
    }))!;

    const serial = JSON.stringify(ev);
    expect(serial).not.toContain('silva');
    expect(serial).not.toContain('99146');
    // gmail canonizado antes do hash: pontos e sufixo +x não contam
    expect(ev.userData!.userIdentifiers).toEqual([
      { emailAddress: await hash('asilva@gmail.com') },
      { phoneNumber: await hash('+5519991460270') },
    ]);
  });

  test('só um identificador de clique', async () => {
    // mandar gclid e gbraid juntos faz o Google recusar o evento
    const ev = (await montarEvento({ ...BASE, gclid: 'Cj0', gbraid: '0AAA', wbraid: 'wb' }))!;
    expect(ev.adIdentifiers).toEqual({ gclid: 'Cj0' });
  });

  test('sem gclid usa gbraid, depois wbraid', async () => {
    expect((await montarEvento({ ...BASE, gbraid: '0AAA', wbraid: 'wb' }))!.adIdentifiers).toEqual({ gbraid: '0AAA' });
    expect((await montarEvento({ ...BASE, wbraid: 'wb' }))!.adIdentifiers).toEqual({ wbraid: 'wb' });
  });

  test('só com dados do lead ainda vale — é o caso que o gclid perderia', async () => {
    const ev = (await montarEvento({ ...BASE, email: 'ana@teste.com' }))!;
    expect(ev.adIdentifiers).toBeUndefined();
    expect(ev.userData!.userIdentifiers).toHaveLength(1);
  });

  test('sem clique e sem lead não vira evento', async () => {
    // subir isso seria um evento que o Google descarta em silêncio
    expect(await montarEvento(BASE)).toBeNull();
  });

  test('valor nulo não leva moeda', async () => {
    // "CRM - Compra (valor real)" com venda sem valor informado
    const ev = (await montarEvento({ ...BASE, gclid: 'Cj0', valor: null }))!;
    expect(ev.conversionValue).toBeUndefined();
    expect(ev.currency).toBeUndefined();
  });

  test('e-mail inválido não vira identificador vazio', async () => {
    const ev = (await montarEvento({ ...BASE, gclid: 'Cj0', email: 'nao-e-email' }))!;
    expect(ev.userData).toBeUndefined();
  });
});

describe('montarCorpo', () => {
  test('a conta e a ação viram destino, não campo do evento', async () => {
    const ev = (await montarEvento({ ...BASE, gclid: 'Cj0' }))!;
    const c = montarCorpo(BASE.accountId, BASE.conversionActionId, [ev], true, '3780611396');

    expect(c.destinations[0]).toEqual({
      // sem loginAccount a API responde 403: o consentimento vale no MCC,
      // nao diretamente em cada conta filha
      loginAccount: { product: 'GOOGLE_ADS', accountId: '3780611396' },
      operatingAccount: { product: 'GOOGLE_ADS', accountId: '6973821129' },
      productDestinationId: '7698886680',
    });
    expect(c.encoding).toBe('HEX');
    expect(c.validateOnly).toBe(true);
    expect(c.events).toHaveLength(1);
  });
});

describe('conferirEvento', () => {
  test('diz o que enfraquece a atribuição', async () => {
    const so = (await montarEvento({ ...BASE, gclid: 'Cj0' }))!;
    expect(conferirEvento(so)).toEqual([
      'sem e-mail nem telefone: se o gclid tiver expirado, a conversão se perde',
    ]);
    const completa = (await montarEvento({ ...BASE, gclid: 'Cj0', email: 'a@b.com' }))!;
    expect(conferirEvento(completa)).toEqual([]);
  });

  test('evento que nem chegou a ser montado', () => {
    expect(conferirEvento(null)[0]).toMatch(/sem gclid e sem dados do lead/);
  });
});
