import { describe, test, expect } from 'vitest';
import {
  detectPlatform,
  detectOrigin,
  campaignId,
  classifyCampaign,
} from '../../src/domain/platform';

describe('detectPlatform', () => {
  test('reconhece o Google pelo utm_source', () => {
    expect(detectPlatform({ utmSource: 'google' })).toBe('google');
    expect(detectPlatform({ utmSource: 'google-ads' })).toBe('google');
  });

  test('reconhece a Meta pelo utm_source', () => {
    expect(detectPlatform({ utmSource: 'facebook' })).toBe('meta');
    expect(detectPlatform({ utmSource: 'ig' })).toBe('meta');
  });

  test('nao confunde "digital" com Instagram', () => {
    // bug real: a regra /face|insta|meta|fb|ig/ casava com o "ig" de "digital"
    // e marcava lead do Google como Meta
    expect(detectPlatform({ utmSource: 'digital' })).toBe('outro');
    expect(detectPlatform({ utmSource: 'p12digital' })).toBe('outro');
  });

  test('cai no click id quando nao ha utm_source', () => {
    expect(detectPlatform({ gclid: 'Cj0KCQ' })).toBe('google');
    expect(detectPlatform({ gbraid: 'x' })).toBe('google');
    expect(detectPlatform({ fbc: 'fb.1.2.3' })).toBe('meta');
  });

  test('o utm_source vence o click id', () => {
    expect(detectPlatform({ utmSource: 'facebook', gclid: 'x' })).toBe('meta');
  });

  test('ultimo recurso: procura em medium e campaign', () => {
    expect(detectPlatform({ utmMedium: 'cpc', utmCampaign: 'pmax-brasil' })).toBe('google');
  });

  test('devolve outro quando nada identifica', () => {
    expect(detectPlatform({})).toBe('outro');
  });
});

describe('detectOrigin', () => {
  test('quiz preenchido e sempre formulario', () => {
    expect(detectOrigin({ quizVersion: 'v2' })).toBe('formulario');
  });

  test('reconhece o evento gravado pelo GTM', () => {
    expect(detectOrigin({ eventClick: 'form_submit' })).toBe('formulario');
    expect(detectOrigin({ origemClick: 'formulario' })).toBe('formulario');
  });

  test('reconhece formulario pelo utm', () => {
    expect(detectOrigin({ utmMedium: 'lead-form' })).toBe('formulario');
  });

  test('o padrao e mensagem', () => {
    expect(detectOrigin({})).toBe('mensagem');
    expect(detectOrigin({ origemClick: 'clique' })).toBe('mensagem');
  });
});

describe('campaignId', () => {
  test('aceita id numerico do utm_id', () => {
    expect(campaignId({ utmId: '22334455' })).toBe('22334455');
  });

  test('recusa nome de campanha', () => {
    expect(campaignId({ utmId: 'campanha-brasil' })).toBe('');
    expect(campaignId({ utmId: '{campaignid}' })).toBe('');
  });

  test('recusa numero curto demais para ser id', () => {
    expect(campaignId({ utmId: '1234' })).toBe('');
  });

  test('cai no utm_campaign quando o utm_id nao serve', () => {
    expect(campaignId({ utmId: 'x', utmCampaign: '9988776655' })).toBe('9988776655');
  });
});

describe('classifyCampaign', () => {
  test('Performance Max vira o slug p-max, nao performance-max', () => {
    // "performance-max" nao existe no vocabulario de etiquetas
    const r = classifyCampaign({ enumTipo: 'PERFORMANCE_MAX', plataforma: 'google' });
    expect(r.tipo).toBe('Performance Max');
    expect(r.slug).toBe('p-max');
  });

  test('mapeia Search e Display', () => {
    expect(classifyCampaign({ enumTipo: 'SEARCH', plataforma: 'google' }).slug).toBe('search');
    expect(classifyCampaign({ enumTipo: 'DISPLAY', plataforma: 'google' }).slug).toBe('display');
  });

  test('tipo sem etiqueta no vocabulario sai com slug vazio', () => {
    const r = classifyCampaign({ enumTipo: 'VIDEO', plataforma: 'google' });
    expect(r.tipo).toBe('Video');
    expect(r.slug).toBe('');
  });

  test('sem resposta da API, deduz pelo nome da campanha', () => {
    const r = classifyCampaign({ nome: 'BR | PMax | Persianas', plataforma: 'google' });
    expect(r.slug).toBe('p-max');
  });

  test('nao deduz tipo para lead que nao e do Google', () => {
    // campanha da Meta chamada "Remarketing" virava "display"
    const r = classifyCampaign({ utmCampaign: 'Remarketing', plataforma: 'meta' });
    expect(r.tipo).toBe('Desconhecido');
    expect(r.slug).toBe('');
  });

  test('sem nada identificavel devolve Desconhecido', () => {
    expect(classifyCampaign({ plataforma: 'google' }).tipo).toBe('Desconhecido');
  });
});
