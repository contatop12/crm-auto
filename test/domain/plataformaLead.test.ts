import { describe, test, expect } from 'vitest';
import { destinoDoLead, type SinaisDoLead } from '../../src/domain/plataformaLead';

const lead = (over: Partial<SinaisDoLead> = {}): SinaisDoLead => ({
  gclid: null, gbraid: null, wbraid: null, ctwa_clid: null, fbc: null, evento: null, utm_source: null, ...over,
});

describe('destinoDoLead', () => {
  test('clique do Google vai para o Google', () => {
    expect(destinoDoLead(lead({ gclid: 'Cj0' }))).toEqual({ plataforma: 'google' });
    expect(destinoDoLead(lead({ gbraid: 'gb' }))).toEqual({ plataforma: 'google' });
    expect(destinoDoLead(lead({ wbraid: 'wb' }))).toEqual({ plataforma: 'google' });
  });

  test('gclid vence o fbc e o ctwa_clid: o clique do Google e o mais forte', () => {
    expect(destinoDoLead(lead({ gclid: 'Cj0', fbc: 'fb.1.2.3', ctwa_clid: 'c' }))).toEqual({ plataforma: 'google' });
  });

  test('ctwa_clid vai para a Meta pelo canal de mensagem', () => {
    expect(destinoDoLead(lead({ ctwa_clid: 'ARAk', utm_source: 'facebook' }))).toEqual({ plataforma: 'meta', canal: 'whatsapp' });
  });

  test('formulario nativo da Meta fica de fora', () => {
    expect(destinoDoLead(lead({ evento: 'meta_lead_form', utm_source: 'meta' })))
      .toEqual({ plataforma: 'meta', fora: 'formulario' });
  });

  test('fbc vai para a Meta pelo canal do site', () => {
    expect(destinoDoLead(lead({ fbc: 'fb.1.2.3', utm_source: 'meta' }))).toEqual({ plataforma: 'meta', canal: 'site' });
  });

  test('rede da Meta sem identificador: e da Meta, mas nao ha o que enviar', () => {
    expect(destinoDoLead(lead({ utm_source: ' Instagram ' }))).toEqual({ plataforma: 'meta', fora: 'sem_identificador' });
    expect(destinoDoLead(lead({ utm_source: 'meta', evento: 'frase_entrada' })))
      .toEqual({ plataforma: 'meta', fora: 'sem_identificador' });
  });

  test('o resto segue para o Google, como hoje', () => {
    expect(destinoDoLead(lead())).toEqual({ plataforma: 'google' });
    expect(destinoDoLead(lead({ utm_source: 'digital' }))).toEqual({ plataforma: 'google' });
  });
});
