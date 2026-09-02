import { describe, test, expect } from 'vitest';
import {
  planejarProvisionamento, precisaResolverNome, utmsDoCard,
  type PadraoEtiqueta, type PadraoAtributo,
} from '../../src/domain/padroes';

const etiquetas: PadraoEtiqueta[] = [
  { slug: 'mensagem', cor: '#8e44ad', descricao: 'a' },
  { slug: 'google-ads', cor: '#4285F4', descricao: 'b' },
];
const atributos: PadraoAtributo[] = [
  { modelo: 'task_attribute', chave: 'utm_id', nome: 'UTM ID', tipo: 'text', descricao: null },
  { modelo: 'task_attribute', chave: 'utm_term', nome: 'UTM Term', tipo: 'text', descricao: null },
  { modelo: 'contact_attribute', chave: 'gclid', nome: 'GCLID', tipo: 'text', descricao: null },
];

describe('planejarProvisionamento', () => {
  test('conta vazia: cria tudo', () => {
    const p = planejarProvisionamento(etiquetas, atributos, [], []);
    expect(p.etiquetasACriar.map((e) => e.slug)).toEqual(['mensagem', 'google-ads']);
    expect(p.atributosACriar.length).toBe(3);
    expect(p.etiquetasExistentes).toEqual([]);
  });

  test('nao recria o que ja existe', () => {
    const p = planejarProvisionamento(etiquetas, atributos, ['google-ads'], [
      { modelo: 'task_attribute', chave: 'utm_id' },
    ]);
    expect(p.etiquetasACriar.map((e) => e.slug)).toEqual(['mensagem']);
    expect(p.etiquetasExistentes).toEqual(['google-ads']);
    expect(p.atributosACriar.map((a) => a.chave)).toEqual(['utm_term', 'gclid']);
  });

  test('a mesma chave em modelos diferentes sao atributos diferentes', () => {
    // `gclid` existe em contato E em tarefa; ter um nao dispensa o outro
    const p = planejarProvisionamento([], [
      { modelo: 'contact_attribute', chave: 'gclid', nome: 'GCLID', tipo: 'text', descricao: null },
      { modelo: 'task_attribute', chave: 'gclid', nome: 'GCLID', tipo: 'text', descricao: null },
    ], [], [{ modelo: 'contact_attribute', chave: 'gclid' }]);
    expect(p.atributosACriar.map((a) => a.modelo)).toEqual(['task_attribute']);
  });

  test('compara ignorando caixa e espaco', () => {
    const p = planejarProvisionamento(etiquetas, [], ['  Google-Ads '], []);
    expect(p.etiquetasACriar.map((e) => e.slug)).toEqual(['mensagem']);
  });

  test('o que o cliente criou a mao e relatado, nao apagado', () => {
    // "Ligar mais tarde" e' trabalho do vendedor; sumir com isso seria destruir
    const p = planejarProvisionamento(etiquetas, atributos, ['mensagem', 'Ligar mais tarde'], [
      { modelo: 'task_attribute', chave: 'match_type' },
    ]);
    expect(p.etiquetasForaDoPadrao).toEqual(['Ligar mais tarde']);
    expect(p.atributosForaDoPadrao).toEqual(['task_attribute/match_type']);
  });
});

describe('precisaResolverNome', () => {
  test('macro nao resolvida com id numerico: resolve', () => {
    expect(precisaResolverNome('{campaignname}', '23920679510')).toBe(true);
  });

  test('campanha vazia com id: resolve', () => {
    expect(precisaResolverNome('', '23920679510')).toBe(true);
    expect(precisaResolverNome(null, '23920679510')).toBe(true);
  });

  test('id repetido no lugar do nome: resolve', () => {
    expect(precisaResolverNome('23920679510', '23920679510')).toBe(true);
  });

  test('nome de verdade: nao mexe', () => {
    expect(precisaResolverNome('Black Friday - Search', '23920679510')).toBe(false);
  });

  test('sem id numerico nao ha o que consultar', () => {
    expect(precisaResolverNome('{campaignname}', null)).toBe(false);
    expect(precisaResolverNome('{campaignname}', 'nao-numerico')).toBe(false);
    expect(precisaResolverNome('', '')).toBe(false);
  });
});

describe('utmsDoCard', () => {
  test('monta so o que tem valor', () => {
    expect(utmsDoCard({ protocolo: 'VITA-1', utmSource: 'google', utmTerm: null })).toEqual({
      protocolo: 'VITA-1',
      utm_source: 'google',
    });
  });

  test('macro nao resolvida nunca entra no card', () => {
    // e' o que hoje aparece no card: `{campaignname}` como nome de campanha
    const r = utmsDoCard({ utmCampaign: '{campaignname}', utmContent: '{adgroupname}_81216', utmSource: 'google' });
    expect(r.utm_campaign).toBeUndefined();
    expect(r.utm_source).toBe('google');
    // `{adgroupname}_81216` nao e' macro pura: tem conteudo util depois dela
    expect(r.utm_content).toBe('{adgroupname}_81216');
  });

  test('espaco em branco nao vira campo', () => {
    expect(utmsDoCard({ gclid: '   ', utmMedium: 'cpc' })).toEqual({ utm_medium: 'cpc' });
  });

  test('nada preenchido devolve objeto vazio', () => {
    expect(utmsDoCard({})).toEqual({});
  });
});
