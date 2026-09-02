import { describe, test, expect } from 'vitest';
import { fakeD1 } from '../helpers/fakeD1';
import { registrarClique } from '../../src/pipelines/click';
import type { Env } from '../../src/env';

function cenario() {
  const { d1, exec, consultar } = fakeD1();
  exec(`INSERT INTO tenants (id, slug, nome, ativo) VALUES (1, 'vita', 'Vita', 1)`);
  return { env: { DB: d1 } as unknown as Env, consultar, exec };
}

const clique = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    protocol: 'VITA-ABC123',
    lead_name: 'Ana Souza',
    phone_number: '(19) 99146-0270',
    email: 'A.Souza+x@GoogleMail.com',
    gclid: 'Cj0xyz',
    utm_source: 'google',
    utm_medium: 'cpc',
    utm_campaign: '{campaignname}',
    utm_id: '23920679510',
    utm_term: 'aparelho auditivo',
    page_url: 'https://audicao.vitaaudio.com.br/aparelhos?x=1',
    ...over,
  });

describe('registrarClique', () => {
  test('grava o clique com telefone e e-mail normalizados', async () => {
    const { env, consultar } = cenario();
    const r = await registrarClique(env, 1, clique());
    expect(r.status).toBe('ok');

    const [l] = consultar<Record<string, string>>('SELECT * FROM leads');
    expect(l!.protocol).toBe('VITA-ABC123');
    expect(l!.phone_e164).toBe('+5519991460270');
    expect(l!.phone_key).toBe('1991460270');
    expect(l!.email).toBe('asouza@gmail.com');
    expect(l!.gclid).toBe('Cj0xyz');
    expect(l!.utm_term).toBe('aparelho auditivo');
  });

  test('macro do GTM nao resolvida nao vira nome de campanha', async () => {
    const { env, consultar } = cenario();
    await registrarClique(env, 1, clique());
    const [l] = consultar<Record<string, string | null>>('SELECT utm_campaign, utm_id FROM leads');
    expect(l!.utm_campaign).toBeNull();
    // o id sobrevive: e' com ele que o nome e' resolvido depois
    expect(l!.utm_id).toBe('23920679510');
  });

  test('clique sem protocolo nao vira lead', async () => {
    // sem chave, a mensagem do lead nao teria como casar
    const { env, consultar } = cenario();
    const r = await registrarClique(env, 1, clique({ protocol: '' }));
    expect(r.status).toBe('ignorado');
    expect(consultar('SELECT * FROM leads').length).toBe(0);
  });

  test('o mesmo protocolo duas vezes nao apaga o que ja tinha', async () => {
    // o beacon do GTM nao garante envio unico; a segunda vinda costuma vir mais
    // pobre, e sobrescrever com null perderia o telefone da primeira
    const { env, consultar } = cenario();
    await registrarClique(env, 1, clique());
    await registrarClique(env, 1, JSON.stringify({ protocol: 'VITA-ABC123', utm_content: 'anuncio-2' }));

    const linhas = consultar<Record<string, string | null>>('SELECT * FROM leads');
    expect(linhas.length).toBe(1);
    expect(linhas[0]!.phone_e164).toBe('+5519991460270');
    expect(linhas[0]!.utm_content).toBe('anuncio-2');
  });

  test('aceita camelCase, porque o modelo de tag varia por cliente', async () => {
    const { env, consultar } = cenario();
    await registrarClique(env, 1, JSON.stringify({
      protocol: 'VITA-X', utmSource: 'google', pageUrl: 'https://x', clientId: 'GA1.2',
    }));
    const [l] = consultar<Record<string, string>>('SELECT * FROM leads');
    expect(l!.utm_source).toBe('google');
    expect(l!.client_id).toBe('GA1.2');
  });

  test('origem e evento tem padrao, para o lead nao ficar sem classificacao', async () => {
    const { env, consultar } = cenario();
    await registrarClique(env, 1, JSON.stringify({ protocol: 'VITA-Y' }));
    const [l] = consultar<Record<string, string>>('SELECT origem, evento FROM leads');
    expect(l!.origem).toBe('clique');
    expect(l!.evento).toBe('whatsapp_click');
  });

  test('corpo ilegivel nao derruba a fila', async () => {
    const { env } = cenario();
    expect((await registrarClique(env, 1, 'nao e json')).status).toBe('ignorado');
    expect((await registrarClique(env, 1, '[]')).status).toBe('ignorado');
  });
});

describe('formato real do GTM', () => {
  // corpo capturado do container GTM-5867VHW5 em producao
  const doGtm = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      protocol: 'VITA-MTKPE89XT1AW',
      event: 'whatsapp_click',
      event_id: 'evt-mtkpe8a0vsje43',
      click_url: 'undefined',
      gclid: '', gbraid: '', wbraid: '', fbc: '', fbp: '',
      landing_url: 'https://audicao.vitaaudio.com.br/aparelhos',
      page_url: 'https://gtm-msr.appspot.com/render?id=GTM-5867VHW5',
      referrer: '',
      utm: { source: 'google', medium: 'cpc', campaign: 'Vita - Search', term: 'aparelho', content: 'anuncio-1' },
      ts: 1788390276,
      ...over,
    });

  test('le as UTMs aninhadas em `utm`', async () => {
    // o modelo de tag manda um objeto, nao campos achatados
    const { env, consultar } = cenario();
    await registrarClique(env, 1, doGtm());
    const [l] = consultar<Record<string, string>>('SELECT * FROM leads');
    expect(l!.utm_source).toBe('google');
    expect(l!.utm_medium).toBe('cpc');
    expect(l!.utm_campaign).toBe('Vita - Search');
    expect(l!.utm_term).toBe('aparelho');
    expect(l!.utm_content).toBe('anuncio-1');
  });

  test('a palavra "undefined" nao vira valor', async () => {
    // o GTM serializa variavel vazia como o texto undefined
    const { env, consultar } = cenario();
    await registrarClique(env, 1, doGtm({ referrer: 'undefined' }));
    const [l] = consultar<Record<string, string | null>>('SELECT referrer FROM leads');
    expect(l!.referrer).toBeNull();
  });

  test('landing_url manda na page_url', async () => {
    // em modo de teste a page_url e' a do renderizador do GTM, que nao diz
    // nada sobre onde o lead estava
    const { env, consultar } = cenario();
    await registrarClique(env, 1, doGtm());
    const [l] = consultar<Record<string, string>>('SELECT page_url FROM leads');
    expect(l!.page_url).toBe('https://audicao.vitaaudio.com.br/aparelhos');
  });

  test('cinco disparos do mesmo protocolo continuam sendo um lead', async () => {
    // a tag disparou 5x no mesmo segundo, com event_id diferente cada
    const { env, consultar } = cenario();
    for (let i = 0; i < 5; i++) {
      await registrarClique(env, 1, doGtm({ event_id: 'evt-' + i }));
    }
    expect(consultar('SELECT * FROM leads').length).toBe(1);
  });
});
