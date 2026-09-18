import { describe, test, expect } from 'vitest';
import { CAMPOS_PLANILHA, montarRegistro, dataHoraBrasilia, urlDoWebhook } from '../../src/domain/planilha';

const lead = {
  nome: 'Amanda Constantino',
  email: 'amanda@teste.com',
  phone_e164: '+5511971036500',
  gclid: 'Cj0KCQ',
  utm_source: 'google',
  utm_medium: 'cpc',
  utm_campaign: 'cortinas_blackout',
  utm_term: 'cortina blackout',
  origem: 'clique',
  evento: 'whatsapp_click',
};

const ctx = {
  cliente: 'Persianas Paulista',
  protocolo: 'PERSI-MTN0F6ANNIUP',
  etapa: 'Novo Lead',
  conversao: 'conversa',
  valor: null,
  moeda: 'BRL',
  // 2026-09-09 17:32:05 UTC = 14:32:05 em Brasilia
  quando: Date.UTC(2026, 8, 9, 17, 32, 5),
  ensaio: false,
};

describe('dataHoraBrasilia', () => {
  test('data e hora no fuso de Brasilia', () => {
    expect(dataHoraBrasilia(Date.UTC(2026, 8, 9, 17, 32, 5))).toEqual({
      data: '09/09/2026',
      hora: '14:32:05',
      timestamp: '09/09/2026 14:32:05',
    });
  });

  test('antes das 3h UTC ainda e o dia anterior em Brasilia', () => {
    expect(dataHoraBrasilia(Date.UTC(2026, 8, 10, 1, 0, 0)).data).toBe('09/09/2026');
  });
});

describe('montarRegistro', () => {
  test('traz cada campo que a tela promete', () => {
    const r = montarRegistro(ctx, lead);
    for (const { campo } of CAMPOS_PLANILHA) expect(r).toHaveProperty(campo);
  });

  test('telefone vai so com digitos, como a planilha ja usava', () => {
    expect(montarRegistro(ctx, lead).telefone).toBe('5511971036500');
  });

  test('link do WhatsApp aponta para o numero do lead', () => {
    expect(montarRegistro(ctx, lead).link_whatsapp).toBe('https://wa.me/5511971036500');
  });

  test('canal diz de onde o lead veio', () => {
    expect(montarRegistro(ctx, lead).canal).toBe('Campanha de Mensagem - Google');
  });

  test('valor com moeda quando existe, vazio quando nao', () => {
    expect(montarRegistro(ctx, lead).valor).toBe('');
    expect(montarRegistro({ ...ctx, valor: 2028 }, lead).valor).toBe('BRL 2028');
  });

  test('lead sem dado vira texto vazio, nunca "null"', () => {
    const r = montarRegistro(ctx, null);
    expect(r.nome).toBe('');
    expect(r.telefone).toBe('');
    expect(r.link_whatsapp).toBe('');
    expect(JSON.stringify(r)).not.toContain('null');
  });

  test('ensaio e teste sao sinalizados para o n8n poder filtrar', () => {
    const r = montarRegistro({ ...ctx, ensaio: true }, lead);
    expect(r.ensaio).toBe(true);
    expect(r.teste).toBe(false);
  });
});

describe('urlDoWebhook', () => {
  test('aceita https', () => {
    expect(urlDoWebhook(' https://n8n.exemplo.com/webhook/abc ')).toBe('https://n8n.exemplo.com/webhook/abc');
  });

  test('recusa http: o corpo leva nome e telefone do lead', () => {
    expect(urlDoWebhook('http://n8n.exemplo.com/webhook/abc')).toBeNull();
  });

  test('recusa o que nao e URL', () => {
    expect(urlDoWebhook('')).toBeNull();
    expect(urlDoWebhook(null)).toBeNull();
    expect(urlDoWebhook('n8n.exemplo.com/webhook')).toBeNull();
  });
});
