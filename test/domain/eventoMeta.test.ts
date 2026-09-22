import { describe, test, expect } from 'vitest';
import {
  corpoMeta, montarEventoMeta, nomeNoCanal, telefoneMeta, type EntradaEventoMeta,
} from '../../src/domain/eventoMeta';
import { hash } from '../../src/domain/conversao';
import { normEmail } from '../../src/domain/email';

const QUANDO = Date.parse('2026-09-22T10:00:00Z');

const entrada = (over: Partial<EntradaEventoMeta> = {}): EntradaEventoMeta => ({
  canal: 'whatsapp', evento: 'LeadSubmitted', eventId: 'TAINA-CTWA-9-LeadSubmitted',
  quando: QUANDO, valor: 10, moeda: 'BRL',
  telefone: '+55 (71) 99106-5853', email: 'Maria@Teste.com.br', ctwaClid: 'ARAk-clid',
  pageId: '555', wabaId: null, fbc: null, fbp: null, ip: null, userAgent: null, pagina: null,
  ...over,
});

describe('montarEventoMeta', () => {
  test('mensagem: business_messaging com clid, Pagina e telefone com hash', async () => {
    expect(await montarEventoMeta(entrada())).toEqual({
      ok: true,
      evento: {
        event_name: 'LeadSubmitted',
        event_time: Math.floor(QUANDO / 1000),
        event_id: 'TAINA-CTWA-9-LeadSubmitted',
        action_source: 'business_messaging',
        messaging_channel: 'whatsapp',
        user_data: { ph: [await hash('5571991065853')], ctwa_clid: 'ARAk-clid', page_id: '555' },
        custom_data: { value: 10, currency: 'BRL' },
      },
    });
  });

  test('WABA sozinho tambem serve', async () => {
    const r = await montarEventoMeta(entrada({ pageId: null, wabaId: '777' }));
    expect(r.ok && r.evento.user_data).toMatchObject({ whatsapp_business_account_id: '777' });
    expect(r.ok && (r.evento.user_data as Record<string, unknown>).page_id).toBeUndefined();
  });

  test('sem Pagina e sem WABA: nao monta (a Meta responderia 2804116)', async () => {
    const r = await montarEventoMeta(entrada({ pageId: null, wabaId: null }));
    expect(r).toEqual({ ok: false, erro: expect.stringContaining('2804116') });
  });

  test('mensagem sem ctwa_clid: nao monta', async () => {
    const r = await montarEventoMeta(entrada({ ctwaClid: null }));
    expect(r).toEqual({ ok: false, erro: expect.stringContaining('ctwa_clid') });
  });

  test('site: website com fbc, fbp, IP e user agent em claro e e-mail com hash', async () => {
    const r = await montarEventoMeta(entrada({
      canal: 'site', ctwaClid: null, pageId: null,
      fbc: 'fb.1.170.abc', fbp: 'fb.1.170.999', ip: '200.1.2.3', userAgent: 'Mozilla/5.0',
      pagina: 'https://clinica.exemplo/lp',
    }));
    expect(r).toEqual({
      ok: true,
      evento: {
        event_name: 'Lead',
        event_time: Math.floor(QUANDO / 1000),
        event_id: 'TAINA-CTWA-9-LeadSubmitted',
        action_source: 'website',
        event_source_url: 'https://clinica.exemplo/lp',
        user_data: {
          ph: [await hash('5571991065853')],
          em: [await hash(normEmail('Maria@Teste.com.br'))],
          fbc: 'fb.1.170.abc',
          fbp: 'fb.1.170.999',
          client_ip_address: '200.1.2.3',
          client_user_agent: 'Mozilla/5.0',
        },
        custom_data: { value: 10, currency: 'BRL' },
      },
    });
  });

  test('site sem user agent: nao monta (a Meta exige no evento do site)', async () => {
    const r = await montarEventoMeta(entrada({ canal: 'site', ctwaClid: null, fbc: 'fb.1.170.abc' }));
    expect(r).toEqual({ ok: false, erro: expect.stringContaining('user agent') });
  });

  test('sem valor, sem custom_data', async () => {
    const r = await montarEventoMeta(entrada({ valor: null }));
    expect(r.ok && r.evento.custom_data).toBeUndefined();
    const zero = await montarEventoMeta(entrada({ valor: 0 }));
    expect(zero.ok && zero.evento.custom_data).toBeUndefined();
  });
});

describe('nomeNoCanal', () => {
  test('LeadSubmitted vira Lead so no site', () => {
    expect(nomeNoCanal('LeadSubmitted', 'site')).toBe('Lead');
    expect(nomeNoCanal('LeadSubmitted', 'whatsapp')).toBe('LeadSubmitted');
    expect(nomeNoCanal('Purchase', 'site')).toBe('Purchase');
  });
});

describe('corpoMeta', () => {
  test('codigo de teste so quando configurado', () => {
    expect(corpoMeta([{ a: 1 }], 'TEST123')).toEqual({ data: [{ a: 1 }], test_event_code: 'TEST123' });
    expect(corpoMeta([{ a: 1 }], '  ')).toEqual({ data: [{ a: 1 }] });
    expect(corpoMeta([{ a: 1 }], null)).toEqual({ data: [{ a: 1 }] });
  });
});

describe('telefoneMeta', () => {
  test('so digitos, com DDI e o nono digito', () => {
    expect(telefoneMeta('+55 (71) 99106-5853')).toBe('5571991065853');
    expect(telefoneMeta('(71) 9106-5853')).toBe('5571991065853');
    expect(telefoneMeta('123')).toBeNull();
    expect(telefoneMeta(null)).toBeNull();
  });
});
