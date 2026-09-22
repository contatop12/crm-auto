import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { GRAPH_VERSAO, postarEventos, verificarToken } from '../../src/clients/metaCapi';

let chamadas: Array<{ url: string; metodo: string; auth: string | null; corpo: any }>;
let respostas: Array<() => Response>;

beforeEach(() => {
  chamadas = [];
  respostas = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    chamadas.push({
      url: String(url),
      metodo: init.method ?? 'GET',
      auth: new Headers(init.headers).get('authorization'),
      corpo: init.body ? JSON.parse(String(init.body)) : null,
    });
    const r = respostas.shift();
    if (!r) throw new Error('resposta nao programada no teste');
    return r();
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('postarEventos', () => {
  test('posta no dataset, com o token no cabecalho, na versao fixada', async () => {
    respostas.push(() => Response.json({ events_received: 1, fbtrace_id: 'x' }));
    const r = await postarEventos('1234567890', 'tok', { data: [{ event_name: 'LeadSubmitted' }] });
    expect(GRAPH_VERSAO).toBe('v26.0');
    expect(chamadas).toEqual([{
      url: 'https://graph.facebook.com/v26.0/1234567890/events',
      metodo: 'POST',
      auth: 'Bearer tok',
      corpo: { data: [{ event_name: 'LeadSubmitted' }] },
    }]);
    expect(r).toMatchObject({ http: 200, eventosRecebidos: 1, erro: null });
  });

  test('recusa da Meta volta com a mensagem, sem lancar', async () => {
    respostas.push(() => Response.json(
      { error: { message: 'Invalid parameter', code: 100, error_subcode: 2804019 } }, { status: 400 },
    ));
    const r = await postarEventos('1', 'tok', { data: [] });
    expect(r.http).toBe(400);
    expect(r.erro).toEqual({ message: 'Invalid parameter', code: 100, error_subcode: 2804019 });
    expect(r.eventosRecebidos).toBe(0);
  });

  test('rede caida lanca: quem chama deixa a fila retentar', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('fetch failed'); });
    await expect(postarEventos('1', 'tok', { data: [] })).rejects.toThrow('fetch failed');
  });
});

describe('verificarToken', () => {
  test('token que le o dataset: ok, com o nome', async () => {
    respostas.push(() => Response.json({ id: '123', name: 'Pixel Tainã' }));
    const r = await verificarToken('tok', '123');
    expect(r).toMatchObject({ ok: true, datasetNome: 'Pixel Tainã' });
    expect(chamadas[0]!.url).toBe('https://graph.facebook.com/v26.0/123?fields=id,name,is_unavailable');
  });

  test('token vencido (190): manda gerar outro', async () => {
    respostas.push(() => Response.json({ error: { code: 190, message: 'expired' } }, { status: 400 }));
    const r = await verificarToken('tok', '123');
    expect(r.ok).toBe(false);
    expect(r.mensagem).toMatch(/inválido ou expirado/);
  });

  test('token da CAPI que nao le o dataset: prova com um evento de teste P12VERIFY', async () => {
    respostas.push(() => Response.json({ error: { code: 100, message: 'Missing Permission' } }, { status: 400 }));
    respostas.push(() => Response.json({ events_received: 1 }));
    const r = await verificarToken('tok', '123', { pageId: '555' });
    expect(r.ok).toBe(true);
    expect(chamadas[1]!.url).toBe('https://graph.facebook.com/v26.0/123/events');
    expect(chamadas[1]!.corpo.test_event_code).toBe('P12VERIFY');
    expect(chamadas[1]!.corpo.data[0].user_data.page_id).toBe('555');
  });

  test('sem Pagina nem WABA nao da para provar por envio', async () => {
    respostas.push(() => Response.json({ error: { code: 100, message: 'Missing Permission' } }, { status: 400 }));
    const r = await verificarToken('tok', '123');
    expect(r.ok).toBe(false);
    expect(r.mensagem).toMatch(/Página/);
    expect(chamadas).toHaveLength(1);
  });

  test('sem dataset nem chama a Meta', async () => {
    const r = await verificarToken('tok', null);
    expect(r.ok).toBe(false);
    expect(chamadas).toHaveLength(0);
  });

  test('Meta fora do ar: marca que foi a rede, nao o token', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('fetch failed'); });
    expect(await verificarToken('tok', '123')).toMatchObject({ ok: false, rede: true });
  });
});
