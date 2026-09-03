import { describe, test, expect } from 'vitest';
import {
  lerModelo, planejarGtm, preencherConstantes, remapearGatilhos,
  indiceDeGatilhos, limparParaCriar, type ModeloGtm,
} from '../../src/domain/gtm';

const VALORES = {
  prefixo: 'VITA',
  clientId: 'p12-vita',
  collectUrl: 'https://crm.sitespdoze.com.br/ingest/vita/click?k=abc',
};

/** Recorte do modelo real, com os nomes e ids que ele usa. */
const modelo: ModeloGtm = {
  customTemplate: [{ name: 'Persist Campaign Data', templateId: '41' }],
  variable: [
    { name: '00 - [P12] PREFIXO PROTOCOLO', type: 'c', variableId: '20', parameter: [{ key: 'value', value: 'CLIENTE' }] },
    { name: '00 - [P12] CLIENT ID', type: 'c', variableId: '21', parameter: [{ key: 'value', value: 'p12-cliente' }] },
    { name: '00 - [P12] COLLECT URL', type: 'c', variableId: '22', parameter: [{ key: 'value', value: 'https://SEU-N8N/webhook/COLE-AQUI' }] },
    { name: '00 | [URL] - utm_source', type: 'u', variableId: '5' },
  ],
  trigger: [
    { name: 'P12 - Clique WhatsApp (todos)', triggerId: '210', type: 'LINK_CLICK' },
    { name: 'P12 - DOM Ready (Todas as páginas)', triggerId: '211', type: 'DOM_READY' },
  ],
  tag: [
    { name: 'P12 | Collector - WhatsApp Click', tagId: '3', firingTriggerId: ['210'] },
    { name: '00 - UTM Persist', tagId: '1', firingTriggerId: ['2147479573'] },
  ],
  builtInVariable: [{ type: 'PAGE_URL' }, { type: 'CLICK_URL' }],
};

const vazio = { templates: [], variaveis: [], gatilhos: [], tags: [], builtIn: [] };

describe('planejarGtm', () => {
  test('container vazio: propoe tudo', () => {
    const p = planejarGtm(modelo, vazio, VALORES);
    expect(p.variaveisACriar.length).toBe(4);
    expect(p.gatilhosACriar.length).toBe(2);
    expect(p.tagsACriar.length).toBe(2);
    expect(p.templatesACriar.length).toBe(1);
    expect(p.builtInACriar).toEqual(['PAGE_URL', 'CLICK_URL']);
  });

  test('o que ja existe no cliente NAO e tocado', () => {
    // o container tem o rastreamento do cliente; apagar seria destruir
    const p = planejarGtm(modelo, {
      ...vazio,
      tags: ['00 - UTM Persist', 'GA4 - Configuração'],
      variaveis: ['00 | [URL] - utm_source'],
      builtIn: ['PAGE_URL'],
    }, VALORES);

    expect(p.tagsACriar.map((t) => t.name)).toEqual(['P12 | Collector - WhatsApp Click']);
    expect(p.variaveisACriar.map((v) => v.name)).not.toContain('00 | [URL] - utm_source');
    expect(p.builtInACriar).toEqual(['CLICK_URL']);
    expect(p.jaExistem).toContain('tag: 00 - UTM Persist');
  });

  test('compara por nome ignorando caixa e espaco', () => {
    const p = planejarGtm(modelo, { ...vazio, tags: ['  00 - UTM PERSIST '] }, VALORES);
    expect(p.tagsACriar.map((t) => t.name)).toEqual(['P12 | Collector - WhatsApp Click']);
  });

  test('as tres constantes recebem os valores do cliente', () => {
    const p = planejarGtm(modelo, vazio, VALORES);
    const valor = (n: string) =>
      p.variaveisACriar.find((v) => v.name === n)?.parameter?.find((x) => x.key === 'value')?.value;

    expect(valor('00 - [P12] PREFIXO PROTOCOLO')).toBe('VITA');
    expect(valor('00 - [P12] CLIENT ID')).toBe('p12-vita');
    expect(valor('00 - [P12] COLLECT URL')).toBe(VALORES.collectUrl);
    expect(p.semValor).toEqual([]);
  });

  test('constante que ficaria com o exemplo do modelo e denunciada', () => {
    // subir `https://SEU-N8N/webhook/COLE-AQUI` faria o container mandar os
    // cliques para lugar nenhum, e em silencio
    const p = planejarGtm(modelo, vazio, { ...VALORES, collectUrl: '' });
    expect(p.semValor).toContain('00 - [P12] COLLECT URL');
  });
});

describe('remapearGatilhos', () => {
  const idx = indiceDeGatilhos(modelo);

  test('o id do gatilho vira o id real do container', () => {
    // `210` e' local ao arquivo; no destino o gatilho tem outro id
    const reais = new Map([['p12 - clique whatsapp (todos)', '77']]);
    const t = remapearGatilhos(modelo.tag[0]!, reais, idx);
    expect(t.firingTriggerId).toEqual(['77']);
  });

  test('gatilho embutido do GTM passa intacto', () => {
    // 2147479573 = todas as paginas, igual em qualquer container
    const t = remapearGatilhos(modelo.tag[1]!, new Map(), idx);
    expect(t.firingTriggerId).toEqual(['2147479573']);
  });

  test('gatilho do modelo sem par no destino nao inventa id', () => {
    const t = remapearGatilhos(modelo.tag[0]!, new Map(), idx);
    expect(t.firingTriggerId).toEqual(['210']);
  });
});

describe('limparParaCriar', () => {
  test('tira os campos que o GTM atribui sozinho', () => {
    const e = limparParaCriar({
      name: 'x', type: 'c', tagId: '3', accountId: '1', containerId: '2',
      fingerprint: 'f', path: 'p', parameter: [{ key: 'value', value: 'v' }],
    });
    expect(e.tagId).toBeUndefined();
    expect(e.accountId).toBeUndefined();
    expect(e.fingerprint).toBeUndefined();
    expect(e.name).toBe('x');
    expect(e.parameter).toEqual([{ key: 'value', value: 'v' }]);
  });
});

describe('lerModelo', () => {
  test('aceita o export do GTM, que embrulha em containerVersion', () => {
    const m = lerModelo(JSON.stringify({ containerVersion: { tag: [{ name: 'a' }], variable: [] } }));
    expect(m.tag.length).toBe(1);
    expect(m.trigger).toEqual([]);
  });

  test('aceita tambem o objeto solto', () => {
    expect(lerModelo(JSON.stringify({ tag: [{ name: 'a' }] })).tag.length).toBe(1);
  });
});

describe('preencherConstantes', () => {
  test('variavel que nao e constante do P12 passa intacta', () => {
    const v = { name: '00 | [URL] - utm_source', type: 'u', parameter: [{ key: 'value', value: 'x' }] };
    expect(preencherConstantes(v, VALORES)).toEqual(v);
  });
});
