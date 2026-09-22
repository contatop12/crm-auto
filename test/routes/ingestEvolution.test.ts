import { describe, test, expect } from 'vitest';
import { fakeD1 } from '../helpers/fakeD1';
import { ingest } from '../../src/routes/ingest';
import type { Env } from '../../src/env';

function cenario() {
  const { d1, exec, consultar } = fakeD1();
  exec(`INSERT INTO tenants (id, slug, nome, ativo) VALUES (5, 'taina', 'Taina', 1)`);
  exec(`INSERT INTO tenant_config (tenant_id, cw_account_id, cw_board_funil_id, ingest_key) VALUES (5, 3, 9, 'legado')`);
  exec(`INSERT INTO ingest_keys (tenant_id, canal, chave) VALUES (5, 'evolution', 'k-evo')`);
  const fila: unknown[] = [];
  const env = { DB: d1, QUEUE: { send: async (m: unknown) => { fila.push(m); } } } as unknown as Env;
  return { env, consultar, fila };
}

const CARTAO = JSON.stringify({
  event: 'messages.upsert',
  instance: 'Tainã Aci',
  data: {
    key: { remoteJid: '5571991065853@s.whatsapp.net', fromMe: false, id: 'A1' },
    message: {
      extendedTextMessage: {
        text: 'Olá! Gostaria de mais informações [Protocolo: MA21RMKT]',
        contextInfo: {
          externalAdReply: {
            title: 'Harmonização', sourceId: '1202', sourceUrl: 'https://fb.me/abc',
            ctwaClid: 'ARAk-clid', jpegThumbnail: '/9j/MINIATURA',
          },
        },
      },
    },
  },
});

const SEM_CARTAO = JSON.stringify({
  event: 'messages.upsert',
  data: { key: { remoteJid: '5571991065853@s.whatsapp.net', fromMe: false }, message: { conversation: 'oi' } },
});

const postar = (env: Env, corpo: string, k = 'k-evo') =>
  ingest.request(`/taina/evolution?k=${k}`, { method: 'POST', body: corpo }, env);

describe('POST /ingest/:slug/evolution', () => {
  test('chave errada: 401 e nada gravado', async () => {
    const { env, consultar } = cenario();
    const r = await postar(env, CARTAO, 'errada');
    expect(r.status).toBe(401);
    expect(consultar('SELECT * FROM meta_atribuicoes')).toHaveLength(0);
  });

  test('a chave antiga do cliente nao abre a Evolution', async () => {
    const { env } = cenario();
    expect((await postar(env, CARTAO, 'legado')).status).toBe(401);
  });

  test('mensagem sem cartao: 200 e nada gravado', async () => {
    const { env, consultar } = cenario();
    const r = await postar(env, SEM_CARTAO);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, gravado: false });
    expect(consultar('SELECT * FROM meta_atribuicoes')).toHaveLength(0);
  });

  test('com cartao: guarda o clique pelo telefone, sem miniatura e sem passar pela fila', async () => {
    const { env, consultar, fila } = cenario();
    const r = await postar(env, CARTAO);
    expect(await r.json()).toEqual({ ok: true, gravado: true });
    expect(consultar(`SELECT tenant_id, phone_key, phone_e164, ctwa_clid, ad_id, source_url, titulo,
                             evo_instancia, origem FROM meta_atribuicoes`)).toEqual([{
      tenant_id: 5, phone_key: '7191065853', phone_e164: '+5571991065853', ctwa_clid: 'ARAk-clid',
      ad_id: '1202', source_url: 'https://fb.me/abc', titulo: 'Harmonização',
      evo_instancia: 'Tainã Aci', origem: 'evolution',
    }]);
    expect(fila).toEqual([]);
    expect(consultar('SELECT * FROM events')).toHaveLength(0);
  });

  test('o mesmo clique reenviado vira uma linha so', async () => {
    const { env, consultar } = cenario();
    await postar(env, CARTAO);
    const r = await postar(env, CARTAO);
    expect(await r.json()).toEqual({ ok: true, gravado: false });
    expect(consultar('SELECT * FROM meta_atribuicoes')).toHaveLength(1);
  });

  test('corpo acima de 1 MB e descartado', async () => {
    const { env, consultar } = cenario();
    const enorme = CARTAO.replace('/9j/MINIATURA', 'x'.repeat(1_100_000));
    const r = await postar(env, enorme);
    expect(await r.json()).toEqual({ ok: true, gravado: false });
    expect(consultar('SELECT * FROM meta_atribuicoes')).toHaveLength(0);
  });
});
