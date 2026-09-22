import { describe, test, expect } from 'vitest';
import { dataDoD1, planoDeImportacao } from '../../src/domain/importTracker';
import { phoneKey } from '../../src/domain/phone';
import { fakeD1 } from '../helpers/fakeD1';

const dados = {
  cliente: {
    meta_dataset_id: '1234567890', meta_token_cipher: 'CIFRA', meta_token_iv: 'IV', meta_token_last4: 'ZDZD',
    meta_token_valid: 1, meta_token_checked_at: '2026-09-19T12:00:00.000Z', meta_page_id: '102345678901234', meta_waba_id: null,
  },
  atribuicoes: [
    { phone_e164: '+5571991065853', ctwa_clid: 'clid-1', ad_id: '1202', source_url: 'https://fb.me/a', first_message_at: '2026-09-18T10:00:00.000Z' },
    { phone_e164: '+1', ctwa_clid: 'clid-sem-fone', ad_id: null, source_url: null, first_message_at: '2026-09-18T10:00:00.000Z' },
  ],
  eventos: [
    { event_id: 'trk-1', event_name: 'LeadSubmitted', phone_e164: '+5571991065853', value: null, currency: null, status: 'enviado', http_code: 200, created_at: '2026-09-18T10:00:05.000Z', sent_at: '2026-09-18T10:00:06.000Z' },
    { event_id: 'trk-2', event_name: 'LeadSubmitted', phone_e164: '+5571991065854', value: null, currency: null, status: 'falhou', http_code: 400, created_at: '2026-09-18T11:00:00.000Z', sent_at: null },
  ],
};

describe('planoDeImportacao', () => {
  test('aplicado no banco: config com envio desligado, cliques e so os envios que a Meta aceitou', () => {
    const { d1, exec, consultar } = fakeD1();
    exec(`INSERT INTO tenants (id, slug, nome) VALUES (5, 'taina', 'Taina')`);
    exec(`INSERT INTO tenant_config (tenant_id, cw_account_id, cw_board_funil_id, ingest_key) VALUES (5, 3, 9, 'k')`);

    for (const c of planoDeImportacao(5, dados, phoneKey)) {
      void d1.prepare(c.sql).bind(...c.params).run();
    }

    expect(consultar(`SELECT meta_dataset_id, meta_token_cipher, meta_token_iv, meta_token_last4, meta_token_valido,
                             meta_token_conferido_em, meta_page_id, meta_dry_run FROM tenant_config`)).toEqual([{
      meta_dataset_id: '1234567890', meta_token_cipher: 'CIFRA', meta_token_iv: 'IV', meta_token_last4: 'ZDZD',
      meta_token_valido: 1, meta_token_conferido_em: '2026-09-19 12:00:00', meta_page_id: '102345678901234', meta_dry_run: 1,
    }]);
    expect(consultar(`SELECT phone_key, ctwa_clid, origem, recebido_em FROM meta_atribuicoes`)).toEqual([
      { phone_key: '7191065853', ctwa_clid: 'clid-1', origem: 'tracker', recebido_em: '2026-09-18 10:00:00' },
    ]);
    expect(consultar(`SELECT dedupe_key, event_id, phone_key, canal, event_name, status, origem, protocol FROM meta_eventos`)).toEqual([
      { dedupe_key: 'trk-1', event_id: 'trk-1', phone_key: '7191065853', canal: 'whatsapp', event_name: 'LeadSubmitted', status: 'enviado', origem: 'tracker', protocol: null },
    ]);
  });

  test('rodar duas vezes nao duplica nada', () => {
    const { d1, exec, consultar } = fakeD1();
    exec(`INSERT INTO tenants (id, slug, nome) VALUES (5, 'taina', 'Taina')`);
    exec(`INSERT INTO tenant_config (tenant_id, cw_account_id, cw_board_funil_id, ingest_key) VALUES (5, 3, 9, 'k')`);
    for (let i = 0; i < 2; i++) {
      for (const c of planoDeImportacao(5, dados, phoneKey)) void d1.prepare(c.sql).bind(...c.params).run();
    }
    expect(consultar('SELECT * FROM meta_atribuicoes')).toHaveLength(1);
    expect(consultar('SELECT * FROM meta_eventos')).toHaveLength(1);
  });
});

describe('dataDoD1', () => {
  test('ISO vira o formato do D1', () => {
    expect(dataDoD1('2026-09-18T10:00:00.000Z')).toBe('2026-09-18 10:00:00');
    expect(dataDoD1(null)).toBeNull();
  });
});
